'use strict';

const assert = require('assert');

const templates = [
  {
    slug: 'jiaotao',
    display_name: '胶套本 A5/B5',
    image_count: 2,
    aspect_ratio: '3:4',
    allow_blank: true
  },
  {
    slug: 'chexian',
    display_name: '车线本 A5/B5',
    image_count: 2,
    aspect_ratio: '3:4',
    allow_blank: true
  },
  {
    slug: 'huoye',
    display_name: '活页本 A5/B5',
    image_count: 1,
    aspect_ratio: '3:4',
    allow_blank: false
  }
];

const functionCalls = [];
const uploadedPaths = [];
let chooseCount = 0;
let pageDefinition;

global.Page = (definition) => {
  pageDefinition = definition;
};

global.wx = {
  chooseMedia(options) {
    const side = chooseCount === 0 ? 'front' : 'back';
    chooseCount += 1;
    // 微信开发者工具模拟器可能返回 http://usr/... 形式的本地临时路径。
    options.success({ tempFiles: [{ tempFilePath: `http://usr/${side}.jpg` }] });
  },
  showLoading() {},
  hideLoading() {},
  showToast() {},
  navigateBack() {},
  cloud: {
    getTempFileURL(options) {
      options.success({ fileList: [] });
    },
    uploadFile(options) {
      uploadedPaths.push(options.filePath);
      options.success({ fileID: `cloud://test/orders/1/${uploadedPaths.length}.jpg` });
    },
    callFunction(options) {
      functionCalls.push({ name: options.name, data: options.data });
      if (options.name === 'getOrder') {
        options.success({
          result: {
            code: 200,
            data: {
              order_id: '1',
              exists: false,
              notebook_type: '',
              front_file_id: null,
              back_file_id: null,
              templates
            }
          }
        });
        return;
      }
      options.success({
        result: {
          code: 200,
          data: {
            order_id: '1',
            notebook_type: 'chexian',
            front_file_id: 'cloud://test/orders/1/1.jpg',
            back_file_id: 'cloud://test/orders/1/2.jpg'
          }
        }
      });
    }
  }
};

const originalSetTimeout = global.setTimeout;
global.setTimeout = (callback) => {
  callback();
  return 0;
};

require('../miniprogram/pages/upload/upload');

function createPage() {
  const page = Object.assign({}, pageDefinition);
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page.setData = (patch) => {
    page.data = Object.assign({}, page.data, patch);
  };
  return page;
}

(async () => {
  const page = createPage();
  await page.onLoad({ orderId: '1' });
  page.selectType({ currentTarget: { dataset: { slug: 'chexian' } } });
  await page.chooseImage({ currentTarget: { dataset: { side: 'front' } } });
  await page.chooseImage({ currentTarget: { dataset: { side: 'back' } } });

  assert.strictEqual(page.data.images.front.path, 'http://usr/front.jpg');
  assert.strictEqual(page.data.images.back.path, 'http://usr/back.jpg');

  await page.submit();

  assert.deepStrictEqual(uploadedPaths, ['http://usr/front.jpg', 'http://usr/back.jpg']);
  const saveCall = functionCalls.find((item) => item.name === 'saveOrderImages');
  assert(saveCall, 'saveOrderImages should be called');
  assert.strictEqual(saveCall.data.frontFileId, 'cloud://test/orders/1/1.jpg');
  assert.strictEqual(saveCall.data.backFileId, 'cloud://test/orders/1/2.jpg');

  console.log('miniprogram page upload flow passed');
})()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => {
    global.setTimeout = originalSetTimeout;
  });
