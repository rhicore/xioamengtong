// 本地演示：使用正式页面和 API，只有存储适配器换成本地文件。
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const express = require('../backend_api/node_modules/express');
const { createApp } = require('../backend_api/src/app');
const { hashPassword } = require('../backend_api/src/auth');
const { getDefaultTemplates } = require('../backend_api/order-core');

// 生成两种配色的演示封面，尺寸与实际裁切输出一致。
function demoCover(variant = 0) {
  const width = 1704, height = 2400;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  const palettes = [[[225, 237, 244], [131, 165, 153], [59, 100, 102]], [[248, 230, 207], [202, 148, 133], [138, 100, 129]]];
  const colors = palettes[variant % palettes.length];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const hill = height * .63 + Math.sin(x / 380 + variant) * 170;
    const foreground = height * .79 + Math.sin(x / 490 + 2) * 130;
    let color = colors[y > foreground ? 2 : y > hill ? 1 : 0];
    if ((x - width * .72) ** 2 + (y - height * .29) ** 2 < 155 ** 2) color = [255, 250, 232];
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    color.forEach((channel, index) => { pixels[offset + index] = channel; });
  }
  function chunk(type, content) {
    const body = Buffer.concat([Buffer.from(type), content]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(content.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function createLocalStore(dataDir) {
  const fileDir = path.join(dataDir, 'files');
  fs.mkdirSync(fileDir, { recursive: true });
  const statePath = path.join(dataDir, 'data.json');
  const state = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, 'utf8'), (key, value) => /_at$/.test(key) && typeof value === 'string' ? new Date(value) : value)
    : { orders: [], accounts: [], sessions: [], files: {} };
  const persist = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const templates = Object.fromEntries(getDefaultTemplates().map(item => [item.slug, item]));
  const saveItem = (collection, data) => { const item = { ...data, _id: randomUUID() }; state[collection].push(item); persist(); return item; };
  const updateItem = (collection, id, patch) => {
    const item = state[collection].find(item => item._id === id);
    if (!item) return null;
    Object.assign(item, patch); persist(); return item;
  };
  const operator = (kind, value) => ({ kind, value });
  function matches(value, condition) {
    if (!condition?.kind) return value === condition;
    if (condition.kind === 'regexp') return condition.value.test(String(value || ''));
    if (condition.kind === 'in') return condition.value.includes(value);
    if (condition.kind === 'gte') return new Date(value) >= condition.value;
    if (condition.kind === 'lt') return new Date(value) < condition.value;
    if (condition.kind === 'and') return condition.value.every(item => matches(value, item));
    return false;
  }
  function matchesOrder(order, filters) {
    if (filters.kind === 'and') return filters.value.every(item => matchesOrder(order, item));
    if (filters.kind === 'or') return filters.value.some(item => matchesOrder(order, item));
    return Object.entries(filters).every(([key, condition]) => key === 'groups.notebook_type'
      ? (order.groups || []).some(group => matches(group.notebook_type, condition))
      : matches(order[key], condition));
  }
  const store = {
    db: {
      command: { in: value => operator('in', value), gte: value => operator('gte', value), lt: value => operator('lt', value), and: (...value) => operator('and', value), or: (...value) => operator('or', value) },
      RegExp: ({ regexp, options }) => operator('regexp', new RegExp(regexp, options))
    },
    async getTemplateMap() { return templates; },
    async getAccountByUsername(username) { return state.accounts.find(item => item.username === username); },
    async getAccountById(id) { return state.accounts.find(item => item._id === id); },
    async listAccounts() { return state.accounts; },
    async countActiveAdmins() { return state.accounts.filter(item => item.role === 'admin' && !item.disabled).length; },
    async createAccount(data) { return saveItem('accounts', data); },
    async updateAccount(id, data) { return updateItem('accounts', id, data); },
    async createSession(data) { return saveItem('sessions', data); },
    async getSessionByTokenHash(hash) { return state.sessions.find(item => item.token_hash === hash); },
    async touchSession(id, now) { return updateItem('sessions', id, { last_seen_at: now }); },
    async revokeSession(hash) { const item = await store.getSessionByTokenHash(hash); if (item) updateItem('sessions', item._id, { revoked_at: new Date() }); },
    async getOrderByOrderId(id) { return state.orders.find(item => item.order_id === id); },
    async getOrdersByIds(ids) { return state.orders.filter(item => ids.includes(item.order_id)); },
    async listOrders(filters, page, pageSize) {
      const items = state.orders.filter(order => matchesOrder(order, filters))
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at));
      return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length };
    },
    async createOrder(data) { return saveItem('orders', data); },
    async updateOrder(id, data) { return updateItem('orders', id, data); },
    async deleteOrder(id) { state.orders = state.orders.filter(item => item._id !== id); persist(); },
    async uploadFile(cloudPath, bytes) {
      const fileID = 'cloud://local-demo/' + cloudPath;
      const filename = randomUUID() + path.extname(cloudPath);
      fs.writeFileSync(path.join(fileDir, filename), bytes);
      state.files[fileID] = filename; persist(); return { fileID };
    },
    async downloadFile(fileID) {
      const filename = state.files[fileID];
      if (!filename) throw new Error('本地图片不存在');
      return fs.readFileSync(path.join(fileDir, filename));
    },
    async deleteFiles(ids) {
      for (const id of ids) {
        const filename = state.files[id];
        if (filename) fs.rmSync(path.join(fileDir, filename), { force: true });
        delete state.files[id];
      }
      persist();
    },
    async getTempFileURLMap(ids) {
      return Object.fromEntries(ids.filter(id => state.files[id]).map(id => [id, '/__demo/files?id=' + encodeURIComponent(id)]));
    }
  };
  if (!state.accounts.length) await store.createAccount({ username: 'demo', password_hash: await hashPassword('demo123'), role: 'admin', disabled: false, created_at: new Date() });
  if (!fs.existsSync(statePath + '.seeded')) {
    const front = await store.uploadFile('orders/DEMO-001/front.png', demoCover(0));
    const back = await store.uploadFile('orders/DEMO-001/back.png', demoCover(1));
    const single = await store.uploadFile('orders/DEMO-001/single.png', demoCover(1));
    const { saveCustomerOrder } = require('../backend_api/src/customer');
    await saveCustomerOrder(store, 'DEMO-001', { groups: [
      { id: 'demo-two', notebook_type: 'chexian', quantity: 3, front_file_id: front.fileID, back_file_id: back.fileID },
      { id: 'demo-one', notebook_type: 'huoye', quantity: 2, front_file_id: single.fileID }
    ] });
    fs.writeFileSync(statePath + '.seeded', '1');
  }
  return store;
}

async function createDemoApp({ dataDir = path.resolve(__dirname, '../.local-demo') } = {}) {
  const store = await createLocalStore(dataDir);
  const app = createApp({ store });
  app.get('/__demo/files', async (req, res, next) => {
    try { res.type(path.extname(req.query.id || '')).send(await store.downloadFile(req.query.id)); }
    catch { res.sendStatus(404); }
  });
  app.use('/admin', express.static(path.resolve(__dirname, '../admin_web/dist')));
  app.use(express.static(path.resolve(__dirname, '../customer_web/dist')));
  return { app, store };
}

if (require.main === module) {
  createDemoApp().then(({ app }) => {
    const port = Number(process.env.DEMO_PORT) || 5173;
    app.listen(port, '127.0.0.1', () => console.log(`顾客端 http://127.0.0.1:${port}/ · 订单 DEMO-001\n管理端 http://127.0.0.1:${port}/admin/ · demo / demo123\n数据和图片保存在 .local-demo/`));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { createDemoApp, demoCover };
