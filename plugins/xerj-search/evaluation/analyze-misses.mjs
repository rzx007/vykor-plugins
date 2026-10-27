import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEvidence, scoreTask, verifyGold } from './retrieval.mjs';

const usage = 'node evaluation/analyze-misses.mjs --root <frozen-corpus> --results <retrieval.json> --output <new-analysis.json>';
const flags = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  assert.ok(['--root', '--results', '--output'].includes(flag) && process.argv[index + 1] && !flags.has(flag), usage);
  flags.set(flag, process.argv[index + 1]);
}
assert.equal(flags.size, 3, usage);
const directory = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(flags.get('--output'));
const offset = relative(directory, output);
assert.ok(offset && !offset.startsWith('..') && !isAbsolute(offset), 'Output must be inside evaluation/');
const root = resolve(flags.get('--root'));
const resultBytes = await readFile(resolve(flags.get('--results')));
const previous = JSON.parse(resultBytes);
const taskBytes = await readFile(resolve(directory, 'tasks.json'));
const dataset = JSON.parse(taskBytes);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(previous.dataset.sha256, sha256(taskBytes), 'Task set changed');
const gold = await verifyGold(root, dataset.tasks);
assert.deepEqual(gold, previous.goldVerification, 'Frozen corpus changed');
const rows = [];
for (const row of previous.rows) {
  const task = dataset.tasks.find(task => task.id === row.taskId);
  assert.ok(task, 'Unknown saved task');
  const located = row.hits.map(hit => ({ ...hit,
    line: Number.isInteger(hit.startLine) && Number.isInteger(hit.endLine) && hit.endLine >= hit.startLine
      ? Math.floor((hit.startLine + hit.endLine) / 2) : hit.line,
  }));
  const evidence = await readEvidence(root, located, previous.budget);
  const score = scoreTask(task, row.hits, evidence);
  const topFiles = [...new Set(row.hits.map(hit => hit.path))].slice(0, previous.budget.topFiles);
  const fragmentAnchor = task.relevant.some(gold => row.hits.some(hit =>
    topFiles.includes(hit.path) && hit.path === gold.path && Number.isInteger(hit.startLine)
      && gold.line >= hit.startLine
      && (hit.text.split(/\r?\n/)[gold.line - hit.startLine] ?? '').includes(gold.contains)));
  rows.push({ taskId: row.taskId, run: row.run, method: row.method, before: row.score, after: score, evidence,
    readBytes: evidence.reduce((sum, window) => sum + window.bytes, 0), previousReadBytes: row.readBytes,
    oldReportedPassageHasAnchor: fragmentAnchor, oldVisibleEvidence: fragmentAnchor || row.score.evidenceHit,
  });
}
assert.deepEqual(await verifyGold(root, dataset.tasks), gold, 'Corpus changed while reading');
const summary = Object.fromEntries([...new Set(rows.map(row => row.method))].map(method => {
  const group = rows.filter(row => row.method === method);
  const rate = predicate => group.filter(predicate).length / group.length;
  const mean = select => group.reduce((sum, row) => sum + select(row), 0) / group.length;
  return [method, { samples: group.length, fileHit: rate(row => row.after.fileHit),
    evidenceBefore: rate(row => row.before.evidenceHit), evidenceAfter: rate(row => row.after.evidenceHit),
    oldVisibleSavedFragments: rate(row => row.oldVisibleEvidence),
    meanReadBytesBefore: mean(row => row.previousReadBytes), meanReadBytesAfter: mean(row => row.readBytes) }];
}));
const report = { analyzedAt: new Date().toISOString(), taskSetSha256: sha256(taskBytes), sourceResultsSha256: sha256(resultBytes),
  method: 'Offline replay: center the unchanged +/-12-line, 4096-byte Read window on the midpoint of the already-returned passage range. No new searches, gold-aware positioning, query/corpus changes or production changes.',
  sameGold: true, newModelRequests: 0, budget: previous.budget, summary, rows };
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ output, sameGold: true, summary }) + '\n');
