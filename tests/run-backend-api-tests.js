const assert = require('assert');
const http = require('http');
const { createApp } = require('../backend_api/src/app');
const { hashPassword } = require('../backend_api/src/auth');

function createMemoryStore() {
  const accounts = new Map();
  const sessions = new Map();
  const deletedFileIds = [];
  const orders = [
    {
      _id: 'order-1',
      order_id: '1',
      notebook_type: 'chexian',
      platform: '拼多多',
      status: 'submitted',
      submitted_at: new Date('2026-09-22T09:00:00+08:00'),
      updated_at: new Date('2026-09-22T09:00:00+08:00'),
      front_file_id: 'cloud://front-1.jpg',
      back_file_id: 'cloud://back-1.jpg'
    },
    {
      _id: 'order-2',
      order_id: '2',
      notebook_type: 'chexian',
      status: 'submitted',
      submitted_at: new Date('2026-09-21T09:00:00+08:00'),
      updated_at: new Date('2026-09-21T09:00:00+08:00'),
      front_file_id: null,
      back_file_id: 'cloud://back-2.jpg'
    }
  ];
  const templates = {
    jiaotao: { slug: 'jiaotao', display_name: '胶套本 A5/B5', image_count: 2, allow_blank: true },
    chexian: { slug: 'chexian', display_name: '车线本 A5/B5', image_count: 2, allow_blank: true },
    huoye: { slug: 'huoye', display_name: '活页本 A5/B5', image_count: 1, allow_blank: false }
  };
  let nextId = 1;

  function same(value, condition) {
    if (condition && condition.__operator) {
      if (condition.__operator === 'in') return condition.value.includes(value);
      if (condition.__operator === 'regexp') return condition.value.test(String(value || ''));
      if (condition.__operator === 'gte') return value >= condition.value;
      if (condition.__operator === 'lt') return value < condition.value;
      if (condition.__operator === 'and') return condition.value.every((item) => same(value, item));
    }
    return value === condition;
  }

  function matchesOrder(order, filters) {
    if (filters.__operator === 'and') return filters.value.every(item => matchesOrder(order, item));
    if (filters.__operator === 'or') return filters.value.some(item => matchesOrder(order, item));
    return Object.entries(filters).every(([key, condition]) => key === 'groups.notebook_type'
      ? (order.groups || []).some(group => same(group.notebook_type, condition))
      : same(order[key], condition));
  }

  const db = {
    command: {
      in: (value) => ({ __operator: 'in', value }),
      gte: (value) => ({ __operator: 'gte', value }),
      lt: (value) => ({ __operator: 'lt', value }),
      and: (...value) => ({ __operator: 'and', value }),
      or: (...value) => ({ __operator: 'or', value })
    },
    RegExp: ({ regexp, options }) => ({
      __operator: 'regexp',
      value: new RegExp(regexp, options || '')
    })
  };

  return {
    db,
    async getAccountByUsername(username) {
      return [...accounts.values()].find((account) => account.username === username) || null;
    },
    async getAccountById(id) {
      return accounts.get(id) || null;
    },
    async listAccounts() {
      return [...accounts.values()];
    },
    async countActiveAdmins() {
      return [...accounts.values()].filter((account) => account.role === 'admin' && !account.disabled).length;
    },
    async createAccount(data) {
      const account = { ...data, _id: 'staff-' + nextId++ };
      accounts.set(account._id, account);
      return account;
    },
    async updateAccount(id, data) {
      const account = { ...accounts.get(id), ...data };
      accounts.set(id, account);
      return account;
    },
    async createSession(data) {
      const session = { ...data, _id: 'session-' + nextId++ };
      sessions.set(session.token_hash, session);
      return session;
    },
    async getSessionByTokenHash(tokenHash) {
      return [...sessions.values()].find((session) => session.token_hash === tokenHash) || null;
    },
    async touchSession(id, now) {
      const session = [...sessions.values()].find((item) => item._id === id);
      if (session) session.last_seen_at = now;
    },
    async revokeSession(tokenHash) {
      const session = sessions.get(tokenHash);
      if (session) session.revoked_at = new Date();
    },
    async getTemplateMap() {
      return templates;
    },
    async listOrders(filters, page, pageSize) {
      const matches = orders.filter((order) => matchesOrder(order, filters));
      return {
        items: matches.slice((page - 1) * pageSize, page * pageSize),
        total: matches.length
      };
    },
    async getOrdersByIds(ids) {
      return orders.filter((order) => ids.includes(order.order_id));
    },
    async updateOrder(id, data) {
      const index = orders.findIndex((order) => order._id === id);
      if (index < 0) return null;
      orders[index] = { ...orders[index], ...data };
      return orders[index];
    },
    async deleteOrder(id) {
      const index = orders.findIndex((order) => order._id === id);
      if (index >= 0) orders.splice(index, 1);
    },
    async deleteFiles(fileIds) {
      deletedFileIds.push(...fileIds);
      return { delete_list: fileIds };
    },
    async getTempFileURLMap(fileIds) {
      return Object.fromEntries(fileIds.filter(Boolean).map((fileID) => [
        fileID,
        `https://mock.local/${encodeURIComponent(fileID)}`
      ]));
    },
    async downloadFile(fileID) {
      return Buffer.from('mock image ' + fileID);
    },
    async seedAccount(data) {
      const account = { ...data, _id: data._id || 'staff-' + nextId++ };
      accounts.set(account._id, account);
      return account;
    },
    deletedFileIds
  };
}

async function request(baseUrl, path, options = {}, cookie = '') {
  const response = await fetch(baseUrl + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.headers || {})
    }
  });
  const setCookie = response.headers.get('set-cookie') || '';
  const body = response.status === 204
    ? null
    : response.headers.get('content-type')?.includes('application/zip')
      ? Buffer.from(await response.arrayBuffer())
      : await response.json();
  return { response, body, setCookie };
}

async function run() {
  const store = createMemoryStore();
  await store.seedAccount({
    _id: 'admin-id',
    username: 'admin',
    password_hash: await hashPassword('123'),
    role: 'admin',
    disabled: false
  });
  await store.seedAccount({
    _id: 'operator-id',
    username: 'printer01',
    password_hash: await hashPassword('op123'),
    role: 'operator',
    disabled: false
  });
  await store.seedAccount({
    _id: 'disabled-id',
    username: 'disabled',
    password_hash: await hashPassword('op123'),
    role: 'operator',
    disabled: true
  });

  const server = http.createServer(createApp({ store, env: 'production' }));
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  let result = await request(baseUrl, '/healthz', {
    headers: { Origin: 'http://localhost:5176' }
  });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.response.headers.get('access-control-allow-origin'), 'http://localhost:5176');
  assert.strictEqual(result.response.headers.get('access-control-allow-credentials'), 'true');

  result = await request(baseUrl, '/api/v1/admin/orders', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5176', 'Access-Control-Request-Method': 'DELETE' }
  });
  assert.strictEqual(result.response.status, 204);
  assert.match(result.response.headers.get('access-control-allow-methods'), /DELETE/);

  result = await request(baseUrl, '/api/v1/admin/me');
  assert.strictEqual(result.response.status, 401);

  result = await request(baseUrl, '/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'wrong' })
  });
  assert.strictEqual(result.response.status, 401);

  result = await request(baseUrl, '/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: '123' })
  });
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.data.username, 'admin');
  assert.strictEqual(result.body.data.role, 'admin');
  assert.ok(!Object.prototype.hasOwnProperty.call(result.body.data, 'name'));
  assert.ok(result.setCookie.includes('SameSite=None'));
  assert.ok(result.setCookie.includes('Secure'));
  assert.ok(!JSON.stringify(result.body).includes('password_hash'));
  const adminCookie = result.setCookie.split(';')[0];

  result = await request(baseUrl, '/api/v1/admin/accounts', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.data.length, 3);

  result = await request(baseUrl, '/api/v1/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({
      id: 'printer02',
      password: 'op123',
      role: 'operator'
    })
  }, adminCookie);
  assert.strictEqual(result.response.status, 201);

  result = await request(baseUrl, '/api/v1/admin/accounts', {
    method: 'POST',
    body: JSON.stringify({ username: 'bad', password: 'x' })
  }, adminCookie);
  assert.strictEqual(result.response.status, 400);

  result = await request(baseUrl, '/api/v1/admin/orders?notebook_type=%E8%83%B6%E5%A5%97%E6%9C%AC', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.data.total, 2);
  assert.strictEqual(result.body.data.items[0].display_name, '胶套本');
  assert.deepStrictEqual(result.body.data.notebook_types.map((item) => item.display_name), ['胶套本', '活页本']);
  assert.match(result.body.data.items[0].front_url, /^https:\/\/mock\.local/);

  result = await request(baseUrl, '/api/v1/admin/orders?notebook_type=%E8%83%B6%E5%A5%97%E6%9C%AC&preview=0', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.data.items[0].front_url, '');

  result = await request(baseUrl, '/api/v1/admin/order-previews', {
    method: 'POST',
    body: JSON.stringify({ orderIds: ['1'] })
  }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.match(result.body.data['1'].front_url, /^https:\/\/mock\.local/);
  assert.strictEqual(result.body.data['1'].front_download_url, '/api/v1/admin/orders/1/images/front');

  let imageResult = await fetch(baseUrl + '/api/v1/admin/orders/1/images/front', {
    headers: { Cookie: adminCookie }
  });
  assert.strictEqual(imageResult.status, 200);
  assert.strictEqual(imageResult.headers.get('content-type'), 'image/jpeg');
  assert.match(decodeURIComponent(imageResult.headers.get('content-disposition') || ''), /拼多多_胶套本_1_前\.jpg/);
  assert.strictEqual(Buffer.from(await imageResult.arrayBuffer()).toString(), 'mock image cloud://front-1.jpg');

  result = await request(baseUrl, '/api/v1/admin/orders/status', {
    method: 'PATCH',
    body: JSON.stringify({ orderIds: ['1'], status: 'in_production' })
  }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.deepStrictEqual(result.body.data.updated_order_ids, ['1']);

  result = await request(baseUrl, '/api/v1/admin/orders?preview=0', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.data.items.find((item) => item.order_id === '1').status, 'in_production');

  result = await request(baseUrl, '/api/v1/admin/orders/status', {
    method: 'PATCH',
    body: JSON.stringify({ orderIds: ['1'], status: 'completed' })
  }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.deepStrictEqual(result.body.data.updated_order_ids, ['1']);

  result = await request(baseUrl, '/api/v1/admin/orders?preview=0', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.data.items.find((item) => item.order_id === '1').status, 'completed');

  result = await request(baseUrl, '/api/v1/admin/batch-download', {
    method: 'POST',
    body: JSON.stringify({ orderIds: ['1'] })
  }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.response.headers.get('content-type'), 'application/zip');
  assert.ok(result.body.includes(Buffer.from('订单-1/订单信息.json')));
  assert.ok(result.body.includes(Buffer.from('订单-1/拼多多_胶套本_1_前.jpg')));
  assert.ok(result.body.includes(Buffer.from('订单-1/拼多多_胶套本_1_后.jpg')));

  result = await request(baseUrl, '/api/v1/admin/batch-download?orderIds=1', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.response.headers.get('content-type'), 'application/zip');
  assert.ok(result.body.includes(Buffer.from('订单-1/订单信息.json')));

  await store.updateOrder('order-1', {
    quantity: 5,
    groups: [
      { id: 'a', notebook_type: 'chexian', quantity: 3, front_file_id: 'cloud://front-1.jpg', back_file_id: 'cloud://back-1.jpg' },
      { id: 'b', notebook_type: 'huoye', quantity: 2, front_file_id: 'cloud://group-b.png', back_file_id: null }
    ]
  });
  result = await request(baseUrl, '/api/v1/admin/orders?order_id=1&preview=0', {}, adminCookie);
  assert.deepStrictEqual(result.body.data.items[0].groups.map(g => [g.display_name, g.quantity]), [['胶套本', 3], ['活页本', 2]]);
  result = await request(baseUrl, '/api/v1/admin/orders?notebook_type=huoye&preview=0', {}, adminCookie);
  assert.deepStrictEqual(result.body.data.items.map(order => order.order_id), ['1']);
  result = await request(baseUrl, '/api/v1/admin/orders?order_id=2&notebook_type=huoye&preview=0', {}, adminCookie);
  assert.strictEqual(result.body.data.total, 0);
  result = await request(baseUrl, '/api/v1/admin/order-previews', {
    method: 'POST', body: JSON.stringify({ orderIds: ['1'] })
  }, adminCookie);
  const previews = result.body.data['1'].groups;
  assert.strictEqual(previews[1].back_download_url, '');
  assert.match(previews[1].front_url, /group-b\.png/);
  const secondImage = await fetch(baseUrl + previews[1].front_download_url, { headers: { Cookie: adminCookie } });
  assert.strictEqual(secondImage.headers.get('content-type'), 'image/png');
  assert.strictEqual(await secondImage.text(), 'mock image cloud://group-b.png');
  const firstPath = '订单-1/第1组-3本/拼多多_胶套本_1_前.jpg';
  const secondPath = '订单-1/第2组-2本/拼多多_活页本_1_前.png';
  result = await request(baseUrl, '/api/v1/admin/batch-download-manifest', {
    method: 'POST', body: JSON.stringify({ orderIds: ['1'] })
  }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  const entries = result.body.data.entries;
  assert.ok(entries.some(entry => entry.name === firstPath && entry.url));
  assert.ok(entries.some(entry => entry.name === secondPath && entry.url.includes('group-b.png')));
  assert.strictEqual(JSON.parse(entries.find(entry => entry.name === '订单-1/第2组-2本/订单信息.json').content).quantity, 2);
  result = await request(baseUrl, '/api/v1/admin/batch-download?orderIds=1', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.ok(result.body.includes(Buffer.from(firstPath)));
  assert.ok(result.body.includes(Buffer.from(secondPath)));

  result = await request(baseUrl, '/api/v1/admin/orders', {
    method: 'DELETE',
    body: JSON.stringify({ orderIds: ['2'] })
  }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.deepStrictEqual(result.body.data.deleted_order_ids, ['2']);
  assert.deepStrictEqual(result.body.data.deleted_file_ids, ['cloud://back-2.jpg']);
  assert.deepStrictEqual(store.deletedFileIds, ['cloud://back-2.jpg']);
  assert.strictEqual((await store.getOrdersByIds(['2'])).length, 0);

  result = await request(baseUrl, '/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'printer01', password: 'op123' })
  });
  assert.strictEqual(result.response.status, 200);
  const operatorCookie = result.setCookie.split(';')[0];

  result = await request(baseUrl, '/api/v1/admin/accounts', {}, operatorCookie);
  assert.strictEqual(result.response.status, 403);
  result = await request(baseUrl, '/api/v1/admin/orders', {
    method: 'DELETE',
    body: JSON.stringify({ orderIds: ['1'] })
  }, operatorCookie);
  assert.strictEqual(result.response.status, 403);
  result = await request(baseUrl, '/api/v1/admin/accounts/admin-id', {
    method: 'PATCH',
    body: JSON.stringify({ password: 'new-admin-password' })
  }, operatorCookie);
  assert.strictEqual(result.response.status, 403);
  result = await request(baseUrl, '/api/v1/admin/accounts/me/password', {
    method: 'PATCH',
    body: JSON.stringify({ password: 'new-op-password' })
  }, operatorCookie);
  assert.strictEqual(result.response.status, 200);

  result = await request(baseUrl, '/api/v1/admin/logout', { method: 'POST' }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  result = await request(baseUrl, '/api/v1/admin/me', {}, adminCookie);
  assert.strictEqual(result.response.status, 401);

  await new Promise((resolve) => server.close(resolve));
  console.log('backend api authentication and role tests passed');
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
