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

- 平台新增可注入的 AWS SDK v3 ECS one-shot Adapter，封装 `RunTask`、`ListTasks`、`DescribeTasks` 和 `StopTask`。它固定账号、区域、集群、Task Definition、子网、安全组和六条代码自有命令；未知提交只按稳定 `startedBy` 在独立有界窗口恢复，无法证明结果时 fail closed。
- Secrets Manager Adapter 只允许当前租户、generation、账号和区域下的 exact-five-key Secret。Secret value 由尚未实现的生产 material generator 在 provider 内生成；平台只接收 ARN、版本、标签和键集合证据，不接收明文值。
- DynamoDB authority Adapter 使用强一致读取和条件 `PutItem`，同时比较 revision 与规范化旧记录；它只是可注入实现源码，尚未创建表、IAM 或 root wiring，也没有被 standalone Worker 使用。
- 订单服务端新增默认禁用的 `db/tenant_lifecycle.js`，统一接受 `inspect`、`prepare_empty_database`、`restore_approved_baseline`、`migrate_saas`、`verify`、`destroy` 六条命令。Secret resolver 必须提供 exact-five-key JSON，但数据库 provider 只得到缩减后的 `database_url`；marker/epoch/ownership 状态机可在响应丢失后精确重放，旧 epoch、漂移和异主资源会被拒绝。
- 订单服务端另提供显式手动的 PostgreSQL 16.14 集成测试 runner：只接受 loopback admin URL，只创建随机命名的一次性数据库，并在 DROP 前二次核对 runner marker。默认 `npm test` 不会进入该目录；B5-G 没有运行真实 PostgreSQL 集成测试，也没有访问 AWS、Neon 或其他数据库。
- 当前仍缺生产 Secrets material generator、ECS task receipt reader、PostgreSQL lifecycle provider、DynamoDB 表/IAM、approved baseline、任务镜像验证、exact predecessor destroy 接线和 Worker root 注入。订单服务 CLI 只输出确定性的非秘密业务结果，不能自证 ECS task ARN；未来 reader 必须把该结果与已独立验证的 DescribeTasks 身份和 exact request 绑定，再由平台构造最终哈希回执。因此本切片只证明代码边界，不代表可以启用 Apply/Cleanup 或运行真实 ECS canary。

## 当前硬门禁

以下任一项未完成时，`applyRuntimeReady` 和 `cleanupRuntimeReady` 必须保持 `false`：

1. `0005`、`0006`、`0007` 尚未应用到 Neon。
2. 尚无独立批准的 PostgreSQL 16.14 空租户 baseline；旧业务数据 dump 禁止作为租户模板。
3. ECS one-shot 与 exact-five-key Secret 已有 AWS SDK v3 Adapter 源码和订单服务 lifecycle 入口，但生产 material generator、task receipt reader、PostgreSQL provider、approved baseline、任务镜像验证、Worker root wiring 和真实崩溃演练尚未完成。
4. 离线 ownership coordinator、原子 authority 接口和 DynamoDB 条件写 Adapter 源码已完成，但没有 DynamoDB 表/IAM/root wiring，也未在 AWS 中验证；CloudFormation 只读回读不是 CAS，不能安装或授权 external marker。
5. Cell 外部证据尚未完整验证 ACM、精确 Trust Store、DNS、Route Table、TTL Schedule 和 Stack 所有权。
6. 分阶段 cleanup coordinator 已离线实现，但 authority record 的 exact provision predecessor 尚未接到 lifecycle Adapter；database/Secret destroy 因此明确 fail closed，Cell Janitor/standalone Worker 也尚未接入完整 destroy Adapter。
7. 尚未进行真实 Cell TTL 删除演练和费用后核对。
8. DynamoDB authority Adapter 和订单服务 `POST /api/saas/provision` 单调 epoch CAS 仅存在于未接线/未部署源码中；其他控制写接口仍未 fence，也没有完成数据库迁移、跨进程 CAS、AWS 条件写或 provider-side 删除演练。`AbortSignal` 不能撤销服务端已经接受的写入。

## 费用与执行规则

- 本阶段的源码、迁移文件、模板渲染和 Mock 测试不调用 AWS，不访问 Neon，也不应用迁移；`0005`–`0007` 继续只是仓库文件。
- `$10` Budget 是延迟告警，不是实时费用硬停。
- 创建 Lambda/Scheduler Bootstrap、ALB、Aurora 或运行 ECS/CodeBuild 都可能产生费用。当前 B5 Bootstrap 写模式已硬禁用；任何未来真实 Change Set 执行或 Worker Apply 都必须另行获得明确确认。
- `infra/`、`.env.local`、证书、私钥、数据库密码和 AWS 长期凭据不得进入 Git。

## 本地验证

```powershell
npm run typecheck
npm run lint
npm test
npm --prefix .\ops\aws-sandbox test
```

这些检查通过只代表代码和静态安全边界通过，不代表 AWS Cell 已经部署或可以打开 Apply。
