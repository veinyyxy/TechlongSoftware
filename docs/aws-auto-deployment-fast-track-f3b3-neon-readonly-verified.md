# F3b3：Neon TLS / 密封 v3 只读验收通过，清理门禁仍保持

2026-10-11 Winnipeg。用户确认清单 `76cadd00835f523d4cd63e2052ccd08badfe25af299dff7bb77b62b7bab76b1f` 后，在有效期内一次 Run 完成 **1 次新的同步 Invoke，代码/配置/权限更新=0**。返回 `NEON_SEALED_READONLY_PREFLIGHT_VERIFIED`，Run 后 Inspect 与新进程 Inspect 均为 `NEON_INVOKE_READONLY_PREFLIGHT_AND_LOG_VERIFIED`，`readProofVerified=true`。

**真实 Neon HTTPS/TLS、受限 reader、只读 Serializable Deferrable 事务及密封原件/保护读取已通过。** 这不是业务运行时或自动部署上线，也不是 certified v3 ownership / 删除授权：实际 sourceGate 为 `ADMISSION_NOT_DRAINING`，环境仍 open，按原设计保持，不改成 draining、不生成假 authority 或删除能力。

## 本次真实调用

准确函数 `arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-ttl-executor-v3`，requestId **a0617cd0-2321-44cc-8b40-ad23c0fcde09**，固定新 nonce `41ebf0acff83ac5fe225963c32c2ca9368da3419627b46d83eeb0c2da63615d6`。仅这一次调用，无补调、SDK/HTTP 调用重试或代码更新。

Lambda 使用自身既有 Secret 的初始 UUID `3f8047d4-e357-4d32-ae87-861fda5f8253` / AWSCURRENT，在内存校验 reader URL、完整注册证书和 pin，再向 Neon HTTPS API 提交一个固定十 SELECT 批次；Source 未 GetSecretValue。真实返回：

- `tlsReadVerified=true`、`transactionSettingsVerified=true`：数据库实际事务为 read_only=on、isolation=serializable、deferrable=on，search_path=pg_catalog、row_security=off。
- `limitedReaderVerified=true`：准确 `techlong_cell_cleanup_reader`，非管理员、无 owner/public schema 创建/table/column write/非 trigger definer 执行能力，既有 source-v3 权限围栏通过。
- `sealedCertificateVerified=true`：完整注册证书、永久 fence、原行/plan hash、保护 catalog/body hash、原件可见性和关联集合通过。原历史计划/实例/订阅保留，不改业务原件。
- `queryCount=10`、`sourceGate=ADMISSION_NOT_DRAINING`，不是 `CERTIFIED_V3_SNAPSHOT`，不会授权 drain、authority 写或删除。

只返回脱敏计数：rawActiveTenants=1、rawNonterminalDeployments=1、capacityReservations=0、liveResources=0、cleanupSchedules=0。这些是**原始读取数量**，不可冒充已排除密封历史记录后的 zero-tenant 清理证明。原件通过检查也不等于业务 drain 协议已安装/执行。

`runtimeEnabled=false`、`mutationPerformed=false`、`deletionAuthorized=false`。本轮没有业务 SQL/密码/角色/GRANT/schema、admission、authority、IAM/Key/Secret、Cell/ECS/Schedule 变更，也没有 Source 密码/URL/SecretString 或原始 provider/DB 结果落盘或提交 Git。正常调用仅写自身已有 7 天保留日志组的日志流/日志。不能保证 JavaScript 清零或提供者服务端日志绝不记录已加密传输的凭据；已批准风险不被取消。

## 两次独立核验

Inspect 观察起点：

- **2026-10-11 16:38:10.823 UTC / Winnipeg 11:38:10.823 CDT**：Run 后只读 Inspector。
- **2026-10-11 16:39:18.221 UTC / Winnipeg 11:39:18.221 CDT**：新进程只读 Inspector，无新 Invoke。

两次均准确验证 TTL 已安装 ZIP `0f2330afbef3e801faf3645f96610d293349705743ae0748de22198391a25533` / 277794 bytes、完成态 RevisionId **80270648-9f62-488b-a99c-4d6a86558302** / Active / Successful，以及未变的配置/标签/7天日志、drain 原 p2 代码、两 IAM KMS v2 / inline / 原 v1 / RoleId / 信任和两个 Secret / Key policy。full anchor **33a5f0257d699b689fa0ec4aa4d852ca5f67aba1e19fdc130d5d893fc3280301**、stable anchor **3d373a6602d2bbcc111b8879ffa37385ef5a7ce74d9bbad1f7390dbe18d5689a** 均保持。

两次均在日志第 **3 页** 找到准确 functionArn/requestId/nonce/**完整响应 canonical SHA `c0c3be88233ffb56398e7e78bb0ec113837926277a3455252fc9e1d9d41f1e55`**，`logMarkerVerified=true`。不靠尾部日志、另一轮 Invoke 或仅 HTTP200 判定成功。Inspect 的空 permissionChecks/sourcePermissionsAllowed=false 是未重复权限模拟，不是权限拒绝。

## 留存回执与禁止重放

私有根目录 `F:/ChatGPT_workshop/`：

| 文件 | 文件 SHA256 |
| --- | --- |
| techlong-f3b3-neon-sealed-invoke-20261011-r1-run/submission-receipt.json | 2b21e9481396b30898fdd559049cfc6a400669844de1fb67939744f2e74e6b65 |
| techlong-f3b3-neon-sealed-invoke-20261011-r1-run/independent-inspect.json | 72bac98fa3ef8e9154ff1b2f137849dbd88bb9fc1298bfb183071e9cc25a86fc |
| techlong-f3b3-neon-sealed-invoke-20261011-r1-verify/independent-inspect.json | 2c6c2f25bf6df4eeb88b77c39a247290db2a978a88ac2d1f75be3e8b2b8d86ef |

永久 slot `techlong-f3b3-readonly-neon-sealed-invoke-v1-consumed` 已消费，保留 approved-manifest/invoke-attempt/invoke-response。**不得再 Run、补调、reset、补齐、自动回滚/撤权/删除或调用重试。** `invocationAttempts=1` 且闭合同步响应/独立日志已确认这一次执行；不能据本地槽位保证其他主体全局没有调用。

旧代码更新失败记录/slot、所有旧 KMS/Neon/IAM 槽位均保留；本次 20 文件 code binding **c120e4c6ac87ee80289088fba9f98316eae0641ff003ba55eb4cd6414beff7e3**、旧 17 文件 d7919f4a...、p1 包与函数代码未改。50 USD/月目标不变，不是 AWS 实时费用硬上限。

## 下一阶段

只读供应链与真实 Neon 数据源预检已收敛，**不需要继续重复同类探针或重建镜像**。下一小阶段准备业务 drain/TTL v3 接线与部署门禁清单：复用已核验的固定 Secret/保护证书，区分 admission=open 的部署准备、实际 Cell/provision authority、到期后的 draining/完整 ownership/zero/raw witness 与最终执行权限。不得把这份只读摘要作为 certified ownership 或删除授权。

当前两个函数仍是 probe-only；业务 drain v3、生产 TTL 执行安装/对应能力与真实 Cell 前驱尚未验收。先完成相邻代码/最小角色兼容检查，再把必要代码/权限/数据库状态变更和 Cell baseline/DNS/mTLS/费用范围列入准确 fresh SHA 审批。保持环境 open 与业务 runtime off，不提前 drain 或生成假 authority；后续实际云/DB 修改和付费 Cell 各具体批准。
