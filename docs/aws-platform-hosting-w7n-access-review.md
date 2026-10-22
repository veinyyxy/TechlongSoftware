# W7n：ECS execution role 与准确 Secret 读取例外待审

本轮准备两个栈模板，但**本清单实际批准范围只有权限接线，不部署承载栈**。代码、CI、AWS只读验证和清单生成不代表批准。W7m凭据已完成，原批准和槽位不可重放，不读取其值或再次连接数据库。

| 阶段 | 当前准备 | 实际写入审批边界 |
| --- | --- | --- |
| W7n access | 两项IAM逻辑资源及现有Secret读取例外 | 本页准确新SHA单独确认 |
| 后续两小时hosting | 11项承载资源完整草案 | 引用真实RoleId及接线结果后另审，不包含在本SHA |

## 准确资源

账号402010193138、区域ca-central-1，Source固定既有techlong-sandbox-dev IAM User及UserId。新栈 `techlong-sandbox-platform-access-v1` 只含：

- `TechlongSandboxPlatformWebExecutionBoundaryV1`：一份新managed policy boundary，初始默认v1，不附给旧角色。
- `TechlongSandboxPlatformWebExecutionRoleV1`：一项新execution角色，引用上述boundary，内含一份同内容 `ExecutionOnly` inline policy；无其他managed policy或应用task角色。

Trust仅ecs-tasks.amazonaws.com，并有SourceAccount=402010193138、SourceArn=本区域本账号ecs:*条件。AWS目前不支持用该条件只限定某一个cluster，所以不宣称单任务/单集群隔离。[AWS说明](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html)

boundary和inline仅允许：本区域ECR认证token（此API只能Resource=*）、准确platform-web仓库的三项pull动作、`/ecs/techlong-sandbox/platform-web`的web/*日志流Create/Put、准确Web Secret GetSecretValue、准确AWS-managed Key的转发Decrypt。KMS条件绑定Secrets Manager ViaService、CallerAccount、准确SecretARN及固定SecretVersionId。**不授予推镜像、创建日志组、写Secret、IAM/CFN/ECS部署或其他Secret读取。**

现有Secret唯一对象为：

`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/neon-v1-UfFKVF`

版本固定 `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f`。对该对象资源策略只改变GetSecretValue的Deny读取例外：从Source一人扩展为Source+准确execution角色ARN；管理动作Deny仍仅Source。此策略本身不新增Allow，实际读取还依赖新角色权限及有效KMS路径。本阶段不Assume该角色、不调用GetSecretValue，**不证明实际ECS取值成功**。[KMS上下文](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)

## 顶层操作与防重放

最多两次顶层AWS写：一次CreateStack（两项具名IAM逻辑资源，CAPABILITY_NAMED_IAM、DisableRollback=true、固定client token）；栈CREATE_COMPLETE且模板/物理ID/RoleId/Trust/boundary默认v1/inline/附加策略/标签准确之后，一次PutResourcePolicy（准确Secret、BlockPublicPolicy=true）。没有Change Set、远程TemplateURL、S3上传、nested stack或自由参数，也不创建CloudFormation service role。

预检先只读核对Source、三项新名称全不存在、Secret准确标签/Key/唯一版本/Source-only原策略及Key启用。预检失败不消费槽或写入。随后 wx+fsync消费 `F:/ChatGPT_workshop/techlong-platform-ecs-access-v1.intent.json`。一经消费永久保留；输出目录/原件不删除、不复位、不自动换槽或重放。

CloudFormation读取等待最多60次、间隔10秒，只读poll不是写重试。Secret写前再次核对Source、原策略及角色真实RoleId。成功或失败后尝试独立只读核验；成功需要原创建和handoff均得到ACK、准确原栈/RoleId/权限一致、独立Secret策略为预期。创建/写入不明、超时、漂移均 `ACCESS_REQUIRES_REVIEW_NO_RETRY`，不自动补齐、回滚、撤权、删除或再次提交。

清单48小时，最晚启动为到期前20分钟；运行写入受20分钟活动窗口及外层到期约束。Source使用既有AWS Login自动刷新、每个顶层写前核验身份；刷新仍可能失败。SDK/CLI应用maxAttempts=1，不保证CloudFormation资源provider/AWS内部不重试。DisableRollback不等于禁止provider内部对本次新对象的补偿清理；本程序不删除旧资源。具名全局IAM名称必须空闲，不接管任何旧栈、角色或policy。

## 必须接受的风险

- **新权限会真实可用。** execution角色可由本账号本区域的ECS任务承担；有权限PassRole/注册任务的其他主体可能使用它。不是只属于将来那个镜像或任务的不可变权限围栏。ECR权限按仓库而非digest限制，Secret Get权限按ARN而非IAM VersionId条件限制；task selector和显式KMS条件另绑固定版本，不承诺阻止管理员未来改配置。
- **跨服务非原子、无CAS。** 可能留下IAM栈/部分资源，或已允许Secret读取但最终回执/核验失败；IAM传播、策略/API序列化、并发都可能影响结果。RoleId核验不能消除核验后竞态。资源策略例外以ARN识别角色，删除后同名重建风险仍存在，需另审处置；不静默修改为其他Principal或追加兜底权限。
- **不会自动到期。** 清单期限不是角色、信任或Secret读取例外的有效期；它们将持续存在，撤权/删除另审。IAM无固定小时资源费，但Secret/API/既有资源继续计费。50USD/月目标不是硬上限。
- **继承的凭据风险仍在。** 若execution角色取得值，其数据库LOGIN及W7m已接受的哈希读取、会话冒充、非行隔离、PUBLIC TEMP、创建者ADMIN等能力可被使用。应用将来获得环境变量，容器/日志/调试可能暴露值；当前不读值、不调应用、不连接Neon。
- **Source权限不降级。** CloudFormation未指定新service role，使用调用者既有权限执行此固定新模板；检查源码/模板/旧证据不等于替代AWS授权，也不承诺Source自身或其他管理员不能改变状态。

Secret管理Deny保持仅Source；不改Key、Secret值/版本/标签、数据库、旧IAM/旧publisher、预算或网络。没有RunTask/RegisterTaskDefinition/CreateService/ALB/DNS/日志组/数据库创建；两小时hosting窗口仍未开始。

## 验证限度与后续

无AWS CI验证精确模板/最小策略/依赖无环/closed bindings/固定digest+UUID/失败不重放等代码契约。生产准备另外只读执行ValidateTemplate两份、ValidateResourcePolicy一次、Access Analyzer identity/trust各一次；均非模拟真实承担execution角色或取值。IAM系统CloudFormation标签只允许与准确栈及逻辑角色匹配的已知键，不接受其他用户标签漂移。

新栈/策略安装完成并独立核验后，才把真实RoleId绑定到[两小时承载草案](aws-platform-hosting-w7n-two-hour-draft.md)下一份fresh执行清单。实际部署和后续清理分审，不以本批准启动ECS或重启旧支线。
