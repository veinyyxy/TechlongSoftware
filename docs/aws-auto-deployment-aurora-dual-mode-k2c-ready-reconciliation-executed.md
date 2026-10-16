# K2c 已完成：单租户平台 ready 与独立认证验收通过

用户对准确SHA `f98bcd6ce2123c1e99085097e846937a8f389002f7637acd6cb1547efce2c5c0`、三行原子协调/两次私密加载/四个认证GET及[完整风险](aws-auto-deployment-aurora-dual-mode-k2c-ready-reconciliation-risk.md)回复“确认”后，唯一Run成功，再由新进程执行唯一Inspect。**本批准与三个永久槽全部消费；不再Run/Inspect、加载私密包、调用应用或重试写入。** 原代码/risk、准备原件、旧失败证据和所有历史槽保持。

## 实际结果与时间

以下为Winnipeg **2026-10-16 CDT**，括号为同日UTC；DB字段采用Neon自己的服务器时钟，不假定与本地时钟严格同步。

- 01:30:44.712（06:30:44.712）：根永久槽独占写入并fsync；此前当前AWS/平台投影、Neon九条旧行与catalog精确匹配。
- 01:30:52.223（06:30:52.223）：Run重新mTLS/JWT读取readiness/control，准确store、实际image、初始化及有效配置验证通过。
- 01:30:52.473（06:30:52.473）：唯一write intent槽消费；落盘后再核对代码/时限/事实窗口，无重试。
- **01:30:52.825（06:30:52.825）：收到唯一SERIALIZABLE事务成功响应，七语句通过、三条原记录更新提交。** 后置承载/Neon只读回读通过。
- 01:31:23.999（06:31:23.999）：独立Inspect槽消费。
- **01:31:26.312（06:31:26.312）：新进程重新加载原控制私密材料、签发新JWT，经mTLS独立readiness/control验收通过；平台、承载及catalog也已独立只读核验。**

最终结果 `READY_PLATFORM_AND_INITIALIZED_CONFIGURATION_INDEPENDENTLY_VERIFIED`。它证明当时一个准确sandbox租户已初始化、有效配置匹配、承载健康且平台终态协调完成，**不是从零申请到部署的无人值守全链路验收，也不是永久可用保证**。

## 三条已有记录已收口

| 对象 | 实际最终状态 | 保留边界 |
| --- | --- | --- |
| `app_e897a4377bce498b9c5ee9e64509dcad` | active；准确access URL；provisioned/updated时间已写，suspended=NULL | 原workspace/subscription/template/configuration及其它列摘要不变 |
| `dep_7c99bd249470184852f0dc74` | ready/current_step=ready；artifact指向实际修复镜像；准确stack/observation和人工receipt已写 | 原desired_plan/plan_hash/幂等键/错误字段保持，旧outputs JSON嵌套保留、原text及整行摘要留存 |
| `job_202c8dc12a8bf379f3a7c693` | succeeded；lease owner/token/expiry清空；完成/更新时间已写 | attempts/max_attempts仍1；未claim/续租/增加attempt或创建job，原错误等其它列保持 |

访问地址：[first-acceptance.sandbox.techlong.cloud](https://first-acceptance.sandbox.techlong.cloud)。本轮只验证固定:8443控制端点的认证readiness/control及ALB healthy target，**没有额外浏览器/公网443 GET或端用户业务操作验收**。

实际镜像 `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，配置hash `06d3cb50dd46b5f32771c356b7e7cd7d524a0707799ae24b9ace0672ef7281c9`；新栈UUID `f71252c0-c917-11f1-8148-02ff648cb917`、task definition:2、1 running/healthy target保持。原store `add89a8c-f43e-81b9-8287-0cb6c5c54f87`、店名/八项entitlements/两套主题与重算配置摘要匹配；本轮没有另读owner用户行或密码。

**这是明确批准的人工恢复终态协调，不冒充原worker成功。** DB outputs内`manualReadyReconciliationV1`保留manifest、原artifact/plan、九条旧行摘要、旧lease归因及前输出摘要；原token未离开数据库。Run后与独立Inspect的九条完整行摘要相同，扣除允许列的九条摘要与原清单完全一致，catalog SHA `3acdd88bfd8f8320a0191dcc97189b8ea39b08a34f0296e4df373abb43d84a1e`保持。未更改或停用任何触发器、权限或封存历史计划。

## 实际动作与证据

- **1次Neon SERIALIZABLE写事务 / 7条固定语句 / 3条已有行；0 INSERT/DELETE/DDL或新行。** Program SHA `cc7ffb96d4ef33b9ca5ee20d799b0147480912a205f2e31c51b94dcb82da6e1f`，receipt/observation SHA `95ba591938f9113464069ce4017ec6b7e0c3af7853820faec1806bf7a7a0cdc9`。
- Run/Inspect共**2次原私密包加载、4个认证GET**，旧loader必读的未使用测试付款材料仅入内存；不调用Stripe、不读/派生owner密码。不保存私钥/token/HTTP正文或原始异常。
- 三组现有元数据观察合计105 SDK/33 CLI，另含三个固定状态快照事务，共6次Neon只读事务、12条只读语句。计数来自固定路径及回执，不称为完整CloudTrail/提供者内部活动遥测。
- **0 AWS/IAM/Secret/DNS/DDB写、0 GetSecretValue、0 Aurora连接、0应用POST、0自动重试。** 未再初始化、改镜像、部署/删除资源、续期或关闭Janitor；没有本轮新增临时grant需要撤权。

五份最终Review、九份Run、五份Inspect及三个永久槽，共**22份原件raw hashes**，见[脱敏执行摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-k2c-ready-reconciliation.executed.json)。独立本地核对重编译program、code/history绑定、两个真实平台快照、catalog和三槽关联全部通过，没有追加云/DB/私密/HTTP调用。原[准备记录](../ops/aws-sandbox/reviews/aurora-dual-mode-k2c-ready-reconciliation.prepared.json)不回填；r1只读Review保留但永不执行。

## 现在离主目标还有什么

首轮最小目标中的“一个真实sandbox租户承载、初始化/配置、地址及平台ready”现已具备当时实证，包含本次显式人工恢复。**不要再扩展F3c9/Grant/generation支线，不再重复provision或重发镜像。**

唯一下一阶段是首轮验收收尾：先根据现有证据列出端用户访问/关键业务冒烟、失败与到期清理、资源/费用退出项中尚未证明的部分，准备最小验收及退出方案。任何新的认证/私密读取、业务操作、清理/状态修正或收费续用仍按具体范围fresh审批；本次没有授权额外调用、自动监控或资源删除。不要把已安装Janitor当成“已验证全部资源清理/平台状态同步”。

**workload固定到期仍为2026-10-16 07:04:28.726 CDT（UTC12:04:28.726）**，旧Janitor保持启用，没有续期。到期删除可能令当前ready地址失效，也不保证控制面自动转终态、全资源退出或账单归零。Cell/Aurora/Fargate/Secret/ECR继续收费，50 USD/月只是目标非硬cap；成功验收不代表之后免费。
