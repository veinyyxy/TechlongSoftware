# W7k：Neon 只读目录审计完成，尚未安装 Web 身份

2026-10-22。用户确认准确清单 `cdf4f18d0989075ba364b503b0f82effc0ee0aa123d9b0468d149937e3d5e27f` 及其中绑定的[范围与风险](aws-platform-hosting-w7k-database-catalog-review.md)。唯一一次生产审计成功，结果 **READ_ONLY_CATALOG_CAPTURED_NOT_INSTALLED**。本次未安装角色/授权、未启用 LOGIN、未创建 Secret、未改数据库数据或 AWS，也未启动两小时平台托管窗口。

## 实际执行

执行 main=`274b91f551ff8f0be30fb27dd7cef5f36fbfed1a`；受审运行代码/风险/CI锚点=`526a3323350e3013c3f09562ff2364e1a4f0e385`，两者之间仅 README 和待审索引更新。准确原清单、十项源码 pins、风险、query/CI收据摘要及目标指纹全部通过校验。没有修改受审代码或重做清单来使执行通过。

- 开始/消费槽：`2026-10-22T19:29:18.814Z`，温尼伯 **10月22日14:29:18.814 CDT**。
- 完成回执：`2026-10-22T19:29:23.324Z`，温尼伯 **14:29:23.324 CDT**。
- 一次现有本地 DATABASE_URL 加载、最多一次连接；pg 显式配置证书验证与 servername 的 TLS 连接成功，没有将 owner 凭据交付 Web。
- 一次 REPEATABLE READ READ ONLY 事务；三次 SET LOCAL 只设置安全 search_path 和超时；七条固定目录 SELECT；COMMIT 后保存本地收据并关闭连接。身份查询观测 transaction_read_only=on。
- 没有业务行、口令/hash/salt、会话值、函数正文读取，没有 SQL data write/DDL、AWS/GitHub API、部署、删除、应用层查询或连接重试。统计描述受审程序控制流，不是服务端全部网络包/日志计数。

执行调用相同已批准导出入口 `main(ReadReviewed,...)`，仅在调用外对终端结果做脱敏投影；完整目录/目标不输出到聊天，只保存在 F。本地语义复核复用同一份不可变回执，没有第二次连接或额外 SQL。TLS 成功依据受审 pg 配置与连接成功，不冒充额外 pg_stat_ssl/证书遥测查询。

## 实际观测

| 项目 | 目录事实 |
| --- | --- |
| 服务端版本 | server_version_num=`180006`（PostgreSQL18.6）；不等于证明一次性CI与Neon所有提供者行为相同 |
| 拟用 Web 角色 | `techlong_platform_web_acceptance_v1` 在观察时不存在，无该角色的成员关系；不是已创建 NOLOGIN 或已激活 LOGIN |
| 目录覆盖 | 43个 relation 对象、51个用户例程对象、3个用户 schema；所有数组未触发1000对象上限 |
| 拟用表/列 | 15张所需表均存在，普通表、均由审计 actor 拥有；RLS/forceRls 均false；缺失表/认证列均为0 |
| PUBLIC 可达路径 | 本次检查的 schema/例程范围内，PUBLIC 可达 SECURITY DEFINER 路径0；PUBLIC 可达表/列授予对象0 |
| 认证表触发器 | 4个内部触发器、0个用户触发器；未执行触发器函数或读取其正文 |
| 默认 ACL | 2项相关目录记录，PUBLIC grant 均为空；未修改默认权限 |
| PUBLIC 数据库权限 | CONNECT、TEMPORARY；没有 CREATE |
| PUBLIC 用户 schema 权限 | public 为 USAGE；所有已审计用户 schema 均未对 PUBLIC 开放 CREATE |

认证表 auth_sessions 的六个现有列和 user_credentials 的九个列，仅检查名称/类型/ACL等目录元数据。`password_hash`、`password_salt`、`token_hash` 出现在列名不表示读取了列中的值。完整表OID、ownerOID、ACL和签名留在本地回执，项目摘要不公布生产 host、actor 或数据库名。

现有审计凭据虽然不是 superuser，却具备 createRole/createDb/replication/bypassRls，并拥有目标库及这15张表。**不能将这份凭据直接作为托管 Web 的 DATABASE_URL。** 当前观测足以继续准备单一受限 Web 身份，不自动授权创建它。

## 需要带入下一角色方案的 TEMPORARY 风险

PUBLIC 的现有 TEMPORARY 允许创建临时表；新角色不被显式授予 schema CREATE，并不代表数据库层完全禁止所有 DDL。PostgreSQL 的权限累加包含 PUBLIC，对单个角色 REVOKE 不能抵消仍存在的 PUBLIC 授予。[权限说明](https://www.postgresql.org/docs/current/ddl-priv.html)、[REVOKE 的累加语义](https://www.postgresql.org/docs/current/sql-revoke.html)。

这不是本轮新增权限，也不是已测试未来角色可执行临时 DDL；未来角色尚不存在。建议下一窄授权清单明确保留并披露这一现有继承风险，不声称“零DDL能力”，不为此自动撤销全库 PUBLIC TEMPORARY 或新增全库硬化支线。若要改变共享默认权限，必须另列受影响角色并单独审批。本次没有做 REVOKE、设置共享 RLS 或修改原触发器。

目录观测仍不是未来无并发 DDL/授权、无其他提权路径或业务租户隔离的证明。列权限也不是行过滤；未来认证 hash SELECT 和 session INSERT 能力的剩余风险仍按原风险文档评审。本阶段的“发现路径0”不等于已安装的角色可安全上线。

## 原件、校验和一次性槽

[机器摘要](../ops/aws-sandbox/reviews/platform-web-database-w7k.catalog-observed.json)不包含真实目标地址或凭据；原[待审索引](../ops/aws-sandbox/reviews/platform-web-database-w7k.catalog-review.json)保持原字节，作为历史准备证据，不代表仍待执行。

- 完整原件：`F:/ChatGPT_workshop/techlong-platform-web-db-catalog-8b2005d47002a7361de0b84e95dbff0e.json`，238246字节，SHA=`d351064ef8d7b4fca5266830117286febaca9e8b41fa15621c7718feab9ebf3e`。
- **已消费永久槽**：`F:/ChatGPT_workshop/techlong-platform-web-db-catalog-v1.intent.json`，SHA=`06f62069535276ad15c65322a21b81bb152d4bc030605155c6a7eeb82461f0cf`；保留原件，不删除/复位/重放，清单尚未到期也不代表可以重连。
- 离线语义复核：`F:/ChatGPT_workshop/techlong-platform-web-db-catalog-8b2005d47002a7361de0b84e95dbff0e.semantic.json`，SHA=`390df5f248b002d354f145b406c019a836bc17298753c8db67126cf3b65cc22b`，复核时间`2026-10-22T19:33:44.834Z`。重新计算 assessment 并核对 scope、目标、身份、nonce、时序、十项源码 pins 及 CI收据；additionalDatabaseConnections=0。它不是第二次独立云读。
- 原清单 SHA 仍为 `cdf4f18d0989075ba364b503b0f82effc0ee0aa123d9b0468d149937e3d5e27f`；原 CI收据 SHA 仍为 `ba54b008676b2a0eade803ba816fcd6adcc35087adbcd54806d758d284f65088`。
- 9项契约测试和准确CI `39838810686` 的13项成功步骤保留；本轮不重跑生产审计、云端CI或镜像构建来验证结果文档。

## 唯一下一步

以这份真实目录为基线，准备一个新的 **Web NOLOGIN 角色及窄授权** 待审方案：不赋 owner/superuser/bypassRls/createRole/createDb/replication，不给 controller/authority schema 权限，只覆盖现有首轮页面读取及认证必要列/会话操作；实际创建前必须重新核对准确目标、对象OID/owner、PUBLIC路径与角色缺失状态。共享 TEMPORARY 风险明确列入，不扩大到全库撤权。

本次批准已完成。新的 SQL/角色创建、密码/LOGIN、Secret、IAM、两小时 HTTPS hosting 部署和之后清理均不在本次只读批准内，仍分别审阅。现有 ECR 镜像和 W7j 发布权限本轮未操作；没有新的 AWS 状态观测或长期保证。50USD/月仍为目标，不是硬停费上限。
