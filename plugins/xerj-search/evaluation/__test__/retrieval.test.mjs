import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function implementation() {
  const module = await import('../retrieval.mjs').catch((error) => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return null;
  });
  assert.ok(module, '检索评测实现尚不存在，应提供真实 rg、证据读取及评分');
  return module;
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'xerj-eval-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'file with spaces.mjs'), 'intro\nexport function exactNeedle() {}\nend\n');
  await writeFile(join(root, 'README.md'), '# Guide\nEvidence is retained here.\n');
  return root;
}

const budget = { topFiles: 5, maxSearchCalls: 2, searchMaxBytes: 8192, readMaxBytesPerFile: 4096, readContextLines: 2, timeoutMs: 3000 };

test('重复文件不能挤占 top5，排在第六个不同文件的答案不算命中', async () => {
  const { scoreTask } = await implementation();
  const hits = ['a.ts', 'a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'gold.ts'].map((path) => ({ path, line: 1 }));
  assert.deepEqual(scoreTask({ relevant: [{ path: 'gold.ts', line: 1, contains: 'proof' }] }, hits, [], 5), {
    fileHit: false, evidenceHit: false, relevantFilesFound: 0, relevantFilesTotal: 1, fileRecall: 0,
    topFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'], evidenceFiles: [],
  });
});

test('只有实际读取到人工标记的那一行证据才算证据命中', async () => {
  const { scoreTask } = await implementation();
  const task = { relevant: [{ path: 'gold.ts', line: 20, contains: 'retainState()' }] };
  const hits = [{ path: 'gold.ts', line: 1 }];
  const wrongWindow = scoreTask(task, hits, [{ path: 'gold.ts', startLine: 1, text: 'retainState()' }], 5);
  assert.equal(wrongWindow.fileHit, true);
  assert.equal(wrongWindow.evidenceHit, false);
  const correctWindow = scoreTask(task, hits, [{ path: 'gold.ts', startLine: 19, text: 'before\nretainState()\nafter' }], 5);
  assert.equal(correctWindow.evidenceHit, true);
});

test('基线真实执行 rg，再按命中位置读取有空格路径的文件', async (t) => {
  const { retrieveBaseline, readEvidence } = await implementation();
  const root = await fixture(t);
  const result = await retrieveBaseline({ baselinePatterns: ['exactNeedle'] }, root, budget);
  assert.equal(result.backend, 'rg');
  assert.deepEqual(result.hits.map(({ path, line }) => ({ path, line })), [{ path: 'src/file with spaces.mjs', line: 2 }]);
  assert.ok(result.searchBytes > 0);
  const evidence = await readEvidence(root, result.hits, budget);
  assert.match(evidence[0].text, /export function exactNeedle/);
  assert.ok(evidence[0].bytes > 0);
});

test('模式中的 shell 字符按数据传给 rg，不会执行额外命令', async (t) => {
  const { runRg } = await implementation();
  const root = await fixture(t);
  const result = await runRg(root, 'exactNeedle|\x24\x28Write-Output INJECTED\x29', budget);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].path, 'src/file with spaces.mjs');
  assert.ok(!result.stderr.includes('INJECTED'));
});

test('rg 输出超过字节预算时明确截断，不把半行 JSON 当完整结果', async (t) => {
  const { runRg } = await implementation();
  const root = await fixture(t);
  await writeFile(join(root, 'huge.ts'), 'needle' + '界'.repeat(10000));
  const result = await runRg(root, 'needle', { ...budget, searchMaxBytes: 400 });
  assert.equal(result.truncated, true);
  assert.ok(result.searchBytes <= 400);
  assert.ok(result.hits.every((hit) => Number.isInteger(hit.line) && hit.line > 0));
});

test('证据读取拒绝跳出仓库的路径', async (t) => {
  const { readEvidence } = await implementation();
  const root = await fixture(t);
  const evidence = await readEvidence(root, [{ path: '../outside-secret.ts', line: 1 }], budget);
  assert.equal(evidence.length, 0);
});

test('后续读取采用已核验片段的中点提示，保持原行数与字节限额', async (t) => {
  const { readEvidence } = await implementation();
  const root = await fixture(t);
  await writeFile(join(root, 'long.ts'), Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n'));
  const evidence = await readEvidence(root, [{ path: 'long.ts', line: 2, startLine: 2, endLine: 22, readLine: 12 }], budget);
  assert.equal(evidence[0].startLine, 10);
  assert.equal(evidence[0].endLine, 14);
  assert.match(evidence[0].text, /line 12/);
  assert.ok(evidence[0].bytes <= budget.readMaxBytesPerFile);
  const invalidHint = await readEvidence(root, [{ path: 'long.ts', line: 2, startLine: 2, endLine: 22, readLine: 300 }], budget);
  assert.equal(invalidHint[0].startLine, 1);
});

test('降级提示会真正交给 rg，并读取到正确证据', async (t) => {
  const { executeFallback, readEvidence, scoreTask } = await implementation();
  const root = await fixture(t);
  const result = await executeFallback({ status: 'fallback', backend: 'grep', hits: [], fallback: { tool: 'Grep', input: { pattern: 'exactNeedle' } } }, root, budget);
  assert.equal(result.backend, 'rg');
  assert.equal(result.hits[0].path, 'src/file with spaces.mjs');
  const evidence = await readEvidence(root, result.hits, budget);
  assert.equal(scoreTask({ relevant: [{ path: 'src/file with spaces.mjs', line: 2, contains: 'exactNeedle' }] }, result.hits, evidence, 5).evidenceHit, true);
});

test('仓库证据发生变化时拒绝沿用旧答案评分', async (t) => {
  const { verifyGold } = await implementation();
  const root = await fixture(t);
  const tasks = [{ id: 'a', relevant: [{ path: 'README.md', line: 2, contains: 'old text' }] }];
  await assert.rejects(verifyGold(root, tasks), /a.*README\.md.*2/s);
});

test('汇总保留未测的模型指标为空，并按任务和重复次数计数', async () => {
  const { summarize } = await implementation();
  const result = summarize([
    { category: 'exact-symbol', method: 'rg', score: { fileHit: true, evidenceHit: false, fileRecall: 1 }, searchMs: 10, readMs: 2, searchBytes: 100, readBytes: 50 },
    { category: 'exact-symbol', method: 'rg', score: { fileHit: false, evidenceHit: false, fileRecall: 0 }, searchMs: 20, readMs: 2, searchBytes: 200, readBytes: 50 },
  ]);
  assert.equal(result.methods.rg.samples, 2);
  assert.equal(result.methods.rg.fileHitAt5, 0.5);
  assert.equal(result.methods.rg.medianSearchMs, 15);
  assert.equal(result.methods.rg.meanRetrievedBytes, 200);
  assert.deepEqual(result.modelEvaluation, { status: 'not_measured', actualTokens: null, cost: null, taskCompletionRate: null });
});

test('插件响应超过固定预算时减少命中条目，并保留可用的完整对象', async () => {
  const { boundPluginResponse } = await implementation();
  assert.equal(typeof boundPluginResponse, 'function', '缺少插件响应预算约束');
  const response = { status: 'ok', backend: 'xerj', hits: [{ path: 'a.ts', line: 1, text: 'a'.repeat(200) }, { path: 'b.ts', line: 1, text: 'b'.repeat(200) }] };
  const result = boundPluginResponse(response, 350);
  assert.equal(result.hits.length, 1);
  assert.equal(result.truncated, true);
  assert.ok(result.searchBytes <= 350);
  assert.ok(result.returnedResponseBytes > 350);
});

test('上游已截断标记不会被评测预算重置，命中条目的截断另行统计', async () => {
  const { boundPluginResponse, summarize } = await implementation();
  const bounded = boundPluginResponse({ status: 'ok', backend: 'xerj', truncated: true, hits: [{ path: 'a.ts', line: 1, text: 'fragment', truncated: true }] }, 8192);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.hits[0].truncated, true);
  const report = summarize([{ method: 'plugin', category: 'exact-symbol', ...bounded, score: { fileHit: true, evidenceHit: false, fileRecall: 1 }, searchMs: 1, readMs: 1, readBytes: 10 }]);
  assert.equal(report.methods.plugin.truncatedSamples, 1);
  assert.equal(report.methods.plugin.hitTruncatedSamples, 1);
  assert.equal(report.methods.plugin.truncatedHitCount, 1);
});
