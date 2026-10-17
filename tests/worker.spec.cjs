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
function request({ method = 'POST', origin = 'https://jarvis.example', body = '{"message":"hello"}', path: pathname = '/api/chat', ip, token } = {}) {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (token) headers.Authorization = 'Bearer ' + token;
  return new Request('https://worker.example' + pathname, {
    method,
    headers,
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

test('rejects an insecure provider URL before calling provider', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const response = await handler.fetch(request(), { ...env, AI_BASE_URL: 'http://provider.example/v1/chat/completions' });
  assert.equal(response.status, 503);
  assert.deepEqual(await json(response), { error: 'invalid_provider_configuration' });
  assert.equal(called, false);
});

test('rejects provider URLs with embedded credentials before calling provider', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const response = await handler.fetch(request(), { ...env, AI_BASE_URL: 'https://user:password@provider.example/v1/chat/completions' });
  assert.equal(response.status, 503);
  assert.deepEqual(await json(response), { error: 'invalid_provider_configuration' });
  assert.equal(called, false);
});

test('rejects malformed provider URLs before calling provider', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const response = await handler.fetch(request(), { ...env, AI_BASE_URL: 'not-a-valid-url' });
  assert.equal(response.status, 503);
  assert.deepEqual(await json(response), { error: 'invalid_provider_configuration' });
  assert.equal(called, false);
});

test('disables redirects when contacting the provider', async () => {
  let redirectMode;
  globalThis.fetch = async (_url, options) => {
    redirectMode = options.redirect;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const response = await handler.fetch(request(), { ...env, AI_BASE_URL: 'https://provider.example/v1/chat/completions' });
  assert.equal(response.status, 200);
  assert.equal(redirectMode, 'error');
});

test('uses configured rate limiting binding before calling provider', async () => {
  let key;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const rateEnv = {
    ...env,
    RATE_LIMITER: {
      async limit(options) {
        key = options.key;
        return { success: false };
      }
    }
  };
  const response = await handler.fetch(request({ ip: '203.0.113.9' }), rateEnv);
  assert.equal(response.status, 429);
  assert.equal((await json(response)).error, 'rate_limited');
  assert.equal(key, '203.0.113.9');
  assert.equal(called, false);
});

test('allows a request through when configured rate limiting succeeds', async () => {
  let key;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const rateEnv = {
    ...env,
    RATE_LIMITER: {
      async limit(options) {
        key = options.key;
        return { success: true };
      }
    }
  };
  const response = await handler.fetch(request({ ip: '203.0.113.11' }), rateEnv);
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { reply: 'ok' });
  assert.equal(key, '203.0.113.11');
  assert.equal(called, true);
});

test('fails closed when configured rate limiting binding is unavailable', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const rateEnv = {
    ...env,
    RATE_LIMITER: { async limit() { throw new Error('binding unavailable'); } }
  };
  const response = await handler.fetch(request({ ip: '203.0.113.10' }), rateEnv);
  assert.equal(response.status, 503);
  assert.equal((await json(response)).error, 'rate_limit_unavailable');
  assert.equal(called, false);
});

test('requires client IP when rate limiting is configured', async () => {
  const rateEnv = { ...env, RATE_LIMITER: { async limit() { return { success: true }; } } };
  const response = await handler.fetch(request(), rateEnv);
  assert.equal(response.status, 503);
  assert.equal((await json(response)).error, 'rate_limit_unavailable');
});

test('requires the configured access token before calling the provider', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const response = await handler.fetch(request(), { ...env, JARVIS_ACCESS_TOKEN: 'secret-token' });
  assert.equal(response.status, 401);
  assert.deepEqual(await json(response), { error: 'unauthorized' });
  assert.equal(called, false);
});

test('accepts a matching configured access token', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  const response = await handler.fetch(request({ token: 'secret-token' }), { ...env, JARVIS_ACCESS_TOKEN: 'secret-token' });
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { reply: 'ok' });
});

test('rejects an incorrect access token before calling the provider', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const response = await handler.fetch(request({ token: 'wrong-token' }), { ...env, JARVIS_ACCESS_TOKEN: 'secret-token' });
  assert.equal(response.status, 401);
  assert.deepEqual(await json(response), { error: 'unauthorized' });
  assert.equal(called, false);
});

test('allows Authorization in CORS preflight for the configured origin', async () => {
  const response = await handler.fetch(new Request('https://worker.example/api/chat', {
    method: 'OPTIONS',
    headers: {
      Origin: env.ALLOWED_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type'
    }
  }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), env.ALLOWED_ORIGIN);
  assert.match(response.headers.get('Access-Control-Allow-Headers'), /Authorization/i);
});

test('rejects CORS preflight from a disallowed origin', async () => {
  const response = await handler.fetch(new Request('https://worker.example/api/chat', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type'
    }
  }), env);
  assert.equal(response.status, 403);
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

test('caps total history context while keeping the latest entries', async () => {
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };
  const history = Array.from({ length: 12 }, (_, i) => ({
    kind: i % 2 === 0 ? 'me' : 'jarvis',
    text: (i % 2 === 0 ? 'Вы: ' : 'Джарвис: ') + String(i).repeat(3000)
  }));
  const response = await handler.fetch(request({
    body: JSON.stringify({ message: 'current question', history })
  }), env);
  assert.equal(response.status, 200);
  const context = sent.messages.slice(1, -1);
  assert.ok(context.reduce((total, item) => total + item.content.length, 0) <= 12000);
  assert.equal(sent.messages.at(-1).content, 'current question');
  assert.equal(context.at(-1).content, '11'.repeat(1000));
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

test('rejects oversized provider responses without returning their contents', async () => {
  const oversized = JSON.stringify({ choices: [{ message: { content: 'x'.repeat(256 * 1024) } }] });
  globalThis.fetch = async () => new Response(oversized, {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const response = await handler.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.equal((await json(response)).error, 'provider_response_too_large');
});

test('does not expose upstream error bodies to the browser', async () => {
  globalThis.fetch = async () => new Response('sensitive provider diagnostics', { status: 500 });
  const response = await handler.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.deepEqual(await json(response), { error: 'provider_error' });
});

test('returns a generic error for malformed provider JSON', async () => {
  globalThis.fetch = async () => new Response('{not-json', { status: 200 });
  const response = await handler.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.deepEqual(await json(response), { error: 'invalid_provider_response' });
});
