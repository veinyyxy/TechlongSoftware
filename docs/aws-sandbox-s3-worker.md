# AWS Sandbox S3 部署执行器

## 当前状态

S3 已加入独立 Node.js Worker、STS/CloudFormation SDK 适配边界、严格参数校验、数据库租约/检查点、原子环境容量占位、两小时 TTL 清理计划、共享 Cell 安全预检边界和 mTLS 控制接口边界。所有执行开关默认关闭，本版本不会因启动网站或运行普通测试而调用 AWS。

以下三项仍使用 fail-closed 默认实现，属于 S3-B 启用前阻断项：

- 租户数据库：必须实现 Cell 内独立 database + role、恢复 SpeedFeast PostgreSQL 16.14 基线并执行 `migrate:saas`；还必须定义幂等 cleanup/drop、Secret 清理与数据保留策略。
- 共享 Cell 安全证明：必须实现 ELBv2/EC2 Describe 适配器，核对绑定账号、Region、VPC、Subnet、两个 Listener、8443 mTLS `verify` 和仅允许 ALB Security Group 访问 Task 3000 端口。
- 控制通道：必须提供私有 ALB 控制监听器的 mTLS transport、实例级非对称 JWT signer，以及基于不可变模板 Schema 和运行时 SecretStore 的 v2 配置编译器；原始客户快照不会直接发送给实例。

独立 Worker 的 `applyRuntimeReady` 当前固定为 `false`。上述任一适配器没有替换并整体评审前，Worker 不会领取 `apply`/`reconcile`，无论部署已经处于哪个恢复状态，也不能到达 CloudFormation Apply 或应用实例 `active`。这不是可以用环境变量绕过的提示。

## 执行门禁

Worker 只有同时满足以下条件，才允许进入租户数据库或 CloudFormation create/update/reconcile 路径：

1. `DEPLOYMENT_WORKER_ENABLED=true`。
2. `AWS_APPLY_ENABLED=true`。
3. `AWS_SANDBOX_EXECUTION_CONFIRMATION=I_ACKNOWLEDGE_AWS_SANDBOX_COST_AND_TTL`。
4. 运行时 Account、Region、Environment Key 和 Worker Role ARN 格式正确。
5. 数据库 `deployment_environments.apply_enabled=1`，环境为 active。
6. `deployment_environment_bindings` 为 active，Worker Role 与 CloudFormation Role 分离，全部属于预期账号。
7. 计划哈希、客户配置哈希、Workspace、Subscription、App Instance 和 ECR digest 没有漂移。
8. CloudFormation 外部参数数量和名称完全匹配，ARN、VPC、Subnet、Listener、Secret 引用、Stripe test key 和 HTTPS 域名全部通过允许名单。
9. 两小时 cleanup 记录已确认，并已经幂等写入到期 cleanup job。
10. STS 返回 Account `402010193138`、SDK Region `ca-central-1`，Caller ARN 是允许 Role 的 assumed-role ARN。
11. 原子环境容量占位成功；当前 Sandbox 的 `maxTenants=1` 由数据库唯一槽位保证并发安全。
12. Shared Cell 安全预检返回经过校验的证据哈希。
13. 在 CloudFormation 写入前重新读取环境和绑定，重新执行 persisted gate、租约、TTL、cleanup、STS 和 Shared Cell 安全预检，防止数据库迁移期间关闭的门禁被旧快照绕过。

`DEPLOYMENT_WORKER_ENABLED=false` 时不领取任何任务，也不调用 AWS。`AWS_APPLY_ENABLED=false` 或确认短语缺失时，只禁止 create/update/reconcile；这不是删除路径的 kill switch。若 Worker 本身仍启用且账号、Region、精确 Provisioner Role 与 CloudFormation Role 绑定匹配，Worker 仍会领取 `cleanup`/`rollback` 并可调用 `DeleteStack`，即使环境已 inactive、数据库 `apply_enabled=0`、订阅已结束或配置已漂移。这可确保 TTL 到期资源不会因创建门禁关闭而泄漏。要停止包括删除在内的所有 AWS 调用，必须关闭 `DEPLOYMENT_WORKER_ENABLED`。

## AWS Profile

`AWS_PROFILE` 必须是专用 assumed-role profile，例如：

```ini
[profile techlong-sandbox-provisioner]
role_arn = arn:aws:iam::402010193138:role/TechlongSandboxProvisionerRole
source_profile = techlong-sandbox-user
region = ca-central-1
mfa_serial = arn:aws:iam::402010193138:mfa/techlong-sandbox-dev
role_session_name = techlong-sandbox-provisioner
```

`techlong-sandbox-user` 只能作为 source profile。上面的 MFA ARN 是当前命名规划，实际值必须使用 IAM 配置完成后返回的 MFA device ARN。Trust Policy 同时要求 MFA 与精确 session name；直接用 IAM User 启动 Worker会因为 STS Caller ARN 不是 `assumed-role/...` 而失败。不要把 Access Key 或 Secret Key 写入仓库、数据库或 Worker 日志。

## TTL 清理

每个租户栈名固定为 `techlong-sandbox-tenant-*`，请求标签中的 `Environment` 固定为 `aws-sandbox`。租户模板先创建 `AWS::Scheduler::Schedule`：

- Group 固定 `techlong-sandbox`。
- `ActionAfterCompletion=DELETE`。
- 到期时间由部署 `created_at + 7200 秒` 计算，调用者不能覆盖。
- Payload 只含 `stackName` 和 `deploymentId`。
- 模板内除清理计划本身以外的所有租户资源都直接或通过 CloudFormation 引用关系依赖该清理计划；包括业务控制拒绝规则，不会抢先创建。

数据库还会写入到期 `cleanup` job；全局 15 分钟 Janitor 扫描由 S3 Bootstrap 提供兜底。Budget 仍只是告警，不是费用断路器。

## CloudFormation 与控制闭环

Apply 使用稳定 `ClientRequestToken`。同名栈存在时先核对 `DeploymentId`、`AppInstanceId`、`ManagedBy` 标签，再 Update；无变更视为幂等成功。Worker 不等待长连接，而是提交后创建 `reconcile` job：

```text
planned → queued → preflight
→ database_preparing → migrating
→ infrastructure_provisioning → waiting_healthy
→ configuring → verifying → ready
```

只有 CloudFormation 完成、控制端健康、`desired_configuration_hash` 与平台快照一致、镜像 digest 一致后，平台才在一个数据库事务中把 Deployment 设为 `ready`、App Instance 设为 `active` 并写入 HTTPS 入口。

## Node.js Worker

需要 Node.js 22.13 或更高版本。AWS SDK 已作为生产依赖写入根目录的
`package.json` 和 `package-lock.json`；全新检出先安装锁定依赖，再运行：

```powershell
npm ci
npm run deployment:worker
```

脚本使用 Node 22 内置 TypeScript strip，不依赖测试 loader 或 `tsx`。默认 `.env.example` 保持所有 gate 关闭。

## 本阶段明确没有执行

- `0004_aws_sandbox_worker.sql` 已应用到当前 Neon；核验结果为
  `apply_enabled=0`、execution binding 为 0，迁移本身没有开启 AWS Apply。
- 没有修改数据库里的 `apply_enabled` 或创建 execution binding。
- Worker 没有调用 STS、CloudFormation、ECS、RDS、Scheduler 或其他 AWS API。
- 没有创建、更新或删除 AWS 资源。
