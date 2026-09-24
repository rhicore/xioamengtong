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
  const server = http.createServer(createApp({ store, env: 'development' }));
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

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

  await new Promise((resolve) => server.close(resolve));
  console.log('customer api query, multipart upload and submit tests passed');
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
