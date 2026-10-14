# 单租户首轮 AWS 自动部署：当前执行主线

决策D001，2026-10-13 America/Winnipeg。用户在审计后明确同意收缩首轮目标并开始实施，同时要求封存F3c9以便重启。此文档取代旧方案中的“继续F3c9”作为当前导航；[原支线封存](./aws-auto-deployment-f3c9-deferred.md)，所有历史保留。

**当前路线 D002（更新2026-10-14）**：用户暂不升级账户，采用 Aurora Express / Full 双模式兼容设计：当前优先 `express_iam`，未来保留 `full_password`。双模式适配、云端两镜像和Express schema/两迁移/独立回读已完成（C3g），应用角色仍NOLOGIN、runtime/ready未启用。下一仅准备准确租户的最小权限、Secret-v2及PG17运行时接线候选；实际授权/登录/Secret/IAM/ECR/ECS写仍fresh具体清单另批。不重放已消费C3槽、不删除旧Full失败Stack、不扩展F3c9；下方旧“升级后继续”等记录仅历史。[完整兼容、快速切换、风险与实施顺序](./aws-auto-deployment-aurora-dual-mode.md)。

## 首轮交付定义

最新C3g实际（2026-10-14）：用户要求按1c0d337清单开始后唯一Run及立即独立Inspect均成功，16:08/16:09 UTC确认73表、两原迁移、九技术seed且其他业务count0；准确DB16459/owner16410/app16456 NOLOGIN/零成员/guard缺席保持。baseline真实hash868ca1...与原C3f拒绝目录相同，V5仅owner窄差异使17组通过；最终catalog hash93d3c7.../744,370字节在Run和Inspect一致，返回实际digest不改写目录。Run2连接/26query/9metadata、Inspect2连接/17只读query/9metadata，AWS资源写0；物理大小12,223,731/12,322,035都过512MiB，不作容量/账单cap证明。V5双槽永久消费，不重放1c0d、旧a5c7或任何槽；结构pin/LOGIN/runtime/ready/lifecycleCompatible仍false，无IAM/Secret/Neon/ECR/ECS改动。本轮仅结果文档、236源码及Backend12400d4/已验镜像保持。下一只准备应用最小权限、IAM登录/Secret-v2和PG17运行时接线清单，实际写另批，不再目录/恢复探针或F3c9。[完整实机证据与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c3g-restore-executed.md)。下段待审状态已消费，仅为历史。

最新C3g待审（2026-10-14）：V5只修正实际uuid-ossp/1.1/public/rdsadmin owner模型，原V3/V4/SQL/角色/73表/seed门禁不改，返回实际目录digest，旧拒绝与新admission分离；V5 apply所有SQL派发/顺序与V4逐字节等价。Backend3新+8相邻/typecheck、平台4新+5相邻/types/lint/syntax过；源码12400d4完整CI38592688849和双镜像38592689025所有steps均success，两个最终镜像新增network-none V5自检过，不发布ECR。新Root真实编译原归档/private brand通过；Source刷新后Review-r2及独立metadata各5只读过、SQL/资源写/新双槽0。236当前pins+原2工具；原229只有imageworkflow新增8行发生变化，历史版本核对并现行重绑，228原文件不变。新SHA1c0d3371...到Winnipeg2026-10-14 16:55:07.952 CDT待同库73表/两迁移九seed/独立Inspect明确批准；旧a5c7和双槽不重放，不再探针/建库角色/Grant/F3c9。[准确新范围、完整风险与继续点](./aws-auto-deployment-aurora-dual-mode-c3g-owner-compatibility-review.md)。

最新C3f实际（2026-10-14）：确认a5c79后唯一一次restore-only Run在15:33 UTC停止，原schema派发后含73表条件在内16组通过，唯一拒绝 `uuid_extension_version_schema_owner`：uuid-ossp版本/schema匹配但实际owner为rdsadmin。校验前安全目录报告已保存，未进入迁移/COMMIT成功状态；Run2连接/13query/6metadata、资源写0。立即独立Inspect2连接/9只读query/9metadata，管理SHA30c1559c.../严格owner/OID保持，当前用户目录全0且完整hash56f65c...与写前相同、物理大小9,069,811字节；不声称历史rollback/九seed或ready已验收。双槽永久消费，a5c7不能重放，不改门禁/补齐/down/重试。下一只准备针对准确扩展所有者的窄兼容修正，保留其他安全门禁，不再SQL探针/建库角色/Grant/F3c9；后续写仍fresh新SHA和新槽另批。本轮只结果文档，229/226/224/212/183pins、Backend62010ac源码及镜像保持，50USD非cap。[实际原因、证据与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c3-restore-only-executed.md)。下段准备状态已尝试，仅为历史。

最新C3f待审（2026-10-14）：同库restore-only Root/fresh review/tenant query捕获已实现，复用冻结V4和原archive/private brand/73表/two migrations，真实编译SQL identity557337...保持，无Backend源码/镜像变化。DB16459/app16456/owner16410/guard缺席及C3e空hash56f65c...绑定，写前同事务额外一次catalog必须精确匹配；不prepare/建库/角色。baseline/final校验前保存安全逐谓词及对象级ACL报告，原冻结verifier不改，迁移/final未通过在COMMIT前挡。5新+4相邻/types/lint/syntax通过，实际错误SHA在编译/AWS/SQL/槽前拒绝；最终Review r3+独立metadata各5只读过，229/原226/224/212/183+2工具保持，SQL/云写/新两槽0。新SHA a5c79b93...到Winnipeg2026-10-14 16:05:41.962 CDT待具体恢复/九seed/独立Inspect批准；旧417f r1已过时，不再目录探针/Grant/F3c9。[完整范围、风险与唯一继续点](./aws-auto-deployment-aurora-dual-mode-c3-restore-only-review.md)。

最新C3e实际（2026-10-14）：用户确认872e后一次只读Run成功，14:09 UTC两连接/九query/九metadata、业务查询及写0；严格owner policy通过，DB16459/app16456/NOLOGIN/guard缺席和管理SHA30c1559c...保持。当前租户目录SHA56f65c61.../449字节，用户表及relations/functions/extensions/types/collations/eventTriggers全0，public owner/ACL通过，库物理大小8,537,331字节。当前缺73表/uuid导致三谓词拒绝，不倒填原失败原因或证明历史rollback。诊断槽永久消费，不再SQL探针；226/224/212/183源码/镜像保持，只保存证据。下一只编码/准备保留准确库的restore-only候选，复用冻结V4/原archive/two migrations，在事务内原校验前保存安全逐谓词报告，不重跑prepare/建库/guard/Grant/F3c9，不改门禁；实际恢复写fresh另批。[真实结果与唯一后继](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-executed.md)。下段待审状态已消费，仅保留历史。

最新C3e刷新（2026-10-14）：用户Source刷新后仅Review r2+独立metadata r2各5次只读通过，SQL/新槽仍0；新旧清单除时间/facts/SHA外完全同范围，226/224/212/183源码和2工具/code/history均不变，原d82c与停止回执保留，不重复测试/compile/镜像。新唯一待审SHA872e3027...，截止Winnipeg2026-10-14 15:02:09.481 CDT；一次最多2连接/9固定目录query、业务查询/写0，范围及完整风险保持，待新具体确认才SQL，不重跑停止Run或重建DB/guard、不回F3c9。[新清单与准确继续点](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-refreshed.md)。下段Source不可用状态为历史。

最新C3e停止（2026-10-14）：用户确认d82c后原Root一次在13:52 UTC的READ_ONLY_METADATA返回SOURCE_CREDENTIALS_UNAVAILABLE，未形成本次完整facts；SQL连接/query/写0、新永久槽未消费，metadata计数3不代表成功回读。没有新租户目录观察，不把其当目录校验失败/自动重试授权。226/224/212/183源码pins与镜像保持；仅记录停止证据/交接，不重复测试/构建。下一Source刷新后只生成新fresh只读清单并独立metadata，保留原d82c/停止目录/旧槽，再按新SHA确认SQL，不重建库/guard、不回F3c9。[真实停止与准确继续位置](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-stopped.md)。下段待审状态已尝试，仅保留历史。

最新C3e待审（2026-10-14）：平台本地准确库只读目录诊断已实现，绑定C3d七真实证据、DB16459/owner16410/app16456/guard缺席，最多2连接/9固定query、业务表查询0、写0；原PG17目录SQL/校验器和V4 owner policy保持，17组解释谓词必须与真实原校验一致，不自动放宽/学习ready。4新+5相邻检查/types/syntax/lint通过，实际错误SHA负例在AWS/SQL/槽前拒绝；Review+独立metadata各5只读通过，SQL0/新槽0，新226/原224/212/183pins保持，Backend源码/镜像不改。待确认新SHA d82c6da5...，截止Winnipeg2026-10-14 14:31:05.518 CDT。若当前catalog为空不能倒填原事务失败目录，不重放DDL制造证据；只读观察后收敛保留准确库的窄恢复候选，后继写另批，不重建库/guard、不回Grant/F3c9。[新SHA、范围和完整风险](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic.md)。

最新C3d实际（2026-10-14）：用户确认87c5995e...后单次Run在12:38 UTC完成准确建库/promotion，库OID16459转postgres/OID16410所有，准确旧guard16457删除，原app16456保持NOLOGIN，无新角色/成员；恢复事务被具体 `AURORA_V3_PG17_CATALOG_REJECTED` 拒绝，没有schema/COMMIT成功证据。立即独立Inspect确认留存库/app及guard缺席，完整目录SHA与promotion相同，但未连接租户库，不能称恢复成功或空库。Run3连接/26query/9metadata，Inspect1连接/4只读query/9metadata，云资源写0，双槽已消费不可重放；224/212/183源码pins和Full/F3c9保持。下一仅准备绑定真实库OID/失败回执的新窄只读目录诊断，定位准确拒绝条件后再审恢复；不放宽校验、不重建库/guard、不给app权限、不部署ECS。50USD非cap，留存资源可能计费。[实际证据与唯一继续点](./aws-auto-deployment-aurora-dual-mode-c3-continuation-executed.md)。下段待审状态已消费，仅保留历史。

最新C3d：严格V4 app零成员/guard准确唯一授权共同覆盖续建及restore，复用原归档/PG17/两迁移，只剩8条prepare语句、无CREATE ROLE/GRANT/app ADMIN；V4收据与新双槽不伪造旧成功。必要Backend8/平台4/types/lint、真实archive-brand拒绝V3 prepared、Root错误SHA全0负例通过；最终62010ac完整CI38561294834/两镜像38561294979均success。原212/183pins保持，新224+2工具r2清单87c5995e...和独立metadata各5只读通过，SQL/云写/新槽消费0；待具体批准准确复用role16456/16457、建库/promotion删除guard、73表及九seed恢复迁移和独立Inspect，截止Winnipeg2026-10-14 13:06:11.476 CDT。没有IAM/Secret/ECS/运行时或ready，不重复C3c探针，不执行过时8758 r1。[准确新SHA、完整风险与唯一继续点](./aws-auto-deployment-aurora-dual-mode-c3-continuation-review.md)。

最新C3c实际：用户确认25dce036...后，唯一1连接/5固定query的角色目录诊断成功、SQL/AWS写0；app OID16456成员数0，使旧必须有管理成员/ADMIN两谓词拒绝，其余22项过，guard OID16457唯一准确postgres/rdsadmin ADMIN-INHERIT-SET全true/全部24项过。原catalog SHA与C3b失败后独立Inspect相同，准确库仍不存在；当前可复现旧校验模型不匹配，不唯一倒填原异常。后置独立5metadata通过，诊断槽永久消费，不重放。下一只编码保留现有两角色、严格app零成员/guard准确授权的续建与restore共用适配，原源/pins保留，后继建库/恢复写fresh另批；不额外给app ADMIN、不再角色probe/Grant/F3c9。[实际结果与最窄后继](./aws-auto-deployment-aurora-dual-mode-c3-role-diagnostic-executed.md)。下段待审状态已消费，仅保留历史。

最新C3c：绑定真实两角色OID16456/16457/nonce和五项旧回执的单次只读诊断入口已实现，1连接/5固定query/同一read-only快照，复用原校验器逐谓词报告，不能修改/接管/继续prepare。Source刷新后Review r3+独立metadata r1通过，各5次直接只读、SQL/云写/诊断槽消费0；错误SHA实际Root在AWS/SQL前拒绝。新SHA `25dce03675001fc6ff269cb5a0322a63d9baca9f2c5125ee6d462eef5d5918d2` 待具体SQL批准，到Winnipeg2026-10-14 12:08:21.746 CDT；212代码/旧210/183历史pins保持，必要5测试/types/lint已通过，不重复compile/镜像。下一仅按fresh SHA确认一次目录只读诊断；本轮元数据不是当前角色/故障原因证明，不重放原安装/复位旧槽。[准确只读范围、风险和继续位置](./aws-auto-deployment-aurora-dual-mode-c3-role-diagnostic.md)。

最新C3b实际：用户确认1df7e2f7...后，原Root仅一次Run，停在reserve提交后的目录核对/证据保存区间，返回AURORA_V3_SESSION_FAILED；立即独立只读Inspect确认app/guard两角色OID16456/16457、NOLOGIN及ownership匹配，指定租户库不存在。尚未进入创建库/73表恢复/迁移，两永久槽已消费，禁止重放/复位；没有ready或完整角色属性证明。共2个SQL连接/16次query，角色写已提交，AWS资源/IAM/Secret/Neon/ECS写0；执行源码/镜像和183pins保持。下一仅准备绑定真实OID/nonce的新准确目录只读诊断，额外SQL连接fresh另批，不重建/删除/接管/自动重试，不回F3c9。[实际证据、原因边界与唯一接续位置](./aws-auto-deployment-aurora-dual-mode-c3-executed.md)。下段待审状态已消费，仅为历史。

最新C3b：73表原归档编译、PG17安全目录/零行与九条技术初始化行门禁、同事务恢复+迁移及Source单次受审Root已实现；最终完整CI/两镜像通过，原Full/183pins/关闭运行时保持。Source刷新后新Review r4和独立metadata r3通过（各5次直接只读），现有准确cluster/writer与身份/FREE-ACTIVE一致。新SHA `1df7e2f7da6b3e900f68e5d5814e2f32e1578c19af131270ef6a355112ced440` 待明确SQL批准，到Winnipeg 2026-10-14 11:28:18.531 CDT；SQL连接/写、AWS资源写、槽消费均0。下一批准具体范围及完整风险后单次真实prepare/restore/migrate与独立SQL回读，不重复镜像或C2b，不使用旧SHA；尚非schema/ready证明。[唯一继续位置、完整风险与证据](./aws-auto-deployment-aurora-dual-mode-c3-review.md)。

最新C3a：基于C2b真实PG17.9事实完成新V3管理写transport、有限NOLOGIN prepare port及双仓pre-Secret SQL候选，30秒连接、准确role/database OID和丢失联动；新Express app候选显式30秒，旧Full/183pins/v2写拒绝保持。本轮云/SQL写0，prepare尚未实际运行，73表恢复/迁移/Secret/IAM/任务/ready仍未完成。下一集中完成owned restore/migration及一次性fresh审阅执行根，不继续Grant探针或F3c9。[代码范围、准确租户候选与继续位置](./aws-auto-deployment-aurora-dual-mode-c3-bootstrap.md)。

最新C2b实际：用户确认f95a0c3c...，唯一Source管理员IAM/TLS连接及四固定只读SQL成功，PG170009/OID5/client TLS/backend TLS/admin目录真实观察；约23秒连接，旧10秒窗口对本次不够但不倒填旧失败原因。独立新进程5次云只读/SQL0回读物理binding一致，Run9metadata/1SQL/资源写0；新槽消费，不重放，cluster继续保留可能计费，仍非tenant或ready证明。下步回主线补C1管理写/连接配置、准备准确角色及原73表空baseline的有限验收包；SQL写/IAM/Secret/任务/部署仍fresh另批。[真实证据与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c2-diagnostic-executed.md)。

最新C2b待审：用户选择保留现有Express后，分阶段白名单诊断adapter、准确临时Source snapshot/STS、新独立永久槽及Review/Run/Inspect入口已实现。新SHA只拟一次逻辑连接/四固定只读SQL，30秒connect/90秒会话，不新增权限或资源。新云只读回读/准确connect ARN模拟通过，实际SQL未调用、旧8执行pins和原槽不变；获批才执行。[新SHA、完整风险与准确范围](./aws-auto-deployment-aurora-dual-mode-c2-diagnostic-review.md)。

最新C2a实际：用户批准b883fbea...后，唯一CreateDBCluster成功；真实PG17.9、0–1ACU、gateway/IAM及cluster/writer身份由独立只读回读一致。唯一管理员只读连接失败，原create/sql槽消费，不重试；尚无TLS/SQL或tenant证明、runtime关闭。资源留存可能计费，清理仅准备未批准。下一建议保留准确cluster，仅准备带分阶段诊断的新独立只读连接清单，不重建、不恢复旧槽，不继续SQL写/部署。[实际证据、费用接管与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c2-executed.md)。

最新C2a：最小Express单次创建+一次管理员只读连接及独立准确清理入口已编码，FREE/ACTIVE、PG17.9默认、查空/配额、SLR和既有Source权限只读核对通过，无需新IAM。本批未创建资源/连接DB；新SHA待批准，真实事实先于剩余C1写适配。0–1ACU/auto-pause不是费用硬上限，旧Full栈、生产RDS、Neon/F3c9和槽保留。[准确范围、费用、完整风险与新SHA](./aws-auto-deployment-aurora-dual-mode-c2-review.md)。

最新C1续段：lifecycle v2任务/独立只读准入/角色目录与receipt接线已实现，写入口仍关闭；旧Full/172pins/F3c9和槽保持。下一准备最小Express事实核验的准确新范围，取得引擎/网关/目录事实后完成写适配；尚无可执行云SHA，不自行安装IAM、创建资源或修改业务。[本续段与最新继续位置](./aws-auto-deployment-aurora-dual-mode-c1-lifecycle.md)。

最新C1编码：双模式连接核心、严格v2契约、app pool接线和只读连接/Secret来源已完成，平台13/Backend41定向检查与types通过；云端双候选38488816036和完整Backend CI38488815977均success，新增断网自检/安全门禁通过，未ECR发布。完整lifecycle/目录/activation及Express实机仍未完成，不提前标记M2或ready，不改旧门禁/槽。[C1实现与继续位置](./aws-auto-deployment-aurora-dual-mode-c1.md)。

管理员触发一个准确sandbox租户任务，后续自动完成独立Secret、独立database/role、空baseline恢复和迁移、ECS服务启动、健康检查、mTLS/JWT配置下发，以及可访问地址和`ready`回写。不是只让一个容器启动，也不是先接付款或开放多租户轮询。

首轮使用一个Cell、一个租户、`standard-v1`、ca-central-1/账号402010193138、sandbox.techlong.cloud，保持独立database/role、ECS Fargate和ALB。D002当前先适配Express实际引擎/网关/IAM；原Full PG16.14与已验收镜像保留，但不是Express兼容证明，后续需云端构建新双模式镜像并验收。原空baseline不重导出，不导出业务数据。50USD/月为目标，不保证整套常驻在50USD内。

资源由受监督的、预先审阅的准确清理路径负责；首轮不要求先完成通用无人值守Cell出生/死亡系统。**自动部署与自动销毁不是同一验收项。** 必须在任何付费创建前具备可执行、准确ARN/ownership绑定的清理方案和失败后人工接管路径；本次同意改变交付顺序，不授权删除现有资源、关掉数据库约束或跳过权限审阅。

后置：付款触发、多Cell/多租户扩容、通用generation/parent/child编排、完整无人值守TTL/失败补偿工厂。保留：隔离、最小权限、凭据不落日志、ownership、拒绝过期重放、健康验收、清理责任和费用核对。付款所需的现有test凭据若应用配置需要仍使用现有安全来源，不为此接入付款触发。

## 四个交付块

| 交付块 | 可核对输出 | 当前状态 |
| --- | --- | --- |
| M1 准确首轮部署包 | 一个Cell/租户的模板、资源/权限/清理范围、镜像与baseline pins、所需新云批准 | **进行中**：原Full IAM、业务/config/policy、私有输入和公钥Secret已有证据；D002双模式设计完成但Express代码/镜像/权限/真实清理未完成，未激活 |
| M2 真实基础设施与数据库 | 经具体批准创建Cell，注册准确lifecycle任务定义，完成真实TLS prepare/restore/migrate/verify | **原Full首次创建失败回滚**：公钥Secret保留、Stack ROLLBACK_COMPLETE，原槽不可重放；当前保持Free Plan，先C1适配再单独审阅Express实机范围，未注册任务/部署tenant |
| M3 一个任务到ready | 管理员触发的受审单次入口、ECS健康端点、mTLS/JWT、地址和ready回写 | 未完成；原默认Worker仍关闭，不能改flag伪装启用 |
| M4 清理验收与交接 | 准确资源有序清理、最终库存/费用、完整运行回执 | 未执行；不把ECS失败检测当数据库或全资源清理 |

完成依据是这些真实输出，不是测试数量或F3子阶段数量。不预先启动新birth TTL；M1蓝图中的日期/ExpiresAt只是提案deadline，既不创建资源也不安装自动删除调度。实际创建与验收的时限在可执行范围就绪后fresh审阅，不以旧过期计划执行。

## M1 已落地的代码

新增 `lib/deployments/cloudformation/single-tenant-acceptance-cell.ts`，独立纯渲染入口 `renderSingleTenantAcceptanceCell`。复用原网络、Aurora、ALB/mTLS与ECS Cluster定义，移除旧PLAN_ONLY `CellCleanupSchedule`、四个仅调度需要的参数及相应dependency；新增明确的DeliveryTrack/CleanupMode标签，**不修改旧renderer或F3c9任何冻结代码**。

候选无RESERVED/ARMED/PAID切换、parent/birth品牌、Lambda/Scheduler/IAM资源，无执行能力。原安全组、private DB、TLS/mTLS、Aurora0–1ACU、Delete策略等定义保持；其收费创建和删除风险以后仍须具体批准。模板中的25项定义如下：

| 资源组 | 准确logical IDs |
| --- | --- |
| 网络11项 | CellVpc, CellInternetGateway, CellGatewayAttachment, PublicSubnetA/B, DatabaseSubnetA/B, PublicRouteTable, PublicDefaultRoute, PublicSubnetRouteAssociationA/B |
| 安全组与入口5项 | LoadBalancerSecurityGroup, TaskSecurityGroup, OneShotTaskSecurityGroup, DatabaseSecurityGroup, DatabaseOneShotIngress |
| ECS Cluster1项 | CellCluster |
| ALB与规则4项 | CellLoadBalancer, BusinessHttpsListener, BusinessControlDenyRule, ControlMtlsListener |
| 数据库4项 | CellDatabaseSubnetGroup, CellDatabaseLogGroup, CellDatabaseCluster, CellDatabaseWriter |

AWS服务可能创建内部资源（例如RDS托管master Secret），25是template定义数，不是全部计费资源数。候选**不含应用Service、应用/lifecycle TaskDefinition、租户Secret或activation**；这些在M1剩余范围里集中收敛，不宣称整个部署包已完成。目标Stack名仍为 `techlong-sandbox-cell-sandbox-1`，名称并非UUID身份；创建前必须准确查空，并与旧已删除UUID区分。

## 已有资产与关键接线

- 原Full镜像：[F3a2真实ECR验收](./aws-auto-deployment-fast-track-f3a2-ecr-published.md)，app `sha256:2af648ae122dad46dcba313481797a49766744c4de167d33642dba124908df07`，lifecycle `sha256:2ab7017dcebd64083e7804001685272a3a5461faa4b7a4bec37adab059980bb4`。这些证据保留；D002需要新双模式镜像、新digest/发布审阅，不能改用latest或声称旧镜像已支持Express。
- baseline/mTLS：[已安装基础](./aws-auto-deployment-fast-track-f3c2-material-foundation-executed.md)，archive `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a`、manifest `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971`。不重导出业务数据；未来仍需准确对象字节/权限核对。
- 复用 `prepared-runtime-composition.ts`、ECS one-shot adapter、租户Secret/SQL与有序cleanup、control client、Worker任务状态机。单次受审live root仍需接线；当前default/prepared的false保留。
- 后端现有admitted prepared root强制验证DDB activation/epoch、真实Fargate任务和RDS会话。**MVP不能绕过这些限制，也不能把本新模板作为旧authority品牌直接传入。** 下一只实现固定首轮资源的合法适配与准确activation/ownership材料，不重建通用Cell生命周期协议。
- 现有CFN执行角色的权限尚未满足收费部署，TaskRole/boundary、worker/execution role、tenant Secret和控制凭据输入仍须集中列明。F3c9 coordinator角色保持原deny-all/空策略/并发0，不复用它执行新主线。

## 本轮验证与追溯

3项新增模板检查与10项相邻旧模板检查共13项通过，typecheck及定向lint零警告通过；验证独立候选、仅允许的原资源差异、依赖闭合/无重复tag、默认不可执行及错误scope拒绝，不是离线数据库模拟或云部署验收。首次开发检查发现共享tag数组重复添加风险，已改为每资源复制数组并加入重复key检查，最终测试通过。

定向检查命令：`node --experimental-strip-types --test tests/single-tenant-acceptance-cell.test.ts tests/shared-cell-stack-v3.test.ts`。另已重新核对F3c9全部132源码pins、26份旧材料文件及已消费V6永久槽，均未变化。

**2026-10-13 10:07:29.648 CDT / 15:07:29.648 UTC**，Source准确身份通过，AWS `ValidateTemplate`成功，25资源/4参数、capabilities为空；15312字节的当次候选SHA `97dca5624d36d278484f1c81f0748ecda1a19735757dc108b86293fbe73ed11e`，requestId `a17a362a-348e-4e9d-bed6-abbe7bea9f24`。输入来自历史拟议基础设施选择，requestedAt刷新用于本次提案，**不是live Neon客户状态、实际创建或执行批准**。原始结果在本次工具回执，非秘密摘要在 [M1 capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.prepared.json)。此SHA是当次模板fingerprint，不是批准SHA；重新渲染日期变化会改变模板hash。

这是[AWS模板验证](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ValidateTemplate.html)，不能证明实际创建权限、服务就绪、数据库迁移或任务成功。没有CreateChangeSet/CreateStack、IAM/DB/table写、Invoke或新槽消费；没有读取Secret值，也没有连接Neon。F3c9冻结132文件与历史材料继续核对保留。

## 唯一下一步

当前唯一下一步由 **D002 C1** 接管：集中实现双模式数据库连接与版本化契约，Full保留、Express新增，不先执行任何云写。以下D001逐段继续记录为历史；以页首最新D002及其兼容方案为准，不重新升级账户、部署Full或重放旧Run。

本轮M1续段已实现限定领取、独立租户workload和集中权限编译，73项定向/相邻检查及真实Neon只读EXPLAIN/AWS模板验证通过；[具体接线、权限表、清理顺序与剩余缺口](./aws-auto-deployment-single-tenant-m1-integration.md)。当前仍无可执行云清单，不创建收费Cell。

新策略已接到 apply/reconcile，租户清理使用持久创建 UUID 和 provision predecessor，Cell 创建/准确删除接口与独立 prepared root 完成；[最新接线及真实只读差异](./aws-auto-deployment-single-tenant-m1-runtime.md)。107项定向/相邻检查通过，但真实新权限、业务行/执行绑定、Neon 50USD policy、control/DNS 输入及批准 guard/journal/verifier仍未就绪；原记录保留。没有可执行云 SHA，默认仍 disabled。

下一后继包集中完成这些**实际权限、输入和审阅边界**，之后按具体云/DB/收费/清理范围 fresh 批准再推进M2。不能用旧scheduler ref或改false绕过缺口；上述项不再拆成新的探针/恢复系列。

最新续段已生成新 Cell 专属 boundary/role/inline **最多三写**的待审清单，实际 AWS 策略验证 findings 为零，新对象仍不存在；管理员指定邮箱只读精确匹配通过，复用真实 active plan 的已发布 schema-v2，无业务写。13项新/相邻检查通过，F3c9冻结132 pins 保持；[准确 SHA、有效期、完整风险和继续位置](./aws-auto-deployment-single-tenant-m1-cell-iam.md)。这是 IAM 安装审批材料，不授权 Cell/DB/DNS/Secret/运行时；本轮写和消费槽仍 0。

用户随后明确批准上述 SHA，实际三次新 IAM 写成功；**18:37:01.667 UTC** 独立新进程 12 项全部通过，`IAM_INDEPENDENTLY_VERIFIED_NO_CELL`。新角色能力为 active，但本范围不准部署 Cell；DB/Secret值/Invoke/Cell API 均 0，新永久槽消费1，旧资料/冻结 pins保留。[实际回执与下一主线](./aws-auto-deployment-single-tenant-m1-cell-iam-installed.md)。下一集中收尾业务/config/control 与 live guard/journal/readiness 及准确 Cell/DNS/费用/清理范围，再按 fresh 具体批准推进 M2，不回到 F3c9。

最新业务续段：用户确认新店铺名/商户用户名，真实 published schema-v2 已按 plan overlay 解析为22项配置，独立 bootstrap 六 DML 原子提交/永久 journal/独立回读入口完成，**未提交**。拟5条新业务行+env budget1000→5000，不创建deployment/job或提前启动TTL，保留旧隔离原件；[准确SHA、有效期与完整风险](./aws-auto-deployment-single-tenant-m1-business-bootstrap.md)。仅新 Cell renderer 的 ManagedBy 对齐已安装IAM条件，原模板/云IAM不改；新25资源候选AWS ValidateTemplate、24项定向相邻检查/type/lint及冻结132pins通过。本轮云/DB写/槽消费0，control/live执行门禁仍待主线收尾。

用户随后批准7b741e22...，六DML一次原子提交成功；**19:21:19.915 UTC** 独立13项全通过，`BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL`。新5行及5000 policy已落库，原记录/保护不变；无deployment/job/TTL、AWS写0，商户账号/密码尚未生成，runtime仍false。新永久槽消费1不可重放；[实际回执与继续位置](./aws-auto-deployment-single-tenant-m1-business-bootstrap-installed.md)。下一以真实app/config/scope接好安全control/payment来源和实际权限/live清理门禁，再审阅Cell/DNS/费用/清理，不回到F3c9。

最新本机输入续段：新RSA-3072签名对、既有mTLS和服务端test-payment安全来源已准备在受限本机r2，首位商户密码来源/独立Neon配置回读/具体prepared接线完成；**22:15:59.651 UTC** 独立8项全部通过，`PRIVATE_INPUTS_VERIFIED_RUNTIME_DISABLED`。用户批准的一次Stripe官方只读认证HTTP200/test mode通过，不证明稍后包字节或webhook投递。实际IAM文档差异已归纳，旧mTLS宽ACL风险保留，132+4+14冻结pins未变；本轮云/DB写、Secret值、bearer/control请求、job/TTL/Cell均0。[本段证据与恢复位置](./aws-auto-deployment-single-tenant-m1-private-inputs.md)。下一集中实际权限/live guard/准确清理/public-key Secret以及收费Cell/DNS/费用批准包，M1未完成，继续封存F3c9。

最新基础待审：现有Source对固定Cell创建/删除命名空间/PassRole、公钥CreateSecret+Tag五项模拟allowed，基础前无需额外IAM安装；真实角色/查空/证书/engine/AZ/key共27项、业务13项及无tenant generation、AWS模板验证通过。具体fresh guard/永久journal/独立Inspect与**未部署tenant的准确UUID清理**入口已完成，最大两次直接创建（公钥Secret+25资源Cell），未执行；后续任务/tenant IAM/DNS/activation/job必须依赖Cell真实输出另批。3h基础用量估算0.56715USD+变量，730h持续活跃约138.81USD，50目标非cap/ExpiresAt不自动删除。40检查/type/lint及158历史pins保持，云/DB写/Secret值/槽消费0。[准确SHA、时限、完整风险与恢复位置](./aws-auto-deployment-single-tenant-m1-cell-foundation-review.md)。这是D001依赖收口，不重启F3c9，也不宣称完整tenant cleanup或M1/部署闭环已完成。

用户随后批准ebeef325...，两次直接创建完成，公钥Secret留存、真实Cell UUID已捕获；RDS因账户Free Plan要求Express/升级拒绝，CFN自动回滚。22:56:49.205UTC独立Inspect确认ROLLBACK_COMPLETE/20历史physical rows全DELETE_COMPLETE；真实VPC/IGW/DB/ALB/log不在，ECS仅INACTIVE/0任务0service，失败Stack记录保留。GetAccountPlanState证实FREE/ACTIVE；没有主动删除、升级账户或重试，原两槽已消费，private Secret值/IAM/Neon/job/runtime0。172历史/本次pins不变；[实际结果、准确失败Stack清理清单和下一选择](./aws-auto-deployment-single-tenant-cell-foundation-executed.md)。最快保留原私有Aurora方案需用户手动Paid Plan升级；Express涉及网络/认证/provider重新设计，不自动换。后继须先确认plan资格，再fresh单独审批旧失败UUID清理及新独立Cell尝试，保留公钥/旧槽，不重放原Run。
