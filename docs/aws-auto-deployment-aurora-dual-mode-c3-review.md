# D002 C3b：73表恢复/迁移清单已就绪，等待准确SQL批准

2026-10-14 America/Winnipeg；承接[C3a准备port](./aws-auto-deployment-aurora-dual-mode-c3-bootstrap.md)。本阶段代码、原归档编译、必要检查与最终GitHub Actions通过。用户重新登录Source后，新Review r4及独立metadata r3均通过，现有cluster/writer/Source/FREE-ACTIVE与准确历史一致。**尚未执行任何SQL连接/写入，两个新槽均未消费；刷新身份不授权Run，等待下面的准确SHA批准。** 旧token过期和旧Review记录保留，不重放。

## 当前待审清单与实际只读证据

- 新manifest SHA：`1df7e2f7da6b3e900f68e5d5814e2f32e1578c19af131270ef6a355112ced440`。
- 生成时间：2026-10-14 10:28:18.531 UTC / Winnipeg 05:28:18.531 CDT；截止：**2026-10-14 16:28:18.531 UTC / Winnipeg 11:28:18.531 CDT**。批准、Run与SQL Inspect均必须使用有效窗口；到期不重放或自动延期。
- 私有原件：`F:/ChatGPT_workshop/techlong-d002-express-c3-review-20261014-r4/manifest.json`。Review直接metadata 5次、SQL连接0、AWS资源写0；Source权限模拟allowed只作为模拟，不是SQL写成功证明。
- 独立新进程回读：`F:/ChatGPT_workshop/techlong-d002-express-c3-metadata-20261014-r3/facts.json`，10:32:28.062 UTC / Winnipeg 05:32:28.062 CDT，文件字节SHA `5e22e302314042cc5281f75c575b21ef9723609deb4e2d307442046a3c3dac6c`。直接metadata 5次、SQL连接0、资源写0，结论 `PHYSICAL_ONLY_SQL_NOT_PROVED`，不证明待创建SQL对象不存在或schema可恢复。
- 当前210 code entries+2原生工具、183历史pin entries全部匹配；code binding `fc7a6d9adc785d481269ceba26f8a1fef0c0edc594900663c8fd24be443f63e9`，SQL program `84948cfc92b85e6004429f1c19ffb02ed8ef887e44794bedc0c50001396a5431`。这里只更新文档/摘要，不改已验证执行源码，不重新构建镜像。

待确认范围：仅在现有准确Express集群创建下文两NOLOGIN角色及一个新库，promotion仅删除本次新guard，恢复固定73表schema并应用两份固定迁移（九条技术初始化行），随后独立只读SQL核验；不改Neon、旧业务或旧对象，不启用app LOGIN/运行时，不改IAM/Secret/ECS，不创建AWS资源。接受下文完整风险；50USD/月是目标，不是硬费用上限。

## 已实现的主线范围

`aurora_express_restore_v3.js` 复用固定archive/manifest和原pg_restore16.14离线编译器，通过真实owned Node pg管理/租户双会话应用schema及两份固定迁移；**不把数据库IAM token给子进程**。prepare仍按C3a三阶段，随后restore+SaaS migration共用一个事务：

1. 核对原nonce、真实role/database/管理role OID、完整ownership comment、NOLOGIN和新库PUBLIC关闭；拒绝已有表/对象。
2. 应用准确schema-only DDL与独立固定verification SQL，核对73表全部0行及原extension/五函数/四trigger；读取PG17目录，检查owner/表与列ACL/函数ACL/definer/RLS/额外schema等安全边界。
3. 应用固定 `saas_control.sql` 与 `theme_config.sql`，只允许1条singleton+8条默认entitlement，其余业务表0行。实例关联字段仍null，不创建商户、店铺或provisioned实例。
4. 读取完整PG17目录SHA及租户数据库实际大小，最多512MiB；再次核对OIDs/ownership和管理会话，再一次COMMIT。没有独立down、自动补齐或重试。

PG17的 `pg_collation.colllocale` 与旧PG16的 `colliculocale` 不同；新路径显式映射，**旧Full/PG16查询、结构pin和协议不改**。[PostgreSQL 17目录](https://www.postgresql.org/docs/17/catalog-pg-collation.html)

目录SHA是观察证据，不自动变成ready fingerprint；验证SQL覆盖原库存/零行/extension/程序，完整列/约束/index fingerprint仍不能冒用旧PG16 hash。512MiB是本次租户门禁，不证明集群总空间、Free Plan余量或未来增长。`lifecycleCompatible=false / runtimeEnabled=false`保持。

## 本地Root与准确待审资源

新入口 `ops/aws-sandbox/scripts/review-aurora-express-c3.mjs`：

- `Review`：离线重编译+5项直接AWS元数据调用；无SQL、无槽消费。
- `Run`：只有具体fresh SHA才可执行准确prepare/restore/migrate。最多3个SQL连接、18项直接SDK/CLI元数据、64次pg query调用；多语句schema/migration另由准确SQL SHA绑定。每组连接30秒/总120秒，整轮270秒，Source临时snapshot至少剩5分钟并以同份STS核验后签名。不缓存或保存令牌，不自动连接/写重试。
- `Inspect`：同一批准下最多2个新只读SQL连接，成功Run独立核对目录SHA/73表行数/九条技术初始化行/大小与ownership；失败Run仅固定管理库catalog回读，明确不是schema成功证明。
- `InspectMetadata`：无需新SQL批准，仅准确AWS元数据。过期历史清单只能这样只读核对，不自动延长/重放。

准入绑定原C2物理历史、诊断文件SHA、183历史pin entries、新Source/CommonJS依赖闭包及两个原生工具SHA；当前210 code entries+2工具。角色/数据库OID来自真实会话和阶段回读，不伪造v2 Secret、Fargate authority或activation。

仍仅准确 `techlong-sandbox-express-d001` / `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，新库 `tenant_a0da1748bc4d5419_db`、新app role `tenant_a0da1748bc4d5419_role`，nonce guard `tl_prepare_96c4e91750c441e3aab2de2609f7f029`。**拟创建两NOLOGIN role及一库，promotion仅删除这个新guard**；不删除旧对象，不改其他数据库PUBLIC ACL、不给app LOGIN/rds_iam/权限，不创建Secret/IAM/ECS/Cell或任何AWS资源。

新永久槽 `techlong-d002-express-c3-bootstrap-g1.permanent-slot.json` 与 `techlong-d002-express-c3-bootstrap-g1-inspect.permanent-slot.json` 均缺失，尚未消费。批准后消耗即永久，不自动复位；原C2/C2b与全部旧记录/槽保持。

## 完整风险——实际Run需要另行确认

- Source既有管理员权限不是新最小权限Fargate角色；本地bootstrap成功不授权应用、worker或其它数据库。
- 连接/DDL可唤醒现有集群并增加ACU、storage、I/O费用。50USD/月是目标非硬cap；资源继续留存，没有自动删除调度。
- prepare有独立role/database提交，失响应或失败可能遗留两NOLOGIN角色、guard-owned禁止连接库或已promotion空库。restore/migration是一个事务，但COMMIT失响应、文件journal或回读失败可能留下已提交schema/九条seed。
- 处置client使未完成事务结束，不等于已独立证明rollback；不自动down/delete/fill/补齐/reset/retry。旧空集群清理提案不得用于已创建租户状态；未来删除须按实际OID/nonce/owner/会话/数据重新审核。
- 合作锁、OID与metadata前后核对不是跨服务CAS，具有权限的并发管理员可竞态；TLS/网络/服务端日志、凭据刷新/传播、数据库超时和tool/journal写失败可能让证据不完整。
- IAM token和temporary keys只在内存；JS/driver清零是尽力而为，AWS/数据库提供者日志可能包含连接/SQL元数据。固定归档包含可信函数/trigger，不能将pg_restore当任意SQL sandbox。[官方恢复警告](https://www.postgresql.org/docs/17/app-pgrestore.html)
- PG17实机DDL、容量及完整结构fingerprint尚未验收；other-database PUBLIC CONNECT保持，因此NOLOGIN终态不能冒充v2目录隔离/IAM app登录。正确的后继仍是Secret-v2、受审IAM/app登录隔离、真实task/activation、ECS/健康与配置下发，不是先开运行时flag。
- Inspect自己的槽也单次；失败回读只能证明所读取的目录，不证明所有表/提交状态。窗口过期或Source失效时，只做metadata/准备新的具体只读方案，不能使用旧SHA再Run。

## 验证、失败历史和继续位置

- 原203375字节schema-only archive与manifest双pin保持：`1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a`、`62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971`。本机编译成功，SQL program SHA `84948cfc92b85e6004429f1c19ffb02ed8ef887e44794bedc0c50001396a5431`；没有上传原归档、schema或业务数据到GitHub/AWS。
- Backend4新+5相邻测试、平台2新+2相邻测试/types/定向lint、语法与断网自检通过。无效SHA的实际Root负例在AWS/SQL/槽之前拒绝，计数全0。不是实机PG17恢复证明。
- 初版 `bc86fdb1aeecd4808de7ac5e045f537b5bdae041` 完整CI38516295515通过，但双镜像38516295511 app自检失败/lifecycle通过：app没有也不需要原生编译工具脚本，新增port过早加载了编译器。修为惰性加载，真正构造仍要求原私有compiled brand；自检精确检查非法baseline错误码，没有扩大app镜像工具面或放宽SQL品牌。
- 最终源码 `16b5daa9d4af8a248d2918d719f1e15d60dc3498` 的[完整CI38517271135](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38517271135)与[双镜像38517271121](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38517271121)均success；独立app115698774364/lifecycle115698774520步骤回读全部success。不用前一版失败候选当证明，不ECR发布。
- 私有旧Review r1/r2全部保留但已被源码修正取代；r2 `e39cd040...` **不能执行**。独立metadata r1泛化停止、不倒填唯一原因；新增安全错误分类后Review r3明确 `EXPRESS_C3_SOURCE_TOKEN_EXPIRED`，SQL/槽0，未生成manifest。后续对不存在manifest的metadata r2也在AWS前停止。CLI/单独SDK STS可成功，不等于RDS/IAM等服务接受该会话。

**唯一继续点：确认当前 `1df7e2f7da6b3e900f68e5d5814e2f32e1578c19af131270ef6a355112ced440` 及完整风险 → 有效窗口内单次Run → 独立Inspect。** Source刷新、新Review r4及独立InspectMetadata已完成，不重复旧诊断、历史构建或任何Run；不接受旧r1/r2 SHA。当前无SQL、AWS资源/Neon/Secret/IAM/任务写，原183pins与用户Backend `.vscode/settings.json`保持；过期或凭据异常时不自动执行/重试写入。[紧凑继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3b.prepared.json)。
