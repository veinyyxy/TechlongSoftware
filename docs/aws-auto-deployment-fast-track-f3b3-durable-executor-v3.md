# F3b3：独立v3持久执行入口与最小权限候选完成，未安装

2026-10-08 Winnipeg。完成准确密封登记后的下一代码阶段：v3持久authority解码/一次性CAS安装器、永久intent/receipt journal、独立executor root/SDK/Lambda与新包，及最小DB角色/Secret范围候选。实现head `0dd96ba816bef50d93ff6f369dcf705f3f86b852`，读权限补强/夹具修订head `c1bf7474be01032826a56a0b8a164cd0430c7a8a`，最终真实PG18验证head `34778181b4018f544b29abffad3a285d4cbf3873`。**本轮没有Neon角色/GRANT/业务写入、AWS安装或删除；默认Worker/Scheduler/runtime仍关闭，自动部署尚未上线。**

## 实际代码接线

`sealed-cell-cleanup-authority-v3.ts` 严格解码独立schema3/协议记录，完整前驱、证书、五类零集合和未删减raw关联见证都进入hash；重新计算候选/record/ownership hash、drain lineage、epoch/revision/时间窗口、固定身份与Stack参数。JSON副本不能经issuer编译器成为新的live候选；旧v2 cleanup记录、错证书pin、缺字段/未知字段/伪造零见证都拒绝。新记录只作为独立 `sealed-cell-ttl-v3:cell:cell-sandbox-1` 当前首轮一次性authority，不自动replace/reset/renew；后续generation需要明确新设计/审批，不能覆盖它当重试。

独立SDK reader用TransactGet原子读取新v3 authority与准确原provision-v2 item，要求后者仍逐字匹配完整已审前驱；只继承前驱，不消费旧v2 cleanup权限。单独installer只接受批准record SHA，用一次TransactWrite对旧provision执行ConditionCheck、对新key执行attribute_not_exists Put，既不改旧记录也不暴露给deleter；未知/拒绝结果只Inspect，不重试。事务权限由底层GetItem/PutItem和ConditionCheckItem定义，拟议IAM需要具体key及EnclosingOperation围栏，不能误写成一个泛化“TransactWriteItems权限”。[AWS事务IAM说明](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)

`prepared-sealed-cell-ttl-executor-v3.ts`使用独立event/schema3、完整durable record/state及专属身份的新运行删除plan SHA；旧v2 intent/receipt不接受。journal新prefix `sealed-cell-ttl-v3:intent:<sha>` / `receipt:<sha>`，strong read、永久条件Put，无Update/Delete/TTL/reset。只有明确CAS赢家有一次DeleteStack机会；失slot响应/重启/输家永远只读恢复。失DeleteStack/receipt响应不重发写，valid历史receipt只作为历史replay，不能声称本次又读到live缺失。

执行前先后读取authority与新Neon品牌快照，复用旧core中**仅AWS读取**的固定专属role/全Stack名称/无租户依赖/准确ARN、Original template/完整inventory/parent/root/termination protection/tag校验。新增只读helper不接受caller/role override，没有旧ownership projection或删除能力；legacy/v2默认路径原样。新root在可能很慢的journal CAS后再完整收集一轮，严格30秒/无时钟倒退/完整raw state不漂移，才委托准确ARN、CF role、STANDARD、无retain的一次DeleteStack。独立缺失恢复拒绝名称替换、矛盾inventory和终态失败，过期只允许对原计划的只读恢复，不恢复执行权限。

`aws-sdk-sealed-cell-cleanup-v3.ts`纯组装不解析凭据/调用网络，固定ca-central-1/忽略endpoint override/maxAttempts1；root不含authority installer/TransactWrite command，只有读authority和journal能力。新Lambda `techlong-sandbox-cell-ttl-executor-v3`、固定TechlongSandboxCellTtlExecutorRole，不覆盖旧函数；context/event校验先于凭据/网络。新 `CELL_CLEANUP_V3_SECRET_ARN` 仅接受准确账户/region/新readonly-v3名称；payload严格schema3/protocol/五字段，完整证书canonical pin固定为已批准独立回读的 `dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f`，URL固定cleanup_reader/Neon/TLS。不能从event或任意DB行替换pin，没有环境开关打开默认Worker。

## 读取完整性补强

v3 source的首条事务局部配置同时固定pg_catalog与row_security=off：这不是绕过RLS，而是在结果可能被策略过滤时使查询失败，防止隐藏active关联制造零；不改变Neon表/策略。角色检查新增列级INSERT/UPDATE与可执行非trigger SECURITY DEFINER检查，不能因只有列级UPDATE而误认为只读。完整证书/原始见证hash结构不变，旧schema2 source不改。[PostgreSQL行安全说明](https://www.postgresql.org/docs/18/ddl-rowsecurity.html)

## 验证与产物

45项密封/管理/新root定向检查、137项相邻清理/旧协议回归通过（存在重叠，非合计182独立用例），typecheck、定向lint、JS/PowerShell语法与production build通过。新root13项测试包括并发单赢家、完整record roundtrip、旧schema拒绝、wrong role/dependent Stack/非零集合、慢CAS/原始见证漂移、失slot/DeleteStack/receipt响应、不确定提交只读恢复和invalid event/context无凭据自检。

首轮 [37827222821](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37827222821)/head0dd96ba失败，fixture在draining后重新激活实例，被原admission fence以55000拒绝；两自有DB已drop，失败日志/原artifact保留于私有a5-failed。修订只调整RLS验证顺序，保留已有active实例，不关闭/放宽围栏。

最终 [37829262726](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37829262726)/head3477818/attempt1 success，固定官方PG18.6镜像，23组证明。除此前19组，新增RLS不能隐藏future terminal关联、reader列写/非trigger definer执行被拒绝、最小角色SQL允许必要行锁但拒绝status/密封原件写、新durable root消费实际受限只读PG证据并只调用一次**mock AWS actuator**。临时DB角色/GRANT只在CI自有数据库/服务，不是Neon安装；AWS/DDB/CF为明确mock，不是云删除/事务线上验收。

两CI自有数据库均drop、容器stop，独立reader要求23唯一proof/准确名称并校验head/path/main/attempt/success、artifact平台digest与清理。私有a6：raw ZIP SHA `1c961bba70708b2325c3f772363b7226da6e6abb05e4e71c75d8589565964218`，report `d505a06ce1d163d70b34c9ec1a34c1cf56bd62fb979f523b0f40466a100992f9`，receipt `82ee96cf8124cfcce07cbd9082792f6466fb99dd2e4fbe800d1e2b11e24dde72`，独立verification `655fdd4e59078d75953b040ff8d8e893c05dc63d47e54915a0841488142a7f4b`。

最终私有候选包 `F:/ChatGPT_workshop/techlong-f3b3-executor-v3-20261008-a2/ttl-executor-v3.zip`：ZIP SHA `921046b3bddf8cb5c399b4ebad5c1f99957215b412d94fd13366b24f466d8bb7`，bundle SHA `1fa8f9b63388facad9ff9b38ae9b1f8674da8263a540d000308e4f1dd260ef0e`，review SHA `86597e1dcd5f25e4c90b35e6c5a98306ff742d892da17696dc209270aecebb64`。node22/x86_64/index.handler，自包含、重复构建/ZIP hash及字节回读、无凭据invalid event启动通过，完整project输入pins与lock入report；未上传/安装，不是Linux Lambda在线proof。a1旧候选及历史v2 ZIP保留，不重建app/lifecycle镜像。

## 最小权限候选与真实只读库存

未注册SQL `ops/aws-sandbox/sql-candidates/f3b3-control-db-role-grants.sql`，SHA `7fc82e392d1745b4e7031a1449d094cd2b327cfaccb459f768e917a4754df016`，**不是执行清单/批准**：

- 两准确角色开始NOLOGIN/NOINHERIT/无super/createdb/createrole/bypassRLS，不授owner membership。reader默认readonly，仅public USAGE和八张必要表SELECT，无写/DDL/fn EXECUTE。
- writer准确名为 `techlong_cell_drain`，匹配现有严格loader；不创建/改历史草案别名techlong_cell_drain_writer。仅四表SELECT、env七个admission列UPDATE、jobs十一列INSERT、deployment/resource的updated_at列UPDATE用于FOR UPDATE行锁。**列授权不是行过滤，且确实有修改timestamp的能力；两审阅SQL仅锁定不更新它，审批必须明确接受，不把它说成纯读权限。** 不授status/plan/owner/registry/fence修改或DELETE/TRUNCATE/DDL。PostgreSQL行锁需要至少一列UPDATE权限，已在真实PG18验证。[SELECT权限说明](https://www.postgresql.org/docs/18/sql-select.html)
- 凭据/LOGIN激活/Secrets各是后续具体写范围，不能用上述NOLOGIN SQL当运行时已可用。新readonly-v3 Secret payload包含数据库URL与完整已核验证书及pin；drain-control沿用严格databaseUrl-only形状。不会上传密码/URL/SecretString到Git或日志。

实际Neon只读capability文件 `F:/ChatGPT_workshop/techlong-f3b3-control-db-20261008-a1/control-db-capabilities.json` SHA `107f1758022541a0b0584a954cac8d88e4e0dd4b8b90dc95021eb2cac5dde749`：原证书/guard一致，reader/drain/历史writer别名/registrar均不存在，neondb_owner有CREATEROLE、非super，PUBLIC可执行非trigger SECURITY DEFINER为0。本轮未创建角色/GRANT。

Source真实STS仍准确IAM user；新只读脚本 `inspect-f3b3-sealed-runtime-resources.ps1` 最终库存私有文件 SHA `b5ca5f323bc728e6411669491054e2beafc36584f4e05c8f1a0c18831eba4634`：专属TtlExecutorRole/DrainCoordinatorRole、readonly-v3/drain-control两个Secret、新Lambda-v3均ABSENT；authority表ACTIVE/PAY_PER_REQUEST（Read/WriteCapacity显示0不是禁止读取或零费用）。未GetSecretValue、未读取其他业务资源、未写AWS。旧readcap5历史描述不能替代这次实际表模式；权限、请求费用与Budget仍需在具体安装前审阅。

## 下一小阶段

生成最小DB角色/GRANT、LOGIN凭据/两Secret、准确IAM/boundary/新Lambda/authority安装的**可执行、fresh SHA审阅入口和清单**，先对当前原件/槽位/资源再只读核对。各批具体确认后才写；不把本SQL SHA、zip SHA或泛化“开始下一步”当新增权限批准。明确处理一次性authority key的首轮条件、未知响应只读回读与立即撤权范围，不自动覆盖旧权限/对象或复用旧slot。实际authority/cell尚未验收，默认runtime off、50USD/月目标不变，CF/baseline/DNS/mTLS/单租户闭环随后集中验收。

此代码/候选小阶段完成，F3b3/自动部署仍未整体完成。两个main按默认Git授权推送，服务端仅同步记录。两Neon schema/install登记slot永久保留，不再Run或down；资源草案 `ops/aws-sandbox/reviews/f3b3-sealed-executor-v3.prepared.json` 所有安装/新权限/runtime授权false。
