# 图书定制采集系统

这是一个“顾客输入订单号、选择本子类型、上传图片 + 打印人员筛选下载”的微信云开发小程序项目。

当前正式代码不依赖旧 FastAPI 服务，代码按客户端、业务云函数和平台适配层拆开：

```text
miniprogram/       顾客微信小程序
customer_web/      顾客网页端
admin_web/         打印/运维人员网页
backend_api/       顾客和运维通用 HTTP API/BFF
cloudfunctions/    小程序兼容云函数
legacy/            旧 FastAPI/React 代码，仅作迁移参考
docs/              架构和历史接口说明
```

## 部署架构

```text
顾客小程序
  ├── getOrder 云函数
  ├── saveOrderImages 云函数
  └── CloudBase 云存储

顾客网页和打印后台网页
  └── backend_api 云托管服务

微信云开发环境
  ├── orders
  ├── notebook_templates
 ├── staff_accounts
  ├── staff_sessions
 └── 云存储
```

小程序和两个网页端都通过稳定的业务接口访问云端，不直接读写数据库。顾客不需要订单预导入：首次输入订单号会创建记录，再次输入同一个订单号可以修改本子类型和图片。当前不与淘宝、拼多多或其他外部平台通信；平台字段只根据订单号外形做启发式识别，无法确定时留空，店铺、商品名、备注字段仍默认留空。详细说明见 [docs/architecture.md](docs/architecture.md) 和 [docs/platform-detection.md](docs/platform-detection.md)。

## 第一次接入 CloudBase

### 1. 创建环境

在微信开发者工具中打开项目根目录：

```text
D:\rhi\code\xiaomengtong
```

创建或关联 CloudBase 环境，记下环境 ID。然后修改：

```text
miniprogram/utils/config.js
cloudbaserc.json
```

将环境 ID 填入 `CLOUDBASE_ENV_ID` 和 `envId`。

如果环境是在微信开发者工具的“云开发”面板中创建并关联的，通常不需要额外填写 API Key 或绑定安全域名；小程序会通过 `wx.cloud` 自动使用当前环境。只有迁移到独立 CloudBase 环境时，才需要按另一套登录和安全配置流程处理。

### 2. 创建数据库集合

在 CloudBase 控制台创建：

- `orders`：订单数据
- `notebook_templates`：本册配置
- `staff_accounts`：打印人员和运维账号
- `staff_sessions`：后台登录会话

本册类型已经内置在各个运行目录中；如果要在后台动态调整，再把本册配置写入 `notebook_templates`。不需要预先导入订单数据，订单会由顾客首次提交时自动创建。

数据库权限建议先设置为客户端不可直接读写，由云函数使用服务端权限访问；云存储允许小程序登录用户上传，但收紧客户端读取权限，图片预览统一由 `getOrder` 云函数生成临时 URL。

### 3. 部署小程序兼容云函数

每个云函数目录都是独立部署单元：

```powershell
cd D:\rhi\code\xiaomengtong\cloudfunctions\getOrder
npm install
```

`saveOrderImages` 目录同样执行一次 `npm install`，然后在微信开发者工具中右键这两个函数目录并上传部署，或者使用 CloudBase CLI 部署。

函数职责：

- `getOrder`：按订单号读取已有提交，或返回可创建的新订单状态
- `saveOrderImages`：按订单号创建或更新本子类型、图片和提交状态
### 4. 当前小程序链路

微信小程序使用 `wx.cloud` 原生能力，云函数使用 `wx-server-sdk`。这条链路不需要 API Key、HTTPS 域名或额外登录系统，微信会自动携带小程序用户身份。

`staff_accounts` 集合现在是网页后台自己的员工账号表，保存 username、password_hash、role、disabled 和时间字段；`staff_sessions` 保存哈希后的后台会话令牌。小程序用户和网页员工账号是两套完全不同的身份。

顾客端只调用 `getOrder` 和 `saveOrderImages`，不会调用后台管理函数。

### 5. 打印后台网页

`admin_web` 和 `customer_web` 都只调用 `backend_api` HTTP API。网页不使用 CloudBase Web Auth，不接触 CloudBase 账号密码，不直连数据库。`backend_api` 按路由隔离顾客接口和后台接口；订单查询、图片上传、后台筛选和批量下载都集中在这个通用服务中。

启用前需要创建 `staff_sessions` 集合，并初始化一个 role 为 admin 的 staff_accounts 账号。管理员可以在网页中创建账号、修改其他账号密码和启停账号；普通用户只能修改自己的密码。

网页前端本身和小程序仍然是两个独立前端，未来可部署到静态网站托管。构建方式如下：

```powershell
cd D:\rhi\code\xiaomengtong\admin_web
Copy-Item .env.example .env.local
```

编辑 `.env.local`，填写：

```text
VITE_BACKEND_MODE=http
VITE_HTTP_API_BASE_URL=https://你的通用后端地址
```

然后构建：

```powershell
npm install
npm run build
```

构建产物部署到 CloudBase Hosting。打印人员通过静态托管地址或绑定的后台域名访问，例如：

```text
https://admin.example.com
```

如果使用 CLI，可在项目根目录执行 `tcb hosting deploy admin_web/dist -e 你的环境ID`；也可以直接在控制台上传 `admin_web/dist` 文件夹。

通用后端 API 部署到 CloudBase 云托管：

首次使用前需要在 CloudBase 控制台开通当前环境的“云托管”资源。

```powershell
tcb cloudrun deploy --env-id 你的环境ID --service-name notebook-backend-api --source backend_api --port 8787 --open-access-types PUBLIC --wait
```

如果后台健康检查正常但登录查询超时，通常是云托管容器没有服务端运行时凭证。请在云托管服务版本中配置
`CLOUDBASE_APIKEY`；它只给 `backend_api` 使用，不能放进网页或小程序。这里必须使用 CloudBase
控制台创建的服务端 API Key，不是小程序端的 Publishable Key。

部署后的非敏感环境变量也可以通过 CLI 通用 API 设置，详见 [backend_api/README.md](backend_api/README.md)。

### 6. 顾客网页端

顾客网页端代码位于 `customer_web/`，使用 `backend_api` 的 `/api/v1/customer/*` 接口。构建后可以部署到同一 CloudBase Hosting 的 `customer/` 路径：

```powershell
cd D:\rhi\code\xiaomengtong\customer_web
npm install
npm run build
tcb hosting deploy dist customer -e 你的环境ID
```

### 7. 上传小程序

在微信开发者工具中重新编译小程序，确认订单查询和图片上传正常后，上传代码并提交审核。小程序前端部署到微信，后台网页部署到 CloudBase 静态网站托管，两者互不混用。

## 未来迁移到服务器

如果以后要迁移到 FastAPI、Node 或其他服务器后端：

1. 按 [docs/admin-auth.md](docs/admin-auth.md) 中的接口实现 HTTP 服务；
2. 将 `miniprogram/utils/config.js` 的 `BACKEND_MODE` 改成 `http`；
3. 配置 `HTTP_API_BASE_URL`；
4. 将 CloudBase fileID 迁移到服务器对象存储或其他兼容存储。

小程序端和运维网页已经预留了 HTTP adapter，不需要重新设计页面流程。

## 注意事项

- 当前 ZIP 下载函数适合中小批量图片；大批量高清图片应迁移到 CloudBase 云托管，采用异步生成下载包。
- 正式上线前必须配置数据库和云存储安全规则：数据库建议禁止客户端直接读写，图片读取通过云函数生成临时 URL；云存储仅开放必要的上传权限。
- `legacy/` 中的代码不参与当前运行链路，不要把它当作 CloudBase 后端部署。

## 本地测试

云函数业务测试不连接真实云环境，使用内存模拟数据库和云存储：

```powershell
node tests/run-cloud-tests.js
```

测试脚本也可以用旧版 Node.js 运行时执行，用来提前检查云函数语法和依赖兼容性，具体说明见 [tests/README.md](tests/README.md)。
