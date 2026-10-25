# W8x：脱敏失败记录与恢复准备（不执行恢复）

## 当前事实与本轮目标

W8w已完成平台更新至revision7、Review发布及用户两处批准，GitHub run `40165734067` completed/success；父流程在完整重建阶段停止，未写观察/证明、未生成RunOnce。独立回读时新账本为1计划/1批准/1 ACKNOWLEDGED调度、proof=NULL，业务任务 `job_6a1129afcebfc9fb580517c9` pending/attempt0/未领取，旧业务及保护保持。四个旧执行槽与独立Inspect槽均永久占用，不能重放。

一次另批诊断已成功读取准确manifest固定版本并核对GitHub run；仅缓存材料完整重建也通过。原失败未复现，底层错误码当时没有保留，**原原因仍不确定，不能认定需要新增IAM权限**。本地计算证明不是已登记证明，虚拟OBSERVED状态不是数据库事实。原云claimBy及安全批准期限均已过，旧窗口关闭，不能续期旧manifest或借诊断批准恢复执行。

本轮只做两个必要改动：在operator读取/衔接层保留安全的失败原因；复用已保存证据生成新的限定只读准备范围。没有Source登录、配置内容读取、生产数据库连接、AWS/S3调用、SQL或云写入、调度、租约更新及执行槽消费。

## 错误记录修复

固定GET/版本化S3读取仍经过相同允许列表、摘要、大小和次数上限。新增operator-only读取端口，不修改原可信publisher、应用或云worker代码，不新增网络目标或重试：

- S3阶段区分为引用、请求、响应元数据、正文、JSON、安全检查、摘要。
- GitHub阶段区分为准确run请求、HTTP状态、正文和JSON；job目录/日志跳转失败也保留安全阶段及HTTP状态。
- 只保存白名单错误标识、网络码、受限整数HTTP状态/SDK attempts、失败阶段。未识别错误只记录unknown和阶段。
- 不复制原始message、stack、cause、请求/响应对象、Authorization、签名URL、Cookie、凭据或对象正文。它们不能靠伪造`.failure`字段进入结果。
- 首次读取失败仍立即停止；诊断文件保存失败也不能替换原安全原因或触发重试。衔接结果、driver及外层结果保留该安全原因，阶段可追踪到读取端。

新模块放在 `ops/platform-review-v6/`；原云81文件闭包、镜像、IAM、Secret、数据库schema和旧证据均不变。新增日志不能恢复当时已经丢失的原始错误，也不意味着已修复一个确定的云端故障。

## 新恢复准备材料

`recovery-preparation.mjs` 只有准备模式。它验证两份不可覆盖闭包及其60+8份原件，绑定新main/准确成功CI/代码pins/配置ACL元数据，生成待审只读清单：

```powershell
node --experimental-strip-types ops/platform-review-v6/recovery-preparation.mjs --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w8x-recovery-<名称>
```

入口没有Run、apply、retry或读取私密值的模式。清单明确 `historicalFactsAreNotCurrentState=true`、`readPreparationIsNotApproval=true`、`cloudExecutionEntryReady=false`。其48小时只是新只读准备材料的期限，不会把旧事实变新，也不延长旧部署/领取期限。

准确历史平台栈为：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`

最后独立核验root为 `cf550b50-d034-11f1-92cf-06fff46e9227`、revision7、runtime source `320be62add8fad5ad3f05ff40d44612b0b87e493`。这些都是历史值，准备阶段不宣称当前仍未变。

## 下一步拟议的限定只读范围（需另获允许）

| 操作 | 上限与限制 |
| --- | --- |
| Source现有资源元数据 | 一份快照，最多75次请求；准确平台栈/ECS/DNS/关联角色策略及固定Secret版本元数据，不读取Secret值 |
| 既有`.env.local`内容 | 一次，整文件仅进进程内存，仅使用准确Neon目标的既有连接信息，不输出凭据 |
| Neon TLS | 一条经验证连接，一份repeatable-read READ ONLY快照，最多45条SQL尝试（含事务控制/错误清理） |
| 核对内容 | 准确held任务、完整旧业务与历史、现有Review原文/批准/调度/证明、保护及角色/函数布局、准入与预算配置 |
| S3/GitHub部署run/PEM/Secret值 | 0次 |
| SQL写/云写/计划或证明写/App token/dispatch/执行槽 | 全部0 |

只读连接仍使用既有owner账号，它不是数据库层面只读或行级隔离；代码仅允许SELECT和只读事务控制，TLS须验证，目标/OID/函数和角色布局须核对。不能以“只读”为名执行业务写、撤权或修复状态。配置读取前应先完成Source可用性及准确云范围核对；失败不自动重复请求或重连。

只有这份新快照通过后，才能根据真实状态准备另审恢复范围。可能允许保留旧账本并追加准确新Review，也可能必须先处理任务/控制门禁；当前不替用户选择或修改，不隐去旧记录，不把本地证明写回，不创建新业务任务或自动发布计划。任何新权限、真实云部署、数据库写、资源删除均继续按具体范围及fresh SHA另审。

## 本轮及后续只读准备风险

接受整配置和凭据进入内存、owner能力不在数据库层面受只读/行级限制、提供者与服务端日志、元数据包含Account ID/ARN、TLS/网络失败和低额非零费用。源码、快照和服务之间不是跨服务CAS，读取后仍可能并发变化。只读失败不能证明外部状态没变；不得自动再读、补齐或推断可执行。

不记录原始异常及未知字段，可能仍只能定位阶段而无法给出完整原因，这是刻意保留的安全限制。没有自动回滚、补偿、续租、复位、部署或清理。50USD/月是目标不是硬封顶，现有承载仍可能持续计费，控制租约过期不自动停机。本轮不授权停费或删除资源。
