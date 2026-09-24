const {
  getDefaultTemplates,
  normalizeOrderId,
  normalizeTemplate
} = require('../order-core');
const { detectPlatform } = require('./platform');

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

function imageContentType(fileId) {
  const match = String(fileId || '').toLowerCase().match(/\.(jpg|jpeg|png|webp)(?:\?|$)/);
  if (!match) return 'application/octet-stream';
  if (match[1] === 'png') return 'image/png';
  if (match[1] === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function customerError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeCustomerOrderId(value) {
  try {
    return normalizeOrderId(value);
  } catch (error) {
    throw customerError(400, error.message);
  }
}

function templateOptions(templateMap) {
  const seen = new Set();
  return Object.values(templateMap || {})
    .map((template) => normalizeTemplate(template))
    .filter((template) => {
      if (seen.has(template.slug)) return false;
      seen.add(template.slug);
      return true;
    });
}

function findTemplate(templates, slug) {
  const aliases = {
    jiaotao_a5: 'jiaotao',
    chexian_a5: 'chexian',
    default: 'huoye'
  };
  return templates.find((item) => item.slug === (aliases[slug] || slug)) || null;
}

function safeOrderPathPart(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeFileId(value) {
  if (value === null || value === undefined || value === '') return null;
  const fileId = String(value).trim();
  return fileId || null;
}

function validateOrderFileId(fileId, orderId) {
  if (!fileId) return null;
  const pathPart = `/orders/${safeOrderPathPart(orderId)}/`;
  if (!fileId.includes(pathPart)) {
    throw customerError(400, '图片地址与订单号不匹配，请重新上传');
  }
  return fileId;
}

function toPublicOrder(order, template, extra = {}) {
  const config = normalizeTemplate(template);
  const detectedPlatform = detectPlatform(order.order_id);
  return {
    exists: true,
    order_id: order.order_id,
    notebook_type: config.slug,
    display_name: config.display_name,
    quantity: Number(order.quantity) || 1,
    platform: order.platform || detectedPlatform.platform,
    platform_detection: detectedPlatform,
    status: order.status || 'submitted',
    front_file_id: order.front_file_id || '',
    back_file_id: order.back_file_id || '',
    created_at: order.created_at || null,
    submitted_at: order.submitted_at || null,
    updated_at: order.updated_at || null,
    ...extra
  };
}

async function getCustomerOrder(store, value, options = {}) {
  const orderId = normalizeCustomerOrderId(value);
  const platformDetection = detectPlatform(orderId);
  const [templateMap, order] = await Promise.all([
    store.getTemplateMap({ allowStale: true }),
    store.getOrderByOrderId(orderId)
  ]);
  const templates = templateOptions(templateMap);

  if (!order) {
    return {
      exists: false,
      order_id: orderId,
      notebook_type: '',
      display_name: '',
      platform: platformDetection.platform,
      platform_detection: platformDetection,
      status: 'draft',
      front_file_id: '',
      back_file_id: '',
      front_url: '',
      back_url: '',
      templates
    };
  }

  const template = findTemplate(templates, order.notebook_type) || templates[0] || getDefaultTemplates()[0];
  let urlMap = {};
  if (options.includePreview !== false) {
    try {
      urlMap = await store.getTempFileURLMap([order.front_file_id, order.back_file_id]);
    } catch (error) {
      // 订单信息仍然可以展示，图片 URL 失败时由前端提示用户重新上传。
      console.warn('customer image preview url unavailable', error.message || error);
    }
  }

  return toPublicOrder(order, template, {
    front_url: urlMap[order.front_file_id] || '',
    back_url: urlMap[order.back_file_id] || '',
    templates
  });
}

async function getCustomerImage(store, value, side) {
  const orderId = normalizeCustomerOrderId(value);
  if (!['front', 'back'].includes(side)) throw customerError(404, '图片不存在');
  const order = await store.getOrderByOrderId(orderId);
  const fileId = order && order[side + '_file_id'];
  if (!fileId) throw customerError(404, '图片不存在');

  try {
    const fileContent = await store.downloadFile(fileId);
    return { fileContent, contentType: imageContentType(fileId) };
  } catch (error) {
    console.warn('customer image download unavailable', error.message || error);
    throw customerError(404, '图片不存在或已失效，请重新上传');
  }
}

async function getCustomerImageUrls(store, value) {
  const orderId = normalizeCustomerOrderId(value);
  const order = await store.getOrderByOrderId(orderId);
  if (!order) return { order_id: orderId, front_url: '', back_url: '' };

  let urlMap = {};
  try {
    urlMap = await store.getTempFileURLMap([order.front_file_id, order.back_file_id]);
  } catch (error) {
    console.warn('customer image preview urls unavailable', error.message || error);
  }
  return {
    order_id: orderId,
    front_url: urlMap[order.front_file_id] || '',
    back_url: urlMap[order.back_file_id] || ''
  };
}

function validateImage(file) {
  if (!file || !file.buffer || file.size <= 0) {
    throw customerError(400, '上传图片不能为空');
  }
  if (!IMAGE_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
    throw customerError(400, '只支持 JPG、PNG 或 WebP 图片');
  }
}

function extensionFor(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

async function uploadCustomerImages(store, value, files = {}, options = {}) {
  const orderId = normalizeCustomerOrderId(value);
  const uploaded = {};
  const orderPath = safeOrderPathPart(orderId);

  const uploadResults = await Promise.all(['front', 'back'].map(async (side) => {
    const file = Array.isArray(files[side]) ? files[side][0] : null;
    if (!file) return null;
    validateImage(file);
    const cloudPath = `orders/${orderPath}/${Date.now()}-${side}${extensionFor(file)}`;
    const result = await store.uploadFile(cloudPath, file.buffer);
    return { side, fileId: result.fileID };
  }));
  uploadResults.filter(Boolean).forEach(({ side, fileId }) => {
    uploaded[side + '_file_id'] = fileId;
  });

  if (Object.keys(uploaded).length === 0) {
    throw customerError(400, '请至少上传一张图片');
  }

  let urls = {};
  if (options.includePreview !== false) {
    try {
      urls = await store.getTempFileURLMap(Object.values(uploaded));
    } catch (error) {
      console.warn('customer uploaded image preview url unavailable', error.message || error);
    }
  }

  return {
    order_id: orderId,
    ...uploaded,
    front_url: urls[uploaded.front_file_id] || '',
    back_url: urls[uploaded.back_file_id] || ''
  };
}

async function saveCustomerOrder(store, value, body = {}) {
  const orderId = normalizeCustomerOrderId(value);
  const [templateMap, existing] = await Promise.all([
    store.getTemplateMap({ allowStale: true }),
    store.getOrderByOrderId(orderId)
  ]);
  const templates = templateOptions(templateMap);
  const template = findTemplate(templates, String(body.notebook_type || body.notebookType || '').trim());
  if (!template) throw customerError(400, '请选择有效的本子类型');

  const frontFileId = validateOrderFileId(
    normalizeFileId(body.front_file_id ?? body.frontFileId),
    orderId
  );
  const backFileId = validateOrderFileId(
    normalizeFileId(body.back_file_id ?? body.backFileId),
    orderId
  );
  if (!template.allow_blank && !frontFileId) {
    throw customerError(400, '活页本请上传封面图片');
  }
  if (template.image_count === 1 && backFileId) {
    throw customerError(400, '当前本子类型不需要后封底图片');
  }

  const now = new Date();
  const updateData = {
    notebook_type: template.slug,
    status: 'submitted',
    updated_at: now,
    submitted_at: now,
    source: 'web'
  };
  const detectedPlatform = detectPlatform(orderId);
  if (!existing || !existing.platform) updateData.platform = detectedPlatform.platform;
  if (Object.prototype.hasOwnProperty.call(body, 'front_file_id')
    || Object.prototype.hasOwnProperty.call(body, 'frontFileId')) {
    updateData.front_file_id = frontFileId;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'back_file_id')
    || Object.prototype.hasOwnProperty.call(body, 'backFileId')) {
    updateData.back_file_id = backFileId;
  }

  const order = existing
    ? await store.updateOrder(existing._id, updateData)
    : await store.createOrder({
      order_id: orderId,
      notebook_type: template.slug,
      platform: detectedPlatform.platform,
      shop: '',
      product_name: '',
      remark: '',
      quantity: 1,
      status: 'submitted',
      front_file_id: frontFileId,
      back_file_id: backFileId,
      created_at: now,
      updated_at: now,
      submitted_at: now,
      source: 'web'
    });

  return toPublicOrder(order || { order_id: orderId, ...updateData }, template);
}

module.exports = {
  getCustomerImage,
  getCustomerImageUrls,
  getCustomerOrder,
  uploadCustomerImages,
  saveCustomerOrder
};
