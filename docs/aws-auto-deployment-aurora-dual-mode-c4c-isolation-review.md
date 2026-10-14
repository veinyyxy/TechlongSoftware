# D002 C4c：两库隔离修正待审，Secret-v7接线候选已修正

2026-10-14 America/Winnipeg。基于[C4b真实结果](./aws-auto-deployment-aurora-dual-mode-c4b-isolation-executed.md)，已实现严格写入口和独立只读Inspect。**本轮没有执行SQL、撤权、启用LOGIN、创建Secret/IAM或部署ECS。** 本阶段先关闭准确两库的PUBLIC路径，应用授权/Secret/IAM/ready仍沿同一主线推进，不在未具备完整输入时提前启用LOGIN。

## 准确待审范围

最终清单SHA：`20487de0b9a7a60e51da74c5a82493b61e5ac5cddcbfe53b73161668d09b4503`。

准备21:49:04.994 UTC / Winnipeg16:49:04.994 CDT；有效至2026-10-15 03:49:04.994 UTC / **Winnipeg2026-10-14 22:49:04.994 CDT**。过期或错误SHA在凭据/AWS/SQL/槽之前拒绝；旧cacddc5f r1源码已过时，保留但不能执行。

仅修改准确Express cluster `arn:aws:rds:ca-central-1:402010193138:cluster:techlong-sandbox-express-d001` / `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`：template1 OID1、postgres OID5，owner均16410，现行完整ACL必须匹配C4b实际。唯一两条权限写为：

```sql
REVOKE CONNECT ON DATABASE "template1" FROM PUBLIC RESTRICT;
REVOKE CONNECT ON DATABASE "postgres" FROM PUBLIC RESTRICT;
```

两条在同一postgres管理库事务内完成，写前/后严格核对四库完整ACL、OID、owner、app16456的NOLOGIN/NOINHERIT/无提升或成员；只移除两个PUBLIC CONNECT条目。保留postgres显式CONNECT/CREATE/TEMPORARY、postgres PUBLIC TEMPORARY及其余所有ACL；rdsadmin16384、tenant16459、owner/allow_connections/业务数据均不改。不执行GRANT、rds_iam membership或LOGIN，不终止会话。

Run仅1连接、正常10query，提交前失败最多另1次同连接ROLLBACK；独立Inspect另1个READ ONLY连接、正常6query/失败最多7。两端TLS、准确postgres用户/角色OID5/16410、17.9和物理binding都必须匹配；写前再次核验Source/plan/管理connect permission及至少剩120秒的临时凭据快照。AWS每次preflight最多7 metadata，无AWS写。

新固定Run槽与独立Inspect槽分别为`techlong-d002-express-c4c-isolation-write-v1.permanent-slot.json`、`techlong-d002-express-c4c-isolation-inspect-v1.permanent-slot.json`（F:/ChatGPT_workshop），当前都不存在。只在各自获批preflight通过、连接前消费；不重用或复位C4b/C3/V4/V5槽。

Run成功或失败后都先执行本范围内唯一独立Inspect，不重试写。Inspect仅接受准确预期closed状态或原样open状态：后者报告未完成隔离，不伪造成功。异常/外来ACL即停下审阅，不修复。COMMIT响应丢失或本地回执缺失时，准确Run槽与run-directory code binding仍可支持已批准的唯一只读回读；不能支持第二次Run或Inspect。不得把数据库仍NOLOGIN且隔离closed当成应用登录或ready验收。

## 完整风险

- PUBLIC撤权影响所有依赖这两库PUBLIC权限建立新连接的现有/未来SQL用户、工具和服务，不仅是本app；消费者/托管维护影响未完整盘点。保留postgres显式授权不能证明所有消费者不受影响，已有连接不会因此自动终止。[PG17 REVOKE规则](https://www.postgresql.org/docs/17/sql-revoke.html)。
- 两条RESTRICT写为一事务，但repeatable-read目录、ACL写和AWS回读不是跨服务CAS；并发高权限修改可能竞态，不承诺排除所有并发或自动解决冲突。
- Source是既有高权限管理员，不是新最小权限边界；IAM token仅留内存，JS/driver擦除尽力而为，服务端/提供者日志可记录SQL/连接元数据。
- Run及独立Inspect连接可唤醒Aurora并产生ACU/I/O费用，既存资源持续计费；50 USD/月是目标而非硬上限。native DNS可能尝试多个解析地址，但不重连逻辑会话。
- 两槽永久消费。失败、超时、COMMIT响应丢失或本地保存失败可遗留未知提交状态；不自动重试、复位、补齐、regrant/down或删除资源。只在提交前失败时尽力同连接ROLLBACK，不在提交响应未知时盲目回滚或补偿。
- 不授予app能力、不读客户表/密码/原始role config/私密材料或Secret值，不创建Secret、IAM/ECR/ECS/Cell或写authority；批准本SHA不批准后续激活和部署。

## Secret-v7：修正真实接线冲突，仍为候选

C4a拟议Name `techlong/sandbox/tenant/a0da1748bc4d5419/runtime/g1` 不符合既有aurora-lifecycle-wire-v2的`appInstance stem + stable hash前10位`约束，真实共享wire的构造测试会拒绝它。本轮不放宽旧wire/Full入口，也不覆盖旧候选，而新增V7采用准确现有scope导出的：

`techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1`

新候选保留原四键/五个标签、generation1、Express IAM及默认AWS-managed KMS；没有private material、SecretString、实际ARN或version。其元数据finalizer同时检查准确cluster/17.9/DB/SQL角色、app/lifecycle两既有任务角色ARN坐标和不变v2生命周期命名规则，再生成四条版本固定ECS refs；不核验真实RoleId/IAM权限或execution role，后者仍待fresh实际核对。构造只在内存中用于兼容检查，不写epoch/activation、不发行实际执行调用或ready证明。合成测试ARN/version不作为真实资源保存。旧V6候选及其C4a结果原样保留，仅该Secret候选命名被V7取代，原73表/7序列最小SQL候选不变。

最终Review-r2只读7项AWS/CLI metadata，准确Source/物理17.9/FREE ACTIVE/管理connect simulation通过，新旧两Name均ABSENT；r1亦7项保留为过时源码记录。本轮总14 metadata、SQL/权限写/AWS写/Secret值/新槽均0。没有重读角色策略，因此C4b既有role事实仍是历史元数据；真正IAM权限、私密材料、LOGIN、ready/初始化及ECR/ECS仍待后继具体清单。

## 实现验证与追溯

平台新增纯隔离compiler/executor、严格CLI、V7 runtime candidate及两测试文件；8新+11相邻共19测试、typecheck、syntax、定向ESLint过。真实CLI用错误SHA验证Run在凭据/AWS/SQL/槽前拒绝，所有调用/权限写/消费均0。只进行必要针对性检查，未重跑历史离线大套件。本轮无Backend执行源码/镜像变化，保留已验153efbc源码，两main按既有授权直接推送。

248当前code pins+原2工具，冻结243旧code和C4b四份结果/槽字节未改。新入口将历史路径与hash固定，不让可编辑摘要指定额外私密文件。code binding `1c7f2d876cb60b7895b3a70a4631ea0f4d6349a81b5f6c44ea0ac3868807bdf6`，program `bbbb711c3bdcab49886789cf9e75b360616d38478ef1634c48a03b05bb0ea4eb`。[文件字节SHA与唯一继续位置](../ops/aws-sandbox/reviews/aurora-express-c4c-isolation.prepared.json)。

用户明确确认本SHA及上述范围/风险后，才执行一次Run并立即独立Inspect；否则只保留待审材料。下一集中准备V7四键Secret与准确app/lifecycle IAM connect、execution Secret读权限及C4a最小应用激活/真实ready初始化，沿既有云端镜像路线完成ECR→ECS，不扩展F3c9/通用Grant/恢复探针。
