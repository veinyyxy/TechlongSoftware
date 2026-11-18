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
- **下一唯一动作**：等用户另批所需的限定只读补核；按真缺项编成最小就绪差异和一次精确执行清单。未解决 Express 写适配、持久化/固定引用、独立核验与窄完成权限前，不启动 AWS、不调度、不做测试购买。

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
