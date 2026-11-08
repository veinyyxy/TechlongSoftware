# 既有租户版本更新：三栈资源基线

初版 2026-11-06；状态整理 2026-11-07 CST / 11-08 UTC。账号 402010193138 / ca-central-1。这里的“正式基线”指后续发布所遵守的**声明归属**，不是新生产环境、可执行部署包或云操作授权。初版仅离线整理；后来的 A1/A2、IAM 修正和租户 B 均是用户另行批准的独立修复范围，不能由追加的文档反向授权。

本页分开记录当前状态、长期归属和历史阶段；只有下一节定义当前继续点。历史段落、旧审批 SHA、旧期限及机器清单中的准备状态均不构成新许可。已验证的现有 sandbox 不等于任意租户。买家商品列表、登录、查看订单及卖家端所测功能由用户确认正常，不列为工程待测项。

2026-11-08接续：用户已另行要求并完成[临时启停v2代码改造](aws-environment-tool.md#cfn-lifecycle-implementation)，CFN生命周期编排及旧直接CFN写入阻断已实现，真实启停/权限尚未验证。本页05:03平台云回执及其中“当时未改临时工具”的记录不覆盖或改写；新工具代码不会改变既有云事实、批准或资源计费，首次使用仍需准确只读接入及新启停清单。

<a id="current-state"></a>

## 当前状态与唯一继续点

**最新：平台最后一段已实际执行并独立核验完成。** [新物理基线、只读接续与证明边界](#platform-idle-verified)：原45588046…只Execute1次，平台11项归属、ALB/443、console Alias和闭控停用声明匹配，Service/CFN同为:13、任务0/0/0。首次检查时仍处理中，原更新随后自行完成；所有旧创建/待定回执保持，未重试写入。此前平台归属另批只读及旧差异见[前置11项表](#platform-ownership-observed)。前一阶段Cell—租户—API Alias引用链已对齐并收口：用户明确确认0e2ad8ca…清单后，仅提交一次准确API A Alias UPSERT，并于21:37:50.709Z由另一进程独立核验通过。[实际结果](../ops/deployment-baseline/tenant-api-alias-updated-20261107.json)：变更/change/C006498723VT6A7LZFY4W为INSYNC，准确Alias指向当前729e Cell ALB，差异0。该阶段实际STS2/元数据11/DNS写1，其他直接写0；更新槽1/批准已消费，不重放。

| 对象 | 最新已存事实与边界 |
| --- | --- |
| Cell与租户三规则 | 21:09独立验收UPDATE_COMPLETE/EXECUTE_COMPLETE、DisableRollback=false、三个729e新规则归属/条件/动作/优先级正确，四保留ID/18参数元数据/角色/标签/输出及当时服务0/:12保持 |
| API A Alias | 21:37独立读回已指向当前1581133878，准确change ID为INSYNC；只改目标DNSName，其他字段保持，0e2…批准已消费 |
| 服务与证明边界 | DNS阶段未查或启动服务；最后服务观察为21:09的0/0/0/:12。没有公网解析/缓存、API健康或产品测试证明，ALB仍可能收费，未新增自动停止 |
| 平台及停用归属 | 05:03独立核验11项归属：ALB/443由原栈恢复，新console Alias匹配，Service/CFN均:13/任务0，模板也声明0且闭控。临时工具及租户声明1/实况0例外未改，不称三个栈同时全属性无漂移 |

只改AliasTarget.DNSName为当前1581133878，名称/类型/所属zone/目标zone/EvaluateTargetHealth=false保持。三规则归属在21:09已独立验收，本次DNS又独立匹配，组成特定Cell—租户—API Alias引用链的收口证据，不是同一时刻原子快照。最后服务观察仍为21:09的0/0/0/:12，本阶段没有重查或启动服务；INSYNC不证明公网缓存、API健康或产品验收。ALB实际active、可能持续收费，没有新增自动停机或续租。

用户后来明确确认59b9b261…新清单及风险，收费平台ALB已经由这唯一一次CFN执行恢复，不再等待同一批准。仅DnsRecord AliasTarget的原生回退比较按批准的写前/写后核对收口，UNSUPPORTED及旧创建回执fullExecutionScopeAccepted=false保留，不篡改为自动放行。不切STANDARD、不重建或重放计划、不扩权限和分支。

68项本地检查及定向lint通过；本轮三段分别明确获批，合计STS5/直接元数据65/Execute1，其他直接云写及秘密值/私钥/配置/数据库读取0。旧00:13事实及05:13Z终点、原件和审批模板不修改，独立核验在原09:53Z读取终点前；未改变资源租约、临时工具原则或费用承诺。本轮平台归属段到此完成，不自动开始下一阶段。

<a id="platform-idle-verified"></a>

### 实际收口：平台11项归属、console Alias与闭控停用基线独立核验通过

最终结果为**PLATFORM_IDLE_OWNERSHIP_AND_DNS_INDEPENDENTLY_VERIFIED**，于2026-11-08T05:03:19.699Z / 温尼伯11月7日23:03:19.699 CST完成：[最终去敏原件索引](../ops/deployment-baseline/platform-idle-followup-observed-20261108.json)。原平台栈c4bf36b0…为UPDATE_COMPLETE，原45588046…变更集EXECUTE_COMPLETE/REVERT_DRIFT；Original全文匹配候选`47ae49231809b1cbe5859c0d5eebd4444c5795162a39ead51ba81964d557f3c1`。原栈无RoleARN、标签/输出摘要与六项未变资源物理ID保持，没有新增IAM。

| 逻辑归属或引用 | 本次实际值及验证 |
| --- | --- |
| LoadBalancer | `arn:aws:elasticloadbalancing:ca-central-1:402010193138:loadbalancer/app/techlong-sandbox-platform/c06cdf93979f2406`，active；网络/四项声明属性/CFN标签匹配 |
| HttpsListener | `arn:aws:elasticloadbalancing:ca-central-1:402010193138:listener/app/techlong-sandbox-platform/c06cdf93979f2406/8db555e0348e379b`，443/HTTPS/TLS13策略、原证书、转发原b29a…目标组匹配；本平台没有新增8443或mTLS |
| DnsRecord | console.sandbox.techlong.cloud. A Alias → `techlong-sandbox-platform-1829777331.ca-central-1.elb.amazonaws.com.` / ZQSVJUPU6J1EY，EvaluateTargetHealth=true；目标等于同栈新ALB实际DNS/zone |
| TaskDefinition / Service | 同为`techlong-sandbox-platform-web-v1:13`，新版本来自CFN实际绑定、没有预测或导入:12；相同镜像71e26893…、原执行角色/固定DB Secret引用，控制器关闭，声明DesiredCount=0且服务实况0/0/0 |
| 其余六项 | Cluster、LogGroup、TargetGroup、AlbSecurityGroup、TaskSecurityGroup、TaskIngress原物理ID保持；核对CFN标签/网络/3000入口/日志7天等指定属性。Service、DnsRecord本身物理ID也保持 |

**实际时序与审批分开计数：** 04:41:07.972Z保存唯一执行意图，04:41:09.517Z收到ACK；写前18项核对约28秒。首次独立根栈读取04:55时仍UPDATE_IN_PROGRESS而停止，代码使用组合差异错误码，但角色/标签/输出均匹配，不能误写为这些发生漂移。随后用户另允准确栈三读，确认仅Service仍处理中、ALB/443/DNS/:13已有CFN完成事件，无失败事件；再另允集中只读跟进，05:02观察原栈已UPDATE_COMPLETE、ECS主部署COMPLETED，再由独立进程完成17项核验。没有新的Execute、主动回滚、补齐或清理；提供者异步等待不是二次执行或本地失败重试。

| 独立批准段 | 实际STS / 元数据 / Execute | 记录与限制 |
| --- | --- | --- |
| 59b9b261…原执行清单 | 2 / 43 / 1 | [原执行及第一次未验收回执](../ops/deployment-baseline/platform-idle-executed-20261108.json)，未复用剩余预算，批准/永久槽已消费 |
| 用户另允准确栈查因 | 1 / 3 / 0 | [原栈与本操作事件](../ops/deployment-baseline/platform-idle-pending-observed-20261108.json)，OperationId 2c882241-a1f6-4895-8e81-c693b209ee2d，一页不翻页 |
| 用户另允只读跟进及独立核验 | 2 / 19 / 0 | 新上限2/24，实用等待阶段2元数据＋独立17；原更新自行完成，未重放旧独立记录或消费新执行槽 |

合计STS5/元数据65/Execute1，不能误记为原59次预算被自动扩充；新增读取均先经用户准确范围确认。所有其他直接云写、Secret值/PEM/.env读取、数据库、镜像、GitHub调度及业务HTTP均0。旧创建、第一次未验收、查因原件与时间不覆盖；本次没有另建变更集或写临时工具。68项本地检查及定向lint通过。

**完成及保留边界：** 本平台停用归属段已经完成，不再等待或重放上述批准。DNS仍属原生UNSUPPORTED回退情形，只由用户另批的准确前后实况补证，不冒称获得通用漂移检测支持。Cell/租户/API已有各自独立时点证据，不是此时三栈原子全属性漂移扫描；租户Service声明1/实况0历史例外及旧启停工具债务保持，本次不暗修。没有运行产品测试、启动任务/数据库或查数据库现时启停状态。后续版本更新复用此物理基线，但必要现状、新镜像与实际变更仍按新的准确范围开始，不自动进入下一阶段。

**费用仍存在：** 新平台ALB已独立观察为active，即使ECS=0仍会计费；未加自动到期/停止或续任何旧租约。既有价格情景约25.37USD/月加LCU/流量/日志/税和其他现存资源，非实际账单或50USD硬上限。用户若要求停费，须按另行明确范围处理，不能由本回执自行删除ALB/停库或调用旧临时工具。

<a id="platform-idle-execute-review"></a>

### 最后执行审批：原变更集单次执行、平台停用基线独立核验

[完整机器清单](../ops/deployment-baseline/platform-idle-execution-review-20261108.json)，规范JSON SHA **`59b9b261b9233849cb92b55606025b2cf984282731bd7ac0314a829e1029caeb`**。本节保留执行前材料；原文件PREPARED_NOT_APPROVED等准备状态不改写。用户随后明确确认后，已按[顶部实际结果](#platform-idle-verified)单次执行并经另批只读接续核验，批准/槽已消费，不再等待、重放或据此扩大范围。下文“收到批准后/尚未执行”只适用于当时。

#### 范围、次数和通过条件

收到准确SHA确认后，按同一轮连续完成：**新鲜限定预检 → ExecuteChangeSet最多1次 → 另一进程独立核验**。Direct预算STS2、元数据59（预检18＋根栈状态最多24＋独立17），每请求最多1次尝试/不翻页；等待最多900秒、状态轮询间隔至少15秒。预算不等于CFN内部调用或账单上限。必要角色缺失、依赖/原件/计划不匹配则停止，不补权限/建资源/更换模式。

- 预检准确栈状态/原模板/11项绑定、原计划完整五项及候选全文SHA；列该栈一页变更集，遇其他AVAILABLE/创建中计划停止；核对当前服务0/:12、平台ALB仍缺失、准确DNS旧值、VPC/两子网/两SG/证书、既有执行角色及两服务关联角色、目标组。调用及目标逐项固定在清单，不查询Cell/租户或业务。
- 唯一Execute仍为REVERT_DRIFT、两Add（ALB/443监听器）＋三Modify（DNS/Service/TaskDefinition），显式**DisableRollback=false**。CFN恢复平台ALB与监听器、由同栈更新console Alias、注册闭控任务版本并使Service声明和实况均0；新revision与ALB物理ID只能取实际同栈返回，不能预测或沿用236108旧ID。不启动数据库或部署控制器。
- 独立核验UPDATE_COMPLETE/EXECUTE_COMPLETE、候选全文、11项逻辑归属和6项保留物理ID；新ALB/监听器及新CFN任务版本与服务一致，desired/running/pending均0、控制器关闭、同镜像/角色/固定DB Secret引用。核验网络/TLS/目标组/标签/四项ALB属性/日志保留及console Alias指向同栈新ALB；不是仅看操作success。不读取Secret值、PEM/.env、日志事件或业务数据，不连接数据库/执行产品测试。

不会直接Create/DeleteChangeSet、UpdateStack、RollbackStack、改ELB/ECS/DNS/IAM/RDS、更新镜像、调度GitHub或运行临时启停工具。CFN按上述批准范围的内部资源操作及正常回滚另计，不伪称这些托管副作用为0。

#### DNS UNSUPPORTED：只接受这一处明确限制

原生漂移计划对不支持的资源采用上次/期望模板比较，而非当前实况比较；它不禁止已显示的AliasTarget更新，也不把该资源变为IN_SYNC。[AWS漂移比较限制](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/drift-aware-change-sets.html)。本清单仅在新明确批准后，接受**DnsRecord、Modify/Replacement=False、仅AliasTarget**这一处回退；Name/Type/zone/EvaluateTargetHealth=true保持，GetAtt仍从同栈LoadBalancer导出DNSName/CanonicalHostedZoneID。AliasTarget的类型文档标为无需中断更新，不是实际DNS已通过的证明。[RecordSet属性](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-route53-recordset.html)。

写前必须新读准确记录并匹配既存摘要，写后须独立将准确Alias与同栈新ALB DNS/zone比较；其他UNSUPPORTED/NOT_CHECKED、IgnoredProperties、额外变化仍阻断。全局REVERT_DRIFT和旧回执false保持，不直接写DNS或放宽通用门禁。跨服务没有CAS，期间第三方DNS修改仍可能被覆盖，用户需接受该并发风险。

#### 新阶段时序，不延长旧事实或资源租约

清单准备于2026-11-08T04:23:52.889Z，新执行提交须在**2026-11-08T09:23:52.889Z / 温尼伯11月8日03:23:52.889 CST**之前；这是须单独批准的新阶段五小时窗口。旧观察00:13:41.732Z及旧05:13:41.732Z事实终点保留，仅作目标绑定，不作当前执行证据。必须批准后重新取得清单内18次预检所需事实，全部检查须在唯一Execute前10分钟内完成；超时或变化停止，不自动再读、重建或重放。独立读取最多保留至09:53:52.889Z / 03:53:52.889 CST，不能据此晚写/重试。这里没有延长ControllerLease、资源TTL或清理期限。

#### 完整风险与失败策略

1. **真实费用**：ALB基础0.02475USD/小时，公网IPv4每地址0.005USD/小时；按2地址/730小时估算固定25.3675USD/月（约25.37），另加LCU/流量/日志/税及原有资源，地址数可能扩展。此次平台不配置mTLS truststore，不套用Cell含truststore费用。价格于04:21:36Z取自官方[ca-central-1 ELB价格表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ca-central-1/index.json)及[VPC价格表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ca-central-1/index.json)。ECS=0也不免ALB费用；没有自动停止，50USD/月不是硬上限。
2. **权限及托管副作用**：原栈无显式RoleARN；写前若仍如此，CFN使用Source派生的临时会话，权限可能较宽。仅检查三个既有角色，不新增IAM。固定Secret引用、旧Command/Environment/lease等可能经元数据进入内存，公开/私有证据只落允许字段、布尔结果及摘要，不保存属性/参数/环境原文、Secret值或原始异常。
3. **正常回滚和旧版本清理**：显式允许CFN正常失败回滚；替换任务定义可能注册新revision、托管注销原CFN :11，额外实际:12不自动导入/删除。Execute可能使同栈其他变更集失效/被托管删除，保留本地历史但不能承诺云记录保留。[Execute API语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。目标闭控/任务0，但提供者/回滚短暂活动不能保证绝对为0，偏离不算验收成功，不自动停回。
4. **非原子和失败遗留**：检查不是跨服务CAS，异步操作可能部分完成、回滚失败或遗留收费资源；超时/凭据失效不取消CFN。唯一永久意图在写前保存，未知提交不重发；不自动重试、补齐、复位、主动回滚、清理或停机。失败/不明只保存已批准的有限状态，不扩事件/日志读取，后续另审Inspect。
5. **清理并发及证明边界**：旧过期Hosting标签保留；模板无Scheduler，已存源码中的tenant Janitor名称围栏排除本平台，但本轮没有穷尽实时自动化盘点，不承诺外部清理/人员操作不会竞争。不安装监控、禁用清理或续租；临时工具不改。通过也只完成本平台停用归属收口，Cell/租户/API采用各自历史独立证据，不声称三个栈同时全属性无漂移、服务已运行或产品新验收通过。租户声明1/实况0及旧工具制造漂移的长期缺口不在此处暗修。

此处准备阶段65项本地检查及定向lint通过，当时账号AWS调用/云写/秘密值/私钥/配置读取/数据库/执行槽0，仅官方公开价格GET2。用户随后明确确认此SHA，实际执行及另批只读接续见顶部；清单原件、准备时权限布尔值及旧时间保持，不作为重放授权。最终回归现为68项，不扩支线。

<a id="platform-idle-created"></a>

### 平台漂移计划已创建并独立核验，未执行

用户以“开始”确认25abd212…后，唯一CreateChangeSet于2026-11-08T02:56:49.891Z收到ACK；另一进程于**02:57:29.262Z / 温尼伯11月7日20:57:29.262 CST**独立回读通过。[去敏结果和真实原件指纹](../ops/deployment-baseline/platform-idle-created-20261108.json)。准确ARN为`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-platform-idle-drift-20261108t020555-ae520bf3/45588046-6ce7-409d-9c47-504631f990e4`，**CREATE_COMPLETE/AVAILABLE、REVERT_DRIFT**。

| 实际变更 | Action / Replacement | 真实漂移证据及边界 |
| --- | --- | --- |
| LoadBalancer | Add | DELETED，拟由CFN恢复；本轮ALB仍缺失 |
| HttpsListener | Add | DELETED，拟恢复443监听器；本轮没有新监听器 |
| DnsRecord | Modify / False | UNSUPPORTED，未给实际状态漂移比较；AliasTarget随资源属性变化，不能当作已独立核对DNS实况 |
| Service | Modify / False | MODIFIED，DesiredCount及任务定义引用变化；候选声明0，原服务仍0/:12 |
| TaskDefinition | Modify / True | IN_SYNC（指原:11实体）；ContainerDefinitions需要替换以闭控，不预测新revision，不直接导入:12 |

恰两Add/三Modify，无Remove/Import/额外逻辑ID/嵌套计划；独立GetTemplate的候选全文SHA为47ae4923…，与受审模板一致。其他六项不在变更中，原栈UPDATE_COMPLETE/旧LastUpdatedTime、无RoleARN、标签/输出及11项旧物理记录保持，原服务desired/running/pending=0/0/0且仍引用:12。**Add行返回的236108…物理ID属于旧CFN记录，不是新创建的ALB或监听器ID**；没有执行就没有新物理ID，不得当下轮资源来源。

**创建核验通过≠执行范围已放行。** 进程内基础检查通过仅表示绑定、模式、五项集合和两个DELETED证明匹配；实际DNS为UNSUPPORTED，公开结果明确`fullExecutionScopeAccepted=false`并列出执行审查阻塞。旧准则要求类型支持限制显式审查，不能静默把它当IN_SYNC或切换整个计划为STANDARD。此处记录创建阶段结束时的阻塞；后继[离线执行审查](#platform-idle-execute-review)已明确这一处原生回退比较、所需新实况与独立核验及完整执行风险，仍须新SHA批准。创建阶段没有新的Route53实况查询，原console Alias观测仍归00:13快照，不冒充02:57新DNS实况；旧回执不改。

直接实际调用**STS2/元数据14/Create1**（writer8＋独立6；两次状态查询），Execute及其他直接写0；CFN托管漂移读取不包含在此计数中。唯一创建槽和25ab批准已消费，不能利用剩余10次预算追加查询或再次运行创建。私有投影原件在`.local-secrets/techlong-platform-idle-drift-20261108t020555-ae520bf3`，既有历史和请求/意图字节保持，不落盘原始参数/Environment/Command/lease/属性上下文。

没有恢复ALB、启动服务或数据库、读Secret值/PEM/.env、连接数据库、改IAM/DNS/镜像/临时工具、GitHub调度或产品测试。平台仍未修复；其他资源仍可计费，没有新增到期、自动停机或50USD硬上限。原源事实至2026-11-08T05:13:41.732Z保持，02:57仅创建结果不为旧依赖续期；未执行计划可以保留追溯，实际执行仍需新范围和新批准。

<a id="platform-idle-create-review"></a>

### 已消费：仅创建平台REVERT_DRIFT变更集的审批留档

[准确机器清单](../ops/deployment-baseline/platform-idle-creation-review-20261108.json)的规范SHA-256：

`25abd21269c43cda9c355bc80b23d4c8d1fba0edf47b938e8f682043f19c1fe5`

以下保留原审批范围和风险；用户随后确认后已仅创建并独立核验，见上方真实45588046…结果。原JSON的PREPARED_NOT_APPROVED保持准备时原文，不再等待批准或重放。新名称`techlong-platform-idle-drift-20261108t020555-ae520bf3`、ClientToken和原c4bf36b0…栈、47ae4923…候选全文均按受审请求提交；TemplateBody采用递归对象键排序/数组顺序保持的JSON（8,776字节），完整请求摘要9a7cb6b0…。无S3上传/TemplateURL，保留原两参数UsePreviousValue和四标签，ImportExistingResources=false/IncludeNestedStacks=false；唯一创建槽已消费。

| 阶段 | 新批准后的直接调用上限 |
| --- | --- |
| 创建前 | STS1；准确栈DescribeStacks/GetTemplate Original/ListStackResources/ListChangeSets各1；准确平台ALB名称缺失核对1、原ECS服务0/:12核对1，共6元数据 |
| 唯一提交 | CreateChangeSet1，仅UPDATE/REVERT_DRIFT，不Execute；提交前持久化唯一意图和准确请求摘要 |
| 状态等待 | DescribeChangeSet最多12，准确返回ARN（ACK不明只用批准的新名称＋准确栈），含IncludePropertyValues；总只读等待最多180秒，间隔至少10秒，不是写入重试 |
| 独立回读 | 另进程STS1＋6元数据：准确变更集含属性1、其候选GetTemplate1、原栈及11物理绑定各1、ALB仍缺失1、ECS仍0/:12为1 |

合计**STS最多2＋元数据最多24＋CreateChangeSet最多1**。只读等待与独立预留不能相互挪作新资源查询；所有直接Execute/Delete/UpdateStack/IAM/ELB/ECS/RDS/DNS/Secret值/PEM/.env/数据库/镜像/GitHub/公网请求均0。ListChangeSets和属性结果均只允许完整一页：遇NextToken即停止，不能翻页；已有AVAILABLE/创建中计划或名称冲突也停止，不删除旧FAILED记录。旧栈RoleARN/模板/标签/输出/11物理绑定、ALB缺失或服务0/:12有变化则不提交，不以剩余预算查新原因。

CFN生成漂移感知计划时可能更新自身DriftInformation；独立回读应把它单列为允许的提供者元数据变化，不能把它误判成运行资源被修改，也不能因此放宽原栈状态/角色/标签/输出或物理绑定保持要求。

**额外必须接受的范围与风险：** CFN会用既有身份能力读取同栈11项实际配置，并可能验证绑定模板直接引用的VPC/两子网、HTTPS证书、任务执行角色、固定Secret引用及ECR镜像的元数据来生成漂移比较（不读Secret值/数据库），后台服务调用不能被本机24次元数据上限约束，也不是本机可逐条列出的读取次数。原采样没有显式RoleARN，本请求继续省略；若现场仍无关联角色，CFN按官方语义使用Source用户派生的临时会话，权限可能较宽，本次不安装或更换角色，若出现新RoleARN就停止。[官方角色规则](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)。

`IncludePropertyValues=true`和模板读取可能让原始参数、历史lease、Environment/Command和Secret固定版本**引用**进入CLI/必要核验进程内存；它们不是Secret值API，但仍有内存、网络/提供者审计日志和低额非零费用风险。仅把允许的身份/状态/属性名、摘要及安全引用投影保存到私有ACL目录，不保存/打印原始环境/命令/参数/lease/上下文或错误，不提交业务快照。写专用属性、IgnoredProperties、NOT_CHECKED或意外差异须如实记录，不以创建成功作为执行依据。[属性读取开关](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)。

创建/核对非原子，并发变化和权限失效仍可能发生；ACK不明只按准确名称/栈独立核对，不重发Create。失败或超时可能遗留未执行记录，状态超时不取消后台处理；保留旧/新记录及已消费槽，不删除、补齐、复位、回滚、自动换STANDARD或安装权限。即使计划含超范围变化，也只记录不执行/删除。未来Execute可能注销旧CFN任务版本、恢复收费ALB和更新DNS，**这些都不在本次批准内**；创建后需实际计划通过并另批执行/失败策略和费用。

沿用真实源事实`2026-11-08T00:13:41.732Z`至`05:13:41.732Z`，保留15分钟预留，必须在**温尼伯2026年11月7日22:58:41.732 CST / UTC次日04:58:41.732前启动**，本轮材料生成时间不续期。独立读取也不得超过原05:13Z；窗口不足/到期即停止，新范围另审。旧HostingExpiresAt标签/租约不续、不禁用清理；这不是资源到期或自动停机设置，其他资源仍可计费，50USD/月不是硬上限。本轮只离线封存清单，不事先探测Source登录或执行任何账号API。

上述范围及完整风险仅作已消费批准留档，不再作为新的可确认或可运行入口；下一唯一继续点见顶部，执行仍另审。

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

1. **另审仅创建**：对准确c4bf36b0…原栈提交一次UPDATE/REVERT_DRIFT候选，IncludeNestedStacks=false，旧两参数UsePreviousValue；不执行。CFN会自行读取资源进行三向比较，相关托管读取、敏感属性比较及本机回读须计入新批准范围，不能套用上轮19次预算。原离线计划中的不完整片段保持；后继完整新名称/ClientToken/请求摘要及创建审批在[上节](#platform-idle-create-review)保留，现已单次创建并独立核验；不重放。
2. **审查真实计划**：必须证明原LoadBalancer/HttpsListener缺失且将被CFN恢复，DnsRecord转向恢复后的ALB；TaskDefinition/Service仅闭控/停用及相应任务版本收敛。允许变化范围只含这五项，其他六项物理绑定必须保留；不得Import、改逻辑ID、增栈或夹带IAM/Cell/租户变化。不预先臆断缺失资源在API中一定显示Add；读完整属性/Drift/BeforeValueFrom及IgnoredProperties后判定。未审明的类型不支持、不可变漂移或未知额外变化就停止，不自动降为STANDARD或改走A1/A2。[官方限制与比较语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/drift-aware-change-sets.html)。真实计划的单一DNS限制现在已在上方单独审明，仍不是自动放行。
3. **执行另批**：只有实际计划通过后，才请求一次Execute及正常CFN回滚、托管清理旧任务版本和独立回读的准确批准。模板ContainerDefinitions变化可能生成新的CFN所属revision，不能预测一定是:13，也不直接认领:12；Service仍引用CFN TaskDefinition，DesiredCount=0。现有依赖使ALB→443监听器/目标组→Service、ALB→DNS由CFN编排。不得先按旧:11启动服务。

AWS公开支持表列出本平台所用资源类型的漂移检测能力，但不是本账号真实计划已经成功的证明。[类型支持表](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/resource-import-supported-resources.html)。离线候选阶段没有进行账号读取；后继仅创建阶段已另批完成上述有限前置与回读，仍不代替执行所需的依赖/权限/清理来源证明。实际计划DNS项UNSUPPORTED以顶部为准，不以公开支持表覆盖真实限制。原状态采样及05:13Z准备终点不重计，离线候选可以追溯保留，不能冒充执行时新事实。

#### 风险与失败策略（实际执行仍另批）

ECS=0不等于免费：未来执行会重建计费ALB及托管公网地址，不启动数据库/任务，也没有新增自动到期或停止机制，50USD/月不能保证。历史HostingExpiresAt标签仍过期；未来执行前必须核对既有清理来源，本候选不续标签或禁用清理。正常回滚拟DisableRollback=false，不能重复旧“替换更新＋禁用回滚”组合；这是待批失败策略，不是本轮自动回滚许可。官方描述漂移感知失败回到部署前实况，但部分完成、回滚失败和收费遗留仍可能发生；旧CFN所属:11可能被托管注销，额外:12不自动删除，详情须绑定真实计划和准确执行风险。未知提交/失败即保存现场并另审Inspect，不自动重试、补齐、手动回滚或清理。

739e9e9离线候选阶段只读已存模板/去敏证据与公开官方文档；当时没有AWS账号调用、Secret值/PEM/.env/HMAC、数据库、GitHub运行读取、云验证/写入、新槽或调度。只在main提交离线材料；不改正式运行内核、旧基线指纹、历史回执或临时工具。本节是原基线的候选附表，不另建平行手册。

<a id="platform-ownership-observed"></a>

### 前置平台归属观察：当时9项实体仍在，2项缺失

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

原草案的`observedAt/factsValidUntil=null`保持；实际采样和5小时终点只记录于结果，不回填或改写准备材料。**本只读阶段当时未启停、重建、删栈、改DNS/IAM/镜像/临时工具，未安装自动清理。** 其他资源/存储等可能持续收费，50USD/月仍不是硬上限。已完成读取的剩余预算不重用；后继候选、仅创建及单次执行已分别获批完成，最终平台收口见顶部，不能再写为当前仍等待执行批准。

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

早期平台归档模板声明 hosted-controller/ControllerLease 与 HostingExpiresAt；手工恢复当时采用闭控:12，无新资源到期。后继受审候选现已实际应用为闭控:13/声明0，保留旧未使用参数/标签但不挂载控制器凭据。之前11月6日stop核对两ALB不存在、A2只恢复Cell、00:14平台只读仍缺ALB/服务0/:12，均是分阶段历史；最新平台已由原栈恢复并独立匹配c06cdf…，详见顶部。表中的11月6日映射和旧236108代记录**不能再当下次参数来源**；未来新操作仍须按必要现状匹配。本基线不判断数据库现在是否已停，也未改stop锁、journal或工具配置。

证据来源：私有归档 `manual-environment-restore-20261101-a/inputs.json` 内两个父栈 Original 模板及 Cell Outputs；子栈用同期 `tenant-create-request.json` 的新建 TemplateBody/公开绑定，**不用已删除旧 UUID 的模板当新栈实况**；11月6日映射来自 `manual-environment-restore-20261106-b/journal.json`。原件位于 F 盘，不复制请求、完整参数、NoEcho 值或业务快照到 Git。[运行事实与已知漂移](aws-manual-test-environment-20261106.md)。

## 给下一次更新用的最小模板

原 B 失败已查明并经另批回滚/新 B 与DNS修复收口，不再作为待查因任务；平台盘点、候选、仅创建及单次执行和独立核验也已完成，当前不自动开始镜像更新或新云动作。[监听器参数片段](../ops/deployment-baseline/tenant-listener-change.template.json)是既有 B 计划的输入，不是新的可执行命令；其创建和单次执行已发生，不得按旧[离线计划](../ops/deployment-baseline/tenant-b-offline-plan.json)再创建或重放。离线阶段的“未读取/任务定义物理 ID 未知”只适用于当时；后续已核对租户CFN/服务引用均为 :12，不能重新当作当前缺口。租户Service声明1、执行后实况0的差异仍保留，本次平台段未改租户Service或DependsOn。

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
