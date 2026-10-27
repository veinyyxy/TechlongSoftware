# a604 固定 held 请求衔接与未发布云绑定候选

2026-10-27。主线仍是完成自动 AWS 部署，不继续 F3c9、UI 或身份探针支线。本阶段只实现事务入口、测试和文档；**没有执行任务取消/创建、生产配置读取、SQL连接、AWS调用、计划发布或调度**。代码提交/无AWS身份CI不是这些实际操作的批准。GitHub environment 审批继续由用户本人完成，不要求在平台 Web 点击。

## 固定范围与真实基准

旧审核挂起任务为 `job_9b57b43a6b88f37202b29170`，新候选为 `job_a60423b885fef3e4326213f7`，clientRequestId 固定 `17004827-71da-4e61-9bb3-26cbf6fbb1ba`。请求摘要固定 `3bb1acc176722d5196a1e507f34e11c0fae512a1cee915a7320ac458047dafe9`。没有选择其他任务、数据库、配置文件、事实时间、SQL或profile的CLI参数。

上阶段另批只读核对已保存完整10任务、8计划/5批准/5attempt、业务准入及保护布局；旧9b pending/attempt0/max1、无lease、审核挂起，Review run40453693112仍准确ACK/proof NULL，新a604及其dedupe不存在。原始十份文件逐一核SHA，封存摘要为 `d6d243f7b929632bab4dfe4b20ff2c25ef434a3a7dbf7b7aaa695eec69dea4c1`；准备时不能只信摘要字段或修改过的snapshot。

旧Review领取窗口和workload TTL已经到期，永久Review槽不能复位或重放。最近成功并已退役的前驱仍是 **`job_9db8466fd95cef0c23ad6bfc`**；9b从未执行成功，不能升格成成功前驱。原basis截止固定为 **2026-10-27T18:47:57.695Z／温尼伯10月27日13:47:57.695 CDT（UTC−05:00）**。PrepareSaved、代码提交或本次新采样都不延长它；实际启动至少留2分钟，过期则拒绝，不换Date.now假装新事实。

## 入口及准备

`ops/platform-a604-handoff-v1/local.mjs`显式提供 `--check`、`PrepareSaved`、`RunReviewed`、`Inspect`，导入和check不读取私密内容、不联网。PrepareSaved只核对封存材料、干净main/最终源码/完整pin、准确No-AWS CI（三次GitHub GET）及固定配置文件ACL/长度元数据，不读取配置内容、不连接生产、不调用AWS、不消费执行槽。生成的新外层SHA只是**待审材料**，没有继承任何旧执行批准。

```powershell
node --experimental-strip-types ops/platform-a604-handoff-v1/local.mjs --check
# 以下均是未来待审命令格式，不是执行授权；准确CI与SHA必须来自新材料。
node --experimental-strip-types ops/platform-a604-handoff-v1/local.mjs --mode PrepareSaved --ci-run <准确CI> --output F:/ChatGPT_workshop/techlong-a604-handoff-<新后缀>
node --experimental-strip-types ops/platform-a604-handoff-v1/local.mjs --mode RunReviewed --manifest F:/ChatGPT_workshop/techlong-a604-handoff-<新后缀>/manifest.json --approved-sha <新批准SHA>
```

真实行值/完整snapshot/配置不提交GitHub。输出与永久槽保存在本地私有工作目录，不覆盖旧材料。

## 若新SHA获批：一次事务及独立核验

复用已存在的 `createTransferTransaction` 与 `compileHeldTransferProgram`，不另写旁路SQL。顺序为源码/CI/pin/ACL核对、验证TLS/固定owner及OID和数据库、完整只读预检、精确基准比较、永久写槽、Serializable事务。

事务内设置 `search_path=pg_catalog`、1秒锁超时及15秒statement超时；锁定控制账本防并行dispatch、按现有准入逻辑锁关联业务行、锁定并重读完整任务集合。只接受与批准基准完全相同的业务、旧历史和保护布局。SQL参数在事务内真实数据库clock下编译，准确旧行CAS及30秒事实窗口防止裸重放保存的示例SQL。

最多两个业务行变化，在同一事务内：

1. 旧9b准确行仅变为canceled并写两个完成时间，保留原行及payload；
2. 插入固定a604一行：pending、attempt0/max1、`available_at=Number.MAX_SAFE_INTEGER`、无lease、`reviewRequired:true`、`cloudExecutionAuthorized:false`。

不改实例、订阅、部署输出、现有成功回执、其他旧任务、控制计划/批准/attempt或保护布局；不删行、不创建deployment，不启动队列或TTL。事务内完整回读通过才COMMIT。COMMIT结果不明不ROLLBACK、不重试提交；其他提交前失败最多一次ROLLBACK，不能据此自动重开尝试。

RunReviewed在本次准确写槽已存在时，自动继续批准内的**第二条独立连接**Inspect，包括提交结果不明时。独立连接只读事务核对完整事后状态，禁用task UPDATE前缀；若原状态未变，记录未应用，不自动重试写入。显式Inspect仅用于中断后尚未消费独立核验槽的恢复；核验槽一旦消费不能重复运行。

固定写槽 `F:/ChatGPT_workshop/techlong-a604-request-handoff-v1.intent.json`，独立核验槽 `F:/ChatGPT_workshop/techlong-a604-request-handoff-v1.inspect.intent.json`。永久不删除、改名、复位或补偿重试。原9b与更旧各代槽/原件保留。

总上限：配置整文件读取2次（运行1、独立核验1）、验证TLS连接2条、每连接最多80次SQL/RPC即总最多160次（含身份、保护目录、事务控制、锁与SELECT），准确CI最多6次GitHub GET；逻辑取消/插入各最多1行。无AWS API、Secret值/PEM/App签名、控制账本写、dispatch、IAM或云资源修改。成功返回 `TASK_TRANSFER_INDEPENDENTLY_VERIFIED_HELD_ONLY`，**不等于执行授权、云兼容或部署完成**。

## 云绑定候选及不能跳过的依赖

现有冻结云闭包仍只支持9b。新增 `coordinates.mjs`/`binding-candidate.mjs`只输出 **UNPUBLISHED** 候选，package/release/source绑定为空，activation和execution始终false，运行时门禁始终拒绝。没有修改冻结97文件、镜像、IAM或工作流部署入口，不会把a604偷偷交给旧云worker。

事后候选编译必须使用真实事务intent、批准SHA、独立核验成功、完整事后snapshot及独立连接的真实数据库clock；缺一即拒绝。投影只排除独立核验的新held行，保留canceled9b、所有旧记录和成功9db。投影明确标记“不是数据库实读snapshot”，不能作为已经发生的生产事实。成功前驱的run/receipt/退役引用沿用原9db，不伪造9b成功证据。

后续还需要独立批准新的事实有效期及按源码pin发布新binding/release；候选中的事后时间不能用于偷偷续原basis。**技术顺序**：先完成当前代码/待审事务入口 → 新SHA单独批准并执行held衔接及独立回读 → 据真实事后材料编译/核验并另审发布新云绑定与连续操作授权 → 全部就绪后才开启新Review，随后本人GitHub审批、RunOnce、独立Inspect。创建held请求本身不会提前消耗15分钟Review窗口，也不会部署付费资源。

## 完整风险

Neon owner凭据权限大于此用途，整份现有 `.env.local`（不只连接字段）进入进程内存两次；不输出凭据不代表服务端、提供者、网络或崩溃日志绝无暴露。验证TLS和固定身份不能消除提供者日志/内存残留风险。短暂锁会影响并发写，Serializable可能冲突或超时；文件/SHA/ACL与事务不是跨进程CAS，独立回读后仍可发生竞态。

一次事务虽然原子，但数据库提交、文件回执和独立连接不是一个跨系统事务。可能提交成功而回执/读取失败，永久槽也可能先消费而没有写入；未知结果不按“失败”自动补齐、回滚、删除或重试。独立核验也可能失败，届时保留所有原件，另审后续只读处置。新任务即使创建，也可能因后续发布或审批过期而继续held，不能自动复活或替换。

现有AWS承载仍可能持续计费，本轮不清理/续租；50 USD/月是预算目标，不是硬封顶。未来云绑定发布、权限/Secret操作、部署及清理均不在本次两行事务授权中。测试和CI只证明合约/代码检查，不是生产运行或端到端验收证据。
