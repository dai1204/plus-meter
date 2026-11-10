import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

// Only this fixed OpenAI endpoint receives the bearer token. Never follow redirects.
const target = new URL('https://chatgpt.com/backend-api/wham/usage');
export function requestUsage(auth, proxy = '') {
  return new Promise((resolve, reject) => {
    let finished = false, tunnel, request, socket;
    const timer = setTimeout(() => finish(new Error('连接超时，请检查网络或本地代理。')), 20000);
    function finish(error, result) {
      if (finished) return;
      finished = true; clearTimeout(timer);
      request?.destroy(); socket?.destroy(); tunnel?.destroy();
      if (error) reject(error); else resolve(result);
    }
    function send(connection) {
      const headers = { Authorization: `Bearer ${auth.accessToken}`, Accept: 'application/json', 'User-Agent': 'PlusMeter/1.0' };
      if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
      const agent = connection ? new https.Agent({ keepAlive: false }) : undefined;
      if (agent) agent.createConnection = () => connection;
      request = https.get(target, { headers, agent }, response => {
        const status = response.statusCode;
        if (status !== 200) {
          response.resume();
          const messages = { 401: '登录凭据已失效，请通过 Codex 重新登录并导入新的 auth.json。', 403: '访问被拒绝，请检查账户权限、所在地区或网络代理。', 429: '查询过于频繁，请稍后刷新。' };
          const error = new Error(messages[status] || `额度接口暂不可用（HTTP ${status}）。`);
          error.status = status;
          const delay = Number(response.headers['retry-after']);
          error.retryAfter = Number.isFinite(delay) && delay > 0 ? Math.min(delay, 3600) : null;
          return finish(error);
        }
        let size = 0; const chunks = [];
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 1024 * 1024) return finish(new Error('接口响应过大。'));
          chunks.push(chunk);
        });
        response.on('end', () => {
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(new Error('接口未返回 JSON，可能遭遇网络拦截。')); }
        });
        response.on('error', () => finish(new Error('额度响应中断，请重试。')));
      });
      request.on('error', () => finish(new Error('无法连接 OpenAI，请检查网络或本地 HTTP 代理。')));
    }
    if (!proxy) return send();
    const p = new URL(proxy);
    tunnel = http.request({ hostname: p.hostname.replace(/^\[|\]$/g, ''), port: p.port || 80, method: 'CONNECT', path: `${target.hostname}:443`, headers: { Host: `${target.hostname}:443` } });
    tunnel.on('connect', (res, connection, head) => {
      socket = connection;
      if (finished) { connection.destroy(); return; }
      if (res.statusCode !== 200) return finish(new Error('本地代理拒绝连接，请检查代理设置。'));
      if (head.length) connection.unshift(head);
      socket = tls.connect({ socket: connection, servername: target.hostname, rejectUnauthorized: true });
      socket.on('error', () => finish(new Error('TLS 连接失败，请检查代理或证书。')));
      socket.once('secureConnect', () => { if (!finished) send(socket); });
    });
    tunnel.on('error', () => finish(new Error('无法连接本地代理，请确认代理已启动。')));
    tunnel.end();
  });
}
