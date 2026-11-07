# Cell 与租户监听器归属修复方案及执行记录

目的：恢复既有 CloudFormation 管理关系，不发布镜像、不启动业务服务。只涉及 ca-central-1 的共享 Cell 和准确租户；不是平台 ALB 修复。**本页不是新增执行授权；下方原“待审/未执行”只保留各阶段事实，最新结果如下。** [三栈基线](aws-deployment-baseline.md)继续保留作修复前对照。

## 当前事实：B 只读核对完成，仅待最小 IAM 修正审批

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
