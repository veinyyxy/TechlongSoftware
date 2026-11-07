# Cell 与租户监听器归属修复方案及执行记录

目的：恢复既有 CloudFormation 管理关系，不发布镜像、不启动业务服务。只涉及 ca-central-1 的共享 Cell 和准确租户；不是平台 ALB 修复。**本页不是新增执行授权；唯一状态与后继方向以[三栈基线顶部](aws-deployment-baseline.md#current-state)为准，下方阶段文字只供追溯。**

<a id="tenant-b-post-rollback-executed"></a>

## 当前结果：三规则实际归属已独立验收通过

用户在准确5ab93ad9…及正常回滚/依赖运行风险请求后明确“确认”。已于2026-11-07T21:07:51.312Z记录唯一执行意图，21:07:52.812Z收到ExecuteChangeSet ACK，显式DisableRollback=false；两次同栈状态查询后为UPDATE_COMPLETE。另一进程于**21:09:03.139Z**完成独立验收，**RULE_BINDINGS_INDEPENDENTLY_VERIFIED、差异0**。[实际结果与原件指纹](../ops/deployment-baseline/tenant-b-post-rollback-executed-20261107.json)。

- 准确e8fb4b24…为EXECUTE_COMPLETE、同租户UPDATE_COMPLETE、实际DisableRollback=false；观察到UPDATE_STACK操作f1563830…，不把其操作ID描述为来自Execute ACK的字段。Original d705…不变，两监听器参数已与Cell真实729e输出一致。
- 三条新规则在租户CFN七资源记录及ELB实际实体中一致，条件/动作/优先级/目标组匹配：443/100拒绝控制路径，8443/100转发控制路径，443/101转发业务；物理ID尾分别为2a324cb802f1f48d、9ddee07811205325、a059386198eb8922。四保留物理ID、18参数元数据/17标签/角色/输出保持，目标组已关联当前Cell ALB。
- 独立验收时服务仍0/0/0/:12、网络/目标配置保持；IAM v10、角色ID/trust/空inline/单附加/boundary与正文均匹配，Cell状态/输出、两监听器TLS/mTLS、共享/默认规则保持。没有瞬时任务历史或NoEcho真值证明，不据最终0宣称期间绝无运行或数据库活动。
- 实际**STS2/元数据34/Execute1**：写前17＋状态2＋独立15，其他直接AWS写0；执行槽1/批准已消费，不能重放5ab…或旧创建/回滚批准。没有额外Create/Delete、直接IAM/DNS/ELB/ECS/RDS写、Secret值/PEM/.env/数据库连接、启停工具或业务测试。CFN按受审替换执行的提供者行为不算Source另获删除权限；旧云端Change Set未额外查询/删除，不保证它们仍存在。

51项本地基线检查及定向lint通过。只完成三规则归属，尚未核对API域名Alias/公网解析/健康/费用，服务验收时仍停用，不称API运行或整套正式基线已完成。20:37完整依赖事实与原期限保留，不因本次结果重计；ALB可能持续收费，未新增自动停止。

<a id="tenant-api-alias-read-scope"></a>

### 下一唯一动作：API域名Alias最小只读核对（待新确认，尚未调用）

目的仅为核对first-acceptance.sandbox.techlong.cloud.的A Alias是否指向本次真实Cell ALB；不再重查整套环境、不启动服务或重复店铺/登录测试。新范围上限**STS1＋元数据3**，固定Source profile techlong-sandbox-user/准确IAM用户、账号402010193138。Route53使用官方全球端点及us-east-1签名，不代表在该区域创建资源。

1. STS GetCallerIdentity最多1次，必须为准确Source IAM用户，失败立即停。
2. ELBv2 DescribeLoadBalancers最多1次，仅本次729e准确ALB ARN，取得真实DNSName/CanonicalHostedZoneId并核对身份/VPC；不读其他ALB或目标健康。
3. Route53 GetHostedZone最多1次，仅历史已绑定zone Z01473621BTTHKXBGOOEJ，核实为覆盖准确域名的公开zone，不枚举/切换zone。
4. Route53 ListResourceRecordSets最多1次，仅该zone、StartRecordName为上述准确API名、StartRecordType=A、MaxItems=5，一页不翻页；只判断准确名的记录，必须恰一条简单A Alias。若同名多条、复杂路由或分页截断准确名则停止，不自动简化。

比较时只规范大小写/末尾点及可选dualstack前缀，Alias的目标DNS和ALB CanonicalHostedZoneId均须匹配；保留EvaluateTargetHealth等字段，不执行UPSERT。历史zone/旧Alias只作固定查询目标，不当作新事实。若已匹配，记录本轮Cell—租户引用链核对结果；不匹配则另备一份准确DNS写清单让用户确认。读成功不等于公网DNS解析或停用服务健康通过，也不表示平台漂移已处理。

明确排除：所有AWS/GitHub写入、Secret值/PEM/.env/HMAC、数据库/S3正文、其他域名/平台资源、公网GET或JS、ECR/镜像更新、任务启动、续租/清理/启停工具修改和执行槽。接受既有凭据在内存使用、网络/提供者日志与低额非零费用风险。最多一次新记录，拒绝/非预期差异/不完整结果就停，不自动重试/扩大诊断；不使用本阶段剩余执行预算。此范围本身尚未获批准。

<details>
<summary>已完成执行审批、前置材料与分阶段原始记录（保留追溯，不重放）</summary>

下方旧“当前/待确认/下一步”、旧SHA及期限只适用于当时；实际已消费批准不能重放，不覆盖本页顶部，不构成新许可。

<a id="tenant-b-post-rollback-execute-review"></a>

## 当前结果：新三规则Change Set已创建并独立核验，未执行

用户明确“确认清单”后，已按ae62c037…执行唯一一次CreateChangeSet：20:52:08.821Z记录意图，20:52:10.388Z收到ACK，20:52:33.485Z读到CREATE_COMPLETE/AVAILABLE。另一进程于**2026-11-07T20:52:53.314Z**独立验收通过。[实际结果与原件指纹](../ops/deployment-baseline/tenant-b-post-rollback-created-20261107.json)。

准确新ARN：`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-tenant-b-postrollback-20261107t203711/e8fb4b24-b8fc-4065-b666-a8e771164842`。

- STANDARD、恰三规则Modify/Replacement=True、仅ListenerArn；拟议/当前Original均d705…，独立回读时租户仍UPDATE_ROLLBACK_COMPLETE，七物理记录/旧参数/角色/17标签/输出及服务0/0/0/:12/网络/目标保持。DisableRollback仍true，尚未应用新规则或恢复API。
- 实际**STS2/元数据23/Create1**：写前15＋新计划状态2＋独立6，其他直接AWS写0；创建槽1/批准已消费。IAM v10只在写前复核，独立阶段未另查；模板正文不保存/输出，没有Secret值、PEM、.env或数据库连接，不重放创建/旧95855d02…/回滚token。
- Cell/网络/证书/trust完整依赖仍来自20:37限定只读；本次写前只重核关键Cell输出/监听器/优先级，创建结果不延长其事实期限。ALB可能持续收费，未新增自动停止；DNS/健康/费用及产品测试不在本阶段。

用现有原件已直接备好[准确执行清单](../ops/deployment-baseline/tenant-b-post-rollback-execution-review-20261107.json)，canonical SHA：

`5ab93ad9b0549cffcc3c221ddd9d53b87dbd802d27c3b8d1254133a3b45b1f8e`

**唯一待审操作：** ExecuteChangeSet仅一次，绑定上述新ARN/同租户UUID与新ClientRequestToken，**显式DisableRollback=false**；原创建请求未设OnStackFailure。先核对计划/栈/角色/监听器仍与原件一致，再执行并由另一进程独立核验三条实际规则、两监听器绑定、保留资源/18参数与服务状态。必须新明确接受下面完整风险；本次创建批准不覆盖执行。

**未来直接调用上限：STS2＋元数据46＋Execute1。** 写前17（准确计划＋拟议/当前Original、租户/Cell状态、七记录/计划列表、两监听器/规则列表/目标组、服务、IAM五项）；同栈状态最多14次；独立15（租户/Cell状态、准确计划、Original/七记录、两监听器/两规则列表/目标组、服务、IAM五项）。所有状态查询计数，不翻页/扩API，不读事件、任务环境或新资源。Create/DeleteChangeSet/DeleteStack/主动Rollback或ContinueUpdateRollback、直接ELB/IAM/DNS/ECS/RDS写、镜像更新、Secret值/私钥/.env、数据库连接、派发、续租/清理均0。

**必须明确接受的执行/失败策略：**

- 正常CFN回滚已开启，不再使用“不回滚保留失败状态”。执行的三项替换包含提供者删除旧规则；失败回滚也可能删除新替换资源或协调依赖。旧规则实体已缺失，更新或回滚仍可能失败、留下部分或收费资源；这些提供者行为不等于Source另获DeleteStack/ELB删除权限。
- 模板Service DesiredCount=1、DependsOn三规则未变，实际0/0/0。即使预览没有Service变更，也不能保证提供者不协调服务或启动任务；可能发生正常运行时托管Secret注入、数据库连接/启动写入及计算/公网IPv4费用。这些间接行为不受Source直接调用次数限制，必须接受；不自动停任务或缩回0。
- 验收要求四保留ID/任务定义:12/网络目标及服务0/0/0保持，三规则真实归属/条件动作/优先级正确。即使CFN UPDATE_COMPLETE，服务或引用偏离也只能报告未验收，不能自动修复或声称成功。
- 跨服务非原子/非CAS、并发、凭据刷新、日志/网络、Source PassRole/SCP/提供者兼容性未完全证明；底层事实采样后仍可能变化。固定执行尝试一经记录意图不复位，提交不明不重发、不重建计划、不跳过资源、不主动回滚/自动清理/撤权。只在清单预算内独立读回；失败原因事件或恢复须新准确审批。CFN执行可能使其他关联计划失效或被清理，不执行任何额外删除API。
- ALB或意外启动任务可能持续收费，没有新增到期/自动停机或50USD硬上限。Source只用已存私有部署元数据，不直接读Secret值/PEM/.env或连数据库；不能把这点误写为没有上述提供者/应用间接活动。

**时间不延长：** 底层事实到2026-11-08T01:37:11.801Z，即温尼伯**11月7日19:37:11.801 CST**；最晚2026-11-08T01:22:11.801Z，即**19:22:11.801 CST**启动。创建独立回读时间不作为重新起算依据；这不是资源到期时间。

50项本地检查及定向lint通过。当前只等执行SHA及上述风险的新明确批准，不调用Execute或用剩余预算补读；规则实际对齐之后才另审API DNS，镜像、临时启停工具、平台修复和业务测试不在本轮扩展。

下方旧“当前/待确认/下一步”、旧SHA及期限只适用于当时；已消费批准不能重复使用，不覆盖顶部，不构成新许可。

<a id="tenant-b-post-rollback-create-review"></a>

## 当前结果：必要只读通过，直接等待新三规则仅创建清单批准

用户明确“允许本轮限定只读核对”后，已按下方准确范围执行一次，2026-11-07T20:37:11.801Z起采样、20:37:50.286Z完成，**实际STS1/元数据27、云写/Secret值/PEM/.env/数据库/槽消费均0**。[新事实与本地私有原件指纹](../ops/deployment-baseline/tenant-b-post-rollback-preflight-20261107.json)。私有目录保留一次性调用配方及去敏元数据日志，没有新增工程运行时入口、框架或固定任务；模板正文只在内存求摘要，不保存/输出。

- 同UUID租户仍UPDATE_ROLLBACK_COMPLETE、ROLLBACK操作80754a93…、DisableRollback=true；Original d705…/七物理记录/参数元数据/17标签/输出/角色匹配，两个参数仍旧241081。三旧规则实体均准确RuleNotFound，既有目标组无ALB关联。
- Cell仍16项/e32…/真实729e ALB与两个监听器，443/8443/TLS/mTLS/证书/trust/网络及标签归属匹配；共享拒绝规则保持，目标443优先级100/101、8443优先级100空闲。服务0/0/0/:12、四保留ID/网络/目标及原角色/default v10正文保持。
- 这些是本次真实新事实，不重计旧期限；未查DNS、健康、费用、瞬时任务历史或NoEcho真值，不能称API恢复/整套基线完成。ALB实际active、可能持续收费，未新增自动停机。

已直接生成[仅创建审批清单](../ops/deployment-baseline/tenant-b-post-rollback-creation-review-20261107.json)，canonical SHA：

`ae62c0377aa6e272cd5165d53daa10906ac7140b8ee04759cf98b2f121cb1baa`

**仅此待审范围：** 一次CreateChangeSet(UPDATE)，固定新名称`techlong-tenant-b-postrollback-20261107t203711`和新token；同一租户UUID、原模板/角色/17私有标签，仍复用两参数片段/18项UsePreviousValue（含ImageUri）。随后另一进程独立回读，只接受CREATE_COMPLETE/AVAILABLE、恰三规则Modify/Replacement=True/仅ListenerArn；其余四资源不变。请求不含OnStackFailure或DisableRollback，后者是未来执行时另批且显式设false的策略，不在创建时混用。

未来批准上限为**STS2＋元数据31＋CreateChangeSet1**：写前15次（租户状态/模板/七记录/计划列表、Cell输出/两监听器/两规则列表、服务/目标组、IAM五项）、准确新计划状态最多10次、独立6次（计划、拟议/当前Original、租户状态/七记录、服务）；所有状态查询均计数，不翻页、不扩API。新读取与本轮已使用的1/27不是同一预算。Execute/DeleteChangeSet/DeleteStack、其他直接写、Secret值/PEM/.env/数据库、DNS/镜像/启停/派发/业务测试均不允许。

**时间：** 事实五小时到2026-11-08T01:37:11.801Z，即温尼伯**11月7日19:37:11.801 CST**；最晚2026-11-08T01:22:11.801Z，即**19:22:11.801 CST**启动，预留独立核验时间。这不是资源到期，不重置或延长旧批准/租约；未获本清单批准前不执行创建。

**本次创建需接受的风险：** 凭据自动刷新失败、网络/提供者日志与低额非零费用；既有标签/NoEcho遮罩元数据进入私有内存/证据；跨服务非原子/非CAS与读后并发变化；Source PassRole/SCP/提供者写兼容性未由只读成功证明；提交不明、失败或超时可能留下未执行/失败对象，固定尝试不复位、不换名重试、不自动删除/执行/补偿。创建清单不执行资源更新；三规则预览不保证将来执行不协调Service（声明1/实况0）或不会发生运行/托管Secret/数据库启动活动，未来执行必须另审正常回滚及相关风险。

48项本地检查及定向lint通过；旧草案/审批/失败记录和回滚配方均未改，不能复用失败95855d02…或已消费回滚token。当前只等待上述SHA“仅创建＋独立核验”批准，不再准备其他支线；DNS核对排在规则实际对齐之后，临时工具原则仅留待未来，不在本轮改造。

下方旧“当前/待确认/下一步”、旧SHA及期限只适用于当时；已使用的读取不能重复消费，不覆盖本页顶部，不构成新许可。

<a id="tenant-b-post-rollback-draft"></a>

## 当前离线交付：新的 B 三规则仅创建材料，尚不可执行

按用户“仅离线准备，实际创建/执行另审”的范围，新增[数据草案](../ops/deployment-baseline/tenant-b-post-rollback-offline-plan.json)，不改旧JSON、原模板、运行时代码或纯离线形状检查器。草案以18:12真实回滚回执及摘要为锚点，`UPDATE_ROLLBACK_COMPLETE`、旧241081参数、七CFN物理记录、服务0/0/0/:12和IAM v10都是已存观察，不是本轮新查询；NoEcho真值/业务状态未核验。

复用[原两参数片段](../ops/deployment-baseline/tenant-listener-change.template.json)：`UsePreviousTemplate=true`，仅ControlListenerArn/HttpsListenerArn候选切至729e，其余18项（含ImageUri）全部`UsePreviousValue=true`，角色/标签保持。不改Service、TaskDefinition、TargetGroup、LogGroup和三个DependsOn；规则条件、动作、优先级和域名参数也不变。

| 规则 | 目标监听器/优先级 | 保留的匹配与动作 |
| --- | --- | --- |
| TenantBusinessControlDenyRule | 443 / 100 | 准确租户host＋`/api/saas`及子路径 → 404 |
| TenantControlListenerRule | 8443 mTLS / 100 | 同host＋控制路径 → 既有目标组 |
| TenantListenerRule | 443 / 101 | 同host → 既有目标组 |

未来新Change Set只接受**三项Modify、Replacement=True、仅ListenerArn**，Add/Remove/Import均0；非预期或无变化就停，不自动执行/删除。继续复用`review.mjs#reviewTenantListenerChangeSet`；形状通过不证明18项请求保留、服务不启动或实体归属，必须同时绑定准确请求和独立读回。

**尚缺且必须另审的准备：** 必要元数据只读核对同UUID/稳定状态/Original/七记录与保留参数，Cell真实输出和ALB/443/8443/mTLS/网络关系、443优先级100/101与8443优先级100占用、旧规则实体/目标组关系、服务0/:12及角色v10。复用有效事实、不为离线草案提前查询；13:46 Cell事实及18:46原期限保留，18:12租户回读不能刷新它。新快照最多5小时，各对象以其真实采样时间约束，不静默续期。

这些门槛通过后，才可形成另批的`CreateChangeSet(UPDATE)`一次清单：新名称/token、同模板、同角色/标签、恰两参数；只创建并独立核对`CREATE_COMPLETE/AVAILABLE`，Execute/Delete均0。当前草案的名称/token、实际Change Set ARN、批准SHA、新事实/启动期限均留空，不是待直接运行的命令；本轮无新读取/创建/执行许可。

**后继执行风险明确保留，不在本轮执行：** 栈仍DisableRollback=true，替换执行必须显式`DisableRollback=false`，创建时不混入OnStackFailure。不依赖SDK默认值，也不重放旧95855d02…、已消费回滚token或剩余预算。正常提供者回滚可能删除替换规则/协调依赖，旧规则缺失仍可能导致更新或回滚失败；模板Service声明1对实况0，不能承诺后继执行不启动任务、托管Secret读取或数据库启动写入。保持失败停止、不自动重试/跳过/补偿；不借此改IAM、启停服务、查DNS或更新镜像，平台漂移修复另列。

本阶段AWS/GitHub API/私密配置读取/数据库连接/云写入/执行槽均0，没有新运行时或恢复框架。ALB可能持续收费，未新增自动停止。46项本地基线检查（新增3项离线材料/事实来源/回滚策略回归）及定向lint通过；源码/检查通过不等于变更集已创建或API已恢复。

<a id="tenant-b-post-rollback-read-scope"></a>

### 下一步待确认：一次必要只读核对，直接准备仅创建清单

2026-11-07，按用户要求集中完成三规则主线。本节仅把所需读取收敛成一次明确范围，**尚未获得该范围的读取许可，也未调用AWS**；不新增脚本、恢复框架或固定任务。目标账号402010193138/ca-central-1、Source profile `techlong-sandbox-user`及准确IAM用户沿用已存材料；IAM使用官方全球端点，不涉及其他区域资源创建。

总上限：**STS身份核对1次＋AWS元数据27次**。STS必须匹配准确IAM用户，身份失败即停。元数据按下表逐项计数；任一拒绝、非预期差异、超限或分页即停，不自动重试/翻页/扩大诊断。三条旧规则各一次DescribeRules，仅准确RuleNotFound可记为该旧对象缺失，不重试或换目标。

| 分组 | 准确API与次数 | 限定目标/目的 |
| --- | --- | --- |
| CloudFormation，7次 | DescribeStacks×2、GetTemplate(Original)×2、ListStackResources×2、ListChangeSets×1 | 仅草案绑定的同UUID租户栈及Cell栈；最后一项仅租户、一页。核对租户稳定状态/回滚操作、两栈Original/物理归属/输出、七租户记录/四保留ID、现有角色/标签及参数元数据。模板正文只在内存求摘要，不输出或保存；不验证NoEcho真值 |
| ELBv2，10次 | DescribeLoadBalancers×1、DescribeListeners×1、DescribeRules×5、DescribeTargetGroups×1、DescribeTrustStores×1、DescribeTags×1 | 仅729e候选ALB、其两个监听器各一次规则列表、七记录中的三条旧规则各一次、既有目标组及固定trust store；标签一次批读限该ALB/两个监听器/共享拒绝规则/目标组。核对443/8443与mTLS、443优先级100/101及8443优先级100占用、共享拒绝规则及目标组关联，不查询健康或读取trust store对象正文 |
| IAM，5次 | GetRole、ListRolePolicies、ListAttachedRolePolicies、GetPolicy、GetPolicyVersion各1 | 仅既有TechlongSandboxCloudFormationExecutionRole及其boundary/附加的同一policy；核对角色ID/trust/空inline/单附加/boundary及默认v10正文，不模拟/安装权限 |
| ECS，1次 | DescribeServices×1 | 仅既有租户service；核对0/0/0、任务定义:12、网络/目标配置，不读任务定义正文/容器环境或任务历史 |
| ACM，1次 | DescribeCertificate×1 | 仅已存Cell监听器绑定的准确证书，核对证书状态与域名元数据；不读私钥 |
| EC2，3次 | DescribeVpcs、DescribeSubnets、DescribeSecurityGroups各1 | 仅Cell已有VPC、两个子网、ALB及任务安全组，核对已存网络绑定，不扫描全区域 |

以上目标以[离线草案及其绑定原件](../ops/deployment-baseline/tenant-b-post-rollback-offline-plan.json)为准，先核对同UUID/原件摘要与已知候选；不把读取中的新对象自动纳入范围。完整Describe返回可能进入CLI/进程内存，仅保存必要元数据和去敏错误至本地私有证据，不提交模板正文、NoEcho值或原始业务配置。

**明确排除：** AWS/GitHub写入、Create/Execute/DeleteChangeSet或DeleteStack、CloudFormation事件读取、Secret值/PEM/.env/HMAC、S3正文、数据库连接、DDB业务项、平台资源核对、DNS/公网健康/产品测试、ECR/镜像更新、启停工具改造、续租及执行槽消费。不会为取得创建材料而启动ECS/RDS，不更改现有资源到期机制。

若核对通过，复用现有参数片段和形状检查器，直接生成**新名称/token、同模板/角色/标签、两参数/三替换规则的仅创建审批清单**，包含创建最多1次及独立读回的准确预算；不自动创建或转入执行。新事实按真实采样时间最多5小时，不延长旧事实/批准；未采样时不编造factsAt、启动期限或新执行SHA。接受的读取风险仅为既有凭据在内存使用、网络/提供者日志、资源/Account ID/ARN元数据进入私有证据及低额非零费用；确认读取不代表批准任何写入。

<a id="tenant-b-rollback-result"></a>

## 最近云结果：单次回滚及独立核验通过，仅恢复 CFN 稳定控制状态

用户报告Source刷新并明确“确认接续清单”后，已按412da1ab…仅启动新b，原a/配方/计数保持。18:10:35.739Z写入唯一提交意图，18:10:37.266Z收到RollbackStack ACK，OperationId `80754a93-34b7-4500-90b2-d9d460903751`；两次状态查询后为UPDATE_ROLLBACK_COMPLETE。另一进程于**2026-11-07T18:12:05.152Z**完成独立核验，无差异。[实际结果与原件指纹](../ops/deployment-baseline/tenant-b-rollback-observed-20261107.json)。

- 同UUID、Original d705…、七CFN物理ID保持；两个监听器参数恢复为旧241081代，其他18参数元数据、标签/输出/角色保持。三旧规则CFN状态仍UPDATE_ROLLBACK_COMPLETE，不代表实体存在；没有ELB实体/DNS/健康读取，不称API已恢复。
- 服务在独立核验时仍0/0/0、任务定义:12，网络/目标配置保持；角色ID/trust/空inline/单附加/boundary、policy默认v10及正文匹配。没有瞬时任务历史或Secret/业务真值读取，不能据最终0承诺期间从未短暂运行或业务状态全不变。
- **DisableRollback实际仍true**；RollbackStack没有重置它。未来替换型B执行必须显式DisableRollback=false，不回到原错误组合，不依赖默认值，创建时不混入OnStackFailure。
- 累计**STS3/元数据20/RollbackStack1**：a失败1/0/0，b写前及状态查询1/11/1，独立1/9/0；其他直接AWS写0，没有创建/执行新变更集、修改IAM/DNS/镜像、直接启停ECS/RDS或自动补偿。原a槽0，新b回滚槽1/批准已消费，不能再用原批准/token或剩余预算。ALB可能持续收费，无新增自动停止。

上述回滚结果是本页顶部新离线材料的事实锚点，不是新创建或执行许可。回滚后的租户/IAM观察不延长旧Cell事实；后继只按顶部材料门槛推进，不重走A1/A2/IAM、改服务/DependsOn/DNS/镜像或扩恢复框架。

回滚阶段43项本地基线检查（含真实回滚结果与累计计数/验收边界回归）及定向lint通过；这不替代后继三规则实体/归属和DNS核验。旧审批、停止记录和原件全部保留在下方历史与对应JSON中。

以下保留各阶段原文与准确审批/风险，均不覆盖顶部结果，不构成新读取或写入许可，不重放已完成/停止的命令。

## 历史：写前凭据核对停止与 b 接续确认

用户明确批准 STS1＋DescribeEvents1 后，2026-11-07T14:53:08.255Z 完成准确 OperationId `05dc971d-c8f7-46b9-ae85-d44ec357b009` 的 FailedEvents 查询：4条事件、无下一页。三条规则均报 `Replacement type updates not supported on stack with disable-rollback.`；说明原清单的替换型更新与 DisableRollback=true 不兼容，是本次执行策略问题。没有重试、写云、读取 Secret/配置/私钥或连接数据库；ResourceProperties 未输出/落盘。[实际回执与私有原件指纹](../ops/deployment-baseline/tenant-b-failed-events-observed-20261107.json)。

上述查因只取历史事件。后继用户另允STS1＋元数据9后，本轮于15:52:42.347Z–15:52:55.171Z完成新的[回滚前只读核对](../ops/deployment-baseline/tenant-b-recovery-preflight-20261107.json)：同一UUID仍UPDATE_FAILED/DisableRollback=true且最后操作仍05dc971d…；Original、两新参数及其他参数元数据、17标签/输出、七CFN物理记录/状态、服务0/0/0/:12及网络/目标、原角色/trust/空inline/单附加/boundary和v10正文全部匹配。实际STS1/元数据9、所有写/秘密值/配置/数据库/执行槽0，不重放读取。

上述15:52只读事实不变。用户随后明确“确认清单”，但本轮实际执行于17:52:05.362Z–17:52:08.982Z在首次Source核对以CREDENTIALS_UNAVAILABLE停止；仅STS尝试1，元数据/回滚/秘密值/数据库/执行槽均0，未创建提交意图或发送RollbackStack。[停止证据](../ops/deployment-baseline/tenant-b-rollback-preflight-stopped-20261107.json)绑定原a目录和原配方指纹；前一次含糊“下一步开始”的命令被复核拦截、进程未启动。当前没有新的身份或资源状态证明，不断言具体凭据失效原因，不重跑a。

<a id="tenant-b-rollback-resume-review"></a>

## 当前待确认：刷新 Source 后，仅启动新的 b 接续记录

请运行 `aws login --profile techlong-sandbox-user`，不要发送验证码或凭据。已只用存档准备[新接续清单](../ops/deployment-baseline/tenant-b-rollback-resume-review-20261107.json)，SHA **`412da1ab49d9607676a729a32661f7ccb2c913a28112366124ed595629f57dfb`**，尚未获准或执行；刷新身份本身不等于批准新清单。

相对原9793…清单，只追加1次STS预算、使用新b证据目录并绑定旧停止记录/累计计数：**总STS≤3（a已失败1＋b写前1＋独立1）、元数据仍≤30、RollbackStack仍≤1**。资源、角色、未提交过的准确请求及token、风险和原截止时间不变；旧a与其配方不覆盖，不复位计数或槽，也不重做15:52的资源准备轮。b写前原9项和独立核验仍按清单执行，必须将a的STS尝试计入累计，不以b自身计数冒充总次数。

本次没有新增AWS调用来准备接续，也没有回滚或b执行槽。收到“Source已刷新＋确认新接续清单及完整风险”后才可启动b；旧批准和未用预算不自动迁移。原事实仍于20:52:42.347Z/温尼伯14:52:42.347 CST到期，最晚20:37:42.347Z/14:37:42.347 CST启动，不因凭据刷新或b准备延期。整栈/提供者删除、服务启动及数据库启动写入、并发/非原子、凭据/日志/费用、不自动重试/补偿等完整风险见下方原清单及新清单risks；新b不创建变更集、不改权限/DNS/镜像，不运行启停工具。

42项本地基线检查（新增2项停止/接续计数边界）及定向lint通过，旧审批/回执/事实时刻/配方和a记录保持；不能把本地验证或接续准备当作凭据恢复或云端成功。

<a id="tenant-b-rollback-review"></a>

## 原回滚清单：已确认但写前停止，不重跑

原[执行清单](../ops/deployment-baseline/tenant-b-rollback-review.json)的规范JSON SHA为 **`97938d9bd812276c30017329fc188c1b408c3a580ff926b1a5f393ed0b36163e`**，用户已确认，但a在STS处停止，RollbackStack未提交，不能重跑该命令。它绑定同一5867e9c0…租户栈、原执行角色、未使用token `tenant-b-rollback-221586dc1acf4b5e8c7e5fa188876da0`、RetainExceptOnCreate=false；不含DisableRollback参数、不声称回滚会重置该字段。原JSON保持准备时原文，实际批准/停止由后继记录说明，不改写历史。

本轮40项本地基线检查（新增3项只读结果/准确回滚请求/次数与失败边界回归）及定向零警告lint通过；原模板、旧审批/失败回执/永久槽不变。只是准备和本地验证，不是回滚或云验收通过。

原批准范围为 **RollbackStack最多1次、额外STS最多2次/元数据最多30次**：写前原9项、最多12次栈状态查询，另一进程9项独立核验。现已用其中STS尝试1、其余均0，不重跑；新b须另确认上方累计3次STS的新清单。直接Create/ExecuteChangeSet、DeleteStack、ContinueUpdateRollback、IAM/ELB/ECS/DNS/RDS/Secret/SQL写、事件读取及调度均0，本机不读.env、私钥或Secrets Manager值；提供者/运行时副作用另见完整风险。复用CLI/私有记录器，不建新框架。

成功只指UPDATE_ROLLBACK_COMPLETE、原Original/七物理ID、旧两监听器参数、其他18项参数元数据/标签/输出/角色/IAM及服务0/:12按清单独立匹配；不是旧规则实体存在、API恢复或后续B执行授权。未知ACK、任一步失败/差异/超时均保留现场、不重发、不跳过/补偿/停回任务，实际部分状态如实报告。若回滚导致服务运行，不能验收，也没有自动停用授权。

**批准必须包含的完整风险：** 回滚作用于整个租户栈而非三规则预览；没有稳定态会删栈，故同UUID真实CREATE_COMPLETE证明及本次失败状态不符即禁止提交。旧规则缺失可能使回滚失败；提供者可能删除新资源，RetainExceptOnCreate=false不禁止所有删除。Service声明1/实况0可能协调成运行任务、注入托管Secret、触发数据库启动活动（含写入）并产生费用，不能保证业务状态全不变；四资源保持只是验收条件，不是技术隔离。检查与写入非CAS，存在并发/既有清理器影响；Source写权/SCP/凭据自动刷新仍可能失败。网络/提供者日志、凭据内存和低额非零费用保留，ALB可能持续计费，无新自动停止/费用硬上限。失败/提交不明不自动重试、改IAM、回滚补偿、跳过资源、删栈重建或复位尝试。全部具体边界与原件索引以本次清单及下方风险说明为准，旧风险接受不代替这次批准。

事实仅至 **2026-11-07T20:52:42.347Z / 温尼伯14:52:42.347 CST**；须在 **20:37:42.347Z / 14:37:42.347 CST** 前启动，保留15分钟，不延长旧事实/批准/TTL。这不是资源到期，也不保证届时停费；事实变化/过期则不执行。审批只针对回滚，后继新B计划、实际DNS和镜像仍分别另审。

## 当前离线恢复提案：先回到稳定状态，再准备正常回滚的 B

前阶段离线准备仅查官方公开文档、使用已存原件，形成[不可执行的机器提案](../ops/deployment-baseline/tenant-b-recovery-offline-plan.json)，当时无账号AWS调用、私密读取、数据库连接、云写或新执行槽。该提案保持原样、不反向改成已授权；当前新事实及待批回滚清单仅以顶部实际记录为准。没有新增执行器、模板或通用恢复框架，新B变更集仍未创建。

37项本地基线检查（含2项提案/风险边界回归）及定向零警告lint通过；这是离线材料核验，不是云端恢复、权限或当前资源状态的证明。

**方案依据与推论：** AWS [失败处理文档](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)说明，从 FAILED 状态继续更新仍须保留失败资源，而该模式不支持不可变替换；[ListenerRule 属性说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listenerrule.html)将 ListenerArn 变更列为替换。因此本案不在失败状态直接重跑替换。建议先用 [RollbackStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_RollbackStack.html)回到上次稳定状态，再准备新的 B。这是依据已存失败和官方约束选择的恢复路径，不是云端验证通过或唯一可行性保证。

| 顺序 | 未来另批的动作 | 必须满足的边界 |
| --- | --- | --- |
| 1 | 同一准确租户 UUID，最多一次 RollbackStack，沿用原 CFN 角色，RetainExceptOnCreate=false | 新前置事实仍为本次 UPDATE_FAILED；绑定同 UUID 在05:55:05.907Z为CREATE_COMPLETE的真实证明。完成后独立核对稳定状态、旧两监听器参数、Original、原四保留物理ID及服务0/:12；回滚不等于旧规则实体恢复或API可用 |
| 2 | 回滚及独立核验通过后，最多一次新 CreateChangeSet，仅创建 | 同模板、两监听器参数来自重新核对的Cell输出、18参数保留；只接受三规则Modify/Replacement=True/仅ListenerArn。无变化或涉及Service/TaskDefinition/目标组/日志即停，不自动强制替换、改逻辑ID或补建 |
| 3 | 严格核验并另批后，最多一次 ExecuteChangeSet，显式DisableRollback=false | [执行 API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)的回滚开关必须明确，不依赖默认值；创建时不设OnStackFailure以避免参数冲突。新ARN/新token，不用旧已消费批准；接受正常失败回滚后仍独立核对三规则实体与四保留ID/服务，DNS和镜像继续另审 |

这三步是审批顺序，不是本次合并写入许可。第一步获批也不自动批准后两步；后两步的准确范围以回滚后真实结果和实际 Change Set 为准。整体回滚不承诺把栈的 DisableRollback 配置改成 false，后续执行仍须显式设置和核对。

### 回滚风险与停止条件

- **RollbackStack 是整个租户栈操作，没有可先预览的“三规则 Change Set”。** 不能把“一个Source写调用”说成只有两参数受影响；原四资源是必须验收保持的条件，不是阻止提供者协调它们的技术围栏。若没有上次稳定状态，AWS 会删除栈；因此找不到同 UUID 的真实成功原件、出现不同操作/角色/模板/物理ID或新状态，均不得提交。
- 上次稳定的 CFN 声明本身含已缺失的旧规则；回滚可能因这种漂移失败，不能保证重建旧监听器或修复API。提供者可能删除本次新建资源；RetainExceptOnCreate=false 不是禁止所有删除。若失败/提交不明，保留现场，不重发、不自动改用[ContinueUpdateRollback](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ContinueUpdateRollback.html)、跳过资源或删栈重建。
- “不自动清理/补偿”限制的是代理，不是禁止另批后CloudFormation的正常回滚动作。[新的变更集执行](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)还可能清理同栈其他旧Change Set对象；历史本地回执/原件/永久槽仍保留，不人工删除或复位。
- Service 声明仍1、最后回读实况0且依赖三规则；回滚/后续正常更新可能引起任务启动、托管 Secret 注入、数据库连接及计算费用。不能沿用旧风险接受作为新回滚批准，也不能保证只有路由变化。计数偏离0或四物理ID/任务定义:12改变即不验收、不继续下一写；不得自动停回、加IAM围栏或暗改Service。
- 回滚与其他资源回读非原子，存在并发竞态。Source是否允许RollbackStack尚未证明；不足时只报准确差异，不先扩权限。Cell/平台、数据库、IAM、DNS、镜像和临时启停工具都不在本提案的直接变更范围。共享ALB可能持续收费，无新自动停止或费用硬上限。

### 已完成的最小只读准备范围（不重放）

本轮已按用户许可完成**STS1＋元数据9**，用于第一步审批准备而非回滚批准。九读为准确租户DescribeStacks/GetTemplate(Original)/ListStackResources各1、准确服务DescribeServices1，以及原执行角色GetRole/ListRolePolicies/ListAttachedRolePolicies、原policy GetPolicy/GetPolicyVersion(v10)各1；状态/本次OperationId、模板摘要、七CFN记录/保留ID、服务引用/计数与IAM布局匹配，没有刷新Cell或重查失败事件。

身份是既有Source IAM用户，IAM使用全局官方端点，其余ca-central-1；单页、无翻页/重试/额外诊断。没有读取Secret值/PEM/.env、调用DescribeTaskDefinition、数据库连接、云写或新执行槽；Original正文仅进内存比对，未持久化或发布。新快照从15:52:42.347Z起5小时，不重计旧事实或资源期限。准确单次回滚清单已生成但未执行，下一只等顶部新SHA及整栈/运行时风险确认，不再重复准备读取。

以下更早原文保留，原“失败原因尚未取得”仅描述查询前，不再是当前阻塞，不能覆盖顶部已验证回滚结果。

## 当前结果：B 已单次执行，但失败且未验收，停止写入

用户确认新SHA `109627ceccdbe813ebbbf2b80c176c9a1e60ed16dfc75cb1f740a04af2dd69c9` 后，执行时HEAD为 `019ddce33006eae14efec26f132f5f7998fbf96c`。写前18项核对通过，**2026-11-07T14:07:56.251Z** 保存唯一意图，14:07:57.733Z收到Execute ACK；随后UPDATE_IN_PROGRESS→**UPDATE_FAILED**，停止写入、不重发。另进程于14:09:45.640Z完成受审独立读取，结果[未验收及原件指纹](../ops/deployment-baseline/tenant-b-execution-inspected-20261107.json)。

- 同一95855d02…为EXECUTE_FAILED，栈DisableRollback=true，Original仍d705…。两个监听器参数**已经保存为729e新值**，不能说失败后全无变化。
- 三条规则CFN记录仍为241081旧物理ID、状态UPDATE_ROLLBACK_COMPLETE，理由仅“Rollback succeeded for the failed resources”；新729e监听器下未验收到租户三规则，目标组仍无ALB关联。说明已发生提供者资源级恢复，**不是代理发起回滚，也不能据此声称旧规则实体恢复存在或新实体从未短暂创建**。创建前已披露的资源级恢复风险实际出现，完整原始失败原因尚未取得。
- 原Service/TaskDefinition/目标组/日志四物理ID保持；验收时服务0/0/0、仍:12，网络/目标配置保持。没有查询瞬时任务历史，不冒称证明整个期间绝无短暂运行。IAM默认v10/正文、角色trust/boundary/使用计数及版本匹配，writer另核对空inline/单附加保持。DNS/镜像/数据库未由本轮修改，API未恢复。
- 实际STS2/元数据36/Execute1（writer 1/22/1、独立1/14/0），其他直接AWS写0。无重试、主动回滚、清理、停回任务、IAM撤权或新计划；**执行槽和本次授权已消费，即使时间尚未过也不能再用原SHA/同token执行**。私有根 `.local-secrets/tenant-b-execute-109627ce-20261107-a`，两journal及attempt-intent保持。现有ALB可能继续收费，无新自动停止。

### 当前唯一继续点：只申请本次操作的失败事件读取

现有DescribeStacks/ListStackResources只给出三规则失败及资源级恢复摘要，未给出最初错误；**不把“旧实体原先缺失”直接当成已证实根因**。当前执行清单特意没有事件API授权，剩余预算不等于可以扩API；本轮不读取事件或写恢复代码、不自行改IAM/模板/栈。

已仅离线准备[准确只读范围](../ops/deployment-baseline/tenant-b-failed-event-read-scope.json)：Source STS最多1次，随后 **DescribeEvents一次**，准确OperationId `05dc971d-c8f7-46b9-ae85-d44ec357b009`、服务端 `Filters.FailedEvents=true`，核对准确栈和请求token；只一页/投影输出≤1MB、不翻页或失败重试。只处理这三规则及准确根栈的失败元数据，不扩到旧栈历史、CloudWatch/CloudTrail、任务定义、秘密、PEM/.env或数据库，不写或消费执行槽。

[官方事件API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeEvents.html)支持准确OperationId及[FailedEvents过滤](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_EventFilter.html)。必须明确额外风险：[事件模型](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_OperationEvent.html)可能含ResourceProperties，**AWS CLI进程可能在内存接收它**；只用白名单投影返回原因/状态，属性不输出、不进入Node审计文件或Git。若发现超出准确操作/栈/三规则的事件则停止；接受凭据内存、网络/提供者日志和低额非零费用。该历史失败原因查询没有新部署窗口，不延长旧事实/批准，也不执行/重建/回滚任何资源。35项本地检查及定向lint通过，仍待这一次新的读取许可；取得实际原因后才提出最小恢复范围，资源或权限变更另审。

## 当前最新：B 限定只读刷新通过，等待新执行 SHA 确认

以下为成功刷新后、执行前的旧观察；已由顶部实际失败/部分状态接续，不能据此重放1096…或说计划仍AVAILABLE。

用户另允同目标STS1/元数据30后，本轮身份核对成功，未要求重登。新记录从 **2026-11-07T13:46:46.440Z（温尼伯07:46:46.440 CST）** 开始实际读取，13:47:26.077Z完成；实际STS1/元数据28，所有AWS写/秘密/PEM/.env/数据库/任务环境读取/新计划/执行槽均0，无自动重试。[新鲜事实和原件](../ops/deployment-baseline/tenant-b-execution-refresh-20261107.json)与旧记录并存，不覆盖历史。

同一95855d02…仍CREATE_COMPLETE/AVAILABLE、STANDARD且完整计划指纹仍e342…，提议/已应用Original仍d705…、三规则替换不变；原七CFN记录、参数/17标签/角色保持，服务0/0/0/:12。Cell实读Original为e32…、16物理记录与729e输出保持，ALB active，443/8443 TLS/mTLS和空优先级、原目标组、三旧规则缺失均匹配；现行role/trust/空inline/单附加/boundary及v10正文/四版本匹配。两SG/两子网归属和入站规则、ISSUED证书/ACTIVE trust store也本轮重新读取，不以旧时间代替新观察。未读DNS/账单/业务、完整路由漂移或清理计划状态，不扩大为全账号验收。

**下一唯一动作仅确认新的执行清单：** [新文件](../ops/deployment-baseline/tenant-b-execution-review-refreshed-20261107.json)，规范JSON SHA：

`109627ceccdbe813ebbbf2b80c176c9a1e60ed16dfc75cb1f740a04af2dd69c9`

原7ec…清单及03:03终点原样保留，仅此新文件绑定真实新采样。仍仅Execute同一95855d02…一次、DisableRollback=true、既有Scope/48元数据上限/失败策略/风险正文均不变；不创建/删除计划、不改IAM/DNS/镜像、服务声明或DependsOn，不直接启动/停止ECS/RDS。你此前“明确接受”的依赖服务及运行时/费用风险已用原停止记录指纹保留，**不再重复询问同一风险方向，但仍需确认新SHA对应的实际执行**，不能把本次只读批准当执行授权。新ClientRequestToken只用于尚未进行的唯一执行，不重放旧尝试或复位创建槽。

新事实按五小时至 **11月7日18:46:46.440Z（温尼伯12:46:46.440 CST）**；预留15分钟核验，**最晚12:31:46.440 CST（18:31:46.440Z）启动**。这是材料有效期，不是资源到期/自动停止；ALB active且可能持续收费。33项本地检查及定向lint通过，未执行变更；新事实不证明Source/SCP有效写权限或执行后服务必仍0。若实际计数偏离0仍不算成功，不自动停回，恢复须另批；DNS及镜像继续分开，不重做业务测试。

## 当前停止点：B 执行清单已过期，未调用 AWS

以下为13:36Z的历史停止，已由顶部另批只读刷新接续；不把旧过期判断改写成执行成功或新期限。

用户明确接受前述依赖服务风险，已记录，不反复讨论方向。但开始时钟核对为 **2026-11-07T13:36:26Z（温尼伯11月7日07:36:26 CST）**，旧执行SHA `7ec89ebe5ae3b2852f3ac8246b3cf7695274cc9b180a7c0c74d8ad8251201858` 的最晚启动09:03:42.258Z（03:03 CST）和依赖事实终点09:18:42.258Z均已过去。**本轮在本地有效期门禁停止，STS/元数据/所有云写/秘密或配置读取/数据库/执行槽消费全部0。** 没有写执行脚本或运行过期命令，不断言Source失效；未验证凭据前不要求先登录刷新。

[准确停止记录](../ops/deployment-baseline/tenant-b-execution-expired-20261107.json)保留用户风险接受、旧SHA/终点和同一95855d02… ARN。旧清单、原件、事实时间、IAM安装及创建槽均不改、不复位；本轮没有执行/删除/重建Change Set或改资源。下方CREATE_COMPLETE/AVAILABLE、服务0等是05:55Z时的旧观察，**不是本轮重新证明的现状**。ALB可能仍持续收费，没有自动停用或新到期。

**当前唯一继续点：只请求新一轮限定只读刷新许可。** 同一Source身份最多STS1＋AWS元数据30，准确核对原计划/租户Original与物理记录、Cell输出/监听器/规则、服务引用与数量、原目标组、现有IAM v10及必要网络/证书/trust store元数据。不读Secret值/PEM/.env或任务定义环境、不连数据库、不写AWS/消耗执行槽、不调度；失败停止，保留新旧记录。只更新必要已过期事实，不重装IAM或重建已存在计划；新采样按五小时、不能把旧观察换日期。通过后才绑定新的执行SHA另确认，当前风险接受不自动延长旧期限或授权这轮读取。

## 最新结果：租户 B Change Set 已创建并独立核验，未执行

用户确认创建清单 `517850bfaaab521db0acff869dba7cac8759ff59dfee25be239115b111723f02` 后，执行时工程HEAD为 `6a4f476ab585c05840213d278398f9db3678baf0`。05:54:19.536Z保存唯一创建意图，05:54:21.095Z收到ACK；另进程于 **2026-11-07T05:55:05.907Z** 完成独立核验。准确Change Set尾ID **95855d02-9903-4d56-b042-959fb66cb232**，完整ARN及原件指纹见[实际结果](../ops/deployment-baseline/tenant-b-created-20261107.json)。

- CREATE_COMPLETE/AVAILABLE、STANDARD，恰TenantBusinessControlDenyRule、TenantControlListenerRule、TenantListenerRule三项Modify/Replacement=True、PolicyAction=ReplaceAndDelete，仅ListenerArn变化；无Service/TaskDefinition/目标组/日志变化或Add/Remove/Import。规则实体尚未重建，两个参数也尚未应用。
- 提议Original与已应用Original均d705…；实际栈仍CREATE_COMPLETE，七项CFN物理记录、20项参数、17标签和原RoleARN保持，服务独立回读仍0/0/0、引用:12。CFN旧记录仍指向三条已知缺失的旧规则，不能称实体都存在或API已恢复。18项UsePreviousValue以提交请求审计为准，返回元数据已比较；未解密或读出NoEcho值。DescribeChangeSet不回显ClientToken，固定token由不可变提交请求/意图绑定，不伪造“响应已回显”证明。
- 实际STS2/元数据24/CreateChangeSet1（writer 1/18/1，独立1/6/0），Execute/Delete/其他直接云写0；无IAM/DNS/镜像、ECS/RDS、秘密/数据库或业务HTTP操作，无重试或清理。私有根 `.local-secrets/tenant-b-create-517850bf-20261107-a`，创建槽已消费，不复位/重建/换名重试；此前IAM槽及旧事实原件保持。

ALB仍运行收费，无新资源到期/自动停止。当前只完成“有一个准确、未执行的三规则计划”，不是资源归属已应用或整体验收通过。

### 当前待审：仅执行这一份 B，必须明确依赖服务风险

只用已存原件准备[执行清单及完整风险](../ops/deployment-baseline/tenant-b-execution-review.json)，本次新增账号读取/执行槽/写入0。规范JSON SHA：

`7ec89ebe5ae3b2852f3ac8246b3cf7695274cc9b180a7c0c74d8ad8251201858`

拟仅Execute准确95855d02…一次，显式 **DisableRollback=true**，失败保留现场、不主动回滚/重发/清理/撤权/复位；[官方Execute说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)允许在本次未设置OnStackFailure的情况下指定该策略。创建时回读的DeploymentConfig.DisableRollback=false只是现状，不是本次执行策略批准。CFN三项ReplaceAndDelete包括更换旧规则引用及其提供者删除步骤，不能把“无直接Delete API”理解为CFN不做替换清理；提供者级恢复/删除仍可能发生，执行也可能使同栈其他旧Change Set失效/被AWS移除。

**必须新确认的风险：** Service不在计划内且Mode=STANDARD，但模板仍DesiredCount=1、实况0且DependsOn这三条规则。当前证据不能保证提供者依赖协调后仍为0，亦未证明必然启动。若出现任务启动，可能产生Fargate/公网IPv4费用，正常托管Secret注入及应用配置的数据库/启动活动也可能发生；这不是额外Source读取授权，但不能藏在“直接ECS/Secret/数据库操作0”后面。**不接受该可能性就不执行。** 代理不会自行改DesiredCount/DependsOn、注册任务定义或增加IAM围栏，也不会在任务数变化后擅自调用停用工具。服务计数/引用偏离即使CFN UPDATE_COMPLETE也标记未验收，恢复/停用须新批准。

拟上限STS2/元数据48/Execute1，含写前准确计划/租户/Cell/规则/服务/目标组/IAM v10核对、限定状态等待及另一进程验收；不创建/删除Change Set、Stack，不直接写ELB/IAM/DNS/ECS/RDS，不更新镜像、读秘密/PEM/.env、连数据库、读任务定义环境或调度。为避免历史事件ResourceProperties携带环境内容，本清单不读DescribeStackEvents。成功门槛为同栈UPDATE_COMPLETE/DisableRollback=true、计划EXECUTE_COMPLETE、两参数对齐新Cell输出、三新规则物理ID及完整Host/path/priority/action正确、其余四物理ID/18参数/标签/角色和服务0/0/0/:12保持；CFN计划形状本身不是这些结果的证明。

接受跨服务非CAS、并发、IAM传播、AWS Login刷新失败、Source/SCP/提供者兼容性、部分完成及收费遗留、网络/提供者日志等风险；失败或超时不重发，超时不取消AWS操作，不自动回滚/补齐/停费。最晚启动 **温尼伯11月7日03:03:42.258 CST（09:03:42.258Z）**，原依赖09:18:42.258Z终点不延期，为执行预留15分钟；不是资源到期。30项本地检查及定向lint通过。**当前仅等待这一份新的执行及依赖风险明确批准**；若不接受风险，停在此处等待方向，不自动扩大为Service修复。DNS单条更新与镜像仍分开，不进入业务测试。

## 最新结果：B 最小 IAM 修正已安装并独立核验

用户确认准确清单 `e6b6b5fd1d391e7e28550210e03b30d1d8a03487a2acb53bdad5c008992f8e5b` 后，执行时工程HEAD为 `990ea7a3e9c77e5c1d94718c6bf48dfcc0f8b293`；私有配方由原件摘要绑定。写前匹配角色/边界/trust、v9正文/三版本/使用计数、Cell输出及443/8443。05:38:11.404Z保存单次意图，05:38:12.809Z收到ACK，另进程于 **2026-11-07T05:38:31.752Z（温尼伯11月6日23:38:31.752 CST）** 独立核验。

当前默认 **v10**，正文规范SHA `965641d5116d7cbf843e7de070d84c17fc010d1cb2606f459edf463d172180f6`、6140字符，v7/v8/v9全保留。恰新增两条DescribeTags路径、移除受审五Sid，旧路径及其他授权保持；role ID/trust/空inline/单附加/boundary和使用计数不变。新读取覆盖持续保留，不自动撤权；不证明Source/SCP或未来CFN执行一定成功。

实际STS2/元数据14/CreatePolicyVersion1（writer 1/8/1、独立1/6/0），其他直接写0。未创建/执行Change Set、改DNS/镜像、读秘密/数据库或调用ECS/RDS写；没有重试、回滚、删版本或清理。[安装结果](../ops/deployment-baseline/tenant-b-iam-installed-20261107.json)绑定两journal和唯一意图，私有根 `.local-secrets/tenant-b-iam-e6b6b5fd-20261107-a`。执行槽已消费、不复位或重放，旧只读事实/废弃草案/批准原件保持。IAM成功不等于规则或API已恢复。

### 当前待批准：只创建未执行的租户 B Change Set

仅用已存B事实、新IAM结果及参数片段，离线准备[准确创建清单及完整风险](../ops/deployment-baseline/tenant-b-creation-review.json)，新增账号读取/写入/创建槽均0。规范JSON SHA：

`517850bfaaab521db0acff869dba7cac8759ff59dfee25be239115b111723f02`

**仅CreateChangeSet一次，不执行：** 准确租户UUID5867e9c0…，名称 `techlong-tenant-b-listeners-20261107t053831` 和ClientToken固定，UPDATE/UsePreviousTemplate、两新监听器参数/其余18项UsePreviousValue，原RoleARN、IncludeNestedStacks=false，无TemplateBody/URL、新IAM能力或OnStackFailure。原17项标签只从绑定私有CFN原件提取，摘要/条数固定、不公开原值或改标签。[CFN官方说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)明确计划不经执行不会应用资源变更，本阶段禁止Execute。

上限STS2/元数据32/Create1，含写前核对、最多10次DescribeChangeSet/300秒只读等待及另一进程回读；Execute/Delete Change Set、Create/UpdateStack、IAM/DNS/ECS/RDS/镜像/秘密/数据库/dispatch均0。写前匹配身份、原租户Original/七项CFN记录/旧参数/标签/空待审列表、idle服务及:12引用、目标组/四其他输入、新输出/监听器/空优先级及IAM v10。只读CFN记录不代表三旧规则实体仍在，本次不会创建三条规则实体。

**接受门槛：** 准确返回ARN为CREATE_COMPLETE/AVAILABLE，恰三条规则Modify/Replacement=True、仅ListenerArn变化；拒绝Add/Remove/Import/Conditional、嵌套/不完整计划或Service/TaskDefinition/目标组/日志变化。提交请求两参数/18保留、角色/标签保持，提议Original仍d705…；已应用Original、七CFN物理记录、参数/标签/角色和服务0/0/0/:12不变。形状匹配不证明未来执行许可或服务保持；声明1/实况0与DependsOn风险保留，不暗改模板。

**完整风险及失败策略：** 跨服务/元数据读写无CAS，Source PassRole/SCP/提供者兼容性、AWS Login刷新和并发变化仍有风险。既有私有标签及含NoEcho占位的CFN元数据仅进入必要本机进程/私有证据，不读Secret值。接受网络/提供者日志、低额非零费用和未执行/失败计划遗留，ALB继续收费。提交前封存永久尝试；失败、未知提交、超时不重发同token/换名，不自动删除/执行/回滚/补齐/复位，只在预算内读取确认，超时不取消AWS内部动作。不自动撤销新IAM覆盖，不设置资源到期或停费。

**最晚启动仍为温尼伯11月7日03:08:42.258 CST（09:08:42.258Z）**，原复用事实09:18:42.258Z终点不因IAM成功/材料生成延期；不是资源自动停止时间。27项本地检查及定向lint通过。**当前唯一继续点只等这份“仅创建”批准**，不重读整套事实或提前创建。实际执行该计划的失败/回滚策略、服务保持风险及准确DNS单条更新仍分别审批，镜像不动。

## 当前事实：B 只读核对完成，仅待最小 IAM 修正审批

本节是IAM安装前原始事实/审批，已由顶部v10结果接续；下方“待批准IAM”不再是重放指令。

用户批准上一轮明确的STS1＋元数据35上限后，本轮以源码 `100e7fa6691c15dafbea4435dfd758425ab8c11d` 完成准确Source身份及集中核对。新事实起点 **2026-11-07T05:22:39.102Z（温尼伯11月6日23:22:39.102 CST）**；实际STS1/元数据22（主记录21＋准确policy版本补读1），AWS写/秘密值/PEM/.env/数据库/任务定义环境/Change Set/执行槽均0，无自动重试。使用官方全球IAM/Route53端点并以us-east-1签名，不在美东创建资源。公开官方文档访问不计入账号API调用。

[事实摘要及原件指纹](../ops/deployment-baseline/tenant-b-preflight-20261107.json)确认：

- Cell仍为A2新729e输出，ALB active；租户Original SHA仍为归档d705…，两个参数仍241081，其余四跨栈输入匹配。CFN记录七项CREATE_COMPLETE，**不代表七实体都存在**：三旧规则分别返回RuleNotFound。新443优先级100/101、8443优先级100均空闲，原目标组仍在且没有ALB关联；无待执行租户Change Set。
- CFN的TenantTaskDefinition物理ID和实际Service引用均为`:12`，此前这一项未知已消除。服务仍0/0/0，Original DesiredCount=1的漂移保持；没有读取任务定义内容/环境，也没有启动服务。三规则门禁、DependsOn及后续服务保持风险不放宽。
- 租户执行角色只有一项附加托管policy，同一policy也是boundary，默认v9；现存v7/v8/v9，仅此一个role附加和一个boundary使用计数。`C5gExactListenerRulesTags` 的DescribeTags仅覆盖旧241081两条规则前缀，不覆盖729e。其他已读取创建/删除/标签动作声明覆盖新旧Cell子路径；这不是Source写权限、SCP或未来CFN运行成功的证明。
- 准确API A Alias仍为 `techlong-sandbox-cell-sandbox-1-1584188584.ca-central-1.elb.amazonaws.com.`，并非新Cell的1581133878，EvaluateTargetHealth=false；未改DNS。B规则归属、API DNS及镜像仍须依次收敛，不能称API已恢复。

### 待批准：仅现有 IAM policy 一次版本更新

准确[审批清单](../ops/deployment-baseline/tenant-b-iam-review.json)规范JSON SHA：

`e6b6b5fd1d391e7e28550210e03b30d1d8a03487a2acb53bdad5c008992f8e5b`

仅一次 `iam:CreatePolicyVersion`，准确policy `TechlongSandboxCloudFormationExecutionBoundary`，`SetAsDefault=true`；[候选正文](../ops/deployment-baseline/tenant-b-iam-policy-draft.json) SHA `965641d5116d7cbf843e7de070d84c17fc010d1cb2606f459edf463d172180f6`。向上述DescribeTags语句**追加新729e两个准确监听器下的规则ARN前缀，保留旧241081两条**，供CFN替换期间读取旧引用；不扩大Action，不用任意Cell/监听器通配符，不挂新policy或换角色/boundary。

离线检查发现，v9去空白6086字符，直接追加会达6372，超出[官方托管policy 6144字符限额](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)。因此候选只额外去掉五个[可选Sid说明标识](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_sid.html)，最终6140字符；五项完整原名/索引在清单exactDiff中保留，目标C5g标签语句Sid保留。逆向加回五个Sid并移除新增两路径，规范SHA**精确还原实读v9** `cfeac9114e3f487855cab5bb5f0c7cc49b5a2291170dc30d2953338aac57e1b8`；所有Effect/Action/Condition、其他Resource和语句顺序不变。后续本地检查不能再假定那五个标签存在，不自动修改历史脚本。初稿63cd…因超限在本地废弃，未获批准/调用IAM，副本留在私有目录，不作为执行依据。

**明确范围与风险：** 当前policy既附加给角色又充当其boundary，因此新默认版本会同时影响两处；只增加两个新前缀的DescribeTags读取，覆盖各前缀下未来生成的规则ID，不是只限已知三个旧ID。[IAM边界说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)解释了两者交集，其他SCP/显式拒绝仍可能影响实际权限。新覆盖持续保留，不是临时grant，不自动撤权。新增一个默认版本，v7/v8/v9全保留；[官方API](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicyVersion.html)最多保留五版本，本次现有三版，不需要删除旧版；若执行前达到五版则停止，不能清旧版腾位。全程最多STS2/元数据20/CreatePolicyVersion1，其他IAM写、CFN/DNS/ECS/RDS/镜像/秘密/数据库/dispatch均0。

写前须匹配准确身份、role ID/trust/空inline/单附加与boundary、policy ID/默认v9/正文摘要/版本及使用计数、Cell输出和监听器，再保存不可复用的单次意图；成功后另进程核验实际返回新版本为默认、候选SHA和旧版本/角色绑定保持。IAM没有这里需要的跨读写CAS：并发、传播、AWS Login刷新失败和提交不明风险仍在；失败不重发、不自动回滚/删除版本/补齐/撤权或复位槽，只在受审预算内只读确认。现有资源继续收费，本项不设置停费或资源到期。

**最晚启动：温尼伯2026年11月7日03:08:42.258 CST（09:08:42.258Z）**。新读取自身五小时到10:22:39.102Z，但复用A2依赖的原五小时终点仍09:18:42.258Z，取较早者并预留十分钟，未重计旧事实。此为审批材料时限，不是资源到期/自动停止。24项本地检查与定向lint通过；**尚未安装IAM或获准任何写入**。本次读取批准不代替新SHA批准。

**当前唯一继续点：只等待上述单次IAM修正及完整风险确认。** 不再重复成功核对、先创建CFN计划或改DNS。IAM经另批实际安装并独立核验后，再单独审仅创建未执行的租户三规则替换Change Set；依然拒绝Service/TaskDefinition/目标组/日志变化，不修改DesiredCount/DependsOn或镜像。DNS准确单条更新仍另审。以下离线计划及A2沿革保留原时刻，不重放。

## 当前准备：B 两参数／三规则离线方案已完成

以下保留离线阶段原记录，当前只读结论及待批IAM修正见顶部；不再把这里的“待读取”当作当前指令。

本轮只复用已存A2结果和租户归档，**账号AWS调用、数据库连接、Secret/PEM/.env读取、新执行槽、Change Set及云写均0**；公开资料仅核对CFN官方说明。新增[参数片段](../ops/deployment-baseline/tenant-listener-change.template.json)和[离线计划](../ops/deployment-baseline/tenant-b-offline-plan.json)，没有新执行器或云调用入口。

准确目标仍为租户栈UUID `5867e9c0-d60d-11f1-b2c0-02ffdbfa6b13`，不使用已删除的旧UUID。`UsePreviousTemplate=true`，仅把 `HttpsListenerArn`、`ControlListenerArn` 换成A2独立核验的Cell新输出；其余18参数全部 `UsePreviousValue=true`，含ImageUri。片段规范SHA `0b96f5a37a0aed5096cda0834e8f3ed0189b89b1b2215f58c6b95441dc830585` **是候选指纹，不是执行批准**；没有Change Set ARN、有效执行SHA或新的事实时刻。

| 租户逻辑ID | 新监听器尾ID | 原优先级／动作（保持） |
| --- | --- | --- |
| TenantBusinessControlDenyRule | 443：31e6577b666f0de1 | 100；准确Host＋两控制路径，固定404 |
| TenantListenerRule | 443：31e6577b666f0de1 | 101；准确Host转发原目标组 |
| TenantControlListenerRule | 8443：864f7b1cd42d3f8d | 100；准确Host＋两控制路径转发原目标组 |

三条均属于ALB新代 `729e0854244ceff6`。[官方ListenerRule说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-elasticloadbalancingv2-listenerrule.html)规定修改ListenerArn需要替换。后续实际计划必须恰三项 **Modify / Replacement="True"**，不能出现Add/Remove/Import/Conditional或Service、TaskDefinition、TargetGroup、LogGroup变化；规则优先级、Host/path、动作、目标组保持。现有离线review函数只检查传入数据的计划形状，**不证明执行权限、18参数实际保留、物理归属或服务不变**，也不代表已经创建过该计划。

**服务漂移必须先核对，不暗改模板。** 归档Original SHA `d705b4d9b96fb5521e1564aaac0693ca4e2327dcf32dfb07e27c0efec8a98779` 中Service仍为DesiredCount=1、TaskDefinition引用栈内定义，且DependsOn上述三条规则；04:51:55.105Z已存实况却是0/0/0、服务引用revision:12。CFN TaskDefinition实际物理ID本阶段未读取，不能断言它等于服务的:12。[官方DependsOn说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-dependson.html)称依赖更新资源的资源也会自动更新，但CFN不改变这些自动更新资源，相关更新权限仍可能需要。因此这**不是已证明会启动任务的故障**；也不能仅凭三规则计划形状，保证跨服务漂移和引用全部安全。下一步先比较真实Original、CFN物理ID与服务引用/数量。保持三规则门禁，不自行去掉DependsOn、把DesiredCount改0、注册新任务定义或扩大Service变更。

**权限尚待证明。** 历史材料曾把执行boundary的两条规则DescribeTags路径绑定到241081代；本阶段没有读取现行租户role/inline/managed/boundary，不能称当前仍是旧版本或已确定只需两条替换。离线计划列出729e代两条准确规则ARN命名空间，后续只核对新监听器/规则的读取、创建、标签及旧规则删除路径，不安装权限。新443的100/101、8443的100是否空闲、三旧规则是否缺失、原目标组是否仍在均未刷新。API Alias另核对另审，不夹带DNS写；本轮不证明API恢复。

**下一唯一动作：另审一次限定只读收敛核对。** 既有Source身份最多STS1＋AWS元数据35，只核对准确Cell/租户Original与物理ID、服务数量及任务定义ARN（不DescribeTaskDefinition或读环境变量）、新旧监听器/规则/目标组、现有执行角色策略和准确API DNS。复用仍有效A2原件，不全量重读；旧时刻不重计，变化或过期只补必要事实。不得读Secret值/PEM/.env、连接数据库、写AWS、创建Change Set、消费执行槽或调度。失败停止、不自动重试；接受凭据内存、网络/提供者日志及低额非零费用。读取通过后才准备准确创建审批；必要IAM差异单列，不在本次安装。

本轮21项本地基线/片段/边界检查与定向lint通过；不是新的云核验或远程CI通过。ALB仍按上轮实际结果运行、可能持续收费，本轮不设新到期/自动停止，不调用临时止费工具；不启RDS/ECS、不改镜像。以下A2原件、时刻和历史待审文字全部保留。

## 最新结果：A2 已执行并独立核验，Cell 四项归属恢复

用户明确确认执行清单 `a4c1b41b6b5d9fa3a9a1883994aeebbc4b514390e8b392964bf93b25f59512a9` 后，本轮仅一次ExecuteChangeSet，显式DisableRollback=true。执行源码 `5f1db521b57861272b035c5fa30fb7cfd923d09a`；04:52:04.090Z收到ACK、04:54:23.776Z观察到UPDATE_COMPLETE，另进程于 **2026-11-07T04:55:14.610Z（温尼伯11月6日22:55:14.610 CST）** 完成独立核验，结果 `A2_EXECUTED_CELL_FOUR_RESOURCES_INDEPENDENTLY_VERIFIED`。

- 准确Cell栈UUID保持，实际Original等于A2的16项模板，SHA `e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`，Change Set为EXECUTE_COMPLETE。十二项保留物理ID不变，四新物理ID由同一Cell栈返回；本次只证明这四项归属及约定属性，不称三栈或全部保留属性都已无漂移。
- 新ALB代为 `729e0854244ceff6`，active，准确VPC/两子网/SG/三项ALB属性和声明标签匹配；只读观察到2个公网IPv4。443业务监听器尾ID `31e6577b666f0de1`，8443控制监听器尾ID `864f7b1cd42d3f8d`；证书/TLS及默认404均匹配，8443为mTLS verify、原trust store、IgnoreClientCertificateExpiry=false。共享拒绝规则尾ID `ec016710498b01e6` 在443优先级1，两控制路径返回固定404；没有新租户转发规则。
- 两监听器Outputs已恢复且分别等于CFN新物理ARN，其余五输出、四参数、六标签和执行角色保持；新ALB DNS为 `techlong-sandbox-cell-sandbox-1-1581133878.ca-central-1.elb.amazonaws.com`，CanonicalHostedZoneId为 `ZQSVJUPU6J1EY`。完整准确ARN与新输出见[公开结果](../ops/deployment-baseline/cell-a2-executed-20261107.json)，不从旧代推导下一步参数。
- 本阶段实际STS2/元数据50/Execute1，其他直接AWS写0（writer 1/35/1，独立 1/15/0）。未调用RDS、ECS写、IAM/DNS/镜像/清理器变更、Secret/PEM或业务HTTP；没有主动回滚、重试、清理或重建Change Set。CFN提供者内部动作不计作代理直接调用。

私有证据根 `.local-secrets/cell-a2-execute-c51436f8`；独立journal规范SHA `4c7abb6a0d4bfc15d17ab69fbea1a14505aabf081ecc56c1fb6d40feceb5e2e9`。执行槽已消费，A1、A2创建/审批及a/b/c历史原件保持，不重放或复位；后续文档HEAD不是执行源码。

公开结果已与writer/独立journal及执行前两项租户参数逐项对齐；17项本地基线/结果边界检查、定向零警告lint通过。这些检查不代替上述真实独立云核验，不声称新文档提交已跑远程CI。

**ALB现已运行并可能持续收费。** 本轮不安装自动停止、不改历史ExpiresAt或原清理计划、不调用临时止费工具；原50USD/月仅目标，账单和折扣未读取，不能保证保留或自动停费。后续按用户通知/另审范围停用，不能把本轮成功当作停费证明。

**A2完成时继续点为离线准备B，现已完成，见顶部。** 本次执行前04:51:53.585Z读取的租户两个监听器参数仍为旧代241081，未改为Cell新代729e；这不是执行后额外查询。三规则实体和API DNS本轮未重新核对或更新。A2通过不等于租户API恢复，平台漂移、租户绑定及DNS仍未收敛，不做业务测试或直接开始镜像更新。原依赖04:18事实不因本轮成功重计期限。

## 待批准：仅执行既有 A2，恢复 Cell 四项声明

以下为已获批且只执行一次的审批记录，由顶部真实结果替代，不再等待或重放此执行批准。

本轮仅用已存创建/独立原件准备执行审批，并核对公开AWS价格和失败策略说明；**账号AWS调用、云写、Secret/PEM/配置读取、数据库连接和新执行槽均为0**。不为准备材料重复资源预检，不重建A2，不把新材料时间当作新依赖事实。

准确[执行清单](../ops/deployment-baseline/cell-a2-execution-review.json)规范JSON SHA：

`a4c1b41b6b5d9fa3a9a1883994aeebbc4b514390e8b392964bf93b25f59512a9`

- 仅一次ExecuteChangeSet，绑定完整Cell栈及现有A2 ARN `c51436f8-6086-413d-9b5e-a4897b8522c2`，固定ClientRequestToken，显式 `DisableRollback=true`。CFN按已核验模板恢复ALB、443/8443监听器、共享拒绝规则四项声明及两个输出；不直接调用ELB创建/修改，不新增IAM、不启动ECS/RDS、不改租户参数/三规则、API DNS或镜像。四项声明不等于AWS底层对象总数，ALB会有服务托管网络接口/公网IP及默认规则。
- 获批后写前核对准确身份、A2仍是唯一CREATE_COMPLETE/AVAILABLE变更集、四Add/模板及A1十二物理ID/输入匹配、同名ALB仍缺失、原角色权限指纹及Cell扫描仍DISABLED、已知租户/集群仍空闲。其余必要依赖复用有效事实、提交前核对准确引用；事实变更或过期停止，不覆盖、不创建替代计划、不修改清理计划或旧到期标签。证据、费用和候选摘要均被执行清单显式绑定。
- 代理直接API上限：Execute1、STS2、限定元数据80、只读等待最多600秒；只访问准确Cell/A2、已知租户、固定角色/依赖/清理计划及本栈返回的新物理ID，IAM全局端点用us-east-1签名。CFN提供者内部并行/重试不计入代理直接次数。等待超时不表示AWS停止创建或收费，不自行取消/清理。
- **失败保留现场：** 意图先持久化，提交后失败或回执不明均不重发（包括同token），不主动Rollback/ContinueUpdateRollback/DeleteStack、补建、删除或复位槽。禁用整体失败回滚不等于所有资源级恢复绝不发生；失败资源仍可能被CFN恢复到稳定状态。与OnStackFailure或RollbackTriggers设置冲突就停止，不去掉DisableRollback后重试。[ExecuteChangeSet参数](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)、[AWS失败保留说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)。可能停在UPDATE_FAILED或部分创建并持续收费，后续修复/清理另审。
- **成功门槛：** 另一进程确认同栈UPDATE_COMPLETE、Original等于A2；十二保留物理ID不变、四新物理ID确由Cell拥有，ALB active且VPC/子网/SG/三属性匹配。独立回读443证书/TLS/默认404、8443 mTLS verify/准确trust store/不忽略到期/默认404、共享拒绝规则优先级1及两个路径；两输出必须等于新的实际监听器ARN，其余五输出、参数、标签、角色保持。只保存真实新ARN/DNSName/CanonicalHostedZoneId；不执行业务HTTP、不读取控制私密包。通过A2不代表租户三规则/DNS已接通或API已恢复。

### 本轮增量费用与持续收费风险

[公开费用估算及来源版本](../ops/deployment-baseline/cell-a2-cost-estimate.json)按2026-11-07T04:37公开目录观察（温尼伯11月6日22:37），ca-central-1：ALB **0.02475 USD/小时**、关联trust store **0.0055 USD/单位小时**、LCU **0.0088 USD/LCU小时**。来源为[AWS区域ELB价目](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ca-central-1/index.json)（版本20261105220241）。公网IPv4 **0.005 USD/地址小时**，来源为[AWS区域VPC价目](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ca-central-1/index.json)（版本20261105181945）。

按1个ALB＋1个trust store关联单位＋2个公网IPv4的**场景推算**，固定项约0.04025 USD/小时，730小时约 **29.38 USD/月**；2小时约0.0805 USD。每持续1 LCU再约6.424 USD/月。此处2小时只作算例，不是新租约或自动停止时间。IPv4可能扩容，实际LCU、流量、税和其他资源不在固定项内，短时ALB还涉及整小时计费，不假设免费额度/折扣，**不是费用上限，也不保证全账号50 USD/月**。[ELB计费规则](https://aws.amazon.com/elasticloadbalancing/pricing/)、[公网IPv4规则](https://aws.amazon.com/vpc/pricing/)。本轮未读取账号账单或启动原数据库/平台/租户服务。

旧 `ExpiresAt=2026-10-15T16:44:56.246Z` 和CellExpiresAt仍保留，不新增到期、不续期、不删除标签。执行前Cell扫描必须仍DISABLED，global tenant扫描仍ENABLED，已知租户不得新增ExpiresAt；部署中的清理器同源性及外部并发仍未证明，**不能保证永不被外部清理，也不能保证自动停费**。本轮不运行或并行使用临时启停工具、不安装到期定时器；失败留下ALB时报告收费状态，代理不自动删除。用户之后通知停止或准确清理批准另行处理。

**最晚启动：温尼伯2026年11月7日03:03:42.258 CST（09:03:42.258Z）**。依赖仍取原04:18:42.258Z，五小时到09:18:42.258Z，预留15分钟用于本次受审执行/独立核验；材料和公开价格观察不延期资源事实。这是审批时限，不是资源寿命。16项本地基线/费用/审批边界检查通过；本轮未执行，准确SHA仍待用户确认。后继唯一方向为A2完成后另审B租户两参数/三规则及API DNS，不开始镜像更新。

## 最新结果：A2 已创建并独立核验，未执行

用户确认清单 `23ee54ae7fdcd573f4895baa425276d0d8779c47f1a2b2341a69d8056f1dd0ac` 后，准确执行源码 `21cb21805103f2f9b3f6945a281c9b6c2604177c` 仅提交一次CreateChangeSet，并由另一进程完成独立只读回读。A2完整ARN：

`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-cell-a2-reattach-20261107t041842/c51436f8-6086-413d-9b5e-a4897b8522c2`

AWS CreationTime原值为2026-11-07T04:30:39.203000+00:00；独立核验于04:32:19.826Z（温尼伯11月6日22:32:19.826 CST）完成，结果 `A2_CREATED_VERIFIED_NOT_EXECUTED`，Change Set为 `CREATE_COMPLETE / AVAILABLE`。

- 真实计划恰为原四逻辑ID的Add，零Modify/Remove/Import；没有嵌套栈或已分配的新物理ID。Change Set Original的规范SHA为原候选 `e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`；四原参数/六标签保持。
- 栈仍 `UPDATE_COMPLETE`，已应用Original仍为A1的SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`；十二项保留物理ID、参数、标签、五输出和执行角色未变，两个监听器输出仍不存在。准确ALB名称仍返回LoadBalancerNotFound；**尚未恢复ALB或完成Cell归属修复**。
- 本阶段实际STS2、元数据19、CreateChangeSet1；Execute/Delete/其他直接AWS写均0。writer为1/13/1，独立为1/6/0，不计CFN内部验证调用。没有IAM、DNS、数据库/ECS启动、镜像、清理器变更或dispatch；没有写重试、替代创建或自动清理。不以此推断数据库现状或全账号零费用。

[公开创建结果](../ops/deployment-baseline/cell-a2-created-20261107.json)与私有证据根 `.local-secrets/cell-a2-create-20261107t041842` 保持；独立journal规范SHA `b0e8b929d3ffc3316e7e4250388d06bff6578cee7a9c28d98a9e00aa75e72573`。创建尝试已消费，原创建审批材料和a/b/c失败/补核记录保留，不重建A2、不复位目录。新文档提交不是上述执行源码。

收尾逐项核对公开结果与两份私有journal/摘要一致，14项本地基线及结果边界检查、定向零警告lint通过。这些检查不代替云端独立回读，也不声称新提交已通过远程CI。

**当前唯一继续点：单独审核执行这一份既有A2**，明确会创建收费ALB及其监听器/规则、历史标签/清理风险和失败/回滚策略，再给准确执行SHA；本次创建批准不包含这些动作。执行前须核对它仍AVAILABLE及必要事实仍有效，不因新ARN生成而重计原04:18:42.258Z依赖采样。不得自动执行、直接UpdateStack、替代创建或进入租户三规则/DNS/镜像；下一阶段的实际新读/写仍按准确范围审批。

## 当前审批：A2 仅创建未执行清单已准备

以下是已获批且只执行过一次的创建阶段准备记录，现由顶部独立结果替代，不再等待创建批准或重放此清单。

用户刷新 Source 并允许新一轮同范围读取后，b/c 联合核验已完成；a 失败记录保留，不重放。新事实从2026-11-07T04:18:42.258Z（温尼伯11月6日22:18:42.258 CST）计时，04:21:52.369Z完成，五小时事实终点固定为09:18:42.258Z；c补读没有重新起算。完整去敏[只读结果](../ops/deployment-baseline/cell-a2-preflight-20261107.json)和私有原件摘要已保存。

- 准确 IAM Source 已核实；同一 Cell `UPDATE_COMPLETE`、Original 为 A1 的十二资源模板，十二项物理 ID与四参数/标签/五输出/角色保持；当前 Change Set 列表为空，同名 ALB缺失。
- 原两子网/SG归属、443/8443及任务3000入口、证书ISSUED、trust store ACTIVE匹配；执行角色RoleId、trust、原inline及boundary v1匹配，无附加managed policy。
- Cell扫描DISABLED、tenant扫描ENABLED，准确租户没有ExpiresAt标签，服务0/0/0、Cell运行及待启动任务0。未调用清理器，也未证明部署中的清理器代码与仓库完全一致。
- 本轮实用STS1、元数据尝试22（21次成功/预期缺失＋1次失败）、所有云写/秘密值/数据库/执行槽均0。b的第10次元数据IAM GetRole因本地固定端点仍使用ca-central-1签名而返回SignatureDoesNotMatch；本地AWS SDK端点规则确认全局IAM签名区为us-east-1，c在同一30次总预算内仅补12次未完成项，未再STS或重读前九项资源。成功补读也只访问全球IAM，不是在美东创建资源。b的失败原件保持，没有修改云权限或持久AWS配置。

准确[仅创建清单](../ops/deployment-baseline/cell-a2-creation-review.json)规范JSON SHA：

`23ee54ae7fdcd573f4895baa425276d0d8779c47f1a2b2341a69d8056f1dd0ac`

**待批准范围仅是一次 CreateChangeSet，不执行：** 准确同一Cell栈，名称 `techlong-cell-a2-reattach-20261107t041842`，固定ClientToken，原A2候选摘要、四参数UsePreviousValue、原角色及六标签原样保留；不附OnStackFailure，IncludeNestedStacks=false。写前保存唯一意图/尝试记录并核对身份、A1模板/十二物理ID、空变更集、ALB缺失及角色指纹。最多STS2/限定元数据30、只读等待300秒，独立回读准确新ARN、模板正文及四Add/零Modify、Remove、Import；栈本身仍须A1中间态，ALB仍不存在。次数不含CFN提供者内部动作；不模拟或声称已证明Source PassRole/SCP的有效创建权限。

**停止与风险：** 创建请求提交失败、结果不明或超时后不重发（包括同token）、不删除或替换失败记录，不执行A2，不主动回滚/清理；仅在获准读取上限内独立确认。接受非原子/并发、凭据内存与AWS Login自动刷新失败、未执行记录可能遗留、提供者验证/日志及低额非零费用。永久尝试不复位。没有ALB恢复、数据库/ECS启动、IAM/DNS/镜像/标签期限变更或dispatch授权；完整风险见机器清单。本阶段不创建收费ALB，但不能据此宣称全账号零费用。实际ALB执行及其失败策略仍必须按将来的准确Change Set另审，A1的DisableRollback批准不沿用。

**最晚启动：温尼伯2026年11月7日03:08:42.258 CST（09:08:42.258Z）**，在原五小时事实终点前预留10分钟，不因本地材料生成而延期；这是审批材料时限，不是资源到期。过期/事实变化就停止，不改日期重用。13项本地基线/清单一致性检查及定向零警告lint通过，尚未创建A2、没有实际四Add云计划或恢复证明。

**当前唯一继续点：等待用户确认上述SHA，仅创建并独立核对这份未执行A2。** 不再次刷新Source或重复整个预检，不开始B租户规则、DNS或镜像。a/b/c、A1原件及离线候选不改写为新批准。

## 当前停止点：A2 只读准备在身份核对处停止

以下是a的历史停止点，现已由顶部b/c核验和待审清单替代，不再等待重复刷新Source。

用户允许最多1次STS＋30次元数据后，新记录a于2026-11-07T02:14:08.550Z开始，02:14:12.366Z停止（温尼伯11月6日20:14:12.366 CST）。官方CLI首次 `sts:get-caller-identity` 报告去敏分类 `CREDENTIALS_UNAVAILABLE`；准确身份未确认，不断言具体失效原因或HTTP是否已经发出。实际STS尝试1、资源元数据读取0、AWS写/Secret值/数据库连接/执行槽/Change Set均0，没有新的资源现状证明或待审SHA；旧依赖采样不延期。

[公开停止摘要](../ops/deployment-baseline/cell-a2-readonly-20261107-a.json)；私有原件 `.local-secrets/cell-a2-readonly-20261107-a/journal.json`，原始字节SHA `05fd89e913d564dbcdf5461f8273ba95e385a558f74ae4b7147b6a65867cf55d`。a保留且不重跑，不自动沿用未使用的元数据次数。**下一只请用户完成 `aws login --profile techlong-sandbox-user`，并允许新一轮同范围只读核对**，再用新的记录继续；不额外诊断STS、不生成假新鲜清单、不创建或执行A2、不恢复ALB。下方离线候选保持可复用，但不是云执行许可。

## 当前准备：A2 四项 Add 离线候选已完成（2026-11-06）

本轮按用户明确要求**仅离线准备**。已从封存原件提取 A1 前实际 Cell Original，核对其规范 SHA 与修复前基线一致，再证明：从该模板移除下表四项及两个输出，全文恰等于已执行 A1 模板。不是重新渲染默认模板，也没有用旧物理 ARN 填入新资源。

- [完整 A2 候选模板](../ops/deployment-baseline/cell-reattach-draft.template.json)，规范 SHA `e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`，与 A1 前 Original 相同；这是**内容指纹，不是执行批准 SHA**。
- [机器方案与未授权边界](../ops/deployment-baseline/cell-a2-offline-plan.json)：`OFFLINE_DRAFT_NOT_EXECUTABLE`；尚无新现场快照、审批 SHA、A2 Change Set ID、执行请求或有效执行期限。

| A2 唯一允许的资源差异 | 复用原声明的行为 |
| --- | --- |
| `CellLoadBalancer`，Add | 原名称的 internet-facing / IPv4 ALB；引用现有两个子网与 ALB SG；原默认路由依赖、三个属性及标签保持 |
| `BusinessHttpsListener`，Add | HTTPS 443，原证书参数、TLS 策略，默认固定 404 |
| `ControlMtlsListener`，Add | HTTPS 8443，原证书/TLS；mTLS `verify`、原 trust store 参数、`IgnoreClientCertificateExpiry=false`；默认固定 404 |
| `BusinessControlDenyRule`，Add | 443 的优先级1，`/api/saas` 与 `/api/saas/*` 固定404，不接入任何租户目标组 |

同时恢复 `HttpsListenerArn → Ref BusinessHttpsListener`、`ControlListenerArn → Ref ControlMtlsListener` 两输出，由 CFN 返回新 ARN。其余十二资源的全部声明、五输出、Metadata、Rules 和四参数定义均不变；四参数全部 `UsePreviousValue`，现有执行角色和栈标签须原样保留。预期仅四 Add、零 Modify/Remove/Import/嵌套栈，实际 Change Set 必须逐项证明，不能仅凭模板的本地差异判定云计划合格。

### 后续集中顺序与停止条件（本轮不执行）

1. **另获限定只读许可后补必要现状。** 准确 Source/账号/区域和同一 Cell UUID；提交前核对栈仍为 A1 `UPDATE_COMPLETE`、Original 摘要及十二保留物理 ID 匹配、无并发栈操作或未审变更集、同名 ALB 缺失。原证书/trust store、两子网/SG及 VPC、现有角色/trust/inline/boundary、已知租户空闲及两个清理计划的依赖事实，仍在原五小时内且未变化的继续复用，只补过期或明确变化项，不重跑整套旧预检。限既有资源元数据，不读 Secret、PEM、配置或数据库；不调用启停工具。旧 A1/依赖观察只保留真实时间，不从本次离线生成时间重新计算新鲜度。
2. **据真实事实另审“只创建、不执行 A2”。** 准确清单绑定同一栈、候选 SHA、四个原参数、现有角色/标签及新的唯一变更集名称/请求 token；最多一次 CreateChangeSet，独立回读实际四 Add和候选正文。不能附带 Execute/UpdateStack/Delete/权限修改。无 Add 物理 ID 现在可填；若真实计划含保留资源变更、额外资源、参数漂移或 IAM 不足，立即停止报告，不绕角色、不导入/手工创建、不自动重试或删除失败变更集。
3. **只有真实 A2 创建及独立核对通过后，再单独审批执行。** 绑定其完整 ARN、最新事实、费用、失败策略及独立验收范围。建议继续显式 `DisableRollback=true`、保留部分现场、代理不重发/主动回滚或清理，但该建议**尚未批准**，A1 的批准不沿用；CFN 提供者内部恢复仍可能发生。创建/执行阶段的配置必须无冲突，不能因冲突去掉该参数重试。执行后即使 ECS 为0，ALB仍可能持续收费；失败/超时也可能留下收费资源，停费或清理另审。
4. **执行后独立验收是进入 B 的门槛。** 同一栈 `UPDATE_COMPLETE`、Original 与候选一致；十二保留物理 ID不变、四新 ID均由本栈管理；新 ALB active且 VPC/两子网/SG/属性匹配。准确回读443/8443端口、证书/TLS、两默认404、8443 mTLS各字段及共享拒绝规则；两输出分别等于新监听器物理 ID，并属于新 ALB。保存真实 ID/DNSName/CanonicalHostedZoneId，不从历史映射推导。未全部通过就不准备租户两参数/三规则或 API DNS 的实际更新。

**历史到期风险明确保留：** 候选含原 `2026-10-15T16:44:56.246Z` 标签和 CellExpiresAt 输出，未添加、删除或延长到期时间。最近历史观察是 Cell 扫描关闭、全局 tenant 扫描开启，不能当作当前保证；A2 前必须核对。如果现有清理会触及新 ALB/栈，或用户要改标签/清理策略，需先单列准确差异另审，不能塞入“四 Add”修复，也不能声称本候选保证常驻。

本轮 AWS/STS、数据库连接、Secret/PEM读取、槽消费、Change Set/资源创建和 dispatch 均为0；仅读取本地已存模板与公开摘要。12项本地基线检查（含4项 A2 差异、TLS/mTLS、引用及未授权边界回归）及定向零警告 lint 通过，不是 AWS ValidateTemplate、远程 CI 或真实云计划/恢复证明。未增加执行器、工作流或启停框架。

**下一唯一动作：另审必要的限定只读核对，生成仅创建未执行 A2 Change Set 的准确审批材料。** 本轮到此收尾；不直接创建/执行 A2，不恢复 ALB/数据库/ECS，不改租户、DNS、IAM、镜像或到期清理。

## 最新结果：A1 已执行并独立核验（2026-11-06）

用户确认清单 `87a80dc7abd91501820ac1d48333613dc283429f40bbba4e0e8a974b7e5b3ed9` 及失败策略后，仅一次执行原 A1 `2e95d3a1-8cdf-4948-a779-eff36394f627`，显式 `DisableRollback=true`。20:07:51.856Z 收到 ACK，20:08:04.483Z 观察到 Cell `UPDATE_COMPLETE`；另一进程于20:09:32.860Z（温尼伯14:09:32.860 CST）完成独立只读核验，结果 `A1_DETACHED_INDEPENDENTLY_VERIFIED`。执行源码为 `23aca56673631a75e5d242f85afc26391522f176`；此后的结果文档提交不冒充执行源码。

- 实际 Original 等于 A1 十二资源模板，规范 SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`；四项失效声明不再是活动归属，Change Set 为 `EXECUTE_COMPLETE`。
- 十二项保留资源的逻辑 ID、类型及物理 ID 与执行前一致；`HttpsListenerArn`、`ControlListenerArn` 两输出移除，其余五输出、标签及执行角色保持。该比较不等于完整资源属性漂移扫描。
- 准确名称 ALB 仍返回 `LoadBalancerNotFound`。没有重建 ALB、启动数据库/ECS、改 IAM/DNS/镜像或清理器；没有失败重发、主动回滚或清理。A1 只解除旧声明，**没有完成 Cell/租户归属恢复**，也不证明全账号停止计费。
- 代理直接调用合计 STS2、元数据19、ExecuteChangeSet1、其他 AWS 写0（writer 1/13/1，独立 1/6/0）；不把 CFN 提供者内部调用算进代理次数。执行槽已永久消费，不重放。

[公开结果摘要](../ops/deployment-baseline/cell-a1-executed-20261106.json)含准确栈/变更集、十二项物理 ID 和证据摘要。私有原件在 `.local-secrets/cell-a1-execute-87a80dc7`，独立 snapshot 规范 SHA `3e29d8e89d2d4ccad76a65c224e4e95b2aa685ff7e051f877fa63ce081ceba85`，不提交原始 API 响应。

收尾已在本地将公开摘要与已存独立原件逐项对齐（包括四参数/标签/角色），8项基线回归及定向零警告 lint 通过；这些测试只验证材料一致性，不替代上述真实云端独立核验，也不声称新文档提交已通过远程 CI。

**A1 收尾时的继续点为仅离线准备 A2 四项 Add 候选，现已按顶部完成。** A1 原件和审批记录保持；没有据 A1 批准创建/执行 A2、恢复收费 ALB 或更新租户参数/三规则、API DNS、镜像。

## 2026-11-06：A 阶段只读前置核对与 A1 候选已完成

用户要求“继续下一步”后，仅完成此范围的只读核验（Source STS 1、资源/权限元数据24次，包括预期 NotFound 回执），AWS 写、Lambda调用、Secret值/数据库读取、Change Set和镜像更新均为0。Cell Original 于19:23:02.749Z（温尼伯13:23:02.749 CST）保存到本轮内存，完整规范JSON摘要与工程基线相同；13:27:57 CST汇总[机器摘要](../ops/deployment-baseline/cell-preflight-20261106.json)，不是新的现场查询时刻，也不是批准SHA或完整原件执行包。

| 核对项 | 本轮观测及边界 |
| --- | --- |
| 准确 Cell 栈 | 原UUID/status保持；16项CFN记录；无现存Change Set |
| 实际旧资源 | 准确名称和旧ALB ARN分别 LoadBalancerNotFound；两个旧监听器均 ListenerNotFound；旧共享拒绝规则 RuleNotFound |
| 保留的网络依赖 | 两SG、两子网仍归属原Cell VPC，子网available、AZ分别a/b；CFN所有权标签匹配。未遍历其余路由/IGW属性，不称12项全部无漂移 |
| TLS依赖 | 原证书ISSUED、覆盖sandbox及其子域、2027-04-26到期；原trust store ACTIVE、1张CA证书；未读CA正文或私钥 |
| 执行角色 | 原RoleId/CFN信任保持；inline为FirstAcceptanceCellResourcesV1，boundary默认v1，未附加其他managed policy；静态Create/Delete/Tag的相应ALB路径存在。不等于证明Source PassRole、SCP或实际CFN调用一定允许 |
| 现有消费方 | 已知租户准确UUID/两旧参数保持，服务desired/running/pending=0/0/0，Cell集群running task列表为空。Cell Outputs没有Export，模板无ImportValue；不把此有限范围称为全账号消费者穷举 |
| 清理风险 | Cell的ExpiresAt仍为10月15日历史值；Cell扫描计划DISABLED。全局tenant扫描仍ENABLED，但准确租户当前Tags没有ExpiresAt。未验证部署中Lambda代码与仓库完全同源，未调用/关闭任何清理器 |

[A1候选模板](../ops/deployment-baseline/cell-detach-draft.template.json)由本次Original精确删去四项和两个Outputs派生。规范JSON SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`，不是执行批准SHA。保留十二资源属性、四参数、其他输出/规则/历史标签，不删除网络、不重计旧到期。生成时逐项比较保留资源与原件一致、无悬空旧引用；六项离线回归通过。它是给未来A1审查的完整CFN模板正文，不是声称已从栈移除资源。

**下一唯一动作：另审仅创建、不执行 A1 Change Set。** 执行前仍需核对源/身份、准确栈和并发状态；创建结果必须恰为四个Remove，其余资源无变化，才可另请执行批准。不得直接UpdateStack或同时创建A2。真实CFN删除缺失物理对象、回滚的提供者行为尚未证明；旧到期标签和现有清理状态在后继审查中明确保留或单列差异，不自动续期/关计划。有关创建/删除动作和标签授权的静态映射仅参考[AWS ELB V2授权表](https://docs.aws.amazon.com/service-authorization/latest/reference/list_elbv2.html)，没有做权限模拟或真实写入试探。

## 起点与取舍

### 批准前执行审批记录：失败保留现场，不进入A2（现已执行，见顶部）

本次只准备审批，实际ExecuteChangeSet仍为0。19:55:02.640Z新一轮STS1/元数据5确认同一A1仍CREATE_COMPLETE/AVAILABLE，原栈/角色未变、它是唯一变更集、四项Remove及模板SHA保持，同名ALB仍不存在。未追加完整25项预检或查询业务数据。

准确[执行清单](../ops/deployment-baseline/cell-a1-execution-review.json)规范JSON SHA：

`87a80dc7abd91501820ac1d48333613dc283429f40bbba4e0e8a974b7e5b3ed9`

- 仅一次ExecuteChangeSet，绑定完整栈ARN、现有A1 ARN和固定ClientRequestToken；显式 `DisableRollback=true`。不创建/删除Change Set、不UpdateStack、不RollbackStack/ContinueUpdateRollback、不调用A2、恢复工具、数据库、IAM、DNS、镜像或Lambda。
- 请求前复核准确身份、唯一A1仍AVAILABLE、四项Remove/旧物理ID和模板摘要未变、原12项物理ID及ALB仍缺失；若存在OnStackFailure或RollbackTriggers等冲突设置，停止，不能偷偷去掉DisableRollback重试。
- 提交意图先持久化。失败或回执不明均消费唯一尝试，不自动重发，包括使用同token的重试；只有获准的只读查询可以继续确认真实状态。最多2次STS、80次限定元数据读取，等待最多600秒；等待超时不代表AWS停止操作，不发送取消或回滚。
- 禁用的是整体失败回滚请求，不是“保证AWS绝无任何内部恢复”。[AWS说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)更新/变更集保留成功资源时，失败资源仍可能恢复到其最后稳定状态。若发生此类处理，只读记录和报告，不由代理追加写入。该API支持显式DisableRollback，且不能与创建阶段OnStackFailure并用：[ExecuteChangeSet参数](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。
- 接受可能停在UPDATE_FAILED、只完成部分声明移除、输出不完整，以及之后需要另审恢复。成功须准确栈UPDATE_COMPLETE、Original等于A1、两个监听器输出消失、12个保留资源物理ID保持、四项不再是活动归属（不将DELETE_COMPLETE历史行算作活动资源），并确认无ALB重建。A1成功只解除旧声明，不意味着ALB/归属恢复或产品已上线。

清单最晚启动为2026-11-07T00:23:02.749Z，即**温尼伯11月6日18:23:02.749 CST**，受原13:23依赖快照五小时限制，不从新一次窄核对重计全部依赖时间。这只是本次执行材料的事实新鲜度，不新增资源到期、不改旧ExpiresAt或JWT/MFA期限。过期不得执行本清单或只改日期，应另核必要差异。

上述次数上限只约束代理直接调用的API，不约束CloudFormation资源提供者内部的并行或重试次数。七项离线数据/边界回归通过；没有新执行框架或runner。用户须明确批准上述SHA及失败策略后才实际执行。另更正前两段温尼伯显示：11月6日为UTC-6（CST），原14:23/14:47已改为13:23/13:47；所有原UTC观察、创建时间及回执不改。

### A1 Change Set 已创建并核对，未执行（2026-11-06）

用户明确确认“仅创建、不执行A1 Change Set，核对四项Remove”后，本轮只提交一次 CreateChangeSet。变更集：

`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-cell-a1-detach-20261106t194714/2e95d3a1-8cdf-4948-a779-eff36394f627`

AWS 创建时刻19:47:24.347Z（温尼伯13:47:24.347 CST），独立只读回读19:48:07.940Z确认 CREATE_COMPLETE / AVAILABLE，准确Cell栈仍CREATE_COMPLETE、旧两个输出保持，尚未执行A1。GetTemplate对该Change Set的Original回读与A1候选SHA完全一致；四个原参数和既有执行角色/标签保持。

变更明细恰为 BusinessControlDenyRule、BusinessHttpsListener、CellLoadBalancer、ControlMtlsListener 四项Remove，PolicyAction均Delete；Add=0、Modify=0，没有网络、ECS、数据库或镜像变更项。十二项保留资源未进入变更明细，两个输出的移除反映在候选模板而不另计资源变更行。完整准确ID/类型/物理引用见[已创建结果](../ops/deployment-baseline/cell-a1-created-20261106.json)。

实际次数：STS1、writer元数据读取7、独立读取2、CreateChangeSet1、ExecuteChangeSet0、DeleteChangeSet0。提交前核对了准确栈/角色、Original摘要、空变更集列表和同名ALB仍缺失；没有重跑前轮24项预检。私有请求/ACK/变更明细保存在工程内Git忽略目录 `.local-secrets/techlong-cell-a1-detach-20261106t194714`，不提交原请求或凭据。

**创建阶段当时仅等待对此准确Change Set执行的单独批准，已由顶部执行结果替代。** 此创建记录不是额外执行许可；不再创建另一份A1，不创建A2、不恢复ALB/数据库/ECS、不改IAM、DNS、标签或镜像。当时要求执行前核验它仍AVAILABLE、准确栈和现状未变，并在新执行范围中明确失败/回滚策略；创建批准本身不授权失败回滚重建收费资源、自动重试或清理。原“尚未执行”只描述创建阶段，不描述当前结果。

上轮只读回读：Cell 栈 UUID 尾段 `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` 为 CREATE_COMPLETE，CFN 的 ALB 和两个监听器物理 ID 属于代 `77888e84c19e8b86`；租户栈 UUID 尾段 `5867e9c0-d60d-11f1-b2c0-02ffdbfa6b13` 的两个监听器参数及三个规则 ID 属于代 `241081ab25c73320`。ELB 按准确名称查询返回 LoadBalancerNotFound。11月6日手工恢复映射也是历史，不拿其中任何 ARN 填新参数。

相同模板再提交不能当作重建缺失资源的方法；不存在的资源也没有可供导入的物理对象。建议**由原栈创建新物理资源，而不是先手工创建再认领**。首选下面的分段移除失效声明、恢复原逻辑 ID 方案。能否实施取决于新鲜证据、栈依赖和实际 Change Set；不保证 CFN 对失效物理 ID 的删除或回滚一定成功。

## A. Cell：仅四项，先恢复所有者

1. **获准后先只读核对。** 绑定准确账号、区域、栈 UUID、Original、角色/boundary、四项 CFN 物理 ID、同名 ALB 与旧 ID 的缺失；核对 SG、两个子网、证书和 trust store 可用。确认两个输出未被其他栈通过 Export/ImportValue 消费，亦无未纳入的监听器消费者、栈更新或并发启停任务。检查旧到期标签/清理计划是否会在修复窗口删栈；不能静默续期或关闭清理器。若同名 ALB 已出现、权限不符或无法排除冲突，停止，不导入、不覆盖。
2. **A1，解除失效声明。** 从获准时的 Cell Original 派生中间模板：仅移除 `BusinessControlDenyRule`、`BusinessHttpsListener`、`ControlMtlsListener`、`CellLoadBalancer` 及指向两个监听器的 Outputs；确认没有悬空引用。仅接受这四个 Remove，其余 12 项不变。A1 会暂时没有监听器输出，只允许在确认已停用且无外部消费的窗口执行。单独审批、等 UPDATE_COMPLETE、独立回读后才允许准备 A2；若 CFN 删除旧记录失败或回滚，保留事件，不跳过资源、不自动重试。
3. **A2，同一栈重新声明。** 使用 A1 前核准的原四项属性、依赖和两个输出名，不用旧物理 ID。只接受四个 Add；不替换 VPC、子网、集群、安全组，不创建数据库。ALB 创建即可能收费，即使 ECS 仍为 0。若需改标签、信任库、IAM 或其他属性，另审，不把它们混入修复。
4. **A 阶段独立核验。** 同一栈的 ListStackResources 必须给出四个新物理 ID；ELB 回读准确 ALB 为 active、所用 VPC/子网/SG 与声明相符。两个输出须分别等于两个 CFN 监听器物理 ARN，并能在该 ALB 上读到。443 为 HTTPS 业务监听器；8443 为 HTTPS、mTLS `verify`、准确 TrustStoreArn、`IgnoreClientCertificateExpiry=false`；证书和 TLS 策略与模板相同，两者默认均为 404。共享拒绝规则须在 443、优先级 1、对 `/api/saas` 与 `/api/saas/*` 返回 404。任一不符，禁止进入 B。保存栈 UUID、模板摘要、新 ARN、两个输出及核验时间。

## B. 租户：仅两参数、三条规则

只使用 A 阶段刚核实且在提交前再次匹配的两个 Cell 输出。其余四个跨栈输入（集群、VPC、子网、任务 SG）与保留的目标组必须一致。检查新监听器优先级空位、旧三规则确实不存在、执行角色能访问新规则路径。旧 IAM 策略曾绑定具体监听器；权限不足则另报，不扩权或换身份绕过。

优先基于租户 Original 保留同一模板、其余 18 项参数 UsePreviousValue（**包括 ImageUri**），只改 HttpsListenerArn 与 ControlListenerArn，要求 Change Set 明确体现三条规则换到新监听器；须接受三规则的明确替换，不接受含糊的条件替换、无变更或对旧规则的普通原地修改。若实际计划无法安全替换已缺失的规则，停止另审，不在本轮自行移除规则：TenantService 对三条规则均有 DependsOn。任何 Service/TaskDefinition/TargetGroup/LogGroup 的更新或替换、启动任务、规则优先级冲突均为 No-Go。

| 租户逻辑 ID | 应归属的监听器 | 必须回读的行为 |
| --- | --- | --- |
| TenantBusinessControlDenyRule | 443，优先级 100 | 准确租户 Host + 两个控制路径 → 404 |
| TenantListenerRule | 443，优先级 101 | 准确租户 Host → 原 TenantTargetGroup |
| TenantControlListenerRule | 8443，优先级 100 | 准确租户 Host + 两个控制路径 → 同一目标组 |

独立回读：租户两个参数分别等于 A 输出；三条规则的 CFN 物理 ARN、ELB 实体、监听器、条件及动作逐项一致；原目标组物理 ID、服务、任务定义/镜像及副本数未被本次修复改变。不能仅凭 UPDATE_COMPLETE 或人工改对路由判为通过。

## DNS、停止点与移交

- 租户 API 的 A Alias 不属于这两个栈。只读核对准确 sandbox zone 中的 `first-acceptance.sandbox.techlong.cloud.`，比对新 Cell ALB 的 DNSName（规范处理尾点/dualstack 前缀）、CanonicalHostedZoneId 及既有 EvaluateTargetHealth；拒绝歧义记录。若不符，记录“规则归属已核对，DNS 未对齐”，**另批单条 DNS 差异**；不碰平台 console 或买家 CDN。DNS 匹配不代表 ECS 已启动或业务测试通过。
- A1、A2、B 均须分别核对真实 Change Set 的 ID、输入、范围及回滚影响；创建、执行和任何资源费用不由本草案授权。执行失败或结果不明时只读核对，绝不自动补建、删除、回滚或复位。A2 成功而 B 失败时，ALB 仍可能持续计费，应报告而非自动清理。
- 费用工具再次直接删除 Cell ALB 会使本次归属失效；未来执行前必须协调该工具与发布窗口，不在停用期间提前重建。本轮不改工具、锁、数据库、ECS 数量或任何 IAM。
- 只有两栈物理归属、六项跨栈绑定、DNS 全部通过，才保存修复后新基线并**另行**准备同一租户的镜像更新。平台自身的 ALB/控制器差异继续单列，不能把本次结果当作三栈全部无漂移。

</details>
