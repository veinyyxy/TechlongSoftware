# K2a：HTTP500后的初始化状态——一次Aurora只读审计 / 完整风险 v1

仅准备不代表允许连接数据库。此清单只解决“上次HTTP500之后实际留下什么”，不初始化、不接管旧job、不改平台ready。K1已经完成，准确新栈UUID `f71252c0-c917-11f1-8148-02ff648cb917` / task definition:2 / app digest `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e` 必须在新只读预检中保持。

## 唯一待批准能力

使用当前 Source `techlong-sandbox-user` 的短期凭据，经已有 IAM DB auth 和 ATS TLS，以既有管理用户 **postgres** 对准确租户库建立**最多一次新连接、一个SERIALIZABLE READ ONLY事务**：

- endpoint `techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com:5432`；集群resource `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`。
- database `tenant_a0da1748bc4d5419_db` / OID16459；应用role `tenant_a0da1748bc4d5419_role` / OID16456；管理用户OID16410；PG17.9。
- 仅复用已装角色/IAM；不新增权限、不读取Secret值，不读取JWT/mTLS/付款私密包，不发应用HTTP请求，不依赖或续用过期job lease。

固定SQL为**10条SELECT，正常共14次query**：BEGIN、SET LOCAL search_path、SET LOCAL lock_timeout、10 SELECT、COMMIT；发生故障最多额外一次ROLLBACK，不重连或重试。连接默认只读，服务端statement_timeout15秒、idle transaction15秒、lock_timeout5秒，客户端query15秒/连接30秒、整体180秒。前四条目录/身份查询通过后才读取表计数和状态。不允许任意SQL、任意WITH、SET ROLE、函数调用入口或来自清单的未验证query。

前八条为旧受审只读snapshot的**准确原字节/参数**：数据库/TLS/只读身份、应用role、数据库ACL、完整catalog定义、73表计数、ownership comments/guard、singleton/default entitlements状态、固定default store。其中目录/ACL/comments，以及entitlement的key/value/type/source/license引用ID/revision/updatedBy和店铺的UUID/code/slug/timezone/currency/status/default标志会返回进程内存，不能称为仅在服务端比较；仅持久化计数/布尔/摘要，不保存原行。第九条复用发布应用的13项初始化readiness布尔查询。第十条只返回计数和布尔比较：准确原幂等键/epoch/marker/hash、completed receipt一致性、固定店铺、预期owner用户名与店铺名、原配置/template/image metadata及provision audit。**不SELECT密码/hash、完整operation/result/实例metadata/audit正文、license正文或商户用户行值**；这些字段只在服务端作等值/存在性比较。

准确旧幂等键 `tlctl-0145bf0ce7258eb38b136c783afd0629-e1-3545b14293b00e38` 来自原计划idempotencyKey和epoch，不重新派生密码或body request hash。数据库中已有request hash仅用于等值/格式比较，不返回。UUIDv8店铺仍为 `add89a8c-f43e-81b9-8287-0cb6c5c54f87`，不修改它。

## 结果只分三类，不开放新动作

1. `PRISTINE_UNINITIALIZED_NO_POST_AUTHORITY`：当前可观察状态完整匹配原受审目录/ACL、73表计数、默认entitlements/唯一seed store；没有operation/owner/profile/audit提交痕迹。证明该快照下未初始化，不证明历史上的某条ROLLBACK必然执行，更不授权POST。
2. `ORIGINAL_COMMIT_CANDIDATE_CONTROL_VERIFICATION_REQUIRED`：13项logical readiness全真，准确原request/epoch/completed receipt、owner/store/profile/audit均匹配。只能称“原提交候选”，不是新镜像认证API initialized/effective configuration或平台ready证明；后续只考虑reconcile，不能再次POST。
3. `DIVERGED_OR_PARTIAL_NO_RETRY` 或严格校验失败：部分/异主/异配置/异epoch/结构或目录差异。停止、保留证据，不自动修复/补齐/再初始化。

所有结果均 `provisionAuthorized=false`、`platformReady=false`。本次不编译旧私密payload，不验证/发布首位owner密码；不能从SQL正向候选跳过后续认证控制核验或从pristine跳过新的单次初始化审批。

## 必须接受的风险和限制

- **管理权限与暴露**：postgres拥有较高权限，即使本入口固定READ ONLY，也比应用用户强。Source凭据和签名token仅在内存，可能被进程/内存/调试/提供者记录观察；SQL参数含固定标识及预期用户名/店铺名，目录/计数本身也是元数据暴露。不输出token/密码、原始SDK/SQL错误或业务行，但不保证内存副本完全擦除、服务端/提供者日志绝不保留敏感上下文。
- **只读不是零副作用/零费用**：连接可唤醒Aurora、增加ACU/I/O/CPU、日志、锁/快照/序列化负担和费用；管理登录/审计也可被记录。READ ONLY禁止普通持久表业务写，但不意味着底层磁盘完全无写入。[PostgreSQL17事务规则](https://www.postgresql.org/docs/17/sql-set-transaction.html)。50USD/月为目标非cap，既有Cell/服务/Secret/ECR等持续收费。
- **认证/TLS**：Source临时凭据必须在建立连接时有效，IAM token有效期及认证成功不代表后续权限/服务永不变化。仅精确真实endpoint，ATS根SPKI/主机名/SNI、客户端及backend TLS均验证，不允许密码降级、不用自定义DNS冒充DB endpoint。[AWS IAM DB auth](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.html)。
- **一致性/漂移**：一个SQL事务内部是同一快照，但AWS/Neon/SQL不是跨服务CAS。管理员、应用、旧Janitor可并发改变状态；整组metadata最多180秒，入DB前metadata距完成最多30秒，仍不消除竞态。预检要求准确新UUID/新镜像/旧IAM和固定Secret元数据/旧平台与DDB坐标不变；如变更就停止，不增权或伪造absence。
- **范围/时限**：新清单入场窗口最多两小时，并早于K1固定ExpiresAt至少十分钟；不延长workload、环境policy、父tag、订阅或lease。原Janitor保持启用。目录/角色/engine版本与当前已审17.9不符时停止，不能自动兼容或恢复schema。
- **一次性read attempt**：固定新永久槽 `F:/ChatGPT_workshop/techlong-express-k2a-initialization-audit-v1.permanent-slot.json` 在连接前独占写入+fsync。消费后即使网络/登录/SQL/序列化/响应或本地保存失败，也不自动重连、复位、补齐、再读或重试。只允许事务内最多一次ROLLBACK；这不是down migration。失败/提交响应不明时保存UNKNOWN，槽和旧记录保留；新的尝试必须明确另审，不能只换SHA/目录。
- **独立Inspect的含义**：另起进程只回读原SQL receipt/分类hash并重新核对AWS/Neon现状，**不建立第二次Aurora连接**。它验证本地receipt完整性和承载原状，不是新的数据库快照，不能证明SQL之后数据库未变。文件系统篡改、日志/保存失败和特权并发风险未完全消除。

## 不在本清单内

0云/IAM/Secret/DNS/DDB/Neon/业务写；0应用HTTP/POST；0JWT/mTLS私密包或Secret值读取；不重建/restore/seed/migrate、不改任何记录/凭据/角色/调度、不接管job/续租/改plan/artifact/epoch、不写ready、不延长07:04:28.726 CDT期限。不扩展F3c9、Grant或清理支线。

Review和Check都不会连接Aurora或签发DB token。必须对最终fresh manifest SHA及本文件的**一次postgres只读连接/事务、14正常query、非零费用和永久槽不重试风险**明确批准后，才可Run；再独立Inspect。此文件固定，不回填结果。
