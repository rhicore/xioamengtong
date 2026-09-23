function callFunction(name, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success(response) {
        const payload = response.result || {};
        if (payload.code === 200) {
          resolve(payload.data);
          return;
        }
        reject(new Error(payload.message || '云函数处理失败'));
      },
      fail(error) {
        reject(new Error(error.errMsg || '云开发请求失败，请检查环境 ID 和云函数部署状态'));
      }
    });
  });
}

module.exports = {
  callFunction
};
