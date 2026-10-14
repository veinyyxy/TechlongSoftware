# D002 C3e：准确租户库PG17目录门禁的窄只读诊断

当前唯一待审已刷新为872e3027...，Source恢复后的Review/独立metadata通过，SQL/槽仍0；范围、源码和历史pins不变，旧d82c与停止回执保留。[新SHA、截止和准确继续点](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-refreshed.md)。下段停止/准备状态为历史，不因刷新自动重试SQL。

此d82c清单已获批并尝试一次，但Source凭据不可用，停在READ_ONLY_METADATA，SQL/写/槽消费全0。停止回执保留，槽仍空；刷新后先仅生成新fresh清单/独立metadata，再按新SHA确认SQL，不自动重跑。[本次真实停止与准确继续位置](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-stopped.md)。以下待审准备状态保留为历史。

2026-10-14 America/Winnipeg。承接[C3d已提交续建及恢复拒绝](./aws-auto-deployment-aurora-dual-mode-c3-continuation-executed.md)。本阶段仅编码、必要检查、现有AWS元数据核对和待审准备：**SQL连接/写、新槽消费、AWS资源写均0**。不重建数据库/guard，不重放restore，不放宽校验、不回F3c9。

## 新待审SHA及截止

`d82c6da5acc1fbbf2840c70b7ffa49bfa991eb020dd900bd84dc2751a40951bd`

生成：2026-10-14 13:31:05.518 UTC / Winnipeg08:31:05.518 CDT；截止：**2026-10-14 19:31:05.518 UTC / Winnipeg14:31:05.518 CDT**。过期不执行或自动延长，Source刷新不授权SQL。

私有清单 `F:/ChatGPT_workshop/techlong-d002-express-c3-catalog-review-20261014-r1/manifest.json`，Review仅5次直接元数据调用。独立新进程 `...-c3-catalog-metadata-20261014-r1/facts.json` 于13:31:40.823 UTC另5次直接只读；除observedAt外，Source/准确cluster-writer/FREE-ACTIVE/连接模拟与Review一致。facts字节SHA `f4d3ac4ef833b2dc6b3be59e2ba8a46ca11ce65f56f67506a0c72d6194b245b5`。结论 `PHYSICAL_ONLY_TENANT_CATALOG_NOT_REOBSERVED`；不声称当前SQL目录已核验。

## 一次批准的精确范围

- 原准确cluster `techlong-sandbox-express-d001`、resourceID `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`、PG17.9/gateway/IAM及writer身份/tags/0–1ACU/300秒pause保持。不改AWS配置或权限。
- 使用既有Source管理员的内存AWS Login snapshot（至少余5分钟、同份STS核对），通过原受审TLS/IAM transport连接管理库postgres/OID5和准确租户库 `tenant_a0da1748bc4d5419_db` / **OID16459**，两连接均postgres/OID16410。不取Secret、不使用app凭据。
- 两连接总计最多**9次固定query**：每连接各一次原身份查询、各一次 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`；管理连接一次原owner目录查询；租户连接一次只读上下文/库大小/元数据表数查询、一次原PG17目录查询；各一次COMMIT。没有锁、DDL、DML、迁移或业务表SELECT/COUNT；仅pg_catalog元数据，**业务表查询0**。
- 管理目录继续调用同一严格V4 promotion policy：app准确OID16456/NOLOGIN/零成员/原nonce及ownership，guard缺席，库OID16459准确所有权/ACL/连接状态。漂移即停止，不接管对象。
- 租户目录复用原 `PG17_CATALOG_SQL` 和**未改的原 `verifyPg17Catalog`**，报告17组安全/结构谓词及当前拒绝项。新解释器只是解释，聚合结果必须和真实原校验器一致；不一致即停止，不放宽门禁。
- 原73表名单直接来自字节SHA固定的空baseline manifest；其生成row-count SQL的SHA仍匹配原pin，但**不执行该SQL或业务读取**。无需重导出、重编译或上传归档。
- 原完整catalog包含函数定义、列default/ACL等，只在内存处理和hash；保存原catalog SHA、字节/对象数量、谓词、少量安全owner/ACL摘要，未知名称hash化，不落原函数体、config或业务内容，不自动学习ready指纹。
- 新独立永久槽 `techlong-d002-express-c3-pg17-catalog-diagnostic-v1.permanent-slot.json` 在第一连接前消费，最多一次Run，max2物理连接/max9query/120秒pair group/30秒connect/max9直接metadata；后置只读回核准确cluster/writer和Source。原C3b/C3c/C3d全部槽和原件保持。

## 结果如何用于主线

当前完整schema若仍留存，诊断报告原校验器的实际拒绝项；若恢复事务已被关闭且当前目录为空，只报告 `CURRENT_TENANT_CATALOG_EMPTY_ORIGINAL_REJECTION_NOT_RECONSTRUCTED`，不把空目录的缺表/缺extension条件冒充原失败原因，也不反推已证明回滚。不会为得到“原失败目录”而自动重放DDL。

诊断后先明确当前真实状态，再结合原固定DDL/verification和报告准备**保留库OID16459的窄恢复候选**，恢复事务中保存逐谓词安全结果，避免再次丢失关键原因。任何restore/迁移、校验模型更改、app登录授权、Secret/IAM或ECS仍按新的具体范围审阅。不是新的通用探针/Grant工厂或Cell生死支线。

## 完整风险

1. Source为既有管理员，不是应用/runtime或新最小权限账户；只读事务和固定query白名单是本地执行约束，不新增服务端权限边界。
2. 连接可能唤醒现有集群产生ACU/I/O费用；50USD/月是目标不是hard cap，库/cluster继续留存，没有自动cleanup。
3. 管理与租户是两个独立repeatable-read快照，OID/owner检查和前后metadata不是跨服务CAS；并发特权管理员可改变对象或权限。
4. AWS/数据库/提供者可记录连接/SQL元数据；完整schema定义在进程内存处理，JS/driver/token清零尽力而为。不输出token、原驱动文本、原函数体、config或业务数据。
5. 当前目录可能为空或与原未提交失败目录不同；这次只读不能保证唯一解释原异常，也不能证明历史COMMIT/rollback或未来PG17兼容性。不会为诊断重放结构写。
6. 原目录查询需扫描元数据/获取对象定义，异常巨大/不兼容目录可能超时、SQL报错或被大小门禁拒绝；错误回执只保留阶段与安全码，证据仍可能不完整。
7. 新槽在连接前永久消费，网络/凭据/超时/文件保存失败也不自动补齐、回滚、复位或重试；此清单没有第二次SQL Inspect许可，后续额外连接需新具体范围。
8. 解释器必须与原冻结校验器一致；观察通过不安装新fingerprint，不代表app LOGIN/隔离/Secret-v2/真实应用/ECS/ready验收通过。
9. 不修改表/角色/ACL/guard，不安装schema/迁移，不读Secret，不改IAM/Neon/业务，不创建资源/付费Cell，不调用Lambda、清理或启用运行时。成功或失败均保留所有旧记录。

## 代码和必要验证

新增仅平台本地Root与纯诊断模块，服务端源码/镜像/原restore V3/V4不改。新226 code entries+原2工具，原224/212/183pins保持；code binding `91a2c8e1ce994e607a709ac90b2a827f0bd6cb9cfcba67e6eff5f84b527d38db`，history `783a896da1af5d3379c33c93e5fb776a1913a6ff66b2e840d121dafeae0b1b96`，历史绑定C3d七份真实收据/槽的字节SHA。

目录SQL原pin `d350ab918b31a3a16aecb998fedfa4ec379c5dfd2b84148962174d6e097c4f24`，owner SQL `ca3221db43d205b75769ae159cbea8b459e0040af1d3dc6db7de8ca1c1f59635`，context SQL `47212f27b4ab719b7d0f68a537b1705d5a23a6f9f4edbc14166e773b0d2da176`，73表名单 `b46962c25ec64238fbcc27754a9a69885c3c73e407f10fc547d0033434b929a7`。

- 4新检查调用真实未改原校验器，17组逐项拒绝一致；空目录/unsafe上下文、原始敏感文本不落收据、exact fresh SHA/过期/重签扩大scope拒绝通过；另5个相邻检查通过，总9项。typecheck、syntax及定向eslint无warning。
- 实际Root错误SHA负例 `...-c3-catalog-negative-20261014-r2` 返回 `EXPRESS_C3_CATALOG_FRESH_APPROVAL_REQUIRED`，AWS/SQL/槽全0；stopped字节SHA `d54b331be8ab754104d39f2ed34f143044075a1cc49e5a858948298dfd11361a`。初r1在受限sandbox本地历史读取阶段STOPPED，亦全0，但不将其当SHA门禁证明；两份原件保留。
- Review和独立metadata各5直接只读通过，SQL0，新槽未消费；不把这当目录实机证明，不重复Backend CI/镜像/原归档编译或ECR发布。

## 唯一继续点

用户确认本SHA及只读范围/完整风险 → 有效窗口内一次新Root Run → 依据真实目录观察收敛窄恢复方案。原87c/8758/角色诊断入口与已消费槽不能重放。仅“开始下一步”授权本轮编码/准备，不授权SQL诊断、安装或恢复。[紧凑继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3e-catalog-diagnostic.prepared.json)。
