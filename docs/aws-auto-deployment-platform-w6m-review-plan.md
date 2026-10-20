# W6m：准确任务的 Review 计划发布与独立回读

2026-10-20，America/Winnipeg。W6l已登记 `job_fc0309dabebc09367f64153f`，本机入口已关闭且独立核验通过。本阶段只补齐可信publisher的受审operator入口，**当前没有读取真实认证文件、连接生产Neon、调用AWS或写入对象/计划**。不新增云执行器、权限或任务。

## 最短路径及拟批准范围

复用已有 `createTrustedPublisherV6`、S3固定版本读取器及owner SQL适配器，不改冻结云闭包、控制数据库函数、App workflow/trust或平台运行时。

最终源码CI通过后，Prepare只核对GitHub CI、认证文件元数据/ACL、W6l公开原件/摘要、源码和空闲端口，生成48小时清单。Prepare不加载Source AWS凭据、不读认证文件内容或生产数据库，不消费两个执行槽。

新的准确SHA拟一次覆盖以下步骤（尚未授权执行）：

1. Publish核对clean main/18项源码pin、认证文件元数据与批准时间；以显式Source AWS Login临时会话调用一次STS并核对准确IAM User。STS/凭据失败发生在永久槽消费和私密读取之前。身份刷新不是写入批准，也不自动重跑失败命令。
2. 消费独立永久槽 `F:/ChatGPT_workshop/techlong-w6m-review-plan.intent.json`；整体读取既有 `.env.local`一次，只使用准确owner DATABASE_URL，经PostgreSQL TLS校验连接。只读验证原9个控制函数、固定role/schema/owner OID；核对本job的plans/approvals/dispatch_attempts均为空及准确heldjob/旧记录仍与W6l摘要一致。没有owner URL fallback或平台HTTP入口。
3. 从固定私有证据桶读取W5r的manifest/provider-after/独立Inspect三个准确版本，结合当前数据库outputs中的准确旧receipt，调用原沿革验证器重建一个link。完整文档摘要和receipt摘要均固定；不把W4c锚点误当最新前驱，不生成新成功证据。历史成功只证明沿革，不是当前AWS健康或退役证明。
4. **仅一次条件PutObject**写入固定key：`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/w6m-job_fc0309dabebc09367f64153f-v1.json`，`IfNoneMatch:*`、AES256、固定bucket/owner、校验和。保留返回的准确versionId/SHA，不覆盖、删除、换key或重试。
5. 原可信publisher再读取准确installation和刚写入lineage版本，重新读取/核对同一heldjob，重建Review计划；把拟提交plan/action/risk SHA先存本机公开回执，再**仅一次调用原 `deployment_control_v6.publish_plan`**。本job只有一条新Review计划；不调用begin_dispatch/attest、不写approval/attempt、不改业务job。Publish全过程最多120秒，首写前重复批准/源码/元数据检查，错误不重试。
6. 另起Inspect进程，核对原槽/拟提交计划/lineage引用/源码，消费单独永久槽 `F:/ChatGPT_workshop/techlong-w6m-review-plan-inspect.intent.json`。再整体读取同一认证文件一次，以独立连接只读核对准确计划全文/三SHA、无attempt且本job控制记录恰为1plan/0approval/0attempt，heldjob和W6l旧摘要未变；另读一次准确lineage版本核对内容。即使计划已过两小时也可在48小时授权期内只读Inspect，但明确显示planStillLive，不把过期计划当可执行。

整组上限：原认证文件2次、8个显式READ ONLY事务、2次STS、6次固定版本S3 Get、1次条件S3 Put、1次owner计划SQL。目录读取事务有多条SELECT；不把SQL语句总数称为8。次数来自受审代码路径，不是提供者审计。无App PEM/AWS Secret值/原私密包读取，无App签名/token/GitHub dispatch或环境批准，无job领取、CreateStack、Cell/ECS/数据库部署、初始化或资源删除。

## 时间与后续衔接

operator清单有效48小时，避免确认时已经过期。原控制合同的Review计划仍最多2小时，**只在实际首次Publish时生成新计划及SHA**，不是把旧计划改时间或提前运行云Review。新SHA批准的是固定job/source/release/原件及这个有界生成算法；不是预先知道动态plan SHA。

发布和独立回读后，为该准确plan准备单独的本机controller窗口/用户批准调度范围；App key/固定Secret/认证文件供给、token/dispatch/观察及云Review私有manifest写各按新具体范围批准。运行时只接受计划绑定的caller源码；一旦发布计划，保持本main冻结至Review→RunOnce→Inspect验收收口，不为文档或补丁移动它。后续低层I/O/可信publisher已存在，必要operator材料可在工作区外受审固定，不改变云执行源码。若仍需代码变更，先停止并重新明确计划后续处置，不自动重发计划。

## 完整风险

- 两次读取的是整份`.env.local`：其中其它原秘密也会短暂进入可信父进程内存；只选DATABASE_URL不等于其它字节未读。owner权限高，原固定SQL校验是代码边界，不是把owner变成窄数据库角色。不保证字符串擦除、无内存/日志/缓存副本或本机管理员隔离；保留原继承ACL。凭据仅发给固定Neon目标，提供者日志/网络/连接风险仍存在。
- Source会话由AWS Login缓存提供，之后显式交给固定STS/S3客户端，SDK maxAttempts=1。没有默认AWS凭据链、任意endpoint或回退身份。凭据在过程中失效会留下部分状态；STS成功也不保证后续S3权限或请求成功。独立Inspect需另一次有效Source会话，但刷新不授权再次Publish。
- 沿革包含旧公共业务快照/receipt/provider/Inspect元数据，仅保存本机和既有私有证据桶，不把它或认证材料提交Git。代码有能力字段过滤，但它不是全面PII分类/签名防篡改机制；本地文件系统仍是可信边界。SDK/网络与提供者可能记录请求元数据。
- S3和Neon非原子，元数据/文件/源码/多事务非跨服务CAS；竞争可发生在检查后。条件对象写成功、计划失败或ACK不明，可能永久留下收费对象或计划；即使“失败”也不能自动重试、删除、补齐、换key、刷新时间、复位槽、回滚或重放整组。现有publish_plan不提供按job/mode的唯一计划约束，前置计数+本地槽不是分布式排他锁，信任其它owner/publisher不并发修改。
- 计划SQL提交前先保存拟提交原件；若在更早阶段失败，可能没有它或lineage ACK，当前Inspect会在第二次私密读取前停止，需要另外明确只读核对范围，不自动寻找/修复。SQL提交与本机result保存也非原子；独立回读不能当作允许再写。
- 时间检查不取消已发出的SQL/S3请求；成功回读只说明观察时的准确计划/job/旧摘要及对象版本，不证明当前AWS健康、namespace空闲、自动清理、全部业务表不变或最终部署成功。后续运行仍要自己的实时preflight和人工environment批准。
- 50 USD/月是目标不是硬cap；S3/数据库/API/CI和已有AWS资源可能收费。这里不删除/停机/续期资源，也不保证绝对零费用或清理收费停止。

## 准确命令（先Prepare，再另行确认SHA）

```powershell
node --experimental-strip-types ops/platform-review-v6/local.mjs --mode Prepare --ci-run <最终准确CI> --output F:/ChatGPT_workshop/techlong-w6m-review-plan-20261020-a
```

只有新SHA明确批准后，Publish一次，然后独立Inspect一次；下列是未来入口，不是本页授权：

```powershell
node --experimental-strip-types ops/platform-review-v6/local.mjs --mode Publish --manifest F:/ChatGPT_workshop/techlong-w6m-review-plan-20261020-a/manifest.json --approved-sha <新SHA> --output F:/ChatGPT_workshop/techlong-w6m-review-plan-20261020-a-run
node --experimental-strip-types ops/platform-review-v6/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6m-review-plan-20261020-a/manifest.json --approved-sha <同一SHA> --output F:/ChatGPT_workshop/techlong-w6m-review-plan-20261020-a-inspect
```

不重放W5r/W6k/W6l，不新增任务、身份/权限实验、F3c9、Sites或本地Docker。整套平台最后迁到AWS。
