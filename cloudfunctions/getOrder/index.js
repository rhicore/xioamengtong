const cloud = require('wx-server-sdk');
const {
  getDefaultTemplates,
  normalizeOrderId,
  normalizeTemplate,
  toPublicOrder
} = require('./order-core');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function success(data = null, message = 'success') {
  return { code: 200, message, data };
}

function failure(message, code = 400) {
  return { code, message, data: null };
}

function databaseFailure(error, action) {
  const rawMessage = String((error && (error.errMsg || error.message)) || '');
  const normalized = rawMessage.toLowerCase();
  console.error(`getOrder ${action} failed`, {
    errCode: error && error.errCode,
    errMsg: rawMessage,
    stack: error && error.stack
  });

  if (normalized.includes('permission') || normalized.includes('denied') || rawMessage.includes('权限')) {
    return failure('云数据库权限不足，请将 orders 集合设置为“仅云函数可读写”', 403);
  }
  if (normalized.includes('collection') && (normalized.includes('not exist') || normalized.includes('not found')) || rawMessage.includes('集合不存在')) {
    return failure('还没有创建 orders 数据库集合，请在云开发控制台创建后重试', 500);
  }
  return failure(`${action}失败：${rawMessage.slice(0, 120) || '云数据库暂时不可用'}`, 500);
}

function mergeTemplates(items) {
  const defaults = getDefaultTemplates();
  const configured = new Map((items || []).map((item) => [item.slug, item]));
  return defaults.map((item) => normalizeTemplate(
    Object.assign({}, item, configured.get(item.slug) || {})
  ));
}

async function getTemplates() {
  try {
    const result = await db.collection('notebook_templates').limit(100).get();
    return mergeTemplates(result.data);
  } catch (error) {
    // 首次部署或集合尚未创建时，顾客仍然可以按内置目录提交。
    return mergeTemplates([]);
  }
}

function findTemplate(templates, slug) {
  const aliases = {
    jiaotao_a5: 'jiaotao',
    chexian_a5: 'chexian',
    default: 'huoye'
  };
  const normalizedSlug = aliases[slug] || slug;
  return templates.find((item) => item.slug === normalizedSlug) || null;
}

async function getTempUrlMap(fileIds) {
  const validFileIds = fileIds.filter(Boolean);
  if (validFileIds.length === 0) return {};

  try {
    const result = await cloud.getTempFileURL({ fileList: validFileIds });
    return (result.fileList || [])
      .filter((item) => item.fileID && item.tempFileURL)
      .reduce((map, item) => {
        map[item.fileID] = item.tempFileURL;
        return map;
      }, {});
  } catch (error) {
    console.error('getTempFileURL failed', error);
    return {};
  }
}

exports.main = async (event) => {
  let orderId;
  try {
    orderId = normalizeOrderId(event.orderId);
  } catch (error) {
    return failure(error.message);
  }

  try {
    const templates = await getTemplates();
    const result = await db.collection('orders')
      .where({ order_id: orderId })
      .limit(1)
      .get();

    const order = result.data && result.data[0];
    if (!order) {
      return success({
        exists: false,
        order_id: orderId,
        notebook_type: '',
        display_name: '',
        status: 'draft',
        front_file_id: '',
        back_file_id: '',
        front_url: '',
        back_url: '',
        templates
      }, '订单号可以使用');
    }

    const template = findTemplate(templates, order.notebook_type) || templates[0];
    const publicOrder = toPublicOrder(order, template);
    const urlMap = await getTempUrlMap([order.front_file_id, order.back_file_id]);

    return success(Object.assign({}, publicOrder, {
      exists: true,
      front_file_id: order.front_file_id || '',
      back_file_id: order.back_file_id || '',
      front_url: urlMap[order.front_file_id] || '',
      back_url: urlMap[order.back_file_id] || '',
      templates
    }));
  } catch (error) {
    return databaseFailure(error, '订单信息查询');
  }
};
