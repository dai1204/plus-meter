export function decodeClaims(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
  catch { return {}; }
}

export function parseAuth(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('auth.json 必须是 JSON 对象。');
  const tokens = input.tokens && typeof input.tokens === 'object' ? input.tokens : input;
  const accessToken = tokens.access_token;
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error(input.OPENAI_API_KEY ? '这是 API Key 配置，无法查询订阅额度。请导入 ChatGPT 登录生成的 auth.json。' : '缺少 access_token，请导入 Codex 登录生成的 auth.json。');
  }
  if (accessToken.length > 30000 || /\s/.test(accessToken)) throw new Error('access_token 格式无效。');
  const claims = decodeClaims(accessToken);
  const accountId = tokens.account_id || input.account_id || claims['https://api.openai.com/auth']?.chatgpt_account_id;
  if (accountId != null && (typeof accountId !== 'string' || !/^[\w-]{1,200}$/.test(accountId))) throw new Error('account_id 格式无效。');
  // JWT claims are hints, not proof of identity. The upstream validates the token.
  return { accessToken, accountId: accountId || null, expiresAt: Number.isFinite(claims.exp) ? claims.exp * 1000 : null };
}

export function normalizeUsage(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('额度接口返回格式已变化。');
  const windows = [];
  function add(limit, group) {
    for (const [key, label] of [['primary_window', '短周期'], ['secondary_window', '长周期']]) {
      const w = limit?.[key];
      if (!w || typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent)) continue;
      const seconds = typeof w.limit_window_seconds === 'number' ? w.limit_window_seconds : null;
      const resetAt = typeof w.reset_at === 'number' && w.reset_at > 0 ? w.reset_at * 1000 :
        typeof w.reset_after_seconds === 'number' ? now + w.reset_after_seconds * 1000 : null;
      const used = Math.max(0, Math.min(100, w.used_percent));
      windows.push({ group, label, used, remaining: 100 - used, seconds, resetAt, blocked: limit.limit_reached === true || limit.allowed === false });
    }
  }
  add(payload.rate_limit, 'Codex');
  add(payload.code_review_rate_limit, '代码审查');
  for (const item of Array.isArray(payload.additional_rate_limits) ? payload.additional_rate_limits : []) {
    add(item.rate_limit, typeof item.limit_name === 'string' ? item.limit_name.slice(0, 100) : '额外额度');
  }
  if (!windows.length && !payload.credits && !payload.plan_type) throw new Error('额度接口返回格式已变化，未找到可显示的数据。');
  const c = payload.credits;
  return {
    plan: typeof payload.plan_type === 'string' ? payload.plan_type.slice(0, 100) : '未知',
    windows, credits: c ? { unlimited: c.unlimited === true, balance: typeof c.balance === 'string' || typeof c.balance === 'number' ? String(c.balance).slice(0, 100) : null } : null,
    updatedAt: now,
  };
}

export function validateProxy(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('代理格式应为 http://127.0.0.1:端口。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('仅支持本机 HTTP 代理，例如 http://127.0.0.1:7897。');
  }
  return url.origin;
}
