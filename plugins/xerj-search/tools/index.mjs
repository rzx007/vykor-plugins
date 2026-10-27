import { searchRepository, findDefinition, mapRepository, batchSearch } from './search.mjs';

/** @type {import('@vykor/plugins/sdk').NativeToolRegister} */
export const registerTools = () => [{
  name: 'XerjSearch',
  description: '复用 XERJ 原生检索当前项目：符号名走 definition，问题描述走 code search，保留原生排序与片段。需要补读时以 readLine 为中心；status=fallback 时改用 Grep/Read。',
  inputSchema: {
    type: 'object', required: ['query'], additionalProperties: false,
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 500 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
  },
  safeToRetry: true,
  async invoke(input, context) {
    const result = await searchRepository(input, context);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  },
}, {
  name: 'XerjDefinition',
  description: '调用 XERJ 原生 definition 查询当前项目的符号或能力描述，保留定义优先排序、去重和片段；结果不足时继续 Grep/Read。',
  inputSchema: { type: 'object', required: ['symbol'], additionalProperties: false,
    properties: { symbol: { type: 'string', minLength: 1, maxLength: 500 }, limit: { type: 'integer', minimum: 1, maximum: 10 } } },
  safeToRetry: true,
  async invoke(input, context) { return { content: [{ type: 'text', text: JSON.stringify(await findDefinition(input, context)) }] }; },
}, {
  name: 'XerjMap',
  description: '调用 XERJ 原生 map，了解当前项目索引有哪些字段、类型和覆盖信息。只能查看操作者绑定的项目索引。',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  safeToRetry: true,
  async invoke(input, context) { return { content: [{ type: 'text', text: JSON.stringify(await mapRepository(input, context)) }] }; },
}, {
  name: 'XerjBatchSearch',
  description: '调用 XERJ 原生批量搜索，在当前项目中同时查找多个问题或符号；按原输入顺序保留命中、无结果和错误，每项不足时可独立回退 Grep。',
  inputSchema: { type: 'object', required: ['queries'], additionalProperties: false,
    properties: { queries: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 500 } },
      limit: { type: 'integer', minimum: 1, maximum: 5 } } },
  safeToRetry: true,
  async invoke(input, context) { return { content: [{ type: 'text', text: JSON.stringify(await batchSearch(input, context)) }] }; },
}];
