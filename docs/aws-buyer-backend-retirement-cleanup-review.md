# b236单行退役准备：原栈清理草案已缩减

2026-10-30，America/Winnipeg。遵守[执行手册](aws-auto-deployment-execution-runbook.md)。用户仅同意准备方向；**此文不是删除、SQL写入、发布或新周期批准，执行SHA为null**。不新建通用恢复/接管框架或固定任务分支。

## 最新缩减：不再提出DeleteStack

用户批准的补核于12:46–12:47 CDT实际完成：准确e992…栈DELETE_COMPLETE，原七物理资源全部DELETE_COMPLETE，Original模板匹配；本轮无任何删除提交。Stack.DeletionTime字段为10:08:38.422 CDT，不当作精确完成时间，也不推断删除操作者或一定由TTL触发。已删栈不重发DeleteStack，原下方删除范围只保留追溯。

b236仍running/1/1、lease已过期、completed_at为空且无成功回执；payload/lease owner/dedupe匹配原受审plan。服务器端完整行、屏蔽六个拟变字段后的行、部署/outputs、其余任务及账本/保护SHA256已取得，不返回lease token/业务正文。其余12任务无活跃或租约；账本19/14/14，本任务原两尝试状态未变。九控制函数及jobs保护函数摘要匹配。实际STS1/CFN3/配置1/TLS1/只读SQL14，其他服务/HTTP读取及所有写/槽/调度0。

本地检查点 `F:/ChatGPT_workshop/techlong-buyer-retirement-cleanup-supplement-readonly-20261030-a/checkpoint.json` raw SHA `acab79a91cb7caf62411739a1754d2cbe54f6b0d004e9fc651a47aa5dec17b6e`。只读事实5小时新鲜度不延期原deadline/TTL/basis。未读新的ECS/目标组缺失，CFN删除完成不是所有计费已停止的证明。

**当前唯一后继**：仅准备并局部验证原任务单行退役小配方及执行材料。云写/新任务/新资源上限均0；只允许未来另批最多一行canceled/旧lease清空，不写成功回执，不改payload/attempts/错误字段、其他任务、部署outputs、旧账本/槽。新SHA必须包含执行前准确栈/服务停止核对、数据库锁后CAS和必要保护检查、一次提交及独立TLS回读；目前配方尚未绑定/验证，执行SHA仍null。不因已取得指纹就自动执行，不新建通用恢复入口。

以下为原草案沿革，不构成当前DeleteStack或补核重放指令。

## 已核对事实

修复代码90e71745837c2447c1d7adbcf2dc141ea10a2933已推送；[主线合同CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/41067648595)16步及[云桥CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/41067648696)26步成功。冻结110文件及原provider执行器未改；云端仍是旧来源，代码通过不等于已发布。

09:22 CDT限定只读已确认：任务 `job_b236b120d6406d3e296d341b` running/1次尝试/最多1次，租约08:27:46.265已过期且无成功回执；原a00回执仍存在。其余12任务状态终态，但没有重读完整业务正文/保护基准。该任务账本为两计划/两批准/两尝试：Review有证明，RunOnce仍ACKNOWLEDGED无证明，无Inspect。

准确栈CREATE_COMPLETE；服务和唯一任务健康、镜像和buyer任务摘要匹配，准确目标healthy、/health与/ready均200。该事实不是原任务完成证明。原完成deadline09:00:41.818已过；TTL10:00:41和basis10:08:09.592不延长、不保证停费。

私有原件：`F:/ChatGPT_workshop/techlong-buyer-existing-workload-state-readonly-20261030-a/checkpoint.json`，raw SHA `2720ce4b1c9a7e05d92185bf2f747f98043d5cff65401eccab935fbe6d164029`。本轮准备只复用已存证据，无新生产读取。

## 原集中范围（历史；DeleteStack已从后继移除）

账号402010193138，区域ca-central-1；仅已有Source IAM用户，不新增权限。唯一拟删栈：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/e9925180-d462-11f1-b351-06ffd7a0da8d`

按已封存模板，其七项承载为：

| 逻辑资源 | 类型 | 拟议影响 |
| --- | --- | --- |
| TenantService | ECS Service | 停止并删除该服务/任务 |
| TenantTaskDefinition | ECS TaskDefinition | 注销该任务定义，历史可能保留 |
| TenantTargetGroup | ELB TargetGroup | 删除准确目标组 |
| TenantListenerRule | ELB ListenerRule | 删除准确业务规则 |
| TenantControlListenerRule | ELB ListenerRule | 删除准确控制规则 |
| TenantBusinessControlDenyRule | ELB ListenerRule | 删除准确拒绝规则 |
| TenantLogGroup | Logs LogGroup | 删除该日志组/日志，无法保证恢复 |

**不删除**共享Cell/ALB/监听器/VPC、数据库/角色/Secret、前端CDN/桶、ECR镜像、其他栈或历史证据；不直接StopTask/删单项资源、不force、不RetainResources、不扩IAM。准确最新七个物理ID和完整模板仍须补核，不凭表格直接执行。

## 原顺序及停止边界（需按单行退役重建，不可直接执行）

1. 准备且固定准确新SHA、范围、源码/小配方pin、完整事实摘要、风险、写前复核和独立核验预算；未获SHA批准不占槽、不写。
2. 实时核对准确Source和UUID、完整模板/七资源及删除保护/在途变更。只允许最多一次STANDARD DeleteStack（仅StackName、独立ClientRequestToken、DeletionMode；不指定新RoleARN）；复用栈已有角色。权限路径尚未证明，若拒绝则停止，不自行授权。
3. 正常ACK后只读观察及独立证明准确栈与其服务/资源已移除；这不是账号零费用证明。删除失败、超时或结果不明时不重发、不force、不补下一写，仅保留证据和独立核对。
4. 只有准确移除已独立证明后，才允许准确任务的单行SERIALIZABLE退役事务。目标为canceled，不是succeeded；清空lease_owner/lease_token/lease_expires_at，用真实数据库时钟写updated_at/completed_at。payload、attempts/max_attempts、错误字段、dedupe、其他任务、部署outputs/回执及控制账本均保持。
5. 事务须验证准确job/deployment/app、running/1/1、过期原lease、原plan来源、成功回执不存在、无其他活跃任务；锁住必要准确行/控制账本，用服务器端完整行SHA256作CAS，并比较屏蔽上述六个允许字段后的摘要及其他行/账本/保护摘要。不得回填旧时刻或放宽旧完成期限。
6. 数据库COMMIT可能已提交但ACK不明时，不自动ROLLBACK/重试/补写；另用独立TLS只读连接核对结果。云删成功而数据库退役失败会留下部分完成状态，须记录，不自动补偿。

删除与Neon事务跨服务非原子，不能用一次审批声称原子性。原五个执行槽、旧Review/批准和原报告全部保留，不复位或重用；此草案不创建新请求、新租约、新回执或执行周期。

## 为什么不直接套现有写入口

`ops/platform-request-v6/transfer.mjs`只接受pending/attempt0/未租约请求，且原事务包含新任务INSERT，不适用于本任务。旧ready对账器固定其他job并会改三行业务/写成功回执，也不适用。只复用其已验证的指纹、锁、一次提交和独立回读模式；不得改旧断言、把SELECT伪装成INSERT来借用入口，或把只读Inspect当作接管。正式写入批准前，必须完成仅本清单的小配方绑定/局部验证，不新增通用执行器。

## 已执行的补核范围（保留原申请，不可重放）

- Source STS最多1次；准确UUID的DescribeStacks、GetTemplate Original、ListStackResources、ListChangeSets各最多1次，不翻页。核对仍存在、模板/七物理ID、角色引用、删除策略、保护和在途变更；不调IAM模拟或读取其他资源。
- 既有.env.local内容读取1次；验证TLS Neon连接1条/最多20条只读SQL及事务控制，固定pg_catalog search_path和UTC。仅返回准确待退役行及其余任务、部署/outputs、控制账本的服务器端SHA256摘要、必要状态/来源投影、约束/触发器/函数/权限元数据；不返回lease token或业务正文，不连接Aurora。
- 不新增ECS/ALB/HTTP/GitHub查询，不读Secret值/PEM/HMAC/DDB项，不写数据库/云、不消费槽、发布、dispatch、续期、删除或重试。身份、证书、作用域不符或请求失败即停，保留记录，不自动换更宽读取。

这次补核仅用于准备，快照按真实新观测5小时；不延长旧任务/TTL/basis。如果准确栈已被其他流程删除，先独立核对，重新生成只含必要剩余处置的待审范围，不把旧清单重放。准备完整后才给正式执行SHA；本次不要求连续40分钟在线或GitHub审批。

## 完整风险与未获批准事项

清理会中断当前健康服务，删除日志/临时任务数据；旧栈UUID不可恢复，部分资源历史可能保留，异步/失败删除可能继续收费。数据库、共享Cell和前端等保留对象也可能持续计费。现有IAM权限不保证实际允许删除，不自动扩权。

Neon owner权限较宽、配置全文件会进入进程内存；网络/提供者日志、元数据及摘要存在泄露风险。锁可能短暂阻塞其他控制写入，实时复核仍不能消除跨服务并发。状态取消是操作员退役，不是原worker成功；不能抹去失败证据或造成功回执。

本轮用户只允许准备方向。实际DeleteStack、单行退役、创建本次清理的永久槽、小配方执行、新来源发布和标准新周期均未获批准；原永久槽不允许删除。完成这一退役/清理后，才重新准备修复版的标准闭环，不在本阶段悄悄创建新任务或恢复旧尝试。
