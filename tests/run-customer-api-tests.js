const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../backend_api/src/app');
const { detectPlatform } = require('../backend_api/src/platform');

assert.equal(detectPlatform('180902-049577984672746').platform, '拼多多');
assert.equal(detectPlatform('123456789012345678').platform, '淘宝/天猫');
assert.equal(detectPlatform('123456789012345').platform, '京东');
assert.equal(detectPlatform('1').platform, '');

function createMemoryStore() {
  const templates = {
    jiaotao: { slug: 'jiaotao', display_name: '胶套本 A5/B5', image_count: 2, aspect_ratio: '3:4', allow_blank: true, description: '前封面、后封底各 1 张；不上传时按空白处理' },
    chexian: { slug: 'chexian', display_name: '车线本 A5/B5', image_count: 2, aspect_ratio: '3:4', allow_blank: true, description: '前封面、后封底各 1 张；不上传时按空白处理' },
    huoye: { slug: 'huoye', display_name: '活页本 A5/B5', image_count: 1, aspect_ratio: '3:4', allow_blank: false, description: '上传 1 张封面图' }
  };
  const orders = new Map();
  const files = new Map();
  let nextId = 1;

  return {
    async getTemplateMap() { return templates; },
    async getOrderByOrderId(orderId) { return [...orders.values()].find((item) => item.order_id === orderId) || null; },
    async createOrder(data) {
      const order = { ...data, _id: `order-${nextId++}` };
      orders.set(order._id, order);
      return order;
    },
    async updateOrder(id, data) {
      const order = { ...orders.get(id), ...data };
      orders.set(id, order);
      return order;
    },
    async uploadFile(cloudPath, fileContent) {
      const fileID = `cloud://mock/${cloudPath}`;
      files.set(fileID, fileContent);
      return { fileID };
    },
    async getTempFileURLMap(fileIds) {
      return Object.fromEntries(fileIds.filter((fileID) => files.has(fileID)).map((fileID) => [
        fileID,
        `https://mock.local/${encodeURIComponent(fileID)}`
      ]));
    },
    async downloadFile(fileID) {
      if (!files.has(fileID)) throw new Error('file not found');
      return files.get(fileID);
    }
  };
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(baseUrl + path, options);
  const body = await response.json();
  return { response, body };
}

async function run() {
  const store = createMemoryStore();
  const { detectPlatform: detectAdminPlatform } = await import('../admin_web/src/utils/platform.js');
  for (const [id, expected] of [
    ['5127850836413057008', '淘宝/天猫'],
    ['123456789012345678', '淘宝/天猫'],
    ['261110_664566535682609', '拼多多'],
    ['261110-664566535682609', '拼多多'],
    [' 261110_664566535682609 ', '拼多多'],
    ['123456789012345', '京东'],
    ['12345678901234567890', ''],
    ['261110__664566535682609', ''],
    ['261110_66456653568260', ''],
    ['512785083641305700X', '']
  ]) {
    assert.equal(detectPlatform(id).platform, expected);
    assert.equal(detectAdminPlatform(id), expected);
  }
  assert.equal(detectPlatform('5127850836413057008').confidence, 'low');
  const server = http.createServer(createApp({ store, env: 'development' }));
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  for (const [id, platform] of [['5127850836413057008', '淘宝/天猫'], ['261110_664566535682609', '拼多多']]) {
    const endpoint = baseUrl + '/api/v1/customer/orders/' + id;
    const queried = await (await fetch(endpoint)).json();
    assert.equal(queried.data.platform, platform);
    assert.equal(queried.data.order_id, id);
    const submitted = await request(baseUrl, '/api/v1/customer/orders/' + id, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: [{ id: 'platform-test', notebook_type: 'chexian', quantity: 1 }] })
    });
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.body.data.platform, platform);
    const saved = await store.getOrderByOrderId(id);
    assert.equal(saved.order_id, id);
    assert.equal(saved.platform, platform);
    await store.updateOrder(saved._id, { platform: '' });
    const existing = await (await fetch(endpoint + '?preview=0')).json();
    assert.equal(existing.data.platform, platform);
    const { listOrders } = require('../backend_api/src/orders');
    const listed = await listOrders({ ...store, listOrders: async () => ({ items: [await store.getOrderByOrderId(id)], total: 1 }) }, { preview: '0' });
    assert.equal(listed.items[0].platform_display, platform);
    assert.equal(listed.items[0].order_id, id);
    await store.updateOrder(saved._id, { platform: '人工确认的平台' });
    assert.equal((await (await fetch(endpoint)).json()).data.platform, '人工确认的平台');
  }
  assert.equal(await store.getOrderByOrderId('261110-664566535682609'), null);

  let result = await request(baseUrl, '/api/v1/customer/orders/WEB-001');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.exists, false);
  assert.equal(result.body.data.templates.length, 3);

  const form = new FormData();
  form.append('front', new Blob([Buffer.from('fake-image')], { type: 'image/jpeg' }), 'front.jpg');
  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001/images', {
    method: 'POST',
    body: form
  });
  assert.equal(result.response.status, 200);
  assert.match(result.body.data.front_file_id, /orders\/WEB-001\//);

  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      notebook_type: 'chexian',
      front_file_id: result.body.data.front_file_id,
      back_file_id: null
    })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.notebook_type, 'chexian');

  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.exists, true);
  assert.match(result.body.data.front_url, /^https:\/\/mock\.local/);

  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001?preview=0');
  assert.equal(result.response.status, 200);
  assert.notEqual(result.body.data.front_file_id, '');
  assert.equal(result.body.data.front_url, '');

  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001/images');
  assert.equal(result.response.status, 200);
  assert.match(result.body.data.front_url, /^https:\/\/mock\.local/);

  const imageResponse = await fetch(baseUrl + '/api/v1/customer/orders/WEB-001/images/front');
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await imageResponse.arrayBuffer()).toString(), 'fake-image');

  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebook_type: 'chexian', front_file_id: 'cloud://mock/orders/OTHER/front.jpg' })
  });
  assert.equal(result.response.status, 400);

  const submittedOrder = await store.getOrderByOrderId('WEB-001');
  await store.updateOrder(submittedOrder._id, {
    status: 'in_production',
    production_started_at: new Date()
  });

  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.status, 'in_production');
  assert.equal(result.body.data.status_display, '制作中');

  const lockedForm = new FormData();
  lockedForm.append('back', new Blob([Buffer.from('another-image')], { type: 'image/jpeg' }), 'back.jpg');
  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001/images', {
    method: 'POST',
    body: lockedForm
  });
  assert.equal(result.response.status, 409);
  assert.match(result.body.message, /制作流程/);

  result = await request(baseUrl, '/api/v1/customer/orders/WEB-001', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notebook_type: 'chexian', front_file_id: submittedOrder.front_file_id })
  });
  assert.equal(result.response.status, 409);
  assert.match(result.body.message, /制作流程/);

  const groups = [];
  for (const [index, type] of ['chexian', 'huoye'].entries()) {
    const form = new FormData();
    form.append('front', new Blob([`group-${index}`], { type: 'image/jpeg' }), 'front.jpg');
    if (index === 0) form.append('back', new Blob(['group-0-back'], { type: 'image/jpeg' }), 'back.jpg');
    const upload = await request(baseUrl, '/api/v1/customer/orders/MULTI-001/images?preview=0', { method: 'POST', body: form });
    assert.equal(upload.response.status, 200);
    groups.push({
      id: `group-${index}`, notebook_type: type, quantity: index + 2,
      front_file_id: upload.body.data.front_file_id,
      back_file_id: upload.body.data.back_file_id || null
    });
  }
  assert.notEqual(groups[0].front_file_id, groups[1].front_file_id);
  const saveGroups = (items) => request(baseUrl, '/api/v1/customer/orders/MULTI-001', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups: items })
  });
  result = await saveGroups(groups);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.quantity, 5);
  assert.deepEqual(result.body.data.groups, groups);

  result = await request(baseUrl, '/api/v1/customer/orders/MULTI-001?preview=0');
  assert.deepEqual(result.body.data.groups.map(({ front_url, back_url, ...group }) => group), groups);
  for (const [index, group] of groups.entries()) {
    const query = `?groupId=${group.id}`;
    result = await request(baseUrl, '/api/v1/customer/orders/MULTI-001/images' + query);
    assert.match(result.body.data.front_url, new RegExp(encodeURIComponent(group.front_file_id)));
    const photo = await fetch(baseUrl + '/api/v1/customer/orders/MULTI-001/images/front' + query);
    assert.equal(await photo.text(), `group-${index}`);
  }
  result = await saveGroups([groups[0], { ...groups[1], quantity: 0 }]);
  assert.equal(result.response.status, 400);
  assert.deepEqual((await store.getOrderByOrderId('MULTI-001')).groups, groups);
  result = await saveGroups([{ ...groups[1], quantity: 4 }]);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.data.quantity, 4);
  assert.equal(result.body.data.groups.length, 1);
  const missing = await fetch(baseUrl + '/api/v1/customer/orders/MULTI-001/images/front?groupId=group-0');
  assert.equal(missing.status, 404);

  await new Promise((resolve) => server.close(resolve));
  console.log('customer api query, multipart upload and submit tests passed');
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
