import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { batchSearch, mapRepository } from '../tools/search.mjs';
import { readEvidence, scoreTask, verifyGold } from './retrieval.mjs';

const usage = 'node evaluation/batch.mjs --root <corpus> --config-dir <plugin-data> --output <new-results.json>';
const flags = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  assert.ok(['--root', '--config-dir', '--output'].includes(flag) && process.argv[index + 1] && !flags.has(flag), usage);
  flags.set(flag, process.argv[index + 1]);
}
assert.equal(flags.size, 3, usage);
const directory = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(flags.get('--output'));
const offset = relative(directory, output);
assert.ok(offset && !offset.startsWith('..') && !isAbsolute(offset), 'Output must be inside evaluation/');
const root = resolve(flags.get('--root'));
const dataDir = resolve(flags.get('--config-dir'));
const configBytes = await readFile(resolve(dataDir, 'xerj.json'));
const config = JSON.parse(configBytes);
assert.equal(config.enabled, true, 'Native control requires enabled configuration');
const taskBytes = await readFile(resolve(directory, 'tasks.json'));
const dataset = JSON.parse(taskBytes);
const gold = await verifyGold(root, dataset.tasks);
const context = () => ({ cwd: root, plugin: { dataDir }, signal: new AbortController().signal, deadline: Date.now() + config.timeoutMs });
const mapStarted = performance.now();
const map = await mapRepository({}, context());
const report = {
  level: 'native-batch-control-no-model',
  startedAt: new Date().toISOString(),
  taskSetSha256: createHash('sha256').update(taskBytes).digest('hex'),
  pluginConfigurationSha256: createHash('sha256').update(configBytes).digest('hex'),
  sameGold: false,
  configuration: { groupSize: 4, perItemLimit: 5, nativeWordBudget: 2000, pluginOutputBudgetBytes: 16384, timeoutMs: config.timeoutMs },
  map: { status: map.status, indexCount: map.map?.indexes?.length ?? 0, elapsedMs: performance.now() - mapStarted, response: map },
  summary: {}, batches: [], rows: [],
};
for (let start = 0; start < dataset.tasks.length; start += 4) {
  const tasks = dataset.tasks.slice(start, start + 4);
  const started = performance.now();
  const response = await batchSearch({ queries: tasks.map(task => task.query), limit: 5 }, context());
  report.batches.push({ taskIds: tasks.map(task => task.id), elapsedMs: performance.now() - started, responseBytes: Buffer.byteLength(JSON.stringify(response)), response });
  for (const [position, task] of tasks.entries()) {
    const item = response.results?.[position];
    const hits = item?.hits ?? [];
    const evidence = await readEvidence(root, hits, dataset.budget);
    report.rows.push({ taskId: task.id, status: item?.status ?? 'error', score: scoreTask(task, hits, evidence, 5), evidence });
  }
}
assert.deepEqual(await verifyGold(root, dataset.tasks), gold, 'Gold changed while measuring');
report.sameGold = true;
report.summary = {
  questions: report.rows.length,
  batchCalls: report.batches.length,
  explicitMapCalls: 1,
  totalSearchMs: report.batches.reduce((sum, batch) => sum + batch.elapsedMs, 0),
  fileHits: report.rows.filter(row => row.score.fileHit).length,
  evidenceHits: report.rows.filter(row => row.score.evidenceHit).length,
  errors: report.rows.filter(row => row.status === 'error').length,
  locatorOnlyHits: report.batches.flatMap(batch => batch.response.results ?? []).flatMap(item => item.hits).filter(hit => hit.evidence === 'native_locator_only').length,
  unknownLineHits: report.batches.flatMap(batch => batch.response.results ?? []).flatMap(item => item.hits).filter(hit => hit.line === null).length,
  modelTokens: null,
};
report.valid = report.map.status === 'ok' && report.batches.every(batch => batch.response.nativeTool === 'xerj_batch_search' && batch.response.status === 'ok') && report.summary.errors === 0;
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ output, valid: report.valid, map: { status: report.map.status, indexCount: report.map.indexCount, elapsedMs: report.map.elapsedMs }, summary: report.summary }) + '\n');
