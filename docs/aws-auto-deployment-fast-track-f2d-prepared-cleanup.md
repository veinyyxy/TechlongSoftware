# F2d：prepared service 接线与正常清理闭环

2026-10-07：完成显式 prepare-v2/正常 cleanup journal、真实 SQL service 组合、部分 prepare 恢复、准确正常清理和下一代命名空间释放。在隔离 PG16.14 TLS/SCRAM、非 superuser cell_admin 上跑通 service 的 prepare→restore→migrate→verify→destroy，并确认旧清理重放不删除第二代。本轮没有源 PG15、AWS 或 Neon 写入，runtime 和生产 baseline 批准仍 false。

## 修复的真实阻断与显式升级

旧 `tenant_lifecycle_registry.sql` 用完整 stable_identity 的截断值约束 ownership/provision/cleanup marker，但真实 parsed task 使用独立 stableIdentityHashPrefix。隔离实例里实际 INSERT 被 `23514` / `techlong_tenant_lifecycle_registry_cleanup_ck` 拒绝，旧表仍零记录。此发现不是 IAM/MFA 问题；不再用新 Grant generation 诊断它。

旧 registry、DDL、旧 production inspect/cleanup-only destroy factory 保持不变。新代码采用 additive `tenant_normal_cleanup_journal.sql`，将 hash_prefix 和准确 database/role OID 独立保存，FK 绑定原 prepare record；初始只能 destroying，fence 不可改，deletion flag 只有准确 OID 在 pg_catalog 中已 absent 才可推进，destroyed 不复位、记录不可删除/截断。新增 REFERENCES 权限是显式 FK 依赖，不授予 tenant role 或 PUBLIC。

`tenant_prepare_release_gate_v2.sql` 是单独显式升级：只调整两个 active index 的 predicate 和 table version comment，不更新或删除原 prepare rows，不改变其终态 guard。原 prepared record 永久保留；新一代必须是同 stable identity/hash_prefix、更大 generation，并逐项匹配所有旧 completed slot 的 destroyed cleanup tombstone/OID/旧 provision fence，才可新建。compensated slot 也不可复位。没有 SQL 下迁移或自动升级云端。

安装顺序：准确 v1 prepare catalog readback → 新 cleanup journal（含显式 REFERENCES）→ release gate v2 → 两项完整 catalog readback。旧 v1 provider 默认仍固定 v1 指纹，新 prepared composition 明确选择 v2；不接受调用方自报 hash 或环境变量切换。后续实际云安装仍须把这些 SQL/权限/目标列入新的 fresh SHA 审阅。

| 项目 | 完整 catalog SHA256 |
| --- | --- |
| prepare v1（保留） | `437c901ffaa790c57318f7de874567ae80993becd6dc0430b0911b734860c7da` |
| prepare v2 | `7d08fae04b5e77a55085ccf4b4e06d44fa41a49e1dcc3630673fa31535113612` |
| normal cleanup journal | `847a45554decbb5cb951d58fa290d2991d749e9b5b9fc8a0b21772f40c952f24` |

## 实际执行边界

`createPreparedTenantLifecycleComposition` 将既有 prepare/restore/SaaS SQL provider 和新的正常 cleanup 接到独立 prepared service。完整五键 Secret 在 callback 内校验，数据库模块只收到 database_url；session source 只收到已解析输入/信号，不获得 JWT/HMAC/支付值。session source 必须可信并管理连接完整生命周期；普通错误被脱敏，不回传原 provider diagnostics。

只有封闭 composition 创建的 branded port 才能使用新的部分 prepare 恢复路径，默认 TenantLifecycleService 和旧 CLI 的 partial-state 拒绝不放宽。恢复依靠准确 journal/guard/OID，不根据部分观察猜测 ownership。restore/migrate/verify 即使同 epoch marker 已到目标状态，也实际调用 SQL provider 重验；v2 journal、当前 cleanup claim、准确 connected backend OID 都在同一 management lock 下核对。旧 epoch 不自动采用。

正常 cleanup 先匹配完整 older provision predecessor、准确 prepare row 和现存 ownership/OID/NoLOGIN/closed ACL，再持久化一次 destroying claim。先 DROP 准确 database，再保存数据库 checkpoint；DROP 准确 role 与 destroyed tombstone 在同一事务。无 FORCE、wildcard、DROP OWNED 或 REASSIGN OWNED，活跃连接/外部依赖不是自动扩大删除范围的理由。[DROP DATABASE 约束](https://www.postgresql.org/docs/16/sql-dropdatabase.html)、[DROP ROLE 依赖/权限](https://www.postgresql.org/docs/16/sql-droprole.html)。

任何 cleanup claim 都永久阻止该 generation 再次 provision；未完成清理阻止后继创建。terminal replay 只证明旧准确 OID 全局 absent，不把新 generation 的同名资源当作旧对象，也不删除它。改变 cleanup epoch/hash 不当作同一次恢复。本协议仍信任遵守锁/代码的数据库管理账户，不防御恶意拥有完整数据库管理权限的操作者。

本批次 cleanup 明确只支持当前 SQL-only NOLOGIN/owner-only access 状态。不能直接清理未来已 LOGIN/授权的运行账户；其停止接入、权限退役、应用连接处理和回读属于下一批显式策略。prepared metadata 的 runtimeEnabled 恒为 false，且默认 production CLI 没有接入此 composition。

## 真实证据与继续位置

最终目录 `F:/ChatGPT_workshop/techlong-pg16-lifecycle-cleanup-20261007-f2d4`，收据 `cleanup-receipt.json`，SHA `5b1d172de6496adb54494f42459d4cc95a6393d7a03d6d4e5ecc8bf969a8419d`，结果 `PREPARED_COMPOSITION_CLEANUP_REAL_PG16_VERIFIED`。

实测：旧 parsed prefix mismatch；准确部分 CREATE 响应丢失后 service 恢复；四项 SQL command 及真正的 verify replay；未释放 generation2 拒绝；DROP DATABASE 成功但响应丢失后永久 claim 保留且 generation1 provision/generation2 create 均拒绝；role-drop/terminal COMMIT 成功但响应丢失，恢复只读证明 already_missing；原 prepare row 保留 prepared；同命名空间 generation2 创建准确新 OID；重放旧 cleanup 后新数据库 OID 不变；不同 cleanup epoch 拒绝；源会话普通 diagnostics 脱敏；独立只读 psql 验永久两项 prepare、一项 destroyed cleanup、旧 OID absent、新 role NOLOGIN、旧 registry 零记录；终态复位拒绝。

本地第一代 database/role 已实际删除，原 OID/对象不能还原；源 schema archive、永久记录和第二代隔离资源证据保留，可按新 generation 重建。没有删除开发源库或云资源。本轮四个新 cluster 都由独立 pg_ctl status 证明停止；f2d1 缺 REFERENCES 的失败、f2d2 catalog 校准、f2d3 首次完整成功和 f2d4 最终脱敏复验目录保留，不覆盖。私有 archive/SQL/manifest/key/cluster/原始收据不提交 Git。

70 项 Node 新 composition/cleanup 与相邻回归、28 项 Python baseline/profile 校验、backend typecheck 通过。下一批：应用授权/LOGIN/真实登录与对应安全清理策略，固定 RDS endpoint/CA/管理 Secret 的 owned-session factory、CLI/receipt/镜像接线；随后集中 F3 云端权限/资源/费用验收。实际 baseline 批准/上传、数据库升级、IAM 安装、付费 Cell 执行和不可恢复删除仍各按 fresh SHA 批准；预算目标 50 USD/月，不重放过期 Grant。
