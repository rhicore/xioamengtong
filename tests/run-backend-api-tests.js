const assert = require('assert');
const http = require('http');
const { createApp } = require('../backend_api/src/app');
const { hashPassword } = require('../backend_api/src/auth');

function createMemoryStore() {
  const accounts = new Map();
  const sessions = new Map();
  const orders = [
    {
      _id: 'order-1',
      order_id: '1',
      notebook_type: 'chexian',
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

  const db = {
    command: {
      in: (value) => ({ __operator: 'in', value }),
      gte: (value) => ({ __operator: 'gte', value }),
      lt: (value) => ({ __operator: 'lt', value }),
      and: (...value) => ({ __operator: 'and', value })
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
      const matches = orders.filter((order) => Object.entries(filters).every(([key, value]) => same(order[key], value)));
      return {
        items: matches.slice((page - 1) * pageSize, page * pageSize),
        total: matches.length
      };
    },
    async getOrdersByIds(ids) {
      return orders.filter((order) => ids.includes(order.order_id));
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
    }
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
  const body = response.headers.get('content-type')?.includes('application/zip')
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

  let result = await request(baseUrl, '/api/v1/admin/me');
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

  result = await request(baseUrl, '/api/v1/admin/orders?notebook_type=%E8%BD%A6%E7%BA%BF', {}, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.body.data.total, 2);
  assert.match(result.body.data.items[0].front_url, /^https:\/\/mock\.local/);

  result = await request(baseUrl, '/api/v1/admin/batch-download', {
    method: 'POST',
    body: JSON.stringify({ orderIds: ['1'] })
  }, adminCookie);
  assert.strictEqual(result.response.status, 200);
  assert.strictEqual(result.response.headers.get('content-type'), 'application/zip');
  assert.ok(result.body.includes(Buffer.from('订单-1/订单信息.json')));
  assert.ok(result.body.includes(Buffer.from('订单-1/车线本_A5_B5-1-前.jpg')));
  assert.ok(result.body.includes(Buffer.from('订单-1/车线本_A5_B5-1-后.jpg')));

  result = await request(baseUrl, '/api/v1/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'printer01', password: 'op123' })
  });
  assert.strictEqual(result.response.status, 200);
  const operatorCookie = result.setCookie.split(';')[0];

  result = await request(baseUrl, '/api/v1/admin/accounts', {}, operatorCookie);
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
