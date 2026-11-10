const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { unzipSync } = require('../admin_web/node_modules/fflate');
const { createDemoApp, demoCover } = require('./local-demo.cjs');

async function run() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaomengtong-browser-'));
  const { app, store } = await createDemoApp({ dataDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (/passive event listener/i.test(message.text())) pageErrors.push(message.text()); });
    async function openOrder(id) {
      await page.goto(base);
      await page.getByRole('textbox', { name: '订单号' }).fill(id);
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByRole('heading', { name: '上传定制图片' }).waitFor();
    }
    async function previewSize() {
      return page.locator('.image-preview img').first().evaluate(async image => {
        await image.decode(); return [image.naturalWidth, image.naturalHeight];
      });
    }
    async function editorReady() {
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: '完成', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.editor-done')?.disabled);
    }
    async function addImage(index, buffer = demoCover(0)) {
      await page.locator('.image-picker').nth(index).locator('input').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer });
      await editorReady();
    }
    async function finishCrop() {
      await page.getByRole('button', { name: '完成', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(await previewSize(), [1704, 2400]);
    }
    await openOrder('BROWSER-MULTI');
    await page.waitForFunction(() => [...document.querySelectorAll('.template-visual-image')].every(img => img.complete && img.naturalWidth > 0));
    await page.getByRole('button', { name: /胶套本（两图）/ }).click();
    await page.locator('.group-quantity input').fill('3');
    const fixture = Buffer.from(await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 1704; canvas.height = 2400;
      const ctx = canvas.getContext('2d');
      ['#ec735d', '#5c9db1', '#e9c565', '#82ad83'].forEach((color, index) => { ctx.fillStyle = color; ctx.fillRect(index % 2 * 852, Math.floor(index / 2) * 1200, 852, 1200); });
      return canvas.toDataURL('image/png').split(',')[1];
    }), 'base64');
    await addImage(0, fixture);
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.waitForFunction(({ width, height }) => {
        const dialog = document.querySelector('.image-editor').getBoundingClientRect();
        const frame = document.querySelector('.editor-crop-frame').getBoundingClientRect();
        return Math.abs(dialog.width - width) < 1 && Math.abs(dialog.height - height) < 1 && frame.width > 20 && frame.bottom < height && Math.abs(frame.width / frame.height - 1704 / 2400) < .002;
      }, viewport);
    }
    const cdp = await context.newCDPSession(page);
    const stage = await page.locator('.editor-stage').boundingBox();
    const cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2;
    const touch = (id, x, y) => ({ id, x, y, radiusX: 6, radiusY: 6, force: 1 });
    const transform = () => page.locator('.editor-media').evaluate(image => image.style.transform);
    const start = [touch(1, cx - 55, cy), touch(2, cx + 55, cy)];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: start });
    const end = [touch(1, cx + 15 - 75, cy - 15 - 43.3), touch(2, cx + 15 + 75, cy - 15 + 43.3)];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: end });
    await page.waitForFunction(() => parseFloat(document.querySelector('[aria-label="图片缩放"]').value) > 1.5);
    assert.match(await transform(), /rotate\(29\./);
    const beforeThird = await transform();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...end, touch(3, cx, cy + 130)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...end, touch(3, cx + 20, cy + 150)] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    assert.equal(await transform(), beforeThird, 'adding or moving a third finger must not jump');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => !document.querySelector('.editor-stage.interacting'));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, cx, cy)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, cx + 15, cy + 15)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const frame = await page.locator('.editor-crop-frame').boundingBox();
    const screenshot = await page.screenshot({ clip: frame });
    await finishCrop();
    // 对比裁切框截图与导出的 JPEG，避免预览和实际打印位置不一致。
    const difference = await page.evaluate(async screenshot => {
      const preview = document.querySelector('.image-preview img'); await preview.decode();
      const reference = new Image(); reference.src = 'data:image/png;base64,' + screenshot; await reference.decode();
      const contexts = [reference, preview].map(image => {
        const canvas = document.createElement('canvas'); canvas.width = 80; canvas.height = 112;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0, 80, 112); return ctx;
      });
      let delta = 0, count = 0;
      for (let y = 12; y < 101; y += 11) for (let x = 10; x < 72; x += 10) {
        const colors = contexts.map(ctx => ctx.getImageData(x, y, 1, 1).data);
        for (let i = 0; i < 3; i++) { delta += Math.abs(colors[0][i] - colors[1][i]); count++; }
      }
      return delta / count;
    }, screenshot.toString('base64'));
    assert.ok(difference < 8, 'crop preview and export differ: ' + difference);
    const originalPreview = await page.locator('.image-preview img').first().getAttribute('src');
    await page.locator('.image-preview.has-image').first().click();
    await editorReady();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.locator('.image-preview img').first().getAttribute('src'), originalPreview);
    assert.deepEqual(await previewSize(), [1704, 2400]);
    assert.equal(await page.evaluate(() => document.body.style.position), '');
    console.log('crop viewport, touch gestures, preview/export comparison and cancel passed');
    // Crop extreme aspect ratios at the minimum zoom and drag limits. An opaque,
    // solid-color source makes every added white/black edge detectable in JPEG.
    for (const [width, height, angle] of [[240, 3600, 0], [4000, 240, 0], [3600, 240, 90], [240, 3600, 37]]) {
      await page.locator('.image-preview.has-image').first().click(); await editorReady();
      const buffer = Buffer.from(await page.evaluate(([width, height]) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#367fba'; ctx.fillRect(0, 0, width, height);
        return canvas.toDataURL('image/png').split(',')[1];
      }, [width, height]), 'base64');
      await page.getByLabel('更换裁切图片').setInputFiles({ name: 'extreme.png', mimeType: 'image/png', buffer });
      await page.waitForFunction(([width, height]) => {
        const image = document.querySelector('.editor-media');
        return image?.naturalWidth === width && image.naturalHeight === height;
      }, [width, height]);
      await editorReady();
      if (angle === 90) await page.getByRole('button', { name: '旋转 90°', exact: true }).click();
      else if (angle) {
        const radians = angle * Math.PI / 180;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: start });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, cx - 55 * Math.cos(radians), cy - 55 * Math.sin(radians)), touch(2, cx + 55 * Math.cos(radians), cy + 55 * Math.sin(radians))] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await page.getByRole('slider', { name: '图片缩放' }).focus();
      await page.keyboard.press('Home');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(1, cx, cy)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(1, cx + 600, cy - 600)] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await finishCrop();
      const invalidPixels = await page.locator('.image-preview img').first().evaluate(async image => {
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let invalid = 0;
        for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 54) > 10 || Math.abs(pixels[i + 1] - 127) > 10 || Math.abs(pixels[i + 2] - 186) > 10) invalid++;
        return invalid;
      });
      assert.equal(invalidPixels, 0, `added pixels outside source for ${width}×${height}, ${angle}°`);
    }
    console.log('extreme wide/tall sources, minimum zoom, boundary drag and rotation exports have no added border pixels');
    await addImage(1, demoCover(1));
    await page.getByRole('button', { name: '旋转 90°', exact: true }).click();
    assert.match(await transform(), /rotate\(90deg\)/);
    await page.getByRole('button', { name: '重置', exact: true }).click();
    assert.match(await transform(), /rotate\(0deg\) scale\(1\)/);
    await finishCrop();
    await page.getByRole('button', { name: /添加一组/ }).click();
    await page.getByRole('button', { name: /活页本（一图）/ }).click();
    await page.locator('.group-quantity input').fill('0');
    await page.getByRole('button', { name: '确认提交', exact: true }).click();
    await page.getByText(/第 2 组：本组数量必须是大于 0 的整数/).waitFor();
    await page.locator('.group-quantity input').fill('2');
    await addImage(0, demoCover(1)); await finishCrop();
    // 删除未保存的新组后，现有组图片和数量必须保留。
    await page.getByRole('button', { name: /添加一组/ }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '删除本组', exact: true }).click();
    assert.equal(await page.locator('.group-quantity input').inputValue(), '2');
    assert.deepEqual(await previewSize(), [1704, 2400]);
    let uploads = 0, puts = 0;
    await page.route('**/api/v1/customer/orders/BROWSER-MULTI/images?preview=0', async route => {
      uploads++;
      if (uploads === 2) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '测试上传中断' }) });
      return route.continue();
    });
    page.on('request', request => { if (request.method() === 'PUT') puts++; });
    await page.getByRole('button', { name: '确认提交', exact: true }).click();
    await page.getByText('第 2 组：测试上传中断', { exact: true }).waitFor();
    assert.equal(puts, 0, 'failed group must not save a partial order');
    await page.getByRole('button', { name: '确认提交', exact: true }).dblclick();
    await page.getByRole('heading', { name: '提交成功', exact: true }).waitFor();
    assert.equal(uploads, 3, 'retry should only upload the failed group');
    assert.equal(puts, 1, 'double click must not submit twice');
    const saved = await store.getOrderByOrderId('BROWSER-MULTI');
    const originalIds = saved.groups.map(group => group.front_file_id);
    assert.deepEqual(saved.groups.map(group => [group.notebook_type, group.quantity]), [['chexian', 3], ['huoye', 2]]);
    await openOrder('BROWSER-MULTI');
    assert.equal(await page.locator('.group-quantity input').inputValue(), '3');
    await page.locator('.image-preview img').first().waitFor();
    await page.getByRole('button', { name: '第 2 组', exact: true }).click();
    assert.equal(await page.locator('.group-quantity input').inputValue(), '2');
    assert.deepEqual(await previewSize(), [1704, 2400]);
    await page.locator('.image-preview.has-image').click(); await editorReady();
    await page.getByRole('button', { name: '旋转 90°', exact: true }).click();
    await finishCrop(); await page.locator('.group-quantity input').fill('4');
    await page.getByRole('button', { name: '确认提交', exact: true }).click();
    await page.getByRole('heading', { name: '提交成功', exact: true }).waitFor();
    const updated = await store.getOrderByOrderId('BROWSER-MULTI');
    assert.equal(updated.quantity, 7);
    assert.equal(updated.groups[0].front_file_id, originalIds[0]);
    assert.notEqual(updated.groups[1].front_file_id, originalIds[1]);
    const admin = await browser.newPage();
    admin.on('pageerror', error => pageErrors.push(error.message));
    await admin.goto(base + '/admin/');
    await admin.getByRole('textbox', { name: '账号' }).fill('demo');
    await admin.getByLabel('密码', { exact: true }).fill('demo123');
    await admin.getByRole('button', { name: '登录', exact: true }).click();
    await admin.getByPlaceholder('输入关键词或选择类型').fill('活页本');
    await admin.getByRole('button', { name: '查询', exact: true }).click();
    const row = admin.locator('tbody[data-order-id="BROWSER-MULTI"]');
    await row.getByRole('cell', { name: '胶套本', exact: true }).waitFor();
    await row.getByRole('cell', { name: '活页本', exact: true }).waitFor();
    assert.deepEqual(await row.locator('.order-quantity-cell').allTextContents(), ['3 本', '4 本']);
    assert.equal(await row.locator('tr').count(), 2);
    assert.equal(await row.locator('input[type=checkbox]').count(), 1);
    await row.getByRole('button', { name: 'BROWSER-MULTI 第 2 组 · 前图', exact: true }).click();
    await admin.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth === 1704);
    assert.match(await admin.getByRole('dialog').locator('img').getAttribute('src'), new RegExp('groupId=' + updated.groups[1].id));
    await admin.getByRole('button', { name: '关闭', exact: true }).click();
    await row.locator('input[type=checkbox]').check();
    const downloadEvent = admin.waitForEvent('download');
    await admin.getByRole('button', { name: /批量下载/ }).click();
    const download = await downloadEvent;
    const entries = unzipSync(await fs.readFile(await download.path()));
    const paths = Object.keys(entries);
    for (const [index, group] of updated.groups.entries()) {
      const folder = `第${index + 1}组-${group.quantity}本/`;
      const info = JSON.parse(Buffer.from(entries[paths.find(name => name.includes(folder) && name.endsWith('订单信息.json'))]).toString());
      assert.equal(info.quantity, group.quantity);
      for (const side of ['front', 'back']) if (group[side + '_file_id']) {
        const bytes = await store.downloadFile(group[side + '_file_id']);
        assert.ok(paths.filter(name => name.includes(folder)).some(name => Buffer.from(entries[name]).equals(bytes)), 'ZIP lost or mixed group image');
      }
    }
    assert.deepEqual(pageErrors, []);
    console.log('PASS: full viewport at four sizes; real touch pinch/rotate/drag and third finger; crop preview matches 1704×2400 export; cancel/reset; group validation/add/delete/reload; partial upload retry and double-click; admin login/preview and grouped ZIP byte checks.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.basename(dataDir).startsWith('xiaomengtong-browser-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
