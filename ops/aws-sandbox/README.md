# AWS Sandbox S0 静态骨架

这个目录只保存可审查的静态配置、CloudFormation 模板和 IAM 策略示例。S0 不会创建 AWS 资源，也不包含任何 Access Key、Secret Access Key、Stripe 密钥、数据库密码或私钥。

## 固定安全边界

示例默认值如下：

- AWS Account：`402010193138`
- Region：`ca-central-1`
- 月预算：`10 USD`
- 单次部署 TTL：`7200` 秒
- 最大并发 Cell / 部署 / 租户：均为 `1`
- Sandbox 域名：`sandbox.techlong.cloud`
- 数据库：最多 1 个共享 Aurora PostgreSQL Serverless v2 Cell，租户使用独立 database
- Aurora 版本：支持自动暂停的 PostgreSQL 16.3 或更高 16.x 版本；只读核验显示 `ca-central-1` 当前提供普通版 16.8–16.14，实际创建前仍须动态确认并拒绝 `limitless`
- Aurora 容量：最小 `0 ACU`、最大 `1 ACU`，空闲 `300` 秒后自动暂停
- 云端 Apply：关闭

这些默认值不是 AWS 授权。未来执行器在每次调用 AWS 前仍必须通过 STS 核对 Account、Region、Role ARN 和短期凭据，并且必须先创建可用的到期清理任务，再创建任何收费资源。

## 目录

```text
ops/aws-sandbox/
├─ README.md
├─ package.json
├─ sandbox.example.json
├─ cloudformation/
│  └─ guardrails.template.json
├─ policies/
│  ├─ provisioner-permissions-boundary.example.json
│  └─ sandbox-expensive-actions-deny.example.json
└─ scripts/
   └─ validate.mjs
```

`guardrails.template.json` 目前只描述月度 Cost Budget 和邮件通知。它故意不创建 ECS、ALB、RDS、NAT、VPC Endpoint、Route 53 Hosted Zone、Lambda 或 EventBridge Scheduler，也不包含 Budget Action。AWS Budgets 的账单数据有延迟，不能代替 TTL Janitor。

## 本地检查

不需要 AWS CLI，也不会发起网络请求：

```powershell
node .\ops\aws-sandbox\scripts\validate.mjs
```

或：

```powershell
npm --prefix .\ops\aws-sandbox test
```

检查内容包括：

- 所有 JSON 都可以解析。
- 默认 Account、Region、预算、TTL、最大并发和域名没有漂移。
- CloudFormation 资源受 Account 与 Region 条件保护。
- Budget 排除 Credit，避免赠送额度掩盖实际消耗。
- 预算通知阈值为 10%、30%、50%、80%、100%。
- Permissions Boundary 不包含允许全部动作的语句。
- Deny 策略覆盖 NAT、VPC Endpoint、EC2、RDS Proxy、Global Database、快照恢复、预留购买、Marketplace 和客户管理 KMS Key 等高风险动作。唯一允许规划的数据库形态是受控的 Aurora PostgreSQL Serverless v2 Cell。
- 文本中没有常见 AWS、Stripe、PostgreSQL URL 或 PEM 私钥特征。

## 云端执行前仍需完成

1. AWS CLI v2 已位于 `D:\Amazon\AWSCLIV2\aws.exe`；当前终端 PATH 尚未刷新，可以先使用绝对路径。
2. 已使用 `techlong-sandbox-user` Profile 只读调用 STS，确认 Account 为 `402010193138`、IAM User ARN 为 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，Profile Region 为 `ca-central-1`。S3 前应让这个 IAM User 只负责 AssumeRole，不直接持有创建租户资源的长期权限。
3. 账号中已只读发现一个现有的 `My Zero-Spend Budget`（`1 USD`）；它未被本次修改。此处的 `10 USD` 模板尚未应用，且 Budget 告警不能作为实时硬停机制。
4. 已只读确认该账号当前未使用 AWS Organizations。不要为了本 Sandbox 主动加入 Organizations；当前 Deny 示例应作为 IAM 策略评审起点，不能假设 SCP 可用。
5. 将通知邮箱作为参数提供，不把个人邮箱硬编码进模板。
6. 人工复核策略示例，再由独立的 CloudFormation Execution Role 承担实际资源权限。Boundary 本身不授予权限。
7. 在下一阶段实现 EventBridge Scheduler + Janitor Lambda，并验证 Janitor 后，才允许打开任何云端 Apply 开关。
8. 创建收费 Stack 前先建立一次性清理计划；创建失败时部署必须中止。

后续 Cell 模板只允许 `aurora-postgresql-serverless-v2`，最多一个共享 Cell，使用支持自动暂停的 PostgreSQL 16.3 或更高 16.x 版本，`minAcu=0`、`maxAcu=1`、`secondsUntilAutoPause=300`，禁止每租户独立 Cluster、额外 Reader、传统 Multi-AZ 实例、DB Proxy、Global Database、预留购买和快照恢复。Aurora Cluster 本身不能被策略绝对禁止，否则生产兼容的 Sandbox Cell 无法创建；具体 Engine、容量和数量要由受控 CloudFormation 模板、Execution Role 与部署前静态检查共同锁定。

## TTL / Janitor 契约

下一阶段的 Janitor 应每 15 分钟扫描一次，并额外为每个部署创建一次性到期任务。所有可变资源必须带有：

```text
Environment=aws-sandbox
ManagedBy=techlong-provisioner
DeploymentId=<stable id>
AppInstanceId=<stable id>
ExpiresAt=<UTC timestamp>
```

清理顺序建议为：ECS Service/Task → ALB Listener/Target Group/ALB → RDS（Sandbox 不保留最终快照）→ Secret → ENI/公共 IPv4/EIP → Log Group → DNS 临时记录。清理需要幂等；一个资源失败不能阻止后续资源继续清理。

## DNS 边界

建议只把 `sandbox.techlong.cloud` 子域委派给 Route 53，生产租户使用另一个域名边界。Sandbox 租户入口使用 `{tenant}.sandbox.techlong.cloud`。控制接口仍使用相同实例域名下受 JWT、scope 和未来 mTLS 保护的 `/api/saas/*`，不新增公开控制域名。

## 策略示例的重要限制

- `provisioner-permissions-boundary.example.json` 是最大权限边界，不是授予权限的 Identity Policy。
- Provisioner 只被允许管理 `techlong-sandbox-*` CloudFormation Stack，并只可 Pass 指定的 Sandbox Execution Role。
- `sandbox-expensive-actions-deny.example.json` 是 Deny-only 示例。当前账号未使用 AWS Organizations，因此只能把它作为 IAM Policy 评审起点，不能假设 SCP 已生效。
- 策略中的 Account、Region 和角色名称属于非敏感固定标识，但上线前仍必须与实际账号状态核对。

本目录没有自动部署入口。任何真实 AWS 部署应在单独阶段、人工批准并完成账号与费用检查后实现。
