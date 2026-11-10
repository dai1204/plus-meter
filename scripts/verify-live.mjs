// Optional real-account check. No token values, browser traces, or auth copies are saved.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { requestUsage } from '../upstream.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const authPath = process.argv[2];
if (!authPath) throw new Error('Provide a local auth.json path as the first argument.');
let upstreamCalls = 0, browser, page, base;
const server = createServer({ fetchUsage: (auth, proxy) => { upstreamCalls++; return requestUsage(auth, proxy); } });
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  page = await browser.newPage({ viewport: { width: 1100, height: 1050 } });
  const browserErrors = []; page.on('pageerror', error => browserErrors.push(error.name));
  await page.goto(base);
  await page.locator('#proxy').fill(process.argv[3] || '');
  await page.locator('#interval').selectOption('30');
  const initialResponse = page.waitForResponse(response => response.url() === base + '/api/usage', { timeout: 35000 });
  await page.locator('#file').setInputFiles(authPath);
  const response = await initialResponse;
  if (!response.ok()) {
    const data = await response.json();
    console.log(JSON.stringify({ stage: 'live-query', status: response.status(), error: data.error }));
    process.exitCode = 1;
  } else {
    const data = await response.json();
    await page.getByText('已连接 · 额度已更新', { exact: true }).waitFor();
    console.log(JSON.stringify({ stage: 'import-and-query', passed: true, plan: data.plan, windows: data.windows, credits: data.credits }));
    assert.equal(await page.locator('.value').count(), data.windows.length);
    assert.equal(await page.evaluate(() => localStorage.length), 0);
    await mkdir(new URL('../screenshots/', import.meta.url), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL('../screenshots/live-account.png', import.meta.url)), fullPage: true });
    const automatic = await page.waitForResponse(r => r.url() === base + '/api/usage', { timeout: 55000 });
    assert.equal(automatic.status(), 200);
    assert.equal(upstreamCalls, 2);
    console.log(JSON.stringify({ stage: 'automatic-refresh-30s', passed: true, upstreamCalls }));
    await page.locator('#interval').selectOption('0');
    await new Promise(resolve => setTimeout(resolve, 16000));
    const manual = page.waitForResponse(r => r.url() === base + '/api/usage', { timeout: 35000 });
    await page.locator('#refresh').click();
    assert.equal((await manual).status(), 200);
    assert.equal(upstreamCalls, 3);
    assert.deepEqual(browserErrors, []);
    console.log(JSON.stringify({ stage: 'manual-refresh', passed: true, upstreamCalls, browserErrors: 0 }));
  }
} catch (error) {
  console.log(JSON.stringify({ stage: 'test-failed', error: error.name, message: error.message }));
  process.exitCode = 1;
} finally {
  if (page && !page.isClosed()) {
    try {
      await page.locator('#interval').selectOption('0');
      const status = await page.evaluate(async () => {
        const token = document.querySelector('meta[name="session-token"]').content;
        await fetch('/api/auth', { method: 'DELETE', headers: { 'X-Session-Token': token } });
        return (await fetch('/api/usage', { headers: { 'X-Session-Token': token } })).status;
      });
      assert.equal(status, 409);
      console.log(JSON.stringify({ stage: 'clear-credentials', passed: true }));
    } catch { console.log('Cleanup: closing the isolated process and browser to discard credentials.'); }
  }
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
