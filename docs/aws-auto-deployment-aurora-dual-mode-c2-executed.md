# D002 C2a 实际执行：Express 已创建，只读连接未证明

2026-10-13 America/Winnipeg。用户明确确认[原清单与完整风险](./aws-auto-deployment-aurora-dual-mode-c2-review.md)，批准SHA `b883fbeacbb0ae473f408f296f805a31c50bd865730e3b4d7a2af45387101671`。清单在07:34:54.750 UTC前有效，本次03:13 UTC执行仍在窗口内。**本阶段部分完成，不是租户部署成功，也不是 IAM/TLS/SQL 验收成功。**

## 实际时间线与计数

| UTC（Winnipeg为前一天CDT，减5小时） | 实际结果 |
| --- | --- |
| 03:13:29.047 | 创建永久槽消费；执行前Source/FREE-ACTIVE/查空/配额/PG默认17.9/SLR/权限与8代码pins通过 |
| 03:13:30.069 | 唯一一次CreateDBCluster成功，准确cluster身份和requestId保存 |
| 03:13:30.758 | 服务创建唯一serverless writer；没有第二次CreateDBInstance |
| 03:13:51.922 | SQL检查永久槽消费，唯一一次只读管理员连接尝试开始 |
| 03:14:02.786 | `EXPRESS_C2_INSPECT_FAILED`；程序退出1，停止、不重试、不补齐、不自动删除 |
| 03:14–03:17 | 独立新进程Inspect与追加RDS/DNS只读核对：cluster/writer均available、原物理binding一致 |

本次直接AWS写 **1**、SQL会话尝试 **1**；SQL程序仅允许固定四条只读语句，没有SQL DDL/DML入口。未产生成功SQL观察，**不能从现有回执判断四条语句分别执行到了哪一步**。IAM/Secret/Neon/authority/activation/job/ECS/旧资源写0，Delete/Reboot/Modify/Invoke0。运行目录 `F:/ChatGPT_workshop/techlong-d002-express-c2-run-20261014-r1`；独立回读目录 `techlong-d002-express-c2-inspect-20261014-r1`。

## 准确新资源与已证明的事实

- Cluster ARN：`arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001`
- `DbClusterResourceId`：`cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`
- Writer ARN：`arn:aws:rds:ca-central-1:402010193138:db:techlong-sandbox-express-d001-instance-1`
- `DbiResourceId`：`db-NVAQZTKV2FPTHGITOQE563CPAY`
- Engine **17.9**、端口5432；cluster/writer均available；IAM=true、gateway=true、VPCNetworking=false；Min0/Max1/auto-pause300、DeletionProtection=false、准确四tag与nonce不变。
- 真实cluster endpoint为 `techlong-sandbox-express-d001.cluster-cn8aaekuqf1r.ca-central-1.rds.amazonaws.com`。DNS可解析至公网IPv4，仅证明解析成功，不证明TCP/TLS/认证成功；没有改连DNS别名/IP或再次打开5432。
- Writer的PubliclyAccessible=false、VPC SG为空；Express网关与传统VPC公开属性不同，不能因此擅自打开public flag、加SG或修改网络。[官方Express网络约束](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/CHAP_GettingStartedAurora.AuroraPostgreSQL.ExpressConfig.html)
- 默认PG17 parameter group为pending-reboot；这是独立观察，不是本次连接错误的已确认原因，没有重启或改参数组。

创建requestId `92f672f6-ff42-451a-b561-e966c7d66121`。创建receipt文件SHA `bc80e68ac03ce32cac72501a235cd57ed5d3c18458732e14054213049a5823c5`；原Run与独立Inspect的binding文件SHA均为 `139040a34b3a2ba187ea80f4a86da615c34daac584ecbe7023bc5edb184d3b15`；停止receipt文件SHA `5489e568edf1a23fbbe6de5e3277a58ff2ca7286f1591249afb2235148ab9f3f`。文件SHA与审批material的canonical SHA口径不同，不混用。

独立核对原 `speedfeast-postgres-prod` 仍available/db.t4g.micro；原Full失败Stack UUID `ede4f290-c758-11f1-8050-06ffda7a3477`仍ROLLBACK_COMPLETE。公钥Secret/原Neon业务/原角色/F3c9及其历史不改；未读取Secret值或任何业务表数据。

## 错误结论与不能冒称的证明

当前只能确定一次检查失败：尝试槽到失败回执约10.864秒，接近配置的10秒connect timeout，**但没有保存分阶段错误，不能据此确认网络超时，更不能断言IAM被拒、TLS不兼容或数据库SQL错误**。既有探针把驱动错误统一脱敏为一个码，这保护了凭据，但诊断粒度不足，属于本批代码的明确不足。

没有成功的SQL identity/admin catalog/TLS观察，尚不能形成C1管理权限、网关后端TLS、rds_iam membership、租户隔离、73表恢复、迁移或ready证据。原Full PG16.14证明仍不能当Express证明。失败程序已结束并处置本机client；服务端会话数、当前ACU和实际auto-pause并未实读证明，不保证费用已经停止。

## 槽、费用与准确清理待审

新create及sql-inspect永久槽均已消费，不复位、不重放原Run；writer-delete/cluster-delete槽仍空。旧槽和历史回执均保留，8项执行代码未因失败被改写或放宽。

**新cluster和writer仍保留，可能继续计费或消耗credits**；没有自动删除/定时销毁。0–1ACU与空闲暂停设置不是硬费用上限。原目标是创建后2小时内决定继续使用或受审清理，即本次约05:13 UTC / Winnipeg 00:13 CDT；这是接管目标，不是自动动作或费用保证。

03:16:41.803 UTC仅生成独立 `CleanupReview`，未执行：

- 准确材料：`F:/ChatGPT_workshop/techlong-d002-express-c2-cleanup-review-20261014-r1/cleanup-manifest.json`
- 审批SHA：`ccfdd8e7ac528c5a0c4cf84a674a7f72642316295ddc73f1110e53e5cb10ab67`
- 到期 **04:16:41.803 UTC / Winnipeg 10月13日23:16:41.803 CDT**，新批准另需明确；过期只能只读重审。
- 绑定本次真实cluster/writer ARN、resource IDs、创建时间、tags与创建receipt；最多准确writer及cluster各一次删除，skip final snapshot/delete automated backups，仍有不可恢复、并发、部分失败、永久槽和费用风险。原C2创建批准不授权删除。未来已装tenant/改变用途时不能使用这份空验证资源清理提案。

## 唯一主线继续位置

建议**保留已经成功创建的准确cluster，不重建**，下一阶段只准备一次带分阶段白名单错误证据的新只读诊断清单：绑定本次实际resource IDs/endpoint/engine、固定SQL、Source身份、新独立永久尝试槽；记录DNS/TCP/TLS/auth/SQL所处阶段与非秘密错误分类，保持ATS/hostname/read-only，不提供任意SQL或回退连接。实际新连接必须fresh SHA单独批准，不能重新运行旧sql-inspect槽。

只读诊断通过后才依据真实admin catalog/网关行为补剩余C1写适配和有限role/baseline验收，然后D001单租户ready。若用户不希望资源留存，则按准确新清理SHA另批删除；**当前没有任何新连接、重启、修改参数/IAM、业务写、部署或删除授权**。本批只记录执行事实与接管位置，两个main按既有授权直接提交推送，不启动F3c9支线。

本轮文档/非秘密[执行摘要](../ops/aws-sandbox/reviews/aurora-express-c2.executed.json)JSON解析及diff检查通过；原172历史源码pin entries加本次8执行pins共180项全部匹配。没有改生产源码、依赖、默认入口或运行时门禁，没有为记录结果重建镜像；用户Backend `.vscode/settings.json`保留、不提交。后续恢复优先读取此文及执行摘要，不重建历史Grant支线，也不重新跑原Run。
