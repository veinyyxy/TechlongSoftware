# D002 C3f：保留准确现有库的restore-only清单

2026-10-14 America/Winnipeg。承接[C3e当前空目录观察](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-executed.md)，不再独立目录探针/建库/角色/Grant/F3c9。本阶段只新增本地受审Root、fresh review和查询捕获装饰器；Backend冻结V4恢复port、原private archive编译品牌、校验逻辑和已验收镜像保持。**SQL连接/写、新槽消费、AWS资源写均0，尚无恢复执行授权。**

## 当前唯一待审SHA

`a5c79b93a0afdf19849ba02e76feb310743f76adeeae64b5aae7de2efa55c632`

生成：2026-10-14 15:05:41.962 UTC / Winnipeg10:05:41.962 CDT；截止：**2026-10-14 21:05:41.962 UTC / Winnipeg16:05:41.962 CDT**。过期不执行/自动延长，Source刷新不授权SQL。

私有清单 `F:/ChatGPT_workshop/techlong-d002-express-c3f-review-20261014-r3/manifest.json`。Review原归档真实重编译/私有brand及固定SQL identity通过，另5次直接AWS元数据核对成功；独立新进程 `...-c3f-metadata-20261014-r3/facts.json` 于15:06:31.561 UTC / Winnipeg10:06:31.561 CDT同样原编译及5次只读成功，除observedAt外Source/准确cluster-writer/FREE-ACTIVE/连接模拟一致。facts字节SHA `11f180d1b22c70f782a07bd64cbf790181f576047e56150e20cc7e9d56dfb691`。这些不是新SQL或恢复证明。

## 准确写范围——具体批准后才执行

- 只复用原cluster `techlong-sandbox-express-d001` / `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`、PG17.9/IAM/gateway/准确writer/tags/0–1ACU/300秒pause，不改AWS资源、IAM、Secret或Neon。
- 只恢复准确现有库 `tenant_a0da1748bc4d5419_db` / **OID16459**；管理postgres角色/OID **16410**，app `tenant_a0da1748bc4d5419_role` / **OID16456** 保持NOLOGIN/零成员/无提权，guard必须缺席，原nonce及ownership不变。源C3d prepared字节、C3e观察/result/已消费槽、旧Source停止回执共五文件直接绑定历史。
- 不执行prepare，不CREATE/DROP DATABASE、不CREATE/ALTER/DROP ROLE、不新增成员、app ADMIN/rds_iam/LOGIN或应用授权、不恢复guard；原C3d库创建/guard删除不重放。
- Run只调用原冻结 `PostgresExpressRestoreProviderV4.apply`。原管理目录/严格V4 owner检查和cooperative lock保持；目标库原 `EMPTY_SQL` 必须objects0/closed_public_schema1，再在**同一原恢复事务**内额外一次固定PG17目录SELECT，完整SHA必须匹配C3e空目录 **`56f65c613ba62ada90240b72679ca0323b3e0b8414f85b25f6263d360be5b0d7`**。非空或漂移即停止，不接管或清空。
- 保持原固定73表schema-only restore、verification及两SaaS迁移同事务；只允许九条技术seed（singleton1+默认entitlement8），其它业务表0。原计数/实例null字段/固定entitlement检查、512MiB大小门禁、前后owner/OID校验保持。不读取业务内容、不创建商户/店铺账号、任务或job；固定原表计数和技术seed校验是此次恢复范围的一部分。
- 本地tenant query装饰器在baseline和迁移后每次固定PG17目录返回、原冻结校验器调用前，先fsync保存安全逐谓词报告、catalog digest/数量、拒绝对象hash及受限owner/ACL/security摘要。保留原判定，不自动修复/放宽，不保存原函数体/default/config/未知名称或credential。管理client不装饰。
- 原校验不通过，报告保存后返回原结果，由原port拒绝，不能迁移或COMMIT。装饰器另要求原baseline判定通过、两迁移均完成及final判定通过，**在COMMIT派发前**再挡未完成状态；失败不自动写重试/down/补齐。
- Run最多2物理连接、40次pg query、9次直接metadata；正常原控制流加一次空目录SELECT为26次query（不是DDL语句数），不会分散到新的管理/建库会话。每连接30秒connect，pair group120秒，Source Login内存snapshot至少余5分钟/同份STS核对，前后准确资源与Source再查。
- 同一批准还含一个**独立新进程Inspect**：最多2连接/40query/9metadata。成功Run则原V4 `inspectOnly` 独立回读73表/九seed/catalog/容量/OID且与Run一致；停止Run则两只读事务只查准确owner/目标目录/context/大小，最多9query，不执行restore/迁移或业务计数，不假称rows/seeds已验收。两个槽均在连接前永久消费。

## 新槽及输出

新Run槽 `techlong-d002-express-c3-restore-only-v4.permanent-slot.json`，独立Inspect槽 `techlong-d002-express-c3-restore-only-v4-inspect.permanent-slot.json` 当前都不存在。旧C3b/c/d/e槽和记录不改。

`stages.jsonl`保留原INTENT/OBSERVED/FAILED；新增 `CATALOG_OBSERVED`，按phase保存 `catalog-empty-before-write.json / catalog-baseline-before-verifier.json / catalog-migrated-before-verifier.json`，独立Inspect为 `catalog-independent-final.json` 或 `catalog-independent-after-stop.json`。报告schema `techlong/express-restore-catalog-report/v1`；原prepared/schema V4协议不伪造升级。观察或校验通过不安装ready fingerprint、不开启runtime。

## 完整风险

1. Source仍是既有管理员，本地受审SQL/allowlist不是新的服务端最小权限边界，不代表应用或Fargate/runtime权限已安装。
2. 固定可信DDL/函数/trigger及迁移在一个事务里执行；COMMIT失响应、postcommit/journal/metadata失败可能留存已提交结构/九seed。dispose连接不等于独立证明rollback，没有自动down/delete/补齐/复位/重试。
3. 记录先于原校验，但fsync/磁盘/大小/SQL/凭据/超时仍可能阻止完整报告，不能保证原异常一定唯一复现。额外空目录查询在事务内，但READ COMMITTED/合作锁不是跨服务CAS，特权并发者可竞态。
4. 原schema/native编译产物仍在私有本地工作区；捕获收据只存安全摘要，原定义和token在内存处理/JS-driver清零尽力而为，提供者可记录SQL/连接元数据。不把源码与凭据或业务数据混淆，归档不上传。
5. 原安全模型继续原样，合法实际PG17目录仍可能被拒绝；本次捕获不授权修改模型或自动重试。只有具体拒绝报告后才审阅窄修正。
6. 槽在连接前永久消费，读回/证据失败也不自动复位。Source不可用时不重跑失败Run；刷新先只读核对/新清单，不能代替写批准。
7. 恢复/连接可能唤醒现有cluster产生ACU/storage/I/O费用；**50USD/月是目标非hard cap**，现有库/cluster留存且无自动cleanup。此前空集群清理范围不适用。
8. 512MiB仅租户门禁，不证明集群/Free Plan总容量。其它库PUBLIC CONNECT保持，app仍NOLOGIN，没有应用隔离/真实登录、Secret-v2或ECS/ready证明。
9. 成功Inspect是结构/技术seed验证，不是运行时验收；失败Inspect仅目录/context，不证明业务行数、历史COMMIT/rollback。独立Inspect本身也可能漂移/失败且不得重放。
10. 不修改AWS/IAM/Secret/Neon/旧业务或F3c9，不部署Cell/ECS、不创建商户账号、不调用Lambda、不激活权限、authority、TTL/job或runtime。以后这些范围仍另按fresh具体清单批准。

## 必要验证与实际pins

5新+4相邻检查共9项通过；新检查调用真实冻结PG17 verifier，原seed/size SQL与V4 port逐字节一致，准确空hash/漂移拒绝、拒绝报告先保存/敏感值剥离、未迁移或final未通过在COMMIT前拒绝、只读Inspect不能写及fresh SHA/扩大scope拒绝均过。typecheck/syntax/定向eslint无warning；这些不当真实PG17恢复证明。

原归档/private brand重编译后SQL identity仍 **`55733716d897ee5cdcd80abffb85c277ca148b4d7c3af5a8d199a4f7fd5bbfa4`**，固定archive/manifest/两迁移/restore-verification/row-count/catalog pins和原Backend源码 **62010acfa7006bb5d03045591d6d3f37d70dfab8** 不变。无需新Backend CI/镜像/权限发布；此前镜像成功也不替代新实机DDL。

229 code entries+原2工具，原226/224/212/183pins保持。当前code binding `277ae66e812dde07027ab9391dc21c98469e54b6bef5968cf8a3123e370e4239`，history `da9bb6d8a78c1c6f65f35ce83eba971ed0bf5181878b97c334c960bb2752ce8c`。

实际Root错误SHA负例 `...-c3f-negative-20261014-r3` 在编译/AWS/SQL/槽前返回 `EXPRESS_C3F_FRESH_APPROVAL_REQUIRED`，计数0，stopped字节SHA `89c23a97155375ad51f226acfdf980aa8da0dc0845125ff57af4c3ffd0d7bf5e`。r1准备417f666e...因补对象级ACL摘要已过时，r2 dc6b...因入口末尾空行清理也已过时；全部原件保留，**只使用最终r3 a5c7 SHA**。

## 唯一继续点

具体批准当前a5c7 SHA及上述恢复/九seed/独立Inspect和完整风险 → 有效窗口内一次Run → 成功或停止后立即一次独立Inspect。仅“开始下一步”授权本轮编码/准备，不授权这些SQL写；没有新探针或prepare/建库/角色动作。完整命令和紧凑状态见[继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3f-restore-only.prepared.json)。
