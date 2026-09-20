# AWS Sandbox S0–S3-B5 安全 Bootstrap 与受控 cleanup-only Cell 基础

这个目录保存可审查的静态配置、CloudFormation 模板、IAM 边界、TTL Janitor、镜像构建基础、B5 低成本支撑资源、destroy-capable Build #7 镜像对应的 inspect-default lifecycle TaskDefinition（尚未执行），以及默认不执行的运维脚本。仓库中不包含 Access Key、Secret Access Key、Stripe 密钥、数据库密码或私钥。

S3-A Bootstrap 脚本默认仅运行本地验证；只有显式选择 `CreateChangeSet` 或 `Apply`、确认账号、提供预算通知邮箱并确认 MFA 前置条件后，脚本才会产生 AWS 写操作。B5-J4b 又增加了独立 IAM 管理根与 cleanup-only child Bootstrap：管理 Stack 持有四组 boundary + role 共 8 个 IAM 资源，child 只含 4 个非 IAM 清理/只读资源，不创建 VPC、ALB、ECS、Aurora 或 Shared Cell。J4b 已于 2026-08-26 按短期授权窗口流程部署并完成严格回读与双次空 inventory 探测；管理根最终恢复 `LOCKED`，四个付费就绪门禁仍全部为 `false`。

## 固定安全边界

示例默认值如下：

- AWS Account：`402010193138`
- Region：`ca-central-1`
- 月预算：`10 USD`
- 单次部署 TTL：`7200` 秒
- 最大并发 Cell / 部署 / 租户：均为 `1`
- Sandbox 域名：`sandbox.techlong.cloud`
- 数据库：最多 1 个共享 Aurora PostgreSQL Serverless v2 Cell，租户使用独立 database
- Aurora 版本：B4 渲染模板固定 PostgreSQL `16.14` 且关闭自动小版本升级；此前只读核验显示 `ca-central-1` 提供普通版 16.8–16.14，实际创建前仍须重新确认并拒绝 `limitless`
- Aurora 容量：最小 `0 ACU`、最大 `1 ACU`，空闲 `300` 秒后自动暂停
- SaaS Worker 云端 Apply：仍关闭；Bootstrap 与租户 Apply 是两个独立开关

这些默认值不是 AWS 授权。未来执行器在每次调用 AWS 前仍必须通过 STS 核对 Account、Region、Role ARN 和短期凭据，并且必须先创建可用的到期清理任务，再创建任何收费资源。

## 目录

```text
ops/aws-sandbox/
├─ README.md
├─ package.json
├─ sandbox.example.json
├─ cloudformation/
│  ├─ guardrails.template.json
│  ├─ s3-bootstrap.template.json
│  ├─ s3-b5-lifecycle-log-support.template.json
│  ├─ s3-b5-lifecycle-task-definition.template.json
│  ├─ s3-b5-cell-bootstrap-management.template.json
│  ├─ s3-b5-cell-lifecycle-management.template.json
│  └─ s3-b5-cell-bootstrap.template.json
├─ codebuild/
│  └─ buildspec.aws-sandbox.yml
├─ lambda/
│  ├─ janitor.cjs
│  └─ cell-janitor.cjs
├─ policies/
│  ├─ provisioner-permissions-boundary.example.json
│  └─ sandbox-expensive-actions-deny.example.json
└─ scripts/
   ├─ render-bootstrap.mjs
   ├─ render-b5-cell-bootstrap-management.mjs
   ├─ render-b5-cell-lifecycle-management.mjs
   ├─ render-b5-cell-bootstrap.mjs
   ├─ render-b5-cell-bootstrap-j4c-deployed.mjs
   ├─ render-b5-cell-bootstrap-j5gg-v2.mjs
   ├─ render-b5-support-rollback.mjs
   ├─ lifecycle-log-support-contract.mjs
   ├─ s3-b5-cell-bootstrap-management.ps1
   ├─ s3-b5-cell-lifecycle-management.ps1
   ├─ s3-b5-cell-bootstrap.ps1
   ├─ s3-b5-lifecycle-log-support.ps1
   ├─ s3-b5-lifecycle-task-definition.ps1
   ├─ s3-b5-shared-cell-cleanup-control.ps1
   ├─ s3-b5-shared-cell-admission-fence.ps1
   ├─ s3-b5-shared-cell-provision-authority-operator.ps1
   ├─ s3-b5-shared-cell-provision-authority-preflight.ps1
   ├─ s3-b5-support-bootstrap.ps1
   ├─ s3-bootstrap.ps1
   ├─ s3-build-image.ps1
   ├─ s3-rollback.ps1
   ├─ validate-cell.mjs
   ├─ validate-b5-cell-bootstrap-management.mjs
   ├─ validate-b5-cell-lifecycle-management.mjs
   ├─ validate-b5-cell-bootstrap.mjs
   ├─ validate-b5-lifecycle-log-support.mjs
   ├─ validate-b5-lifecycle-task-definition.mjs
   ├─ validate-b5-shared-cell-cleanup-control.mjs
   ├─ validate-b5-shared-cell-admission-fence.mjs
   ├─ validate-b5-shared-cell-provision-authority-operator.mjs
   ├─ validate-b5-shared-cell-provision-authority-preflight.mjs
   ├─ validate-b5-support.mjs
   ├─ verify-managed-policy-document.mjs
   ├─ verify-change-set-template.mjs
   └─ validate.mjs
```

`guardrails.template.json` 只描述按 `user:Environment$aws-sandbox` 成本分配标签过滤的月度 Cost Budget 和邮件通知。通知邮箱只能在执行时作为参数传入。AWS Budgets 的账单数据有延迟，不能代替 TTL Janitor。

此过滤依赖 Billing 中已经激活 `Environment` 用户成本分配标签；新激活标签和费用归集都可能延迟。执行 Bootstrap 前必须在 Billing 控制台确认该标签可用于 Cost Explorer/Budgets，否则 `$10` Budget 可能暂时看不到 Sandbox 费用。

`s3-bootstrap.template.json` 不创建 Cell、VPC、NAT、ALB、ECS Service、Aurora/RDS、Route 53 Hosted Zone 或租户资源。它只创建：

- MFA 强制的 `TechlongSandboxProvisionerRole`，信任关系只接受现有 `techlong-sandbox-dev` IAM User；不修改该用户或 Administrators 组。
- 有独立 Permissions Boundary 的 CloudFormation Execution Role、Janitor Role、Scheduler Invoke Role、CodeBuild Role、ECS Task Execution Role、普通 tenant web Task Role 和专用 Lifecycle Task Role。
- 全局 Janitor Lambda 与 `rate(15 minutes)` EventBridge Scheduler 安全扫描。
- `techlong-sandbox` Scheduler Group，供每个租户先创建一次性 TTL 清理计划。
- 标签不可覆盖、推送扫描、最多保留两个镜像的 `techlong-sandbox-speedfeast` ECR Repository。
- 完全阻止公网访问、AES256 加密、`source/` 一天过期的专用 CodeBuild 源码 Bucket。
- 默认构建必定失败、仅可显式 Source/Buildspec override 启动的 CodeBuild Project；固定 `aws/codebuild/standard:8.0`、最小 Compute、5 分钟超时、并发 1。
- exact `techlong-sandbox-402010193138-ca-central-1-tenant-receipts` receipt Bucket：完全阻止公网访问、Bucket owner enforced、SSE-S3、只允许 `tenant-lifecycle/v1/`、强制 `If-None-Match: *`，receipt 一天后过期。
- exact `techlong-sandbox-tenant-external-epoch-authority` DynamoDB 表：单一 `authority_key` 分区键、`PAY_PER_REQUEST`、最多约 `5 RRU/s` 与 `2 WRU/s` 的 best-effort on-demand ceiling，不启用 PITR、Stream、索引或收费的 KMS managed key。
- 公网 tenant web service 使用的 `TechlongSandboxTaskRole` 已完全移除原有 `techlong-sandbox-*` S3 identity policy；它不能读写 receipt 或读取 runtime Secret。独立 `TechlongSandboxTenantLifecycleTaskRole` 只允许读取/conditional-write exact receipt，以及在 `ManagedBy`/`SecretSchema` 标签匹配时读取 generation-bound Secret。`TechlongSandboxDeploymentWorkerRole` 只允许 exact receipt read、`tenant:*` authority CAS、在 `cell-sandbox-1` 上运行 revision-pinned `task-definition/tenant-lifecycle:*` 并恢复/观察/停止自身标记的任务、Pass exact TaskExecutionRole/LifecycleTaskRole，以及管理 generation-bound `techlong/sandbox/tenant/*/runtime/g*` Secret；它没有 CloudFormation、ALB 或 RDS 写权限。

Janitor 不设置 Lambda Reserved Concurrency：该账号当前 Lambda 并发额度较低，预留 1 会违反 AWS 至少保留 10 个未预留并发的账号规则。并发风险改由 Sandbox `maxTenants=1`、单个全局计划、每次最多删除一个栈、严格所有权标签和幂等 `DeleteStack` 控制。

Bootstrap 模板中的 Janitor 源码使用占位符，部署脚本会从 `lambda/janitor.cjs` 注入并检查渲染后模板不超过 CloudFormation 的直接 TemplateBody 限制。不要直接部署未渲染的 `s3-bootstrap.template.json`。

## 本地检查

不需要 AWS CLI，也不会发起网络请求：

```powershell
npm --prefix .\ops\aws-sandbox test
```

该命令同时执行 S0–S3-A Bootstrap、S3-B Shared Cell 渲染、B5-J4b management/child Bootstrap，以及 B5 support resource/Change Set/rollback 边界检查。单独运行 `validate.mjs` 只覆盖基础 Bootstrap，不等价于完整验证。

检查内容包括：

- 所有 JSON 都可以解析。
- 默认 Account、Region、预算、TTL、最大并发和域名没有漂移。
- 相关 CloudFormation 模板均受 Account 与 Region 条件保护。
- Budget 排除 Credit，避免赠送额度掩盖实际消耗。
- Budget 只统计带 `Environment=aws-sandbox` 成本分配标签的资源。
- 预算通知阈值为 10%、30%、50%、80%、100%。
- Permissions Boundary 不包含允许全部动作的语句。
- Deny 策略覆盖 NAT、VPC Endpoint、EC2、RDS Proxy、Global Database、快照恢复、预留购买、Marketplace 和客户管理 KMS Key 等高风险动作。唯一允许规划的数据库形态是受控的 Aurora PostgreSQL Serverless v2 Cell。
- 文本中没有常见 AWS、Stripe、PostgreSQL URL 或 PEM 私钥特征。
- Provisioner Role 信任关系强制 MFA，且模板中不存在 IAM User/Group 资源。
- 租户 Janitor 对错误前缀、缺标签、错误标签、无效/未来 `ExpiresAt`、嵌套 Stack，以及不匹配的 DeploymentId、AppInstanceId、CellId 或 ResourceGeneration 均拒绝删除。
- Shared Cell 模板固定为 render-only；独立 one-shot SG 零入站，只有公网 TCP 443 与 exact DB SG TCP 5432 出站，相关输出/VPC/TTL/所有权/SG 规则由只读 preflight exact 校验。
- B5-J4b management 模板只含 Manager、CloudFormation execution、Janitor、Scheduler 四组 boundary + role，共 8 个 IAM 资源；child 模板只含 LogGroup、只读 inventory Lambda、ScheduleGroup 与 `DISABLED` Schedule，共 4 个非 IAM 资源，不含 VPC、ALB、ECS、Aurora、NAT、VPC Endpoint 或 Route 53 Hosted Zone。
- child 不拥有 IAM lifecycle；外置 CloudFormation execution role 只能 `PassRole` 给外置最小 Janitor/Scheduler 两个角色。child template 以 raw SHA-256 内容寻址存入私有 build-source Bucket 的 `b5-cell-bootstrap/templates/sha256/<raw>.json`，明确避开 Provisioner 可写的 `source/*`。AuthorGrant 只允许该 exact object 的 `GetObject`，并锁定 `TemplateUrl`、`RoleARN`、deterministic `ChangeSetName` 与 4 种 `ResourceTypes`；ExecuteGrant 打开前必须精确预检 child Change Set/原始模板。正常授权序列固定为 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`，每个短窗后立即撤销，child 删除只使用 `RollbackGrant → Locked`，空 inventory probe 必须精确执行两次。
- J5g-g 的 `AuthorityV2ConsumerUpdate` 固定重建已部署 J4c-v1 前态，只接受 `UPDATE_COMPLETE` Stack 上唯一 `CellJanitorFunction` 的 `Modify / Replacement=False / Scope=Properties`；Schedule 不允许出现在 Change Set 中。休眠的 `AuthorityV2ConsumerRollback` 反向固定同一单 Lambda 形状和独立 Change Set 名称，不能复用会删除整个 child Stack 的 `BootstrapRollbackGrant`。严格回读还会下载 AWS 返回的 Lambda ZIP，以无重定向、双超时、压缩包/解压长度上界核对唯一 `index.js` 的逐字节内容、ZIP `CodeSha256` 与稳定 `RevisionId`。
- ECR、CodeBuild、源码 Bucket、Scheduler 和角色权限边界没有漂移。
- receipt Bucket、authority table、专用 LifecycleTaskRole、WorkerRole 与 B5-H Adapter 的固定账号、区域、Cell、`tenant-lifecycle:*` family、角色和 generation-bound Secret namespace 一致；普通 TaskRole 无 receipt/Secret identity permission。Worker ECS 的三个 `Resource: *` statement 精确限于按 region/cluster 收紧的 `ListTasks`、只在 `ecs:CreateAction=RunTask`/exact request tags 下生效的 tag-on-create，以及按 exact region 收紧的只读 `DescribeTaskDefinition`。CloudFormation execution boundary 当前只可 Pass TaskExecutionRole/普通 TaskRole，不能再 Pass LifecycleTaskRole；rollback 模板删除五个新增资源、撤销两项既有 boundary 中的 B5 能力，并保留普通 TaskRole 的 S3 通配权限移除、TaskDefinition registration scope 和 cleanup 授权修正；它不删除原有 Bootstrap、ECR、Janitor 或预算。

## Bootstrap 操作模式

所有命令默认只做本地检查，不调用 AWS：

```powershell
.\ops\aws-sandbox\scripts\s3-bootstrap.ps1
.\ops\aws-sandbox\scripts\s3-rollback.ps1
.\ops\aws-sandbox\scripts\s3-build-image.ps1
```

可选操作按风险递增：

```powershell
# 只读 AWS CloudFormation 模板验证
.\ops\aws-sandbox\scripts\s3-bootstrap.ps1 -Mode OnlineValidate

# 创建但不执行 Change Set；仍会在 AWS 留下 Change Set/REVIEW_IN_PROGRESS 状态
.\ops\aws-sandbox\scripts\s3-bootstrap.ps1 `
  -Mode CreateChangeSet `
  -BudgetAlertEmail 'ops@example.com' `
  -ConfirmAccountId '402010193138' `
  -AcknowledgeMfaPrerequisite

# 真实创建 Bootstrap 资源；必须再次显式选择 Apply
.\ops\aws-sandbox\scripts\s3-bootstrap.ps1 `
  -Mode Apply `
  -BudgetAlertEmail 'ops@example.com' `
  -ConfirmAccountId '402010193138' `
  -AcknowledgeMfaPrerequisite
```

## B5 低成本支撑资源：一次受控 Bootstrap Update

这一步只更新既有 `techlong-s3-bootstrap`，不会另建 support/Cell Stack。由于当前 Provisioner 的 boundary 按设计不能更新它自己的 Bootstrap，首次更新必须在 source user 登录恢复后执行一次；脚本精确拒绝其他账号、区域、Stack 和 principal。更新完成后，source user 不参与运行态：MFA Provisioner 只能以固定 session name Assume 最小 WorkerRole。这个受控例外不等于允许长期使用 IAM User，也不会打开 `applyRuntimeReady` 或 `cleanupRuntimeReady`。

所有在线模式都只接受 AWS CLI v2 `login_session` profile：`login_session` 必须精确为 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，`aws configure list` 的 access/secret key source 必须都是 `login`，终端不得设置 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` 或 `AWS_SESSION_TOKEN`。任意 `AWS_ENDPOINT_URL`/service-specific endpoint 环境变量，以及当前、default 或递归 source profile 中的 `endpoint_url`/`services` 配置也会被拒绝；通过检查后，脚本仍会在进程内强制 AWS CLI 忽略 configured endpoints。脚本随后在线确认 caller identity，并要求该用户只绑定 `arn:aws:iam::402010193138:mfa/techlong-sandbox-dev`。先在本机浏览器完成 AWS CLI 登录；长期 access key、shared credentials、`credential_process` 和 AssumeRole profile 都会被这个一次性 Bootstrap 入口拒绝：

```powershell
aws login --profile 'techlong-sandbox-user'
aws configure get login_session --profile 'techlong-sandbox-user'
aws configure list --profile 'techlong-sandbox-user'
```

`AcknowledgeMfaSession` 只是补充人工确认，不替代上述机器门禁。如果 AWS CLI 无法把凭据来源报告为 `login`，禁止用布尔参数绕过，改用已经完成 MFA 登录的 AWS Console 人工创建、检查和执行完全相同的 Change Set。

默认仅本地验证，不调用 AWS：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-support-bootstrap.ps1
```

真实更新严格分为创建、查看、执行同一个 digest-bound Change Set 三条命令：

```powershell
# 1. 创建但不执行
.\ops\aws-sandbox\scripts\s3-b5-support-bootstrap.ps1 `
  -Mode CreateChangeSet `
  -Profile 'techlong-sandbox-user' `
  -ConfirmAccountId '402010193138' `
  -ConfirmRegion 'ca-central-1' `
  -ConfirmBootstrapStackName 'techlong-s3-bootstrap' `
  -AcknowledgeAwsWrite `
  -AcknowledgeLowCostNotFree `
  -AcknowledgeSourceUserBootstrapRisk `
  -AcknowledgeMfaSession

# 2. 只读查看完整资源差异
.\ops\aws-sandbox\scripts\s3-b5-support-bootstrap.ps1 `
  -Mode InspectChangeSet `
  -Profile 'techlong-sandbox-user'

# 3. 人工确认查看结果后执行同一个 Change Set
.\ops\aws-sandbox\scripts\s3-b5-support-bootstrap.ps1 `
  -Mode ExecuteChangeSet `
  -Profile 'techlong-sandbox-user' `
  -ConfirmAccountId '402010193138' `
  -ConfirmRegion 'ca-central-1' `
  -ConfirmBootstrapStackName 'techlong-s3-bootstrap' `
  -ConfirmExecutionPhrase 'I_ACKNOWLEDGE_B5_SUPPORT_BOOTSTRAP_AWS_CHANGES' `
  -AcknowledgeAwsWrite `
  -AcknowledgeLowCostNotFree `
  -AcknowledgeSourceUserBootstrapRisk `
  -AcknowledgeMfaSession `
  -AcknowledgeChangeSetReviewed
```

Change Set 名由渲染后模板 SHA-256 自动生成，description 同时绑定 raw 与 canonical SHA-256。Inspect 和 Execute 都会调用 Change Set `GetTemplate --template-stage Original`，兼容 CLI 返回 JSON object 或 JSON string 的 `TemplateBody`，规范化后与本地本次渲染模板做 exact structure/hash 比较；同名或伪造 description 不能绕过。两阶段还会拒绝参数、账号、区域、Stack、精确 Add/Modify/Remove 集合、replacement、Notification ARN 或 CloudFormation service RoleARN 漂移；既有 Bootstrap Stack 状态只接受 `CREATE_COMPLETE`、`UPDATE_COMPLETE` 或 `UPDATE_ROLLBACK_COMPLETE`。如果 Stack 已绑定 service role 或处于其他状态，脚本会 fail closed，必须先单独评审，不能静默继续。`OnlineValidate`、`InspectChangeSet` 只有 source identity/MFA、IAM 与 CloudFormation 只读调用；其他未显式选择的模式均不会产生写入。

费用不能保证绝对为零：S3 只产生少量 Standard storage/request 费用且 receipt 一天后过期；DynamoDB 只按实际请求计费，并设置 best-effort `5 RRU/s`、`2 WRU/s` 上限；IAM Role 不单独计费。模板不创建 KMS customer key、PITR、Stream、GSI、CloudWatch 新运行时、VPC、NAT、ALB、ECS、RDS/Aurora 或 DNS 资源。现有 `$10` Budget 仍只是延迟告警，不是硬断路器。

首次 B5 support 更新还会把已部署 Janitor 提升到当前仓库的 generation/AppInstance/Cell ownership 围栏版本；CloudFormation 会把 `JanitorFunction` 及引用其 ARN 的 `SchedulerInvokeRole`、`GlobalJanitorSchedule` 显示为无替换更新。三项都绑定在同一份 exact TemplateBody，并且不扩大 Janitor 的 tenant-only 删除前缀。

2026-08-22 已按上述三阶段流程执行 Change Set `techlong-s3-b5-support-1fb78e3a91ede382`。raw SHA-256 为 `1fb78e3a91ede382702792f2521f935aa690670ead7e05dc89a57cec0d0b0145`，canonical SHA-256 为 `15d68976bf94a94f0be0d205194782e4700a89aa51a846457b38b8e2c8988b62`；11 项变更与 allowlist 完全匹配，5 项新增、6 项无替换修改，Bootstrap 最终为 `UPDATE_COMPLETE`。部署后只读核验确认 receipt prefix 为空、authority table 为空且 `ACTIVE`、普通 TaskRole 没有任何 inline/attached policy、专用 LifecycleTaskRole/WorkerRole 权限与 trust/boundary 匹配。带 `aws:RequestedRegion=ca-central-1` 上下文的 IAM 模拟允许 5 个 Shared Cell evidence 读取动作，`CreateVpc`/`CreateDBCluster` 仍为 `implicitDeny`。该更新没有创建 Cell、tenant Stack、VPC、ALB、ECS 或 RDS；两个 runtime gate 保持关闭。

回退同样是 create / inspect / execute 三阶段，但执行会先清空 exact receipt prefix，然后通过 Bootstrap UPDATE 删除 receipt Bucket、Bucket Policy、authority table、LifecycleTaskRole 和 WorkerRole，并从 `ServiceRoleBoundary` 与 `ProvisionerBoundary` 撤销 B5 support、Worker Assume 与 Shared Cell 只读预检能力。只读预检权限仅包含 `ca-central-1` 的 ECS/ELBv2/EC2/RDS Describe 动作，从未包含这些服务的写权限。回退会永久删除所有 receipt 和 authority record；普通 TaskRole 的 S3 通配权限移除和已升级 Janitor 围栏会保留，现有 ECR、CodeBuild、普通 TaskRole、Provisioner、Budget 和任何 Cell/tenant Stack 均不在删除范围内：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-support-bootstrap.ps1 -Mode CreateRollbackChangeSet -Profile 'techlong-sandbox-user' -ConfirmAccountId '402010193138' -ConfirmRegion 'ca-central-1' -ConfirmBootstrapStackName 'techlong-s3-bootstrap' -AcknowledgeAwsWrite -AcknowledgeLowCostNotFree -AcknowledgeSourceUserBootstrapRisk -AcknowledgeMfaSession
.\ops\aws-sandbox\scripts\s3-b5-support-bootstrap.ps1 -Mode InspectRollbackChangeSet -Profile 'techlong-sandbox-user'
.\ops\aws-sandbox\scripts\s3-b5-support-bootstrap.ps1 -Mode ExecuteRollbackChangeSet -Profile 'techlong-sandbox-user' -ConfirmAccountId '402010193138' -ConfirmRegion 'ca-central-1' -ConfirmBootstrapStackName 'techlong-s3-bootstrap' -ConfirmExecutionPhrase 'I_ACKNOWLEDGE_B5_SUPPORT_ROLLBACK_DATA_DELETION' -AcknowledgeAwsWrite -AcknowledgeLowCostNotFree -AcknowledgeSourceUserBootstrapRisk -AcknowledgeMfaSession -AcknowledgeChangeSetReviewed -AcknowledgeDeleteAllReceipts -AcknowledgeDeleteAuthorityRecords
```

## B5-J3 destroy-capable-image, inspect-default lifecycle TaskDefinition

`s3-b5-lifecycle-task-definition.template.json` 只含一个 `AWS::ECS::TaskDefinition`，不会创建 Cluster、Service、Task、日志组、Secret、网络或数据库。镜像 artifact 已包含受审 destroy runtime，并固定为完成独立 smoke 与零发现扫描的 Build #7 digest `sha256:6001bde1cc05058ae3df83fbdb084e8cd53b64325ecb6663b43a5fccc8ef22be`（Backend commit `201187cddb1a77690c0df2c7779d354af6009e7c`）；但该 TaskDefinition 的默认命令仍严格固定为 `/usr/local/bin/node db/tenant_lifecycle.js inspect`，注册过程也不运行它。Fargate 资源为 `256 CPU / 512 MiB`，容器使用 `65532:65532`、只读 root filesystem、drop ALL、零端口/卷/sidecar/Secret。日志目标预留为 `/saas/cell-sandbox-1/tenant-lifecycle`，但本阶段不创建它，`LogGroupReady=false`。

脚本默认 `LocalValidate`；在线模式只接受精确的 `techlong-sandbox-provisioner` MFA AssumeRole 会话，并拒绝凭据环境变量和 endpoint override。`CreateStack` 需要显式账号、区域、Stack、当前 canonical template hash、未来 15 分钟至 24 小时内的 `ExpiresAt` 和三项风险确认；它通过固定 CloudFormation execution role 注册 TaskDefinition，但脚本中没有 `RunTask`/直接 Register/Deregister API。`Readback` 会把 StackId、单资源清单、原始模板、revision ARN、image/command/roles/hardening/tags 和注册时间精确对账：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-lifecycle-task-definition.ps1 -Mode LocalValidate
.\ops\aws-sandbox\scripts\s3-b5-lifecycle-task-definition.ps1 -Mode Readback -Profile 'techlong-sandbox-provisioner' -ExpiresAt '<stack ExpiresAt>' -ConfirmTaskDefinitionArn 'arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:2'
```

2026-08-30 的当前权威结果为：Stack `techlong-sandbox-tenant-b5j3`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j3/5e145df0-a4f2-11f1-b674-0e76530b9cdf`）=`CREATE_COMPLETE`；精确 revision `tenant-lifecycle:2`=`ACTIVE`，旧 revision 1 已为 `INACTIVE`；模板 raw/canonical SHA-256 为 `68af0afca7b18827ab50fe493137b299a884b701773b025546d1ecdf2e14af11` / `127b4bf5cf634c84737df5fd7cba2eac94424a42e7974166b607036b42df1962`，TaskDefinition properties canonical SHA-256 为 `f580ece0458b701091802dc3ca2789dccc2e5d85732c5932d65400eb87453850`，readback evidence canonical SHA-256 为 `f3b8fb0d9eeb2386658f49e51fe4687da8a7e345c443934a98171f7e512b51cb`。ECS 不返回该资源类型的 CloudFormation system tags，因此 ownership 由 exact StackId + `list-stack-resources` physical ID + 原始模板共同绑定，ECS 自身标签严格限于六个业务标签。

该注册 Stack 刻意没有伪造 `CellId`/`ResourceGeneration`，所以不属于现有 tenant Janitor 的自动删除集合；`ExpiresAt` 是创建窗口与 ownership guard，不是自动 TTL 承诺。当前 revision 为后续只读 Cell 证据阶段保留；若决定放弃它，必须使用脚本的 `DeleteStack` 模式、exact revision ARN、当前模板 hash 和显式 deregistration 确认，不能依赖到期标签静默清理。

本轮注册前的临时 IAM grant Change Set 为 `techlong-s3-b5-support-lifecycle-task-registration-grant-a24567a02879a2be`（UUID `f4ae26bb-b5c6-4537-8b82-10a1414479fc`；raw/canonical `a24567a02879a2be3194d6be00db8bb8627beded207553a79c245f851518bc22` / `a61c6c3f7b870199d4020a732c613c7c43ca72d84e3a1eec58d3194b8e6d67b8`）；注册后立即执行的 revoke 为 `techlong-s3-b5-support-lifecycle-task-registration-revoke-68a34349f703dd52`（UUID `f703d78e-f368-41f5-8d08-45dea15c8310`；raw/canonical `68a34349f703dd5269058a2447bd3d7b4bcc1453225c00b8aca1f8cd8a51bf69` / `211e46d35a957aff766b2240284012500d5afee14cd1c4c55c9c9be3a0dcc2ee`）。两者都只修改 `ExecutionRoleBoundary`、`Replacement=False`。grant boundary `v6` 临时包含三个 exact PassRole；最终 `v7` 为 `LOCKED`，只剩 TaskExecutionRole 与普通 TaskRole 两个 baseline PassRole。精确 `cell-sandbox-1` cluster 为 `MISSING`，未执行 `RunTask`，四个 readiness gate 全部保持 `false`。

## B5-J4a 独立 lifecycle LogGroup 支撑

`s3-b5-lifecycle-log-support.template.json` 只含一个 `AWS::Logs::LogGroup`，初始 Stack 名固定为 `techlong-sandbox-tenant-b5j4logs`，日志组固定为 `/saas/cell-sandbox-1/tenant-lifecycle`。它只允许 `STANDARD`、`RetentionInDays=1`，无 KMS key、log stream、subscription filter、metric filter、ECS 或 Shared Cell。该模板不修改 B5-J3 TaskDefinition Stack/模板，J3 的 `LogGroupReady=false` 仍保持不变。

`s3-b5-lifecycle-log-support.ps1` 默认只做 `LocalValidate`。受控 `Create` 由 exact `techlong-sandbox-provisioner` MFA 会话调用 CloudFormation，并固定使用 `TechlongSandboxCloudFormationExecutionRole`；CloudWatch Logs 直接只读回读由现有 `techlong-sandbox-user` AWS CLI `login_session` profile 完成，不扩展 Provisioner 或 Worker IAM。所有在线模式都拒绝静态凭据环境变量/endpoint override，并要求 exact 账号、区域、两个身份、MFA device、Stack/日志组和 template digest。`OnlineValidate`、`Create`、`Readback` 与 `Delete` 还会要求 `cell-sandbox-1=MISSING`；脚本不包含 `RunTask`。

```powershell
# 已执行的离线验证；不调用 AWS
.\ops\aws-sandbox\scripts\s3-b5-lifecycle-log-support.ps1 -Mode LocalValidate

# 2026-08-25 已按以下受控形状执行；保留用于审计和未来重建
.\ops\aws-sandbox\scripts\s3-b5-lifecycle-log-support.ps1 -Mode OnlineValidate -ExpiresAt '<15 分钟至 3 小时内的 UTC>'
.\ops\aws-sandbox\scripts\s3-b5-lifecycle-log-support.ps1 -Mode Create -ExpiresAt '<exact UTC>' -ConfirmAccountId '402010193138' -ConfirmRegion 'ca-central-1' -ConfirmStackName 'techlong-sandbox-tenant-b5j4logs' -ConfirmLogGroupName '/saas/cell-sandbox-1/tenant-lifecycle' -ConfirmTemplateSha256 '<LocalValidate raw SHA-256>' -ConfirmTemplateCanonicalSha256 '<LocalValidate canonical SHA-256>' -ConfirmExecutionPhrase 'I_ACKNOWLEDGE_B5J4_EMPTY_LIFECYCLE_LOG_GROUP_CREATION' -AcknowledgeAwsWrite -AcknowledgeLowCostNotFree -AcknowledgeNoEcsCompute
.\ops\aws-sandbox\scripts\s3-b5-lifecycle-log-support.ps1 -Mode Readback -ExpiresAt '<exact UTC>' -ConfirmStackId '<exact StackId>' -ConfirmLogGroupName '/saas/cell-sandbox-1/tenant-lifecycle'
```

Readback 必须同时对账 `CREATE_COMPLETE`、单资源 inventory、`GetTemplate(Original)` canonical exact match、模板标签与 Stack 传播标签合并后的六个业务标签、1 天保留、STANDARD、无 KMS/data-protection/bearer-token authentication、零 metric filter、零 log-group/account-level subscription policy、零 stream、零 stored bytes 和 cluster `MISSING`。`OnlineValidate`/`Create` 也会在写入前先证明账号没有 `SUBSCRIPTION_FILTER_POLICY`。`Delete` 只能在同样的精确空日志组证据通过后显式执行。该 Stack 不带 `CellId`/`ResourceGeneration`；`ExpiresAt` 只是创建窗口与 ownership tag，不会被现有 Janitor 自动清理。空日志组本身不代表绝对零费用；将来若写入日志，仍会产生 CloudWatch Logs ingestion/storage 等用量费用，1 天 retention 只负责压低保留量。

2026-08-25 已创建并两次严格回读 Stack `techlong-sandbox-tenant-b5j4logs`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j4logs/8fcccc70-a0be-11f1-ac7e-06f748bb68bd`，`ExpiresAt=2026-08-25T21:51:44Z`），状态为 `CREATE_COMPLETE`。模板 raw/canonical SHA-256 为 `65c00d1c139991627a6f1801cc4887de53352b6e884064850df339cd6da0455c` / `4999c5fd89edd2aa9476cafc2a802871198b88bbdf103305dd442713281a90c2`；live evidence canonical SHA-256 为 `c2270d6344b1b93e80af9c41c47cfbfcec5ac45c14b5b93692aeb98f4f3086c6`。两次 readback 都确认唯一日志组为 STANDARD、1 天保留、六个业务标签、零 stream/bytes/metric filter/log-group subscription/account subscription、无 KMS/data protection/bearer-token authentication，并再次确认 `cell-sandbox-1=MISSING`。本次 J4a 未创建 ECS cluster/service 或运行 task；当时既有 inspect-only revision 1 未变，其后已由 Build #7/revision 2 取代，revision 1 现为 `INACTIVE`。`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 保持不变。后续 B5-J4b 已于 2026-08-26 完成受控在线部署，但仍未创建 Shared Cell、ECS cluster/service 或运行 task。

## B5-J4b IAM 管理根与 cleanup-only Cell Bootstrap（2026-08-26 已部署）

本切片将 IAM lifecycle 与 child 运行资源拆成两个固定 Stack：

- `techlong-s3-b5-cell-bootstrap-management` 只拥有 Manager、CloudFormation execution、Janitor、Scheduler 四组 permissions boundary + role，共 8 个 IAM 资源。常态为 `LOCKED`；创建这个管理根时不向 CloudFormation 传 service `RoleARN`，也不修改现有 IAM User 或 Administrators 组。
- `techlong-s3-b5-cell-bootstrap` 只拥有 `CellJanitorLogGroup`、只读 inventory `CellJanitorFunction`、`CellSchedulerGroup`、状态为 `DISABLED` 的 `CellGlobalJanitorSchedule`，共 4 个非 IAM 资源。child 不创建或变更 IAM；外置 CloudFormation execution role 只能 `PassRole` 给管理根中的最小 Janitor/Scheduler 两个角色。
- child 渲染模板以 raw SHA-256 内容寻址保存到私有 `techlong-sandbox-build-source-402010193138-ca-central-1` Bucket 的 `b5-cell-bootstrap/templates/sha256/<raw>.json`。该 key 不位于 Provisioner 可写的 `source/*`；管理路径只允许 exact `GetObject`，不授予该模板 prefix 的 Put/List。
- Lambda 固定 mutation disabled，只检查精确 `cell-sandbox-1` 的空 inventory；它不能创建、更新或删除 Cell。显式 `ProbeJanitor` 必须执行两次低成本调用并得到一致的空 inventory 证据，后台 Schedule 保持关闭。

两个脚本默认只执行离线 `LocalValidate`：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-cell-bootstrap-management.ps1 -Mode LocalValidate
.\ops\aws-sandbox\scripts\s3-b5-cell-bootstrap.ps1 -Mode LocalValidate
```

管理脚本提供 `LocalValidate`、`OnlineValidate`、`CreateChangeSet`、`InspectChangeSet`、`ExecuteChangeSet`、`Readback`、`Delete`，并只接受 `InitialLocked`、`LockedPolicyRefresh`、`BootstrapAuthorGrant/Revoke`、`BootstrapExecuteGrant/Revoke`、`BootstrapRollbackGrant/Revoke` 八种 UpdateShape。child 脚本另提供 `ProbeJanitor`。所有在线路径都拒绝静态凭据与 endpoint override，要求 exact AWS CLI `login_session` source user/MFA、随机只读 snapshot、raw + canonical 双哈希确认、deterministic Change Set、严格 `GetTemplate(Original)`/参数/tag/resource diff/readback 和 IAM simulation。AuthorGrant 还精确绑定 digest-addressed `TemplateUrl`、child execution `RoleARN`、`ChangeSetName` 与 `AWS::Logs::LogGroup`、`AWS::Lambda::Function`、`AWS::Scheduler::ScheduleGroup`、`AWS::Scheduler::Schedule` 四种 `ResourceTypes`，并且只可读取 exact 模板对象；ExecuteGrant 创建前必须先对账既有 child Change Set 和 `GetTemplate(Original)`。

正常 child 创建必须按 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked` 分五个受审步骤完成：AuthorGrant 只允许从上述 exact TemplateUrl 为 exact child 创建 Change Set，随后立即 revoke；ExecuteGrant 只允许执行已经过精确预检的 exact Change Set，随后立即 revoke。删除 child 只能临时进入 `RollbackGrant`，并在 child 不存在或安全删除证据通过后回到 `Locked`；管理根只有在 child 已不存在且自身为 exact Locked 模板时才可删除。

2026-08-26 已按上述五阶段授权序列完成受控在线部署，实际状态和审计证据如下：

- 管理 StackId 为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap-management/e1bacdf0-a0ca-11f1-a27e-0e9a646108cf`；J4b 阶段结束时状态为 `UPDATE_COMPLETE`、UpdateShape 为 `LOCKED`，inventory 精确为 8 个 IAM 资源。当时管理模板 raw/canonical SHA-256 分别为 `15ec52203f390d29858fb77e032c4d6bff83d5c3678397bf133bf60e6ab9d553` / `5d09bbc9010de13dfdba09b71c13c58711a9238cb09cd78eb767f509b29c07a1`；当前状态与模板哈希见 J5g-g 完成证据。
- child StackId 为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/2477b820-a174-11f1-aca9-0668f7a50fdf`，J4b 创建完成时状态为 `CREATE_COMPLETE`，经 J4c/J5g-g 原地更新后当前为 `UPDATE_COMPLETE`，inventory 始终精确为 4 个非 IAM 资源。J4b child 模板 raw/canonical SHA-256 分别为 `8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f` / `2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389`。
- 被审查并执行的 Change Set 名为 `techlong-s3-b5-cell-bootstrap-8eeef35a7936cdd1`，ID 为 `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-8eeef35a7936cdd1/ae46c8c2-5445-4590-b23d-cbfa36aa8489`。其 `TemplateURL` 精确为 `https://techlong-sandbox-build-source-402010193138-ca-central-1.s3.ca-central-1.amazonaws.com/b5-cell-bootstrap/templates/sha256/8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f.json`；在线执行实际遵循 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`，两个临时 grant 均已撤销。
- 4 个 child 资源为日志组 `/aws/lambda/techlong-sandbox-cell-janitor`、Lambda `techlong-sandbox-cell-janitor`、Scheduler Group `techlong-sandbox-cell` 和 Schedule `techlong-sandbox-cell-global-janitor`。Schedule 保持 `DISABLED`、表达式为 `rate(15 minutes)`；Lambda 未设置 reserved concurrency。
- 严格 readback evidence SHA-256 为 `b6e8083c3c04de9daccecfe3ca1e0c242ae2b27131f0c683ec2097f795ae97cc`。`ProbeJanitor` 的 evidence SHA-256 为 `d77199f776408f75d722176805ba09853caee51ee4639b87d879b013d4a967ca`；两次低成本调用均返回相同 empty inventory，未请求或执行任何删除。

该部署只建立 cleanup-only/只读基础，不批准付费 Cell。未创建付费 Shared Cell，也未创建 VPC、ALB、ECS cluster/service 或运行中的 task、RDS/Aurora、Route 53 资源，且没有执行 `RunTask`；J4b 当时既有 inspect-only `tenant-lifecycle:1` 未变，后续已由 Build #7 的 inspect-default `tenant-lifecycle:2` 取代，revision 1 现为 `INACTIVE`。`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 全部保持不变。digest-addressed S3 对象、Lambda 调用、CloudWatch Logs 和 Scheduler 仍可能产生少量用量费用，因此只能称为低成本，不能保证绝对零费用。此前已确认 IAM User 绑定 MFA，并成功建立受限 AssumeRole 会话；既有 S3-A 与 J4b 模板都不修改现有 IAM User 或 Administrators 组，SaaS Worker Apply 继续保持关闭。

### B5-J4c PlannerUpdate（2026-08-28 已部署）

J4c 已将既有 J4b child 原地更新为 ownership-fenced、authority-bound 的 plan-only cleanup planner。management `LockedPolicyRefresh` 只修改 `CellJanitorBoundary` 与 `CellBootstrapExecutionBoundary` 两个 ManagedPolicy，均为 `Replacement=False`；执行授权仍经过 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`，最终 management 已恢复 exact `LOCKED`。

- management 最终 Locked 模板 raw/canonical SHA-256 为 `93f37b585812b49f540a317bfdbdd45a374705347288a2c998c229d31231f9ec` / `1be6a039a759acbf9c8d3211981400122c549bff0be6073e3df008c51b08ae12`。
- child PlannerUpdate Change Set 为 `techlong-s3-b5-cell-bootstrap-a14e9898ed7af636`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-a14e9898ed7af636/9b883194-0385-4b7d-ae0a-474be55225f4`），TemplateURL 为 `https://techlong-sandbox-build-source-402010193138-ca-central-1.s3.ca-central-1.amazonaws.com/b5-cell-bootstrap/templates/sha256/a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986.json`。
- child 模板 raw/canonical SHA-256 为 `a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986` / `74379232124d94b1d2ffb4322edaecd0bdb0534444b8961295175ecadc06c09c`。既有 child Stack 完成 `UPDATE_COMPLETE`，严格 readback evidence canonical SHA-256 为 `bb74dbdd8000d94f5a68d5b69d5d3e982f4dbc0738af0c784b04d1819136a258`。
- `ProbeJanitor` 的两次调用均返回 `ABSENT_SAFE` 和相同空 inventory；probe evidence canonical SHA-256 为 `ef7699c9c005eed98077f2e43ebfae8caa78069fff269b5b7db6a645875f3835`，没有请求或执行 mutation。
- Schedule 继续为 `DISABLED`；`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false`。本次更新没有创建付费 Shared Cell、VPC、ALB、ECS cluster/service/task、Aurora/RDS 或 Route 53 资源，也没有执行 `RunTask`。

### B5-J5a Shared Cell cleanup authority（仅本地契约）

J5a 当时为 J4c 的 `cell:cell-sandbox-1` authority v1消费schema增加 SDK-free本地候选契约：compiler只校验调用方Stack DTO的严格形状，不采集或认证live evidence；它生成exact 4-field item与canonical 22-field cleanup record，内部从exact intent派生cleanup operation hash，并绑定marker、revision、Cell到期时间和最长一小时authorization。产物通过仓库内当时的J4c validator与DynamoDB AttributeValue decoder本地跨契约测试；没有调用已部署Lambda或AWS。后续J5g-f已把当前contract升级为仍为4字段item、但包含`cloudFormationRoleArn`的23字段v2 cleanup record，旧v1不再被当前consumer接受。

atomic advance 协调逻辑拒绝空 snapshot，只允许已有 exact predecessor 在同 owner/generation/provision/Stack lineage 内严格增加 cleanup epoch；exact 重试不写入，CAS、独立回读、intent hash或时间窗任一漂移都 fail closed。这里只存在接口、Mock 和显式 disabled 实现，没有真实条件写 provider；default root 不暴露该 capability，现有 `tenant:<64hex>` adapter 仍拒绝 `cell:*`。

首条可信 provision authority/bootstrap、live evidence provenance、AWS SDK/DynamoDB writer/IAM 和 root 接线仍缺失，因此新增 `shared_cell_provision_authority_predecessor_missing` 与 `shared_cell_cleanup_authority_writer_missing` 两个 blocker。`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false`。本切片没有 AWS、IAM、CloudFormation 或部署步骤，不能授权 J4c mutation，也不能创建或删除 Shared Cell。

### B5-J5b Shared Cell cleanup authority（dormant production DynamoDB CAS adapter）

J5b 增加 production DynamoDB adapter 源码，但 default runtime 不构造或暴露它。adapter 只接受 exact table ARN `arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority` 与 fixed key `cell:cell-sandbox-1`；observe 使用 full consistent `GetItem`，只读取 exact 4-field item。字段集合、schema、revision、canonical `record_json`、operation/record hash、账号、区域、Cell 或 Stack lineage 任一漂移都会 fail closed。

cleanup authority 不能从空 snapshot bootstrap；后续必须先由独立受审流程安装带可信 live provenance 的 provision predecessor。已有 predecessor 的 advance 使用 schema + revision + 完整 canonical predecessor `record_json` 约束 conditional `PutItem`，并在写后重新 full consistent readback exact candidate。exact replay 不写入；conditional conflict 只返回 fresh winner snapshot。abort、provider 错误或不确定结果、CAS 伪成功、缺失/漂移 readback、时钟回拨、授权在写入前或写入后过期，均不得报告成功。

本切片只新增 dormant adapter 与注入 fake commands/client 的本地测试，没有修改 runtime、IAM、CloudFormation、J4c Lambda 或 Schedule，没有调用 AWS、连接 Neon/PostgreSQL、执行 `RunTask` 或创建/删除资源。`shared_cell_provision_authority_predecessor_missing` 和 `shared_cell_cleanup_authority_writer_missing` 两个 blocker与四个 readiness gate 全部保持不变；下一依赖是可信 provision predecessor、live Stack evidence provenance 和它们的独立安装授权，不能跳过这些边界直接启用 cleanup mutation。

### B5-J5c Shared Cell provision predecessor（dormant）

J5c 阶段在同一个 `cell:cell-sandbox-1` key上增加严格18字段v1 `provision_verified` predecessor；当时既有4字段item envelope与22字段v1 `cleanup_authorized`消费契约不变。后续J5g-f已把当前记录升级为分别包含`cloudFormationRoleArn`的19/23字段v2 union，旧v1不再兼容且不会自动迁移。provision/cleanup operation hash和record hash均绑定各自schema的canonical exact intent，唯一允许的首跳是同Stack/owner/generation/provision/RoleARN lineage、revision + 1且cleanup epoch更大的`provision_verified → cleanup_authorized`；cleanup adapter继续拒绝空表bootstrap。

只读 Stack evidence adapter 核对 exact STS caller、root Stack/role/status/tags/parameters/outputs、Original template hash、完整分页 resource inventory及采集前后稳定性。独立 SDK-free installer 只允许 generation 1 / epoch 1 的 fresh branded evidence 在 30 秒窗口内执行 absent-only conditional install，并要求独立 exact readback；提交后的任何不确定结果均不报告成功。

本切片没有 provision DynamoDB writer、IAM、root wiring 或线上 authority 写入，也没有修改 J4c、Schedule、management/child Stack 或 runtime gates，没有调用 AWS、创建付费 Cell 或运行 ECS task。可注入 clients 只属于受信 composition/test seam；真正上线前仍需受审生产构造、最小 IAM 与在线安装批准。

### B5-J5d Shared Cell provision installer（dormant production adapter）

J5d 增加 exact-table/exact-key 的 production DynamoDB installer 源码。它只接受 J5c compiler 私有 provenance 保留的 generation 1 / provision epoch 1 / revision 1 `provision_verified` 原对象；首次安装使用 `attribute_not_exists(authority_key)` 的单条条件 `PutItem`，不能覆盖任何既有 lineage。所有 observe、冲突 winner 和写后确认均为 full strongly-consistent `GetItem`，成功还必须独立 exact readback；提交后的 Abort、provider/clock 错误及缺失或漂移 readback一律按 retryable uncertain fail closed。

dormant production bundle 固定 `techlong-sandbox-provisioner` profile 与 exact MFA device，要求未来受审入口注入 MFA callback；同一次 `defaultProvider()` 返回值显式构造 STS、CloudFormation 和 DynamoDB client，并令业务 client 与内部 STS 忽略 configured endpoint override。bundle 构造本身不解析凭据、不发 AWS 请求，不接入 default Worker、J4c Lambda、CLI 或 Schedule；注入 module/client 只是受信测试 seam。默认 runtime 测试继续断言没有 provision evidence/authority capability，两个 blocker和四个 readiness gate未改变。

J5d 结束时 Provisioner 还没有 exact Cell root Stack read 与 authority Get/Put；后续 J5e 已部署 exact Stack/GetItem 稳定只读并完成短时 Put grant/revoke channel drill，但没有写入 authority。Worker 的 `LeadingKeys` 仍只允许 `tenant:*`，Janitor 只有 cell key Get 且显式 Deny mutation，Manager 也没有 DynamoDB writer；source IAM User 的广泛权限不是批准的安装路径。本切片没有 AWS/IAM/CloudFormation mutation、线上 authority 写入、付费 Cell 或 `RunTask`。后续仍必须把付费 Cell 创建、live evidence/absent pre-read/candidate 审阅后的单次 install + readback + revoke、现有 cleanup CAS adapter 的 IAM/online enablement/root wiring、J4c mutation/Schedule enable 分开批准，不能直接放宽长期 Worker 权限。

### B5-J5e Shared Cell provision-authority IAM channel

J5e 为 `TechlongSandboxProvisionerRole` 定义下一稳定 locked baseline：只增加 exact root Stack 的 `DescribeStacks/GetTemplate/ListStackResources` 和 exact authority table/key 的 `GetItem`；不修改 Worker 的 `tenant:*` `LeadingKeys`、Janitor、Manager、J4c 或任何 readiness gate。单次安装窗口另由 `SharedCellProvisionAuthorityInstallGrant` 向同一 `ProvisionerBoundary` 增加唯一 `PutItem` statement，绑定 `ca-central-1`、exact table、`cell:cell-sandbox-1`、四字段 attribute allowlist 和 canonical UTC `DateLessThan`。`SharedCellProvisionAuthorityInstallRevoke` 只撤销该临时 Put，保留 exact read 用于不确定结果恢复与独立 readback。

`s3-b5-support-bootstrap.ps1` 对 grant/revoke 继续使用 source IAM User 的 exact login session/MFA，仅允许既有 `ProvisionerBoundary` 无 replacement 修改；Change Set 名称绑定 raw template digest，Inspect/Execute 前核对 `GetTemplate(Original)`。Execute grant 要求窗口入口剩余 15–60 分钟且实际执行前仍大于 10 分钟；Stack 完成后对 managed-policy default version、Role boundary/attachment/inline policy做 exact readback，执行 exact/wrong-key/wrong-region/wrong-table/extra-attribute/expired IAM simulation，再复读一次默认 policy 关闭并发漂移窗口。`EvidencePreflight` 只用 exact Provisioner AssumeRole 读取 root Stack MISSING 与 authority key ABSENT；它不调用 `PutItem`，临时写权限由前述 policy readback/simulation证明。

J5e 已完成线上 IAM channel drill，但没有执行 installer。Grant Change Set `techlong-s3-b5-support-shared-cell-provision-authority-install-grant-89b3fc2b651162a6` 的 raw/canonical SHA-256 分别为 `89b3fc2b651162a6f99268470eec4f8cd3516f5e86a7243112083c5327cd5a10` / `81ff00ba9a077c0e5e5c66ae2fc80a215a3c13c02afc4ffd0dcddd7e676b70c7`，执行后 exact policy readback SHA-256 为 `f4788818fab5e7731e5fed8a5095b590225b1abf5c59a2b0e059005c20aece97`。事后验证曾因 IAM Simulator 对 deny 结果汇总无关 `MissingContextValues` 而 fail closed；门禁现要求 allowed 结果零 missing context、implicit deny 精确匹配且零 matched statement。临时 grant 于 `2026-09-01T18:19:28.077Z` 自动失效，期间没有调用 `PutItem`。

Revoke Change Set `techlong-s3-b5-support-shared-cell-provision-authority-install-revoke-5854019ecacde555` 的 raw/canonical SHA-256 分别为 `5854019ecacde5554b756e538556cf69f330cce79901ac7950317f2f5bbd73cc` / `8231ff876b99b3f5374d1ee2978736f8ba3a48f1260f3d85382e67e9a453caf9`；执行后的 readback → 全部正反向 IAM simulation → readback 均通过，两次稳定 policy SHA-256 都是 `cebda5b97adbacd877e2d52459541ef9bbba4c7e028cb3657f101862e9cd574d`。随后 `EvidencePreflight` 证明 root Stack 为 `MISSING`、authority key 为 `ABSENT`。线上临时写权限已显式撤销；本阶段没有创建付费 Shared Cell、写 authority 或执行 `RunTask`，四个 readiness gate 与两个 blocker保持不变。未来 candidate/install 仍必须重新走独立 Grant → Inspect → Execute → install/readback → Revoke 批准链。

### B5-J5f Shared Cell provision-authority reviewed operator（本轮仅 LocalValidate）

J5f 只补齐 dormant production evidence/installer 与未来受审运维入口之间的 operator 协议。`inspectSharedCellProvisionAuthorityCandidate` 必须用同一个受约束 runtime 采集 fresh branded live Stack evidence，并在候选编译前后分别执行 strongly-consistent authority read；只有 fixed key 持续为 `ABSENT` 时，才返回不含原始 item 的可审摘要和 `candidateItemSha256`。`executeReviewedSharedCellProvisionAuthorityInstall` 必须重新采集 fresh evidence、重新编译 generation 1 / epoch 1 / revision 1 candidate，并把新摘要与人工确认的 digest exact-match 后，才可调用 J5d 的 absent-only conditional installer并再次核对结果摘要。`recoverReviewedSharedCellProvisionAuthorityInstall` 仅执行 strongly-consistent authority read，并校验 exact item、approved digest、owner、generation 1、epoch 1 和 revision 1；它固定 `evidenceObservedAt=null`，不读取 Stack、不重编译 candidate，也绝不调用 `PutItem`。

受控入口为 `scripts/run-shared-cell-provision-authority-operator.ts`，PowerShell 门禁包装为 `ops/aws-sandbox/scripts/s3-b5-shared-cell-provision-authority-operator.ps1`，静态/本地验证器为 `validate-b5-shared-cell-provision-authority-operator.mjs`。包装脚本只接受 `LocalValidate`、`InspectCandidate`、`ExecuteInstall`、`Recover` 四个模式；本轮仅执行：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-provision-authority-operator.ps1 -Mode LocalValidate
```

未来三个在线模式都要求 raw-SHA-256 固定的 reviewed JSON manifest和 exact Provisioner MFA identity。PowerShell 的 STS identity read固定 `10` 秒 connect / `20` 秒 read timeout；root CLI 的 MFA 等待及全部 evidence/authority SDK 请求共用一个 `120` 秒 `AbortSignal`，但 SDK 凭据提供器内部 login/AssumeRole 网络解析是否严格响应该取消信号仍须在启用线上模式前验证。首次 AssumeRole 的六位 MFA 只允许从交互式 TTY 以 raw mode隐藏读取，prompt只写 stderr，验证码不经 argv、环境变量或 stdout。`ExecuteInstall` 还要求 approved candidate digest、剩余大于 2 分钟且不超过 60 分钟的 canonical grant expiry、账号/区域/Stack/table/key 五项 exact confirmation、五项风险确认及固定执行短语；PowerShell 和 root CLI 各自独立校验这些 Execute 确认，grant window还会在实际 `installIfAbsent` delegate前立即复检。`Recover` 拒绝 grant expiry，不需要写确认且只向 root CLI 传递只读参数。当前禁止执行这三个在线模式。

本切片提供 operator 源码与受控未来在线 CLI，但本轮只运行 `LocalValidate`，没有调用 AWS。J5e 的旧 grant 已到期并显式撤销；当前 root Stack 仍为 `MISSING`、authority key 仍为 `ABSENT`，所以本轮不得执行 Inspect/Execute/Recover 线上操作，不会生成可执行的 live candidate或写入线上 authority。它不创建、更新或删除 Shared Cell，不接入默认 Worker/J4c/Schedule，不执行 ECS `RunTask`，也不访问 Neon、PostgreSQL、DNS、ACM 或 Trust Store。`shared_cell_provision_authority_predecessor_missing`、`shared_cell_cleanup_authority_writer_missing` 与 `registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 全部保持不变。

CLI 在线路径仍须在真实运行前单独审查 account/region/profile/MFA/endpoint、freshness、超时和确认摘要门禁；实际安装只能在真实付费 Cell 已由另一项明确批准创建、exact live evidence 可得、J5e 短时 `PutItem` grant 重新完成 Create → Inspect → Execute 后，再通过独立批准执行。无论成功、冲突或结果不确定，都必须完成 exact readback，并立即按独立 Revoke → Inspect → Execute 撤销临时写权限。J5f 本轮的 `LocalValidate` 不构成上述任一在线批准。

### B5-J5g-a / J5g-a-online-1 / J5g-a-online-2 Shared Cell lifecycle IAM channel

J5g-a 为真实 Shared Cell 的 CloudFormation author/execute/失败创建回滚路径建立了独立 IAM 管理契约，不复用 Provisioner、J4c Manager、租户 Worker 或普通 Bootstrap execution role。J5g-a-online-1 把其中无临时 grant 的 Locked IAM root扩展为受控线上 controller，并把 management Stack 固定为 `techlong-s3-b5-cell-lifecycle-management`。`s3-b5-cell-lifecycle-management.template.json` 固定只包含四个 IAM 资源：`TechlongSandboxCellOperatorBoundary`、`TechlongSandboxCellOperatorRole`、`TechlongSandboxCellCloudFormationExecutionBoundary` 与 `TechlongSandboxCellCloudFormationExecutionRole`。Operator role只信任 exact source IAM User并要求 MFA；Cell CloudFormation execution role只信任 `cloudformation.amazonaws.com` service principal。AWS 对普通 Stack 的 CloudFormation service-role trust是否稳定提供 `aws:SourceArn` / `aws:SourceAccount` 没有官方保证，因此本切片不把未经保证的 context key写成可部署隔离条件，而是依靠 exact boundary、inline policy、Change Set 和严格 readback收口。

renderer 仍生成 `Locked`（默认）、`AuthorGrant`、`ExecuteGrant`、`RollbackGrant` 四种可审权限形状。J5g-a-online-2 把线上 controller 的 `UpdateShape` 收窄为 `InitialLocked`、`AuthorGrant`、`AuthorRevoke`；`ExecuteGrant`与`RollbackGrant`继续无法选择。AuthorGrant绑定 exact digest-derived Change Set name、raw/canonical template SHA-256、cell TTL、reviewed-at 与 grant expiry；窗口必须大于零且不超过60分钟，并至少早于Cell TTL 15分钟。author/execute/rollback 能力仍互斥，`RollbackGrant` 只表达失败创建后的 exact root Stack 回滚窗口，不是 TTL 删除授权。未来隔离边界必须组合 exact `iam:PassRole`、CloudFormation `RoleARN`、digest-addressed `TemplateUrl`、固定 18 种 `ResourceTypes`、exact Stack/Change Set name、exact tags 与 action allowlist；发布端还必须用不可覆盖写入和执行前 hash readback证明 URL 内容不可变。当前 effective execution权限由临时 boundary 与 exact inline policy取交集，并显式禁止 IAM lifecycle、ECS `RunTask` / service lifecycle、NAT/EIP/VPC endpoint、Route 53和手工 Secrets lifecycle；但 boundary自身对 EC2 dependency仍含区域级 `Resource="*"`，尚不能单独证明不会触及第二条 Cell lineage。

受控入口 `s3-b5-cell-lifecycle-management.ps1` 当前提供 `LocalValidate`、`OnlineValidate`、`CreateChangeSet`、`InspectChangeSet`、`ExecuteChangeSet`、`Readback` 六种 Mode；UpdateShape只接受`InitialLocked`、`AuthorGrant`、`AuthorRevoke`。AuthorGrant/Revoke的UPDATE必须只包含`CellOperatorBoundary`单一`Modify`且`Replacement=False`，所有UPDATE与严格回读都绑定已部署的固定StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d`。本地验证仍可使用：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-cell-lifecycle-management.ps1 -Mode LocalValidate
```

`OnlineValidate`、`InspectChangeSet` 与 `Readback` 是只读路径；`CreateChangeSet` 和 `ExecuteChangeSet` 是彼此分离的写阶段，必须各自取得独立明确确认。`2026-09-13` 已完成首次只读 `OnlineValidate`：raw/canonical SHA-256 为 `acaa2b5e65361b84ed8fd3fb55d5a512b64bbf51b9fd855837d0adeef2f06bc1` / `803f28a0741f411493852dbaa2282fba2aa109b4f64b4986ee85d97e39eccda5`。随后创建、两次独立检查并在另一项明确批准下执行 InitialLocked Change Set `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-lifecycle-management-initial-locked-56020f776e9dc476/c546bbff-48b6-40b7-b245-a575d8307f11`；其 StackId为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d`。Change Set最终为 `CREATE_COMPLETE` / `EXECUTE_COMPLETE`，Stack以及两个 `AWS::IAM::ManagedPolicy`、两个 `AWS::IAM::Role`均为 `CREATE_COMPLETE`。完整严格 Readback验证了 Original template、参数、标签、五个输出、四资源inventory、policy仅v1、exact attachments/boundaries/trust和zero inline。首次执行后的 simulation因缺少 `cloudformation:ChangeSetName` context而 fail closed；原始结果仍为 `implicitDeny`且 `AllowedByPermissionsBoundary=false`。四条 operator simulation补入 deterministic sentinel `techlong-sandbox-cell-sandbox-1-simulation` 后，所有目标均精确返回 `implicitDeny`、`MissingContextValues=[]`、`AllowedByPermissionsBoundary=false`，完整 Readback通过。Cell仍为 `MISSING`，authority key仍为 `ABSENT`。InitialLocked只建立 Locked IAM root，不打开临时 grant或付费 Cell能力；模板 metadata、renderer 与 validator 继续固定 `ApplyReady=false`、`CleanupReady=false`、`PaidCellExecutionApproved=false`，Janitor仍为 `PLAN_ONLY`。没有创建或删除 Cell，也没有创建 VPC、ALB、ECS、Aurora/RDS、Route 53、Schedule资源或执行 `RunTask`。

J5g-a-online-2 当前只完成本地实现与回归，没有调用AWS。`compile-b5-shared-cell-author-candidate.mjs`确定性编译exact 18类资源、两AZ、四tag、三小时Cell TTL与最多1个Aurora cluster/1个writer/1 ACU、0 NAT/0 interface endpoint边界，同时固定`cloudApplyReady=false`与`executionReady=false`。`s3-b5-shared-cell-prerequisite-preflight.ps1`只读聚合Locked管理根、Cell `MISSING`、authority `ABSENT`、J4c PLAN_ONLY/DISABLED、AZ、ACM、Trust Store、Aurora 16.14/db.serverless、三项service-linked role和build-source不可变策略；它会把`PLAN_ONLY_JANITOR_EVENT_INCOMPATIBLE`作为硬blocker。`s3-bootstrap.template.json`已加入digest路径只允许带`If-None-Match: *`首次写、并拒绝删除的Bucket Policy，但该IaC尚未部署。CREATE型child Change Set会创建`REVIEW_IN_PROGRESS`占位Stack，而当前AuthorRevoke严格要求Cell `MISSING`；在实现并验证`REVIEW_IN_PROGRESS → MISSING → AuthorRevoke`补偿闭环前，child author入口保持不存在，不能创建或检查child Change Set。

`2026-09-19` 已以 `techlong-sandbox-user` 的精确 Source login session 运行只读线上 inventory。账号没有可传给完整入口的 ELB Trust Store ARN，因此没有构造假 ARN；改为逐项调用同一入口的原始检查函数。修复 DynamoDB `{}` 被 PowerShell `.Properties.Name` 误计为一个 `$null` 的假 blocker 后，Source/MFA、Locked根、Cell `MISSING`、authority `ABSENT`、PLAN_ONLY/DISABLED、两AZ及Aurora 16.14/db.serverless共7项通过。真实 blockers 为5项：Janitor event不兼容；现有唯一 ISSUED ACM证书仅为`api.techlong.cloud`；Trust Store不存在；`AWSServiceRoleForElasticLoadBalancing`不存在而ECS/RDS service-linked roles存在；Bucket Policy缺少`DenyMutableSharedCellTemplateOperation`。读取过程中未创建、更新或删除任何AWS资源。

随后为第5项新增 `s3-b5-support-bootstrap.ps1 -UpdateShape SharedCellTemplateImmutability`。该shape在 Create/Inspect/Execute前绑定固定StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917`、exact三项Stack tag、`UPDATE_COMPLETE`和已部署baseline canonical SHA-256 `8231ff876b99b3f5374d1ee2978736f8ba3a48f1260f3d85382e67e9a453caf9`，并精确回读旧的一statement Policy、public-access block、BucketOwnerEnforced、未配置versioning、仅作用于`source/`的既有lifecycle以及CloudFormation ownership。Change Set allowlist仅接受`CodeBuildSourceBucketPolicy`的单一`Modify`、`Replacement=False`及直接`PolicyDocument` detail；目标四statement策略保持TLS deny、只允许`If-None-Match: *`首次写、无条件拒绝`DeleteObject`/`DeleteObjectVersion`并拒绝`PutLifecycleConfiguration`，且写入/删除门禁同时覆盖`b5-shared-cell/templates/sha256/*`和`b5-cell-bootstrap/templates/sha256/*`。目标raw/canonical SHA-256固定为`13d4bcb5cc799fc54610a4398aa2cbaf13a410354eb83e720db4116ad3d71435` / `ccf14717e1fa8ec1ccfe453b2d96211022e0df4bf060105b7f4c3a6b98cd745a`。child controller已同步严格回读新策略并永久保留digest对象，不再含对象删除调用。Execute调用成功后先以同一ClientRequestToken精确观察根Stack `UPDATE_IN_PROGRESS`事件，避免旧的`UPDATE_COMPLETE`被误认为本次更新完成，再进入waiter和严格回读；另提供只支持该shape的独立`Readback`恢复路径。两条回读路径均不做Put/Delete探针。线上`OnlineValidate`已通过，确定性Change Set名将为`techlong-s3-b5-support-shared-cell-template-immutability-13d4bcb5cc799fc5`，但尚未创建或执行。

当前 Cell 模板会先创建状态为 `ENABLED` 的一次性 TTL Schedule，并发送 `action=delete_shared_cell_stack`；已部署的 J4c `cell-janitor.cjs` 只接受 `inspect_cell_cleanup_plan` 且固定 `PLAN_ONLY`，两者不兼容，不能据此保证到期删除。cleanup authority 的授权时序、创建失败时的可恢复回滚、RDS-managed master Secret 所需的受限 Secrets/KMS权限、execution boundary 的 EC2资源上界、运行时最小剩余 grant窗口，以及真正删除前对 live Stack 与 strongly-consistent authority 的双读/围栏仍是 P1 blocker。`shared_cell_provision_authority_predecessor_missing`、`shared_cell_cleanup_authority_writer_missing` 与 `registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 全部保持不变；严禁把 J5g-a 描述为付费创建 ready 或 cleanup ready。

J5g-a之后的 J5g-b 必须复用 J5b 已有的同 lineage conditional CAS adapter，不重写另一套 CAS，并把 authority advance、Janitor mutation授权、失败创建回滚、TTL调度和删除前双读拆成可审步骤。下节只实现其中的 dormant生产契约；在 provider、权限与线上演练完成前，不得启用 Cell Apply、Schedule mutation或付费创建。

### B5-J5g-b Shared Cell cleanup authority/deletion control（dormant、仅 LocalValidate）

J5g-b 新增两个彼此分权的本地生产契约，但没有接入真实 provider。`shared-cell-cleanup-authority-operator.ts` 的 inspect/execute/recover 流程要求受保护 collector生成带私有 provenance的 Stack evidence与五项全零 ownership evidence；普通结构对象不能伪造这些 evidence。Stack evidence固定账号、区域、Cell、root Stack和 `TechlongSandboxCellCloudFormationExecutionRole`，必须证明 Cell已经到期，并与 strongly-consistent `provision_verified` predecessor的 StackId、状态、TTL、模板摘要和完整资源 inventory摘要一致；Stack与 ownership两份 evidence必须都在 Cell expiry当时或之后采集，并落在同一个 30 秒 freshness窗口。inspect在收集 evidence前后读取同一 predecessor，execute重新采集并重编 exact candidate，再使用独立注入、绑定 predecessor/candidate/expiry的短时 CAS capability调用 J5b既有 `advanceSharedCellCleanupAuthority`；它只允许 `provision_verified → cleanup_authorized`，写后还要独立强读 exact item。recover只读并确认已发生的 authority结果，不采集 evidence、不写 CAS，即使授权窗口已经到期也可用于判定 outcome；所有摘要固定 `deletionPerformed=false`。

`shared-cell-cleanup-deletion.ts` 使用另一组窄端口：完整 CloudFormation evidence读、strong cleanup-authority只读和唯一 `DeleteStack` delegate。inspect/execute/recover均固定 caller为 `TechlongSandboxCellJanitorExecutionRole` assumed-role session，拒绝把人工 Cell Operator或 Provisioner当成 TTL deleter。执行计划要求完整分页的 Stack列表没有租户/意外 Cell，authority在证据采集前后两次 strong read完全一致，并两次读取不得早于 Cell expiry的 fresh zero-tenant ownership snapshot；snapshot不仅要求五项计数为零，还要求五个 source ID数组为空且 canonical source hash匹配。其间连续两次完整读取 exact root Stack、Original template和全部 terminal resource inventory，并核对 termination protection、四个 exact tags、已过期 `ExpiresAt`、专用 Cell `RoleARN`以及 active `cleanup_authorized` lineage的模板/inventory/operation hashes。execute须用 fresh evidence重现人工批准的 `deletionPlanSha256`，在唯一一次 `DeleteStack` 紧前再次以 zero-tenant before/after夹住 Stack和 authority复核，随后最后核对 caller，使用由 exact plan派生的稳定 ClientRequestToken，并在有界窗口内以 name-bound missing + 完整 Stack inventory共同证明删除。响应丢失或畸形不重发删除，只进入只读恢复；`DELETE_FAILED` / rollback failure、StackId replacement、矛盾 missing或 readback超时均 fail closed。recover不持有 delete capability。

本阶段受控入口仍只有：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-cleanup-control.ps1 -Mode LocalValidate
```

validator只核对上述静态契约、两组定向测试、默认 `offline_only` runtime，以及当前 J4c child/Lambda仍为 `PLAN_ONLY`、Schedule仍为 `DISABLED`。wrapper没有 online模式、AWS profile或写入确认参数；本切片也没有 production Stack/ownership collector、AWS deletion adapter、CLI、default Worker/Janitor wiring或 IAM grant。J5g-b阶段的 `cell-janitor.cjs` 未修改，仍只接受 `inspect_cell_cleanup_plan`；后续J5g-f只离线升级其v2 authority解码与plan projection，仍不接受 Cell模板发出的 `delete_shared_cell_stack`，也没有 `DeleteStack` 或 authority mutation命令。

因此 J5g-b 只是 dormant contract，不是 cleanup ready。线上前仍缺 production collectors及有界 SDK runtime、cleanup CAS和 Janitor `DeleteStack` 的相互独立短时 grant/readback/revoke、Schedule在 Cell TTL到点后才授权 cleanup的可靠时序，以及失败创建时尚未满足“Cell已到期 + 完整 provision predecessor”的独立 rollback路径。J5g-b 当时的 authority record尚未持久化 future provision live evidence与 deletion fresh read都要求的专用 Cell `RoleARN`；后续J5g-f已在离线 schema v2契约中补上这一记录级 lineage，但production collector/root接线与线上验证仍未完成。账号当前没有 Cell或既有 Cell lineage；本轮没有调用 AWS，没有修改 IAM、Schedule、Lambda或 CloudFormation Stack，没有创建/删除 Cell或执行 `RunTask`；`shared_cell_provision_authority_predecessor_missing`、`shared_cell_cleanup_authority_writer_missing`和四个 readiness gate全部保持不变。

### B5-J5g-c production cleanup adapters 与独立临时 grant 契约（默认关闭、仅 LocalValidate）

J5g-c 把 J5g-b 的抽象端口落实为真实 provider 形状，但没有把它们接入默认 Worker 或已部署 Janitor。`aws-sdk-shared-cell-cleanup-stack-evidence.ts` 固定由 exact `TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator` MFA session读取到期后的 root Cell Stack；它执行 STS identity、Stack前后稳定读、`GetTemplate(Original)`与完整分页 `ListStackResources`，并复核专用 Cell CloudFormation role、四个 exact tag、StackId/状态/TTL以及 predecessor中的模板和 inventory摘要后，才可调用受保护的 `markVerified()`。dormant factory还固定 `techlong-sandbox-cell-operator` profile、MFA device、`ca-central-1`及禁用 endpoint override，并让 STS/CloudFormation共享同一个 lazy credential provider；构造阶段不解析凭据、不发 AWS请求。人工 evidence身份继续与 Provisioner及具有删除能力的 Janitor分离。

零租户证据不再依赖五次松散查询。`neon-shared-cell-zero-tenant-source.ts` 使用一个 Neon HTTP `Serializable + READ ONLY + DEFERRABLE` transaction，在同一数据库 snapshot内核对 fixed environment和数据库时钟，并读取 active tenant、capacity reservation、nonterminal deployment、live tenant resource及 nonterminal cleanup schedule五组完整排序 ID。`shared-cell-zero-tenant-evidence.ts` 只在这五组都为空时生成 cleanup-authority所需的 branded evidence；`shared-cell-cleanup-deletion-zero-tenant.ts` 则把同一 source contract投影为删除核心要求的五项计数、五个 source数组和 canonical SHA-256。J5g-c切片当时的代码构造不会访问 Neon，默认 root也没有注入 `DATABASE_URL` 或调用该 source；截至该阶段数据库侧 `0005`–`0008`尚未应用，后续J5g-e2虽已完成migration，默认root仍未注入或调用该source，因此当前依然不是live evidence。

`aws-sdk-shared-cell-cleanup-deletion.ts` 提供 Janitor侧的 STS/CloudFormation窄读和唯一 `DeleteStack` capability。`ListStacks` 显式传入除 `DELETE_COMPLETE` 外的 active状态集合，避免把 CloudFormation保留的历史删除记录误判为存活 Stack；missing只接受 exact Stack name对应的精确 `ValidationError`，StackId请求的错误不能翻译成 missing。模板固定 `Original`，资源读取保留完整分页；删除请求只接受 exact StackId、专用 `RoleARN`、计划派生 token和 `STANDARD` mode，不包含 `RetainResources`。provider错误会脱敏并保留 retryability/abort语义。dormant runtime只围绕一个 lazy ambient Janitor credential provider构造 STS/CloudFormation clients，不发请求，也未接到 Lambda handler。

`aws-sdk-shared-cell-cleanup-authority-grant.ts` 在既有 DynamoDB conditional CAS外再加最终 capability boundary：先复制不可被调用方随后篡改的 predecessor/candidate JSON快照，再让两者 SHA-256和 grant expiry在 provider提交前完全匹配；另一个 read-only view同时满足 operator和deleter的强读接口，但不暴露 `compareAndSet`。DynamoDB强读不使用 Projection，完整 Item 必须通过四字段 exact decoder，因此未知顶层属性不能被请求层隐藏；普通/条件失败写入返回值均固定为 `NONE`。只读 IAM仍只允许 exact table/key，四字段 allowlist只约束 `PutItem`。这层是应用侧 digest fence，不能被误述成 IAM能够检查 DynamoDB item正文。

独立 IAM候选契约位于 `s3-b5-shared-cell-cleanup-grants.template.json` 与 renderer。它只离线生成五个互斥形状：`Locked`、`AuthorityWriterGrant/Revoke`、`JanitorDeleteGrant/Revoke`。Writer目标固定为 Provisioner role，只描述 exact table/key/四字段且 `ReturnValues=NONE` 的 `PutItem`最长 15 分钟窗口；Janitor目标固定为 Cell Janitor role，只描述人工批准的完整 StackId（不接受同名 Stack通配符）、exact expired tags及专用 `cloudformation:RoleArn` 条件下的 `DeleteStack`，并单独限定同一角色的 `PassRole`。两份 managed policy均未挂载到任何 role，模板没有 online apply路径，因而当前不会授予任何权限；IAM也不能把 approved candidate/deletion-plan digest直接绑定到请求正文或 `ClientRequestToken`。现有 Janitor permissions boundary中的 mutation deny及其 identity policy尚未通过受审替换，必须在未来独立 Grant → readback/simulation → operation → Revoke流程中闭合，不能直接部署本候选模板后宣称可删除。

本阶段两个受控入口都只有离线模式：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-cleanup-production-adapters.ps1 -Mode LocalValidate
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-cleanup-grants.ps1 -Mode LocalValidate
```

J5g-c 没有调用 AWS 或 Neon，没有创建/更新/删除 IAM、CloudFormation、Lambda或 Schedule资源，没有创建付费 Cell，也没有执行 ECS `RunTask`。已部署 J4c Lambda仍只接受 `inspect_cell_cleanup_plan`并固定 `PLAN_ONLY`，Schedule仍为 `DISABLED`；默认 runtime仍为 `offline_only`。后续J5g-f已补齐RoleARN lineage的schema v2持久化；仍需受控 online CLI/root组合、两种身份的真实凭据接线、已应用迁移上的 live transaction及数据库/运行主机时钟校准、独立 IAM grant/readback/revoke、cleanup-authority推进与新租户准入互斥时序、J4c handler/Schedule更新、失败创建 rollback、schema v2线上验证及真实 TTL删除/费用演练。因此两个 blocker和四个 readiness gate保持不变，J5g-c 仍不能称为 cleanup ready。

### B5-J5g-d durable Shared Cell admission fence（默认关闭、仅 LocalValidate）

J5g-d 关闭了 J5g-c 零租户 snapshot 与后续新增 ownership之间的代码级 TOCTOU 缺口。`0008_shared_cell_admission_fence.sql` 在 `deployment_environments` 上持久化 `open/draining`、单调 epoch、exact provision-operation/Stack/Cell-expiry绑定和 canonical fence SHA-256；新环境只能以 `open`、epoch 0和空 fence metadata开始。`NeonSharedCellAdmissionFenceWriter` 在任何 SQL提交前重新计算 predecessor `recordHash`与 provision-operation hash并核对 generation/epoch marker，拒绝 lineage内部不自洽的输入；随后只在 PostgreSQL `transaction_timestamp()` 已达到 predecessor 的 Cell expiry后，锁定与容量预留相同的 fixed environment row并执行 `open → draining`。transition trigger要求 epoch精确加一，tombstone trigger禁止删除或改写已 draining环境行，因而不能通过改 ID或删除后重建默认 `open` 行绕过围栏。同 lineage重试保持同一 epoch/时间，任何不同 lineage、提前执行或缺失环境都返回空结果并 fail closed。请求一旦开始提交，abort或 transport loss可能发生在数据库已 commit之后，因此统一返回可重试的 `NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN`，只允许以同一 predecessor幂等重试/readback；恢复准入则必须由后续独立审查的新 Cell lineage协议完成。

Repository与数据库 triggers构成双层围栏。`reserveEnvironmentCapacity`在同一环境行锁内要求 `admission_state='open'`，并用数据库时钟写入 `reserved_at`；Repository也约束 tenant-resource claim/reopen与 cleanup-schedule写入。deployment的 app-instance/environment以及 reservation和 cleanup schedule的 deployment/environment ownership坐标不可变且必须匹配 owning deployment；migration会在持有四张 ownership表的 `SHARE ROW EXCLUSIVE`锁时拒绝既存 reservation/resource/schedule错配，因此记录不能从 draining Cell移到 open环境后逃离零快照。数据库 trigger还 fence真正新增的 deployment、terminal deployment reopen、tenant-resource新增/换 owner或 generation/`destroyed → live`、cleanup-schedule新增，以及实例从非活跃状态进入 `pending/active`。真正 INSERT使用 AFTER ROW trigger，使 `ON CONFLICT ... DO NOTHING`重试保持幂等。draining期间 deployment、tenant-resource与 cleanup-schedule行都是不可删除的 ownership tombstone，不能靠直接 `DELETE`或 deployment级联擦除零快照信号；cleanup通过 terminal状态推进并显式删除 reservation。drain前已经持有同环境 exact reservation的在途 deployment仍可落 tenant resource或为既有 nonterminal deployment建立 cleanup schedule。零快照要求 reservation也为零，且 draining后无法创建新 reservation，因此快照后不能重新长出这些 ownership。cleanup schedule的 `succeeded/canceled`由 Repository状态谓词与 trigger共同保持为全局不可复活的 terminal状态。

显式 drain writer与 cleanup-authority零租户 adapter是两个独立边界：Inspect/evidence adapter不会隐式执行 `beginAdmissionDrain` 或任何 mutation，只读取 `Serializable + READ ONLY + DEFERRABLE` snapshot并验证事先已持久化的 exact lineage fence。snapshot schema v2强制回读同一 epoch/fence/Stack/provision hash，并由数据库显式返回 `databaseCellExpired=true`；本地主机时钟只限制该 evidence调用耗时，不再被当作数据库 expiry证明。但上层 authority/deletion freshness判断仍将数据库 `observedAt` 与本地 `now`比较，上线前的数据库/运行主机时钟校准仍是 blocker。删除侧的每次 ownership read同样拒绝 `open`、未到期或围栏字段畸形的 snapshot。

删除执行会在最终零租户 snapshot之后再次 exact读取 live Stack，再复核 caller、strong authority、授权有效期与 freshness，以收窄 `DeleteStack` 前窗口。但 CloudFormation、STS、DynamoDB与 DeleteStack不能组成单一原子事务；真正启用 cleanup前，所有 Stack mutator仍必须共享 durable deletion claim/lease或等价 IAM排他窗口。当前默认关闭，因此不能把本切片称为已绝对消除最终删除 TOCTOU。

本阶段仍只有本地入口：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-admission-fence.ps1 -Mode LocalValidate
```

该J5g-d入口只检查源码和运行mock定向测试；没有online模式，不读取 `DATABASE_URL`，不调用AWS/Neon。后续J5g-e2已独立应用 `0008`及其同批 `0005`–`0007`，J5g-f又在离线authority schema v2中闭合记录级RoleARN lineage；但显式drain和新schema都还没有接入线上批准/执行工作流。默认runtime依旧 `offline_only`，J4c Janitor仍为 `PLAN_ONLY`，Schedule仍为 `DISABLED`。持续数据库/运行主机时钟校准、受控root接线、短时IAM grant、authority推进、Janitor handler/Schedule、失败创建rollback、schema v2线上验证和真实删除/费用演练仍未完成，四个readiness gate继续为 `false`。

### B5-J5g-e1 Shared Cell PostgreSQL cutover OnlineInspect（真实只读）

J5g-e1把下一次 Neon schema写入拆成先审后执行。`neon-shared-cell-migration-readiness.ts`只接受仓库 exact `0001`–`0008` catalog、Neon exact `0001`–`0004` applied prefix以及唯一 `0005`–`0008` pending suffix；任意 checksum漂移、未知/部分 migration、无记录的目标schema对象、固定环境漂移、开启apply、运行或排队任务、运行step、非terminal cleanup schedule、capacity reservation或ownership坐标错配都会拒绝。数据库目标只进入不含host/user/password的fingerprint SHA-256。时钟采样要求10秒以内RTT与5秒以内数据库/运行主机偏差，review manifest最长有效15分钟且绑定canonical SHA-256。

PowerShell入口默认只做本地校验：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-postgres-cutover.ps1 -Mode LocalValidate
```

真实检查必须从未被Git跟踪的 `.env.local`读取 `DATABASE_URL`，拒绝进程环境覆盖，并把全新manifest写到仓库外：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-postgres-cutover.ps1 `
  -Mode OnlineInspect `
  -OutputPath 'C:\temp\techlong-j5ge1-neon-cutover-review.json' `
  -ConfirmReadOnlyPhrase 'I_ACKNOWLEDGE_NEON_READ_ONLY_INSPECTION' `
  -AcknowledgeReadOnlyNeonAccess
```

在线入口只开启 `SERIALIZABLE READ ONLY DEFERRABLE`事务，设置10秒statement timeout、1秒lock timeout及15秒idle timeout，结束时显式 `ROLLBACK`；没有Apply模式。2026-09-09实际检查确认PostgreSQL `server_version_num=180006`、事务回读确为read-only/serializable/deferrable、已应用 `0001`–`0004` checksum全部匹配、唯一pending为 `0005`–`0008`，running/queued job、running step、非terminal cleanup schedule、capacity reservation和坐标错配均为0；时钟RTT 70ms、偏差1848ms。最终仓库外manifest SHA-256为 `e161549a32f2bd19a407d02d83fbddd81bc7b5fc09585a6cc0f4c3531a3c48f7`，`mutationPerformed=false`。

J5g-e1不授权数据库写入。后续Apply阶段必须重新验证未过期的exact manifest，在一个受控事务内重查quiescence、取得固定advisory/table lock、只执行 `0005`–`0008`并提交后独立回读。默认runtime、J4c Janitor与Schedule保持 `offline_only` / `PLAN_ONLY` / `DISABLED`；本阶段没有调用AWS、应用migration、创建Cell、推进authority、执行admission drain、`DeleteStack`或`RunTask`。

### B5-J5g-e2 reviewed Neon migration apply（已执行，runtime仍默认关闭）

J5g-e2使用独立执行器，绝不调用会逐文件提交的通用 `apply-postgres-migrations.mjs`。它要求 fresh J5g-e1 manifest及其exact SHA与当前Neon target匹配；写路径使用一个 `SERIALIZABLE READ WRITE NOT DEFERRABLE`事务、固定 `public,pg_catalog` search path、transaction advisory lock、`schema_migrations`独占锁和execution/ownership表写互斥锁。锁后会重新核对exact `0001`–`0004`、全部activity/ownership计数、两个可能触发 `0006` 历史数据归一化的计数、`0003`旧定义到`0005`新定义的同名step-run索引、schema与时钟，再按checksum固定顺序将 `0005`–`0008`及四条migration记录一次提交。任何部分前缀或漂移都拒绝；提交后换新连接强回读exact 8条记录、正确的 `external_operation_epoch`、新表、23个已启用trigger、20个index、23个已验证constraint、空cutover数据和fixed environment默认admission状态。`COMMIT`回包不明时只能只读reconcile，不会盲目重试。

默认入口只做本地验证，不读取数据库：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-postgres-migration-apply.ps1 `
  -Mode LocalValidate
```

只有取得明确数据库写入批准并重新生成尚未过期的J5g-e1 manifest后，才可运行：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-postgres-migration-apply.ps1 `
  -Mode ApplyReviewedMigrations `
  -ReviewPath 'C:\temp\techlong-j5ge1-fresh-review.json' `
  -ReviewSha256 '<fresh-manifest-sha256>' `
  -OutputPath 'C:\temp\techlong-j5ge2-migration-receipt.json' `
  -ConfirmApplyPhrase 'I_CONFIRM_J5GE2_APPLY_NEON_MIGRATIONS_0005_TO_0008' `
  -AcknowledgeNeonDatabaseWrite `
  -AcknowledgeAtomicDdlNoAutomaticDownMigration
```

提交结果不明时，`RecoverAppliedState`只做read-only exact post-state判定，并拒绝所有apply确认参数：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-shared-cell-postgres-migration-apply.ps1 `
  -Mode RecoverAppliedState `
  -ReviewPath 'C:\temp\techlong-j5ge1-fresh-review.json' `
  -ReviewSha256 '<fresh-manifest-sha256>' `
  -OutputPath 'C:\temp\techlong-j5ge2-recovery-receipt.json'
```

2026-09-09首次fresh apply在DDL前因工具把 `0003`已存在、`0005`将同名替换的step-run索引误判为提前出现而失败关闭，事务回滚且 `mutationPerformed=false`；没有手工删除或修复数据库对象。修正为精确旧/新索引定义后，新manifest SHA-256为 `4bd20b41a185462c5d8951d36f57c463cc1fe13cf7ed54fdbcafc7262a0a72da`。受审执行已原子应用 `0005`–`0008`，apply回执为 `outcome=applied`、`mutationPerformed=true`、SHA-256 `9edb120a7cf4b89e197f5ab2f1bdbf1093327b4b1d8969bc7aeef6433f1dd392`；独立只读recovery回执SHA-256 `5a8ac632c925fe7950a018f8dd1d12c1d5ac49ea7d82c2d0c3eac97d32936d06`再次确认exact完整后态。所有runtime gate、Janitor和Schedule状态不变；本次没有涉及AWS调用或付费资源变更。

### B5-J5g-f Shared Cell authority RoleARN lineage schema v2（默认关闭、仅离线验证）

J5g-f把authority item与其canonical记录统一升级为显式v2：DynamoDB四字段item只接受`schema_version=2`，`record_json`中的`provision_verified`和`cleanup_authorized`只接受`schemaVersion=2`，并都持久化exact `cloudFormationRoleArn=arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole`。该字段属于canonical exact-key集合，进入provision/cleanup operation hash、record hash、同lineage比较和admission-drain lineage；cleanup advance必须从v2 predecessor原样继承它，其他RoleARN、缺字段、额外字段以及item/record schema漂移都会fail closed。

live provision evidence也升级为schema v2，并从前后稳定CloudFormation Stack readback的`RoleARN`携带该值进入absent-only compiler；online provision/cleanup operator summary同样升级为v2并显式携带该字段。plan-only `cell-janitor.cjs`固定同一RoleARN，只接受v2 authority，并在仍为v1的`PLAN_READY_MUTATION_DISABLED` result中显式投影`cloudFormationRoleArn`；authority其他reader/writer也只接受v2，旧v1记录不会被兼容读取、自动迁移或静默改写。本轮涉及的入口边界中，LocalValidate envelope与Schedule event继续保持schema v1，其他独立协议版本也未随authority自动改变；它们与DynamoDB authority schema是不同边界，不能用来降级authority校验。

本切片没有新增online CLI、DynamoDB migration或default Worker/Janitor root wiring，只执行离线源码与定向测试，不调用AWS或Neon。账号仍没有Shared Cell，authority key仍为`ABSENT`，因而线上没有v1 item被迁移或v2 item被安装；J4c Lambda仍只接受`inspect_cell_cleanup_plan`并固定`PLAN_ONLY`，Schedule仍为`DISABLED`，默认runtime仍为`offline_only`，两个blocker与四个readiness gate均不变。

J5g-a-online-1 已完成四资源 Locked IAM root部署与严格 Readback；J5g-a-online-2已在本地补齐`AuthorGrant → AuthorRevoke` controller、双哈希/固定StackId/短窗口门禁、确定性candidate和只读preflight，但没有调用AWS。下一步不是重复 InitialLocked，也不是创建child Change Set；应先部署并核验build-source不可变策略、让Janitor兼容`delete_shared_cell_stack`，再完成`REVIEW_IN_PROGRESS → MISSING → AuthorRevoke`失败补偿状态机。之后仍须单独实现并批准Execute/Rollback grant、付费Cell、production collector/root、数据库/运行主机时钟校准、live drain/snapshot、v2 predecessor install/cleanup advance、provider-side真实删除和费用演练。线上J4c consumer升级为v2并完成严格回读的前置已由J5g-g闭环；这不批准安装authority item或启用Schedule。首次authority install仍必须从持续`ABSENT` strong read出发，使用fresh schema v2 evidence、exact `cloudFormationRoleArn`和人工批准的candidate digest；若任何环境观察到v1 item，应停止并人工调查，不能由运行时自动升级。

### B5-J5g-g J4c authority-v2 plan-only consumer rollout（线上已完成）

J5g-g 固定以 commit `ae71dac5d4c1e5c05912a630e2696c4645ac2836` 重建上线前 J4c-v1 child：raw/canonical SHA-256 为 `a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986` / `74379232124d94b1d2ffb4322edaecd0bdb0534444b8961295175ecadc06c09c`。已部署 v2 目标固定为 `a768753c50de3fd3e13a1366ac5493768f794a0635c54274438c9606c1ad11e6` / `4f42f95d7e0b43b309d87acf2fb4795b136a1b40643d433e84606849d46d4673`，正向 Change Set 名称为 `techlong-s3-b5-cell-bootstrap-a768753c50de3fd3`；全模板比较证明唯一模板差异为 `CellJanitorFunction.Properties.Code.ZipFile`，实际 Change Set 仅含 `CellJanitorFunction.Code` 原地修改、`Replacement=False`。反向回退 Change Set 目标名称为 `techlong-s3-b5-cell-bootstrap-rollback-a14e9898ed7af636`，仍处于休眠状态，未创建、未执行；它也只允许同一 Lambda Code 原地修改。

正向部署已按 digest-addressed S3 object 和 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked` 完成；Author/Execute grant 均已撤销，management 最终为 `LOCKED`，raw/canonical SHA-256 为 `93f37b585812b49f540a317bfdbdd45a374705347288a2c998c229d31231f9ec` / `1be6a039a759acbf9c8d3211981400122c549bff0be6073e3df008c51b08ae12`。child 当前为 `UPDATE_COMPLETE`；已执行 Change Set `techlong-s3-b5-cell-bootstrap-a768753c50de3fd3`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-a768753c50de3fd3/38bd29a4-6926-4a24-947f-1d3c70a80030`）只修改 `CellJanitorFunction.Code`、`Replacement=False`，Schedule 未进入变更集合且保持 `DISABLED`。实际 Lambda ZIP `CodeSha256=ste9pzx4E+qEezhoPwB+oZRtJv/iYC2szaOhlFVdozI=`；strict readback evidence canonical SHA-256 为 `9010a454f0a7573235e6532a2155f102cf211302b711fb7a41af7a38c5d129b8`。两次低成本调用逐字一致返回 `ABSENT_SAFE`、`mutationPerformed=false`、`cellStack=MISSING`、`tenantStacks=[]`，probe evidence canonical SHA-256 为 `ef7699c9c005eed98077f2e43ebfae8caa78069fff269b5b7db6a645875f3835`。Schedule event与 plan result仍是独立 schema v1，Lambda仍固定 `PLAN_ONLY`；v2仅指 authority item/record decoder。authority key仍为`ABSENT`；未创建付费 Shared Cell、VPC、ALB、ECS cluster/service、Aurora/RDS 或 Route 53，也未执行`RunTask`，但两次 Lambda 调用及日志仍可能产生极少量费用。四个readiness gate仍全部为`false`。

启用 MFA 后，应创建一个本地 `techlong-sandbox-provisioner` AWS CLI Profile：`role_arn` 固定为 `arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole`，`source_profile` 指向现有 IAM User Profile，`mfa_serial` 指向该用户的真实 MFA Device ARN，`role_session_name` 必须是 `techlong-sandbox-provisioner`。构建脚本会对 STS ARN 做精确匹配，拒绝直接使用长期 IAM User 凭据。

## 安全镜像源码包

`s3-build-image.ps1` 只读取 Git 已跟踪、工作树无修改且位于明确 allowlist 中的订单服务文件。它始终排除 `.env`、Firebase/Service Account JSON、私钥/证书、压缩包、备份、数据库 dump 和 migration artifacts，并对文本执行常见 Secret 特征扫描。未跟踪文件绝不会进入源码包。上传或启动构建只能使用 MFA 支持的 `techlong-sandbox-provisioner` AssumeRole 会话。

```powershell
# 仅检查 allowlist 与 Secret；不生成 Zip
.\ops\aws-sandbox\scripts\s3-build-image.ps1

# 只在本地生成可审查 Zip
.\ops\aws-sandbox\scripts\s3-build-image.ps1 `
  -Mode Package `
  -OutputPath 'C:\temp\speedfeast-build.zip'

# 上传到一天后清理的专用 S3 source/ 前缀，但不启动构建
.\ops\aws-sandbox\scripts\s3-build-image.ps1 `
  -Mode Upload `
  -ConfirmAccountId '402010193138'

# 上传并明确接受 CodeBuild 费用后启动一个构建
.\ops\aws-sandbox\scripts\s3-build-image.ps1 `
  -Mode StartBuild `
  -ConfirmAccountId '402010193138' `
  -AcknowledgeBuildMayIncurCost

# 只按 ECR 中现有不可变 tag 的 exact digest 拉取并重跑全部 smoke；不走 push 分支
.\ops\aws-sandbox\scripts\s3-build-image.ps1 `
  -Mode VerifyImage `
  -ConfirmAccountId '402010193138' `
  -AcknowledgeBuildMayIncurCost
```

上传对象键为 `source/speedfeast-<40位Git提交>.zip`，镜像标签为不可覆盖的 `git-<40位Git提交>`。CodeBuild Project 没有 Webhook、定时触发、VPC/NAT 或默认可工作的 Source；只有显式调用 `StartBuild` 才会产生构建费用。

脚本在上传源码前先查询该 Git 标签。若 ECR 已存在 `git-<commit>`，普通 `StartBuild` 返回现有 Digest，并跳过 S3 上传和 CodeBuild，从而避免不可变标签冲突和重复构建费用。只有显式 `VerifyImage` 才会把标签再次绑定到 exact digest，上传当前受审 buildspec，并启动一次 smoke-only CodeBuild；该路径按 digest pull、本地 tag、完整 smoke 和最终 digest readback，不执行 `docker push`。CodeBuild Role 的 exact-repository policy 因此必须包含 `ecr:BatchGetImage` 与 `ecr:GetDownloadUrlForLayer`；旧 Bootstrap 只允许通过 `CodeBuildImagePull` update shape 补齐这两项只读权限。唯一直接修改必须是 `CodeBuildRole/Policies`、`Replacement=False`；CloudFormation 还会报告现有 `SandboxCodeBuildProject/ServiceRole` 对 `CodeBuildRole.Arn` 的 dynamic dependency，脚本只接受该 exact `Modify / Replacement=Conditional` 记录，拒绝任何其他 Project 属性、依赖来源或 replacement 形态。

`StartBuild` 返回只表示构建已排队。必须继续确认 CodeBuild 为 `SUCCEEDED`、不可变标签解析到固定 Digest，并使用受限 Provisioner Role 读取 ECR scan findings。扫描未完成或存在尚未评审的高危/严重发现时，不得把镜像写入部署环境绑定或启动租户 Apply。

镜像推送前，Buildspec 还会在本地构建容器上验证最终身份为 `65532:65532`、空 ENTRYPOINT 语义、Web-only CMD、Node 版本精确为 `24.18.0`，并实际加载 `bcrypt`、`pg` 与 lifecycle runtime。只有全部 smoke 完成才会写入 push sentinel；post-build 即使在 build 失败后仍被 CodeBuild 调度，也无法越过该 sentinel。任一 smoke、push 或 digest readback 失败都会使构建失败；这可以在无 shell 的 distroless 运行时进入 ECR 前发现 Node ABI、原生依赖或运行契约不兼容。

## 此前核验的云端状态与后续门禁

以下条目包含 S3-A 历史核验，以及 2026-08-22 B5-I、2026-08-24 B5-J2/B5-J3、2026-08-25 B5-J4a、2026-08-26 B5-J4b 和 2026-08-30 Build #7/B5-J3 revision 2 的在线状态。

1. AWS CLI v2 已位于 `D:\Amazon\AWSCLIV2\aws.exe`；当前终端 PATH 尚未刷新，可以先使用绝对路径。
2. 已确认 `techlong-sandbox-dev` 绑定 MFA，并配置不含密钥的 `techlong-sandbox-provisioner` AssumeRole Profile。首次角色会话需要操作者在本地终端输入 MFA 一次性验证码；后续还应移除 IAM User 继承的长期 AdministratorAccess，只保留受控 AssumeRole 能力。
3. 账号原有的 `My Zero-Spend Budget`（`1 USD`）未被修改；S3-A 已另行创建按 `Environment=aws-sandbox` 过滤的 `10 USD` Budget。两者都只是有延迟的告警，不能作为实时硬停机制。
4. 已只读确认该账号当前未使用 AWS Organizations。不要为了本 Sandbox 主动加入 Organizations；当前 Deny 示例应作为 IAM 策略评审起点，不能假设 SCP 可用。
5. Budget 通知邮箱已作为 CloudFormation 参数提供，个人邮箱没有硬编码进模板或仓库。
6. S3-A 已由独立的 CloudFormation Execution Role 和 Permissions Boundary 部署；Boundary 本身不授予权限。
7. Janitor 已在真实 AWS 中验证空扫描、伪造共享 Cell 拒绝路径和到期临时租户 Stack 删除路径；测试资源已完全清除。
8. Build #4 及更早镜像保留为历史不可变版本。当前权威 Build #7（CodeBuild ID `techlong-sandbox-speedfeast-image:0a33f1c9-8e43-408d-b91d-fe39d6c61ac7`）从后端提交 `201187cddb1a77690c0df2c7779d354af6009e7c` 构建；源码存档 SHA-256 为 `e00ca7f2865a81ab0500a505ec37c812c0e7e827293239d329cf00f9bcfcf29e`，最终不可变镜像为 `sha256:6001bde1cc05058ae3df83fbdb084e8cd53b64325ecb6663b43a5fccc8ef22be`。全部阶段成功，ECR 扫描 `COMPLETE` 且 findings 为 0，仓库仍为 `IMMUTABLE`、scan-on-push、AES256。
9. Build #7 已固定到 inspect-default `tenant-lifecycle:2`，但尚未写入 execution binding，Worker 和 Apply 仍关闭；TaskDefinition 注册不构成 runtime binding。创建收费 Stack 前必须先建立一次性清理计划，创建失败时部署必须中止。
10. B5 receipt Bucket、authority table、专用 LifecycleTaskRole 和最小 WorkerRole 已由受审 Change Set 部署。2026-08-24 的 `LifecycleReadback` Change Set `techlong-s3-b5-support-lifecycle-readback-60d854ad2664718e`（raw SHA-256 `60d854ad2664718eed88ec4731ff3a70cb84b34ba9dcaf439782dcba7a816113`，canonical SHA-256 `1fe4af4b94a198437511a147fe05685eefb768304e3ab487ca06722657c2223b`）只对 `ServiceRoleBoundary`、`ProvisionerBoundary`、`TenantLifecycleTaskRole`、`DeploymentWorkerRole` 执行四项无 replacement 修改；Bootstrap 为 `UPDATE_COMPLETE`，线上 policy/role 回读匹配模板。scoped rollback 脚本已通过静态审查，但它会永久删除 receipt/authority data，真实回退演练仍须在无租户状态下单独批准。
11. B5-J3 已注册并严格回读 ACTIVE `tenant-lifecycle:2`，旧 revision 1 为 `INACTIVE`；随后撤销临时 LifecycleTaskRole PassRole，最终 boundary `v7` 为 `LOCKED`。部署模板 canonical SHA-256 为 `127b4bf5cf634c84737df5fd7cba2eac94424a42e7974166b607036b42df1962`，readback evidence 为 `f3b8fb0d9eeb2386658f49e51fe4687da8a7e345c443934a98171f7e512b51cb`；精确 Cell cluster 为 `MISSING`，没有 tenant service、Cell 或 `RunTask`。
12. B5-J4b management/child 在首次部署时分别达到 `UPDATE_COMPLETE`/`CREATE_COMPLETE`；经 J4c/J5g-g 原地更新后，child 当前为 `UPDATE_COMPLETE`。管理根最终 `LOCKED`，child 只含 4 个 cleanup-only 资源；当前严格 readback 与两次 `ABSENT_SAFE` probe 均通过，Schedule 保持 `DISABLED`，没有创建 Shared Cell 或运行 ECS Task，四个 readiness gate 仍全部为 `false`。

B4 Cell 模板只允许 `aurora-postgresql-serverless-v2`，最多一个共享 Cell，固定 PostgreSQL `16.14`、关闭自动小版本升级，使用 `minAcu=0`、`maxAcu=1`、`secondsUntilAutoPause=300`，并禁止每租户独立 Cluster、额外 Reader、传统 Multi-AZ 实例、DB Proxy、Global Database、预留购买和快照恢复。Aurora Cluster 本身不能被策略绝对禁止，否则生产兼容的 Sandbox Cell 无法创建；真实 Apply 前还必须重新核对该 Region 支持的 Engine/自动暂停能力，并由受控模板、Execution Role 与部署前静态检查共同锁定。

## TTL / Janitor 契约

Janitor 每 15 分钟扫描一次，并由每个租户 Stack 额外创建一次性到期任务。所有可变资源必须带有：

```text
Environment=aws-sandbox
ManagedBy=techlong-provisioner
DeploymentId=<stable id>
AppInstanceId=<stable id>
CellId=<stable cell id>
ResourceGeneration=<positive integer>
ExpiresAt=<UTC timestamp>
```

租户 Janitor 不直接逐项删除 AWS 资源，只调用 CloudFormation `DeleteStack`，让 Stack 按依赖关系回滚。它同时要求：Stack 名严格匹配 `techlong-sandbox-tenant-<1至16位小写字母或数字>`、是顶层 Stack、`Environment=aws-sandbox`、`ManagedBy=techlong-provisioner`、非空 `DeploymentId`/`AppInstanceId`/`CellId`、正整数 `ResourceGeneration`，以及格式严格且已经到期的 UTC `ExpiresAt`。`DELETE_IN_PROGRESS`、`DELETE_COMPLETE` 和 `REVIEW_IN_PROGRESS` 会跳过；`DELETE_FAILED` 会在全局扫描中重试。共享 Cell 即使误带租户标签也不能被租户 Janitor 删除。全局扫描每次最多删除一个 Stack，定向清理还必须同时匹配 payload 中的 `DeploymentId`、`AppInstanceId` 和 `ResourceGeneration`。

`cell-janitor.cjs` 仍是审查来源；B5-J4b child 只把其中的精确单 Cell inventory 检查包装成 mutation-disabled Lambda，Schedule 也固定为 `DISABLED`，因此它当前不能删除 Cell。管理根/child 已在 AWS 部署并完成严格回读和双次 empty inventory probe，但这不构成完整 cleanup runtime。完整 Cell Janitor 代码仍不能清理 CloudFormation Stack 外的租户 database、role 或 Secret；没有完整、有围栏的 cleanup coordinator 与真实 TTL 演练时，禁止 Cell Apply。

回退默认只显示计划。真实回退会先拒绝仍有租户 Stack 的环境，然后验证专用源码 Bucket 的三项安全标签、清空该 Bucket，并删除 Bootstrap；这也会清空并删除 Sandbox ECR 镜像。Budget 只有额外传入 `-DeleteBudgetGuardrail` 和准确 Stack 名时才删除。

## DNS 边界

建议只把 `sandbox.techlong.cloud` 子域委派给 Route 53，生产租户使用另一个域名边界。Sandbox 租户入口使用 `{tenant}.sandbox.techlong.cloud`。控制接口仍使用相同实例域名下受 JWT、scope 和未来 mTLS 保护的 `/api/saas/*`，不新增公开控制域名。

## 策略示例的重要限制

- `provisioner-permissions-boundary.example.json` 是最大权限边界，不是授予权限的 Identity Policy。
- Provisioner 只被允许管理 `techlong-sandbox-tenant-*` CloudFormation Stack、Pass 指定的 Sandbox Execution Role，并以固定 session name Assume exact `TechlongSandboxDeploymentWorkerRole`；共享 Cell 和 Bootstrap 仍不在其 CloudFormation 权限内。
- B5-J4b 管理根的 Manager role 只在短期 grant 窗口操作固定 child Bootstrap Change Set；长期 Locked 状态不允许 child Create/Execute/Delete。AuthorGrant 通过 exact digest-addressed S3 `TemplateUrl`、execution `RoleARN`、`ChangeSetName`、4 种 `ResourceTypes` 和 exact `GetObject` 收窄模板作者能力，ExecuteGrant 前必须完成 exact Change Set/原始模板预检，两个窗口都要立即撤销。CloudFormation execution role 不拥有 IAM lifecycle，只能 `PassRole` 给 exact Janitor/Scheduler 两个外部最小角色。
- J5g-a 的 Cell lifecycle IAM 模板与 J4c cleanup-only 管理根彼此独立。J5g-a-online-1 已为固定 Stack `techlong-s3-b5-cell-lifecycle-management` 实现 `LocalValidate/OnlineValidate/CreateChangeSet/InspectChangeSet/ExecuteChangeSet/Readback`，但线上 `UpdateShape` 只接受 `InitialLocked`；`AuthorGrant/ExecuteGrant/RollbackGrant` 继续只能离线渲染。InitialLocked Change Set已按独立批准执行，Stack和四个 Locked IAM资源均为 `CREATE_COMPLETE`，严格 Readback通过。PassRole、RoleARN、digest URL、18 种 ResourceTypes、tags、name、action与 expiry仍只是后续 grant组合契约，发布不可覆盖性、execution boundary EC2上界、RDS-managed Secret权限和运行时 grant窗口尚未闭合。AWS 对普通 Stack service-role trust是否稳定提供 SourceArn/SourceAccount没有官方保证，且 rollback grant不承担 TTL cleanup，因此 InitialLocked能力不构成 grant部署或收费 Cell批准。
- B5-J4b cleanup-only Bootstrap 管理根与 child 已通过受控 `OnlineValidate`、Change Set 审查、IAM simulation、严格 readback 和双次 empty inventory probe；该管理根最终回到 `LOCKED`。这些证据只证明当前 cleanup-only Bootstrap 边界，不允许付费 Cell，也不打开任何 readiness gate。
- `sandbox-expensive-actions-deny.example.json` 是 Deny-only 示例。当前账号未使用 AWS Organizations，因此只能把它作为 IAM Policy 评审起点，不能假设 SCP 已生效。
- 策略中的 Account、Region 和角色名称属于非敏感固定标识，但上线前仍必须与实际账号状态核对。

这些脚本没有后台自动执行入口。任何真实 AWS 写操作都需要人工显式选择模式、核对账号，并满足相应确认参数；SaaS Worker 的租户 Apply 仍保持关闭。
