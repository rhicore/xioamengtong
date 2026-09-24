const cloudbase = require('@cloudbase/node-sdk');

function createCloudbaseStore(options = {}) {
  const envId = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || 'xiaomengtong-d5g5zuan5ae97c4ea';
  const cloudbaseApp = options.app || cloudbase.init({
    env: envId,
    ...(process.env.CLOUDBASE_APIKEY && { accessKey: process.env.CLOUDBASE_APIKEY }),
    ...(process.env.TENCENTCLOUD_SECRETID && { secretId: process.env.TENCENTCLOUD_SECRETID }),
    ...(process.env.TENCENTCLOUD_SECRETKEY && { secretKey: process.env.TENCENTCLOUD_SECRETKEY })
  });
  const db = cloudbaseApp.database();
  const TEMPLATE_CACHE_TTL_MS = 5 * 60 * 1000;
  let templateCache = null;
  let templateCacheExpiresAt = 0;
  let templateRefreshPromise = null;

  async function getAccountByUsername(username) {
    const result = await db.collection('staff_accounts')
      .where({ username })
      .limit(1)
      .get();
    return result.data && result.data[0];
  }

  async function getAccountById(id) {
    if (!id) return null;
    const result = await db.collection('staff_accounts').doc(id).get();
    return result.data && result.data[0] ? result.data[0] : null;
  }

  async function listAccounts() {
    const result = await db.collection('staff_accounts').limit(100).get();
    return (result.data || []).sort((left, right) => (
      String(left.username || '').localeCompare(String(right.username || ''))
    ));
  }

  async function countActiveAdmins() {
    const result = await db.collection('staff_accounts')
      .where({ role: 'admin', disabled: false })
      .count();
    return result.total || 0;
  }

  async function createAccount(data) {
    const result = await db.collection('staff_accounts').add(data);
    return { ...data, _id: result.id || result._id };
  }

  async function updateAccount(id, data) {
    await db.collection('staff_accounts').doc(id).update(data);
    return { ...data, _id: id };
  }

  async function createSession(data) {
    return db.collection('staff_sessions').add(data);
  }

  async function getSessionByTokenHash(tokenHash) {
    const result = await db.collection('staff_sessions')
      .where({ token_hash: tokenHash })
      .limit(1)
      .get();
    return result.data && result.data[0];
  }

  async function touchSession(id, now) {
    await db.collection('staff_sessions').doc(id).update({ last_seen_at: now });
  }

  async function revokeSession(tokenHash) {
    const session = await getSessionByTokenHash(tokenHash);
    if (session) {
      await db.collection('staff_sessions').doc(session._id).update({ revoked_at: new Date() });
    }
  }

  async function refreshTemplateMap() {
    const { getDefaultTemplates } = require('../order-core');
    const templateMap = getDefaultTemplates().reduce((map, template) => {
      map[template.slug] = template;
      return map;
    }, {});
    try {
      const result = await db.collection('notebook_templates').limit(100).get();
      (result.data || []).forEach((item) => {
        if (item.slug) templateMap[item.slug] = item;
      });
    } catch (error) {
      console.warn('notebook_templates unavailable, using built-in templates');
    }
    templateCache = templateMap;
    templateCacheExpiresAt = Date.now() + TEMPLATE_CACHE_TTL_MS;
    return templateCache;
  }

  async function getTemplateMap(options = {}) {
    if (options.allowStale) {
      if (!templateCache) {
        const { getDefaultTemplates } = require('../order-core');
        templateCache = getDefaultTemplates().reduce((map, template) => {
          map[template.slug] = template;
          return map;
        }, {});
      }
      if (!templateRefreshPromise && Date.now() >= templateCacheExpiresAt) {
        templateRefreshPromise = refreshTemplateMap().finally(() => {
          templateRefreshPromise = null;
        });
      }
      return templateCache;
    }
    if (templateCache) return templateCache;
    if (!templateRefreshPromise) {
      templateRefreshPromise = refreshTemplateMap().finally(() => {
        templateRefreshPromise = null;
      });
    }
    return templateRefreshPromise;
  }

  async function listOrders(filters, page, pageSize) {
    function createQuery() {
      let query = db.collection('orders');
      if (Object.keys(filters || {}).length > 0) query = query.where(filters);
      return query;
    }

    const [totalResult, pageResult] = await Promise.all([
      createQuery().count(),
      createQuery()
        .orderBy('submitted_at', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    ]);
    return { items: pageResult.data || [], total: totalResult.total || 0 };
  }

  async function getOrdersByIds(orderIds) {
    const result = await db.collection('orders')
      .where({ order_id: db.command.in(orderIds) })
      .limit(100)
      .get();
    return result.data || [];
  }

  async function getOrderByOrderId(orderId) {
    const result = await db.collection('orders')
      .where({ order_id: orderId })
      .limit(1)
      .get();
    return result.data && result.data[0] ? result.data[0] : null;
  }

  async function createOrder(data) {
    const result = await db.collection('orders').add(data);
    return getOrderById(result.id || result._id);
  }

  async function getOrderById(id) {
    if (!id) return null;
    const result = await db.collection('orders').doc(id).get();
    return result.data && result.data[0] ? result.data[0] : null;
  }

  async function updateOrder(id, data) {
    await db.collection('orders').doc(id).update(data);
    return getOrderById(id);
  }

  async function uploadFile(cloudPath, fileContent) {
    return cloudbaseApp.uploadFile({ cloudPath, fileContent });
  }

  async function getTempFileURLMap(fileIds) {
    const validFileIds = [...new Set((fileIds || []).filter(Boolean))];
    if (validFileIds.length === 0) return {};

    const result = await cloudbaseApp.getTempFileURL({ fileList: validFileIds });
    return (result.fileList || [])
      .filter((item) => item.fileID && item.tempFileURL)
      .reduce((map, item) => {
        map[item.fileID] = item.tempFileURL;
        return map;
      }, {});
  }

  async function downloadFile(fileID) {
    const result = await cloudbaseApp.downloadFile({ fileID });
    return result.fileContent;
  }

  return {
    db,
    getAccountByUsername,
    getAccountById,
    listAccounts,
    countActiveAdmins,
    createAccount,
    updateAccount,
    createSession,
    getSessionByTokenHash,
    touchSession,
    revokeSession,
    getTemplateMap,
    listOrders,
    getOrdersByIds,
    getOrderByOrderId,
    createOrder,
    updateOrder,
    uploadFile,
    getTempFileURLMap,
    downloadFile
  };
}

module.exports = { createCloudbaseStore };
