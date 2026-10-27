import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { callMcp } from '../tools/native-mcp.mjs';
const fixture = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url));
const settings = { binary: process.execPath, args: [fixture], cwd: process.cwd(), url: 'http://127.0.0.1:9200', codeHome: process.cwd() };

test('uses native MCP and returns only the requested result, then stops its child', async () => {
  const result = await callMcp({ ...settings, signal: AbortSignal.timeout(2000) }, 'xerj_def', { prefix: 'project', symbol: 'Cache' });
  assert.doesNotMatch(JSON.stringify(result), /SEND PRIVATE/);
  const value = JSON.parse(result.content[0].text);
  assert.equal(value.name, 'xerj_def');
  assert.deepEqual(value.args, { prefix: 'project', symbol: 'Cache' });
  assert.equal(value.feedbackDisabled, 'true');
  assert.throws(() => process.kill(value.pid, 0), error => error.code === 'ESRCH');
});

test('rejects write and feedback tools before spawning any process', async () => {
  for (const name of ['xerj_memory_store', 'xerj_field_report', 'xerj_autoindex_remove']) {
    await assert.rejects(callMcp({ ...settings, binary: 'missing-executable' }, name, {}), /not allowed/);
  }
});

test('cancellation kills a hanging MCP child and propagates cancellation', async () => {
  const controller = new AbortController();
  const request = callMcp({ ...settings, args: [fixture, 'hang'], signal: controller.signal }, 'xerj_map', {});
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(request, error => error.name === 'AbortError');
});

test('bounds native stdout and fails promptly when the child exits', async () => {
  await assert.rejects(callMcp({ ...settings, args: [fixture, 'large'], signal: AbortSignal.timeout(2000) }, 'xerj_map', {}), /response_too_large/);
  await assert.rejects(callMcp({ ...settings, args: [fixture, 'exit'], signal: AbortSignal.timeout(2000) }, 'xerj_map', {}), /native_process_exit/);
});
