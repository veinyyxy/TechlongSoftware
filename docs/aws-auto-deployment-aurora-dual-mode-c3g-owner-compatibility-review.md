# D002 C3g：准确 AWS 扩展所有者兼容与同库恢复待审

**已单次执行且双槽永久消费（2026-10-14）。** schema/两迁移/九seed及立即独立Inspect均通过；当前仅运行时未验收。下方是执行前清单历史，不能作为未执行状态或重放授权。见[实际执行结果与唯一后继](./aws-auto-deployment-aurora-dual-mode-c3g-restore-executed.md)。

2026-10-14 America/Winnipeg。直接承接[C3f真实拒绝报告](./aws-auto-deployment-aurora-dual-mode-c3-restore-only-executed.md)，不新增诊断SQL/Grant/F3c9支线。V5窄修正、平台受审入口及必要自检已完成。**本轮SQL连接/写、AWS资源写、新永久槽消费均0；尚未批准第二次恢复。**

## 当前唯一待审SHA

`1c0d3371744eecbf9f0346059a0305b4ce365862c4d6615462d524b038965307`

生成 **2026-10-14 15:55:07.952 UTC / Winnipeg10:55:07.952 CDT**；截止 **21:55:07.952 UTC / Winnipeg16:55:07.952 CDT**。Source刷新不授权SQL，过期不执行/自动延长。私有清单 `F:/ChatGPT_workshop/techlong-d002-express-c3g-review-20261014-r2/manifest.json`。

独立新进程 `...-c3g-metadata-20261014-r2/facts.json` 于15:55:37.857 UTC / Winnipeg10:55:37.857 CDT只读成功；与Review的Source、准确cluster/writer/creation/tags、FREE/ACTIVE及连接模拟事实除observedAt外一致，各5次直接metadata、SQL0。facts字节SHA `9203b755d656ef19f92506a1b04ea950218d2eda9e7819b66a55a361066a40b1`。不是PG17实机恢复/计费hard cap证明。

## 本次仅修正一个已观察字段

真实C3f baseline报告中，17组旧谓词只有 `uuid_extension_version_schema_owner` 拒绝：唯一uuid-ossp版本1.1/public匹配，owner为rdsadmin。V5对准确cluster `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM` / engine17.9 要求此扩展**恰为 uuid-ossp / 1.1 / public / rdsadmin**，postgres或未知owner也拒绝，不能作为通用Full/任意Aurora放宽。

新校验器只在内存私有验证投影中把这一字段对应旧模型，调用冻结V3以证明其余条件仍成立；**不修改SQL或原查询结果、不将投影目录当实际收据**。输出始终取原始目录digest/bytes。V5 provider所有apply SQL、参数与顺序和V4逐字节一致；原V3/V4源码、严格角色/OID/NOLOGIN/private archive brand、两迁移/73表/九seed/容量门禁保留。新schema收据v5、新capture收据v2分别保存旧校验与V5 admission结果，不伪造旧成功，不学习ready pin。

版本支持可参考[AWS官方扩展版本表](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraPostgreSQLReleaseNotes/AuroraPostgreSQL.Extensions.html)，但该通用资料不证明本实例的owner；本次所有者选择来自准确C3f实机安全报告。

## 准确恢复范围——具体确认后才执行

- 只复用 `techlong-sandbox-express-d001`、准确writer/gateway/IAM及当前资源绑定；现有tenant库 `tenant_a0da1748bc4d5419_db` / **OID16459**，owner postgres/OID **16410**，app role/OID **16456** 保持NOLOGIN/零成员/无提权，guard缺席，原nonce/ownership不变。
- 不prepare、CREATE/DROP DATABASE/ROLE，不新增成员、LOGIN/rds_iam/app权限，不复原guard，不改AWS/IAM/Secret/Neon/旧业务/F3c9、不部署Cell/ECS、不创建商户账号、job/authority/TTL或runtime。
- 写前原EMPTY门禁及同事务额外固定PG17目录必须精确匹配当前空目录 SHA **56f65c613ba62ada90240b72679ca0323b3e0b8414f85b25f6263d360be5b0d7**；非空/漂移立即停，不接管或清空。
- 一次原固定73表schema-only恢复及两项SaaS迁移同事务，只九条技术seed（singleton1/entitlement8）；原业务零行、seed/null字段/固定默认值、512MiB、前后owner/OID检查不变。baseline/final目录在V5 admission前fsync保存安全报告；baseline不过不能迁移，两迁移/final不过在COMMIT派发前挡。
- Run最多2物理连接/40次pg query/9次metadata，pair120秒、connect30秒、Source内存snapshot至少余5分钟并同份STS检查；正常流26query（不是DDL语句数）。同一批准还含一次独立新进程Inspect，最多2连接/40query/9metadata。
- 成功Inspect以V5原流程回读73表/九seed/实际目录及容量/owner，并和Run一致；失败Run后的Inspect仅两个只读事务核对owner/目标目录/context/容量，9query、不读业务行，不把其当迁移/提交/rollback证明。
- 新永久Run槽 `techlong-d002-express-c3-restore-only-v5.permanent-slot.json`、Inspect槽 `techlong-d002-express-c3-restore-only-v5-inspect.permanent-slot.json` 当前均空。**这是另审新尝试，不是旧a5c7/旧双槽的复位或重放**；全部旧记录保留，失败不补齐/down/reset/retry。

## 必要验证和实际pins

Backend3新+8相邻检查/typecheck通过；V5正例、实际digest不变、23组其他字段负例、目标/私有品牌拒绝，以及apply每个SQL派发/顺序等价V4均验证。平台4新+5相邻/typecheck/定向eslint零warning/syntax通过；双校验报告分离、敏感摘要、写前准确empty、迁移/final/COMMIT门禁、只读不能写、错误SHA/过期/重签扩大scope及原SQL绑定通过。均不当实机恢复证明。

服务端执行源码 **12400d40b0fea58ce5d502a1082e39e6c18ddef6**：完整[CI38592688849](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38592688849)和[双镜像38592689025](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38592689025)均success。CI jobs115951368055/115951368721，app115951370746、lifecycle115951371183所有steps通过；两最终镜像新增V5 `--network none`自检成功，旧dual-mode/V4、toolchain、Full默认入口及HIGH/CRITICAL门禁保留。只构建/保留候选，无AWS credential/OIDC、ECR发布或ECS。[紧凑云验证记录](../ops/aws-sandbox/reviews/aurora-express-c3g-cloud-validation.json)。

原archive/manifest/restore/verification/PG17 catalog/row-count/两迁移字节和V4角色policy/续建program均保持，真实native编译/原private brand通过。新program identity **4468b84cbc553812ab143561ad72011cf294ebff2e4185d9422b7eac1033e982** 仅比原557337...增加 catalogPolicySha **5bc73bb1e9f094a67bd4bf06bb8972d88f6cc84449734e21c99c915c79e148f2**，并非SQL改写。

236当前code entries+两原工具；原229中228不变，唯一更新旧双镜像workflow增加8行V5无网络自检，其历史版本从准确Git提交7648f07核验原pin，现行版本另入新SHA；增加7项V5运行源。本阶段不运行旧Root，不声称旧229全部未变。code binding **d588ae8af11d72d606506b8cdcecc5aa1c613c6a0e432357c370bb6444f90dc2**；history **192bf08034227f6ff9c8af2f4ded972adc92ea1bcc324d0c318388dfe6310b2e**，直接绑定13个既有文件（包括C3f失败报告/独立观察/旧槽/原清单）。

真实Root错误SHA负例 `...-c3g-negative-20261014-r3` 在编译/AWS/SQL/槽前返回 `EXPRESS_C3G_FRESH_APPROVAL_REQUIRED`、计数全0，stopped字节SHA **69a85a9337ca8971419e120f1d0b2fce8480a3d3b50a9de6447fbfe7563d7d1b**。此前非提升negative-r2在manifest读取前泛化停止，不能作为SHA门禁证明，原件保留。本轮最初Review-r1在Source unavailable停止、SQL/槽0，stopped字节SHA **4988a9d98fd515eb6e24f08a6c258941d7a33e849837bb174ccbe4632ad81fee**；用户Source刷新后只新Review-r2和独立metadata，未重试SQL。

## 完整风险

1. Source是既有管理员，受审本地Root/allowlist不提供新的服务端最小权限边界。此修正只是固定PG17目标的扩展owner模型，不代表Full通用兼容、角色权限或运行时验收。
2. 原可信DDL/函数/trigger与两迁移/九seed同事务；COMMIT失响应或提交后证据失败可能留存结构/seed。断开连接不证明rollback；没有自动down/删除/补齐/复位/重试。
3. 校验前fsync报告可能因磁盘、查询、credential或超时失败而不完整；原始定义/token在内存处理，JS/driver清零尽力而为，提供者可能记录SQL和连接元数据。安全收据不输出原定义/配置/凭据。
4. 准确empty/hash/OID及合作锁不是跨服务或跨进程CAS，特权并发者可竞态；before/after metadata与独立Inspect也有事实窗口，不能保证无并发漂移。
5. V5只改变恰当一字段；其余严格PG17门禁仍可能拒绝迁移后的合法目录，此批准不授权再改模型或自动重试。新实际目录仍按真实结果审阅，不学习ready fingerprint。
6. 两新槽连接前永久消费；调用、读回、记录失败均不自动复位。Source不可用则保留停止，不重跑失败Run；刷新仅只读新清单，仍需具体新SHA确认。
7. 连接/恢复可能唤醒留存cluster，产生ACU/storage/I/O费用；**50USD/月是目标而非hard cap**，现有资源留存，无自动cleanup，过去空集群删除范围不适用。
8. 512MiB仅租户门禁，不证明集群/Free Plan总容量、账单或credit。FREE/ACTIVE仅观测；其它库PUBLIC CONNECT未改，app仍NOLOGIN，没有应用隔离/真实登录/Secret-v2/ECS/ready证明。
9. 成功Inspect是结构/技术seed验证，不是运行时验收；失败Inspect仅目录/context，不证明业务行数、历史COMMIT/rollback。独立Inspect也可能失败/漂移，不得重放。
10. 后续 app LOGIN/rds_iam/grants、Secret、IAM、Neon、ECR发布、Cell/ECS、商户账号、authority/TTL/job、runtime都不在本次范围，另按fresh具体清单批准。

## 唯一继续点

用户具体确认当前1c0d337 SHA及上列同库恢复/两迁移九seed/独立Inspect与完整风险 → 有效窗口内一次Run → 成功或停止后立即一次独立Inspect。旧a5c7/旧槽全部不可执行；仅“开始下一步”不授权恢复写入。完整命令/状态见[继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3g-restore-only.prepared.json)。
