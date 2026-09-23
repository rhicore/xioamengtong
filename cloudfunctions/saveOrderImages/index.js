const cloud = require('wx-server-sdk');
const {
  getDefaultTemplates,
  normalizeOrderId,
  normalizeTemplate
} = require('./order-core');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function success(data = null, message = 'success') {
  return { code: 200, message, data };
}

function failure(message, code = 400) {
  return { code, message, data: null };
}

function databaseFailure(error) {
  const rawMessage = String((error && (error.errMsg || error.message)) || '');
  const normalized = rawMessage.toLowerCase();
  console.error('saveOrderImages database failed', {
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
  return failure(`订单提交失败：${rawMessage.slice(0, 120) || '云数据库暂时不可用'}`, 500);
}

async function getTemplate(slug) {
  try {
    const result = await db.collection('notebook_templates')
      .where({ slug })
      .limit(1)
      .get();
    if (result.data && result.data.length > 0) return normalizeTemplate(result.data[0]);
  } catch (error) {
    console.warn('notebook_templates unavailable, use built-in templates', error);
  }

  const aliases = { jiaotao_a5: 'jiaotao', chexian_a5: 'chexian', default: 'huoye' };
  const normalizedSlug = aliases[slug] || slug;
  const fallback = getDefaultTemplates().find((item) => item.slug === normalizedSlug);
  return fallback ? normalizeTemplate(fallback) : null;
}

function normalizeFileId(value) {
  if (value === null || value === undefined || value === '') return null;
  const fileId = String(value).trim();
  return fileId || null;
}

function hasField(event, field) {
  return Object.prototype.hasOwnProperty.call(event || {}, field);
}

exports.main = async (event) => {
  let orderId;
  try {
    orderId = normalizeOrderId(event.orderId);
  } catch (error) {
    return failure(error.message);
  }

  const notebookType = String(event.notebookType || '').trim();
  const template = await getTemplate(notebookType);
  if (!template) return failure('请选择有效的本子类型');

  const frontFileId = normalizeFileId(event.frontFileId);
  const backFileId = normalizeFileId(event.backFileId);
  if (!template.allow_blank && !frontFileId) {
    return failure('活页本请上传封面图片');
  }
  if (template.image_count === 1 && backFileId) {
    return failure('当前本子类型不需要后封底图片');
  }

  try {
    const result = await db.collection('orders')
      .where({ order_id: orderId })
      .limit(1)
      .get();
    const existing = result.data && result.data[0];
    const now = new Date();

    if (existing) {
      const updateData = {
        notebook_type: template.slug,
        status: 'submitted',
        updated_at: now,
        submitted_at: now
      };

      // 顾客端每次提交都明确传两个图片字段：null 就代表恢复为空白。
      if (hasField(event, 'frontFileId')) updateData.front_file_id = frontFileId;
      if (hasField(event, 'backFileId')) updateData.back_file_id = backFileId;

      await db.collection('orders').doc(existing._id).update({ data: updateData });
    } else {
      await db.collection('orders').add({
        data: {
          order_id: orderId,
          notebook_type: template.slug,
          platform: '',
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
          source: 'miniprogram'
        }
      });
    }

    return success({
      order_id: orderId,
      notebook_type: template.slug,
      display_name: template.display_name,
      status: 'submitted',
      front_file_id: frontFileId,
      back_file_id: backFileId
    }, '提交成功');
  } catch (error) {
    return databaseFailure(error);
  }
};
