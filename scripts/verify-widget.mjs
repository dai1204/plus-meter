import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const base = process.argv[2] || 'http://127.0.0.1:18766';
try {
  const page = await browser.newPage({ viewport: { width: 350, height: 600 } });
  const errors = []; page.on('pageerror', e => errors.push(e.name));
  const usage = page.waitForResponse(r => r.url().endsWith('/api/usage'), { timeout: 35000 });
  await page.goto(base + '/?widget=1');
  const response = await usage;
  const data = await response.json();
  if (!response.ok()) throw new Error(data.error);
  await page.getByText('已连接 · 额度已更新', { exact: true }).waitFor();
  assert.equal(await page.title(), 'Plus Meter 桌面小组件');
  assert.equal(await page.locator('.import-panel').isVisible(), false);
  assert.equal(await page.locator('#remember').isChecked(), true);
  assert.equal(await page.locator('#proxy').inputValue(), 'http://127.0.0.1:7897');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.screenshot({ path: fileURLToPath(new URL('../screenshots/widget-live.png', import.meta.url)), fullPage: true });
  await page.locator('#settings').click(); assert.equal(await page.locator('.import-panel').isVisible(), true);
  await page.locator('#settings').click(); assert.equal(await page.locator('.import-panel').isVisible(), false);
  await page.reload(); await page.getByText('已连接 · 额度已更新', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ autoLoad: true, savedProxy: true, reload: true, compactLayout: true, settings: true, plan: data.plan, windows: data.windows.map(w => ({ label: w.label, remaining: w.remaining })) }));
} finally { await browser.close(); }
