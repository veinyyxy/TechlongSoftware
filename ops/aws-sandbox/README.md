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
   ├─ render-b5-cell-bootstrap.mjs
   ├─ render-b5-support-rollback.mjs
   ├─ lifecycle-log-support-contract.mjs
   ├─ s3-b5-cell-bootstrap-management.ps1
   ├─ s3-b5-cell-bootstrap.ps1
   ├─ s3-b5-lifecycle-log-support.ps1
   ├─ s3-b5-lifecycle-task-definition.ps1
   ├─ s3-b5-shared-cell-provision-authority-operator.ps1
   ├─ s3-b5-shared-cell-provision-authority-preflight.ps1
   ├─ s3-b5-support-bootstrap.ps1
   ├─ s3-bootstrap.ps1
   ├─ s3-build-image.ps1
   ├─ s3-rollback.ps1
   ├─ validate-cell.mjs
   ├─ validate-b5-cell-bootstrap-management.mjs
   ├─ validate-b5-cell-bootstrap.mjs
   ├─ validate-b5-lifecycle-log-support.mjs
   ├─ validate-b5-lifecycle-task-definition.mjs
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

- 管理 StackId 为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap-management/e1bacdf0-a0ca-11f1-a27e-0e9a646108cf`，状态为 `UPDATE_COMPLETE`，最终 UpdateShape 为 `LOCKED`，inventory 精确为 8 个 IAM 资源。最终管理模板 raw/canonical SHA-256 分别为 `15ec52203f390d29858fb77e032c4d6bff83d5c3678397bf133bf60e6ab9d553` / `5d09bbc9010de13dfdba09b71c13c58711a9238cb09cd78eb767f509b29c07a1`。
- child StackId 为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/2477b820-a174-11f1-aca9-0668f7a50fdf`，状态为 `CREATE_COMPLETE`，inventory 精确为 4 个非 IAM 资源。child 模板 raw/canonical SHA-256 分别为 `8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f` / `2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389`。
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

J5a 为 J4c 的 `cell:cell-sandbox-1` authority 消费 schema 增加 SDK-free 本地候选契约：compiler 只校验调用方 Stack DTO 的严格形状，不采集或认证 live evidence；它生成 exact 4-field item 与 canonical 22-field record，内部从 exact intent 派生 cleanup operation hash，并绑定 marker、revision、Cell 到期时间和最长一小时 authorization。产物通过仓库内 J4c validator 与 DynamoDB AttributeValue decoder 的本地跨契约测试；没有调用已部署 Lambda 或 AWS。

atomic advance 协调逻辑拒绝空 snapshot，只允许已有 exact predecessor 在同 owner/generation/provision/Stack lineage 内严格增加 cleanup epoch；exact 重试不写入，CAS、独立回读、intent hash或时间窗任一漂移都 fail closed。这里只存在接口、Mock 和显式 disabled 实现，没有真实条件写 provider；default root 不暴露该 capability，现有 `tenant:<64hex>` adapter 仍拒绝 `cell:*`。

首条可信 provision authority/bootstrap、live evidence provenance、AWS SDK/DynamoDB writer/IAM 和 root 接线仍缺失，因此新增 `shared_cell_provision_authority_predecessor_missing` 与 `shared_cell_cleanup_authority_writer_missing` 两个 blocker。`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false`。本切片没有 AWS、IAM、CloudFormation 或部署步骤，不能授权 J4c mutation，也不能创建或删除 Shared Cell。

### B5-J5b Shared Cell cleanup authority（dormant production DynamoDB CAS adapter）

J5b 增加 production DynamoDB adapter 源码，但 default runtime 不构造或暴露它。adapter 只接受 exact table ARN `arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority` 与 fixed key `cell:cell-sandbox-1`；observe 使用 full consistent `GetItem`，只读取 exact 4-field item。字段集合、schema、revision、canonical `record_json`、operation/record hash、账号、区域、Cell 或 Stack lineage 任一漂移都会 fail closed。

cleanup authority 不能从空 snapshot bootstrap；后续必须先由独立受审流程安装带可信 live provenance 的 provision predecessor。已有 predecessor 的 advance 使用 schema + revision + 完整 canonical predecessor `record_json` 约束 conditional `PutItem`，并在写后重新 full consistent readback exact candidate。exact replay 不写入；conditional conflict 只返回 fresh winner snapshot。abort、provider 错误或不确定结果、CAS 伪成功、缺失/漂移 readback、时钟回拨、授权在写入前或写入后过期，均不得报告成功。

本切片只新增 dormant adapter 与注入 fake commands/client 的本地测试，没有修改 runtime、IAM、CloudFormation、J4c Lambda 或 Schedule，没有调用 AWS、连接 Neon/PostgreSQL、执行 `RunTask` 或创建/删除资源。`shared_cell_provision_authority_predecessor_missing` 和 `shared_cell_cleanup_authority_writer_missing` 两个 blocker与四个 readiness gate 全部保持不变；下一依赖是可信 provision predecessor、live Stack evidence provenance 和它们的独立安装授权，不能跳过这些边界直接启用 cleanup mutation。

### B5-J5c Shared Cell provision predecessor（dormant）

J5c 在同一个 `cell:cell-sandbox-1` key 上增加严格 18 字段 `provision_verified` predecessor；现有 4 字段 envelope 与 22 字段 `cleanup_authorized` 消费契约不变。provision/cleanup operation hash 和 record hash 均绑定 canonical exact intent，唯一允许的首跳是同 lineage、revision + 1 且 cleanup epoch 更大的 `provision_verified → cleanup_authorized`；cleanup adapter 继续拒绝空表 bootstrap。

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
12. B5-J4b management/child 已分别达到 `UPDATE_COMPLETE`/`CREATE_COMPLETE`；管理根最终 `LOCKED`，child 只含 4 个 cleanup-only 资源。严格 readback 与两次 empty inventory probe 均通过，Schedule 保持 `DISABLED`，没有创建 Shared Cell 或运行 ECS Task，四个 readiness gate 仍全部为 `false`。

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
- 管理根与 child 已通过受控 `OnlineValidate`、Change Set 审查、IAM simulation、严格 readback 和双次 empty inventory probe；管理根最终回到 `LOCKED`。这些证据只证明当前 cleanup-only Bootstrap 边界，不允许付费 Cell，也不打开任何 readiness gate。
- `sandbox-expensive-actions-deny.example.json` 是 Deny-only 示例。当前账号未使用 AWS Organizations，因此只能把它作为 IAM Policy 评审起点，不能假设 SCP 已生效。
- 策略中的 Account、Region 和角色名称属于非敏感固定标识，但上线前仍必须与实际账号状态核对。

这些脚本没有后台自动执行入口。任何真实 AWS 写操作都需要人工显式选择模式、核对账号，并满足相应确认参数；SaaS Worker 的租户 Apply 仍保持关闭。
