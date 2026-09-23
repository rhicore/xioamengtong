# Admin Web 独立账号认证方案

当前方案已落地到 backend_api/：Admin Web 使用项目自己的 HTTP API 和 HttpOnly 会话，不再使用 CloudBase Web Auth。CloudBase 只由服务端访问数据库和云存储。

## 1. 目标

Admin Web 使用项目自己的员工账号体系，不再要求员工拥有或输入 CloudBase Auth 用户名密码。

员工只需要使用 `staff_accounts` 中维护的账号和密码登录后台。CloudBase 只作为后台服务使用的数据库、云存储和云函数运行环境；CloudBase Auth 不再参与员工的登录流程。

本方案只调整 Admin Web 的认证链路，不改变顾客小程序当前的微信云开发链路。

## 2. 当前问题

当前 Admin Web 直接使用 CloudBase Web SDK：

```text
Admin Web
  -> CloudBase Auth signInWithPassword
  -> 获取 CloudBase 用户 UID
  -> 调用后台 HTTP 订单和下载接口
  -> 云函数根据 UID 查询 staff_accounts
```

当前的 `staff_accounts` 只保存 CloudBase UID 和禁用状态，并不保存员工登录密码。因此它是权限白名单，不是真正的账号表。

这种实现会导致员工登录依赖 CloudBase Auth。目标方案应改为：

```text
Admin Web
  -> 项目自己的后台登录接口
  -> 后台校验 staff_accounts 账号密码
  -> 后台创建自己的登录会话
  -> 后台使用服务端权限访问 CloudBase
```

## 3. 目标架构

```text
员工浏览器
  |
  | HTTPS /api/v1/admin/*
  v
backend_api / BFF
  |-- 校验 staff_accounts
  |-- 管理 session 或 JWT
  |-- 访问 CloudBase 数据库
  |-- 访问 CloudBase 云存储
  `-- 调用或承载订单查询、批量下载逻辑

CloudBase
  |-- orders
  |-- notebook_templates
  |-- staff_accounts
  |-- staff_sessions（如果使用服务端会话）
  `-- 云存储
```

前端不直接读取 CloudBase 数据库，不持有 CloudBase 服务密钥，也不直接使用 CloudBase Web Auth。

## 4. `staff_accounts` 数据模型

建议将 `staff_accounts` 改成真正的员工账号表：

```json
{
  "username": "printer01",
  "password_hash": "$2b$12$...",
  "role": "operator",
  "disabled": false,
  "created_at": "2026-09-22T00:00:00.000Z",
  "updated_at": "2026-09-22T00:00:00.000Z"
}
```

字段规则：

- `username`：后台登录名，必须唯一，建议统一转为小写后比较。
- `password_hash`：只保存 Argon2id 或 bcrypt 哈希，禁止保存明文密码。
- 不保存姓名：账号只需要登录 ID 和密码，角色与禁用状态由管理员维护。
- `role`：为以后区分管理员、打印人员等角色预留。
- `disabled`：禁用账号时设为 `true`，不删除历史数据。
- `created_at`、`updated_at`：审计和账号维护时间。

原来的 `uid` 字段不再参与员工登录校验。迁移期间可以保留 `legacy_cloudbase_uid`，用于追溯旧账号，但新登录逻辑不应依赖它。

## 5. 登录流程

### 5.1 登录接口

```http
POST /api/v1/admin/login
Content-Type: application/json

{
  "username": "printer01",
  "password": "员工输入的密码"
}
```

后台执行：

1. 按 `username` 查询 `staff_accounts`。
2. 如果账号不存在、密码错误或账号已禁用，统一返回登录失败。
3. 使用 Argon2id/bcrypt 校验密码哈希。
4. 创建后台自己的登录会话。
5. 返回员工的基本信息，不返回密码哈希。

推荐使用 HttpOnly Cookie：

```http
Set-Cookie: admin_session=<opaque-session-id>; HttpOnly; Secure; SameSite=None; Path=/
```

不要把长期有效的服务端凭证放进 `localStorage`。如果部署环境无法使用 Cookie，再考虑短时效 JWT，并配合刷新机制和撤销策略。

### 5.2 当前登录状态

```http
GET /api/v1/admin/me
```

未登录或会话失效时返回 `401`；登录成功时返回：

```json
{
  "code": 200,
  "data": {
    "username": "printer01",
    "role": "operator"
  }
}
```

### 5.3 登出接口

```http
POST /api/v1/admin/logout
```

后台撤销或删除当前会话，并清除 Cookie。

## 6. 会话存储

推荐使用服务端会话，而不是把完整登录状态放在浏览器中。

可以新增 `staff_sessions` 集合：

```json
{
  "token_hash": "sha256(session-token)",
  "staff_account_id": "staff-document-id",
  "created_at": "2026-09-22T00:00:00.000Z",
  "expires_at": "2026-09-22T08:00:00.000Z",
  "revoked_at": null,
  "last_seen_at": "2026-09-22T01:00:00.000Z"
}
```

浏览器只拿到随机的 session token，数据库只保存 token 的哈希值。后台每次请求通过 Cookie 找到会话，再检查：

- 会话是否存在；
- 是否已过期；
- 是否已撤销；
- 对应员工账号是否仍然存在且未禁用。

如果采用 JWT，也必须在每次请求中检查员工账号是否被禁用，不能只验证 JWT 签名。

## 7. 后台接口权限边界

登录接口可以被未登录用户调用，但这不意味着 `staff_accounts` 集合可以被客户端读取。

正确的边界是：

```text
未登录客户端
  -> 只能调用 /admin/login
  -> 后台内部查询 staff_accounts
  -> 不返回账号表内容

已登录客户端
  -> 调用 /admin/me
  -> 调用订单查询和批量下载接口

CloudBase 数据库/云存储
  -> 只允许后台服务端或云函数访问
```

数据库权限建议继续设置为客户端不可直接读写。后台使用 `@cloudbase/node-sdk` 或云函数服务端 SDK 访问 CloudBase，不把服务端密钥发给浏览器。

## 8. 订单接口迁移

Admin Web 应改为使用自己的 HTTP 适配器，不再调用 CloudBase Web SDK：

```text
GET  /api/v1/admin/orders
POST /api/v1/admin/batch-download
```

当前网页已经预留了 HTTP 适配器：

- `admin_web/src/backend/http.js`
- `admin_web/src/backend/index.js`

当前已实现：

- `signIn(username, password)`：调用 `/api/v1/admin/login`。
- `getCurrentUser()`：调用 `/api/v1/admin/me`。
- `signOut()`：调用 `/api/v1/admin/logout`。
- `listOrders(filters)`：请求订单列表接口。
- `batchDownload(orderIds)`：请求批量下载接口。

账号管理接口也已实现：管理员可以列出、创建、禁用/启用账号并修改其他账号密码；普通用户只能修改自己的密码。

原来的 `adminListOrders` 和 `adminBatchDownload` 云函数已经删除。订单筛选和批量下载逻辑已迁移到 `backend_api`，由同一个通用 HTTP 服务完成会话校验、权限控制和 CloudBase 服务端访问。小程序兼容的 `getOrder`、`saveOrderImages` 仍然保留，直到小程序端完全迁移到顾客网页。

## 9. 安全要求

- 生产环境必须使用 HTTPS。
- 密码只在登录请求中传输，服务端只保存密码哈希。
- 登录失败统一返回“账号或密码错误”，不要暴露账号是否存在。
- 登录接口增加 IP/账号维度的失败次数限制和短暂锁定。
- Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Lax` 或更严格配置。
- 如果前后端跨域使用 Cookie，需要配置明确的 CORS Origin，不能使用 `*`。
- 使用 Cookie 时，需要考虑 CSRF 防护。
- CloudBase 服务端密钥、JWT 密钥和会话签名密钥只能放在服务端环境变量或密钥管理中。
- 后台接口必须在服务端检查账号是否被禁用，不能只依赖前端状态。
- 记录登录成功、登录失败、登出和批量下载等审计事件，但不要记录密码或完整 session token。

## 10. 与小程序的关系

小程序继续使用现有链路，不需要改成员工账号体系：

```text
小程序
  -> wx.cloud.callFunction(getOrder)
  -> wx.cloud.uploadFile
  -> wx.cloud.callFunction(saveOrderImages)
```

小程序用户和 Admin Web 后台账号是两套完全不同的身份。员工认证改造不影响顾客订单查询、图片上传和订单提交。

## 11. 实施顺序

本项目已按以下顺序实施：

1. 增加 `username`、`password_hash` 等 `staff_accounts` 字段，并创建 `staff_sessions`。
2. 实现后台登录、当前用户、登出、会话中间件和账号管理。
3. 实现 backend_api 的顾客、订单查询和批量下载接口。
4. 修改 `admin_web/src/backend/http.js`，接入这些接口。
5. 将 `VITE_BACKEND_MODE` 切换为 `http`，配置 `VITE_HTTP_API_BASE_URL`。
6. 验证登录、禁用账号、会话过期、订单查询、批量下载和角色权限。
7. 移除 Admin Web 对 `@cloudbase/js-sdk` 的依赖和 CloudBase Auth 代码。
8. 确认旧的 `staff_accounts.uid` 校验不再是管理端访问条件；旧云函数仅保留兼容部署。
9. 云托管开通后部署 `backend_api`，再将带真实 API 地址的 `admin_web/dist` 和 `customer_web/dist` 发布到 Hosting。

## 12. 验收标准

- 正确的 `staff_accounts` 账号密码可以登录。
- 错误密码不能登录。
- `disabled: true` 的账号不能登录或不能继续访问。
- 未登录不能查询订单或批量下载。
- 登录后刷新页面能够恢复自己的后台会话。
- 登出后旧会话不能继续访问。
- Admin Web 浏览器中不出现 CloudBase Auth 登录请求。
- Admin Web 浏览器中不出现 CloudBase 服务密钥。
- 浏览器不能直接读取 `staff_accounts`、`orders` 或云存储管理数据。
- 小程序原有订单查询和图片提交功能保持正常。
