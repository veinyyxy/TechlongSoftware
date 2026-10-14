# D002 C3d实际执行：续建已提交，恢复被PG17目录门禁拒绝

2026-10-14 America/Winnipeg。用户回复“确认”，承接[受审范围和完整风险](./aws-auto-deployment-aurora-dual-mode-c3-continuation-review.md)及准确SHA `87c5995ea79c8e7218e33bdc76bc5c98618cd2d486b77319b290d3ce5a26599f`。在18:06:11.476 UTC / Winnipeg13:06:11.476 CDT截止前，原冻结Root单次Run，停止后立即新进程独立Inspect。**两个新永久槽已消费，原SHA不能再次执行。**

## 已发生的结果

- Run于12:38:09.208 UTC / Winnipeg07:38:09.208 CDT消费槽。3个SQL连接、26次pg query、9次直接AWS metadata；Root最终返回 `AURORA_V3_SESSION_FAILED`，没有schema/result成功回执。
- quarantine：12:38:30.332 UTC写INTENT，12:38:31.904 UTC完成OBSERVED。准确租户库 `tenant_a0da1748bc4d5419_db` 创建，真实OID **16459**；app/guard沿用原OID **16456/16457**，没有新建角色或成员。
- promote：12:38:31.955 UTC写INTENT，12:38:32.439 UTC完成OBSERVED。库转准确postgres/OID **16410**所有，关闭该库PUBLIC ACL、写原ownership comment并允许连接；只删除原准确guard/OID16457，其原OID不可恢复。`prepared.json`状态 `NOLOGIN_CONTINUED_NOT_RESTORED`，不代表schema恢复。
- restore-and-migrate：12:38:34.670 UTC写INTENT，12:38:38.327 UTC写FAILED，保留具体安全码 **`AURORA_V3_PG17_CATALOG_REJECTED`**。本次不是身份/MFA连接前失败，而是恢复事务中的PG17目录校验拒绝。
- 独立Inspect于12:39:07.764 UTC / Winnipeg07:39:07.764 CDT消费槽，12:39:09.198 UTC保存result；1个管理SQL连接、4次只读query、9次直接metadata，SQL/AWS资源写0。结果 `PARTIAL_BOOTSTRAP_CATALOG_OBSERVED_NOT_SCHEMA_VERIFIED`。
- Inspect确认准确app OID16456仍NOLOGIN、ownership匹配；准确guard不在返回目录中；准确库OID16459、ownerOID16410、允许连接且ownership匹配。完整目录观察SHA **`30c1559c488e1885d59a4c897f3966450fff28a943637f0887133faecf582553`**，与promotion后的OBSERVED相同。

这次已有**数据库续建/promotion写提交**，不能描述成零写或完全失败未留资源。准确guard已删除，保留库和NOLOGIN app；未删除数据库、未回滚promotion、未复位槽或重试。

## 恢复失败的已知边界

固定V4控制流在恢复SQL、固定verification和73表零行门禁之后、两SaaS迁移之前第一次调用 `verifyPg17Catalog`。26次query与该位置停止相符（prepare14次，restore pair12次），FAILED安全码明确来自目录门禁；未形成恢复事务COMMIT/OBSERVED成功回执，未进入两迁移或九条技术seed步骤。

但安全码合并了schema ACL、relation/function/extension/type等多项拒绝条件，本轮没有保存原完整PG17目录/逐谓词报告，**不能唯一确定哪一项拒绝，也不能把镜像通过当真实PG17兼容证明**。owned transport关闭未成功事务连接，不等于已经独立证实回滚。本次获批的失败Inspect只读管理目录，没有连接租户库，因此73表是否留存、实际对象/ACL及业务/seed行数均未独立核验；不能声称空库或完整恢复成功。

下一步不能放宽校验器、重放73表、重建库或重新创建guard。只需准备一次新范围的**准确租户库只读诊断**，绑定真实OID16459/owner16410/app16456、原nonce、此次prepared/FAILED/Inspect证据和原目录SQL，读取当前对象/ACL/行数边界并输出逐谓词拒绝条件。不取业务内容、不改权限、不安装结构。该额外SQL连接不在已消费Inspect权限内，需fresh具体清单批准；如事务回滚后目录为空，不为诊断重放DDL，先用现有原归档/固定SQL和有限观测说明证据缺口，再审窄恢复候选。

## 私有证据字节SHA256

| 文件 | SHA256 |
| --- | --- |
| `F:/ChatGPT_workshop/techlong-d002-express-c3d-run-20261014-r1/stopped.json` | `6292606affad86c0dc131efbe116064f840bf51ba8dbd0e56631dfe46313a61f` |
| 同Run目录 `prepared.json` | `59d8b5af4ab581fcc26d194346eb24917d5aa21735f6c0127e0e91d671c86d0a` |
| 同Run目录 `stages.jsonl` | `f17f8e3f52684e2f8a5d17da16e4ceffa9b0121d976a797909e0f16d013edf4a` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3d-inspect-20261014-r1/result.json` | `a87a58c108e2c1a48da8aea81016fdbe094f79700020c19b505349b8330707c9` |
| 同Inspect目录 `schema.json` | `958ed32cf65662bd36d1d8299f638482f5371965dcd47e4f0a5a3c268e48e8fc` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-reserved-continuation-v4.permanent-slot.json` | `189b354108a09b7bc368e5b67b7d9568b759911e0671c29a777b526e14a8562e` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-reserved-continuation-v4-inspect.permanent-slot.json` | `05ca613ed663d83e8f9950cabe789b50f88ae20d1be91cadb2328d7399ec1e20` |

执行源码仍是Backend `62010acfa7006bb5d03045591d6d3f37d70dfab8`；224 code entries+2工具、原212/183历史pins、code binding `8f66777769c2cb82b507f5a1362289776d0d1a23ce8892cd0138f853dee0b3ef`、history `fc0091ad2b450bd6b60badb19c4aafaa6c610c9dfdd97ec5fa58aeb1840808db`、continuation program `7676c19f2058b5ceff7dac296f605893f249f8183c384affc24ddd0e7922a8a5` 和SQL identity `55733716d897ee5cdcd80abffb85c277ca148b4d7c3af5a8d199a4f7fd5bbfa4`保持。记录前独立本地校验7项证据字节SHA、224项源码LF-normalized SHA、2工具字节SHA、Run/Inspect相同code binding及计数/OID/catalog匹配全部通过。旧源码/失败记录/槽不改，本轮只新增结果文档与更新继续摘要，不重新测试/构建相同源码或发布ECR。

## 费用及唯一继续位置

该接续已准备为[C3e准确租户库只读诊断](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic.md)：新d82c6da5...待单独SQL批准，SQL/新槽0；旧87c与本页真实收据不重放。C3e不会为重建失败目录重放DDL，也不读取业务内容。

本轮合计4个SQL连接、30次query、18次直接metadata；AWS资源/IAM/Secret/Neon/ECS写0，数据库DDL写确已提交。保持 `runtimeEnabled=false / lifecycleCompatible=false / pg17LiveRestoreVerified=false`，没有app LOGIN/rds_iam/授权、Secret-v2、商户账号、任务、ready或ECS部署。Express集群与准确租户库留存可能计费，**50USD/月是目标非硬cap**；不自动删除或清理、此前空集群清理范围不再适用。原Full/F3c9与Backend用户`.vscode/settings.json`保持。

下一唯一继续点是上述准确库目录门禁的窄诊断/恢复设计，不再重复网络/MFA/角色探针、Grant或F3c9。原87c清单及两槽消费，即使仍在时间窗口也禁止Run/Inspect重放。后继SQL诊断、schema恢复、应用登录授权或部署均按新具体范围批准。[紧凑继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3d-continuation.prepared.json)。
