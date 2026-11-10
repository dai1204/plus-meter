// Optional development check; Playwright is not a runtime dependency.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
let fail = false;
const server = createServer({ fetchUsage: async () => {
  if (fail) { const error = new Error('测试网络故障'); error.status = 403; throw error; }
  return { plan_type: 'plus', rate_limit: { primary_window: { used_percent: 37, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 10000 }, secondary_window: { used_percent: 81, limit_window_seconds: 604800, reset_after_seconds: 80000 } }, additional_rate_limits: [{ limit_name: '<script>alert(1)</script>', rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 86400 } } }], credits: { balance: '2.5' } };
} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1200 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  assert.equal(await page.locator('#refresh').isDisabled(), true);
  await page.locator('#file').setInputFiles({ name: 'auth.json', mimeType: 'application/json', buffer: Buffer.from('{bad-json') });
  await page.getByText('文件不是有效 JSON。', { exact: true }).waitFor();
  await page.locator('#file').setInputFiles({ name: 'auth.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ OPENAI_API_KEY: 'fake-only' })) });
  await page.getByText(/这是 API Key 配置/).waitFor();
  const fake = { name: 'auth.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ tokens: { access_token: 'fake-ui-only' } })) };
  await page.locator('#file').setInputFiles(fake);
  await page.getByText('已连接 · 额度已更新', { exact: true }).waitFor();
  assert.equal(await page.locator('.value').first().textContent(), '63%');
  assert.equal(await page.locator('#cards script').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await mkdir(new URL('../screenshots/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../screenshots/desktop-demo.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: new URL('../screenshots/mobile-demo.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  fail = true;
  // Reimport to invalidate server cache, then verify stale data after another cached response expires.
  await page.clock.install();
  await page.clock.fastForward(61000);
  // Browser clock does not advance the server clock; reset backend auth without changing displayed cards.
  await page.evaluate(async () => {
    await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': document.querySelector('meta[name="session-token"]').content }, body: JSON.stringify({ auth: { access_token: 'fake-ui-only' } }) });
  });
  await page.locator('#refresh').click();
  await page.getByText('刷新失败 · 当前显示旧数据', { exact: true }).waitFor();
  assert.equal(await page.locator('.value').first().textContent(), '63%');
  await page.locator('#clear').click();
  await page.getByText('账户已清除，请重新导入 auth.json。', { exact: true }).waitFor();
  assert.equal(await page.locator('#refresh').isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: invalid import, API-key rejection, valid import, rendering, no persistent credentials, mobile layout, stale data, clear.');
} finally {
  await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
