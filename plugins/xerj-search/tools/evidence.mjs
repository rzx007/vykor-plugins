import { realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { readBounded } from './config.mjs';
const EXTENSIONS = new Set('.ts .tsx .mts .cts .js .jsx .mjs .cjs .md .mdx .txt .rst .adoc .html .htm .css .scss .json .yaml .yml .toml .py .rs .go .java .c .h .cc .cpp .hpp .cs .rb .php .sh .ps1 .sql .vue .svelte .xml .graphql .proto'.split(' '));
const PRIVATE = /^(?:\..*|node_modules|dist|build|coverage|vendor|artifacts)$/i;
const SENSITIVE = /(?:^|\.)(?:lock|key|pem|p12|pfx|sqlite|db)(?:\.|$)|^(?:credentials|secrets?)(?:\.|$)/i;
const fold = text => text.replace(/\s+/gu, '');
export function trimBytes(text, max) {
  if (Buffer.byteLength(text) <= max) return text;
  const bytes = Buffer.from(text); let end = max - 3;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8') + '…';
}
function inside(root, path) {
  const local = relative(root, path);
  return local && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
}
function textPath(path) {
  const parts = path.replaceAll('\\', '/').split('/');
  return !parts.some(part => PRIVATE.test(part)) && !SENSITIVE.test(parts.at(-1)) && EXTENSIONS.has(extname(path).toLowerCase());
}
export function textResult(result) {
  if (!result || result.isError || !Array.isArray(result.content)) throw new Error('native_tool_error');
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
}
export function codeCandidates(text) {
  // Only a complete renderer footer at EOF is metadata. Similar source text stays.
  const footer = /\r?\n([0-9]+) passages from [^\r\n]+\r?\n(?:Cite file:line for anything you rely on\.\r?\n)?(?:\[token budget:[^\r\n]*\]\r?\n)?\s*$/.exec(text);
  if (footer) {
    const count = [...text.matchAll(/^─── .+?  \([^\n]*\)\r?$/gm)].length;
    const budget = /\[token budget: ([0-9]+)\/([0-9]+) passages full, ([0-9]+) locator-only, ([0-9]+) deduped(?: \(identical locator and passage\))?, ([0-9]+) dropped; counted as standard-uax29-words, max_tokens [0-9]+\]/.exec(footer[0]);
    const accounted = budget && Number(budget[2]) === Number(footer[1])
      && Number(budget[1]) + Number(budget[3]) === count
      && count + Number(budget[4]) + Number(budget[5]) === Number(footer[1]);
    if (Number(footer[1]) === count || accounted) text = text.slice(0, footer.index);
  }
  const starts = [...text.matchAll(/^─── (.+?)  \(([^\n]*)\)\r?$/gm)];
  return starts.map((match, index) => {
    const locator = match[1].replace(/ \(line unknown[^\n]*$/, '').replace(/#[^/\\]*$/, '');
    const parsed = /^(.*?):([1-9][0-9]*)$/.exec(locator);
    let passage = text.slice(match.index + match[0].length, starts[index + 1]?.index ?? text.length);
    const lines = passage.replace(/^\r?\n/, '').trimEnd().split(/\r?\n/);
    const definition = /^    \[(.+?) @ line ([1-9][0-9]*) — [0-9,]+ of [0-9,]+ chars\]$/.exec(lines[0]);
    const window = /^    \[no symbol match; showing [0-9,]+ of [0-9,]+ chars from offset [0-9,]+, window centred on the match\]$/.test(lines[0]);
    const omitted = /^    \[passage omitted: over the max_tokens [0-9]+ budget — locator only\]$/.test(lines[0]);
    if (definition || window || omitted) lines.shift();
    while (lines.at(-1) === '') lines.pop();
    if (definition) {
      const marker = /^    \.\.\. \[(.+?)(?: truncated at [0-9]+ chars|: showing [0-9,]+ of [0-9,]+ chars from offset [0-9,]+, window centred on the match)\]$/.exec(lines.at(-1) ?? '');
      if (marker?.[1] === definition[1]) lines.pop();
    }
    return { path: parsed?.[1] ?? locator, line: parsed ? Number(parsed[2]) : undefined,
      definitionLine: definition ? Number(definition[2]) : undefined, text: lines.join('\n').trimEnd(), notice: match[2] };
  });
}
export function jsonCandidates(response) {
  if (!Array.isArray(response?.hits?.hits) || response.timed_out || Number(response._shards?.failed) > 0) throw new Error('invalid_native_response');
  return response.hits.hits.map(hit => {
    const source = hit._source ?? {};
    const passages = hit.fields?._passage;
    const passage = Array.isArray(passages) ? passages.find(item => typeof item.text === 'string')?.text : passages?.text;
    return { path: source.ax_path ?? source.path, line: hit.match_line ?? source.match_line ?? source.line ?? source.start_line,
      definitionLine: source.line ?? source.start_line,
      text: passage ?? source.code ?? source.body ?? source.text ?? '', notice: source.kind ?? '' };
  });
}
/** Verify the original native passage against the current file without replacing its selection. */
export async function verifyCandidates(candidates, scope, limit, { allowFileOnly = false } = {}) {
  const hits = [], seen = new Set();
  for (const candidate of candidates.slice(0, 50)) {
    scope.signal.throwIfAborted();
    if (typeof candidate.path !== 'string' || !candidate.path || candidate.path.length > 4096) continue;
    const proposed = resolve(scope.root, candidate.path);
    if (!inside(scope.root, proposed) || !textPath(relative(scope.root, proposed))) continue;
    let path, source;
    try {
      path = await realpath(proposed);
      if (!inside(scope.root, path) || !textPath(relative(scope.root, path))) continue;
      source = await readBounded(path, 524_288, scope.signal);
    } catch { scope.signal.throwIfAborted(); continue; }
    if (source.includes('\0')) continue;
    const passage = typeof candidate.text === 'string' ? candidate.text.replace(/\r\n/g, '\n').trimEnd() : '';
    let line = candidate.line, ambiguous = false;
    if (passage) {
      const needle = fold(passage);
      const haystack = fold(source);
      if (!needle || !haystack.includes(needle)) continue;
      const first = needle;
      const positions = [];
      for (let start = 0; start <= haystack.length - first.length;) {
        const found = haystack.indexOf(first, start);
        if (found < 0) break;
        positions.push(found); start = found + Math.max(1, first.length);
      }
      let found = positions[0];
      if (positions.length > 1) {
        const lines = source.split('\n');
        const anchorAt = hint => Number.isInteger(hint) && hint > 0 && hint <= lines.length
          ? fold(lines.slice(0, hint - 1).join('\n')).length : undefined;
        const matchAnchor = anchorAt(candidate.line);
        found = positions.find(position => position <= matchAnchor && position + first.length > matchAnchor);
        if (found === undefined) {
          const definitionAnchor = anchorAt(candidate.definitionLine);
          const following = definitionAnchor === undefined ? [] : positions.filter(position => position >= definitionAnchor);
          if (following.length === 1) found = following[0];
        }
        ambiguous = found === undefined;
      }
      let normalized = 0, offset = 0;
      for (; offset < source.length && normalized < found; offset++) if (!/\s/u.test(source[offset])) normalized++;
      while (offset < source.length && /\s/u.test(source[offset])) offset++;
      line = ambiguous ? null : source.slice(0, offset).split('\n').length;
    }
    const fileOnly = allowFileOnly && !passage && (line === undefined || line === null);
    if (fileOnly) line = null;
    if (!ambiguous && !fileOnly && (!Number.isInteger(line) || line < 1 || line > source.split('\n').length)) continue;
    const identity = JSON.stringify([path, line, passage]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const text = trimBytes(passage, 1500);
    const endLine = line === null ? null : line + text.split('\n').length - 1;
    hits.push({ path: relative(scope.root, path).replaceAll('\\', '/'), line, startLine: line,
      endLine, readLine: line === null ? null : Math.floor((line + endLine) / 2), text, truncated: text !== passage,
      evidence: ambiguous ? 'native_passage_verified_current_ambiguous' : passage ? 'native_passage_verified_current' : 'native_locator_only', notice: trimBytes(candidate.notice ?? '', 200) });
    if (hits.length === limit) break;
  }
  return hits;
}
