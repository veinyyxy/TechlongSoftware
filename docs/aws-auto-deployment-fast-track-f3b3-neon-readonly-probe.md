# F3b3：Neon TLS / 密封 v3 只读探针已准备，未执行

> 本文保留准备时清单。2026-10-11 批准后已一次更新代码，但 RevisionId 后置门禁停止，未调用；候选代码经两次独立回读确认就绪，新槽位已消费，禁止重放或补调。当前状态见[实际安装、差异和下一步](./aws-auto-deployment-fast-track-f3b3-neon-readonly-installed.md)。以下不是新的执行授权。

2026-10-11 Winnipeg。上一阶段 KMS 修正已通过实机 Secret 读取和独立日志核验。本阶段新增独立的只读探针/构建/Review-一次 Run-Inspect 入口，**没有更新或调用 Lambda、读取 Secret 值、连接 Neon 或写 AWS/数据库**；旧 p2 包、KMS/安装代码 binding、所有已消费槽位及记录保持。

## 本次拟执行的准确范围

仅现有 `arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-ttl-executor-v3`：

- 一次 UpdateFunctionCode，原 RevisionId **0ce68252-11fe-4cd8-9fc6-9fdc1ec44e9f** 服务端比较，Publish=false。用内联 ZipFile，不上传 S3、不创建版本/别名/函数，不改配置/日志组或标签。
- 更新就绪与全 anchor 只读核对后，一次 RequestResponse Invoke，固定新 action/nonce；不执行旧探针 action，不因负面结果或日志缺失补调。
- Lambda 仅使用现有 `TechlongSandboxCellTtlExecutorRole` / `techlong_cell_cleanup_reader` 和自身固定 Secret UUID/AWSCURRENT。在内存读取数据库 URL、完整已密封证书及 pin；Source 不 GetSecretValue。
- 经 Neon 官方 serverless **HTTPS/TLS** 驱动只提交一个固定十查询批次：原生产 source-v3 九条 SELECT + 一条 PostgreSQL 实际事务设置 SELECT。只读、Serializable、Deferrable，并要求服务端回读三项设置准确；search_path=pg_catalog、row_security=off 是事务本地设置，不是业务数据写入。
- 核对准确环境、受限 reader、无 owner/table/column write/非 trigger definer 能力、完整密封证书、原行/plan hash、保护 catalog/body hash、原件可见性及关联集合。只返回闭合布尔/计数/门禁，完整原行、URL、密码或 SQL/provider 原始错误不返回/落盘/日志。
- 独立 Inspect 只读回读更新后的代码/配置/IAM/Key/Secret 和既有调用的分页云日志，匹配 functionArn/requestId/nonce/完整响应 SHA。

这不是直连 PostgreSQL TCP/5432 的 TLS 验收；官方 `neon()` 走 HTTPS fetch。驱动端请求必须是准确 Neon API `/sql`、固定 SQL/参数、只读批次 headers，禁止重定向和第二次 fetch；TLS 使用默认平台证书校验，不关闭验证、不改 endpoint 回退。[Neon 官方驱动](https://github.com/neondatabase/serverless/blob/main/README.md)、[事务与 fetch 配置](https://github.com/neondatabase/serverless/blob/main/CONFIG.md)。Lambda 代码更新使用 RevisionId 防止覆盖已变化函数。[AWS UpdateFunctionCode](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionCode.html)。

不改 drain 函数、IAM/boundary/inline、Key/Key policy、Secret/密码/版本、Neon 角色/GRANT/schema/业务原件、admission 状态、authority、Cell/ECS、Schedule 或默认 Worker。没有 drain UPDATE、DeleteStack、数据库写或运行时启用能力。固定 IAM 读取范围复用已批准 KMS v2。

## 保留真实前置门禁，不伪造清理条件

生产 `NeonSealedCellOwnershipSourceV3` 原文件不改，仍要求真实环境 draining、完整到期/前驱信息及全部保护证据。探针实际调用这个 source，提交的九条 SQL 必须逐字一致。

若 source 因 admission=open 拒绝，探针在同一批实际结果上独立核对受限角色/完整证书/catalog/原件/关联，报告 `ADMISSION_NOT_DRAINING`；它**不是 certified v3 ownership/deletion proof**，不把原状态改成 draining。只有 source 本身完整校验通过才报告 `CERTIFIED_V3_SNAPSHOT`，但该状态也不授予删除、authority 写或业务 runtime。其他 source/query/保护错误均不验证。没有真实 Cell/到期前驱时不生成假 authority，不将历史计划原件删掉或取消。

本阶段 Review 未读取 Neon，所以不声称当前 admission 状态已在线确认。之前的历史记录仅供继续位置，不替代本次实机查询。

## 一次性边界与风险

新永久槽位 `techlong-f3b3-readonly-neon-sealed-probe-v1-consumed` 当前空。Run 必须 fresh SHA/17 文件 code binding/候选字节/前序 KMS 回执+新进程核验完整匹配；调用前更新响应 RevisionId、代码、全 anchor 和批准时效再次检查。UpdateFunctionCode 是服务端 RevisionId 比较；其他 IAM/metadata 检查不是跨服务 CAS，不能消除并发变更。

最多 **1 次代码更新 + 1 次同步 Invoke**；每次 API 前永久 attempt 落盘，未知更新响应或消费后只允许 Inspect。只读就绪轮询不提交第二次更新或 Invoke。不自动恢复旧代码、撤权、删除、补齐、复位或重试；更新失败/调用失败可能留下新代码而未完成验收，需后续单独审阅。外部已有调用主体可额外 Invoke，本地槽位不能全局排除。

数据库 URL/密码只在 Lambda 内存和加密 HTTPS 请求中传送到 Neon；不能保证 JavaScript 字符串清零或提供者服务端日志绝不记录。HTTP 中止不保证远端已提交的只读查询立即取消，可能唤醒 Neon 计算或产生请求/Lambda/Secret/KMS/日志费用；50 USD/月仍是目标，低成本但非绝对零费用或硬上限。

## 候选、验证与真实 Review

16 项定向测试覆盖闭合响应/错误脱敏、实际 Neon 驱动的固定批次与单 fetch（网络明确 mock）、服务端设置/证书/权限拒绝、fresh SHA、永久槽位、失响应/RevisionId 漂移和 marker 失败不补调；另 6 项相邻 source-v3 回归通过，共 22 项。typecheck/lint/三脚本语法通过；没有重复 Docker/PG/GHA/镜像演练。测试不是实机 Neon 证明。

私有候选 `F:/ChatGPT_workshop/techlong-f3b3-neon-sealed-artifacts-20261011-p1/`：报告 SHA `698e4be0150598920e7d63b89900600bdbbcf7ccf31b599945f0e280020cc8a0`，ZIP **0f2330afbef3e801faf3645f96610d293349705743ae0748de22198391a25533 / 277794 bytes**，bundle `efea52b1b6194bf2c8b0c596d69545a514e479ced128fa211740d054a5f55ed4`。自包含、两次构建/ZIP 回读/无凭据 invalid event 启动通过，不含业务 drain/delete/DDB/CF/ECS/S3 root；未上传。package/lock 未改。

首次入口加载发现新 helper 引用了未安装的 hash 包，未创建 Review 目录/访问 AWS；改用仓库已有 `@smithy/core` 导出，不新增依赖。随后 r1 只读 Review 在 **2026-10-11 15:36:52.712 UTC** 开始 inventory，完整集合 12.158 秒内完成；准确 KMS v2/两 inline、原两函数/日志配置/Secret 初始版本/Key policy 与前序 anchor 一致。Source 精确 UpdateFunctionCode/InvokeFunction 两项模拟 allowed，仅预检，不是实际更新/调用证明。

## 当前待批清单

`F:/ChatGPT_workshop/techlong-f3b3-neon-sealed-review-20261011-r1/review-manifest.json`：

- manifest SHA：**c3635097594bdd1443fe4cf814507da14a33ab4723c668ab7a068b5e1cd756f1**。
- 文件 SHA：`87820a45595a171ca9253d8a4f2da0842b90e114bf451e9c2ec0b330320d546f`。
- 17 文件 code SHA：`d7919f4aa2827b89276198d731c2e2f444d88b4165a7c52a81c3e58d6c172aba`。
- stable anchor SHA：`3d373a6602d2bbcc111b8879ffa37385ef5a7ce74d9bbad1f7390dbe18d5689a`。
- inventory 文件 SHA：`1b5c73b66aafead1213eef7d4410f5e28284489d6047da92bdaaa1a9ba8e2b6c`。
- 截止：**2026-10-11 16:37:04.870 UTC / Winnipeg 10月11日 11:37:04.870 CDT**。过期仅只读 Review 刷新后另确认，不执行旧 SHA。

> 我确认按清单 c3635097594bdd1443fe4cf814507da14a33ab4723c668ab7a068b5e1cd756f1，仅一次更新现有 TTL 只读探针代码（RevisionId 比较、不发布版本、不改配置），一次同步调用，通过自身固定 Secret 的 reader 经 Neon HTTPS/TLS 提交一个固定十 SELECT 的只读 Serializable Deferrable 批次并独立核验；不改 drain/IAM/Key/Secret/密码/Neon schema或业务数据/admission/authority，不建 Cell/ECS或启用业务 runtime。接受代码更新非原子与并发/传播风险、提供者日志及远端只读查询可能继续、额外外部调用、失败可能留新代码、永久新槽位不自动回滚/撤权/删除/补齐/复位或写调用重试，以及低成本非零费用。

确认后仅一次 Run，然后新进程 Inspect。任何失败禁止重新 Run 或补调；依真实回执记录 TLS/保护验证与 admission/source gate，不能把 preflight 成功当 F3/F4 自动部署完成。
