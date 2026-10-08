# AWS 自动部署最快交付方案

决策日期：2026-10-05。用户明确要求执行最快实现方案，移除优先省钱策略，并给出新预算 `50 USD`；按此前月预算语境落实为 **50 USD/月目标**。

## 交付目标与主线

首轮只验收一个 Cell、一个租户，完整链路为：

```text
已发布模板和镜像 → 购买/管理员部署任务 → Worker
→ 租户独立 Secret → 独立 database/role → 空 baseline 与 SaaS 迁移
→ CloudFormation/ECS → 健康检查 → mTLS/JWT 配置下发
→ 可访问地址/ready 回写 → 失败回滚和到期清理
```

沿用已有 AWS ECS Fargate + ALB + Aurora PostgreSQL 架构、现有 region/account 和 `sandbox.techlong.cloud`。Neon 是平台控制数据库，不替代餐饮租户业务数据库；现有 `public.*` SQL 仍使用每租户独立 database/role，不改为共用 database。

交付速度优先：复用已完成状态机、SDK adapter、模板、镜像供应链和数据库迁移；测试只覆盖本次改动及相邻安全边界。权限诊断是主链路的门禁子任务，不再默认用新 generation 轮次推进项目。多租户扩容、退款/升级降级和新架构选型不在首轮关键路径。

## 四个验收批次

| 批次 | 实施范围 | 验收标准 | 当前状态 |
| --- | --- | --- | --- |
| F1 真实运行时组合 | 真实 Secret material generator、租户上下文绑定、数据库/ownership/清理/mTLS adapter 接线、50 USD 预算兼容 | 组合不调用云；独立凭据不串租；同一 Secret/lifecycle 实例用于部署和清理；不能靠环境变量打开 runtime | 代码及定向验证完成，未云启用 |
| F2 数据库可执行闭环 | PostgreSQL 16.14 空 baseline 候选；backend prepare/restore/migrate/verify production provider；镜像构建与严格 readback | 业务数据为空；只允许批准 seed；真实任务回执和崩溃恢复；旧 inspect/destroy 入口不被放宽 | F2g2已接通显式prepared-v2 runner/SDK/收据并加入未安装TaskDefinition/activation/单租户权限草案；65项协议+129项主链、跨仓wire/type/lint/build通过；新镜像/baseline/权限/authority仍未部署，Source只读Locked/v4 |
| F3 在线门禁集中验收 | 单次只读取证收敛 IAM；authority/root；ACM/DNS/mTLS；空 inventory；TTL/回滚；费用估算；bootstrap Change Set | 使用真实 provider 证据；审批/执行在同一本地流程及时完成；成功或失败均独立撤权；可证明清理 | 尚未执行 |
| F4 单租户端到端 | 已批准 Cell 和镜像上运行真实 Worker；一个部署任务到 ready；失败/TTL 验收 | 真实健康端点、配置与地址回写；无孤儿租户资源；费用与资源 inventory 核对 | 尚未执行 |

F1/F2 的代码准备不等待 IAM 探针完成；付费执行仍必须满足 F3。任何批次不能把本地模拟通过当作云端验收通过。

## 费用与授权的新边界

- **10 USD 最低费用优先不再是当前交付方案的约束。** 新代码接受已批准的 50 USD/月 policy；旧 10 USD policy 仅为封存计划兼容，不自动重写历史清单、证据或数据库配置。
- 50 USD/月不是无限消费授权，也不是 AWS 实时扣费断路器。不能据此宣称整套 ECS/ALB/Aurora 可以全年常驻在该预算内。创建前需按 ca-central-1 实际资源、运行时间和已发生费用评估。
- 本批次不修改 AWS 上原有 Budget、Deny、IAM、Schedule 或 Neon policy。变更它们属于新的受审云/数据库操作，需列入新的准确清单。
- NAT Gateway、VPC Endpoint 或其他服务如确实能缩短主链路，可纳入后续成本与权限评审；不为“取消省钱优先”而强行替换现有网络模板。当前已批准模板/IAM 的拒绝边界不被静默删除。
- 单 Cell/租户限额、租户隔离、ownership CAS、凭据不落日志、立即撤权、失败回滚和禁止过期重放均保持。这些不是费用优化项。
- Git 提交/推送沿用用户默认授权，直接两个仓库的 main；仅提交实际变动的仓库，不生成新分支。
- 实际 IAM 安装、付费 Cell 执行、数据库写入和不可恢复删除仍按 fresh SHA 单独批准；本次泛化实现授权不重放 generation6 的过期计划。

## F1 实现说明

`NodeTenantRuntimeSecretMaterialGenerator` 使用 Node `randomBytes(32)` 分别生成数据库密码、HMAC、JWT 密钥；Stripe test key/webhook secret 从租户绑定的私有 credential source 借用，不随机伪造，不接收 live key。数据库 URL 固定为已配置的区域 RDS endpoint/5432、当前租户 database/role、`sslmode=verify-full`。

material 只能在 guarded Secret store 的 generation/epoch 上下文内生成。AsyncLocalStorage 隔离并发租户，校对完整 Secret 名称和 ownership 字段，Stripe lease 始终 dispose，provider 原始异常不外泄。生成器不保留生成的秘密；不可承诺 JavaScript 字符串能被即时可靠擦除。

`createPreparedDeploymentWorkerRuntime` 实际组合现有 Secret adapter、ECS one-shot lifecycle、GuardedTenantDatabasePort、CloudFormation workload cleanup、OrderedTenantResourceCleanup、DynamoDB authority-backed ownership coordinator 与 mTLS control client。部署与清理共享同一组实例。构建只加载能力，不调用 AWS/Neon，不领取任务。

这仍是 **prepared_not_activated**：原 standalone Worker 默认入口保持关闭，prepared root 的 apply/cleanup readiness 也固定为 false。原因是当前已部署 lifecycle 镜像只证明 inspect/destroy，不包含已经在线验证的 prepare/restore/migrate/verify provider；当前 Cell 仍缺失，authority 尚未安装。不能伪称自动部署已经可用。

## 继续位置

最新继续位置（2026-10-07 Winnipeg）：F2g2平台显式prepared-v2接线和未安装部署材料已完成。下一阶段F3集中只读preflight、实际Aurora PG版本/资源/费用核验与fresh云批准材料；默认Worker仍关闭，无安装或付费执行授权。见 [F2g2实现、验证与边界](./aws-auto-deployment-fast-track-f2g2-prepared-runner.md)。以下记录保留历史。

F2a 已在服务端加入 `build-empty-tenant-baseline.js` 和复用既有严格 TOC validator 的候选编译器。仅允许本地 PGHOST、read-only PGOPTIONS、schema-only dump；子进程离线 TOC/SQL 不继承 PG 环境，不输出凭据/provider 原始错误；输出目录新建且实际父路径必须在 artifact workspace 内。不会把数据 archive 标成空库。

实际首次导出留在 `F:/ChatGPT_workshop/techlong-empty-baseline-20261005-f2a`，只有 0 字节失败 archive，**不是有效 baseline**。用户启动原开发 PostgreSQL 后，`f2a2` 真实导出成功；旧策略拒绝订单系统所需 extension/functions/triggers。已逐项核对真实定义，新增显式、版本固定的 `speedfeast-empty-schema/2026-10-05/v1`：仅允许 `uuid-ossp`、5 个固定函数、4 个固定 trigger，比较完整 SQL 定义并拒绝 body/权限/绑定漂移。默认 legacy policy 不变，没有删除购物车计算或更新时间行为。这不是通用 SQL 沙箱，完整 archive/manifest SHA 与恢复批准仍必要。

最终候选 `F:/ChatGPT_workshop/techlong-empty-baseline-20261005-f2a4`：73 张表、203375 字节 schema-only archive、10 个程序对象定义匹配，无业务行/源库写入。archive SHA `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a`，candidate manifest SHA `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971`。失败/中间目录全部保留；私有 archive/SQL/manifest 不提交 Git。结果仅为 `CANDIDATE_REQUIRES_PG16_RESTORE_AND_APPROVAL`，不是 approved baseline。

2026-10-06 F2b 已完成：独立 EDB 便携 PostgreSQL 16.14 实例恢复此准确候选，另起只读进程/会话实测 73 张表零行与扩展/程序定义通过，临时实例已停止，源 archive/manifest 未变。结果 `PG16_RESTORE_EMPTY_PROFILE_VERIFIED`；`baselineApproved=false`，没有升级源 PG15、安装系统服务、构建/运行镜像或调用 AWS/Neon。见 [F2b 真实验收与证据](./aws-auto-deployment-fast-track-f2b-pg16.md)。

2026-10-07 F2c 第一批已完成 `migrate_saas/verify` SQL transaction provider，在全新 PG16.14 TLS、非 superuser cell_admin 上实际验证回滚、同任务重放、COMMIT 响应丢失恢复、管理会话丢失中止和旧 epoch 拒绝。独立只读进程核验 1 条 singleton、8 条默认 entitlement，其余业务表零行；空 Stores 使主题 seed 为 0 行，非此前简化的无条件两行。所有临时实例已停止，Source/AWS/Neon 未变。见 [真实事务 provider、证据与继续位置](./aws-auto-deployment-fast-track-f2c-saas-transactions.md)。

2026-10-07 F2c 第二批已完成真实 prepare/失败补偿 SQL capability：永久 journal、专属 NOLOGIN guard、禁止连接 quarantine、准确 role/database OID、原子 ownership promotion 和补偿 tombstone；真实 PG16.14 非 superuser TLS 验证三类创建/提交响应丢失恢复及清理响应丢失恢复，拒绝外来同名/重建 OID/旧 epoch，独立只读回读通过，临时实例全部停止。45 项相邻 Node 回归及 backend typecheck 通过。数据库模块只接收 URL，不接触其他 Secret 键。见 [prepare 真实证据与继续位置](./aws-auto-deployment-fast-track-f2c-prepare.md)。

2026-10-07 F2c 第三批已完成原子 restore SQL capability：准确 archive/manifest 离线编译、固定逻辑 catalog pin、准备阶段准确 OID 前驱、目标事务 DDL/零行/profile/双 marker、只读重放和提交响应丢失恢复；实测管理 backend 丢失整体 rollback、额外列漂移拒绝，真实 prepare→restore→migrate→verify SQL 链跑通。62 项 Node、28 项 Python 相邻校验和 backend typecheck 通过，四个实例停止；应用账户仍 NOLOGIN，无源库/云写入。见 [原子恢复证据与继续位置](./aws-auto-deployment-fast-track-f2c-atomic-restore.md)。

2026-10-07 F2d 已完成 prepared SQL service、准确部分恢复、独立 normal cleanup journal 和显式 prepare-v2 release gate；实际证实旧 cleanup registry 的 parsed prefix 约束不匹配，旧表/旧默认 CLI 保留不自动迁移。真实 service 四阶段→删除响应/COMMIT 响应丢失恢复→同命名空间新 generation→旧 cleanup replay 不触碰新 OID，独立只读回读通过。70 项 Node、28 项 Python 回归与 backend typecheck 通过，四个新实例停止，无源库/云写入。见 [prepared service 与正常清理证据](./aws-auto-deployment-fast-track-f2d-prepared-cleanup.md)。

2026-10-07 F2e 已完成：单独 prepared 应用最小授权和实际 TLS 数据库登录，准确 policy 原子提交/只读恢复，其他数据库 CONNECT prerequisite 拒绝；对应 cleanup 先永久 claim，再 NOLOGIN/撤销 CONNECT/关闭准确数据库新连接，活跃旧会话不强制终止，关闭后准确删除并释放下一代。75 项 Node、28 项 Python 和 backend typecheck 通过；最终应用闭环及原 NoLOGIN 清理/响应丢失真实回归通过，五实例停止。见 [应用授权、真实登录与安全退役证据](./aws-auto-deployment-fast-track-f2e-application-access.md)。

2026-10-07 F2f 第一批完成固定 RDS owned-session/AWSCURRENT source、prepared taskService 与 v2 immutable receipt、平台严格 proof decoder/Guarded 传播、独立 lifecycle 镜像候选。真实本地 PG16 全链和跨仓真实 receipt bytes 通过，production Client 配置被检查，但 AWS SDK/网络传输是明确本地替身，不等于真实 RDS endpoint/CA/S3/ECS 验收。97 项 backend Node、28 项 Python、64 项平台测试及类型/lint 通过；四实例停止。公开 RDS trust store 当前 SHA 变化已逐证书审阅并同步候选 pins；没有线上升级。见 [F2f 第一批证据与剩余项](./aws-auto-deployment-fast-track-f2f-rds-task.md)。

继续 F2f 下一批：先解决本机无 Docker/WSL 的镜像验证条件（本地 Docker 或单独审阅仅构建 workflow），然后容器内工具/compiler/image digest 读回；生产 admission/authority/环境/deadline/artifact source/固定 task commands 的 CLI 写 root 接线仍需完成。当前新 CLI main 仅 check-bundle，所有 Worker/runtime 门禁 false，baseline 未批准/发布。SQL verified、databaseLoginVerified 与 HTTP/tenant ready 区分；Cell 全部其他 connectable DB 的 PUBLIC CONNECT 硬化仍按 fresh SHA。F2 完成后准备 F3 在线资源/费用/权限清单，批准具体 SHA 后执行，不自动新 Grant generation。

本批次平台 129 项定向测试、typecheck、lint、production build 通过；服务端 39 项 Node 相邻回归、28 项 Python baseline/legacy/profile 测试及 typecheck 通过。独立进程复验候选并重新生成验证 SQL，逐字节一致。当前没有 AWS/Neon 写入或付费资源，所有 runtime 门禁仍 false。

运行时状态可使用 `npm run deployment:check-runtime` 查看；该命令不加载 `.env.local`、不连接 Neon、不调用 AWS，报告当前 standalone root blockers 和 50 USD 月预算目标。

参考：[ECS ALB](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)、[ECS 部署熔断](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)、[ECS 出站网络](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)、[AWS Budgets 延迟](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)。
