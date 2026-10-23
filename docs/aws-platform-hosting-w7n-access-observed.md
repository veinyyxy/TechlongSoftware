# W7n：执行角色与 Secret 读取接线已安装并独立核验

结果：**ACCESS_HANDOFF_INDEPENDENTLY_VERIFIED**。2026-10-22 16:31:55 CDT（21:31:55.419Z）消费唯一永久执行槽，16:32:41 CDT 保存最终成功回执，errors为空。用户明确确认准确清单 `9cdfcdc03a33cbcc22ca749bbb84294054bdeb58439447656e337ae4ad592e09` 及[完整风险](aws-platform-hosting-w7n-access-review.md)后，原受审程序只运行一次，没有绕过门禁或重试写入。

本页及[机器证据摘要](../ops/aws-sandbox/reviews/platform-ecs-w7n.observed.json)记录该次执行时的实际观察，不是后续时点的实时资源保证。额度中断发生在云执行成功之后、文档发布之前；恢复时只重核本地五份原始回执、21项源码及9项准备产物hash，没有再查询或写AWS。

## 已完成的准确范围

账号402010193138，区域ca-central-1。最多两次顶层写提交均成功并得到ACK：

1. 一次CreateStack创建 `techlong-sandbox-platform-access-v1`，两项具名IAM逻辑资源：新execution角色（含唯一ExecutionOnly inline policy）及其新managed permissions boundary。栈实际CREATE_COMPLETE，原模板、两项物理资源、角色身份、信任、唯一inline、无额外managed attachment、boundary默认v1、usage和标签均经程序核验。
2. 一次PutResourcePolicy更新准确Web Secret的GetSecretValue显式Deny例外，仅从Source扩为Source及准确execution角色ARN；管理Deny仍仅Source。随后独立读取IAM/CFN及Secret元数据，确认相同角色身份、预期策略及HANDOFF状态。

| 对象 | 实际身份/版本 |
| --- | --- |
| Access栈 | `techlong-sandbox-platform-access-v1` / UUID `01b4bb80-ce60-11f1-9435-0e85c8c75895` |
| Execution角色 | `TechlongSandboxPlatformWebExecutionRoleV1` / RoleId `AROAV3GNMXTZJ45S2ANZ7` |
| Boundary | `TechlongSandboxPlatformWebExecutionBoundaryV1` / PolicyId `ANPAV3GNMXTZP7KMHXNYF` / 默认v1 |
| Web Secret | `techlong/sandbox/platform-web/neon-v1-UfFKVF` / UUID `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f` |

完整ARN、五组窄权限、原清单/源码/产物hash和每份回执大小/hash见机器摘要及保留的待审索引。本轮没有更新Secret值/版本/标签、Key、Neon、旧IAM、网络或预算。

## 实际调用、证据及限度

- 程序记录41次AWS只读提交、2次顶层写提交；不包含CloudFormation资源provider内部IAM调用或AWS Login内部操作，不能解释为总共只有两次底层写。
- Secret值读取0、SQL连接0、ECS任务/承载部署0；未承担execution角色，未验证真实ECS Secret注入或真实平台登录。
- 原始目录：`F:/ChatGPT_workshop/techlong-platform-ecs-access-aca6c7934875a069a696bbe47d9b7b35/`。五份运行原件为create-ack、access-installed、handoff-ack、independent-observation、result；另有纯离线offline-semantic复核回执，无值/URI/口令/verifier/私钥材料。
- 最终result SHA：`a1777458e1da3b3979110d3065b09d4ad9ac5c6eed523fcceda20e4514b9ce61`；独立观察SHA：`2f943c2ddff1f71b0a229b9102c3e8034b8722612787e2136ea1678f6c26e597`；离线复核SHA：`2556727c5700aaa3f420d8cacc7c22030d7c8ca4a85d8dc612dda976fd6197b4`。
- 永久槽 `F:/ChatGPT_workshop/techlong-platform-ecs-access-v1.intent.json` **已经消费**，SHA `572ed1b9c0f47bf57e1063a2767e410f1bd464ba0baed504db6d6ecce3323b48`。原批准/清单即使尚未到期也不得再次安装，不删除/复位/换槽重放。
- 源码为 `ceaaf92c7298ed67039ead2ca6cd059ea3722479`，执行HEAD为 `e9ebc52881a90aaae80ee815b4f8540c90848f19`。准确[No-AWS CI39856557759](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39856557759)的10项测试、类型和lint此前已通过；本次文档发布未改执行代码，不另造新CI或安装证明。准备索引和完整风险原件保持不变。

IAM权限及Secret读取例外现已真实安装，**不会随48小时清单或未来两小时hosting意图自动失效**。SourceAccount/区域ecs:*信任不是单cluster隔离，角色ARN例外存在同名重建风险，RoleId读取不是跨服务CAS；其余继承数据库能力、费用和并发限制仍按原风险保留。后续撤权或删除必须另审，不以完成为由自动清理。

## 唯一下一主线

基于实际RoleId/PolicyId及本次成功证据，准备[11项两小时HTTPS承载草案](aws-platform-hosting-w7n-two-hour-draft.md)的独立执行清单，重新只读核对权限、镜像、Secret元数据、网络、名称、证书及预算，绑定固定镜像digest与Secret UUID。实际创建承载资源、应用认证验收、随后清理分别确认；当前批准不覆盖它们。

首轮仍仅平台Web管理员登录、overview和实例只读页面。controller/request/worker/apply保持关闭，F3c9/旧租户/失败publisher支线停止。**平台尚未在AWS上线，两小时hosting窗口尚未开始**；50USD/月是预算目标而非硬停止器。不得因IAM/CFN接线成功宣称HTTPS、数据库应用访问或整套系统验收通过。
