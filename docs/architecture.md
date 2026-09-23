# 系统架构和迁移边界

本项目把“业务接口”与“云服务实现”分开，避免小程序、运维后台和数据库供应商互相绑定。

## 代码边界

```text
miniprogram/
  顾客使用的小程序，只调用 order client，不直接读写数据库

admin_web/
  打印/运维人员使用的网页，只调用通用后端 API，不直接读写数据库

backend_api/
  顾客接口、运维认证、HttpOnly 会话、账号管理、订单接口和批量下载 BFF

customer_web/
  顾客网页端，只调用 backend_api 的 customer 接口

cloudfunctions/
  微信云开发适配层：把稳定的业务操作映射到数据库和云存储

各个部署目录中的 order-core.js
  各自携带需要的订单字段、文件命名和输入校验规则，部署时不依赖根目录公共包

legacy/
  旧 FastAPI、旧 React 前端，仅用于迁移和比对，不参与正式运行
```

## 现阶段微信云开发实现

顾客端使用：

- `getOrder`
- `saveOrderImages`
- `wx.cloud.uploadFile`

顾客流程是：输入订单号 → 选择本子类型 → 上传图片 → 提交。`getOrder` 不要求订单预先存在；`saveOrderImages` 会按订单号创建或更新记录，因此同一个订单号可以再次提交来修改本子类型和图片。

当前业务不与淘宝、拼多多或其他外部平台通信。顾客网页会对订单号进行本地启发式平台识别，明显匹配的结果写入 `platform`；平台格式不唯一时保持为空。`shop`、`product_name`、`remark` 字段后续由客服后台手工维护或通过独立内部导入接口补齐。具体规则见 `docs/platform-detection.md`。

运维端现在使用 `backend_api` 的 admin HTTP 接口，顾客网页使用同一服务的 customer HTTP 接口。员工账号密码只在后台接口中校验，顾客接口不具备后台权限。未来迁移到普通服务器时，只需要迁移 backend_api。

数据库和文件存储只由服务端代码管理：小程序兼容链路由云函数访问，网页链路由 `backend_api` 使用服务端 SDK 访问。客户端不能直接获得管理员数据库权限；服务端负责把 fileID 换成临时 URL，客户端不直接读取云存储文件。

## 以后增加网页端顾客上传

当前顾客网页位于 `customer_web/`，复用 backend_api 的订单契约；小程序旧版本仍通过 `getOrder`、`saveOrderImages` 云函数兼容运行。

## 以后迁移到自有服务器

小程序已经预留了 `miniprogram/utils/backend/http.js`，运维后台也预留了 HTTP adapter。迁移时只需要：

1. 用 FastAPI/Node/其他服务实现 `docs/admin-auth.md` 中的接口；
2. 把 `BACKEND_MODE` 改成 `http`；
3. 配置 HTTP API 地址；
4. 将 CloudBase fileID 迁移成服务器或对象存储 URL。

页面、订单字段和运维后台业务不需要跟着重写。

## 数据模型

推荐创建以下 CloudBase 集合：

- `orders`：订单号、本子类型、`front_file_id`、`back_file_id`、提交时间和可选运营字段
- `notebook_templates`：胶套本、车线本、活页本等本册类型配置
- `staff_accounts`：员工账号、bcrypt 密码哈希和角色
- `staff_sessions`：哈希后的后台会话令牌

正式环境需要为这四个集合配置权限规则，并通过 `backend_api` 或小程序兼容云函数执行服务端读写。
