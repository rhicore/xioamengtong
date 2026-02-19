这是为你整理的**图书定制系统数据库接口文档 (v1.0)**。本方案旨在满足顾客前端的快速提取与客服后端的多维度筛选需求。

---

## 1. 数据库表定义：`orders`

| 字段名 (Field) | 类型 (Type) | 约束 (Constrains) | 说明 (Description) |
| --- | --- | --- | --- |
| **id** | Integer | Primary Key | 内部唯一主键。 |
| **order_id** | String | **Unique Index** | **订单号**。前端查询的核心索引，禁止重复。 |
| **notebook_type** | String | Not Null | **本子类型**。决定前端显示 1 张或 2 张图。 |
| **quantity** | Integer | Default: 1 | **定制数量**。由系统自动带出。 |
| **platform** | String | Index | **平台**。用于后台筛选和文件名生成。 |
| **shop** | String | Index | **店铺**。区分不同渠道。 |
| **product_name** | String | - | **商品名**。订单对应的具体产品名称。 |
| **remark** | String | - | **备注**。客服或顾客的特殊要求。 |
| **front_image** | String | - | **前封面路径**。物理文件存储路径。 |
| **back_image** | String | - | **后封底路径**。活页本此字段始终为 `null`。 |
| **status** | String | Default: `pending` | **状态**。`pending` (待上传) / `completed` (已完成)。 |
| **created_at** | DateTime | Index | **创建时间**。用于后台按日期筛选。 |
| **updated_at** | DateTime | - | **更新时间**。记录图片最后提交时间。 |

---

## 2. 字段取值规范 (Standard Values)

为保证数据的一致性和后续自动命名的准确性，建议在后端逻辑中对以下字段使用标准化枚举值（存储时建议使用小写英文或标准中文）：

### A. 平台 (platform)

* `taobao`: 淘宝
* `pinduoduo`: 拼多多
* `jd`: 京东
* `tiktok`: 抖音
* `offline`: 线下/私域

### B. 本子类型 (notebook_type)

该字段直接决定前端 `UploadPage.jsx` 的渲染逻辑：

* `jiao_tao_a5` / `jiao_tao_b5`: 胶套本 (渲染 2 张上传框)
* `che_xian_a5` / `che_xian_b5`: 车线本 (渲染 2 张上传框)
* `huo_ye_a5` / `huo_ye_b5`: 活页本 (渲染 1 张上传框)

### C. 状态 (status)

* `pending`: 顾客扫码后，尚未提交图片。
* `completed`: 顾客已完成裁剪并提交，设计人员可下载。

---

## 3. 业务逻辑规范 (Business Logic)

### 1. 图像关联逻辑

* **物理存储**：图片保存至服务器 `/uploads/{year}/{month}/{day}/` 目录下。
* **数据库存储**：仅记录文件名，如 `ORDER123_front.jpg`。
* **前端访问**：通过 Nginx 静态代理，URL 格式为 `https://domain.com/static/ORDER123_front.jpg`。

### 2. 自动命名规则 (下载时触发)

当客服点击下载时，后端程序需读取该行记录，按以下逻辑动态拼接文件名：

> **文件名格式**：`notebook_type`-`platform`-`shop`-`order_id`-`remark`.zip
> **示例**：`胶套本A5-淘宝-心选店-123456789-加急打印.zip`

### 3. 数据生命周期

* **预录入**：订单产生时，由后台管理程序或脚本先将 `order_id`、`notebook_type`、`platform` 等信息批量写入数据库，`status` 设为 `pending`。
* **激活**：顾客扫码输入 `order_id`，若命中 `pending` 记录，则允许上传。
* **归档**：上传成功后，状态改为 `completed`。

---

## 4. 索引设计建议

* **唯一索引**：`order_id`。
* **组合索引**：`(created_at, platform, shop)`。这能极大提升客服在后台按“日期+平台+店铺”进行多维度复合筛选时的响应速度。

**下一步：**
这份文档已经定义了前后端沟通的“契约”。如果你确认没问题，我可以为你生成基于这个 Schema 的 **SQL 建表语句**，或者生成 **Python 后端的数据库模型 (ORM) 代码**。你需要哪一个？