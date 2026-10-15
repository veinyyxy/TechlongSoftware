# D002 C4h：准确授予者校准，同一应用激活主线

2026-10-14 America/Winnipeg。依据[C4g实机写后记录及独立回滚核验](./aws-auto-deployment-aurora-dual-mode-c4g-role-grantor-observed.md)，仅校准本目标的 `rds_iam` membership grantor。**本轮 SQL连接/写、AWS写、Secret值/私密材料读取和执行槽消费均0**。没有应用登录、ECR发布或ECS部署，也没有恢复F3c9、Grant或恢复探针支线。

## 准确改变与保持的边界

C4g在写后记录实际 grantor=`rdsadmin`，冻结服务端V6期望`postgres`；COMMIT未提交、ROLLBACK收到响应，独立Inspect确认原NOLOGIN/closed。此观测直接定位C4g角色谓词，不倒填C4f未保存的原件，也不证明完整post-catalog或实际IAM登录已通过。

新增平台C4h入口只允许以下准确规则：

- 账户402010193138、ca-central-1；集群`techlong-sandbox-express-d001`，资源ID `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，17.9/server170009。
- 库`tenant_a0da1748bc4d5419_db`/OID16459；角色`tenant_a0da1748bc4d5419_role`/OID16456；管理`postgres`/OID16410。
- closed仍NOLOGIN、parents空；active恰好一个`rds_iam`/OID16389 parent，grantor必须`rdsadmin`，ADMIN/INHERIT/SET均false。不接受`postgres`回退、其它grantor、重复或额外parent；closed/active均固定IAM角色OID16389。
- 私有副本只将这一grantor投影为旧V6要求的`postgres`以复用所有其它冻结角色谓词；**不改真实响应、SQL、日志或实际digest**。返回实际角色digest/实际grantor和独立校准policy SHA，不返回伪造的观测。
- 旧V6、C4f/C4g源码与全部历史槽保持；原完整目录/ACL/owner、四库完整ACL、九技术seed/业务count0核验不改。完整post-catalog必须实际通过，旧脱敏inventory和80条ACL向量检查不能代替它。

校准policy SHA：`4fd85dd40bbd7296429c4e2938f0cb8f5c131dfffd4565dac0359c9d562f475e`，绑定C4g已消费证据清单`9a72074b...`。引擎/角色OID或授予路径改变时拒绝并另审，不自动适应。

## 待批准清单与调用范围

最终r2 SHA：

`f6e1fc317da5607bd97aa3635cd8212fb1e6e7211b71b958ad15e2f0b857b3e5`

准备：Winnipeg **2026-10-14 19:37:18.572 CDT** / UTC2026-10-15 00:37:18.572。
截止：Winnipeg **2026-10-15 01:37:18.572 CDT** / UTC2026-10-15 06:37:18.572。

文件：`F:/ChatGPT_workshop/techlong-d002-express-c4h-review-20261015-r2/manifest.json`。目录按UTC日期命名。旧批准、过期清单或JSON复制的私有程序不能执行。

一对**新的独立永久尝试槽**，不是C4g/C4f槽复位或重试：

- `F:/ChatGPT_workshop/techlong-d002-express-c4h-application-install-v1.permanent-slot.json`
- `F:/ChatGPT_workshop/techlong-d002-express-c4h-application-inspect-v1.permanent-slot.json`

批准范围仍为原八语句的一次事务：准确租户库CONNECT、public USAGE、73明确表SELECT/INSERT/UPDATE/DELETE、7明确序列USAGE、三条`rds_iam` SET/INHERIT/ADMIN FALSE及LOGIN。程序digest `a9dedc4537c3656c073e9f7a6872d1d718785acb281bafe80ebd72b7243140c6`，`program.json`原字节SHA `9df67b2aa6c6199745994baad3a61ce3d37ec65c79e6239540871590a5347af9`，与C4g/C4f完全相同。没有DDL、新函数权限、default privileges、grant option、序列UPDATE、其它库权限或业务行写。

一次Run：1管理TLS连接，正常21查询/提交前一次ROLLBACK最多22，最多8权限/LOGIN语句。写前后检查准确closed→active角色、四库ACL、应用ACL投影后的完整原目录和全部表count；必须全部通过才COMMIT。C4g同次既有响应的有限证据仍保留，不增加诊断SQL/查询。

成功或失败后唯一独立Inspect：1管理READ ONLY TLS连接，正常8查询/失败最多9；仅完整exact active通过才最多1应用READ ONLY TLS连接/6查询（失败最多7），用Source内存签名IAM token验证准确SQL用户、上下文、受限成员关系、DML/序列权限元数据及count。原closed只报告未安装，不尝试应用登录或重放。

每模式至多32只读元数据调用；无AWS资源写、IAM/Secret/Neon/authority修改、GetSecretValue/私密材料读取、AssumeRole、商户初始化、ECR/ECS/Cell部署或通用runtime启用。本批准不包括后续ready/初始化或部署。

## 已完成的验证与只读准备

8项新校准/编排测试加14项冻结相邻测试全部通过，types/syntax/定向lint通过。覆盖原生pg.Result含函数解析器（不可整体structuredClone）、实际digest/input不变、准确授予者和OID、全部原角色拒绝、旧SHA/改policy/JSON品牌/过期拒绝、准确目标限制、原21-query流程、目录/count仍挡COMMIT并回滚、COMMIT未知不自动补偿。合成VM测试不冒充云结果。

r1 Review在第12个只读metadata计数处提供者失败，未生成manifest；具体提供者原因未确定，材料保留。随后一次CLI STS及一次SDK GetRole只读检查通过；最终新目录r2的25个metadata调用成功，精确核对原IAM默认v4/保留v3/七消费者、固定Secret、Express17.9/FREE ACTIVE和Source两username connect模拟。Review共37个计数，另2个只读检查；没有SQL，因此当前NOLOGIN/目录/行数仍是C4g独立Inspect的历史事实，真正执行前必须同事务重新核验。

263当前源码pins/2工具、原260源码及17历史文件原字节保持，原受信归档重新编译/private品牌通过。校准代码只新增三文件，服务端153efbc执行源码及已验镜像不变。真实CLI带旧9a720批准在LOCAL_BINDING拒绝，AWS/SQL/槽/原生编译均0。六份最终Review、代码/工具/历史、原program及新双槽不存在均已本地核验，没有追加云回读。[文件SHA及继续位置](../ops/aws-sandbox/reviews/aurora-express-c4h-role-grantor.prepared.json)。

## 完整风险

- 八条权限/LOGIN提交后为持久73表DML，包含租户技术/授权表，不是行过滤或只读应用。准确授予者校准不增加SQL权限，但承认该托管授予路径；原PUBLIC函数权限保留，最小权限不能证明所有应用行为安全。
- ADMIN/INHERIT/SET仍false。真实受限IAM登录兼容性尚未证明；即使本次Source签名应用登录通过，也不证明ECS task/session/SCP/KMS或完整ready，不静默提升成员选项或回退密码。
- 事务快照、fresh AWS metadata、OID/版本核对不是跨服务CAS，也不阻止并发特权写。实际grantor/目录等任一变化仍可严格拒绝；此批准不授权后续修复或再试。
- Run COMMIT与独立Inspect非原子。COMMIT丢失响应、持久化失败、后续连接或校验失败可能留下未知或已LOGIN/DML状态；只在提交前有一次受限ROLLBACK，提交后不自动down/撤权/补齐/回滚或重试。
- 本地有限证据保存发生在同次事务内，磁盘失败/延迟可导致abort或未知状态；框架不是第二次实时SQL观察。它只保留角色/成员元数据、准确对象应用ACL向量、目录digest及count，不保存DDL/函数/config/业务行/提供者message。配置仍由冻结SQL脱敏。
- 一对新永久槽在连接前消费，旧记录全保留。失败不删除/补齐/复位/重试；槽占用后只能核对事实和另审后续范围。本次不重放C4g/C4f或其它历史槽。
- AWS token/SQL认证材料仅内存使用、擦除尽力而为，服务端/提供者可能保留连接/query元数据；连接可在无MFA提示时失败。最多三次SQL连接可唤醒Aurora并产生ACU/I/O等费用，50 USD/月是目标而非硬cap，非绝对零费用。
- C4e已有持久IAM能力/共享Secret版本Deny及CFN drift风险不撤销；已有Secret和其它资源费用保持。本轮不读取Secret值、不改IAM/Secret/Neon/业务/authority或部署Cell，不升级账户，不改变旧Full或F3c9封存。

## 唯一继续位置

等待用户明确批准本新SHA、上述准确校准、原八SQL、独立永久槽/管理Inspect及仅exact active时一次Source签发的应用TLS IAM登录，并接受完整风险。确认仍fresh后一次Run，立即独立Inspect；如凭据失败/窗口过期，保留回执并只读核对，不自动重试写入。

若实际全核验和应用登录成功，直接同一单租户主线推进PG17完整ready/初始化和已验镜像ECR→ECS；新的实际初始化/发布/部署范围另审。若原目录/count/登录再失败，只基于本次确切差异处理，不扩展同类探针、Grant/恢复或F3c9。
