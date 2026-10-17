const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

let handler;
test.before(async () => {
  const source = await fs.readFile(path.join(__dirname, '../server/worker.js'), 'utf8');
  const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  handler = (await import(moduleUrl)).default;
});

const env = { ALLOWED_ORIGIN: 'https://jarvis.example', AI_API_KEY: 'test-key', AI_MODEL: 'test-model' };
function request({ method = 'POST', origin = 'https://jarvis.example', body = '{"message":"hello"}', path: pathname = '/api/chat' } = {}) {
  return new Request('https://worker.example' + pathname, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: method === 'GET' || method === 'OPTIONS' ? undefined : body
  });
}
function json(response) { return response.json(); }

test('rejects a disallowed origin before calling provider', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const response = await handler.fetch(request({ origin: 'https://evil.example' }), env);
  assert.equal(response.status, 403);
  assert.equal((await json(response)).error, 'origin_not_allowed');
  assert.equal(called, false);
});

test('returns a configuration error when provider credentials are missing', async () => {
  const response = await handler.fetch(request(), { ALLOWED_ORIGIN: env.ALLOWED_ORIGIN });
  assert.equal(response.status, 503);
  assert.equal((await json(response)).error, 'server_not_configured');
});

test('rejects malformed JSON and empty messages', async () => {
  const malformed = await handler.fetch(request({ body: '{' }), env);
  assert.equal(malformed.status, 400);
  assert.equal((await json(malformed)).error, 'invalid_json');
  const empty = await handler.fetch(request({ body: JSON.stringify({ message: '  ' }) }), env);
  assert.equal(empty.status, 400);
  assert.equal((await json(empty)).error, 'invalid_message');
});

test('rejects oversized request bodies before calling provider', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const body = JSON.stringify({ message: 'hello', history: [], padding: 'x'.repeat(64 * 1024) });
  const response = await handler.fetch(request({ body }), env);
  assert.equal(response.status, 413);
  assert.equal((await json(response)).error, 'request_too_large');
  assert.equal(called, false);
});

test('strips display labels from history before forwarding it', async () => {
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const response = await handler.fetch(request({
    body: JSON.stringify({ message: 'hello', history: [{ kind: 'me', text: 'Вы: previous message' }, { kind: 'jarvis', text: 'Джарвис: previous answer' }] })
  }), env);
  assert.equal(response.status, 200);
  assert.equal(sent.messages[1].content, 'previous message');
  assert.equal(sent.messages[2].content, 'previous answer');
});

test('maps an upstream timeout to HTTP 504', async () => {
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const response = await handler.fetch(request(), { ...env, AI_TIMEOUT_MS: '1000' });
  assert.equal(response.status, 504);
  assert.equal((await json(response)).error, 'provider_timeout');
});

test('returns a successful provider reply without surrounding whitespace', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '  привет  ' } }] }), { status: 200 });
  const response = await handler.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { reply: 'привет' });
});
