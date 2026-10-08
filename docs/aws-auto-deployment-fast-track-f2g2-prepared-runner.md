# F2g2：平台 prepared-v2 接线与未安装部署草案

2026-10-07（Winnipeg）。本切片完成 runner/SDK/收据协议接线和数据型部署审阅编译器。**没有发布镜像、上传 baseline、注册 TaskDefinition、安装 IAM/authority 或启动 ECS/Cell/Worker。** 50 USD/月目标和逐项 fresh 云批准边界保持。

## 已实现

runner 与真实 ECS SDK adapter 增加显式 `lifecycleProtocol: "prepared_v2"`，必须同时选择 `receiptSchemaVersion: 2`；默认仍是 legacy-v1，旧六个完整 Node/script 命令和环境 allowlist 不放宽。Prepared 只允许单参数 `[operation]`、固定 Sandbox account/region/Cell/container；SDK 还核对所接 receipt reader 的真实配置版本。

每次请求携带完整 canonical tenant identity、完整 authority key、ownerDeploymentId，以及本次数据库/角色名。数据库/角色不能固化到共享 TaskDefinition。重算五字段 ownership preimage 和逻辑 Secret 名称，严格绑定 generation、owner/epoch marker、物理 Secret、请求 hash/startedBy；拒绝非 canonical JSON、跨租户目标、缺字段和额外字段。restore/migrate/verify 只接受代码绑定的准确 archive SHA；这只是协议 pin，**不是 baseline 批准**。

请求和配置采用独立快照，外部可变 DTO 不在异步校验间重新定义请求。新协议的 task readback 拒绝角色 override。既有 lease loss/独立 launch deadline/超时 stop/startedBy 有界恢复不变；RunTask 响应未知后只核对准确任务并确认停止，仍返回失败，不把收据观察升级为成功，不再次 launch。

S3 原始收据 schema2 与平台可信 envelope schema1 是两层不同协议。现有 `tenant-lifecycle/v1/...` key namespace 保留，v2 decoder 不读取旧 schema1 成功结果；既有对象不会被覆盖或迁移。verify 必须提供真实 application-login proof，不能以 SQL 已完成推导 HTTP/租户 ready。

## 数据型部署审阅材料

`compilePreparedLifecycleDeploymentReview` 接受拟议 image registry URI、明确修订 ARN、Cell management target、一个租户 fence 和最多六小时窗口，输出深冻结草案及绑定身份/owner/目标的 review SHA。**review SHA 不是可执行批准清单**；拟议 ARN/digest 语法通过也不是资源存在、镜像已发布或 live readback 证明。

- TaskDefinition 草案：Fargate Linux/X86_64、256 CPU/512 MiB、固定两个 role ARN、prepared ENTRYPOINT、默认 `--check-bundle`、uid65532、只读 root、唯一 `/tmp/tenant-lifecycle` 匿名可写卷。无 host path/EFS/额外挂载、无凭据注入、无 ECS Exec/常驻 Service；Cell 环境静态，租户环境按请求 override。
- activation item 草案：固定 `runtime:cell-sandbox-1:lifecycle-v2`、外层 schema_version2、canonical record、准确 management target/TaskDefinition/image、两个 immutable baseline keys 和 receipt-v2。仅有数据，**没有 PutItem/installer**；`revision=1` 是新行草案，不授权复位旧行或覆盖现有记录。
- TaskRole 最小权限草案：只读准确 activation/本租户 authority key、准确管理 Secret 和本代 Secret、两个 pinned baseline 对象；只允许本租户/代次收据 Get/带 AES256 + If-None-Match `*` 的 Put。没有 authority 写、Secret 写/删、RunTask、IAM/PassRole、S3 List/Delete。
- ExecutionRole 草案仅 ECR token 与固定 repository pull；无数据库/Secret/authority/收据权限。这不包含 CloudWatch logging、Worker、部署安装者权限；若后续需要，必须新增准确范围审阅。

`ecs:DescribeTaskDefinition` **不支持资源级 IAM 缩窄**，草案必须使用 `Resource: "*"` 且限制 ca-central-1，再由 admission 固定准确 ARN/内容。ECR token 也必须 `*`。这些例外不代表已批准安装。[AWS ECS 权限参考](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecs.html)、[DynamoDB LeadingKeys 条件](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html)、[S3 条件写](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html)

所有 readiness、registration/permissions/activation authorization、imagePublicationVerified、baselineApproved 均固定 false。没有编造当前 live image/Cell endpoint/subnet/TaskDefinition，所以本阶段没有生成可执行 fresh 云清单。实际卷初始化和 uid 权限必须真实 Fargate 验收。[AWS 卷说明](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/bind-mounts.html)

## 验证与在线状态

- `npm run test:deployment:prepared-v2`：65 项新/旧协议与收据测试通过。六操作实际组合 runner→严格 SDK adapter→S3 v2 decoder，但 SDK transport 是测试替身，不是 ECS/S3 在线验证。
- `npm run test:deployment:mvp`：129 项既有部署主链回归通过；typecheck、定向 ESLint 和 production build 通过。两条测试命令有重叠，不合计为独立测试数。
- `node --experimental-strip-types scripts/verify-prepared-lifecycle-wire.ts E:/NodejsProject/SpeedFeast_Backend_main`：直接调用两个仓库实际模块，六操作均通过服务端 task parser、production invocation 校验、activation schema/pins 校验。只使用明确 fixture 坐标，无 AWS/数据库连接或文件写入；没有重复真实 PG16 演练。
- Source 实际 `run-reviewed-ecr-republish.ps1 -Mode Inspect`：UPDATE_COMPLETE、Locked/v4、`lockedVerified=true`、`mutationPerformed=false`。没有执行旧 `15d30e5...` 批准，旧固定槽位与记录保留。

服务端生产代码未修改。F2g1 的源 `19cc3e0...` 云端候选、构建/扫描证据与旧 ECR 镜像完整保留；新候选仍未发布。候选 artifact 到期为 2026-10-08 18:31 CDT 左右；不得将 image config digest 当 registry digest，也不得以日志索引替代原 ZIP/收据 bytes 核验。[F2g1 证据](./aws-auto-deployment-fast-track-f2g1-admitted-root.md)

## 下一阶段

进入 F3 集中只读 preflight 与具体审批材料：先核对实际 Aurora PostgreSQL 可用版本、已有 IAM/boundary/OIDC/资源、候选原始 artifacts/收据及费用，再给出 fresh 镜像发布范围和 baseline/Cell/authority 安装方案。当前 session provider 严格要求 PG16.14，不能从“PG16 兼容 PG15”推导 Aurora 精确版本已满足；若云端可用版本不同，需要有证据的版本门禁调整。

新 root 镜像发布、私有 73 表 schema-only baseline 批准/上传、注册修订、IAM、条件 activation 写入、付费 Cell 和真实端到端验收仍各按具体资源/变更确认。授权前继续只读与代码准备，不能把 50 USD 月目标当实际费用硬断路器；新 IAM 更新清单需披露 CloudFormation 可能清理旧 managed-policy version 的副作用。真实 metadata/credentials/卷、DDB 延迟与 admission cap、跨系统 lease/TTL/cleanup、PUBLIC CONNECT 硬化、mTLS/control/健康检查及自动清理仍是 F3/F4 门禁。
