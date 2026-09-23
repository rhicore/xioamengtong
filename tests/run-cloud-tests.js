'use strict';

const assert = require('assert');
const fs = require('fs');
const Module = require('module');
const path = require('path');

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    const result = {};
    Object.keys(value).forEach((key) => {
      result[key] = clone(value[key]);
    });
    return result;
  }
  return value;
}

function sameValue(left, right) {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  return left === right;
}

function matches(value, condition) {
  if (condition && condition.__mockOperator) {
    switch (condition.__mockOperator) {
      case 'regexp':
        return condition.value.test(String(value || ''));
      case 'in':
        return condition.value.some((item) => sameValue(value, item));
      case 'gte':
        return value >= condition.value;
      case 'gt':
        return value > condition.value;
      case 'lt':
        return value < condition.value;
      case 'lte':
        return value <= condition.value;
      case 'and':
        return condition.value.every((item) => matches(value, item));
      default:
        throw new Error(`Unsupported mock operator: ${condition.__mockOperator}`);
    }
  }
  return sameValue(value, condition);
}

function matchesDocument(document, filters) {
  return Object.keys(filters || {}).every((field) => matches(document[field], filters[field]));
}

class MockQuery {
  constructor(database, name) {
    this.database = database;
    this.name = name;
    this.filters = [];
    this.limitValue = null;
    this.skipValue = 0;
    this.orderField = null;
    this.orderDirection = 'asc';
  }

  where(filters) {
    this.filters.push(filters || {});
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  skip(value) {
    this.skipValue = value;
    return this;
  }

  orderBy(field, direction) {
    this.orderField = field;
    this.orderDirection = direction || 'asc';
    return this;
  }

  async get() {
    let records = this.database.records[this.name].filter((record) => (
      this.filters.every((filter) => matchesDocument(record, filter))
    ));

    if (this.orderField) {
      const field = this.orderField;
      const direction = this.orderDirection === 'desc' ? -1 : 1;
      records = records.slice().sort((left, right) => {
        if (left[field] === right[field]) return 0;
        return left[field] > right[field] ? direction : -direction;
      });
    }

    records = records.slice(this.skipValue);
    if (this.limitValue !== null) records = records.slice(0, this.limitValue);
    return { data: records.map(clone) };
  }

  async count() {
    const result = await this.get();
    return { total: result.data.length };
  }
}

class MockCollection {
  constructor(database, name) {
    this.database = database;
    this.name = name;
  }

  where(filters) {
    return new MockQuery(this.database, this.name).where(filters);
  }

  limit(value) {
    return new MockQuery(this.database, this.name).limit(value);
  }

  orderBy(field, direction) {
    return new MockQuery(this.database, this.name).orderBy(field, direction);
  }

  async get() {
    return new MockQuery(this.database, this.name).get();
  }

  async count() {
    return new MockQuery(this.database, this.name).count();
  }

  async add(payload) {
    const data = clone(payload.data || {});
    data._id = data._id || `${this.name}-${this.database.nextId++}`;
    this.database.records[this.name].push(data);
    return { _id: data._id }; 
  }

  doc(id) {
    const database = this.database;
    const name = this.name;
    return {
      async update(payload) {
        const record = database.records[name].find((item) => item._id === id);
        if (!record) throw new Error(`mock document not found: ${id}`);
        Object.assign(record, clone(payload.data || {}));
        return { stats: { updated: 1 } };
      }
    };
  }
}

class MockDatabase {
  constructor() {
    this.records = {
      orders: [],
      notebook_templates: [],
      staff_accounts: []
    };
    this.nextId = 1;
    this.command = {
      in: (value) => ({ __mockOperator: 'in', value }),
      gte: (value) => ({ __mockOperator: 'gte', value }),
      gt: (value) => ({ __mockOperator: 'gt', value }),
      lt: (value) => ({ __mockOperator: 'lt', value }),
      lte: (value) => ({ __mockOperator: 'lte', value }),
      and: (...value) => ({ __mockOperator: 'and', value })
    };
  }

  collection(name) {
    if (!this.records[name]) this.records[name] = [];
    return new MockCollection(this, name);
  }

  RegExp(options) {
    return {
      __mockOperator: 'regexp',
      value: new RegExp(options.regexp, options.options || '')
    };
  }

  seed(name, records) {
    this.records[name] = records.map((record) => clone(record));
  }
}

function createMockCloud(database) {
  const uploads = [];
  return {
    DYNAMIC_CURRENT_ENV: 'mock-environment',
    uploads,
    init() {},
    database() {
      return database;
    },
    getWXContext() {
      return { OPENID: 'staff-openid' };
    },
    async getTempFileURL(payload) {
      return {
        fileList: (payload.fileList || []).map((fileID) => ({
          fileID,
          tempFileURL: `https://mock.local/${encodeURIComponent(fileID)}`
        }))
      };
    },
    async downloadFile(payload) {
      return { fileContent: Buffer.from(`mock:${payload.fileID}`) };
    },
    async uploadFile(payload) {
      const chunks = [];
      if (payload.fileContent && typeof payload.fileContent.on === 'function') {
        await new Promise((resolve, reject) => {
          payload.fileContent.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          payload.fileContent.on('end', resolve);
          payload.fileContent.on('error', reject);
        });
      }
      const fileID = `cloud://mock/${path.basename(payload.cloudPath)}`;
      uploads.push({
        cloudPath: payload.cloudPath,
        fileID,
        content: Buffer.concat(chunks)
      });
      return { fileID };
    }
  };
}

function loadCloudFunction(relativePath, cloud) {
  const filePath = path.resolve(__dirname, '..', relativePath);
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(filePath)];
    return require(filePath);
  } finally {
    Module._load = originalLoad;
  }
}

async function run() {
  // 云函数运行在 Linux 时使用 /tmp；本地 Windows 测试时提前创建对应目录。
  const cloudTempDir = path.resolve('/tmp');
  if (!fs.existsSync(cloudTempDir)) fs.mkdirSync(cloudTempDir);

  const database = new MockDatabase();
  const cloud = createMockCloud(database);
  const getOrder = loadCloudFunction('cloudfunctions/getOrder/index.js', cloud);
  const saveOrderImages = loadCloudFunction('cloudfunctions/saveOrderImages/index.js', cloud);

  let result = await getOrder.main({ orderId: 'ORDER-001' });
  assert.strictEqual(result.code, 200);
  assert.strictEqual(result.data.exists, false);
  assert.strictEqual(result.data.templates.length, 3);
  assert.strictEqual(result.data.templates[0].image_count, 2);
  assert.strictEqual(result.data.templates[2].slug, 'huoye');

  result = await saveOrderImages.main({
    orderId: 'ORDER-001',
    notebookType: 'jiaotao',
    frontFileId: null,
    backFileId: null
  });
  assert.strictEqual(result.code, 200);
  assert.strictEqual(database.records.orders.length, 1);
  assert.strictEqual(database.records.orders[0].status, 'submitted');
  assert.strictEqual(result.data.front_file_id, null);
  assert.strictEqual(result.data.back_file_id, null);

  result = await getOrder.main({ orderId: 'ORDER-001' });
  assert.strictEqual(result.data.exists, true);
  assert.strictEqual(result.data.notebook_type, 'jiaotao');
  assert.strictEqual(result.data.front_url, '');

  result = await saveOrderImages.main({
    orderId: 'ORDER-001',
    notebookType: 'huoye',
    frontFileId: 'cloud://front.jpg',
    backFileId: null
  });
  assert.strictEqual(result.code, 200);
  assert.strictEqual(database.records.orders.length, 1);
  assert.strictEqual(database.records.orders[0].notebook_type, 'huoye');
  assert.strictEqual(database.records.orders[0].front_file_id, 'cloud://front.jpg');
  assert.strictEqual(database.records.orders[0].back_file_id, null);
  assert.strictEqual(result.data.front_file_id, 'cloud://front.jpg');

  result = await getOrder.main({ orderId: 'ORDER-001' });
  assert.strictEqual(result.code, 200);
  assert.strictEqual(result.data.front_file_id, 'cloud://front.jpg');
  assert.strictEqual(result.data.front_url, 'https://mock.local/cloud%3A%2F%2Ffront.jpg');

  console.log('cloud function tests passed');
  console.log('- unknown order returns a draft');
  console.log('- first submission creates an order');
  console.log('- repeat submission updates type and images');
  console.log('- blank-book and one-image validation works');
  console.log('- all cloud function entrypoints load successfully');
}

run().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
