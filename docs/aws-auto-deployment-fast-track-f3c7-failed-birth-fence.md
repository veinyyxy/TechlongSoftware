# F3c7：失败出生的数据库排除围栏与独立占用证明

2026-10-12 Winnipeg。本切片完成**数据库侧**候选 schema、窄权限候选、一次写 adapter、独立 certified reader 和真实 Neon material factory。没有安装到 Neon，没有 AWS 调用/新增 IAM/Lambda，也没有失败 DeleteStack 能力。自动部署/清理闭环仍未启用；数据库证明不能替代 DynamoDB 的 activation/provision 排除和云批准。

## 实现范围

旧 admission 只允许到期后 draining，不能把提前失败伪装成成功 Cell 到期。候选新增 `failed_unadmitted`：admission epoch 从0到1、准确 fence SHA/Stack ARN/expiry，**provision operation hash 必须 NULL**，changedAt 可早于 expiry。既有环境行锁与只允许 open 的 capacity/deployment/resource 门禁共用锁，失败关闭后不再接收新租户。

schema 候选只增加一张永久围栏表，替换环境的 transition function 和两条 CHECK，增加四个 Always trigger，并把环境 transition trigger 设为 Always。保留原 open/draining 语义；新状态必须对应同事务插入的准确 fence。冻结完整环境 tombstone、围栏 UPDATE/DELETE/TRUNCATE；不自动复位/替换/补齐/重试。**会修改原环境函数/约束**，未来安装必须明确批准，不借用过去“只新增保护 schema”的授权。

不增加或修改受旧证书保护的业务表 trigger/function，不增加指向旧 deployment 的 FK，不重登记/更新旧证书。真实 PostgreSQL 证明显示旧完整目录指纹与证书/原计划行均保持。故意采用独立的新保护目录指纹，包含环境/围栏表定义、约束、索引、全部相关触发器/函数/owner/RLS；不能拿旧目录指纹替代它。

`begin_failed_cell_birth_fence_v1`固定 search_path、revoke PUBLIC、全字段/类型/精确 hash 校验，锁准确环境并核对未改变身份、open/epoch0/apply0、原 sealed plan 和零占用后，原子 INSERT fence＋关闭 admission。原实例/订阅/旧计划不取消或改写。新函数可受限写数据库，但不是云删除授权。

窄权限文件**与 schema 分开**：reader SELECT 新 fence，jobs/steps 只读 `id/deployment_id/status` 三列（不是行过滤，不开放 payload）；drain 只新增准确函数 EXECUTE。无新 role、LOGIN、密码、Secret 或业务表写权限。

`failed-cell-birth-fence-v1.ts`从真实 branded failed Stack 编译精确 fence 数据；完整计划、Stack/代次/模板/partial inventory、环境身份及 epoch0 绑定。数据 flags 均 false；冷 decoder 不是批准。writer 检查准确 fence SHA 后最多一条 SQL，异常/丢失响应只 Inspect。当前没有开放安装 helper 或批准登记；SHA 入参不能代替未来 fresh 人工审批/窗口/代码绑定与当前云证据。

`neon-failed-cell-birth-source-v1.ts`以独立 protocol 做14 SELECT的 Serializable READ ONLY DEFERRABLE事务：受限非 owner reader、准确失败 fence/环境、旧注册证书及未变化完整目录、原始实例/deployment关联、capacity/resource/schedule和runnable job/step。保留旧计划原始1/1 witness，仅排除准确封存记录，拒绝新关联/占用/保护漂移/多余权限。WeakSet proof拒绝JSON复制，30秒新鲜度；不冒充旧 v3 due/draining、成功 provision 或 DeleteStack authority。

真正的 Neon factory 只接受已审阅的内存 material、固定 reader/drain 用户、同 host/database、TLS、实际已注册证书 SHA 与新批准保护 SHA；构造不连接数据库，不读环境变量/Secret，不安装 schema。固定 Lambda material loader/handler/自测 bundle hash 和父批准范围仍需后续组合。

## 最终验证

最终隔离 PostgreSQL 16.14 r7 于 **19:12:55.688 UTC / Winnipeg14:12:55.688**通过10项真实证明：旧证书/全目录不变、错 hash/NULL/直接 transition 拒绝、已有 capacity 拒绝、真实并发 INSERT 等待环境锁后拒绝、提前失败且无 provision hash、实际 TLS/SCRAM 受限用户登录与只读 census、复制 proof 拒绝、永久 tombstone、禁用保护/扩大 reader EXECUTE 被识别、错批准零 SQL/已占围栏不重试。测试集群已停止；AWS出生参数和业务行是明确合成夹具，不是云执行验收。

另有 **4新＋8相邻共12项定向测试通过**，typecheck、定向 lint 无 warning、两 CLI syntax通过。只跑本次/相邻边界，没有重建镜像或重复旧云探针。r1–r5修正隔离夹具 search_path、workspace 唯一约束、reserved_at 和角色登录等问题；失败回执保留、对应集群均停止，未放宽生产/旧证书校验。r6是收窄列权限前证明，最终以r7为准。

Neon最终 r3只读核对于 **19:12:18.712 UTC / Winnipeg14:12:18.712**通过：实际PG18.6（180006）、open/epoch0/apply0，新表/函数/状态均不存在；证书SHA `dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f`与目录 `41eea5ac8b64801144fa568dce2b42d5dcb350a520a82df91f973c23bedab168`保持。raw active/association/deployment各1，capacity/resource/schedule/job/step各0；未过滤成生产 failed-birth proof。

operator prestate使用现有owner连接但只执行READ ONLY，不能当成受限运行时证明。首次只读脚本把非 owner runtime 条件混入operator审阅，r1未完成不表示证书损坏；r2/r3明确分开定义安全性和调用者身份，运行时reader要求未放宽。这里没有给PG18安装新DDL；真实DDL/事务验证是PG16.14，未来PG18安装仍须相应验收。

最终私有材料：PG r7 `F:/ChatGPT_workshop/techlong-f3c7-failed-birth-pg16-20261012-r7/`：证明文件SHA `1127ee00ffc6dc2b9ce101e1646c27fbdad6a84802e16fcf4f1ff6fcf2bf896b`，停止/通过回执SHA `97776b3a798b1252ada682f2be50e3f7287af00290ae86ac9e264bbb7b5b54da`。其中模拟证书/新目录 digest不能作Neon批准。Neon prestate r3 `F:/ChatGPT_workshop/techlong-f3c7-failed-birth-prestate-20261012-r3/`，报告SHA `5e6192d6c71530871e92b71919e581020843e1027a884eaaf05aaf850cff93e9`，42代码SHA `361360c24888c562a0c64e98c436545438bb79ba83c3e204770321a896c71b7a`包含未修改原36；源码/package/lock/旧记录保持。[公开摘要](../ops/aws-sandbox/reviews/f3c7-failed-birth-fence.prepared.json)。

## 风险与继续位置

未来schema安装有环境表锁、原函数/约束变更和新保护；角色列权限不等于行过滤、SECURITY DEFINER写能力、永久环境关闭、owner/管理员可修改schema等风险需准确fresh范围确认。跨Neon/AWS非原子；提交后不自动down/复位/删除或重试。SELECT也可能产生提供者日志/费用，50USD/月为目标非cap。[PG16锁](https://www.postgresql.org/docs/16/explicit-locking.html)、[ALTER TABLE](https://www.postgresql.org/docs/16/sql-altertable.html)、[函数权限与固定search_path](https://www.postgresql.org/docs/16/sql-createfunction.html)。

下一切片补齐**DynamoDB准确activation/provision缺失的原子failure marker、配套publisher ConditionCheck/旧发布路径封存、不可变补偿intent/once-only journal、准确ARN STANDARD删除与独立恢复**。随后组合完整父登记/TTL child和固定Lambda root/包/权限，不能借F3c6 drain-only范围删除。数据库零占用不证明DDB缺失或有效IAM；当前不发行可执行批准清单、不创建Reserved/付费Cell、不启用worker/runtime。实际Neon schema/role/fence或AWS权限/部署仍另按fresh SHA批准。
