import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseAuth, normalizeUsage, validateProxy } from '../core.mjs';
import { createServer, startServer } from '../server.mjs';

const fakeToken = claims => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fake`;
const fixture = { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_at: 1800000000 }, secondary_window: { used_percent: 81, limit_window_seconds: 604800, reset_after_seconds: 500 } }, credits: { balance: '2.5', unlimited: false } };

test('repeated startup reuses the running meter', async t => {
  const first = await startServer(0);
  t.after(() => new Promise(resolve => { first.server.close(resolve); first.server.closeAllConnections(); }));
  const second = await startServer(first.server.address().port);
  assert.equal(second.reused, true); assert.equal(second.url, first.url); assert.equal(second.server, null);
});
test('unrelated port owner causes automatic selection of an available port', async t => {
  const other = http.createServer((req, res) => res.end('Another application'));
  await new Promise(resolve => other.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { other.close(resolve); other.closeAllConnections(); }));
  const meter = await startServer(other.address().port);
  t.after(() => new Promise(resolve => { meter.server.close(resolve); meter.server.closeAllConnections(); }));
  assert.equal(meter.reused, false); assert.notEqual(meter.server.address().port, other.address().port);
  assert.equal((await fetch(meter.url)).status, 200);
});

test('Codex nested auth, flat auth, and JWT account fallback; discard refresh token', () => {
  const auth = parseAuth({ tokens: { access_token: fakeToken({ exp: 1900000000, 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' } }), refresh_token: 'never-keep-this' } });
  assert.equal(auth.accountId, 'acct-123'); assert.equal(auth.expiresAt, 1900000000000);
  assert.equal(auth.refresh_token, undefined);
  assert.equal(parseAuth({ access_token: 'fake', account_id: 'acct-flat' }).accountId, 'acct-flat');
  assert.throws(() => parseAuth({ OPENAI_API_KEY: 'fake-key' }), /API Key/);
  assert.throws(() => parseAuth({ tokens: { access_token: 'fake\r\n', account_id: 'foo' } }), /格式/);
  assert.throws(() => parseAuth({ access_token: 'fake', account_id: 'foo\r\n' }), /格式/);
});
test('usage percentages, reset times, credits and missing windows', () => {
  const result = normalizeUsage(fixture, 1000000);
  assert.equal(result.windows[0].remaining, 63);
  assert.equal(result.windows[0].seconds, 18000);
  assert.equal(result.windows[0].resetAt, 1800000000000);
  assert.equal(result.windows[1].resetAt, 1500000);
  assert.equal(result.credits.balance, '2.5');
  assert.equal(normalizeUsage({ plan_type: 'plus' }).windows.length, 0);
  assert.throws(() => normalizeUsage({ wrong: 'schema' }), /变化/);
  const extra = normalizeUsage({ additional_rate_limits: [{ limit_name: '<script>', rate_limit: { primary_window: { used_percent: 105 } } }] });
  assert.equal(extra.windows[0].remaining, 0); assert.equal(extra.windows[0].resetAt, null);
});
test('only loopback HTTP proxies allowed', () => {
  assert.equal(validateProxy('http://127.0.0.1:7897'), 'http://127.0.0.1:7897');
  for (const p of ['https://example.com', 'http://example.com:7897', 'http://user:pass@localhost', 'socks5://localhost:1080', 'http://localhost:7897/path']) assert.throws(() => validateProxy(p));
});

async function harness(t, fetchUsage) {
  const server = createServer({ fetchUsage });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const html = await (await fetch(base)).text();
  const token = html.match(/name="session-token" content="([^"]+)"/)[1];
  const call = (path, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { 'X-Session-Token': token, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { base, call };
}

test('import, fetch, cache, clear; never return credentials; reject foreign origin', async t => {
  let calls = 0;
  const { base, call } = await harness(t, async auth => { assert.equal(auth.accessToken, 'fake-only'); calls++; return fixture; });
  assert.equal((await fetch(base + '/api/usage')).status, 403);
  assert.equal((await call('/api/usage', 'GET', null, { Origin: 'https://evil.example' })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/usage', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await call('/api/usage')).status, 409);
  const invalid = await call('/api/auth', 'POST', { auth: { OPENAI_API_KEY: 'fake-key' } });
  assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /API Key/);
  const result = await call('/api/auth', 'POST', { auth: { tokens: { access_token: 'fake-only', refresh_token: 'SECRET-FAKE' } } });
  assert.equal(result.status, 200); assert.ok(!(await result.text()).includes('fake-only'));
  const usage = await call('/api/usage'); const text = await usage.text();
  assert.ok(!text.includes('SECRET-FAKE')); assert.equal(JSON.parse(text).windows[0].remaining, 63);
  await call('/api/usage'); assert.equal(calls, 1);
  assert.equal((await call('/api/auth', 'DELETE')).status, 200);
  assert.equal((await call('/api/usage')).status, 409);
});
test('expired tokens do not call upstream; 429 honors backoff', async t => {
  let calls = 0;
  const { call } = await harness(t, async () => { calls++; const error = new Error('too many'); error.status = 429; error.retryAfter = 90; throw error; });
  await call('/api/auth', 'POST', { auth: { access_token: fakeToken({ exp: 1 }) } });
  assert.equal((await call('/api/usage')).status, 401); assert.equal(calls, 0);
  await call('/api/auth', 'POST', { auth: { access_token: 'fake-only' } });
  assert.equal((await call('/api/usage')).status, 429);
  const retry = await call('/api/usage'); assert.equal(retry.status, 429); assert.ok((await retry.json()).retryAfter >= 89); assert.equal(calls, 1);
});
test('account switching cannot serve a response from the old account', async t => {
  let resolveFirst; let startedResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const { call } = await harness(t, auth => auth.accessToken === 'first' ? new Promise(resolve => { resolveFirst = resolve; startedResolve(); }) : Promise.resolve({ ...fixture, plan_type: 'pro' }));
  await call('/api/auth', 'POST', { auth: { access_token: 'first' } });
  const old = call('/api/usage'); await started;
  await call('/api/auth', 'POST', { auth: { access_token: 'second' } });
  const next = await call('/api/usage'); assert.equal((await next.json()).plan, 'pro');
  resolveFirst(fixture); assert.equal((await old).status, 409);
  assert.equal((await (await call('/api/usage')).json()).plan, 'pro');
});
