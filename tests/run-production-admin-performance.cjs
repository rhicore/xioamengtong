// 正式站只读浏览器测量。凭据仅从环境变量读取；不记录订单号、图片 URL 或 Cookie。
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function measureProductionAdmin() {
  const base = (process.env.ADMIN_PERF_BASE_URL || 'https://xiaomengtong.site').replace(/\/$/, '');
  const username = process.env.LOAD_TEST_ADMIN_USER;
  const password = process.env.LOAD_TEST_ADMIN_PASSWORD;
  if (!username || !password) throw new Error('Set LOAD_TEST_ADMIN_USER and LOAD_TEST_ADMIN_PASSWORD');
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const results = [];
  try {
    const login = await context.request.post(base + '/api/v1/admin/login', { data: { username, password } });
    assert.equal(login.status(), 200, 'production staff login failed');
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.addInitScript(() => {
      window.adminPerf = { starts: [], loads: [], longTasks: [] };
      const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', { ...source, set(value) {
        if (this.closest('.image-thumb-button')) window.adminPerf.starts.push({
          index: [...document.querySelectorAll('.image-thumb-button img')].indexOf(this),
          at: performance.now(), processed: value.includes('imageMogr2/thumbnail/')
        });
        source.set.call(this, value);
      } });
      document.addEventListener('load', event => {
        if (event.target.matches?.('.image-thumb-button img')) window.adminPerf.loads.push({
          at: performance.now(), width: event.target.naturalWidth, height: event.target.naturalHeight
        });
      }, true);
      new PerformanceObserver(list => window.adminPerf.longTasks.push(...list.getEntries().map(e => Math.round(e.duration))))
        .observe({ type: 'longtask', buffered: true });
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const active = new Set();
    let peak = 0;
    const imageResponses = [];
    page.on('request', request => {
      if (request.resourceType() === 'image') { active.add(request); peak = Math.max(peak, active.size); }
    });
    page.on('requestfinished', request => active.delete(request));
    page.on('requestfailed', request => active.delete(request));
    page.on('response', response => {
      if (response.request().resourceType() === 'image') imageResponses.push({ status: response.status(), processed: response.url().includes('imageMogr2/thumbnail/') });
    });
    const modes = process.env.ADMIN_PERF_MODES ? process.env.ADMIN_PERF_MODES.split(',') : ['cold', 'repeat', 'slow-network-cpu4'];
    assert.equal(modes[0], 'cold', 'the first scenario must load a fresh page');
    for (const mode of modes) {
      peak = 0;
      imageResponses.length = 0;
      if (mode === 'slow-network-cpu4') {
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.emulateNetworkConditions', {
          offline: false, latency: 80, downloadThroughput: 200000, uploadThroughput: 100000
        });
      }
      const started = performance.now();
      let browserStart = 0;
      if (mode === 'cold') await page.goto(base + '/admin/', { waitUntil: 'domcontentloaded' });
      else {
        const previousBody = await page.locator('tbody[data-order-id]').first().elementHandle();
        browserStart = await page.evaluate(() => { window.adminPerf = { starts: [], loads: [], longTasks: [] }; return performance.now(); });
        await page.getByRole('button', { name: '查询', exact: true }).click();
        // 等新查询替换表格；旧 tbody 尚在时不能算作新一轮已经加载完成。
        await page.waitForFunction(previous => !previous.isConnected, previousBody);
        await previousBody.dispose();
      }
      await page.locator('tbody[data-order-id]').first().waitFor();
      const listMs = Math.round(performance.now() - started);
      await page.waitForFunction(() => window.adminPerf.loads.length > 0);
      const firstImageMs = await page.evaluate(start => Math.round(window.adminPerf.loads[0].at - start), browserStart);
      await page.waitForFunction(() => [...document.querySelectorAll('.image-thumb-button img')].every(image => {
        const rect = image.getBoundingClientRect();
        return rect.bottom < 0 || rect.top > innerHeight || image.style.opacity === '1' || image.closest('button').title.includes('加载失败');
      }));
      const visibleImagesMs = Math.round(performance.now() - started);
      const snapshot = await page.evaluate(() => ({
        orders: document.querySelectorAll('tbody[data-order-id]').length,
        groups: document.querySelectorAll('tbody[data-order-id] tr').length,
        imageSlots: document.querySelectorAll('.image-thumb-button').length,
        failedImages: document.querySelectorAll('.image-thumb-button[title]').length,
        ...window.adminPerf
      }));
      const indices = [...new Set(snapshot.starts.map(item => item.index))];
      assert.deepEqual(indices, [...indices].sort((a, b) => a - b), 'live thumbnail starts were out of page order');
      assert.ok(snapshot.loads.length > 0, 'live visible images did not load');
      const inputStart = performance.now();
      await page.getByPlaceholder('搜索订单号').fill('只读响应测试');
      const inputMs = Math.round(performance.now() - inputStart);
      await page.getByPlaceholder('搜索订单号').fill('');
      const result = { mode, listMs, firstImageMs, visibleImagesMs, inputMs,
        orders: snapshot.orders, groups: snapshot.groups, imageSlots: snapshot.imageSlots,
        requestedImages: snapshot.starts.length, processedStarts: snapshot.starts.filter(s => s.processed).length,
        loadedImages: snapshot.loads.length, failedImages: snapshot.failedImages, peak,
        decodedWidths: [...new Set(snapshot.loads.map(s => s.width))], maxLongTaskMs: Math.max(0, ...snapshot.longTasks),
        imageHttpFailures: imageResponses.filter(r => r.status >= 400).length, topToBottom: true };
      results.push(result);
      console.log(JSON.stringify(result));
      // 连预取区也完成后再开始下一轮，避免把上轮加载回调计入下一轮。
      await page.waitForLoadState('networkidle');
    }
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const beforeScroll = await page.evaluate(() => window.adminPerf.starts.length);
    await page.locator('tbody[data-order-id]').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.image-thumb-button img')].every(image => {
      const rect = image.getBoundingClientRect();
      return rect.bottom < -160 || rect.top > innerHeight + 160 || image.style.opacity === '1' || image.closest('button').title.includes('加载失败');
    }));
    await page.waitForLoadState('networkidle');
    const afterScroll = await page.evaluate(() => window.adminPerf.starts.length);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const afterReturn = await page.evaluate(() => window.adminPerf.starts.length);
    assert.equal(afterReturn, afterScroll, 'returning to loaded rows restarted live image requests');
    console.log(JSON.stringify({ scrollLoads: afterScroll - beforeScroll, returnLoads: afterReturn - afterScroll }));
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let top = 0; top < height; top += 500) {
      await page.evaluate(y => window.scrollTo(0, y), top);
      await page.waitForFunction(() => [...document.querySelectorAll('.image-thumb-button img')].every(image => {
        const rect = image.getBoundingClientRect();
        return rect.bottom < 0 || rect.top > innerHeight || image.style.opacity === '1' || image.closest('button').title.includes('加载失败');
      }));
    }
    const fullPage = await page.locator('.image-thumb-button img').evaluateAll(images => ({
      imageSlots: images.length, loaded: images.filter(image => image.style.opacity === '1').length,
      failed: images.filter(image => image.closest('button').title.includes('加载失败')).length,
      decodedWidths: [...new Set(images.map(image => image.naturalWidth))]
    }));
    assert.equal(fullPage.loaded, fullPage.imageSlots, 'live full-page scroll left images unloaded');
    console.log(JSON.stringify({ fullPage }));
    await page.evaluate(() => window.scrollTo(0, 0));
    const first = page.locator('.image-thumb-button').first();
    await first.click();
    await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth > 0);
    const preview = await page.getByRole('dialog').locator('img').evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
    assert.ok(preview.width > 80, 'preview accidentally loaded thumbnail');
    console.log(JSON.stringify({ originalPreview: preview }));
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    return { scenarios: results, scrollLoads: afterScroll - beforeScroll, returnLoads: afterReturn - afterScroll, fullPage, originalPreview: preview };
  } finally {
    await context.request.post(base + '/api/v1/admin/logout').catch(() => {});
    await browser.close();
  }
}

module.exports = { measureProductionAdmin };
if (require.main === module) measureProductionAdmin().catch(() => {
  console.error('Production verification failed; inspect assertions locally without printing credentials or signed URLs.');
  process.exitCode = 1;
});
