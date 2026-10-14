# D002 C4c：两库隔离修正已提交并独立核验

2026-10-14 America/Winnipeg。用户确认 [C4c准确范围及完整风险](./aws-auto-deployment-aurora-dual-mode-c4c-isolation-review.md)后，按清单 `20487de0b9a7a60e51da74c5a82493b61e5ac5cddcbfe53b73161668d09b4503` 执行唯一一次 Run，随后执行已批准的唯一一次独立只读 Inspect。最终结果为 `ISOLATION_INDEPENDENTLY_OBSERVED_APP_NOLOGIN`，不是应用登录、ready或部署成功。

## 实际变更及独立结果

准确集群为 `arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001`，物理ID `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`。在postgres管理库的一事务中，仅执行：

```sql
REVOKE CONNECT ON DATABASE "template1" FROM PUBLIC RESTRICT;
REVOKE CONNECT ON DATABASE "postgres" FROM PUBLIC RESTRICT;
```

Run的COMMIT于22:05:34.489 UTC / Winnipeg17:05:34.489 CDT获得成功响应。独立Inspect使用另一个TLS管理库连接和READ ONLY事务，于22:06:34.522 UTC / 17:06:34.522 CDT完成；以上为入口本地journal时间，不是数据库服务器时钟。

| 数据库 | OID / owner OID | PUBLIC CONNECT | 应用 CONNECT | 结果 |
| --- | --- | --- | --- | --- |
| template1 | 1 / 16410 | false（原true） | false（原true） | 仅撤销PUBLIC CONNECT |
| postgres | 5 / 16410 | false（原true） | false（原true） | 仅撤销PUBLIC CONNECT |
| rdsadmin | 16384 / 10 | false | false | 完整ACL不变 |
| tenant_a0da1748bc4d5419_db | 16459 / 16410 | false | false | 完整ACL不变，应用授权另批 |

两次完整四库快照均准确匹配受审程序预期closed状态，digest一致：`0251a30e18af71c2bd73a3880eadda1d00845fcbaf619c599cac88b5b2323d87`。template1/postgres的postgres16410显式CONNECT、CREATE、TEMPORARY全部保留；postgres的PUBLIC TEMPORARY保留。其它ACL、owner、allow_connections和连接限制未变。

准确应用角色16456仍通过closed-role classifier，保持NOLOGIN/NOINHERIT、无提升、配置、所有权、parents/members；其它可CONNECT数据库计数由2变为0。没有授予租户库CONNECT、73表/7序列权限或rds_iam membership。client TLS和backend TLS两次均true；准确Source、物理Express17.9/FREE ACTIVE及管理connect simulation通过，但不证明未来任务角色实际权限。

| 执行 | AWS/CLI元数据 | SQL连接 | query总数 | 权限写 | AWS写 / Secret值读取 |
| --- | --- | --- | --- | --- | --- |
| Run | 6 | 1 | 10 | 2 | 0 / 0 |
| 独立Inspect | 6 | 1 | 6 | 0 | 0 / 0 |

没有失败补偿、ROLLBACK、自动重试或第三次数据库连接。没有客户表读取/业务数据写入、Secret私密材料读取、Secret/IAM/Neon修改、LOGIN激活、Lambda调用、ECR发布或ECS/Cell部署。未重查C3g的73表/seed/结构目录，`schemaReverified=false`；原结构验收仍是历史事实。当前`/ready`的SELECT1不构成完整运行时验收，`runtimeEnabled=false`、`readyVerified=false`。

PUBLIC撤权影响所有依赖这两库PUBLIC权限建立新连接的角色、工具和服务，影响不局限于应用角色。保留postgres显式权限不证明所有消费者或托管维护均不受影响；此次没有完整消费者盘点，也未终止已有连接。既存资源及两次唤醒可能计费，50 USD/月仍是目标而非硬上限。并发及提供者日志风险沿用已批准清单。

## 完整性与不可重放

执行目录分别为：

- `F:/ChatGPT_workshop/techlong-d002-express-c4c-run-20261014-r1`
- `F:/ChatGPT_workshop/techlong-d002-express-c4c-inspect-20261014-r1`

写槽于22:05:11.642 UTC消费，独立只读槽于22:06:32.583 UTC消费。两槽均绑定上述SHA且`retryAuthorized=false`；即使原清单尚未到期，也不得再次Run/Inspect、刷新以重放、复位、regrant、down或补齐。旧C4b/C3/V4/V5/F3c9记录与槽全部保留。

随后仅做本地文件完整性核验：批准SHA、两回执计数、COMMIT journal、预期完整ACL、两槽及248当前源码pins/2工具一致。源码pins按受审规则归一化CRLF→LF；结果文件与工具用原始字节SHA。code binding保持`1c7f2d876cb60b7895b3a70a4631ea0f4d6349a81b5f6c44ea0ac3868807bdf6`；不把本地文件核验算成第三次实机回读。[紧凑结果、全部文件SHA与唯一继续位置](../ops/aws-sandbox/reviews/aurora-express-c4c-isolation.executed.json)。

本轮后处理只提交结果文档及非秘密证据；执行代码与Backend `153efbc7566d2ed2d566437f002c8fa95a6b9c9f` 已验镜像保持，没有重建或发布。用户`.vscode/settings.json`保留。

## 下一主线：实际运行时接线，不扩展隔离支线

隔离前置已完成，不再增加隔离/恢复探针。下一集中准备V7四键Secret、准确app/lifecycle IAM connect和execution Secret读权限，再准备C4a最小应用权限、受限rds_iam membership的真实TLS/IAM登录、完整ready与首轮初始化，之后ECR→ECS。

V7名称为`techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1`，兼容既有v2 wire；旧V6 Secret命名候选仅作历史保留。实际Secret ARN/version、private material仍未准备或创建；两名称ABSENT是21:49 Review的历史元数据，本次未重新查询，后续写前必须fresh核对。IAM权限、SQL激活、私密材料读取、Secret创建及实际部署各需具体新范围和fresh SHA批准。本次C4c授权不延伸至这些写入。F3c9继续封存，不新增通用Grant或恢复支线。
