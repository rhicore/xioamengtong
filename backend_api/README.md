# Backend API

这是顾客网页和运维网页共用的 HTTP API/BFF。它负责：

- `/api/v1/customer/*`：顾客订单查询、图片读取、图片上传和提交；
- `/api/v1/admin/*`：staff_accounts 账号密码校验、HttpOnly admin_session 会话、订单查询和按订单目录生成 ZIP；
- 管理员创建、禁用账号和修改其他账号密码；
- 普通用户修改自己的密码。

网页不再使用 CloudBase Web Auth，也不直接读取 CloudBase 数据库、云存储或服务密钥。

## 本地运行

```powershell
npm install
Copy-Item .env.example .env
$env:CLOUDBASE_ENV_ID='xiaomengtong-d5g5zuan5ae97c4ea'
$env:PORT='8787'
node server.js
```

本地运行或云托管运行时，后台优先读取服务端 `CLOUDBASE_APIKEY`，也兼容腾讯云
`TENCENTCLOUD_SECRETID` 和 `TENCENTCLOUD_SECRETKEY`。这些值只给 Node 服务端使用，不能提交到
仓库，也不能放进 `admin_web`。这里的 `CLOUDBASE_APIKEY` 必须是 CloudBase 控制台创建的服务端
API Key，不是前端使用的 Publishable Key。

如果容器日志提示 `missing secretId or secretKey`，说明当前容器没有读取到任何服务端凭证。
请在云托管服务版本的环境变量中配置 `CLOUDBASE_APIKEY`。浏览器永远不应该拿到这个变量。

本地网页通过 Vite /api 代理访问 http://localhost:8787。

## CloudBase 云托管

首次部署前，需要在 CloudBase 控制台为当前环境开通“云托管”资源；如果 CLI 返回“云托管资源未开通”，不是代码或授权错误。

```powershell
tcb cloudrun deploy --env-id xiaomengtong-d5g5zuan5ae97c4ea --service-name notebook-backend-api --source backend_api --port 8787 --open-access-types PUBLIC --min-num 1 --wait
```

`--min-num 1` 用于保留一个热实例，避免低频访问时服务缩容到 0 后产生冷启动延迟；如果更看重最低成本，可以改成 `--min-num 0`，但用户第一次打开时可能需要等待容器唤醒。

### 顾客端性能链路

顾客查询接口支持 `?preview=0` 快速模式。顾客网页先拿订单、类型和文件 ID，页面立即显示；已有图片通过图片接口在后台并行读取，不再阻塞订单页面。图片上传也会并行上传前后图片，并使用快速模式跳过无用的临时预览地址生成。

管理端订单列表也使用 `preview=0` 快速返回，列表先显示，缩略图通过受保护的 `/api/v1/admin/order-previews` 接口后台批量补齐。批量下载使用有限并发读取图片，避免逐张串行等待；ZIP 对已经压缩的图片使用低压缩级别，优先保证生成速度。

部署后需要在云托管服务环境变量中设置以下非敏感变量：

- CLOUDBASE_ENV_ID=xiaomengtong-d5g5zuan5ae97c4ea
- ADMIN_CORS_ORIGINS=https://你的静态托管域名,http://localhost:5175,http://localhost:5176
- ADMIN_COOKIE_SAMESITE=None

当前 CLI 的 `tcb cloudrun deploy` 没有直接的环境变量参数。可以通过 CLI 的通用 CloudRun API
提交配置差异；下面是本项目当前环境已经验证过的接口形态（Windows PowerShell 需要通过
`cmd.exe` 保留 JSON 双引号）：

```powershell
cmd.exe /d /s /c 'pnpm.cmd dlx --package=@cloudbase/cli tcb api tcbr SubmitServerConfigChangeDiff --api-version 2022-02-17 --body "{\"EnvId\":\"你的环境ID\",\"ServerName\":\"notebook-backend-api\",\"Items\":[{\"Key\":\"EnvParam\",\"Value\":\"{\\\"CLOUDBASE_ENV_ID\\\":\\\"你的环境ID\\\",\\\"ADMIN_CORS_ORIGINS\\\":\\\"你的静态托管域名,http://localhost:5175,http://localhost:5176\\\",\\\"ADMIN_COOKIE_SAMESITE\\\":\\\"None\\\"}\"}]}" --json'
```

返回 `TaskId` 后，可用下面的命令查询配置任务；状态为 `finished` 后再访问服务：

```powershell
cmd.exe /d /s /c 'pnpm.cmd dlx --package=@cloudbase/cli tcb api tcbr DescribeServerManageTask --api-version 2022-02-17 --body "{\"EnvId\":\"你的环境ID\",\"ServerName\":\"notebook-backend-api\",\"TaskId\":任务ID}" --json'
```

这次实际部署中，以上配置和服务端 API Key 已经在云托管版本中配置并核验成功。服务端 API Key
只存在于云托管容器环境变量中，不会进入仓库或网页。

云托管服务本身通过服务端身份访问 CloudBase，浏览器只持有 HttpOnly 会话 Cookie。
