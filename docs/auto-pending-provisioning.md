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

**实际就绪差异见下方两份清单。** 生产端口、准确 SQL/Secret/IAM/存储/DNS 权限仍需审定，不能把注入测试或候选 DDL 当成已安装。缺项补核、权限安装、原 Express/Cell 恢复、测试购买与单条首开执行分别审核。

<a id="first-onboarding-step4-installation"></a>

#### 第 4 步清单一：最小权限、存储和 DNS 安装（离线待审）

**2026-11-18（温尼伯）｜`NO_GO`，不是可执行清单，不签发 SHA。** 依据 [06:40 CST 已存去敏摘要](#first-onboarding-step4-readonly-result)、源码 `4985c68` 与[离线及隔离 PostgreSQL CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44309450151)。不重新采样或刷新证据期限：旧应用角色只覆盖旧数据库登录，旧桶/分发仅作隔离部署样板，D2 核验角色有 Secret 正文读取及证据写入，不复用。只针对同一 sandbox 首开任务和 g1，不改普通 worker、旧租户、D2 角色、版本目录或队列开关。

| 项目 | 拟安装的最小差异 | 锁定对象与独立验收 |
| --- | --- | --- |
| **首开执行身份及控制面** | 一次性执行器只调用准确任务的 `SELECT_FIRST_ONBOARDING` / `CLAIM_FIRST_ONBOARDING`，只操作该任务的租约、外部围栏、步骤和技术证据；一次配置写入只给该实例。AWS 建栈提交侧只读准确新栈及最多一次 `CreateStack`，`iam:PassRole` 限准确 CFN 服务角色及 `cloudformation.amazonaws.com`。CFN 角色只覆盖初始 7 项承载资源所需动作及另批的托管回滚；ECS 两个 PassRole 严格限定给 `ecs-tasks.amazonaws.com`。 | 源码、运行入口、调用者／trust／边界、准确栈名、任务角色、日志组、外部围栏键及实际监听器 ARN 固定后才出策略。不授予直接 `UpdateStack`/`DeleteStack`、任意日志内容读取或 IAM 写，不以通配监听器 ARN 等待恢复。若共享角色不能只收敛到首开范围，停止该项，不把宽权限挂到现有 worker。 |
| **Express 生命周期与应用角色** | 复用可证实的 `TechlongSandboxTenantLifecycleTaskRole` 管理连接；只访问 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/postgres`，并在受审入口限定 V3 程序、固定空基线恢复、迁移及激活，管理凭据不进应用。若缺固定基线权限，仅候选两条准确 `s3:GetObjectVersion`（archive/manifest，分别固定键、VersionId 和 SHA；如需 KMS，仅准确加密对象所需范围）。每租户应用 TaskRole `TechlongSandboxFirstOpen-<租户摘要前16位>` 只给 `rds-db:connect` 到该物理集群的准确新租户 SQL 登录及本桶商品动作。 | 由实际实例/工作区/产品/环境/Cell 派生新库与角色，审管理和应用的有效权限，锁定基线工具及 PG17.9 兼容证据。`CREATEDB`/`CREATEROLE` 或等效管理能力不下发给应用；V3 临时 NOLOGIN guard、库/角色创建和应用 `LOGIN` 是将来首开动作，不是本次安装副作用。不改别的库的 PUBLIC ACL 来换取隔离，不借旧登录或默认 Full。 |
| **g1 Secret 供给与 ECS 执行角色** | 供给权限仅覆盖该代际派生的完整 Secret 名、归属标签和批准的加密路径；将来只用确定性版本 token 调用一次初始 `CreateSecret`，不用 `PutSecretValue`、轮换或删除。ECS 执行侧仅现有 ECR repo 拉取需用的能力、本栈日志流，以及控制公钥和新 g1 各自所需的固定版本注入。 | 固定控制公钥的 ARN＋VersionId。g1 只接受本次创建 ACK 的准确 ARN/初始 VersionId，并由独立元数据确认唯一版本。如在安装时 ARN 尚未生成，实际政策须把批准的完整名称推导边界、AWS 随机后缀的限制及固定 VersionId 的有效性写明；不能用全 Secret 通配或 `AWSCURRENT` 代替。若不能证实 ECS 固定版本请求受此约束，或确需取得 ACK 后再绑定权限，不放行首开、不领取后停等。只有已审客户托管 KMS 路径才列准确 key/服务/上下文及所需操作，不默认安装新 key 或宽解密。 |
| **独立只读核验** | 单独的 `TechlongSandboxFirstOpenInspector`；上限沿用[首开读取适配](../lib/deployments/execution/first-onboarding-reader.ts)的 24 次 AWS 元数据，限定原 Cell/平台和新租户的 CFN/ECS/ELB、Express 集群、ECR 镜像、指定 zone/name、桶拥有者和两个 Secret 的版本元数据。允许另审的准确 TLS `/health`、`/ready` 和仅目标库的 SQL 只读身份/版本/schema 元数据，不读业务行。 | 核对独立会话、实际 allowed actions、目标资源和必须使用 `Resource: *` 的只读例外，写清受限查询参数及无分页规则；不授予 `GetSecretValue`、S3 对象读写、CFN/ECS 写或 Neon 完成权。只读 DB 登录路径须另证，不用执行者、应用或 D2 核验凭据。 |
| **Neon 完成／回读** | 先审核供给一个 `NOLOGIN` definer 和互相独立、无角色成员资格的写／读 LOGIN；生成器只校验这些角色，不负责创建或供给凭据。再以一份原子 DDL 安装专用 schema `techlong_first_onboarding`、`complete`/`inspect` 各 1 个；列级读/锁及精确 DML 仅给 definer，撤销 PUBLIC，LOGIN 只有对应函数调用权。密码、托管和供给须另批，不进仓库。 | 按[生成器](../lib/deployments/execution/first-onboarding-completion-entry.ts)固定真实 job/deployment/instance、最终首开审批 SHA 和 `writeBefore`；在测试购买另批登记 held 任务、其余材料确定后，才能派生这份 DDL，且在任何领取前另批安装。安装后独立核对 owner、权限和函数正文摘要；真实运行一次提交 3 条状态更新＋1 条 revision 0 绑定，不允许拿执行入口做试写。独立读回用另一登录，既有 D2 角色、数据库 owner 和普通 worker 均不代替。 |
| **新租户私有图片存储** | 若无已证实合格的本租户设施，候选仅一个独立 CFN 存储栈、5 个资源：`MediaBucket`、`MediaBucketPolicy`、`MediaOriginAccessControl`、`MediaDistribution`、`MediaResponseHeadersPolicy`。桶名 `techlong-sandbox-tenant-images-402010193138-<租户摘要前16位>`；版本化、四项 Public Access Block、BucketOwnerEnforced、SSE-S3、保留桶，不设自动到期。OAC 签名；桶策略仅给准确分发 `GetObject` 到 `products/*` 并拒绝非 TLS；应用仅同前缀 `PutObject`，现有图片替换和失败补偿需 `DeleteObject` 时明确审入，不给 `DeleteObjectVersion`、列桶或其它桶权限。 | 沿用[五资源布局](aws-instance-release-persistence-plan.md)，不借旧桶/OAC/分发；CORS 仅准确买家来源，不改 API CORS。验收精确桶拥有者和 CFN 归属、保留/阻隔/加密、OAC/SourceArn 和对象范围、分发 `Deployed` 与真实 HTTPS 域名，以及 `s3`／地址／无本地降级。CDN 商品图片公开读取，不放业务私件；不搬图、不上传探针。 |
| **准确 API DNS** | 仅在原 Cell 恢复且实际新 ALB 经回读后，对准确公共 sandbox zone 的 `<实例 slug>.sandbox.techlong.cloud.` 提交最多一条 `CREATE` A Alias；权限候选限定准确 hosted zone、normalized name、类型 `A`、动作 `CREATE`，目标锁定真实 ALB DNS 和其 canonical hosted zone。 | 精确记录已存在且等于真实目标时不写；同名冲突、非预期类型/归属/目标即停。不 `UPSERT`、不改通配或其它别名，不能从旧模板填目标。核对 change 状态和准确别名回读；443 优先级 100（拒绝）/101（业务）、8443 优先级 100（控制）必须实际空闲，不挪旧规则。 |

**编成执行材料前要补齐的只有三组事实（新读取全部另审）：**

1. 围绕唯一拟验收实例：工作区/受信首版镜像、购买后 held 任务与租约范围、派生名称是否占用、准确 public zone/域名和新桶/角色名称；若对象尚未产生，明确标为未绑定。记录固定 archive/manifest 元数据与已有兼容证据，不列桶搜对象，不读正文。只对实际采用的角色补有效 trust/边界/相关策略、准确 ECR 与 Secret/KMS 版本元数据；不重复旧应用角色、旧桶或 D2 身份检查。
2. 围绕本次身份安装：明确每个注入端口的真实调用者、部署入口、SQL 事务/证据与准确 API 集合；Neon 只读目录、Express SQL 兼容/隔离、实际固定正文或私密登录验证若确有必要，单列连接和对象上限另审，不包含在元数据核对内。未证明的真实适配不由 CI 替代，也不通过给 owner/管理员运行权限绕过。
3. 围绕恢复后的新物理值：只从[清单二](#first-onboarding-step4-restoration)的独立回执派生两条监听器、ALB/Alias；若需 IAM 补差异只列实际 ARN。实例标识、Secret 派生、DNS/权限或完成 DDL 迟迟无法绑定时，保持任务待审，不先开始短领取窗口。

安装批准不含恢复、付款、领取、正式 `CreateStack`、首开配置写入或原子完成。将来实际安装须按准确对象及模板／SQL 摘要、上限、独立回读和失败策略审批；跨 AWS 与 Neon 非原子，失败可遗留收费资源或角色，未知结果不自动重提、补齐或清理。

<a id="first-onboarding-step4-restoration"></a>

#### 第 4 步清单二：只恢复原 Express 和共享 Cell（离线待审）

**共享准备边界：** 仅 `402010193138 / ca-central-1`，使用已存对象标识，不把 06:40 的 `stopped`/缺输出当当前事实。新读取另审，只需原 Express 集群和 writer 定向元数据、原 Cell Stack 状态/Original/一页资源和活动变更集；只有用于判断严格四项差异时才补已知的证书、mTLS trust store、实际监听器或角色关联。不盘点其它栈、区域、数据库，不探测 API、查私密配置或连接 SQL。

| 恢复对象 | 允许提请审批的写入上限 | 执行前门槛／成功回执 |
| --- | --- | --- |
| **原 Express** `techlong-sandbox-express-d001`，物理 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，writer `techlong-sandbox-express-d001-instance-1` | 最多一次对原集群 `StartDBCluster`；不对 writer 单独写，不新建、替换或修改参数。 | 新事实确认原集群、writer、PG17.9、IAM auth、端点归属一致且确实 `stopped` 才提交；已 `available` 且匹配则不写。随后只读核对集群与原 writer 均 `available`，身份和端点不变；这不是应用或 SQL 验收。不明确、出现过渡/失败且超预算或 ACK 不明即停，不重发。 |
| **原 Cell** `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` | 原栈上 `CreateChangeSet(UPDATE)` 最多 1 次、对该准确 ARN `ExecuteChangeSet` 最多 1 次。仅 Add `CellLoadBalancer`、`BusinessHttpsListener`、`ControlMtlsListener`、`BusinessControlDenyRule` 及恢复相应输出；无直接 ELB 创建。 | 当前 Original 与归属必须证明 12 项保留且四项确实缺失，无竞争操作；逐项核对精确四 Add、无余下资源/参数/标签或角色更改。以[历史 A2 形状](../ops/deployment-baseline/cell-a2-executed-20261107.json)为参照，绝不复制 ARN、Change Set 或回滚选择。成功须独立证明同一栈 `UPDATE_COMPLETE`、12 个保留物理 ID 不变、总计 16、ALB active，443/8443 属同一 ALB，证书和 8443 `verify` mTLS/准确 trust store、443 共享拒绝规则正确，输出匹配真实 ARN。若已完整恢复，仅接受同等独立证明并跳过写；若仅缺输出或差异不是四 Add，停下另审。 |

**开窗和失败策略：** 先备齐可离线的安装、首版和验收材料，再另批窄恢复；只有 Cell 恢复模板和实际权限就绪才开窗，避免 Express 或 ALB 无谓提前计费。Cell 执行前须明确批准回滚选择；候选优先采用 CFN 托管回滚，不继承历史 `DisableRollback=true`，不授权主动回滚、删除 Change Set/资源或重试。未知提交、部分恢复、并发变化或窗口不足时只保留原记录，另批独立回读；不继续另一条写入来凑齐结果。恢复有持续费用，窗口结束不自动停费。**不恢复平台、旧租户、独立 RDS `speedfeast-postgres-prod`、整环境或全队列；不并入新 IAM/DNS 变更。**

编制两份清单时只编辑本地文档，未访问云。随后用户另批的定向补核见[结果](#first-onboarding-step4-install-restore-facts)，不重放旧事实或审批。

<a id="first-onboarding-step4-install-restore-facts"></a>

#### 第 4 步安装与恢复清单：集中只读补核结果

**2026-11-18 07:15:32.900–07:16:02.125（温尼伯 CST；13:15:32.900–13:16:02.125Z）｜`NO_GO`，无执行 SHA。** 固定 Source 区域 STS **1 次**匹配准确 IAM 用户；元数据 **20 次**（CFN 4、证书/trust store 2、IAM 13、Route 53 1），19 次成功，1 次为拟建核验角色 `NoSuchEntity`。未翻页、未重试。只保留本节投影，不保存模板正文、策略正文、证书内容或原始响应。

| 清单项 | 证据及结论 |
| --- | --- |
| **共享 Cell 四项恢复** | 原栈尾 ID `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`，`UPDATE_COMPLETE`，一页内无活动 Change Set。实际 12/12 项匹配[已存物理归属](../ops/deployment-baseline/cell-a1-executed-20261106.json)且状态稳定。缺四项恢复资源及 `HttpsListenerArn`、`ControlListenerArn`；查询的 Original 规范 SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`，与从[已存 16 项候选](../ops/deployment-baseline/cell-reattach-draft.template.json)仅移除四项资源和两个输出的结果完全一致，无其它模板差异。候选规范 SHA 保持 `e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`。这是离线模板差异，不是 AWS 已创建的 Change Set。 |
| **Cell 原依赖** | 原角色仍为 `TechlongSandboxFirstAcceptanceCellExecutionRole`，有 CFN trust、`TechlongSandboxFirstAcceptanceCellExecutionBoundary` 和唯一 inline `FirstAcceptanceCellResourcesV1`，无附加策略。原证书 ID `6d1f2880-9f83-449c-930a-6b17516ef49d` 为 `ISSUED`、覆盖 `*.sandbox.techlong.cloud`；原 trust store `techlong-sandbox-control-v1/aa1771fd0469cc44` 为 `ACTIVE`、1 个 CA。尚无实际新 ALB/监听器或 mTLS 独立验收；关联与元数据不等于四 Add、所选回滚及 PassRole 的实际有效权限。 |
| **原 Express** | 未重读集群或 writer，复用 [06:40 CST 摘要](#first-onboarding-step4-readonly-result)的准确集群、writer 当时 `stopped`、PG17.9/IAM auth，不把旧事实写成新的状态核对。恢复仍拟只启动原集群一次；执行前实际状态与独立回读均属另批清单。 |
| **首开权限** | `TechlongSandboxProvisionerRole`、`TechlongSandboxCloudFormationExecutionRole` 均存在，各只附加自己的 Boundary、无 inline；后者有 CFN trust。`TechlongSandboxTaskExecutionRole` 存在，有 ECS Tasks trust、`TechlongSandboxServiceRoleBoundary` 和唯一 inline `PullSandboxImageAndRuntimeSecrets`，无附加策略。这些是关联/信任摘要，不证明新任务角色 PassRole、准确新 g1 固定版本可读或新监听器 ARN 已被覆盖。`TechlongSandboxFirstOpenInspector` 返回 `NoSuchEntity`：需另审新专用角色，不拿既有 D2 核验角色代替。Neon 未连库，实际 GRANT 仍未证明。 |
| **持久化和准确 DNS** | 已确认 `Z01473621BTTHKXBGOOEJ` 是 `sandbox.techlong.cloud.` 的公共 hosted zone，未枚举或读取任何记录。新租户实例/slug、桶、CDN、应用角色及 g1 Secret 未绑定；缺可靠精确原件的 archive/manifest VersionId 也未靠搜索补全。故未查名称占用、S3/CloudFront或 Secret，未预填名称、Alias 或旧 ALB 值。新域是否空闲及新存储有效权限仍未证明。 |

**时序与继续点。** 已确认四 Add 的候选形状，不必再重复这一轮盘点；合用 Express 旧事实不晚于其原观测起算 5 小时（最早端 2026-11-18 11:40:50.837 CST），新补核不延旧期限、不授权开窗。先绑定单一验收工作区和可信首版，收口真实执行入口、安装权限和精确对象缺项；未绑定对象不读不写。原 Express/Cell 等其它材料齐备后再另批恢复，安装、恢复、测试购买、首开执行各自批准，不能用本节作为执行清单。**本轮 AWS 写、Secret 值、Aurora/Neon 连接、Stripe、恢复、队列启用、部署/调度、任务和槽变更均为 0。** 不改普通 worker 和 D2。

<a id="first-onboarding-step4-candidate-binding"></a>

#### 第 4 步：锁定可信首版与唯一验收范围（离线）

**2026-11-18（温尼伯）｜`NO_GO`。** 固定一个专用 sandbox 验收工作区作为唯一范围（拟用显示名「Sandbox 首开验收」；**真实 `workspaceId` 未绑定**）。仓库已存验收材料中的工作区 `ws_ac46ffc6778f44f5a4b5332c41bb9f33` 已有 `app_e897a4377bce498b9c5ee9e64509dcad`，不能当首开工作区；也不借此复用其租户桶、域名或权限。不从显示名猜 ID，不把一个未创建的工作区当成现存记录。若用户提供一个确切专用工作区 ID，只准备核对该 ID；若没有，记为待另批建立一个新工作区，不搜索或自动选择其它工作区。

**唯一首版固定为 A**：`release_00b9c5cfa6bceedc5fd05aa451dca811`（`d2-6-a-b9ca2138-r44128576107`），`prd_restaurant_order_system / tenant_api`。用[已存 A 目录对象](../ops/releases/d2-6-step4-activation.prepared.json)重算规范 SHA `b7aa3406a88a30cc9d38d88809dde6bfd8ee231784c5188ad11c43da62662702`，与[真实登记和独立回读](aws-instance-release-initial-publication-observed-20261117.json)一致；D2 最后一次真实验收回到 A，见[结案](aws-instance-version-release-plan.md#d2-closeout)。

- 固定镜像：`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0`。存档 manifest 与 `linux/amd64` 平台 digest 相同，不用 tag、不替换成 B、不重推、不重新登记。
- 兼容要求：`express_iam`、`speedfeast-saas-control-v1`、端口 `3000`、`speedfeast-client-api-sha256:90191edd28decd490e95ea35461f9e26200874783a1ffc5f8598406bbc583144`；应用启动不得迁移/写数据库。已有 `ecr_verified` 是独立回读的历史事实，不替代使用前的目录未撤销、镜像仍在和新空库/基线兼容证明。
- 同一对象范围：账号 `402010193138`、区域 `ca-central-1`、环境 `env_aws_sandbox_ca_central_1`（key `aws-sandbox-ca-central-1`）、`cell-sandbox-1`、`standard-v1`。最多 **1 工作区、1 实例、1 条首开待审任务**；拒绝已有该产品实例或订阅、非测试模式购买、旧任务或第二个任务。全队列不打开。

##### 将安装清单绑定到真实值的顺序

| 最小安装项 | 本轮已固定 | 缺项与放行条件 |
| --- | --- | --- |
| **待审登记入口** | `AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID=release_00b9c5cfa6bceedc5fd05aa451dca811`；`AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID` 只允许一个真实工作区 ID；镜像必须是上面的 A digest。只登记待审且不会被普通队列领取的任务。 | 先拿到/只读验证准确工作区及 A 的当前目录状态，再单独审该工作区的配置和一次测试购买。`AWS_SANDBOX_IMAGE_URI` 也是[普通计划使用的镜像输入](../lib/deployments/management.ts)，不得为首开改全局默认。若现有入口的镜像与 A 不符，或不能证明只作用于该工作区，停下来另审最小差异，不走普通 apply。 |
| **首开身份／Neon** | 从[补核结果](#first-onboarding-step4-install-restore-facts)复用准确已有角色布局；缺少的独立身份只按 `TechlongSandboxFirstOpenInspector` 准备，拒用 D2 核验身份。首开完成/独立回读只用现有 `complete` / `inspect` 生成器。 | `runReviewedFirstOnboarding` 的引用目前只有定义和测试，没有已接通的真实入口；可信首版或已存在的角色不能代替签名调用者/稳定运行入口、范围、固定 Secret 版本请求和有效策略的证明。新应用角色/PassRole 与 Secret 范围须用下行真实派生名，监听器限定须等实际恢复输出；DDL 在真实 `jobId`、`deploymentId`、`appInstanceId`、执行签核的 SHA/截止固定后派生，领取前另外安装审批。不安装宽 policy、旧 D2 角色或 owner 暂代。 |
| **隔离存储和 g1 名称** | 用[现有派生](../lib/deployments/first-onboarding.ts)：`H=sha256Hex({appInstanceId,workspaceId,productId,environmentId,cellKey})`；桶只用 `techlong-sandbox-tenant-images-402010193138-`＋`H` 前16位，角色只用 `TechlongSandboxFirstOpen-`＋同前16位；库/SQL 角色同一前缀 `tenant_<H前16位>`。只准[五资源私有存储形状](#first-onboarding-step4-installation)，对象范围 `products/*`；g1 名调用[现有代际派生](../lib/deployments/execution/tenant-database.ts)。 | [真实购买路径](../lib/instances/management.ts#L435)才随机生成 `appInstanceId`，不能现在算出准确新桶/角色/Secret 名、目标栈或 job。另批购买后仅从唯一实际 held 任务派生，确认占用/固定运行引用和基线 archive/manifest 版本；新 CDN 地址从本桶实际分发回执获取，所需 KMS、VersionId 或兼容证据缺失时不启动首开。 |
| **API DNS** | 用已证实公共 Zone `Z01473621BTTHKXBGOOEJ`；新实例 `slug` 取真实记录（当前购买路径为 `pending-` 加实例 ID 下划线转连字符），只候选一条 `<slug>.sandbox.techlong.cloud.` 的 `CREATE A Alias`。 | 只查准确名称占用，不接受显示名或猜测的 slug、不查其它 DNS；Alias 的目标及 canonical hosted zone 只取原 Cell 恢复独立回执的实际 ALB；恢复前不装 Alias。固定动作和精确名称，冲突即停、不 `UPSERT`。 |

**工作区接续：** 用户确认没有可用专用工作区，转入[单工作区建立申请](#first-onboarding-step4-workspace-create)，不扫描或借用旧工作区。可信首版 A 保持不变。

<a id="first-onboarding-step4-workspace-create"></a>

#### 第 4 步：单工作区建立申请（仅准备）

**历史方案，未执行。** 原方案依赖一个已有的普通测试账号；用户已确认没有此账号，改为[普通账号与唯一工作区一同建立](#first-onboarding-step4-test-account)。保留原分析作追溯，不走后台的新建客户按钮或先建空工作区。

| 项目 | 单次待审范围 |
| --- | --- |
| **入口与前置** | 复用现有[新建企业客户页面](../app/admin/customers/new/page.tsx)与[受平台管理员限制的 POST](../app/api/admin/customers/route.ts)，只在已确认连接到本次验收控制库的既有可用入口提交一次。另行批准后，按确切邮箱验既有活跃非平台管理员账号，账号 ID 必须匹配代码的 `stableId("usr", email.toLowerCase())`，且同一负责人没有这一个确切名称的工作区；只查这些条件，不列客户或用户。账号不符、无可用入口、环境不明或已有同名工作区即停，不绕过入口直写 SQL，不启动平台或 AWS。 |
| **真实写入上限** | [createCustomer](../lib/admin/management.ts#L825) 在一个 Neon 批事务中执行三条语句：既有负责人账号仅更新 `users.updated_at`；插入 1 条新 `workspaces`（`active / not_configured / not_provisioned`）；插入 1 条该负责人的 `workspace_members`（`owner`）。原代码在邮箱缺失时会插入用户，**不在本稿批准候选范围内**；若不能把已有账号条件落实到受控提交窗口，则不执行。登录会话若需建立另界定，不取密码或 Cookie、不改用户权限。 |
| **回执与未知结果** | 成功只接受同一次响应的真实 `wsp_…`，另行限定只读回查该 ID 的状态、归属、成员数为 1、无订阅、无实例/首开任务；新 ID 仅用于下一步与 A 绑定，不立即写部署配置。提交后成功回读不在批事务内，超时/报错不能判定未提交；现有入口生成随机 ID、无幂等键，未知结果不再提交，不自动删除，另批仅按确切负责人和名称查因。只记录必要 ID/布尔值，不把联系人邮箱或认证数据提交仓库。 |

**原范围不包含：** 新账号/邀请、套餐配置、订阅、Stripe/测试购买、实例/任务、部署配置或 A 的重新登记，以及 AWS 读取、安装、恢复、队列启用和实际首开。原方案没有创建任何数据，不是当前待批动作。

<a id="first-onboarding-step4-test-account"></a>

#### 第 4 步：一次普通注册建立专用账号及工作区（仅准备）

**`NO_GO`，无执行 SHA。** 用户确认没有测试账号，拟复用[普通注册](../app/register/page.tsx)，非邀请路径。只登记 1 个非平台管理员账号和 1 个新工作区「Sandbox 首开验收」，用户用自己控制且未在该验收入口注册过的邮箱和自设密码；不借旧租户或平台管理员。普通注册直接生成工作区，**不再走后台新建客户**。这是控制库中的普通工作区，不自动配置 sandbox、套餐、付款或部署。A 保持锁定。

| 项目 | 单次待审范围 |
| --- | --- |
| **入口** | 只在后续确认已可用且连接本次验收控制库的可信入口，由用户本人在无旧登录会话的浏览器窗口打开 `/register?returnTo=%2Fdashboard%2Fsettings`，一次提交 `POST /api/auth/register`，不带邀请 token。来源与实际部署版本必须匹配；无可信可用入口就停，不能借用旧租户、直写 SQL、开公共注册窗口或自动启动平台。已有[平台停用记录](aws-environment-tool.md)不是实时探测结果，也不授权恢复。 |
| **实际写入** | [注册实现](../lib/auth/credentials.ts#L159)先按规范化邮箱查重，账号、工作区、Owner 成员关系和密码散列各 1 行同一事务；账号 `active / 非管理员`，工作区 `active / not_configured / not_provisioned`。不发信、不邀请、不插入订阅/实例/任务。密码仅在本人可信页面输入，不在聊天、报表或仓库中收集。 |
| **已接受的注册副作用** | 注册成功后另建 1 条登录会话并设置 Cookie。[现有会话事务](../lib/auth/credentials.ts#L419)同时删除该控制库内截至当时**所有已过期会话**，不只测试账号；不影响有效会话。用户已接受本人后续标准注册的这项副作用，本轮只许查入口，不执行会话清理或注册。 |
| **回执与未知结果** | 页面返回成功后只进[工作区设置](../app/dashboard/settings/page.tsx)读取 `wsp_…`、名称和 Owner 状态，不购买、不配置；只回传工作区 ID 或简短错误。账号/工作区事务与会话事务分开，超时/500 可能已提交前者；不要重复提交或再走后台创建，另批仅对该邮箱派生的准确工作区进行只读查因。独立回查也另审，只核对该工作区、普通账号、唯一 Owner、无订阅/实例/首开任务，不查密码散列或会话正文。 |

<a id="first-onboarding-step4-register-readonly"></a>

**入口只读结果（2026-11-18 07:58:04.882–07:58:05.267 温尼伯 CST；13:58:04.882–13:58:05.267Z）：`DNS_UNRESOLVED`。** 对既有 `https://console.sandbox.techlong.cloud/register?returnTo=%2Fdashboard%2Fsettings` 尝试 1 次匿名 HTTPS GET，当前执行环境未解析出主机，curl 退出码 6；未建立 TLS、无 HTTP 状态、未见注册表单。未重试、未跳转或另查 DNS/平台资源。结果只说明本次入口不可达，不单凭此判断云端资源现在的状态。

**停止点：不注册。** 未登录、未提交表单、未取凭据或 Cookie，账号/工作区/会话、数据库访问、购买、AWS API、恢复及队列变更均为 0。用户随后要求只准备[既有注册入口最小恢复方案](#first-onboarding-step4-register-minimal-restore)，不能自动恢复。首版 A 不变。

<a id="first-onboarding-step4-register-minimal-restore"></a>

#### 第 4 步：原 sandbox 注册入口最小可用方案（离线）

**2026-11-18（温尼伯）｜`NO_GO`，无执行 SHA。** 为了使用原地址 `https://console.sandbox.techlong.cloud/register?returnTo=%2Fdashboard%2Fsettings`，只考虑让**原平台栈**重新提供网页和认证，不恢复整个环境。复用[已存停用回执](../ops/temporary-idle/stop-continuation-execution-20261113.json)、[原 11 项平台闭控模板](../ops/deployment-baseline/platform-idle-convergence.template.json)和[本次 DNS 未解析的记录](#first-onboarding-step4-register-readonly)。离线校验历史模板的四项恢复差异、七项保留及来源 `d098cfefd11c8839d5b00fee0701a71ed74aa73c` 确有普通注册和工作区设置页；不把旧回执或本次 DNS 失败当成当前云端归属，也不证明线上镜像此刻可拉取。

| 范围 | 候选最小变化 |
| --- | --- |
| **原平台栈** | 仅 `402010193138 / ca-central-1`、`techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`。若实际仍是已知七项停用形态，只候选同一栈一次 `UPDATE` Change Set，恰四个 Add：`LoadBalancer`、`HttpsListener`（443，原证书）、`Service`（仅 1 个原 Fargate 平台任务）及 `DnsRecord`（原公共 zone `Z01473621BTTHKXBGOOEJ`、准确 console A Alias）。Alias 由模板引用**本次同栈新 ALB**的 DNS 与 canonical hosted zone，不手写旧 ARN、不在 Route 53 另做 `UPSERT`。保留 `AlbSecurityGroup`、`Cluster`、`LogGroup`、`TargetGroup`、`TaskDefinition`、`TaskIngress`、`TaskSecurityGroup` 七项及其物理 ID、参数、角色、标签、输出；不能借机更新旧资源。 |
| **运行配置和数据** | 原平台镜像 `techlong-sandbox-platform-web@sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a`、原任务定义及固定 `DATABASE_URL` 注入引用不变；按已有证明绑定原验收 Neon 控制库，不另供给账号或读 Secret 值，不改数据库。控制器及 hosted/local、初始请求、worker、apply 均保持关闭；不挂载控制器私钥，不开启租约或部署入口。镜像、引用、启用态或数据库归属不能证明即停。不恢复共享 Cell、租户栈、Aurora 或独立 RDS，不调用整套环境 `start` 工具。 |

**将来实际顺序（各自另审）：**

1. **一次定向只读补核。** 只核对原平台栈状态、Original、保留资源和是否有未决变更集；再核准确保留任务定义的镜像与闭控/固定引用，以及该 zone 上 console 精确记录占用。复用尚有效的同证书证据；只在现有证明不足时另列准确证书、镜像或 Secret 版本元数据，不查正文、不重复盘点其它栈。若实际已恢复，只核现有入口不做写；若并非准确四 Add、出现外部同名 DNS/ALB 占用、模板/执行身份或保护变化，停止，不接管/覆盖。
2. **只创建并审这一份变更集，执行再确认。** 固定实际模板、执行身份和差异，`CreateChangeSet` 与 `ExecuteChangeSet` 拟各最多 1 次。历史原栈未关联显式 `RoleARN`；若实际仍使用提交者派生会话，须明确审核其权限，不擅自指定新角色。看到准确四 Add、七项无 Modify/Replace/Remove 后才审核执行；明确 CFN 托管回滚的权限与副作用，无权限或需改其它资源即停。不继承旧变更集/授权，不直接改 ELB、ECS、DNS、IAM；失败或提交不明不重试、不主动回滚/清理。
3. **独立证明页面可用，再由用户本人注册。** 回读同一平台栈 `UPDATE_COMPLETE`、四项归属/七项物理 ID、任务定义与关闭开关、ECS 1 运行/0 待启动及目标健康、443 验证的证书、准确 Alias 指向新 ALB；再做不带身份的 HTTPS GET，各最多一次 `/api/health` 和准确 `/register?returnTo=%2Fdashboard%2Fsettings`，要求正确平台响应和普通注册表单，无外部跳转。不把 `/api/health` 200 或页面表单当成数据库写入通过，不为验收追加测试 POST。通过后只把可信入口交给用户本人；注册/工作区回执和任何后续购买是独立步骤。

**费用和公开面的边界。** 原 HTTPS 监听器转发整个平台，不是只开放 `/register`；拟复用原访问边界，不新加公网旁路或开启部署控制。ALB、1 个任务、公网 IPv4 等可能持续计费；本方案不设置 TTL、不自动停费或删除，注册后如需关停只按原平台栈另审。不在本轮更改正式模板、代码、配置或启停状态。**本轮只读仓库内已有证据并做离线断言；AWS/公网探测、数据库、Secret 值、创建变更集、资源启动、注册和购买均为 0。**

<a id="first-onboarding-step4-register-platform-facts"></a>

#### 第 4 步：注册入口原平台定向核对结果

**2026-11-18 08:17:53.956–08:18:04.681（温尼伯 CST；14:17:53.956–14:18:04.681Z）｜只读核对通过，未恢复，`NO_GO`，无执行 SHA。** 已获准的固定 Source STS 1 次匹配准确 IAM 用户；元数据 6 次全部成功（原平台 CFN 4、准确 ECS 任务定义 1、准确 Route 53 名称 1），无翻页或重试。仅保存以下投影，原始模板、任务环境和 Secret 引用不另存或输出。

- **原栈**仍为 `c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`、`UPDATE_COMPLETE`、无显式 `RoleARN`。`Original` 规范 SHA `cd0a829365af8e1b2a6a993448866237d0ea3b0920eb43b783c6f5aa380437e1`；与历史 11 项模板仅去掉 `LoadBalancer`、`HttpsListener`、`Service`、`DnsRecord` 后的全文一致。实际 7/7 个保留资源的逻辑 ID、类型、物理 ID 和稳定状态匹配，单页未决 Change Set 为 0。
- **任务定义** `techlong-sandbox-platform-web-v1:13` 为 `ACTIVE`，匹配原 CFN 物理绑定、平台镜像 digest、单容器、Fargate 网络/规格、执行角色及无应用 TaskRole。完整环境匹配原闭控模板，控制器（含 hosted/local）、初始请求、worker 和 apply 均关闭；唯一 `DATABASE_URL` 固定 Secret 引用匹配。核对的是定义元数据，不是运行中任务、Secrets 内容、镜像仍可拉取或数据库可用性的证明。
- **DNS**：在已知公共 zone `Z01473621BTTHKXBGOOEJ` 从 `console.sandbox.techlong.cloud.` 精确名称起查一条；返回的第一条不是该名称，故**本轮未见准确名称占用**。未跟页，未保存邻接记录或修改 DNS；新 Alias 目标仍须取同栈实际新 ALB。未重新探测 `/register`，也未查询 CloudFormation 之外同名 ALB 是否存在。

**下一步只用本轮事实编制「仅创建、不执行」的四 Add Change Set 审批材料。** 不重复盘点，不换角色或候选；如实际创建所需的精确依赖有未证明项，另列最小核对，不用历史数据强行放行。本轮新事实按首个采样起算至温尼伯 **2026-11-18 13:17:53.956 CST**，不延期，不自动开执行窗口。AWS 写、Secret 值读取、数据库访问、创建/执行变更集、资源启动、注册、购买和调度均为 0。实际创建与执行分别另审，页面核验通过后才由用户本人注册。

<a id="first-onboarding-step4-register-create-review"></a>

#### 第 4 步：原平台四项恢复变更集——仅创建审批材料

**原清单已批准，提交前停止，不可重放。** [原清单](../ops/deployment-baseline/platform-register-restore-create.review.json)规范 SHA **`1b39fab237fa130f9b4abe7968105c71ea67ede2b92bdae851621e2b085f2d6f`**仅供追溯，见[更正清单](#first-onboarding-step4-register-create-standard)。候选为 `techlong-platform-register-restore-20261118t141753z`；仅普通 `UPDATE`，原平台栈，不导入或包含嵌套栈。

| 核心项 | 准确范围 |
| --- | --- |
| **模板差异** | 用原 11 项闭控模板只派生 `Service.DesiredCount=1`，候选模板规范 SHA `6b982ae4027bf583793f6be6e2a1631994f5c2aca0b548309e81a55b5dd5e036`。相对本轮只读核实的七项停用模板，恰四 Add：`LoadBalancer`、`HttpsListener`、`Service`、`DnsRecord`；0 Modify/Remove/Import/Replace。七保留资源和模板其它段逐值不变；根 Description 的历史停用文字只作归属记录，新服务的真实期望数以新增 `Service` 声明为准。 |
| **原参数、角色、标签** | `ControllerLease`、`HostingExpiresAt` 均 `UsePreviousValue`，原标签映射须匹配再原样传递，不续约。原栈无显式 `RoleARN`，不指定新角色或 IAM 能力；CFN 可能按原调用者的临时会话权限验证，不据此安装/扩大 IAM。任务仍用保留 `:13` 与固定 DB Secret 引用，控制器、初始请求、worker、apply 均关闭；不读 Secret 值。 |
| **待批准调用** | 最多 `CreateChangeSet` 1 次；前置、独立回读共 STS 最多 2、元数据最多 12。一组仅核对原栈状态/更新时间/原标签/无未决变更集，以及**单个准确 ALB 名**和 console DNS 名均无碰撞；ALB 名是上轮没有读取的新对象检查，须在本次批准中明示。只在 ACK 后由独立进程使用同一固定 Source 身份，对准确 ARN 最多 4 次单页 `DescribeChangeSet`（总等待不超过 180 秒），核对 `CREATE_COMPLETE / AVAILABLE` 和四 Add，再比较变更集模板摘要、原栈模板与七项物理 ID 保持不变。不对其它栈、镜像、数据库或平台 HTTP 检查。 |
| **失败与禁止** | 提交前写单次意图并占永久槽；超时、响应不明、变更集不符或事实变化即停，不自动重发、删除未执行记录、回滚、补齐或消费新槽。API/provider 验证与日志可能有低额非零费用；并发或 AWS 后台验证不是跨资源原子操作。`ExecuteChangeSet`、其它云写、ALB/ECS/DNS 实际恢复、注册、购买、队列、Cell 和数据库操作均为 0。 |

**原事实时限不延长。** 若未来获准，最晚 **2026-11-18 13:07:53.956 CST（温尼伯）**启动本轮创建核对，事实 **13:17:53.956 CST** 截止；超过任一门槛不提交、不重放。取得并独立核对准确 Change Set ARN 后，再另报执行与失败策略审批；注册页当前仍未恢复。本轮本地复算清单、物化请求和模板三份 SHA 并核对四 Add、保留配置与边界，仅提交审批材料；没有执行工具接线、AWS 读取或写入，没有创建记录或消费槽。

<a id="first-onboarding-step4-register-create-standard"></a>

#### 提交前停止：更正普通变更集 API 参数

用户批准原 `1b39fab2…` 后，提交前对照既有生命周期工具和 [AWS CreateChangeSet API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html#API_CreateChangeSet_RequestParameters) 发现：请求字段 `DeploymentMode` 只接受 `REVERT_DRIFT`，而 `STANDARD` 是普通变更集的验收语义。**不把 `STANDARD` 发给 AWS，也不擅自改成漂移修复。** 本轮 STS、AWS API、写入、变更集、槽消费和启动均为 0；原记录保留。

**[更正后的仅创建清单](../ops/deployment-baseline/platform-register-restore-create-standard.review.json)规范 SHA `665738dfae20643d7f0fc0dbf1660ccf26b776e7b792fcf1d59ec20e5a290932` 随后获批。** 物化请求规范 SHA `583fbccd10f2d13c851c90521f25b793af4cfe0dcef83d0597838bf90d6dadea`；实际请求唯一变化是省略 `DeploymentMode`，也不加 `DeploymentConfig`。模板、四 Add、七项保留、目标栈、候选名称、有限前置读取（含准确 ALB 名）与独立回读边界均未变。原时限不延期，见[实际创建回执](#first-onboarding-step4-register-created)。

<a id="first-onboarding-step4-register-created"></a>

#### 原平台四项恢复变更集已创建，未执行

**`READY_UNEXECUTED`｜2026-11-18 08:31:24.655–08:31:52.494 温尼伯 CST。** 按 `665738df…` 单次创建并经独立进程回读：[去敏回执](../ops/deployment-baseline/platform-register-restore-created-20261118.json)。准确 Change Set ID 尾段 `52eb096a-3ed2-48a8-80cf-1d34671495df`，`CREATE_COMPLETE / AVAILABLE`，普通 `UPDATE`。前置只按准确 ALB 名得到 `LoadBalancerNotFound`、准确 console DNS 名未占用。实际四项均为 Add：`LoadBalancer`、`HttpsListener`、`Service`、`DnsRecord`，无修改、删除、导入或替换；候选摘要匹配，原栈模板、角色、参数、标签、输出摘要和七项保留物理 ID 不变。

实际 STS 2、元数据 10、`CreateChangeSet` 1、`ExecuteChangeSet` 0，单次创建槽已消费，不重放或删除。未启动平台、ALB、ECS 或数据库，未更新 DNS、启用队列、注册或购买，也未取 Secret 值或连接数据库。**下一步仅准备同一 ARN 的执行审批及失败策略，需另批。** 原事实仍于温尼伯 **13:17:53.956 CST** 截止，不因回读延期；本轮没有执行清单 SHA，注册页未恢复。执行后的独立核验和本人注册仍是后续单独步骤。

<a id="first-onboarding-step4-register-execute-review"></a>

#### 原平台注册入口：同一变更集的执行审批与失败策略

**`PREPARED_NOT_APPROVED`。** [待审执行清单](../ops/deployment-baseline/platform-register-restore-execute.review.json)规范 SHA **`f6069d7f335692444ecd4b49321fbd3ad1b3131f2c31fef7666965e21a4c605e`**，绑定真实创建并独立回读的原 ARN（尾段 `52eb096a-3ed2-48a8-80cf-1d34671495df`）。最多一次 `ExecuteChangeSet`，精确请求摘要 `88d397f8a6d4ebc7a70dfe08d6bf3ae1007d361c0fc363cb0ae9ada45475a033`，`DisableRollback=false`，不再调用 `CreateChangeSet`、不直接做 ECS/ALB/DNS/IAM 写入。

| 阶段 | 拟批准的范围和门槛 |
| --- | --- |
| **前置** | 固定 Source；仍是同一 `CREATE_COMPLETE / AVAILABLE` 普通变更集，无竞争变更集；恰四 Add、模板与原栈的两个摘要/七项物理 ID/原角色和标签匹配；准确 ALB 名、console DNS 名仍空。最多 12 项元数据，只包含这一个栈和确切依赖，并检查原 `:13` 仍 `ACTIVE` 和闭控、原证书、镜像 digest、已固定数据库 Secret 版本元数据（不取正文、不连库）。存在差异、权限不足、来源不符或时间不足，在写前停止，不自动改参数、换角色或补读。 |
| **提交与托管等待** | 写单次意图后只执行原 ARN，一次提交。CloudFormation **托管回滚开启**，可能移除本次新增的资源，回到原停用状态；这不是另行手工回滚授权，也不保证失败后没有遗留资源。收到明确 ACK 后，只看原栈，最多 7 次 `DescribeStacks`、间隔至少 60 秒、最多 8 分钟。旧栈 `UPDATE_COMPLETE` 的残留读不当成这次成功；须看到本次更新已完成并进入独立读回。 |
| **独立核验和交付** | 仅在看到本次 `UPDATE_COMPLETE` 后独立核对已 `EXECUTE_COMPLETE`、候选模板、同一栈四项归属及七项物理 ID 等未改、`:13` 和 1/1/0 任务、ALB active、443 原证书/目标 healthy、准确新 ALB Alias（最多 9 项元数据）；然后仅对 `/api/health` 与准确 `/register?returnTo=%2Fdashboard%2Fsettings` 各一次匿名验证 TLS GET，无外部跳转，不提交表单。合计 STS 最多 3、AWS 元数据 28、GET 2；无注册/登录、购买、Agent 直连数据库或调度。独立验收过后才告知本人注册，不以 HTTP 200 代替注册提交或工作区验收。 |

**失败处理：** 无法确认提交时停止保留永久槽，仅另批对同一 ARN 的只读查证，不重发。失败、进入托管回滚、等候超时或审批时限用尽时记录实际状态；不强行取消仍可能在后台进行的 CloudFormation 操作，不清理或另建。若栈已更新但独立核验失败，明确记为「已更新、注册入口未验收」，不要注册；资源可能继续计费，任何补查、修复或停止另审。

**风险和时限：** 只恢复原平台，仍是原公开 HTTPS 入口，不是仅 `/register` 的访问限制。CloudFormation 可能用原调用者派生会话；平台启动可由 ECS 托管拉取固定镜像、注入既有数据库 Secret 和产生普通日志，并允许正常流量。ALB、单任务、公网 IPv4 等可能持续计费，不设置 TTL、不自动关停；不恢复 Cell、租户、Aurora 或独立 RDS，不开启 worker。最晚温尼伯 **2026-11-18 13:02:53.956 CST** 启动核对，**13:05:53.956 CST** 前提交，原 **13:17:53.956 CST** 事实/读取截止不延；超时不自动刷新。此轮只复用并核验本地清单/回执/模板，没有调用 AWS、执行、注册、重建或消费执行槽。实际执行及以上限定读取均须明确批准此 SHA。

<a id="first-onboarding-step4-register-executed"></a>

#### 原平台注册入口已恢复并独立核验

**`REGISTER_ENTRY_VERIFIED`｜2026-11-18 08:54:57.080–09:01:41.170 温尼伯 CST。** 用户批准 `f6069d7f…` 后，仅一次执行原 `52eb096a…`，`DisableRollback=false`，未创建新变更集。[实际去敏回执](../ops/deployment-baseline/platform-register-restore-executed-20261118.json)记录 `UPDATE_COMPLETE / EXECUTE_COMPLETE`，候选模板、同栈四项新归属及七项保留 ID 均匹配；仍用原任务定义 `:13`，控制器与 worker 关闭，任务 1/1/0、rollout 完成、目标 healthy。原证书在新 443 监听器上，console A Alias 指向这次的新平台 ALB。

独立匿名 GET `/api/health` 和[普通注册页](https://console.sandbox.techlong.cloud/register?returnTo=%2Fdashboard%2Fsettings)各一次，均通过 TLS、返回 HTTP 200；确认普通注册表单，未提交。实际 STS 2、元数据 28（前置 12、等待 7、独立 9）、`ExecuteChangeSet` 1、GET 2，执行槽已消费。其他直接写、Secret 值读取、Agent 连库、登录、注册、购买、Cell/租户资源或两库恢复均为 0；无自动停机，平台 ALB 和任务等可能持续计费。

**当时交付：由用户本人注册一次，不购买。** 用户随后提交后遇到服务端通用错误，不能按页面曾验收通过推定已注册。现转入[注册权限修复待审](#first-onboarding-step4-registration-permissions)，不重复提交、不重放平台恢复。首版 A 不变。

<a id="first-onboarding-step4-registration-permissions"></a>

#### 第 4 步：普通注册最小数据库权限修复（仅离线实现）

**`OFFLINE_PROPOSAL_NOT_EXECUTABLE`。** 11 月 18 日温尼伯 **09:20:27.828 CST** 的唯一注册失败日志：PostgreSQL `42501`，应用访问 `public.users` 被拒；阶段只能定位到账号查重或注册事务，未做数据库回读，账号/工作区是否存在仍不得假定。原任务的固定 `DATABASE_URL` 引用与[已验收 Web 凭据](aws-platform-hosting-web-credential-w7m-observed.md)完全匹配，项目的[原授权](../ops/platform-web-database-role-v1/no-login.sql)只设计已有账号登录/只读验收：`users` 等只给 SELECT，认证表只给原登录所需列，未给注册的四表 INSERT。若实际目录证明查重 SELECT 反而失效或角色不符，先停，不以新写权限掩盖读权限漂移。仅引用去敏日志证据，不保存原日志或邮箱。

**选定方案：一个受限注册函数，不给 Web 直接写表。** 保持 `techlong_platform_web_acceptance_v1` 的既有授权不变；候选只新增独立 schema 的 `USAGE` 以及该 schema 一条固定注册函数的 `EXECUTE`，没有对 `users`、`workspaces`、`workspace_members`、`user_credentials` 的新直接 DML 或角色成员资格。不借 owner、超级用户或部署控制器；也不直接给四表列权，避免 Web SQL 任意创建管理员或为旧工作区追加 Owner。

| 边界 | 拟议最小变化 |
| --- | --- |
| **数据库实现** | 专用 `NOLOGIN/NOINHERIT/NOBYPASSRLS` definer，仅拥有新 schema 和一条 `SECURITY DEFINER` 函数，不拥有业务表，不赋给 Web 角色或留成员关系；只给[清单](../ops/platform-web-database-role-v1/sandbox-registration-permissions.review.json)所列四表 INSERT 列与必要 schema USAGE，不给 UPDATE/DELETE/TRUNCATE、不改 RLS/约束/触发器。函数固定 `search_path=pg_catalog,pg_temp`、全限定表名、无动态 SQL，同一事务撤销 PUBLIC EXECUTE。 |
| **注册约束** | 只绑定用户本人准备的一个规范化测试邮箱（受审私有材料中绑定摘要，不在 Git/聊天公布）及「Sandbox 首开验收」，一次最多生成 1 个普通账号、1 个工作区、1 条 Owner 成员关系、1 条密码凭据。按既有算法派生 ID，不接受调用方指定 ID、成员角色、账号状态或管理员位；普通账号、工作区的状态及非管理员值由函数写死。仅接既有 PBKDF2 结果（散列 64 位十六进制、盐 32 位、迭代 600,000），不传明文。四条 INSERT 必须同一事务，无覆盖、认领旧记录或拆分提交；已存在即拒绝。邮箱约束本身不验证邮箱归属，不把实际目标邮箱公开；若不能接受公共入口可能被知晓该邮箱者抢注的风险，不启用。 |
| **应用接线** | 仅让 sandbox 的**普通注册**用一次带绑定参数的函数调用替换原四表 `db.batch`，保持输入校验、哈希和重复账号 409 行为。默认非本验收路径不获得该能力；不加邀请、重置密码、登录、worker 或新发布框架，不回退到用 Web 直接写四表。原会话创建在注册提交后独立进行，保留用户已知的过期会话清理；这意味着会话失败时仍可能已有账号，遇 500 或超时仍不反复注册。 |

**审批清单与验收顺序：**

1. **已批准离线实现与隔离 PostgreSQL 回归。** [离线 SQL 模板](../ops/platform-web-database-role-v1/sandbox-registration-ddl.ts)只生成一条 `sandbox_registration.register_account` 的安装事务，不连接数据库，不内置真实邮箱摘要或挂进自动迁移。[普通注册调用点](../lib/auth/credentials.ts)复用现有服务器端 `alb-https-v1` 和准确 sandbox origin；函数调用失败不回退到直接写四表，其他环境、登录、邀请和会话处理不变。[隔离回归](../tests/sandbox-registration-postgres.test.mjs)使用合成身份和专用的一次性 PostgreSQL 库，覆盖四行原子成功、最后一条 INSERT 失败回滚、错误邮箱、重复、无额外角色参数、Web 直接写/冒用 definer 和 PUBLIC 调用被拒。只触发无 AWS 身份的 CI。
2. **实际安装和发布另批。** 仅对准确 Neon 目标、Web 登录/OID、有效权限/成员关系、四表约束/RLS、新对象名、安装角色的创建与转移所有权能力、默认授权及同一测试身份做一次限定 `READ ONLY` 前置（范围与凭据使用须确认，不读密码散列或其他用户正文）。隔离库能执行 DDL 不代表托管安装者具备相同权限或无自动成员关系；若无法满足清单、不保留意外 ACL/成员关系的条件，停止，不额外授权。若先前提交状态不明，先查目标身份是否存在；已存在不采用重试或改旧记录。实际 SQL 固定摘要后另批，一次原子 DDL 安装及独立目录回读，不发起注册验证。后续确切平台镜像和原闭控服务最小更新还要单独批准，不改 `DATABASE_URL`、IAM、平台登录/会话权限或其它栈；SQL 与发布非原子，任何未知结果不自动重放或清理。
3. **只读验证完成后再另批本人一次注册。** 只有函数/权限与平台代码都在实际运行中绑定且目标仍空，才让用户在原入口试一次；不购买、不创建部署任务。未知结果只查唯一派生 ID，不复制、删除或延用旧批准。

**离线验收通过，线上仍为 `NO_GO`。** 实现提交 `04e876b` 的[无 AWS CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44337547242)通过离线及 PostgreSQL 16 隔离回归。本机认证回归、TypeScript 和 scoped lint 也通过。[原机器审批清单](../ops/platform-web-database-role-v1/sandbox-registration-permissions.review.json)原样保留，没有生产安装 SHA 或线上授权。未联系 AWS/Neon、未读 Secret 值、未改线上权限或重试。下一个继续点仅为另审限定只读前置核对；首版 A、普通 worker 和 D2 运行路径不变。

<a id="first-onboarding-step4-registration-preflight"></a>

#### 第 4 步：普通注册限定只读前置核对（已准备、待审）

[待审范围](evidence/sandbox-registration-preflight.review.json)复用原平台 `:13` 恢复回执、W7m 固定 Secret 版本及 Web 角色历史 OID `196608`、原授权与隔离回归；这些是目标绑定和对照基线，不冒充实时状态。只针对原 sandbox 平台 Neon，不重复查询 AWS、ECS、CloudWatch 或 GitHub。

| 只读核对 | 必须确认 |
| --- | --- |
| Web 角色 | 核对 Web 登录/OID、成员关系、有效库和 schema 权限、角色默认及库级 `search_path`。`users` 的 `id`、`email` 可读（现有查重所需）；四表无直接 `INSERT`，不允许改管理员位，不扩大已有授权。保留原 `user_credentials` 的 6 列读、仅 `failed_attempts`、`locked_until`、`updated_at` 可更新，以及 `auth_sessions` 的既有权限；会话表只查权限元数据。有效权限包括直接、继承和 PUBLIC，不仅比对历史 GRANT 文本，不登录或切换到 Web 角色。 |
| 四表约束 | 只查 `public.users`、`public.workspaces`、`public.workspace_members`、`public.user_credentials` 的结构和必要目录依赖：29 个指定写入列及未显式写入列的默认值/空值兼容、PK/FK、邮箱和 `(workspace_id, user_id)` 唯一索引的有效性、其余检查约束、RLS、重写规则和非内部触发器。对照现有模板；未知差异停止，不改表、不绕过 RLS、不执行或读取触发器函数正文。 |
| 安装角色 | 从同一已知 owner 连接只读核对身份、建角色/建 schema、PL/pgSQL、四表列及 schema 转授权限、默认 ACL、角色/名称占用和可证明的所有权路径。**有 `CREATEROLE` 不等于能直接安装。** 在标准 PostgreSQL 16，非超级用户创建角色时的自动 `ADMIN` 授予不默认给 `SET`，且创建者不能自行撤掉这条自动授予；为另一角色创建 schema 又需要能切换到该角色。若只有这一条路径且不满足原清单的无额外成员关系要求，就记安装阻塞，不试跑 DDL、不提权、不切身份。[角色规则](https://www.postgresql.org/docs/16/role-attributes.html) · [schema 所有权规则](https://www.postgresql.org/docs/16/sql-createschema.html) |
| 唯一测试邮箱 | 待用户私下绑定上次尝试的一个邮箱。只有目标及 `public.users` 的查询安全性已确认，才允许一次参数化 `EXISTS`，按应用标准化邮箱及其派生用户 ID 分别返回布尔值，不读用户行正文。任一命中即停：已有身份不等于注册与会话成功，不重试、不认领、不修改、删除或换邮箱。 |

**上限与失败处理：** 实际操作另审。届时只读取 `.env.local`、指定旧私有目录回执和批准的单邮箱输入各一次，均只进入内存；使用回执的 SHA 与目标字段比对准确 host/port/database/actor 后，最多建立一条验证服务器证书和主机名的 TLS 连接，无备用端点/角色。一次 `REPEATABLE READ READ ONLY`，最多 13 条 SQL（`BEGIN`、3 条事务局部设置、7 条目录 SELECT、1 条条件 `EXISTS`、一次 `COMMIT` 或 `ROLLBACK`）；`statement_timeout=15s`、`lock_timeout=3s`。身份不明、权限或结构漂移、输入缺失、超时即停止或不开始，不自动重试；安装能力不足但 `users` 查询已确认安全时，仅可记录原清单内的查重结果，整体仍阻塞。只留去敏标志、原因码、计数和观测时间。owner 权限较宽、文件整体进内存、提供者日志可能记录查询或绑定参数；不保存/输出连接串、邮箱、其摘要、派生 ID 或原始应答。只有全部匹配且两项查重均 `false`，才可用观测后不足 5 小时的新事实准备另一份安装审批。

**本轮无线上操作。** 未绑定邮箱、未开执行窗口、未读任何私有输入、未连库；未安装权限、未更新平台或重试注册。此清单只供另审读取，本身不授权执行，也不复用旧审批或复位槽位。

<a id="first-onboarding-step4-registration-preflight-followup"></a>

#### 只读核对接续：`search_path` 校验已离线修复，待审

原单次核对已停止，原脚本和回执保留，不重放。已在独立修正版中仅排除重复计入覆盖检查的 Web 角色默认设置；默认值仍必须匹配，数据库级以及角色/数据库组合的真实覆盖仍会阻断。两项最小离线回归通过；未读取邮箱或数据库配置，未连接 Neon。

接续清单已保存在本机私有目录，绑定原只读范围、修正版和独立结果文件。仍限各一次准确私有输入读取、一条验证 TLS 的 Neon 只读连接、最多 13 条 SQL；四表约束、安装角色能力和邮箱存在性仍待核对。实际连接另审，不安装权限、不更新平台、不重试注册。

<a id="first-onboarding-step4-registration-install-review"></a>

#### 普通注册安装审批：专用角色拥有对象，创建者仅保留系统自动授予的 ADMIN

[新版待审清单](evidence/sandbox-registration-install-pg18.review.json)复用已完成的 PostgreSQL 18 只读接续回执。原 Web 有效权限、四表结构与保护均匹配；安装者是原非超级用户 owner，具 `CREATEROLE`、建 schema 和 29 列转授能力；新名称空闲，单一测试身份未命中。原阻塞是没有证明可以按旧要求转移所有权且不留下成员关系，而不是需要放宽 Web 权限。快照于 **2026-11-18 09:51:53.991（温尼伯 CST）** 取得，原五小时有效期截至 **14:51:53.991 CST / 20:51:53.991 UTC**，不重计、不重复盘点。

| 对象或角色 | 待审的准确结果 |
| --- | --- |
| `sandbox_registration` schema 和唯一 `register_account(text,text,text,text)` | 都归专用 `techlong_sandbox_registration_definer`。schema 创建时直接指定 owner；函数以该角色创建，不再由安装者建完后转移。专用角色 `NOLOGIN / NOINHERIT / NOBYPASSRLS`，不拥有业务表；只拿 `public` 的 USAGE 和原定 29 列 INSERT。函数逻辑、固定 `search_path` 和四条原子写入不变。 |
| 安装者 | 仅在同一安装事务中显式自授 `SET=true, INHERIT=false, ADMIN=false` 的临时记录；建完对象并配置 ACL 后恢复 `SESSION_USER`，按 `GRANTED BY CURRENT_USER RESTRICT` 只撤这条自授记录。提交后只能留下 **bootstrap 超级用户自动授予创建者的一条 `ADMIN=true, SET=false, INHERIT=false`**。安装者不能直接切换到或继承 definer，但仍能用 `ADMIN` 再授成员权限，这是真实的长期管理权，需明确接受。参考 [PostgreSQL 18 创建者权限](https://www.postgresql.org/docs/18/role-attributes.html)及工程内[已验证的非超级用户建对象模式](../ops/releases/README.md)。该历史回归不是本候选在 Neon 上的执行证明。 |
| Web 和 PUBLIC | Web 仍只得到原拟议的**新 schema USAGE＋单函数 EXECUTE**，不扩至直接表写、CREATE、可转授权限或 definer 成员关系。PUBLIC 不得访问新 schema 或调用函数。不变更任何既有登录、会话或普通 worker 权限。 |

**未来实际安装限额（尚未批准）：** 复用同一配置、封存目标回执、已完成只读回执及同一测试邮箱文件，各最多读取一次。邮箱地址留在本机，获批后才用原算法在内存派生摘要以生成同一函数正文；上一轮回执故意不保留邮箱指纹，要求确认文件自核对后未改、修改时间不得更新，不把这当成回溯性的密码学证明。函数元数据或提供者日志可能暴露可猜测的邮箱摘要；它不用于验证邮箱归属，也不进 Git。使用至多两条验证 TLS 的连接：先一次安装事务（最多 24 条 SQL，含最多 14 条 DDL/授权），提交前核对目标、最终所有权和准确权限差异；只在收到明确提交确认后，再用独立只读连接/事务回读（最多 6 条 SQL）。核对只针对本次安装及原 Web 权限边界，不重跑现状盘点或邮箱查询，不调用注册函数。提交前不符即回滚，提交结果不明停止、不重试或清理。过期或时间不足不执行。

**本轮只编制方案和清单。** 未读取邮箱或配置、未重新核对或连库、未生成含真实身份的 SQL、未安装、未更新平台或重试注册。下一步仅另审这一份安装范围及剩余事实时限；平台更新与本人注册均不在本清单内。

<a id="first-onboarding-step4-registration-install-observed"></a>

#### 数据库安装已提交并独立回读；平台尚未更新

**`REGISTRATION_FUNCTION_INSTALLED_AND_INDEPENDENTLY_VERIFIED`｜2026-11-18 09:59:30.777 温尼伯 CST。** 按用户批准的 `e32b5b85…` 一次安装，收到明确提交确认；另一条验证 TLS 的只读连接回读与事务内核对一致。新 schema 和唯一函数均归专用 `NOLOGIN` definer；definer 只有原定 29 列 INSERT 和必要 schema USAGE；临时自授 SET 记录已撤掉，创建者只留系统自动的 ADMIN（SET/INHERIT 均关闭），Web 仅新增新 schema USAGE 和单函数 EXECUTE，无新增直接表写权限，PUBLIC 无新对象访问权。

本机私有去敏回执 `sandbox-registration-pg18-install-e32b5b85.result.json`，文件 SHA-256 `0aaaa43569204d55a8225598853d90c4c86a8176286f9bc2e31ad00b97eeeec2`；实际 2 条 TLS 连接，安装 SQL 24、独立只读 SQL 6、DDL/授权 14，业务读写、函数调用、AWS 更新、平台更新和注册均 0。已消费安装次数，不复用清单或重跑。**下一步只准备原平台闭控服务的最小版本更新审批材料，不执行更新；平台和函数均验证后才另审本人一次注册。**

<a id="first-onboarding-step4-registration-platform-update-review"></a>

#### 原闭控平台的最小版本更新：离线待审，尚无候选镜像

[离线审批材料](evidence/sandbox-registration-platform-update.prepared.json)仅针对原 `ca-central-1` 平台栈 UUID `c4bf36b0…` 和原 ECS `techlong-sandbox-platform-web`。复用已确认的数据库安装，不重新连库。用原模板与历史 `DesiredCount=1` 重建的模板摘要，与最近恢复回执一致；历史任务 `:13`、旧镜像、原 `DATABASE_URL` 固定 Secret 版本、原 ALB/443 和 console Alias 仅作比对，不当作当前在线状态。

**最小候选不是 `main` 全量镜像。** 旧镜像的真实构建来源是 `5fcbc23c…`，不同于已关闭控制器的 `ExecutionSource` 标记 `d098cfef…`。把整份注册修复提交 `04e876b…` 构建上线，会带入 D2 及首开任务路径等其他代码。只允许在旧镜像源码上叠加该提交的 `lib/auth/credentials.ts` 和 `lib/auth/sandbox-registration.ts` 两份固定字节文件；其余源码、Dockerfile、依赖锁和运行策略不变。隔离 PostgreSQL 回归证明的是注册函数和调用逻辑，不是这个候选镜像。现有候选工作流打包 `HEAD`，旧发布入口固定历史产物；若需最小接线才能携带合成来源的真实证明，应另审，不把复合来源冒填为单个提交，不改已有门禁或复用旧批准。

1. **先证明候选，再发布。** 另审一次固定两文件范围、无 AWS 身份的 GitHub 云构建；核对源码闭包、原启动方式、禁网匿名自检和安全扫描，封存原产物及 config digest。产物具备后才另审最少的精确 GitHub/AWS 读取和保护发布；由用户批准准确的 GitHub environment。只允许同一既有 ECR 仓库的单次发布；若需临时发布授权，成功或失败后立即按另批方案撤权、独立证明 Locked，不能夹带 ECS 更新。
2. **只在同栈换镜像。** 新不可变 registry manifest digest 完成独立核验后，才另审一轮 **STS 1＋最多 12 项准确元数据读取**（原栈/服务、任务定义和任务、目标健康、原/新镜像、固定 Secret 版本元数据、console Alias）。上线在原 CloudFormation 栈按原模板做 `UPDATE`；资源属性唯一改动是 `TaskDefinition` 中 `web.Image`。仅同步两个顶层镜像溯源元数据，不改控制器关联来源。先另批仅创建、不执行 Change Set；只接受 `TaskDefinition` 替换为新修订、同一 `Service` 不替换但引用新修订，其他九项资源物理 ID 不变，无新增、删除或导入。`DesiredCount=1`、角色、网络、DNS、Secret 引用和原启动命令不改，控制器、请求入口、worker、apply 继续关闭，租约为空。
3. **执行和独立核验仍另审。** 只执行上一步独立验真的同一 Change Set 一次，允许 CloudFormation 托管回滚，不直接更新 ECS 或自动补救。确认完成后只验同一栈、准确任务摘要和 1/1/0、目标健康、DNS 及闭控，可另批最多两次匿名 GET（`/api/health`、普通注册页），不提交表单或登录。原滚动配置可能短时中断；任务启动会由 ECS 注入原固定 Secret，可能产生存储、任务和流量费用。遇漂移、过期、未知提交或计划不符即停；不把这次更新变成恢复、续期或清理操作。

**当前 `NO_GO`。** 尚无两文件候选的构建证据、ECR 新摘要或实际 Change Set，不签出执行 SHA。本轮没有新 AWS/GitHub 事实读取、构建、镜像发布、连库、平台写入或注册。下一步只等另审两文件候选的无 AWS 构建范围；暂不刷新云端状态，不重复数据库核对。

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
