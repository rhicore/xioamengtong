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
    back_url: imageUrls[order.back_file_id] || ''
  }]));
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

async function createBatchDownload(store, orderIds) {
  const normalizedIds = [...new Set((Array.isArray(orderIds) ? orderIds : [])
    .map((id) => String(id).trim()).filter(Boolean))];
  if (normalizedIds.length === 0) throw failure('至少选择一个订单');
  if (normalizedIds.length > 100) throw failure('一次最多下载 100 个订单');

  const templateMap = await store.getTemplateMap();
  const orders = await store.getOrdersByIds(normalizedIds);
  if (orders.length === 0) throw failure('没有找到所选订单');

  const orderEntries = await mapWithConcurrency(orders, 8, async (order) => {
    const folderName = buildOrderFolderName(order);
    const entries = [{
      name: folderName + '/订单信息.json',
      content: Buffer.from(JSON.stringify(buildOrderInfo(order, templateMap[order.notebook_type]), null, 2) + '\n', 'utf8')
    }];
    const imageEntries = await Promise.all(['front', 'back'].map(async (side) => {
      const fileID = order[side + '_file_id'];
      if (!fileID) return null;
      const content = await store.downloadFile(fileID);
      const fileName = buildDownloadFileName(
        order,
        templateMap[order.notebook_type],
        side,
        '.jpg'
      );
      return { name: folderName + '/' + fileName, content };
    }));
    return entries.concat(imageEntries.filter(Boolean));
  });
  const entries = orderEntries.flat();

  return {
    filename: 'orders-' + Date.now() + '.zip',
    content: await createZip(entries)
  };
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

module.exports = { listOrders, getOrderImagePreviews, createBatchDownload };
