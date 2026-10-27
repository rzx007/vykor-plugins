import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const usage = 'Usage: node --import <host>/apps/cli/node_modules/tsx/dist/loader.mjs plugins/xerj-search/scripts/agent-ab.mjs --host-root <host> --corpus <directory> --service-url <loopback URL> --prefix <prefix> --plugin-config <xerj.json> --output <report.json> [--tasks <tasks.json>] [--run] [--resume]';
const flags = new Map();
let run = false;
let resume = false;
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (flag === '--run') { run = true; continue; }
  if (flag === '--resume') { resume = true; continue; }
  if (!['--host-root', '--corpus', '--service-url', '--prefix', '--output', '--tasks', '--plugin-config'].includes(flag) || !process.argv[index + 1] || flags.has(flag)) throw new Error(usage);
  flags.set(flag, process.argv[++index]);
}
for (const flag of ['--host-root', '--corpus', '--service-url', '--prefix', '--output']) if (!flags.has(flag)) throw new Error(usage);
assert.ok(!resume || run, '--resume requires --run');
const hostRoot = resolve(flags.get('--host-root'));
const corpus = resolve(flags.get('--corpus'));
assert.ok((await stat(corpus)).isDirectory(), 'The corpus must be an existing directory');
const output = resolve(flags.get('--output'));
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tasksPath = resolve(flags.get('--tasks') ?? join(pluginRoot, 'evaluation/tasks.json'));
const endpoint = new URL(flags.get('--service-url'));
assert.equal(endpoint.protocol, 'http:');
assert.equal(endpoint.hostname, '127.0.0.1');
assert.equal(endpoint.username + endpoint.password + endpoint.search + endpoint.hash, '');
assert.equal(endpoint.pathname, '/');
const prefix = flags.get('--prefix');
assert.match(prefix, /^[a-z0-9][a-z0-9-]{0,63}$/);
const hostImport = path => import(pathToFileURL(join(hostRoot, path)).href);
const [{ loadSettings }, { resolveApiKey }, api, core, { PermissionChecker }, { fileReadTool }, { grepTool }, plugins,
  { activateNativePluginTools }, { createRunCapabilityView }] = await Promise.all([
  hostImport('packages/host-config/src/index.ts'),
  hostImport('packages/auth/src/index.ts'),
  hostImport('packages/api/src/index.ts'),
  hostImport('packages/core/src/index.ts'),
  hostImport('packages/permissions/src/index.ts'),
  hostImport('packages/tools/src/file/read.ts'),
  hostImport('packages/tools/src/search/grep.ts'),
  hostImport('packages/plugins/src/index.ts'),
  hostImport('packages/agent-runtime/src/node/plugins/native-tools/activate.ts'),
  hostImport('packages/agent-runtime/src/node/plugins/run-capability-view.ts'),
]);

// Resolve credentials read-only before switching this process to a temporary profile.
const configured = await loadSettings(undefined, { projectRoot: hostRoot, includeProject: true });
const apiKey = await resolveApiKey(configured);
const provider = api.findByName(configured.provider);
assert.ok(apiKey, 'The selected model provider has no configured credential');
assert.equal(configured.apiFormat, 'openai', 'This bounded experiment currently supports the OpenAI-compatible adapter only');
assert.ok(provider, 'The selected provider must be registered in the supplied host checkout');
const tasksBytes = await readFile(tasksPath);
assert.ok(flags.has('--plugin-config'), 'Native evaluation requires --plugin-config <operator-owned xerj.json>');
const nativeConfigBytes = await readFile(resolve(flags.get('--plugin-config')));
const nativeConfig = JSON.parse(nativeConfigBytes);
assert.equal(nativeConfig.enabled, true);
assert.equal(nativeConfig.url, endpoint.origin);
assert.ok(nativeConfig.projects.some(project => resolve(project.root) === corpus && project.prefix === prefix));
const taskDocument = JSON.parse(tasksBytes);
const categories = ['exact-symbol', 'english-feature', 'chinese-requirement', 'documentation'];
const tasks = categories.map(category => {
  const task = taskDocument.tasks.find(task => task.category === category);
  assert.ok(task, `Missing task category: ${category}`);
  return task;
});
const systemPrompt = [
  '你是仓库代码定位助手。只用当前工作目录内的代码与资料回答，不修改文件。',
  '有 XerjSearch 时先尝试一次，否则 Grep；fallback 立即 Grep；返回文件和行号。',
  '检索结果不足时可提取关键词并调用 Grep，用 Read 核对当前原文。不要从记忆猜测路径。',
  '回答简洁，说明找到的入口、关键步骤和证据。最多使用六轮模型请求。',
].join('\n');
const selection = {
  schemaVersion: 1, selectedAt: new Date().toISOString(),
  source: { path: tasksPath, sha256: createHash('sha256').update(tasksBytes).digest('hex'), id: taskDocument.id },
  selectionRule: 'First task in each predeclared category, fixed before any model request',
  provider: configured.provider, model: configured.model, corpus, serviceUrl: endpoint.origin, prefix,
  pluginConfiguration: { version: JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version, sha256: createHash('sha256').update(nativeConfigBytes).digest('hex'), tools: ['XerjSearch','XerjDefinition','XerjMap','XerjBatchSearch'] },
  nativePermissionPolicy: ['XerjSearch', 'XerjDefinition', 'XerjMap', 'XerjBatchSearch'],
  budget: { agentRuns: 8, maxModelRequestsPerRun: 6, maxModelRequestsTotal: 48, maxOutputTokensPerRequest: 1024, automaticRetries: 0 },
  systemPrompt,
  tasks: tasks.map(task => ({ ...task, userPrompt: `${task.query}\n请说明定位依据，返回文件与行号。` })),
};
await mkdir(dirname(output), { recursive: true });
const selectionPath = output.replace(/\.json$/i, '') + '.selection.json';
let savedSelection;
try { savedSelection = JSON.parse(await readFile(selectionPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (savedSelection) {
  const comparable = ({ selectedAt, ...value }) => value;
  assert.deepEqual(comparable(selection), comparable(savedSelection), 'Existing precommitted task selection differs; choose a fresh report path');
  selection.selectedAt = savedSelection.selectedAt;
} else {
  await writeFile(selectionPath, JSON.stringify(selection, null, 2) + '\n', { flag: 'wx' });
}
const validation = await plugins.validateNativePlugin(pluginRoot);
assert.equal(validation.status, 'valid', JSON.stringify(validation.diagnostics));
const loaded = await plugins.loadNativePlugin(validation.plugin);
assert.equal(loaded.components.tools?.status, 'loaded');
console.log(JSON.stringify({ phase: 'preflight', configured: true, provider: configured.provider, model: configured.model,
  tasks: selection.tasks.map(({ id, category }) => ({ id, category })), selectionPath, runRequested: run }));
if (!run) process.exit(0);

const originalEnv = Object.fromEntries(['VYKOR_CONFIG_DIR', 'VYKOR_DATA_DIR'].map(key => [key, process.env[key]]));
const runRoot = await mkdtemp(join(tmpdir(), 'vykor-xerj-agent-ab-'));
process.env.VYKOR_CONFIG_DIR = join(runRoot, 'profile');
process.env.VYKOR_DATA_DIR = join(runRoot, 'data');
const safeError = error => ({ name: error?.name ?? 'Error', code: error?.code ?? null,
  message: String(error?.message ?? error).replaceAll(apiKey, '[credential redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]') });
const report = resume ? JSON.parse(await readFile(output, 'utf8')) : { ...selection, selectionPath, startedAt: new Date().toISOString(), runs: [], cost: null,
  costNote: 'Only provider-returned token usage is recorded. No price or billed amount is inferred.' };
if (resume) {
  assert.equal(report.status, 'incomplete', 'Only an interrupted/incomplete report may resume');
  assert.equal(report.source.sha256, selection.source.sha256);
  for (const field of ['systemPrompt', 'provider', 'model', 'corpus', 'serviceUrl', 'prefix']) assert.deepEqual(report[field], selection[field]);
  assert.deepEqual(report.tasks, selection.tasks);
  report.resumedAt ??= [];
  report.resumedAt.push(new Date().toISOString());
  for (const previous of report.runs) {
    if (previous.error?.message === 'Experiment model request budget exhausted') {
      previous.failureKind = 'task_budget_exhausted';
      delete previous.providerFailure;
    }
  }
}
const persist = () => writeFile(output, JSON.stringify(report, null, 2) + '\n');
let totalModelRequests = report.runs.reduce((sum, row) => sum + row.modelRequests, 0);
let totalModelHttpRequests = report.runs.reduce((sum, row) => sum + row.modelHttpRequests, 0);
let providerFailed = false;
const budgetExceeded = () => Object.assign(new Error('Experiment model request budget exhausted'), { name: 'ExperimentBudgetExceeded' });
const summarizeProviderUsage = row => ({
  knownInputTokens: row.modelUsage.length ? row.modelUsage.reduce((sum, usage) => sum + usage.inputTokens, 0) : null,
  knownOutputTokens: row.modelUsage.length ? row.modelUsage.reduce((sum, usage) => sum + usage.outputTokens, 0) : null,
  reportedRequests: row.modelUsage.length, httpRequests: row.modelHttpRequests,
  completeness: row.modelUsage.length === row.modelHttpRequests && row.modelUsage.every(usage => usage.metering?.completeness === 'complete')
    ? 'complete' : row.modelUsage.length ? 'partial' : 'unknown',
});
for (const row of report.runs) row.providerUsage = summarizeProviderUsage(row);

async function oneRun(task, group) {
  const cleanups = [];
  const record = { taskId: task.id, group, status: 'running', tools: [], modelAttempts: [], modelUsage: [], permissions: [],
    toolResultBytes: 0, modelRequests: 0, modelHttpRequests: 0, output: '', durationMs: 0 };
  const started = performance.now();
  let localBudgetExhausted = false;
  const registry = new core.ToolRegistry();
  registry.register(fileReadTool, { kind: 'builtin' });
  registry.register(grepTool, { kind: 'builtin' });
  const settings = { ...configured, permission: { mode: 'default' }, maxTurns: 6, outputTokenMax: 1024, sandbox: { enabled: false },
    memory: { enabled: false } };
  let engine;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Agent experiment exceeded 120 seconds')), 120_000);
  try {
    if (group === 'xerj') {
      const dataRoot = join(runRoot, task.id, group);
      const configPath = join(dataRoot, loaded.manifest.id, 'xerj.json');
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, JSON.stringify(nativeConfig));
      const activation = await activateNativePluginTools(loaded, { cwd: corpus, settings, dataRoot, toolRegistry: registry,
        addCleanup: cleanup => cleanups.push(cleanup) });
      assert.equal(activation.state, 'active', JSON.stringify(activation.diagnostics));
    }
    const view = createRunCapabilityView({ toolRegistry: registry,
      pluginIds: new Set(group === 'xerj' ? [loaded.manifest.id] : []) }, group === 'xerj' ? [loaded.manifest.id] : []);
    const nativeReadTools = group === 'xerj' ? selection.nativePermissionPolicy : [];
    const checker = new PermissionChecker({ mode: 'default', cwd: corpus,
      allowedTools: ['Grep', 'Read', ...nativeReadTools],
      rules: nativeReadTools.map(tool => ({ tool, action: 'allow' })) });
    record.permissionPreflight = [];
    for (const tool of nativeReadTools) {
      const decision = await checker.checkTool(tool, {});
      assert.equal(decision.action, 'allow', `Experiment must approve the declared read tool ${tool} before model requests`);
      record.permissionPreflight.push({ tool, action: decision.action });
    }
    const client = new api.OpenAICompatibleClient({ apiKey,
      baseURL: api.resolveProviderScopedBaseUrl(configured.baseUrl, configured.provider) ?? provider.defaultBaseURL });
    const providerFetch = client.client.fetch.bind(client.client);
    client.client.fetch = async (...args) => {
      if (record.modelHttpRequests >= 6 || totalModelHttpRequests >= 48) { localBudgetExhausted = true; throw budgetExceeded(); }
      record.modelHttpRequests++; totalModelHttpRequests++;
      return providerFetch(...args);
    };
    const countedClient = {
      async *streamMessage(params) {
        if (record.modelRequests >= 6 || totalModelRequests >= 48) { localBudgetExhausted = true; throw budgetExceeded(); }
        record.modelRequests++; totalModelRequests++;
        for await (const event of client.streamMessage({ ...params, maxTokens: 1024, temperature: 0,
          requestTimeoutMs: 30_000, streamIdleTimeoutMs: 30_000 })) {
          if (event.type === 'usage') record.modelUsage.push(structuredClone(event.usage));
          yield event;
        }
      },
    };
    const permission = { async checkTool(name, input, schema) {
      const result = await checker.checkTool(name, input, schema);
      record.permissions.push({ tool: name, action: result.action, reason: result.reason });
      return result;
    } };
    engine = new core.QueryEngine(countedClient, registry, permission, { register() {}, async execute() { return { blocked: false }; } }, {
      cwd: corpus, model: configured.model, maxTurns: 6, maxTokens: 1024, systemPrompt, trajectoryTrackerFactory: false,
      toolTimeoutMs: 10_000, modelRetry: { maxTotalRetries: 0 },
    });
    const id = randomUUID();
    const execution = { scope: { agentId: id, sessionId: id, inputId: id, runId: id, traceId: id, cwd: corpus, signal: controller.signal },
      tools: view.tools, hardMaxTurns: 6, profile: { maxOutputTokens: 1024, executableHooks: false },
      effects: { requestPermission: async () => ({ status: 'denied', reason: 'Experiment is restricted to approved read tools within corpus' }) },
      emit: async () => {}, takeSteeredInputs: async () => [], closeSteering() {} };
    for await (const event of engine.submitMessage(task.userPrompt, { signal: controller.signal, execution })) {
      if (event.type === 'text_delta') record.output += event.delta;
      if (event.type === 'tool_use_start') record.tools.push({ id: event.toolUse.id, name: event.toolUse.name, input: event.toolUse.input });
      if (event.type === 'tool_use_end') {
        const call = record.tools.find(tool => tool.id === event.toolUseId);
        const text = event.result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        record.toolResultBytes += Buffer.byteLength(text);
        if (call) { call.isError = event.result.isError ?? false; call.result = text; }
      }
      if (event.type === 'model_attempt_finished') record.modelAttempts.push(structuredClone(event));
      if (event.type === 'error') throw event.error;
    }
    record.status = 'completed';
  } catch (error) {
    record.status = 'failed'; record.error = safeError(error);
    if (localBudgetExhausted || ['MaxTurnsExceeded', 'ExperimentBudgetExceeded'].includes(error?.name)) record.failureKind = 'task_budget_exhausted';
    else if (controller.signal.aborted) record.failureKind = 'task_timeout';
    else if (error?.name === 'ModelRequestFailure' && record.modelHttpRequests > 0) {
      record.failureKind = 'provider';
      record.providerFailure = { kind: error.info?.kind ?? 'unknown', phase: error.info?.phase ?? null, statusCode: error.info?.statusCode ?? null };
      providerFailed = true;
    } else record.failureKind = 'task';
  } finally {
    clearTimeout(timeout);
    record.durationMs = Math.round(performance.now() - started);
    record.usage = engine?.getTotalUsage() ?? null;
    record.providerUsage = summarizeProviderUsage(record);
    record.pathMentions = task.relevant.map(item => ({ path: item.path,
      found: record.output.replaceAll('\\', '/').includes(item.path) }));
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
  return record;
}

try {
  // A second paid run must use a fresh output path, including after interruption.
  if (resume) await persist();
  else await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  for (let index = 0; index < selection.tasks.length && !providerFailed; index++) {
    const task = selection.tasks[index];
    const groups = index % 2 ? ['xerj', 'baseline'] : ['baseline', 'xerj'];
    for (const group of groups) {
      if (report.runs.some(row => row.taskId === task.id && row.group === group)) continue;
      console.log(JSON.stringify({ phase: 'run_started', taskId: task.id, group }));
      const record = await oneRun(task, group);
      report.runs.push(record); await persist();
      console.log(JSON.stringify({ phase: 'run_finished', taskId: task.id, group, status: record.status,
        modelRequests: record.modelRequests, usage: record.usage, durationMs: record.durationMs }));
      if (providerFailed) break;
    }
  }
  report.finishedAt = new Date().toISOString();
  report.totalModelRequests = totalModelRequests;
  report.totalModelHttpRequests = totalModelHttpRequests;
  report.status = report.runs.length === 8 && report.runs.every(run => run.status === 'completed') ? 'completed' : 'incomplete';
  await persist();
  if (report.status !== 'completed') process.exitCode = 1;
} finally {
  for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const checkedRoot = resolve(runRoot);
  assert.ok(checkedRoot.startsWith(resolve(tmpdir()) + '\\') || checkedRoot.startsWith(resolve(tmpdir()) + '/'));
  await rm(checkedRoot, { recursive: true, force: true });
}
