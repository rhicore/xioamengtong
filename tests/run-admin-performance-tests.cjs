// 使用真实生产构建与独立 HTTP 图片夹具，测慢网下的请求顺序、并发和交互响应。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const baseline = process.env.ADMIN_PERF_BASELINE === '1';
const dist = path.resolve(__dirname, '../admin_web/dist');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  let browser;
  const requests = [];
  let active = 0, peak = 0, previewCalls = 0, heldPreview;
  let previewAbortCount = 0;
  const orders = Array.from({ length: 20 }, (_, o) => ({
    order_id: `PERF-${o}`, notebook_type: 'jiaotao', display_name: '胶套本', status: 'submitted',
    groups: Array.from({ length: 10 }, (_, g) => ({
      id: `g-${g}`, notebook_type: 'jiaotao', display_name: '胶套本', quantity: g + 1,
      ...Object.fromEntries(['front', 'back'].flatMap((side, s) => {
        const id = o * 20 + g * 2 + s;
        return [[side + '_file_id', `cloud://fixture/${id}.jpg`], [side + '_download_url', `/fixture/proxy/${id}.jpg`]];
      }))
    }))
  }));
  let original, thumbnail;
  const serveImage = async (id, variant, respond) => {
    requests.push({ id, variant });
    peak = Math.max(peak, ++active);
    try {
      await sleep(id === 0 ? 800 : 120);
      // 两种失败：缩略处理不支持；云链接失效后回到有权限的原图接口。
      const failed = (id === 2 && variant === 'thumb') || (id === 3 && variant !== 'proxy');
      respond(failed ? 404 : 200, failed ? Buffer.from('image unavailable') : variant === 'thumb' ? thumbnail : original);
    } finally { active--; }
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ code: 200, data })); };
    if (url.pathname === '/api/v1/admin/me') return json({ username: 'fixture', role: 'operator' });
    if (url.pathname === '/api/v1/admin/orders') return json({ items: orders, total: 40, notebook_types: [] });
    if (url.pathname === '/api/v1/admin/order-previews') {
      let body = ''; for await (const chunk of req) body += chunk;
      const ids = JSON.parse(body).orderIds;
      previewCalls++;
      if (heldPreview) {
        const held = heldPreview;
        heldPreview = null;
        held.started();
        res.on('close', () => { if (!res.writableEnded) previewAbortCount++; });
        await held.release;
        if (res.destroyed) return;
      }
      await sleep(60);
      return json(Object.fromEntries(ids.map(id => {
        const order = orders.find(o => o.order_id === id);
        return [id, { groups: order.groups.map(group => ({ ...group,
          front_url: `https://fixture.tcb.qcloud.la/${group.front_download_url.split('/').pop()}?sign=fixture`,
          back_url: `https://fixture.tcb.qcloud.la/${group.back_download_url.split('/').pop()}?sign=fixture`
        })) }];
      })));
    }
    if (url.pathname.startsWith('/fixture/proxy/')) return serveImage(Number(path.basename(url.pathname, '.jpg')), 'proxy', (status, body) => {
      res.writeHead(status, { 'Content-Type': 'image/jpeg' }); res.end(body);
    });
    const file = path.join(dist, url.pathname === '/admin/' ? 'index.html' : url.pathname.replace(/^\/admin\//, ''));
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: Number(process.env.ADMIN_PERF_WIDTH) || 1440, height: 900 } });
    // 同一张 1704×2400 测试照片和真实缩小后的 80px 图片，不接触顾客图片。
    const images = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1704; canvas.height = 2400;
      const context = canvas.getContext('2d'); const image = context.createImageData(canvas.width, canvas.height);
      let seed = 12345;
      for (let i = 0; i < image.data.length; i += 4) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        image.data[i] = seed & 255; image.data[i + 1] = (seed >>> 8) & 255; image.data[i + 2] = (seed >>> 16) & 255; image.data[i + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      const original = canvas.toDataURL('image/jpeg', .8).split(',')[1];
      const small = document.createElement('canvas'); small.width = 80; small.height = 113;
      small.getContext('2d').drawImage(canvas, 0, 0, 80, 113);
      return { original, thumbnail: small.toDataURL('image/jpeg', .8).split(',')[1] };
    });
    original = Buffer.from(images.original, 'base64'); thumbnail = Buffer.from(images.thumbnail, 'base64');
    await page.route('https://fixture.tcb.qcloud.la/**', route => {
      const url = new URL(route.request().url());
      return serveImage(Number(path.basename(url.pathname, '.jpg')), url.search.includes('imageMogr2') ? 'thumb' : 'direct',
        (status, body) => route.fulfill({ status, contentType: 'image/jpeg', body }).catch(() => {}));
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.addInitScript(() => {
      window.perfSample = { longTasks: [], maxTickGap: 0, imageStarts: [] };
      const source = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        ...source,
        set(value) {
          const match = /\/(\d+)\.jpg/.exec(value);
          if (match) window.perfSample.imageStarts.push(Number(match[1]));
          source.set.call(this, value);
        }
      });
      new PerformanceObserver(list => window.perfSample.longTasks.push(...list.getEntries().map(e => Math.round(e.duration)))).observe({ type: 'longtask', buffered: true });
      let previous = performance.now();
      setInterval(() => { const now = performance.now(); window.perfSample.maxTickGap = Math.max(window.perfSample.maxTickGap, now - previous); previous = now; }, 20);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
    await page.locator('tbody[data-order-id]').first().waitFor();
    await sleep(1800);
    const initialRequests = requests.length;
    const sample = await page.evaluate(() => window.perfSample);
    const started = performance.now();
    await page.getByPlaceholder('搜索订单号').fill('输入响应测试');
    const interactionMs = Math.round(performance.now() - started);
    console.log(JSON.stringify({ mode: baseline ? 'baseline' : 'optimized', images: 400, initialRequests, peak, interactionMs, originalBytes: original.length, thumbnailBytes: thumbnail.length, longTasks: sample.longTasks, maxTickGap: sample.maxTickGap }));
    if (baseline) return;
    assert.ok(peak <= 3, `thumbnail concurrency was ${peak}`);
    assert.ok(initialRequests < 50, `offscreen thumbnails were eagerly loaded: ${initialRequests}`);
    // 浏览器网络层可交换同批请求的抵达顺序；检查真实 img.src 的启动顺序。
    const firstStarts = [...new Set(sample.imageStarts)];
    assert.deepEqual(firstStarts, [...firstStarts].sort((a, b) => a - b), 'initial thumbnails did not start top to bottom');
    assert.ok(requests.some(r => r.id === 2 && r.variant === 'direct'), 'thumbnail failure did not use original: ' + JSON.stringify(requests));
    assert.ok(requests.some(r => r.id === 3 && r.variant === 'proxy'), 'expired cloud link did not use authenticated original');
    assert.ok(interactionMs < 500, `input stalled for ${interactionMs}ms`);
    assert.ok(Math.max(0, ...sample.longTasks) < 250, 'a front-end task blocked the page for 250ms');
    if (process.env.ADMIN_PERF_SCREENSHOT) await page.screenshot({ path: process.env.ADMIN_PERF_SCREENSHOT });
    const firstButton = page.getByRole('button', { name: 'PERF-0 第 1 组 · 前图', exact: true });
    await firstButton.click();
    await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth === 1704);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('tbody').last().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('tbody:last-of-type img')].some(img => img.naturalWidth > 0));
    assert.ok(requests.some(r => r.id >= 380), 'bottom rows did not load on scroll');
    assert.ok(!requests.some(r => r.id > 60 && r.id < 360), 'skipped offscreen rows should remain unloaded');
    await page.getByRole('columnheader').first().locator('input').check();
    assert.equal(await page.getByRole('button', { name: '批量下载 (20)', exact: true }).count(), 1);
    if (process.env.ADMIN_PERF_SWEEP === '1') {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 500) {
        await page.evaluate(top => window.scrollTo(0, top), y);
        await page.waitForFunction(() => [...document.querySelectorAll('.image-thumb-button img')].every(image => {
          const rect = image.getBoundingClientRect();
          return rect.bottom < 0 || rect.top > innerHeight || (image.naturalWidth > 0 && image.style.opacity === '1');
        }));
      }
      assert.equal(await page.locator('.image-thumb-button img').evaluateAll(images => images.filter(image => image.naturalWidth > 0).length), 400);
      const beforeReturn = requests.length;
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(200);
      assert.equal(requests.length, beforeReturn, 'returning to loaded rows downloaded images again');
      console.log(`PASS: continuous full-page scroll loaded all 400 images, ${requests.length} total image requests including fallback/preview, and returning to the top caused no re-downloads.`);
    }
    // 刷新中再次查询：旧预览 HTTP 请求应中止，后续批次不能继续占用连接。
    let release;
    const startedPreview = new Promise(started => {
      heldPreview = { started, release: new Promise(resolve => { release = resolve; }) };
    });
    await page.getByPlaceholder('搜索订单号').fill('');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await startedPreview;
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await sleep(500);
    release();
    assert.ok(previewAbortCount > 0, 'superseded preview HTTP request was not aborted');
    assert.ok(previewCalls <= 16, 'obsolete query kept fetching preview batches');
    console.log('PASS: top-to-bottom starts, bounded concurrency, viewport loading, fallbacks, original preview, responsive input, scrolling, order selection and request cancellation.');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
