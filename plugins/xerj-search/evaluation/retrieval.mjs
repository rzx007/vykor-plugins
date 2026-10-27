import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const SOURCE_GLOB = '*.{ts,tsx,js,jsx,mjs,cjs,md,mdx,json,yaml,yml}';

function topHits(hits, count) {
  const seen = new Set();
  return hits.filter((hit) => {
    if (!hit || typeof hit.path !== 'string' || seen.has(hit.path)) return false;
    seen.add(hit.path);
    return true;
  }).slice(0, count);
}

async function containedFile(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || /^[A-Za-z]:/.test(path)) return null;
  const parts = path.replaceAll('\\', '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  const canonicalRoot = await realpath(root);
  const file = await realpath(resolve(canonicalRoot, ...parts)).catch(() => null);
  if (!file) return null;
  const offset = relative(canonicalRoot, file);
  return offset && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset) ? file : null;
}

function truncateUtf8(text, maxBytes) {
  let used = 0;
  let result = '';
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

/** Run the same local text-search engine used underneath Grep; never launch a shell. */
export async function runRg(root, pattern, budget) {
  if (typeof pattern !== 'string' || !pattern || pattern.includes('\0')) throw new Error('rg 模式必须是非空字符串且不能包含 NUL');
  const started = performance.now();
  const maxBytes = Math.max(0, budget.searchMaxBytes);
  const args = ['--no-config', '--json', '--line-number', '--max-count', '20', '--glob', SOURCE_GLOB, '--glob', '!node_modules/**', '--glob', '!.git/**', '--', pattern, '.'];
  return new Promise((resolveResult, reject) => {
    const child = spawn('rg', args, { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let capturedBytes = 0;
    let receivedBytes = 0;
    let stderr = '';
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, budget.timeoutMs);
    child.stdout.on('data', (chunk) => {
      receivedBytes += chunk.length;
      const remaining = maxBytes - capturedBytes;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        chunks.push(kept);
        capturedBytes += kept.length;
      }
      if (chunk.length > remaining) { truncated = true; child.kill(); }
    });
    child.stderr.on('data', (chunk) => { stderr = truncateUtf8(stderr + chunk.toString('utf8'), 2048); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== 1 && !truncated && !timedOut) {
        reject(new Error(`rg 执行失败 (${code}): ${stderr}`));
        return;
      }
      const hits = [];
      for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch (error) {
          if (truncated || timedOut) continue;
          reject(new Error('rg 返回了无法解析的 JSON', { cause: error }));
          return;
        }
        if (event.type !== 'match' || typeof event.data?.path?.text !== 'string') continue;
        hits.push({
          path: event.data.path.text.replaceAll('\\', '/').replace(/^\.\//, ''),
          line: event.data.line_number,
          text: event.data.lines.text.trimEnd(),
        });
      }
      resolveResult({ backend: 'rg', hits, searchBytes: capturedBytes, receivedBytes, truncated, timedOut, stderr, elapsedMs: performance.now() - started });
    });
  });
}

/** Patterns were written by a human before measuring either method. */
export async function retrieveBaseline(task, root, budget) {
  const started = performance.now();
  const files = new Map();
  let searchBytes = 0;
  let receivedBytes = 0;
  let truncated = false;
  let timedOut = false;
  let searchCalls = 0;
  const patterns = task.baselinePatterns.slice(0, budget.maxSearchCalls);
  for (const [index, pattern] of patterns.entries()) {
    const remainingMs = budget.timeoutMs - (performance.now() - started);
    if (searchBytes >= budget.searchMaxBytes || remainingMs <= 0) { truncated = true; break; }
    const result = await runRg(root, pattern, { ...budget, searchMaxBytes: budget.searchMaxBytes - searchBytes, timeoutMs: remainingMs });
    searchCalls++;
    searchBytes += result.searchBytes;
    receivedBytes += result.receivedBytes;
    truncated ||= result.truncated;
    timedOut ||= result.timedOut;
    for (const hit of result.hits) {
      const file = files.get(hit.path);
      if (file) file.matches++;
      else files.set(hit.path, { ...hit, patternIndex: index, matches: 1 });
    }
  }
  const hits = [...files.values()].sort((a, b) => a.patternIndex - b.patternIndex || b.matches - a.matches || a.path.localeCompare(b.path));
  return { status: 'ok', backend: 'rg', hits, searchBytes, receivedBytes, truncated, timedOut, searchCalls, patterns };
}

export async function executeFallback(response, root, budget) {
  const hint = response?.fallback;
  const pattern = hint?.input?.pattern ?? hint?.pattern;
  if (response?.status !== 'fallback' || hint?.tool !== 'Grep' || typeof pattern !== 'string') {
    throw new Error('插件没有返回可执行的 Grep 降级模式');
  }
  const result = await runRg(root, pattern, budget);
  return { ...result, status: 'fallback', searchCalls: 1, pattern, implementation: '真实 rg 子进程；未声称已调用宿主 Grep 工具' };
}

export function boundPluginResponse(response, maxBytes) {
  if (!response || !['ok', 'fallback'].includes(response.status) || !Array.isArray(response.hits)) throw new Error('插件返回结构无效');
  const returnedResponseBytes = Buffer.byteLength(JSON.stringify(response));
  const bounded = { ...response, hits: [] };
  let searchBytes = Buffer.byteLength(JSON.stringify(bounded));
  if (searchBytes > maxBytes) throw new Error('插件响应元数据超出固定字节预算');
  for (const hit of response.hits) {
    bounded.hits.push(hit);
    const size = Buffer.byteLength(JSON.stringify(bounded));
    if (size > maxBytes) { bounded.hits.pop(); break; }
    searchBytes = size;
  }
  return { ...bounded, searchBytes, returnedResponseBytes, truncated: response.truncated === true || bounded.hits.length < response.hits.length };
}

/** Both methods get one identically bounded source window for each of their first five files. */
export async function readEvidence(root, hits, budget) {
  const result = [];
  for (const hit of topHits(hits, budget.topFiles)) {
    const file = await containedFile(root, hit.path);
    if (!file) continue;
    try {
      const metadata = await stat(file);
      if (!metadata.isFile() || metadata.size > 512 * 1024) continue;
      const source = await readFile(file, 'utf8');
      if (source.includes('\0')) continue;
      const lines = source.split(/\r?\n/);
      const hinted = Number.isSafeInteger(hit.readLine) && Number.isSafeInteger(hit.startLine) && Number.isSafeInteger(hit.endLine)
        && hit.startLine > 0 && hit.endLine <= lines.length && hit.readLine >= hit.startLine && hit.readLine <= hit.endLine;
      const center = hinted ? hit.readLine : Number.isSafeInteger(hit.line) && hit.line > 0 ? hit.line : 1;
      const startLine = Math.max(1, center - budget.readContextLines);
      const raw = lines.slice(startLine - 1, center + budget.readContextLines).join('\n');
      const text = truncateUtf8(raw, budget.readMaxBytesPerFile);
      result.push({ path: hit.path, startLine, endLine: startLine + text.split('\n').length - 1, text, bytes: Buffer.byteLength(text), truncated: raw !== text });
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
    }
  }
  return result;
}

export function scoreTask(task, hits, evidence, limit = 5) {
  const topFiles = topHits(hits, limit).map((hit) => hit.path);
  const relevantPaths = [...new Set(task.relevant.map((item) => item.path))];
  const matched = relevantPaths.filter((path) => topFiles.includes(path));
  const evidenceFiles = matched.filter((path) => task.relevant.filter((item) => item.path === path).some((item) => evidence.some((window) => {
    if (window.path !== path || item.line < window.startLine) return false;
    const actualLine = window.text.split(/\r?\n/)[item.line - window.startLine];
    return typeof actualLine === 'string' && actualLine.includes(item.contains);
  })));
  return {
    fileHit: matched.length > 0,
    evidenceHit: evidenceFiles.length > 0,
    relevantFilesFound: matched.length,
    relevantFilesTotal: relevantPaths.length,
    fileRecall: matched.length / relevantPaths.length,
    topFiles,
    evidenceFiles,
  };
}

export async function verifyGold(root, tasks) {
  const checked = [];
  const contents = new Map();
  for (const task of tasks) {
    for (const item of task.relevant) {
      const file = await containedFile(root, item.path);
      if (!file) throw new Error(`人工证据失效: ${task.id} ${item.path}:${item.line}（路径不可读取）`);
      if (!contents.has(item.path)) contents.set(item.path, await readFile(file, 'utf8'));
      const text = contents.get(item.path);
      if (!text.split(/\r?\n/)[item.line - 1]?.includes(item.contains)) {
        throw new Error(`人工证据失效: ${task.id} ${item.path}:${item.line}；请人工复核并另建题集版本，不能按检索结果修题`);
      }
      checked.push({ taskId: task.id, ...item, sha256: createHash('sha256').update(text).digest('hex') });
    }
  }
  return checked;
}

function aggregate(rows) {
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const quantile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return {
    samples: rows.length,
    fileHitAt5: mean(rows.map((row) => Number(row.score.fileHit))),
    evidenceHitAt5: mean(rows.map((row) => Number(row.score.evidenceHit))),
    meanRelevantFileRecallAt5: mean(rows.map((row) => row.score.fileRecall)),
    medianSearchMs: median(rows.map((row) => row.searchMs)),
    p95SearchMs: quantile(rows.map((row) => row.searchMs), 0.95),
    medianSearchAndReadMs: median(rows.map((row) => row.searchMs + row.readMs)),
    meanSearchBytes: mean(rows.map((row) => row.searchBytes)),
    meanReadBytes: mean(rows.map((row) => row.readBytes)),
    meanRetrievedBytes: mean(rows.map((row) => row.searchBytes + row.readBytes)),
    fallbackSamples: rows.filter((row) => row.status === 'fallback').length,
    xerjSamples: rows.filter((row) => row.backend === 'xerj').length,
    timeoutSamples: rows.filter((row) => row.timedOut).length,
    truncatedSamples: rows.filter((row) => row.truncated).length,
    hitTruncatedSamples: rows.filter((row) => row.hits?.some((hit) => hit.truncated)).length,
    truncatedHitCount: rows.reduce((sum, row) => sum + (row.hits?.filter((hit) => hit.truncated).length ?? 0), 0),
    errorSamples: rows.filter((row) => row.error).length,
  };
}

export function summarize(rows) {
  const methods = {};
  const categories = {};
  for (const method of new Set(rows.map((row) => row.method))) {
    const selected = rows.filter((row) => row.method === method);
    methods[method] = aggregate(selected);
    categories[method] = Object.fromEntries([...new Set(selected.map((row) => row.category))].map((category) => [category, aggregate(selected.filter((row) => row.category === category))]));
  }
  return {
    methods,
    categories,
    modelEvaluation: { status: 'not_measured', actualTokens: null, cost: null, taskCompletionRate: null },
  };
}
