# 临时 AWS 测试环境启停工具

2026-11-08，v2代码改造及只读接入。仅用于本项目测试环境，正式上线后移除；不是新部署框架或全账号清空工具。**代码/合成测试与只读计划通过，不等于真实云启停已验证。** 初版代码交付阶段未调用AWS；后续只读接入以以下当前记录为准。没有读取Secret值/PEM/.env或连接数据库，环境及费用未因代码提交或计划生成而停止。

<a id="cfn-lifecycle-implementation"></a>

## 当前实现与范围

### 当前代码：仅角色回读契约已修复，162回归及准确CI通过（2026-11-13）

用户明确允许仅这一处接口校验修复与测试。本轮运行代码只移除DescribeChangeSet响应中不存在的RoleARN比较，保留CS ID/标签和准确原栈角色/UUID/标签/更新时间及执行前、执行后校验；创建请求仍省略RoleARN，适配器仍禁止指定新角色，没有新增API、权限、模式或恢复入口。依据仍是下节已核对的官方Create/Describe接口契约。

原合成夹具删除虚构的RoleARN响应。新增使用真实SDK、固定合成凭据和内存HTTP handler解码XML并贯穿原完整停用路径的回归：修复前准确复现CHANGE_SET_ROLE_TAGS_OR_ID_CHANGED，修复后通过；没有真实网络/凭据提供器或AWS CLI调用。另证明原栈角色被更换/移除/新增，或栈UUID、标签、时间、状态改变，及CS ID/标签不符，仍在Execute前拒绝。相关162项测试、定向lint、类型检查通过，准确无AWS CI待提交后核验。

最终源码`27b7a028533aaa5568c1a8fe6eee65f428886478`已推送main，[无AWS CI43439591040](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43439591040) completed/success，准确head与回归/lint/类型各步骤成功。此工作流仍只contents:read，没有AWS/OIDC身份或environment审批，未dispatch任何云工作流；本轮到此结束，不额外生成恢复代码、云读取或执行材料。

本轮不读生产配置/私有状态或凭据、不调用AWS，不改现存未执行CS、失败attempt、锁或pending；原8045fffc…不能重跑，源码改变也使旧实现闭包不匹配。云端最近观察仍为13:52Z两ALB active/两ECS0/两库stopped，本地修复不构成实际停费。仅提交/推送和CI收尾，之后如需接续，须另审保留现存CS及旧失败记录的准确范围，不能自动清理、复位或换根。

### 当前实际执行：创建一个未执行CS后安全停止，ALB尚未移除（2026-11-13）

用户确认本轮8045fffc…清单及风险后，13:49:25.862Z—13:50:49.350Z原入口已单次运行。tenant-drain创建请求得到准确ACK，CS达到CREATE_COMPLETE，随后CHANGE_SET_ROLE_TAGS_OR_ID_CHANGED保护停止；Create1/ACK1、Execute0、停库及其他直接写0。原plan/attempt为NEEDS_INSPECTION、根pending为4f1edc31…；准确CS保留为AVAILABLE，不因原12:30CST截止尚未到而允许重跑或直接执行。

13:52:11.304Z—13:52:26.118Z另一进程按原范围独立读取：准确三栈UPDATE_COMPLETE，栈角色/标签与计划一致；两ALB active、两ECS0/0/0、两库stopped。准确CS的ID、标签摘要均匹配，资源范围仅TenantService Modify/不替换；唯一失败谓词是CS.RoleARN缺失而原租户栈角色非空。原根/attempt journal在独立核验期间未改。本轮执行＋核验合计STS2/资源元数据45/读取47/Create1，其他云写、Secret值/PEM/.env/SQL0。[完整可公开回执](../ops/temporary-idle/stop-execution-20261113.json)不含模板/参数或业务正文。

官方[DescribeChangeSet响应结构](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)未声明RoleARN；[CreateChangeSet RoleARN语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)说明省略参数时沿用原栈角色。原请求没有传新角色，现有栈角色也未变；原代码把响应字段缺失等同角色变化，是本地契约错误，不是凭据过期或IAM变更证据。本轮仅定位，没有修复或放宽校验，没有执行现存CS。

**未完成停费，ALB仍可能收费。** 唯一下一建议是仅修这一角色回读契约、保留准确栈UUID/当前原角色/更新时间及执行前核对，补回归与文档；须用户批准该代码范围后实施。旧CS/失败/已消费attempt保留，代码通过也不授权原stop重跑、删除CS、关pending或后继执行；接续另给准确范围，不扩恢复框架。下方清单为执行前记录，不再等待同一SHA批准。

<a id="stop-approval-20261113"></a>

### 当前：11月13日新停用计划通过，仅待准确SHA批准

用户另允后，原工具于2026-11-13T13:29:56.108Z—13:30:42.609Z完成STS1/元数据32（含三栈各一次完整变更集单页，均0项），无云写/变更集创建/Secret值/PEM/.env/SQL/执行attempt。原三栈准确UUID/模板/角色/绑定/参数、ALB/监听器/规则/mTLS、服务任务/网络、DNS和两库不可变ID通过原覆盖项校验；两个ALB仍active，两ECS0/0/0、两库stopped。不是全账号/全属性漂移扫描或真实停用完成。

[准确摘要](../ops/temporary-idle/stop-approval-20261113.json)绑定新私有工具计划；**批准对象为完整plan SHA，而非公开摘要文件的SHA：**

```text
planId: 4f1edc31-e860-4321-aff3-70a49dac25fd
planSha256: 8045fffc95ec1c9e1c6240ca9da5aa0a98730c345c4a483d7914acbef7a4602a
implementationSha256: 48683ce4e9a0444b8324e2e9c1953b2c53432068abff7e7e7fc98340df93415d
preparedAt: 2026-11-13T13:30:41.674Z
writeBefore: 2026-11-13T18:30:41.674Z
温尼伯写截止: 2026-11-13 12:30:41.674 CST
```

13:31:05.596Z另一进程仅本地核对新plan/journal SHA、PREPARED、当前实现闭包、无新attempt、根pending为空/无锁、旧失败attempt仍消费及旧文件准备期间原字节未改。持久配置仍disabled、恢复权限review=false；没有重复11月8日已完成结案。源码与已通过159回归及准确CI42508461523的df5d476未变，不重复代码修复。

#### 本次准确范围、失败策略与完整风险

- 仅账号402010193138、ca-central-1，摘要中的原三栈UUID及原两数据库不可变ID。预计4组普通UPDATE Change Set：租户DesiredCount声明1→0；租户移除Service/三规则保留3项；平台移除Service/ALB/443监听器/console DNS保留7项；Cell移除ALB/两监听器/共享拒绝规则保留12项。平台已声明0，跳过无变化归零。全部由所属CFN栈管理，不DeleteStack、不直接写ELB/ECS/EC2。
- 两库本次stopped，预计停库写0；执行时若准确原库已available，仍仅允许停止，禁止启动/删除。强制上限CreateChangeSet5、ExecuteChangeSet5、停库2，总直接写12，外部API Alias写0；只读1561含写前与独立核验及每阶段1800秒轮询预留，不要求用满。每组创建后严格审查准确变更/模板/参数/角色/标签才执行；不切drift-aware/EXPRESS、导入/嵌套或IAM能力。
- 停用后平台动态控制台/API与路由不可用；保留三栈、数据库/业务数据、VPC/子网/SG/集群、任务定义/目标组/日志、镜像、Secret与静态买家站。外部API Alias保留但不保证目标可用；不更镜像/IAM/数据/租约，不恢复资源。
- 跨服务非原子且无全局CAS；预检和SDK测试不证明实际写权限。创建/执行可能使同栈其他变更集失效。允许正常CFN失败回滚（DisableRollback=false），回滚本身也可能失败/部分恢复、遗留收费资源，甚至恢复旧租户声明1并启动任务、托管Secret注入/应用连接与费用。不能保证失败后仍为0；不自动再次停止、主动回滚、补齐、重试或清理。未知提交即停，永久attempt不复位。
- 计划/模板/元数据进入内存及私有ACL目录；不输出或提交凭据、私钥或业务正文。代理不读Secret值/PEM/.env或SQL；正常回滚若启动任务，AWS仍可能使用既有运行时Secret引用。网络与提供者日志、并发变化和部分状态风险保留。
- RDS停止仍有存储/备份费用，约7天原生自动启动限制不变，无再停守护；日志/ECR/Secrets/S3/CDN/DNS等仍可能收费。不能保证全账号零费用或50USD硬上限，范围外独立任务/其他区域不扫描。恢复另批新start计划及新ARN权限，工具不自动扩权。
- 成功后按原合同独立回读三栈归属、ALB/服务移除与两库stopped；失败保留现场。实现闭包或准确事实变化即拒绝，写截止后不执行、不延期。旧b/旧03d/结案原件不改或重放。

本轮唯一下一动作是用户确认本节新SHA与完整风险，随后执行并独立核验；尚未执行停用或证明真实stop→start→stop。下方11月8日段仅作历史。

### 2026-11-13恢复：旧b已过期，结案完成，不重放

本地只读回读确认b仍PREPARED/无attempt，原写截止2026-11-08T23:19:08.358Z已过；保留其原摘要/时间/SHA，不把它改为新清单。根pending/最后成功指针均null，无运行锁；旧结案PENDING_CLOSED_OLD_ATTEMPT_PRESERVED已经完成，不重复结案或复位。实现闭包文件与df5d476未变，沿用159回归和准确无AWS CI42508461523成功证据；实际停用尚未验证。

上次额度中断时b摘要与三份文档已保存，但Git收尾未执行，本次补录。用户另允本轮一次STS最多1＋原元数据最多40的只读准备（原三栈/变更集、ALB/ECS、两库和DNS、私有工具记录/新五小时计划），无云写/变更集创建、旧状态修改或执行槽消费，无Secret值/PEM/.env/SQL。实际停用须新SHA批准。以下b段只保留历史，不能将其11月8日观测当作当前资源状态。

<a id="stop-approval-20261108-b"></a>

### 当前：新准备b与本地结案完成，仅待新SHA停用批准

用户另允新同范围准备后，b于2026-11-08T18:17:45.492Z—18:19:08.991Z完成；实际STS2/元数据61，AWS写/Change Set创建/Secret值/PEM/.env/SQL均0，未重用a的未用预算或失败事实。准确三栈、原模板/角色/绑定/参数/输出/最后更新时间、两服务/网络/任务定义、ALB/规则/mTLS、DNS及两库与旧受审原状匹配，三栈变更集完整单页没有原准确名或AVAILABLE/执行中项。新鲜核对仍两ALB active、两ECS0/0/0、两库stopped，未达成停费。

根据用户明确的本地结案授权，18:18:29.913Z仅一次关闭原root pending引用，追加私有审计回执；原plan/attempt/journal及root snapshot共五文件SHA原样保持，旧尝试仍消费/失败，最后成功周期指针均保持null。独立本地进程确认旧文件未变、根新摘要匹配结案回执、pending为null；这不是复位旧attempt、删除锁或更换状态根。a失败记录和所有旧批准/时间保持，不改写为成功。

```text
closureDirectory: F:/ChatGPT_workshop/aws-environment-cfn-state/pending-closure-1fd34c91-1298-4048-87f5-4741bdc0c9f7
closureSnapshotSha256: 46d7f3e923b7c0716e47640368de6639b37c9ce4314c2d278950e41c493b5000
newPlanId: eac98465-b570-4f41-b267-4d8eac5bd964
newPlanSha256: 8b70421a3325b6b4dded3abc123969911d827033ab7b0e74ec36dbb88cd59426
implementationSha256: 48683ce4e9a0444b8324e2e9c1953b2c53432068abff7e7e7fc98340df93415d
privatePlanDirectory: F:/ChatGPT_workshop/aws-environment-cfn-state/plan-eac98465-b570-4f41-b267-4d8eac5bd964
preparedAt: 2026-11-08T18:19:08.358Z
writeBefore: 2026-11-08T23:19:08.358Z
温尼伯截止: 2026年11月8日17:19:08.358 CST
```

由原plan-stop生成的[新清单摘要](../ops/temporary-idle/stop-approval-20261108-b.json)已在另一进程独立核对plan SHA、journal PREPARED、当前实现闭包、未消费新attempt和结案证据。SHA批准对象是新私有工具plan，不是公开摘要文件SHA。最终代码df5d476/准确无AWS CI42508461523成功、159回归/lint/类型通过；普通请求省略非法DeploymentMode，回读不再要求虚构STANDARD。没有实际调用修复后的云CreateChangeSet，不能把SDK/只读核验当权限有效或真实停用通过。

#### 本次b准确范围及完整风险

仅账号402010193138、ca-central-1，原三栈准确UUID、原ALB代c06c/729e及两数据库不可变ID，继续使用配置中的原角色/标签/其余参数。预计四组普通UPDATE Change Set：租户DesiredCount声明1→0并核对0/0/0；租户移除Service及三规则保留3项；平台移除Service/ALB/443/console DNS保留7项；Cell移除ALB/两监听器/共享拒绝规则保留12项。平台已声明0，跳过无变化归零。数据库当前stopped，预计写0；若执行过程中原准确数据库被AWS启动，原边界最多只允许再次停止，不允许启动/删除。

强制保守上限仍为CreateChangeSet5、ExecuteChangeSet5、准确StopDB2，总直接写12，外部API Alias写0；只读上限1561含身份和每阶段1800秒轮询预留，不要求用满。每个子变更集创建后严格核对精确范围/普通模式/原模板、参数、角色和标签才执行；不切REVERT_DRIFT或EXPRESS、不启用导入/嵌套/IAM capabilities。新的5小时只属于本次实际新计划，不是重计旧03d的时间，也不是资源自动到期。

本次沿用以下[完整共同风险](#stop-shared-risk-policy)，逐条适用于新b而不复活旧批准：

- 服务/路由/平台DNS和两个ALB由所属栈移除，动态控制台与API将不可达；保留三栈、数据库/数据、VPC/子网/SG/集群、任务定义/目标组/日志、镜像、Secret和静态买家站。不DeleteStack、不直接写ELB/ECS/IAM/EC2、不改业务/镜像/租约；外部API Alias保留，恢复不在本次范围。
- 跨服务非原子、无全局CAS，额外变化/权限拒绝/未知请求停止，不能因只读或SDK通过宣称所有实际写权限有效。Create/Execute可使其他同栈变更集失效，旧证据仍保留。
- 显式正常CFN失败回滚DisableRollback=false，可能失败/部分恢复并遗留收费资源，甚至把旧租户声明1恢复、启动任务/托管Secret注入/应用连接并计费；不承诺失败后仍0，也不自动停回或清理。未知提交/超时不重试、主动回滚或补齐；固定attempt不复位。
- 计划/模板/元数据进入内存与私有ACL目录，不输出或提交秘密、私钥、业务正文。代理不读Secret值/PEM/.env或SQL；若正常回滚拉起任务，AWS仍可能使用既有运行时Secret引用。
- 停库不消除存储/备份费，约7天原生自动启动限制保持，没有安装再停守护。日志/ECR/Secret/S3/CDN/DNS等仍可能收费，不能保证全账号零费用或50USD硬上限；覆盖范围之外的独立任务/全账号不扫描。
- 完成后用原工具新回读归属、ALB/服务移除与两库stopped，失败则保留现场。恢复需另审新start计划及新ARN权限，恢复review标志仍false。代码闭包或资源变化使旧计划失效；23:19:08.358Z后不得写，不自动延长或重放。

下一唯一动作是用户确认本节完整新SHA、资源范围和风险；获准前不运行stop/start、不再重复生产读取。持久local配置仍disabled，实际获批调用才内存启用并核验相同配置；旧03d即使尚未到原截止也永远不能重跑。仅文档提交不改变实现闭包或新准备时刻。

### 最新：契约修复及CI完成，准备a在Source过期处停止，旧pending未改

最终源码`df5d4768f68d41a06b8cce10efe2b659b22f725f`的[准确无AWS CI42508461523](https://github.com/veinyyxy/TechlongSoftware/actions/runs/42508461523)成功，159项回归/lint/类型通过；已包含真实SDK无网络契约检查及旧pending/journal不自动修改回归，不再重复此修复。

用户随后另批STS2/元数据70＋原私有计划/journal，完全匹配才本地结案和新只读计划。准备a于18:12:42.640Z—18:13:14.930Z在平台ALB DescribeListeners以ExpiredToken停止；STS1/元数据24含失败1，所有云写、秘密值/PEM/.env/SQL0。没有结案目录/根pending迁移、新plan/SHA或执行attempt；本进程锁正常释放，没有删除旧锁/复位旧attempt/另换根。[原停止记录](../ops/temporary-idle/stop-continuation-preflight-stopped-20261108-a.json)保留。

下一仅待Source登录刷新并明确新一轮同范围准备许可，使用新记录保留a，不自动用剩余额度续读/重跑。新鲜整组事实未建立，不能按18:12开始时间声称五小时快照有效；原03d52073…已消费，不可重用。代码完成/CI成功不是停费完成，本轮没有删除ALB或暂停新的运行资源。下面草案/批准范围保留为经过，不是当前自动执行指令。

### 当前代码修复：普通CFN接口契约已纠正，离线接续待审

用户以“开始下一步”确认只修请求/回读和对应测试。本轮原请求删除非法`DeploymentMode=STANDARD`，适配器禁止调用方显式传DeploymentMode或DeploymentConfig；没有改传REVERT_DRIFT。回读要求DeploymentMode缺失；若AWS返回另一独立的DeploymentConfig，只允许已知普通默认字段（Mode缺失或STANDARD、DisableRollback缺失或false），拒绝EXPRESS/禁用回滚/未知字段或模式。`DeploymentConfig.Mode`与`DeploymentMode`是不同枚举，不能相互代用。[普通部署配置](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeploymentConfig.html)。

fixture不再伪造STANDARD响应，并按真实SDK枚举拒绝历史非法输入。159项本机回归通过，包括真实CloudFormation SDK通过内存HTTP handler序列化原创建请求、反序列化普通XML响应并交给原审查器；无AWS网络、凭据提供器或真实CLI调用。普通/非法/漂移/Express/未知配置均有拒绝回归，原stop→start→stop保持；定向lint/类型通过。另验证未决状态继续阻断新规划且不改根journal/attempt字节，不因接口修复自动解锁。

[新受审继续草案](../ops/temporary-idle/stop-continuation-offline-20261108.json)仅离线、不可执行、新SHA仍null：先另批一次准确旧失败/三栈/变更集/依赖状态核对，再在完全匹配且获得明确批准时，保留旧plan/attempt/journal原字节并追加独立核验/结案回执，只单次关闭根pending引用。最后成功周期指针不能改指向失败计划，不删锁、不换根或复位旧attempt。此状态接续本轮没有实现或调用；之后仍用原plan-stop生成新五小时SHA，实际CFN停用再次另批，不重跑03d52073…。

建议把下一次准备收拢为同一受审范围：最多STS2＋现有工具白名单元数据70；按原准确UUID/ID，核对三栈/完整单页变更集及原私有失败证据，必要局部根状态结案和新只读计划一起准备。AWS写、Change Set创建、Secret值/PEM/.env/SQL均0；未知或不匹配即停，不能用这份草案作为许可。没有新增云API、权限、资源、模式或通用恢复框架，本轮Source/AWS/私有生产状态操作均0；最后17:37Z观察不重计，ALB仍可能收费。

### 最新限定查因：确认非法STANDARD接口值，未修复或重试

用户另批STS最多1/LookupEvents最多3（≥2分钟间隔/最多10分钟）后，17:51:20.990Z—17:57:23.959Z仅完成这些只读调用。三次准确CreateChangeSet时间段/名称的完整单页均返回0事件，无事件/模板/参数正文保存，无其他资源读取/云写/Secret值/PEM/.env/SQL。没有取得历史AWS拒绝原文，不能把空结果解释为未提交，或宣称CloudTrail已经证明本次唯一根因。[诊断摘要](../ops/temporary-idle/stop-cloudtrail-diagnostic-20261108.json)与旧执行/三个准备失败原件分别保留。

已另由本地源码、官方API和已安装SDK确认确定的契约错误：

- `environment-cfn.mjs:89`和`environment-cli.mjs:30`发送/强制`DeploymentMode=STANDARD`；[AWS CreateChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)及SDK3.1106.0的DeploymentMode枚举只有REVERT_DRIFT，STANDARD不是合法输入。普通非drift-aware请求应省略该参数，不能改传REVERT_DRIFT以绕过。
- `environment-cfn.mjs:74`还错误要求普通回读含STANDARD，而[AWS DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)说明该字段只在drift-aware响应出现。适配器/fixture同样虚构STANDARD，所以原155项合成测试通过不能证明API契约正确。

本轮仅诊断，运行代码、权限、旧attempt/锁/root pending均未改。下一只建议同时修正原请求、回读、适配器和对应fixture/SDK契约回归；实际修复方向仍待用户确认，不加模式/框架/云调用。旧计划03d52073…已经消费，即使实现修复也不能继续旧SHA；后继须另审可追溯关闭旧pending并创建新计划的办法，保留旧失败/消费事实，不静默手改journal、复位槽或另换状态根。

最后资源观测仍是17:37Z独立检查：两个ALB active、两ECS0/0/0、两库stopped；本次没有重新核对资源或实现停费，ALB可能仍收费。以下执行记录保留原状态，不将确定代码缺陷反写成当时已知的错误正文。

### 当前停用结果：首个Create被拒，实际未移除ALB（2026-11-08）

用户确认完整03d52073…清单后，原入口于17:33:38.936Z启动、17:34:24.296Z停止。新鲜预检通过，但首个tenant-drain `CreateChangeSet`返回`ValidationError`，没有ACK/ChangeSet ARN，Execute与数据库写均0；journal为NEEDS_INSPECTION、actions为UNKNOWN_OR_REJECTED、无完成阶段。原尝试已消费，root pending保持；即使22:23Z未到期也不能再次执行。

另一进程17:37:23.316Z—17:37:37.973Z按原范围独立读取三栈、准确变更集名、两ALB/服务/数据库：三栈仍UPDATE_COMPLETE，list-change-sets完整单页无`tl-env-d6b756a9833a541e02b7652c3236677c3075-plan`；两ALB active、两ECS0/0/0、两库stopped且ID匹配。执行读34（含STS1）/Create提交1，独立读11（含STS1）/写0，合计STS2/元数据43/Create提交1，其他直接写0。[执行回执](../ops/temporary-idle/stop-execution-20261108.json)未含私密模板/参数正文，不改写原准备清单或失败journal。

**尚未达成停费，两个ALB未被本轮移除，可能持续收费。** 原错误适配器只保留code，不能据ValidationError推断唯一根因。已请求另一次限定CloudTrail事件查因（STS最多1＋LookupEvents最多3、间隔至少2分钟/最多10分钟，只投影准确本次名称/时间内的去敏原因/摘要，不保存事件模板或参数正文）。未获许可前不调用，不重试写、修原错误适配器、加权限、清锁/复位/换状态根或绕过CFN。后续修复/新写方案按真实原因另定；下面新清单待批文本属于执行前历史。

<a id="stop-approval-20261108"></a>

### 当前：新只读停用计划已准备并独立本地回读，等待执行批准

用户逐项批准的最小兼容已完成，仅修改原临时模块的ECS标签、FARGATE provider表示、准确子网列表类型解析及对应回归；没有改CFN生命周期/权限或正式业务代码。最终源码`d60e190643e004b197da6fb82d7f82a391a48b7d`的[准确无AWS CI 42504572554](https://github.com/veinyyxy/TechlongSoftware/actions/runs/42504572554)成功，155项回归、lint与类型检查通过；实际stop→start→stop仍未执行。

本次只读准备17:23:12.125Z—17:23:51.530Z使用原`plan-stop`，实际STS1＋元数据29、云写/云Change Set/Secret值/PEM/.env/SQL/执行attempt均0。三栈准确UUID/模板/物理绑定、服务标签/任务/网络/策略、Cell输出及租户参数、两ALB/监听器/规则/mTLS、准确DNS和数据库ID通过现有覆盖项检查；并非全账号或全属性漂移扫描。新观察两ECS均0/0/0、两数据库stopped、两个ALB存在且active。持久local配置仍disabled，只读调用在内存启用，读适配器另有只读白名单；没有因计划生成持久启用云写。

准确[审批摘要](../ops/temporary-idle/stop-approval-20261108.json)绑定本地私有计划，不是已批准/已执行回执。**批准对象是原工具plan的完整SHA，不是这份公开摘要的文件SHA：**

```text
planId: 5625988f-48eb-4052-b41f-bce4202e635d
planSha256: 03d52073ebec4788ea4133f847656a7e4e386d74fc0a56a17a6d26046361e618
implementationSha256: 7ec034bafa69bf3c6e5c01b207113e678db2a6640e0089e4c21d1833a3d29619
privatePlanDirectory: F:/ChatGPT_workshop/aws-environment-cfn-state/plan-5625988f-48eb-4052-b41f-bce4202e635d
preparedAt: 2026-11-08T17:23:50.824Z
writeBefore: 2026-11-08T22:23:50.824Z
温尼伯写入截止: 2026年11月8日16:23:50.824 CST
```

另一进程本地回读确认完整plan SHA、journal PREPARED、当前实现闭包一致、执行attempt不存在且未过期；没有新AWS读取。五小时是本次批准/写入窗口，不是资源到期或自动停费；旧失败记录和原时间不改写。过期、代码闭包/资源变化或提交不明时停止，不能复用此SHA重放。

#### 准确停用范围

仅账号402010193138、ca-central-1的配置内原三栈UUID和两个固定resource ID数据库；完整栈ID从私有plan与原配置逐项核对，不按同名认领。

| 顺序 | 通过所属CFN栈的变更 | 结果/保留 |
| --- | --- | --- |
| 1 | 租户仅将TenantService声明1改0，核对实际0/0/0 | 不启动新任务；平台声明已0，跳过无变化归零阶段 |
| 2 | 租户移除TenantService及三条监听规则 | 保留任务定义、目标组、日志3项 |
| 3 | 平台移除Service、LoadBalancer、HttpsListener、DnsRecord | 保留其余7项；console动态入口及该Alias不可用属预期 |
| 4 | Cell移除ALB、443/8443监听器和共享拒绝规则 | 保留网络/集群等12项 |
| 5 | 两个准确数据库仅核对/按需停止 | 本次均stopped，预计写0；不删除数据库/数据 |

当前预计4次CreateChangeSet＋4次ExecuteChangeSet、数据库写0。原工具强制整轮上限为各5次CFN创建/执行、准确数据库停止最多2次、外部API Alias写0，总直接写最多12次；这是保守上限，不要求用满。不修改这些预算来扩大代码任务。只读调用总上限1561含身份与每阶段最多1800秒的轮询预留，实际按完成状态结束，不自动延长五小时写入期限。

不DeleteStack，不直接写ELB/ECS/IAM/EC2，不修改镜像、Secret、业务数据或租约，不删除VPC/子网/SG/目标组/任务定义/日志/静态买家站。外部API Alias保留旧目标、不在stop写入范围；停用期间API不可访问属预期。恢复不包含在这份批准中，需新start计划和新监听器ARN权限审查，当前恢复review标志仍false。

<a id="stop-shared-risk-policy"></a>

#### 本次完整风险与失败策略

- CFN更新、删除依赖和RDS停止跨服务非原子、无全局CAS；写前再读不能消除并发外改。额外变化、未知资源或不匹配的子Change Set阻断，不跳过或扩大范围。
- 每个子Change Set必须先创建、严格核对精确Add/Remove/DesiredCount范围及全文/原参数/标签/角色，再执行；不会将本地计划当AWS已经创建的Change Set。不新增IAM、不换大角色绕过权限。只读检查和角色ARN匹配不证明每项实际写权限有效，AccessDenied时保留现场停止。
- 显式正常CFN失败回滚（DisableRollback=false）可能托管删除旧版本/使其他同栈Change Set失效，也可能部分回滚、失败或遗留收费资源。原租户声明1在回滚中可能被恢复，导致任务启动、计算费、托管Secret注入或应用连接活动；不承诺失败后仍全为0，也不自动再停回。
- 数据库正常情况下已停止而跳过写；若执行期间AWS自动启动了准确数据库，原整轮边界最多允许将它们再次停止，不允许启动或删除。停止仍有存储/备份费用，约7天原生自动启动限制保持；未安装自动再停守护。
- console记录/服务删除后平台动态页面不可用；租户API亦不可用。恢复ALB会产生新ARN/DNS，必须使用本工具保存的完整实际模板及新Cell输出，不能重放旧直接恢复备份。静态买家站保留并不代表后端仍在线。
- 模板/任务定义环境元数据和公开绑定进入内存与私有ACL计划；不读Secret值/PEM/.env或SQL。不提交私有模板/参数/业务正文、凭据或原始错误到Git。正常云任务若因回滚启动，可能按既有引用读取运行时Secret，这不是代理新增GetSecretValue调用。
- 固定单次attempt及写前日志不复位；未知提交/超时不重试、补齐、主动回滚或自动清理。超时不取消AWS操作，部分成功也不算停费验收。已消费或未决记录须先独立只读核对，不删除锁或重放旧命令。
- 完成后用原工具新回读三栈归属、服务/ALB缺失和两数据库stopped；只证明覆盖范围，不扫描独立任务或全账号。存储、日志、ECR、Secret、S3/CDN/DNS等仍可能收费，不能保证零费用或50USD硬上限。批准前两个ALB未移除，仍可能收费。

下一唯一动作是用户对上述完整plan SHA及范围/风险确认。此次生成清单不授权执行，原三个失败摘要保持不动；不先运行stop/start或另扩修复。执行时仍使用原入口/原配置、仅在获批调用内启用；文档提交不改变实现闭包，也不刷新本次期限。

### 已另批的子网参数单点解析修复完成，待新只读清单（2026-11-08）

FARGATE兼容的准确CI42504043779通过后，新只读规划在原网络解析停止；限定三次网络补核证明子网集合/SG/AssignPublicIp与模板完全一致，实际参数类型为`List<AWS::EC2::Subnet::Id>`，旧解析器只拆`CommaDelimitedList`，误按字符串字符比较。[停止原件摘要](../ops/temporary-idle/stop-readiness-after-capacity-fix-20261108.json)保留（STS1/元数据18/写0），不是云网络漂移或新的执行许可。

用户已明确允许只补这一类型并测试。运行代码仅在原`resolveNetwork`的一处类型分支增加该准确类型；不通配接纳其他List类型，不改变子网集合、SG及公网IP的精确匹配，不写AWS网络。155项本地回归、定向lint和类型通过，新增2项覆盖两种列表类型完整启停、顺序等价以及三类真实网络差异拒绝。准确代码CI后再用原只读入口生成新SHA，真实停用仍另批，原失败目录/槽保持。

### 已批准的FARGATE表示兼容已编码，待准确CI及新只读计划（2026-11-08）

用户另允后，仅在原服务校验增加capacity-provider等价路径：模板和实际均只能有一个`FARGATE`，base/weight准确匹配（省略按0），两侧均不得同时声明launchType；EC2、混合、Spot、被改动/未声明的策略拒绝。原直接launchType路径仍只允许FARGATE，准确CFN绑定、标签、任务/目标/网络保护保持。没有新增API、权限、云写或修改CFN生命周期。

153项本地回归通过，新增4项覆盖等价表示完整stop→start→stop及上述拒绝边界；定向lint和类型检查通过。准确代码CI通过后，才按本次批准用原只读入口准备新五小时停用SHA；不创建或执行云Change Set、不停启数据库或任务。下面两次失败的原件保留，不复位或重放，不能据本地通过声称真实环境已停费。

### 本轮标签修复已通过，新的只读规划停在租户FARGATE表示检查（2026-11-08）

标签修复源码`2c76428fbf3b5d2d9539dff960ea183ebfcd2247`及[准确CI 42499624616](https://github.com/veinyyxy/TechlongSoftware/actions/runs/42499624616)已通过。新只读规划于16:25:05.743Z—16:25:26.304Z通过平台标签检查，随后在租户服务原有`launchType==='FARGATE'`条件处停止。准确ECS与CFN服务ARN/任务定义:12匹配，服务0/0/0，但AWS返回`launchType=null`及`capacityProviderStrategy=[FARGATE,weight1,base1]`。官方API明确使用capacity provider时省略launchType；不是发现了EC2工作负载或云端归属丢失。[AWS说明](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Service.html)。

[新停止记录](../ops/temporary-idle/stop-readiness-after-tag-fix-20261108.json)保持旧标签阻塞原件。实际STS1/元数据17（含准确服务与CFN绑定诊断2），云写/Change Set/执行attempt/Secret值/PEM/.env/SQL均0；没有可执行停用SHA，持久配置仍关闭。此处不自动扩大标签批准去修另一条件，已询问用户是否仅兼容模板与实况准确一致的FARGATE provider并补回归。未获新方向前不改该条件、不再读取或生成假计划。两个ALB没有被本轮移除，可能持续收费。

用户已批准仅修复ECS归属校验并测试，再生成新停用清单。原`liveService`现在以准确CFN记录的服务物理ARN为归属基础，保留任务定义/目标组/网络检查；系统标签若存在仍必须匹配准确栈ID、逻辑ID及栈名。缺少系统标签不再直接拒绝，但真实模板声明的业务标签必须逐项匹配；参数引用只比较`readStack`已有的非NoEcho参数摘要，不保存额外参数正文。重复标签、缺少/篡改声明标签、冲突归属、NoEcho和未支持表达式均拒绝。不改ALB归属检查、不写云端标签、不扩权限或改启停顺序。

149项本地回归、定向lint及类型检查通过，新增5项覆盖缺系统标签的stop→start→stop、两服务冲突归属、声明标签篡改、NoEcho/未知表达式拒绝，以及ARN/任务/目标/网络保护不变。合成通过不是云启停通过；准确代码CI通过后才用现有入口新建只读停用计划，实际CloudFormation创建/执行仍另批该新SHA。持久local配置保持关闭，旧阻塞草案和历史尝试不改写。

### 2026-11-08 首次真实只读接入结果：未通过，不能执行停费

用户要求准备两个仍active的ALB停费变更并验证工具。本轮144项合成/私有文件/基线回归、定向lint和TypeScript通过；新增当前场景覆盖两库已停、两ECS为0而两个ALB仍存在，验证预计只需4组CFN创建/执行、0次数据库写，stop→start→stop保持保留资源ID和真实新引用。首次沙箱内回归因私有ACL目录清理EPERM失败，未改安全检查；同一套测试在正常权限环境144项全部通过，不涉及AWS。

真实只读`plan-stop`使用现有入口、内存enabled:true且独立限制只读，持久local配置仍false。STS1＋元数据12后在平台服务归属标签检查停止；另一次准确DescribeServices确认ARN与该栈的Service物理绑定相同，服务0/0/0，但仅返回业务标签，没有代码强制要求的`aws:cloudformation:stack-id`和`aws:cloudformation:logical-id`。这是当前真实接入的兼容阻塞，不据此判定云端已失去归属。CFN系统标签的传播因资源类型而异，不能用合成fixture有这些标签来证明所有真实服务都有。[AWS说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-resource-tags.html)。

**结论：工具尚未满足真实启停使用条件。** 本轮总计STS1/资源元数据13，云写、Change Set创建/执行、DB连接和Secret值/PEM/.env读取均0；没有生成planId/可执行SHA或消费执行attempt。新私有根只有根状态；不清锁/复位或重跑旧尝试。剩余ALB/DNS/数据库依赖及角色权限未被本次工具检查走完，前轮盘点不是这些检查的替代证明。

[停费范围与阻塞记录](../ops/temporary-idle/stop-readiness-20261108.json)是**不可执行草案**：先将租户CFN声明1与实际0对齐，再依次移除租户Service/三规则、平台Service/ALB/443/console记录、Cell ALB/两监听器/共享拒绝规则；保留三栈及3/7/12项资源、两数据库和网络骨架。不能仅删除两个ALB，否则会再次制造漂移。已停止数据库跳过写，外部API Alias保留，停用时域名不可用属预期；仍可能有存储等费用。

下一仅待最小代码修复方向确认：保留准确UUID＋CFN物理ARN＋任务定义/目标组/网络和冲突归属拒绝，按真实声明校验业务标签，不强制不存在的系统标签；不云端补标签、不扩IAM、不改其他启停逻辑。修复及测试后才能用同一入口新建只读计划，实际CFN停费仍另批该新SHA。本轮没有改运行代码或声称真实stop/start通过，两个ALB仍未被本轮移除，可能持续收费。

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

远端验证留档：代码提交 `0251a135bd61a036d3a32935d114b04fdcf590a3` 的[无AWS CI 42454426128](https://github.com/veinyyxy/TechlongSoftware/actions/runs/42454426128)已completed/success，143项合成/基线回归、lint及TypeScript通过。这里只证明代码与合成流程，不证明实际云端启停或权限。

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
