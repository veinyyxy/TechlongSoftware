# Sandbox 首开启用：一次集中审批

**仅启用购买入口，不代做测试购买，不执行首开任务。** 一份批准覆盖本页和[机器清单](evidence/sandbox-first-purchase-activation-consolidated.review.json)。不要使用历史草案 SHA。未批准前不读取新凭据、不连 Stripe/Neon/AWS、不调度或安装；更新文档和正常代码推送不是启用。

唯一目标是 `ca-central-1` 原 sandbox 的一个已注册工作区、`standard-v1` 和可信租户首版 A，以及原平台 Web。复用已封存候选 `14457164929`（构建 `44370472025`、attempt 1）。源、镜像配方/树/配置、两个原栈的物理 ID、工作区绑定摘要、权限与所有上限写入机器清单；不填写猜测的 ECR digest、Secret ARN 或 ECS revision。

| 顺序 | 同一次审批内允许的实际操作 |
| --- | --- |
| 0. 防接错的前置 | 核对 Source、原两栈/执行角色/旧固定 Secret 版本元数据、Console DNS 和服务健康；检查新 Secret 空位。用一条经验证 TLS 的 Neon 只读连接核对安装者、锁定工作区/套餐/A、准入和原表/触发器保护。**不做单独 Stripe 测试**；本次真正启用时最多 5 次固定 GET，仅确认两个键归属同一 Sandbox、测试模式及唯一准确回调，不查余额值、不送事件或触发 Checkout。发布前复用原 GitHub 门禁和封存产物检查。 |
| 1. 发布并关权限 | 原 publisher 栈一次临时 Grant、一次 GitHub dispatch、一次顶层 ECR push。**用户本人只批准该 run 的 `techlong-sandbox-deploy`**；不 Run/Re-run 或代批。成败、超时或未知均在可能提交 Grant 后进入一次立即 Revoke；不做额外写入。单独 AWS 读取证明角色 Locked、同仓库旧映射保留、准确 tag 的原 manifest 字节与封存 config 匹配，才继续。 |
| 2. 安装数据库窄入口 | 原 Neon PG18 一次事务，新 1 个 NOLOGIN definer、1 个 webhook LOGIN、1 个 schema、五个函数。Web 只获 `reserve/attach/read_order`，webhook 只获 `webhook_order/complete`；两者都不获业务表直接写权。提交前撤掉临时 SET，另外开一条经验证 TLS 的只读连接回读函数、ACL 和保护摘要；不调用函数或重放 SQL。 |
| 3. 写一个固定版本 Secret | 只对 `techlong/sandbox/platform-web/first-purchase-v1` 做 3 笔：建空、写精确保护策略、用原 KMS 填 1 个固定版本。仅存 Stripe 测试运行键、该端点签名密钥、同 host/port/database 的窄 webhook DSN；inspection key 不写入。以元数据独立确认保护、ARN 和 VersionId；不读原 Secret 值、不改 KMS。 |
| 4. 更新原 Access | 创建、严格核对并执行同一个 Change Set，各 1 次。仅 `ExecutionRole` 和 `ExecutionBoundary` 两项原资源就地修改：固定新 ARN/版本的 Secret 读取及现有 KMS 转发解密；不新增身份、不改 trust 或旧权限。核对实际策略后才进 Hosting。 |
| 5. 更新原 Hosting 并验收 | 创建、严格核对并执行同一个 Change Set，各 1 次。只替换 TaskDefinition 与就地更新 Service 的任务定义。挂 5 个首开绑定和 3 个固定版本引用，保留原 Web DB、域名、网络、Cell、ALB 和 DesiredCount 1，普通 worker、部署控制器和 apply 都保持关闭。最后独立回读原服务 1/1/0、镜像、任务绑定、目标健康、原监听器及 DNS；只 GET `/api/health`、`/register` 各 1 次。 |

上限：Source STS **11**、AWS 元数据 **440**（含有界 CFN 等待和回读）、GitHub 源端 GET **213**（主要为等同一个 run）/凭据 helper **1**、云端固定产物 ZIP **1**，发布 job 内另有限定 GitHub API GET **3**、STS **1** 和显式 ECR 读取 **3**，底层镜像分层请求不按 1 次计。Stripe 供给文件各读 **1**；`.env.local` 读 **1**（全文件进内存，只使用既有 Neon URL）、经验证 TLS 的 Neon 连接 **3**／SQL 提交最多 **76**（含该次安装与独立回读），只读核对已封存原件，不重盘点。实际不读 AWS Secret 正文、PEM、支付或客户记录正文，不恢复 Cell/Express 或做任何业务写、不新增通用权限。

## 回调签名供给（不发到聊天）

Stripe [读取已有端点](https://docs.stripe.com/api/webhook_endpoints/retrieve)不会返回签名密钥。在同一个 Stripe Sandbox 的 [Workbench](https://dashboard.stripe.com/workbench) 确认只有一个准确地址的 **Your account / Snapshot** 端点；事件只选 `checkout.session.completed` 和 `checkout.session.async_payment_succeeded`。端点的显式 API 版本为 `2026-10-28.endive`。已有端点完全匹配就复用，不改任何已存在的端点；**只有确无同 URL（包括 Thin/Connect）时，才可在这同一份审批下由用户本人在 Dashboard 新建一个匹配端点**。程序只允许 GET，不用管理键、不自动创建。若已有同 URL 但不匹配、版本不符或有重复，停止，不新建旁路或轮转。

在 `E:\NodejsProject\TechlongSoftware\.local-secrets\sandbox-first-purchase-stripe-webhook-test.json` 私密保存以下两字段，继承现有私有 ACL；不要发实际值。运行键与检查键仍来自已经更正的原文件。签名文件未就绪不会开 AWS 写入或消耗执行槽。Stripe [API 版本说明](https://docs.stripe.com/api/versioning)区分端点显式版本与会随账户默认值变化的版本；本轮不把后一种作为已绑定。供给仅是配置，不发测试购买或 webhook 测试。

```json
{
  "endpointId": "we_替换为准确端点ID",
  "signingSecret": "whsec_替换为该端点签名密钥"
}
```

## 时间与失败处理

最晚 **2026-11-18 15:31:18.005 CST（温尼伯，21:31:18.005Z）前**开始，获批后最长 95 分钟，且不迟于原事实到期 **17:06:18.005 CST（23:06:18.005Z）**。原产物 **11 月 21 日 12:31:59 CST** 到期不延长。正常写入不越截止；发布 Grant 若可能已提交，必须立即尝试获批范围内唯一 Revoke 及 Locked 回读，即使正常时间已到。私有记录保留，不复位或重跑。未就绪、窗口不足、事实漂移、发布或回读不通过均停止，没有第二次调度或自动清理。

跨 GitHub、Neon、AWS 无原子性；可遗留镜像、数据库窄角色及函数、用户所建测试回调、新 Secret 或窄 IAM 更新；平台滚动可能短时不可用并正常托管回滚，未知提交不追加执行或继续。Neon 创建者保留自动 ADMIN（不留 SET/INHERIT），可重新授予成员权限；安装密码/运行键/签名只在进程内存和必要供应商请求中使用，仍有服务端日志、网络、托管注入及并发风险。本地不保存凭据正文到回执，禁止写到命令行、聊天或 Git。ECR/Secret/请求与既有资源可能计费。最终技术核验通过后才通知用户测试购买；测试购买、回调后业务结果及实际执行首开任务不属于本次批准。

用户确认示例：`我确认按清单 <SHA-256> 启用 sandbox 首开，接受完整风险；GitHub environment 我本人批准，启用后测试购买由我来做。`
