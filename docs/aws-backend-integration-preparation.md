# 后端联调/CORS：当前最小准备与继续点

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)，承接[已完成的客户端静态发布](aws-buyer-web-sandbox-publication-observed.md)。本文件仅整理当前主线，不是新任务、数据库写入、私密读取、来源发布、IAM修改或付费后端部署授权。[机器准备摘要](../ops/aws-sandbox/reviews/backend-integration-v1.plan.json)执行SHA为null。

## 已确定的主线差异

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

## 当前唯一继续点：本地最小CORS/新合法请求接线与测试

已有事实足够准备最小适配，不再重复只读核对或开前端支线；没有可重用的待审任务。下一步按以下顺序备齐整轮材料，实际副作用仍另批：

1. 仅纳入前述准确CloudFront来源，保留原两个CORS来源。把差异绑定到新的受审配置材料/源码，不改写旧capsule/pin的历史含义，不放宽任意参数/来源/闭包；复用原执行器与7资源模板。
2. 复用prepareInitializedPlatformRequest的一条新held请求编译能力；本机纯投影已证明expired且无活跃任务，可准备新请求。不得使用要求“旧pending取消+新建”的两行handoff，不取消或复活a00，不复制固定job目录或创建新的通用请求框架。当前尚未分配新job/request ID、编译或提交写入。
3. 在开窗前集中备齐新请求、配置/来源与必要包引用、准确源码/CI、必要workflow/reusable trust-only差异、Review→RunOnce→Inspect累计副作用、本人GitHub审批点及时间预留。代码/测试不产生云权限；新任务写、上传、来源发布、IAM trust及付费部署各在准确清单列清，不能临时扩大。无需重发镜像、重读HMAC或重建前端。
4. 新后端验收意图仅按2小时候选准备，实际起止仍null；当前不续旧TTL或启动任何资源。先备齐再审批，过期不重放；清理按准确资源另审，到期不等于停费。
5. 后端独立Inspect通过后，才另按准确范围准备客户端启动、既有店铺/菜单读取及API/数据库连通。启动客户端会正常创建/更新访问租约并heartbeat，不能当纯只读；不默认创建商品/订单、重设商户密码或Stripe支付，数据不足先记录缺口。

本阶段只完成只读事实与本地差异/投影核对；没有修改部署代码、角色、材料、数据库或前端，也没有执行SHA或新事实执行授权。50 USD/月仍是整体目标而非硬停费，平台/共享Cell/数据库和静态版本可能持续收费；不扩F3c9、前端/探针/UI/调度平台，wholeProductAccepted=false。
