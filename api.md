这份文档是按照**大厂标准（OpenAPI 3.0 规范）**重写的 API 协议。我们严格遵守**无状态（Stateless）**原则，将交互拆分为两个独立的原子操作。

---

## 1. 全局响应规范 (Global Response Schema)

为了让前端能够进行统一的逻辑处理，所有接口均采用以下闭环结构：

### 成功响应 (Success Wrapper)

```json
{
  "code": 200,
  "message": "success",
  "data": { /* 业务逻辑负载 */ }
}

```

### 失败响应 (Error Wrapper)

```json
{
  "code": 404, 
  "message": "订单号不存在",
  "data": null,
  "request_id": "req-8892-xcz" // 链路追踪ID，用于后台排查
}

```

---

## 2. 接口 A：提取订单状态及配置 (Query)

**功能描述**：顾客输入订单号后，前端通过此接口确认该订单是否存在、是否已上传，并根据返回的类型动态渲染上传界面。

* **Method**: `GET`
* **Endpoint**: `/api/v1/orders/{order_id}`
* **Stateless 逻辑**：后端仅根据 URL 中的 `order_id` 实时检索数据库。

#### 请求参数 (Path Parameters)

| 字段 | 类型 | 必填 | 示例 | 描述 |
| --- | --- | --- | --- | --- |
| `order_id` | String | 是 | `2026021901` | 唯一订单标识符 |

#### 响应数据 (data 载荷)

```json
{
  "order_id": "2026021901",
  "status": "pending", // pending(待上传), completed(已归档)
  "notebook_type": "jiao_tao_a5", // 核心枚举值，见下文定义
  "config": {
    "image_count": 2, // 告知前端需要渲染几个裁剪框
    "aspect_ratio": "3:4",
    "display_name": "胶套本 A5 (封面+封底)"
  },
  "quantity": 1
}

```

---

## 3. 接口 B：上传裁剪后图像 (Upload)

**功能描述**：前端完成图片编辑后，以文件流的形式提交。

* **Method**: `POST`
* **Endpoint**: `/api/v1/orders/{order_id}/images`
* **Content-Type**: `multipart/form-data`
* **Stateless 逻辑**：请求中必须包含 `order_id`。后端不依赖之前的 GET 请求，直接执行“保存文件+关联订单”的动作。

#### 请求负载 (Multipart Body)

| 参数名 | 类型 | 必填 | 描述 |
| --- | --- | --- | --- |
| **front** | File (Binary) | 是 | 裁剪后的前封面/封面图像 (JPG/PNG) |
| **back** | File (Binary) | 否 | 裁剪后的后封底图像 (活页本无需上传) |

#### 响应数据 (data 载荷)

```json
{
  "order_id": "2026021901",
  "status": "completed",
  "uploaded_at": "2026-02-19T15:45:00Z",
  "file_ids": ["img_001", "img_002"]
}

```

---

## 4. 业务状态码与枚举定义 (Constants)

### 业务状态码 (code)

* **200**: 请求成功。
* **404**: 资源不存在（订单号查无此人）。
* **400**: 请求参数错误（如：活页本强制上传了 back 字段）。
* **413**: 文件过大（建议单张限制在 10MB 以内）。

### 本子类型枚举 (notebook_type)

| 枚举值 | 渲染逻辑 |
| --- | --- |
| `jiao_tao_a5` / `jiao_tao_b5` | 渲染 2 个裁剪框 (Front & Back) |
| `che_xian_a5` / `che_xian_b5` | 渲染 2 个裁剪框 (Front & Back) |
| `huo_ye_a5` / `huo_ye_b5` | **仅渲染 1 个裁剪框** (Front Only) |