import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindAutoindexReceipt } from '../scripts/bind-autoindex.mjs';
test('binds an actual completed receipt without refreshing its index time or source files', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'vykor-xerj-bind-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'project'), codeHome = join(temp, 'native-code'); await mkdir(root);
  const receipt = { doc_kind: 'run', root, prefix: 'project', url: 'http://127.0.0.1:9200', started: '2026-10-26T12:00:00Z', generation: 1, unique_content_files: 2, files_indexed: 2, files_junk: 0, records_total: 4 };
  const configFile = join(temp, 'xerj.json'), receiptFile = join(temp, 'run.json');
  await writeFile(configFile, JSON.stringify({ enabled: true, binary: process.execPath, codeHome, url: receipt.url, projects: [{ root, prefix: 'project', corpus: 'current' }] }));
  await writeFile(receiptFile, JSON.stringify(receipt));
  const result = await bindAutoindexReceipt(configFile, receiptFile);
  const ledger = JSON.parse(await readFile(join(codeHome, 'state/current.json'), 'utf8'));
  assert.equal(ledger.indexed_at, '2026-10-26T12:00:00Z'); assert.equal(ledger.index_prefix, 'project-');
  assert.equal(ledger.project_root, root); assert.equal(ledger.binding_origin, 'completed_autoindex_receipt');
  assert.equal(result.corpus, 'current');
  await assert.rejects(bindAutoindexReceipt(configFile, receiptFile), error => error.code === 'EEXIST');
});
test('refuses a receipt outside the configured project or with incomplete indexing', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'vykor-xerj-bind-')); t.after(() => rm(temp, { recursive: true, force: true }));
  const root = join(temp, 'project'); await mkdir(root);
  const configFile = join(temp, 'xerj.json'), receiptFile = join(temp, 'run.json');
  await writeFile(configFile, JSON.stringify({ enabled: true, binary: process.execPath, codeHome: join(temp, 'native-code'), url: 'http://127.0.0.1:9200', projects: [{ root, prefix: 'project', corpus: 'current' }] }));
  for (const receipt of [
    { doc_kind: 'run', root, prefix: 'other', url: 'http://127.0.0.1:9200', started: '2026-10-26T12:00:00Z', generation: 1, unique_content_files: 2, files_indexed: 2, files_junk: 0 },
    { doc_kind: 'run', root, prefix: 'project', url: 'http://127.0.0.1:9200', started: '2026-10-26T12:00:00Z', generation: 1, unique_content_files: 2, files_indexed: 1, files_junk: 0 },
  ]) { await writeFile(receiptFile, JSON.stringify(receipt)); await assert.rejects(bindAutoindexReceipt(configFile, receiptFile), /receipt/i); }
});
