# W7p：公网只读GET通过，转优先清理准备

2026-10-22 23:09:46CDT（2026-10-23T04:09:46.507Z），对固定 `https://console.sandbox.techlong.cloud` 顺序执行三次HTTPS GET，不带Cookie/Authorization，不跟随重定向，不提交表单，不登录或读取Secret。

| 路径 | 实际观察 |
| --- | --- |
| `/api/health` | 200，预期saas-platform/ok健康JSON |
| `/login` | 200，登录页标记存在 |
| `/admin` | 307，同origin跳转到/login；未跟随 |

三次均使用Node默认TLS证书链/主机名验证，TLS1.3、authorized=true，HSTS `max-age=300`，无Set-Cookie。响应正文只在内存检查，证据保存字节数/hash，不保存HTML、Cookie值或身份材料。[机器证据](../ops/aws-sandbox/reviews/platform-hosting-w7p.public-readback.json)及原件 `F:/ChatGPT_workshop/techlong-platform-public-readback-w7p-20261022.json`。

这是有限公开入口验证：没有静态资源完整加载、伪造Host/Origin/POST、Secure登录Cookie、管理员认证、overview或实例业务页面验证，不能据此宣称整套系统或首轮认证验收已完成。

用户明确选择**优先准备清理审批**，不继续人工登录。本轮Source过期阻止了fresh清理元数据读取；尚未生成删除SHA、发起删除或消费清理槽。刷新仅用于只读核对，不是删除批准。[待生成清单的准确删除范围与风险](aws-platform-hosting-w7p-cleanup-review.md)。

原两小时标签为今晚23:13:24CDT，不会自动停止/删除。超过它资源仍可能运行并收费；只能在新清单确认后删除准确W7o承载栈，保留IAM/Secret/数据库/镜像/证书/网络等旧资源。
