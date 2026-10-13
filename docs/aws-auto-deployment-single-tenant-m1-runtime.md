# M1：受监督工作负载接线与准确 UUID 清理

2026-10-13 America/Winnipeg。继续[D001 单租户首轮交付](./aws-auto-deployment-single-tenant-acceptance.md)，不重启 F3c9。本轮把上一阶段的数据候选接到既有 Worker 状态机和真实 SDK 方法，**没有启用运行时、安装权限或创建收费资源；M1 仍未完成，也没有可执行批准 SHA。**

## 本轮完成的主线代码

- `single-tenant-workload-strategy.ts` 明确区分旧 scheduled 模式与新 supervised 模式。新模式检查六字段 scope、准确角色、完整 15 项环境参数；缺失参数、旧调度参数或环境级租户凭据在 generation/数据库操作前拒绝。cleanup readiness 是独立回读接口，绑定 scope hash、审阅/权限证据、真实 Cell UUID、时限和 Source 人工接管责任；不是本地 enabled flag，也不是 Scheduler 回执。
- Worker 的 apply/reconcile 共用新策略，保留 lease heartbeat、generation/epoch、数据库 verified、mTLS/JWT 和原子 ready 检查。新的 7 项模板不再传为旧 ApplyReady 类型，不确认不存在的调度、不自动入队 TTL cleanup，不伪造 `TenantCleanupSchedule` ref。原默认路径保持。apply 输出另存真实 workload UUID、模板/参数摘要及 provision generation/epoch/marker/hash，后继清理不靠名字猜测。
- `createPreparedSingleTenantAcceptanceRuntime` 组装同一套 Secret、one-shot lifecycle、ordered cleanup、epoch 和 control 实例，并自己创建限定 scope 的 Neon repository，不能注入全队列 repository。新 root 的 apply/cleanup readiness 仍为 false，旧 CLI 不因环境变量开启它；尚未提供批准入口或真实独立 readiness verifier。
- `SupervisedTenantWorkloadCleanup` 从限定部署输出读取原创建 UUID，核对 generation 和准确 provision predecessor。所有 CloudFormation 观察/删除指向该 UUID，另检查新 DeliveryTrack/CleanupMode；名字被重建、原回执缺失或所有权漂移即停止。继续复用原 workload → database/role → generation Secret 有序清理，未改原冻结接口/数据库保护。
- SDK 增加独立 supervised apply 方法，材料必须由新 renderer/finalizer 产生且未被修改；参数最终冻结。新写前再次核对准确 Provisioner 身份；已有工作负载更新及删除使用回读的 ARN，不退回名称。SDK maxAttempts=1，不依赖隐式 SDK 写重试，禁用配置端点替换。
- `SingleTenantAcceptanceCellOperations` 实现一个 Cell 的创建回执、只读库存和准确 UUID 删除接口；需要另行提供实际审阅 guard 和永久 one-shot journal。创建保存服务返回 UUID、创建标识、完整模板摘要、标签与 logical inventory。清理复核角色、模板和实际物理资源，拒绝额外资源/漂移，仅 STANDARD DeleteStack，不 update、ForceDelete、RetainResources、调度或调用 F3c9。接口尚未接实际 Run，局部提交不等于创建/删除完成。

Cell 创建候选明确采用 CFN 原生 `OnFailure=ROLLBACK`，不是旧 RESERVED 的 DisableRollback。这个设置可能自动清理**本新栈**资源；真实执行必须另批删除范围、非原子/并发、收费遗留和响应丢失风险。创建响应丢失、回执保存失败或部分失败，不自动换名/重放，也不把缺 UUID 当作“未创建”；需要独立只读人工接管。租户尚未提交 workload 的失败情况同样不伪造创建 UUID，本轮没有扩展通用失败补偿工厂。

## 本轮真实只读事实

Source 曾返回 session expired，未消费执行槽或进行云写；用户刷新后准确 Account/ARN/UserId 核对通过。

**12:37:11.426 CDT / 17:37:11.426 UTC**，新的集中只读集合完成：

| 项目 | 当次事实 |
| --- | --- |
| 目标 `techlong-sandbox-cell-sandbox-1` | 不存在，未创建新 UUID |
| 拟专属 `TechlongSandboxFirstAcceptanceCellExecutionRole` | 不存在 |
| 拟专属 `TechlongSandboxFirstAcceptanceCellExecutionBoundary` | 不存在 |
| RDS / ECS / ELB service-linked roles | 三个均已存在，不需据本事实添加创建授权 |
| Cell 25 项定义涉及的 CloudFormation resource types | 17 种全部 DescribeType 成功，保存 create/read/delete handler 权限声明 |

原始非秘密记录 `F:/ChatGPT_workshop/techlong-d001-cell-permissions-20261013-r1.json`，文件 SHA `a459be281978e3f19f5e0911b3f83fdeede49af50a24eab6113245e1b9380ed3`。只读采集入口为 `ops/aws-sandbox/scripts/review-single-tenant-cell-permissions.mjs`，只保存新的私有文件、不覆盖历史，不创建批准或执行槽。

官方 provider 声明是资源类型的通用权限集合，**不是本模板最小权限策略**。例如它包含 VPN gateway、VPC encryption control、容量预留、Cognito、Firehose/S3 log delivery、数据库 snapshot/restore/replica/global 等本模板未选功能。不能原样授予整组动作，也不能以不存在的服务端条件宣称权限安全；后继须按实际属性筛选并核对 Service Authorization ARN/condition 支持、需要的正常删除和 CFN rollback。参考 [DescribeType](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeType.html)、[resource schema handlers](https://docs.aws.amazon.com/cloudformation-cli/latest/userguide/resource-type-schema.html)、[CFN service role](https://docs.aws.amazon.com/prescriptive-guidance/latest/least-privilege-cloudformation/service-roles-for-cloudformation.html)。

**12:40:43.397 CDT / 17:40:43.397 UTC**，Neon Serializable READ ONLY、`transaction_read_only=on`：目标环境 active/open、epoch0、apply_enabled=0、admission_stack_id=null；仅一条旧 plan_only/planned 部署，没有执行绑定。没有读取客户 configuration/password 或修改旧行。**12:41:49.406 CDT / 17:41:49.406 UTC** 另只读确认环境 policy budgetLimitCents 仍 1000、TTL7200；不是已约定的 5000。AWS Budget 本轮未重读，不能混淆 AWS Budget 与 Neon 执行 policy。新真实租户行/配置 hash、执行绑定及 Neon 50USD policy 差异须纳入后继明确 DB 审阅，不自动改 flag 或采用旧隔离记录运行。

## 验证和追溯

107 项定向/相邻检查、typecheck、定向 lint 零警告通过。新增检查覆盖 supervised apply/reconcile 到 ready 的调用顺序、参数/过期 proof 拒绝、真实 SDK 命令参数、持久 scope/UUID/predecessor 查找、原 UUID 清理及 Cell 一次提交/漂移拒绝。测试中的 DI/fixture 成功只是代码控制流证据，**不是实际收费 Cell、数据库迁移、TLS 握手或租户 ready 证明**；没有启动本地 Docker 或数据库模拟，也没有重建镜像。

F3c9 132 源码 pins 按原 UTF8/LF 归一规则再次核对无变化。初次直接文件字节校验对 11 个既有 CRLF 文件产生差异，按原绑定定义核验后全部一致，未修改原 pins/文件来掩盖差异。旧槽和证据保留。

本轮实际云写/数据库写/Secret value read/Lambda invoke/付费创建/永久槽消费均 0。新 SDK/Cell 操作接口没有被实际调用，默认 CLI 仍 disabled/offline_only。摘要见 [本轮 capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.runtime.json)。

## 剩余主线，不另开 F3 支线

现在无需再制作 workload 模板或 TTL 微探针。下一审阅包集中收尾：

1. 新专属 Cell 服务角色/boundary 的真实最小权限及 Source 准确 PassRole/CFN 创建和 UUID 清理范围；保留原 F3c9 无 Allow 角色。将本轮 provider 声明按实际资源属性筛选，而不是全盘 grant。
2. 一个新合法 sandbox 业务对象、不可变配置、环境 50USD policy/准确执行绑定、control 签名/mTLS 安全来源；不改变旧隔离业务原件。Cell output 对应的准确 sandbox DNS Alias 也须在真实资源/费用审阅中列明，目前这 25+7 项模板不含业务 DNS Alias。
3. 实际审阅 guard、永久执行 journal 和独立 cleanup-readiness verifier，然后才能产生 fresh 可执行 SHA；真实 Cell 创建之后回读 endpoint/Secret/Key/task revision，再合法写精确 activation，不虚构 ARN。

这些是 M2 前仍在同一 M1 主线中的真实缺口。没有现成云批准可让用户运行，也不将 prepared 的 false 改成 true 作为完成方式。
