import { callMcp } from './native-mcp.mjs';
import { projectContext, checkCorpus, fallback } from './config.mjs';
import { codeCandidates, jsonCandidates, textResult, verifyCandidates } from './evidence.mjs';
export { loadSearchConfig } from './config.mjs';

function validate(input, keys, queryKey = 'query') {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !keys.includes(key))) throw new TypeError('Unknown search argument');
  if (queryKey && (typeof input[queryKey] !== 'string' || !input[queryKey].trim() || input[queryKey].length > 500)) throw new TypeError(queryKey + ' must contain 1–500 characters');
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new TypeError('limit must be between 1 and 10');
  return limit;
}
function bounded(output, max = 8192) {
  while (Buffer.byteLength(JSON.stringify(output)) > max && output.hits?.length > 1) { output.hits.pop(); output.truncated = true; }
  if (Buffer.byteLength(JSON.stringify(output)) > max) throw new Error('response_too_large');
  return output;
}
function boundedBatch(output) {
  if (Buffer.byteLength(JSON.stringify(output)) > 16384) {
    for (const item of output.results) if (item.fallback) item.fallback = {
      tool: 'Grep', queryPosition: item.position, note: '从本次原输入 queries 的该位置取问题，提取关键词后调用 Grep；未截断原搜索条件。',
    };
  }
  while (Buffer.byteLength(JSON.stringify(output)) > 16384) {
    const candidates = output.results.flatMap(item => item.hits).filter(hit => hit.text);
    if (!candidates.length) break;
    const largest = candidates.sort((a, b) => Buffer.byteLength(b.text) - Buffer.byteLength(a.text))[0];
    largest.text = ''; largest.endLine = largest.line; largest.readLine = largest.line; largest.truncated = true;
    largest.evidence = 'native_locator_only'; output.truncated = true;
  }
  while (Buffer.byteLength(JSON.stringify(output)) > 16384) {
    const item = [...output.results].reverse().find(item => item.hits.length > 1);
    if (!item) break;
    item.hits.pop(); output.truncated = true;
  }
  return bounded(output, 16384);
}

/** Native transport is the only injected boundary; all validation and result handling stay real. */
export function createSearchService(nativeCall = callMcp) {
  async function run(input, context, operation) {
    const queryKey = operation === 'definition' ? 'symbol' : operation === 'code' ? 'query' : null;
    const limit = validate(input, operation === 'batch' ? ['queries', 'limit'] : operation === 'map' ? [] : [queryKey, 'limit'], queryKey);
    if (operation === 'batch' && (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > 8 || input.queries.some(query => typeof query !== 'string' || !query.trim() || query.length > 500))) throw new TypeError('queries must be 1–8 nonempty strings');
    const query = queryKey ? input[queryKey].trim() : operation === 'batch' ? input.queries[0] : 'project';
    const itemFallback = query => ({ tool: 'Grep', input: fallback(query, '').fallback.input });
    const failure = reason => operation === 'batch' ? boundedBatch({
      status: 'fallback', backend: 'grep', reason, hits: [], fallback: { tool: 'Grep', note: '按原输入位置逐项使用 results 中的 Grep 参数；本插件没有执行 Grep。' },
      results: input.queries.map((query, position) => ({ position, status: 'error', hits: [], reason, fallback: itemFallback(query) })),
    }) : fallback(query, reason);
    const scope = await projectContext(context, query);
    if (scope.fallback) return failure(scope.fallback.reason);
    try {
      let name, args;
      if (operation === 'map') { name = 'xerj_map'; args = { index: scope.project.prefix + '-*', max_bytes: 1024 }; }
      else if (operation === 'batch') { name = 'xerj_batch_search'; args = { prefix: scope.project.prefix, queries: input.queries.map(query => ({ query })), size: Math.min(limit, 5), max_tokens: 2000 }; }
      else if (operation === 'definition' || /^[A-Za-z_$][\w$]*(?:[.:][\w$]+)*$/.test(query)) {
        name = 'xerj_def'; args = { prefix: scope.project.prefix, symbol: query, k: limit, max_tokens: 2000 };
      } else {
        await checkCorpus(scope);
        name = 'xerj_code_search'; args = { corpus: scope.project.corpus, query, k: limit, mode: 'bm25', full: 1200, max_tokens: 2000 };
      }
      const native = await nativeCall(scope.settings, name, args);
      const text = textResult(native);
      if (operation === 'map') {
        const result = JSON.parse(text);
        if (!Array.isArray(result.indexes)) throw new Error('invalid_native_response');
        const indexes = result.indexes.filter(item => typeof item.index === 'string' && item.index.startsWith(scope.project.prefix + '-'));
        return bounded({ status: 'ok', backend: 'xerj', nativeTool: name, hits: [], map: { indexes, matched: indexes.length, indexesOmitted: result.indexes_omitted ?? 0 } });
      }
      if (operation === 'batch') {
        const batch = JSON.parse(text);
        if (!Array.isArray(batch.results) || batch.results.length !== input.queries.length) throw new Error('invalid_native_response');
        const results = [];
        for (let position = 0; position < batch.results.length; position++) {
          const item = batch.results[position];
          if (item.position !== position || !['hits', 'abstain', 'error'].includes(item.status)) throw new Error('invalid_native_response');
          const candidates = item.status === 'hits' ? jsonCandidates({ hits: { hits: (item.hits ?? []).map(value => {
            const hit = value.hit ?? {}, source = hit._source ?? {}, citation = value.citation ?? {};
            return { ...hit, match_line: hit.match_line ?? citation.match_line, _source: { ...source,
              ax_path: source.ax_path ?? citation.ax_path, path: source.path ?? citation.path,
              line: source.line ?? citation.line, start_line: source.start_line ?? citation.start_line } };
          }) } }) : [];
          const hits = await verifyCandidates(candidates, scope, Math.min(limit, 5), { allowFileOnly: true });
          const status = item.status === 'hits' && !hits.length ? 'error' : item.status;
          results.push({ position, status, nativeStatus: item.status, hits,
            ...(status === 'hits' ? {} : { fallback: itemFallback(input.queries[position]) }) });
        }
        const output = { status: 'ok', backend: 'xerj', nativeTool: name, hits: [], results, truncated: false };
        return boundedBatch(output);
      }
      const candidates = name === 'xerj_code_search' ? codeCandidates(text) : jsonCandidates(JSON.parse(text));
      const hits = await verifyCandidates(candidates, scope, limit);
      if (/^weak match: the corpus may not cover this/m.test(text)) return { ...fallback(query, 'weak_match'), nativeTool: name, weakMatch: true };
      if (!hits.length) return { ...fallback(query, 'no_usable_hits'), nativeTool: name };
      return bounded({ status: 'ok', backend: 'xerj', nativeTool: name, hits, truncated: candidates.length > hits.length,
        note: '片段已核对当前原文；需要补读时以 readLine 为中心，Read offset=max(1,readLine-12)、limit=25。未知行号先 Grep；证据不足继续 Grep/Read。' });
    } catch (error) {
      scope.callerSignal.throwIfAborted();
      return failure(scope.timeout.aborted ? 'timeout' : ['corpus_scope_mismatch', 'response_too_large'].includes(error.message) ? error.message : 'native_unavailable');
    }
  }
  return {
    searchRepository: (input, context) => run(input, context, 'code'),
    findDefinition: (input, context) => run(input, context, 'definition'),
    mapRepository: (input, context) => run(input, context, 'map'),
    batchSearch: (input, context) => run(input, context, 'batch'),
  };
}
export const { searchRepository, findDefinition, mapRepository, batchSearch } = createSearchService();
