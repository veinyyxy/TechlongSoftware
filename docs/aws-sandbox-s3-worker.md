# AWS Sandbox S3 部署执行器

## 当前状态

S3 已加入独立 Node.js Worker、STS/CloudFormation SDK 适配边界、严格参数校验、数据库租约/检查点、原子环境容量占位、两小时租户 TTL 清理计划、共享 Cell 安全预检边界和 mTLS 控制接口边界。S3-B B0–B4 进一步实现了离线可测试的类型化租户资源生命周期、不可变模板编译、RS256/mTLS 客户端、AWS 只读证据收集器、独立 Shared Cell 渲染模板和 Cell Janitor。B5 当前完成 lease-token/持续续租、租户 JSON Secret 注入、schema-v2 external epoch authority 契约、可恢复分阶段 cleanup、ECS/S3/Secrets Manager/DynamoDB SDK 适配器源码、可信 raw receipt publisher/reader、持久化 Shared Cell admission drain契约，以及默认 `offline_only` Worker root composition。B5-J4c 的独立 IAM 管理根与 plan-only child Bootstrap 已部署并严格回读；J5g-g现已准备好只允许单 Lambda Code更新的v2 consumer正向与休眠反向门禁，但因source AWS CLI login过期尚未执行线上更新。J5g-e1/e2已在真实Neon完成先审后写的 `0005`–`0008` 单事务迁移及独立只读回读。迁移已应用但仍未接入root，可变更/完整删除协调器也尚未部署。所有执行开关默认关闭，本版本不会因启动网站或运行普通测试而调用 AWS、Neon 或真实数据库。

以下三项已有严格边界；租户数据库路径已增加真实 inspect-only provider，其余变更操作及独立 Worker live root 仍使用 fail-closed 默认依赖，属于真实启用前阻断项：

- 租户数据库：类型化 lifecycle、approved baseline 门禁、active provision epoch 校验、脱敏 lifecycle evidence 持久化、ECS/Secret/S3 receipt SDK Adapter 源码、可信 raw receipt 边界和可恢复反向清理顺序已完成。订单服务已有真实 ARN-native `inspect` production composition 与 cleanup-only `destroy` root，但其他 lifecycle 变更命令仍未启用。receipt Bucket/authority table/最小 IAM 已通过受审 Bootstrap UPDATE 部署；destroy-capable Build #7 已构建、零发现扫描并以 inspect-default ACTIVE `tenant-lifecycle:2` 注册和严格回读，revision 1 已为 `INACTIVE`。仍缺生产 Secret material generator、其他 PostgreSQL 变更 provider、已批准的 PostgreSQL 16.14 baseline、Worker live root 注入和 provider-side 在线演练。
- 共享 Cell 安全证明：可注入的 ECS/ELBv2/EC2/RDS/STS 只读收集器及严格校验已完成；render-only 模板已拆出零入站的 one-shot SG，只读 preflight 会核对其公共 task subnet、VPC/输出/所有权/TTL、TCP 443 公网出站、TCP 5432 到 exact DB SG 出站，以及 DB 只接受 app/one-shot 两个 SG 的 5432 入站。lifecycle management evidence 另要求 RDS-managed Secret `active`、可信 runtime provenance 与稳定资源 hash。对应最小 `ecs:DescribeTaskDefinition`/RDS-managed Secret read IAM 已通过 `LifecycleReadback` 增量更新部署并在线回读，live root 仍未接线。
- 控制通道：固定 8443 的 mTLS transport、实例级 RS256 JWT 和不可变模板 v2 编译器已完成；订单服务 `POST /api/saas/provision` 源码已实现 control API v1.2 事务单调 epoch CAS，但其他控制写接口未 fence。相关 `0005`–`0008` SQL已应用到Neon，应用源码仍未部署。仍缺真实证书/私钥来源、Neon immutable source、可在重试期间保持同值并在 GET 对账后有围栏删除的 Owner Secret source，以及 Worker runtime 接线。

独立 Worker 的 `applyRuntimeReady` 与 `cleanupRuntimeReady` 当前都固定为 `false`。上述任一适配器没有替换并整体评审前，Worker 不会领取 `apply`/`reconcile`/`cleanup`，无论部署已经处于哪个恢复状态，也不能到达 CloudFormation Apply 或应用实例 `active`。这不是可以用环境变量绕过的提示。

## S3-B B0–B5 成果

- `0005_tenant_resource_lifecycle.sql` 定义 reference-only 的 `deployment_tenant_resources` 当前状态和 append-only 的 `deployment_tenant_resource_events` 审计记录。写入必须同时匹配 live job lease、当前 owner 和 generation；该迁移已受审应用到Neon。
- 同一部署的重试可以幂等复用当前 generation。资源尚未销毁时，另一个 deployment 不能接管 owner；只有完整进入 `destroyed` 后，新的 deployment 才能以 `generation + 1` 进入 `reopening`。`0006_deployment_lease_fencing.sql` 为每次 job claim 增加不可复用的 lease token；长操作持续续租，现有外部 I/O 边界消费同一个 `AbortSignal`，Repository 写入必须匹配 attempt、token 与未过期租约，丢租后的迟到返回值不会落库。
- `0007_external_ownership_epoch_cleanup_phases.sql` 增加 provider-observed provision/cleanup epoch、append-only ownership 事件以及可恢复 cleanup run/phase。Repository 不能自证 external marker；只有注入的 provider 安装并重新观察 marker 后才能激活。cleanup 以稳定 operation ID 恢复 workload → database/role → Secret 阶段，并原子收口资源、部署、实例、TTL 计划和容量。`0005`–`0008`已由J5g-e2原子应用；真实provider与destroy Adapter尚未接线，因此跨deployment live handoff与真实Apply/Cleanup继续fail closed。
- `0008_shared_cell_admission_fence.sql` 增加默认 `open`、不可自动 reopen的持久化 `draining` 围栏；新环境只能以 `open`、epoch 0和空 fence metadata开始。独立显式 writer先核对 predecessor `recordHash`、provision-operation hash和 generation/epoch marker自洽，再用数据库时钟证明 Cell到期并锁定 fixed environment row；请求已开始提交后的 abort/transport loss统一成为可用同一 predecessor恢复的 `NEON_SHARED_CELL_ADMISSION_DRAIN_UNCERTAIN`。Inspect/evidence只读并验证事先存在的 exact fence，不会隐式执行 drain。已 draining环境行成为不可删除、不可改写的 tombstone；deployment的 app-instance/environment以及 reservation与 cleanup schedule的 ownership坐标也不可变并必须匹配 owning deployment，不能通过移库逃离零快照。Repository门禁与数据库 triggers共同阻止 post-drain新 deployment/resource/schedule ownership或实例重新激活；draining期间 deployment、tenant-resource与 cleanup-schedule记录也不能用 `DELETE` 擦除，cleanup必须靠 terminal状态推进并显式释放 reservation，同时仍允许 drain前已有 exact reservation的在途工作续行。cleanup schedule的 `succeeded/canceled`是不可逆 terminal状态。snapshot schema v2回读同一 lineage fence和数据库到期布尔值；adapter层本地时钟只限制调用耗时，但上层 freshness仍比较数据库 `observedAt`与本地 `now`，所以上线时钟校准仍是 blocker。该migration已应用到Neon，但显式drain线上批准/执行工作流和adapter仍未接入默认root。
- 删除执行已把一次 exact live Stack重读放到最终零租户 snapshot之后，再核对 caller、strong authority、授权有效期与 freshness；但 CloudFormation/STS/DynamoDB/DeleteStack仍不是原子事务。上线启用 cleanup前必须让所有 Stack mutator共享 durable deletion claim/lease或等价 IAM排他窗口；当前默认关闭，最终删除 TOCTOU仍是明确 blocker。
- Tenant CloudFormation 标签和控制 API 请求/回读已携带 active epoch，但标签不等于外部原子围栏。平台新增的 authority 接口要求单次线性化 compare-and-set 并保留 predecessor；默认 authority 禁用，CloudFormation 仅作只读 readback，目前没有真实 provider。订单服务只有 `POST /api/saas/provision` 的未部署源码实现了事务单调 CAS，其他写接口仍未 fence。客户端收到 abort 也不能撤销服务端已经接受的写入。
- 每租户资源固定为独立 database + role + Secret namespace；创建、approved baseline 恢复、`migrate:saas`、验证和 workload → database/role → Secret 清理均有幂等、ownership fail-closed 契约。
- 控制请求只允许模板 Schema v2 编译出的 `instance/entitlements/default_store/first_owner`，不转发原始客户快照。JWT 只使用 2048 位以上 RSA，mTLS transport 固定 Sandbox hostname 与 8443，POST 后必须再次 GET 对账。
- 租户 Task 不再从环境 binding 读取共享 database/HMAC/JWT/Stripe Secret，而只接受与当前 resource generation 精确匹配的一条 Secrets Manager JSON Secret，并使用 ECS JSON-key 引用注入五个值。Task 健康检查使用 Distroless 可执行的 Node `CMD`，不依赖 Shell。
- B3 只读证据会验证 STS、ECS Cluster、ALB/VPC/Subnet/Security Group、443 控制路径拒绝、8443 mTLS verify + ACTIVE Trust Store，以及私有 Aurora PostgreSQL 16.14 Serverless v2。
- B4 Cell 模板只能渲染，固定 `renderOnly=true`、`applyReady=false`。模板新增独立 `OneShotTaskSecurityGroup`/输出：零入站，出站只有 TCP 443 到公网和 TCP 5432 到 exact DB SG；DB SG 的 5432 入站只接受 app task SG 与 one-shot SG，普通 app task SG 仍只收 ALB:3000。Cell TTL 为 3 小时，租户 TTL 为 2 小时，另保留至少 15 分钟 cleanup buffer；代码层使用独立前缀、权限边界与 Cell Janitor，租户 Janitor 不会删除 Cell。2026-08-26 部署的 J4b Janitor 只读取单 Cell inventory，Schedule 保持 `DISABLED`；它不是可变更或完整删除协调器，也不能清理 CloudFormation Stack 外的 database/role/Secret。必须先接入有围栏的完整 cleanup coordinator、全局扫描兜底并演练 `DELETE_FAILED`，才允许真实 Cell Apply。
- B5-J4b 已于 2026-08-26 完成 AWS 部署。固定管理 Stack `techlong-s3-b5-cell-bootstrap-management` 拥有 Manager、CloudFormation execution、Janitor、Scheduler 四组 boundary + role，共 8 个 IAM 资源，最终为 `LOCKED`；固定 child Stack `techlong-s3-b5-cell-bootstrap` 为 `CREATE_COMPLETE`，只拥有 LogGroup、只读 inventory Lambda、ScheduleGroup 与 `DISABLED` 的 `rate(15 minutes)` Schedule，共 4 个非 IAM 资源。child 不管理 IAM，外置 CloudFormation execution role 只可 `PassRole` 给外置最小 Janitor/Scheduler 两个角色。Scheduler trust 精确绑定 `aws:SourceAccount=402010193138` 与 `aws:SourceArn=arn:aws:scheduler:ca-central-1:402010193138:schedule-group/techlong-sandbox-cell`，Lambda 没有 reserved concurrency。实际授权序列为 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`，每个短窗后均立即撤销；两次 probe 均为空、read-only 且没有删除。该切片不创建、更新或删除 Shared Cell；S3、Lambda、Logs 与 Scheduler 的少量请求/存储仍不能保证绝对零费用。
- B5-F 先建立 SDK-free ECS one-shot 与 exact-five-key Secret Adapter 边界。注入接口覆盖 `RunTask`、精确 `startedBy` 恢复、`DescribeTasks` 和 `StopTask`；数据库任务只收到 generation-bound Secret ARN、代码固定命令、active epoch 和必要的 approved baseline digest，不接收密码、`DATABASE_URL`、连接 URL 或 Secret value。任务失租、超时或回执失败时会停止已知任务并确认 `STOPPED`；`RunTask` 不确定提交时会在独立恢复窗口持续查询，发现后停止，持续不可见则保留“结果未知”并 fail closed。实际 Secret 名使用逻辑 `/runtime` 加 `/gN`，并精确校验租户、generation、账号和区域。该阶段尚无真实 SDK/ARN lifecycle 源码；B5-G 已补入下一段所述的注入式实现基础，但 authority predecessor 仍未传入 lifecycle Adapter，database/Secret destroy 明确 fail closed，`cleanupRuntimeReady=false` 保持不变。
- B5-G 在上述接口后增加 AWS SDK v3 ECS one-shot、Secrets Manager 与 DynamoDB authority Adapter 源码。`EcsOneShotTaskRunner` 与 ECS Adapter 显式固定 environment kind、账号、区域、集群、revision-pinned Task Definition、subnet 列表、唯一 one-shot SG 和六条生命周期命令；`aws_sandbox` 只接受 `AssignPublicIp=ENABLED`，`aws_production` 只接受 `DISABLED`，任一漂移都会在 SDK 调用前 fail closed。Sandbox 公网 IP 只是无 NAT/endpoint 的低成本出站权衡，one-shot SG 仍零入站。Secret Adapter 使用 generation-stable 四标签，只暴露 ARN/版本/键集合/标签证据，同 generation 的新 epoch 不修改 Secret；DynamoDB Adapter 使用完整表 ARN、强一致读取与 revision/旧记录条件写入。订单服务 lifecycle service 保留六种类型化操作契约；当前 B5-J2 production CLI 则进一步收窄为只接受 exact `inspect`，其余操作继续禁用。
- B5-H 继续补齐可信 raw receipt 与 exact predecessor cleanup。订单服务只允许向 reviewed sandbox bucket 的固定 key 写入 canonical flat raw envelope；平台 receipt reader 必须先独立验证 exact ECS task/request、`ExpectedBucketOwner`、AES256 和 full-object SHA-256，再把 raw result 组装为最终 receipt hash。authority record 中保存的 exact provision predecessor 也已接到 cleanup contracts、runner、database/role 和 Secret destroy 边界；任何缺失、跨代、非 provision 或漂移 predecessor 都会在 provider 调用前 fail closed。与此同时，standalone Worker root 改为默认 `offline_only` composition，不会 claim apply/reconcile/cleanup job，也不会创建 live AWS/Neon/runtime provider。
- B5-I 在既有 `techlong-s3-bootstrap` 中加入并部署低成本支撑 IaC：exact receipt Bucket 强制 SSE-S3/`If-None-Match: *` 并一天过期，公网 tenant web service 使用的普通 TaskRole 完全移除 S3 identity permission，只有专用 LifecycleTaskRole 可 conditional-write/read receipt 和读取标签匹配的 generation-bound Secret；authority table 使用 `PAY_PER_REQUEST`、`5 RRU/s`/`2 WRU/s` best-effort ceiling 且不启用 PITR/Stream/索引。最小 WorkerRole 除 receipt/authority 外，只可在 exact Cell 运行 `task-definition/tenant-lifecycle:*`、恢复/观察/停止自身标记的任务、Pass exact TaskExecutionRole/LifecycleTaskRole，以及管理 generation-bound runtime Secret；它没有 CloudFormation、ALB 或 RDS 写权限。source user 的一次 Bootstrap UPDATE 被拆成 create/inspect/execute，在线只接受 exact AWS CLI `login_session`/MFA device；Inspect 与 Execute 还会把 Change Set `GetTemplate(Original)` 与本地模板做 canonical exact match。scoped rollback 删除五个支撑资源并撤销两项既有 boundary 的 B5 能力，但保留普通 TaskRole 的通配权限移除硬化。2026-08-22 执行的 Change Set `techlong-s3-b5-support-1fb78e3a91ede382` 已完成且无资源 replacement；root 与 gate 均未打开。
- 为避免在首次单租户 canary 前扩大长期 CloudFormation/IAM 权限，tenant web 模板暂时使用三值锁定的 ephemeral local 图片模式：`APP_RUNTIME_MODE=aws_sandbox_ephemeral_canary`、`ALLOW_EPHEMERAL_IMAGE_STORAGE=true`、`IMAGE_STORAGE_PROVIDER=local`。普通 TaskRole 继续保持零 S3 identity permission，租户模板也不再接收未实现的 `ImageS3Bucket`/`ImagePublicBaseUrl` 外参。该目录只存在于单个 Fargate task：重启、替换、部署或清理会永久丢失文件并可能留下失效数据库 URL；禁止上传真实客户素材，canary 不覆盖图片持久性，且 `persistentImageStorageReady=false`。正式方案必须另行评审并部署每租户/每 generation 专用 TaskRole、exact S3 prefix、permission boundary 和私有 Bucket 的受控读取路径，绝不能恢复共享 S3 通配权限。
- B5-J1 把 lifecycle one-shot 收敛为单一 exact `tenant-lifecycle:<revision>` ARN；Runner 独立传递原始 `expectedOperation`，Adapter 只有在请求 operation 与 argv 都与它一致时才接受六条 code-owned command。新增的离线 binding/compiler 只记录 Sandbox ECR `@sha256`、预期 Cell cluster、两条 IAM role、receipt Bucket、命令和候选网络 intent。`candidateSubnetIds` 与 `candidateOneShotSecurityGroupId` 只是未验证输入，`sharedCellEvidenceReady=false` 明确禁止把它们描述为已证明的公共 Cell subnet/one-shot SG。compiler 不输出 Runner/API 运行时配置，并保持 `registrationReady=false`、`liveReadbackReady=false`；未来 live readback verifier 必须结合 `DescribeTaskDefinition` 和 Shared Cell 网络证据后才能产出配置。默认 root 也新增 TaskDefinition live-readback blocker；本切片没有注册任务、创建 SDK client、调用 AWS 或打开 gate。
- B5-J2 在既有 Shared Cell 只读 Adapter 上增加兼容的 lifecycle evidence read：完整 preflight 通过后，只投影 exact cluster、公共 task subnet、one-shot SG、Aurora cluster、writer endpoint、RDS-managed master Secret ARN、`SecretStatus=active`、`cell_admin` database/user 与证据哈希，且不返回 Secret value、password 或连接 URL。模块私有 `WeakSet` 只认可完整 collect/preflight/hash 流程产出的 evidence，克隆或伪造对象不能编译；稳定资源 hash 排除瞬态观察值并规范化集合顺序。management-target compiler 再把该投影与 B5-J1 intent、当前 `TenantResourceFence` 对账，强制 `tenant_<stem>_db`/`tenant_<stem>_role` 同 stem，并只允许 5 分钟新鲜度窗口内、时钟未回退的受标记 target 生成 canonical 11-key backend projection。任一账号、区域、Cell、cluster、network、management reference 或 tenant target 漂移都会 fail closed；它不输出 Runner/API config，两个 readiness flag 仍为 `false`。
- B5-J2 后端已实现真实 inspect-only Secrets Manager + PostgreSQL + S3 receipt 组合，但没有运行它：生产入口要求 exact runtime mode、canonical management target、RDS-managed `AWSCURRENT` Secret、AWS RDS CA、TLS peer verification、只读 session、参数化且有界的 catalog/COMMENT 查询，以及 exact immutable receipt key。CloudFormation 的最小 `ecs:DescribeTaskDefinition`/RDS-managed Secret read IAM 已通过 `LifecycleReadback` 三阶段 Change Set 部署并在线回读；Build #4 也已由当时源码构建并完成零发现扫描。该阶段结束时仍没有 TaskDefinition 或 `RunTask`。
- B5-J3 当前由单资源 CloudFormation Stack `techlong-sandbox-tenant-b5j3`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j3/5e145df0-a4f2-11f1-b674-0e76530b9cdf`）注册并严格回读 ACTIVE `tenant-lifecycle:2`；旧 revision 1 已为 `INACTIVE`。revision 2 固定 destroy-capable Build #7 digest、inspect-default 命令，roles/Fargate/容器 hardening/业务标签均 exact match。部署模板 raw/canonical SHA-256 为 `68af0afca7b18827ab50fe493137b299a884b701773b025546d1ecdf2e14af11` / `127b4bf5cf634c84737df5fd7cba2eac94424a42e7974166b607036b42df1962`，properties canonical SHA-256 为 `f580ece0458b701091802dc3ca2789dccc2e5d85732c5932d65400eb87453850`，readback evidence canonical SHA-256 为 `f3b8fb0d9eeb2386658f49e51fe4687da8a7e345c443934a98171f7e512b51cb`。临时 grant `techlong-s3-b5-support-lifecycle-task-registration-grant-a24567a02879a2be`（UUID `f4ae26bb-b5c6-4537-8b82-10a1414479fc`）使 boundary 为 `v6`，随后 revoke `techlong-s3-b5-support-lifecycle-task-registration-revoke-68a34349f703dd52`（UUID `f703d78e-f368-41f5-8d08-45dea15c8310`）恢复最终 `v7` `LOCKED`，只保留两个 baseline PassRole。精确 Cell cluster 为 `MISSING`；未执行 `RunTask`。
- B5-J4a 已通过固定 Stack `techlong-sandbox-tenant-b5j4logs` 创建并两次严格回读唯一 `AWS::Logs::LogGroup`：`/saas/cell-sandbox-1/tenant-lifecycle`、`STANDARD`、1 天保留。模板 raw/canonical SHA-256 为 `65c00d1c139991627a6f1801cc4887de53352b6e884064850df339cd6da0455c` / `4999c5fd89edd2aa9476cafc2a802871198b88bbdf103305dd442713281a90c2`，live evidence canonical SHA-256 为 `c2270d6344b1b93e80af9c41c47cfbfcec5ac45c14b5b93692aeb98f4f3086c6`。Provisioner 只通过 exact CloudFormation execution role 创建 Stack，source `login_session` profile 只做 Logs 直接回读，没有扩展 Provisioner/Worker IAM。在线证据确认零 stream/bytes/metric filter/log-group subscription/account subscription、无 KMS/data protection/bearer-token authentication，exact cluster 仍为 `MISSING`，没有 `RunTask`。
- 该支撑 Stack 没有 `CellId`/`ResourceGeneration`，其 `ExpiresAt` 不会被现有 Janitor 解释为自动 TTL；需要显式安全删除。B5-J3 模板未修改；后续 B5-J4b management/child Stack 已完成部署，但只提供 read-only inventory 与禁用的定时入口。J5g-e2已完成 `0005`–`0008`受审migration，但生产material generator、PostgreSQL变更/销毁provider、可变更/完整删除协调器、approved baseline、live root wiring和真实租户AWS/数据库演练仍未完成。因此 `registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 全部保持不变。

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

`techlong-sandbox-user` 只能作为 source profile。上面的 MFA device ARN 已确认为 `arn:aws:iam::402010193138:mfa/techlong-sandbox-dev`。Trust Policy 同时要求 MFA 与精确 session name；直接用 IAM User 启动 Worker 会因为 STS Caller ARN 不是 `assumed-role/...` 而失败。每次在线 readback/update 前都必须重新确认短期 login/AssumeRole 会话仍有效；不要把 Access Key 或 Secret Key 写入仓库、数据库或 Worker 日志。

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

以下包含 S3-A、2026-08-22 B5-I support update、2026-08-24 B5-J2 LifecycleReadback/历史 Build #4/B5-J3、2026-08-25 B5-J4a lifecycle LogGroup、2026-08-26 B5-J4b management/child Bootstrap、2026-08-30 Build #7/ACTIVE `tenant-lifecycle:2`，以及2026-09-09 J5g-e1/e2 Neon先审后写cutover。e1使用 `SERIALIZABLE READ ONLY DEFERRABLE`并最终 `ROLLBACK`；e2在明确授权下使用单个 `SERIALIZABLE READ WRITE NOT DEFERRABLE`事务应用 `0005`–`0008`，随后换新连接执行独立只读核验。

- `0004_aws_sandbox_worker.sql` 已应用到当前 Neon；核验结果为
  `apply_enabled=0`、execution binding 为 0，迁移本身没有开启 AWS Apply。
- J5g-e2执行前fresh manifest SHA-256为 `4bd20b41a185462c5d8951d36f57c463cc1fe13cf7ed54fdbcafc7262a0a72da`，确认PostgreSQL 18.6、exact `0001`–`0004`前缀、唯一pending `0005`–`0008`、旧同名step-run索引精确定义及全部activity/ownership/隐藏改写计数安全，RTT 65ms、时钟偏差1877ms且 `mutationPerformed=false`。apply回执为 `outcome=applied`、`mutationPerformed=true`、SHA-256 `9edb120a7cf4b89e197f5ab2f1bdbf1093327b4b1d8969bc7aeef6433f1dd392`；独立只读回读回执SHA-256 `5a8ac632c925fe7950a018f8dd1d12c1d5ac49ea7d82c2d0c3eac97d32936d06`确认最终exact `0001`–`0008`、23/23启用trigger、20/20 index、23/23已验证constraint、7张cutover表零行和唯一环境默认admission状态。
- 没有修改数据库里的 `apply_enabled` 或创建 execution binding。
- S3-A Bootstrap 已创建受限角色/Boundary、TTL Janitor、Scheduler、不可变 ECR、私有源码 Bucket 和只能显式启动的 CodeBuild Project。
- B5-I digest-bound Change Set `techlong-s3-b5-support-1fb78e3a91ede382` 已使 `techlong-s3-bootstrap` 达到 `UPDATE_COMPLETE`：receipt Bucket、authority table、LifecycleTaskRole 和最小 WorkerRole 均为 `CREATE_COMPLETE`，Janitor ownership 围栏及其 Scheduler 引用均为无替换更新。receipt prefix 当前 `KeyCount=0`；区域上下文 IAM 模拟允许 exact Shared Cell 读动作，`CreateVpc` 与 `CreateDBCluster` 保持 `implicitDeny`。
- Janitor 已通过空扫描、伪造共享 Cell 拒绝、以及已过期临时租户 Stack 的真实删除测试；测试 Stack 和日志组均已清除。
- `LifecycleReadback` Change Set `techlong-s3-b5-support-lifecycle-readback-60d854ad2664718e` 的 raw/canonical SHA-256 分别为 `60d854ad2664718eed88ec4731ff3a70cb84b34ba9dcaf439782dcba7a816113` / `1fe4af4b94a198437511a147fe05685eefb768304e3ab487ca06722657c2223b`；它只修改 `ServiceRoleBoundary`、`ProvisionerBoundary`、`TenantLifecycleTaskRole`、`DeploymentWorkerRole`，全部无 replacement，`techlong-s3-bootstrap` 为 `UPDATE_COMPLETE`。实际 managed-policy 默认版本为 Service boundary `v3`、Provisioner boundary `v4`，两个角色的 boundary、trust、tags 和 exact inline policy 回读均匹配模板。
- Build #3 与 Build #4 保留为此前零发现历史镜像。当前权威 Build #7（ID `techlong-sandbox-speedfeast-image:0a33f1c9-8e43-408d-b91d-fe39d6c61ac7`）从后端提交 `201187cddb1a77690c0df2c7779d354af6009e7c` 构建，源码包 SHA-256 为 `e00ca7f2865a81ab0500a505ec37c812c0e7e827293239d329cf00f9bcfcf29e`；全部 CodeBuild 阶段成功，最终不可变镜像为 `sha256:6001bde1cc05058ae3df83fbdb084e8cd53b64325ecb6663b43a5fccc8ef22be`。ECR 保持 `IMMUTABLE`、scan-on-push、AES256，扫描 `COMPLETE` 且 findings 为 0。
- 第一张 Node Bookworm 完整运行时镜像因 `3 Critical / 5 High / 6 Medium` 被门禁拒绝，未写入 execution binding，也未用于租户。最新零发现镜像同样尚未启用 Apply；镜像合格不代表其余 S3-B 门禁已经完成。
- B5-J3 Stack `techlong-sandbox-tenant-b5j3` 为 `CREATE_COMPLETE`，唯一输出为 ACTIVE `tenant-lifecycle:2`，旧 revision 1 为 `INACTIVE`。临时 registration grant 和 revoke 均只修改 `ExecutionRoleBoundary`、无 replacement；grant boundary `v6` 含三个 exact PassRole，最终 `v7` 为 `LOCKED`，只可 Pass TaskExecutionRole/普通 TaskRole。精确 `cell-sandbox-1` cluster 返回 `MISSING`。
- B5-J4b management Stack `techlong-s3-b5-cell-bootstrap-management`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap-management/e1bacdf0-a0ca-11f1-a27e-0e9a646108cf`）已部署 8 个 IAM 资源并最终严格回读为 `LOCKED`；模板 raw/canonical SHA-256 分别为 `15ec52203f390d29858fb77e032c4d6bff83d5c3678397bf133bf60e6ab9d553` / `5d09bbc9010de13dfdba09b71c13c58711a9238cb09cd78eb767f509b29c07a1`。
- digest-addressed child 模板已上传到 `https://techlong-sandbox-build-source-402010193138-ca-central-1.s3.ca-central-1.amazonaws.com/b5-cell-bootstrap/templates/sha256/8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f.json`，raw/canonical SHA-256 分别为 `8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f` / `2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389`。成功执行的 Change Set 为 `techlong-s3-b5-cell-bootstrap-8eeef35a7936cdd1`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-8eeef35a7936cdd1/ae46c8c2-5445-4590-b23d-cbfa36aa8489`），授权过程完整经过 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`。
- child Stack `techlong-s3-b5-cell-bootstrap`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/2477b820-a174-11f1-aca9-0668f7a50fdf`）为 `CREATE_COMPLETE`，4 个 cleanup-only 非 IAM 资源均完成创建。strict readback evidence canonical SHA-256 为 `b6e8083c3c04de9daccecfe3ca1e0c242ae2b27131f0c683ec2097f795ae97cc`；probe evidence SHA-256 为 `d77199f776408f75d722176805ba09853caee51ee4639b87d879b013d4a967ca`，两次 probe 均得到一致空 inventory、只读且无删除。Schedule 保持 `DISABLED`/`rate(15 minutes)`，Lambda 没有 reserved concurrency，Scheduler trust 为 exact SourceAccount + schedule-group ARN。
- Worker 与租户 Apply 仍未启动；除上述单一 TaskDefinition 外，没有创建 Cell、ALB、ECS 租户服务、Aurora/RDS、VPC、Route 53 或正式租户 Stack，也没有执行 `RunTask`。

## 后续受控步骤

1. B5-J3 的 TaskDefinition 注册、独立 `DescribeTaskDefinition` readback 和临时权限撤销已经完成；不要重新注册 revision，也不要把 `registrationReady` 当作事实状态手工改为 true。
2. B5-J4a 单资源日志 Stack 已创建并两次 exact readback；不要修改 B5-J3 模板或手工翻转任何 readiness gate。
3. B5-J4c management 与 plan-only child 已完成，无需重复创建。J5g-g的v2 consumer上线门禁已离线通过；刷新source与Manager身份后先在management `LOCKED`下执行只读`AuthorityV2ConsumerUpdate`预检，再分别批准grant、Change Set创建和执行。正向目标只允许`CellJanitorFunction.Code`修改，Schedule必须保持`DISABLED`；休眠反向Change Set只在更新成功后严格回读或探针失败时另行批准，不能用会删除整个child的`BootstrapRollbackGrant`替代。
4. 即使v2 consumer随后成功上线，它仍只接受inspect事件并固定`PLAN_ONLY`，不拥有`DeleteStack`或authority mutation能力；`ABSENT_SAFE`双探针也只能证明authority缺失时fail closed，不能证明完整v2 authority链路。Shared Cell、数据库访问和首次 one-shot `RunTask` 仍属于后续独立批准，且不得伪造 subnet、one-shot SG、RDS Secret 或 management target。

以上状态不改变 `registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false` 或 `cleanupRuntimeReady=false`；没有部署 Shared Cell、VPC、ALB、ECS 服务、Aurora/RDS、Route 53，也没有执行 `RunTask`。Cell 创建和 Worker Apply 仍需后续独立批准。
