# D002 C3d：保留准确已reserve角色的V4续建/恢复清单

本清单87c5995e...已获批并单次执行，双永久槽已消费，禁止重放。数据库OID16459已续建/promotion，准确旧guard16457已删除；schema恢复被 `AURORA_V3_PG17_CATALOG_REJECTED` 拒绝。立即独立Inspect确认库与NOLOGIN app留存、guard缺席，但未验证租户schema。详见[真实结果与唯一接续位置](./aws-auto-deployment-aurora-dual-mode-c3-continuation-executed.md)。以下准备状态仅保留为历史，不能作为再次执行授权。

2026-10-14 America/Winnipeg。承接[C3c真实目录诊断](./aws-auto-deployment-aurora-dual-mode-c3-role-diagnostic-executed.md)。新增严格V4校验同时覆盖prepare与restore，旧Full/V2/V3、原212 code entries/183历史entries和全部旧槽不改。**本轮SQL连接/写、云资源写、新执行槽消费均0；以下SHA等待用户确认。**

## 当前待审SHA

`87c5995ea79c8e7218e33bdc76bc5c98618cd2d486b77319b290d3ce5a26599f`

生成：2026-10-14 12:06:11.476 UTC / Winnipeg07:06:11.476 CDT；截止：**2026-10-14 18:06:11.476 UTC / Winnipeg13:06:11.476 CDT**。过期不执行或自动延长，Source刷新不授权SQL。

私有清单 `F:/ChatGPT_workshop/techlong-d002-express-c3d-review-20261014-r2/manifest.json`。Review原归档重编译与5次直接AWS元数据核对通过，SQL0/槽0；独立新进程 `...-c3d-metadata-20261014-r2/facts.json` 于12:08:39.671 UTC同样5次直接只读，Source/准确cluster-writer/FREE-ACTIVE/模拟结果与Review一致，文件字节SHA `487c6a01cb53fdab24f5a0c55e8715846dfe567106cf852123be223ee2312822`。结论 `PHYSICAL_ONLY_SQL_NOT_PROVED`，不声称本轮已重新读取SQL角色或执行DDL。

## 精确写范围——新确认后才执行

- 只在原 `techlong-sandbox-express-d001` / `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM` 上操作；PG17.9/原writer资源ID与创建时间/gateway/IAM/0–1ACU/300秒pause/原tags保持。不创建或修改任何AWS资源。
- 允许准确复用已reserve的app `tenant_a0da1748bc4d5419_role` / **OID16456** 和guard `tl_prepare_96c4e91750c441e3aab2de2609f7f029` / **OID16457**，原scope/nonce/ownership不变。不是任意已存在对象接管；执行前完整catalog投影必须匹配已诊断SHA `d4aa1330a48212824bba726b8c550d5523aedb009f3b1956948cc734ade147b8` 且准确库不存在。
- app必须NOLOGIN/NOINHERIT、无提权/owner/settings/config/parents且**members严格0**。guard必须唯一postgres/OID16410成员、grantor rdsadmin/OID10、ADMIN/INHERIT/SET全部true；同一共享校验用于prepare各阶段和restore前后owner检查。不新增角色或成员，不为旧模型额外给app ADMIN。
- 只执行剩余8条prepare语句：1次创建 `tenant_a0da1748bc4d5419_db`（template0/UTF8/guard所有/禁止连接）；随后独立事务转postgres/OID16410所有、关闭这个新库的PUBLIC ACL、写原ownership comment、允许连接，**删除仅准确现有guard/OID16457**。不重放reserve/CREATE ROLE/GRANT，不删除其它角色或数据库。
- 以新V4 prepared证明连接新库；固定原73表schema-only恢复和两份 `saas_control.sql` / `theme_config.sql` 迁移共用一个事务。仅九条技术seed（1 singleton+8默认entitlement），其它业务表0；实例关联/provisioned字段null，不创建商户/店铺账号，不改Neon/旧业务。
- 单次Run最多3个物理连接，随后独立Inspect最多2个只读连接。Run成功则回读73表/九seed/PG17目录/owner/OID/大小；失败只读管理catalog，不重放恢复，不假称schema成功。各group120秒/connect30秒、Source snapshot至少余5分钟/同份STS验证，直接metadata上限18/9、query调用上限64；多语句归档/迁移由固定SQL SHA绑定。
- 保持NOLOGIN、无app权限/rds_iam/Secret-v2/Fargate authority/activation/任务/ECS/运行时；不改IAM/Secret/其它数据库PUBLIC权限或F3c9。

新永久槽：`techlong-d002-express-c3-reserved-continuation-v4.permanent-slot.json` 与 `...-v4-inspect.permanent-slot.json` 均未消费。原安装/Inspect/诊断槽永久保留，不能借新槽继续旧Root。新收据schema `express-continuation-observation/v4` / `express-schema-observation/v4`，不伪造原V3成功记录。

## 完整风险

1. Source仍是既有管理员，本地受审SQL不是应用或最小权限Fargate授权；不因本轮准备而启用worker/runtime。
2. CREATE DATABASE不在promotion事务里，restore/migrate又是后一个事务；失败/COMMIT失响应可能遗留guard-owned禁止连接库、postgres-owned空库或已提交schema/九seed。
3. promotion删除准确guard后，其原OID不可恢复。只有在严格owner/nonce/OID状态符合时提交；并发特权管理员可竞态，cooperative lock/前后metadata不是跨服务CAS，也不是按OID执行DROP ROLE的CAS。
4. 不自动down/rollback/delete/fill/reset/retry；事务dispose不等于独立证明rollback。新槽连接前永久消费，失响应、文件journal/回读、凭据/传播/超时失败都需要独立检查和后续新范围审阅。
5. 现有集群可能被唤醒并产生ACU/storage/I/O费用；**50USD/月是目标不是硬cap**，资源继续留存，没有自动cleanup。原空集群清理提案不适用于创建了租户库后的状态；未来删除按实际OID/ownership/会话/数据另审。
6. token/临时keys只在内存，JS/driver清零尽力而为，AWS/数据库提供者可能记录连接/SQL元数据。只输出固定安全错误码或SQLSTATE，不输出原驱动消息、SQL或credential。
7. 原归档是可信固定DDL/函数/trigger，不是任意SQLsandbox。PG17实机schema尚未恢复；目录SHA仅观察，不自动学习ready结构pin，不能把PG16旧fingerprint冒用为PG17。
8. 512MiB是租户大小门禁，不证明集群总容量/Free Plan余量/未来增长。其它数据库PUBLIC CONNECT保持，app仍NOLOGIN；Secret/IAM/真实应用登录/完整隔离及ECS/健康/ready后继另审。
9. 成功Inspect也只是schema/迁移检查，失败Inspect只管理目录；自身槽也单次，不保证能在失效Source/并发变化后补齐证据。不以当前“检查通过”直接授权其它写入。

## 代码、准确pins与必要验证

双仓同字节 `aurora-express-continuation-v4.cjs` 输出固定8语句/私有brand/准确诊断前驱；Backend新增continuation/restore V4和原archive重编译器，平台新fresh Review/Run/Inspect/metadata Root。V4 restore复用旧PG17安全与行数函数，但owner校验改用同一严格policy；安全journal保留旧AURORA_V3/newV4/Root固定码和SQLSTATE，不再把所有拒绝条件丢失为SessionFailed。旧源码/原失败回执不重写。

- 224 code entries+2原生工具；当前code binding `8f66777769c2cb82b507f5a1362289776d0d1a23ce8892cd0138f853dee0b3ef`，history `fc0091ad2b450bd6b60badb19c4aafaa6c610c9dfdd97ec5fa58aeb1840808db`。
- continuation program `7676c19f2058b5ceff7dac296f605893f249f8183c384affc24ddd0e7922a8a5`，严格policy `771efce4e77445591095cfd1c8abc376377771b1b47ee9bfd7ae39c2da8a00d7`；V4 SQL+policy identity `55733716d897ee5cdcd80abffb85c277ca148b4d7c3af5a8d199a4f7fd5bbfa4`。
- 原archive/manifest/SaaS两迁移/restore-verification-row/catalog SQL pins全部保持；剥去新policy字段的SQL identity仍是原 `84948cfc...`，没有重新导出或上传归档/schema/业务数据。
- Backend4新+4相邻测试、平台2新+2相邻测试、双方types、平台定向lint/syntax及惰性自检通过。真实原归档brand重编译后，旧V3 prepared实际负例在owned连接前拒绝，SQL/云0；实际Root无效SHA负例 `...-c3d-negative-20261014-r1` 在AWS/SQL/槽前拒绝，计数全0。不把这些当PG17实际DDL证明。

## 云端镜像及保留的失败历史

最终Backend源码 **62010acfa7006bb5d03045591d6d3f37d70dfab8** 的[完整CI38561294834](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38561294834)与[双镜像38561294979](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38561294979)均success。独立jobs回读：CI check115842731403/docker115842731802、app115842732433/lifecycle115842732363，所有steps均success，包括新V4 network-none自检、旧bundle/toolchain/Full根和HIGH/CRITICAL两类门禁；默认入口保持，未ECR发布。

初版3985778的完整CI38559823987/app镜像通过，但38559824086 lifecycle在原自有CI PostgreSQL fixture启动步骤失败：pg_isready放行时准确数据库尚不存在。只修复CI readiness为准确synthetic库的TCP `SELECT 1` 成功+有限等待，不创建额外库/跳过toolchain。[官方说明：pg_isready不要求正确数据库名](https://www.postgresql.org/docs/16/app-pg-isready.html)。修复4777852的CI38560555782/双镜像38560555806已过；随后补安全错误码白名单并验证最终62010ac。失败记录保留，不称旧失败候选已通过。

私有Review r1的8758f2e6...因最终源码修正已过时、不能执行；r1/metadata历史保留。本次只交付r2 SHA，不复位或重用旧目录。

## 唯一继续点

用户确认当前r2 SHA、允许准确复用两role和删除guard及完整风险 → 有效窗口内单次Run → 新进程独立Inspect。此前“开始下一步”只授权本轮编码/准备，不授权这些SQL写。不要重复C3c目录诊断/历史镜像/Grant/F3c9，不新增app ADMIN/角色/cluster。[紧凑继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3d-continuation.prepared.json)。
