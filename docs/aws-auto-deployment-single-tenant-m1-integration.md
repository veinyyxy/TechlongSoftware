# M1：限定部署领取、租户模板与集中权限材料

2026-10-13 America/Winnipeg。[D001主线](./aws-auto-deployment-single-tenant-acceptance.md)继续，未重启F3c9。本轮解决会直接阻挡首轮部署的接线问题；没有安装权限、创建Cell、领取业务任务或写数据库。**M1尚未全部完成，当前没有可执行云批准清单。**

## 已实现

1. `single-deployment-scope.ts`绑定deployment/app/environment、plan/configuration两个hash及已验收app镜像digest。`NeonDeploymentExecutionRepository`新增可选scope；默认入口行为保留，首轮使用scope限定领取。限制同时放入released_disallowed、exhausted和candidate三个CTE，避免只限定最终领取却修改别的客户过期任务；后续failed_cleanup仅消费已限定的CTE结果。保留DB clock、lease token、SKIP LOCKED及同deployment sibling互斥。loadContext对目标和hash再次核对，不调整容量计数或旧业务状态。
2. Worker CLI支持这五个限定参数，必须完整提供且使用`--once`或`--check-runtime`。不完整、拼错或重复参数拒绝，不能悄悄退回全队列；scope先复制，再严格验证所有字段为字符串，显式undefined/null ID也拒绝，不能变成SQL的null/global sentinel。默认root仍disabled，参数只是限制范围，不授权执行。
3. `single-tenant-acceptance-workload.ts`复用原租户工作负载定义和原epoch/Secret/ownership检查，独立输出7项资源：TenantLogGroup、TenantTaskDefinition、TenantTargetGroup、TenantBusinessControlDenyRule、TenantListenerRule、TenantControlListenerRule、TenantService。去除旧TenantCleanupSchedule及调度参数/依赖，明确supervised cleanup，不冒充旧scheduled/ApplyReady品牌。mTLS、独立租户Secret JSON引用、/ready健康检查、固定单task保持。按照交付优先，候选从FARGATE_SPOT改为标准FARGATE；这只避免采用Spot容量，不保证永不故障，实际费用另估算批准。旧renderer不改。
4. `single-tenant-acceptance-access.ts`集中复用既有prepared-v2和single-tenant lifecycle IAM编译器；绑定同一部署/租户/plan、实际物理Secret及Key ARN，新增ECS ExecutionRole的两Secret转发解密与两个准确日志流前缀补充权限，不替换原共享boundary/已有inline。新增lifecycle日志组草案（7天保留）。所有输出均DATA_ONLY_NOT_INSTALLABLE，不授予运行时能力。
5. lifecycle注册稿与activation分开：`compileAcceptanceLifecycleRegistration`只需Cell实际endpoint/master Secret等坐标，**不需要伪造task-definition revision**；注册后由AWS返回准确ARN，独立回读后再编译activation/后继权限材料。当前compiler只校验坐标形状，不证明输入已真实存在；单元测试中的fixture ARN不是部署证据。

## 集中权限表：不另开通用授权支线

**10:31:12.001 CDT / 15:31:12.001 UTC**，Source身份通过，六个准确既有role/inline/attachment/boundary只读核对完成。以下是当次事实，未来安装前仍需fresh核对，Allow statement数量不是有效权限证明。

| 使用方 | 当前只读事实 | 首轮处理 |
| --- | --- | --- |
| Cell CFN服务角色 | TechlongSandboxCellCloudFormationExecutionRole / RoleId AROAV3GNMXTZOJLYFB4HB，空策略，boundary v1无Allow | 不能靠追加inline突破无Allow的boundary；需准备独立、准确收费Cell权限范围，优先不改封存F3c9角色 |
| 租户CFN服务角色 | TechlongSandboxCloudFormationExecutionRole / AROAV3GNMXTZKHYBCRSOE，boundary v7亦attached，13 Allow statements | 复用并审阅7项工作负载所需权限，不重建默认role，不据metadata宣称ECS创建可用 |
| 单部署执行者 | TechlongSandboxProvisionerRole / AROAV3GNMXTZMEBX7MOF7，boundary v6亦attached，11 Allow statements | 准确tenant epoch/activation、Secret、RunTask/PassRole、租户CFN与DNS范围集中核对；新权另批 |
| lifecycle TaskRole | TechlongSandboxTenantLifecycleTaskRole / AROAV3GNMXTZDIWVT3BKN，原inline、共享boundary v3 | 复用已有窄IAM编译器，实际两Secret/Key、两个DDB key、baseline/receipt范围；新专属boundary/inline安装另批 |
| ECS ExecutionRole | TechlongSandboxTaskExecutionRole / AROAV3GNMXTZJHJWAN4IR，原pull/Secret inline、共享boundary v3 | 只准备补充inline：准确tenant/control public-key Secret、经Secrets Manager解密、两个log stream前缀；原策略保持 |
| 应用TaskRole | TechlongSandboxTaskRole / AROAV3GNMXTZLH2AU5I5G，空identity策略、共享boundary v3 | 不为应用容器添加不需要的AWS写权限；依靠ExecutionRole注入租户Secret |

真实Key/Secret、Cell ARN/outputs、注册revision和新租户行未产生前，不填占位对象生成安装批准。当前两个权限编译器均不验证metadata的真实性，必须由后继真实只读回读/批准入口绑定。Source登录有效不代表批准IAM安装。

## 受监督清理：已收敛顺序，执行接线仍待完成

创建前的同一审阅包必须包括实际资源范围、清理执行者及权限、准确创建回执/ARN捕获办法和失败人工接管责任。新Cell创建回执保存准确StackId、创建token、模板/参数/标签和真实资源inventory；名称不是身份。CFN原生rollback是否开启及其删除范围须在该批准中明确，不延用旧RESERVED的DisableRollback批准。

正常有序清理复用现有fenced tenant cleanup：**准确租户工作负载 → 准确database/role → 该generation Secret → 准确Cell stack → 独立库存/费用核对**。先处理租户再处理共享Cell；不删除平台Secret、旧实例/订阅、baseline、证书/TrustStore或封存控制面。RDS服务生成的master Secret等不计在25项template定义内，必须在真实清理后核对是否遗留。

部分失败时先只读判定具体已创建对象和ownership，无法归属或出现其他资源即停下请求方向，不进行名字猜测删除、自动复位或重放。没有把这个清理顺序当已安装或可执行证明：Cell准确删除入口及它的权限、租户有序清理的实际live root、创建响应丢失后的准确归属回读仍须在同一后继实施包完成。

特别注意：现有Worker仍调用旧租户renderer，且硬编码`cloudformation:...:TenantCleanupSchedule`确认。**本轮没有伪造这个ref，也没有将无调度模板传为旧ApplyReady类型。** 首轮supervised cleanup assurance和工作负载需要在独立live root明确适配，保留原默认模式。限定领取已经接到CLI，但不等于新的整条执行路径已启用。

## 真实验证与可追溯记录

- **10:40:03.007 CDT / 15:40:03.007 UTC**：Neon PG18.6，Serializable READ ONLY事务，`transaction_read_only=on`；实际限定领取语句仅做不带ANALYZE的EXPLAIN，返回1个计划行，ModifyTable/Update计划结构核对通过。没有运行UPDATE、领取job、读取Secret或改变业务数据。
- 第一次EXPLAIN报SQLSTATE42883；本地schema证明desired_plan/payload是text，显式`::jsonb`修正后SQL可计划。中间一次诊断输出plannedSuccessfully=false仅因脚本以EXPLAIN的null rowCount判断成功；最终按真实`rows/QUERY PLAN`核验通过。不倒填为数据库写失败，也没有写重试。
- **10:46:52.459 CDT / 15:46:52.459 UTC**：Source准确身份及AWS ValidateTemplate成功，新租户BODY为11174字节、7项资源、20参数、capabilities为空。fingerprint `a2762e8679a17bf2a66dfe88e15b2ecde3e89993210bbee7455c1cb8f40de768`，requestId `56cff9f0-6b92-40b8-8098-a486fd1e32e8`。只是拟议坐标的BODY验证，非live Cell/客户/Secret/epoch证明，不是执行批准SHA。
- 带五个完整提案参数的`--check-runtime`实际仍返回disabled/offline_only、无DB访问/云写；这些提案IDs/hashes不是已创建的业务对象。
- 73项定向/相邻检查、typecheck及定向lint零警告通过，覆盖新scope/workload/access和原Worker、schema结构；未新增本地数据库模拟、Docker/镜像构建或generation探针。原Worker回归保持，F3c9冻结132文件再次校验未变化。
- 原只读结果在本次工具回执，非秘密摘要在[slice capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.integration.json)。无IAM/Cell/TaskDefinition/activation安装、Lambda调用、DB写或新永久槽消费；F3c9原132文件及旧材料/槽继续保持。

## 唯一后继包

下一集中完成：**Cell收费创建及准确删除的权限/执行范围、supervised cleanup assurance与新workload的live root接线、实际单租户业务行/控制签名输入和费用审阅**。现有Cell role无Allow、单次live root未实现与缺少真实ARN是实际阻断，不通过改flag或宣称模板验证等于部署来跳过。准备可执行范围后才提交具体fresh SHA批准，再进入M2；不继续追加F3c9协议或把上述三项拆成新的探针/恢复系列。
