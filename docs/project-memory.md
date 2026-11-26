# 项目记忆与操作守则

维护日期：2026-11-26。供后续 AI 和维护人员接手使用；必须与当前代码、Git 状态和实际部署相互核对。维护要求见根目录 [AGENTS.md](../AGENTS.md)。

## 1. 用户已确认的工作方式

- 优先最小改动。曾因重做原页面、引入新流程和预览保护受到用户明确反对，不要重复这些做法。
- 保持现有黑白灰 UI 风格、圆角层级、边线和间距的一致性。只在用户指定的范围调整，不新增无关配色、功能或核对步骤。
- “给我看一下”意味着提供本地实际效果，可用示例订单截图并明确说明是示例；不等于要求上线。
- 提交、推送和发布按当前任务授权执行，已授权的同一步骤不反复询问。后续的暂停和修正指令优先。
- 不做“仅预览多组操作，不会上传或保存订单”一类前端保护，不用假成功替代真实保存。
- 用户偏好简短、直接的中文说明。完成后说明是否已提交、上线，不能把本地测试通过说成线上已经验证。

## 2. 真实架构与目录

正式链路是：顾客网页 / 管理网页 → `backend_api` HTTP 服务 → CloudBase 数据库与云存储。

- `customer_web/`：顾客 React/Vite 网页，原有流程为订单号输入 → 选款、图片裁切与数量 → 统一提交。
- `admin_web/`：员工登录、订单列表、图片预览、整单批量操作及下载。
- `backend_api/`：认证、订单校验、数据与文件访问、下载清单和 ZIP。
- `tests/`：接口、构建、裁切几何与浏览器回归；说明见 [tests/README.md](../tests/README.md)。
- `docs/`：业务与架构说明。详见 [architecture.md](architecture.md)、[admin-auth.md](admin-auth.md)、[multi-item-order-update-plan.md](multi-item-order-update-plan.md)、[platform-detection.md](platform-detection.md)。

磁盘上可能还存在旧 `cloudfunctions/` 或其他历史目录，不能据此判断它们仍是正式入口。先检查当前网页调用和后端路由。仓库曾迁移位置；2026-11-26 本机实际目录为 `D:\rhi\projects\xiaomengtong`，旧聊天中的 `D:\rhi\code\xiaomengtong` 与 Obsidian 下路径已经失效。路径只是当日记录，使用前重新定位并确认 Git 根目录。

## 3. 登录与权限边界

- 管理端使用独立的 `staff_accounts` 用户名和密码，密码经 bcrypt 哈希；会话保存在 `staff_sessions`，浏览器使用 HttpOnly `admin_session` Cookie。
- 不要求员工输入 CloudBase Auth 用户名和密码。网页只调用 HTTP API，不能直连 CloudBase 数据库或持有服务端密钥。
- `backend_api` 使用服务端环境变量访问 CloudBase，发布时保留已有环境变量，不以空配置覆盖。
- 顾客的订单查询、图片上传和提交走独立顾客路由，不要求员工登录；管理员账号维护及受保护的订单操作仍遵守原角色权限。

## 4. 一个订单、多组本册

- 一个订单号可以包含任意多组不同图片或款式；同款同图印多本用该组的 `quantity`。
- `groups` 数组每组包含稳定 `id`、`notebook_type`、`quantity`、`front_file_id`、`back_file_id`。不要用数组位置代替稳定 ID 关联图片。
- 胶套本需要正反两张图片位，沿用可留空规则；活页本需要一张正面图。旧数据中的 `chexian` 仍映射显示为“胶套本”，不要随意改历史 slug。
- 每组沿用原上传接口上传，完成后一次 PUT 保存所有组；失败重试保留已上传成功的 fileID，防止重复提交和重复上传。
- 根字段保存第一组的类型和图片、整单总数量；旧订单没有 `groups` 时按单组读取。制作中和已完成的锁定规则继续生效。
- 按组读取图片使用 `groupId`。上传路径使用 UUID，避免多组文件名冲突。删除、预览和下载必须遍历全部组。

## 5. 管理端已确认的表格

列顺序：勾选 → 订单号 → 订单平台 → 本册类型 → 数量 → 图片 → 状态 → 上传/修改时间。

- 每组占一行，类型、数量、图片三列连续排列，逐行对应。
- 每笔订单使用独立 `tbody`；勾选框、订单号、平台、状态、时间用 `rowSpan` 跨组纵向合并。
- 图片上方不重复堆叠“第几组、类型、数量”的文字；预览按钮的可访问名称和弹窗标题仍带组号，以便区别同款分组。
- 勾选、分页总数、制作状态和删除仍以订单为单位，不能因为一单占多行而重复计数。
- 2026-11-26 分隔线调整：同单组内线为 1px 浅灰 `#e1e5eb`；不同订单之间为 2px 深一些的灰 `#c8ced8`。边界必须同时覆盖跨行单元格与最后一个组的单元格，不能只加深图片列。保持原布局及灰色系。

关键问题：旧的单组预览响应延迟返回时，曾覆盖刷新后的多组列表，使第二组消失。`admin_web/src/App.jsx` 的 `ordersRequestRef` 为列表与预览绑定请求序号，过期响应不得更新当前列表、提示或加载状态。保留该机制，回归见 `tests/run-admin-refresh-tests.cjs`。

2026-11-26 管理端多图性能优化已在本地实现、尚未提交上线：列表使用独立 `OrderThumbnail.jsx` 队列，按页面从上到下启动，最多 3 张并发，只加载可见区域及上下 160px；CloudBase 链接请求 80px 缩略处理，失败逐级回到原图链接/受保护接口。弹窗与下载仍为原图，不修改顾客文件。预览链接每批 4 单顺序获取，过期请求取消并保留请求序号校验；`OrderRows` 避免无关输入与图片更新重绘全表。实现、测量及上线验证边界见 [admin-performance.md](admin-performance.md)，回归为 `tests/run-admin-performance-tests.cjs`。后续发布时同步更新本段及该文档的发布状态。

## 6. 预览、裁切与导出

- 顾客上传区的缩略图、空图片位使用圆角，与网页风格统一。进入全屏裁切后，裁切框使用直角。
- 裁切是黑色全屏画面，支持单指移动、双指缩放与旋转、90° 旋转、重置及替换图片。
- 裁切比例固定 `1704:2400`，JPEG 导出固定 **1704 × 2400**；不添加白边。长图、宽图默认居中铺满，拖动、缩放和旋转均不能让裁切框越出原图。
- 旋转约束需要在图像坐标系内检查裁切框四个角；只检查旋转后外接矩形会漏出三角空白。几何及导出共用 `customer_web/src/cropGeometry.js`。
- 网页圆角只影响显示，不写进文件；实际导出四个角必须完整。取消裁切不能撤销仍在使用的 blob URL。

## 7. 下载与平台识别

- 浏览器优先从下载 manifest 获取所有文件并生成 ZIP，失败时可走原服务端 ZIP；两条链路必须包含同样的组与图片。
- 多组下载为 `订单目录/第N组-X本/`，每组包含自身订单信息 JSON 和对应图片；旧单保留原有结构。
- 平台判断只是本地格式推测，未接入交易平台授权接口。当前淘宝/天猫为 18–19 位数字候选、低置信度；拼多多兼容 6 位数字、`-` 或 `_`、15 位数字。其他旧规则和限制见 [platform-detection.md](platform-detection.md)。
- 后端 `src/platform.js` 与管理端 `src/utils/platform.js` 必须同步。顾客页面从后端获取判断结果；已有明确平台字段优先，空平台字段可在读取时推断。
- 订单号保持字符串，不转为 Number，也不把 `_` 改成 `-` 后保存，避免精度丢失或更改记录与文件关联。

## 8. 验证与示例数据

按影响范围执行验证，不为纯样式小改动增加机械测试。常用命令在项目根目录运行：

```powershell
node tests/run-admin-web-tests.js
node tests/run-backend-api-tests.js
node tests/run-customer-api-tests.js
node tests/run-customer-web-tests.js
node tests/run-crop-geometry-tests.mjs
# 已有 Playwright 模块可通过 PLAYWRIGHT_MODULE 指定，浏览器默认使用本机 Edge
node tests/run-admin-refresh-tests.cjs
node tests/run-admin-performance-tests.cjs
node tests/run-browser-flow-tests.cjs
```

`tests/local-demo.cjs` 使用正式页面与 API，但存储适配为本地文件，数据位于被忽略的 `.local-demo/`。运行前需要构建两个网页。该示例不代表线上存储已验证；截图使用示例数据时说明来源。

本机工具、Playwright 和模块缓存路径随运行环境更新，不照抄旧聊天的版本绝对路径。项目搬迁后依赖软链接可能失效；按现有锁文件恢复所需目录的依赖，不修改或删除锁文件。安装工具可能生成临时配置，结束时检查差异，避免把自动生成的无效配置纳入提交；不要盲目放开依赖构建脚本权限。

线上验证优先只读。用户授权真实上传测试时，使用可明确归属的临时订单和最小权限测试账号，记录产生的文件；结束时仅清理这些测试订单、图片、账号和会话。不得删除或修改顾客原记录，也不把临时凭据写进文档、日志或 Git。

## 9. 提交、发布及核验

- Git 远程：`https://github.com/rhicore/xioamengtong.git`，当前工作主分支为 `main`。提交前检查实际分支、远程变化与工作区，只暂存本次相关文件。
- 正式顾客端：`https://xiaomengtong.site/customer/`；管理端：`https://xiaomengtong.site/admin/`。域名根路径不是已确认的顾客入口。
- CloudBase 环境：`xiaomengtong-d5g5zuan5ae97c4ea`，后端服务：`notebook-backend-api`，端口 `8787`。发布前查询实际服务与路由，不在记忆里固定云端版本号。
- 网页生产包走同源 `/api`，不要把本机 `.env.local` 中的临时域名打入生产包。域名 `/api` 路由指向后端，其余静态页面分目录托管。
- 以下 CLI 3.9.2 命令曾验证可用；执行前确认当前 CLI 的帮助与登录状态。不要打印凭据、服务端 EnvParam 或带令牌的完整响应。

```powershell
# 在对应目录恢复依赖后，项目根目录构建管理端
node tests/run-admin-web-tests.js
pnpm dlx --package=@cloudbase/cli@3.9.2 tcb hosting deploy admin_web/dist admin --env-id xiaomengtong-d5g5zuan5ae97c4ea --verify

# 顾客端发生变更时构建并发布到 customer，而不是站点根目录
node tests/run-customer-web-tests.js
pnpm dlx --package=@cloudbase/cli@3.9.2 tcb hosting deploy customer_web/dist customer --env-id xiaomengtong-d5g5zuan5ae97c4ea --verify

# 仅后端有改动时需要部署容器；省略 --env-params，以保留线上环境变量
pnpm dlx --package=@cloudbase/cli@3.9.2 tcb cloudrun deploy --env-id xiaomengtong-d5g5zuan5ae97c4ea --service-name notebook-backend-api --source backend_api --port 8787 --open-access-types PUBLIC --min-num 1 --force --wait
```

CLI 的容器发布即使带 `--force` 也曾询问是否灰度；非交互命令可能在提示后直接退出 0，不代表已经发布。需要可交互终端选择正常发布，并等待明确的完成结果；不要在没有确认时再次提交同一部署。容器部署需等待构建与流量切换，不能把提交成功说成已上线。

管理端样式调整只发布管理端静态文件，无需重部署后端。涉及新接口时先确保后端就绪。静态发布不使用 `--prune` 清除旧哈希资源，避免仍打开旧页面的用户加载失败。

上线后核对正式域名返回的 HTML 与哈希资源是否匹配本地产物，再检查相关交互与接口。页面入口可能存在缓存，核验版本并按需提示用户 Ctrl+F5 刷新。最后确认推送结果、工作区状态和测试数据清理情况；未通过的验证不能省略报告。

## 10. 维护记录

- 2026-11-26：将本次分隔线对比度调整及此前已确认的多组表格、裁切、平台识别、异步刷新修复和发布经验归入本文件；增加根目录 AI 阅读入口。后续任务按入口规则持续更新，具体发布版本以 Git 和实际线上产物核验为准。
- 2026-11-26：新增管理端多图按序与按需加载、本地性能回归和测量文档。保留既有分组表格与下载流程，未自动提交或发布本次优化。
