# D002 C3f：同库恢复停止，已捕获准确扩展所有者差异

2026-10-14 America/Winnipeg。用户确认清单 `a5c79b93a0afdf19849ba02e76feb310743f76adeeae64b5aae7de2efa55c632` 后，一次 Run 已停止，并立即完成一次独立只读 Inspect。**未完成恢复验收；原双槽永久消费，不可重放。** 本轮后续只保存文档和安全收据，未修改冻结校验器、SQL或权限，没有自动写重试。

## 实际结果

- 准确现有库 `tenant_a0da1748bc4d5419_db` / OID16459，owner postgres/OID16410、app role/OID16456 保持；没有 prepare、建库、建角色、成员授权或 guard 删除。
- 写前原 EMPTY 门禁和同事务目录检查通过：449字节空目录 SHA `56f65c613ba62ada90240b72679ca0323b3e0b8414f85b25f6263d360be5b0d7` 与批准前观察一致，随后派发一次原固定 schema restore。
- 原恢复事务的 baseline 目录已在校验前保存：SHA `868ca1351fc83ae6d202dfc1539345c63b39c21e82c0194bef402b7b3f9e223e`，741,911规范化字节，73表条件通过；目录包含276 relations、15 functions、一个 extension、146 types，无用户 collation/event trigger。
- 真实冻结校验器17组条件中，**只有 `uuid_extension_version_schema_owner` 拒绝**。唯一扩展为 `uuid-ossp`，版本匹配、schema匹配，实际所有者 **`rdsadmin`**。其余16组通过，安全对象拒绝列表为空；不是连接/MFA错误，也不是表数、函数ACL或PUBLIC schema ACL拒绝。
- journal 在 baseline 报告后保存 `AURORA_V3_PG17_CATALOG_REJECTED`；Root外层为 `AURORA_V3_SESSION_FAILED`。没有 migration/final/COMMIT成功记录，没有 Run result/schema成功收据。冻结控制流在此拒绝，不继续两迁移，未授权修正门禁或另一次写入。
- 独立 Inspect 为 `PARTIAL_TENANT_CATALOG_OBSERVED_NOT_ROWS_VERIFIED`：准确 owner policy通过，管理目录 SHA `30c1559c488e1885d59a4c897f3966450fff28a943637f0887133faecf582553` 与此前一致；目标库当前用户对象仍全0，449字节完整目录 SHA仍为上述 `56f65...`，public schema owner/ACL正常，物理大小9,069,811字节。
- 此次回读证明**观察时覆盖的用户目录为空**，不是完整业务行数/九seed/历史COMMIT或rollback证明；未安装结构pin、ready fingerprint、应用LOGIN或运行时。

## 时间、调用和永久槽

时间同时保留 UTC 和 Winnipeg CDT（UTC−5）：

| 事实 | UTC | Winnipeg |
| --- | --- | --- |
| Run槽消费 | 15:33:23.593 | 10:33:23.593 |
| restore INTENT | 15:33:45.687 | 10:33:45.687 |
| 写前空目录保存 | 15:33:46.186 | 10:33:46.186 |
| baseline目录保存 | 15:33:50.147 | 10:33:50.147 |
| 原校验拒绝 | 15:33:50.287 | 10:33:50.287 |
| 独立Inspect槽消费 | 15:34:16.078 | 10:34:16.078 |
| 独立当前空目录保存 | 15:34:17.754 | 10:34:17.754 |

Run：2物理连接、13次pg query、6次直接metadata，schema写已派发；`attemptConsumed:true`、`sqlEffectsMayHaveOccurred:true`。Inspect：2连接、9次只读query、9次metadata、写0。query计数不是DDL语句数。两模式 AWS资源写0，不改 IAM/Secret/Neon/ECS/F3c9，不新增收费资源；现有cluster仍可能因唤醒、存储/I/O产生费用，50USD/月是目标而非hard cap。

原首次启动请求曾被自动安全审核拦截，脚本未启动、槽未消费；用户再明确确认完整SHA与范围后才启动以上唯一一次Run。此入口拦截不计作SQL尝试、不构成自动重试。

永久槽均保留：

- `F:/ChatGPT_workshop/techlong-d002-express-c3-restore-only-v4.permanent-slot.json`
- `F:/ChatGPT_workshop/techlong-d002-express-c3-restore-only-v4-inspect.permanent-slot.json`

## 安全证据及字节SHA256

私有 Run目录 `F:/ChatGPT_workshop/techlong-d002-express-c3f-run-20261014-r1`，独立 Inspect目录 `F:/ChatGPT_workshop/techlong-d002-express-c3f-inspect-20261014-r1`。不上传归档、原函数体或凭据；以下仅本地安全收据的字节hash，非源码换行规范化hash。

| 文件 | SHA256 |
| --- | --- |
| Run stopped.json | `66be39eece50db5d1eef3dbac383a2530b14aae9826ff08357ea6a7ee5a9433d` |
| Run stages.jsonl | `d25d9353413a30d529aa61752c38c8ad2ff8912b4b49976f2c9dc7435fdaec60` |
| Run prepared.json（原C3d收据副本） | `59d8b5af4ab581fcc26d194346eb24917d5aa21735f6c0127e0e91d671c86d0a` |
| Run catalog-empty-before-write.json | `014f33113a62eb1190242b6a3a03e83aa917f2b78f1a846203f1fc0318df5e8d` |
| Run catalog-baseline-before-verifier.json | `f19b0f2c4a1c7698de9b39e579e70358d114a280e3896eb17e2c0df0aee1ade2` |
| Inspect result.json | `57b9cd516b03c504a05fb7d7d156799e544876e2629ffa23bc405206637d2f87` |
| Inspect schema.json | `d1170c082c70a9300c2cea841dacc9d735b93b15fe445ecd697f8d987d1b4f0e` |
| Inspect stages.jsonl | `9627401467cf0921f040d9d7dd9194ae55c380e67d5f15c25c7410e8601a999c` |
| Inspect catalog-independent-after-stop.json | `dea8c3648980b1efc26eee72c5b1412246573d698f26c19606ca3459104a4f35` |
| Run永久槽 | `1c16f85522fe03296b9ccbb158e38fd6abe1c1296b42305819cd7b2cb2e6ec27` |
| Inspect永久槽 | `45dd8906255f9f6f068c3aaa7a3368a6d72c66e4d1560914427e4bb2d77b23d5` |

229项code entries、原226/224/212/183和两原native工具保持，code binding `277ae66e812dde07027ab9391dc21c98469e54b6bef5968cf8a3123e370e4239`，history `da9bb6d8a78c1c6f65f35ce83eba971ed0bf5181878b97c334c960bb2752ce8c`。每个进程实际编译原archive/验证私有brand，SQL identity仍 `55733716d897ee5cdcd80abffb85c277ca148b4d7c3af5a8d199a4f7fd5bbfa4`。Backend执行源码仍 `62010acfa7006bb5d03045591d6d3f37d70dfab8`，已有CI/镜像保持；本轮无需重建/ECR发布。用户 `.vscode/settings.json` 不提交。

## 唯一后继：准确所有者模型的窄兼容修正

不再为相同失败做SQL目录探针，不重建库/角色/guard，不回Grant或F3c9。下一阶段仅以这份**实际baseline目录**为依据，审阅 `uuid-ossp` 在当前 AWS PG17目标由 `rdsadmin` 所有的窄兼容模型：保留准确扩展/版本/schema、全部函数/关系owner与ACL、安全和73表/九seed门禁，不能全局放宽owner、学习未知对象或自动安装ready pin。

实现与必要定向验证后再准备新的同库restore-only清单；如执行源码改变，受影响云端自检按需重新验证。**本轮并未实现或批准该修正，更没有批准第二次SQL尝试。** 下一实际恢复仍需绑定本次报告、空目录hash、准确OID与新永久槽的fresh SHA单独确认；旧a5c7、旧Run/Inspect槽绝不重放，所有旧记录保留。

[原范围与完整风险（历史）](./aws-auto-deployment-aurora-dual-mode-c3-restore-only-review.md) · [紧凑真实结果/继续位置](../ops/aws-sandbox/reviews/aurora-express-c3f-restore-only.executed.json)
