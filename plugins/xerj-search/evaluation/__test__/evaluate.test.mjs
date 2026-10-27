import test from 'node:test';
import assert from 'node:assert/strict';

async function cli() {
  const module = await import('../evaluate.mjs').catch((error) => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return null;
  });
  assert.ok(module, '评测 CLI 尚未实现');
  return module;
}

test('CLI 拒绝缺失检索根目录和不合理的重复次数', async () => {
  const { parseArgs } = await cli();
  assert.throws(() => parseArgs(['--config-dir', 'config']), /--root/);
  assert.throws(() => parseArgs(['--root', '.', '--config-dir', 'config', '--runs', '0']), /--runs/);
  assert.throws(() => parseArgs(['--root', '.', '--config-dir', 'config', '--runs', '1.5']), /--runs/);
  assert.equal(parseArgs(['--root', '.', '--config-dir', 'config', '--runs', '3']).runs, 3);
});

test('Markdown 报告显示原始检索指标，缺失模型数据不会变成零收益', async () => {
  const { renderMarkdown } = await cli();
  const text = renderMarkdown({
    dataset: { id: 'fixed', tasks: 16, sha256: 'abc' }, runs: 3,
    summary: { methods: { rg: { samples: 48, fileHitAt5: 0.5, evidenceHitAt5: 0.25, meanRetrievedBytes: 1200, medianSearchMs: 30, p95SearchMs: 80, fallbackSamples: 0, errorSamples: 0 } } },
    fallbackSmoke: { score: { evidenceHit: true }, backend: 'rg' },
  });
  assert.match(text, /检索级/);
  assert.match(text, /50\.0%/);
  assert.match(text, /未测量/);
  assert.doesNotMatch(text, /节省.*0%|费用.*\b0\b/);
});
