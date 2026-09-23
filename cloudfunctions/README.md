# 微信云开发云函数

当前项目使用的是微信开发者工具里的“微信云开发”环境。顾客端函数使用内置的 `wx-server-sdk` 访问数据库和云存储；普通云函数通过 `cloud.DYNAMIC_CURRENT_ENV` / `SYMBOL_CURRENT_ENV` 自动连接当前部署环境，不需要把 API Key 放进代码。

网页后台和顾客网页现在由根目录的 `backend_api/` 统一提供 HTTP API、员工账号认证、顾客上传和批量下载能力。`admin_web/`、`customer_web/` 不再使用 CloudBase Web Auth，也不再依赖后台云函数。

## 函数职责

每个函数目录都是独立部署单元；函数根目录内包含部署所需的 `order-core.js`，不会依赖函数目录外的 `packages/` 或 Windows Junction。这样在微信开发者工具选择“所有文件”上传时，云端拿到的是完整自包含函数。

- `getOrder`：按顾客输入的订单号读取已有提交；订单不存在时返回可创建的草稿状态，并返回本子类型目录。
- `saveOrderImages`：按订单号 upsert 订单，保存本子类型和图片 fileID；同一个订单号再次提交时覆盖原类型和图片。

## 部署前准备

1. 在 CloudBase 环境创建集合：`orders`、`notebook_templates`、`staff_accounts`、`staff_sessions`。
2. 本册类型默认已经内置在每个函数目录中；如果要动态维护名称和规则，再在 `notebook_templates` 中配置。即使暂时没有该集合，顾客也能按内置目录提交。
3. 在 `staff_accounts` 中初始化一个 `username=admin`、`role=admin` 的账号。账号密码由 `backend_api` 服务端保存 bcrypt 哈希，不能在小程序或网页代码中写入明文。
4. 在两个小程序兼容函数目录执行 `npm install`，然后通过微信开发者工具右键上传并部署云函数。网页端单独部署 `backend_api/` 云托管服务，再把 `admin_web/dist` 部署到根路径、把 `customer_web/dist` 部署到 CloudBase Hosting 的 `/customer/` 路径。

当前顾客端不再向淘宝、拼多多或任何外部平台查询订单。订单号、本子类型和图片全部由顾客在小程序中提交；新订单会自动创建，旧订单可再次输入订单号修改。

当前没有外部平台通信。网页顾客端会对明显匹配的订单号格式做启发式平台识别，无法确定时 `platform` 留空；`shop`、`product_name`、`remark` 等字段仍默认为空。平台识别规则见 `docs/platform-detection.md`。

批量 ZIP 当前适合中小批量订单。若一次导出大量高清图片，应把生成 ZIP 的函数迁移到云托管，改成异步任务，避免云函数临时目录和执行时长限制。网页后台本身部署在 CloudBase Hosting，和云函数是两个独立部署单元。
