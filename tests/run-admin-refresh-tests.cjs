const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { unzipSync } = require('../admin_web/node_modules/fflate');
const { createDemoApp } = require('./local-demo.cjs');

(async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaomengtong-admin-refresh-'));
  const { app, store } = await createDemoApp({ dataDir });
  const order = await store.getOrderByOrderId('DEMO-001');
  const allGroups = structuredClone(order.groups);
  await store.updateOrder(order._id, { groups: [allGroups[0]] });
  await store.createOrder({ order_id: 'LEGACY-ONE', notebook_type: 'huoye', quantity: 4, status: 'submitted', front_file_id: allGroups[1].front_file_id });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser, releasePreview;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage();
    let previewHeld;
    const held = new Promise(resolve => { previewHeld = resolve; });
    const release = new Promise(resolve => { releasePreview = resolve; });
    let holdFirstPreview = true;
    await page.route('**/api/v1/admin/order-previews', async route => {
      if (!holdFirstPreview) return route.continue();
      holdFirstPreview = false;
      const response = await route.fetch();
      const body = await response.json();
      assert.equal(body.data['DEMO-001'].groups.length, 1);
      previewHeld(); await release;
      await route.fulfill({ response, json: body });
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/admin/');
    await page.getByRole('textbox', { name: '账号' }).fill('demo');
    await page.getByLabel('密码', { exact: true }).fill('demo123');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await held;

    // 顾客新增第二组后，管理端再次查询；旧的单组预览最后返回。
    await store.updateOrder(order._id, { groups: allGroups });
    const newPreview = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/order-previews'));
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await (await newPreview).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const orderBody = page.locator('tbody[data-order-id="DEMO-001"]');
    const secondLabel = orderBody.getByRole('cell', { name: '活页本', exact: true });
    await secondLabel.waitFor();
    const oldPreview = page.waitForResponse(response => response.url().endsWith('/api/v1/admin/order-previews'));
    releasePreview();
    await (await oldPreview).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await secondLabel.count(), 1, 'late one-group preview overwrote the refreshed two-group order');
    assert.equal(await orderBody.locator('.image-thumb-button').count(), 3);
    assert.equal(await orderBody.locator('tr').count(), 2);
    assert.equal(await orderBody.locator('td[rowspan="2"]').count(), 5);
    assert.equal(await orderBody.locator('input[type=checkbox]').count(), 1);
    assert.deepEqual(await orderBody.locator('.order-quantity-cell').allTextContents(), ['3 本', '2 本']);
    const legacyBody = page.locator('tbody[data-order-id="LEGACY-ONE"]');
    assert.equal(await legacyBody.locator('tr').count(), 1);
    assert.equal(await legacyBody.locator('.order-quantity-cell').textContent(), '4 本');
    assert.equal(await page.getByRole('columnheader', { name: '数量', exact: true }).count(), 1);

    await page.getByRole('button', { name: 'DEMO-001 第 2 组 · 前图', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[role=dialog] img')?.naturalWidth > 0);
    assert.match(await page.getByRole('dialog').locator('img').getAttribute('src'), /groupId=demo-one/);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await orderBody.locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: '批量下载 (1)', exact: true }).waitFor();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /批量下载/ }).click();
    const files = unzipSync(await fs.readFile(await (await downloading).path()));
    const names = Object.keys(files);
    for (const [index, group] of allGroups.entries()) {
      const folder = `第${index + 1}组-${group.quantity}本/`;
      const info = names.find(name => name.includes(folder) && name.endsWith('订单信息.json'));
      assert.equal(JSON.parse(Buffer.from(files[info]).toString()).quantity, group.quantity);
      for (const side of ['front', 'back']) if (group[side + '_file_id']) {
        const expected = await store.downloadFile(group[side + '_file_id']);
        assert.ok(names.some(name => name.includes(folder) && Buffer.from(files[name]).equals(expected)), 'download lost or mixed a group image');
      }
    }
    await page.getByPlaceholder('搜索订单号').fill('NO-SUCH-ORDER');
    await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.getByText('暂无订单', { exact: true }).waitFor();
    assert.equal(await page.locator('.empty-cell').getAttribute('colspan'), '8');
    console.log('PASS: late previews preserve group rows; type/quantity/images align, shared cells and selection merge by order, legacy and empty rows work, and all group images download correctly.');
  } finally {
    releasePreview?.(); await browser?.close();
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.basename(dataDir).startsWith('xiaomengtong-admin-refresh-'));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
