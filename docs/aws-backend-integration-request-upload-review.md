# buyer后端联调：仅登记请求与上传材料的审核范围

2026-10-29，America/Winnipeg。遵循[执行手册](aws-auto-deployment-execution-runbook.md)及[当前事实](../ops/aws-sandbox/reviews/backend-integration-v1.readiness-20261029-d.json)。本页不是批准，也不启动Review/RunOnce/Inspect、修改IAM或部署承载。

## 唯一目的与复用边界

为同一候选 `job_b236b120d6406d3e296d341b` 取得真实held请求及独立回读、准确bundle上传版本，消除后继来源发布缺少真实回执的问题。不新建平台功能、执行根、队列或固定任务分支，不重做前端/证书/镜像，不重放a00或旧槽。

原 `request-local.mjs` 是取消旧pending加INSERT的两行handoff，**不适用于本次全终态历史**，因此不调用它、不把成功a00改为canceled。本次固定本地调用配方只复用 `prepareBuyerCompatibility().prepareRequest()` 的原单INSERT、`openTransferDatabase` 的配置读取/TLS/身份/80查询上限、`readTransferState` 的完整catalog/准入/保护校验，并按原控制表SHARE锁及SERIALIZABLE事务规则提交。没有复制SQL编译器或新建应用执行器；配方和证据在本地，不替换工程入口。

材料上传仍由既有 `packageUploadRunner` / `createPackageIo` 执行，其原STS身份、桶安全校验、条件PUT和固定版本GET不变。只通过已有CODE capability绑定准确buyer bundle及原genuine basis重建，不修改上传器、SDK封装或线上source。工程应用代码仍为已验收cfb1408/CI40940078691；本地配方的17项合成客户端检查不冒称远端CI或真实AWS/Neon验收。

## 真实目标与允许的最小副作用

- 同一实例 `app_e897a4377bce498b9c5ee9e64509dcad`、deployment `dep_7c99bd249470184852f0dc74`，request ID `d7436aa8d34b8205a2e9a5650a2a05dbfce22facefb0009d4a3dd55854f9debe`，clientRequestId `0cfcf0c0-fd5e-4c52-9481-7b0c0a5f592d`。
- 最多提交一次原单INSERT：新行pending、attempts0/max1、available_at=Number.MAX_SAFE_INTEGER、lease为空。普通worker不能领取；不取消/更新任何旧任务、控制账本、业务原件、权限或保护。
- 私有桶 `techlong-sandbox-cloud-worker-evidence-402010193138`，key为 `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/buyer-context-v1-f01f9489f1987c3517c858ed7a4cf81fbbf0fb502dea405b9c82336dbecc8b78.json`。canonical JSON准确615808字节、SHA `f01f9489f1987c3517c858ed7a4cf81fbbf0fb502dea405b9c82336dbecc8b78`，不是外层pretty JSON文件字节。
- 上传仅一次 `If-None-Match:*` / AES256 / ExpectedBucketOwner402010193138 /准确ContentLength及SHA256 checksum；随后独立一次GET准确ACK的VersionId。版本只从真实ACK及独立大小/加密/checksum/SHA/内容重建得到，不预填、不覆盖旧对象、不列桶。

本轮获批执行的累计上限：配置全文件读取2、验证TLS连接2、SQL160（每连接最多80），其中单INSERT提交最多1、新held行最多1；Source STS3、桶元数据6、目标HEAD2、条件PUT1、固定版本GET1。GitHub GET/写、Secret值/PEM/HMAC/DDB项读取、Aurora连接、旧任务/控制账本/部署更新、IAM/受保护workflow改动、续租、dispatch、CreateStack及自动重试均0。

配置仅经原固定读取器在内存使用；不是在聊天提供凭据。PrepareSaved只核对文件长度/ACL等元数据，不读取配置内容、不构建AWS客户端、不连接Neon。实际Source仅接受准确IAM用户techlong-sandbox-dev；不提前要求刷新，只有实际凭据检查失败才停止处理。

## 固定时序与核验

1. 核对准确批准SHA、本地配方/测试原始字节、clean main、原源码/CI文件pin、原110/候选111闭包及材料hash；不允许CLI/env/JSON替换目标。
2. 原TLS连接验证owner/database/session；读只读完整基线，必须仍为12旧任务和17/12/12账本规范摘要fd0bfd96…，准入/保护、无lease、候选id/去重键无冲突均匹配。消费同一job稳定的请求永久槽。
3. 单个SERIALIZABLE事务、`SET LOCAL search_path=pg_catalog`、1秒lock_timeout/15秒statement_timeout，锁定控制账本SHARE、重读完整状态并锁定原job集合。请求payload.requestedAt仅从该事务已验证的数据库时钟派生；原INSERT自己锁定/校验准入行。事务30秒限制、不接受保存的旧时间参数。
4. 最多一次原INSERT，事务内重读，除新held行外完整状态必须逐字段相同，然后一次COMMIT。未提交时可正常ROLLBACK；COMMIT提交/ACK不明时不发ROLLBACK、不重新INSERT。
5. 另一个验证TLS连接独立完整回读并验证新行及全部旧记录；无论成功、停止或提交不明，最多只用这一个独立连接。只有**明确COMMIT ACK且独立完整验证成功**才继续上传；即使不明提交的回读发现新行，也停止后续写，不能自动补齐上传。
6. 原上传器重新核对准确IAM用户、桶区域/版本化/AES256/BucketOwnerEnforced/四公开阻断/PolicyIsPublic=false及无delete marker的准确目标404；两次身份与HEAD核对后消费上传槽、仅一次条件PUT。成功ACK后再独立消费Inspect槽并作准确版本GET和genuine basis重建。
7. 任一失败、漂移、未知、条件冲突或凭据不可用即停止更多写；保留已写事实及所有永久槽，不清理、补齐、复位或自动再试。各阶段结果保存在本地，不把业务正文或SQL参数提交Git。

## 时间与实际批准

准备事实来自10月29日14:39:51.491 CDT，只在今天19:39:51.491 CDT之前生成新清单，不重计采样时间。清单可用期最长24小时并**硬截于原basis 10月30日10:08:09.592 CDT**；最晚启动预留15分钟，即明天09:53:09.592 CDT。运行时仍完整核对当前数据库及桶，不将历史快照当分布式CAS，也不授予basis延期。

精确本地原件：

- 调用配方：`F:/ChatGPT_workshop/techlong-buyer-request-upload-20261029-a.mjs`；合成检查：同名前缀 `.test.mjs`。
- 清单：`F:/ChatGPT_workshop/techlong-buyer-request-upload-20261029-a/manifest.json`；生成结果 `prepared.json`；独立封存 `prepared-verified.json`。**最后一份存在且raw SHA/实际HEAD/配方pin全部匹配才算准备完成**，本页不推定它已生成。
- 仅准备：`node --experimental-strip-types F:/ChatGPT_workshop/techlong-buyer-request-upload-20261029-a.mjs --prepare-saved`。
- 实际执行须另批准确manifest SHA；获批后命令为同一配方 `--run-reviewed <准确SHA>`，不是重复运行PrepareSaved。main及配方在真实清单生成后冻结，不再提交文档导致来源变化。

四个固定永久槽均在同一 `techlong-reviewed-cycle-job_b236b120d6406d3e296d341b` 本地前缀下：buyer-request、buyer-request-inspect、buyer-package-upload、buyer-package-inspect；不随输出目录、清单SHA或失败次数变化。已占任何槽不重新RunReviewed。另需恢复/只读回读时按准确新范围审，不复位槽。

## 完整风险与不包含项

现有owner数据库凭据权限较宽，列/目标校验不等于数据库权限已缩窄；两次全配置进入内存、TLS网络/提供者及审计日志仍有暴露风险。短暂行/表锁可能影响并发，SERIALIZABLE可能中止；读取不是跨事务/跨服务CAS。SQL与S3非原子：可能只留下held请求、收费对象版本，或未知提交/上传结果。私有bucket不意味着既有获授权主体不能读取历史业务及Account ID/ARN元数据；bundle不是Secret值但仍按私有业务材料处理。

AWS Login自动刷新可能失败，独立核验也可能失败；当前批准不等于以后可无限读取、补齐或清理。接受提交后不自动down/回滚/删除、永久槽不复位、失败/未知不自动重试及低成本但非绝对零费用。原有云资源仍可能计费；50 USD/月是目标，不是硬停费保证。

即使本轮成功，两个buyer生产选择仍null；不生成/执行workflow或trust Change Set、不读取控制私密包、不调度三模式、不建付费Cell或租户承载，不称整体上线。下一才用真实请求及版本证据准备原双workflow/SOURCE/六项派生/唯一trust claim的准确发布审批，随后单独准备同任务整轮；三次GitHub environment仍由用户本人批准，不要求Web界面操作。

## 本次实际完成结果

用户确认清单 `a8393ad2aeb7bdc65f04fd6b73fb9f3e5e6fddbce532a84cfebe557edff783fb` 后，首次启动在工具自动审批阶段因额度失败，明确未执行命令、无槽/配置/数据库/AWS副作用。用户要求继续后，于17:46 CDT先核对原封存/来源/76个pin、期限及全部槽/运行目录仍不存在，再经原自动审批唯一实际启动；没有绕过审查或重放已执行命令。

来源 `cc5240120d132ae316347dbed6f641c72ce609f7`：17:47:07.486 CDT明确COMMIT，17:47:13.475独立连接回读新held请求通过，旧12任务、17/12/12账本、deployment/准入及保护保持。新请求pending、attempt0/max1、永久审核挂起、无lease，不可被普通队列领取。独立完整after SHA `585cbb9eb9bc7ffe75dda8c00e1b0f08d371d88d536e310d5b9b07abcea4ae3e`，不是完整产品验收。

原私有桶准确key的条件PUT1已ACK，独立固定版本GET1核对615808字节、AES256/checksum/SHA/canonical内容及genuine basis重建成功。真实VersionId `ywA1SETga2C.2JIxiHXvTcLbXimP0n_4`，包SHA仍f01f9489…；旧对象/原件未覆盖，没有列桶、补齐或重试。

实际累计配置2/TLS2/SQL72（<=160）、STS3/桶元数据6/HEAD2/PUT1/GET1，准确原单INSERT及COMMIT各1。GitHub、Secret值/PEM/HMAC/DDB项、Aurora、旧任务/控制账本写、IAM/受保护workflow、续租/dispatch/承载/清理均0。17项合成配方检查和既有应用CI仍是代码证据；以上为本次另外取得的真实效果，不能互相替代。

恢复读 `F:/ChatGPT_workshop/techlong-buyer-request-upload-executed-verified-20261029-a.json`，raw SHA `4af3c72085a367a601120646fc4832315bd43946252be311585ab5d6df534a30`；它绑定23份原始文件、实际四槽、事务/独立快照和上传ACK/独立结果。[去敏机器摘要](../ops/aws-sandbox/reviews/backend-integration-v1.request-upload-observed.json)不含业务或材料正文。该次独立本地复核没有新的生产读取，成功后来源冻结结束，仅正常记录结果；四槽永久保留，禁止重新RunReviewed、重建请求、再次上传或复位。

原准备观察及basis明天10:08:09.592 CDT不重计、不延期。两个生产选择仍null；下一只准备原双workflow/SOURCE/六项派生/唯一trust pin的准确发布范围，必要新读取/发布及整轮另审。不自动写facts批准、发布来源或调度，不把本次成功说成后端已恢复或整套上线。
