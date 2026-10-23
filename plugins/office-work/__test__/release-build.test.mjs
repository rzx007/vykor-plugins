import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, access, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const script = new URL('../scripts/build.mjs', import.meta.url);
const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'office-release-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'bin'));
  await mkdir(join(dir, 'cache'));
  // A missing build entry is the regression: a fresh market checkout cannot prepare its runtime.
  await assert.doesNotReject(() => access(script), 'independent Node build entry is required');
  const { ensureVerifiedBinary } = await import(script);
  return { dir, ensureVerifiedBinary, options: { name: 'officecli-linux-x64', sha256, version: '1.0.139', binDir: join(dir, 'bin'), cacheDir: join(dir, 'cache') } };
}
test('a verified cached binary prepares the plugin without a network request', async t => {
  const { dir, ensureVerifiedBinary, options } = await fixture(t);
  await writeFile(join(dir, 'cache', options.name), 'hello');
  const result = await ensureVerifiedBinary({ ...options, fetcher() { throw Error('network must not be used'); } });
  assert.equal(result.bytes, 5);
  assert.equal(await readFile(join(dir, 'bin', options.name), 'utf8'), 'hello');
});
test('corrupted cached binaries cannot enter a release', async t => {
  const { dir, ensureVerifiedBinary, options } = await fixture(t);
  await writeFile(join(dir, 'cache', options.name), 'tampered');
  await assert.rejects(() => ensureVerifiedBinary(options), /SHA-256/);
  assert.deepEqual(await readdir(join(dir, 'bin')), []);
});
test('downloads use the pinned release URL and reject corrupt bytes before publication', async t => {
  const { dir, ensureVerifiedBinary, options } = await fixture(t);
  await assert.rejects(() => ensureVerifiedBinary({ ...options, fetcher(url) {
    assert.equal(url, 'https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.139/officecli-linux-x64');
    return new Response('wrong bytes');
  } }), /SHA-256/);
  assert.deepEqual(await readdir(join(dir, 'bin')), []);
  assert.deepEqual(await readdir(join(dir, 'cache')), []);
});
test('verified downloads become reusable even if the plugin output is removed', async t => {
  const { dir, ensureVerifiedBinary, options } = await fixture(t);
  await ensureVerifiedBinary({ ...options, fetcher: async () => new Response('hello') });
  await rm(join(dir, 'bin', options.name));
  await ensureVerifiedBinary({ ...options, fetcher() { throw Error('download repeated'); } });
  assert.equal(await readFile(join(dir, 'bin', options.name), 'utf8'), 'hello');
});
test('a separate plugin checkout prepares releases from its own engine source', async t => {
  const { dir } = await fixture(t);
  const source = fileURLToPath(new URL('..', import.meta.url));
  await assert.doesNotReject(() => access(join(source, 'tools/office-engine.mjs')), 'the plugin must own its engine source');
  for (const path of ['scripts', 'tools', 'licenses', 'vendor', '.vykor-plugin', 'LICENSE', 'package.json']) {
    await cp(join(source, path), join(dir, path), { recursive: true });
  }
  // Keep the actual engine implementation; only substitute the checksums so tiny
  // cached fixtures can exercise the full release entry without real binaries.
  const modulePath = join(dir, 'tools/office-engine.mjs');
  await writeFile(modulePath, (await readFile(modulePath, 'utf8')).replace(/"[a-f0-9]{64}"/g, JSON.stringify(sha256)));
  const names = ['officecli-win-x64.exe', 'officecli-win-arm64.exe', 'officecli-linux-x64', 'officecli-linux-arm64', 'officecli-mac-x64', 'officecli-mac-arm64'];
  await mkdir(join(dir, 'cache/v1.0.139'), { recursive: true });
  for (const name of names) await writeFile(join(dir, 'cache/v1.0.139', name), 'hello');
  const { stdout } = await promisify(execFile)(process.execPath, [join(dir, 'scripts/build.mjs')], {
    cwd: dir,
    env: { ...process.env, OFFICECLI_CACHE_DIR: join(dir, 'cache') },
    windowsHide: true,
    timeout: 10000,
  });
  assert.match(stdout, /Prepared OfficeCLI v1\.0\.139: 6 platforms, 30 binary bytes/);
  for (const name of names) assert.equal(await readFile(join(dir, 'bin', name), 'utf8'), 'hello');
  const { createRunner, OFFICE_VERSION } = await import(pathToFileURL(modulePath));
  assert.equal(OFFICE_VERSION, '1.0.139');
  const run = createRunner(process.execPath, { cwd: dir, signal: new AbortController().signal, deadline: Date.now() + 30000 });
  assert.equal(await run(['-e', 'process.stdout.write("independent engine")']), 'independent engine');
});
