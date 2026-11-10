import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { createCredentialStore, dataDirectory } from '../storage.mjs';
import { createServer } from '../server.mjs';

test('default storage lives in the user profile, independent of virtualized AppData', () => {
  assert.equal(dataDirectory, join(homedir(), '.plus-meter'));
});

test('Windows encrypted storage survives reload and never stores a plaintext token', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'plus-meter-storage-'));
  const store = createCredentialStore(directory);
  try {
    const account = { auth: { tokens: { access_token: 'fake-persistent-test', refresh_token: 'fake-refresh' } }, proxy: 'http://127.0.0.1:7897' };
    await store.save(account);
    const encrypted = await readFile(store.path, 'utf8');
    assert.ok(!encrypted.includes('fake-persistent-test')); assert.ok(!encrypted.includes('fake-refresh'));
    assert.deepEqual(await createCredentialStore(directory).load(), account);
    await store.clear(); assert.equal(await store.load(), null);
  } finally { await store.clear(); await rmdir(directory); }
});

test('restored account state reveals no tokens; clear removes persisted account', async t => {
  let removed = 0;
  const server = createServer({ initialAccount: { auth: { access_token: 'fake-restored' }, proxy: 'http://127.0.0.1:7897' }, credentialStore: { clear: async () => removed++ }, fetchUsage: async () => ({ plan_type: 'plus', rate_limit: { primary_window: { used_percent: 5 } } }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(base)).text()).match(/name="session-token" content="([^"]+)"/)[1];
  const headers = { 'X-Session-Token': token };
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.deepEqual(state, { imported: true, proxy: 'http://127.0.0.1:7897', remembered: true, canRemember: true });
  assert.ok(!JSON.stringify(state).includes('fake-restored'));
  assert.equal((await fetch(base + '/api/usage', { headers })).status, 200);
  await fetch(base + '/api/auth', { headers, method: 'DELETE' }); assert.equal(removed, 1);
  assert.equal((await (await fetch(base + '/api/state', { headers })).json()).remembered, false);
});
