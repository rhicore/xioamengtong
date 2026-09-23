require('dotenv').config();
const cloudbase = require('@cloudbase/node-sdk');
const { createApp } = require('./src/app');
const { createCloudbaseStore } = require('./src/cloudbase-store');

const envId = process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || 'xiaomengtong-d5g5zuan5ae97c4ea';
const cloudbaseApp = cloudbase.init({
  env: envId,
  ...(process.env.CLOUDBASE_APIKEY && { accessKey: process.env.CLOUDBASE_APIKEY }),
  ...(process.env.TENCENTCLOUD_SECRETID && { secretId: process.env.TENCENTCLOUD_SECRETID }),
  ...(process.env.TENCENTCLOUD_SECRETKEY && { secretKey: process.env.TENCENTCLOUD_SECRETKEY })
});
const app = createApp({
  store: createCloudbaseStore({ app: cloudbaseApp }),
  env: process.env.NODE_ENV || 'production'
});
const port = Number(process.env.PORT) || 8787;

app.listen(port, '0.0.0.0', () => {
  console.log('backend api listening on ' + port);
});
