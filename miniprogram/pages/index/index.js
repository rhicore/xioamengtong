const { fetchOrderDetails } = require('../../utils/order');

Page({
  data: {
    orderId: '',
    errorMsg: '',
    loading: false
  },

  onOrderIdInput(event) {
    this.setData({
      orderId: event.detail.value,
      errorMsg: ''
    });
  },

  async onSubmit() {
    const orderId = this.data.orderId.trim();
    if (!orderId || this.data.loading) return;

    this.setData({ loading: true, errorMsg: '' });
    wx.showLoading({ title: '准备中' });

    try {
      await fetchOrderDetails(orderId);
      wx.hideLoading();
      wx.navigateTo({
        url: `/pages/upload/upload?orderId=${encodeURIComponent(orderId)}`
      });
    } catch (error) {
      wx.hideLoading();
      this.setData({ errorMsg: error.message || '订单号处理失败，请稍后重试' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
