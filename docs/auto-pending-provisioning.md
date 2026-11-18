# 支付后待开通实例：现状与首次自动开通计划

<a id="first-onboarding-plan"></a>

## 缺口 3 实施计划：新客户首次自动开通

**状态：第 1–3 步已离线实现；第 4 步审批草案已备，尚未实际开通。** [D2 日常版本发布](aws-instance-version-release-plan.md#d2-closeout)已结案。本项补齐从普通购买产生的新实例到第一版可用服务的链路；首开完成后，该实例才能交给 D2 更新。执行与授权以[主线手册](aws-auto-deployment-execution-runbook.md)为准。

### 首版范围

只做餐饮订单系统、一个新 sandbox 工作区／租户、现有共享 Cell，首轮选择 Express 数据库档位；空库初始化能否直接复用现有路径须在步骤 2 证明，不能用既有库的可连接性代替。起点是现有购买／支付确认流程生成的 `pending` 实例和 `active` 订阅，终点是该租户的 API 可访问、客户入口可用、实例 `active`、部署 `ready`，且 D2 已看到同一租户的初始版本 `revision 0`。验收从 Stripe 测试模式的正常入口开始，不手工造部署记录或填 URL，不接真实付款。新租户的权限、数据库与配置不能借用已有租户的值；共享设施复用，不重建 Cell 或为每个租户新建独立数据库服务器。

首轮采用**受控自动开通**：客户的购买事件负责登记任务，独立执行入口完成开通步骤；实际云执行仍需按准确范围批准，GitHub environment 由用户本人审批。不在 Webhook 内调 AWS，不开启全队列，不让历史 `planned` 记录自动进入执行范围。不宣称已实现无人值守的生产开通。暂不做 Full 档位、其他产品或区域、全量迁移旧实例、自动删资源或新审批后台。

### 可直接复用的能力与真正缺口

| 环节 | 已有 | 本项要补 |
| --- | --- | --- |
| 购买后登记 | [付款确认](../lib/payments/management.ts#L752)调用[计划入口](../lib/deployments/management.ts#L249)，登记实例、计划和待执行任务。 | 确认普通新实例的计划可以安全交给当前首开执行入口；验证重复事件和中断后续接不会创建第二套资源。 |
| 实际开通 | [现有 worker](../lib/deployments/execution/worker.ts#L1270)已有数据库、版本基线、配置、服务发布与技术核验步骤；已有[限定任务工作流](../.github/workflows/cloud-worker-execute.yml)，但服务的是经过审查的限定任务。 | 建立从**这一条新首开任务**到现有能力的明确绑定。核对现有任务、镜像、权限和承载合同是否适用于空租户；不能套用旧恢复包或把[默认关闭](../lib/deployments/execution/runtime-composition.ts#L45)改成全局放开。 |
| 开放客户入口 | [现有 `markReady`](../lib/deployments/execution/neon-repository.ts#L1603)能在同一数据库语句内写部署 `ready`、实例 `active` 和入口。D2 已有[初始绑定验收](aws-instance-release-step4-finish-observed-20261117.json)。 | 把验证过的第一版与模型中的租户、实际栈和运行配置绑定，并与客户可见的完成状态协调。不能把固定实例的临时 owner 操作变成日常开通接口。 |

### 实施顺序与阶段交付

1. **打通购买到可审任务的交接（代码已实现，默认关闭）。** 现有付款路径共用首开登记入口，在一个数据库语句内写入部署计划和一条待审任务。固定实例和首次代际，绑定当前订阅、套餐、配置摘要、ECR digest 和目标 release；不改历史计划，不新增队列或调度平台。审阅只读回查当前状态和授权来源的 D2 可信目录，不执行领取。
2. **接通单租户执行和验收（先用本地／隔离环境回归）。** 优先复用现有受审执行入口与数据库生命周期、运行凭据、CloudFormation 和控制面步骤。按“核对订阅、归属和配额 → 初始化该租户数据库和版本基线 → 配置凭据引用 → 用固定镜像创建该租户 API 承载 → 核对路由、健康和配置”执行。用独立核验结果确认实际栈身份、同一租户的数据库与 schema、镜像 digest、域名以及 `/health`、`/ready`。缺失允许的权限、配置或资源身份就在写入前停止；先确定最小差异，再提出一次集中清单，不开通全量 worker。
3. **收口原子完成并交接 D2。** 核验通过后，用窄权限在 D2 中登记这一个实例的初始版本、准确栈身份、配置和镜像摘要，`revision 0`，无活动发布请求。若能在同一 Neon 事务内完成，优先把初始绑定与现有 `ready` / `active` / 入口回写一起提交；否则保持 `pending`，先独立确认绑定成功，最后才开放客户入口。重复完成不能改写现有版本，订阅失效或租约丢失不能激活实例，提交不明先独立回读而不是再执行。把成功、确定失败和结果不明记录到现有状态与证据，不做自动资源清理。
4. **做一次真实的 sandbox 首开验收。** 代码和离线回归通过后，另行准备一份准确执行范围：新租户、测试支付入口、资源与调用上限、固定镜像、最小权限与人工审批、费用和失败处置。获批后仅一轮，从正常测试付款开始，核对原实例不变、新租户配置与数据隔离、客户入口可见、`active` / `ready`、初始版本绑定可由 D2 读取，以及独立证据和账本一致。重复投递只验证幂等，不开第二套资源。对新实例做 D2 兼容核对即可，不为这个缺口再部署一次版本更新；停费或生产放量另审。

**完成标准：** 新餐厅不用管理员手工拼接部署材料、填写入口或点“标记为已开通”；在一次经批准的 sandbox 首开中，一条正常购买产生的任务完成初始化、部署、核验和状态回写，且新实例可交给现有 D2。代码/CI 通过只算实现进度，不算真实首开通过。方案本身不授权付款、生产读取、权限安装、调度、AWS 或数据库写入。

### 第 1 步交付与边界

- [购买登记入口](../lib/deployments/management.ts)仅在 `AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID` 匹配准确 sandbox 工作区，且产品、区域、Cell、档位符合首轮范围时走新路径。还必须有指定的 `AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID` 和固定 `AWS_SANDBOX_IMAGE_URI`；目标范围内配置无效时不回落到普通 `apply`。两个新配置均保持未设；其余购买行为不变。
- [首开任务及审阅合同](../lib/deployments/first-onboarding.ts)：同一实例的首开只有一个稳定去重键。登记前检查购买来源、当前有效订阅和匹配配置，拒绝已有开通记录、旧计划或租户资源代际。任务留在现有 outbox，远期可领取时间和两个普通领取入口的明确排除共同防止调度。审核须用受审读取来源重新确认范围、任务未领取、可信目录状态 `ecr_verified`、准确镜像和 Express 兼容；审阅摘要本身不授权执行。
- 不设置环境变量、不迁移旧任务、不导入或更新真实目录、不启用 worker、不创建 AWS 资源。回归有本机合成测试和既有无 AWS CI 的隔离 PostgreSQL 测试。

### 第 2 步交付与边界

- [单次领取](../lib/deployments/first-onboarding.ts)重新核对同一笔购买、有效订阅、准确任务、计划、配置、目录版本和有效期；锁定原行，仅把原任务的唯一尝试置为运行中。保留 payload、隔离去重命名空间和领取时间标记，不派生普通任务、不允许旧槽重跑；续租不延原批准的截止时间。
- [受审执行](../lib/deployments/execution/worker.ts)复用现有归属/配额、空库与基线初始化、运行凭据引用、首版配置、受审七资源模板和控制面读回。无可信 Express 空库能力证明即不领取；只能新建准确首开栈，拒绝接管或更新，原建栈响应不等于成功。等待建栈时只读准确 Stack ARN，不另提交写入。
- [独立技术核验](../lib/deployments/execution/first-onboarding-inspection.ts)比较同一实例、准确栈模板和资源、DNS 目标、数据库归属和 schema、ECS 实际运行 digest、健康目标及 TLS `/health`、`/ready`。只保存技术核验检查点；不设置客户入口、不提交任务的最终完成、不写 `active`／`ready` 或 D2 `revision 0`。失败或提交不明停下核验，不重试、不清理。
- 未接生产凭据或配置，也未验证真实 Express 空库写适配、只读核验身份或对该租户的路由、挂载及持久化。当前模板仍是 sandbox 临时图片存储，核验如实报告；D2 原有持久化要求不变。真实适配/材料在一次实际验收前集中确认，不能用已初始化租户的证据替代。本轮无 AWS 调用、无生产数据库连接、不启用 runtime 或全队列。
- 审计边界：继承的 V5／V6 历史候选检查仍固定更早发布日期的源码指纹。第 2 步最终变更与第 1 步结点 `a8b57b3` 对比，两套运行闭包的 76／81 个文件均未变动；本轮不重标历史预期、不改已安装的绑定。首开及隔离 PostgreSQL 由现有 no-AWS 专项 CI 验证。

### 第 3 步交付与边界

- [首开完成语句](../lib/deployments/execution/first-onboarding-completion.ts)在原租约内锁定同一实例、订阅、部署、任务、首代资源、核验证据和目录版本；从独立核验派生初始绑定。一次 PostgreSQL 语句同时登记 D2 `revision 0`（无活动请求）、将实例置为 `active` 并开放入口、将部署置为 `ready`、将原任务置为 `succeeded` 并释放租约。已存在的绑定不覆盖；任一写入未完成则整组回滚。
- 技术核验和客户激活仍是两件事。完成范围须显式包含 D2 采样摘要和兼容客户端 API 版本；持久化桶、固定密钥版本引用和可信 D2 采样不齐时不激活。旧的仅技术核验范围不触发完成。提交结果不明不重发，同一文件提供准确范围的独立只读回查。
- 未设置真实写入身份、权限或连接串，未修改线上 D2 角色，也未启动 AWS、启用调度或改真实数据。第 4 步若另获授权，先核对真实 Express 空库、独立读回、固定引用与持久化材料，并审核窄写入身份；当前 sandbox 临时图片配置不能通过激活门槛。

<a id="first-onboarding-step4-review"></a>

### 第 4 步审批草案：一次 sandbox 真实首开

**2026-11-18（温尼伯）｜待审、不可执行。** 源码基线 `caa5bd2`，[无 AWS CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44234058703)只证明离线流程及隔离 PostgreSQL 原子提交。当前没有新鲜线上事实、已批准对象/启动窗口或可执行 SHA。本次只编制材料，未访问 AWS、Stripe、Neon 或 Aurora，未读取私密配置，未恢复资源、登记/领取任务、发起支付、安装权限或调度。

#### 单次验收范围与审批顺序

1. **先核对，再开窗。** 仅在另行允许后，核对已知准确对象的状态、归属和下列缺项；只存必要投影、摘要和观测时刻。不整账号盘点、不读 Secret 值、业务行、图片正文或归档正文；需要数据库连接、固定基线正文或测试支付的，另外界定。共享 Cell、平台、Express 服务或存储未就绪时停止；如需恢复现有收费环境，另给恢复范围，不把启停列为首开默认副作用。
2. **只登记一个测试购买。** 待前置材料齐全、且实际测试购买另获批准后，由用户走既有 Stripe **测试模式**正常购买和签名回调。只允许一个新 sandbox 工作区／餐饮应用／当前有效订阅，在 `ca-central-1` 的 `cell-sandbox-1` 使用 `standard-v1`，预期产生一条 `pending` 实例、一份 `planned` 部署和一条 `attempts=0 / maxAttempts=1` 的首开待审任务。仅为准确工作区绑定固定 `AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID`、`AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID` 和目录镜像 URI；配置安装本身也须批准。确认准确 checkout、签名回调和测试模式证据，不仅凭配置变量存在；不是手工造付款事件或填入口。出现第二条任务、旧租户匹配或非测试事件即停，不发起第二次购买。
3. **锁定同一任务再执行。** 用真实购买/应用/任务 ID、订阅与模板版本、计划/配置摘要、`ecr_verified` 目录项、镜像及平台 digest、基线摘要、预期域名/ALB、审批版本和原截止生成准确整轮清单，再另批。只领取此任务一次、首代 `g1`，只给一个新数据库、一个租户登录、一份固定版本租户运行时 Secret、一个租户承载栈。由已审现状证明租户资源、目标域和路由槽不冲突；仅可用准确栈名作最多一次 `CreateStack`，创建 7 项承载资源（一个 task definition、一个 ECS Service、一个目标组、三个监听规则、一个日志组），目标常驻任务数 1。若必须新建存储/授权/精确 DNS，另列差异和副作用，不计入或隐藏在这 7 项里。旧栈、旧租户和普通队列不参与。
4. **独立核验后只完成一次。** 与执行者分离的读取身份核验下表的准确物理归属和运行状态；待技术证据落账后，专用写入身份才提交一次 `COMPLETE_FIRST_ONBOARDING`。独立新会话只读回查实例、部署、原任务和 D2 初始绑定，确认没有活动 D2 请求；不进行 A→B/D2 发布，不再建栈。若使用 GitHub Actions，真实续接入口、确切源码、run/attempt 和受保护 environment 须纳入清单，environment 由用户本人审核；旧发布审批不可重用。

#### 四项放行条件

| 条件 | 当前缺项与将来必须核对的证据 |
| --- | --- |
| **Express 空库** | [已提交的 lifecycle v2](../lib/deployments/execution/aurora-lifecycle-v2.ts)只编译 Express `inspect`，明确 `writeCommandsAvailable:false`；[现有首开策略](../lib/deployments/execution/single-tenant-workload-strategy.ts)复用通用七资源渲染，仍继承 `DATABASE_URL`/本地图片，不能直接用于 Express 真跑。[已有 Express 专用候选](../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts)可复用 IAM/TLS/固定 Secret 与 bootstrap 健康配置，但本身只渲染、不执行。需证明指定集群物理 ID/版本、TLS 主机校验、管理与运行登录隔离、目标库/角色空闲；同一租约和资源代际下证明 `prepare_empty_database → restore_approved_baseline → migrate_saas → verify`，其中空库状态必须先于恢复。固定不含旧客户数据的 archive/manifest 键、版本、SHA、恢复工具与目标引擎兼容性、DB/role OID 和迁移合同。旧租户可登录或已初始化不证明新库可建，也不能以 Full 密码方案替代。 |
| **持久化与固定引用** | 当前图片配置 `local` 不合格。复用[已验证的私有桶／CDN模式](aws-instance-release-persistence-plan.md)和[已有最小配置派生](../ops/releases/persistence.ts)，目标是新租户隔离的桶或后端已证明可隔离的精确前缀；旧租户桶、`products/*` 授权和媒体不能直接转给新租户。清单固定桶拥有者、商品对象范围、公开 HTTPS 地址/来源和 CORS，任务实际配置必须是 `s3` 并匹配桶；禁止临时磁盘回退。应用注入的所有 Secrets Manager 引用（含控制公钥引用）必须落到真实 ARN＋VersionId。D2 会读确切域名的 Route 53 A Alias 及其 ALB 目标，历史通配 DNS 或单次 HTTPS 成功不能代替；若缺失，最多提议创建这一条 Alias，不能覆盖现有记录或修改共享 zone。新桶/OAC/分发或 IAM 如不可免，需在开窗前列入独立待审差异，不能默认复用原租户材料。 |
| **独立核验** | 读取同一首次创建的真实 StackId、Original 模板、资源清单/归属及无竞争变更；实际 listener/路由、目标和证书/mTLS、ECS 服务与任务定义、1 个运行任务/0 个待启动/healthy 目标、实际平台 digest、数据库身份/schema/基线、准确 DNS、Secret 固定版本元数据、持久化桶及 TLS `/health`、`/ready` 均一致。独立采样须符合 [D2 既有读取合同](../lib/deployments/releases/sampling.ts)，不以 Create ACK、工作流成功、bootstrap-only `/bootstrap-ready` 或旧验收证据替代；控制面配置写入只由执行者进行一次，读回核对当前实例和配置摘要。技术验收不冒充真实商家上传或买家业务测试；不加业务探针或迁移旧图。 |
| **原子完成与新 Secret 标识绑定** | [现有批准](../lib/deployments/execution/worker.ts)在领取前绑定 `completion.samplingSha256`，[采样材料](../lib/deployments/releases/sampling.ts)含新租户 Secret 的真实 ARN＋VersionId。若这些 ID 要在运行时产生，不能预填、借旧 Secret，也不能领取后改摘要或拆一次无完成的尝试再重放。开窗前须另审并证明一条可行路径：已合法准备且与同一 g1/epoch 完全匹配的固定引用，或经过单独代码与权限审核的**受限派生**（外层固定准确租户 Secret 名、只允许一次创建及固定版本规则；仅从同次受信回执和独立核验派生，不能放松摘要核对）。本稿不选择/执行任一路径。完成写入入口也尚未绑定真实身份，不能用平台 owner、D2 执行/核验身份或普通应用账号顶替。 |

#### 拟议最小权限：对象和动作都要审

下表是能力上限，不是可安装 policy。只列真实适配用到的动作；后续若某 API 无法按资源 ARN 限制，清单须写清其仅有的列表/跨资源例外和本端限定参数、页数、次数，不能据此给运行时通配写。实际 trust、SCP、边界、会话、KMS、网络及 PostgreSQL 权限要单独验证；成功的策略模拟不等于真实可达。

| 身份 | 仅需的能力 | 明确不授予或不执行 |
| --- | --- | --- |
| sandbox 平台支付入口／受审任务执行器 | 支付入口继续用当前受限的签名校验和购买/订阅/实例/outbox 写入能力；执行器只读准确 checkout 派生任务、订阅/计划与目录，通过首开领取语句用唯一租约锁定原任务，只写本任务的容量、代际/epoch、步骤和受审状态。若用外部围栏，只允许当前资源键的条件读写、不能在旧纪元回退；mTLS/签名执行凭据只允许这一个实例的首次配置操作。 | 无通用 `claimNext`、不启用全量 apply、不新建兄弟任务、不扫支付业务数据、不处理生产事件；执行器不自行给独立证据签认可。 |
| Express 生命周期管理／应用 TaskRole | 管理身份仅 `rds-db:connect` 到指定 Express 物理集群及批准的管理登录，经 TLS 执行准确数据库和角色的准备、只在新库恢复/迁移及核验；固定基线只读两条对象版本（archive/manifest，考虑 `s3:GetObjectVersion` 和实际加密所需的准确解密）。应用 TaskRole 的 `rds-db:connect` 只给该集群的 tenant login，SQL 只给租户库所需 schema/对象；无静态数据库密码。若用现有单次 ECS 生命周期任务，只允许运行准确 task definition/cluster/角色和网络，列清每次命令、启动次数及日志范围。 | 不新建/重启 RDS 实例、不管理其他库或账户、不把管理身份给长期应用或独立读取者；不把 `rds-db:connect` 当 SQL 授权，也不向普通角色开放 `CREATEDB`/`CREATEROLE`。若现有管理身份只有宽权限而无窄受审执行路径或真空库适配，停下补方案。 |
| Secret 供给／ECS TaskExecutionRole | 仅在另批方式下创建一份准确 g1 运行时 Secret（无覆盖；只允许必要初始版本、归属标签与受审 KMS），或使用已证明属于本代际的固定引用。TaskExecutionRole 只需拉取固定 ECR repo 镜像、写本栈日志流、按固定 ARN＋版本取启动注入所需内容；必要的 `kms:Decrypt` 只给实际相关 key 和流转范围。 | 不轮换/删除现有 Secret、不读其它租户、无通用 Secret/KMS 管理，值不进模板、step 输出、审批文档或验收日志。独立核验只读版本元数据。 |
| 首次建栈提交者／CloudFormation 服务角色 | 提交者只对准确新栈做 `DescribeStacks`（查空和按 ACK 轮询）及一次 `cloudformation:CreateStack`；`iam:PassRole` 仅指定 CFN 角色并限 CFN 服务。CFN 角色只允许七资源所需的 ECS task definition/Service、准确共享监听器规则和本目标组、本日志组的创建、标签、状态读取和**已评审的该次建栈失败回滚**，PassRole 仅两个准确 ECS 任务角色并限相应服务。模板须固定当次参数和 ARN 来源。 | 无调用者 `UpdateStack`、接管、`DeleteStack`、IAM 改动或其它栈写入；默认不授予 DNS/媒体基础设施变更、集群创建或任务扩容。只要预计需 CFN 内建回滚权限和费用，须在实际清单明确列出；不经手工/自动重试或清理。 |
| 商品图片写入／读取 | 应用 TaskRole 仅 `s3:PutObject` 到批准的商品对象范围；仅当保留应用现有替换/删除行为且批准时，再加同范围 `s3:DeleteObject`。私有桶的读取只给指定 CloudFront OAC/分发及该商品前缀；独立者只验证准确桶拥有者、权限与分发引用。 | 无应用级桶枚举、跨租户读写、版本删除或 PublicAccessBlock 变更；公开 URL 只用于允许公开的商品图片，不放私密附件。没有批准的产品上传验收时不写示例图。 |
| 独立核验身份 | 按准确标识读 CFN 模板/归属、ECS service/task definition/task、listener/rule/target health、Route 53 Alias、ECR manifest、RDS 元数据、Secret 版本元数据、S3 HeadBucket（不列/读对象）以及必要的 Neon 投影；若独立确认 schema 需连库，只给该租户 TLS/只读元数据或去敏核验结果，不读客户数据。HTTPS 仅批准的准确 hostname/路径；控制面只读要与配置写限开。 | 不写 CFN、ECS、S3、DNS 或数据库；不 `GetSecretValue`、不接执行者写入凭据、不用应用登录做验收。 |
| Neon 首开完成执行／独立回读 | 专用窄入口仅执行[这一份语句](../lib/deployments/execution/first-onboarding-completion.ts)，对准确租约检查和锁定 job、deployment、instance、subscription、workspace、environment、resource、epoch、独立 step 与 release；只允许给 `deployment_release.instance_state` 插入本实例的初始行，以及对本实例、部署、任务更新该语句列出的状态/入口/时间/证据/租约字段。首开 writer 的真实实现与 GRANT 要验证锁、FK、行限制及反向拒绝，既有 D2 runtime [只给函数权限](../ops/releases/grants.draft.sql)，不能视为已有首开权。独立回读仅 `READ_FIRST_ONBOARDING_COMPLETION` 和该实例的 D2 `read_context`；不需要完成权限。 | 不给直接跨租户表 DML、owner 或任意 SQL；不更新已有 `instance_state`，不写目录、requests、订阅状态或支付记录，不增加 D2 既有 worker 权限。用 PostgreSQL 角色分离或专用入口实现，不能把一次 CTE 的 WHERE 当作数据库权限隔离。 |

#### 放行、停止与落账

- 待补足的准确材料：新工作区/支付模式、真实 checkout 到任务的派生与目标范围、镜像及运行版本、基线版本/SHA、模板与各资源物理引用/归属、存储与访问证明、独立核验和完成身份及负例、租户预约容量和无冲突路由、准备时效/执行截止和本人审批点。待新事实另获准后，按真实对象分别固定读取与写入上限；现在的硬上限是 **1 个验收租户／1 条任务／1 次领取／1 个租户栈／1 次完成提交**，不是可分配给其它对象的额度。
- 开窗前记录人工监督、预计时长及成本估算（尤其既有 ALB/Express、Fargate、日志及存储/流量）。沿用 50 USD/月目标，不把它或任务截止当硬停费上限；原始执行/资源到期不得为凑时延长。停止/删除不在这轮验收授权，临时费用及资源留存分别记账，按已审流程另批。
- 缺证据、权限多于批准范围、目录/配置变化、无法保障当前租约，或 ACK 不明就停。领取前不消费尝试；领取后不复位、不换任务、不自动补写、补偿或清理。只有独立回读证明同一实例 `active` 且 URL 准确、同一部署 `ready`、原 job `succeeded` 且无租约、D2 `revision 0` 且无活动请求、证据摘要一致，才算一次真实首开完成。否则保留已有记录；不能把没有回读的一次提交判为可重试。
- **当前继续点**：见[第 4 步首开离线接线](#first-onboarding-step4-offline)；不先重复盘点、启动 AWS、调度或做测试购买。

<a id="first-onboarding-step4-readonly"></a>

#### 限定只读补核记录与准确范围

**2026-11-18 06:33:28–06:33:30（温尼伯 CST；12:33:28–12:33:30 UTC）｜停在身份核对，未生成执行清单。** 用现有 Source profile `techlong-sandbox-user` 对官方区域 STS 尝试身份核对 1 次，去敏结果 `CREDENTIALS_UNAVAILABLE`；未收到已匹配的账号/调用者响应，不能断定会话过期或具体根因。后续资源和 IAM 元数据调用均为 0。无重试、无替代登录、无 Secret 值读取、无数据库连接、无 AWS 写、资源启动、队列启用、任务登记/领取或开通。本次记录保留；它不产生新鲜资源事实或新的执行窗口。

如另行允许新一轮，Source 身份须先匹配账号 `402010193138`、区域 `ca-central-1`、IAM 用户 `techlong-sandbox-dev`。之后只核对以下确切目标：**STS 最多 1 次、AWS 元数据最多 20 次，一页、不翻页、不自动重试。** 表中对象来自本地已存引用；即使读回完全匹配，也不自动变成新租户授权。

| 目的 | 仅允许的目标、调用及保留的事实 |
| --- | --- |
| Express 及共享 Cell 前置 | **最多 3 次**：`DescribeDBClusters` 指定 `techlong-sandbox-express-d001`；仅当物理 ID 匹配已存 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM` 且 writer 仍为 `techlong-sandbox-express-d001-instance-1`，再对该 writer 做 `DescribeDBInstances` 1 次；`DescribeStacks` 只读 [原 Cell 的准确 Stack ARN](../ops/releases/d2-6-step4-finish.review.json)，仅保留状态和所需输出键是否存在。集群/实例状态、引擎版本、IAM auth 和物理归属不能证明目标库名/角色空闲、SQL 权限、真实空库创建或基线恢复。未绑定准确新 archive/manifest 键及版本，不列桶寻址、不读对象。 |
| 持久化参照 | **最多 4 次**：仅对 [已存旧租户图片桶](aws-instance-release-persistence-media-installed-20261115.json) `techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad` 做 `HeadBucket`（必须带预期拥有者）、`GetPublicAccessBlock`、`GetBucketVersioning`；仅对已存分发 `E2H9SBE05EMLAN` 做 `GetDistribution` 核对状态、原桶/OAC 绑定。仅验证既有模式可作设计参考，不确认/转用新租户桶、前缀、对象或访问权限。 |
| 固定版本参照 | **最多 2 次**：对 [已存控制公钥引用](../ops/releases/d2-6.prepared.json)、[D2 核验登录引用](../ops/releases/runtime.json) 各 `DescribeSecret` 1 次，只比对此准确 ARN、原固定 VersionId 是否存在/当前、删除/轮换状态及 KMS 引用是否存在。不查旧租户运行时 Secret，不列 Secret、不读内容。新租户 g1 Secret 的 ARN/VersionId 仍未产生或绑定，不能从这些参照推定。 |
| 生命周期与应用权限参照 | **最多 6 次**：分别 `GetRole` 指定 `TechlongSandboxTenantLifecycleTaskRole`、`TechlongSandboxTaskRole`；分别 `GetRolePolicy` 读取两者已存准确 inline `ImmutableReceiptsAndGenerationSecretRead`、`ConnectExactExpressTenantC4e`；只在原关联匹配时 `GetPolicy`、`GetPolicyVersion` 各 1 次读取 `TechlongSandboxServiceRoleBoundary` 的当前默认版。只存边界匹配、固定版本约束及连接用户范围摘要；不做 AssumeRole、模拟、取 IAM 登录 token 或 SQL 授权验证，不把旧租户权限当首开权限。 |
| 独立核验与原子完成权限 | **最多 5 次**：仅指定 `TechlongSandboxInstanceReleaseVerifierRole` 的 `GetRole`、`ListAttachedRolePolicies`、`ListRolePolicies`；仅在匹配已存边界时，`GetPolicy`、`GetPolicyVersion` 各 1 次，检查 `TechlongSandboxInstanceReleaseVerifierBoundaryV1` 的默认版。只比对信任、边界和读取能力，并标记可能的固定 Secret 读取、证据写入等额外能力；不假设现有 D2 验证者是纯只读或已有新首开权限。**Neon 完成身份无已审安装/执行授权证据**；不查猜测的 AWS Secret 名，不连接 Neon 验证 GRANT。必须另审受限首开入口与真实权限的正/反例，不用旧 D2 角色或 owner。 |

上表是原停止后确定的准确只读上限，不是执行审批。下方新一轮结果保留原停止记录，不覆盖原事实或延长其期限。

<a id="first-onboarding-step4-readonly-result"></a>

#### Source 刷新后的单次补核结果与最小待审差异

**2026-11-18 06:40:50.837–06:41:19.350（温尼伯 CST；12:40:50.837Z–12:41:19.350Z）｜元数据补核完成，首开不放行。** 用户刷新 Source 并明确允许新一轮后，区域 STS 1 次匹配 `402010193138` 的准确 IAM 用户；上表元数据 **20/20** 成功，无翻页、重试或范围扩张。不读 Secret 值、图片、基线对象或私密配置，不连 Neon/Aurora，不调用 Stripe，不启动/写入 AWS，不启用全队列，不登记或领取任务，不实际开通。仅保留以下去敏事实摘要；原凭据失败记录仍保留。准备引用按原观测及手册 5 小时规则，不产生执行窗口。

| 范围 | 本轮确认 | 不可据此放行 |
| --- | --- | --- |
| Express / 共享 Cell（3 次） | 集群 `techlong-sandbox-express-d001` 及准确 writer 均为 **`stopped`**，物理 ID/成员匹配，Aurora PostgreSQL `17.9`、IAM DB auth 开启。原 Cell 栈为 `UPDATE_COMPLETE`，有 `ClusterName`，但无 `HttpsListenerArn`、`ControlListenerArn` 输出。 | **当前承载未就绪。** 输出缺失不是对监听器实际物理状态的核验，不用旧 ARN 补空。未核对目标库/登录空闲、SQL 能力、空库写适配或固定基线对该版本的兼容性。 |
| 持久化参照（4 次） | 旧租户桶拥有者符合预期，四项 Public Access Block 均开启，版本化为 `Enabled`；原分发启用且 `Deployed`，桶 origin 与 OAC 匹配。 | 只证明旧租户模式，不复用其桶、权限或媒体，不能证明新租户存储/任务写入链路。 |
| Secret 固定版本（2 次） | 控制公钥及既有 D2 核验登录的两个准确旧引用均存在且为 `AWSCURRENT`，无删除计划、未启用轮换。 | 版本元数据不证明读取权、内容或 SQL 登录，也不能替代新租户 g1 Secret。新 ARN＋VersionId 的绑定路径仍缺。 |
| 生命周期／应用 IAM（6 次） | 两角色匹配原 `TechlongSandboxServiceRoleBoundary`（默认 `v5`）。所核对生命周期 inline 的 `rds-db:connect` 指向该集群 `postgres`；应用 inline 指向已初始化的旧租户 SQL 登录，边界摘要包含这两个用户。 | 仅说明所读允许语句，不证明交叉条件下的有效权限，不证明新的租户登录、SQL 创建/隔离和基线执行；不能把管理账号权限交给应用。 |
| 独立核验／原子完成（5 次） | D2 核验角色命中既有 GitHub environment 信任，唯一附加策略与其专用权限边界一致（默认 `v1`），无 inline。策略有资源元数据读取，也有带版本条件的 `GetSecretValue` 和证据 `s3:PutObject` 允许语句。 | 安装态 D2 核验角色不等于首开纯只读身份；本轮没有使用这些权限。Neon 首开完成入口/实际 GRANT 未查、未证明，不能复用旧 D2 登录或 owner 完成。 |

**当前审批清单结论：`NO_GO`，不签发执行 SHA。** 不做第二次盘点，下一步若获同意仅离线细化这些待审差异：

1. 将**原 Express 恢复与共享 Cell 的受审恢复/输出核验**列为独立前置范围；只围绕本轮准确集群和原 Cell 栈，明确恢复后两条输出、实际监听器 mTLS、路由及费用。恢复仍另审，不把它并入首次领取、借用旧 ARN 或启动其它环境。
2. 将**一次新租户 Express 空库初始化与首版持久化**限定为已知缺项：同一资源代际的管理/应用登录区分、无客户数据的固定版本基线与兼容性、首版 Express＋S3 配置、准确 DNS/路由，以及新 g1 Secret 版本生成与审批绑定。复用现有专用渲染器和持久化模式，不复用旧租户授权；不预填未生成的 ARN/版本。
3. 将**独立只读核验与专用原子完成**明确分权。提出首开独立元数据/技术读回的窄身份或等效受限会话，以及只允许原任务完成语句的 Neon 入口；要测允许完成本任务，拒绝未核验、越租户或改写既有 D2 状态。真实权限核对、需要的连接或安装均另审。

在缺项解决、目标任务和资源值真实绑定且另有执行授权之前，保持未购买、未领取、未启动、未开通。

<a id="first-onboarding-step4-delta"></a>

#### 第 4 步最小就绪差异：离线候选，不可执行

**2026-11-18（温尼伯）｜`NO_GO`，无执行 SHA。** 只复用 [06:40 CST 的限定补核](#first-onboarding-step4-readonly-result)与已提交源码/历史去敏材料；事实时点不续期。本节确定候选差异和验收门槛，不是已实现的适配、已验证的权限或新一轮读取许可。实际改动只限文档。

##### A. 原 Express 和共享 Cell：单独审批恢复，不重开整套环境

| 对象 | 将来拟议的最小动作 | 放行与停止条件 |
| --- | --- | --- |
| 原 Express | 仅指 `techlong-sandbox-express-d001`（已观测物理集群 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`），如果后来获准窄核对仍为 `stopped`，对原集群最多一次 `StartDBCluster`；writer 由原集群管理，不另外启动、替换或新建实例。 | 准确集群及 writer 均 `available`，物理归属、已审 PG17.9/IAM/TLS 条件未变。若已启动不再写；身份、版本、writer 或端点归属不符即停。这里不连 SQL、不建库，不启动 `speedfeast-postgres-prod`。 |
| 原共享 Cell | 只用原栈 `techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`。在另行核对实际停用模板、完整 12 项保留资源和空缺后，按[已验证的四资源模式](../ops/deployment-baseline/cell-a2-executed-20261107.json)派生一次变更集；只允许 Add `CellLoadBalancer`、`BusinessHttpsListener`、`ControlMtlsListener`、`BusinessControlDenyRule`，并恢复对应输出。将来创建/执行上限各 1，执行须先看到准确差异。 | 独立核对同一栈 `UPDATE_COMPLETE`、原 12 项物理 ID 不变、四项确属该栈，新 ALB/443/8443、业务拒绝规则、证书和 `verify` mTLS 正确；只使用实际新 `HttpsListenerArn`、`ControlListenerArn`。若仅缺输出而资源或模板差异不是上述 4 Add，则停并重审；不动其它栈，不导入或直接建 ALB。 |

仓库的[通用环境启停入口](aws-environment-tool.md)会涉及三栈和两库，不用于这两项窄恢复。可复用的是原栈变更集和独立核验方式，不是旧清单、旧监听器或旧权限附件。新监听器若落在当前 CFN 角色允许范围之外，只列对两条实际新 ARN 的最小声明差异另审，不能夹带到恢复变更集。恢复会带来持续费用，应在其余候选齐备后另定窗口；不顺手恢复平台、旧租户或其它 RDS，不装自动停费。若实际验收所需测试支付入口另有停止状态，单列前置，不扩大本范围。

##### B. 新租户：复用空基线，首版就用 Express 和隔离图片存储

- **初始化窄路径。** 复用 [Express V3 管理会话/prepare 合同](aws-auto-deployment-aurora-dual-mode-c3-bootstrap.md)与[同集群 PG17.9 空基线恢复及迁移的历史验收](aws-auto-deployment-aurora-dual-mode-c3g-restore-executed.md)，只作材料和底层能力参考，不运行历史固定目标入口、不复用其 OID、数据和永久槽。新目标库名/应用 SQL role 取本任务的不可变计划，Secret 名依现有代际函数派生；疑似占名、不同 g1/epoch、跨租户访问或身份不匹配即停，不领养旧资源。拟接入 `GuardedTenantDatabasePort` 的仅首开适配：一次 prepare、一次固定 schema-only 基线恢复及已审迁移、一次独立读回；不把现有 v2 `inspect` 改成通用写入口。真实 archive/manifest 须另绑定对象版本与两份摘要，再核对引擎、restore 工具和迁移合同。历史 73 表/两迁移/九条技术 seed 可作核对基线，不是新库证明；除批准的技术 seed 外业务行须为空。
- **SQL 与角色隔离。** 只允许核准的管理身份在指定 Express 集群操作同一新库/角色；正常应用不持管理权限。若复用 V3 quarantine，清单必须明列一次 `CREATE DATABASE`、一个新应用角色及仅本次临时 NOLOGIN guard 的建/收动作和每个阶段的 ACK；建库本身不与后续恢复/迁移算一个原子事务，失响应只读核对、不续跑。应用 `LOGIN`、目标库/Schema 权限和 `rds_iam` 依实际审核权限开启；必须证明不能登录旧租户库。若需改其它数据库的 PUBLIC ACL 才能隔离，当前方案不含这一写入，停止另审。现应用 TaskRole 的新旧任务无法仅靠资源 ARN 策略区分，不向原共享应用角色直接追加新库或新桶；首选仅本新租户可用的 TaskRole，限精确 dbuser 和图片对象。角色/边界/必要 `PassRole` 或认证若没有精确复用范围，单列最小 IAM 差异，角色凭据不下发给其它任务。
- **一次首版渲染，不先部署本地盘版本。** [Express 渲染器](../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts)可复用 IAM/TLS、实际 OID 与 bootstrap readiness；目前是 render-only、协议与普通首开 finalizer 不同，不能直接交给 AWS 适配器。另批代码时，只在首开分支组合 Express、固定注入和持久化，重新做准确角色/参数、7 项逻辑资源、标签和 `createOnly` 校验；普通 worker 和原 D2 保持。通用 [TaskRole 参数白名单](../lib/deployments/execution/parameters.ts)固定为原共享角色，须在首开分支绑定批准的准确新角色，而不是全局放宽。租户栈保持一次总计 7 项，镜像仅 D2 可信目录的固定 digest，禁止启动迁移或后装一次 `UpdateStack` 修图片。
- **存储和 DNS 最小边界。** 现有[持久化派生](../ops/releases/persistence.ts)硬绑旧桶和角色，复用其任务字段形状而非旧常量：`IMAGE_STORAGE_PROVIDER=s3`、`IMAGE_S3_BUCKET`、`IMAGE_PUBLIC_BASE_URL`、`ALLOW_EPHEMERAL_IMAGE_STORAGE=false`。首选为新租户使用隔离私有 bucket 的 `products/*`，应用任务仅对本对象范围写；仅在证明后端、旧任务和 CDN 都隔离时才接受复用的独立前缀。没有合格预置存储时，另列私有桶、桶策略、OAC、CloudFront 分发、响应头策略 **5 项参照候选**，不是默认获批；保持 PublicAccessBlock、版本化、准确 OAC 与应用角色权限，不迁旧图、不开放桶。D2 需要确切新 hostname 的 A Alias；若该名空闲且不在栈内，才另批一次 `CREATE` 指向实际新 ALB，冲突即停，不 `UPSERT`、改旧域或用通配证据。当前首开还固定 listener priority 100，必须证明两监听器的模板所占优先级无冲突；不移动旧规则或启用全局优先级分配。

##### C. 固定 Secret 与 D2 摘要：先审派生规则，后接受真实回执

保留已知固定版本的原路径。对需要新建 g1 Secret 的验收，**建议仅增加首开专用的受限派生路径**，不要求采购前预测 AWS ARN，也不以阶段后得到的 hash 冒充审批。

1. 外层一次性批准绑定准确任务/订阅和 g1、基线/镜像/租户配置摘要、真实 Cell/平台/zone/存储及 API 版本、静态引用完整摘要；动态字段只允许该 g1 Secret 的物理 ARN 和初始 VersionId。先固定派生的完整 Secret 名、归属、批准的加密/版本范围和截止；最多一次创建一份初始版本，不复用未知同名对象、不 rotate，不将已有旧 Secret、其它版本或 `AWSCURRENT` 占位作为替代。
2. 保存当次创建的去敏 ACK（请求指纹、确切 ARN、实际版本、归属、代际/epoch），由分离的核验入口用 `DescribeSecret` 元数据同任务回读并与实际任务定义逐项比对，所有注入包括控制公钥均必须是批准的 ARN＋版本；不读其值。只有 ACK、独立元数据和运行引用一致，且批准的其它采样字段完全不变，才派生 D2 完整 `samplingSha256` 和相同证据；原始审批 SHA 不变。
3. 当前 [worker](../lib/deployments/execution/worker.ts)和[完成绑定](../lib/deployments/execution/first-onboarding-completion.ts)只接受领取前已知的固定摘要，未实现上述分支。实际接线前离线验证拒绝错误名/账户/epoch、未知回执、第二版本、变更静态字段和过期；不可先领取一个无完成段的任务来获取版本，再重开原单次槽。已就绪的真实新 g1 固定引用若另行证明，则用既有固定摘要机制，不再建 Secret。

##### D. 独立读回与 Neon 原子完成：两条权限边界

- **技术核验者。** 提议用独立只读会话或等效首开专用身份，取准确资源的 D2 采样、实际栈/监听规则/运行 digest、持久化配置和 TLS `/health`、`/ready`；数据库归属与 schema 只用独立的只读元数据证据，不看客户行。后续若需要实际连接，另列目标/权限。复用同一 [D2 sampling](../lib/deployments/releases/sampling.ts) 的事实形状，不把运行者的成功回执当独立结果，也不复用已有附带 Secret 值读取和证据 PUT 的 D2 核验身份。核验者只返回验证结果，不改存储、数据库、路由、ECS 或 Secret，也不提交完成；执行侧只有原任务范围的安全证据检查点写入。
- **Neon 完成者。** 候选为一个只接受同一任务实际完成材料的固定入口（优先复用本库锁及 CTE，必要时在专用无登录的最小权限所有者之下做固定 `SECURITY DEFINER` 函数，固定 `search_path`、限定参数和授权，撤销 PUBLIC 执行）。运行登录只授予该入口的 `EXECUTE`，不授予通用表 DML、D2 owner、角色管理、任意 SQL 或其它函数写权；不能交给可调用 owner 上下文的身份。依[现有语句](../lib/deployments/execution/first-onboarding-completion.ts)核对实际锁定/外键所需权限，写集合仅 1 条 D2 初始行和 3 条状态记录，一次提交；不修改目录、支付、订阅或已有 D2 记录。独立只读回查不持完成权，确认同一任务完成、实例与部署及时间/证据一致、D2 `revision 0` 无活动请求。隔离 PG 必测低权限真实登录成功、越租户/未核验/失租约拒绝、原绑定不可覆盖、部分失败整组回滚和未知回复只读回查；已有超级用户隔离 CI 不能当成最小权限实证。

**实施边界与顺序。** 先等明确许可做 B–D 的最小离线候选及必要回归；不再整批盘点。能否原样复用的结论随代码与隔离测试落账，仍不足以批准安装。再按真实缺项编制准确的只读、权限/存储/DNS 写入与 A 恢复清单；不提前恢复收费资源。只有真实测试购买另批并登记了唯一任务，暨工作区、目标物理值、证据与剩余窗口已绑定，才生成并请审同任务真跑清单；另需的 GitHub environment 由用户本人批准。任何阶段出界、结果不明或剩余窗口不足即停，不启动、不补写、不重试、不清理。**本轮无 AWS/数据库/Stripe 调用，无读取私密值、资源启动、队列启用、测试购买或任务写入。**

<a id="first-onboarding-step4-offline"></a>

#### 第 4 步首开专用离线接线

**2026-11-18 ｜ `NO_GO`，尚无生产执行清单。** 专用入口只接受已审的同一条 held 首开任务、第一代资源和一次领取；不启用普通 worker、全队列或 D2 的任何新权限。

- [Express 编排](../lib/deployments/execution/first-onboarding-express.ts)：只对新登记的首开计划绑定 V3 的确定性库/角色名，不改旧任务。校验准确物理集群及代际，编译现有空库 V3 程序并交付窄适配接口；恢复只接受固定版本和摘要的 schema-only 基线，依序执行 SaaS 迁移、准确新 SQL 角色激活及登录/隔离核验。首版直接渲染为 7 项 create-only 资源，使用新租户 TaskRole、私有 S3 桶及固定 CDN 地址，无本地盘降级；桶、CDN 和 DNS 不在这次 tenant create 中新建。
- **固定引用**：仅允许同一代际一次初始 g1 Secret，版本由审查 SHA、任务、fence 与基线确定，ARN 只能来自记录匹配的 ACK。独立 `DescribeSecret` 前后核对同一唯一版本；渲染及 D2 初始采样绑定实际 ARN＋VersionId 与批准的控制公钥版本，不读取 Secret 内容。
- [独立验收](../lib/deployments/execution/first-onboarding-reader.ts)复用现有事实采样，约束独立身份与元数据 API；比对栈、监听器、DNS、运行镜像、媒体配置、数据库物理归属/OID 及 TLS `/health`、`/ready`，数据库探测为只读。`HeadBucket` 和任务配置只提供作用域/存在性事实，不替代准确应用角色与 CDN 访问权限的安装证明。
- [Neon 完成入口](../lib/deployments/execution/first-onboarding-completion-entry.ts)只生成候选 DDL，运行者和独立回读者各用不同窄函数，函数 owner 为专用 `NOLOGIN`；一次原子提交实例激活、部署 ready、任务成功和 D2 `revision 0`。提交已确认而回读不明时停止，不补写、不重试。隔离 PostgreSQL 回归覆盖真实受限角色、越界/过期拒绝和完成回读，不是 Neon 权限已安装的证明。

**下一步仅准备实际就绪差异。** 生产端口、准确 SQL/Secret/IAM/存储/DNS 权限仍需审定，不能把注入测试或候选 DDL 当成已安装。只复用已有事实，缺项必要时另批；原 Express/Cell 恢复、权限安装、测试购买与单条首开执行都须分别审核。本轮未连接 AWS、Aurora、Neon 或 Stripe，未启动资源、登记任务或启用 runtime。

## 当前操作说明（实施计划不改变现有流程）

### 目的

当 Stripe 发送通过签名验证的付款成功事件后，平台会把付款记录标记为已付款、把 Checkout 对应的产品订阅更新为有效，并自动创建或重新关联该产品的待开通实例记录。系统还会根据套餐固定的资源档位生成 AWS Sandbox 目标计划和幂等部署任务。当前 S3 Worker 的真实运行 Adapter 未配置且 `applyRuntimeReady=false`，因此不会调用 AWS，也不会生成云资源、ARN、Secret 值、真实域名或入口。

### 管理员操作

1. 在“应用实例管理”中将状态筛选为“等待开通”。
2. 打开来源为“付款成功自动创建”的实例，核对企业客户和关联订阅。
3. 核对实例详情中的部署资源档位、目标区域、Cell 和计划状态。`planned` 只表示计划已保存，不表示资源已部署。
4. 编辑实例，填写真实的买家端 `access_url`、卖家端 `seller_apk_url`、租户标识以及需要的域名或路径。
5. 返回详情页，确认有效订阅和有效访问地址都已具备后，选择“标记为已开通”。

也可以将记录标记为“开通失败”或“服务已暂停”。没有有效访问地址时，平台会阻止标记为已开通。

### 验收流程

1. 以普通企业账号从“订阅与账单”发起 Stripe 测试付款。
2. 用 Stripe CLI 转发测试 Webhook，或在 Stripe 测试事件中重新投递同一付款成功事件。
3. 确认付款记录为 `paid`、订阅为 `active`，并且该工作区只有一条餐饮订单系统实例，状态为 `pending`，来源为“付款成功自动创建”。
4. 确认实例存在一条 `aws_ecs_cell` / `plan_only` / `planned` 的目标计划，并且计划中没有 AWS 凭据、Secret 值、ARN 或正式 URL。
5. 重复投递同一事件，确认不会新增付款记录、应用实例或相同配置的部署计划。
6. 在管理员后台填写入口并标记为已开通；客户刷新后才会看到“进入餐饮订单系统”按钮。

### 边界

当前版本不部署应用、不创建云资源、不生成生产域名，也不支持同一个工作区购买多个餐饮订单系统实例。数据库以 `(workspace_id, product_id)` 唯一约束保证实例边界，并以部署计划幂等键避免重复排期。后续真实部署必须由独立执行器 / Worker 消费任务，不能在 Webhook 请求内直接调用 AWS。详细设计见 [AWS ECS Cell 部署计划 DEMO](./aws-ecs-cell-deployment-demo.md)。
