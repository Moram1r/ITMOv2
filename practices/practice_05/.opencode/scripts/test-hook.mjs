import assert from 'node:assert/strict';
import plugin from '../plugins/quality-gate.js';

let callback, disposed = false;
const cleanup = await plugin.setup({ tool: { hook: async (name, handler) => {
  assert.equal(name, 'execute.after');
  callback = handler;
  return { dispose: async () => { disposed = true; } };
} } });
const read = { status: 'completed', tool: 'read', result: { content: [] } };
await callback(read);
assert.equal(read.result.content.length, 0, 'Reads must not start checks.');
const failedEdit = { status: 'error', tool: 'edit' };
await callback(failedEdit);
const edit = { status: 'completed', tool: 'edit', result: { content: [{ type: 'text', text: 'File edited.' }] } };
await callback(edit);
assert.equal(edit.result.content[0].text, 'File edited.', 'The original tool result must be preserved.');
assert.equal(edit.result.content.length, 2);
assert.match(edit.result.content[1].text, /OK: конфигурация/);
assert.doesNotMatch(edit.result.content[1].text, /SKIP:/, 'The hook should run the fast check only.');
const patch = { status: 'completed', tool: 'patch', result: { content: [] } };
await callback(patch);
assert.match(patch.result.content[0].text, /OK: конфигурация/, 'The OpenCode V2 patch tool must trigger the check.');
await cleanup();
assert.equal(disposed, true);
console.log('OK: хук выполняет реальную быструю проверку после правки и освобождает регистрацию.');
