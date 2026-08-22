# AWS Sandbox S3 部署执行器

## 当前状态

S3 已加入独立 Node.js Worker、STS/CloudFormation SDK 适配边界、严格参数校验、数据库租约/检查点、原子环境容量占位、两小时租户 TTL 清理计划、共享 Cell 安全预检边界和 mTLS 控制接口边界。S3-B B0–B4 进一步实现了离线可测试的类型化租户资源生命周期、不可变模板编译、RS256/mTLS 客户端、AWS 只读证据收集器、独立 Shared Cell 渲染模板和 Cell Janitor。B5 当前完成 lease-token/持续续租、租户 JSON Secret 注入、原子 external epoch authority 契约、可恢复分阶段 cleanup、ECS/S3/Secrets Manager/DynamoDB SDK 适配器源码、可信 raw receipt publisher/reader，以及独立 Cell Bootstrap 的本地渲染与 Change Set 安全入口和默认 `offline_only` Worker root composition。所有执行开关默认关闭，本版本不会因启动网站或运行普通测试而调用 AWS、Neon 或真实数据库。

以下三项已有接口和严格单元实现，但独立 Worker 仍使用 fail-closed 默认依赖，属于真实启用前阻断项：

- 租户数据库：类型化 lifecycle、approved baseline 门禁、active provision epoch 校验、脱敏 lifecycle evidence 持久化、ECS/Secret/S3 receipt SDK Adapter 源码、可信 raw receipt 边界和可恢复反向清理顺序已完成；订单服务也已有默认禁用的 ARN-native 六命令入口。receipt Bucket/authority table/最小 IAM 已通过受审 Bootstrap UPDATE 部署，当前源码镜像也已构建、固定 digest 并通过 0-findings 扫描；仍缺生产 Secret material generator、PostgreSQL provider、已批准的 PostgreSQL 16.14 baseline、revision-pinned lifecycle TaskDefinition 以及 Worker live root 注入。
- 共享 Cell 安全证明：可注入的 ECS/ELBv2/EC2/RDS/STS 只读收集器及严格校验已完成；render-only 模板已拆出零入站的 one-shot SG，只读 preflight 会核对其公共 task subnet、VPC/输出/所有权/TTL、TCP 443 公网出站、TCP 5432 到 exact DB SG 出站，以及 DB 只接受 app/one-shot 两个 SG 的 5432 入站。租户 ECS SDK 依赖已安装，但 Shared Cell 其余服务的真实 root 客户端和只读权限仍未接线。
- 控制通道：固定 8443 的 mTLS transport、实例级 RS256 JWT 和不可变模板 v2 编译器已完成；订单服务 `POST /api/saas/provision` 源码已实现 control API v1.2 事务单调 epoch CAS，但其他控制写接口未 fence，SQL/源码也未应用或部署。仍缺真实证书/私钥来源、Neon immutable source、可在重试期间保持同值并在 GET 对账后有围栏删除的 Owner Secret source，以及 Worker runtime 接线。

独立 Worker 的 `applyRuntimeReady` 当前固定为 `false`。上述任一适配器没有替换并整体评审前，Worker 不会领取 `apply`/`reconcile`，无论部署已经处于哪个恢复状态，也不能到达 CloudFormation Apply 或应用实例 `active`。这不是可以用环境变量绕过的提示。

## S3-B B0–B5 成果

- `0005_tenant_resource_lifecycle.sql` 定义 reference-only 的 `deployment_tenant_resources` 当前状态和 append-only 的 `deployment_tenant_resource_events` 审计记录。写入必须同时匹配 live job lease、当前 owner 和 generation；该迁移尚未应用到 Neon。
- 同一部署的重试可以幂等复用当前 generation。资源尚未销毁时，另一个 deployment 不能接管 owner；只有完整进入 `destroyed` 后，新的 deployment 才能以 `generation + 1` 进入 `reopening`。`0006_deployment_lease_fencing.sql` 为每次 job claim 增加不可复用的 lease token；长操作持续续租，现有外部 I/O 边界消费同一个 `AbortSignal`，Repository 写入必须匹配 attempt、token 与未过期租约，丢租后的迟到返回值不会落库。
- `0007_external_ownership_epoch_cleanup_phases.sql` 增加 provider-observed provision/cleanup epoch、append-only ownership 事件以及可恢复 cleanup run/phase。Repository 不能自证 external marker；只有注入的 provider 安装并重新观察 marker 后才能激活。cleanup 以稳定 operation ID 恢复 workload → database/role → Secret 阶段，并原子收口资源、部署、实例、TTL 计划和容量。真实 provider 与 destroy Adapter 尚未接线，因此跨 deployment live handoff 与真实 Apply/Cleanup 继续 fail closed；`0005`–`0007` 均尚未应用到 Neon。
- Tenant CloudFormation 标签和控制 API 请求/回读已携带 active epoch，但标签不等于外部原子围栏。平台新增的 authority 接口要求单次线性化 compare-and-set 并保留 predecessor；默认 authority 禁用，CloudFormation 仅作只读 readback，目前没有真实 provider。订单服务只有 `POST /api/saas/provision` 的未部署源码实现了事务单调 CAS，其他写接口仍未 fence。客户端收到 abort 也不能撤销服务端已经接受的写入。
- 每租户资源固定为独立 database + role + Secret namespace；创建、approved baseline 恢复、`migrate:saas`、验证和 workload → database/role → Secret 清理均有幂等、ownership fail-closed 契约。
- 控制请求只允许模板 Schema v2 编译出的 `instance/entitlements/default_store/first_owner`，不转发原始客户快照。JWT 只使用 2048 位以上 RSA，mTLS transport 固定 Sandbox hostname 与 8443，POST 后必须再次 GET 对账。
- 租户 Task 不再从环境 binding 读取共享 database/HMAC/JWT/Stripe Secret，而只接受与当前 resource generation 精确匹配的一条 Secrets Manager JSON Secret，并使用 ECS JSON-key 引用注入五个值。Task 健康检查使用 Distroless 可执行的 Node `CMD`，不依赖 Shell。
- B3 只读证据会验证 STS、ECS Cluster、ALB/VPC/Subnet/Security Group、443 控制路径拒绝、8443 mTLS verify + ACTIVE Trust Store，以及私有 Aurora PostgreSQL 16.14 Serverless v2。
- B4 Cell 模板只能渲染，固定 `renderOnly=true`、`applyReady=false`。模板新增独立 `OneShotTaskSecurityGroup`/输出：零入站，出站只有 TCP 443 到公网和 TCP 5432 到 exact DB SG；DB SG 的 5432 入站只接受 app task SG 与 one-shot SG，普通 app task SG 仍只收 ALB:3000。Cell TTL 为 3 小时，租户 TTL 为 2 小时，另保留至少 15 分钟 cleanup buffer；代码层使用独立前缀、权限边界与 Cell Janitor，租户 Janitor 不会删除 Cell，但 Cell Janitor 尚未部署。当前 Cell Janitor 代码只能证明按精确 `CellId` 删除 CloudFormation workload Stack 的边界，不能清理 Stack 外的 database/role/Secret；必须先接入有围栏的完整 cleanup coordinator、全局扫描兜底并演练 `DELETE_FAILED`，才允许真实 Cell Apply。
- B5 Cell Bootstrap 仍不创建收费 Cell；它只离线生成精确单 Cell的 Operator、独立 CloudFormation Execution Role、Cell Janitor 与 15 分钟兜底 Scheduler。脚本默认 `LocalValidate`，预留的 Create/Execute Change Set 写模式当前会在任何 AWS API 调用前硬拒绝；本次没有运行任何写模式。
- B5-F 先建立 SDK-free ECS one-shot 与 exact-five-key Secret Adapter 边界。注入接口覆盖 `RunTask`、精确 `startedBy` 恢复、`DescribeTasks` 和 `StopTask`；数据库任务只收到 generation-bound Secret ARN、代码固定命令、active epoch 和必要的 approved baseline digest，不接收密码、`DATABASE_URL`、连接 URL 或 Secret value。任务失租、超时或回执失败时会停止已知任务并确认 `STOPPED`；`RunTask` 不确定提交时会在独立恢复窗口持续查询，发现后停止，持续不可见则保留“结果未知”并 fail closed。实际 Secret 名使用逻辑 `/runtime` 加 `/gN`，并精确校验租户、generation、账号和区域。该阶段尚无真实 SDK/ARN lifecycle 源码；B5-G 已补入下一段所述的注入式实现基础，但 authority predecessor 仍未传入 lifecycle Adapter，database/Secret destroy 明确 fail closed，`cleanupRuntimeReady=false` 保持不变。
- B5-G 在上述接口后增加 AWS SDK v3 ECS one-shot、Secrets Manager 与 DynamoDB authority Adapter 源码。`EcsOneShotTaskRunner` 与 ECS Adapter 显式固定 environment kind、账号、区域、集群、revision-pinned Task Definition、subnet 列表、唯一 one-shot SG 和六条生命周期命令；`aws_sandbox` 只接受 `AssignPublicIp=ENABLED`，`aws_production` 只接受 `DISABLED`，任一漂移都会在 SDK 调用前 fail closed。Sandbox 公网 IP 只是无 NAT/endpoint 的低成本出站权衡，one-shot SG 仍零入站。Secret Adapter 使用 generation-stable 四标签，只暴露 ARN/版本/键集合/标签证据，同 generation 的新 epoch 不修改 Secret；DynamoDB Adapter 使用完整表 ARN、强一致读取与 revision/旧记录条件写入。订单服务端的 `db/tenant_lifecycle.js` 已统一接收 `inspect`、`prepare_empty_database`、`restore_approved_baseline`、`migrate_saas`、`verify`、`destroy`，但默认 provider 禁用。
- B5-H 继续补齐可信 raw receipt 与 exact predecessor cleanup。订单服务只允许向 reviewed sandbox bucket 的固定 key 写入 canonical flat raw envelope；平台 receipt reader 必须先独立验证 exact ECS task/request、`ExpectedBucketOwner`、AES256 和 full-object SHA-256，再把 raw result 组装为最终 receipt hash。authority record 中保存的 exact provision predecessor 也已接到 cleanup contracts、runner、database/role 和 Secret destroy 边界；任何缺失、跨代、非 provision 或漂移 predecessor 都会在 provider 调用前 fail closed。与此同时，standalone Worker root 改为默认 `offline_only` composition，不会 claim apply/reconcile/cleanup job，也不会创建 live AWS/Neon/runtime provider。
- B5-I 在既有 `techlong-s3-bootstrap` 中加入并部署低成本支撑 IaC：exact receipt Bucket 强制 SSE-S3/`If-None-Match: *` 并一天过期，公网 tenant web service 使用的普通 TaskRole 完全移除 S3 identity permission，只有专用 LifecycleTaskRole 可 conditional-write/read receipt 和读取标签匹配的 generation-bound Secret；authority table 使用 `PAY_PER_REQUEST`、`5 RRU/s`/`2 WRU/s` best-effort ceiling 且不启用 PITR/Stream/索引。最小 WorkerRole 除 receipt/authority 外，只可在 exact Cell 运行 `task-definition/tenant-lifecycle:*`、恢复/观察/停止自身标记的任务、Pass exact TaskExecutionRole/LifecycleTaskRole，以及管理 generation-bound runtime Secret；它没有 CloudFormation、ALB 或 RDS 写权限。source user 的一次 Bootstrap UPDATE 被拆成 create/inspect/execute，在线只接受 exact AWS CLI `login_session`/MFA device；Inspect 与 Execute 还会把 Change Set `GetTemplate(Original)` 与本地模板做 canonical exact match。scoped rollback 删除五个支撑资源并撤销两项既有 boundary 的 B5 能力，但保留普通 TaskRole 的通配权限移除硬化。2026-08-22 执行的 Change Set `techlong-s3-b5-support-1fb78e3a91ede382` 已完成且无资源 replacement；root 与 gate 均未打开。
- 为避免在首次单租户 canary 前扩大长期 CloudFormation/IAM 权限，tenant web 模板暂时使用三值锁定的 ephemeral local 图片模式：`APP_RUNTIME_MODE=aws_sandbox_ephemeral_canary`、`ALLOW_EPHEMERAL_IMAGE_STORAGE=true`、`IMAGE_STORAGE_PROVIDER=local`。普通 TaskRole 继续保持零 S3 identity permission，租户模板也不再接收未实现的 `ImageS3Bucket`/`ImagePublicBaseUrl` 外参。该目录只存在于单个 Fargate task：重启、替换、部署或清理会永久丢失文件并可能留下失效数据库 URL；禁止上传真实客户素材，canary 不覆盖图片持久性，且 `persistentImageStorageReady=false`。正式方案必须另行评审并部署每租户/每 generation 专用 TaskRole、exact S3 prefix、permission boundary 和私有 Bucket 的受控读取路径，绝不能恢复共享 S3 通配权限。
- 生产 material generator、backend PostgreSQL lifecycle provider、approved baseline、live root wiring 和真实租户 AWS/数据库演练仍未完成；receipt/DynamoDB/IAM 支撑 IaC 已应用，但 `0005`–`0007` 尚未应用到 Neon。因此 `applyRuntimeReady=false`、`cleanupRuntimeReady=false` 保持不变；support update 没有创建 Cell、租户 Stack，也没有访问 Neon 或真实 PostgreSQL。

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

`DEPLOYMENT_WORKER_ENABLED=false` 时不领取任何任务，也不调用 AWS。`AWS_APPLY_ENABLED=false` 或确认短语缺失时，只禁止 create/update/reconcile；它们不是删除路径的 kill switch。cleanup/rollback 只有在完整的 fenced cleanup coordinator 已注入时才会被领取；默认独立 Worker 没有该适配器，因此会保留任务并保持零 AWS 调用。未来 cleanup runtime 启用后，即使创建门禁关闭，也只允许匹配当前 generation/owner 的反向清理。要停止包括删除在内的所有 AWS 调用，必须关闭 `DEPLOYMENT_WORKER_ENABLED`。

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
- Payload 只含 schema version、动作、`stackName`、`deploymentId`、`appInstanceId` 和 `resourceGeneration`，不含凭据或客户配置。
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

## 此前核验的数据库与 AWS 状态

以下包含 S3-A 历史记录与 2026-08-22 B5-I support update 的最新核验；没有查询或修改 Neon，也没有访问真实 PostgreSQL。

- `0004_aws_sandbox_worker.sql` 已应用到当前 Neon；核验结果为
  `apply_enabled=0`、execution binding 为 0，迁移本身没有开启 AWS Apply。
- `0005_tenant_resource_lifecycle.sql`、`0006_deployment_lease_fencing.sql` 与 `0007_external_ownership_epoch_cleanup_phases.sql` 已加入仓库迁移文件，均尚未应用到 Neon。
- 没有修改数据库里的 `apply_enabled` 或创建 execution binding。
- S3-A Bootstrap 已创建受限角色/Boundary、TTL Janitor、Scheduler、不可变 ECR、私有源码 Bucket 和只能显式启动的 CodeBuild Project。
- B5-I digest-bound Change Set `techlong-s3-b5-support-1fb78e3a91ede382` 已使 `techlong-s3-bootstrap` 达到 `UPDATE_COMPLETE`：receipt Bucket、authority table、LifecycleTaskRole 和最小 WorkerRole 均为 `CREATE_COMPLETE`，Janitor ownership 围栏及其 Scheduler 引用均为无替换更新。receipt prefix 当前 `KeyCount=0`；区域上下文 IAM 模拟允许 exact Shared Cell 读动作，`CreateVpc` 与 `CreateDBCluster` 保持 `implicitDeny`。
- Janitor 已通过空扫描、伪造共享 Cell 拒绝、以及已过期临时租户 Stack 的真实删除测试；测试 Stack 和日志组均已清除。
- 后端提交 `fb9b521df1b59b849b871059572667a9b86546ab` 的 Build #3（ID `techlong-sandbox-speedfeast-image:43178c1b-d852-4069-b7b0-92bb04e5c7ec`）全阶段成功；allowlist 源码包 SHA-256 为 `c957c297d893b4071f7ee5158b2449c7fbd66b4f4be7d6167c372d4345292001`，最终镜像固定为 `sha256:0c4cb3ebfb55a944a24d548ded716d93dd00bcc4d1796c8e9eb588ce385710ae`。构建期已验证 uid/gid `65532:65532`、Node `24.18.0`、`bcrypt` 与 `pg`；ECR 扫描 `COMPLETE` 且 findings 为 0。仓库保持 `IMMUTABLE`、scan-on-push 与 AES256。
- 第一张 Node Bookworm 完整运行时镜像因 `3 Critical / 5 High / 6 Medium` 被门禁拒绝，未写入 execution binding，也未用于租户。最新零发现镜像同样尚未启用 Apply；镜像合格不代表其余 S3-B 门禁已经完成。
- Worker 与租户 Apply 仍未启动；没有创建 Cell、ALB、ECS 租户服务、Aurora/RDS、VPC、Route 53 或正式租户 Stack。
