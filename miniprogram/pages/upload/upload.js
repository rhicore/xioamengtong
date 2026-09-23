const { fetchOrderDetails, uploadOrderImages } = require('../../utils/order');

function chooseImageFile() {
  return new Promise((resolve, reject) => {
    const done = (path) => {
      if (typeof wx.cropImage !== 'function') {
        resolve(path);
        return;
      }

      wx.cropImage({
        src: path,
        cropScale: '3:4',
        success(result) {
          resolve(result.tempFilePath || path);
        },
        fail() {
          // 某些基础库或模拟器没有裁剪接口，仍然允许上传原图。
          resolve(path);
        }
      });
    };

    const onSuccess = (path) => {
      if (path) done(path);
      else reject(new Error('没有选择图片'));
    };

    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success(result) {
          const file = result.tempFiles && result.tempFiles[0];
          onSuccess(file && file.tempFilePath);
        },
        fail(error) {
          reject(new Error(error.errMsg || '选择图片失败'));
        }
      });
      return;
    }

    wx.chooseImage({
      count: 1,
      sourceType: ['album', 'camera'],
      success(result) {
        onSuccess(result.tempFilePaths && result.tempFilePaths[0]);
      },
      fail(error) {
        reject(new Error(error.errMsg || '选择图片失败'));
      }
    });
  });
}

function emptyImage() {
  return { path: '', fileId: '' };
}

function imageFromOrder(url, fileId) {
  return { path: url || '', fileId: fileId || '' };
}

function getClientTempUrl(fileId) {
  return new Promise((resolve) => {
    if (!fileId || !wx.cloud || typeof wx.cloud.getTempFileURL !== 'function') {
      resolve('');
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: [fileId],
      success(result) {
        const item = result.fileList && result.fileList[0];
        resolve(item && item.tempFileURL ? item.tempFileURL : '');
      },
      fail(error) {
        console.warn('client getTempFileURL failed', error);
        resolve('');
      }
    });
  });
}

function downloadClientPreview(fileId) {
  return new Promise((resolve) => {
    if (!fileId || !wx.cloud || typeof wx.cloud.downloadFile !== 'function') {
      resolve('');
      return;
    }

    wx.cloud.downloadFile({
      fileID: fileId,
      success(result) {
        resolve(result.tempFilePath || '');
      },
      fail(error) {
        console.warn('client downloadFile preview failed', error);
        resolve('');
      }
    });
  });
}

async function resolvePreviewUrl(url, fileId) {
  if (url) return url;
  const tempUrl = await getClientTempUrl(fileId);
  if (tempUrl) return tempUrl;
  return downloadClientPreview(fileId);
}

Page({
  data: {
    orderId: '',
    orderData: null,
    templates: [],
    selectedType: '',
    selectedTemplate: null,
    previewWarning: '',
    images: {
      front: emptyImage(),
      back: emptyImage()
    },
    loading: true,
    submitting: false,
    errorMsg: ''
  },

  async onLoad(options) {
    const orderId = decodeURIComponent(options.orderId || '').trim();
    if (!orderId) {
      this.setData({ loading: false, errorMsg: '缺少订单号，请返回首页重新进入' });
      return;
    }

    this.setData({ orderId });
    wx.showLoading({ title: '加载中' });

    try {
      const orderData = await fetchOrderDetails(orderId);
      const templates = orderData.templates || [];
      const selectedType = orderData.notebook_type || '';
      const selectedTemplate = templates.find((item) => item.slug === selectedType) || null;
      const frontPreviewUrl = await resolvePreviewUrl(orderData.front_url, orderData.front_file_id);
      const backPreviewUrl = await resolvePreviewUrl(orderData.back_url, orderData.back_file_id);
      const hasStoredFile = Boolean(orderData.front_file_id || orderData.back_file_id);
      const hasPreview = Boolean(frontPreviewUrl || backPreviewUrl);

      this.setData({
        orderData,
        templates,
        selectedType,
        selectedTemplate,
        previewWarning: hasStoredFile && !hasPreview ? '之前的图片已保存，但当前暂时无法生成预览；你可以继续修改或重新上传。' : '',
        images: {
          front: imageFromOrder(frontPreviewUrl, orderData.front_file_id),
          back: imageFromOrder(backPreviewUrl, orderData.back_file_id)
        },
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false, errorMsg: error.message || '订单信息加载失败' });
    } finally {
      wx.hideLoading();
    }
  },

  selectType(event) {
    if (this.data.submitting) return;

    const slug = event.currentTarget.dataset.slug;
    const template = this.data.templates.find((item) => item.slug === slug);
    if (!template) return;

    const typeChanged = this.data.selectedType && this.data.selectedType !== slug;
    this.setData({
      selectedType: slug,
      selectedTemplate: template,
      // 修改本子类型时不沿用原类型图片，避免把两种规格混在同一订单里。
      images: typeChanged ? { front: emptyImage(), back: emptyImage() } : this.data.images,
      errorMsg: ''
    });
  },

  async chooseImage(event) {
    if (this.data.submitting) return;

    const side = event.currentTarget.dataset.side;
    wx.showLoading({ title: '准备图片' });
    try {
      const path = await chooseImageFile();
      const images = Object.assign({}, this.data.images);
      images[side] = { path, fileId: '' };
      this.setData({ images, errorMsg: '' });
    } catch (error) {
      if (error.message && !error.message.includes('cancel')) {
        wx.showToast({ title: error.message, icon: 'none' });
      }
    } finally {
      wx.hideLoading();
    }
  },

  clearImage(event) {
    if (this.data.submitting) return;
    const side = event.currentTarget.dataset.side;
    const images = Object.assign({}, this.data.images);
    images[side] = emptyImage();
    this.setData({ images });
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  async submit() {
    if (this.data.submitting || !this.data.orderData || !this.data.selectedTemplate) {
      this.setData({ errorMsg: '请先选择本子类型' });
      return;
    }
    if (!this.data.selectedTemplate.allow_blank && !this.data.images.front.path) {
      this.setData({ errorMsg: '活页本请先选择封面图片' });
      return;
    }

    this.setData({ submitting: true, errorMsg: '' });
    wx.showLoading({ title: '提交中' });
    try {
      const images = this.data.selectedTemplate.image_count === 1
        ? { ...this.data.images, back: emptyImage() }
        : this.data.images;
      await uploadOrderImages(this.data.orderId, this.data.selectedType, images);
      wx.hideLoading();
      wx.showToast({ title: '提交成功', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 800);
    } catch (error) {
      wx.hideLoading();
      this.setData({ errorMsg: error.message || '提交失败，请稍后重试' });
      wx.showToast({ title: error.message || '提交失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
