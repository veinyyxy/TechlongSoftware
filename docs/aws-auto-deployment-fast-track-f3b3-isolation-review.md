# F3b3：旧规划隔离与控制面只读审阅完成，安装前须修订执行身份

后续切片已完成独立Executor v2代码/新ZIP和新role只读核验，密封隔离契约仍未安装；最新继续位置见 [独立v2执行身份与候选产物](./aws-auto-deployment-fast-track-f3b3-dedicated-executor-v2.md)。以下记录保留本次13:29Z初始审阅时的状态与证据。

2026-10-08 Winnipeg。用户选择 **保留实例与订阅，研究隔离历史规划记录**，并非批准取消/暂停、修改 schema 或执行云变更。本阶段完成真实 Neon 关联/触发器核验、原行及业务状态私有快照、设计审阅器以及 Source 刷新后的 AWS 控制面只读核验。发现旧 Janitor 身份不能仅通过更换 boundary 复用，提出独立执行身份的修订方案。**本次只读审阅切片已完成，F3b3 尚未整体完成；没有可执行安装/数据库清单 SHA。**

## 真正需要保留的业务状态

目标为 `dep_d00144511731f1c20991aa56`：planned/plan_only、cell-demo-1、attempts0；唯一关联实例 `app_fb1962e93a9a4cc2acf046170593d9e3` 为 pending，订阅为 active。job/resource/capacity/schedule/step全部0，实例关联deployment数量1。这不等于可以默认停掉客户实例或修改订阅。

准确生产环境仍为 `env_aws_sandbox_ca_central_1`、account402010193138/ca-central-1/cell-sandbox-1。按现有全部五类查询语义，activeTenant=1、nonterminalDeployment=1，capacity/liveResource/nonterminalSchedule=0。只取消deployment一行不能消除pending实例门禁，本阶段不做这种不完整处置。

## 直接迁移不可行

真实 Neon 的 `app_instance_deployments_admission_reopen_fence` 已启用，session_replication_role=origin；实际 function 定义禁止修改 deployment.environment_id/app_instance_id。这不是本地旧文件的推断。即使目标专用planning environment槽位未占用，简单UPDATE迁移依然被现有不可变协议拒绝。

| 方案 | 本阶段判断 |
| --- | --- |
| 直接改environment_id | 拒绝，违反实际不可变trigger |
| 禁用trigger/replication bypass，或删除原行再复制 | 不允许；会破坏既有 ownership/原件保留边界 |
| 暂停实例或改订阅 | 不符合用户选择；不执行 |
| 新的密封、不可执行规划隔离登记 | 可研究的候选，需要新schema与独立版本化证明；未实施 |

候选为 append-only `deployment_plan_only_isolations` 登记：原deployment/environment_id/plan bytes/hash和完整快照全部保留；只有fresh准确原行快照与无任何执行引用的证据才可登记。需要永久冻结原行与所有未来job、created/owned resource、capacity、schedule、step引用；客户实例/订阅不冻结也不修改。未来实际部署必须使用新deployment，并继续被五类ownership集合看见。

这不是“给plan_only加排除过滤”：未来快照协议必须携带准确、永久密封证书，旧schema2 source/authority/deletion协议继续失败关闭。当前真实source查询完全不改，当前门禁仍为1/1。新DDL、登记、协议接线和在线验证必须分别有具体scope/fresh批准；现阶段没有migration文件、DDL executor或自动注册入口。[现有严格source](../lib/deployments/execution/neon-shared-cell-zero-tenant-source.ts)

设计数据为 `ops/aws-sandbox/reviews/f3b3-plan-isolation-design.prepared.json`，mode `DESIGN_REVIEW_ONLY_NO_EXECUTOR`。准备一个物理规划environment而绕过trigger不是候选方案。

## 独立证据与代码

真实READ ONLY/SERIALIZABLE/deferrable transaction核对原行、业务状态、触发器启用/会话状态和全部关联计数，原始private preimage不提交Git。最终目录 `F:/ChatGPT_workshop/techlong-f3b3-legacy-readonly-20261008-a2`，review SHA `113f62e2dd5ee643466818d6ea100ff4539e12745c421d646724d214218112f6`；isolation-review.json原始文件SHA `399f7decc0400d3068a0d21ed27f31a60eb7e26d1ffb8c52f19c5311686b9a59`。它是**设计审阅hash，不是执行许可**。a1快照保留，但后续审阅应使用包含trigger启用状态的a2。

新collector只支持 `--out` 的新私有目录，不接收Apply或approval参数。新纯审阅器强制准确target/环境、完整byte pins、严格字段和非负计数；任何执行尝试、非planning mode、多deployment或资源/作业/容量/调度/步骤存在都阻止候选资格。6项定向测试、typecheck、lint与PowerShell AST通过；无AWS/Neon业务写、云调用Lambda、Secret上传、角色创建、镜像重建、Worker启用。

初次关联读取使用不存在的deployment_events表名而只读失败，随后以实际schema表名核对成功；没有写入、没有用失败查询当作零行。后续collector保留独立完整证据。

## 控制面安装前置

初次Source只读STS返回登录session过期；用户随后确认“Source 已刷新”。2026-10-08T13:29:09Z 的collector成功核对准确Source IAM user/account。刷新只用于现有资源读取，没有新增IAM或安装授权。

`inspect-f3b3-control-plane.ps1` 的真实结果保存在 `F:/ChatGPT_workshop/techlong-f3b3-control-readonly-20261008-a1/control-inventory.json`，原始文件SHA `f0c8fd4ccf68171dc24a2872bb71d648173fdc2bfa45979cda95797a89c484d0`。只读取Secret元数据，不GetSecretValue，不写IAM/函数/调度。准确两新函数、DrainCoordinatorRole、两专属boundary与两Secret均ABSENT；旧函数仍为PLAN_ONLY、nodejs22.x、60s/128MB，code SHA base64 `3cC05X0dGdj6RZpQLW9n5jwJ6Ln9oLfWqCNaZPQdO3k=`。

关键实际发现：`TechlongSandboxCellJanitorExecutionRole` 的 boundary 是 `TechlongSandboxCellJanitorBoundary` default v2，而且**同一managed policy也作为身份策略附加**，inline数量0。`DenyPlanOnlyCoordinatorMutations` 对 Resource * 无条件拒绝 DeleteStack、DDB PutItem、IAM PassRole等变更。仅换boundary指针并不能移除仍附加的身份策略Deny；显式Deny优先于Allow。[AWS官方策略评估规则](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html)

因此F3b2草案的 `executorExistingRoleName` 复用路线不可安装，历史草案与a5产物保留而不改写。修订候选是独立 `TechlongSandboxCellTtlExecutorRole`，保留旧role/boundary/attached policy/PLAN_ONLY函数完全不动。**该新role不在本次原collector的读取范围，存在性尚未核验，不能宣称ABSENT。** 当前deletion core、Secret admission和executor artifact严格绑定Janitor身份，不能直接换role或伪造caller ARN；下一代码切片需要独立版本化的精确身份入口与新产物，不是环境变量放行任意role。

兼容性材料为 `ops/aws-sandbox/reviews/f3b3-control-plane-compatibility.prepared.json`，绑定本次AWS原始文件SHA和旧policy/trust/attached list/选定函数配置的canonical pins，所有安装/写入/runtime授权均false。它只是修订材料，不是Grant或执行清单。

拟议两个Secret的公开定价参考是每个0.40USD/月，即存储基准约0.80USD/月；API调用、Lambda、日志等另计，不能当完整费用上限，也没有使用新账号free credits抵扣假设。[AWS Secrets Manager官方价格](https://aws.amazon.com/secrets-manager/pricing/)。安装前仍应按准确区域/资源/时间核对费用；50USD/月只是目标。

## 同一 F3b3 的继续位置

1. 准备独立executor身份的版本化精确入口，保留旧Janitor协议；按新产物修订控制面范围，并只读核验新增候选role存在性，不拆旧policy、不放宽共享boundary、不重放旧publisher/Grant批准。
2. 按用户保留业务的方向继续独立密封隔离协议设计；新schema/单行登记/快照版本升级均需具体范围，不能自动安装，也不修改原immutable trigger或旧查询来“凑零”。
3. 安装材料须绑定修订后的executor artifacts与仍有效的drain产物、准确Secret/DB角色/IAM/函数/调用/期限/费用和fresh prestate。实际Cell/authority不存在时，不能伪造运行期drain/cleanup SHA。

目前仍须补权限/数据库作用域/authority writer与调度的实际proof，F3整体未完成。默认Worker关闭，已发布source19cc镜像及消费过的1ab slot不重放。两个main按默认授权提交，无新分支；服务端仅同步继续位置。
