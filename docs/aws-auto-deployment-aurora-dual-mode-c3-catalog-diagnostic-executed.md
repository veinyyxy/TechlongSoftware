# D002 C3e实际执行：当前用户目录为空，保留准确库进入窄恢复设计

2026-10-14 America/Winnipeg。用户“确认”批准[新872e清单、只读范围及完整风险](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-refreshed.md)。在20:02:09.481 UTC截止前，原冻结Root只运行一次，执行成功；**本次无数据库或AWS资源写，唯一诊断槽现已永久消费，不再追加SQL诊断或重放。**

## 已观察的真实结果

- 槽于14:09:33.765 UTC / Winnipeg09:09:33.765 CDT消费，14:09:57.890 UTC / Winnipeg09:09:57.890 CDT形成观察。总计2个SQL物理连接、9次固定query、9次直接metadata（含同份snapshot STS及后置cluster/writer/Source核对），没有业务表查询、Secret读取或写调用。
- 结果 `CURRENT_TENANT_CATALOG_EMPTY_ORIGINAL_REJECTION_NOT_RECONSTRUCTED`。准确租户库 `tenant_a0da1748bc4d5419_db` / **OID16459** 和准确app/OID **16456** 保持；严格V4 promotion policy再次通过，库postgres/OID **16410**所有、原ownership/ACL/连接状态符合，app NOLOGIN/零成员，guard缺席。
- 管理目录SHA **`30c1559c488e1885d59a4c897f3966450fff28a943637f0887133faecf582553`** 与C3d promotion及独立管理Inspect一致。没有重建角色/库、恢复guard或改变所有权。
- 当前租户目录SHA **`56f65c613ba62ada90240b72679ca0323b3e0b8414f85b25f6263d360be5b0d7`**，canonical目录449字节。原目录查询覆盖的relations（含表/索引/序列）、functions、extensions、types、collations、eventTriggers全0；用户表0、原73表缺失、额外表0。不是“数据库物理大小0”，实际库大小 **8,537,331字节**（含内置对象）。
- 唯一用户schema是public，owner pg_database_owner；PUBLIC仅USAGE、owner CREATE/USAGE，grantor与owner符合，均不带grant option。此条件当前通过。
- 原未改PG17校验器在当前空目录返回CATALOG_REJECTED，与独立17组解释谓词一致；当前拒绝项仅 `exact_73_tables / uuid_extension_only / uuid_extension_version_schema_owner`。其它空集合上的通过项不证明曾恢复对象的属性安全。

**这些缺表/缺extension是当前空目录的结果，不是原失败事务的原因。** 原C3d在restore后的临时完整目录拒绝，事务关闭后那些对象未在本次快照留存；本次不能唯一复原原拒绝项，不能倒填“原来因为没执行restore”，也不单凭当前空目录证明历史rollback命令/COMMIT状态。`originalFailureConditionProved=false / rollbackIndependentlyProved=false / rowCountsRead=false`保持。

## 证据字节SHA256

| 文件 | SHA256 |
| --- | --- |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-catalog-run-20261014-r2/observation.json` | `8bd2d3b35f7f490f991124c8136c5429a7388c02c2b4c1174fdb17ae91da6329` |
| 同Run目录 `result.json` | `a386f78167778f388fda4f663572b179f0b88ae3ff88b727427a6bae8379a4af` |
| `F:/ChatGPT_workshop/techlong-d002-express-c3-pg17-catalog-diagnostic-v1.permanent-slot.json` | `30a48f9e71e0ee87c803b6b02275ccf9685d01b604a49710900c236fcd564a59` |

本次准确SHA `872e302703b3e09bcbf9a439b3d6eef818e5643ead4872fee523a81ab7c7e5cf`，code binding `91a2c8e1ce994e607a709ac90b2a827f0bd6cb9cfcba67e6eff5f84b527d38db`、history `783a896da1af5d3379c33c93e5fb776a1913a6ff66b2e840d121dafeae0b1b96`、226/224/212/183源码pins与2工具保持。记录前本地独立核对三文件字节SHA、226源码LF-normalized SHA、2工具字节SHA、计数/OID/目录数量和槽时间全部通过。Source不可用的旧d82c Run-r1、全部C3d/C3c/C3b记录和槽保留。本轮仅保存结果与双仓交接，不重复相同测试、归档编译、镜像构建或ECR发布；Backend用户`.vscode/settings.json`不提交。

## 唯一后继：保留准确库的恢复专用候选，不再目录探针

该后继现已仅编码/准备为[C3f restore-only清单](./aws-auto-deployment-aurora-dual-mode-c3-restore-only-review.md)，最终a5c7 SHA待单独恢复批准、SQL/新槽0。原V4/Backend镜像和本页真实记录不改；不重放本C3e诊断。下方设计保持为收敛依据。

当前事实足以停止额外只读探针，下一小阶段仅编码/准备**restore-only受审入口**：

1. 绑定现有DB16459/app16456/owner16410、原nonce/ownership、本次空目录SHA及三项收据；执行前再次严格核对准确空库/NOLOGIN及固定输入，不接管非空或漂移对象。
2. 尽量直接复用已验收、冻结的V4恢复port/私有原archive编译品牌/原verification/两SaaS迁移/九seed和原所有权、容量、安全门禁。只恢复这一个已留存库，不重跑prepare、CREATE DATABASE、CREATE ROLE或guard删除，不新建角色/成员/Secret/IAM。
3. 在原恢复事务内、每次固定PG17目录查询返回后、原校验调用之前，先保存**安全逐谓词报告、catalog digest、数量和必要owner/ACL摘要**。优先在本地受审Root/driver装饰层捕获，保留原Backend源码/镜像和原判定逻辑；不为取证放宽门禁或安装新ready指纹。原始函数体、config、驱动文本或业务内容不落记录。
4. 原校验通过才继续迁移/原COMMIT；拒绝则保留具体报告并停止，不自动修补/重试。成功或停止后只在新具体批准范围内独立只读检查，不另建通用诊断/Grant工厂。

该后继只是设计方向，**尚无可执行写清单/新槽或SQL恢复授权**。必要本地源码/归档编译和真实输入校验用于新候选，不重复离线模拟或无变化镜像。任何安全模型调整需依赖具体报告单独审阅，不把已知空库当原校验误报证明。

保持 `runtimeEnabled=false / lifecycleCompatible=false / structuralPinInstalled=false`。没有PG17恢复/九seed成功、app LOGIN/rds_iam/应用隔离/Secret-v2、商户账号、任务、ECS或ready。现有cluster/准确库留存可能计费，50USD/月为目标非hard cap；不自动删除或启用cleanup，原Full/F3c9保持。[紧凑继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3e-catalog-diagnostic.prepared.json)。
