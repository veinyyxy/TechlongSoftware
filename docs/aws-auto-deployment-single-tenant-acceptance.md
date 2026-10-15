# 单租户首轮 AWS 自动部署：当前执行主线

**最新 C5c（2026-10-15 Winnipeg）**：真实 ECR digest 已接入独立 Express 组合入口；现有非私密租户元数据编译通过，原 plan 与显式物理数据库名修订分开 hash，四键固定版本 Secret/mTLS/模板编译/7资源 workload 已接线，旧 Full 入口不变。16资源计算模板已通过真实 AWS ValidateTemplate；旧失败栈仍占名、20条 CFN 资源记录 DELETE_COMPLETE，未删除。54项相关 tests/types/定向 lint 通过；未读 Secret 值/私密材料、无 SQL 或云资源写。尚缺实际 owner/epoch adoption、scoped queue、具体计算层/清理审批、默认店铺 seed/初始化和 ready 回写，不是完整 live root。[当前实现、证据及唯一继续点](./aws-auto-deployment-aurora-dual-mode-c5c-delivery-root.md)。下方进度为历史。

决策D001，2026-10-13 America/Winnipeg。用户在审计后明确同意收缩首轮目标并开始实施，同时要求封存F3c9以便重启。此文档取代旧方案中的“继续F3c9”作为当前导航；[原支线封存](./aws-auto-deployment-f3c9-deferred.md)，所有历史保留。

**当前路线 D002（更新2026-10-14 Winnipeg）**：优先`express_iam`、保留`full_password`，暂不升级账户。C3g schema/迁移、C4c隔离、C4d四键Secret、C4e准确IAM保持；C4h唯一Run原八SQL已COMMIT成功，独立Inspect确认准确active/完整目录与ACL，并通过Source签发的应用TLS IAM只读登录。应用SQL权限/LOGIN已持久安装，rdsadmin/OID16389及ADMIN/INHERIT/SET false实证通过，但不是ECS任务身份或完整ready验收。全部已消费槽不可重放；不再C4激活/同类SQL探针。下一直接准备完整ready/商户初始化→ECR→ECS，各新的实际读取/写入/部署范围另审；不提升成员选项或改其它谓词。保留旧Full及历史，不扩展F3c9/Grant/恢复支线。[最新实机结果与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c4h-application-activated.md)，[完整兼容顺序](./aws-auto-deployment-aurora-dual-mode.md)。

**当前编码进度 C5b 已完成验证**：Express 受认证 bootstrap/完整 readiness、独立四键固定版本 workload 健康路径、四键首位密码来源及实际配置/epoch/image最终核对接口已实现，旧 Full 路径保持。平台36/服务端65项定向测试、双方类型与完整构建通过；准确服务端8753546的CI38680847326/双候选38680847373全部成功。未读取真实Secret、初始化、发布ECR或部署，新适配尚未装入真实执行根。下一 C5c 合并准备一次受审发布→部署→初始化验收入口及清单，不再新开 SQL/Grant/F3c9 支线。[当前结果、风险与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c5b-delivery-wiring.md)。下方阶段信息保留为历史。

## 首轮交付定义

**最新C5c实际**：用户确认b7d4bb49...后单次发布38682952254成功；app registry digest5e42b2de...、lifecycle c5ef6cf0...已独立重算manifest并核对config，BASIC扫描COMPLETE/HIGH与CRITICAL0。立即Source Revoke，控制器及独立新进程均确认deny-all Locked/v8；CFN已清理旧v5/v6，文档备份保留而版本ID不可恢复。原21份记录保持、追加3份独立证据，槽永久消费，不重跑发布。未读Secret/私密bundle、未SQL/初始化或ECS/Cell部署；新完整Express root仍待实现。下一直接绑定这两真实ECR digest，收尾当前租户执行根与计算/workload/监督清理待审包。[真实结果与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c5c-publication-executed.md)。下方待审信息是历史。

当前 C5c 已推进到准确镜像发布审批：Source/发布栈及Locked/v6、精确v5/v6版本只读核验通过，新清单绑定C5b两份已检候选，尚未获云写授权。另已补16资源、无RDS/one-shot的Express计算网络模板候选，旧Full25资源不改；旧失败栈仍占名，未删除。真实ECR digest/新执行根/计算层/业务初始化均未完成，不把Docker config digest冒充registry digest。[当前待批范围、完整风险和继续位置](./aws-auto-deployment-aurora-dual-mode-c5c-publication-review.md)。下方为历史。

最新C5a云验证完成（2026-10-14 Winnipeg）：准确执行源码760e632c72874a36b04e13554a5294ee8f224688的CI38678047208与双镜像38678047220全部success，app116236032493/lifecycle116236032929所有steps通过，含新增network-none readiness、原Dual/V4/V5/V6和依赖/OS安全门禁。初次87ec旧CA pin失败记录保留，修正仅官方公开新114根bundle准确SHA/相邻tests，原111及加拿大三根均未变，Express ATS不变，不关闭TLS/SHA。服务端62项/平台9项及CA相关21项（有重叠）过，source12文件LF哈希/实际13表清单/云artifact元数据记录；artifactZIP digest不是ECR digest，两候选UTC10月16日03:47:54/57到期。AWS账号API/SQL/Neon/Secret值/初始化/资源写/ECR/ECS0，未实际ready。代码接线第一步闭合，C5b直接集中Express bootstrap握手、独立workload健康路径、四键首位密码与现有provision/有效配置epoch/image最终核验；旧模板不能直接部署新Express，不新增C4或Grant/恢复/F3c9支线。[当前完成范围和唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c5a-readiness-wiring.md)。下方“云验证中”仅过程历史。

最新C5a编码/云验证中（2026-10-14 Winnipeg）：真实app接入bootstrap-ready及严格tenant-v1 ready，Express不得降级SELECT1，旧Full默认行为保持，新Full可显式使用实际OID/初始化门禁；平台增加五字段/path纯数据候选。服务端62项/平台9项及types/lint过，无AWS/Neon/SQL新调用或Secret值/初始化/部署。首次源码87ec0c0的CI check通过，但三镜像build均被AWS公开CA bundle旧SHA挡住；核对新114根包含原111/加拿大三根不变，仅新增sa-west-1三根，固定新90a6...，保留旧文件/历史pin且不绕过TLS/SHA。修正源码760e632已推送，CA/container/readiness21项过，新CI38678047208/双镜像38678047220待核对。旧ECS/ALB health路径/worker bootstrap握手尚未适配，不能直接旧模板部署新Express；完整ready仍须实际ECS身份/Secret/初始化/有效配置及epoch/image验收。下一C5b集中接线，不再C4激活或F3c9/Grant/恢复支线。[当前实现、失败修正及唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c5a-readiness-wiring.md)。

最新C4h实际（2026-10-14 Winnipeg）：确认f6e1fc31...后唯一Run八SQL/21查询、19:44:23.007 CDT COMMIT响应成功；立即独立Inspect管理8查询确认同一active/实际role941cfda9...、四库ACL9a6a5619...、真实目录ad213560...及投影后的完整非应用原目录93d3c7eb.../九seed业务0，之后应用6查询TLS IAM登录成功，19:44:45.726保存最终结果。rds_iam/OID16389 grantor=rdsadmin及ADMIN/INHERIT/SET全false，实际DML/序列权限元数据与只读用户上下文过；完整post-catalog这次实际到达并通过，不是旧ACL向量推断。Run26metadata/1conn/21query/8权限写、Inspect26/2/14/0，双槽已消费不能重放；263pins/2工具/17历史、6Review/15结果及2槽本地核验一致，无额外云SQL诊断。应用权限/LOGIN持久安装，SQL业务写、AWS资源写、私密值/IAM/Secret/Neon/ECR/ECS均0；Source应用认证不是ECS/完整ready/初始化证明。Backend153efbc源码/已验镜像保持，本轮仅结果文档。下一直接完整ready/商户初始化/ECR→ECS接线与fresh具体清单，不再C4激活/同类探针，不扩展F3c9/Grant/恢复支线。[实际结果、持续风险与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c4h-application-activated.md)。下方C4h待审仅历史。

最新C4h待审（2026-10-14 Winnipeg）：新增本目标精确rds_iam grantor=rdsadmin/OID16389规则，私有单字段投影复用冻结V6所有其它角色谓词，保存/返回实际metadata digest，不接受postgres回退、其它grantor或ADMIN/INHERIT/SET。原八SQL/program原字节/完整目录/四库ACL/行数规则保持。8新+14相邻tests/types/syntax/lint过，263pins/2工具/原260及17历史保持。r1第12metadata处提供者失败，CLI STS/SDK GetRole各一次通过，r2最终25metadata成功；本轮SQL/写/Secret值/私密/槽0，旧9a720批准在LOCAL_BINDING拒绝，当前数据库状态仍以C4g独立回读为历史。新SHAf6e1fc31...有效至Winnipeg2026-10-15 01:37:18.572 CDT，等待新的独立永久双槽/同八语句及准确校准、独立管理Inspect及仅exact active时一次Source签名应用TLS IAM登录批准。全post-catalog/受限IAM登录仍待实证，非ECS/ready证明；不重放旧槽、不改IAM/Secret或部署，不扩展F3c9/Grant/恢复支线。[准确范围、风险及唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c4h-role-grantor-review.md)。

最新C4g实际（2026-10-14 Winnipeg）：用户确认9a72074b...后唯一Run八语句收到响应，但ROLE_CLASSIFIER拒绝；19:15:47.753 CDT写后证据明确唯一rds_iam parent/OID16389 grantor=rdsadmin，旧V6要求postgres，ADMIN/INHERIT/SET仍false、其它已记录角色限制匹配。本地仅改变假想副本grantor即通过，可定位本次谓词，不倒填C4f缺失原件。80应用ACL向量/count匹配；完整post目录verifier未到达，不能用脱敏历史inventory重建冒充原pin通过。COMMIT未提交、ROLLBACK成功，19:16:16.632独立Inspect确认原closed/NOLOGIN/四库ACL0251a30e.../完整目录93d3.../九seed业务0，应用连接0。Run26metadata/1conn/21query/8权限调用、Inspect26/1/8/0；两槽已消费不可重放。260pins/2工具/12历史及13结果/本地分析/双槽核验，无追加AWS/SQL诊断或IAM/Secret/业务/ECR/ECS写。下一仅准备精确rdsadmin授予者校准、其它谓词与八SQL不变，再fresh具体批准推进实际完整核验/登录/ready，不开F3c9/Grant/恢复支线。[实机原因与继续位置](./aws-auto-deployment-aurora-dual-mode-c4g-role-grantor-observed.md)。下方C4g待审仅历史。

最新C4g待审（2026-10-14 Winnipeg，材料UTC2026-10-15）：冻结C4f原八SQL/完整strict角色/四库ACL/目录/行数谓词不改，新独立入口在同次已有查询响应后先存有限脱敏证据，再验证并保留三个具体stage/枚举码，不增加SQL/query或探针。源码与PG17规则揭示grantor未必等于登录用户，但历史post丢失，不能称为已证明原因或放宽替代grantor；可能再次严格拒绝。7新+7冻结相邻checks、types/syntax/lint过；260pins/2工具/原257及12历史保持，program9df67b2a原字节/digest不变。Review25metadata确认原IAM/Secret/17.9/FREE ACTIVE保持，SQL/写/值/私密/新槽0，真实旧0c32批准在LOCAL_BINDING拒绝。SHA9a72074b...到Winnipeg2026-10-15 01:09:20.368 CDT，待一对新独立永久槽/同八语句/有限同事务观测/独立回读及仅exact active时一次Source应用TLS IAM登录具体批准；不部署、不改IAM/Secret/业务，不重放C4f，不开F3c9/Grant/恢复支线。[准确范围、证据变化与完整风险](./aws-auto-deployment-aurora-dual-mode-c4g-application-evidence-review.md)。

最新C4f实际（2026-10-14）：用户确认0c32f6f0...后唯一Run，Winnipeg18:52:36.897 CDT消费槽、18:53:00.704记录写意图，八准确权限/LOGIN语句均收到响应；写后最终核验报通用失败，COMMIT未提交、一次ROLLBACK收到响应，18:53:02.664保存。立即独立Inspect于18:53:35.757保存ORIGINAL_CLOSED_STATE_OBSERVED_INSTALL_NOT_PROVED，确认app16456仍NOLOGIN/零成员/无提升、四库ACL0251a30e.../完整目录93d3c7eb...及九seed/业务count0保持；应用连接0。Run26metadata/1连接/21query/8权限调用，Inspect26metadata/1连接/8query/0写，非8项持久权限成功；两槽永久消费，不重跑/复位/补齐。最后SNAPSHOT_5不是唯一原因，V6具体谓词/post原件未保存，尚未唯一定位；不按grantor/membership猜测放松门禁。257pins/2工具/八历史及13结果/双槽本地核验，未加AWS/SQL诊断。C4e IAM保持，无Secret值/私密/业务/authority/ECR/ECS写；下一本地收敛核验和失败观测后新具体批准，继续同一最小激活/真实登录/ready主线，F3c9不扩展。[实际证据与继续位置](./aws-auto-deployment-aurora-dual-mode-c4f-application-activation-stopped.md)。下方C4f待审仅历史。

最新C4f待审（2026-10-14）：最小SQL激活与独立回读/一次应用TLS IAM登录入口完成，仍沿单租户主线。原受信归档重新编译候选digest保持；257pins/2工具/原254及八实际历史不变，7新编排+11平台相邻+5服务端V6检查、types/syntax/lint通过。最终r2 Review25metadata，已装IAM v4/保留v3/7消费者及固定Secret/17.9/FREE ACTIVE保持、Source两username connect模拟allowed；r1在补充非秘密失败步骤/SQLSTATE/COMMIT与abort事实后被取代，SQL/权限digest不改，总50metadata，SQL/私密/值读取/写/新槽均0。SHA0c32f6f0...至Winnipeg2026-10-15 00:48:42.474 CDT，仅待准确8权限/LOGIN同事务、独立管理回读和仅active时一次Source签发的应用账号只读登录批准；不证明ECS身份或完整ready，不改IAM/Secret/业务/authority或部署。后继直接完整ready/初始化再ECR→ECS，不开同类探针/F3c9。[准确范围与完整风险](./aws-auto-deployment-aurora-dual-mode-c4f-application-activation-review.md)。

最新C4e实际（2026-10-14）：用户确认785b18c8...后唯一Run三次IAM响应成功，Winnipeg18:28:51–52 CDT完成；立即独立Inspect于18:29:05.847 CDT确认默认v4/原v3保留、候选全文与三role ID/trust/tags/attachments及7消费者保持。Run33metadata/3IAM写、Inspect30metadata/0写，两次六组策略模拟8资源结论均过但不是实际IAM/KMS/PG访问证明。SQL/LOGIN/GRANT、Secret值/私密材料、业务/authority/ECR/ECS均0；254pins/2工具及13原Review/25结果文件/双槽本地核验过，无额外云调用。持久能力/共享版本Deny及CFN drift风险保持，授权和双槽已消费不能重放。153efbc执行源码/已验镜像不改，下一集中最小SQL/真实TLS IAM登录/完整ready初始化再部署，各实际新范围另批，不开F3c9/Grant/恢复支线。[准确结果与继续点](./aws-auto-deployment-aurora-dual-mode-c4e-runtime-iam-executed.md)。下方C4e待审仅历史。

最新C4e待审（2026-10-14）：准确IAM三写入口和独立Inspect已实现；6 tests/types/syntax/lint及六组实机策略模拟过（8准确资源结论），不是实际登录/密钥读取证明。新boundary保留v3全部语句，追加两个principal-ARN限定连接Allow和准确新Secret错/缺VersionId Deny；生命周期追加管理连接/固定版本读取、应用新inline仅应用连接，execution/旧Full不改。已完整盘点7个boundary角色/无普通附件，版本Deny影响它们对新Secret的读取，Source三项写模拟allowed。最终r3只读32metadata，254代码+2工具/原251及C4d历史保持；本轮写/SQL/私密值/新槽均0。SHA785b18c8...至Winnipeg2026-10-15 00:08:50.064 CDT仅待这三项持久IAM安装和独立Inspect批准；接受非原子/传播/CFN drift/部分遗留/永久槽不重试，不SQL LOGIN/GRANT、ECR/ECS/Cell。下一仍是最小SQL/真实IAM登录/完整ready初始化及部署，不扩展F3c9/Grant/恢复支线。[准确范围、全部影响与完整风险](./aws-auto-deployment-aurora-dual-mode-c4e-runtime-iam-review.md)。

最新C4d实际（2026-10-14）：用户确认77edc1a6...后一次CreateSecret于22:43:34.957 UTC获响应，独立DescribeSecret于22:43:46 UTC通过；准确四键Name、真实ARN后缀T9CqN5、受审版本0f45d29f.../AWSCURRENT、五标签/默认KMS/无replica保持。Run14metadata/1私密读取/1AWS写，Inspect6metadata/0私密或写；两者SQL/GetSecretValue均0。四条ECS refs固定到真实版本，binding digest41c1d3ea...仍仅候选，不证明IAM/login/ready。现有execution role/boundary宽前缀读取Allow已接受，新Secret纳入它的范围；未验证实际读取或所有reader。251源码/2工具、9回执文件及2槽核验一致，无额外云回读/重试。77ed及双槽已消费不可重放，153efbc执行源码/已验镜像保持。下一fresh准备三角色/共享boundary准确IAM/Secret版本及最小应用/真实ready初始化，实际写另批。[准确结果与继续点](./aws-auto-deployment-aurora-dual-mode-c4d-runtime-secret-executed.md)。下方C4d待审仅历史。

最新C4d待审（2026-10-14）：单次四键Secret创建/独立DescribeSecret入口已实现，7新+3相邻共10tests、types/syntax/lint过；251源码+2工具，原248及C4c历史不变。Source恢复后最终r5只读13metadata，两Name均ABSENT；新Secret会匹配既有execution role inline及boundary的techlong/sandbox/*读取Allow，风险显式纳入SHA77edc1a6...，不把0 IAM写说成不可读取。当前AWS/SQL写、私密/Secret值读取、新槽均0；错误SHA真实CLI在LOCAL_BINDING拒绝。清单到Winnipeg2026-10-14 23:34:32.263 CDT，仅待一次CreateSecret（含初始版本/五标签/默认KMS）及一次独立元数据回读批准；不安装权限/LOGIN/runtime/ECR/ECS。得到真实ARN/version后再准备准确IAM/最小应用与ready初始化；不扩展F3c9/隔离/恢复支线。[准确范围、完整风险与唯一继续位置](./aws-auto-deployment-aurora-dual-mode-c4d-runtime-secret-review.md)。

最新C4c实际（2026-10-14）：用户确认20487de0...后唯一Run两条PUBLIC CONNECT撤销同事务提交，22:05:34.489 UTC获得COMMIT响应；紧随独立READ ONLY Inspect于22:06:34.522 UTC通过，四库完整closed快照digest0251a30e...一致。template1/postgres PUBLIC及app CONNECT均false，owner16410显式CONNECT/CREATE/TEMPORARY与postgres PUBLIC TEMPORARY保持；rdsadmin/tenant ACL及app NOLOGIN/无提升或成员保持，其它可CONNECT计数2→0。Run1连接/10query/6metadata/2权限写，Inspect1连接/6query/6metadata/0写；AWS/Secret值/LOGIN/业务写/ECR/ECS均0，未重查schema、未验ready。248源码LF pins+2工具及回执/双槽原字节核验过，无第三次SQL或重试。双槽永久消费不能刷新重放，153efbc执行源码及已验镜像保持。下一实际V7 Secret/IAM/最小应用权限及完整ready初始化，各fresh范围另批，不扩展隔离支线。[实际证据与继续点](./aws-auto-deployment-aurora-dual-mode-c4c-isolation-executed.md)。下方C4c待审仅历史，已被本段取代。

最新C4c待审（2026-10-14）：严格两PUBLIC CONNECT RESTRICT写入口及独立Inspect已实现，完整ACL/OID/owner/角色写前后核对，保持app16456 NOLOGIN，不授予app/IAM权限，不修改rdsadmin/tenant/业务。新V7Secret候选采用不变生命周期v2所需准确stem+hash Name，旧V6 Name经共享wire回归证明不兼容；不修改旧Full/wire、不伪造ARN/version。8新+11相邻共19tests、types/syntax/lint过，真实错误批准SHA在AWS/SQL/槽之前拒绝。最终Review-r2 7metadata、新旧Secret Name均ABSENT，248当前code+2原工具；本轮SQL/权限/AWS写/私密值/新槽0。SHA20487de0...有效至Winnipeg2026-10-14 22:49:04.994 CDT，待准确两库撤权（影响所有PUBLIC依赖新连接）及成功/失败后立即唯一独立Inspect批准；旧cacddc5f r1保留但过时，4de95槽已消费不能重放。下一同一路线准备实际V7Secret/IAM/最小app与ready初始化，不扩展恢复/Grant/F3c9。[准确范围与风险](./aws-auto-deployment-aurora-dual-mode-c4c-isolation-review.md)。

最新C4b实机结果（2026-10-14）：用户确认4de95e90后唯一Inspect成功返回ISOLATION_ACTION_REQUIRES_REVIEW，21:09:41.255 UTC新read槽消费，21:10:03 UTC结果保存；1连接/6固定query/6metadata，TLS两端true，准确app16456仍NOLOGIN/无提升或成员。实际4个可连接库目录中template1(1)/postgres(5)的app/PUBLIC CONNECT均true、owner16410；rdsadmin(16384)与tenant(16459)均false。两个PUBLIC CONNECT无grant option，postgres显式CONNECT/CREATE/TEMPORARY保持；目录digest2959d744...。SQL/AWS写/Secret值/LOGIN/IAM/ECR/ECS均0，隔离/ready未通过，C3g schema未重查。独立本地回执/243代码pins核验过，不声称第二次实时SQL回读，不复位或重放4de95/C3槽。下一仅数据级准备准确两库PUBLIC CONNECT撤销及集中激活范围，保留其它ACL；影响所有依赖PUBLIC新连接的角色/工具，未证明所有消费者无影响，实际写fresh清单另批。Backend153efbc执行源码/已验镜像保持，F3c9封存。[真实证据与处置影响](./aws-auto-deployment-aurora-dual-mode-c4b-isolation-executed.md)。下方待审4de95已消费，仅历史。

最新C4b只读清单（2026-10-14）：Source SDK初始身份1次及Review-r1的19次AWS/CLI元数据完成，三个准确role/RoleId、共享boundary v3/两个inline与历史一致，四键Secret准确名称ABSENT。新CLI/纯classifier/固定6query计划已实现，5项针对性测试/syntax/lint过；真实错误批准SHA在凭据/AWS/SQL/槽之前拒绝，0调用/连接/消费。243当前pins+原2工具/7历史保持；SHA4de95e90...有效到Winnipeg2026-10-14 21:53:27.942 CDT，仅待一个postgres管理库READ ONLY事务查看app16456及DB16459/其它库CONNECT/PUBLIC ACL，无客户表/密码/原始role config。SQL/写/Secret值/槽均0，仍无隔离/应用登录/ready证明。旧Backend153efbc已验两镜像保持，不重建/发布；后继仅根据真实隔离事实收敛实际激活范围，不恢复或扩展F3c9。[完整范围与风险](./aws-auto-deployment-aurora-dual-mode-c4b-isolation-review.md)。下方C4a为前置历史。

最新C4a候选通过（2026-10-14）：已修正app镜像顶层归档compiler依赖，准确Backend153efbc源码的CI38633329098/双镜像38633329018所有steps均success，包括两个最终镜像network-none V6及原安全门禁。Backend8项/平台9项相关测试、types及定向lint通过。新r3真实编译原archive/private品牌并绑定73表/7序列，8个最小SQL仅数据；四键Secret候选实际ARN/version为null，元数据finalization不证明IAM/login/ready。r1保留，r2因本机Python更新在编译前停止，r3仅本地候选重绑新bundle/Python3.12.14，C3g旧工具/槽/receipt不改。240当前pins+2工具，候选6a618802...不是fresh执行SHA；本轮SQL/AWS/Secret值/新槽均0，无ECR/ECS。当前跨库隔离、任务角色权限、受限membership真实IAM登录及完整ready仍未核验，下一收敛这些具体激活事实，不再恢复/Grant/F3c9支线。[完成范围、失败修正、追溯与下一步](./aws-auto-deployment-aurora-dual-mode-c4a-application-candidate.md)。下方C3g为前置历史。

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
