import { open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

export async function readBounded(path, limit, signal) {
  signal?.throwIfAborted();
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('file_too_large');
    const bytes = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    signal?.throwIfAborted();
    if (bytesRead > limit) throw new Error('file_too_large');
    return bytes.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
  } finally { await file.close(); }
}

export function fallback(query, reason) {
  return { status: 'fallback', backend: 'grep', reason, hits: [], fallback: {
    tool: 'Grep', input: { pattern: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), limit: 40 },
    note: '继续调用内置 Grep 和 Read；自然语言问题先提取关键词。本插件未执行 Grep。',
  } };
}

export async function loadSearchConfig(dataDir, signal) {
  const config = JSON.parse(await readBounded(join(dataDir, 'xerj.json'), 65_536, signal));
  if (!config || typeof config.enabled !== 'boolean') throw new Error('invalid_config');
  if (!config.enabled) return { enabled: false };
  const url = new URL(config.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid_config');
  for (const key of ['binary', 'codeHome']) if (typeof config[key] !== 'string' || !isAbsolute(config[key])) throw new Error('invalid_config');
  if (!Array.isArray(config.projects) || !config.projects.length || config.projects.length > 100) throw new Error('invalid_config');
  const timeoutMs = config.timeoutMs ?? 1500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 10_000) throw new Error('invalid_config');
  for (const project of config.projects) {
    if (!project || typeof project.root !== 'string' || !isAbsolute(project.root)
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(project.prefix ?? '')
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(project.corpus ?? '')) throw new Error('invalid_config');
  }
  if (config.authFile !== undefined && (typeof config.authFile !== 'string' || !isAbsolute(config.authFile))) throw new Error('invalid_config');
  return { ...config, url: url.origin, timeoutMs };
}

export async function projectContext(context, query) {
  const callerSignal = context.signal ?? new AbortController().signal;
  callerSignal.throwIfAborted();
  let config;
  try { config = await loadSearchConfig(context.plugin.dataDir, callerSignal); }
  catch (error) { callerSignal.throwIfAborted(); return { fallback: fallback(query, error.code === 'ENOENT' ? 'not_configured' : 'invalid_config') }; }
  if (!config.enabled) return { fallback: fallback(query, 'disabled') };
  let root, project;
  try {
    root = await realpath(context.cwd);
    for (const candidate of config.projects) if (relative(root, await realpath(candidate.root)) === '') {
      if (project) return { fallback: fallback(query, 'invalid_config') };
      project = candidate;
    }
  } catch { return { fallback: fallback(query, 'invalid_config') }; }
  if (!project) return { fallback: fallback(query, 'project_not_configured') };
  const remaining = Math.min(config.timeoutMs, (context.deadline ?? Date.now() + config.timeoutMs) - Date.now());
  if (remaining <= 0) return { fallback: fallback(query, 'timeout') };
  const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
  const signal = AbortSignal.any([callerSignal, timeout]);
  let auth;
  if (config.authFile) {
    try { auth = (await readBounded(config.authFile, 4096, signal)).trim(); }
    catch { callerSignal.throwIfAborted(); return { fallback: fallback(query, timeout.aborted ? 'timeout' : 'invalid_config') }; }
    if (!auth || /[\r\n]/.test(auth)) return { fallback: fallback(query, 'invalid_config') };
    if (!auth.startsWith('ApiKey ')) auth = `ApiKey ${auth}`;
  }
  return { root, project, config, callerSignal, timeout, signal,
    settings: { binary: config.binary, cwd: root, url: config.url, codeHome: config.codeHome, auth, signal } };
}

export async function checkCorpus(scope) {
  const ledger = JSON.parse(await readBounded(join(scope.config.codeHome, 'state', scope.project.corpus + '.json'), 65_536, scope.signal));
  const prefix = ledger.index_prefix ?? ledger.prefix;
  if (![scope.project.prefix, scope.project.prefix + '-'].includes(prefix) || ledger.url !== scope.config.url) throw new Error('corpus_scope_mismatch');
  if (ledger.project_root && relative(scope.root, await realpath(ledger.project_root)) !== '') throw new Error('corpus_scope_mismatch');
}
