// 在微信开发者工具创建 CloudBase 环境后，把环境 ID 填到这里。
// 小程序只通过 wx.cloud 调用云函数、云存储和云数据库，不再保存 HTTP API 地址。
const CLOUDBASE_ENV_ID = 'xiaomengtong-d5g5zuan5ae97c4ea';
const BACKEND_MODE = 'cloudbase';
const HTTP_API_BASE_URL = 'https://api.example.com';

module.exports = {
  CLOUDBASE_ENV_ID,
  BACKEND_MODE,
  HTTP_API_BASE_URL
};
