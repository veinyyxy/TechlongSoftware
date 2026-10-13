# M1：首个 sandbox 业务记录已提交并独立核验

2026-10-13 America/Winnipeg，继续 [D001 主线](./aws-auto-deployment-single-tenant-acceptance.md)。用户明确批准 [六 DML 清单与完整风险](./aws-auto-deployment-single-tenant-m1-business-bootstrap.md) `7b741e2278d93c23c1885d33df89469ec03012b6842766a39e95d69083d32afc` 后，一次原子提交成功、独立只读验收通过。**这只是业务 bootstrap，不是 AWS 部署、租户 ready 或执行启用；M1 尚未完成。**

## 实际完成与独立回读

清单有效期、14 源码 binding、TLS verify-full Neon 身份、最新源行/原隔离/schema/权限及无碰撞检查通过。只锁准确源行，永久槽于 **19:21:06.960 UTC / 14:21:06.960 CDT** 消费，随后在同一 Serializable 事务中执行五条 INSERT 和一条 UPDATE，每条命中一行；同事务 postcondition 全部通过后 COMMIT，Run 返回 `BUSINESS_COMMITTED_REQUIRES_INDEPENDENT_INSPECT`，`dmlInvocations=6`、`commitEntered=true`。没有写重试或补偿。

五条新记录是独立 `Techlong Sandbox Acceptance` workspace、其 owner membership、31 天 admin_manual/active/standard-v1 subscription、`first-acceptance` pending app、pending entitlement；全部准确相互绑定，复用用户指定管理员和 actual active plan/published template。用户确认的店铺名/商户用户名已写入 22 项非秘密 configuration 快照，**没有创建商户管理员账号或设置密码**。subscription 起止和记录 created/updated 字段绑定原批准清单时间 **19:08:45.326 UTC**，不是伪称服务端 COMMIT 时间。

准确 sandbox env 的 policy `budgetLimitCents` 已从 1000 更新为 **5000**，其他 policy 与 apply_enabled=0、open/epoch0/无 stack 保持。这不是 AWS Budget 修改，也不是 50 USD 硬费用 cap。

**19:21:19.915 UTC / 14:21:19.915 CDT**，独立新进程、Serializable READ ONLY 回读结果 `BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL`，13 项全 true：数据库身份、owner/plan、五条准确行、workspace/member/subscription/app/entitlement 各归属和状态、时间、env 唯一 budget 差异、旧隔离原件/证书/fence/保护 schema、业务 schema、无 deployment/job。Inspect 数据库写 0。

因此本次准确结果为：新增业务行 **5**、env policy 更新 **1**；新 deployment/job **0**、TTL 启动 **0**、AWS/IAM/Secret 值/Lambda/付费资源创建 **0**、新永久槽消费 **1**。原客户/实例/订阅/旧部署与密封保护均未改，既有 active Cell IAM 也没有变更；后端代码/镜像/SQL/admission 保持。

## 身份、回执与不可重放

配置 hash `06d3cb50dd46b5f32771c356b7e7cd7d524a0707799ae24b9ace0672ef7281c9`；规划 hash `c45dafe1d1c65609eed08ff397d899aeaa0e55092312e330a0b4eef507434e5a`；14 源码 UTF8/LF binding `8c57b72d76aa9a154457a7c726e413ddc793c6f721a79a92ec8913c87c0f5ba8`。新业务 ID、管理员身份及完整非秘密配置继续只放在本地私有 manifest/run；不是公开 capsule，也不是环境级 Secret。

| 本地私有记录 | 文件 SHA256 |
| --- | --- |
| `F:/ChatGPT_workshop/techlong-d001-business-run-20261013-7b741e22/run.json` | `7c36332cf16d564cb1ec28d24294571988c6c5caf7aeded3ca0229242a885e6c` |
| `F:/ChatGPT_workshop/techlong-d001-business-inspect-20261013-7b741e22/inspect.json` | `e06b62d46a1dc7844c8f489efe87778cc11f3aa8f0f5710108d897d18143a3fe` |
| `F:/ChatGPT_workshop/techlong-d001-business-bootstrap.permanent-slot.json` | `eda869ac29e9f92170d347d3efa601ba1dfda008bef832e3628b2d5b1df44d5f` |

r1/r2/r3、原 seed、只读 EXPLAIN、批准、Run/Inspect 与永久槽全部保留。不再次 Run/Review 本 bootstrap，不复位或换槽重放，不自动 down/delete/撤销业务行或 policy。后续如需业务变更也按新的准确范围处理。

源码未变，本阶段依据上一批 24 项定向/相邻检查、typecheck/lint、六条真实只读 EXPLAIN 与本次真实事务/独立验收，不重复本地模拟或构建。F3c9 132 pins、已安装 IAM 四 pins及本 bootstrap 14 pins复核不变；后端用户 `.vscode/settings.json` 未纳入提交。摘要见 [installed capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.business-bootstrap-installed.json)。

## 下一主线和明确限制

新 pending app/active subscription 已会影响客户/容量视图，不能从旧 plan_only 证书中排除；旧 zero-tenant 门禁可能据此阻止旧流程，不能篡改查询或旧证书。F3c9继续封存。`https://first-acceptance.sandbox.techlong.cloud` 仍只是 pending 地址，没有 DNS/ALB/service/数据库或 ready 证明。

下一包以这些**已经落库**的 app/config/未来 scope 为唯一对象，接好 control signing/mTLS/payment 的安全来源、真实 lifecycle/worker 权限与 live approval/journal/cleanup-readiness，再集中准备准确 Cell/DNS/费用/清理创建清单。实际 Cell 输出后才登记准确 endpoint/Secret/key/task revision/binding/activation；依赖就绪前不 enqueue、不启动 TTL、不改 prepared false。AWS/Secret/数据库/activation/清理实际变更仍须 fresh 具体审批，不把本 bootstrap 批准扩展为部署授权。
