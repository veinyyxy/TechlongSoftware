# 临时 AWS 测试环境启停工具

2026-11-08，v2代码改造。仅用于本项目测试环境，正式上线后移除；不是新部署框架或全账号清空工具。**代码及合成测试完成，不等于真实云启停已验证。** 本轮未调用AWS/数据库、未读取凭据/Secret值/PEM/.env；现有环境及费用未因代码提交而改变。

<a id="cfn-lifecycle-implementation"></a>

## 当前实现与范围

沿用 `node scripts/aws-environment.mjs`，临时实现隔离在 `ops/temporary-idle/environment*.mjs`，正式应用、worker、Janitor不导入它。CFN所属资源只经原栈的受审UPDATE Change Set操作；不直接调用ELB创建/删除、ECS UpdateService，不DeleteStack，不扩IAM或更新镜像。

| 所属栈 | stop | start |
| --- | --- | --- |
| 租户，7项 | 先CFN声明任务0并核对0/0/0，再移除Service与三规则，保留任务定义、目标组、日志3项 | 原栈Add回Service与三规则；监听器参数来自同一Cell真实输出，先任务0、最后CFN改到配置副本数 |
| 平台，11项 | 先CFN归零，再移除Service、ALB、443监听器与console DNS，保留其余7项 | 原栈恢复这些资源，console Alias由模板GetAtt派生；始终关闭部署控制器，最后CFN恢复副本 |
| Cell，16项 | 租户依赖移除后，只移除ALB、两监听器和共享拒绝规则，保留网络/集群等12项 | 原栈Add回四项，从实际输出/物理绑定核对443/8443、mTLS及租户引用 |
| 两个独立数据库 | 仅停止Aurora `techlong-sandbox-express-d001`、RDS `speedfeast-postgres-prod`，核对不可变resource ID，不删库/数据 | 整套测试环境启动会启动这两个准确数据库，即使某库在本轮stop前已经停止；不沿用旧“只恢复原运行库”的隐含语义 |
| 独立API Alias | 保留 `first-acceptance.sandbox.techlong.cloud.`，停用时不可达属预期 | 只核对并更新该外部记录的准确ALB目标；保留健康评估/dualstack等字段，不直接写CFN所属console记录 |

不删整栈，不删除VPC/子网/安全组、目标组、任务定义、日志、镜像、静态买家站或Secret。当前配置没有NAT/端点/EIP清理列表，v2不接受网络清理参数或扫描全区后自动纳入。发现外部伸缩、额外服务/监听器/规则或指定检查项的漂移会拒绝；不宣称全属性漂移扫描。已停止服务对象会经CFN删除再创建，这是本方案避免悬空监听依赖的受审范围，不是只做旧版直接缩容。

## 固定入口：离线默认，规划与执行分开

Node.js 22.13+、AWS CLI v2，入口无需Docker。以下默认命令都只预览，不取凭据、不调用AWS、不创建状态目录：

```powershell
node scripts/aws-environment.mjs status
node scripts/aws-environment.mjs stop
node scripts/aws-environment.mjs start
node scripts/aws-environment.mjs --help
```

配置例子：`ops/temporary-idle/environment-cfn.example.json`；本机同名 `environment-cfn.local.json` 已准备为 **enabled:false、acknowledgeRoleScopeReview:false**，Git忽略。它只绑定已存基线的三栈UUID、模板SHA及准确两个数据库，不是新鲜云事实。不读取/覆盖旧v1 local配置或备份。默认新私有根 `F:/ChatGPT_workshop/aws-environment-cfn-state`；旧 `aws-environment-state` 不接受为v2状态根。

未来用户另允实际只读准备后，核对配置并启用，按同一固定入口生成**只读云准备＋本地私有计划**：

```powershell
# --execute在plan-*模式只允许只读AWS API，不执行Change Set
node scripts/aws-environment.mjs plan-stop --execute --confirm-account 402010193138
# 用户审核输出的planId、完整planSha256、私有计划内阶段/风险后：
node scripts/aws-environment.mjs stop --execute --confirm-account 402010193138 --plan <planId> --approved-plan-sha <planSha256>

# 恢复前，先另审现有角色是否覆盖将重建的监听器/规则ARN，完成后确认该review标志并重新准备：
node scripts/aws-environment.mjs plan-start --execute --confirm-account 402010193138
node scripts/aws-environment.mjs start --execute --confirm-account 402010193138 --plan <planId> --approved-plan-sha <planSha256>
```

这些命令是使用说明，不是本轮执行许可。计划以实际读取完成时为准，有效5小时；每次写前核对完整SHA、配置范围、原UUID/模板/物理绑定/参数摘要和实际服务等，不改变旧事实/资源租约或自动延长。计划捕获真实模板、标签、ARN等，含可能敏感的环境配置和引用，只保存到私有ACL目录；不提交GitHub、不输出模板/参数正文或原始提供者异常。未调用GetSecretValue、私钥读取或SQL，但云启动后的正常任务会读取既有固定Secret引用并连接数据库。

一次整轮批准覆盖受限阶段和新输出的固定派生规则，不为每个子Change Set重新等聊天。计划也绑定实际执行代码闭包SHA，代码改动后拒绝旧计划。stop最多5组CFN创建/执行＋两次RDS写，start最多7组CFN创建/执行＋两次RDS写＋一次外部API Alias写；实际无变化阶段跳过。按等待上限派生保守读取预算，执行时计数封顶，不把轮询当无上限读取。子计划仍逐项核对仅四项Add/Remove或Service DesiredCount变化，候选全文/旧角色/原标签/其余参数一致、无嵌套/导入/IAM；未知额外变化阻断。CFN按原API支持创建/审查后执行变更集。[CreateChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)。不自动切REVERT_DRIFT来接纳缺失实体；发生额外漂移就停止，另审。

## 角色权限与首次接入

`acknowledgeRoleScopeReview`是操作者已完成恢复权限审查的确认，**不是权限证明或授权扩展**。默认false会在start执行前拒绝，包括尚未进行云预检时；读权限、CFN角色是否能操作新ARN须真实使用前另审。若现有租户执行策略绑定旧监听器，必须先单独审核必要的权限布局，工具不能自行更新policy或换用更大角色绕过。确认标志不计入持久资源范围hash，允许保留原stop备份；但它进入新计划风险，标志后来改为true也不能复用旧待审start计划。

第一次只接受配置SHA匹配的完整三栈，并检查归属；可识别已记录的租户声明1/实际0这一准确初始例外。stop先通过CFN改为声明0；首次start也先对齐0再通过CFN改到运行副本，不能把旧声明1的无变化更新冒充已启动。其他计数/任务引用/目标组/网络或跨栈参数差异拒绝。后续停用模板只能用本工具保存的真实完整模板恢复，不以历史ARN/同名资源认领。版本更新后模板或栈UUID改变时应按新范围重新接入，不自动“接受新基线”。

## 周期、等待与失败

私有根仅允许当前用户/SYSTEM/Administrators，拒绝链接及仓库/磁盘/用户根路径，单进程锁。计划/attempt目录不可覆盖：

```text
aws-environment-cfn-state/
  snapshot.json + journal.json      配置范围、最后完成周期、待核对指针
  plan-<UUID>/
    snapshot.json + journal.json    不可变计划、SHA及状态
    attempt/
      snapshot.json + journal.json  写前备份、每步意图、准确CS ARN、独立回读
```

不同stop/start各有新计划及单次attempt；重复旧SHA/父周期或已有attempt拒绝，不自动重放。新的已批准同态计划只核对、不重复云写。凭据或fresh预检失败保留失败计划，不消费后续写入；失败后的重新准备也需当次授权，不能删attempt或旧锁。写前意图持久化失败则不提交；提交不明保存UNKNOWN_OR_REJECTED，不因token幂等而重发。

停用：归零租户/平台 → CFN移除租户依赖 → 平台边缘 → Cell边缘 → 两数据库停止。启动：必要的初始计数对齐 → 两数据库available → Cell/平台0任务恢复 → 取真实Cell输出恢复租户 → 准确外部API Alias → CFN启动两Service → 归属/输出/计数/目标健康回读。不登录/下单/付款/推送/打印，不代替用户业务验收。

默认每阶段只读等待最多1800秒，可 `--wait-seconds 1..7200`；整轮可能更久，这不是资源到期或后台任务。CFN阶段向stderr输出去敏阶段/栈状态，stdout保留最终JSON。超时不会取消AWS操作，也不证明失败；工具不追加写/主动回滚/补齐/清理。CFN的正常失败回滚明确为DisableRollback=false，可能部分恢复或失败、遗留收费资源；Execute也可能使同栈其他变更集失效/被删除，旧本地证据保留。[ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。

失败后 `status --execute --confirm-account ...` 只读显示待核对计划、已完成阶段/提交状态及准确三栈状态，不因为中间模板不同而偷偷恢复或续跑。未决指针阻断新规划/执行；需独立核对后另定处置，不通过清锁复位。工具不会安装过期扫描器、清理任务或续租。

## 费用、隔离与已验证程度

停止不是全账号零费用：存储、备份、日志、ECR、Secret、CDN/DNS等仍可能收费；公开RDS实例的保留IPv4也可能继续计费。RDS及Aurora停止约7天后会自动重启，本工具不安装自动再停机制。[RDS停止与费用](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)，[Aurora停止限制](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-cluster-stop-start.html)。没有月费用硬上限或自动停机，部分失败资源仍可能收费。

143项本地合成/文件回归通过，含完整stop→start→stop、CFN归属/新输出/Service一致性、原基线68项、旧入口阻断、错误SHA/过期/并发外改、未知提交/失败/超时不重放、Windows私有ACL及无AWS默认预览。定向lint、TypeScript及语法检查通过。新增 `aws-environment-cfn.yml` 只读代码、无AWS/OIDC身份、无environment、无真实云执行的CI；远端结论以对应commit运行结果为准，不由本地通过推导。

**尚未证明：真实账号stop→start→stop、现有角色覆盖新ARN、当前资源/费用状态。** 本轮没有生成新实际云计划或启停环境。真实操作前先按当前唯一继续点另批必要只读及准确整轮SHA，不复用历史批准。旧 `aws-cost-*` / `aws-temporary-idle` 的CFN所属ALB/ECS/网络路径已阻断，旧CFN备份不能借drift acknowledgement重建；这些独立工具只保留其非CFN明确目标行为。

正式上线移除本临时入口、`environment*.mjs`和配置/调用及对应临时CI；正式CFN模板/资源归属基线保留，私有备份按安全策略归档，正式业务无需导入临时层。

<a id="future-lifecycle-principle"></a>

## 已落实为v2的原始改造原则

**CloudFormation管理的资源，创建、删除、恢复均经CloudFormation；临时工具只编排，不成为第二个资源创建者。** 数据库独立保留/停启；ECS声明与实际一致；恢复完整的实际输出—租户参数/规则—DNS引用链；临时隔离、失败不重放、真实云副作用另审。2026-11-07原记录与旧v1限制保留在下方历史，不再将“仅记录、未实施”当当前代码状态。

<details>
<summary>历史v1全文及当时未实施的原则（仅追溯，不执行）</summary>

# 临时 AWS 测试环境启停工具

2026-11-06。用户要求把已有节约费用代码固化为工具，之后直接调用，不再反复写恢复脚本。本工具只服务原项目测试环境；**不是全账号清空工具，也不是新的自动部署框架**。默认关闭、手动调用，正式上线后整体移除。交付本工具不代表执行启停；本轮没有 AWS/数据库/凭据调用，原已恢复环境未因此改变。

**2026-11-07补充：** 用户已确认[后续改造原则](#legacy-future-lifecycle-principle)，留待以后明确要求修改临时工具时采用；本次只记文档，不修改工具或模板、不操作AWS，也不替换当前三规则修复继续点。下文现有`stop/start`实现仍会直接删除/重建ALB并造成CFN漂移，不能因新增原则而认为问题已经修复。

## 固定入口

在 `E:/NodejsProject/TechlongSoftware` 运行，Node.js 22.13+、AWS CLI v2；使用原 Source profile 和现有权限，不会自动新增 IAM。

```powershell
# 默认都是离线预览：不会获取凭据、调用 AWS 或创建状态目录
node scripts/aws-environment.mjs status
node scripts/aws-environment.mjs stop
node scripts/aws-environment.mjs start

# 真实状态核对（AWS 只读）
node scripts/aws-environment.mjs status --execute --confirm-account 402010193138

# 停止原测试环境
node scripts/aws-environment.mjs stop --execute --confirm-account 402010193138

# 恢复本工具上次停止的环境
node scripts/aws-environment.mjs start --execute --confirm-account 402010193138
```

首次配置一次即可：本机已准备 `ops/temporary-idle/environment.local.json`，默认 `enabled:false`，真正使用前改为 `true` 并核对范围。此文件已被 Git 忽略，不含密码或 Secret 值。其他机器从 `environment.example.json` 复制，修改 AWS CLI 路径、身份和私有状态目录即可；可用 `--config <文件>` 覆盖默认路径。`--help` 无需配置文件。不要把凭据写入配置，也不要用内联 AWS Access Key/Session Token 环境变量运行。

后续用户说“启动环境/停止环境”，执行方应调用这一个入口；仅在实际凭据失败时要求 `aws login --profile techlong-sandbox-user`。不需要重新手写脚本、改 ALB ARN 或重新导入测试数据。**本次代码交付不是未来任意资源操作的永久授权**，仍按用户当次明确启停要求调用；扩容、其他区域、新 IAM、删库或不同资源范围另行确认。

## 当前固定范围

账号 `402010193138`，区域 `ca-central-1`，准确 Source IAM 用户 `techlong-sandbox-dev`。

| 对象 | stop | start |
| --- | --- | --- |
| 平台 `techlong-sandbox-platform-web`、租户 `tenant-9c5ee9e64509dcad-ecs-service` | 保存任务定义/副本数；暂停既有服务伸缩；desired=0，等待无任务 | 检查原服务/任务定义/目标组未变，恢复原副本数和伸缩；平台控制器必须保持关闭 |
| Aurora `techlong-sandbox-express-d001` | 暂停，不删除 | 同一 resource ID，恢复原先运行的库，等待 available |
| RDS `speedfeast-postgres-prod` | 暂停，不删除（名称带 prod，属于用户已选的测试启停范围） | 同上；不访问或迁移数据 |
| 两台 ALB `techlong-sandbox-cell-sandbox-1`、`techlong-sandbox-platform` | 按名称+VPC+所有权标签查找，完整备份监听器/规则/证书引用/属性/标签后删除 | 重建原配置，记录新 ARN/DNS；不创建新证书、不读密钥 |
| 两条准确 A Alias：`console.sandbox.techlong.cloud`、`first-acceptance.sandbox.techlong.cloud` | 保存，不删除（停用时域名不可用是预期） | 核对未被外部修改后指向新 ALB；保留 dualstack、健康评估等字段，等待 INSYNC |
| 原显式选择的收费网络（NAT、接口端点、独立 EIP） | 复用原临时工具的所有权/依赖检查与备份后删除 | 先恢复必要网络，再启数据库/ALB/ECS；闲置独立 EIP 不为“闲置”重新分配 |

当前配置的收费网络三列表均为空，不扫描全区域、不会误删默认 VPC，也不自动纳入后来增加的资源。VPC/子网/路由骨架/安全组、目标组、ECS 集群/任务定义/服务对象、数据库数据、ECR 镜像、S3、CloudFront、Secrets 保留。ECS 服务对象保留，故下一次只是从0恢复任务，不重建七资源租户栈。**如果有人另外删了服务、目标组、栈或 VPC，工具会停止，不会擅自绕过部署流程新建。** 已有静态买家站不需要“启动”。

## 备份、顺序和失败处理

默认私有根 `F:/ChatGPT_workshop/aws-environment-state`，不能设为仓库/磁盘根/用户根等宽泛路径。工具创建仅当前用户、SYSTEM、Administrators 可访问的目录；拒绝链接，使用单进程锁。

```text
aws-environment-state/
  snapshot.json + journal.json        配置摘要、当前周期指针
  cycle-<时间>-<随机值>/
    snapshot.json + journal.json      整轮 ALB/DNS 预检与阶段结果
    idle/                            ECS/伸缩/网络原状、执行日志
    power/                           RDS/ALB 完整恢复材料、新 ARN 映射
```

每次成功 `start` 后再次 `stop`，自动创建新的独立周期；旧备份不覆盖，新 ARN 自动捕获。保留整个私有根，不只保存最后一份 JSON；材料含资源元数据及可能敏感的规则配置，不提交 GitHub。冻结配置绑定周期，期间改配置会拒绝执行；有意改变范围时须独立审核及新私有根，不能编辑备份绕过检查。未来若手动扩展 NAT/端点等并产生新 ID，须核对新的显式配置，不会扫描认领。

停用顺序：准确身份/目标预检与完整 ALB/DNS 备份 → ECS 原状备份/缩容为0 → 两数据库停止及 ALB 删除并核验 → 收费网络回收。恢复顺序：原服务/控制器/别名检查 → 网络 → 数据库与 ALB/监听规则 → 两别名 → ECS → 目标组健康。只核对基础设施，不登录/下单/支付/推送/打印，不替代用户店铺菜单验收。

默认每个等待阶段最多1800秒（可 `--wait-seconds`，1–7200用于启动，停止允许0），是**本机只读轮询上限，不是资源过期时间**，整个工具可能运行更久。不会设置后台计划、自动停机、自动清理或续租。

已停/已启重复命令只做核对，不重放已成功写入。写失败、回执不明、外部变更、进程中断、健康超时均留档停止；不自动重试、回滚、补齐或删除新资源。`*_FAILED_INSPECT`/`STARTING`/`STOPPING` 或残留锁时，先核对私有 journal 和真实状态，**不要重新运行旧脚本、删备份/复位阶段**。若身份核验在周期开始前失败，未打开新尝试，可刷新身份后重新发起命令。已停库被 AWS 自动启动时，会报告状态变化，不擅自重写原恢复备份。

退出码：0为完成/已同态或离线预览；1为拒绝/失败需核对；2为未完全停止（如公网IP残留）或状态混合。`RUNNING` 仅基础设施计数/ALB/DNS就绪，`ENVIRONMENT_STARTED`还等待目标健康，不代表产品验收通过。

## 费用与暂时性边界

- 不保证全账号零费用：数据库存储/备份、ECR、Secret、S3、DNS/CloudFront和日志等仍可能计费；停止中的RDS也可能被AWS在约7天后自动启动。本工具不安装周期性再停任务，长时间停用后请重新核对。
- 直接删除/重建 ALB 会产生 CloudFormation 物理ID/输出漂移。工具只修复上述准确DNS及原目标组/服务绑定，不执行 CFN/修改 IAM。下次正式部署前独立对齐，不能直接拿旧模板引用更新。这是已接受临时方案的限制，不声称无漂移。
- 保留原手动停止/恢复工具及历史备份；新入口组合它们，不修改旧事实、固定槽或部署授权，不自动启动部署控制器。
- 正式上线移除 `scripts/aws-environment.mjs`、`ops/temporary-idle/environment*.mjs`及配置/调用；私有备份按安全归档策略保存。应用、worker、Janitor、正式部署没有导入此入口，停用不需改产品代码。

<a id="legacy-future-lifecycle-principle"></a>

## 用户确认的后续改造原则（2026-11-07，仅记录，未实施）

**CloudFormation管理的资源，创建、删除、恢复都经由CloudFormation；临时工具只负责编排，不再成为第二个资源创建者。**

这条原则用于未来用户明确要求修改临时启停工具时约束实现，不是现在的改造任务、云读取或写入授权。用户仍需停费时，不能为了维护基线而要求收费环境一直运行；也不能只修三规则，却继续让旧工具在每次停费/恢复时制造新的漂移。

- **统一资源归属：** 对CFN已管理的ALB、监听器、规则等，由所属栈的受审创建/更新/删除流程负责实际资源生命周期；临时层不再直接调用ELB创建/删除这些对象，也不能只保存新旧ARN映射便宣称归属恢复。不能把这条原则理解为不分依赖地删除整栈。
- **数据库独立保留：** 数据库及数据继续在准确独立范围内保留，只停止/启动，不随测试资源清理而删库；不因本原则迁移数据、重建数据库或扩大所选目标。
- **ECS状态一致：** 运行/停用状态必须纳入统一受审流程，使模板中的期望副本数与实际状态相符；不能再长期留下模板声明1、实际0，却默认后续更新不会协调服务或启动任务。具体采用何种参数/模板调整，须未来按最小方案核对，不预先承诺新增开关或拆栈。
- **恢复完整引用链：** 从所属栈的真实输出取得新物理ID，按实际依赖同步租户监听器参数/规则及准确DNS；先验证CFN管理记录与实际绑定一致，再判断基础设施恢复完成。域名可访问、同名资源、备份映射或日志中的完成标记，都不能替代归属核验。
- **保持临时隔离：** 复用现有入口及正式资源管理流程，不再新建一套资源创建者、通用恢复框架或业务运行时依赖。停费编排保持可移除，正式上线后移除；正式模板和资源归属基线保留。
- **未来验证门槛：** 改造时覆盖stop→start→stop及失败/提交不明路径，检查资源归属、实际输出、引用和ECS期望状态；不把合成测试通过称为云端启停已验证。新云读取、模板/权限变更、真实启停仍按准确范围另审，不重放旧批准或复位旧槽。

本次记录不选择具体实施路径、不生成新执行清单、不启用自动到期/自动停机、不更改凭据或业务状态。当前唯一主线继续点仍以[执行手册顶部](aws-auto-deployment-execution-runbook.md)为准。

## 本轮验证

使用合成 AWS 响应及本地临时文件，不访问真实账号：68项测试通过，覆盖完整 stop→start→stop、新 ARN/DNS、重复调用、私有文件周期、原两工具回归、准确身份/资源ID/标签/平台控制器检查、失败不重放与无AWS默认预览。ALB回归还覆盖 TypedConfig/Values双表示、空Transforms、空日志字段仅差异回填；Route53使用全球 endpoint 与 us-east-1 签名区域。定向 ESLint、TypeScript 检查及入口语法检查通过；真实环境未执行第二轮启停。

```powershell
node --test --test-timeout=30000 tests/aws-environment.test.mjs tests/aws-resource-power.test.mjs tests/temporary-idle.test.mjs
```

</details>
