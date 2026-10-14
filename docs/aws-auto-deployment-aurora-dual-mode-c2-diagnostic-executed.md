# D002 C2b 实机结果：管理员 IAM / TLS / 固定只读 SQL 通过

2026-10-13 America/Winnipeg。用户明确确认[新清单与完整风险](./aws-auto-deployment-aurora-dual-mode-c2-diagnostic-review.md)，SHA `f95a0c3c6c88a07757fa08dd4a604749b3e3cfc483aee9f925776f7a96a0c7f8`；04:09 UTC执行，仍在09:47:37.715 UTC有效期内。**本阶段管理员只读连接实机验证完成；不是租户生命周期/部署验收完成。**

## 本次实际执行

- 新独立槽在 **04:09:22.092 UTC / Winnipeg10月13日23:09:22.092 CDT** 消费；原create/sql两个槽保持消费，不重放。
- 实际1个Client、1次connect、1次签名、4条固定只读SQL；26帧白名单进度。Run结果为 `ADMIN_READONLY_OBSERVED_NOT_TENANT_VERIFIED`、退出0、无failure。
- DNS约533ms、TCP/PG SSL协商开始589ms、TLS事件898ms、认证挑战949ms、签名完成951ms；认证ready/connect完成 **23057ms**。BEGIN、identity、admin catalog、COMMIT分别成功，处置完成23658ms，finished23659ms。
- 认证挑战到ready约 **22.108秒**，本次实际连接23.057秒，说明10秒窗口对本次条件不够；30秒窗口通过。**旧C2a无阶段证据，不能倒填为已确认同一原因，也未证明冷启动/自动恢复就是延迟原因。**
- 实际客户端ATS根链/hostname/SNI与原身份门禁通过，`clientTlsVerified=true`；SQL为postgres/current_user=session_user=postgres、database OID5、server_version_num **170009**、`backend_tls_active=true`。不是把未知/false伪装为true。
- 管理员OID16410，LOGIN/INHERIT/CREATEDB/CREATEROLE=true；SUPERUSER/REPLICATION/BYPASSRLS=false。直接父角色rds_superuser、rds_iam，grantor=rdsadmin、ADMIN=false、INHERIT/SET=true。这是托管管理员目录事实，**不能复制为租户应用权限或证明已执行DDL**。

保持准确资源 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM` / writer `db-NVAQZTKV2FPTHGITOQE563CPAY`、PG17.9、原endpoint/5432、创建时间/nonce/tags与0–1ACU配置。没有重建、修改、重启、删除、IAM/Secret/Neon/业务/authority/activation/job/ECS写入；没有任意SQL、Secret值或原始错误/令牌输出。

## 独立回读与证据

Run有限metadata调用9次、SQL会话1次、AWS资源写0；随后独立新进程Inspect **04:10:31.105 UTC** 回读5次metadata、SQL0、写0。Source精确UserId/ARN、FREE/ACTIVE、准确connect ARN模拟allowed与原物理binding全部一致，`PHYSICAL_BINDING_OBSERVED_SQL_NOT_REPLAYED`。没有用第二次SQL连接证明第一次结果，也没有把策略模拟当真实认证；真实登录证据来自已批准的唯一会话。

私有Run目录 `F:/ChatGPT_workshop/techlong-d002-express-c2b-run-20261014-r1`、Inspect目录 `techlong-d002-express-c2b-inspect-20261014-r1`；[非秘密实际摘要](../ops/aws-sandbox/reviews/aurora-express-c2-diagnostic.executed.json)给出准确继续位置，不是新执行批准。

| 文件 | 文件字节SHA256 |
| --- | --- |
| diagnostic.json | `52b8b44db1c958a28b0a0cae3e1158a1de8b39e677414aca7149c1dcc1b9b184` |
| progress.jsonl | `cff07a58d488610bdf5776e29e90ab96efeb1f246b29237d131a04f973e66a4e` |
| result.json | `c9f24e3e23e8c11603855e69fdb28db6c5a4191551a1fc71c3acecc085f23292` |
| postconnection-binding.json | `139040a34b3a2ba187ea80f4a86da615c34daac584ecbe7023bc5edb184d3b15` |
| 独立facts.json | `1321ee7172e33bdfe8462f112b6da76b46ee1b20f0907fae1ea56d3780dac967` |
| 新永久槽 | `12f0a06cb4e5ab2d0233c44781a6998c7f9db028743c5da0ef8d30dbb4c4a286` |

这些是文件字节SHA，与approval/target的canonical SHA不混用。现有新11执行+原172历史共183pin entries全部匹配；本批只更新文档与执行摘要，不改已批准源码、依赖或运行时flag。用户Backend `.vscode/settings.json`保留、不提交；两个main按既有授权直接提交推送。

## 成功边界、费用与主线下一步

已经证明：**真实Express的Source管理员IAM连接、客户端认证TLS、PG17.9固定身份与admin catalog只读事务**。尚未证明：租户用户名IAM、NOINHERIT/精确membership隔离、CREATE DATABASE/ROLE实际操作、73表恢复/容量、migration、Secret-v2/首位商户密码、Fargate task authority、ECS健康、配置下发与ready。`lifecycleCompatible=false / runtimeEnabled=false`继续保持；不能借管理员成功放宽应用或旧Full约束。

客户端已正常关闭；服务端会话数、当前ACU/自动暂停与最终账单尚未实读证明。cluster/writer按用户选择继续保留，可能计费/消耗credits，50USD/月是目标非cap；未安装删除调度，原清理提案未执行，过期需另行只读重审/新SHA批准。本批准仅一次新只读会话，新槽已消费，不能再运行原Run。

**下一阶段回到主线C1/C2交叉包**：以真实PG17.9/TLS/admin事实完成剩余管理写provider与连接窗口配置，保留原固定Secret-v2/ownership/准入门禁；准备准确独立租户database/应用role、原73表空baseline及迁移的有限验收材料。应用/管理会话的10秒窗口需要在新受审配置中处理，不直接修改183项冻结pin或凭一次观察证明所有冷连接时延。实际SQL写、Secret、IAM、Fargate/部署仍按具体范围fresh批准，**本轮不执行**。不继续无目的Grant探针、不重建可用cluster、不重启F3c9。
