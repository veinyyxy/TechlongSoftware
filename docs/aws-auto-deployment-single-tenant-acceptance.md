# 单租户首轮 AWS 自动部署：当前执行主线

决策D001，2026-10-13 America/Winnipeg。用户在审计后明确同意收缩首轮目标并开始实施，同时要求封存F3c9以便重启。此文档取代旧方案中的“继续F3c9”作为当前导航；[原支线封存](./aws-auto-deployment-f3c9-deferred.md)，所有历史保留。

## 首轮交付定义

管理员触发一个准确sandbox租户任务，后续自动完成独立Secret、独立database/role、空baseline恢复和迁移、ECS服务启动、健康检查、mTLS/JWT配置下发，以及可访问地址和`ready`回写。不是只让一个容器启动，也不是先接付款或开放多租户轮询。

首轮使用一个Cell、一个租户、`standard-v1`、ca-central-1/账号402010193138、sandbox.techlong.cloud；沿用Aurora PG16.14、ECS Fargate和ALB，不改成共享租户数据库，不重建已验收镜像或导出业务数据。50USD/月为目标，不保证整套常驻在50USD内。

资源由受监督的、预先审阅的准确清理路径负责；首轮不要求先完成通用无人值守Cell出生/死亡系统。**自动部署与自动销毁不是同一验收项。** 必须在任何付费创建前具备可执行、准确ARN/ownership绑定的清理方案和失败后人工接管路径；本次同意改变交付顺序，不授权删除现有资源、关掉数据库约束或跳过权限审阅。

后置：付款触发、多Cell/多租户扩容、通用generation/parent/child编排、完整无人值守TTL/失败补偿工厂。保留：隔离、最小权限、凭据不落日志、ownership、拒绝过期重放、健康验收、清理责任和费用核对。付款所需的现有test凭据若应用配置需要仍使用现有安全来源，不为此接入付款触发。

## 四个交付块

| 交付块 | 可核对输出 | 当前状态 |
| --- | --- | --- |
| M1 准确首轮部署包 | 一个Cell/租户的模板、资源/权限/清理范围、镜像与baseline pins、所需新云批准 | **进行中**：25项Cell与7项workload候选、限定部署领取、集中Task/Execution权限及无虚构revision的注册稿完成；Cell权限/准确清理和live root仍待收尾 |
| M2 真实基础设施与数据库 | 经具体批准创建Cell，注册准确lifecycle任务定义，完成真实TLS prepare/restore/migrate/verify | 未执行，付费/权限/DB写另批 |
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

- 镜像：[F3a2真实ECR验收](./aws-auto-deployment-fast-track-f3a2-ecr-published.md)，app `sha256:2af648ae122dad46dcba313481797a49766744c4de167d33642dba124908df07`，lifecycle `sha256:2ab7017dcebd64083e7804001685272a3a5461faa4b7a4bec37adab059980bb4`。未来读回这些精确digest，不重建或改用latest。
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

本轮M1续段已实现限定领取、独立租户workload和集中权限编译，73项定向/相邻检查及真实Neon只读EXPLAIN/AWS模板验证通过；[具体接线、权限表、清理顺序与剩余缺口](./aws-auto-deployment-single-tenant-m1-integration.md)。当前仍无可执行云清单，不创建收费Cell。

下一后继包集中完成**Cell收费创建/准确删除权限与执行范围、supervised cleanup assurance与workload live root、实际单租户/控制签名输入及费用审阅**，之后按具体云/DB范围fresh批准再推进M2。不能用旧scheduler ref或改false绕过缺口；上述项不再拆成新的探针/恢复系列。
