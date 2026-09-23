'use strict';

const assert = require('assert');

let captured;
let uploadCount = 0;

global.wx = {
  cloud: {
    uploadFile(options) {
      uploadCount += 1;
      options.success({ fileID: `cloud://mock/${options.filePath}` });
    },
    callFunction(options) {
      captured = options.data;
      options.success({
        result: {
          code: 200,
          data: {
            front_file_id: captured.frontFileId,
            back_file_id: captured.backFileId
          }
        }
      });
    }
  }
};

const backend = require('../miniprogram/utils/backend/cloudbase');

backend.saveOrderImages('1', 'chexian', {
  front: { path: 'tmp/front.jpg', fileId: '' },
  back: { path: 'tmp/back.jpg', fileId: '' }
}).then(() => {
  assert.strictEqual(uploadCount, 2);
  assert.strictEqual(captured.orderId, '1');
  assert.strictEqual(captured.notebookType, 'chexian');
  assert.strictEqual(captured.frontFileId, 'cloud://mock/tmp/front.jpg');
  assert.strictEqual(captured.backFileId, 'cloud://mock/tmp/back.jpg');
  console.log('miniprogram upload adapter test passed');
}).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
