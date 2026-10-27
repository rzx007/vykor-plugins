import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const hostIndex = args.indexOf('--host-root');
const binaryIndex = args.indexOf('--xerj-binary');
if (hostIndex < 0 || !args[hostIndex + 1] || binaryIndex < 0 || !args[binaryIndex + 1] || args.length !== 4) {
  throw new Error('Usage: host-smoke.mjs --host-root <host> --xerj-binary <verified xerj executable>');
}
const hostRoot = resolve(args[hostIndex + 1]);
const xerjBinary = resolve(args[binaryIndex + 1]);
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostImport = (path) => import(pathToFileURL(join(hostRoot, path)).href);
const [plugins, { ToolRegistry }, { activateNativePluginTools }, { discoverVykorExtensions }, { createRunCapabilityView }, { grepTool }, { fileReadTool }] = await Promise.all([
  hostImport('packages/plugins/src/index.ts'),
  hostImport('packages/core/src/index.ts'),
  hostImport('packages/agent-runtime/src/node/plugins/native-tools/activate.ts'),
  hostImport('packages/agent-runtime/src/node/plugins/plugin-discovery.ts'),
  hostImport('packages/agent-runtime/src/node/plugins/run-capability-view.ts'),
  hostImport('packages/tools/src/search/grep.ts'),
  hostImport('packages/tools/src/file/read.ts'),
]);

const runRoot = await mkdtemp(join(tmpdir(), 'vykor-xerj-host-'));
const originalEnv = Object.fromEntries(['VYKOR_CONFIG_DIR', 'VYKOR_DATA_DIR'].map(key => [key, process.env[key]]));
process.env.VYKOR_CONFIG_DIR = join(runRoot, 'profile');
process.env.VYKOR_DATA_DIR = join(runRoot, 'data');
const cleanups = [];
const requests = [];
const sockets = new Set();
let responseMode = 'ok';
const server = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, path: request.url, body: JSON.parse(body || '{}') });
  if (responseMode === 'timeout') return;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ hits: { hits: [{ _source: { ax_path: 'src/example.ts', line: 1, code: 'export const hostSmoke = "real native host";' } }] } }));
});
server.on('connection', socket => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

const textJson = result => JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
const settings = { model: 'host-smoke', apiFormat: 'openai', maxTurns: 1, permission: { mode: 'default' }, plugins: { enabled: true }, sandbox: { enabled: false } };
let childPid;
try {
  const cwd = join(runRoot, 'project');
  await mkdir(join(cwd, 'src'), { recursive: true });
  await writeFile(join(cwd, 'src/example.ts'), 'export const hostSmoke = "real native host";\n');
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const serviceUrl = `http://127.0.0.1:${server.address().port}`;

  const validation = await plugins.validateNativePlugin(pluginRoot);
  assert.equal(validation.status, 'valid', JSON.stringify(validation.diagnostics));
  assert.ok(validation.plugin);
  const loaded = await plugins.loadNativePlugin(validation.plugin);
  assert.equal(loaded.components.tools?.status, 'loaded');
  assert.equal(loaded.components.tools.value.length, 1);
  const pluginId = loaded.manifest.id;
  const permissions = plugins.requestedPluginPermissions(loaded.manifest);
  assert.ok(permissions.includes('network:127.0.0.1'));
  assert.ok(permissions.includes('filesystem:read'));
  const installInput = {
    sourcePath: pluginRoot, scope: 'user', cwd,
    cacheDir: join(runRoot, 'cache'), storePath: join(process.env.VYKOR_CONFIG_DIR, 'plugins/installed.json'),
  };
  const deniedInstall = await plugins.installLocalNativePlugin({ ...installInput, approvedPermissions: [] });
  assert.equal(deniedInstall.status, 'blocked');
  assert.ok(deniedInstall.diagnostics.some(item => item.code === 'plugin_permissions_not_approved'));
  const installed = await plugins.installLocalNativePlugin({ ...installInput, approvedPermissions: permissions });
  assert.equal(installed.status, 'installed', JSON.stringify(installed.diagnostics));

  const discovery = await discoverVykorExtensions(cwd, settings);
  assert.deepEqual(discovery.plugins.map(plugin => plugin.manifest.id), [pluginId], discovery.warnings.join('\n'));
  assert.deepEqual((await discoverVykorExtensions(cwd, { ...settings, plugins: { enabled: false } })).plugins, []);
  assert.deepEqual((await discoverVykorExtensions(cwd, settings, { pluginsEnabled: false })).plugins, []);

  const dataRoot = join(runRoot, 'tool-data');
  const configPath = join(dataRoot, pluginId, 'xerj.json');
  const codeHome = join(runRoot, 'native-code'); await mkdir(codeHome);
  const config = { enabled: true, binary: xerjBinary, codeHome, url: serviceUrl, projects: [{ root: cwd, prefix: 'host-smoke', corpus: 'host-smoke' }], timeoutMs: 1500 };
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config));
  const registry = new ToolRegistry();
  const activation = await activateNativePluginTools(discovery.plugins[0], {
    cwd, settings, dataRoot, toolRegistry: registry, addCleanup: cleanup => cleanups.push(cleanup),
  });
  assert.equal(activation.state, 'active', JSON.stringify(activation.diagnostics));
  assert.deepEqual([...activation.toolNames].sort(), ['XerjBatchSearch', 'XerjDefinition', 'XerjMap', 'XerjSearch']);
  assert.deepEqual(registry.inspect('XerjSearch')?.source, { kind: 'plugin', id: pluginId });
  // This opt-in smoke targets the supplied source checkout, whose host owns this child.
  childPid = activation.host?.child?.pid;
  assert.ok(Number.isSafeInteger(childPid) && childPid !== process.pid, 'Expected a separate native ToolHost process');

  const sources = { toolRegistry: registry, pluginIds: new Set([pluginId]) };
  const baseline = createRunCapabilityView(sources, []);
  const selected = createRunCapabilityView(sources, [pluginId]);
  assert.equal(baseline.tools.has('XerjSearch'), false);
  assert.equal(selected.tools.has('XerjSearch'), true);
  const tool = registry.get('XerjSearch');
  const input = { query: 'hostSmoke' };
  const context = { cwd, agent: { tools: selected.tools } };
  const found = textJson(await tool.execute(input, context));
  assert.equal(found.status, 'ok', JSON.stringify(found));
  assert.ok(found.hits.some(hit => hit.path === 'src/example.ts' && Number.isSafeInteger(hit.line) && hit.line > 0 && hit.text.includes('hostSmoke')));
  const readable = found.hits.find(hit => hit.path === 'src/example.ts');
  assert.equal(readable.readLine, 1);
  const hintedRead = await fileReadTool.execute({ file_path: readable.path, offset: Math.max(1, readable.readLine - 12), limit: 25 }, { cwd });
  assert.notEqual(hintedRead.isError, true);
  assert.match(hintedRead.content.filter(block => block.type === 'text').map(block => block.text).join('\n'), /1: export const hostSmoke/);
  assert.equal(requests.at(-1).method, 'POST');
  assert.match(requests.at(-1).path, /^\/host-smoke-.*\/_search$/);
  const requestCount = requests.length;
  const scopeDenied = await tool.execute(input, { cwd, agent: { tools: baseline.tools } });
  assert.equal(scopeDenied.failureKind, 'policy');
  assert.equal(scopeDenied.executionState, 'not_started');
  const networkDenied = await tool.execute(input, { ...context, environment: { info: { networkMode: 'none' } } });
  assert.equal(networkDenied.failureKind, 'policy');
  assert.equal(networkDenied.executionState, 'not_started');
  assert.equal(requests.length, requestCount);
  await assert.rejects(tool.execute({ query: 123 }, context), error => error.code === 'tool_input_invalid');

  await writeFile(configPath, JSON.stringify({ ...config, enabled: false }));
  const disabled = textJson(await tool.execute(input, context));
  assert.equal(disabled.status, 'fallback');
  assert.equal(disabled.reason, 'disabled');
  assert.equal(disabled.fallback.tool, 'Grep');
  assert.equal(requests.length, requestCount);
  const grepResult = await grepTool.execute(disabled.fallback.input, { cwd });
  assert.notEqual(grepResult.isError, true);
  const grepText = grepResult.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  assert.match(grepText, /src[\\/]example\.ts:1:.*hostSmoke/);
  const readResult = await fileReadTool.execute({ file_path: 'src/example.ts', offset: 1, limit: 2 }, { cwd });
  assert.notEqual(readResult.isError, true);
  assert.match(readResult.content.filter(block => block.type === 'text').map(block => block.text).join('\n'), /1: export const hostSmoke/);
  await rm(configPath);
  const missing = textJson(await tool.execute(input, context));
  assert.equal(missing.status, 'fallback');
  assert.equal(missing.reason, 'not_configured');
  assert.equal(missing.fallback.tool, 'Grep');
  await writeFile(configPath, JSON.stringify({ ...config, timeoutMs: 400 }));
  responseMode = 'timeout';
  const timedOut = textJson(await tool.execute(input, context));
  assert.equal(timedOut.status, 'fallback');
  assert.equal(timedOut.reason, 'timeout');
  assert.equal(timedOut.fallback.tool, 'Grep');
  assert.equal(requests.length, requestCount + 1);

  await plugins.updateInstalledPluginStore(installInput.storePath, store => { store.plugins[`user::${pluginId}`].enabled = false; });
  assert.deepEqual((await discoverVykorExtensions(cwd, settings)).plugins, []);
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  assert.equal(registry.has('XerjSearch'), false);
  assert.equal(activation.host.state, 'inactive');
  const processStopped = () => {
    try { process.kill(childPid, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  };
  const stopDeadline = Date.now() + 3000;
  while (!processStopped() && Date.now() < stopDeadline) await new Promise(accept => setTimeout(accept, 20));
  assert.ok(processStopped(), 'Native ToolHost child must stop during cleanup');
  console.log(JSON.stringify({ status: 'passed', hostRoot, pluginId, nativeChildPid: childPid,
    permissions, httpRequests: requests.length,
    checks: ['validate', 'load', 'permission approval', 'isolated installation', 'discovery', 'disabled visibility', 'unselected visibility', 'native process', 'HTTP search', 'readLine to real Read', 'scope denial', 'network denial', 'input validation', 'disabled fallback', 'fallback to real Grep and Read', 'missing fallback', 'timeout fallback', 'cleanup'] }, null, 2));
} finally {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const socket of sockets) socket.destroy();
  await new Promise(accept => server.close(accept));
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const checkedRoot = resolve(runRoot);
  assert.ok(checkedRoot.startsWith(resolve(tmpdir()) + '\\') || checkedRoot.startsWith(resolve(tmpdir()) + '/'));
  await rm(checkedRoot, { recursive: true, force: true });
}
