# W6e：真实 App 身份验收成功，尚未授权 AWS 部署

2026-10-19 14:39（温尼伯）。按用户确认的清单 `51dca897d2a362a2a38f5e9b51356f926cc76e699167e9602080720bccb9c5cb` 单次执行。用户随后自行批准准确environment，独立只读验收通过：[运行39312477081](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39312477081)，attempt1、completed/success。

## 已实测通过

- 本机一次固定PEM读取/签名、一次指定单仓Actions-write token（HTTP201）、8个元数据GET（全200）、唯一identity dispatch（HTTP200）。准确run ACK先落盘，再立即一次token撤销（HTTP204）；不等待用户审批才撤销。
- 首次独立Inspect为waiting，准确workflow389772013、caller main `36d42cd5cb2c541997f2b8574b58ba4b90cf843f`、actor/triggeringActor344813947、attempt1已匹配；随后用户报告环境已批准，没有代批、重跑或第二次dispatch。
- 第二次独立Inspect读到success，并只下载该run唯一公开身份artifact12217380387。ZIP摘要 `8eb800d8c05599f22df15c18b85cd9db16bcb5059c203d5aed8b1f1d0cf16b03` 匹配，单文件名/大小/CRC通过；签名URL只在内存使用、不落盘，不向存储域转发GitHubAuthorization。
- proof摘要 **`1465a6050e878dba63b58c0214b82ef88ff051256a28ddc63a14e817e2076aca`** 与准确run API交叉验证通过：App5381160、installation173033406、actor/sender344813947，公开nonce `3f36a638b29d4d6604f7ed2510451282bcf726aa1906fe318bfbfd510217281a`、caller36d42cd、冻结执行源码ca2b38d、准确workflow与attempt1全匹配。

这不再只是bot公开资料或合成测试：**真实App dispatch actor与运行内sender已有同一次成功运行和artifact证明**。Actions内的proof注明privateKeyRead=false，表示runner未读App key；本机认证这一次确实按批准读取了PEM，二者不能混为一谈。

独立Inspect不读PEM、不mint App token，仅使用现有Git身份的GET。撤销204已在原回执记录并独立本地回读；未保留旧token做第二次提供者状态验证，因此不声称独立实时证明token失效。

## 原件与防重放

[结构化完成证据](../ops/aws-sandbox/reviews/platform-identity-dispatch-v6.executed.json)保存10份公开本地原件的raw SHA256：最终manifest、新永久槽、ACK、撤销/调度receipt、执行结果、两次Inspect观察/结果及身份proof。canonical manifest SHA、proof SHA与文件raw SHA输入不同，分别记录。

目录在 `F:/ChatGPT_workshop/techlong-w6e-identity-20261019-a*`；新永久槽/ACK/receipt在同父目录 `techlong-w6e-identity-dispatch.*.json`，已占用。旧W6b认证/W6d发布及所有历史记录保留。**不再执行Dispatch、读钥、mint、revoke、复位或重复身份实验。** 原清单虽尚未到期，也不能用于第二次执行。

本轮没有修改执行代码、已发布workflow、AWS/IAM/Secrets、Neon/业务数据，没有请求OIDC或部署应用；没有重跑25项检查、原105项或PG CI。只有按既有授权记录结果文档及公开证据，原工作流/闭包和服务端用户.vscode保持。

## 离主目标还缺什么

**本次仅完成真实App身份门禁，不是W6或平台自动部署已完成。** 平台 `PLATFORM_RELEASE` 仍UNPUBLISHED；旧AWS trust仍不是新的App云发布授权。

下一阶段沿最小激活路线推进，先盘点并实现待审接线，不增加身份探针：

1. 控制器窄SQL安装/服务凭据及可信publisher生产I/O仍未受审激活。复用现有独立审批/intent/ACK/证据账本与可信重建器，不开放owner DSN到平台路由，也不让service角色直接发布计划/证明。
2. 固定新的App caller/reusable源码、已验证身份proof与App OIDC trust；集中准备最小发布/安装清单，而不是恢复旧个人工作流或扩F3c9。
3. 实际SQL/Secret/IAM/trust/工作流发布仍按准确资源和fresh SHA另批；随后用**新held job**完成Review→人工批准→RunOnce→独立Inspect的端到端验收，不重放已完成W5r任务。

无AWS身份实验不扩展云权限。整套系统最终AWS上线、Aurora双模式兼容和50 USD/月预算目标保持；不转向Sites、不升级plan。本次实际费用风险与长期私钥/Actions权限边界沿用[原完整清单](aws-auto-deployment-platform-w6e-app-identity-dispatch.md)。
