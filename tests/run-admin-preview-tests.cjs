// 逐帧检查：图片头已返回、文件尚未加载完成时，预览框也不能被原图撑大。
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createDemoApp } = require('./local-demo.cjs');

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaomengtong-preview-'));
  const { app, store } = await createDemoApp({ dataDir });
  const order = await store.getOrderByOrderId('DEMO-001');
  let browser, streaming = false;
  const pending = [];
  const server = http.createServer(async (req, res) => {
    if (streaming && req.url.startsWith('/api/v1/admin/orders/DEMO-001/images/front')) {
      const group = req.url.includes('demo-one') ? order.groups[1] : order.groups[0];
      const body = await store.downloadFile(group.front_file_id);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': body.length, 'Cache-Control': 'private, max-age=300' });
      res.write(body.subarray(0, Math.floor(body.length / 2)));
      pending.push(() => res.end(body.subarray(Math.floor(body.length / 2))));
      return;
    }
    app(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    let page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    const wide = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1704;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#8da6a0'; ctx.fillRect(0, 0, 2400, 1704);
      ctx.fillStyle = '#d8e4ed'; ctx.fillRect(0, 0, 1200, 1704);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const uploaded = await store.uploadFile('preview/wide.png', Buffer.from(wide, 'base64'));
    order.groups[1].front_file_id = uploaded.fileID;
    await store.updateOrder(order._id, { groups: order.groups });
    let cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
    await page.getByRole('textbox', { name: '账号' }).fill('demo');
    await page.getByLabel('密码', { exact: true }).fill('demo123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('.image-thumb-button img')].length === 3
      && [...document.querySelectorAll('.image-thumb-button img')].every(image => image.naturalWidth > 0));
    const authState = await page.context().storageState();
    const freshPage = async viewport => {
      streaming = false;
      await page.context().close();
      const context = await browser.newContext({ storageState: authState, viewport });
      page = await context.newPage(); page.setDefaultTimeout(15000);
      cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
      await page.locator('.image-thumb-button').first().scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll('.image-thumb-button img')].length === 3
        && [...document.querySelectorAll('.image-thumb-button img')].every(image => image.naturalWidth > 0));
    };
    const button = group => page.getByRole('button', { name: `DEMO-001 第 ${group} 组 · 前图`, exact: true });
    const frames = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const startCapture = async () => page.evaluate(() => {
      window.previewFrames = [];
      window.capturePreview = true;
      const capture = () => {
        const dialog = document.querySelector('[role=dialog]');
        if (dialog) {
          const box = dialog.getBoundingClientRect(), image = dialog.querySelector('img').getBoundingClientRect();
          window.previewFrames.push({ width: box.width, height: box.height, x: box.x, y: box.y, imageWidth: image.width, imageHeight: image.height });
        }
        if (window.capturePreview) requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    });
    const assertStable = async viewport => {
      const samples = await page.evaluate(() => { window.capturePreview = false; return window.previewFrames; });
      assert.ok(samples.length >= 2, 'not enough rendered frames');
      for (const key of ['width', 'height']) assert.ok(Math.max(...samples.map(s => s[key])) - Math.min(...samples.map(s => s[key])) <= 1, `preview ${key} jumped while loading`);
      assert.ok(samples.every(s => s.x >= 0 && s.y >= 0 && s.x + s.width <= viewport.width + 1 && s.y + s.height <= viewport.height + 1), 'preview overflowed viewport');
      assert.ok(samples.every(s => s.imageWidth <= s.width && s.imageHeight <= s.height), 'image briefly used raw dimensions');
      return samples.length;
    };

    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      if (viewport.width !== 1440) await freshPage(viewport);
      await page.setViewportSize(viewport);
      for (const group of [1, 2]) {
        streaming = true;
        await startCapture();
        await button(group).click();
        await page.getByRole('status').filter({ hasText: '图片加载中' }).waitFor();
        await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth > 0);
        assert.equal(await page.getByRole('dialog').locator('img').evaluate(image => image.complete), false, 'fixture did not expose partial image');
        await frames();
        pending.shift()();
        await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.style.opacity === '1');
        await frames();
        const count = await assertStable(viewport);
        if (group === 1 && viewport.width === 1440 && process.env.ADMIN_PREVIEW_SCREENSHOT) await page.screenshot({ path: process.env.ADMIN_PREVIEW_SCREENSHOT });
        await page.getByRole('button', { name: '关闭', exact: true }).click();
        console.log(`PASS ${viewport.width}x${viewport.height} ${group === 1 ? 'portrait' : 'landscape'}: ${count} frames, constant preview bounds through partial/full load.`);
      }
    }
    // 缓存命中时仍保持同样的稳定布局。
    streaming = false;
    await page.setViewportSize({ width: 1440, height: 900 });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    for (let index = 0; index < 2; index++) {
      await startCapture(); await button(1).click();
      await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.style.opacity === '1');
      await frames(); await assertStable({ width: 1440, height: 900 });
      await page.getByRole('button', { name: '关闭', exact: true }).click();
    }
    // 关闭尚未加载的旧图后打开另一组，旧响应不能改变当前画面。
    await freshPage({ width: 1440, height: 900 });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    streaming = true;
    await button(1).click(); await frames();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await startCapture(); await button(2).click();
    await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth > 0);
    pending.shift()(); await frames();
    assert.match(await page.getByRole('dialog').locator('strong').textContent(), /第 2 组/);
    assert.equal(await page.getByRole('dialog').locator('img').evaluate(image => image.style.opacity), '0');
    pending.shift()();
    await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.style.opacity === '1');
    await frames(); await assertStable({ width: 1440, height: 900 });
    console.log('PASS cached reopen and closing/loading another group: no old-response resize or image replacement.');
  } finally {
    for (const release of pending) release();
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.basename(dataDir).startsWith('xiaomengtong-preview-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
