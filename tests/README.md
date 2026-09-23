# 本地测试

## 云函数业务测试

在项目根目录执行：

```powershell
node tests/run-cloud-tests.js
```

脚本不会连接真实 CloudBase，而是在内存中模拟数据库、云存储临时 URL 和后台 OPENID，覆盖：

- 不存在的订单号可以开始提交；
- 首次提交自动创建订单；
- 同一订单号再次提交可以修改本子类型和图片；
- 胶套本、车线本允许空白提交；
- 活页本必须上传封面图；
- 后台按商品名和日期筛选订单；
- 后台批量 ZIP 下载可以生成临时下载链接，并验证每个订单目录及 `订单信息.json`；
- 后台本册类型支持按关键词匹配显示名称，并返回全部可选本册类型；
- 后台时间格式化覆盖“刚刚、分钟前、今天、昨天”等相对时间；
- 四个云函数入口可以被加载。

如果真实云端返回数据库错误，优先检查 `orders` 集合是否存在，以及集合权限是否设置为“仅云函数可读写”。

如需模拟较旧的云函数 Node.js 运行时，可以使用 Node.js 10 运行同一个脚本：

```powershell
node-v10.15.3-win-x64\node.exe tests/run-cloud-tests.js
```

另外可以不使用 mock，直接加载真实 `wx-server-sdk` 和云函数依赖：

```powershell
node tests/run-real-entry-load.js
```

小程序上传适配器测试：

```powershell
node tests/run-miniprogram-upload-test.js
```

小程序上传页面级测试（模拟选择前封面、后封底，并验证两次 `wx.cloud.uploadFile` 和最终云函数参数）：

```powershell
node tests/run-miniprogram-page-test.js
```

后台网页协议和生产构建测试：

```powershell
node tests/run-admin-web-tests.js
```

这个测试会校验 CloudBase/HTTP adapter 共用的返回值协议，并执行一次 `admin_web` 的 Vite 生产构建；它不登录云端、不写入数据库、不上传文件。
