import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeCandidates, verifyCandidates } from '../tools/evidence.mjs';

async function fixture(t, source) {
  const root = await mkdtemp(join(tmpdir(), 'xerj-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'code.ts'), source);
  return { root, signal: new AbortController().signal };
}
const rendered = body => `\n─── code.ts:1  (score 5)\n${body}\n\n1 passages from 'current'\nCite file:line for anything you rely on.\n`;

// Each case exercises the parser and current-source verifier, not a copied parser.
test('native truncation notes do not discard a verified function passage', async t => {
  const source = 'function run() {\n  return work();\n}\n';
  const scope = await fixture(t, source);
  const hits = await verifyCandidates(codeCandidates(rendered('    [function run @ line 1 — 30 of 300 chars]\nfunction run() {\n  return work();\n    ... [function run truncated at 30 chars]')), scope, 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, 'function run() {\n  return work();');
});

test('the final budget-only locator survives without footer prose becoming source', async t => {
  const scope = await fixture(t, 'first\nsecond\n');
  const text = '\n─── code.ts:2  (score 1)\n    [passage omitted: over the max_tokens 2000 budget — locator only]\n1 passages from \'current\'\nCite file:line for anything you rely on.\n[token budget: 0/1 passages full, 1 locator-only, 0 deduped, 0 dropped; counted as standard-uax29-words, max_tokens 2000]\n';
  const hits = await verifyCandidates(codeCandidates(text), scope, 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].text, '');
});

test('a native budget footer accounts for deduped or dropped passage headers', async t => {
  const scope = await fixture(t, 'const one = 1;\n');
  const text = '\n─── code.ts:1  (score 1)\nconst one = 1;\n\n2 passages from \'current\'\nCite file:line for anything you rely on.\n[token budget: 1/2 passages full, 0 locator-only, 1 deduped (identical locator and passage), 0 dropped; counted as standard-uax29-words, max_tokens 2000]\n';
  const hits = await verifyCandidates(codeCandidates(text), scope, 5);
  assert.equal(hits[0]?.text, 'const one = 1;');
});

test('bracketed source is preserved unless it is a recognized native annotation', async t => {
  const source = '    [1, 2, 3]\n    [some source text]\n';
  const scope = await fixture(t, source);
  const hits = await verifyCandidates(codeCandidates(rendered(source.trimEnd())), scope, 5);
  assert.equal(hits[0].text, source.trimEnd());
});

test('a footer-looking sentence inside a passage is preserved', async t => {
  const source = 'before\nCite file:line for anything you rely on.\n[token budget: user data]\nafter\n';
  const scope = await fixture(t, source);
  const hits = await verifyCandidates(codeCandidates(rendered(source.trimEnd())), scope, 5);
  assert.equal(hits[0].text, source.trimEnd());
});

test('a definition label disambiguates code when the header match line is outside it', async t => {
  const scope = await fixture(t, 'function a() {\n  return false;\n}\nfunction b() {\n  return false;\n}\n');
  const text = '\n─── code.ts:6  (score 2)\n    [function b @ line 4 — 15 of 60 chars]\n  return false;\n\n1 passages from current\n';
  const hits = await verifyCandidates(codeCandidates(text), scope, 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 5);
});

test('a unique verified passage is not lost because its header points beyond the passage', async t => {
  const scope = await fixture(t, 'before\nconst unique = 1;\nafter\n');
  const hits = await verifyCandidates(codeCandidates(rendered('const unique = 1;').replace('code.ts:1', 'code.ts:3')), scope, 5);
  assert.equal(hits[0]?.line, 2);
});

test('a repeated passage with an unrelated match line does not acquire the next occurrence', async t => {
  const scope = await fixture(t, 'function a() {\n  return false;\n}\nfunction b() {\n  return false;\n}\n');
  const hits = await verifyCandidates(codeCandidates(rendered('  return false;').replace('code.ts:1', 'code.ts:3')), scope, 5);
  assert.equal(hits[0]?.line, null);
});

test('a matching header disambiguates repeats inside the same definition before its start label', async t => {
  const scope = await fixture(t, 'function a() {\n  if (first) {\n    return false;\n  }\n  if (second) {\n    return false;\n  }\n}\n');
  const text = '\n─── code.ts:6  (score 2)\n    [function a @ line 1 — 13 of 100 chars]\n    return false;\n\n1 passages from current\n';
  assert.equal((await verifyCandidates(codeCandidates(text), scope, 5))[0]?.line, 6);
  const unrelated = text.replace('code.ts:6', 'code.ts:8');
  assert.equal((await verifyCandidates(codeCandidates(unrelated), scope, 5))[0]?.line, null);
});

test('an ellipsis cannot join unrelated source regions into a verified passage', async t => {
  const scope = await fixture(t, 'start();\nunrelated();\nend();\n');
  const hits = await verifyCandidates([{ path: 'code.ts', line: 1, text: 'start();…end();' }], scope, 5);
  assert.deepEqual(hits, []);
});

test('verified passages recommend their midpoint for bounded follow-up reads', async t => {
  const scope = await fixture(t, 'before\nfunction run() {\n  first();\n  evidence();\n  last();\n}\nafter\n');
  const hits = await verifyCandidates([{ path: 'code.ts', line: 2, text: 'function run() {\n  first();\n  evidence();\n  last();\n}' }], scope, 5);
  assert.equal(hits[0].line, 2);
  assert.equal(hits[0].readLine, 4);
});
