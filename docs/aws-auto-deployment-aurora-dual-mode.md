# Aurora Express / Full 双模式兼容与切换方案

> **最新 K2c 已完成**：用户确认f98bcd6c…后，Winnipeg 2026-10-16 01:30:52.825唯一三行事务提交，01:31:26.312另进程独立验收平台/初始化/有效配置/真实镜像通过；instance active、deployment ready、旧job succeeded/清lease，attempt与原计划/错误证据保持，明确人工恢复归因。2次私密加载/4GET，0云/IAM/Secret值/Aurora/POST，三个永久槽和本轮批准全消费，不再Run/Inspect或初始化。下一只做首轮验收/资源退出项盘点及最小方案，不扩展支线；固定07:04:28.726 CDT到期、Janitor和50USD非cap保持。[实际执行、22份证据及继续点](aws-auto-deployment-aurora-dual-mode-k2c-ready-reconciliation-executed.md)。下方为历史。

> **当前 K2c 最终待审**：K2b已初始化，不重复POST。新的人工收口入口以一个SERIALIZABLE事务协调三条原记录为active/ready/succeeded，保留旧plan/错误/人工归因，不续租或增加attempt；两次新私密包加载/四个认证GET另审，0 AWS/IAM写。39 tests/types/零警告lint/Check、真实只读Review和独立绑定复核通过，平台尚未ready、三槽未消费。SHA `f98bcd6ce2123c1e99085097e846937a8f389002f7637acd6cb1547efce2c5c0`，Winnipeg 2026-10-16 03:13:10.481入场/03:28:10.481执行截止，固定07:04:28.726到期不延长。[具体范围、完整风险与确认文本](aws-auto-deployment-aurora-dual-mode-k2c-ready-reconciliation-review.md)。下方为历史。

> **最新 K2b 已完成**：准确批准7596abc9…的唯一POST成功，Winnipeg 2026-10-16 00:32:19.910新进程独立mTLS/JWT验收通过initialized/effective configuration/准确store/新image。原平台记录和过期job不改，故仍非平台ready；两个永久槽及本轮私密/HTTP预算消费，不重复Run/Inspect或provision。下一仅K2c平台原子协调清单，新读/写另批；固定07:04:28.726 CDT到期不延长。[实际结果与继续点](aws-auto-deployment-aurora-dual-mode-k2b-initialization-recovery-executed.md)。下方为历史。

> **当前 K2b 待审**：新的人工单次恢复入口不冒充有效旧job lease，不改旧worker校验器或Neon记录；先一次新只读pristine guard，再固定Secret/原私密控制材料、一次provision和独立initialized/effective configuration验收，ready仍另审。25tests/types/lint及真实35/11/1元数据只读通过，尚无运行时动作；fresh SHA `7596abc946c49640de42832aab432bcbe437f51bcd81136221a692aebe1d3017`，Winnipeg 2026-10-16 02:24:39.501入场截止/02:39:39.501执行截止，workload固定07:04:28.726到期不延长。[准确范围、完整风险和继续点](aws-auto-deployment-aurora-dual-mode-k2b-initialization-recovery-review.md)。下方为历史。

> **最新 K2a 已完成**：准确批准e5610e47…的一次Aurora只读审计得到原始未初始化状态，73表计数/目录/ACL/默认entitlements/store保持，operation/owner/profile/audit无残留；Winnipeg 2026-10-15 23:52:07.651独立回执完整性和承载核验通过，不是第二份SQL快照。0写/私密值/应用调用，不POST/ready/续期；读槽与批准消费，不再运行。下一只准备K2b明确单次初始化及平台协调，固定07:04:28.726 CDT到期保持。[执行证据和唯一继续点](aws-auto-deployment-aurora-dual-mode-k2a-initialization-audit-executed.md)。下方为历史。

> **当前 K2a 待审**：K1恢复已完成不重放。现场35 SDK/11 CLI/1 Neon只读通过，修复镜像、新栈及旧平台原状保持；10条冻结/固定SELECT的单次postgres Aurora只读审计入口已完成，16tests/types/lint/独立绑定核验通过。本轮0 Aurora/私密值/写/HTTP/槽，初始化状态仍未知。待审SHA `e5610e470f12ce98d274b7ad605d5d3492542acfd874a4f8ae4d1698e47b18b1`，入场早于Winnipeg 2026-10-16 01:46:21.931 CDT；不续期、不POST/ready，原07:04:28.726 CDT到期保持。[完整范围、风险与继续点](aws-auto-deployment-aurora-dual-mode-k2a-initialization-audit-review.md)。下方为历史。

> **最新 C5k K1 已完成**：用户确认4b194dc3…后唯一CreateStack得到新UUID `f71252c0-c917-11f1-8148-02ff648cb917`，七资源CREATE_COMPLETE；Winnipeg 2026-10-15 23:16:07.509独立Inspect确认task definition:2/实际修复digest/1 running/healthy target，原Cell/IAM/Secret/DNS/authority/平台记录保持。新槽及批准消费，不重放，不POST/不ready；固定到期2026-10-16 07:04:28.726 CDT，旧Janitor保持，无自动续期。下一仅准备K2受审只读初始化状态核验及后续平台协调。[实际执行、证据与唯一继续点](aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-executed.md)。以下为历史。

> **最新 C5k K1 最终待审**：Source刷新后真实30 SDK/14 CLI/1 Neon只读通过；准确旧七资源删除、原Cell/库/Secret/IAM、新命名空间/镜像、Janitor与旧平台原状匹配，永久槽空、0云写/私密/应用调用。SHA `4b194dc34fa44bc23c1999d21363351b14177fd0e57e62bce5726f75c8e95e10`，仅申请一次新CreateStack/七workload资源及独立八小时人工窗口例外，旧Janitor/平台记录保持；提交截止Winnipeg 2026-10-16 01:04:28.726 CDT，不执行初始化或ready。仍需明确SHA及完整风险批准。[最终清单、两项时限和确认文本](aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-review.md)。下面为历史。

> **最新继续点 C5k**：用户同意先准备workload-only恢复。七资源单次新CreateStack/复用现有Cell和数据库/旧平台记录保留/独立八小时窗口及启用Janitor的范围和入口已接线，16项测试与types/本地Check通过；现场Review第一项SDK遇Source过期，未生成有效SHA、0写/私密/SQL/槽。刷新后仅继续新目录只读Review，再公布具体SHA另审创建。[准备状态、完整风险与准确下一命令](aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-prepared.md)。

> **当前继续点（2026-10-15 Winnipeg，C5j）**：UUIDv8修复镜像已在C5i发布并立即撤权、独立Locked/v10；恢复时查明原workload被既有旧Janitor删除，七资源DELETE_COMPLETE，镜像更新预检已拦截，未云写/业务写/消费槽。Cell/Aurora/固定Secret仍在，旧job租约过期。下一需确认“只恢复workload、保留数据库/Cell、明确Janitor兼容窗口及平台协调”方向，再准备fresh具体清单；不要重放旧批准。[准确删除证据、更正及最短主线恢复边界](aws-auto-deployment-aurora-dual-mode-c5j-deleted-workload.md)。下方设计/历史进度不覆盖当前状态。

决策 **D002**，2026-10-13 America/Winnipeg。状态：**设计完成，代码与云适配尚未实现/验收**。用户暂不升级 AWS account plan，要求先设计兼容或快速切换方案。本文件调整 D001 的数据库交付路径，不扩大“一个 sandbox 租户自动部署到 ready”的首轮目标。

后继编码已开始：C1双模式连接核心/严格v2契约/app pool分支/只读来源及云端镜像自检已实现；C1整体和Express实机尚未完成。[准确实现范围、验证与下一接线](./aws-auto-deployment-aurora-dual-mode-c1.md)。本方案以下“尚未开始/只有文档”是最初设计时状态，不覆盖后继实际进度。

## 结论与本轮边界

采用**同一业务应用 + 两个基础设施 provider + 两个连接 profile**：当前优先 `express_iam`，未来可选择 `full_password`。业务路由、73 表空 baseline、配置下发、ECS/ALB、mTLS/JWT和任务状态机尽量共用；网络、凭据来源、会话证明、数据库资源创建与清理分别适配。

“快速切换”指：适配完成后，新部署通过一份受审 profile/binding 选择目标，不重写餐饮业务代码。**不意味着已有 cluster 原地转换、只改一个环境变量、零停机迁移，或同一个用户同时接受 IAM/password。** 有数据的切换必须新建目标、验证迁移并明确切换写入端。

本轮只有文档和 Git 提交/推送；不升级账户，不读 Secret 值，不执行 AWS/Neon 写入、安装权限、重建镜像、删除失败 Stack、重试创建或启用 runtime。F3c9 继续封存。后续实际变更仍按准确资源/操作/新 SHA 单独批准。

## 1. 已证明的起点与官方约束

2026-10-13 的原 Full 基础创建因 Free Plan 被 RDS 拒绝，CloudFormation 自动回滚，独立核验为 `ROLLBACK_COMPLETE`；没有可用 Aurora/ALB 或已运行租户。公钥 Secret 和失败 Stack 记录保留，原两次创建槽永久消费。账户只读观察为 `FREE / ACTIVE`；详见[实际回执](./aws-auto-deployment-single-tenant-cell-foundation-executed.md)。D002 不覆盖这些历史事实。

以下是选型约束，不是本账户 Express 实机验收：

- Free Plan 只支持 Aurora Express；官方列明每集群 4 ACU / 1 GB 上限和账户 2 cluster / 2 instance 上限。这是平台限制，不是本项目允许自动扩容的预算。Free Plan 不等于 ECS、ALB、Secrets 等整套系统永远零费用。[Aurora Free Tier](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-free-tier.html)
- Express 使用 internet access gateway、IAM 认证和 5432，不关联客户 VPC，不能事后挂入 VPC；没有可供现有 provider 读取的 master password Secret。创建时由服务选择引擎版本；网关 TLS 使用 AWS root certificates。Express 快照可以恢复为新 Full 集群，这不是原对象原地切换。[Express 官方指南](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html)
- IAM token 用于建立连接，有效期 15 分钟，已建立会话不因 token 到期自动断开；临时 AWS 凭据在认证时也必须有效。为 PG 用户授予 `rds_iam` 后 IAM 优先于 password，不能按密码失败再自动降级。[IAM DB authentication](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.html)
- 应用用户仍需真实 SQL 用户和权限，不是有 IAM role 就自动有表访问权。PG 的 IAM 用户需 `rds_iam` membership；AWS 侧使用 `rds-db:connect`，资源为准确 `DbClusterResourceId` 加用户名，而非 cluster 名字或普通 `rds:` ARN。[SQL 用户](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.DBAccounts.html)、[IAM policy](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.IAMPolicy.html)

## 2. 复用与差异

| 层 | 共同部分 | `express_iam` | `full_password` |
| --- | --- | --- | --- |
| 餐饮业务 | HTTP API、业务 SQL、店铺/商户配置 | 不改业务语义 | 保留原语义 |
| 租户隔离 | 一个独立 database + 一个应用 role；应用无 DDL/管理权限 | 增加准确 IAM 用户映射并验证跨租户拒绝 | 现有随机 DB password / 精确 ACL |
| 基础资源 | ECS/Fargate、ALB、业务 HTTPS、control mTLS/JWT | 计算网络与 Express 数据库分开管理 | 现有私有 DB subnet/SG 与 Full Aurora |
| 会话 | owned Client、超时、取消、事务、真实 DB/user/OID 校验 | 每次新连接动态签名；网关 trust profile | Secrets Manager password；现有 RDS CA pin |
| 应用密钥 | HMAC/JWT/Stripe 的固定 Secret 版本、首位商户密码稳定派生 | 新 Secret/binding 协议，无持久化 token | 原五键 Secret 协议保持 |
| baseline | 原 archive/manifest 哈希、schema-only 编译、零行验证 | 在实际选定 PG 版本上再验收 | 原 PG16.14 验收只对原目标成立 |
| 生命周期 | prepare→restore→migrate→verify→activate 的意图和拒绝重放语义 | 新版本认证/目录 profile、真实证据适配 | 旧协议和冻结 provider 不放宽 |
| 创建/清理 | fresh 审阅、永久 journal、准确资源身份、独立回读 | RDS SDK 创建；记录托管 writer，单独清理 | 原 CFN Stack UUID / 有序清理 |

兼容不表示原代码“无改动就支持两种模式”。现有 app pool 和 lifecycle session 都使用固定密码；`tenant_rds_sessions.js` 强制 PG16.14、RDS CA、master Secret 和服务端 TLS 状态。Express 必须有新适配，不能向这些入口塞入假 Secret ARN、token 形式的长期密码或假 PG16.14。

## 3. 配置与接口：把业务配置和部署事实分开

以下为**待实现的接口设计**，不是当前可运行配置或审批清单：

```ts
type DatabaseProfile = 'express_iam' | 'full_password';

// operator 选择；在 review 中冻结，不由客户业务字段控制
type DatabaseIntentV2 = {
  schema: 'techlong/database-intent/v2';
  profile: DatabaseProfile;
  region: 'ca-central-1';
  tenantIsolation: 'database-and-role';
};

// 创建后来自 AWS 独立回读，绑定到具体 deployment/generation
type DatabaseBindingV2 = {
  schema: 'techlong/database-binding/v2';
  profile: DatabaseProfile;
  clusterArn: string;
  clusterResourceId: string;
  endpoint: string;
  port: 5432;
  observedEngineVersion: string;
  tenantDatabase: string;
  tenantUsername: string;
  connectionProofDigest: string;
  // Express：IAM principal + gateway/TLS evidence
  // Full：准确 master/runtime Secret references + RDS TLS evidence
};
```

实际实现使用 discriminated union：两种 profile 的必需字段和禁用字段分别校验，不让上面的注释变成可随意缺失的字段。profile、binding digest、实际 engine、资源身份、镜像/协议版本加入 review、plan、TaskDefinition 和 receipt 的哈希链；endpoint 只能来自被绑定的 AWS 事实。未知 profile、缺少身份、同名重建资源、混合 Express/Full 字段一律拒绝。

不会直接改现有已发布 schema-v2 的22项商户配置，也不自动改已提交五条业务行。部署意图进入新版本受审 overlay，旧 configurationHash/planHash/epoch/activation 不冒充新版本；若需要存储新 overlay 或启用记录，再单独审阅数据库变化。

拟保留三类边界：`DatabaseInfrastructureProvider`（create/inspect/cleanup）、`DatabaseConnectionProvider`（management/tenant sessions、app pool）、`DatabaseCapabilities`（真实引擎与权限证据）。业务层只拿 query/pool 和正常业务配置，不负责签名，也不能选择另一个租户/cluster。旧 Full provider 作为独立实现保留，新 facade 只分发到匹配版本，绝不在连接失败时自动切换数据库。

首轮仅两个 profile；Full 的 IAM 模式可作为未来优化，当前不维护第三种组合，也不引入 Data API、RDS Proxy、Custom Resource Lambda 或新通用 Cell 工厂。

## 4. Express 连接与安全适配

### 应用 pool 与短期 token

`db/pgsql.js` 保持对上层的 query/pool 接口。新连接工厂在 `express_iam` 下创建显式 host/port/database/user 配置和 async `password` callback，每次建立物理连接前，用 ECS task role 的可刷新凭据签名；不在容器启动时生成一份 token 长期复用。node-postgres 支持同步/异步动态 password callback；选用受锁定 SDK signer 版本，不复制文档中静态 access key 示例。[node-postgres 连接文档](https://node-postgres.com/features/connecting)

- 不把 token 写入 `DATABASE_URL`、Secrets Manager、Neon、任务定义、receipt、磁盘或日志；不缓存一个带 token 的 pool config。JS 内存清零不能保证，错误只输出脱敏码。
- 禁止 `DATABASE_URL`/`PGPASSWORD` 与 IAM profile 混用，避免 URI 覆盖 callback/TLS。任务不传长效 access key，凭据刷新失败则新连接失败，ready 不成立。
- pool 设小的有界并发和连接超时；验收“连接建立超过15分钟仍可查询、主动释放后新连接成功、AWS 凭据刷新后成功”。不为了 token TTL 每15分钟杀掉正常事务。
- 不用自定义 `techlong.cloud` CNAME 签名；签名 hostname、SNI 与连接 endpoint 一致，并绑定实际 cluster identity。客户端连接重试有界；这不是对 CREATE/DDL/清理等写操作的自动重试授权。

### TLS 与真实会话证据

Full 保留原 RDS CA pin。Express 新增独立 gateway trust profile：可信 AWS root 链、`rejectUnauthorized=true`、真实 hostname verification/SNI，来源与 image trust bytes 可追溯；不使用 `ssl=false` 或跳过证书验证。数据库 TLS 与 ALB control mTLS 是不同链，不能用客户端 CA 代替数据库信任。

先实读 Express 的 `current_user/session_user/current_database`、datOid、server_version_num、`pg_stat_ssl`、server address/port 和可用 PG catalog。网关可能让服务端报告与当前直连证明不同；这是**尚未验收的兼容点**。若不同，只能设计并审核新版本的等价证明（AWS绑定 + 客户端认证 TLS + 真实 SQL/OID/权限），不能删掉旧检查或把 null 当成成功。无法形成充分身份证据则停在不兼容，不激活租户。

### 管理用户与租户应用用户

bootstrap/lifecycle principal 只连接本次准确 cluster 的管理用户名；app task principal 只允许本租户 SQL username 的准确 `rds-db:connect`。不把 postgres/master IAM 权限赋给应用，也不允许 `dbuser:*/*`。现有 TaskRole 没有可证明的 Express 连接授权，已装 Full Cell role 也不能视作 Express 权限证明。

保持应用 role 初始 NOLOGIN、独立 DB ownership/guard 和 journal；Express activation 新版本仅加入被批准的准确 `rds_iam` membership 与必要 LOGIN/ACL。相关 catalog verifier 必须知道这一个受审 membership，仍拒绝其它 owner/admin/跨租户上行路径。原 Full 的 PASSWORD 设置和目录 fingerprint 不复用为 Express 成功证明；两种 verifier 分开版本化。撤销 IAM grant 不保证已建立会话消失，清理仍要关闭应用 pool、确认准确 DB 会话为0，不能直接 FORCE/terminate。

**实机前必须证明**：管理用户名有受审 CREATE DATABASE/ROLE/ownership 操作能力；新增租户用户名能通过网关 IAM 登录；其角色/DB 隔离、事务和新连接行为符合协议。官方通用 IAM 支持不替代本项目这些验收。

## 5. Secret、baseline 与协议版本

Full v1 继续使用严格五键：`database_url / hmac_secret_key / jwt_secret_key / stripe_secret_key / stripe_webhook_secret`，不改变旧载荷和校验器。

Express 候选 `runtime-secret/v2` 只保存后四个稳定私密键；DB endpoint/database/user/profile/IAM principal 是独立受审 binding，不伪造一个无密码 `database_url` 来满足 v1。v2 的准确 Secret ARN/version 与 binding 一起被 task/receipt 固定，不接受额外键或客户端自报版本。HMAC 派生首位商户密码依然使用固定 Secret version 的稳定材料，不能用 IAM token 派生。未来 Full/Express 切换若要保留账号、JWT或HMAC行为，需要显式批准密钥沿用/版本映射，不能重新随机生成后声称兼容。

现有 baseline archive `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a`、manifest `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971` 保持。当前 lifecycle **pg_restore16.14 只离线编译 schema SQL，再经 owned Node pg session 原子执行**，不是把 pg_restore 直接连 RDS，因此不新增 PGPASSWORD/token 子进程传递路线。

创建后冻结真实 Express 引擎版本并评估所需工具/SQL：PG16.14 的既有恢复证明不泛化到其它版本。检查73表零业务行、migration marker、ownership/ACL/角色membership、journal和允许的seed；1GB限额以实测数据库/集群占用及增长余量评估，不能用压缩 archive 大小推断容量。若版本不合，先报告具体差异，再审阅新的版本 profile/镜像，不自动升级/降级数据库或修改原 baseline。

raw task input、management target、runtime Secret、session proof 与 receipt 需要成套 v2 适配；旧 admitted root 要求的真实 activation/epoch/Fargate证据仍保留。新 profile 不能伪装旧品牌，也不能生成假 Scheduler/ARN 或只改 `runtimeEnabled`。

## 6. 基础设施与清理：避免再写一套大工厂

Express DB 与 compute network 分开建模。ECS/ALB 仍需自己的 VPC、subnets/SG 和出口；不因数据库没有 VPC 就删除全部网络。候选沿用首轮计算布局，为 task/lifecycle 提供受审 IPv4/5432 出站及访问 AWS API 的路径；不凭空假定已有 private subnet 能直连公网，也不自动加 NAT Gateway。

Full 保留原25资源 CFN 模板和准确 Stack UUID路径。Express 拟使用小型受监督 RDS SDK provider，一次 `CreateDBCluster(WithExpressConfiguration=true)`，由服务创建 writer；不再额外提交一遍 CreateDBInstance。当前公开 CFN DBCluster 属性页未列出 `WithExpressConfiguration`，所以不把 API 参数直接塞进 CFN，也不为此引入 custom-resource Lambda。[CreateDBCluster API](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_CreateDBCluster.html)、[CFN DBCluster 属性](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-rds-dbcluster.html)

运行前检查锁定 SDK/CLI 是否支持新字段，生成受审调用形状；Express 请求不继承 Full 的 EngineVersion、DBSubnetGroup、VpcSecurityGroupIds、master password/managed Secret 等字段。能力/限额配置必须先确认 API 支持的修改阶段，再列入准确写清单，不默默采用超预算默认值。创建角色还涉及 gateway、托管 writer 和可能的 service-linked role 能力；仅准备权限差异，不修改既有 Full 角色或扩大 Source 权限。

创建响应、独立 Describe 的 `DBClusterArn / DbClusterResourceId / Endpoint / EngineVersion / InternetAccessGatewayEnabled`、实际 member instance IDs/ARNs、标签、时间与请求ID进入新永久 journal。普通 API 中 Endpoint 的语义和 gatewayEnabled 可回读，但其实际格式/可连接性仍需本账户验证；不猜域名、writer名、resourceId或管理员身份。[DBCluster 响应模型](https://docs.aws.amazon.com/AmazonRDS/latest/APIReference/API_DBCluster.html)

清理须覆盖应用Service/任务、租户 SQL/Secret、compute Stack 和独立 Express cluster/writer；Delete compute Stack 不等于删除 DB。Express writer/cluster 的准确删除顺序、snapshot/保留策略、gateway 随服务清理行为在创建前形成具体可执行审阅；只删 journal 捕获且独立核对的资源，不按名称推断所有权。失败或响应丢失先只读 Inspect，不补齐/自动删除/重放创建。所有写使用新独立尝试槽，旧槽保留。

现有公钥 Secret 可在重新验证准确 version/字节后复用，不重复创建。旧 `ROLLBACK_COMPLETE` Stack 是否清除、或新 provider 使用新的受审名称，都是后续明确资源范围；D002 不执行旧 cleanup 清单，也不自动刷新其 SHA/有效期。

## 7. 如何切换

| 场景 | 方法 | 明确不能承诺 |
| --- | --- | --- |
| 尚未部署/没有租户数据（当前） | review 固定 `express_iam` → 新 provider/双模式镜像验证 → 创建并绑定真实目标 → 首轮验收 | 当前旧镜像立即可用，或原失败槽能复用 |
| 未来新部署采用 Full | 用户先完成账户资格决策 → 选择 `full_password` → 独立 Full 资源/Secret/binding → 同一业务镜像接线验收 | 当前 Free Plan 可运行 Full |
| 已有租户从 Express 切至 Full | 首轮优先计划停写窗口、最终快照/导出、新目标恢复、独立 SQL/角色/业务验收、切新 TaskDefinition 与 binding、再开放写入 | 原 cluster 原地挂VPC、零停机、自动继承身份/OID |
| 新 Full 已有相同数据，想回切 | 只有源仍准确可用且不存在目标新增写入时，才按受审切回旧 task/binding；否则先数据对账/迁移方案 | DNS/环境变量一改即可无损回滚 |

空租户最快：在另一目标重放**获批空 baseline 与配置**，不需要复制业务数据。已有数据首选官方 Express snapshot→新 Full 恢复路径，但先验证区域/版本/恢复参数/目标资格、整cluster数据范围与密钥影响；不把快照恢复等同单租户迁移。需要单租户范围时另评估准确 database 的 pg_dump/restore，不默认导出全部业务数据。

切换记录包含 source/target clusterResourceId、provider/协议/镜像版本、数据截止点、备份摘要、审批SHA、新 deployment/generation和 TaskDefinition revision。目标 DB OID、role OID、ownership、activation 重新取证；绝不复制源的 authority 品牌假装目标已准入。旧任务停写并 drain，目标只有完成 ready 与真实配置证明后开放；源保留只读/停服并承担明确费用责任，删除另批。切换后的业务写不能自动反向同步，首轮不做双写、CDC或无人值守迁移。

已有商户账号迁移保留其准确密码哈希，不重新运行“首位密码生成/首次初始化”：该KDF绑定generation与Secret version，新generation不保证派生出旧密码。密钥沿用、轮换或JWT失效窗口均需明确处理，不能用“共用业务代码”代替账号兼容验收。

## 8. 最短实施顺序及完成条件

### C1：一个集中兼容代码包（下一步，尚未开始）

平台新增 v2 intent/binding/proof 与两 provider facade，Backend 新 IAM connection factory、Secret-v2/session/catalog/receipt 适配及 app pool 接线。新文件/新协议入口优先，不修改被冻结的132 F3c9或已执行基础14 pins；若确需更新共享文件，先列出受影响旧 code binding，旧证据只能作为历史，生成新 pin，不能继续宣称旧清单有效。

保留 Full/password 和现有本地开发配置；两种模式必须分别通过有针对性的连接/契约/目录测试。直接用 GitHub Actions 构建双模式 app/lifecycle 镜像并自检，不装 Docker Desktop、不跑大量重复模拟。新 digest/权限/ECR发布仍按实际范围另审，已有发布 grant 不重新启用。**当前两份旧 ECR digest 均不能作为 Express 已支持的镜像。**

### C2：一次最小 Express 数据库实机验收（云变更另批）

先只读核对 account plan、ca-central-1实际可用性、quota/服务资格、SDK支持、费用和旧遗留。之后集中给出准确 IAM 差异、一个 Express DB/托管writer、受限SQL测试对象与有序清理清单；按具体写范围批准，不复用旧 Full创建批准。

只用本次自有 sandbox 空 DB，证明管理操作/非master IAM用户、TLS/身份、准确角色隔离、原73表baseline/迁移、跨15分钟新连接和任务凭据刷新、受监督清理；必要的最小真实测试写预先列入批准范围。失败停在准确证据处，不转成新generation微探针系列，不改客户业务或F3c9。成功回执才可标记 `EXPRESS_DATABASE_COMPATIBILITY_VERIFIED`。

### C3：回到 D001 的一个任务到 ready

使用已核验 Express binding、双模式新镜像和现有 sandbox 业务配置，集中审阅 compute/workload/tenant权限/DNS/activation的准确范围；接单次受审 live root，完成 M2/M3，核验 HTTPS、DB-backed readiness、mTLS/JWT配置与 ready 回写，再按预审路径做 M4清理/费用交接。Full provider 保留可选，不等待 Full 云部署来阻塞当前 Express 首轮交付。

### 验收门禁

- Full旧协议、default-disabled、源数据库/旧记录/冻结支线不被放宽；未知/混合profile、host/binding漂移、错误username/clusterResourceId、过期凭据拒绝。
- app不能管理DB/role、不能访问另一个DB或user；非master应用登录成功，管理与应用principal分离；Secret/log/artifact扫描没有 token、password或private key。
- 两镜像Linux容器自检成功；实际engine/TLS/DB及role OID/73表零行/迁移与seed证明完整；长期连接和新连接均实测。
- app `/health`200不足以称ready；真实数据库、配置、mTLS/JWT及Neon回写必须全部通过，失败不误记成功。
- 清理真实资源库存与费用回读，不把INACTIVE ECS、失败Stack记录或仅删除compute当成整个数据库已删除。

## 9. 成本、风险与恢复位置

50 USD/月继续是目标而非实时硬cap，账户升级仍未授权。Express 的默认容量、实际计量/额度有效性、1GB余量和限额需创建前核对；ALB小时/LCU、Fargate、IPv4、Secret、日志、存储/I/O/备份、传输和迁移时双份资源另列。旧 Full 的0.56715USD/3h或138.81USD/730h估算**不能复制成Express报价**。资源ExpiresAt标签不自动停费，必须指定验收结束与人工清理接管人/时间。

主要新增风险：公网可达网关（不是公开匿名DB）、IAM/SQL双重授权与既有会话、token/凭据刷新、网关身份/TLS差异、版本/目录兼容、1GB容量、跨服务非原子、托管子资源与清理遗留、迁移停写及已写入后的不可逆性。所有限制不能靠fail-open、自动换数据库、伪造品牌或跳过确认来解决。

继续位置：**仅开始 C1 集中兼容实现**，然后 C2 具体实机范围审阅；无需现在升级账户，也无需现在刷新 Source 才能做本地实现。D002是路线设计，不是任何 IAM/SQL/资源/删除执行批准。原失败创建、公钥Secret、私有凭据包和所有永久槽保持原样；[D001导航](./aws-auto-deployment-single-tenant-acceptance.md)、[原失败回执](./aws-auto-deployment-single-tenant-cell-foundation-executed.md)、[F3c9重启条件](./aws-auto-deployment-f3c9-deferred.md)保留可追溯。

本轮文档验证：5份既有 code binding 的172项源码pin entries（可能重叠，不是172个独立文件）LF归一化全部匹配；新方案本地链接均存在、`git diff --check`通过，未更改生产源码/SQL/镜像/冻结材料。本轮没有运行数据库兼容测试或云部署，不能把文档验证计为C1/C2验收。
