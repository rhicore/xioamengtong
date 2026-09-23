# 顾客网页端

顾客网页端使用通用 `backend_api` 的顾客接口，不直接读取 CloudBase 数据库，也不在浏览器中保存 CloudBase 密钥。

## 本地运行

```powershell
Copy-Item .env.example .env.local
# 修改 VITE_API_BASE_URL 为 backend_api 地址
npm install
npm run dev
```

页面流程：输入订单号 → 查询已有订单 → 选择本册类型 → 选择图片 → 拖动/缩放裁切 → 预览 → 提交。已有订单的图片也可以通过后端图片代理重新打开裁切器，不受云存储临时 URL 跨域限制。

## 发布

```powershell
npm run build
tcb hosting deploy dist customer -e 你的环境ID
```

它与运维后台共用 CloudBase Hosting，但发布在 `customer/` 路径下；运维后台仍在根路径。
