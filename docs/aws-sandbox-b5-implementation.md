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
- CloudFormation 标签/ClientRequestToken 及 SaaS Control metadata/header/idempotency/readback 已绑定当前 active provision epoch；但真实 AWS 与订单服务端尚未实现原子拒绝旧 epoch 的 provider-side compare-and-set，所以这些字段目前只是离线契约，不能据此开启执行门禁。
- 默认 external ownership provider、Tenant DB/Secret/workload Adapter 和 standalone Worker root wiring 仍未配置，因此 Apply/Cleanup 保持 fail closed。

## 当前硬门禁

以下任一项未完成时，`applyRuntimeReady` 和 `cleanupRuntimeReady` 必须保持 `false`：

1. `0005`、`0006`、`0007` 尚未应用到 Neon。
2. 尚无独立批准的 PostgreSQL 16.14 空租户 baseline；旧业务数据 dump 禁止作为租户模板。
3. 真实 ECS one-shot Tenant Database/Secret/workload Adapter 尚未完成并演练崩溃恢复。
4. 离线 ownership coordinator 已完成，但尚无真实 provider 为 database、role、Secret 和 CloudFormation workload 安装并回读 external marker。
5. Cell 外部证据尚未完整验证 ACM、精确 Trust Store、DNS、Route Table、TTL Schedule 和 Stack 所有权。
6. 分阶段 cleanup coordinator 已离线实现，但 Cell Janitor/standalone Worker 尚未接入真实 destroy Adapter 与 provider-backed ownership proof。
7. 尚未进行真实 Cell TTL 删除演练和费用后核对。
8. CloudFormation workload 与订单服务控制端尚未实现并演练 provider-side 单调 epoch CAS；`AbortSignal` 不能撤销服务端已经接受的写入。

## 费用与执行规则

- 本阶段的源码、迁移文件、模板渲染和 Mock 测试不调用 AWS，也不应用 Neon 迁移。
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
