import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseAuth, normalizeUsage, validateProxy } from './core.mjs';
import { requestUsage } from './upstream.mjs';
import { createCredentialStore } from './storage.mjs';

export function createServer({ fetchUsage = requestUsage, initialAccount = null, credentialStore = null } = {}) {
  const nonce = randomBytes(32).toString('hex');
  let auth = null, proxy = '', snapshot = null, generation = 0, pending = null, lastQuery = 0, blockedUntil = 0;
  let remembered = !!initialAccount;
  if (initialAccount) { auth = parseAuth(initialAccount.auth); proxy = validateProxy(initialAccount.proxy); }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const host = `127.0.0.1:${server.address().port}`;
    const origin = `http://${host}`;
    function json(status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: '仅允许本机页面访问。' });
    try {
      const path = new URL(req.url, origin).pathname;
      if (path.startsWith('/api/')) {
        if (req.headers['x-session-token'] !== nonce) return json(403, { error: '页面会话已失效，请重新打开页面。' });
        if (path === '/api/state' && req.method === 'GET') return json(200, { imported: !!auth, proxy, remembered, canRemember: !!credentialStore });
        if (path === '/api/auth' && req.method === 'POST') {
          if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(415, { error: '需要 JSON 格式。' });
          const body = await readJson(req);
          let next, nextProxy;
          try { next = parseAuth(body.auth); nextProxy = validateProxy(body.proxy); }
          catch (error) { return json(400, { error: error.message }); }
          if (body.remember && !credentialStore) return json(400, { error: '当前服务不支持加密保存，请从 Windows 启动脚本打开。' });
          if (credentialStore) {
            if (body.remember) await credentialStore.save({ auth: body.auth, proxy: nextProxy });
            else await credentialStore.clear();
          }
          generation++; auth = next; proxy = nextProxy; snapshot = null; pending = null; lastQuery = 0; blockedUntil = 0;
          remembered = !!body.remember;
          return json(200, { imported: true, expiresAt: auth.expiresAt });
        }
        if (path === '/api/auth' && req.method === 'DELETE') {
          if (credentialStore) await credentialStore.clear();
          generation++; auth = null; proxy = ''; snapshot = null; pending = null; lastQuery = 0; blockedUntil = 0;
          remembered = false;
          return json(200, { imported: false });
        }
        if (path === '/api/usage' && req.method === 'GET') {
          if (!auth) return json(409, { error: '请先导入 auth.json。' });
          if (auth.expiresAt && auth.expiresAt <= Date.now()) return json(401, { error: 'access_token 已过期，请重新登录 Codex 并导入最新 auth.json。' });
          if (Date.now() < blockedUntil) return json(429, { error: '请等待后再查询。', retryAfter: Math.ceil((blockedUntil - Date.now()) / 1000) });
          if (snapshot && Date.now() - lastQuery < 15000) return json(200, snapshot);
          const version = generation;
          if (!pending) {
            lastQuery = Date.now();
            pending = fetchUsage(auth, proxy).then(normalizeUsage);
          }
          const current = pending;
          try {
            const result = await current;
            if (version !== generation) return json(409, { error: '账户已切换，请重新刷新。' });
            snapshot = result;
            return json(200, result);
          } catch (error) {
            if (version !== generation) return json(409, { error: '账户已切换，请重新刷新。' });
            if (error.status === 429) blockedUntil = Date.now() + (error.retryAfter || 60) * 1000;
            else blockedUntil = Date.now() + 15000;
            return json([401,403,429].includes(error.status) ? error.status : 502, { error: error.message, retryAfter: error.retryAfter });
          } finally { if (version === generation && pending === current) pending = null; }
        }
        return json(404, { error: '接口不存在。' });
      }
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method !== 'GET' || !files[path]) return json(404, { error: '页面不存在。' });
      const [name, type] = files[path];
      let content = await readFile(new URL(`./public/${name}`, import.meta.url), 'utf8');
      if (path === '/') content = content.replace('__SESSION__', nonce);
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(content);
    } catch (error) { json(400, { error: error.safe ? error.message : '导入失败，请检查 JSON、凭据格式和代理地址。' }); }
  });
  server.requestTimeout = 30000;
  return server;
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error('too large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object') throw new Error();
    return body;
  } catch { throw new Error('invalid json'); }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export async function startServer(port = 18765, options = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PLUS_METER_PORT 必须是 0 至 65535 的整数。');
  const server = createServer(options);
  try { await listen(server, port); }
  catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const url = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (response.ok && (response.headers.get('content-type') || '').startsWith('text/html')) {
        const reader = response.body.getReader();
        const first = await reader.read(); await reader.cancel();
        const text = Buffer.from(first.value || []).toString('utf8');
        if (text.includes('<title>Plus Meter · 额度看板</title>') && /name="session-token" content="[a-f0-9]{64}"/.test(text)) {
          return { server: null, url, reused: true };
        }
      }
    } catch { /* An unrelated service must never be opened as the meter. */ }
    await listen(server, 0);
  }
  return { server, url: `http://127.0.0.1:${server.address().port}`, reused: false };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const credentialStore = process.platform === 'win32' ? createCredentialStore() : null;
    const initialAccount = credentialStore ? await credentialStore.load() : null;
    const { url, reused } = await startServer(Number(process.env.PLUS_METER_PORT || 18765), { credentialStore, initialAccount });
    console.log(reused ? `Plus Meter 已在运行，打开现有页面：${url}` : `Plus Meter 已启动：${url}\n已保存的账户和代理会自动加载。`);
    if (process.argv.includes('--open') && process.platform === 'win32') {
      const opener = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process '${url}'`], { windowsHide: true, stdio: 'ignore' });
      opener.on('error', () => console.log('请手动打开上面的本地地址。'));
    }
  } catch (error) { console.error(`服务启动失败：${error.message}`); process.exitCode = 1; }
}
