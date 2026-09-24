# 运维后台网页

这个目录只负责打印/客服人员使用的网页，独立构建和发布。

当前网页只调用 backend_api HTTP API。员工账号和密码由项目自己的 staff_accounts 账号体系维护，网页不使用 CloudBase Web Auth，不保存 CloudBase API Key，也不直连数据库。

代码通过 `src/backend/index.js` 隔离后端适配器。当前固定使用 HTTP API；将来迁移到普通服务器时，只需替换 `VITE_HTTP_API_BASE_URL`，页面层不需要改写。

## 本地开发

```powershell
Copy-Item .env.example .env.local
# 编辑 .env.local，填写 backend_api 地址
npm install
npm run dev
```

正式启用前需要在 CloudBase 控制台完成一次集合配置：

1. 创建 staff_sessions 集合。
2. 将 staff_accounts 调整为账号表，至少包含：

   ```json
   {
     "username": "printer01",
     "password_hash": "bcrypt 哈希",
     "role": "operator",
     "created_at": "2026-09-22T00:00:00.000Z",
     "updated_at": "2026-09-22T00:00:00.000Z",
     "disabled": false
   }
   ```

3. 由 backend_api 服务端访问 CloudBase；浏览器不获得集合权限。

当前页面展示订单号、本册类型、状态和日期筛选。本册类型支持输入关键词，也可以点击输入框从当前模板目录中选择。订单列表会单独显示上传时间和修改时间，并按“刚刚、分钟前、今天、昨天、X天前”的方式简化显示。管理员可以打开账号管理界面创建账号、修改其他账号密码和禁用账号；普通用户只能修改自己的密码。

## 发布

```powershell
npm run build
cd ..
# 首次使用先执行：npm i -g @cloudbase/cli && tcb login
tcb hosting deploy admin_web/dist -e 你的环境ID
```

网页文件部署在 CloudBase 静态托管（Hosting）。正式域名、HTTPS、访问配置和认证方式在 CloudBase 控制台管理。

部署前可在项目根目录执行：

```powershell
node tests/run-admin-web-tests.js
```

这个测试只做本地协议断言和生产构建，不会修改 CloudBase 数据。

生产环境的 `.env.local` 需要配置 `VITE_HTTP_API_BASE_URL=https://你的通用后端地址`。
