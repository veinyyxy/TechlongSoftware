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

- Cell Bootstrap 与租户 Worker 权限分离，固定 Account、Region、唯一 Cell 名称和 3 小时 TTL。
- Cell Operator 的目标模型是 MFA AssumeRole；Cell CloudFormation Execution Role、Janitor Role 和 Scheduler Role 已拆分为独立权限边界，但 lifecycle scope 仍需继续收紧和在线模拟，不能称为已达到生产最小权限。
- 默认模式只做本地渲染和静态验证。`CreateChangeSet`/`ExecuteChangeSet` 接口已预留，但当前在任何 AWS API 调用前硬禁用，后续只有完成 IAM、MFA、模板 digest、TTL 与 cleanup 评审后才能单独打开。
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
- 订单服务端新增默认禁用的 `db/tenant_lifecycle.js`，统一接受 `inspect`、`prepare_empty_database`、`restore_approved_baseline`、`migrate_saas`、`verify`、`destroy` 六条命令。Secret resolver 必须提供 exact-five-key JSON，但数据库 provider 只得到缩减后的 `database_url`；marker/epoch/ownership 状态机可在响应丢失后精确重放，旧 epoch、漂移和异主资源会被拒绝。
- 订单服务端另提供显式手动的 PostgreSQL 16.14 集成测试 runner：只接受 loopback admin URL，只创建随机命名的一次性数据库，并在 DROP 前二次核对 runner marker。默认 `npm test` 不会进入该目录；B5-G 没有运行真实 PostgreSQL 集成测试，也没有访问 AWS、Neon 或其他数据库。
- B5-G 结束时仍缺生产 Secrets material generator、PostgreSQL lifecycle provider、DynamoDB 表/IAM、approved baseline、任务镜像验证和 Worker root 注入。订单服务 CLI 只输出确定性的非秘密业务结果，不能自证 ECS task ARN；下一切片需要把该结果与已独立验证的 DescribeTasks 身份和 exact request 绑定，再由平台构造最终哈希回执。

### B5-H：可信 raw receipt、exact predecessor cleanup 与默认离线 root

- 平台新增可注入的 AWS SDK v3 S3 receipt reader，专门读取 account-owned、region-pinned、tenant/generation scoped 的固定 object key：`tenant-lifecycle/v1/<tenant-hash>/gN/<idempotency-hash>.json`。Reader 在 `GetObject` 前先校验 exact task/request/location 绑定，要求 `ExpectedBucketOwner`、`ChecksumMode=ENABLED`、`ServerSideEncryption=AES256`、`ChecksumType=FULL_OBJECT`、canonical UTF-8 JSON 和 full-object SHA-256，然后才把 raw envelope 与独立验证过的 ECS task ARN、exact request 组装成最终 receipt hash。任务程序本身不能写入 `taskArn`、`requestHash` 或最终 `receiptHash`。
- 订单服务端新增默认禁用的 immutable raw receipt publisher：只向 reviewed sandbox bucket 写入 canonical flat envelope `schemaVersion / operation / resourceGeneration / ownershipMarker / externalEpoch / externalMarker / externalOperationHash / output / outputHash`。首次写入使用条件 `If-None-Match: *`、`ExpectedBucketOwner`、AES256 和 SHA-256 checksum；遇到 412 或响应不确定时，只能通过重新读取同一 key 且逐字节匹配 canonical bytes 才能视为幂等成功。
- authority-derived exact provision predecessor 现已贯穿 cleanup contracts、ownership proof、Tenant DB/Secret adapter 和 workload one-shot destroy 路径。cleanup 只允许删除“当前 cleanup epoch 的 authority record 所保存的那个上一条 provision predecessor”；缺失 predecessor、跨 generation、cleanup/foreign predecessor 或任意 marker/hash 漂移，都会在 provider 调用前 non-retryable fail closed。
- standalone Worker root 现在统一通过默认 `offline_only` composition 构造依赖：只暴露 disabled shared-cell preflight、tenant database、control compiler/client，且同时保持 `applyRuntimeReady=false`、`cleanupRuntimeReady=false`。即使仓库中已经存在 SDK adapters、receipt reader 或 cleanup path 源码，root 也不会创建 live AWS/Neon/runtime provider，更不会 claim 任何 apply/reconcile/cleanup job。
- B5-H 切片完成时尚未创建真实 S3 receipt bucket/IAM/task role；后续 B5-I support update 已部署这些低成本支撑资源，但仍没有接线 backend real Secret/PG lifecycle provider、approved baseline 或 Worker live root。`0005`–`0007` 仍未应用到 Neon。因此 B5-H 的源码边界和 fail-closed 证明仍不代表可以启用 Apply/Cleanup 或运行真实 ECS canary。

### B5-I：受控在线快速模式的低成本支撑 IaC

- 既有 `techlong-s3-bootstrap` 模板包含与 B5-H exact contract 对齐的 receipt Bucket、DynamoDB authority table 和最小 Worker access。2026-08-22 已执行 digest-bound Change Set `techlong-s3-b5-support-1fb78e3a91ede382`（raw SHA-256 `1fb78e3a91ede382702792f2521f935aa690670ead7e05dc89a57cec0d0b0145`，canonical SHA-256 `15d68976bf94a94f0be0d205194782e4700a89aa51a846457b38b8e2c8988b62`），Bootstrap 最终为 `UPDATE_COMPLETE`；没有创建 Cell 或 tenant Stack。
- receipt Bucket 固定为 `techlong-sandbox-402010193138-ca-central-1-tenant-receipts`，只允许 `tenant-lifecycle/v1/`，使用 Bucket owner enforced、完全 Public Access Block、SSE-S3，并在 Bucket Policy 与专用 `TechlongSandboxTenantLifecycleTaskRole` 两层强制 `If-None-Match: *`。公网 tenant web service 使用的普通 `TechlongSandboxTaskRole` 已完全移除 S3 identity policy；它不能读写 receipt，也不读取 generation Secret。LifecycleTaskRole 只可读取/conditional-write exact receipt，并仅在 `ManagedBy`/`SecretSchema` 标签匹配时读取 generation-bound runtime Secret。
- authority table 固定为 `techlong-sandbox-tenant-external-epoch-authority`，只有 `authority_key` 分区键，使用 `PAY_PER_REQUEST`，best-effort 限制为 `5 RRU/s`、`2 WRU/s`，不启用 PITR、Stream、索引、预热容量或收费 KMS key。`TechlongSandboxDeploymentWorkerRole` 只允许读取 exact receipt prefix、以 `tenant:*` leading key 对 exact table 执行 `GetItem/PutItem`、在 exact `cell-sandbox-1` 上运行 revision-pinned `task-definition/tenant-lifecycle:*` 并恢复/观察/停止自身标记的任务、Pass exact TaskExecutionRole/LifecycleTaskRole，以及管理 generation-bound `techlong/sandbox/tenant/*/runtime/g*` Secret。ECS 的两个不可 resource-scope 授权只以 `Resource: *` 配合 exact region/cluster、`ecs:CreateAction=RunTask` 和六个 exact request tag key；Secret 创建禁止自定义 KMS/replica，删除禁止强制立即删除且只允许 7–30 天恢复窗。该 Role 没有 CloudFormation、ALB、RDS 或 Cell 管理写权限。
- `s3-b5-support-bootstrap.ps1` 默认只做 `LocalValidate`。真实更新只能由固定 source user 对既有 Bootstrap 创建 Change Set、单独 Inspect、再用另一条命令 Execute。所有在线模式都要求 profile 的 `login_session` 精确指向 source user、credential source 精确为 AWS CLI `login`、环境中没有 AWS 静态凭据，并在线确认该用户只绑定 exact MFA device；`AcknowledgeMfaSession` 只是补充人审，不是唯一门禁。Inspect 与 Execute 都通过 Change Set `GetTemplate` 的 `Original` TemplateBody 与本地渲染模板做 canonical exact match，再拒绝账号、区域、Stack、参数、资源集合、replacement 或摘要漂移。这个一次性 Bootstrap 例外解决“Provisioner 不能更新自己的 boundary”的初始权限闭环，运行态仍只允许 MFA Provisioner 以固定 session name Assume 最小 WorkerRole。Provisioner 另仅获得 `ca-central-1` 的 ECS/ELBv2/EC2/RDS Describe 动作，用于 Shared Cell 只读证据；没有新增这些服务的写权限，scoped rollback 会一并撤销这组读取能力。
- 首次 support Change Set 已把部署中的 Janitor 升级到仓库当前的 generation/AppInstance/Cell ownership 围栏实现；`JanitorFunction` 以及动态引用其 ARN 的 `SchedulerInvokeRole`、`GlobalJanitorSchedule` 均完成无替换修改。scoped rollback 使用另一个可审查的 UPDATE Change Set，删除 receipt Bucket/Policy、authority table、LifecycleTaskRole 和 WorkerRole，并从 `ServiceRoleBoundary`/`ProvisionerBoundary` 撤销 B5 support/Assume/Shared Cell 只读能力；执行前必须明确接受永久删除全部 receipt 与 authority record，并先清空 exact receipt prefix。它保留普通 TaskRole 的 S3 通配权限移除与 Janitor 围栏升级，也不会删除 ECR、CodeBuild、普通 TaskRole、Provisioner、Budget、Cell 或 tenant Stack。
- 该 IaC 只消耗少量 S3 Standard storage/request 与 DynamoDB on-demand request 费用，IAM Role 本身不计费；费用不能保证绝对为零，`$10` Budget 仍只是延迟告警。`applyRuntimeReady=false`、`cleanupRuntimeReady=false`、Cell Bootstrap hard-disable 和默认 `offline_only` root 均未改变。
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

## 当前硬门禁

以下任一项未完成时，`applyRuntimeReady` 和 `cleanupRuntimeReady` 必须保持 `false`：

1. `0005`、`0006`、`0007` 尚未应用到 Neon。
2. 尚无独立批准的 PostgreSQL 16.14 空租户 baseline；旧业务数据 dump 禁止作为租户模板。
3. ECS one-shot、exact-five-key Secret、trusted S3 receipt reader/publisher、订单服务 lifecycle 入口与单 revision TaskDefinition binding/compiler 已离线完成，receipt Bucket/专用 LifecycleTaskRole 也已部署；当前后端提交的镜像已构建并以 digest 固定、扫描为 0 findings，但尚未注册并独立 readback 对应的 revision-pinned lifecycle TaskDefinition。生产 material generator、PostgreSQL provider、approved baseline、Worker live root wiring 和真实崩溃演练仍未完成。
4. 离线 ownership coordinator、原子 authority 接口和 DynamoDB 条件写 Adapter 源码已完成，authority table/WorkerRole 已部署并完成最小只读 IAM 模拟，但尚未注入 root，也未执行真实 AWS 条件写。CloudFormation 只读回读不是 CAS，不能安装或授权 external marker。
5. Cell 外部证据尚未完整验证 ACM、精确 Trust Store、DNS、TTL Schedule 和 Stack 所有权；Route Table/attached IGW 的只读证据与 fail-closed 校验已离线实现，但尚未在真实 Cell 上回读。
6. 分阶段 cleanup coordinator 与 exact provision predecessor 接线已离线实现，但 backend real lifecycle provider、Cell Janitor/standalone Worker 的 live destroy root wiring，以及真实 provider-side 删除演练仍未完成。
7. 尚未进行真实 Cell TTL 删除演练和费用后核对。
8. DynamoDB authority Adapter 和订单服务 `POST /api/saas/provision` 单调 epoch CAS 仅存在于未接线/未部署源码中；其他控制写接口仍未 fence，也没有完成数据库迁移、跨进程 CAS、AWS 条件写或 provider-side 删除演练。`AbortSignal` 不能撤销服务端已经接受的写入。

## 费用与执行规则

- 源码、迁移文件、模板渲染和 Mock 测试本身不调用 AWS，不访问 Neon，也不应用迁移；本阶段唯一在线写入是上述受审 B5 support Bootstrap UPDATE。`0005`–`0007` 继续只是仓库文件，既没有应用到 Neon，也没有接入真实数据库。
- `$10` Budget 是延迟告警，不是实时费用硬停。
- 创建 Lambda/Scheduler Bootstrap、B5 support S3/DynamoDB、ALB、Aurora 或运行 ECS/CodeBuild 都可能产生费用。Cell Bootstrap 写模式仍硬禁用；B5 support 只开放 source-user 的三阶段受审 Bootstrap UPDATE，任何真实 Change Set 执行或 Worker Apply 都必须另行获得明确确认。
- `infra/`、`.env.local`、证书、私钥、数据库密码和 AWS 长期凭据不得进入 Git。

## 本地验证

```powershell
npm run typecheck
npm run lint
npm test
npm --prefix .\ops\aws-sandbox test
```

这些检查通过只代表代码和静态安全边界通过，不代表 AWS Cell 已经部署或可以打开 Apply。
