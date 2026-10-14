# D002 C3b实际执行：reserve部分提交，独立确认两NOLOGIN角色、无租户库

2026-10-14 America/Winnipeg。用户在本线程回复“我确认”，明确承接上一条 SHA `1df7e2f7da6b3e900f68e5d5814e2f32e1578c19af131270ef6a355112ced440`、具体数据库安装范围及[完整风险](./aws-auto-deployment-aurora-dual-mode-c3-review.md)。清单到16:28:18.531 UTC / Winnipeg11:28:18.531 CDT，执行在有效窗口内。仅运行原冻结Root一次，随后原批准内的独立只读Inspect一次；**二槽现已永久消费，原SHA即使未过期也不能重放。**

## 实际结果

- Run于10:37:30.726 UTC / Winnipeg05:37:30.726 CDT消费安装槽；1个管理连接、12次pg query、6次直接AWS metadata。返回 `AURORA_V3_SESSION_FAILED`；`stopped.json`如实标记SQL效果可能已发生，不声称零写或自动rollback。
- `stages.jsonl`只有10:37:53.399 UTC的reserve INTENT（7条语句），没有OBSERVED、quarantine或promote INTENT；没有prepared/result成功回执。未进入租户库创建、guard删除、restore或migration。
- 独立新进程Inspect于10:38:19.874 UTC消费只读槽，9次直接metadata、1个SQL连接、4次只读事务/目录query。结果 `PARTIAL_BOOTSTRAP_CATALOG_OBSERVED_NOT_SCHEMA_VERIFIED`，SQL/AWS资源写均0。
- 准确app角色 `tenant_a0da1748bc4d5419_role`：真实OID **16456**，NOLOGIN，准确ownership comment匹配。
- 准确guard角色 `tl_prepare_96c4e91750c441e3aab2de2609f7f029`：真实OID **16457**，NOLOGIN，准确ownership comment匹配。没有删除。
- 准确租户库 `tenant_a0da1748bc4d5419_db`：独立固定目录查询返回**不存在**。目录观察SHA `d4aa1330a48212824bba726b8c550d5523aedb009f3b1956948cc734ade147b8`；不是完整角色权限、schema或ready证明。

这证明两个角色及标记已经提交留存，不证明所有角色属性符合预期。保持 `runtimeEnabled=false / lifecycleCompatible=false`；没有PG17表恢复/迁移成功证明、app LOGIN/rds_iam/授权、Secret-v2、任务或ECS部署。

## 停止区间和不能倒填的原因

按原固定控制流，1条身份查询+1条锁查询+1条查空+reserve7条（含BEGIN/COMMIT）+1条提交后catalog+1条unlock，共12次query；结合留存角色和只有INTENT的journal，停止区间是**reserve提交后的目录核对或证据保存**，不是一次未连接成功的MFA/网络失败。

但是管理transport会把回调内部异常统一包装成 `AURORA_V3_SESSION_FAILED`，旧回执没有保存原安全错误码、完整post-reserve成员目录或具体拒绝条件。因此目前不能唯一归因于membership/grantor检查、SQL错误、连接丢失或本地journal错误，更不能直接放宽角色验证/采用已存在对象继续创建数据库。独立Inspect只保存了最小角色/OID/NOLOGIN/comment事实，不能据其catalog SHA复原其它字段。

## 证据与不可重放记录

| 私有证据 | 文件字节SHA256 |
| --- | --- |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-run-20261014-r1/stopped.json` | `7c5f664cfe012aab465709b402ac108d6071788737a68f383b4ec20be943e061` |
| 同Run目录 `stages.jsonl` | `b48a706ca68cae27e5a71c539cd3a40723b2f32a523e4cd86f3c8d200742d99e` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-inspect-20261014-r1/result.json` | `8e4cb1f7d1ffba334be0d849253595b02ee4e7f3c413d82e73886f687899882a` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-bootstrap-g1.permanent-slot.json` | `0d08ac8a636ecad70153a52724dfc0334a9faf53dd50b499d3d4110d08272a33` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-bootstrap-g1-inspect.permanent-slot.json` | `56a883de7de8d90608f7540585bdaf794282d76d823047f8fdeb1d872fd42b50` |

实际冻结源码仍为Backend `16b5daa9d4af8a248d2918d719f1e15d60dc3498`、code binding `fc7a6d9adc785d481269ceba26f8a1fef0c0edc594900663c8fd24be443f63e9`、SQL program `84948cfc92b85e6004429f1c19ffb02ed8ef887e44794bedc0c50001396a5431`；210 code entries+2工具、183历史pin entries未改。先前完整CI/两镜像通过只证明源码/镜像门禁，不替代这次真实DDL失败结果；不重建或ECR发布。

本轮共2个SQL连接、16次query、15次直接metadata，AWS资源/IAM/Secret/Neon/ECS写0；SQL角色写确已发生。现有Express集群和两角色保留，50USD/月是目标非硬cap，未安装自动cleanup。旧Full、F3c9、全部历史槽及Backend用户`.vscode/settings.json`保持。

## 唯一接续位置

此接续的有限只读入口已在C3c实现；当前Source凭据不可用、无新manifest/SQL授权，详见[准确范围、风险和刷新后的继续点](./aws-auto-deployment-aurora-dual-mode-c3-role-diagnostic.md)。下面保留该接续的设计范围，不代表已执行新的目录查询。

建议下一小步仅准备一个fresh SHA的**准确角色完整目录只读诊断**：绑定现有cluster、两个真实OID/名称/nonce与独立回执，查询角色属性、creator membership及grantor选项，输出安全字段/比较拒绝条件；不修改角色、不重新prepare、不创建数据库，不重复C2b网络探针或Grant支线。额外SQL连接不在已消费Inspect授权内，需新具体清单确认。

取得真实目录后，若是校验模型与合法实际目录不一致，才准备保留现有两角色的准确后继方案及必要代码修正；若是异常权限，则准备准确处置范围。任何角色修改/删除、已有对象接管、数据库创建/恢复、独立新槽均另按fresh SHA批准。**不清空旧槽、不自动修补/回滚/重试，不换名字堆叠新角色，不重建集群，不回F3c9。** [紧凑继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3b.prepared.json)。
