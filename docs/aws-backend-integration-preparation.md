# 后端联调/CORS：当前最小准备与继续点

**最新继续点（2026-10-29 08:37 CDT）**：[buyer自定义域名已安装并独立静态验收通过](aws-buyer-web-domain-install-observed.md)。现在只准备新合法后端held请求、准确buyer域内CORS材料/必要来源与一次Review→RunOnce→独立Inspect的集中范围；不再申请证书、改CDN/DNS、重发客户端或读取HMAC。域名成功不等于业务连通，本轮没有JS/API/业务或后端部署。

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)，承接[已完成的客户端静态发布](aws-buyer-web-sandbox-publication-observed.md)。本文件仅整理当前主线，不是新任务、数据库写入、私密读取、来源发布、IAM修改或付费后端部署授权。[机器准备摘要](../ops/aws-sandbox/reviews/backend-integration-v1.plan.json)执行SHA为null。

## 初始差异核对（raw CloudFront方向已被下方域名方案取代）

客户端602e543/准确run40799958045已发布，来源为https://d3a0kml1xanzgt.cloudfront.net；无需重建前端、再读HMAC、更新客户端Secret或再dispatch。API编译目标仍为first-acceptance.sandbox.techlong.cloud。

当前源码核对发现，现有云入口不是可随意传入CORS的通用部署器：

| 位置 | 受约束事实 |
| --- | --- |
| ops/cloud-worker/material/public-capsule-v5.json | CorsAllowedOrigins仍为first-acceptance与techlong.cloud两个原来源 |
| ops/cloud-worker/cloud-context-v5.mjs | 固定接受capsule body SHA 5c7e5eeff2febef52b469487e0bd7d170e711fb2b26e3df81162b5b46c6e2e14；不能静默改材料 |
| .github/workflows/cloud-worker-platform-job-v6.yml | checkout/核对冻结源码0e18a25，源码中仍选中已经完成的a00周期；本地改文件不会自动替换已发布云代码 |
| ops/platform-reviewed-cycle-v1/closure.mjs | 保留旧104闭包并校验110闭包；不能改旧pin、放宽guard或用环境变量绕过 |

所需业务差异只有新增准确来源，保留原两个，不用*、不移除Origin或新增API代理：

`https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud,https://d3a0kml1xanzgt.cloudfront.net`

仅在本机克隆原公开body、追加上述一项得到候选body SHA `c124b21accd6cd538e45c2cc43706583ad146ba0ded25067c0406e0c5d128ddc`；原body摘要匹配检查通过。**这是差异证明，不是批准SHA，不是已安装材料。** 当前原capsule/常量/闭包/工作流均未修改。后继须把新配置纳入合法新请求/来源及实际模板校验，不能直接UpdateStack已删UUID，或恢复旧a00/旧Review/旧永久槽。

最小适配必须复用既有请求/Review→RunOnce→Inspect能力，保持执行内核、资源清单和权限范围尽量不变；先取得真实完整历史，才确定准确的新请求/来源绑定。若确需新的固定配置材料/源码发布和reusable trust pin变更，要在执行清单逐项说明并另批，不能承诺“绝无IAM写”后再临时改trust。这里不新建固定job目录、通用恢复器、探针或UI支线，也不先修改冻结内核。

## 本轮真实停止点

用户已允许一次STS1＋AWS元数据65/GitHub GET10、配置全文件1/TLS连接1/SQL45的限定只读。实际新观察于20:39:15 CDT在**第一次Source STS身份查询**失败，结果 `STOPPED_NO_RETRY / SOURCE_UNAVAILABLE`：

- STS尝试1；AWS元数据、GitHub、配置读取、TLS连接和SQL均0。
- Secret值/HMAC/PEM/DDB项、Aurora连接、云或数据库写、新/取消任务、续租、dispatch和执行槽均0。
- 原件 `F:/ChatGPT_workshop/techlong-backend-integration-readiness-20261028-a/result.json`，raw SHA `ebd73a2a1d4dae7c2c2e7815dc209f6a6aa4e0fc3bc154f0622bfe12650c3548`。原脚本和结果保留，不重跑、覆盖或改时间。

失败记录中的计算到期字段不是可用于部署的新事实窗口；本轮尚未获得AWS/Neon现状，不能声称namespace已空、业务/保护未变、新job不存在或材料已经齐备。旧19:46退役记录仍只证明当时那个准确UUID，不能据此推导现在所有同名资源不存在或费用停止。

A失败原件保持。用户随后刷新Source并明确允许新一轮同范围读取；B观察于20:56:03–20:59:51 CDT完成以下部分，不重跑A或重新采样AWS：

- 实际合计STS1、AWS元数据57、GitHub GET9、配置全文件1、验证TLS连接1、SQL4（BEGIN、SET LOCAL、身份查询、ROLLBACK）；所有云/数据库持久写、Secret值/HMAC/PEM/DDB项、调度及执行槽均0。
- 旧准确UUID仍DELETE_COMPLETE，同名栈不存在；旧ECS服务INACTIVE、desired/running均0，集群服务与运行任务列表为空。共享Cell为CREATE_COMPLETE、worker基础栈UPDATE_COMPLETE；这不证明全账户费用停止。
- 原应用镜像digest仍在；三个指定Secret固定版本均AWSCURRENT。五个现有角色及边界/授权布局已记录，不能据此声称新来源已发布或新部署获批。两张DDB表ACTIVE、TTL DISABLED，没有读取业务项。
- GitHub人工reviewer与main分支门禁保持。当前66e9985只是文档/候选材料变更，未触发recovery CI；“准确HEAD必须有该CI”的本地预期导致B停止，原记录保留。随后只使用尚未用完的额度核对成功CI40748831700/284f6ad，并逐文件证明至66e9985未改部署运行时代码；不冒称66e9985自身跑过该CI，没有重查AWS或重复GitHub请求。
- TLS客户端证书验证通过，但接下来组合门禁返回DATABASE_IDENTITY_OR_MODE，已ROLLBACK并关闭连接。该门禁同时比较actor/session actor、库、owner OID、只读模式及数据库侧TLS布尔值；本次未保存逐字段结果，不能确定哪个字段不符，也不能声称身份、权限或TLS已改变。没有读取任务/业务/保护快照，不能认定它们仍匹配。

B原停止记录：F:/ChatGPT_workshop/techlong-backend-integration-readiness-20261028-b/result.json，raw SHA eb2e2a4405805f95afc25a6868ecadf87cc92cfb32543f5ea935dc605ad1cd2e。未使用额度继续记录：F:/ChatGPT_workshop/techlong-backend-integration-readiness-20261028-b-continuation/result.json，raw SHA f60aa42991df400518a698fbc498ca717c9ccd6f19d8827c0a919128fce134c4。两者均保持原样，后者累计计数包含前者，不相加重复计算。

AWS/GitHub部分观察的原准备到期为2026-10-29 01:56:03 CDT，继续过程没有重计5小时；数据库事实尚不完整，不能生成执行SHA或开付费窗口。没有更改capsule、冻结源码、门禁、部署代码或任何原批准。

上述补核随后由用户“开始下一步”确认，已按新独立记录执行，不重跑A/B。以下为当前事实，前述失败原件不覆盖。

## 数据库补核已完成（23:29 CDT）

C补核执行源码e620a0f，于2026-10-28 23:29:16–23:29:22 CDT完成：配置全文件1次、单条验证TLS连接、15条只读查询；AWS/GitHub调用、持久写、Secret值/HMAC/PEM/DDB项、Aurora、续租、任务创建/取消、调度及执行槽均0。

逐字段诊断中actor、session actor、数据库、owner OID、只读事务全部匹配；客户端TLSv1.3且证书authorized=true，唯一诊断差异是backendTlsReported=false。它是数据库侧视图，不作为客户端证书验证的替代。本次沿用原publisher的显式rejectUnauthorized:true、无connectionString覆盖配置，以及现有readTransferState的完整身份/catalog/函数/权限/准入/保护校验；没有修改线上权限、数据库或运行时，也没有关闭证书验证。[Neon连接安全/代理说明](https://neon.com/docs/security/security-overview)、[node-postgres的TLS参数说明](https://node-postgres.com/features/ssl)。原B未保存逐字段值，因此这里只记录本次复现差异，不追写B的未知字段。

已取得准确实例12条任务、17条plan/12条approval/12条dispatch attempt。所有任务为succeeded或canceled，无pending/running/retry_wait，lease全部清空；最新成功仍为a00。整个normalized snapshot（包括任务、完整账本、deployment/admission和保护）与上一轮受信Inspect封存snapshot逐字段完全一致，catalog/trigger摘要仍ff430aee…/72037e9b…。没有重置或取消任何旧成功任务。

原始result：F:/ChatGPT_workshop/techlong-backend-integration-database-supplement-20261028-c/result.json，raw SHA 16a4e43673dcb9003c62f11b942db2aafe31bfb0894e033759cb1dc25fd58395。完整业务快照仅保留该本地目录，不入Git。恢复先读该目录verified.json，raw SHA 21ac8c94e8cb851564e4923f6d4d81627a0a90ee113a2e92e84b6fa4bfefaae8；它绑定6份原件及上一轮Inspect快照，并核对了父B记录。C没有重采AWS/GitHub或延长期限，集中准备仍受较早的2026-10-29 01:56:03 CDT限制。

## 自定义域名准备沿革（现已完成，保留追溯）

本轮适配原型的实际V5 Review测试发现，除固定capsule哈希外，lib/deployments/execution/parameters.ts还拒绝techlong.cloud域外CORS。追加raw CloudFront来源会报“must use the techlong.cloud HTTPS boundary”，不能渲染实际请求。原型没有发布，未接通的新增适配文件已撤回，没有修改原校验器或旧110文件闭包。诊断保留在F:/ChatGPT_workshop/techlong-buyer-origin-adapter-stopped-20261028-a.json；不把23/25原型检查中的失败改称接线成功。

用户已明确选定“先准备自定义域名方案”。当前只推进[buyer.sandbox.techlong.cloud方案](aws-buyer-web-custom-domain-plan.md)及[模板差异候选](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-template-proposal.json)：复用现有CDN/桶/发布角色，只准备us-east-1证书、准确alias和DNS；不新增执行器，不放宽域边界，也不重发客户端。原始raw CloudFront候选c124b21a…被取代，后继准确buyer域名body候选为649c3077a5c1316e663f9765c10b4d79a9cc1bc673086de8e50d4ed1ddc92a62；两者都不是执行批准，原capsule仍未改变。

既有prepareInitializedPlatformRequest已支持一条新held请求，无需再实现取消/恢复框架。现状12条任务均终态、无lease，不能使用“取消旧pending+新建”的两行handoff。后继仍保留全部旧任务/账本/业务与保护；新job/request ID、真实新窗口和请求写入均未产生。

本轮新增边界/域名候选回归与原请求回归合计23项通过，类型/lint及旧110文件闭包核对保持；源码aad23fa的准确CI40820296477全部成功，实用GitHub GET5，无AWS/生产配置/SQL。恢复读F:/ChatGPT_workshop/techlong-buyer-domain-code-verified-20261028-a.json。上述不是AWS模板验证、域名安装、后端部署或业务验收；只把检查加到原无AWS CI，没有新部署workflow或云副作用。

用户随后确认本轮域名限定预检，已用STS1/AWS11取得准确CDN/栈、DNS及证书事实，零配置/秘密/数据库/写入。详见[公开观察](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-preflight.json)与[证书单写风险清单](aws-buyer-web-certificate-review.md)。该证书单写及后继验证DNS/CDN更新现均已按各自准确批准完成，不能继续把此段历史“待申请”当当前任务，禁止重新申请、重放或复位槽。

## 当前唯一动作：集中准备后端联调整轮材料

实际买家来源现在是 `https://buyer.sandbox.techlong.cloud`；后继CORS只追加这一项，保留原first-acceptance与techlong.cloud。域内校验无需例外，候选body SHA 649c3077…仍只是差异证明；原capsule/固定pin不静默改写，也不直接让旧成功a00再跑一次。

复用原prepareInitializedPlatformRequest单INSERT和既有整轮能力，不再实现两行pending取消handoff、固定job分支或新执行器。旧23:29快照只证明当时12任务/17/12/12历史均终态/空lease，AWS/GitHub/Neon准备已过期，不能据此声称当前仍未变或直接生成写清单。下一次仅取得当轮限定只读许可，核对完整真实状态、原镜像/权限/Secret版本元数据与必要来源绑定后，集中给出新请求/材料/必要发布和整轮的明确范围/时序；不提前建任务、占槽、开TTL或云写。GitHub环境仍由用户本人批准，50 USD目标与清理另审边界不变。

### 10月29日a/b停止沿革（保留原件，后经下段c解除）

用户批准一次1STS/65AWS元数据/10GitHub GET/配置1/TLS1/SQL45后，08:52:39的a记录在第一次STS调用停止。用户刷新并明确给出新一轮同范围许可后，08:55:40的b独立记录仍在第一次STS停止；不是重跑a。两者原生返回都被既有错误处理归为CLI_OR_CREDENTIAL_FAILURE，尚不能区分认证、端点或本地调用错误，**不能断言用户刷新失败或凭据仍过期**。

实际合计仅Source STS调用尝试2次（是否已到达服务端未知），其余AWS/GitHub/配置读取/Neon/SQL/写入/执行槽/调度均0；没有新生产事实、可用5小时快照或部署SHA。原结果中的计算到期字段不构成已取得事实或新执行窗口。CLI2.36.19/region ca-central-1仅作本地非秘密元数据核对，没有新增STS调用。

恢复读 `F:/ChatGPT_workshop/techlong-backend-integration-preparation-stopped-20261029-a.json`，raw SHA `76d4f315d1a87c8bbc1c574799cbf50c0c76e1252b0006c6a5d811dd540ef8ab`，绑定a/b原停止结果；旧命令、旧事实与永久槽不重放或重计。下一只等待用户对一次固定官方endpoint的去敏STS诊断确认；若准确IAM身份通过，才按该次新许可继续仍未用的65/10/配置1/TLS1/SQL45，不先读配置或做写入。失败则保存分类停止，不盲目要求反复刷新。

### 官方端点诊断与剩余只读已完成（09:07–09:08 CDT）

用户另允一次诊断及成功后剩余范围，c独立记录通过 `https://sts.ca-central-1.amazonaws.com` 核对准确IAM用户，再完成原未用只读。**这证明当前官方端点路径及身份可用，不倒推a/b一定是端点错误或用户刷新失败**；旧失败原件保留，不重跑。实际STS1/AWS元数据57/GitHub GET9/配置全文件1/验证TLS连接1/SQL15；云/数据库持久写、Secret值/PEM/HMAC/DDB项、任务创建/取消、续租、调度及执行槽均0。

新事实如下：

- 原a00准确栈仍DELETE_COMPLETE，同名栈不存在，ECS服务/运行任务列表均空。旧服务已被ECS清退，Describe返回准确ARN的MISSING，不追写成先前的INACTIVE。共享Cell CREATE_COMPLETE、worker基础栈UPDATE_COMPLETE，模板未变。
- 五角色的RoleId/trust/inline/attached/boundary布局及三份managed policy默认版本和正文，与上一可信布局逐项一致；三个固定Secret版本仍AWSCURRENT。只核对元数据，不读Secret值。两张控制表ACTIVE/TTL DISABLED，没有读DDB项；表布局可用不是内部epoch/authority记录可用的证明。
- 原镜像digest仍存在，已有扫描记录COMPLETE/无报告项；扫描时间仍为10月15日，不冒称本轮重新扫描。没有构建或发布新镜像。
- 本人GitHub environment/main分支门禁保持；当前reusable仍1120f510…，原已完成a00的SOURCE未替换。准确未改代码CI为d869f47/run40875734305成功，不冒称当前文档HEAD跑过CI。
- 客户端TLSv1.3/证书验证、owner/session/database/OID/只读全部匹配。数据库侧TLS视图仍false，只作代理诊断，不替代客户端证书证据。12任务/17plan/12approval/12attempt、完整业务/准入/保护与旧可信snapshot逐字段一致，任务全终态/无lease，latest仍a00且已过期。新请求/任务ID没有分配，不能取消已成功a00。

恢复读 `F:/ChatGPT_workshop/techlong-backend-integration-readiness-20261029-c/verified.json`，raw SHA `0febbdba1fd957cb1d24a5f88d0b03d2b6e4536d6430d32125cc9fe449b95eeb`；绑定8份本轮原件、旧可信数据库/布局及a/b停止索引。[公开摘要](../ops/aws-sandbox/reviews/backend-integration-v1.readiness-20261029.json)不包含业务快照正文或凭据。事实真正始于09:07:12.204 CDT，5小时准备截止**今天14:07:12.204 CDT**；不是新执行/TTL/48小时事实批准，也不改变旧窗口。

### 接下来的唯一最小代码动作

只补齐**既有单INSERT请求接入及准确buyer CORS材料/SOURCE兼容接线与定向测试**，复用原V5根、claim/完成/Inspect和既有调度/发布能力；不新增通用恢复器、固定job分支、探针或执行内核。新材料只能比原公开body多一个准确buyer来源，保留两个原来源、控制指纹、业务材料和历史；旧body/pin/110文件闭包不改写。

本地已确认buyer值通过真实域边界校验、候选body仍649c3077…；原工厂按设计拒绝该新body的旧固定哈希，因此**还未接通已发布云入口**，不能把仅参数检查通过称为完整V5 Review可用。接线完成的No-Go标准：实际V5 Review/模板重建必须接受准确三来源、原两来源历史仍验证、旧任务/账本不变、默认入口仍关闭，云端与本机绑定同一来源；未经真实定向测试及准确CI，不创建新held任务、不上传材料/发布来源、不改trust、不开始短窗口或部署。必要来源/reusable/trust-only差异与请求/整轮副作用仍集中列明、按新SHA审核，GitHub环境由本人批准。

### 最小组合候选已编码（本轮仅代码/测试，未激活）

新增仅一个 [buyer-compatibility.mjs](../ops/platform-reviewed-cycle-v1/buyer-compatibility.mjs)，位于原整轮目录；没有新执行器、SDK封装、队列、恢复框架或固定job分支。`BUYER_SOURCE=null`，原已发布workflow、operator绑定、两来源材料和110文件不改。候选把以下能力接到同一份显式SOURCE：

- 原 `prepareInitializedPlatformRequest` 单INSERT编译器：完整旧业务/账本/保护摘要、全终态/空lease、最新准确回执及确定性request/job ID全部匹配才返回原SQL；不执行SQL，不取消旧成功任务，不生成实际新任务ID。
- 原 `recoveryData` genuine capability与 `continueCloudContextV5`：先重建真实历史恢复锚，再验证成功回执＋独立Inspect的后继链。不可把序列化basis当能力、跳过旧未验收缺口、把成功a00再当未验收恢复，或延长basis事实时间。
- 只接受649c3077…准确新body；还原其唯一CORS差异后必须由原工厂验证5c7e5eef…旧body。原材料、控制指纹、镜像、Secret引用及业务配置不变。新旧Review的完整CFN模板与七项resource inventory相同，参数只差准确buyer来源，request/manifest哈希相应变化。
- 同一候选SOURCE调用原 V5 root 和原 `runPlatformCloudV6` mode bridge；安装绑定、源码/closure、准确job、原claim/完成/Inspect校验继续保留。候选新增文件用**111文件增量闭包**单独计入，不冒称110旧闭包已覆盖新增接线。

本机35项定向检查通过（10项新接线＋15项原域名/边界＋10项原请求）；包含真实V5 Review/完整模板重建、云mode bridge、原body保持、伪造basis/独立证据/请求/安装/源码/过期/旧行漂移拒绝。使用公开材料和合成行/依赖，不读生产配置、私钥、Secret或业务原件，不调用AWS/Neon。新检查进入原无AWS身份CI，准确远端CI结果只在实际完成后记录。

**尚未完成/不能混称**：这不是已安装cloud entry或整轮部署证明。当前线上仍是旧 `recovery-envelope/v1` SOURCE；新候选使用原V6已验收后继能力，并不声称旧固定恢复发布器可直接接收新材料或新协议。SDK/OIDC/S3运输端仍须复用原能力，在后继集中材料中明确来源/发布组合差异，不能偷偷替换workflow或绕开人工门禁。还未用真实a00原件重建候选SOURCE，未分配新job/nonce、上传新材料、消费槽、续租、dispatch或部署。

准确CI通过后，下一唯一动作是以已封存事实和原件准备**准确新请求＋accepted lineage＋buyer材料/SOURCE与必要发布组合的集中材料**，先证明原发布/整轮组合能承载该绑定；如有必需差异只改原组合，不复制执行器。原09:07只读事实至14:07:12.204 CDT不重计；到期只继续本地材料，不自动重新读取生产。实际副作用仍新SHA审核，先备齐整轮再开短窗口。

**准确CI现已通过**：源码 `ed4d15dbdbc11bdad4acd8b4feda0f85e3dc5745` 的 [run40894623180](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40894623180) completed/success、attempt1，job123520234513的16项报告步骤全部成功。本机35项定向＋81项旧相关回归、类型、lint、YAML/链接/diff均通过；原110闭包仍0c6f119d…，新增111候选闭包为96679e2e…。恢复读 `F:/ChatGPT_workshop/techlong-buyer-compatibility-code-verified-20261029-a.json`，raw SHA `9beba5a3bd1fa7954df2ebc68935b81843669e9ad739d5524ac6ce8b69e67254`。本轮生产配置/私钥/Secret/HMAC读取、AWS/SQL连接/写入、任务/槽/dispatch均0；正常代码/文档提交和无AWS CI不等于生产激活。后续文档HEAD不是这次CI源码，未改测试源码不冒称重跑。

## 集中材料草案及兼容性核对（10月29日09:57 CDT）

本阶段不重复上轮测试或部署。已用真实封存原件重建旧basis并核对54份整轮原件、11份固定版本对象记录；读取09:07已存数据库快照，仅在本地调用原单INSERT编译器。候选 `job_b236b120d6406d3e296d341b` **只是草案ID，未创建、未查询其当前数据库存在性、未分配任何执行槽**；全部12旧任务/17plan/12approval/12attempt保留，不能取消已成功a00。新材料仍仅增加buyer来源，body SHA649c3077…；请求SQL、nonce、原始业务及未完成后继链只在私有目录，不提交Git。

恢复读 `F:/ChatGPT_workshop/techlong-buyer-backend-material-prepared-20261029-a.json`，raw SHA `a362f39693f14d80d8f59fa788b0aa8b986f179fa16c02e0dd13b8f555a40223`。它绑定本地草案result（raw SHA94b644fb…）、四份草案文件及下面的单次补件停止记录。原准备仍于今天14:07:12.204 CDT到期，旧basis原截止为10月30日10:08:09.592 CDT；两者均不重计，不把草案编译时刻09:57当生产观测或新事实批准。最初Windows ESM导入路径错误发生在任何准备I/O之前，改成file URL后本地编译完成；不涉及生产重试。

### 不能直接发布的准确差异

| 既有位置 | 当前源码实际约束 | 最小处理边界 |
| --- | --- | --- |
| 原 `package.mjs` / 请求来源 | 要求旧pending取消后的两行handoff及其独立回执 | 本轮是单INSERT，不能假造canceled旧成功任务或复用旧handoff证明；复用原请求编译/事务/回读能力 |
| `cycle.mjs`、恢复publisher/信封 | publication必须recovery-envelope/v1，inner predecessor固定为原basis恢复锚 | buyer候选先追加真正验收的a00，再改变准确CORS；不能仅换SOURCE/job ID或给旧恢复basis改前驱 |
| 原native V6 publisher | 自行读取旧两来源capsule并调用原固定工厂 | 仅换成native发布器仍不兼容；本机证据验证和云根必须绑定同一个经验证buyer context |
| `whole.mjs`、Review/Inspect successor组合 | 硬接恢复publisher，并按innerManifest、旧descriptor字段和固定capture对象数校验 | 只在原组合接入准确buyer材料/模式绑定，保留三写、完整业务/账本校验、时间预留和未知不重试；不放宽字段/数量guard掩盖差异 |
| 线上live/bootstrap及发布模板 | 固定旧恢复application、110冻结源码、旧SOURCE/reusable | 不改旧110；候选111是代码证明，不是已装SDK/OIDC/S3入口。必要源码/原双workflow/唯一trust pin差异集中准确审核，不扩IAM权限或新建执行器 |

上述是本地源码事实，不是新的云漂移。当前组合兼容性结论为 **NOT_COMPATIBLE / NOT_EXECUTABLE**；没有生成部署批准SHA。下一只完成这些原发布/整轮组合的必要兼容接线，复用原V5执行根、SDK能力与Git/CFN发布器，不新建运行器、框架、身份、镜像或固定job分支；旧测试和旧110必须保持。

### 唯一缺失的历史原件及一次补件停止

a00的manifest、成功回执、独立Inspect及固定provider引用均已找到，但54份封存集合不含该provider对象正文。不能从现在的已删栈、推算task revision或合成数据代替原件。准确对象为同一私有证据桶中 `.../job_a00fc18c13a5d6c6616c8039/35ca1be63598b1989f7c3c12ff91c53482bd5c7ad6dc41c738bb7b82806bca58/run-40751515012-1/provider-after.json`，固定VersionId `.geI7CLMRhzabh1lmey4OLkDHhy7JlaB`，既有SHA `c2a78b3ee6dbb6b6d81aa7daadb91c574ac9fff8abc3db8efeebd328f16ed4ef`。完整键只在上述机器检查点内，未列桶。

用户另允STS1＋该版本GET1/≤1MB后，10:03:13–10:03:15的独立记录在官方STS身份步骤以CLI255停止；实际STS尝试1（是否到达服务未知）、S3 GET0、其他AWS/配置/Neon/秘密读取/云或DB写/槽/dispatch0。错误分类CLI_OR_TRANSPORT_FAILURE，原因未证实，不能断言凭据过期或刷新失败，也不推定一定是本地网络限制。不重跑、不沿用未用GET继续、不盲目要求刷新；需要时另批新的准确补件尝试。原result `F:/ChatGPT_workshop/techlong-buyer-provider-readonly-20261029-a/result.json`，raw SHA `b823b531b4b64259c0f79bf3c7b4c64ef7e235b275b128061d9615ad57054646` 保持。

### 后继集中范围草案（非执行批准）

准备顺序固定为：完成原组合兼容及准确CI → 取得缺失固定原件并验证accepted链 → 绑定真实完整状态/新请求与独立回读 → 准确新材料上传及必要原双workflow/SOURCE/trust-only差异 → 同任务Review→RunOnce→独立Inspect。前三项不齐就不占短窗口。实际请求写、上传、权限/来源发布、私钥/固定Secret使用及三次dispatch，仍须完整次数、资源、期限、派生规则和风险绑定到新SHA；本草案的批准SHA为null。

云范围仍只考虑原ca-central-1租户名/原镜像、最多一次CreateStack/七承载资源、一次控制私密包读取/两次认证GET、同任务原子完成及独立验收；GitHub environment三次由用户本人批准，不再要求Web页面点击。50 USD/月仅目标、可能遗留收费资源、清理另审；不删除、不续旧TTL、不重发客户端/证书/CDN/HMAC，不通过新增IAM权限来迁就候选。具体预算及整轮上限须组合验证后再确定，不能把旧整轮SHA/635查询预算或上轮读取许可自动套给新周期。

## 原发布/整轮组合兼容修复（代码阶段，未发布入口）

本阶段只解决上一节源码组合No-Go，不再补件或读取生产。原 `createCycleComposition` 现在可由**不可序列化的genuine buyer能力＋准确bundle**选择已验证buyer context；不靠CLI/env/JSON开关。原V5执行根、owner SQL、三写publisher、连续Review及整轮流程继续复用；旧恢复流程是原默认路径，110冻结文件不改，没有新队列、云执行器或SDK包装层。

最小差异包括：

- buyer模块验证原生V6结果的精确字段、真实run/源码/版本引用、原V5 manifest/完整模板、同一安装绑定和独立Inspect；不把恢复信封改名冒充原生证据。恢复锚依旧由原编译器重建，当前全历史baseline另行核对，旧basis不得延期。
- 原组合传入该context/完整旧baseline、合法单INSERT实际回执与严格proposer；原三写顺序及独立回读、旧业务/账本/保护核对不变。policy与实际步骤的到期均不超过原basis。
- continuous、whole和实际capture适配器从同一个CODE能力取得真实原生manifest；旧路径仍读原innerManifest。原capture4/6/5对象上限、15分钟claim、8分钟RunOnce及12/10分钟Inspect预留保持，不以放宽字段/数量校验消除差异。
- 既有本地入口仅在受审SOURCE选定buyer时读取其固定本地证据bundle，验证SHA并重建genuine能力；无新路径/目标/模式参数，默认未启用buyer。SOURCE派生保留原四个自引用规则，**另明确派生buyer的code.commitSha及buyerContextSha256两项**；非null模板/任意重复绑定拒绝。这六项规则必须进入后继准确发布审批，不能沿用旧“四项已批准”范围。

本机46项定向检查通过（11项新发布/整轮检查、10项原buyer接线、15项域边界及10项原请求），另81项旧整轮/上传/发布/V5根回归通过；类型和lint结果及准确CI在收尾时据实际记录。新增测试运行真实编译器、证据验证、原三写和原整轮组合，cloud执行报告及外部端口为明确合成fixture；不把这些测试当实际CreateStack、AWS/Neon现状或部署证明。最初抽出fixture时遗漏normalizedState导入导致一次本机测试失败，已修正；不是生产错误或云重试。

**仍未授权/未完成**：buyer SOURCE未选定、原受保护双workflow/role trust及SDK/OIDC/S3生产装配没有发布；真实provider原件仍缺、草案不是真实held任务，实际材料/新来源/部署均未发生。下一只在此代码准确CI后补齐缺失原件并重建真实SOURCE/bundle，集中生成原双workflow/SOURCE/唯一trust pin的受审候选；生产运输装配及六项派生必须在发布前有准确证明，不假设旧publication-local可直接执行。补件须另批新STS/GET，旧CLI255记录和原准备/basis期限均保留，不重试、不restamp，不先开短窗口。

**本阶段已准确收尾**：最终源码 `4a62d740c1350aefab058327cddaa19ae4bb4f7a` / [CI40926305909](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40926305909) completed/success、attempt1，job123632624159的16项报告步骤全部成功；类型/lint、JSON/YAML/链接及最终diff检查通过。初始8e09fd7后的fixture末尾空行已独立修正，未重放或amend历史提交。原110仍0c6f119d…，当前111候选闭包为 `caeca1f9d0413d0b592efa2bec373d4d0d4eb26f306f2e2d1165ea212d55d1e3`，不是旧111的96679e2e…。恢复读 `F:/ChatGPT_workshop/techlong-buyer-publication-composition-code-verified-20261029-a.json`，raw SHA `1d75807adc81ba7a9c50b9ca228410f2b62ac576afbc5e96d0644208b2768512`；绑定13个源码/测试/无AWS CI文件hash和准确远端步骤、旧草案与补件停止索引。真实业务原件不在Git。本阶段生产调用/配置/秘密读取、SQL连接/写入、上传、任务/槽、protected workflow/trust改动及dispatch全部0；后续纯文档HEAD不冒称重跑该CI。下一步就是上段真实材料及受审发布候选，不再重复本代码阶段，也不提前申请部署。
