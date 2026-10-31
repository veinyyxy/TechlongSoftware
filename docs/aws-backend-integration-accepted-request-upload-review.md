# 已验收续接：新请求与不可变材料的受限调用配方

本文件服从[执行手册](aws-auto-deployment-execution-runbook.md)，仅覆盖主线第2步「新 held 请求、独立回读及 buyer bundle 条件上传」。它不是生产读取或写入授权；准确SHA只认下面实际封存的执行包，代码/文档提交和只读许可都不批准执行。不得直接运行历史 `techlong-buyer-request-upload-20261029-a.mjs`：它绑定已取消 b236、旧 basis 和旧时钟逻辑。

## 本轮准确执行包（待批）

Source刷新后用户另允同范围新b，10月30日20:34:42.313–20:36:25 CDT成功取得真实新事实：STS1/HTTP1、AWS元数据73（含准确HEAD）、GitHub GET9、配置1/TLS1/只读SQL21，写/槽/调度0。完整13任务、19/14/14账本、业务/保护与原基线相同，准确候选/去重键/对象缺失。新观察不是旧采样改时间；有效至10月31日01:34:42.313 CDT，最晚启动01:19:42.313。旧basis/事实/TTL不变，原失败和旧槽保留。

新事实证明 `F:/ChatGPT_workshop/techlong-buyer-accepted-facts-readonly-20261030-b/checkpoint.json`，raw SHA `34a67ae565e2e2834615f2df59e538e8dd3b490b233fd7e83b6f101db5e61da1`。本次新PENDING来源复用同一候选、相同包正文和基线；原适配器依然拒绝PENDING，没有实际新authority或业务写入。原最小代码及准确CI仍是a221a24/41141437220，新增本机调用不冒称该CI已覆盖。

本机调用 `F:/ChatGPT_workshop/techlong-buyer-accepted-request-upload-20261030-a.mjs` 只是既有编译器/TLS reader/条件上传及Inspector的准确装配，无新工程运行模块。对应 `.test.mjs` 的21项本地检查通过：单INSERT/pg_catalog/UTC、旧行漂移、零行/未知COMMIT、严格新行回读、准确ACK、原上传冲突不重试、单调30秒/DB倒退及明确事实派生/参数门禁；外部端口为合成，旧请求草案只用于本地检查，不作为真实新写时间。

准确执行SHA、调用/测试字节、主源码/事实/风险pins和配置元数据只认 `F:/ChatGPT_workshop/techlong-buyer-accepted-request-upload-20261030-a/prepared-verified.json` 实际生成并匹配。`manifest.json` 的SHA是待批执行标识，生成不批准执行；最终值不写回本文件制造自引用。封存后冻结main/本机调用，仅等用户该SHA确认。批准后最多原单INSERT一行held、独立完整回读、一次条件PUT和固定版本GET，下面全部上限和风险保持；不写控制账本、不读PEM/Secret值、不发布来源或dispatch。

独立检查最迟到新事实截止后10分钟（01:44:42.313 CDT），只读、不因此续写；重建能力若已过期仍须停止，不用历史时刻绕过真实执行校验。最终本机装配增加的写前STS包括在总上限4内，不另开身份/重试预算。任何未知提交停止后继写，不据独立观察自动补齐。

## 已经完成与尚未完成

- 最小兼容源码 `a221a24dd0fa5a99c2917b74b51c7e5f8b1a2654` 的[无 AWS CI 41141437220](https://github.com/veinyyxy/TechlongSoftware/actions/runs/41141437220)通过；本机167项相关检查已封存。后续纯文档 HEAD 不是该 CI 的源码，不冒称新增运行代码已验证。
- 保存的候选为 `job_36735d0b9201afabd681b061`，请求标识/去重键由原编译器产生并保持；不再次随机生成候选。候选只存在于本地草案，尚未 INSERT。
- 包规范字节621945，SHA `5485a0c9ded263c9da05aeb29e13bd06045c02c1c78a52632ef369d8a872c5f1`；准确键是私有证据桶 `techlong-sandbox-cloud-worker-evidence-402010193138` 中 `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/buyer-context-v1-5485a0c9ded263c9da05aeb29e13bd06045c02c1c78a52632ef369d8a872c5f1.json`。尚未上传，VersionId=null。
- 10月30日19:40 CDT的另批 b 补核证明当时准确候选/去重键和对象均不存在，完整13任务、19/14/14账本、准入及保护保持；实际 STS1、HEAD1、配置1/TLS1/只读SQL17，无写/槽/调度。这是当次观察，不是目前状态保证。
- 原完整事实从14:43:48.735 CDT起仅5小时，19:43:48.735截止；预留15分钟后最晚写启动19:28:48.735。b 补核完成已晚于该启动点，不能借补核、代码CI、文档提交或本地封存重计原事实。历史 basis 的10:08截止也不变。
- 该旧准备没有产生真实 facts approval、新 authority、请求、上传或来源选定。PENDING来源仍须被原适配器拒绝；本轮新事实/待批执行包按上节区分，旧草案/失败原件/永久槽全部保留。

## 精确复用的调用顺序

本节是既有函数的受限调用合同，不新增队列、云执行根、通用恢复框架或固定任务分支。最终本机调用文件、依赖闭包、配置元数据、风险字节与实际新事实必须一起封存到新的外层 SHA 后另批；不能把本地材料摘要当执行 SHA。

| 顺序 | 既有实现与必须保留的限制 |
| --- | --- |
| 0 审批与来源 | 核对 main 干净、受审代码 pins/111闭包和本地调用文件；后续 HEAD 与准确 CI 源码若仅文档差异，分别记录，不能混称同一次CI。官方STS只接受准确 IAM user，先于配置内容读取。旧外层批准、目录与槽不重放。 |
| 1 重建能力 | `rebuildRecoveryPackage`/原 profile 只重建历史溯源；`prepareBuyerCompatibility({source,basis,capsule,links,baseline,now})` 使用新受审事实和完整基线。原历史 expiry 不改，不能用历史时间打开本轮执行能力。 |
| 2 打开写连接 | 原 `openTransferDatabase`，`allowTaskUpdate:false`；原身份/TLS/80查询限制保持。`readTransferState` 加原完整历史账本 SELECT 和准确 ID/dedupe 查询，不把默认两任务 ledger 当完整历史。所有读事务及写事务内显式 pg_catalog/UTC。 |
| 3 单 INSERT | SERIALIZABLE；短 lock/statement timeout；三控制表 SHARE 锁及原任务集合行锁；完整基线完全一致；由实际 DB clock 传入 `compat.prepareRequest`，只提交原编译器的单条 CTE INSERT，准确返回一条新 held 行。不复用保存草案的 requestedAt，不调用旧两行取消入口。 |
| 4 事务与独立回读 | 事务内回读、COMMIT ACK 后，关闭连接并以另一验证TLS READ ONLY连接重读。删除唯一新行后的规范状态必须与完整旧基线逐字规范相等；新行须 pending/attempts0/max1、MAX_SAFE_INTEGER hold、无lease/错误/完成字段，payload/request/dedupe一致，创建/更新时间在实际DB时序内。 |
| 5 原上传器 | 仅在 COMMIT 明确成功且独立回读通过后，调用 `packageUploadRunner`＋`createPackageIo` 的既有 code capability。Source两次、桶六项安全元数据、准确键两次HEAD；唯一PUT必须 IfNoneMatch=*、AES256、准确字节数与SHA256校验和。不列桶、不取旧正文、不上传其他键。 |
| 6 独立对象核验 | 独立 `createPackageIo(...,{inspect:true,capability})`，只按实际 PUT ACK 的准确 VersionId 做一次GET；校验版本/字节/SHA/加密并 `rebuildBuyerBundle`。返回新的 `.authority`，不是历史 `.basis`；未取得可信ACK不得猜版本、列桶或补写。 |

### 审批派生与时钟

外层清单绑定真实新观察、PENDING来源、完整基线、历史原件和准确请求/包。用户批准外层 SHA 后，才按清单唯一规则在内存派生 `approval.state=APPROVED`、`approval.manifestSha256=外层SHA` 与正确 facts commitment SHA；再由原适配器产生独立 authority。外层不能预填自己的SHA造成循环自引用，也不能把本次材料摘要当该批准。新事实/新来源保存为新原件，不覆盖当前PENDING文件。

原上传/发布合同字段名 `basisSha256` 在此路径必须绑定新 authority SHA，`basisExpiresAt`绑定新事实截止；历史 basis SHA/expiry只留溯源。候选及包若真实基线保持可继续复用；发生漂移则停止给差异，不自动换候选、重计包、改变基准或补齐。

30秒事务/最后核对经过时长使用本机 `performance.now()`；DB epoch只用于事实有效性、准入和DB前后时序，不能用 DB epoch 减本机UTC来判定30秒。写前至少15分钟启动预留，写操作不得越过新事实截止/各组件更早截止；检查器不允许续写。旧requestedAt、lease、claim、TTL和basis均不延期。未来新事实5小时从实际首次采样开始，不从封存或用户批准开始。

## 后续执行的最大范围（尚未批准）

| 项目 | 总上限 |
| --- | ---: |
| Source STS（先于DB1＋上传2＋对象独立核验1） | 4 |
| 桶安全元数据 / 准确键 HEAD | 6 / 2 |
| `.env.local`全文件读取 / 验证TLS连接 | 2 / 2 |
| SQL（每连接≤80，含事务控制、锁、编译器语句和回读） | 160 |
| 原单INSERT提交 / 新held行 | 1 / 1 |
| 条件PUT / 实际ACK固定版本GET | 1 / 1 |
| 新永久槽：请求、请求独立回读、上传、对象独立核验 | 各1，合计4 |

AWS/数据库写与实际私密材料读取尚须新SHA批准；前面的新事实采样另有准确次数及许可，不包含在上述执行预算中，不自动沿用旧读取余量。超预算、角色/版本/基线变化、来源或审批不匹配均停止。

**本阶段始终为0**：旧任务 UPDATE/DELETE、控制账本写、IAM/工作流/Secret修改、Secret值/PEM/HMAC/控制私密包读取、DDB业务项、Aurora连接、Cell/承载创建、来源发布、Review/RunOnce/Inspect dispatch、续租与自动重试。GitHub本人门禁不变；请求+包通过不等于部署成功，后续来源发布及整轮分别审核。

## 完整风险与停止规则

1. 配置文件虽只用于准确Neon连接，整文件会两次进入进程内存；既有owner凭据权限远宽于本次单INSERT。TLS/固定SQL/次数及日志去敏只能缩小使用范围，不能撤销owner能力；操作系统、内存转储、数据库及提供者日志仍可能暴露信息。不会输出或提交凭据。
2. SERIALIZABLE、控制表/业务行锁、原保护触发器可能短暂阻塞其他写入或导致本事务失败；不能保证无竞争。锁与审批、AWS元数据和对象上传不是跨服务CAS，独立回读后仍可能出现并发变化。
3. COMMIT或PUT可能被服务端接受但响应/本地落盘失败，状态不明不代表未应用。任何失败/未知立即禁止后继写；单独只读核对即便发现已应用，也不是自动继续上传或补齐的授权。无可信版本ACK不猜测对象版本。
4. DB提交与S3上传非原子：可能只留下永久held任务，或任务和收费对象存在但核验未完；held不等于无副作用，也不自动被普通worker领取。未提交事务可以正常ROLLBACK；已提交任务/对象不自动删除、补偿、down、复位或重试。
5. bundle含历史业务记录、请求、部署及Account ID/ARN等元数据。上传准确私有桶后，既有获授权主体仍可能读取；版本保留和日志可能持续计费。AES256和block-public配置不是所有风险/费用归零保证。正文仅在本地私有证据目录及批准的私有对象，不提交GitHub。
6. 既有AWS Login凭据进入SDK内存且可能自动刷新/失效；maxAttempts=1不构成网络绝不重复到达的保证。官方固定endpoint、无区域跳转、准确身份/版本验证和单次槽不能消除服务端或网络风险。
7. 四个槽永久占用、失败不复位，云/DB事实窗口和旧截止均不续期。任何新尝试、必要新读取、来源发布、部署或清理另审；不能凭未用次数继续、不重放旧命令。
8. 请求/元数据/存储/读取产生低额但非绝对零费用。50 USD/月是预算目标，不是硬停费；本阶段不创建付费Cell但现存共享资源仍可能计费，未证明账号零费用或整套产品验收。

## 本地恢复与唯一继续点

主源码证明：`F:/ChatGPT_workshop/techlong-buyer-accepted-continuity-code-verified-20261030-a.json`（raw SHA `0b11c3df4b2bec4bd6b2c609551932a02f5942f4a3cc671f1401f53704f0c401`）。

草案：`F:/ChatGPT_workshop/techlong-buyer-accepted-request-material-20261030-a/checkpoint.json`（raw SHA `98f184b45c6958bdcf6eee501e3233a21195953eb6aef9247fc69bcd1ff29fde`）。仅重读封存原件，不重跑原准备器生成另一随机候选。

补核b：`F:/ChatGPT_workshop/techlong-buyer-accepted-target-readonly-20261030-b/checkpoint.json`（raw SHA `28cff80bfbef9db6a9aa11b34436e954c3a6f034b837421435b2db64129c0691`）。a的失败及b的真实时刻保留，不重跑。

原材料封存 `F:/ChatGPT_workshop/techlong-buyer-accepted-invocation-material-20261030-a/checkpoint.json` 及其摘要保留追溯，不是执行SHA。新限定只读b现已完成，当前唯一动作是封存上节准确执行包并等待用户新SHA批准；不开部署短窗、不再扩兼容功能。请求/包通过后才进入必要来源发布，最后同任务整轮和有限买家业务验收。
