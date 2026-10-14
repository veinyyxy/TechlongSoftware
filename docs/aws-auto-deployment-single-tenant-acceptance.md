# 单租户首轮 AWS 自动部署：当前执行主线

决策D001，2026-10-13 America/Winnipeg。用户在审计后明确同意收缩首轮目标并开始实施，同时要求封存F3c9以便重启。此文档取代旧方案中的“继续F3c9”作为当前导航；[原支线封存](./aws-auto-deployment-f3c9-deferred.md)，所有历史保留。

**最新路线 D002（2026-10-13）**：用户暂不升级账户，先采用 Aurora Express / Full 双模式兼容设计：当前优先 `express_iam`，未来保留 `full_password`。设计已记录，适配代码、双模式镜像和Express实机验收尚未完成；本次不改云/数据库，不删除失败Stack、不复位原两槽。下一步仅 C1 集中连接/协议/provider 适配，再按具体资源新SHA审阅 C2；下方原Full路线的“升级后继续”及阶段状态保留为历史，不能当执行授权。[完整兼容、快速切换、风险与实施顺序](./aws-auto-deployment-aurora-dual-mode.md)。

## 首轮交付定义

最新C2a：最小Express单次创建+一次管理员只读连接及独立准确清理入口已编码，FREE/ACTIVE、PG17.9默认、查空/配额、SLR和既有Source权限只读核对通过，无需新IAM。本批未创建资源/连接DB；新SHA待批准，真实事实先于剩余C1写适配。0–1ACU/auto-pause不是费用硬上限，旧Full栈、生产RDS、Neon/F3c9和槽保留。[准确范围、费用、完整风险与新SHA](./aws-auto-deployment-aurora-dual-mode-c2-review.md)。

最新C1续段：lifecycle v2任务/独立只读准入/角色目录与receipt接线已实现，写入口仍关闭；旧Full/172pins/F3c9和槽保持。下一准备最小Express事实核验的准确新范围，取得引擎/网关/目录事实后完成写适配；尚无可执行云SHA，不自行安装IAM、创建资源或修改业务。[本续段与最新继续位置](./aws-auto-deployment-aurora-dual-mode-c1-lifecycle.md)。

最新C1编码：双模式连接核心、严格v2契约、app pool接线和只读连接/Secret来源已完成，平台13/Backend41定向检查与types通过；云端双候选38488816036和完整Backend CI38488815977均success，新增断网自检/安全门禁通过，未ECR发布。完整lifecycle/目录/activation及Express实机仍未完成，不提前标记M2或ready，不改旧门禁/槽。[C1实现与继续位置](./aws-auto-deployment-aurora-dual-mode-c1.md)。

管理员触发一个准确sandbox租户任务，后续自动完成独立Secret、独立database/role、空baseline恢复和迁移、ECS服务启动、健康检查、mTLS/JWT配置下发，以及可访问地址和`ready`回写。不是只让一个容器启动，也不是先接付款或开放多租户轮询。

首轮使用一个Cell、一个租户、`standard-v1`、ca-central-1/账号402010193138、sandbox.techlong.cloud，保持独立database/role、ECS Fargate和ALB。D002当前先适配Express实际引擎/网关/IAM；原Full PG16.14与已验收镜像保留，但不是Express兼容证明，后续需云端构建新双模式镜像并验收。原空baseline不重导出，不导出业务数据。50USD/月为目标，不保证整套常驻在50USD内。

资源由受监督的、预先审阅的准确清理路径负责；首轮不要求先完成通用无人值守Cell出生/死亡系统。**自动部署与自动销毁不是同一验收项。** 必须在任何付费创建前具备可执行、准确ARN/ownership绑定的清理方案和失败后人工接管路径；本次同意改变交付顺序，不授权删除现有资源、关掉数据库约束或跳过权限审阅。

后置：付款触发、多Cell/多租户扩容、通用generation/parent/child编排、完整无人值守TTL/失败补偿工厂。保留：隔离、最小权限、凭据不落日志、ownership、拒绝过期重放、健康验收、清理责任和费用核对。付款所需的现有test凭据若应用配置需要仍使用现有安全来源，不为此接入付款触发。

## 四个交付块

| 交付块 | 可核对输出 | 当前状态 |
| --- | --- | --- |
| M1 准确首轮部署包 | 一个Cell/租户的模板、资源/权限/清理范围、镜像与baseline pins、所需新云批准 | **进行中**：原Full IAM、业务/config/policy、私有输入和公钥Secret已有证据；D002双模式设计完成但Express代码/镜像/权限/真实清理未完成，未激活 |
| M2 真实基础设施与数据库 | 经具体批准创建Cell，注册准确lifecycle任务定义，完成真实TLS prepare/restore/migrate/verify | **原Full首次创建失败回滚**：公钥Secret保留、Stack ROLLBACK_COMPLETE，原槽不可重放；当前保持Free Plan，先C1适配再单独审阅Express实机范围，未注册任务/部署tenant |
| M3 一个任务到ready | 管理员触发的受审单次入口、ECS健康端点、mTLS/JWT、地址和ready回写 | 未完成；原默认Worker仍关闭，不能改flag伪装启用 |
| M4 清理验收与交接 | 准确资源有序清理、最终库存/费用、完整运行回执 | 未执行；不把ECS失败检测当数据库或全资源清理 |

完成依据是这些真实输出，不是测试数量或F3子阶段数量。不预先启动新birth TTL；M1蓝图中的日期/ExpiresAt只是提案deadline，既不创建资源也不安装自动删除调度。实际创建与验收的时限在可执行范围就绪后fresh审阅，不以旧过期计划执行。

## M1 已落地的代码

新增 `lib/deployments/cloudformation/single-tenant-acceptance-cell.ts`，独立纯渲染入口 `renderSingleTenantAcceptanceCell`。复用原网络、Aurora、ALB/mTLS与ECS Cluster定义，移除旧PLAN_ONLY `CellCleanupSchedule`、四个仅调度需要的参数及相应dependency；新增明确的DeliveryTrack/CleanupMode标签，**不修改旧renderer或F3c9任何冻结代码**。

候选无RESERVED/ARMED/PAID切换、parent/birth品牌、Lambda/Scheduler/IAM资源，无执行能力。原安全组、private DB、TLS/mTLS、Aurora0–1ACU、Delete策略等定义保持；其收费创建和删除风险以后仍须具体批准。模板中的25项定义如下：

| 资源组 | 准确logical IDs |
| --- | --- |
| 网络11项 | CellVpc, CellInternetGateway, CellGatewayAttachment, PublicSubnetA/B, DatabaseSubnetA/B, PublicRouteTable, PublicDefaultRoute, PublicSubnetRouteAssociationA/B |
| 安全组与入口5项 | LoadBalancerSecurityGroup, TaskSecurityGroup, OneShotTaskSecurityGroup, DatabaseSecurityGroup, DatabaseOneShotIngress |
| ECS Cluster1项 | CellCluster |
| ALB与规则4项 | CellLoadBalancer, BusinessHttpsListener, BusinessControlDenyRule, ControlMtlsListener |
| 数据库4项 | CellDatabaseSubnetGroup, CellDatabaseLogGroup, CellDatabaseCluster, CellDatabaseWriter |

AWS服务可能创建内部资源（例如RDS托管master Secret），25是template定义数，不是全部计费资源数。候选**不含应用Service、应用/lifecycle TaskDefinition、租户Secret或activation**；这些在M1剩余范围里集中收敛，不宣称整个部署包已完成。目标Stack名仍为 `techlong-sandbox-cell-sandbox-1`，名称并非UUID身份；创建前必须准确查空，并与旧已删除UUID区分。

## 已有资产与关键接线

- 原Full镜像：[F3a2真实ECR验收](./aws-auto-deployment-fast-track-f3a2-ecr-published.md)，app `sha256:2af648ae122dad46dcba313481797a49766744c4de167d33642dba124908df07`，lifecycle `sha256:2ab7017dcebd64083e7804001685272a3a5461faa4b7a4bec37adab059980bb4`。这些证据保留；D002需要新双模式镜像、新digest/发布审阅，不能改用latest或声称旧镜像已支持Express。
- baseline/mTLS：[已安装基础](./aws-auto-deployment-fast-track-f3c2-material-foundation-executed.md)，archive `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a`、manifest `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971`。不重导出业务数据；未来仍需准确对象字节/权限核对。
- 复用 `prepared-runtime-composition.ts`、ECS one-shot adapter、租户Secret/SQL与有序cleanup、control client、Worker任务状态机。单次受审live root仍需接线；当前default/prepared的false保留。
- 后端现有admitted prepared root强制验证DDB activation/epoch、真实Fargate任务和RDS会话。**MVP不能绕过这些限制，也不能把本新模板作为旧authority品牌直接传入。** 下一只实现固定首轮资源的合法适配与准确activation/ownership材料，不重建通用Cell生命周期协议。
- 现有CFN执行角色的权限尚未满足收费部署，TaskRole/boundary、worker/execution role、tenant Secret和控制凭据输入仍须集中列明。F3c9 coordinator角色保持原deny-all/空策略/并发0，不复用它执行新主线。

## 本轮验证与追溯

3项新增模板检查与10项相邻旧模板检查共13项通过，typecheck及定向lint零警告通过；验证独立候选、仅允许的原资源差异、依赖闭合/无重复tag、默认不可执行及错误scope拒绝，不是离线数据库模拟或云部署验收。首次开发检查发现共享tag数组重复添加风险，已改为每资源复制数组并加入重复key检查，最终测试通过。

定向检查命令：`node --experimental-strip-types --test tests/single-tenant-acceptance-cell.test.ts tests/shared-cell-stack-v3.test.ts`。另已重新核对F3c9全部132源码pins、26份旧材料文件及已消费V6永久槽，均未变化。

**2026-10-13 10:07:29.648 CDT / 15:07:29.648 UTC**，Source准确身份通过，AWS `ValidateTemplate`成功，25资源/4参数、capabilities为空；15312字节的当次候选SHA `97dca5624d36d278484f1c81f0748ecda1a19735757dc108b86293fbe73ed11e`，requestId `a17a362a-348e-4e9d-bed6-abbe7bea9f24`。输入来自历史拟议基础设施选择，requestedAt刷新用于本次提案，**不是live Neon客户状态、实际创建或执行批准**。原始结果在本次工具回执，非秘密摘要在 [M1 capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.prepared.json)。此SHA是当次模板fingerprint，不是批准SHA；重新渲染日期变化会改变模板hash。

这是[AWS模板验证](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ValidateTemplate.html)，不能证明实际创建权限、服务就绪、数据库迁移或任务成功。没有CreateChangeSet/CreateStack、IAM/DB/table写、Invoke或新槽消费；没有读取Secret值，也没有连接Neon。F3c9冻结132文件与历史材料继续核对保留。

## 唯一下一步

当前唯一下一步由 **D002 C1** 接管：集中实现双模式数据库连接与版本化契约，Full保留、Express新增，不先执行任何云写。以下D001逐段继续记录为历史；以页首最新D002及其兼容方案为准，不重新升级账户、部署Full或重放旧Run。

本轮M1续段已实现限定领取、独立租户workload和集中权限编译，73项定向/相邻检查及真实Neon只读EXPLAIN/AWS模板验证通过；[具体接线、权限表、清理顺序与剩余缺口](./aws-auto-deployment-single-tenant-m1-integration.md)。当前仍无可执行云清单，不创建收费Cell。

新策略已接到 apply/reconcile，租户清理使用持久创建 UUID 和 provision predecessor，Cell 创建/准确删除接口与独立 prepared root 完成；[最新接线及真实只读差异](./aws-auto-deployment-single-tenant-m1-runtime.md)。107项定向/相邻检查通过，但真实新权限、业务行/执行绑定、Neon 50USD policy、control/DNS 输入及批准 guard/journal/verifier仍未就绪；原记录保留。没有可执行云 SHA，默认仍 disabled。

下一后继包集中完成这些**实际权限、输入和审阅边界**，之后按具体云/DB/收费/清理范围 fresh 批准再推进M2。不能用旧scheduler ref或改false绕过缺口；上述项不再拆成新的探针/恢复系列。

最新续段已生成新 Cell 专属 boundary/role/inline **最多三写**的待审清单，实际 AWS 策略验证 findings 为零，新对象仍不存在；管理员指定邮箱只读精确匹配通过，复用真实 active plan 的已发布 schema-v2，无业务写。13项新/相邻检查通过，F3c9冻结132 pins 保持；[准确 SHA、有效期、完整风险和继续位置](./aws-auto-deployment-single-tenant-m1-cell-iam.md)。这是 IAM 安装审批材料，不授权 Cell/DB/DNS/Secret/运行时；本轮写和消费槽仍 0。

用户随后明确批准上述 SHA，实际三次新 IAM 写成功；**18:37:01.667 UTC** 独立新进程 12 项全部通过，`IAM_INDEPENDENTLY_VERIFIED_NO_CELL`。新角色能力为 active，但本范围不准部署 Cell；DB/Secret值/Invoke/Cell API 均 0，新永久槽消费1，旧资料/冻结 pins保留。[实际回执与下一主线](./aws-auto-deployment-single-tenant-m1-cell-iam-installed.md)。下一集中收尾业务/config/control 与 live guard/journal/readiness 及准确 Cell/DNS/费用/清理范围，再按 fresh 具体批准推进 M2，不回到 F3c9。

最新业务续段：用户确认新店铺名/商户用户名，真实 published schema-v2 已按 plan overlay 解析为22项配置，独立 bootstrap 六 DML 原子提交/永久 journal/独立回读入口完成，**未提交**。拟5条新业务行+env budget1000→5000，不创建deployment/job或提前启动TTL，保留旧隔离原件；[准确SHA、有效期与完整风险](./aws-auto-deployment-single-tenant-m1-business-bootstrap.md)。仅新 Cell renderer 的 ManagedBy 对齐已安装IAM条件，原模板/云IAM不改；新25资源候选AWS ValidateTemplate、24项定向相邻检查/type/lint及冻结132pins通过。本轮云/DB写/槽消费0，control/live执行门禁仍待主线收尾。

用户随后批准7b741e22...，六DML一次原子提交成功；**19:21:19.915 UTC** 独立13项全通过，`BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL`。新5行及5000 policy已落库，原记录/保护不变；无deployment/job/TTL、AWS写0，商户账号/密码尚未生成，runtime仍false。新永久槽消费1不可重放；[实际回执与继续位置](./aws-auto-deployment-single-tenant-m1-business-bootstrap-installed.md)。下一以真实app/config/scope接好安全control/payment来源和实际权限/live清理门禁，再审阅Cell/DNS/费用/清理，不回到F3c9。

最新本机输入续段：新RSA-3072签名对、既有mTLS和服务端test-payment安全来源已准备在受限本机r2，首位商户密码来源/独立Neon配置回读/具体prepared接线完成；**22:15:59.651 UTC** 独立8项全部通过，`PRIVATE_INPUTS_VERIFIED_RUNTIME_DISABLED`。用户批准的一次Stripe官方只读认证HTTP200/test mode通过，不证明稍后包字节或webhook投递。实际IAM文档差异已归纳，旧mTLS宽ACL风险保留，132+4+14冻结pins未变；本轮云/DB写、Secret值、bearer/control请求、job/TTL/Cell均0。[本段证据与恢复位置](./aws-auto-deployment-single-tenant-m1-private-inputs.md)。下一集中实际权限/live guard/准确清理/public-key Secret以及收费Cell/DNS/费用批准包，M1未完成，继续封存F3c9。

最新基础待审：现有Source对固定Cell创建/删除命名空间/PassRole、公钥CreateSecret+Tag五项模拟allowed，基础前无需额外IAM安装；真实角色/查空/证书/engine/AZ/key共27项、业务13项及无tenant generation、AWS模板验证通过。具体fresh guard/永久journal/独立Inspect与**未部署tenant的准确UUID清理**入口已完成，最大两次直接创建（公钥Secret+25资源Cell），未执行；后续任务/tenant IAM/DNS/activation/job必须依赖Cell真实输出另批。3h基础用量估算0.56715USD+变量，730h持续活跃约138.81USD，50目标非cap/ExpiresAt不自动删除。40检查/type/lint及158历史pins保持，云/DB写/Secret值/槽消费0。[准确SHA、时限、完整风险与恢复位置](./aws-auto-deployment-single-tenant-m1-cell-foundation-review.md)。这是D001依赖收口，不重启F3c9，也不宣称完整tenant cleanup或M1/部署闭环已完成。

用户随后批准ebeef325...，两次直接创建完成，公钥Secret留存、真实Cell UUID已捕获；RDS因账户Free Plan要求Express/升级拒绝，CFN自动回滚。22:56:49.205UTC独立Inspect确认ROLLBACK_COMPLETE/20历史physical rows全DELETE_COMPLETE；真实VPC/IGW/DB/ALB/log不在，ECS仅INACTIVE/0任务0service，失败Stack记录保留。GetAccountPlanState证实FREE/ACTIVE；没有主动删除、升级账户或重试，原两槽已消费，private Secret值/IAM/Neon/job/runtime0。172历史/本次pins不变；[实际结果、准确失败Stack清理清单和下一选择](./aws-auto-deployment-single-tenant-cell-foundation-executed.md)。最快保留原私有Aurora方案需用户手动Paid Plan升级；Express涉及网络/认证/provider重新设计，不自动换。后继须先确认plan资格，再fresh单独审批旧失败UUID清理及新独立Cell尝试，保留公钥/旧槽，不重放原Run。
