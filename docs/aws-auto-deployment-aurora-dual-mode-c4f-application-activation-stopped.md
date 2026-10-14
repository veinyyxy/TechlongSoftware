# D002 C4f：提交前回滚，独立核验确认仍未激活

2026-10-14 America/Winnipeg。用户确认[C4f八语句与独立核验/登录范围及完整风险](./aws-auto-deployment-aurora-dual-mode-c4f-application-activation-review.md)后，按SHA `0c32f6f0885938065735b1945586e082eff3e2272e50f02c321d93b7feb943cc` 执行唯一Run，随后立即独立Inspect。**本次激活没有完成：Run在COMMIT之前停止并收到ROLLBACK成功响应；独立Inspect确认原closed状态，未尝试应用登录。**

## 实际执行与当前状态

Run于Winnipeg18:52:36.897 CDT / 23:52:36.897 UTC消费安装槽。真实postgres TLS连接在准确租户库OID16459/管理角色OID16410下通过写前检查：应用OID16456仍NOLOGIN/零成员/无提升/其它可CONNECT库0；四库完整ACL digest `0251a30e18af71c2bd73a3880eadda1d00845fcbaf619c599cac88b5b2323d87`，完整迁移目录digest `93d3c7eb62bbdd3e38f0a3943c9d44d607b419d562fcbd73ebd2fccf319e876b`，九技术seed、业务count0。

18:53:00.704 CDT / 23:53:00.704 UTC记录事务意图；准确八条权限/LOGIN语句均收到响应。之后写后五项快照查询进入最终核验路径，程序报 `C4F_LOCAL_OR_PROVIDER_FAILURE`，阶段 `MANAGEMENT_SQL_TRANSACTION`，最后查询标签 `SNAPSHOT_5`。回执明确 `permissionResponsesObserved=8`、`commitSubmitted=false`、`commitAcknowledged=false`、`rollbackAttempted=true`、`rollbackAcknowledged=true`，于18:53:02.664 CDT保存。**八次权限写调用/响应不等于八项已安装的持久权限；本轮安装COMMIT从未提交。**

独立Inspect于18:53:33.108 CDT消费核验槽，18:53:35.709 CDT收到只读事务COMMIT响应（不是安装事务COMMIT），18:53:35.757 CDT保存结果 `ORIGINAL_CLOSED_STATE_OBSERVED_INSTALL_NOT_PROVED`：

- 应用角色仍NOLOGIN/NOINHERIT、零parents/members、无提升/配置/所有权、其它可CONNECT库0。
- 原四库ACL及完整目录与上述digest完全一致，没有应用CONNECT/schema/table/sequence ACL新增。
- 原九技术seed/业务count0保持；rds_iam角色OID16389，本次没有留下应用membership。
- 客户端及服务端TLS通过；未进入条件性的应用连接/token签发或登录事务。

| 执行 | AWS/CLI只读元数据 | SQL连接/query | 权限/LOGIN调用 | 事务结果 |
| --- | --- | --- | --- | --- |
| Run | 26 | 1 / 21 | 8，均收到响应 | 最终核验停止，COMMIT未提交；1次ROLLBACK收到响应 |
| 独立Inspect | 26 | 1 / 8 | 0 | 原closed状态通过，只读COMMIT收到响应 |

两次当前IAM快照均与[C4e已安装结果](./aws-auto-deployment-aurora-dual-mode-c4e-runtime-iam-executed.md)一致：boundary默认v4/原v3、三role和7消费者保持；固定Secret/Express17.9/FREE ACTIVE保持。没有IAM/Secret/AWS、业务/authority/Neon写、Secret值或私密源读取、AssumeRole、ECR/ECS/Cell部署。两次管理连接可能唤醒Aurora并产生费用，50 USD/月不是cap。C4e持久IAM能力仍存在，不因本次SQL回滚而撤销。

## 原因已知范围与证据限制

阻断位置已定位到八语句之后、COMMIT之前的写后快照/核验路径；不是Source凭据预检查失败。`postgresSqlState=null`；原catch只接受C4F前缀错误，V6角色/ACL/目录或原row-count verifier的拒绝可能被压成通用错误。写后原始角色/catalog/count结果及具体校验码没有保存，`SNAPSHOT_5`仅是最后派发查询，不证明第五查询或row-count本身失败。**目前不能唯一确定具体失败谓词，也不能把grantor差异、membership选项或目录投影假设当作实机原因。**

本轮未为诊断追加SQL连接、宽权限、第二次Run/Inspect或新尝试槽；不通过修改已消费的257源码/清单去“补证”历史，不伪造post-state为已安装。下一次准备必须先在本地收敛上述证据缺口，保持原最小权限与完整校验；需要的新受审入口/槽和任何新的数据库调用都须明确新批准。不能只放松旧分类器、复位槽或重放本清单。

## 完整性与唯一继续位置

Run目录 `F:/ChatGPT_workshop/techlong-d002-express-c4f-run-20261014-r1`，Inspect目录 `F:/ChatGPT_workshop/techlong-d002-express-c4f-inspect-20261014-r1`。独立本地核验6份原Review、6份Run及7份Inspect安全文件、两个永久槽、257源码LF pins/2工具、八项前置历史原字节一致；code binding `22cf57cf38a550a80c1adf8b09cc63c4dd4b05a13dcb6743b505d64e6203a2ca`。没有追加AWS/SQL回读。[紧凑事实及全部文件SHA](../ops/aws-sandbox/reviews/aurora-express-c4f-application-activation.executed.json)。原r1/r2 Review/negative检查和C4e/C4d/C4c/C3/Full/F3c9历史均保留。

安装槽及核验槽永久消费，即使清单仍在时间范围内也不得重放或刷新成新尝试。此轮后处理仅结果文档/非秘密证据，Backend153efbc执行源码/已验镜像及用户`.vscode/settings.json`不改，不重跑历史大套件或重建镜像。

当前主线仍是最小应用激活→真实TLS IAM登录→完整ready/首轮初始化→ECR→ECS。下一先本地审阅写后验证差异及安全失败证据，再提供一次新的、具体受审尝试方案；未获新批准前不进行SQL/IAM/Secret/初始化/发布部署。保持旧Full兼容、F3c9封存，不增加Grant/恢复探针支线。本次未证明应用登录、ECS task role有效访问或完整ready。
