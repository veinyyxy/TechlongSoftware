# F3c9d：Neon 失败保护与窄授权安装评审

2026-10-12 Winnipeg。上一步四对象 LOCKED 安装保持为历史已验证状态；本次仅实现数据库安装 Review/一次 Run/独立 Inspect 入口并刷新只读前态，**未提交 DDL/GRANT，未消费新安装槽位，未启用自动部署。** 不重放已消费的 AWS bootstrap，也不重做镜像或旧 generation 探针。

## 当前待批准清单

SHA：`91a63757de532e1189f7c2478401e26d46cd2643965c802172cb9841477c4291`。

截止 **2026-10-13 01:21:12.279 UTC / Winnipeg 2026-10-12 20:21:12.279**。过期或代码/目标/前态漂移，不写数据库、不消费槽位；只有槽仍为空时可另做只读 Review 并重新确认新 SHA，不转移旧授权。

| 对象 | 准确变更 |
| --- | --- |
| 新表 | `public.deployment_failed_cell_birth_fences_v1`：4列，PK/FK及5项CHECK，初始空表，无业务围栏行；PUBLIC无权限 |
| 环境保护 | 仅替换 `enforce_deployment_environment_admission_transition()`，扩展两项 admission CHECK；不改变任何现有环境行或状态 |
| 新函数与触发器 | 3个新函数：reject mutation、guard environment、`begin_failed_cell_birth_fence_v1(text,text)`；4个新 Always 触发器，并将现有 environment transition 触发器设为 Always |
| `techlong_cell_cleanup_reader` | 新表 SELECT；`deployment_jobs`、`deployment_step_runs` 的 id/deployment_id/status 三列 SELECT |
| `techlong_cell_drain` | 仅新增准确 `public.begin_failed_cell_birth_fence_v1(text,text)` 的 EXECUTE；保留已有窄权限，不改变角色属性/密码/LOGIN |

准确 SQL 为原未安装 `f3c9c-failed-cell-birth-fence.sql`（SHA `f4f0bf14bb0b5b126be50dae9c52e21c22ff88bfc36add877db97ae8a45188d9`）及 `f3c7-failed-cell-birth-role-grants.sql`（SHA `a9b2bca56d3ead7d964f25c00a1a721f5a5fe7dd4a1105ab2c82efeb07391e92`），文件保持原字节。两份 SQL 在**同一个 SERIALIZABLE 事务**中提交，不拆分 schema/grants，不自动运行失败入口。

不创建角色、Secret、迁移记录或计划证书；不改密码/现有业务数据/旧保护函数和触发器；不调用 `begin_failed_cell_birth_fence_v1`，不把环境改成 failed/draining；不修改 AWS、调用 Lambda、登记 parent、创建 RESERVED 或付费 Cell。

## 执行和只读验收

新独立 CLI 为 `ops/aws-sandbox/scripts/review-failed-cell-birth-installation-v4.mjs --mode Review|Run|Inspect`，不是 migration hook 或 runtime 开关。使用本地已配置的 DATABASE_URL，经验证证书/主机名的 TLS 和 channel binding 连接，不从 AWS 读取 Secret。

Run 严格验证完整冷清单、准确 SHA、目标/68代码绑定/两 SQL 摘要/一小时期限；获取 environment ACCESS EXCLUSIVE 及有关业务/旧保护表的写锁后重新核对完整前态。已有两角色的准确表/列/配置权限必须仍是原批准集合，不接受额外权限或 admin/owner/inheritance。前态和代码通过后，用固定私有文件 `wx+flush` 永久占槽，再提交 SQL；提交前核对历史证书/原件/业务摘要、角色完整有效权限增量、函数 body/安全属性/ACL、trigger类型/Always及表结构/约束目录。

成功 COMMIT 或结果不确定后都关闭原连接，用**新连接、SERIALIZABLE READ ONLY DEFERRABLE** 独立回读；Inspect 不执行 DDL/GRANT、不调用入口、不重试。目录验收只证明已观察到的安装配置，**不等于真实受限角色认证、失败入口行为或 PG18 上完整并发清理验收通过**，不产生 runtime proof。

## 必须接受的完整风险

- 此次会改变数据库 schema、两项环境约束及触发器执行条件；短暂排他锁会阻塞业务读写，锁/语句超时、约束验证或权限不足可能使事务失败。未提交事务可用 ROLLBACK 收尾，但不会再提交 SQL。
- 两控制角色已 LOGIN；新增 SECURITY DEFINER 入口使已有 drain 凭据具备受限、准确环境的失败围栏写能力。安装不调用该入口，不代表别人无法调用。列 SELECT 不是行过滤，涉及两张表全部行的指定列。
- 管理员并发 DDL/ACL/角色替换、提供者同步和目录读取并不是全局跨会话 CAS；前后检查不能排除最后一次读取后的变化或角色身份竞态。目录验收不承诺权限传播、函数行为和真实 runtime Allow/Deny 已通过。
- 本地管理员/提供者日志可能记录 SQL、账户/资源和数据库标识。脚本不输出连接字符串、密码、原始提供者异常，也不保证提供者日志完全不记录这些信息。
- TLS/连接/提交响应可能失败。COMMIT 一经尝试后，即使返回丢失也不执行补偿或再写；只能 Inspect，不能凭失败回执判定未提交。
- 永久槽在 DDL 前消费。SQL失败或事务回滚后仍不能删除、复位、换目录、补齐或自动重试；提交后的 schema/grants 不自动 down、撤销或恢复旧函数。异常处置需按实际状态另审，不安装第二个自动重试槽。
- Neon/API/遗留服务不承诺绝对零费用；50 USD/月仍非费用硬断路器。本清单不创建 AWS 付费 Cell，也不扩大其它 AWS 部署权限。

## 当前只读取证、测试和继续位置

- 原单独前态 r3（23:07:33.572 UTC）：PG18.6、open/epoch0/apply0、旧证书 `dc093614...` 与保护 `41eea5ac...` 完整；新表/入口/failed状态未安装。旧封存 active/deployment/association 各1保留，其余占用/jobs/steps0。
- 安装入口 r1/r2/r3 三次只读准备的完整前态摘要一致：`e2f42d036a44235ebfede2f0703336740df95d091551540ddf21a53920c26b88`。**仅最终 r3 是本次交付清单**；前两份保留为代码收紧过程的历史，不执行。
- 最终私有目录：`F:/ChatGPT_workshop/techlong-f3c9d-neon-install-20261012-r3/`。68代码 SHA `cd90d88625ea3c2b25226ea5a326a53bc9b34104ad05e8c628735489290f4486`；manifest文件 SHA `320ed5999e443348a82ae95a532a5082894cf708e74a3d139f53914b6da19505`；原63和候选包/lock未改。
- 固定新槽：`F:/ChatGPT_workshop/techlong-f3c9d-failed-birth-installation.permanent-slot.json`，当前不存在。旧 bootstrap/注册/schema/角色安装槽及历史记录保留。
- 8新＋16相邻共24测试、typecheck、定向 lint 0 warning、CLI syntax通过。没有运行隔离数据库 fixture；这些测试不是实际 Neon 写入或受限运行时验收。本轮共4次只读连接/事务，Neon写/AWS调用/Secret值读取/Invoke均0。

下一步：用户确认此 SHA 和完整风险后，仅运行一次准确事务并独立 Inspect。之后仍须在 AWS 控制面锁定期完成 runtime reader 的准确 `$LATEST` ARN/null Layer 修正、固定 gate-capable 最终包和异步配置，再另审 RESERVED/最终 IAM-table窗口/parent登记和实际门禁调用；当前无自动部署许可，不 ARMED/PAID。
