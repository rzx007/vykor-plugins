import { spawn } from 'node:child_process';

const READ_TOOLS = new Set(['xerj_code_search', 'xerj_def', 'xerj_map', 'xerj_batch_search']);

/** One bounded native MCP session per invocation; no upstream instructions reach the model. */
export async function callMcp(settings, name, args) {
  if (!READ_TOOLS.has(name)) throw new Error('Native tool is not allowed');
  settings.signal?.throwIfAborted();
  const child = spawn(settings.binary, settings.args ?? ['mcp', '--url', settings.url, '--disable-feedback'], {
    cwd: settings.cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, XERJ_URL: settings.url, XERJ_CODE_HOME: settings.codeHome,
      XERJ_AUTH: settings.auth ?? '', XERJ_DISABLE_FEEDBACK: 'true' },
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  const pending = new Map();
  let nextId = 0, received = 0, buffer = '', failure;
  const fail = error => {
    failure ??= error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  const abort = () => { fail(settings.signal.reason); child.kill(); };
  settings.signal?.addEventListener('abort', abort, { once: true });
  child.on('error', () => fail(new Error('native_process_unavailable')));
  child.on('close', () => fail(new Error('native_process_exit')));
  child.stdin.on('error', () => fail(new Error('native_process_exit')));
  child.stderr.resume(); // Drain diagnostics, never expose credentials or upstream invitations.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => {
    received += Buffer.byteLength(text);
    if (received > 1_048_576) { fail(new Error('response_too_large')); child.kill(); return; }
    buffer += text;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { fail(new Error('invalid_native_response')); child.kill(); return; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error('native_rpc_error'));
      else request.resolve(message.result);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vykor-xerj-readonly', version: '0.2.1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return await rpc('tools/call', { name, arguments: args });
  } finally {
    settings.signal?.removeEventListener('abort', abort);
    child.stdin.end();
    child.kill();
    await closed;
  }
}
