# 新周期来源发布：现有双工作流、本机绑定与一项trust pin

这是[执行手册](aws-auto-deployment-execution-runbook.md)当前P4的风险附表。代码、测试、只读Capture和未引用Git对象只是在准备材料，不代表批准发布、信任变更、App操作或部署。只有用户确认新的准确SHA后才可PublishReviewed；旧a604及包上传SHA不能复用。

## 固定复用与最小差异

**2026-10-29 18:06 CDT：b236真实来源材料已重建，当前只准备事实绑定与发布前只读核对。** [材料去敏摘要](../ops/aws-sandbox/reviews/backend-integration-v1.publication-material-20261029.json)绑定已提交且独立回读的b236、真实上传版本ywA1SETga2C.2JIxiHXvTcLbXimP0n_4及原basis。原a839清单仅批准请求/上传，不自动成为新SOURCE的factsApproval。本地候选publication/activation仍UNPUBLISHED、factsApproval及六项待派生引用仍null；没有用伪造APPROVED、假Git SHA或合成请求回执来调用发布器。

下一份**准备清单**仅请求两项组合批准：以该清单SHA形成本地SOURCE事实批准记录，profile SHA f9319902…、factsAt准确请求事务17:47:07.486 CDT、databaseCheckedAt/observedBy准确独立回读17:47:13.475 CDT，有效终点仍截于原basis明天10:08:09.592 CDT；以及最多STS1＋AWS元数据12＋GitHub GET20的原只读Capture。其余历史锚、48小时profile合同不改，但有效事实期限取原basis和新profile期限的较早者，不延长原basis。事实批准并不是workflow/trust发布或整轮执行批准。

本次只复用并检查原37项发布合同（合成外部端口），没有新增测试、应用功能或改发布执行器；本地只读入口语法及零调用--check通过。这个结果不替代最终main的准确远端无AWS CI；后者由上述限定GET实际核对后才记录。

只读范围限准确现有foundation五资源、WorkerRole/trust/inline/boundary，和最终clean main的准确无AWS CI、原双workflow/本人environment/main规则/OIDC/未完成caller运行；CI定位和校验计入20次。源码/CI通过后才核对AWS；不读.env、Secret值、PEM/HMAC或S3正文，不连Neon/Aurora，不写AWS/数据库/工作流、不创建Git候选对象或消费执行槽、不dispatch。沿用原readOnly publication I/O，原writer方法被readOnly capability拒绝；失败保留新记录、不自动重试，也不提前要求刷新Source。

准备清单从最终clean main及原件离线生成后冻结main/本地入口，只有其F:/ChatGPT_workshop/techlong-buyer-publication-preflight-20261029-a/prepared-verified.json真实存在并匹配才可请求准确SHA。准备必须仍在真实独立请求观察的5小时内（至今天22:47:13.475 CDT），不是从本地重建时刻重新计时；新metadata的5小时从实际Capture开始，但原数据库观察、请求及basis时间不变。接受既有Source/Git凭据在内存使用、AWS Login自动刷新失败、网络/提供者/审计日志、跨读取非CAS、低额非零费用及失败不自动重试；不接触owner连接或私钥。

准备后才用真正的facts批准和新layout生成原三文件Git对象及唯一trust claim变更清单，仍须另批准确发布SHA。目标reusable commit只能由原prepareObjects的真实ACK/本地对象核验得到；当前不得把旧1120f510…说成新buyer工作流已发布。上段新b236状态优先，以下a00固定坐标和2026-10-28执行只保留历史追溯，禁止重放。

**2026-10-29 buyer兼容附注（代码/测试，不是发布批准）**：原a00来源发布已完成，下方固定值仅为历史默认路径，不能重放。新buyer入口仅在源码中的BUYER_PUBLICATION_SOURCE另行准确选定、真实请求/独立回读及已核验上传版本齐备后选择；目前该常量和BUYER_SOURCE均null。新路径复用原Git/CFN发布和独立Inspect，只把旧四项自引用增加到已明确的六项：原caller source、reusable、activation source及release SHA，加buyer.source.code.commitSha和publication.buyerContextSha256。后两者由前者绑定后计算，不能用外部参数或旧批准覆盖。

原SDK/session/provider/evidence/固定Secret/窄Neon/control/journal及V5执行根保持；new buyer SOURCE与实际SDK端口同一上下文，旧110不改，新增111候选摘要按实际代码另核对。新caller/reusable仍为原两文件和本人环境门禁；云端literal不含本机bundleFile，按准确S3 key/version/SHA取得同一bundle。发布前必须用真正生成的caller/reusable、准确新CI及完整来源证明，不能用模拟测试结果或旧包VersionId填空。

新prestate按本次已核验的真实template/operator/old reusable确定，不再套用下方旧null binding及e658f7… pin。唯一trust claim之外的模板、inline/boundary/RoleId/actor和资源保持；源码选择不是云授权，Capture、上传、请求写、Git push、CFN Create/Execute及整轮仍各按新准确范围另审。原非原子/传播/部分遗留/费用/永久槽风险继续适用；编译历史材料和过期后的独立只读Inspect不延长写入时限。相关代码测试外部SDK响应为明确合成，尚未真实发布或部署。

复用准确新任务 `job_a00fc18c13a5d6c6616c8039`、已独立核验的包VersionId `PCD4J0_Ydp1lpa1BzFeKhDbNIEiUK1HC`、包SHA `e908e74b0de03ae61a2f36bfe1e9f0423ce3850e341a1a3cdf5f9676553b0700`、basis `2cf26916af4f9d8734da18231d2571b23758397c72f1a5566bee5656623d8045` 及ce3a497b…新事实批准。新facts仍固定至2026-10-30 10:08:09.592（温尼伯CDT），不重传包、不改事实时刻或延长旧basis。完整11旧job/14旧plan及原9db成功前驱保持，不把a604 Review升级为成功或accepted lineage。

拟议发布仅更新现有三个文件：

1. `.github/workflows/cloud-worker-platform-job-v6.yml`：沿用原manual caller/reusable结构、App actor、7个输入、环境人工审批、并发组及安装合同；受审SOURCE literal调用已冻结的 `runCycleLive`。
2. `.github/workflows/cloud-worker-platform-v6.yml`：只引用本次真正生成的reusable commit R。
3. `ops/platform-reviewed-cycle-v1/operator-source.mjs`：本机operator绑定同一SOURCE及R。它在冻结云闭包外，工程准备期间为null；原云端 `selection.mjs` 仍null，由受审reusable携带SOURCE，不使用CLI/env/外部JSON选择能力。

云执行/claim/complete/独立Inspect内核不变，冻结源码 `0e18a25e15af64010187c9870be3cfa6433aa5de`、110文件闭包 `0c6f119def3b10efe592f559b29d4d8f929893a28dbc77a065c2746052aa308d`。只按原固定规则绑定caller source、reusable SHA、activation source和release SHA四项自引用；可重建的原七对象包不变，不求解源码自身摘要的循环固定点。

现有 `TechlongSandboxGitHubDeploymentWorkerRole` 的 `job_workflow_ref` 从 `…/cloud-worker-platform-job-v6.yml@e658f7b88ab50b4ff3c5653d46866b859fbadfe1` 改为本次准确R；actor、其他条件、RoleId、inline、boundary v1及所有资源保持。Foundation为原准确UUID `308174f0-ca9e-11f1-a04d-02569e9287b5`，模板原摘要 `5bee8aacbb2cce98e69807f9b21da7f0d033abd41c0cd9b0a146494185bc5c75`。不新增IAM/Secret/Cell，不扩权限。

## 准备与时限

先完成最终源码准确No-AWS CI，再按当轮单独许可CaptureReadiness：最多1次STS＋12次AWS元数据、20次GitHub GET（CI GET计入）。只核对现有角色/基础栈/策略和GitHub门禁/OIDC/现有workflow/main，无Secret值/PEM/.env/SQL或资源写。观测时间保留为本次调用开始时刻，不以后续序列化完成时间重算。

PrepareSaved复用原三文件Git对象准备器：只生成未引用blob/tree/commit及F:/ChatGPT_workshop私有候选，不创建分支、不移动任何ref，不写工作区受保护workflow。原main、refs与protected文件须逐项保持，未来Publish只有一次非强推精确caller commit。

准备快照从真实Capture开始不足5小时；清单为 `min(观测开始+24小时, 已批准新facts固定到期)`，最晚启动保留20分钟。源/准确CI/本机main/pins、真实package proof、观察时间及完整baseline绑定。若材料缺失、Source失效或任何漂移，停止保留原件，不重放失败Capture/写入或倒填时钟。清单生成后冻结main，不能再追加文档提交使其失效。

## 获新SHA批准后才允许的顺序

复用原 `publishAppOnceV6` / `createAppPublicationIo`，不是新增执行器：

- 实时核验同一IAM Source、远端parent、两个既有workflow准确ID/内容、角色/策略/模板、环境人工门禁及OIDC；原五资源与完整prestate匹配后消费固定发布槽。
- 一次非强推精确caller commit（链中含reusable和三个文件），不Run/Re-run或dispatch。
- 一次CreateChangeSet，严格核对准确ARN、模板及仅WorkerRole信任文档的变化，再最多一次ExecuteChangeSet；`DisableRollback=true`。不允许使用其它栈、额外IAM变更或自动重建Change Set。
- 原栈完成后核对完整layout/两个workflow，最多一次本机main快进。
- 新只读实例独立核对准确模板、角色物理身份/策略/门禁、远端main和workflow。只有全部匹配才声称来源发布完成；不意味着部署验收。

写上限为push1/CreateChangeSet1/Execute1/本机快进1，两个固定永久槽（按准确job）不因换清单、源码或输出复位。执行metadata上限沿用原发布器180次AWS/160次GitHub，独立核验最多13/17；均包含原有有限轮询，不是任意范围查询许可。没有Secret值/PEM/数据库、包上传、环境设置写、App签名、dispatch、承载创建或租约续期。

## 完整风险与后继边界

接受：GitHub与AWS非原子、无跨服务CAS、IAM传播及异步CFN；workflow/本机绑定可能先发布而trust未完成，失败可能遗留已发布来源、未完成Change Set或部分信任变化。原旧reusable pin将失去新STS角色访问能力，但这不是撤销已签发STS会话；不自动回滚、删除、补齐、换槽、换任务或重试。精确Git对象仍可被本地并发影响，运行前后仍须重复核验；缺失/未知ACK不得猜测成功。

审批必须接受Source凭据在内存使用和自动刷新失效、网络/提供者/审计日志、Account ID/ARN及部署状态进入已授权Git提交和私有本地原件、禁用失败自动回滚，以及低额但非零费用。50 USD/月只是目标，TTL/标签不自动停止费用；不隐含任何清理授权。

来源绑定安装后本机入口可准备新整轮清单，但不会启动后台worker或自动调度。Review→RunOnce→独立Inspect仍需新的准确整轮SHA；三次GitHub environment都必须用户本人批准，不能由本方案代审、移除门禁或缩减完整历史。后续生产数据库或私密读取不继承本次准备/发布授权。

## 2026-10-28执行记录（只供追溯，不允许重放）

用户确认清单 `42a33afc9a77b42c5bc6237e61788ea5cb2434d9b0b4eac35d2b85d091354e9a` 后，执行源码573bdb5/准确CI40745969505下，push/CreateChangeSet/Execute/本机快进各一次完成；reusable `1120f5106079a006c5e1c455f7de4b70e9732e5b`、caller `5b98b36284be5e06e0cd185be617d66b5fa711ac`。原栈UPDATE_COMPLETE，独立核验 `APP_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH`，RoleId、策略/边界、本人门禁及110云闭包保持。没有私密内容、SQL、dispatch、部署或续租，两永久槽已消费。

私有检查点 `F:/ChatGPT_workshop/techlong-reviewed-cycle-publication-executed-verified-20261028-a.json`（原始字节SHA `812544109e02b2e70715e66ce3044828788498cb00de9ce9178328c22ed58441`）绑定15份真实原件；原准备材料不改写。此记录不批准再次发布、Inspect、包读取或新整轮执行，下一仅按主线准备新的整轮外层SHA。
