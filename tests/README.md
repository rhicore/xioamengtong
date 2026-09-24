# 本地测试

在项目根目录执行以下命令：

```powershell
node tests/run-backend-api-tests.js
node tests/run-customer-api-tests.js
node tests/run-admin-web-tests.js
node tests/run-customer-web-tests.js
```

## 测试范围

### `run-backend-api-tests.js`

使用内存 store 验证后台登录、会话、角色权限、账号管理和 CORS 行为，不连接线上数据库。

### `run-customer-api-tests.js`

使用内存 store 验证订单查询、首次创建、重复修改、两图/一张图校验、图片上传和临时预览 URL。

### `run-admin-web-tests.js`

验证后台 HTTP 协议、平台和相对时间显示逻辑，并执行一次 `admin_web` 生产构建。

### `run-customer-web-tests.js`

验证顾客端关键文案、接口调用、编辑器入口和生产构建。

测试不会写入 CloudBase 生产数据库，不需要账号密码或 API Key。真正部署前还应在 CloudBase 控制台确认集合权限和云托管环境变量。
