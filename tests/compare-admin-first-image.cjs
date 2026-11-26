// 相同正式 API、相同浏览器缓存条件，比较指定生产包；仅静态包来自本地构建。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function compareFirstImage(variants) {
  const base = 'https://xiaomengtong.site';
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  try {
    const loginContext = await browser.newContext();
    const login = await loginContext.request.post(base + '/api/v1/admin/login', { data: {
      username: process.env.LOAD_TEST_ADMIN_USER, password: process.env.LOAD_TEST_ADMIN_PASSWORD
    } });
    assert.equal(login.status(), 200);
    const state = await loginContext.storageState();
    for (let round = 0; round < Number(process.env.ADMIN_COMPARE_ROUNDS || 3); round++) {
      // 交替顺序，避免总让后测版本独享服务端预热收益。
      for (const variant of round % 2 ? [...variants].reverse() : variants) {
        const context = await browser.newContext({ storageState: state, viewport: { width: 1440, height: 900 } });
        try {
          const page = await context.newPage();
          const cdp = await context.newCDPSession(page);
          await cdp.send('Network.enable');
          await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
          await page.route(base + '/admin/**', route => {
            const pathname = new URL(route.request().url()).pathname;
            const relative = pathname === '/admin/' ? 'index.html' : pathname.slice('/admin/'.length);
            const file = path.join(variant.dist, relative);
            if (!file.startsWith(variant.dist + path.sep) || !fs.existsSync(file)) return route.abort();
            return route.fulfill({ path: file, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
          });
          await page.addInitScript(() => {
            window.firstImage = null;
            document.addEventListener('load', event => {
              if (!window.firstImage && event.target.matches?.('.image-thumb-button img')) {
                window.firstImage = { at: performance.now(), width: event.target.naturalWidth };
              }
            }, true);
          });
          const events = [];
          const phase = request => {
            const url = new URL(request.url());
            if (url.pathname === '/api/v1/admin/me') return 'session';
            if (url.pathname === '/api/v1/admin/orders') return 'list';
            if (url.pathname === '/api/v1/admin/order-previews') return 'preview-links';
            if (request.resourceType() === 'image') return url.search.includes('imageMogr2') ? 'thumbnail' : 'original';
          };
          const started = performance.now();
          page.on('request', request => {
            const name = phase(request);
            if (name) events.push({ phase: name, event: 'start', at: Math.round(performance.now() - started), request });
          });
          page.on('requestfinished', request => {
            const name = phase(request);
            if (name) events.push({ phase: name, event: 'end', at: Math.round(performance.now() - started), request });
          });
          await page.goto(base + '/admin/', { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.firstImage !== null, null, { timeout: 60000 });
          const image = await page.evaluate(() => window.firstImage);
          const summary = { version: variant.name, round: round + 1, firstImageMs: Math.round(image.at), width: image.width,
            timeline: ['session', 'list', 'preview-links', 'thumbnail', 'original'].map(name => ({
              phase: name, start: events.find(e => e.phase === name && e.event === 'start')?.at,
              end: events.find(e => e.phase === name && e.event === 'end')?.at
            })) };
          results.push(summary);
          console.log(JSON.stringify(summary));
        } finally { await context.close(); }
      }
    }
    await loginContext.request.post(base + '/api/v1/admin/logout');
    await loginContext.close();
    return results;
  } finally { await browser.close(); }
}
module.exports = { compareFirstImage };
