const { callFunction } = require('../request');

async function getOrder(orderId) {
  return callFunction('getOrder', { orderId });
}

function uploadFile(orderId, side, filePath) {
  return new Promise((resolve, reject) => {
    const safeOrderId = String(orderId).replace(/[^a-zA-Z0-9_-]/g, '_');
    wx.cloud.uploadFile({
      cloudPath: `orders/${safeOrderId}/${Date.now()}-${side}.jpg`,
      filePath,
      success(result) {
        if (!result || !result.fileID) {
          console.error('wx.cloud.uploadFile returned no fileID', result);
          reject(new Error('图片上传成功但没有拿到云文件地址，请检查云存储环境')); 
          return;
        }
        resolve(result.fileID);
      },
      fail(error) {
        reject(new Error(error.errMsg || '图片上传失败，请检查云存储权限'));
      }
    });
  });
}

async function saveOrderImages(orderId, notebookType, files) {
  const uploaded = {};

  // 开发者工具里的本地临时文件可能是 http://usr/...，不能把它误判成云端 URL。
  // 是否已经上传只能根据 fileId 判断。
  if (files.front && files.front.path && !files.front.fileId) {
    uploaded.frontFileId = await uploadFile(orderId, 'front', files.front.path);
  } else {
    uploaded.frontFileId = files.front && files.front.fileId ? files.front.fileId : null;
  }
  if (files.back && files.back.path && !files.back.fileId) {
    uploaded.backFileId = await uploadFile(orderId, 'back', files.back.path);
  } else {
    uploaded.backFileId = files.back && files.back.fileId ? files.back.fileId : null;
  }

  const result = await callFunction('saveOrderImages', { orderId, notebookType, ...uploaded });
  if (uploaded.frontFileId && result.front_file_id !== uploaded.frontFileId) {
    throw new Error('前封面图片没有成功保存，请重试');
  }
  if (uploaded.backFileId && result.back_file_id !== uploaded.backFileId) {
    throw new Error('后封底图片没有成功保存，请重试');
  }
  return result;
}

module.exports = {
  getOrder,
  saveOrderImages
};
