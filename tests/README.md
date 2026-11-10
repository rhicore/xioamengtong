# 本地测试

在项目根目录执行以下命令：

```powershell
node tests/run-backend-api-tests.js
node tests/run-customer-api-tests.js
node tests/run-admin-web-tests.js
node tests/run-customer-web-tests.js
node tests/run-crop-geometry-tests.mjs
```

## 线上只读压测

`run-production-load-test.js` 只请求静态页面、订单查询、图片地址和后台订单列表，不上传图片、不创建订单。默认测试并发 `1/5/10`，可通过环境变量调整：

```powershell
$env:LOAD_TEST_ADMIN_USER = "admin"
$env:LOAD_TEST_ADMIN_PASSWORD = "你的密码"
$env:LOAD_TEST_REQUESTS = "24"
node tests/run-production-load-test.js https://xiaomengtong.site
```

测试后台接口时只登录一次并复用会话；不要把密码写进脚本或提交到 Git。高并发测试前应先确认目标环境允许压测。

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

## 本地交互演示

先执行上面的两个网页构建测试，再启动：

```powershell
node tests/local-demo.cjs
```

顾客端 `http://127.0.0.1:5173/`，输入 `DEMO-001` 查看已保存的两组（胶套本 3 本、活页本 2 本），也可以输入新订单号自行上传。管理端 `http://127.0.0.1:5173/admin/`，账号 `demo`，密码 `demo123`。设置 `DEMO_PORT` 可以换端口。

演示直接使用两个网页的正式构建和 `backend_api` 原接口，存储适配器将订单、账号会话和图片保存在被 Git 忽略的 `.local-demo/`，刷新或重启后仍能读取。演示不加载 CloudBase 配置，不访问线上数据。网页没有演示开关或假提交分支。

## 浏览器完整流程测试

安装或指定 Playwright 模块后执行（默认使用本机 Edge，可通过 `BROWSER_CHANNEL` 调整）：

```powershell
# 仅在 Playwright 未安装到项目中时，指定已有模块位置
$env:PLAYWRIGHT_MODULE = '你的 playwright 模块绝对路径'
node tests/run-browser-flow-tests.cjs
node tests/run-admin-refresh-tests.cjs
```

使用独立临时数据验证：全屏裁切的四种窗口尺寸，触控缩放/旋转/拖动，第三根手指加入时画面稳定，裁切预览与 1704 × 2400 JPEG 输出一致，极长/极宽图片缩到最小并拖至边缘、旋转后逐像素检查没有补边，取消与重置，多组数量校验、新增/删除/重新加载、上传失败只重试未完成组、防止重复提交，以及管理端登录、分组预览和 ZIP 图片逐字节核对。测试后清理临时数据。触控测试为浏览器模拟，发布前仍需真机确认手感。

`run-admin-refresh-tests.cjs` 专门复现管理端刷新后旧预览延迟返回的情况，确认旧的单组响应不会覆盖新的多组列表，并检查第二组预览及各组图片的实际下载内容。
