# W7o：HTTPS承载已创建，元数据通过；应用验收待进行

结果：**HOSTING_METADATA_VERIFIED_APPLICATION_ACCEPTANCE_PENDING**，errors为空。用户明确确认准确清单 `289e7cdcb09630b2b851fe5fa493477f1d7a642bbe10509efa21bf3ccac178ab` 及[完整风险](aws-platform-hosting-w7o-deployment-review.md)后，原受审DeployReviewed程序仅运行一次，未改代码、绕过门禁或重试写入。

2026-10-22 21:13:21.444CDT消费永久槽；21:13:24.726CDT计算两小时意图并提交唯一CreateStack，收到ACK。21:17:18–19CDT保存独立观察和成功结果。时间来自本地意图/回执及mtime，不是单独的AWS服务端时间审计。

**当前存在真实收费资源。HostingExpiresAt为2026-10-22 23:13:24.726CDT（2026-10-23T04:13:24.726Z），只是标签/输出，不会自动停机或销毁。清理仍需单独批准，错过该时间服务也会继续运行和计费。** 50USD/月预算仍是告警目标而非硬上限。

## 已观察的实际状态

部署入口：[console.sandbox.techlong.cloud](https://console.sandbox.techlong.cloud)。这里是已创建DNS/ALB的目标地址，**本阶段没有从公网发HTTP或管理员登录验证其可用性**。

| 对象 | 实际结果 |
| --- | --- |
| 新承载栈 | `techlong-sandbox-platform-hosting-v1` / UUID `54a0d7d0-ce87-11f1-aa1a-0eb4b7868f6f` / CREATE_COMPLETE |
| ECS Service | `techlong-sandbox-platform/techlong-sandbox-platform-web` / desired1、running1、pending0，部署COMPLETED |
| Task definition / 实际任务 | `techlong-sandbox-platform-web-v1:1` / `3c1bbd7a8a4a4d96a7e1ade001fe9026`，RUNNING且健康 |
| 实际镜像digest | `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612` |
| ALB / target group | `techlong-sandbox-platform` / `techlong-platform-web-v1`，准确task IP:3000为healthy |
| DNS / HTTPS listener | 准确A alias指向本ALB，仅443、既有固定证书及TLS policy |

11项逻辑资源全部CREATE_COMPLETE，原模板/参数/标签/物理ID一致。程序独立读取并断言实际ALB/listener、service网络、任务定义/env/固定Secret引用/无TaskRole、真实任务digest、健康target、安全组入出站规则、7天日志保留及DNS alias。原execution RoleId `AROAV3GNMXTZJ45S2ANZ7` / boundary PolicyId `ANPAV3GNMXTZP7KMHXNYF` / 固定Secret UUID `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f` 均未变。更多准确ARN、SG IDs和hash见[机器证据](../ops/aws-sandbox/reviews/platform-hosting-w7o.observed.json)。

这些是部署程序对当时API字段的检查；回执保存摘要而非所有原始响应，也不是后续时点的实时状态保证。ECS已获批准按任务定义托管读取/注入真实Secret，**不等于本地读过值，亦不等于应用数据库认证已验收**。

## 调用及可追溯证据

- 程序记录98次AWS只读提交、1次顶层CreateStack；另一次只读资源进度CLI查询单独保存progress-1.json，不包含在98内。CFN provider、ECS托管启动/Secret读取/健康检查以及AWS Login内部操作不在这些计数内。
- 本程序直接GetSecretValue、SQL连接、应用HTTP请求均0；没有登录、业务验收、IAM/Secret策略写或清理。公开应用可能因外部请求访问数据库或写认证状态，不能据此宣称全环境“无数据库变化”。
- 原始目录 `F:/ChatGPT_workshop/techlong-platform-hosting-deployment-3cbd907904d9162f560f80a5e2de1581/`；五份运行/进度原件及额外纯离线offline-semantic.json已保留。result SHA `e332cc6109a68c7932501ee804e85955295f944c695b8fe1b0b95cf80b547104`；独立观察SHA `32e2ddf8808ddc97d39b41e41bb75005c645a5c8ef0eeffb42733033037a83c0`。原件不含数据库URL/值/verifier/私钥；不承诺提供者或容器日志全局脱敏。
- 永久槽 `F:/ChatGPT_workshop/techlong-platform-hosting-deploy-v1.intent.json` **已消费**，SHA `02b50fdd7c0bf5a0204a6be5ae889c03e332f94490cfed09f1ebfe3e916e1581`。即使原48小时清单未到期，也不得再次运行DeployReviewed或复位/换槽。
- 源码 `281933ba4064fbde4978d4d2f3cc214bcdef1fb5`，执行HEAD `1c3dba83859b97207b0ad76561a538bc8042e3c3`；离线复核29项源码、4份准备产物、三份W7n父回执、CI与原审批索引均一致，额外AWS/SQL为0。准确[No-AWS CI39886264015](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39886264015)的21项测试、类型/lint此前通过；本次结果文档不修改运行代码或重建镜像。

## 下一步与边界

先准备独立公网HTTPS、Host/Origin/Secure Cookie及既有管理员自行登录、overview/实例只读页面的验收；不要在聊天发送密码。完成或遇阻后尽快准备准确已建承载栈的清理审批，**不要把23:13标签当成已经安排的自动清理**。本页不是应用验收/删除批准。

controller/request/worker/apply继续关闭，旧F3c9/租户/失败publisher支线未重启。承载创建不代表整套系统全部功能上线。原IAM、Secret、Neon LOGIN不会随hosting窗口到期消失，未来即使删除承载栈，也需另审是否保留它们。
