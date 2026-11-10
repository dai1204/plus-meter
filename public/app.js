const $ = id => document.getElementById(id);
const session = document.querySelector('meta[name="session-token"]').content;
const widget = new URLSearchParams(location.search).get('widget') === '1';
if (widget) { document.body.classList.add('widget'); document.title = 'Plus Meter 桌面小组件'; }
let imported = false, busy = false, epoch = 0, failures = 0, timer, latest = null, stopped = false;
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: { 'X-Session-Token': session, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(26000) });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '请求失败'); error.status = response.status; error.retryAfter = data.retryAfter; throw error; }
  return data;
}
function message(text, stale = false) {
  $('status').textContent = text;
  $('dot').className = 'dot' + (stale ? ' stale' : imported ? ' connected' : '');
}
function errorText(error) { return error.name === 'TimeoutError' ? '连接超时，请稍后刷新。' : error.message; }
function showError(error) { $('error').textContent = errorText(error); $('error').hidden = false; }
function schedule(delay) {
  clearTimeout(timer);
  const interval = Number($('interval').value);
  if (imported && interval && !stopped) timer = setTimeout(refresh, Math.max(interval, delay || 0) * 1000);
}
function element(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
function duration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '周期未提供';
  if (seconds % 86400 === 0) return `${seconds / 86400} 天周期`;
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时周期`;
  return `${Math.round(seconds / 60)} 分钟周期`;
}
function countdown(date) {
  if (!date) return '未提供';
  let seconds = Math.max(0, Math.ceil((date - Date.now()) / 1000));
  if (!seconds) return '已到重置时间，等待刷新';
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return `${days ? days + ' 天 ' : ''}${hours} 小时 ${minutes} 分`;
}
function render(data) {
  latest = data; $('cards').replaceChildren();
  $('plan').textContent = data.plan.toUpperCase();
  $('widget-plan').textContent = data.plan.toUpperCase() + ' · CODEX';
  for (const w of data.windows) {
    const card = element('article', null, 'panel');
    const top = element('div', null, 'card-top'); top.append(element('strong', `${w.group} · ${w.label}`), element('span', duration(w.seconds)));
    const value = element('div', Number(w.remaining.toFixed(1)), 'value' + (w.remaining <= 20 ? ' low' : '')); value.append(element('em', '%'));
    const progress = element('progress'); progress.max = 100; progress.value = w.remaining; progress.setAttribute('aria-label', `${w.group}${w.label}剩余百分比`);
    const reset = element('div', null, 'reset'); const countdownText = element('b', countdown(w.resetAt)); if (w.resetAt) countdownText.dataset.reset = w.resetAt;
    reset.append(element('span', '重置倒计时'), countdownText);
    card.append(top, value, element('div', w.blocked ? '接口报告已达到额度上限' : `剩余额度 · 已用 ${Number(w.used.toFixed(1))}%`, 'caption'), progress, reset, element('p', w.resetAt ? `重置于 ${new Date(w.resetAt).toLocaleString('zh-CN')}` : '接口未提供重置时间', 'date'));
    $('cards').append(card);
  }
  if (!data.windows.length) $('cards').append(element('div', '此账户暂未返回可显示的额度窗口。', 'panel empty'));
  if (data.credits) { const c = element('article', null, 'panel credit'); c.append(element('span', '额外 Credits'), element('strong', data.credits.unlimited ? '无限制' : data.credits.balance ?? '未提供')); $('cards').append(c); }
  $('updated').textContent = `上次成功更新 ${new Date(data.updatedAt).toLocaleTimeString('zh-CN')}`;
}
async function refresh() {
  if (!imported || busy) return;
  clearTimeout(timer); const version = epoch; busy = true; $('refresh').disabled = true; message('正在获取额度…');
  let delay = 0;
  try {
    const data = await api('/api/usage');
    if (version !== epoch) return;
    render(data); failures = 0; stopped = false; $('error').hidden = true; message('已连接 · 额度已更新');
  } catch (error) {
    if (version !== epoch) return;
    failures++; showError(error); message(latest ? '刷新失败 · 当前显示旧数据' : '暂时无法获取额度', true);
    delay = Math.max(error.retryAfter || 0, Math.min(300, 30 * 2 ** Math.min(failures - 1, 4)));
    if (error.status === 401 || error.status === 403) stopped = true;
  } finally {
    if (version === epoch) { busy = false; $('refresh').disabled = !imported; schedule(delay); }
  }
}
async function importFile(file) {
  if (!file) return;
  clearTimeout(timer); epoch++; busy = false; const version = epoch;
  $('refresh').disabled = true; $('clear').disabled = true; $('file').disabled = true;
  try {
    if (file.size > 128 * 1024) throw new Error('文件超过 128 KB，请选择 auth.json。');
    let auth; try { auth = JSON.parse((await file.text()).replace(/^\uFEFF/, '')); } catch { throw new Error('文件不是有效 JSON。'); }
    message('正在导入…');
    await api('/api/auth', 'POST', { auth, proxy: $('proxy').value.trim(), remember: $('remember').checked });
    if (version !== epoch) return;
    latest = null; $('updated').textContent = ''; $('cards').replaceChildren(element('div', '正在获取新账户额度…', 'panel empty'));
    imported = true; failures = 0; stopped = false; $('error').hidden = true; $('plan').textContent = '已导入';
    document.body.classList.add('has-account'); document.body.classList.remove('show-settings');
    await refresh();
  } catch (error) { showError(error); message(imported ? '导入失败 · 保留原账户' : '导入失败', true); schedule(); }
  finally { $('file').value = ''; $('file').disabled = false; $('clear').disabled = !imported; $('refresh').disabled = !imported || busy; }
}
$('file').addEventListener('change', event => importFile(event.target.files[0]));
$('refresh').addEventListener('click', () => { stopped = false; refresh(); });
$('interval').addEventListener('change', () => schedule());
$('clear').addEventListener('click', async () => {
  epoch++; clearTimeout(timer); busy = false;
  try { await api('/api/auth', 'DELETE'); imported = false; latest = null; stopped = false; document.body.classList.remove('has-account'); $('remember').checked = false; $('cards').replaceChildren(element('div', '账户已清除，请重新导入 auth.json。', 'panel empty')); $('plan').textContent = '等待导入'; $('updated').textContent = ''; $('error').hidden = true; message('尚未连接账户'); $('refresh').disabled = true; $('clear').disabled = true; }
  catch (error) { showError(error); schedule(); }
});
for (const name of ['dragenter', 'dragover']) $('drop').addEventListener(name, event => { event.preventDefault(); $('drop').classList.add('drag'); });
$('drop').addEventListener('dragleave', () => $('drop').classList.remove('drag'));
$('drop').addEventListener('drop', event => { event.preventDefault(); $('drop').classList.remove('drag'); if (!$('file').disabled) importFile(event.dataTransfer.files[0]); });
setInterval(() => { for (const e of document.querySelectorAll('[data-reset]')) e.textContent = countdown(Number(e.dataset.reset)); }, 1000);
$('settings').addEventListener('click', () => document.body.classList.toggle('show-settings'));
async function restoreAccount() {
  const version = epoch;
  try {
    const state = await api('/api/state');
    if (version !== epoch) return;
    $('remember').parentElement.hidden = !state.canRemember;
    $('remember').checked = !!state.remembered;
    $('proxy').value = state.proxy || '';
    if (state.imported) {
      imported = true; document.body.classList.add('has-account'); $('clear').disabled = false; $('refresh').disabled = false;
      await refresh();
    }
  } catch (error) { if (error.status !== 404) { showError(error); message('连接失败，请刷新页面', true); } }
}
restoreAccount();
