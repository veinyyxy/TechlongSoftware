# AWS Sandbox B5 实施边界

B5 的目标是把 S3-B 的离线模型推进到可安全接入真实 AWS Adapter 的状态，而不是直接创建收费资源。平台、租户运行时和 Shared Cell 必须分别通过安全门禁；只打开一个环境变量不能启用部署。

## 本阶段切片

### B5-A：执行租约与迟到写隔离

- 每次领取部署任务都生成不可复用的 lease token；相同 Worker ID 的旧进程不能使用新租约写入。
- Repository 的 heartbeat、状态迁移、步骤完成、租户资源生命周期和 cleanup 收口同时校验 job、attempt、lease token、owner 和数据库时间下仍有效的租约。
- 长时间外部操作使用持续心跳，并由执行边界提供 `AbortSignal`。续租失败后，迟到返回值不能写入步骤、实例、部署或租户资源状态；真实 Adapter 在启用前还必须消费该 Signal，并以外部 operation epoch 阻止已经发出的旧操作提交。
- live 跨 deployment handoff 继续禁用。真实 database、role、Secret 与 workload 都能原子观测 ownership epoch 之前，不允许复用尚未销毁的资源。

### B5-B：租户运行时 Secret 边界

- 每个租户只接受自己的 Secrets Manager JSON Secret 引用，由 ECS 使用 JSON key 选择器注入数据库、HMAC、JWT 和 Sandbox Stripe 参数。
- 环境级 execution binding 只保存共享 Cell、控制公钥和非秘密运行参数，不得保存或复用租户数据库/HMAC/JWT Secret。
- ECS 健康检查必须兼容无 Shell 的 Distroless 镜像，不能使用 `CMD-SHELL`。
- 实例控制通道保持 HTTPS `8443`、mTLS、实例级 RS256 JWT 和 POST 后 GET 对账；域名必须属于 execution environment 明确允许的 base domain。

### B5-C：独立 Shared Cell Bootstrap

- 2026-08-28，B5-J4c ownership-fenced plan-only cleanup planner 已通过 PlannerUpdate 部署并完成严格回读。固定管理 Stack `techlong-s3-b5-cell-bootstrap-management` 继续与租户 Worker 权限分离，持有 Manager、CloudFormation execution、Janitor、Scheduler 四组 boundary + role，共 8 个 IAM 资源，最终权限形状恢复为 `LOCKED`。
- J4c 更新授权完整经过 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`，两个临时 grant 均在对应操作后撤销；management locked refresh 只原地修改 `CellJanitorBoundary` 与 `CellBootstrapExecutionBoundary`，没有 replacement 或额外 Role 修改。后续删除 child Bootstrap 时仍只允许使用 `RollbackGrant → Locked`。
- 固定 child Stack `techlong-s3-b5-cell-bootstrap` 已达到 `UPDATE_COMPLETE`，继续只含 LogGroup、plan-only Janitor Lambda、ScheduleGroup 和状态为 `DISABLED`、表达式为 `rate(15 minutes)` 的 Schedule，共 4 个非 IAM 资源。child 模板不拥有 IAM lifecycle；外置 CloudFormation execution role 只能 `PassRole` 给外置的最小 Janitor Role 与 Scheduler Role。
- child 仅提供 ownership-fenced、authority-bound 的 plan-only cleanup 基础，不创建、更新或删除 Shared Cell；两次显式 probe 均返回 `ABSENT_SAFE` 和一致的空 inventory，且没有执行 mutation。`registrationReady`、`liveReadbackReady`、`applyRuntimeReady`、`cleanupRuntimeReady` 全部固定为 `false`，J4c 部署完成不构成付费 Cell 批准。
- render-only Cell 模板现包含独立 `OneShotTaskSecurityGroup` 及 `OneShotTaskSecurityGroupId` 输出。该 SG 零入站，出站仅允许 TCP 443 到 `0.0.0.0/0` 和 TCP 5432 到 exact DB SG；DB SG 的 5432 入站也只接受 tenant app SG 与 one-shot SG。只读 preflight 会验证公共 task subnet、输出绑定的 one-shot SG/VPC/所有权/TTL、零入站、两条 exact 出站和 DB 的两个 exact 来源；同时通过注入式 `DescribeRouteTables`/`DescribeInternetGateways` 证明每个 app/one-shot 公共子网有 active exact association 和唯一 `0.0.0.0/0 -> attached VPC IGW`，并拒绝 DB 子网的 IPv4/IPv6 default、IGW、NAT 或 EIGW 路由。普通 app task SG 仍只接受 ALB:3000。
- NAT Gateway、VPC Endpoint、传统 EC2、RDS Proxy、Global Database、快照恢复、Reserved Purchase 和第二个 Cell 均保持拒绝。

### B5-E：外部 ownership epoch 与可恢复清理

- `0007_external_ownership_epoch_cleanup_phases.sql` 为每个租户 resource generation 增加单调 external operation epoch。Repository 只能准备 `pending_external` 记录；只有 provider 把精确 marker 安装到外部资源并重新观察、返回脱敏 proof 后，CAS 才能把 epoch 激活。
- provision 与 cleanup 使用不同的不可变 operation hash。相同意图的重试复用原 epoch；cleanup 会使未完成的 provision 意图失效并旋转到新 epoch。旧 epoch 不能再推进数据库生命周期或执行删除。
- cleanup 持久化 run 及 workload → database/role → Secret 三个 phase。每个 phase 使用稳定 operation ID、脱敏 receipt 和 append-only 事件，崩溃后跳过已经成功的阶段；最终事务同时收口资源、部署、实例、TTL 计划和容量占位。
- 现有 AWS SDK、HTTPS、控制通道、Shared Cell 和类型化 Tenant DB/Secret 边界都接收同一个必填 `AbortSignal`。Signal 用于尽快取消失租操作，但不能替代 provider 对 external marker 的安装与观察。
- CloudFormation 标签/ClientRequestToken 及 SaaS Control metadata/header/idempotency/readback 已绑定当前 active provision epoch；标签只能用于 readback，不能承担原子 compare-and-set。
- 订单服务 `POST /api/saas/provision` 已在源码实现 control API v1.2 事务单调 epoch CAS、同 epoch 精确重放和旧 epoch/漂移拒绝；其他控制写接口仍未 fence，相关 SQL 和源码也未应用数据库或部署运行。
- 默认 external ownership provider、Tenant DB/Secret/workload Adapter 和 standalone Worker root wiring 仍未配置，因此 Apply/Cleanup 保持 fail closed。

### B5-F：ECS one-shot 与 generation-bound Secret 离线边界

- 新增 `AtomicTenantExternalEpochAuthorityPort`：provider 必须以一次线性化条件写入比较 revision 和旧 record，再由已匹配记录派生并保存 predecessor；describe 后无条件写入不满足契约。默认 `DisabledAtomicTenantExternalEpochAuthority` 会在调用 provider 前拒绝，且没有内存版生产回退。CloudFormation Adapter 在这里仅作前后只读兼容性检查，不安装 epoch，也不是 authority。
- 新增不构造 AWS SDK 客户端的注入式 ECS one-shot 边界。`RunTask`、按精确 `startedBy` 恢复、`DescribeTasks` 和 `StopTask` 均要求 `AbortSignal`；失租、轮询超时或回执失败时，已知任务必须先以独立有界 Signal 停止并观察到 `STOPPED`。若 `RunTask` 可能已被 AWS 接受但响应丢失，恢复器会在独立窗口内持续按稳定 `startedBy` 查询；发现任务后停止并确认，持续不可见则返回专用“结果未知”错误并 fail closed，绝不将一次空查询当成不存在任务的证明。
- one-shot request 只允许代码内固定命令、当前 active epoch、generation、ownership marker、当前租户 Secret ARN，以及 baseline/迁移/验证阶段所需的独立批准 baseline digest。禁止传入 password、`DATABASE_URL`、连接 URL、Secret value、任意命令或 baseline S3 地址；回执使用 exact-key allowlist，并绑定 request/output/receipt hash 与当前 epoch。
- 租户运行时 Secret 的逻辑 identity 仍以 `/runtime` 结尾，实际 Secrets Manager 名称按 generation 确定为 `/runtime/gN`。ARN 必须精确匹配租户、generation、AWS account 和 region；回读证据必须证明 JSON 恰好只有 `database_url`、`hmac_secret_key`、`jwt_secret_key`、`stripe_secret_key`、`stripe_webhook_secret` 五个键以及当前 provision generation/epoch。这样 g1 Secret 进入 pending deletion 时不会阻止 g2 reopen。
- 当前只有离线 provider DTO、严格验证和 Mock 测试，没有真实 ECS/Secrets Manager SDK provider，没有 Worker root 注入，也没有批准 baseline。订单服务现有 baseline image 仍接收明文迁移环境变量，不能直接接入此 ARN-only 边界；其 ARN 原生 lifecycle helper 需后续单独实现和审查。
- Secret 和数据库删除不会错误地把 cleanup epoch 当作原资源的 provision ownership。authority record 已能保留 exact predecessor，但该证据尚未进入 lifecycle Adapter 输入，因此 B5-F 的两个 destroy 方法都会以 non-retryable 专用错误在任何 provider 调用前 fail closed；`cleanupRuntimeReady` 必须继续为 `false`。

### B5-G：真实 SDK 形状与订单服务 lifecycle 离线基础

- 平台新增可注入的 AWS SDK v3 ECS one-shot Adapter，封装 `RunTask`、`ListTasks`、`DescribeTasks` 和 `StopTask`。`EcsOneShotTaskRunner` 与 Adapter 配置显式固定 environment kind、账号、区域、集群、revision-pinned Task Definition、subnet 列表、唯一 one-shot SG 和六条代码自有命令；`aws_sandbox` 只允许 `AssignPublicIp=ENABLED`，`aws_production` 只允许 `DISABLED`，请求或配置任一漂移都会在 SDK 调用前 fail closed。未知提交只按稳定 `startedBy` 在独立有界窗口恢复，无法证明结果时同样 fail closed。
- Secrets Manager Adapter 只允许当前租户、generation、账号和区域下的 exact-five-key Secret。Secret value 由尚未实现的生产 material generator 在 provider 内生成；平台只接收 ARN、版本、标签和键集合证据，不接收明文值。
- DynamoDB authority Adapter 使用强一致读取和条件 `PutItem`，同时比较 revision 与规范化旧记录；它只是可注入实现源码，尚未创建表、IAM 或 root wiring，也没有被 standalone Worker 使用。
- 订单服务 lifecycle service 保留 `inspect`、`prepare_empty_database`、`restore_approved_baseline`、`migrate_saas`、`verify`、`destroy` 六种类型化操作契约。B5-G 时 provider 默认禁用；当前 B5-J2 production `db/tenant_lifecycle.js` 已进一步收窄为只接受 exact `inspect`，其余操作继续禁用。marker/epoch/ownership 状态机仍会拒绝旧 epoch、漂移和异主资源。
- 订单服务端另提供显式手动的 PostgreSQL 16.14 集成测试 runner：只接受 loopback admin URL，只创建随机命名的一次性数据库，并在 DROP 前二次核对 runner marker。默认 `npm test` 不会进入该目录；B5-G 没有运行真实 PostgreSQL 集成测试，也没有访问 AWS、Neon 或其他数据库。
- B5-G 结束时仍缺生产 Secrets material generator、PostgreSQL lifecycle provider、DynamoDB 表/IAM、approved baseline、任务镜像验证和 Worker root 注入。订单服务 CLI 只输出确定性的非秘密业务结果，不能自证 ECS task ARN；下一切片需要把该结果与已独立验证的 DescribeTasks 身份和 exact request 绑定，再由平台构造最终哈希回执。

### B5-H：可信 raw receipt、exact predecessor cleanup 与默认离线 root

- 平台新增可注入的 AWS SDK v3 S3 receipt reader，专门读取 account-owned、region-pinned、tenant/generation scoped 的固定 object key：`tenant-lifecycle/v1/<tenant-hash>/gN/<idempotency-hash>.json`。Reader 在 `GetObject` 前先校验 exact task/request/location 绑定，要求 `ExpectedBucketOwner`、`ChecksumMode=ENABLED`、`ServerSideEncryption=AES256`、`ChecksumType=FULL_OBJECT`、canonical UTF-8 JSON 和 full-object SHA-256，然后才把 raw envelope 与独立验证过的 ECS task ARN、exact request 组装成最终 receipt hash。任务程序本身不能写入 `taskArn`、`requestHash` 或最终 `receiptHash`。
- 订单服务端新增默认禁用的 immutable raw receipt publisher：只向 reviewed sandbox bucket 写入 canonical flat envelope `schemaVersion / operation / resourceGeneration / ownershipMarker / externalEpoch / externalMarker / externalOperationHash / output / outputHash`。首次写入使用条件 `If-None-Match: *`、`ExpectedBucketOwner`、AES256 和 SHA-256 checksum；遇到 412 或响应不确定时，只能通过重新读取同一 key 且逐字节匹配 canonical bytes 才能视为幂等成功。
- authority-derived exact provision predecessor 现已贯穿 cleanup contracts、ownership proof、Tenant DB/Secret adapter 和 workload one-shot destroy 路径。cleanup 只允许删除“当前 cleanup epoch 的 authority record 所保存的那个上一条 provision predecessor”；缺失 predecessor、跨 generation、cleanup/foreign predecessor 或任意 marker/hash 漂移，都会在 provider 调用前 non-retryable fail closed。
- 平台现有独立的 CloudFormation workload 删除 Adapter 源码，但仍未接入默认 Worker root。它只接受 Account `402010193138`、配置的 exact Region 和 `TechlongSandboxCloudFormationExecutionRole`，并在每次 Stack readback 及 `DeleteStack` 前重新确认 caller 为 exact `TechlongSandboxProvisionerRole` assumed-role session；待删 Stack 必须携带 authority-derived provision predecessor 的 generation、deployment 和 external-operation tags。SDK factory 只构造一个显式 default credential provider 并把同一实例交给 STS 与 CloudFormation；destructive provider boundary 的 caller verifier 为必填且紧邻 `DeleteStack`。成功但空、多项或缺少 StackId/StackStatus 的 `DescribeStacks` 会 hard fail，只有 `name=ValidationError` 且消息精确绑定本次 Stack name 时才能成为 authoritative `missing`。删除使用由 idempotency key、resource fence、cleanup epoch 与 predecessor 共同派生的稳定 ClientRequestToken，并以有界独立 readback 证明 Stack 严格 `missing` 后才返回成功；`DELETE_FAILED`、响应丢失后仍存在、caller 漂移或 lease abort 都 fail closed。该源码和测试不会调用 AWS，也没有改变任何 readiness gate。
- standalone Worker root 现在统一通过默认 `offline_only` composition 构造依赖：只暴露 disabled shared-cell preflight、tenant database、control compiler/client，且同时保持 `applyRuntimeReady=false`、`cleanupRuntimeReady=false`。即使仓库中已经存在 SDK adapters、receipt reader 或 cleanup path 源码，root 也不会创建 live AWS/Neon/runtime provider，更不会 claim 任何 apply/reconcile/cleanup job。
- B5-H 切片完成时尚未创建真实 S3 receipt bucket/IAM/task role；后续 B5-I support update 已部署这些低成本支撑资源，但仍没有接线 backend real Secret/PG lifecycle provider、approved baseline 或 Worker live root。`0005`–`0007` 仍未应用到 Neon。因此 B5-H 的源码边界和 fail-closed 证明仍不代表可以启用 Apply/Cleanup 或运行真实 ECS canary。

### B5-I：受控在线快速模式的低成本支撑 IaC

- 既有 `techlong-s3-bootstrap` 模板包含与 B5-H exact contract 对齐的 receipt Bucket、DynamoDB authority table 和最小 Worker access。2026-08-22 已执行 digest-bound Change Set `techlong-s3-b5-support-1fb78e3a91ede382`（raw SHA-256 `1fb78e3a91ede382702792f2521f935aa690670ead7e05dc89a57cec0d0b0145`，canonical SHA-256 `15d68976bf94a94f0be0d205194782e4700a89aa51a846457b38b8e2c8988b62`），Bootstrap 最终为 `UPDATE_COMPLETE`；没有创建 Cell 或 tenant Stack。
- receipt Bucket 固定为 `techlong-sandbox-402010193138-ca-central-1-tenant-receipts`，只允许 `tenant-lifecycle/v1/`，使用 Bucket owner enforced、完全 Public Access Block、SSE-S3，并在 Bucket Policy 与专用 `TechlongSandboxTenantLifecycleTaskRole` 两层强制 `If-None-Match: *`。公网 tenant web service 使用的普通 `TechlongSandboxTaskRole` 已完全移除 S3 identity policy；它不能读写 receipt，也不读取 generation Secret。LifecycleTaskRole 只可读取/conditional-write exact receipt，并仅在 `ManagedBy`/`SecretSchema` 标签匹配时读取 generation-bound runtime Secret。
- authority table 固定为 `techlong-sandbox-tenant-external-epoch-authority`，只有 `authority_key` 分区键，使用 `PAY_PER_REQUEST`，best-effort 限制为 `5 RRU/s`、`2 WRU/s`，不启用 PITR、Stream、索引、预热容量或收费 KMS key。`TechlongSandboxDeploymentWorkerRole` 只允许读取 exact receipt prefix、以 `tenant:*` leading key 对 exact table 执行 `GetItem/PutItem`、在 exact `cell-sandbox-1` 上运行 revision-pinned `task-definition/tenant-lifecycle:*` 并恢复/观察/停止自身标记的任务、Pass exact TaskExecutionRole/LifecycleTaskRole，以及管理 generation-bound `techlong/sandbox/tenant/*/runtime/g*` Secret。Worker ECS 的三个 `Resource: *` statement 精确限于：按 region/cluster 收紧的 `ListTasks`、只在 `ecs:CreateAction=RunTask` 与六个 exact request tag key 下生效的 tag-on-create，以及按 exact region 收紧的只读 `DescribeTaskDefinition`；Secret 创建禁止自定义 KMS/replica，删除禁止强制立即删除且只允许 7–30 天恢复窗。该 Role 没有 CloudFormation、ALB、RDS 或 Cell 管理写权限。
- `s3-b5-support-bootstrap.ps1` 默认只做 `LocalValidate`。真实更新只能由固定 source user 对既有 Bootstrap 创建 Change Set、单独 Inspect、再用另一条命令 Execute。所有在线模式都要求 profile 的 `login_session` 精确指向 source user、credential source 精确为 AWS CLI `login`、环境中没有 AWS 静态凭据，并在线确认该用户只绑定 exact MFA device；`AcknowledgeMfaSession` 只是补充人审，不是唯一门禁。Inspect 与 Execute 都通过 Change Set `GetTemplate` 的 `Original` TemplateBody 与本地渲染模板做 canonical exact match，再拒绝账号、区域、Stack、参数、资源集合、replacement 或摘要漂移。这个一次性 Bootstrap 例外解决“Provisioner 不能更新自己的 boundary”的初始权限闭环，运行态仍只允许 MFA Provisioner 以固定 session name Assume 最小 WorkerRole。Provisioner 另仅获得 `ca-central-1` 的 ECS/ELBv2/EC2/RDS Describe 动作，用于 Shared Cell 只读证据；没有新增这些服务的写权限，scoped rollback 会一并撤销这组读取能力。
- 首次 support Change Set 已把部署中的 Janitor 升级到仓库当前的 generation/AppInstance/Cell ownership 围栏实现；`JanitorFunction` 以及动态引用其 ARN 的 `SchedulerInvokeRole`、`GlobalJanitorSchedule` 均完成无替换修改。scoped rollback 使用另一个可审查的 UPDATE Change Set，删除 receipt Bucket/Policy、authority table、LifecycleTaskRole 和 WorkerRole，并从 `ServiceRoleBoundary`/`ProvisionerBoundary` 撤销 B5 support/Assume/Shared Cell 只读能力；执行前必须明确接受永久删除全部 receipt 与 authority record，并先清空 exact receipt prefix。它保留普通 TaskRole 的 S3 通配权限移除与 Janitor 围栏升级，也不会删除 ECR、CodeBuild、普通 TaskRole、Provisioner、Budget、Cell 或 tenant Stack。
- 该 IaC 只消耗少量 S3 Standard storage/request 与 DynamoDB on-demand request 费用，IAM Role 本身不计费；费用不能保证绝对为零，`$10` Budget 仍只是延迟告警。`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 和默认 `offline_only` root 均未改变；后续 B5-J4b 已于 2026-08-26 部署 cleanup/read-only Bootstrap，但同样没有打开这些 gate。
- Sandbox one-shot 使用公网 IP 是在无 NAT Gateway/VPC Endpoint 条件下的低成本出站权衡，不代表开放任何入站；production 继续固定私网 `AssignPublicIp=DISABLED`。本轮只调用 AWS 完成并验证 support update，没有接线 Worker root、没有打开 gate，也没有创建 Cell；Cell 仍是 `renderOnly=true`、`applyReady=false`。

### 单租户 canary：临时本地图片边界

- 当前订单服务真实 S3 图片路径只有 `PutObject`/失败补偿 `DeleteObject`，历史 key 为共享 `products/<year>/<month>/<uuid>`；租户栈又复用了同一个普通 TaskRole。给该共享 Role 恢复 S3 权限会形成跨租户/跨 generation 删除或覆盖能力，因此明确禁止。
- 为先验证一个短 TTL Sandbox 租户而不扩大长期 IAM，租户模板暂时固定 `APP_RUNTIME_MODE=aws_sandbox_ephemeral_canary`、`ALLOW_EPHEMERAL_IMAGE_STORAGE=true` 和 `IMAGE_STORAGE_PROVIDER=local`。订单服务在 `NODE_ENV=production` 下要求前两个值逐字精确匹配才接受 `local`；缺一、大小写漂移或其他 runtime mode 都会在监听端口前 fail closed。默认 production 继续要求 S3。
- Distroless 镜像中的 `/app/images` 由 nonroot `65532:65532` 拥有，应用也只通过现有 `/images` 路径提供这些文件。但目录属于单个 Fargate task，不是持久卷：task 重启、替换、部署或 Stack 清理都会永久删除上传内容，数据库中的 media URL 可能因此失效。canary 禁止上传任何真实客户素材，不验证图片持久性，也不能作为 production-ready 证据；模板安全元数据固定 `sandboxEphemeralImageStorage=true`、`persistentImageStorageReady=false`。
- 正式持久资产需要单独的 IAM 架构切片：account/region 固定的私有 assets Bucket；`tenant-assets/v1/<stable-identity-hash>/gN/` exact prefix；每租户、每 generation 独立 ECS TaskRole；只含该 prefix `PutObject`/`DeleteObject` 的 inline policy；独立 permissions boundary；以及 CloudFront OAC 或等价的私有读取路径。它需要给 tenant CloudFormation service role 增加受 boundary 约束的 IAM role lifecycle，并启用 `CAPABILITY_NAMED_IAM`，必须另行审查、模拟和批准，不能借本次 canary 偷渡。

### B5-J1：单 revision lifecycle TaskDefinition 离线 binding

- `tenant-lifecycle-task-binding.ts` 只接受 Sandbox 固定账号/区域、预期 `cell-sandbox-1` cluster、`tenant-lifecycle:<revision>` ARN、当前私有 ECR 仓库的 `@sha256` 镜像、预期 TaskExecutionRole/LifecycleTaskRole、receipt Bucket、两个候选 subnet id 和一个候选 one-shot SG id。tag-only 镜像、无 revision ARN、错误 family/role、非法候选网络格式或额外字段均 fail closed；通过这些离线校验不代表 subnet 已被证明为公共 Cell subnet，也不代表 SG 已通过 Shared Cell 证据验证。
- ECS Runner 与 AWS SDK Adapter 已从 operation → 多 ARN 收敛为一个 exact revision ARN；六个 lifecycle operation 分别映射到代码内固定的 `/usr/local/bin/node db/tenant_lifecycle.js <operation>`。Runner 在任何异步边界前捕获原始 operation，并把它作为独立 `expectedOperation` 传入 RunTask/DescribeTask 校验；请求中的 operation 与 argv 必须同时匹配该独立值，不能通过同步篡改两者来触发其他数据库操作。
- compiler 只生成深度冻结、尚未验证的 intent：image、TaskDefinition、cluster ARN、receipt Bucket、六条代码自有命令，以及带 `candidateSubnetIds`、`candidateOneShotSecurityGroupId`、`sharedCellEvidenceReady=false` 的 `networkIntent`。它不输出 Runner/API 运行时配置，并固定 `registrationReady=false`、`liveReadbackReady=false`。默认 Worker root 增加 `tenant_lifecycle_task_definition_live_readback_missing` blocker；未来 live readback verifier 必须同时核对独立 `DescribeTaskDefinition` 回读与 Shared Cell 网络证据，之后才可产出运行时配置。本切片没有注册 TaskDefinition、没有调用 AWS，也没有改变任何 runtime gate。

### B5-J2：Shared Cell lifecycle 管理目标绑定

- Shared Cell database observation 现在要求同一 `DescribeDBClusters` 结果提供 `DBClusterIdentifier=techlong-sandbox-cell-sandbox-1`、exact Aurora writer endpoint、RDS-managed `MasterUserSecret.SecretArn`、`MasterUserSecret.SecretStatus=active`、`MasterUsername=cell_admin` 与 `DatabaseName=cell_admin`。这些引用必须与 `cell-sandbox-1` ECS cluster、Sandbox account/region、Aurora cluster ARN/identifier及完整网络/所有权/TTL preflight 一起通过校验。原有 `verify()` 返回形状保持不变；新增的 lifecycle evidence read 只在完整校验后返回深冻结、reference-only projection，并继续透传调用方的 `AbortSignal`。
- 只有同一次完整 collect → preflight → resource-hash 流程产出的 evidence 才会进入模块私有 `WeakSet`，并可被 management-target compiler 消费；复制对象、结构相同的伪造对象或跳过 preflight 的 evidence 都会 fail closed。资源哈希排除 `observedAt`、`callerArn` 等瞬态观察值，并对数组和对象键做稳定 canonicalization，使相同资源状态不会因观察顺序或调用身份改变哈希。
- `tenant-lifecycle-management-target.ts` 把具有可信 runtime provenance 的 Shared Cell projection、B5-J1 offline intent 与当前 generation 的 `TenantResourceFence` 逐项对账。evidence 与被标记 target 的有效窗口固定为 5 分钟；compiler/projection 都拒绝未来时间、过期证据或时钟回退。tenant database/role 必须分别符合 `tenant_<stem>_db`、`tenant_<stem>_role` 且 stem 完全相同。compiler 输出固定的 schema/readiness 与 reference-only target；只有被 compiler 标记的 target 才能投影成 backend 使用的 canonical 11-key management target。输出禁止 Secret value、password、`DATABASE_URL`、额外字段或 Runner/API config，cluster、候选公共 subnet、one-shot SG、management reference、tenant database/role 任一漂移都会 fail closed。
- 订单服务当前本地源码已有两个彼此隔离的 production mode：`inspect` 使用只读 PostgreSQL session；cleanup-only `destroy` 使用 exact predecessor、registry identity、session advisory lock、database → role 删除顺序、tombstone 恢复和 immutable receipt。Secret material 只在 provider callback 内存在，不进入日志、management target 或业务返回。`prepare_empty_database`、`restore_approved_baseline`、`migrate_saas`、`verify` 仍未启用。
- 最小 `ecs:DescribeTaskDefinition` 与 exact RDS-managed Secret read 权限已通过 `LifecycleReadback` Change Set `techlong-s3-b5-support-lifecycle-readback-60d854ad2664718e` 部署：raw/canonical SHA-256 分别为 `60d854ad2664718eed88ec4731ff3a70cb84b34ba9dcaf439782dcba7a816113` / `1fe4af4b94a198437511a147fe05685eefb768304e3ab487ca06722657c2223b`，只修改 `ServiceRoleBoundary`、`ProvisionerBoundary`、`TenantLifecycleTaskRole`、`DeploymentWorkerRole`，全部无 replacement，Bootstrap 最终为 `UPDATE_COMPLETE`。destroy-capable Build #7 已构建、零发现扫描并存档，且已注册、严格回读为 inspect-default `tenant-lifecycle:2`；没有执行 `RunTask`。四个 readiness gate 全部保持不变。

### B5-J3：受控注册与 fail-closed 撤权

- 单资源 Stack `techlong-sandbox-tenant-b5j3`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j3/5e145df0-a4f2-11f1-b674-0e76530b9cdf`）已以固定 CloudFormation execution role 注册 `tenant-lifecycle:2`；旧 revision 1 已为 `INACTIVE`。原始模板 raw/canonical SHA-256 为 `68af0afca7b18827ab50fe493137b299a884b701773b025546d1ecdf2e14af11` / `127b4bf5cf634c84737df5fd7cba2eac94424a42e7974166b607036b42df1962`；TaskDefinition properties canonical SHA-256 为 `f580ece0458b701091802dc3ca2789dccc2e5d85732c5932d65400eb87453850`。唯一容器固定 Build #7 digest、默认 `inspect` argv、Fargate `256/512`、Linux/X86_64、nonroot `65532:65532`、只读 root filesystem、drop ALL、零端口/卷/sidecar/Secret。
- 严格 readback 逐项核对 StackId、`CREATE_COMPLETE`、唯一 CloudFormation physical resource、`GetTemplate(Original)`、revision-pinned ARN、`registeredBy`、roles、image、command、hardening 和六个业务标签，canonical evidence SHA-256 为 `f3b8fb0d9eeb2386658f49e51fe4687da8a7e345c443934a98171f7e512b51cb`。ECS 不为该资源类型返回 CloudFormation system tags，因此 ownership 绑定来自 StackId + 单资源 inventory + exact original template，而不是伪造 system tag。
- 注册 Stack 没有 `CellId`/`ResourceGeneration`，不会被 tenant Janitor 自动删除；`ExpiresAt` 只约束受审创建窗口和 ownership tag，不是自动 TTL 承诺。放弃该 revision 时必须走脚本的 exact `DeleteStack`/deregistration gate。
- 注册窗口的 deterministic grant Change Set `techlong-s3-b5-support-lifecycle-task-registration-grant-a24567a02879a2be`（ID UUID `f4ae26bb-b5c6-4537-8b82-10a1414479fc`；raw/canonical SHA-256 `a24567a02879a2be3194d6be00db8bb8627beded207553a79c245f851518bc22` / `a61c6c3f7b870199d4020a732c613c7c43ca72d84e3a1eec58d3194b8e6d67b8`）只修改 `ExecutionRoleBoundary`、无 replacement，并将 boundary 临时推进到 `v6` 的三个 exact PassRole。注册后，revoke Change Set `techlong-s3-b5-support-lifecycle-task-registration-revoke-68a34349f703dd52`（ID UUID `f703d78e-f368-41f5-8d08-45dea15c8310`；raw/canonical SHA-256 `68a34349f703dd5269058a2447bd3d7b4bcc1453225c00b8aca1f8cd8a51bf69` / `211e46d35a957aff766b2240284012500d5afee14cd1c4c55c9c9be3a0dcc2ee`）立即移除 exact LifecycleTaskRole PassRole。最终 boundary 默认版本 `v7` 为 `LOCKED`，只保留 TaskExecutionRole/普通 TaskRole 两个 baseline PassRole。
- 本阶段不创建日志组；metadata 明确 `LogGroupReady=false`。精确 `cell-sandbox-1` cluster 回读为 `MISSING`，所以没有可运行目标，也没有执行 `RunTask`。`registrationReady=false` 表示 runtime registration contract 尚未可供 Worker 使用；`liveReadbackReady=false` 仍等待真实 Shared Cell/network/Secret evidence。`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 同样保持不变。

### B5-J4a：独立 lifecycle LogGroup 支撑

- 新增的独立模板把初始 Stack 名固定为 `techlong-sandbox-tenant-b5j4logs`，且只包含一个 `AWS::Logs::LogGroup`：`/saas/cell-sandbox-1/tenant-lifecycle`。日志组固定为 `STANDARD`、`RetentionInDays=1`，不配置 KMS key，不创建 log stream、subscription filter、metric filter、ECS 计算或 Shared Cell。B5-J3 TaskDefinition Stack/模板不修改，其 `LogGroupReady=false` 仍是现状而不是可手工翻转的开关。
- 操作契约为受限 Provisioner 通过 exact `TechlongSandboxCloudFormationExecutionRole` 创建单资源 Stack；CloudWatch Logs 直接只读回读使用现有 source user 的 AWS CLI `login_session` profile，不为 Provisioner/Worker 扩展 Logs IAM。创建前、精确回读和安全删除路径都要求 `cell-sandbox-1` 为 `MISSING`；回读还要求零 stream、零 stored bytes、零 metric filter 和 exact 标签。任何路径都不得调用 `RunTask`。
- 该 Stack 故意不使用 `CellId`/`ResourceGeneration`，所以 `ExpiresAt` 只是创建窗口与 ownership tag，不会让现有 Janitor 自动删除它。废弃支撑 Stack 时必须走显式、无日志流/无存储数据的安全删除路径。
- 2026-08-25 已创建并两次严格回读 Stack `techlong-sandbox-tenant-b5j4logs`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j4logs/8fcccc70-a0be-11f1-ac7e-06f748bb68bd`，`ExpiresAt=2026-08-25T21:51:44Z`）。模板 raw/canonical SHA-256 为 `65c00d1c139991627a6f1801cc4887de53352b6e884064850df339cd6da0455c` / `4999c5fd89edd2aa9476cafc2a802871198b88bbdf103305dd442713281a90c2`，live evidence canonical SHA-256 为 `c2270d6344b1b93e80af9c41c47cfbfcec5ac45c14b5b93692aeb98f4f3086c6`。readback 确认唯一日志组为空、账号级 subscription policy 为空且 `cell-sandbox-1=MISSING`。后续 B5-J4b cleanup/read-only Bootstrap 已于 2026-08-26 完成部署与双次空 inventory probe；`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 全部保持不变。

### B5-J4b：独立 IAM 管理根与 cleanup-only Bootstrap

- 2026-08-26 已部署管理 Stack `techlong-s3-b5-cell-bootstrap-management`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap-management/e1bacdf0-a0ca-11f1-a27e-0e9a646108cf`）。严格回读确认它只管理 Manager、CloudFormation execution、Janitor、Scheduler 四组 boundary + role，共 8 个 IAM 资源，最终为 `LOCKED`；部署模板 raw/canonical SHA-256 分别为 `15ec52203f390d29858fb77e032c4d6bff83d5c3678397bf133bf60e6ab9d553` / `5d09bbc9010de13dfdba09b71c13c58711a9238cb09cd78eb767f509b29c07a1`。
- 实际授权序列完整经过 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`，每个短时授权窗口后立即 revoke。child template 以 raw SHA-256 内容寻址上传到 `https://techlong-sandbox-build-source-402010193138-ca-central-1.s3.ca-central-1.amazonaws.com/b5-cell-bootstrap/templates/sha256/8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f.json`；该 key 位于 Provisioner 可写 `source/*` 之外。AuthorGrant 只允许该 exact object 的 `s3:GetObject`，并锁定 exact `TemplateUrl`、`RoleARN`、Change Set 和 4 种 `ResourceTypes`；ExecuteGrant 前已精确预检 child Change Set 与 `GetTemplate(Original)`。后续删除 child 仍只能在安全围栏下使用 `RollbackGrant → Locked`。
- 成功执行的 child Change Set 为 `techlong-s3-b5-cell-bootstrap-8eeef35a7936cdd1`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-8eeef35a7936cdd1/ae46c8c2-5445-4590-b23d-cbfa36aa8489`）。child 模板 raw/canonical SHA-256 分别为 `8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f` / `2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389`。
- child Stack `techlong-s3-b5-cell-bootstrap`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/2477b820-a174-11f1-aca9-0668f7a50fdf`）为 `CREATE_COMPLETE`，且只拥有 4 个非 IAM 资源：LogGroup、只读 inventory Lambda、ScheduleGroup 和 `DISABLED` 的 `rate(15 minutes)` Schedule。CloudFormation execution role 属于管理根，child 不管理 IAM；Scheduler role trust 精确绑定 `aws:SourceAccount=402010193138` 与 `aws:SourceArn=arn:aws:scheduler:ca-central-1:402010193138:schedule-group/techlong-sandbox-cell`。Lambda 没有 reserved concurrency。
- child strict readback evidence canonical SHA-256 为 `b6e8083c3c04de9daccecfe3ca1e0c242ae2b27131f0c683ec2097f795ae97cc`。随后两次显式 probe 均返回一致的空 inventory；probe evidence SHA-256 为 `d77199f776408f75d722176805ba09853caee51ee4639b87d879b013d4a967ca`，两次调用均为 read-only，未执行删除或其他 mutation。
- 已部署的是只读 inventory Janitor 基础，不是可变更或完整删除协调器。本切片没有创建 Shared Cell、VPC、ALB、ECS cluster/service 或运行中的 task、Aurora/RDS、Route 53 资源，也没有执行 `RunTask`；J4b 当时既有 inspect-only revision 1 未变，后续已由 Build #7 的 inspect-default `tenant-lifecycle:2` 取代，revision 1 现为 `INACTIVE`。Lambda、Scheduler 及 S3 模板对象会产生少量请求、日志或存储用量，低成本不等于绝对零费用；`$10` Budget 也不是实时硬停。
- 四个付费就绪门禁仍精确为 `registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false`。任何 Cell 创建、数据库访问、可变更/完整删除协调器接线或 ECS `RunTask` 仍需后续独立批准。

### B5-J4c：ownership-fenced plan-only cleanup planner（2026-08-28 已部署）

- J4c 已把 J4b inventory Lambda 原地更新为只读、authority-bound 的 cleanup planner，并继续保持 Schedule `DISABLED`、无任何 CloudFormation mutating command。management 的 locked refresh 只修改 `CellJanitorBoundary` 与 `CellBootstrapExecutionBoundary` 两个 `PolicyDocument`，两项均为 `Replacement=False`；没有修改 Role，也没有替换 ManagedPolicy。
- Janitor inventory 只精确排除两个 tenant-prefix 支撑 Stack：`techlong-sandbox-tenant-b5j3` 与 `techlong-sandbox-tenant-b5j4logs`。任意真实租户 Stack、相似拼写或加后缀的名称仍返回 `BLOCKED_TENANT_STACKS`；没有 Cell 且只有这两个支撑 Stack 时返回 `ABSENT_SAFE`。
- management Stack 最终恢复 exact `LOCKED`，模板 raw/canonical SHA-256 为 `93f37b585812b49f540a317bfdbdd45a374705347288a2c998c229d31231f9ec` / `1be6a039a759acbf9c8d3211981400122c549bff0be6073e3df008c51b08ae12`。
- 执行的 child PlannerUpdate Change Set 为 `techlong-s3-b5-cell-bootstrap-a14e9898ed7af636`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-a14e9898ed7af636/9b883194-0385-4b7d-ae0a-474be55225f4`）。child 模板 raw/canonical SHA-256 为 `a14e9898ed7af636dfdb7f5c509d93b317b604a591aadb4a67d0f956e7a9d986` / `74379232124d94b1d2ffb4322edaecd0bdb0534444b8961295175ecadc06c09c`。
- child Stack `techlong-s3-b5-cell-bootstrap`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/2477b820-a174-11f1-aca9-0668f7a50fdf`）完成 `UPDATE_COMPLETE` 严格回读；readback evidence canonical SHA-256 为 `bb74dbdd8000d94f5a68d5b69d5d3e982f4dbc0738af0c784b04d1819136a258`。
- 随后的双 probe 均返回 `ABSENT_SAFE` 和相同空 inventory；probe evidence canonical SHA-256 为 `ef7699c9c005eed98077f2e43ebfae8caa78069fff269b5b7db6a645875f3835`，没有请求或执行删除及其他 mutation。Schedule 保持 `DISABLED`，四个 readiness gate 全部为 `false`，且没有创建付费 Shared Cell、VPC、ALB、ECS、Aurora/RDS 或 Route 53 资源。

### B5-J5a：Shared Cell cleanup authority 本地生产契约

- 新增 SDK-free candidate compiler，把调用方提供的严格形状 Stack DTO、provision coordinate 和短时 cleanup intent 编译为 J4c 消费 schema：DynamoDB item 精确 4 字段、canonical record 精确 22 字段。它固定 account/region/Cell/Stack identity，内部从 canonical exact intent 派生 cleanup operation hash，并从去掉 `recordHash` 的 record 派生最终 hash；它不采集或认证 live Stack evidence，产物本身不构成授权。
- 与仓库内 J4c `validateAuthorityItem` 的本地跨契约测试证明候选字节可被当前消费者解析，包括真实 DynamoDB AttributeValue decode；测试没有调用已部署 Lambda，也没有访问 AWS。未过期 Cell、过期或超过一小时的 authorization、cleanup epoch 不大于 provision epoch、非法 StackId/digest/owner/revision 和额外字段都会 fail closed。
- atomic advance 协调逻辑拒绝空 snapshot，因而不能从裸 DTO bootstrap 首条 cleanup authority；它只允许已有 exact predecessor 的同 owner/generation/provision/Stack lineage 严格增加 cleanup epoch，相同 intent 精确重放不写入。注入 port 必须报告 conditional CAS，并接受独立 exact readback；CAS 冲突、伪成功、非 canonical predecessor、revision/hash/intent drift、时钟回拨或 CAS 期间过期都不能返回成功。
- J5a 只提供接口、Mock 与显式 disabled 实现；default root 不接线也不暴露该 capability。它新增 `shared_cell_provision_authority_predecessor_missing` 和 `shared_cell_cleanup_authority_writer_missing` 两个 blocker；真实 provision bootstrap、live evidence provenance、DynamoDB writer/IAM、root 接线和 provider-side CAS 演练仍不存在。`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false`；本阶段没有修改 J4c Lambda/CloudFormation/IAM/Schedule，没有调用 AWS/Neon，也没有创建或删除资源。

## 当前硬门禁

以下任一项未完成时，`applyRuntimeReady` 和 `cleanupRuntimeReady` 必须保持 `false`：

1. `0005`、`0006`、`0007` 尚未应用到 Neon。
2. 尚无独立批准的 PostgreSQL 16.14 空租户 baseline；旧业务数据 dump 禁止作为租户模板。
3. ECS one-shot、exact-five-key Secret、trusted S3 receipt reader/publisher、订单服务 inspect 与 cleanup-only destroy 源码、单 revision TaskDefinition intent 和 runtime-provenance-checked management target compiler 已存在；receipt Bucket/专用 LifecycleTaskRole 已部署。destroy-capable Build #7 已构建、零发现扫描并注册/严格 readback 为 inspect-default `tenant-lifecycle:2`，revision 1 已为 `INACTIVE`；尚未执行 `RunTask`。生产 material generator、其他数据库变更操作、approved baseline、Worker live root wiring 和真实崩溃演练仍未完成。
4. 离线 ownership coordinator、原子 authority 接口和 DynamoDB 条件写 Adapter 源码已完成，authority table/WorkerRole 已部署并完成最小只读 IAM 模拟，但尚未注入 root，也未执行真实 AWS 条件写。CloudFormation 只读回读不是 CAS，不能安装或授权 external marker。
5. Cell 外部证据尚未完整验证 ACM、精确 Trust Store、DNS、TTL Schedule 和 Stack 所有权；Route Table/attached IGW、`SecretStatus=active`、runtime provenance、稳定资源 hash 及 reference-only lifecycle management projection 的 fail-closed 校验已实现，但尚未在真实 Cell 上回读，因此还没有真实 B5-J2 target。
6. 分阶段 cleanup coordinator 与 exact provision predecessor 接线已离线实现，backend 本地源码已有 inspect 和 cleanup-only destroy provider，destroy-capable Build #7 artifact 也已构建、扫描、注册并严格回读；但 Cell Janitor/standalone Worker live destroy root wiring，以及真实 provider-side 删除演练仍未完成。
7. 尚未进行真实 Cell TTL 删除演练和费用后核对。
8. DynamoDB authority Adapter 和订单服务 `POST /api/saas/provision` 单调 epoch CAS 仅存在于未接线/未部署源码中；其他控制写接口仍未 fence，也没有完成数据库迁移、跨进程 CAS、AWS 条件写或 provider-side 删除演练。`AbortSignal` 不能撤销服务端已经接受的写入。
9. B5-J2 的 CloudFormation IAM 已经由 `LifecycleReadback` 三阶段路径执行并在线回读；B5-J3 又完成 ACTIVE `tenant-lifecycle:2` 注册、正向 `DescribeTaskDefinition` exact readback 和临时注册权限撤销，最终 boundary `v7` 为 `LOCKED`；B5-J4a 已完成独立 lifecycle LogGroup Stack 创建与两次 strict readback。仍没有 Cell、runtime config 或 `RunTask` 执行证据。
10. B5-J4c ownership-fenced plan-only child 已通过 PlannerUpdate 部署并严格回读，management 临时 grant 已撤销并恢复 exact `LOCKED`，Schedule 保持 `DISABLED`，双 probe 均返回 `ABSENT_SAFE` 且没有 mutation；但它仍不是完整 cleanup coordinator，不能据此打开任何 readiness gate。
11. B5-J5a 只补齐 Shared Cell cleanup authority candidate compiler、同 lineage atomic advance 接口和显式 disabled 实现；首条可信 provision authority/bootstrap、真实 DynamoDB writer/IAM、live root 接线及 provider-side CAS 演练仍不存在，因此 J4c 继续保持 plan-only。

## 费用与执行规则

- 源码、迁移文件、模板渲染和本地测试本身不调用 AWS，不访问 Neon，也不应用迁移；最近的在线写入是 2026-08-30 Build #7 TaskDefinition revision 2 注册及其临时 grant/revoke 闭环。该闭环只注册一个 inspect-default TaskDefinition 并把 boundary 恢复到 `v7/LOCKED`，没有创建或运行 ECS Task、Shared Cell、VPC、ALB、Aurora/RDS 或 Route 53 资源，也没有执行 `RunTask`；`0005`–`0007` 继续只是仓库文件，没有访问 Neon 或真实 PostgreSQL。
- `$10` Budget 是延迟告警，不是实时费用硬停。
- 创建 Lambda/Scheduler Bootstrap、B5 support S3/DynamoDB、ALB、Aurora 或运行 ECS/CodeBuild 都可能产生费用。B5-J4c management/child PlannerUpdate 已部署并恢复 `LOCKED`，Schedule 保持 `DISABLED`，但 Lambda、Scheduler、CloudWatch Logs 与 S3 对象仍可能产生少量费用，不能保证绝对为零；`LifecycleReadback` IAM 更新、destroy-capable Build #7 和 inspect-default `tenant-lifecycle:2` 注册/readback 也已完成。注册不授权 `RunTask`，临时 CloudFormation LifecycleTaskRole PassRole 已撤销并恢复 boundary `v7/LOCKED`；当前不运行 ECS task。任何 Cell 创建、Worker Apply 或数据库写入仍必须另行获得明确确认。
- `infra/`、`.env.local`、证书、私钥、数据库密码和 AWS 长期凭据不得进入 Git。

## 本地验证

```powershell
npm run typecheck
npm run lint
npm test
npm --prefix .\ops\aws-sandbox test
```

这些检查通过只代表代码和静态安全边界通过，不代表 AWS Cell 已经部署或可以打开 Apply。
