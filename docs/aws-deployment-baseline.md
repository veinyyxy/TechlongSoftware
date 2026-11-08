# 既有租户版本更新：三栈资源基线

初版 2026-11-06；状态整理 2026-11-07。账号 402010193138 / ca-central-1。这里的“正式基线”指后续发布所遵守的**声明归属**，不是新生产环境、可执行部署包或云操作授权。初版仅离线整理；后来的 A1/A2、IAM 修正和租户 B 均是用户另行批准的独立修复范围，不能由追加的文档反向授权。

本页分开记录当前状态、长期归属和历史阶段；只有下一节定义当前继续点。历史段落、旧审批 SHA、旧期限及机器清单中的准备状态均不构成新许可。已验证的现有 sandbox 不等于任意租户。买家商品列表、登录、查看订单及卖家端所测功能由用户确认正常，不列为工程待测项。

<a id="current-state"></a>

## 当前状态与唯一继续点

**最新：平台最小停用收敛候选已离线完成，尚未云修复。** [同11个逻辑ID、原生CFN漂移感知方案](#platform-idle-convergence)已备齐。此前平台归属另批只读于00:14:08.034Z完成，实际STS1/元数据17/云写0；[完整11项表及证据](#platform-ownership-observed)。前一阶段Cell—租户—API Alias引用链已对齐并收口：用户明确确认0e2ad8ca…清单后，仅提交一次准确API A Alias UPSERT，并于21:37:50.709Z由另一进程独立核验通过。[实际结果](../ops/deployment-baseline/tenant-api-alias-updated-20261107.json)：变更/change/C006498723VT6A7LZFY4W为INSYNC，准确Alias指向当前729e Cell ALB，差异0。该阶段实际STS2/元数据11/DNS写1，其他直接写0；更新槽1/批准已消费，不重放。

| 对象 | 最新已存事实与边界 |
| --- | --- |
| Cell与租户三规则 | 21:09独立验收UPDATE_COMPLETE/EXECUTE_COMPLETE、DisableRollback=false、三个729e新规则归属/条件/动作/优先级正确，四保留ID/18参数元数据/角色/标签/输出及当时服务0/:12保持 |
| API A Alias | 21:37独立读回已指向当前1581133878，准确change ID为INSYNC；只改目标DNSName，其他字段保持，0e2…批准已消费 |
| 服务与证明边界 | DNS阶段未查或启动服务；最后服务观察为21:09的0/0/0/:12。没有公网解析/缓存、API健康或产品测试证明，ALB仍可能收费，未新增自动停止 |
| 平台及停用漂移 | 00:14另批核对：9实体在、ALB/443监听器缺失；console Alias仍旧目标，Service引用:12/0而CFN记:11/声明1。临时工具未改，不能称三个栈全部无漂移 |

只改AliasTarget.DNSName为当前1581133878，名称/类型/所属zone/目标zone/EvaluateTargetHealth=false保持。三规则归属在21:09已独立验收，本次DNS又独立匹配，组成特定Cell—租户—API Alias引用链的收口证据，不是同一时刻原子快照。最后服务观察仍为21:09的0/0/0/:12，本阶段没有重查或启动服务；INSYNC不证明公网缓存、API健康或产品验收。ALB实际active、可能持续收费，没有新增自动停机或续租。

**本轮离线候选已完成，下一仅准备“创建但不执行”单份REVERT_DRIFT变更集的准确审批材料。** 采用已核对原模板的最小差异，保留控制器关闭/DesiredCount=0；先经另批创建并看实际三向差异，再单独批准执行及收费ALB恢复，不提前创建、Execute或启动任务。原只读批准及剩余预算已结束，不重复Cell/租户/API DNS、不升级镜像、改临时工具或重做业务测试，不扩执行框架。

60项本地检查及定向lint通过；新增三项只验证固定模板差异、安全停用和未授权边界，不是AWS模板验证或实际变更集证明。平台差异已盘清但未收敛，临时工具CFN统一编排原则仍留待未来；不能宣称三个栈全部无漂移或环境已运行。旧清单/事实时间/私有原件保持；本轮AWS/配置秘密/数据库/云写/执行槽均0，不重计旧00:13采样或延长其5小时终点。

<a id="platform-idle-convergence"></a>

### 平台最小停用收敛候选：同一栈、同11个逻辑ID

交付为[完整候选模板](../ops/deployment-baseline/platform-idle-convergence.template.json)、[精确差异及分段计划](../ops/deployment-baseline/platform-idle-convergence-offline-plan.json)和现有离线review模块中的`draftPlatformIdleConvergence`；没有新云执行器/CLI或临时启停工具接线。候选模板规范SHA为`47ae49231809b1cbe5859c0d5eebd4444c5795162a39ead51ba81964d557f3c1`；计划SHA为`86685d3e5a7600ac95ebf5de7590db2c65863509ae26f342dba2c1f6ad004746`，**都不是实际云执行批准**。

从已存11月1日Original完整正文派生，源SHA严格等于本次真实GetTemplate的24e4dba3…，不是重新调用早期默认渲染器。只改以下五个JSON路径，其余声明及11个逻辑ID不变：

| 路径 | 候选变化 |
| --- | --- |
| Description | 明确关闭控制器、停用状态及历史标签不续期，避免把旧描述当新租约 |
| Service.Properties.DesiredCount | 1→0，将当前停用意图写入CFN声明 |
| TaskDefinition容器.Command | 去掉--hosted-controller，其余启动入口保持 |
| TaskDefinition容器.Environment | controller enabled/hosted=false、lease空；其余现有环境项及顺序保持，worker/apply/request原开关仍false |
| TaskDefinition容器.Secrets | 去掉控制器数据库/私钥挂载，只保留原DATABASE_URL固定版本引用 |

镜像仍71e26893…，角色/CPU/内存/网络/目标组/证书引用、现有Service依赖及DNS的GetAtt表达式都保留。ControllerLease与HostingExpiresAt两个旧参数定义/标签和Metadata仍保留，未来用UsePreviousValue，不给旧租约续期；ControllerLease不再接入容器。Metadata只是历史版本溯源，不是本候选获批或已上线证明。

#### 最短CFN顺序及门禁

原生`DeploymentMode=REVERT_DRIFT`可比较实际、旧声明、新声明，并恢复栈外删除的资源；这是本候选选择原逻辑ID而不增加拆除/重建两轮的依据。[AWS发布说明](https://aws.amazon.com/about-aws/whats-new/2025/11/configuration-drift-enhanced-cloudformation-sets/)。

1. **另审仅创建**：对准确c4bf36b0…原栈提交一次UPDATE/REVERT_DRIFT候选，IncludeNestedStacks=false，旧两参数UsePreviousValue；不执行。CFN会自行读取资源进行三向比较，相关托管读取、敏感属性比较及本机回读须计入新批准范围，不能套用上轮19次预算。当前只存不完整请求片段，无新ChangeSetName、ClientToken或执行SHA。
2. **审查真实计划**：必须证明原LoadBalancer/HttpsListener缺失且将被CFN恢复，DnsRecord转向恢复后的ALB；TaskDefinition/Service仅闭控/停用及相应任务版本收敛。允许变化范围只含这五项，其他六项物理绑定必须保留；不得Import、改逻辑ID、增栈或夹带IAM/Cell/租户变化。不预先臆断缺失资源在API中一定显示Add；读完整属性/Drift/BeforeValueFrom及IgnoredProperties后判定。类型不支持、不可变漂移或未知额外变化就停止，不自动降为STANDARD或改走A1/A2。[官方限制与比较语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/drift-aware-change-sets.html)。
3. **执行另批**：只有实际计划通过后，才请求一次Execute及正常CFN回滚、托管清理旧任务版本和独立回读的准确批准。模板ContainerDefinitions变化可能生成新的CFN所属revision，不能预测一定是:13，也不直接认领:12；Service仍引用CFN TaskDefinition，DesiredCount=0。现有依赖使ALB→443监听器/目标组→Service、ALB→DNS由CFN编排。不得先按旧:11启动服务。

AWS公开支持表列出本平台所用资源类型的漂移检测能力，但不是本账号真实计划已经成功的证明。[类型支持表](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-import-supported-resources.html)。未来仍需必要的新鲜身份/栈/依赖/名称空位、权限和既有清理来源核对；本轮没有执行这些账号读取。原状态采样及05:13Z准备终点不重计，离线候选可以追溯保留，不能冒充执行时新事实。

#### 风险与失败策略（实际执行仍另批）

ECS=0不等于免费：未来执行会重建计费ALB及托管公网地址，不启动数据库/任务，也没有新增自动到期或停止机制，50USD/月不能保证。历史HostingExpiresAt标签仍过期；未来执行前必须核对既有清理来源，本候选不续标签或禁用清理。正常回滚拟DisableRollback=false，不能重复旧“替换更新＋禁用回滚”组合；这是待批失败策略，不是本轮自动回滚许可。官方描述漂移感知失败回到部署前实况，但部分完成、回滚失败和收费遗留仍可能发生；旧CFN所属:11可能被托管注销，额外:12不自动删除，详情须绑定真实计划和准确执行风险。未知提交/失败即保存现场并另审Inspect，不自动重试、补齐、手动回滚或清理。

本轮只读已存模板/去敏证据与公开官方文档；没有AWS账号调用、Secret值/PEM/.env/HMAC、数据库、GitHub运行读取、云验证/写入、新槽或调度。只在main提交离线材料；不改正式运行内核、旧基线指纹、历史回执或临时工具。本节是原基线的候选附表，不另建平行手册。

<a id="platform-ownership-observed"></a>

### 平台归属实际结果：9项实体仍在，2项缺失

用户另批cca2bc44…后，于**2026-11-08T00:13:41.732Z—00:14:08.034Z / 温尼伯11月7日18:13—18:14 CST**完成一次只读盘点。[机器结果与私有原件指纹](../ops/deployment-baseline/platform-ownership-observed-20261107.json)，状态`PLATFORM_OWNERSHIP_INSPECTED_WITH_DIFFERENCES`。实际**STS1＋元数据17、云写0**；未重试，未用的2次预算不再使用。准确c4bf36b0…栈仍UPDATE_COMPLETE，11项CFN记录完整，Original全文规范SHA仍24e4dba3…；这不证明实体齐全或无漂移。

| 逻辑资源 | CFN绑定与实际结果 |
| --- | --- |
| LoadBalancer | CFN仍记23610822b0ae5c30；准确平台名称及此ARN均LoadBalancerNotFound。不是当前仍有a33cd… ALB的证明 |
| HttpsListener | CFN仍记上述ALB下f5d6d689383d64c0；准确ARN返回ListenerNotFound。无实际443/TLS/转发配置可验收 |
| DnsRecord | console A Alias存在，EvaluateTargetHealth=true，仍指1535966359旧ALB DNS；因ALB缺失，不能验收到现存承载 |
| TargetGroup | b29a8b9e4f95f6dd实体及CFN绑定匹配，HTTP3000、/api/health；LoadBalancerArns为空，未查询目标健康 |
| Cluster | 原techlong-sandbox-platform实体及CFN标记匹配，running/pending均0 |
| Service | 原service ARN存在；desired/running/pending=0/0/0、目标组及任务SG/两子网引用保持。实际taskDefinition=:12，CFN绑定为:11；声明DesiredCount=1 |
| TaskDefinition | CFN记录的:11仍ACTIVE，含旧hosted-controller启动及控制库/私钥Secret引用；实际服务引用:12也ACTIVE、同一镜像71e26893…，控制器五项检查均false，仅挂DATABASE_URL引用。不能切回旧:11或按旧模板重新注入特权 |
| AlbSecurityGroup | sg-0f9770a8e90b139c2存在，准确栈/逻辑ID标签匹配；公网443入站、仅3000出站到任务SG |
| TaskSecurityGroup | sg-018de900b98bd3a35存在，准确栈/逻辑ID标签匹配；仅ALB SG的3000入站及443出站 |
| TaskIngress | 原sgr-009f70fee0c3b27c4存在，任务SG←ALB SG的TCP3000关系匹配 |
| LogGroup | 原/ecs/techlong-sandbox/platform-web存在，保留期7天；未读日志流/正文 |

**结论与最小后继：** 资源归属差异已明确，不再另开盘点分支。[保留关闭控制器/停用状态的候选及CFN顺序](#platform-idle-convergence)已离线完成；旧模板不能整体覆盖实际服务。实际创建/执行Change Set、恢复收费资源、改DNS/镜像或新权限均另审。当前没有实施修复，不能以本结果宣称正式三栈基线已全部收敛。

私有去敏原件在`.local-secrets/platform-ownership-read-cca2bc44-20261107-a`；公开JSON只含必要物理引用/状态/布尔判断及原件指纹，没有原始Environment/Command/参数值、Secret值、PEM/.env或业务正文。所有云写、数据库连接、Secret/PEM/.env读取、IAM/GitHub/HTTP/公网DNS、新执行槽及环境启动均0。非原子快照、无第二次独立采样或完整属性漂移检测；原读取草案不改写为可重放的批准。事实准备到2026-11-08T05:13:41.732Z（温尼伯11月7日23:13:41.732 CST），不延长旧事实/租约、也不是资源自动停机；未核清其他资源当前费用，不保证50USD硬上限。

<a id="platform-readonly-scope"></a>

### 平台归属：已执行只读范围与批准留档（不重放）

[机器清单](../ops/deployment-baseline/platform-ownership-read-scope.json)的规范JSON SHA-256：

`cca2bc4432b27e33913f8d50e681fddb274b1a07821941819f6dd10574a526ce`

以下保留原准备范围和风险；用户随后确认后已按顶部结果执行结束，不再等待或重放。机器草案的`PROPOSED_NOT_APPROVED/readAuthorized=false`保留准备时原文，实际批准和次数见结果JSON。目标为账号402010193138 / ca-central-1、原Source IAM用户及准确平台栈UUID `c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`；未按同名其他UUID扩查。

| 组别 | 最多次数及边界 |
| --- | --- |
| STS | 1，准确IAM用户ARN、UserId及账号 |
| CloudFormation | 3：准确栈DescribeStacks、GetTemplate Original、ListStackResources各1 |
| ELBv2 | 7：准确名称与不同旧CFN ARN的ALB/TG各最多2；现ALB监听器及不同旧CFN监听器最多2；四个以内已定位ALB/TG的标签批量1 |
| ECS | 4：准确Cluster/Service各1；CFN记录与服务引用的不同TaskDefinition最多2，不列任务或查网卡 |
| EC2/Logs | 3：两CFN SG及现ALB/Service所引SG最多四ID批量1；仅准确TaskIngress sgr-ID最多1；准确日志组前缀/limit2的一页元数据1，不读日志 |
| Route53 | 2：准确公开zone1、console.sandbox.techlong.cloud.的A Alias一页1，不查API/buyer记录或公网DNS |

合计**STS1＋元数据19、所有云写0**；每请求一次、无翻页/轮询/自动重试，不用未用预算扩查IAM、证书、Secret、Cell/租户、ECR或其他Region。准确NotFound只记录缺失、跳过依赖调用，余下独立读取仍不得越表；未知错误/凭据问题则停止，不自动刷新或诊断。模板/资源集有差异时保留差异、停止依赖遍历，不覆盖历史基准。

交付只包含一张“CFN声明/物理绑定—实际资源—引用差异”表：11项存在和绑定；443/TLS/证书引用及转发目标；console Alias与实际ALB DNS/zone/原健康评估字段；Service的目标组/网络/任务版本；TaskDefinition的镜像/角色/端口/日志/固定Secret引用，以及控制器关闭布尔检查。`:12`、旧ALB/listener ARN均仅为历史，不能充当前值；Service声明1/实况0、关闭控制器模式等已知差异须如实列出，不因核验而修正或“恢复”特权。未检查所有属性、运行中任务或业务健康，不能据此声称完整漂移检测或正式上线完成。

**完整风险与数据边界：** 使用既有Source凭据会进入内存，并有网络/提供者审计日志和低额非零费用。GetTemplate/DescribeTaskDefinition的原响应可能在CLI内存中含参数、Environment或Command；仅将白名单身份/引用、控制器布尔检查和摘要投影保存到私有ACL目录，原始环境/命令/参数值及原始错误不保存或输出。其他资源名、私网IP、Account ID/ARN与Secret版本引用可能进入核验元数据。禁止GetSecretValue、PEM/.env/HMAC、数据库连接、日志正文、公网HTTP/JS及GitHub读取；不提交凭据、秘密或业务正文。读取不是跨服务原子快照，资源可并发变化，缺页/未知/缺失须保留，不冒充完整归属证明。

原草案的`observedAt/factsValidUntil=null`保持；实际采样和5小时终点只记录于结果，不回填或改写准备材料。**不启停、重建、删栈、改DNS/IAM/镜像/临时工具，不安装自动清理。** 其他资源/存储等可能持续收费，50USD/月仍不是硬上限。已完成读取的剩余预算不重用；离线候选现已完成，下一只准备未执行变更集的新审批，实际修复另审。

**已确认的直接原因：** 2026-11-07T14:53:08.255Z 完成的一页事件查询绑定 OperationId `05dc971d-c8f7-46b9-ae85-d44ec357b009`、`FailedEvents=true`，返回根栈及三条规则共4条失败事件，无下一页。三规则均报 `Replacement type updates not supported on stack with disable-rollback.`。原执行清单把三项替换与 `DisableRollback=true` 组合，这是本次执行策略的不兼容，不是新的 IAM 缺口证明；也不能据此保证未来恢复必然成功。ResourceProperties 只可能进入 CLI 内存，未保存/输出；原[读取草案](../ops/deployment-baseline/tenant-b-failed-event-read-scope.json)保持准备时原文，不用于重复读取。

## 哪个栈负责什么

| 栈（现有名称） | 声明归属 | 不归它管理 |
| --- | --- | --- |
| 平台 `techlong-sandbox-platform-hosting-v1`，11 项 | 平台 Cluster、TaskDefinition、Service、LogGroup；ALB、443 Listener、目标组、两个安全组、TaskIngress、console 域名 A Alias | 所用 VPC/子网、证书、Web 数据库与执行角色。平台执行角色/boundary 在独立 access 栈；不属于平台版本更新 |
| 共享 Cell `techlong-sandbox-cell-sandbox-1`，16 项 | VPC、IGW/attachment、两个公网子网、路由表/默认路由/两个子网关联；任务和 ALB 安全组；集群、ALB、443 业务与 8443 mTLS 监听器、共享业务拒绝规则 | Express 数据库是外部依赖；不能把 Full 配置的 DB 子网组、集群或 writer 加回。证书和 trust store 也是输入 |
| 租户 `techlong-sandbox-tenant-9c5ee9e64509dcad`，7 项 | 租户 Service、TaskDefinition、LogGroup、目标组、两条 443 规则（业务和拒绝控制路径）、一条 8443 控制规则 | 不拥有集群、监听器、租户 API DNS、数据库、镜像仓库或角色 |

平台 DNS 由平台模板从自身 ALB 的 DNSName/CanonicalHostedZoneID 派生；租户 API Alias 在这三个栈之外，指向 Cell ALB。买家 CDN/静态桶有独立前端栈，不随租户更新。独立 RDS 实例也不是此租户发布目标。禁止把“使用”理解为“可以随版本替换或删除”。

完整逻辑 ID、类型、参数/输出清单和三份模板的规范 JSON SHA 在 [机器基线](../ops/deployment-baseline/existing-tenant.template.json)。复用原 [平台模板](../ops/platform-ecs-v1/templates.mjs)、[Express Cell 渲染器](../lib/deployments/cloudformation/express-single-tenant-cell-v1.ts)和[租户渲染器](../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts)；机器基线指纹来自实际归档声明，**不把某个较早的渲染器默认输出当作已安装的模板**。

## 跨栈绑定与恢复差异

Cell 六个输出按同名参数传给租户，并非租户栈自己查找资源。`ClusterName` 供 Service 使用，`VpcId` 供目标组使用，`SubnetIds` 和 `TaskSecurityGroupId` 用于任务网络。归档对照中这四项一致。另两项决定三条租户规则挂在哪个监听器上，历史材料中已不一致：

| 引用（ARN尾段；前三数据列为历史） | 11月1日归档 Cell 输出 | 11月1日新租户建栈参数 | 11月6日手动恢复映射 | 本次A2独立核验的Cell输出 |
| --- | --- | --- | --- | --- |
| HttpsListenerArn / 443 | 77888e84c19e8b86 / 469c2b642a33bfc1 | 241081ab25c73320 / 8fce768af0ff42f7 | 706bcbbc89b8a673 / 9f91841ec135459f | 729e0854244ceff6 / 31e6577b666f0de1 |
| ControlListenerArn / 8443 | 77888e84c19e8b86 / bc69b195b69bc2d9 | 241081ab25c73320 / 576403dc1245139b | 706bcbbc89b8a673 / ae460cdac1f0e971 | 729e0854244ceff6 / 864f7b1cd42d3f8d |

上表的 A2 输出本身不是租户已接通的证明。A2 执行前 04:51:53.585Z 的租户参数仍为 241081 代；原 B 失败执行虽曾把两参数保存为 729e 代，三规则 CFN 物理引用当时仍旧代。之后回滚并另批执行的新 B，已于21:09独立核验三规则实体与归属；API Alias 又于21:37另批更新并独立核验，最新结果见顶部。**参数、CFN 记录和实际规则实体必须分开核验**，不得把创建时的 AVAILABLE 或参数对齐当修复成功；本轮未查询公网解析或API健康。

平台也经历 ALB `92d54a44479fbc3a → a33cd1f8bed33cba`，443 监听器 `0234243da966933a → 253cde394d05f108`；两条 Alias 曾被直接切到重建后的 ALB。重建监听规则会产生新物理 ID，Cell 自有拒绝规则与租户三规则须分别对应到各自栈。**同名、同标签、DNS 曾经工作均不能证明 CFN 已接管。**

初版离线阶段明确不调整 IAM。之后用户单独批准了[最小 IAM 修正](../ops/deployment-baseline/tenant-b-iam-review.json)，[安装结果](../ops/deployment-baseline/tenant-b-iam-installed-20261107.json)确认既有 policy 默认 v9→v10，保留 v7/v8/v9，仅新增两个准确新监听器规则前缀的 DescribeTags 读取覆盖；因长度上限去掉五个可选 Sid 标签，其余授权元素保持。它同时作为角色 identity policy 和 boundary，新读取覆盖持久保留，不是临时 grant。这是另批的范围扩展，不属于三栈资源归属或镜像更新，也不授权继续改 IAM。

平台归档模板仍声明 hosted-controller/ControllerLease 与 HostingExpiresAt；手工恢复采用关闭控制器的任务定义 :12，无新资源到期。不可拿旧平台模板整体覆盖实际服务或重新挂载控制器凭据。之前11月6日stop核对发现两台ALB均不存在，那是A2之前事实；A2阶段只由CFN恢复并核验了Cell。后继本次平台只读已再次确认准确平台名称/CFN ALB及监听器缺失，实际服务仍0/:12，详见顶部；没有因此恢复平台。表中的11月6日恢复映射是历史，**不能再当下次参数来源**；未来使用新输出仍须提交前匹配实际状态。本基线不判断数据库现在是否已停，也不改动stop锁、journal或工具配置。

证据来源：私有归档 `manual-environment-restore-20261101-a/inputs.json` 内两个父栈 Original 模板及 Cell Outputs；子栈用同期 `tenant-create-request.json` 的新建 TemplateBody/公开绑定，**不用已删除旧 UUID 的模板当新栈实况**；11月6日映射来自 `manual-environment-restore-20261106-b/journal.json`。原件位于 F 盘，不复制请求、完整参数、NoEcho 值或业务快照到 Git。[运行事实与已知漂移](aws-manual-test-environment-20261106.md)。

## 给下一次更新用的最小模板

原 B 失败已查明并经另批回滚/新 B 与DNS修复收口，不再作为待查因任务；平台归属盘点和停用收敛候选也已完成，下一仅准备未执行变更集审批，不提前更新镜像。[监听器参数片段](../ops/deployment-baseline/tenant-listener-change.template.json)是既有 B 计划的输入，不是新的可执行命令；其创建和单次执行已发生，不得按旧[离线计划](../ops/deployment-baseline/tenant-b-offline-plan.json)再创建或重放。离线阶段的“未读取/任务定义物理 ID 未知”只适用于当时；后续已核对租户CFN/服务引用均为 :12，不能重新当作当前缺口。租户Service声明1、执行后实况0的差异仍保留，本次平台候选不改租户Service或DependsOn。

[参数片段](../ops/deployment-baseline/tenant-image-change.template.json)按现有租户声明使用 `UsePreviousTemplate`，仅替换 `ImageUri`，其余 19 项均为 `UsePreviousValue`，不需要导出任何秘密值。镜像必须是同账号同区域指定仓库的新 SHA-256 digest，不能传 tag。此片段没有执行入口；不把监听器修复、DNS、平台任务、数据库迁移或角色改动夹带在版本更新里。

本地检查入口（Node 22.13+，JSON 模板正文；不是 CloudFormation API 的返回外壳）：

```powershell
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json bindings.json
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json bindings.json <旧镜像摘要URI> <目标镜像摘要URI>
```

`bindings.json` 仅需 `cellOutputs` 与 `tenantParameters` 两个对象，各含上述六个公开键及其字符串值；SubnetIds 为逗号分隔串。三个原模板核对资源清单、参数/输出名及完整规范内容摘要（对象键顺序无关，数组顺序保留）。任何模板差异需审查；绑定不匹配时拒绝生成版本草案。即便全部一致，结果仍是 **liveOwnershipVerified=false / executionAuthorized=false**。

**初版离线检查（历史事实）：** 本机三份归档模板与清单匹配；同一批已存输出/参数比对准确报出两项监听器差异，版本草案被拒绝。这是当时的保护结果，不是当前实况或云端修复完成证明。

**未来镜像发布条件（不是当前执行许可）：** 真正发布前，另审必要的只读核对：准确栈 UUID、Original、物理资源与运行引用（包括域名、规则、服务 revision 和镜像），确定恢复/收敛方式。若资源缺失、执行权限绑定陈旧或归属不明，单列修复范围；不直接重建、不以名称认领。只有重新证明归属与绑定一致并核实新镜像后，才可准备只针对租户的镜像 Change Set，审查预期任务定义新 revision 和服务更新、拒绝无关资源变化。GitHub environment 仍由用户本人批准。初版“未启动收费环境/未创建 Change Set”只描述初版离线阶段；后继另批的 ALB 恢复与 Change Set 创建/执行已发生，不能继续写作当前事实。

## 历史阶段索引（只追溯，不重放）

| 阶段 | 当时结果与证据 |
| --- | --- |
| 初版离线基线 | `e2fb780`，仅声明/历史绑定对照，无云调用；不是后续云操作授权 |
| A1 创建 → 执行 | [仅创建结果](../ops/deployment-baseline/cell-a1-created-20261106.json)、[单次执行及独立核验](../ops/deployment-baseline/cell-a1-executed-20261106.json)；四项失效声明移除，十二项保留，属于已完成中间态 |
| A2 创建 → 执行 | [仅创建结果](../ops/deployment-baseline/cell-a2-created-20261107.json)、[单次执行及独立核验](../ops/deployment-baseline/cell-a2-executed-20261107.json)；Cell 恢复四项声明/两输出，不等于租户/API 恢复 |
| B 预检 → IAM 修正 | [05:22Z 预检](../ops/deployment-baseline/tenant-b-preflight-20261107.json)、[v10 安装](../ops/deployment-baseline/tenant-b-iam-installed-20261107.json)；当时三旧规则缺失、参数仍旧代；IAM 修正已另批完成，不再待批 |
| B 仅创建 | [95855d02… 创建结果](../ops/deployment-baseline/tenant-b-created-20261107.json)，当时为 AVAILABLE/三规则替换，无 Service 等变化；不是现在仍可执行的证明 |
| 旧 B 执行清单过期 → 新只读刷新 | [过期停止](../ops/deployment-baseline/tenant-b-execution-expired-20261107.json)、[另批刷新](../ops/deployment-baseline/tenant-b-execution-refresh-20261107.json)；旧清单未执行，原事实/期限未改写，随后另批新 SHA |
| B 单次执行 → 独立检查 | [失败/部分状态结果](../ops/deployment-baseline/tenant-b-execution-inspected-20261107.json)；执行槽已消费、未验收，不重放 |
| B 单次失败事件读取 | [用户另允的查因结果](../ops/deployment-baseline/tenant-b-failed-events-observed-20261107.json)，STS1＋DescribeEvents1，确认禁用回滚与替换型更新不兼容；无写入/实际修复，唯一后继方向见顶部 |
| 回滚 a 停止 → 新 b 回滚及独立核验 | [a凭据停止](../ops/deployment-baseline/tenant-b-rollback-preflight-stopped-20261107.json)、[b实际结果](../ops/deployment-baseline/tenant-b-rollback-observed-20261107.json)；累计3/20/1，恢复CFN稳定控制态而非规则实体/API，回滚批准已消费 |

完整分阶段审批、原 SHA/期限与失败记录继续保留在[修复沿革](aws-cell-listener-ownership-repair.md)、执行手册/主线的折叠历史及 Git 历史中；历史机器清单、模板、执行回执、私有原件及永久槽保持，本次平台观察另存新结果文件。历史中的“下一步/待批准/尚未执行”只适用于当时，不覆盖顶部状态，也不能作为重放入口。
