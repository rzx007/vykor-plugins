import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSearchService } from '../tools/search.mjs';
const native = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const definition = path => native({ hits: { hits: [{ _source: { ax_path: path, line: 2, code: 'export function readCache() {' } }] } });
async function fixture(t, respond = () => definition('src/cache.ts')) {
  const temp = await mkdtemp(join(tmpdir(), 'vykor-xerj-native-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'repo'), dataDir = join(temp, 'data'), codeHome = join(temp, 'code-home');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(dataDir); await mkdir(join(codeHome, 'state'), { recursive: true });
  await writeFile(join(root, 'src/cache.ts'), '// current file\nexport function readCache() {\n  return cache.get(key);\n}\n');
  await writeFile(join(codeHome, 'state/current.json'), JSON.stringify({ index_prefix: 'project-', url: 'http://127.0.0.1:9200', indexed_at: new Date().toISOString() }));
  const config = { enabled: true, binary: process.execPath, codeHome, url: 'http://127.0.0.1:9200', projects: [{ root, prefix: 'project', corpus: 'current' }], timeoutMs: 1500 };
  const configure = value => writeFile(join(dataDir, 'xerj.json'), JSON.stringify(value));
  await configure(config);
  const calls = [];
  const service = createSearchService(async (settings, name, args) => { calls.push({ settings, name, args }); return respond(settings, name, args); });
  const context = { cwd: root, plugin: { dataDir }, signal: new AbortController().signal, deadline: Date.now() + 5000 };
  return { temp, root, dataDir, config, configure, context, calls, ...service };
}
test('symbol lookup uses native definition ordering and native passage', async t => {
  const f = await fixture(t);
  const result = await f.searchRepository({ query: 'readCache' }, f.context);
  assert.equal(result.status, 'ok'); assert.equal(f.calls[0].name, 'xerj_def');
  assert.equal(f.calls[0].args.prefix, 'project');
  assert.equal(result.hits[0].path, 'src/cache.ts'); assert.equal(result.hits[0].line, 2);
  assert.equal(result.hits[0].text, 'export function readCache() {');
});
test('code search preserves the native matching window instead of taking a file head', async t => {
  const f = await fixture(t, () => native('\n─── src/cache.ts:2  (score 8.5)\n    [function readCache @ line 2 — 24 of 70 chars]\n  return cache.get(key);\n\n1 passages from current\nCite file:line for anything you rely on.\n'));
  const result = await f.searchRepository({ query: 'read cached value' }, f.context);
  assert.equal(f.calls[0].name, 'xerj_code_search'); assert.equal(f.calls[0].args.corpus, 'current');
  assert.equal(result.status, 'ok'); assert.equal(result.hits[0].line, 3);
  assert.equal(result.hits[0].text, '  return cache.get(key);');
});
test('explicit definition accepts a capability phrase and map is scoped to the project', async t => {
  const f = await fixture(t, (_settings, name) => name === 'xerj_map' ? native({ indexes: [
    { index: 'project-docs', fields: [{ name: 'body', es_type: 'text' }] }, { index: 'other-private', fields: [{ name: 'secret' }] },
  ] }) : definition('src/cache.ts'));
  await f.findDefinition({ symbol: 'cache read policy', limit: 2 }, f.context);
  assert.equal(f.calls[0].name, 'xerj_def'); assert.equal(f.calls[0].args.symbol, 'cache read policy');
  const result = await f.mapRepository({}, f.context);
  assert.equal(f.calls[1].name, 'xerj_map'); assert.equal(f.calls[1].args.index, 'project-*');
  assert.deepEqual(result.map.indexes.map(item => item.index), ['project-docs']);
  assert.doesNotMatch(JSON.stringify(result), /other-private|secret/);
});
test('native batch keeps duplicate query positions and per-item abstention or errors', async t => {
  const f = await fixture(t, () => native({ results: [
    { position: 0, status: 'hits', hits: [{ hit: { _source: { ax_path: 'src/cache.ts', line: 2, code: 'export function readCache() {' } } }] },
    { position: 1, status: 'abstain', hits: [] }, { position: 2, status: 'error', error: { reason: 'invalid_search_response' } },
  ] }));
  const result = await f.batchSearch({ queries: ['readCache', 'readCache', 'unknown'] }, f.context);
  assert.equal(f.calls[0].name, 'xerj_batch_search'); assert.equal(f.calls[0].args.prefix, 'project');
  assert.equal(result.results.length, 3); assert.deepEqual(result.results.map(item => item.position), [0, 1, 2]);
  assert.deepEqual(result.results.map(item => item.status), ['hits', 'abstain', 'error']);
  assert.equal(result.results[1].fallback.tool, 'Grep');
});
test('disabled, absent and unmatched project configuration do not invoke XERJ', async t => {
  const f = await fixture(t); await f.configure({ enabled: false });
  assert.equal((await f.searchRepository({ query: 'readCache()' }, f.context)).reason, 'disabled');
  await rm(join(f.dataDir, 'xerj.json'));
  assert.equal((await f.searchRepository({ query: 'x' }, f.context)).reason, 'not_configured');
  await f.configure(f.config); await mkdir(join(f.temp, 'other'));
  assert.equal((await f.searchRepository({ query: 'x' }, { ...f.context, cwd: join(f.temp, 'other') })).reason, 'project_not_configured');
  assert.equal(f.calls.length, 0);
});
test('model inputs cannot replace endpoint, corpus, prefix or supply query DSL', async t => {
  const f = await fixture(t);
  for (const input of [{ query: { match_all: {} } }, { query: 'x', index: '*' }, { query: 'x', corpus: 'other' }, { query: 'x', limit: 20 }]) await assert.rejects(f.searchRepository(input, f.context), /query|argument|limit/i);
  await assert.rejects(f.batchSearch({ queries: [{ query: 'x', index: '*' }] }, f.context), /queries/i);
  assert.equal(f.calls.length, 0);
});
test('refuses a code corpus bound to another index or remote endpoint', async t => {
  const f = await fixture(t);
  await writeFile(join(f.config.codeHome, 'state/current.json'), JSON.stringify({ index_prefix: 'private-', url: f.config.url }));
  assert.equal((await f.searchRepository({ query: 'read cache' }, f.context)).reason, 'corpus_scope_mismatch');
  await f.configure({ ...f.config, url: 'https://example.com' });
  assert.equal((await f.searchRepository({ query: 'x' }, f.context)).reason, 'invalid_config'); assert.equal(f.calls.length, 0);
});
test('native weak-match warning triggers Grep fallback and keeps the warning', async t => {
  const f = await fixture(t, () => native('weak match: the corpus may not cover this\n\n─── src/cache.ts:2  (score 1, weak)\nexport function readCache() {\n\n1 passages from current\n'));
  const result = await f.searchRepository({ query: 'unfamiliar cache workflow' }, f.context);
  assert.equal(result.status, 'fallback'); assert.equal(result.reason, 'weak_match'); assert.equal(result.weakMatch, true);
  assert.equal(result.fallback.tool, 'Grep');
});
test('rejects outside paths, private paths, directory links and changed indexed passages', async t => {
  const f = await fixture(t, () => native({ hits: { hits: [
    { _source: { ax_path: '../outside.ts', line: 1, code: 'PRIVATE' } },
    { _source: { ax_path: '.env', line: 1, code: 'PRIVATE' } },
    { _source: { ax_path: 'linked/outside.ts', line: 1, code: 'PRIVATE' } },
    { _source: { ax_path: 'src/cache.ts', line: 2, code: 'OLD REMOVED IMPLEMENTATION' } },
  ] } }));
  await mkdir(join(f.temp, 'outside')); await writeFile(join(f.temp, 'outside/outside.ts'), 'PRIVATE');
  await symlink(join(f.temp, 'outside'), join(f.root, 'linked'), 'junction');
  const result = await f.searchRepository({ query: 'readCache' }, f.context);
  assert.equal(result.reason, 'no_usable_hits'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|OLD REMOVED/);
});
test('native timeout falls back, caller cancellation propagates and upstream errors stay private', async t => {
  const f = await fixture(t, settings => new Promise((_, reject) => settings.signal.addEventListener('abort', () => reject(settings.signal.reason), { once: true })));
  await f.configure({ ...f.config, timeoutMs: 50 });
  assert.equal((await f.searchRepository({ query: 'readCache' }, f.context)).reason, 'timeout');
  const controller = new AbortController(); const pending = f.searchRepository({ query: 'readCache' }, { ...f.context, signal: controller.signal });
  setTimeout(() => controller.abort(), 10); await assert.rejects(pending, error => error.name === 'AbortError');
  const e = await fixture(t, () => ({ isError: true, content: [{ type: 'text', text: 'ApiKey private-credential' }] }));
  const result = await e.searchRepository({ query: 'readCache' }, e.context);
  assert.equal(result.status, 'fallback'); assert.doesNotMatch(JSON.stringify(result), /private-credential/);
});
test('an unreadable authentication file falls back without exposing its path', async t => {
  const f = await fixture(t);
  await f.configure({ ...f.config, authFile: join(f.temp, 'private.key') });
  const result = await f.searchRepository({ query: 'readCache' }, f.context);
  assert.equal(result.reason, 'invalid_config');
  assert.doesNotMatch(JSON.stringify(result), /private.key/);
  assert.equal(f.calls.length, 0);
});
test('a whole batch failure preserves a separate fallback for every original query', async t => {
  const f = await fixture(t, () => { throw new Error('native_process_exit'); });
  const result = await f.batchSearch({ queries: ['readCache', 'readCache', 'other'] }, f.context);
  assert.equal(result.status, 'fallback');
  assert.equal(result.results.length, 3);
  assert.deepEqual(result.results.map(item => item.position), [0, 1, 2]);
  assert.ok(result.results.every(item => item.status === 'error' && item.fallback.tool === 'Grep'));
});
test('keeps separate native definitions from the same file in native order', async t => {
  const f = await fixture(t, () => native({ hits: { hits: [
    { _source: { ax_path: 'src/cache.ts', line: 1, code: 'export function alpha() {' } },
    { _source: { ax_path: 'src/cache.ts', line: 4, code: 'export function beta() {' } },
  ] } }));
  await writeFile(join(f.root, 'src/cache.ts'), 'export function alpha() {\n  return false;\n}\nexport function beta() {\n  return false;\n}\n');
  const result = await f.findDefinition({ symbol: 'alpha beta' }, f.context);
  assert.deepEqual(result.hits.map(hit => hit.line), [1, 4]);
});
test('uses the native locator to disambiguate repeated code and does not invent unknown lines', async t => {
  const f = await fixture(t, () => native('\n─── src/cache.ts:5  (score 2)\n  return false;\n\n1 passages from current\n'));
  await writeFile(join(f.root, 'src/cache.ts'), 'export function alpha() {\n  return false;\n}\nexport function beta() {\n  return false;\n}\n');
  assert.equal((await f.searchRepository({ query: 'return false code' }, f.context)).hits[0].line, 5);
  const ambiguous = createSearchService(async () => native('\n─── src/cache.ts (line unknown — no file line)  (score 2)\n  return false;\n\n1 passages from current\n'));
  const result = await ambiguous.searchRepository({ query: 'return false code' }, f.context);
  assert.equal(result.hits[0].line, null);
  assert.equal(result.hits[0].evidence, 'native_passage_verified_current_ambiguous');
});
test('accepts an ordinary native corpus ledger pinned to the exact configured build prefix', async t => {
  const f = await fixture(t, () => native('\n─── src/cache.ts:2  (score 2)\nexport function readCache() {\n\n1 passages from current\n'));
  await writeFile(join(f.config.codeHome, 'state/current.json'), JSON.stringify({ index_prefix: 'project', url: f.config.url }));
  assert.equal((await f.searchRepository({ query: 'read cache implementation' }, f.context)).status, 'ok');
});
test('even a disabled batch with eight maximum-length Unicode queries stays within the byte budget', async t => {
  const f = await fixture(t); await f.configure({ enabled: false });
  const result = await f.batchSearch({ queries: Array.from({ length: 8 }, () => '字'.repeat(500)) }, f.context);
  assert.equal(result.results.length, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 16384);
  assert.ok(result.results.every(item => item.fallback.input.pattern === '字'.repeat(500)));
});
test('JSON-heavy fallback patterns retain original query positions within the batch budget', async t => {
  const f = await fixture(t); await f.configure({ enabled: false });
  const result = await f.batchSearch({ queries: Array.from({ length: 8 }, () => '\\'.repeat(500)) }, f.context);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 16384);
  assert.deepEqual(result.results.map(item => item.fallback.queryPosition), [0, 1, 2, 3, 4, 5, 6, 7]);
});
test('batch budgeting retains a verified locator for every matched query instead of turning it into an error', async t => {
  const alpha = `export const alpha = '${'字'.repeat(700)}';`;
  const beta = `export const beta = '${'字'.repeat(700)}';`;
  const f = await fixture(t, () => native({ results: Array.from({ length: 8 }, (_, position) => ({ position, status: 'hits', hits: [alpha, beta].map((code, index) => ({ hit: { _source: { ax_path: 'src/cache.ts', line: index + 1, code } } })) })) }));
  await writeFile(join(f.root, 'src/cache.ts'), alpha + '\n' + beta + '\n');
  const result = await f.batchSearch({ queries: Array.from({ length: 8 }, () => 'alpha beta') }, f.context);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 16384);
  assert.ok(result.results.every(item => item.status === 'hits' && item.hits.length >= 1));
  assert.ok(result.results.some(item => item.hits.some(hit => hit.evidence === 'native_locator_only')));
});
test('uses the native batch citation when its token budget has removed the raw hit source', async t => {
  const f = await fixture(t, () => native({ results: [{ position: 0, status: 'hits', hits: [
    { citation: { ax_path: 'src/cache.ts', line: 2, match_line: 2 }, hit: { _index: 'project-docs', _id: 'one' } },
  ] }] }));
  const result = await f.batchSearch({ queries: ['readCache'] }, f.context);
  assert.equal(result.results[0].status, 'hits');
  assert.equal(result.results[0].hits[0].path, 'src/cache.ts');
  assert.equal(result.results[0].hits[0].line, 2);
  assert.equal(result.results[0].hits[0].evidence, 'native_locator_only');
});
test('keeps a native batch file-only citation with an explicitly unknown line', async t => {
  const f = await fixture(t, () => native({ results: [{ position: 0, status: 'hits', hits: [
    { citation: { ax_path: 'src/cache.ts', ax_locator: 'code' } },
  ] }] }));
  const result = await f.batchSearch({ queries: ['read cache'] }, f.context);
  assert.equal(result.results[0].status, 'hits');
  assert.equal(result.results[0].hits[0].line, null);
  assert.equal(result.results[0].hits[0].evidence, 'native_locator_only');
});
