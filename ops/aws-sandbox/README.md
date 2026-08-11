# AWS Sandbox S0–S3-B5 安全 Bootstrap 与离线 Cell 基础

这个目录保存可审查的静态配置、CloudFormation 模板、IAM 边界、TTL Janitor、镜像构建基础和默认不执行的运维脚本。仓库中不包含 Access Key、Secret Access Key、Stripe 密钥、数据库密码或私钥。

S3-A Bootstrap 脚本默认仅运行本地验证；只有显式选择 `CreateChangeSet` 或 `Apply`、确认账号、提供预算通知邮箱并确认 MFA 前置条件后，脚本才会产生 AWS 写操作。B5 又增加了一个独立的 Cell Bootstrap：它只准备 MFA Operator、独立 CloudFormation Execution Role、Cell Janitor 和 15 分钟兜底计划，不创建 VPC、ALB、ECS、Aurora 或 Shared Cell。它的默认模式同样只做本地验证，真实写入严格拆成“创建 Change Set”和“人工审查后执行 Change Set”两次命令。

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
│  └─ s3-b5-cell-bootstrap.template.json
├─ codebuild/
│  └─ buildspec.aws-sandbox.yml
├─ lambda/
│  ├─ janitor.cjs
│  └─ cell-janitor.cjs
├─ policies/
│  ├─ cell-operator-permissions-boundary.example.json
│  ├─ provisioner-permissions-boundary.example.json
│  └─ sandbox-expensive-actions-deny.example.json
└─ scripts/
   ├─ render-bootstrap.mjs
   ├─ render-b5-cell-bootstrap.mjs
   ├─ s3-b5-cell-bootstrap.ps1
   ├─ s3-bootstrap.ps1
   ├─ s3-build-image.ps1
   ├─ s3-rollback.ps1
   ├─ validate-cell.mjs
   ├─ validate-b5-cell-bootstrap.mjs
   └─ validate.mjs
```

`guardrails.template.json` 只描述按 `user:Environment$aws-sandbox` 成本分配标签过滤的月度 Cost Budget 和邮件通知。通知邮箱只能在执行时作为参数传入。AWS Budgets 的账单数据有延迟，不能代替 TTL Janitor。

此过滤依赖 Billing 中已经激活 `Environment` 用户成本分配标签；新激活标签和费用归集都可能延迟。执行 Bootstrap 前必须在 Billing 控制台确认该标签可用于 Cost Explorer/Budgets，否则 `$10` Budget 可能暂时看不到 Sandbox 费用。

`s3-bootstrap.template.json` 不创建 Cell、VPC、NAT、ALB、ECS Service、Aurora/RDS、Route 53 Hosted Zone 或租户资源。它只创建：

- MFA 强制的 `TechlongSandboxProvisionerRole`，信任关系只接受现有 `techlong-sandbox-dev` IAM User；不修改该用户或 Administrators 组。
- 有独立 Permissions Boundary 的 CloudFormation Execution Role、Janitor Role、Scheduler Invoke Role、CodeBuild Role、ECS Task Execution Role 和 Task Role。
- 全局 Janitor Lambda 与 `rate(15 minutes)` EventBridge Scheduler 安全扫描。
- `techlong-sandbox` Scheduler Group，供每个租户先创建一次性 TTL 清理计划。
- 标签不可覆盖、推送扫描、最多保留两个镜像的 `techlong-sandbox-speedfeast` ECR Repository。
- 完全阻止公网访问、AES256 加密、`source/` 一天过期的专用 CodeBuild 源码 Bucket。
- 默认构建必定失败、仅可显式 Source/Buildspec override 启动的 CodeBuild Project；固定 `aws/codebuild/standard:8.0`、最小 Compute、5 分钟超时、并发 1。

Janitor 不设置 Lambda Reserved Concurrency：该账号当前 Lambda 并发额度较低，预留 1 会违反 AWS 至少保留 10 个未预留并发的账号规则。并发风险改由 Sandbox `maxTenants=1`、单个全局计划、每次最多删除一个栈、严格所有权标签和幂等 `DeleteStack` 控制。

Bootstrap 模板中的 Janitor 源码使用占位符，部署脚本会从 `lambda/janitor.cjs` 注入并检查渲染后模板不超过 CloudFormation 的直接 TemplateBody 限制。不要直接部署未渲染的 `s3-bootstrap.template.json`。

## 本地检查

不需要 AWS CLI，也不会发起网络请求：

```powershell
npm --prefix .\ops\aws-sandbox test
```

该命令同时执行 S0–S3-A Bootstrap、S3-B Shared Cell 渲染，以及 B5 Cell Bootstrap/双阶段 Change Set 边界检查。单独运行 `validate.mjs` 只覆盖 S0–S3-A，不等价于完整验证。

检查内容包括：

- 所有 JSON 都可以解析。
- 默认 Account、Region、预算、TTL、最大并发和域名没有漂移。
- 两个 CloudFormation 模板均受 Account 与 Region 条件保护。
- Budget 排除 Credit，避免赠送额度掩盖实际消耗。
- Budget 只统计带 `Environment=aws-sandbox` 成本分配标签的资源。
- 预算通知阈值为 10%、30%、50%、80%、100%。
- Permissions Boundary 不包含允许全部动作的语句。
- Deny 策略覆盖 NAT、VPC Endpoint、EC2、RDS Proxy、Global Database、快照恢复、预留购买、Marketplace 和客户管理 KMS Key 等高风险动作。唯一允许规划的数据库形态是受控的 Aurora PostgreSQL Serverless v2 Cell。
- 文本中没有常见 AWS、Stripe、PostgreSQL URL 或 PEM 私钥特征。
- Provisioner Role 信任关系强制 MFA，且模板中不存在 IAM User/Group 资源。
- 租户 Janitor 对错误前缀、缺标签、错误标签、无效/未来 `ExpiresAt`、嵌套 Stack，以及不匹配的 DeploymentId、AppInstanceId、CellId 或 ResourceGeneration 均拒绝删除。
- Shared Cell 模板固定为 render-only，TTL Schedule 先于收费资源，Cell Janitor 与 Operator 权限边界保持独立且尚未部署。
- B5 Bootstrap 本身不含 VPC、ALB、ECS、Aurora、NAT、VPC Endpoint 或 Route 53 Hosted Zone；Operator 不能直接 `CreateStack`/`UpdateStack`，只能操作固定 Cell Stack 的 Change Set。
- B5 Operator 强制 MFA 和精确 session name；Cell、Janitor 和 Scheduler 角色彼此分离，Cell Janitor 有独立的 15 分钟扫描兜底。
- ECR、CodeBuild、源码 Bucket、Scheduler 和角色权限边界没有漂移。

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

## B5 Cell Bootstrap（仍不创建 Shared Cell）

默认命令只渲染并检查本地文件，不需要 AWS CLI，也不会调用 AWS：

```powershell
.\ops\aws-sandbox\scripts\s3-b5-cell-bootstrap.ps1
```

`OnlineValidate` 只读取 STS 身份并调用 CloudFormation `ValidateTemplate`。`CreateChangeSet` 与 `ExecuteChangeSet` 参数形状已预留，但当前由脚本内的固定门禁在任何 AWS API 调用前硬拒绝，不能通过确认字符串或环境变量打开。其 IAM lifecycle scope、MFA 执行身份、规范化模板/参数/tag digest 绑定、精确 3 小时 TTL，以及 Stack 外资源 cleanup 完成评审后，才可在后续独立变更中打开。

即使将来部署这个 Bootstrap，它也会创建 Lambda、Logs 和 Scheduler 等 AWS 运行资源，可能产生少量费用；它只是不创建 VPC、ALB、ECS 或 Aurora 等付费 Cell 资源。DNS、ACM、ACTIVE Trust Store、完整租户 database/role/Secret 清理协调器和真实 TTL 删除演练仍是独立阻断项，`applyRuntimeReady` 必须继续为 `false`。

此前已确认 IAM User 绑定 MFA，并成功建立受限 Provisioner AssumeRole 会话；Provisioner Role 的信任策略仍会拒绝无 MFA 会话。本模板不修改现有 IAM User 或 Administrators 组，SaaS Worker Apply 继续保持关闭。

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
```

上传对象键为 `source/speedfeast-<40位Git提交>.zip`，镜像标签为不可覆盖的 `git-<40位Git提交>`。CodeBuild Project 没有 Webhook、定时触发、VPC/NAT 或默认可工作的 Source；只有显式调用 `StartBuild` 才会产生构建费用。

脚本在上传源码前先查询该 Git 标签。若 ECR 已存在 `git-<commit>`，脚本返回现有 Digest，并跳过 S3 上传和 CodeBuild，从而避免不可变标签冲突和重复构建费用。

`StartBuild` 返回只表示构建已排队。必须继续确认 CodeBuild 为 `SUCCEEDED`、不可变标签解析到固定 Digest，并使用受限 Provisioner Role 读取 ECR scan findings。扫描未完成或存在尚未评审的高危/严重发现时，不得把镜像写入部署环境绑定或启动租户 Apply。

镜像推送前，Buildspec 还会在本地构建容器上验证最终身份为 `65532:65532`、Node 版本精确为 `24.18.0`，并实际加载 `bcrypt` 与 `pg`。任一 smoke test 失败都会阻止 push；这可以在无 shell 的 distroless 运行时进入 ECR 前发现 Node ABI 或原生依赖不兼容。

## 此前核验的云端状态与后续门禁

以下条目来自 S3-A 阶段的历史在线核验；本次 S3-B 离线收口没有重新查询 AWS。

1. AWS CLI v2 已位于 `D:\Amazon\AWSCLIV2\aws.exe`；当前终端 PATH 尚未刷新，可以先使用绝对路径。
2. 已确认 `techlong-sandbox-dev` 绑定 MFA，并配置不含密钥的 `techlong-sandbox-provisioner` AssumeRole Profile。首次角色会话需要操作者在本地终端输入 MFA 一次性验证码；后续还应移除 IAM User 继承的长期 AdministratorAccess，只保留受控 AssumeRole 能力。
3. 账号原有的 `My Zero-Spend Budget`（`1 USD`）未被修改；S3-A 已另行创建按 `Environment=aws-sandbox` 过滤的 `10 USD` Budget。两者都只是有延迟的告警，不能作为实时硬停机制。
4. 已只读确认该账号当前未使用 AWS Organizations。不要为了本 Sandbox 主动加入 Organizations；当前 Deny 示例应作为 IAM 策略评审起点，不能假设 SCP 可用。
5. Budget 通知邮箱已作为 CloudFormation 参数提供，个人邮箱没有硬编码进模板或仓库。
6. S3-A 已由独立的 CloudFormation Execution Role 和 Permissions Boundary 部署；Boundary 本身不授予权限。
7. Janitor 已在真实 AWS 中验证空扫描、伪造共享 Cell 拒绝路径和到期临时租户 Stack 删除路径；测试资源已完全清除。
8. 第二次受控 CodeBuild 已从后端提交 `e3f4e1722686cdc9de4e46115332afaf6da7678d` 生成 Distroless 镜像 `sha256:7063a9ab2765f8fb565a581c810047b8fc2a4119fe5d288a685bd6c87b3eae78`；构建与 smoke test 全部成功，ECR 扫描 `COMPLETE` 且没有发现漏洞。第一张含 Perl 的镜像因 `3 Critical / 5 High / 6 Medium` 被明确拒绝。
9. 合格镜像尚未写入 execution binding，Worker 和 Apply 仍关闭；镜像构建后再次确认没有活动的 tenant/Cell Stack。创建收费 Stack 前必须先建立一次性清理计划，创建失败时部署必须中止。

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

`cell-janitor.cjs` 和原有 `cell-operator-permissions-boundary.example.json` 仍是离线审查来源；B5 独立 Bootstrap 已把更严格的精确单 Cell 权限、Janitor 和全局扫描计划组装为可生成 Change Set 的模板，但本次没有部署。Cell Janitor 代码仍不能清理 CloudFormation Stack 外的租户 database、role 或 Secret；没有完整、有围栏的 cleanup coordinator 与真实 TTL 演练时，禁止 Cell Apply。

回退默认只显示计划。真实回退会先拒绝仍有租户 Stack 的环境，然后验证专用源码 Bucket 的三项安全标签、清空该 Bucket，并删除 Bootstrap；这也会清空并删除 Sandbox ECR 镜像。Budget 只有额外传入 `-DeleteBudgetGuardrail` 和准确 Stack 名时才删除。

## DNS 边界

建议只把 `sandbox.techlong.cloud` 子域委派给 Route 53，生产租户使用另一个域名边界。Sandbox 租户入口使用 `{tenant}.sandbox.techlong.cloud`。控制接口仍使用相同实例域名下受 JWT、scope 和未来 mTLS 保护的 `/api/saas/*`，不新增公开控制域名。

## 策略示例的重要限制

- `provisioner-permissions-boundary.example.json` 是最大权限边界，不是授予权限的 Identity Policy。
- Provisioner 只被允许管理 `techlong-sandbox-tenant-*` CloudFormation Stack，并只可 Pass 指定的 Sandbox Execution Role；共享 Cell 和 Bootstrap 不在租户 Worker 权限内。
- B5 Cell Operator 只能为精确的 `techlong-sandbox-cell-sandbox-1` 创建、读取和执行 Change Set；不能直接调用 `CreateStack` 或 `UpdateStack`。Cell Bootstrap 自身仍由现有 IAM User 通过独立双阶段脚本创建，因此移除该用户的长期 AdministratorAccess 仍是付费 Cell 前置条件。
- B5 Cell Execution Boundary 既有明确 Allow 清单，也显式 Deny NAT、VPC Endpoint、EC2、RDS Proxy、Global Database、快照恢复和预留购买；但 IAM 条件键与 CloudFormation 实际调用必须在未来 OnlineValidate/IAM simulation 中再次核对，离线检查不构成 AWS 授权证明。
- `sandbox-expensive-actions-deny.example.json` 是 Deny-only 示例。当前账号未使用 AWS Organizations，因此只能把它作为 IAM Policy 评审起点，不能假设 SCP 已生效。
- 策略中的 Account、Region 和角色名称属于非敏感固定标识，但上线前仍必须与实际账号状态核对。

这些脚本没有后台自动执行入口。任何真实 AWS 写操作都需要人工显式选择模式、核对账号，并满足相应确认参数；SaaS Worker 的租户 Apply 仍保持关闭。
