# 临时测试止费与恢复方案（正式上线前移除）

2026-10-31，America/Winnipeg。用户已同意本方案，并要求临时措施可追溯、与正式代码隔离。最初代码交付阶段没有调用AWS、启动watch或安装IAM；随后用户另行明确要求实际调用一次，真实结果见下节，不能继续用代码阶段的“未调用”代表当前状态。原部署/店铺菜单验收主线不变，旧事实、批准和TTL不延期，默认样例仍关闭。

## 2026-11-01按用户通知再次停用已独立核验

用户明确“现在可以清理AWS资源，别忘动用额外资费工具，等下次要求启动”。仅按既有临时止费范围实际执行，没有新部署、业务测试、权限安装、读取Secret/PEM/.env、数据库连接或账本写入。执行源码仍为停用前main `9140c4a02c1d5d029cd808a997d675caab9fe90f`；工程运行模块/临时工具均未修改，本轮只更新操作文档。

区域ca-central-1、账号402010193138及准确Source IAM用户核对通过；初次沙箱网络不能连接登录端点，网络获准后STS成功，不将沙箱错误误判为登录过期。额外只读预检先因tenant采用capacityProviderStrategy而非launchType停止、后因4个已分配EIP停止，均0云写。补核证明tenant是FARGATE，4个EIP全部是本次两ALB的ServiceManaged=alb/准确托管ENI；保留原诊断，不对这些IP直接ReleaseAddress或强删ENI。项目两VPC的NAT/接口端点为空，无独立EIP清理目标。

新配置 `F:/ChatGPT_workshop/temporary-idle-20261101-b.config.json`，enabled=true/expiresAt=null，仅用于这次显式idle调用，不是后台计时器。新恢复备份 **`F:/ChatGPT_workshop/aws-temporary-idle-20261101-b`**，ALB/RDS备份在其`power/`子目录；两份旧停用/恢复备份均保留。两服务无scalable target，无新增来源暂停/恢复。

实际入口 `scripts/aws-temporary-idle.mjs idle --execute` 单次运行，自动调用既有power stop，云写只有 **UpdateService2、StopDBCluster1、StopDBInstance1、DeleteLoadBalancer2**。所有请求各一次ACK，无重试或回滚；约18:09:41Z退出0，结果TEMPORARY_IDLE_VERIFIED，嵌套power为STOP_VERIFIED。独立新进程只读于 **2026-11-01T18:10:10.267Z** 完成MANUAL_IDLE_INDEPENDENTLY_VERIFIED：

| 对象 | 独立最后回读 |
| --- | --- |
| 平台 techlong-sandbox-platform-web / 租户 tenant-9c5ee9e64509dcad-ecs-service | 两者desired/running/pending=0/0/0；TaskDefinition均保持:12；原task均STOPPED |
| Aurora techlong-sandbox-express-d001 | stopped，原cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM保持，不删库 |
| RDS speedfeast-postgres-prod | stopped，原db-MOOXGHRHTZM25V3I4NY25D4IEQ保持，PubliclyAccessible=false，不删库 |
| Cell ALB241081ab25c73320 / 平台ALB92d54a44479fbc3a | 准确ARN均LoadBalancerNotFound，随附3监听器/4非默认规则删除，完整配置已备份 |
| 项目NAT / 接口端点 | 均0，无需删除网络骨架 |
| 公网IP | 原ALB4个托管EIP均已释放，区域已分配EIP数量0；原两个task网卡无公网IP残留 |

独立原件 `F:/ChatGPT_workshop/aws-idle-independent-20261101-b/result.json` raw SHA `49284f9fae5f070ecf5401cf9d5ca41d79aa9ac7cf4f5f73e93fae52921fe2fd`。ECS snapshot raw SHA `6756e51ed3673cff050b546ca820d43c3c78ed9c025bd8549939da046e40a331`、canonical `fb6b1e04ab96237c96fa3e808d2a9382f1cb35d124e0a2f9852365e9a28a1726`；power snapshot raw SHA `f1471a4e4910fec9e7273da904d784cd23713a1d0da91df80e87077920f8215e`、canonical `336a9f9d1ee9b84b636ad52fd05a29f491260c81c9ca37c2def361cdd3e51955`。最终两journal raw SHA分别 `667b5cc9c6d55cd5bfd843ae7223f36508761f23c700832cdd7f8657d4842025`、`d1ed55343a35352bec752d79163677eed0caa2b14abed4f043b4b72bf6e6cf4f`。私有快照正文不提交GitHub。

**当前只等用户通知恢复，不主动启动资源。** 未删CFN栈/目标组/数据库/Secret/ECR/CDN、未改IAM/DNS/业务记录、不装watch或持续停库守护。买家静态页面保留，但API和平台暂停；DB存储/备份、镜像、Secret、S3/CDN等仍可能收费，不能称全账号零费用。RDS/Aurora停止最多7天，AWS之后会自动启动，这是服务原生限制，不是本轮安装的恢复任务，见[AWS RDS规则](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)及[Aurora规则](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-cluster-stop-start.html)。

下次启动先读本节及独立原件、新snapshot/journal；先恢复原两数据库/两ALB，再核对新ARN/DNS/listener/目标组/父子CFN drift，最后恢复原两ECS副本数1。平台仍按用户已选的关闭部署控制器模式，除非另有新批准。不要套用旧ARN、旧power state或重放业务任务；旧恢复器的空日志桶/双条件格式问题已在前次记录，恢复时只发规范且必要的请求，不复位失败槽或误删数据库。

## 2026-11-01手工测试环境已恢复（停用前历史）

用户集中批准完整无自动到期恢复，随后另批精确IAM路径调整，并明确同意平台先以关闭部署控制器模式常驻。恢复写入及分步AWS部署回读已完成；这是基础设施恢复，不是Review/RunOnce/Inspect新业务周期或产品验收，不重放旧任务、改写历史事实或伪造成功业务回执。

| 对象 | 最后完成的分步回读 |
| --- | --- |
| Aurora techlong-sandbox-express-d001 / RDS speedfeast-postgres-prod | 两者available；原resource ID保持，没有重建数据库 |
| Cell ALB | active；新ARN尾241081ab25c73320，443监听器8fce768af0ff42f7、8443监听器576403dc1245139b，原共享拒绝规则已恢复 |
| 平台ALB | active；新ARN尾92d54a44479fbc3a，443监听器0234243da966933a，保留原目标组 |
| console/API DNS | 两A Alias单批改绑新ALB，ChangeId C06749462OS01RPUUTPGQ，INSYNC；买家CDN未修改 |
| 租户API | 新栈UUID5867e9c0-d60d-11f1-b2c0-02ffdbfa6b13，原7资源CREATE_COMPLETE；ECS desired/running/pending=1/1/0、rollout COMPLETED，目标组healthy |
| SaaS平台 | 原镜像，TaskDefinition techlong-sandbox-platform-web-v1:12，ECS1/1/0且rollout COMPLETED；无hosted-controller启动参数，控制器关闭 |
| IAM | TechlongSandboxCloudFormationExecutionBoundary默认v9；只替换C5gExactListenerRulesTags中两条规则读取资源路径，其他Action/Statement/Condition不变，v7/v8保留 |

平台旧v11带已过期的30分钟控制器租约，恢复后容器退出，不能用延长/伪造永久授权绕过。按用户后续选择，使用现有镜像原有的普通Web启动路径，将CLOSED_BINDINGS全部保持关闭，移除TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY与TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL两个Secret挂载，仅保留原Web DATABASE_URL引用。未读取Secret值/PEM，未换镜像、改JWT/MFA/登录会话期限；批准/调度AWS部署功能有意保持关闭，不能说所有部署权限永久开通。

旧恢复工具的首ALB属性批次ValidationError保留；只对真实两项差异写入后通过回读。接续中规则请求同时给Values/PathPatternConfig被拒，准确CloudTrail事件d8f743a2-ee2a-4efa-980d-6c1ea80a86cd给出明确错误；先核对该监听器仅默认规则，再规范为单一类型条件和省略空Transforms，以新动作记录完成同一规则，未重建已成功ALB/监听器，未复位原失败记录。租户本地首次因NoEcho隐藏两个ARN参数停止、CreateStack0；只读原TaskDefinition:11的Secret ValueFrom及原模板固定引用补齐ARN后，唯一CreateStack成功，没有GetSecretValue或新业务任务。

租户启动过程中ALB曾报/ready 503、AWS更换任务，随后服务稳定、目标healthy；没有为此改readiness代码/数据库数据或放宽健康检查，也未读取应用业务日志。平台旧模式的原resume-compute读取等待超时记录保持；新模式注册/切换使用独立动作记录，不重跑旧恢复尝试。代理未执行店铺、菜单、下单、登录或浏览器JS测试，未主动连接数据库或改控制账本。

私有恢复根仍为`F:/ChatGPT_workshop/manual-environment-restore-20261101-a`。最新入口 **handoff-stepwise.json**，raw SHA **6bdce23bcd8f91261ec80a1a1bf611cb68821b7db7f7092884801e469c871e01**；绑定continuation-b.json及各阶段实际完成时间、映射、7资源、IAM/DNS、新平台模式。最后额外汇总脚本在第一次STS返回ExpiredToken即停，没有获取额外资源状态或进行云写，因此没有ready-for-user-testing.json独立汇总证明；不把分步成功混称为这次额外聚合通过，也不为此重做已完成恢复。本机Source操作凭据过期不会触发停止工具，已运行资源不依赖这次CLI会话持续有效。

本次新租户栈/新ALB/新平台任务定义配置不新增ExpiresAt或HostingExpiresAt，没有安装watch或新到期清理计划。旧父栈历史标签/模板仍可能显示旧期限，不能将它们改写成未来事实；Cell清理计划保持原DISABLED，新租户栈无ExpiresAt供既有扫描器触发到期删除。登录/JWT等安全期限不改。资源持续计费，待用户明确通知后再停；50USD/月目标不是硬上限。

已准备 **manual-stop.config.json**：准确两个当前ECS服务、两个新ALB ARN及原两数据库，enabled=false、expiresAt=null，无自动运行。用户通知停用后先核对资源及身份、启用本次准确配置并使用新备份目录；不要用旧ARN配置或复用旧永久尝试。原停止快照、失败journal、各次源码和已完成阶段均保留。

边界：直接重建ALB及平台任务定义切换造成的父CloudFormation物理ID/Outputs/template drift仍需正式部署前收敛，不能现在直接Update旧父栈模板；本次没有为此扩展导入/恢复框架。控制数据库中的历史部署/任务记录未改写为这次手工恢复，wholeProductAccepted仍false。当前只交由用户测试，未经新指示不再追加产品验证、重新开启控制器或清理资源。以下部分恢复/待批文字仅为沿革。

## 2026-11-01无自动到期恢复部分完成

用户改变当前方向：产品测试由本人负责，只恢复原AWS环境，不新增到期时间，测试完成后本人通知停用。用户已集中确认原两数据库、两ALB/监听器、平台ECS1任务、租户原七资源及对应DNS/监听器引用；允许移除恢复配置的到期标签或必要的定向自动清理条件，不改JWT/MFA安全期限、不改业务数据、不新增IAM、不做产品测试，并接受持续费用及50USD/月目标不保证。该新确认不是旧Review/业务任务或历史期限的重放。

新恢复根`F:/ChatGPT_workshop/manual-environment-restore-20261101-a`；源power备份raw SHA仍b64c8e29…不变，新派生power snapshot canonical SHA `079280757b3627f7bb95b0dd2e22b20c74a2281f4bca967858f166c1394f309b`，只从ALB/监听器/规则标签移除6个ExpiresAt/HostingExpiresAt项，原快照和历史时刻保持。原临时ECS备份已通过restore-network阶段；没有收费网络目标，所以此步无云写，计算仍归零。

本次实际云写：Aurora techlong-sandbox-express-d001 Start1、RDS speedfeast-postgres-prod Start1均ACK，最新回读两库均available；仅首个Cell ALB已创建并达到active，新ARN尾部`241081ab25c73320`，新DNS为`techlong-sandbox-cell-sandbox-1-1508657029.ca-central-1.elb.amazonaws.com`。随后旧工具ModifyLoadBalancerAttributes回填整批属性时返回ValidationError，journal保留NEEDS_INSPECTION及UNKNOWN_OR_REJECTED，不重试写入。此ALB未创建监听器/规则，第二ALB尚未创建，ECS/DNS/租户栈尚未恢复。

只读比较首ALB属性，只有idle_timeout.timeout_seconds当前60/目标30及routing.http.drop_invalid_header_fields.enabled当前false/目标true不同；旧请求也包含Describe返回的空日志桶/前缀字段，但原始ValidationError正文未保存，不把推测当唯一根因。后续若获准继续，应仅针对真实差异写入，不重发整批属性、不重新Create首ALB或启动已available数据库；原失败journal不覆盖、不复位。

只读模板/DNS/既有执行角色材料已保存`inputs.json`。最初采集在错误的IAM区域endpoint读取时停止、云写0，修正为IAM官方全局endpoint后重新采集，保留这次失败事实，不冒称新增读取为旧采样。CFN旧租户角色`TechlongSandboxCloudFormationExecutionRole`的唯一附加策略也是其boundary：`TechlongSandboxCloudFormationExecutionBoundary`默认v8，另有非默认v7。它允许原工作负载动作，但C5gExactListenerRulesTags的DescribeTags资源仅指向已删除旧ALB/监听器。重建规则前需另批将这两条路径替换为本次新ALB下对应监听器规则路径；其余Statement/Action/Condition不变，版本槽位充足，无需删除v7/v8。不新增角色，不改用Source直接创建来绕过原执行角色边界。

**下一步等待这项精确IAM更新及继续剩余恢复的确认；当前不是全部可测试环境。** 本轮IAM写、DNS写、业务数据访问/测试均0。检查点`checkpoint.json`绑定派生power journal、当前inputs摘要、真实3项成功写/1项失败写、映射与剩余步骤。继续前先读它，不重跑Prepare/restore-power或复位尝试。原已启动资源持续收费，没有安装新的watch/到期时间，不自动回滚或清理；暂停等待授权不等于停止计费。

## 随后单次实际停用（2026-10-31，已独立核验）

用户明确要求“调用一次停止后面两项收费，试是否成功”。执行源码`c4afaf0b1009895b621afaaaf77516f9e97d74b0`，账号402010193138，区域ca-central-1；准确Source IAM身份核对通过。本轮只处理ECS/Fargate及VPC收费组件，不重跑已完成的ALB/RDS停止、不恢复或部署。

只读盘点两个现有项目集群：`techlong-sandbox-platform`中仅`techlong-sandbox-platform-web`运行1个Fargate任务，`cell-sandbox-1`无service/任务。本区域NAT Gateway、VPC Endpoint、EIP均为空，没有网络删除目标；默认/项目VPC和数据库网络骨架保留。Scheduler的两个目标均为既有Janitor Lambda、默认EventBridge无rule/无其他bus，因此不修改这些来源；准确service没有已登记的扩缩容target。

本地准确配置`F:/ChatGPT_workshop/techlong-temporary-idle-20261031-a.config.json`，新恢复备份 **`F:/ChatGPT_workshop/aws-temporary-idle-20261031-a`**。真实入口idle仅执行一次`UpdateService`：准确平台service的desiredCount从1改为0，ACK已保存。无StopTask、网络删除、IAM、Secret/数据库/业务访问、ALB/RDS写入或watch安装。snapshot先于云写落盘，保留原副本数/任务定义/目标组等恢复依据；raw SHA `b6673b0f2c8f04c240838a664f361e488cd21d8d80848812dfa7a7d066475759`，canonical SHA `d5852ae9fc70b31a16b4c5252ad3dcb4bdf1328a39e480662cc99ce9ef1bfb15`。

最初入口回读数量已归零，但旧任务ENI仍带公网IP，真实journal保留`IDLE_WITH_PUBLIC_IP_RESIDUALS`及非零退出，不改写成当时已释放。随后仅对准确service、备份中的原task和ENI做独立只读核验，3轮后于 **19:19:47.973 CDT（2026-11-01T00:19:47.973Z）** 确认：desired/running/pending均0，原task `af47eb87bad548a79f58577116bd473a`的lastStatus/desiredStatus均STOPPED，原ENI `eni-0122c4d4c6bff5df7`无公网IP残留。最终证明`ECS_IDLE_AND_CAPTURED_PUBLIC_IP_RELEASE_VERIFIED`、writes0，位置`independent-readback.json`，raw SHA `1ca27b62ea76ed90cc7081f3e16f11a0041a633a1a93a6e54c8fa63e195cd73c`。本地原件已核对，备份锁已释放，不重跑idle。

独立核验首次在Windows ESM绝对路径导入时本地退出，AWS调用0；仅修正本地配方的file URL后继续原范围只读验收，没有再次云写或修改工程停止代码。原journal与独立最终证明分别保留，不用后来的观察改写先前残留状态。

**结论只覆盖本次准确Fargate任务与其公网IP；没有实际NAT/端点/EIP删除可测试。** 不能据此声称全账号零费用或账单立即归零，数据库存储/备份、镜像等仍可能收费。未来恢复需新确认准确范围：本轮ECS备份与既有ALB/RDS备份`F:/ChatGPT_workshop/aws-cost-backup-20261031-a`配合，先恢复依赖并核对新绑定，最后再启动计算；本轮未执行恢复，也没有设置常驻自动止费。

## 已确认的范围

| 对象 | 临时闲置时 | 恢复时 |
| --- | --- | --- |
| ECS/Fargate service | 保存原副本数，暂停已登记的扩缩容，desiredCount=0；确认运行/待启动任务归零 | 依赖和新绑定核对后，恢复原副本数及原扩缩容状态 |
| 明确登记的独立 Fargate task | 停止 | 不自动重放，避免重复业务/部署写入 |
| 明确登记的直接 ECS Scheduler / EventBridge rule | 保存配置并禁用 | 仅恢复原先启用且未过期的周期来源；at 一次性计划不重放 |
| 明确登记的 NAT Gateway、Interface Endpoint、EIP | 先备份配置；确认计算已停，再删 NAT 路由/NAT/端点，等待消失后释放选定 EIP | 新建必要 NAT EIP、NAT、路由和端点，输出新旧映射；不为原本闲置的 EIP 重新付费占位 |
| ALB / RDS | 可选择复用现有停止工具：删除已备份 ALB、停止指定数据库 | 复用现有恢复工具，再检查新 ARN/DNS/目标组等绑定 |
| VPC、RDS 必需 subnet/安全组、数据库数据/备份、部署引用的 ECR 镜像 | 保留，不删除 | 继续复用 |

VPC 本身不是要靠删除来节省的收费主体；重点是 NAT、接口端点、公网 IPv4 和运行中的计算资源。保留数据库网络骨架，避免恢复数据库却丢失依赖。ECR 是镜像存储，不存在与 ECS task 相同的“暂停”状态；本轮不清空部署镜像。依据：[VPC FAQ](https://aws.amazon.com/vpc/faqs/)、[VPC 定价](https://aws.amazon.com/vpc/pricing/)、[ECS 定价](https://aws.amazon.com/ecs/pricing/)、[ECR 定价](https://aws.amazon.com/ecr/pricing/)。

此方案仅为测试周期的临时成本控制，不是最终生产架构，也不是账号零费用承诺。此前实际 ALB/RDS 停止结果单独记录在[已有工具文档](aws-resource-power-tools.md#本轮实际停止2026-10-31已确认)；不能把本轮写代码当成又一次实际停止。

## 隔离方式与入口

- 实现只在 [ops/temporary-idle](../ops/temporary-idle/core.mjs)，入口为 [scripts/aws-temporary-idle.mjs](../scripts/aws-temporary-idle.mjs)。
- 临时代码单向复用既有 ALB/RDS 辅助工具的本地备份/CLI；旧辅助工具、正式运行模块、Janitor、部署 workflow 均不反向导入它。
- 不修改 package 依赖、不新增 npm 自动钩子、不改变正式部署或清理语义。
- `temporary:true`、`enabled:true`、`--execute`、准确 `--confirm-account` 必须同时满足，才能访问 AWS。否则仅离线预览，不是 AWS 服务端 dry-run，也不代表当前资源存在。
- 使用 Node.js 22.13+、AWS CLI v2 和既有 profile；不读取 `.env`、Secret 值、PEM 或数据库内容。Windows 备份目录用 PowerShell 7 设置受限 ACL。

## 配置与支持边界

复制[默认关闭的样例](../ops/temporary-idle/config.example.json)到本地私有配置。先核对实际资源，再填入准确集群/服务/任务、计划、rule、VPC、NAT、端点和 allocation ID。**样例没有通过本轮在线盘点，不可当作现状清单。** 不把凭据写入 JSON，不使用账号全扫描/模糊前缀清理。

- `services` 为 FARGATE/FARGATE_SPOT；EC2/Managed Instances 不在此工具范围。
- `standaloneTasks` 必须准确 ARN，且不能是 service 管理的 task。
- `schedules` 为 `{name,group}`，`rules` 为 `{name,bus}`。只支持目标直接为所选 ECS cluster 的来源；间接 Lambda 调度或混合非 ECS rule 在写入前拒绝。未登记的外部 CI/人员仍可重新启动任务，本工具不能阻止它们。
- 收费网络目标必须同时满足准确 ID、`vpcIds` 白名单、`requiredNetworkTags` 以及 `acknowledgeNetworkRecreation:true`。支持单地址 zonal public/private NAT、用户管理的 Interface Endpoint、闲置或属于选定 NAT 的 Amazon VPC EIP；regional/多地址 NAT、其他类型/托管端点及未知挂载 EIP 拒绝处理。
- NAT 的路由表也须满足所有权标签。保留 subnet/安全组等依赖；不删除 VPC、网卡、数据库、快照或镜像。不强行分离托管 ENI。
- `expiresAt` 是固定 UTC 时间，例如 `2026-11-01T01:00:00.000Z`，仅 watch 需要。不会延长业务 TTL 或改正式 Janitor 标签。
- `power:null` 表示本轮只处理 ECS/收费网络；以后要一并停止 ALB/RDS，可嵌入[既有 power 配置](../ops/aws-resource-power/config.example.json)，账号/区域/profile 必须相同。必须使用当时真实新 ARN，不复制已删除的旧 ALB ARN冒充当前目标。

## 通用操作示例与恢复顺序

以下路径是以后人工填好的配置与新备份目录示例，不是已经启用的任务。`idle`/`watch` 的 state 必须尚不存在；每个新周期都使用新目录、当时实际资源 ID 和准确范围。

先离线预览，不查询 AWS：

```powershell
node scripts/aws-temporary-idle.mjs idle --config F:/ChatGPT_workshop/temporary-idle.json --state F:/ChatGPT_workshop/temporary-idle-cycle-001
```

实际执行需另行确定目标和权限范围。仅当确实要执行时，才附加：

```powershell
node scripts/aws-temporary-idle.mjs idle --config F:/ChatGPT_workshop/temporary-idle.json --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --execute --confirm-account 402010193138
```

也可将 `idle` 换为 `watch`：本地进程等待已配置的固定到期时间，然后仅执行一次同样的闲置流程。**watch 不依赖聊天额度，但依赖电脑持续在线、进程存活、网络及届时有效的 CLI 凭据；它不是已安装的云端定时器。** 关机/登录失效会阻止止费，不会自动续期、补跑或建立收费调度资源。本轮没有启动此进程或设置开机任务；若以后需要云端独立到期执行，必须另审准确资源/IAM/安装，不能称本轮已经实现云端自动联动。

实际闲置的顺序固定为：保存 ECS/来源/网络备份 → 暂停来源与扩缩容 → 计算归零并回读暂停状态 → 可选既有 ALB/RDS stop → 删除选定收费网络 → 回读删除/公网 IP 残留。旧 power 工具自己的 ALB/RDS 备份仍在其首次写入前生成。

恢复分三步，**不会一次命令直接把容器拉起**：

```powershell
node scripts/aws-temporary-idle.mjs restore-network --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --execute --confirm-account 402010193138
node scripts/aws-temporary-idle.mjs restore-power --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --power-state F:/ChatGPT_workshop/aws-cost-backup-20261031-a --execute --confirm-account 402010193138
```

第一步仅恢复必要 NAT/EIP/路由/接口端点，ECS 仍为 0；记录新 NAT/端点 ID、EIP 和端点 DNS。第二步复用已有 ALB/RDS 备份恢复；若停用时嵌入 `power` 生成了本周期 `state/power`，可省略 `--power-state`。**旧备份仅供其自身一次恢复，不能再次用于停止或重放恢复。** 上述既有真实备份只允许它原先指定的范围，实际恢复尚未获本轮批准。

接着检查 CFN drift、ALB 新 ARN/DNS、Route53 alias、监听器/目标组以及网络 ID 引用，必要修改单独处理；`--bindings-reviewed` 是操作者确认，不会替你修改这些绑定。完成后才允许：

```powershell
node scripts/aws-temporary-idle.mjs resume-compute --state F:/ChatGPT_workshop/temporary-idle-cycle-001 --power-state F:/ChatGPT_workshop/aws-cost-backup-20261031-a --bindings-reviewed --execute --confirm-account 402010193138
```

恢复计算前要求已有 ALB/RDS 恢复证明、当前数据库 resource ID/available、ALB active、原 service 目标组绑定到新 ALB，以及 service 身份/任务定义/目标组和暂停配置未被别人改动。随后恢复原副本数并等待运行数稳定，再恢复原扩缩容及有效周期来源。独立 task、at 计划不重放；输出始终不把计算恢复当作产品验收成功。

所有模式省略 `--execute` 都是离线预览；恢复预览须已有真实备份。CLI 不在 PATH 时可加 `--aws-cli "D:/Amazon/AWSCLIV2/aws.exe"`；`--wait-seconds` 默认1800，范围0–7200，只控制读取轮询，不自动重试云写。

## 状态、失败与费用限制

`snapshot.json` 在首次临时资源写入前持久化，`journal.json` 保存原状态、动作和新旧映射。目录 ACL 仅当前用户/SYSTEM/Administrators；配置/计划 target 可能含私密元数据，备份留本地、不提交 GitHub。摘要用于检测意外改动，不是防本地管理员的签名。

- 每次写入先记 `SUBMITTING`；ACK 后记 `ACKNOWLEDGED`。网络/权限/进程异常保留状态，停止后继，不自动重试、补齐、回滚、删除锁或清理新建资源。
- 使用本地锁禁止同一备份并行；调用原 ALB/RDS 工具时也使用其备份锁。不要同时部署、编辑这些资源或切换 profile；本地锁不是跨 AWS 服务 CAS。
- 部分步骤成功后可能遗留收费资源或 disabled 来源。先检查备份/journal/准确现状，不简单重跑；不复位既有尝试。
- `TEMPORARY_IDLE_VERIFIED` 只代表本轮选定计算及网络核验通过；不代表全账号无费用。托管公网 IP 若仍存在，返回 `IDLE_WITH_PUBLIC_IP_RESIDUALS` 和退出码2，不强删 ENI。
- `NETWORK_RESTORED_COMPUTE_STILL_IDLE` 不是应用恢复；`TEMPORARY_COMPUTE_RESUMED` 也不是店铺/菜单验收。
- RDS/Aurora 停止最多7天，AWS 后续可能自动启动。watch 是一次到期收尾，**没有持续7天自动再停库的守护功能**。数据库存储/备份、ECR、Secret、S3、CloudFront/日志/流量等仍可能收费；不能保证绝对零费用。参阅 [RDS停止](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)、[Aurora停止](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-cluster-stop-start.html)。

所需 API 白名单见[独立 CLI 适配器](../ops/temporary-idle/cli.mjs)，ALB/RDS 仍受[原白名单](../ops/aws-resource-power/cli.mjs)限制。工具不新增 IAM、不读取数据库或 Secret 内容。实际账号是否有这些权限尚未由本轮证明。

## 正式上线前移除清单

1. 停止显式启动过的临时 watch/外部临时任务；本轮没有安装任何云端或开机调度，所以没有隐藏常驻服务需要猜测。
2. 先按备份恢复正式需要的网络、ALB/RDS、计算及原扩缩容/周期来源，处理 CFN/DNS 引用，核对应用可用。**不能在资源仍被停用时直接删代码，假装已经恢复。**
3. 删除 `ops/temporary-idle/`、`scripts/aws-temporary-idle.mjs`、`tests/temporary-idle.test.mjs`，更新本手册和主线文档的当前状态。正式模块/workflow/Janitor未接入它，无正式接口需要回滚。
4. ALB删除/RDS停止措施同样是临时政策，最终运行流程不能继续自动调用。若既有两个手动辅助工具也不再需要，在确认无其他使用方后一起移除；先移除单向引用它们的临时代码。
5. 私有恢复备份、真实 journal 和历史决策文档保留追溯，不能把删除临时代码等同于删除数据库或审计证据。

## 最初代码交付阶段的验证

使用合成 AWS 响应与本地临时文件测试，不启动真实 CLI/入口。覆盖停用顺序/持久备份、暂停回读、扩缩容及周期来源恢复、一次性不重放、收费网络删除/重建/新 ID、未知提交不重试、依赖与外部变更拦截、公网 IP 残留及正式代码隔离。

代码交付时 `node --test --test-timeout=15000 tests/temporary-idle.test.mjs tests/aws-resource-power.test.mjs`：**54/54通过**（新增32项、原工具22项）。新代码定向 ESLint 零警告、`npm run typecheck`及三个新模块/入口的语法检查均通过。既有111文件部署闭包仍为 `9f6ceb7ccca8ee542bf8cab4ec120ab79571d20fd97356ddbaa831b58e4c745b`。未改正式运行模块、保护 workflow 或依赖；代码阶段AWS调用和实际新工具执行均0。随后另批的单次实际停用见顶部；仍没有安装常驻自动止费。
