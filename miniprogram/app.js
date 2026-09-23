const { BACKEND_MODE, CLOUDBASE_ENV_ID } = require('./utils/config');

App({
  globalData: {
    appName: '图书定制采集系统',
    cloudReady: false
  },

  onLaunch() {
    if (BACKEND_MODE !== 'cloudbase') return;

    if (!wx.cloud) {
      console.error('当前基础库不支持 CloudBase，请升级微信开发者工具基础库');
      return;
    }

    wx.cloud.init({
      env: CLOUDBASE_ENV_ID,
      traceUser: true
    });

    this.globalData.cloudReady = true;
  }
});
