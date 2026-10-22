# W7k：平台 Web 数据库最小权限接线——仅目录审计待审范围

2026-10-22。继续[两小时平台 HTTPS 验收主线](aws-platform-hosting-w7c-two-hour-https.md)，[W7j 镜像发布与撤权](aws-platform-hosting-w7j-publication-verified.md)已完成。本阶段只实现并测试真实只读审计入口，随后生成具体待审 SHA；“开始下一步”不批准读取生产数据库、安装 SQL 或创建 Secret。

## 为什么先查目录

已发布镜像内的应用使用 `DATABASE_URL` 经 Neon 驱动访问平台库。现有 controller 窄身份不具备 Web 登录/页面所需权限，不可复用；更不能向托管 Web 交付现有本地 owner 身份。

现有受限候选为 `techlong_platform_web_acceptance_v1`，将来拟使用 Secret 名称 `techlong/sandbox/platform-web/neon-v1`，都不是已安装事实。读取首页、管理员概览、实例详情需要读取现有业务表；真实登录还会读取认证列、更新失败计数/锁定时间并增删会话。注册、邀请、密码修改、业务/部署/controller/authority 写入不属于首轮验收。

因此先查实际目录中的表/列、owner/OID/ACL、角色属性与成员关系、PUBLIC 可达 SECURITY DEFINER 路径、默认 ACL、认证表触发器，再确定窄授权清单。**本审计不会授予任何权限或判定未来 grant 已安全安装。** 不能仅用静态 CREATE TABLE 文本推断现网授权。

## 唯一允许的生产动作（需准确 SHA 另批）

工程入口 `ops/platform-web-database-v1/local.mjs`：

- `Prepare <F清单路径> <F中CI收据路径>`：只读本地配置/源码/CI收据，在内存解析 `.env.local` 中已有 DATABASE_URL，取得目标主机/数据库/actor 的指纹；不连接数据库，不初始化 AWS/GitHub clients，不消费执行槽。CI收据在生成前由独立 GitHub API 回读，包含准确源码及成功 PostgreSQL 步骤；运行时校验已绑定的原始收据摘要，不冒充再次联网查询 GitHub。
- `ReadReviewed <F清单路径> <完整SHA>`：必须有单独批准。仅在准确 main、源码 pins/风险/query SHA/目标指纹匹配、48小时清单有效、稳定槽未消费时执行。允许源码锚点后仅追加 README 和准确项目审阅索引，不允许改运行代码。
- 通过本地门禁后，wx+fsync 消费稳定永久槽 `F:/ChatGPT_workshop/techlong-platform-web-db-catalog-v1.intent.json`，再建立**最多一次** Postgres TLS 连接。使用既有本地 DATABASE_URL 的密码，仅在内存传给该原始固定 Neon 目标，不输出、不写入清单或收据；不调用 AWS GetSecretValue、读取 App PEM 或私密包。
- 连接显式指定 host/port/database/user/password，`rejectUnauthorized=true`、固定 TLS servername；不把 URL 字符串交给 pg 再次解析，也不继承 PG*、DATABASE_URL 或 Node/Git 覆盖。只接收已列出的 sslmode/channel_binding 参数，拒绝 options 或证书路径注入。启用驱动 channel binding 支持，但不声称已单独证明强制 SCRAM-PLUS。
- 一次 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`；三次 `SET LOCAL` 仅设置 pg_catalog search_path、15秒 statement_timeout、3秒 lock_timeout；**七条固定 SELECT**，只访问 pg_catalog 系统目录，最后 COMMIT。错误时尝试 ROLLBACK 并关闭连接，不另建连接或重发查询。
- 七项：数据库/会话身份及候选角色属性；非系统 relations/columns/ACL；schemas/ACL；routine 签名/语言/definer/ACL；与 actor/候选相关成员关系；default ACL；两张认证表的 trigger 元数据。每类最多1000对象，超限或超过2MiB拒绝，不把截断结果当作完整目录。
- 不读取业务行、密码/hash/salt、会话 token/hash、pg_authid、函数正文、默认表达式或任意角色配置值。列名中出现 password_hash 不等于读取该列数据。对 routine/trigger 仅看元数据，绝不执行用户函数。
- 结果保存在 `F:/ChatGPT_workshop/techlong-platform-web-db-catalog-<nonce>.json`，包含准确目录观测、候选缺失项及待审风险路径。项目只提交无凭据摘要、清单 SHA 和目标指纹；生产目标的明文 host/actor/database 及完整收据留在本地 F 材料中。

准备会单独读取一次本地配置；实际被批准的读取再读取一次并核对同一目标指纹。密码未做哈希后公布，也未绑定到审批摘要；目标身份或配置改变需重新准备，不能沿用原批准切换数据库。

## 本次明确不允许

不 CREATE/ALTER ROLE、不 LOGIN/PASSWORD、不 GRANT/REVOKE、不建视图/函数/策略，不写业务/认证数据、不做真实登录、不调用业务 SQL 或 controller 函数；不改共享 PUBLIC 权限、默认权限或原触发器。审计程序不调用 AWS/GitHub API，不创建/删除云资源、不改 Secret/IAM/ECS/Cell、不重建或发布镜像。普通代码提交、No-AWS CI 及其独立只读 API 核验仅属准备，不给生产审计程序添加调度权限。先前 d902... 发布批准不能复用于本阶段。

这不是通用 SQL shell，没有任意 query、host、role、credential 参数或自动升级路径。未来修正目录发现的问题仍需具体范围审批，不能在审计出错时顺便修库。

## 必须接受的风险及一次性语义

- 即使 READ ONLY，认证、数据库唤醒、网络/提供者日志、目录访问和锁等待仍有成本及可见性；不是绝对零费用/无副作用。原50USD/月只是项目目标。一次连接不等于只有一次网络包，服务端及 TLS/provider 内部行为不由应用计数控制。
- 本地文件包含现有较高权限凭据；程序只向固定目标发送并在内存使用，但主机管理员、恶意依赖、内存取证、提供者日志及运行中并发篡改风险不能消除。文件链接/代码指纹/clean-main 检查不是跨文件或跨服务 CAS。
- 目录名称、角色名、ACL/对象ID属于内部技术元数据。完整材料留本地；人工转发日志/文件可能暴露这些信息。错误输出只保留固定错误码，不输出连接字符串、SQL参数、原异常 detail 或 stack。
- 数据库只读事务有明确的 PostgreSQL 语义，并不自动禁止一切临时/会话行为。本程序进一步只执行固定目录 SQL，不以“只读”之名运行临时 DDL、用户函数或任意 SELECT。[PostgreSQL READ ONLY 说明](https://www.postgresql.org/docs/current/sql-set-transaction.html)。schema search_path 固定为 pg_catalog，避免按调用者搜索路径解析查询函数。
- 目录快照只能描述观察时刻；不证明未来没有并发 DDL、授权、角色替换或网络身份变化。PUBLIC、角色成员、默认 ACL 和触发器都是后续 grant 的输入，而非自动修复许可。[成员关系](https://www.postgresql.org/docs/current/catalog-pg-auth-members.html)、[默认 ACL](https://www.postgresql.org/docs/current/catalog-pg-default-acl.html)。
- 当前候选按现有应用查询设计，**列授权不是行过滤**：未来会读跨用户认证列/业务表，认证会话 INSERT 能在数据库层代表其他用户，SELECT hash 有离线破解风险。它只是不授予 owner/DDL/业务写的首轮验收角色，不是被攻陷 Web 的完整租户隔离边界。未来真实安装前须明示这些风险，不在本阶段偷偷添加共享 RLS 或重建镜像。
- 永久槽一经消费，不删除、复位、复用或自动重试。连接失败、TLS/SQL失败、目录超限或收据落盘失败，也可能已消费槽且结果不完整；失败文件只记录错误码，不自动另建槽或重连。成功输出不自动安装角色。清单过期只重做待审准备，不能重放已消费槽。
- TLS 验证使用 pg 显式配置，不混用 connectionString 的 SSL 参数覆盖；[驱动 SSL 参数覆盖说明](https://node-postgres.com/features/ssl)。CI 的一次性 localhost PostgreSQL 无 TLS，仅验证 SQL/元数据行为，不能冒充 Neon 连接、真实 SSL 或最小权限安装已通过。

## 测试与后续

No-AWS CI 只有 contents:read，无 environment、id-token、仓库私密材料、镜像构建/push/upload 或生产连接。复用工程已固定 digest 的 PostgreSQL18.6服务镜像，验证准确目录 SQL 在真实一次性 PostgreSQL 上可执行、role absent/present/列ACL/sequenceACL/PUBLIC definer/trigger 可见，以及业务行和函数正文不被返回；不证明现网也是同一版本。CI创建/写入的是 runner 内一次性测试对象，不能记作已安装生产授权。

本地契约测试覆盖准确七查询/安全路径/目标TLS/清单期限及摘要/身份和截断拒绝/单次连接前先消费/失败关闭不重试/固定错误码。已发布平台镜像、旧发布权限和旧永久槽保持不变；不用再跑300MB镜像构建。

首轮真实PostgreSQL CI `39838421235` 捕获了序列默认ACL类型码大小写错误，证据保留：pg_class的relkind是大写S，但acldefault的SEQUENCE参数必须是小写s，大写S代表FOREIGN SERVER。修正的是目录查询，不是放宽原SELECT/UPDATE/USAGE断言；最终批准材料只绑定修正后源码的成功CI。[PostgreSQL acldefault类型参数](https://www.postgresql.org/docs/current/functions-info.html)。此诊断没有连接生产Neon或消费执行槽。

具体清单将在准确 CI 成功、独立回读后离线生成，48小时内可批准；当前不得执行生产审计。审计完成后的下一步才是以真实目录为依据准备该单一 NOLOGIN Web 角色及窄授权，再单独处理 Secret/LOGIN 与两小时托管部署；不进入旧 F3c9 或恢复旧租户支线。
