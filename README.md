# 图书定制采集系统

这是一个“顾客输入订单号、选择图片类型、上传并编辑图片，打印人员在后台筛选和下载”的网页系统。当前正式链路已经统一为网页端，不再依赖微信小程序、旧云函数或历史 FastAPI/React 代码。

## 目录结构

```text
customer_web/    顾客上传与图片编辑网页
admin_web/       打印/客服人员使用的后台网页
backend_api/     顾客和后台共用的 HTTP API/BFF
docs/            架构、业务流程、认证和平台识别说明
tests/           本地自动化测试脚本
cloudbaserc.json CloudBase Hosting 配置
```

三个运行目录各自保持边界清晰：两个前端只负责页面和 HTTP 调用，`backend_api` 负责认证、业务校验、CloudBase 数据库/云存储访问和 ZIP 生成。前端不会接触 CloudBase 服务端密钥，也不会直连数据库。

## 运行链路

```text
顾客浏览器 ─┐
            ├─> backend_api 云托管 ─> CloudBase 数据库和云存储
后台浏览器 ─┘
```

顾客输入订单号后，后端查询或创建订单；顾客选择“两图”或“一张图”，在浏览器中完成裁切后上传。再次输入同一订单号会加载已有提交并允许修改。后台员工通过账号密码登录，按条件筛选订单、预览图片和下载按订单分目录整理的压缩包。

平台只根据订单号外形做启发式识别，不与淘宝、拼多多或其他外部平台通信；无法判断时显示“未知平台”。平台识别规则见 [docs/platform-detection.md](docs/platform-detection.md)。

## CloudBase 配置

当前环境 ID 已写入根目录 `cloudbaserc.json`。首次部署前，在 CloudBase 环境中创建以下集合：

- `orders`：订单、本子类型、图片 fileID 和时间字段
- `notebook_templates`：可选的本册类型配置
- `staff_accounts`：后台员工账号和密码哈希
- `staff_sessions`：后台登录会话

服务端还需要在云托管服务版本中配置环境变量：

```text
CLOUDBASE_ENV_ID=你的环境ID
CLOUDBASE_APIKEY=CloudBase 控制台创建的服务端 API Key
ADMIN_CORS_ORIGINS=后台和顾客网页的正式域名，多个域名用逗号分隔
ADMIN_COOKIE_SAMESITE=None
```

生产环境的 `CLOUDBASE_APIKEY` 只能放在 `backend_api` 云托管环境变量中，不能写入前端代码或 Git；本地联调如需访问真实 CloudBase 数据，可以只填写在被 `.gitignore` 忽略的 `backend_api/.env` 中。

## 本地开发

Node.js 建议使用 20.19+ 或 22.12+。Windows 下原来的 PowerShell 命令仍然兼容；macOS/Linux 可以使用下面的命令。仓库现有的 `pnpm-lock.yaml` 和 `package-lock.json` 不要删除。

### macOS/Linux

```bash
cd /Users/rhi/code/xioamengtong/backend_api
pnpm install --frozen-lockfile

cd ../customer_web
pnpm install --frozen-lockfile

cd ../admin_web
npm ci
```

首次使用时复制环境模板（本机已经配置好的 `.env` / `.env.local` 不要提交）：

```bash
cp backend_api/.env.example backend_api/.env
cp customer_web/.env.example customer_web/.env.local
cp admin_web/.env.example admin_web/.env.local
```

本地开发时，三个目录的地址保持一致：backend 使用 `http://localhost:8787`，顾客端的 `VITE_API_BASE_URL` 和后台端的 `VITE_HTTP_API_BASE_URL` 也使用这个地址。

分别在三个终端启动：

```bash
cd backend_api && pnpm start
cd customer_web && pnpm run dev
cd admin_web && npm run dev
```

分别安装三个目录的依赖：

```powershell
cd D:\rhi\code\xiaomengtong\backend_api
npm install

cd ..\customer_web
npm install

cd ..\admin_web
npm install
```

复制各自的 `.env.example` 为 `.env.local`。后台填写：

```text
VITE_HTTP_API_BASE_URL=http://localhost:8787
```

顾客端填写：

```text
VITE_API_BASE_URL=http://localhost:8787
VITE_BACKEND_MODE=http
```

启动 API：

```powershell
cd D:\rhi\code\xiaomengtong\backend_api
$env:CLOUDBASE_ENV_ID="你的环境ID"
$env:CLOUDBASE_APIKEY="仅在本机环境变量中设置，不要写入仓库"
npm start
```

启动顾客端和后台端：

```powershell
cd D:\rhi\code\xiaomengtong\customer_web
npm run dev

cd ..\admin_web
npm run dev
```

## 部署

### 1. 部署通用 API

在项目根目录执行：

```powershell
tcb cloudrun deploy --env-id 你的环境ID --service-name notebook-backend-api --source backend_api --port 8787 --open-access-types PUBLIC --min-num 1 --wait
```

生产环境建议保留一个最小实例，减少低频访问时的冷启动。部署完成后，将服务地址写入两个前端的 `VITE_HTTP_API_BASE_URL` 并重新构建。

### 2. 构建和发布后台

```powershell
cd D:\rhi\code\xiaomengtong\admin_web
npm run build
tcb hosting deploy dist admin -e 你的环境ID
```

### 3. 构建和发布顾客端

```powershell
cd D:\rhi\code\xiaomengtong\customer_web
npm run build
tcb hosting deploy dist customer -e 你的环境ID
```

macOS/Linux 不需要全局安装 CLI，也可以直接使用：

```bash
pnpm dlx --package=@cloudbase/cli tcb login
pnpm dlx --package=@cloudbase/cli tcb cloudrun deploy \
  --env-id xiaomengtong-d5g5zuan5ae97c4ea \
  --service-name notebook-backend-api \
  --source backend_api --port 8787 --open-access-types PUBLIC --min-num 1 --wait

pnpm dlx --package=@cloudbase/cli tcb hosting deploy admin_web/dist admin \
  -e xiaomengtong-d5g5zuan5ae97c4ea
pnpm dlx --package=@cloudbase/cli tcb hosting deploy customer_web/dist customer \
  -e xiaomengtong-d5g5zuan5ae97c4ea
```

### GitHub 上传

本机已经验证 GitHub SSH 身份可用，远程仓库是 `git@github.com:rhicore/xioamengtong.git`。提交前确认不要把 `.env`、`.env.local` 或 CloudBase API Key 加入暂存区：

```bash
git status
git add README.md backend_api customer_web admin_web docs tests cloudbaserc.json
git commit -m "同步项目配置"
git push origin main
```

上面的命令只上传 Git 中已明确加入的文件；本地密钥文件已由 `.gitignore` 忽略。

两个网页可以共用一个 CloudBase Hosting 环境，也可以以后迁移到其他静态托管；只要保持 `VITE_HTTP_API_BASE_URL` 指向通用 API，前端不需要改业务逻辑。

## 测试

在项目根目录执行：

```powershell
node tests/run-backend-api-tests.js
node tests/run-customer-api-tests.js
node tests/run-admin-web-tests.js
node tests/run-customer-web-tests.js
```

这些测试不依赖线上账号，不会写入生产数据库；它们覆盖认证和角色权限、订单查询和上传、批量下载、图片预览、构建产物及顾客端主要协议。

## 未来迁移

如果以后把数据库或对象存储迁移到自有服务器，只需要替换 `backend_api` 的存储实现和环境变量；顾客端和后台端继续调用同一套 HTTP 契约。若以后增加其他网页端，也只需复用顾客接口，不需要复制 CloudBase 访问逻辑。

详细说明见：

- [docs/architecture.md](docs/architecture.md)
- [docs/逻辑流程.md](docs/逻辑流程.md)
- [docs/admin-auth.md](docs/admin-auth.md)
- [backend_api/README.md](backend_api/README.md)
