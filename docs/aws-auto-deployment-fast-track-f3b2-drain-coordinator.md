# F3b2：生产 draining／清理入队协调与独立 Lambda 候选完成

2026-10-07 Winnipeg / 10-08 UTC。接通实际 Neon admission writer、清理作业 INSERT producer、serializable ownership source 与 F3b1 executor，并构建两个独立自包含 Lambda ZIP。**尚未安装、未启用 Scheduler/Worker，完整自动 TTL 及真实云删除仍未验收。**

本阶段只对 Neon 执行 READ ONLY EXPLAIN 和控制库存 SELECT；没有 draining/INSERT、数据库角色或 schema 写入、AWS API 写入/调用 Lambda、Secret 上传、镜像重建、付费 Cell 或资源删除。Git 提交推送沿用默认授权，50 USD/月仍为目标而非执行授权。

## 两个独立入口

| 入口 | 已接通的能力 | 不接受的能力 |
| --- | --- | --- |
| `techlong-sandbox-cell-drain-coordinator` 候选 | 强一致 provision item 回读→受审 drain SHA→数据库时钟到期 draining→准确租户 cleanup/rollback 入队→独立六查询 serializable snapshot→待审材料 | 没有 cloud DeleteStack、authority CAS 或 journal 写入入口 |
| `techlong-sandbox-cell-ttl-executor` 候选 | 单独 SELECT-only Neon source→F3b1 准确 plan SHA→永久 intent→严格 DeleteStack core→独立缺失回读／不可变回执 | 没有 draining、作业入队或 authority CAS 入口 |

协调器事件只接受四字段：schemaVersion/action/expectedProvisionItemSha256/approvedDrainIntentSha256。只有准确 `provision_verified` predecessor、完整 item hash 与 drain intent SHA 均匹配且 Cell 已到期，才调用 writer；每阶段重新强一致核对 predecessor。drain 后漂移停止入队；快照 fence、五类集合／计数／hash 和数据库/本地时钟都复验。输出 `TENANT_CLEANUP_PENDING`、`BLOCKED_CLEANUP_JOB_REQUIRES_REVIEW` 或 `ZERO_TENANT_READY_FOR_AUTHORITY_REVIEW`，**不会据此自签 authority 或产生删除批准**。

## 真实清理事件 producer

新 SQL 在同一个数据库事务内锁准确 sandbox environment、当前 resource 与 owner deployment，复验 account/region/cell、immutable draining epoch/hash/stack/expiry。固定批量最多10，ready 产生 cleanup，失败/回滚/取消中的已拥有资源产生 rollback；仍在 apply 的状态不冒充已稳定清理目标。

沿用现有 Worker 的 `jobType:deploymentId:planHash` dedupe key 和字节一致的 schema1 payload；INSERT仅 `ON CONFLICT(dedupe_key) DO NOTHING`，不 UPDATE/DELETE 作业、不抢占 Worker lease、不复位 dead-letter/canceled/succeeded 记录。job id 的内建 md5 只用于稳定标识，不当作授权 hash。所有 workload→database/role→Secret 的实际破坏性阶段仍由原 lease/epoch fenced Worker 处理。响应丢失只报固定 uncertain code，后续准确事件投递复用幂等键；blocked job 不被伪造为成功。

真实 TTL 只作用于已完成并过期的 owned Cell。Cell 创建失败或部分创建仍需独立 author-compensation 范围，不能用这两个入口提前强制删栈。

## 凭据、权限和安装材料

两个 handler 在加载凭据前拒绝非法事件、错误 function name/完整未限定 ARN、无效 Lambda 剩余时间；执行受独立 AbortSignal 截止控制。Secret 只取准确 account/region/name 前缀、AWSCURRENT、返回 ARN，JSON仅 databaseUrl，Neon TLS endpoint/5432 和指定 DB username 均验证，不接受 master URL替代。

- 协调器拟用 `techlong/sandbox/cell-drain-control` / DB role `techlong_cell_drain`。
- 执行器拟用独立 `techlong/sandbox/cell-cleanup-readonly` / DB role `techlong_cell_cleanup_reader`，不借用 drain credential。

这些角色/Secret 尚未创建或授予权限；名称约束不是最小权限的在线证明，安装前必须独立回读 DB grants/成员关系/作用域。共用 SDK class中可能包含通用CAS实现，但本root不注入CAS能力；未来IAM也必须禁止原authority key写入。

资源/权限草案为 `ops/aws-sandbox/reviews/f3b2-cell-cleanup-installation.prepared.json`，**不是可执行清单、没有安装授权**。提出专属 boundary，不静默修改七角色共用 ServiceRoleBoundary；旧 PLAN_ONLY Lambda保持不替换。若复用既有 Janitor execution role，新删除/journal/Secret权限定向新 executor function 的未限定 `lambda:SourceFunctionArn`，不能让旧函数自动获得新动作；准确当前role/boundary和IAM效果仍待fresh审阅。[AWS 官方 source-function 条件说明](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)

## 实际候选产物

最终私有目录 `F:/ChatGPT_workshop/techlong-f3b2-cell-cleanup-20261008-a5`，报告 `artifact-review.json` SHA **`3e7ee33443b69a3e50aa5c49501e44f9e0a759e2bce26b5f02629ce9a0841615`**。两个ZIP均只含 `index.js`，handler `index.handler`，Node22/x86_64候选：

- drain：324786 bytes；ZIP SHA `5e9e7253e2666793fd7c981444255d8bec368049b7057bc039732fed4f6a5160`，bundle SHA `4d7b84884a1e05bbfb59949319ce2e2eac33cb0176ce2df497867c480067e5a2`。
- executor：364454 bytes；ZIP SHA `c08cd0618fa9116f97031bb9ed49fb726ebed1698eff4a82a470dc8b39cf2fd3`，bundle SHA `d7bd49a93322388f0ff7563679d9f140f99cb7e42eb99b8903ec9210e8cbf83d`。

实际 esbuild0.28.0/fflate0.7.4与package-lock一致，依赖打入包、只允许Node builtin externals、无native构建；同输入两次bundle/固定ZIP时间重复hash相同，ZIP成员/原始bytes回读通过。drain包的metafile不含CloudFormation客户端或F3b1删除runtime。无凭据子进程实际导入并拒绝非法事件通过，未读连接配置或调用云。这里是Windows Node22.19本地自检，**不是Linux Lambda在线运行或权限证明**；未上传到AWS/Git。

首次a1因fflate package.json exports读取失败，其空目录保留；a2–a4为边界/凭据隔离修订的历史候选，保留但不用于下一安装。仅a5是当前候选，没有自动重试任何云写。

## 在线只读核验与验证

Neon实际 READ ONLY/SERIALIZABLE/deferrable transaction执行 **EXPLAIN，不带ANALYZE**；SQL SHA `78ca4315bcfcd853030aa41c3dd76fbf92d91c3371ce34abba9f757d8bf05a92`，语法、表列与plan通过，没有执行mutation CTE。无需新增schema migration。

控制库存：环境为account402010193138/ca-central-1/cell-sandbox-1、admission=open，live resource0，但未终结部署1；两拟议DB role均不存在。准确旧记录 `dep_d00144511731f1c20991aa56` 为 planned/plan_only、cell-demo-1、owned live resource0、active job0。**保留这条记录；不自动取消/删除/迁移或放宽零租户查询来忽略它。** 当前严格快照会因此阻止宣称零租户；是否及如何终结该旧计划必须另有准确review，不能假设只改status就一定满足所有五类围栏。

11项新协调/事件/handler测试，34项新入口+Neon相邻集和131项完整清理相邻集通过；typecheck、定向零警告lint、production build通过。旧F3b1 intent/receipt恢复围栏及PLAN_ONLY协议不变。`deployment:check-runtime`仍disabled/offline_only、monthlyBudgetTargetUsd50，检查本身cloudMutationPerformed/databaseAccessPerformed=false。源码协议测试使用provider fixture，不能替代上面的只读在线SQL核验或未来真实写入验收。

## 继续位置：F3b3

下一步先为旧plan_only记录准备保留原件的最小处置审阅，核对全部五类ownership集合；并准备新控制DB角色/Secret、独立IAM/函数/日志、准确调用/事件配置的安装清单。真实Cell/predecessor不存在时不能伪造可执行drain/authority/deletion SHA。

完整自动TTL仍缺独立受审 cleanup-authority writer/生产计划生成、调度安装和在线端到端 proof；目前协调器只输出后续review门禁，不把动态hash当人类授权。数据库/IAM安装、具体云删除、调度启用和付费Cell均按新的准确资源、费用/期限/不可恢复风险及fresh SHA另批。baseline、专属TaskRole、read cap/Budget、DNS/mTLS等仍为剩余门禁，F3整体未完成。两个main直接提交，无新分支；服务端source19cc镜像不重复构建。
