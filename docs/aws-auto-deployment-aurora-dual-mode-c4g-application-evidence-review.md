# D002 C4g：同一最小激活流程，补齐写后失败证据

**已消费/仅历史（2026-10-14 Winnipeg）**：唯一Run写后ROLE_CLASSIFIER拒绝，实际rds_iam grantor=rdsadmin/旧期望postgres，COMMIT未提交、ROLLBACK成功。独立Inspect确认原closed/NOLOGIN，未进入应用登录。双槽永久消费，不复位/重放；下文0 SQL/槽不存在/待批准及候选原因尚未确认均为准备时事实。[实际差异、回滚证据与唯一下一步](./aws-auto-deployment-aurora-dual-mode-c4g-role-grantor-observed.md)。

2026-10-14 America/Winnipeg。[C4f提交前回滚及独立closed验收](./aws-auto-deployment-aurora-dual-mode-c4f-application-activation-stopped.md)后继续同一主线。本轮已完成新入口、定向测试和AWS只读清单；**SQL连接/写、Secret值/私密读取、AWS写和新槽消费均0**。没有修改任何C4f源码/槽/历史，没有新增权限/Grant/恢复探针支线。

## 能定位的事实与仍未证明的原因

C4f原catch只保留C4F前缀错误；冻结V6角色、应用ACL/目录及原row-count classifier使用不同AURORA前缀。因此三种拒绝可以被压成相同通用失败。原入口只在整体验证成功后保存结果，实际post数据没有保存；最后SNAPSHOT_5不是失败谓词。这个证据缺口可以由源码和定向失败路径重现，并已补齐，**不意味着历史实机失败原因已被唯一确定**。

冻结V6同时要求应用membership grantor=postgres、schema app-USAGE grantor=pg_database_owner、表/序列grantor=postgres。PG17会按实际owner/ADMIN授予路径记录grantor，不总等于登录用户；角色授予默认使用直接ADMIN角色或最近继承的ADMIN角色。[PG17 GRANT规则](https://www.postgresql.org/docs/17/sql-grant.html)、[PG17官方check_role_grantor实现](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/user.c)。因此grantor差异是候选原因，但本轮没有新的SQL数据来证明它，不能把候选原因称为已修复。新入口仍拒绝任何未审替代grantor，ADMIN/INHERIT/SET仍须false，原完整ACL/目录/行数规则不变。

## 新SHA与准确执行范围

`9a72074b2dd90358bdd9a05a9abdb52609636027e38f68c04fe8d2cbd1eb6270`

准备Winnipeg2026-10-14 **19:09:20.368 CDT** / UTC2026-10-15 00:09:20.368；有效至 **Winnipeg2026-10-15 01:09:20.368 CDT** / UTC06:09:20.368。文件目录按UTC日期命名：`F:/ChatGPT_workshop/techlong-d002-express-c4g-review-20261015-r1/manifest.json`。

这是一对新独立永久安装/核验槽，不是复位、刷新重放C4f或自动重试。用户须批准本新SHA、准确原八语句、独立管理回读及仅exact active时一次Source签发的应用TLS IAM只读登录，及下面完整风险；旧0c32...批准无效。

目标不变：账户402010193138、ca-central-1、集群`techlong-sandbox-express-d001`/`cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`；租户库`tenant_a0da1748bc4d5419_db`/OID16459、应用角色`tenant_a0da1748bc4d5419_role`/OID16456、管理postgres/OID16410。八语句不变：准确库CONNECT、public USAGE、73明确表SELECT/INSERT/UPDATE/DELETE、7明确序列USAGE、三条rds_iam SET/INHERIT/ADMIN FALSE、LOGIN。没有DDL、grant option、default privileges、新函数权限、序列UPDATE、其它数据库权限或业务行写。

原私有归档编译品牌仍必须通过、JSON复制品拒绝；C4g `program.json`原字节与C4f完全相同，program digest仍 `a9dedc4537c3656c073e9f7a6872d1d718785acb281bafe80ebd72b7243140c6`。新代码只包装现有同步验证器及查询回执，不替换/放宽它们。

一次Run仍为管理连接1、正常21 query/最多一次提交前ROLLBACK、权限/LOGIN语句最多8。写前后同事务检查准确closed→active角色、四库完整ACL、应用ACL投影后原完整目录、九技术seed/业务count0，只有全部原规则通过才COMMIT。失败不忽略谓词、不补写或自动重试；COMMIT提交后不自动撤销。随后唯一独立Inspect仍先管理只读1连接/8 query，只有完整active通过才应用只读最多1连接/6 query；原closed只报告安装未证明，不登录应用、不重放。

## 同次事务内的有限观测变化

每个既有快照响应在验证前保存脱敏框架，不新增SQL/query或诊断连接。Run正常10框架、Inspect管理5框架，每模式最多15，每框架最多256 KiB：

- 上下文：准确库/user/session user/OID、版本、只读/隔离和TLS标志。
- 角色：布尔属性、OID、受限membership及grantor元数据；config/valid-until仅保存是否null，既有SQL仍不选角色密码且只返回REDACTED配置。
- 数据库目录：行数与完整ACL digest，不保存额外业务内容。
- 用户schema：原catalog digest，public及已批准表/序列的应用ACL向量；不保存函数定义、DDL、trigger/default表达式、配置值。外来对象名称仅hash/类型和应用ACL标志。
- 行数：准确73表的名称/count，不选业务行值。

拒绝保留有限的 `ROLE_CLASSIFIER` / `CATALOG_PROJECT_AND_PIN` / `SEED_AND_BUSINESS_COUNTS` 标签和枚举校验码；提供者message/detail/hint/SQL文本、密码/token/Secret值不输出。ACL向量/grantor记录是证据，不会生成允许路径或自动学习新结构指纹。上下文/四库ACL的旧C4F精确拒绝码也保留，最后查询标签不再冒充具体原因。

## 已验证与当前边界

7项新+7项C4f相邻编排测试全部通过：新SHA/新槽、old SHA/过期/JSON品牌拒绝、脱敏、原grantor/成员提升仍拒绝、正常21 query不变、三个写后失败分别标注且先留证据后abort、COMMIT未知不补偿。测试使用明确合成VM，不能冒充云数据库结果。typecheck/syntax/定向lint通过。

Review25个只读AWS/CLI元数据调用核对C4e完整IAM、默认v4/保留v3/7消费者、固定Secret、Express17.9/FREE ACTIVE和Source准确两username connect模拟；没有SQL，当前closed/schema是C4f独立回读历史事实。260当前源码pins/2工具，原257不改、12项实际历史原字节保持，原归档重新编译通过。真实CLI使用旧0c32...批准在LOCAL_BINDING拒绝，AWS/SQL/槽/原生编译均0。新双槽均不存在；六份Review/代码/工具/历史本地核验没有追加云回读。[文件SHA及唯一继续位置](../ops/aws-sandbox/reviews/aurora-express-c4g-application-evidence.prepared.json)。

## 完整风险与后继

- 沿用[C4f完整风险](./aws-auto-deployment-aurora-dual-mode-c4f-application-activation-review.md)：同事务八权限/LOGIN提交后是持久73表DML，包含租户技术/授权表，不是行过滤；原PUBLIC函数权限保留，非跨服务CAS，COMMIT丢失响应/后续失败可能留下未知或已LOGIN状态，没有自动down/撤权/补齐/重试。
- 明确允许一对新的独立永久尝试槽：`techlong-d002-express-c4g-application-install-v1.permanent-slot.json`、`techlong-d002-express-c4g-application-inspect-v1.permanent-slot.json`（F:/ChatGPT_workshop）。旧双槽永久保留，新槽连接前消费且不复位/删除或再次使用。
- 新证据写发生在同次事务内，持久化/磁盘失败或延迟可能使事务abort或遗留未知状态；metadata框架不是独立SQL回读，也不是实际app权限/ready证明。提供者可记录连接/query/token元数据，内存擦除尽力而为，最大三连接可唤醒Aurora计费；50 USD/月不是cap。
- 历史原因尚未唯一定位。原严格规则可能再次拒绝，届时只能依据本次新证据审阅具体差异，不能自动接受其它grantor、启用INHERIT/SET/ADMIN、改密码或再消费新槽。此批准不授权后续修复或第二次尝试。
- Source签发的真实应用账号登录仅验证SQL用户/TLS及既有原只读权限/count检查，不证明ECS task/session/SCP/KMS或完整ready。NoInherit/SetFalse兼容仍须实证；失败后无密码回退。
- 不改IAM/Secret/Neon/业务/authority，不GetSecretValue/读私密源或AssumeRole，不初始化商户、发布ECR、部署ECS/Cell或启通用runtime。C4e持续权限及既有资源费用不撤销，Backend153efbc执行源码/镜像不变，旧Full和F3c9封存保持。

确认且新SHA仍fresh时才一次Run并立即独立Inspect。若成功，直接同一主线推进完整ready/初始化及ECR→ECS；如果旧谓词再次拒绝，保留准确新观测并在SQL回滚/独立核验后按实际差异审阅，不插入Grant/恢复/同类探针支线。任何新的实际调用范围各需明确批准。
