const archiver = require('archiver');
const { PassThrough } = require('stream');
const {
  buildDownloadFileName,
  buildOrderFolderName,
  normalizeTemplate
} = require('../order-core');
const { detectPlatform } = require('./platform');

function failure(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function imageContentType(fileID) {
  const value = String(fileID || '').toLowerCase();
  if (value.endsWith('.png')) return 'image/png';
  if (value.endsWith('.webp')) return 'image/webp';
  if (value.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function buildAdminImageDownloadUrl(orderId, side) {
  return `/api/v1/admin/orders/${encodeURIComponent(orderId)}/images/${side}`;
}

function contains(db, value) {
  const escaped = String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return db.RegExp({ regexp: escaped, options: 'i' });
}

function getTemplateOptions(templateMap) {
  const seen = new Set();
  return Object.values(templateMap)
    .map((template) => normalizeTemplate(template))
    .filter((template) => {
      if (seen.has(template.slug)) return false;
      seen.add(template.slug);
      return true;
    });
}

async function listOrders(store, event = {}) {
  const page = Math.max(Number(event.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(event.pageSize) || 20, 1), 100);
  const templateMap = await store.getTemplateMap();
  const templateOptions = getTemplateOptions(templateMap);
  const filters = {};
  const fields = ['order_id', 'platform', 'shop', 'product_name', 'status'];

  fields.forEach((field) => {
    if (event[field]) filters[field] = contains(store.db, event[field]);
  });

  const notebookKeyword = String(event.notebook_type || '').trim().toLowerCase();
  if (notebookKeyword) {
    const matchedSlugs = templateOptions
      .filter((template) => template.slug.toLowerCase().includes(notebookKeyword)
        || template.display_name.toLowerCase().includes(notebookKeyword))
      .map((template) => template.slug);
    filters.notebook_type = matchedSlugs.length > 0
      ? store.db.command.in(matchedSlugs)
      : store.db.RegExp({ regexp: 'a^', options: 'i' });
  }

  const createdFrom = String(event.created_from || '').trim();
  const createdTo = String(event.created_to || '').trim();
  if (createdFrom || createdTo) {
    const start = createdFrom ? new Date(createdFrom + 'T00:00:00+08:00') : null;
    const end = createdTo ? new Date(createdTo + 'T00:00:00+08:00') : null;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
      throw failure('日期筛选格式不正确');
    }
    if (start && end && end < start) throw failure('结束日期不能早于开始日期');
    if (start && end) {
      end.setDate(end.getDate() + 1);
      filters.submitted_at = store.db.command.and(
        store.db.command.gte(start),
        store.db.command.lt(end)
      );
    } else if (start) {
      filters.submitted_at = store.db.command.gte(start);
    } else {
      end.setDate(end.getDate() + 1);
      filters.submitted_at = store.db.command.lt(end);
    }
  }

  const result = await store.listOrders(filters, page, pageSize);
  let imageUrls = {};
  const includeImageUrls = event.preview !== '0' && event.preview !== 'false';
  if (includeImageUrls && typeof store.getTempFileURLMap === 'function') {
    try {
      const fileIds = result.items.flatMap((order) => [order.front_file_id, order.back_file_id]);
      imageUrls = await store.getTempFileURLMap(fileIds);
    } catch (error) {
      console.warn('admin image preview urls unavailable', error.message || error);
    }
  }
  return {
    items: result.items.map((order) => {
      const detectedPlatform = detectPlatform(order.order_id);
      const resolvedPlatform = order.platform || detectedPlatform.platform;
      return Object.assign(
        {},
        order,
        normalizeTemplate(templateMap[order.notebook_type]),
        {
          platform: resolvedPlatform,
          platform_display: resolvedPlatform || '未知平台',
          platform_detection: detectedPlatform,
          front_url: imageUrls[order.front_file_id] || '',
          back_url: imageUrls[order.back_file_id] || ''
        }
      );
    }),
    notebook_types: templateOptions,
    total: result.total,
    page,
    page_size: pageSize
  };
}

async function getOrderImagePreviews(store, orderIds = []) {
  const normalizedIds = [...new Set((Array.isArray(orderIds) ? orderIds : [])
    .map((id) => String(id).trim()).filter(Boolean))].slice(0, 100);
  if (normalizedIds.length === 0) return {};

  const orders = await store.getOrdersByIds(normalizedIds);
  let imageUrls = {};
  if (typeof store.getTempFileURLMap === 'function') {
    try {
      const fileIds = orders.flatMap((order) => [order.front_file_id, order.back_file_id]);
      imageUrls = await store.getTempFileURLMap(fileIds);
    } catch (error) {
      console.warn('admin image preview urls unavailable', error.message || error);
    }
  }

  return Object.fromEntries(orders.map((order) => [order.order_id, {
    front_url: imageUrls[order.front_file_id] || '',
    back_url: imageUrls[order.back_file_id] || '',
    front_download_url: order.front_file_id
      ? buildAdminImageDownloadUrl(order.order_id, 'front')
      : '',
    back_download_url: order.back_file_id
      ? buildAdminImageDownloadUrl(order.order_id, 'back')
      : ''
  }]));
}

async function getAdminOrderImage(store, value, side) {
  const orderId = String(value || '').trim();
  if (!orderId || !['front', 'back'].includes(side)) throw failure('图片不存在', 404);
  const order = typeof store.getOrderByOrderId === 'function'
    ? await store.getOrderByOrderId(orderId)
    : (await store.getOrdersByIds([orderId]))[0];
  const fileID = order && order[side + '_file_id'];
  if (!fileID) throw failure('图片不存在', 404);

  try {
    const [templateMap, fileContent] = await Promise.all([
      store.getTemplateMap(),
      store.downloadFile(fileID)
    ]);
    return {
      fileContent,
      contentType: imageContentType(fileID),
      fileName: buildDownloadFileName(
        order,
        templateMap[order.notebook_type],
        side,
        '.jpg'
      )
    };
  } catch (error) {
    console.warn('admin image download unavailable', error.message || error);
    throw failure('图片不存在或已失效，请重新上传', 404);
  }
}

function normalizeOrderIds(orderIds, limitMessage) {
  const normalizedIds = [...new Set((Array.isArray(orderIds) ? orderIds : [])
    .map((id) => String(id).trim()).filter(Boolean))];
  if (normalizedIds.length === 0) throw failure('至少选择一个订单');
  if (normalizedIds.length > 100) throw failure(limitMessage);
  return normalizedIds;
}

async function updateOrdersStatus(store, orderIds, status, now = () => new Date()) {
  const normalizedIds = normalizeOrderIds(orderIds, '一次最多处理 100 个订单');
  if (!['in_production', 'completed'].includes(status)) {
    throw failure('订单状态不正确');
  }

  const orders = await store.getOrdersByIds(normalizedIds);
  const foundIds = new Set(orders.map((order) => order.order_id));
  const missingOrderIds = normalizedIds.filter((orderId) => !foundIds.has(orderId));
  const results = await Promise.all(orders.map(async (order) => {
    if (order.status === status) {
      return { orderId: order.order_id, action: 'unchanged' };
    }
    if (status === 'in_production' && order.status === 'completed') {
      return { orderId: order.order_id, action: 'skipped' };
    }

    const patch = { status, updated_at: now() };
    if (status === 'in_production') patch.production_started_at = order.production_started_at || now();
    if (status === 'completed') patch.completed_at = order.completed_at || now();
    await store.updateOrder(order._id, patch);
    return { orderId: order.order_id, action: 'updated' };
  }));

  return {
    status,
    updated_order_ids: results.filter((item) => item.action === 'updated').map((item) => item.orderId),
    unchanged_order_ids: results.filter((item) => item.action === 'unchanged').map((item) => item.orderId),
    skipped_order_ids: results.filter((item) => item.action === 'skipped').map((item) => item.orderId),
    missing_order_ids: missingOrderIds
  };
}

async function deleteOrders(store, orderIds) {
  const normalizedIds = normalizeOrderIds(orderIds, '一次最多删除 100 个订单');
  const orders = await store.getOrdersByIds(normalizedIds);
  const foundIds = new Set(orders.map((order) => order.order_id));
  const missingOrderIds = normalizedIds.filter((orderId) => !foundIds.has(orderId));
  const fileIds = [...new Set(orders.flatMap((order) => [
    order.front_file_id,
    order.back_file_id
  ].filter(Boolean)))];

  if (fileIds.length > 0) {
    if (typeof store.deleteFiles !== 'function') {
      throw failure('当前存储适配器不支持删除订单图片', 500);
    }
    // 先清理云存储文件，再删除订单记录；图片清理失败时保留订单，方便重试，避免产生“记录已删但图片还在”的孤儿数据。
    await store.deleteFiles(fileIds);
  }

  if (typeof store.deleteOrder !== 'function') {
    throw failure('当前存储适配器不支持删除订单记录', 500);
  }
  await Promise.all(orders.map((order) => store.deleteOrder(order._id)));

  return {
    deleted_order_ids: orders.map((order) => order.order_id),
    missing_order_ids: missingOrderIds,
    deleted_file_ids: fileIds
  };
}

async function markOrdersInProduction(store, orderIds, now = () => new Date()) {
  return updateOrdersStatus(store, orderIds, 'in_production', now);
}

function serializeDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (value.$date) return new Date(value.$date).toISOString();
  return String(value);
}

function buildOrderInfo(order, template) {
  const config = normalizeTemplate(template);
  return {
    order_id: order.order_id || '',
    notebook_type: config.slug,
    notebook_name: config.display_name,
    quantity: Number(order.quantity) || 1,
    status: order.status || '',
    platform: order.platform || '',
    shop: order.shop || '',
    product_name: order.product_name || '',
    remark: order.remark || '',
    created_at: serializeDate(order.created_at),
    submitted_at: serializeDate(order.submitted_at),
    updated_at: serializeDate(order.updated_at),
    images: {
      front: Boolean(order.front_file_id),
      back: Boolean(order.back_file_id)
    }
  };
}

function createZip(entries) {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const chunks = [];
    output.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    output.on('end', () => resolve(Buffer.concat(chunks)));
    output.on('error', reject);
    const archive = archiver('zip', { zlib: { level: 0 } });
    archive.on('error', reject);
    archive.pipe(output);
    entries.forEach((entry) => archive.append(entry.content, { name: entry.name }));
    archive.finalize();
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadFileWithRetry(store, fileID, tempFileURL, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await (typeof store.downloadFileFast === 'function'
        ? store.downloadFileFast(fileID, tempFileURL)
        : store.downloadFile(fileID));
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(250 * (2 ** attempt));
    }
  }
  throw lastError;
}

async function getBatchDownloadContext(store, orderIds) {
  const normalizedIds = normalizeOrderIds(orderIds, '一次最多下载 100 个订单');
  const [templateMap, orders] = await Promise.all([
    store.getTemplateMap(),
    store.getOrdersByIds(normalizedIds)
  ]);
  if (orders.length === 0) throw failure('没有找到所选订单');
  let fileUrls = {};
  if (typeof store.getTempFileURLMap === 'function') {
    try {
      const fileIds = orders.flatMap((order) => [order.front_file_id, order.back_file_id]);
      const chunks = [];
      for (let index = 0; index < fileIds.length; index += 50) {
        chunks.push(fileIds.slice(index, index + 50));
      }
      const urlMaps = await mapWithConcurrency(chunks, 4, (chunk) => store.getTempFileURLMap(chunk));
      fileUrls = Object.assign({}, ...urlMaps);
    } catch (error) {
      console.warn('batch download temp urls unavailable, fallback to SDK download', error.message || error);
    }
  }
  return { templateMap, orders, fileUrls };
}

async function getBatchDownloadManifest(store, orderIds) {
  const { templateMap, orders, fileUrls } = await getBatchDownloadContext(store, orderIds);
  const entries = [];

  orders.forEach((order) => {
    const { folderName, entry } = buildOrderInfoEntry(order, templateMap);
    entries.push({
      name: entry.name,
      content: entry.content.toString('utf8')
    });

    ['front', 'back'].forEach((side) => {
      const fileID = order[side + '_file_id'];
      const url = fileID ? fileUrls[fileID] : '';
      if (!url) return;
      entries.push({
        name: folderName + '/' + buildDownloadFileName(
          order,
          templateMap[order.notebook_type],
          side,
          '.jpg'
        ),
        url
      });
    });
  });

  return {
    filename: 'orders-' + Date.now() + '.zip',
    entries
  };
}

function buildOrderInfoEntry(order, templateMap) {
  const folderName = buildOrderFolderName(order);
  return {
    folderName,
    entry: {
      name: folderName + '/订单信息.json',
      content: Buffer.from(JSON.stringify(buildOrderInfo(order, templateMap[order.notebook_type]), null, 2) + '\n', 'utf8')
    }
  };
}

async function getOrderImageEntries(store, order, templateMap, folderName, fileUrls = {}) {
  const imageEntries = await Promise.all(['front', 'back'].map(async (side) => {
    const fileID = order[side + '_file_id'];
    if (!fileID) return null;
    const content = await downloadFileWithRetry(store, fileID, fileUrls[fileID]);
    const fileName = buildDownloadFileName(
      order,
      templateMap[order.notebook_type],
      side,
      '.jpg'
    );
    return { name: folderName + '/' + fileName, content };
  }));
  return imageEntries.filter(Boolean);
}

async function createBatchDownload(store, orderIds) {
  const { templateMap, orders, fileUrls } = await getBatchDownloadContext(store, orderIds);

  const orderEntries = await mapWithConcurrency(orders, 4, async (order) => {
    const { folderName, entry } = buildOrderInfoEntry(order, templateMap);
    return [entry].concat(await getOrderImageEntries(store, order, templateMap, folderName, fileUrls));
  });
  const entries = orderEntries.flat();

  return {
    filename: 'orders-' + Date.now() + '.zip',
    content: await createZip(entries)
  };
}

async function streamBatchDownload(store, orderIds, res) {
  const { templateMap, orders, fileUrls } = await getBatchDownloadContext(store, orderIds);
  const filename = 'orders-' + Date.now() + '.zip';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');

  const archive = archiver('zip', { zlib: { level: 0 } });
  archive.pipe(res);
  await mapWithConcurrency(orders, 4, async (order) => {
    const { folderName, entry } = buildOrderInfoEntry(order, templateMap);
    archive.append(entry.content, { name: entry.name });
    const imageEntries = await getOrderImageEntries(store, order, templateMap, folderName, fileUrls);
    imageEntries.forEach((imageEntry) => archive.append(imageEntry.content, { name: imageEntry.name }));
  });
  await archive.finalize();
  return { filename };
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = {
  listOrders,
  getOrderImagePreviews,
  getAdminOrderImage,
  createBatchDownload,
  getBatchDownloadManifest,
  streamBatchDownload,
  markOrdersInProduction,
  updateOrdersStatus,
  deleteOrders
};
