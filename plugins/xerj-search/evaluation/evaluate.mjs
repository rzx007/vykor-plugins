import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { boundPluginResponse, executeFallback, readEvidence, retrieveBaseline, scoreTask, summarize, verifyGold } from './retrieval.mjs';

const execFileAsync = promisify(execFile);
const evaluationDir = dirname(fileURLToPath(import.meta.url));

export function parseArgs(args) {
  const options = { runs: 3, output: resolve(evaluationDir, 'results', 'retrieval.json') };
  const names = { '--root': 'root', '--config-dir': 'configDir', '--output': 'output', '--runs': 'runs', '--source-root': 'sourceRoot' };
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (name === '--help' || name === '-h') return { help: true };
    if (!names[name] || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`未知参数或缺少值: ${name}`);
    options[names[name]] = args[++index];
  }
  if (!options.root) throw new Error('必须提供 --root <检索语料目录>');
  if (!options.configDir) throw new Error('必须提供 --config-dir <插件数据目录>');
  options.runs = Number(options.runs);
  if (!Number.isSafeInteger(options.runs) || options.runs < 1 || options.runs > 20) throw new Error('--runs 必须为 1 到 20 的整数');
  for (const field of ['root', 'configDir', 'output', 'sourceRoot']) if (options[field]) options[field] = resolve(options[field]);
  const outputOffset = relative(evaluationDir, options.output);
  if (!outputOffset || outputOffset === '..' || outputOffset.startsWith(`..${sep}`) || isAbsolute(outputOffset)) throw new Error('--output 必须位于 evaluation 目录内，避免散落评测产物');
  return options;
}

async function sourceMetadata(root) {
  if (!root) return null;
  try {
    const canonical = await realpath(root);
    const top = (await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: canonical, shell: false, windowsHide: true })).stdout.trim();
    if (await realpath(top) !== canonical) return { root: canonical, git: null, note: '不是独立 Git 根目录，避免把父目录提交冒认为语料提交' };
    const [{ stdout: sha }, { stdout: status }] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: canonical, shell: false, windowsHide: true }),
      execFileAsync('git', ['status', '--porcelain'], { cwd: canonical, shell: false, windowsHide: true }),
    ]);
    return { root: canonical, git: { commit: sha.trim(), dirty: Boolean(status.trim()) } };
  } catch { return { root, git: null }; }
}

async function pluginSearch(searchRepository, task, root, configDir, budget) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('评测检索时间预算已用完')), budget.timeoutMs);
  let rejectTimer;
  try {
    const response = await Promise.race([
      searchRepository({ query: task.query, limit: budget.topFiles }, { cwd: root, plugin: { dataDir: configDir }, signal: controller.signal, deadline: Date.now() + budget.timeoutMs }),
      new Promise((_, reject) => { rejectTimer = setTimeout(() => reject(new Error('插件检索超出固定时间预算')), budget.timeoutMs); }),
    ]);
    const bounded = boundPluginResponse(response, budget.searchMaxBytes);
    if (bounded.status === 'ok') return { ...bounded, searchCalls: 1, receivedBytes: null };
    const remainingMs = budget.timeoutMs - (performance.now() - started);
    const remainingBytes = budget.searchMaxBytes - bounded.searchBytes;
    if (remainingMs <= 0 || remainingBytes <= 0) return { ...bounded, hits: [], searchCalls: 1, timedOut: remainingMs <= 0, truncated: true };
    const fallback = await executeFallback(bounded, root, { ...budget, searchMaxBytes: remainingBytes, timeoutMs: remainingMs });
    return { ...fallback, searchBytes: bounded.searchBytes + fallback.searchBytes, returnedResponseBytes: bounded.returnedResponseBytes, searchCalls: 2, fallback: bounded.fallback, pluginBackend: bounded.backend, truncated: bounded.truncated || fallback.truncated };
  } finally {
    clearTimeout(timeout);
    clearTimeout(rejectTimer);
    controller.abort();
  }
}

async function measure(method, task, run, root, configDir, budget, searchRepository) {
  const started = performance.now();
  let result;
  try {
    result = method === 'rg' ? await retrieveBaseline(task, root, budget) : await pluginSearch(searchRepository, task, root, configDir, budget);
  } catch (error) {
    result = { status: 'error', backend: method, hits: [], searchBytes: 0, error: error.message };
  }
  const searchMs = performance.now() - started;
  const readStarted = performance.now();
  const evidence = await readEvidence(root, result.hits, budget);
  const score = scoreTask(task, result.hits, evidence, budget.topFiles);
  return {
    taskId: task.id, category: task.category, query: task.query, run, method,
    ...result, hits: score.topFiles.map((path) => result.hits.find((hit) => hit.path === path)),
    score, searchMs, readMs: performance.now() - readStarted,
    readBytes: evidence.reduce((sum, window) => sum + window.bytes, 0), evidence,
  };
}

export function renderMarkdown(report) {
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const rows = Object.entries(report.summary.methods).map(([method, value]) => `| ${method} | ${value.samples} | ${pct(value.fileHitAt5)} | ${pct(value.evidenceHitAt5)} | ${value.meanSearchBytes?.toFixed(0) ?? '—'} / ${value.meanReadBytes?.toFixed(0) ?? '—'} | ${value.meanRetrievedBytes.toFixed(0)} | ${value.medianSearchMs.toFixed(1)} / ${value.p95SearchMs.toFixed(1)} | ${value.fallbackSamples} | ${value.errorSamples} |`).join('\n');
  return `# Xerj 检索级评估\n\n题集：${report.dataset.id}；${report.dataset.tasks} 题，每题 ${report.runs} 次。题集 SHA-256：\`${report.dataset.sha256}\`。\n\n| 方法 | 样本数 | top5 文件命中 | top5 证据命中 | 平均回包 / 后续读取字节 | 平均总字节 | 检索延迟中位数 / P95 ms | 降级样本 | 错误样本 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n这是固定语料、固定题集的检索级评估。基线由人工预先提供 1–2 个正则模式，采用真实 rg 与源码读取，因此不能代表模型自主构造检索词的水平。两组均按前 5 个不同文件读取相同大小的证据窗口；有已核验的 readLine 时以它为中心，否则以命中行为中心。共同保留回包上限为 32KiB，生产插件自身另有 8KiB 上限；后续每文件正文至多 4KiB。回包若已包含正文片段，再次读取时仍分别计数。\n\n真实降级演练：插件使用 disabled 配置，返回的 Grep 模式交给本地 ${report.fallbackSmoke.backend} 执行；人工证据读取${report.fallbackSmoke.score.evidenceHit ? '命中' : '未命中'}。这不等于通过宿主调用了 Grep 工具。\n\n模型实际 Token、费用和任务完成率均未测量，JSON 中为 null。检索字节差异不能换算为这些指标。字节包含两种方法各自保留的输出表示及读取的正文，序列化格式不同；原始接收量、截断、逐题结果和证据均见配套 JSON。\n\n插件组的降级与错误必须一起阅读；全部降级时不构成 Xerj 效果证据。重复运行受操作系统缓存影响，顺序在两种方法间交替，无独立冷启动或模型试验。\n`;
}

export async function runEvaluation(options) {
  const root = await realpath(options.root);
  const rawTasks = await readFile(resolve(evaluationDir, 'tasks.json'), 'utf8');
  const dataset = JSON.parse(rawTasks);
  const checkedBefore = await verifyGold(root, dataset.tasks);
  const pluginModule = await import(pathToFileURL(resolve(evaluationDir, '../tools/search.mjs')).href);
  if (typeof pluginModule.searchRepository !== 'function') throw new Error('真实插件必须导出 searchRepository');
  await mkdir(dirname(options.output), { recursive: true });
  const rows = [];
  for (let run = 1; run <= options.runs; run++) {
    for (const [index, task] of dataset.tasks.entries()) {
      const methods = (run + index) % 2 ? ['rg', 'plugin'] : ['plugin', 'rg'];
      for (const method of methods) rows.push(await measure(method, task, run, root, options.configDir, dataset.budget, pluginModule.searchRepository));
      process.stderr.write(`完成 ${run}/${options.runs} ${task.id}\n`);
    }
  }
  const disabledDir = await mkdtemp(resolve(dirname(options.output), '.fallback-config-'));
  let fallbackSmoke;
  try {
    await writeFile(resolve(disabledDir, 'xerj.json'), JSON.stringify({ enabled: false }));
    fallbackSmoke = await measure('plugin', dataset.tasks[0], 1, root, disabledDir, dataset.budget, pluginModule.searchRepository);
    fallbackSmoke.scenario = 'real-plugin-disabled-config-to-real-rg-and-source-read';
  } finally { await rm(disabledDir, { recursive: true, force: true }); }
  const checkedAfter = await verifyGold(root, dataset.tasks);
  if (JSON.stringify(checkedBefore) !== JSON.stringify(checkedAfter)) throw new Error('评测期间人工证据文件发生变化，拒绝输出混合状态结果');
  const configText = await readFile(resolve(options.configDir, 'xerj.json'), 'utf8').catch(() => null);
  const summary = summarize(rows);
  const report = {
    schemaVersion: 1, evaluatedAt: new Date().toISOString(), evaluationLevel: 'retrieval-only',
    plugin: { version: JSON.parse(await readFile(resolve(evaluationDir, '..', 'package.json'), 'utf8')).version,
      implementation: 'native MCP: code search / definition; explicit map and batch tools available separately' },
    dataset: { id: dataset.id, tasks: dataset.tasks.length, sha256: createHash('sha256').update(rawTasks).digest('hex'), reference: dataset.reference },
    root, source: await sourceMetadata(options.sourceRoot ?? root),
    config: { directory: options.configDir, sha256: configText === null ? null : createHash('sha256').update(configText).digest('hex') },
    runs: options.runs, budget: dataset.budget,
    methodology: {
      baselineProtocol: 'rg-parallel-no-config-v2: no --sort path; collected hits are ranked in retrieveBaseline after reading, as before',
      readProtocol: 'verified-readLine-v1: use plugin midpoint hint only within its verified passage range; otherwise use match line. Same +/-12 lines and 4096-byte cap.',
      baseline: '人工预先写定 1–2 个 rg 正则；按首个命中模式优先、文件命中行数降序、路径排序选前5个不同文件。',
      plugin: '真实 tools/search.mjs，limit=5；生产插件保留同文件不同位置，评分按前5个不同文件；降级时执行返回的 Grep 模式。',
      sharedBudget: '每题每方法最多2次检索操作、总检索时间5秒、保留检索输出32KiB；前5文件优先采用已核验范围内的readLine，缺少提示则用命中行，读取前后12行且最多4KiB。插件检索一次，必要时加一次rg；基线最多两次rg。',
      bytes: 'searchBytes 是保留的 rg JSON 字节或插件响应 JSON 字节；共同上限32KiB，生产插件自身8KiB上限。readBytes 是后续源码/文档正文 UTF-8 字节；回包正文与后续读取可能重复，分别照实计数。不等于模型Token或网络流量。',
      evidence: '实际读取窗口在预先标注的行包含人工确认的锚点；只是可核查的检索证据，不是语义正确性或任务完成率。',
      order: '每题交替两方法顺序；无模型、无冷启动保证；重复执行可受索引和文件缓存影响。',
    },
    goldVerification: checkedBefore, summary, fallbackSmoke, rows,
  };
  report.valid = fallbackSmoke.status === 'fallback' && fallbackSmoke.backend === 'rg' && fallbackSmoke.score.evidenceHit && rows.every((row) => !row.error);
  report.xerjEvidence = summary.methods.plugin.xerjSamples > 0 ? 'measured' : 'none-all-plugin-calls-fell-back-or-failed';
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
  await writeFile(options.output.replace(/\.json$/i, '') + '.md', renderMarkdown(report));
  return report;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('node evaluation/evaluate.mjs --root <语料根目录> --config-dir <插件数据目录> [--output <evaluation内JSON>] [--runs 3] [--source-root <源Git仓库>]');
    return;
  }
  const report = await runEvaluation(options);
  console.log(JSON.stringify({ output: options.output, valid: report.valid, xerjEvidence: report.xerjEvidence, ...report.summary }, null, 2));
  if (!report.valid) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
