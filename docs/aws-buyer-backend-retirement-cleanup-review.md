# b236过期任务退役与准确遗留栈清理：集中草案

2026-10-30，America/Winnipeg。遵守[执行手册](aws-auto-deployment-execution-runbook.md)。用户仅同意准备方向；**此文不是删除、SQL写入、发布或新周期批准，执行SHA为null**。不新建通用恢复/接管框架或固定任务分支。

## 已核对事实

修复代码90e71745837c2447c1d7adbcf2dc141ea10a2933已推送；[主线合同CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/41067648595)16步及[云桥CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/41067648696)26步成功。冻结110文件及原provider执行器未改；云端仍是旧来源，代码通过不等于已发布。

09:22 CDT限定只读已确认：任务 `job_b236b120d6406d3e296d341b` running/1次尝试/最多1次，租约08:27:46.265已过期且无成功回执；原a00回执仍存在。其余12任务状态终态，但没有重读完整业务正文/保护基准。该任务账本为两计划/两批准/两尝试：Review有证明，RunOnce仍ACKNOWLEDGED无证明，无Inspect。

准确栈CREATE_COMPLETE；服务和唯一任务健康、镜像和buyer任务摘要匹配，准确目标healthy、/health与/ready均200。该事实不是原任务完成证明。原完成deadline09:00:41.818已过；TTL10:00:41和basis10:08:09.592不延长、不保证停费。

私有原件：`F:/ChatGPT_workshop/techlong-buyer-existing-workload-state-readonly-20261030-a/checkpoint.json`，raw SHA `2720ce4b1c9a7e05d92185bf2f747f98043d5cff65401eccab935fbe6d164029`。本轮准备只复用已存证据，无新生产读取。

## 准确拟议范围

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

## 顺序及停止边界

1. 准备且固定准确新SHA、范围、源码/小配方pin、完整事实摘要、风险、写前复核和独立核验预算；未获SHA批准不占槽、不写。
2. 实时核对准确Source和UUID、完整模板/七资源及删除保护/在途变更。只允许最多一次STANDARD DeleteStack（仅StackName、独立ClientRequestToken、DeletionMode；不指定新RoleARN）；复用栈已有角色。权限路径尚未证明，若拒绝则停止，不自行授权。
3. 正常ACK后只读观察及独立证明准确栈与其服务/资源已移除；这不是账号零费用证明。删除失败、超时或结果不明时不重发、不force、不补下一写，仅保留证据和独立核对。
4. 只有准确移除已独立证明后，才允许准确任务的单行SERIALIZABLE退役事务。目标为canceled，不是succeeded；清空lease_owner/lease_token/lease_expires_at，用真实数据库时钟写updated_at/completed_at。payload、attempts/max_attempts、错误字段、dedupe、其他任务、部署outputs/回执及控制账本均保持。
5. 事务须验证准确job/deployment/app、running/1/1、过期原lease、原plan来源、成功回执不存在、无其他活跃任务；锁住必要准确行/控制账本，用服务器端完整行SHA256作CAS，并比较屏蔽上述六个允许字段后的摘要及其他行/账本/保护摘要。不得回填旧时刻或放宽旧完成期限。
6. 数据库COMMIT可能已提交但ACK不明时，不自动ROLLBACK/重试/补写；另用独立TLS只读连接核对结果。云删成功而数据库退役失败会留下部分完成状态，须记录，不自动补偿。

删除与Neon事务跨服务非原子，不能用一次审批声称原子性。原五个执行槽、旧Review/批准和原报告全部保留，不复位或重用；此草案不创建新请求、新租约、新回执或执行周期。

## 为什么不直接套现有写入口

`ops/platform-request-v6/transfer.mjs`只接受pending/attempt0/未租约请求，且原事务包含新任务INSERT，不适用于本任务。旧ready对账器固定其他job并会改三行业务/写成功回执，也不适用。只复用其已验证的指纹、锁、一次提交和独立回读模式；不得改旧断言、把SELECT伪装成INSERT来借用入口，或把只读Inspect当作接管。正式写入批准前，必须完成仅本清单的小配方绑定/局部验证，不新增通用执行器。

## 当前还缺的必要补核（另待许可）

- Source STS最多1次；准确UUID的DescribeStacks、GetTemplate Original、ListStackResources、ListChangeSets各最多1次，不翻页。核对仍存在、模板/七物理ID、角色引用、删除策略、保护和在途变更；不调IAM模拟或读取其他资源。
- 既有.env.local内容读取1次；验证TLS Neon连接1条/最多20条只读SQL及事务控制，固定pg_catalog search_path和UTC。仅返回准确待退役行及其余任务、部署/outputs、控制账本的服务器端SHA256摘要、必要状态/来源投影、约束/触发器/函数/权限元数据；不返回lease token或业务正文，不连接Aurora。
- 不新增ECS/ALB/HTTP/GitHub查询，不读Secret值/PEM/HMAC/DDB项，不写数据库/云、不消费槽、发布、dispatch、续期、删除或重试。身份、证书、作用域不符或请求失败即停，保留记录，不自动换更宽读取。

这次补核仅用于准备，快照按真实新观测5小时；不延长旧任务/TTL/basis。如果准确栈已被其他流程删除，先独立核对，重新生成只含必要剩余处置的待审范围，不把旧清单重放。准备完整后才给正式执行SHA；本次不要求连续40分钟在线或GitHub审批。

## 完整风险与未获批准事项

清理会中断当前健康服务，删除日志/临时任务数据；旧栈UUID不可恢复，部分资源历史可能保留，异步/失败删除可能继续收费。数据库、共享Cell和前端等保留对象也可能持续计费。现有IAM权限不保证实际允许删除，不自动扩权。

Neon owner权限较宽、配置全文件会进入进程内存；网络/提供者日志、元数据及摘要存在泄露风险。锁可能短暂阻塞其他控制写入，实时复核仍不能消除跨服务并发。状态取消是操作员退役，不是原worker成功；不能抹去失败证据或造成功回执。

本轮用户只允许准备方向。实际DeleteStack、单行退役、创建本次清理的永久槽、小配方执行、新来源发布和标准新周期均未获批准；原永久槽不允许删除。完成这一退役/清理后，才重新准备修复版的标准闭环，不在本阶段悄悄创建新任务或恢复旧尝试。
