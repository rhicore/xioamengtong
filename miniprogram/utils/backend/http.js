const { HTTP_API_BASE_URL } = require('../config');

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${HTTP_API_BASE_URL}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: options.header || {},
      success(response) {
        const payload = response.data || {};
        if (response.statusCode >= 200 && response.statusCode < 300 && payload.code === 200) {
          resolve(payload.data);
          return;
        }
        reject(new Error(payload.message || '服务器请求失败'));
      },
      fail(error) {
        reject(new Error(error.errMsg || '服务器连接失败'));
      }
    });
  });
}

function uploadFile(orderId, side, filePath) {
  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${HTTP_API_BASE_URL}/api/v1/customer/orders/${encodeURIComponent(orderId)}/images`,
      filePath,
      name: side,
      success(response) {
        const payload = JSON.parse(response.data || '{}');
        if (response.statusCode >= 200 && response.statusCode < 300 && payload.code === 200) {
          resolve(payload.data);
          return;
        }
        reject(new Error(payload.message || '图片上传失败'));
      },
      fail(error) {
        reject(new Error(error.errMsg || '图片上传失败'));
      }
    });
  });
}

async function getOrder(orderId) {
  const order = await request(`/api/v1/customer/orders/${encodeURIComponent(orderId)}`);
  return {
    ...order,
    front_url: order.front_url || '',
    back_url: order.back_url || ''
  };
}

async function saveOrderImages(orderId, notebookType, files) {
  const uploads = [];
  if (files.front && files.front.path && !/^https?:\/\//i.test(files.front.path)) {
    uploads.push(() => uploadFile(orderId, 'front', files.front.path));
  }
  if (files.back && files.back.path && !/^https?:\/\//i.test(files.back.path)) {
    uploads.push(() => uploadFile(orderId, 'back', files.back.path));
  }

  const uploaded = await uploads.reduce((promise, upload) => promise.then(upload), Promise.resolve({}));
  return request(`/api/v1/customer/orders/${encodeURIComponent(orderId)}`, {
    method: 'PUT',
    data: {
      notebook_type: notebookType,
      front_file_id: uploaded.front_file_id || (files.front && files.front.fileId) || null,
      back_file_id: uploaded.back_file_id || (files.back && files.back.fileId) || null
    }
  });
}

module.exports = {
  getOrder,
  saveOrderImages
};
