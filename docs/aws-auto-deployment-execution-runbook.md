# AWS 自动部署与整套上线执行手册

2026-10-27，America/Winnipeg。本手册将用户已确认的讨论固化为后续工作的执行准则；不是新的生产读取、数据库写入、权限安装、调度、部署或删除许可。未来明确的用户指示可调整主线，但必须先记录调整，不静默扩展范围。

## 1. 唯一主线与完成标准

按以下顺序交付，不以新增模块数量或测试数量代替结果：

1. **整轮真实部署闭环**：准确任务的 Review → RunOnce → 独立 Inspect，资源、服务健康、业务状态及回执一致，失败/未知状态明确且不偷偷重试。
2. **完整产品验收**：客户端、服务端和数据库连通，覆盖所选交付场景的真实业务流程。固定 sandbox、已初始化租户的恢复成功不能替代新租户首次部署、版本更新或完整产品验收。
3. **整套系统 AWS 正式交付**：落实平台/租户应用及最终数据库承载、域名与 HTTPS、登录/支付回调、日志、备份恢复和整体费用。GitHub Actions 沿用已确定的云构建/受控执行方案，不安装本地 Docker Desktop，不用 Sites 上线。

Neon 可继续用于已批准的过渡方案，不因本手册自动迁移；Aurora Express/Full 兼容方案保留。50 USD/月是预算目标，不是硬停费保证，限时验收到期不等于资源已停止计费；实际常驻和清理分别按准确范围审核。

## 2. 当前轮到此收尾

| 事实 | 结论与边界 |
| --- | --- |
| Review `40607422851` | GitHub completed/success；仅两份固定版本结果/manifest的SHA核对通过，未重建完整Review证明、未写后继账本 |
| 原窗口 | 温尼伯10月27日19:16:17生成；claimBy 19:31:17；保留8分钟执行及2分钟发布启动预留，最晚衔接19:21:17；原时间不改 |
| 后继处理 | 因窗口不足停止，未读取配置/连接Neon做后继准备，未发布或调度RunOnce；旧Review槽保留占用，不重跑 |
| 最小连续衔接修复 | 提交 `b4fc2dfdef9b3a2de010dfeb7b01cdfd4c53f5f2` 已推送main；76项本机相关测试、类型/lint及[准确CI40610066977](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40610066977)通过 |
| 修复实际能力 | 新的预先外层SHA批准后，可单次调度Review，等待本人GitHub批准，再同进程核验并执行原三写与独立回读；**不自动调度RunOnce，不复活旧周期** |
| 本次手册收尾 | 只整理准则、状态和证据索引；不再追加运行时功能、离线模拟或生产操作 |

历史原件继续保存在本地私有目录，不复制业务正文/私密值到Git：

- 停止证明：`F:/ChatGPT_workshop/techlong-a604-review-timing-stopped-verified-20261027-a.json`，原始字节SHA `64609e78be6c76bd5f70e98380692263c6b6fa793c08c925955adc34f721a5ff`。
- 代码验证：`F:/ChatGPT_workshop/techlong-a604-continuous-review-code-verified-20261027-a.json`，原始字节SHA `753ec16ae096f10d9615e7928dfe9dbb733d5870f1f66f145448c2a00638fe1c`。
- [连续衔接实现、预算及完整风险](aws-auto-deployment-a604-continuous-review.md)。旧失败、原件和全部永久槽保留，文档归档不代表删除、撤权或云资源清理。

## 3. 当前唯一继续点：整轮真实部署闭环已完成，转向产品验收与AWS交付

**当前仅收尾一个旧CI测试兼容修复，不扩展发布支线。** 用户已明确同意只改 `tests/platform-recovery-cloud-v1.test.mjs`、必要文档并验证CI，撤回此前“太长就删除”的指令；不删除任何历史、资源或分支。原第186行强制当前来源等于旧a00模板，且硬接恢复信封校验/renderer，会拒绝新的b236/buyer来源。现在只在该测试中识别原生buyer协议，调用原六项绑定/来源事实校验，并用原基础workflow重建准确全文；旧历史发布断言和最终两个文件的逐字节比较全部保留。仅新增一个合成元数据回归，验证native路径及篡改事实期限拒绝，不改运行代码、权限或执行器。

18项该文件检查及37项相邻发布回归均已通过（共55项），类型与该文件零警告lint通过；旧110/111摘要保持0c6f119d…/52ae2ee3…。准确CI只按实际结果封存。恢复读F:/ChatGPT_workshop/techlong-buyer-legacy-source-test-fix-verified-20261029-a.json；**文件未真实生成或不匹配时不能声称准确CI通过**。本次用户授权允许仅为这个测试/文档更新一次main；最终提交后重新冻结，不再追加文档使准确CI失效。旧658feef/CI40971833829及AWS读取仍保留为历史，不能冒称新HEAD已经核对。

原事实绑定及限定只读已实际通过：检查点F:/ChatGPT_workshop/techlong-buyer-publication-preflight-20261029-a/capture/verified.json（raw SHA 0f2fe0e4d8d6010ab11ecacb6abadcc6fefda96e3aa1e29d5275a3cdf7e55773），实际STS1/其他AWS元数据9/GitHub15、无云写/配置/数据库读取；本地facts批准SHA27672b25…保持。只复用18:18 CDT实际AWS快照，不重计时间或重读；本次CI/main/双工作流核验最多6次GitHub GET，不调用AWS或Neon。准确CI完成即结束本测试修复，回到原三文件/单项trust发布清单准备；尚不生成或执行云变更，不重建请求/上传或开窗口。需要运行代码修改即停止另问，不借此扩功能。

**最新完成（10月29日17:47–17:48 CDT）：请求登记＋材料上传已按a8393ad2…实际执行并独立核验成功。** 来源cc52401，准确COMMIT后新b236为pending/attempt0/max1、永久审核挂起、lease为空；独立TLS回读证明12条旧任务、17/12/12账本及业务/保护完全保持。原私有桶615808字节条件PUT1及固定版本GET1通过，真实VersionId ywA1SETga2C.2JIxiHXvTcLbXimP0n_4，bundle SHA f01f9489…。实际配置2/TLS2/SQL72/STS3/桶元数据6/HEAD2；IAM/工作流/秘密值/HMAC/PEM/DDB项/Aurora/续租/dispatch/承载/重试/清理均0。[去敏完成记录](../ops/aws-sandbox/reviews/backend-integration-v1.request-upload-observed.json)。

恢复F:/ChatGPT_workshop/techlong-buyer-request-upload-executed-verified-20261029-a.json，raw SHA 4af3c72085a367a601120646fc4832315bd43946252be311585ab5d6df534a30；23份原件已本地重建，四个永久槽已消费，不再RunReviewed、重新登记/上传或复位。首次工具因额度无法完成自动审批而明确未启动；用户要求继续后核对全部槽/目录空缺，才唯一实际执行，未绕过审批。独立复核后本次来源冻结结束，允许正常记录结果，不重放已批准命令。

**本轮来源材料已用真实请求/版本重建，下一只等待[本地事实绑定＋原发布前限定只读](aws-auto-deployment-reviewed-cycle-source-publication.md#固定复用与最小差异)的准确准备SHA确认。** cycle d1fdfd0e…/profile f9319902…经原编译器/完整历史投影校验，本地SOURCE仍UNPUBLISHED、factsApproval及新Git引用为null；不把a839上传许可变成来源许可。[去敏候选摘要](../ops/aws-sandbox/reviews/backend-integration-v1.publication-material-20261029.json)只存索引，完整原件在F:/ChatGPT_workshop/techlong-buyer-publication-material-20261029-b/result.json（raw SHA f49a8945a82d28642051546d83a52714e18caa7f7af28b227574087adfcc816b）。无生产/私密读取、Git候选对象、执行槽或应用代码改动。

新准备组合仅显式批准原basis内的本地事实绑定，以及STS1/元数据12/GitHub20的现有worker/foundation/准确CI/双workflow/本人门禁/OIDC读取；配置/私钥/Secret/S3正文/数据库/云写/来源选择/dispatch均0。准确清单以F:/ChatGPT_workshop/techlong-buyer-publication-preflight-20261029-a/prepared-verified.json真实生成并匹配为准，生成后冻结main/入口；这不是发布或部署批准。随后才按真正facts/新layout准备原三文件及唯一trust pin发布的另审SHA，不重复请求/上传或扩框架。原basis明天10:08:09.592 CDT保持；后继整轮及三次本人GitHub审批另审，wholeProductAccepted=false。下方“待批准/尚无请求和VersionId”仅为本次完成前沿革，不是重复执行指令。

**本次获同意的两处代码接线及准确无AWS CI已完成**：源码cfb1408/[CI40940078691](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40940078691) completed/success，16报告步骤全过。三处既有源码接入buyer真实SDK端口和原发布器SOURCE/template/prestate选择；默认BUYER_SOURCE/BUYER_PUBLICATION_SOURCE仍null，旧110与默认恢复保持。本机57定向/122相关检查（重叠）、类型/lint和--check通过；外部SDK响应为明确合成，不是生产验收。111现为52ae2ee3…。恢复F:/ChatGPT_workshop/techlong-buyer-sdk-publication-wiring-code-verified-20261029-a.json，raw SHA 84cb3a8627dffaa50047e45d9259276afa1b87b83f3a86e3df6e821f66d8db42；旧材料和失败记录保留，不重跑代码或补件。

**最新只读阶段已完成（10月29日14:39–14:41 CDT）**：另获用户限定许可后，新d记录完成STS1/AWS元数据64/GitHub9/配置1/验证TLS1/只读SQL16；完整12任务及17/12/12账本、业务/保护摘要未变，候选b236及去重键不存在，准确拟上传键HEAD404，角色/策略/三Secret固定版本元数据及本人门禁匹配。独立本地核验和原单INSERT重新投影通过，未写业务或云资源；[公开去敏摘要](../ops/aws-sandbox/reviews/backend-integration-v1.readiness-20261029-d.json)不含业务正文。恢复F:/ChatGPT_workshop/techlong-buyer-backend-readiness-20261029-d/verified.json，raw SHA 0aa14e355472379e04400d1a47f77e7972ade773cbf094303faa41b280befe55。

**本轮下一步已收拢为[同一b236请求登记/独立回读及准确材料上传的审核范围](aws-backend-integration-request-upload-review.md)**：原请求CLI是两行handoff，不用于全终态历史；固定本地配方仅编排原单INSERT/TLS读取器和原条件PUT/版本GET，不新增工程应用代码或云执行根。17项合成客户端检查通过，真实配置/数据库/AWS读取写入及槽仍0。本页及普通文档提交不是执行批准；精确SHA只以F:/ChatGPT_workshop/techlong-buyer-request-upload-20261029-a/prepared-verified.json真实生成并匹配为准。生成后冻结main/配方，下一只请求该SHA批准，不再生产读取或加功能。

新准备事实仅至今天10月29日19:39:51.491 CDT（UTC次日00:39:51.491）；本次清单最长24小时且不超过原basis明天10:08:09.592 CDT，最晚启动保留15分钟至明天09:53:09.592 CDT。执行仍实时核验完整数据库/目标桶，失败或未知停止更多写；真实请求、上传VersionId和发布回执仍null，两个源码选择仍null。请求/上传成功后才准备原双workflow/SOURCE/唯一trust pin及整轮，不开短窗口、不重复代码/补件或新增框架。以下旧快照期限及“先读取”的记录仅为沿革，不能重放；后续纯文档HEAD不是上述CI源码。

**用户现已同意仅实施下述两处最小接线与定向测试。** 本轮范围为现有buyer SDK装配、publication/publication-local来源选择及对应测试/文档；保留旧110和默认恢复路径。不读取生产、私密配置或凭据，不执行发布/部署/调度；正常代码提交及无AWS CI按既有授权继续。下方“先取得同意”是本次批准前的停止记录，不重复征求同一代码范围。

**最新13:36 CDT（10月29日）：固定provider原件已另批补齐，真实buyer后继链和来源材料已本地重建，仍不可执行。** 新记录仅STS1＋准确版本S3 GET1/1703字节，版本/完整大小/SHA全部匹配；54原件、11固定对象和原basis重建通过。完整报告用已有`providerPublicV5`投影后经原后继链校验通过，未改原件、旧110或应用代码；本地B格式停止和旧STS失败均保留，无云重试。原b236请求身份保持，仅本地SQL编译，未创建/占槽/上传/发布/调度。[真实材料、缺口及下一范围](aws-backend-integration-preparation.md#固定原件及真实buyer材料已重建10月29日1336-cdt)。恢复F:/ChatGPT_workshop/techlong-buyer-real-material-verified-20261029-a.json，raw SHA 16b1a0dff9deed74ee41d0a1e880fb7e412c6d675527bc3f13e4e2a68a9b9fb2。

**发布候选差异核对现已完成，但生产装配证明未通过，不能生成可执行发布SHA。** 原双workflow、六项SOURCE派生及唯一trust claim的本地差异已核对；旧live仍调用固定恢复application，原publication/local仍固定旧周期/信封/before hash，不能直接拿buyer材料发布。恢复F:/ChatGPT_workshop/techlong-buyer-publication-candidate-verified-20261029-a.json，raw SHA 95ada491ca4658d480f9f72d0132f7d97a2a37e8880fc5d375502b8e80150ea1。本轮生产调用、私密读取、应用代码/受保护workflow/IAM改动、Git候选对象、槽和dispatch均0。

**下一唯一动作先取得仅两处既有入口最小接线及定向测试的同意**：在现有buyer模块装配原SDK/窄数据库/provider/evidence能力，以及在原publication/local选择真实buyer SOURCE/模板/prestate；限三处现有源码加对应测试，旧110/默认路径、权限和执行根不改，不建执行器/框架。[具体差异与停止条件](aws-backend-integration-preparation.md#发布候选差异与两处最小接线缺口)。真实请求/独立回读、上传VersionId、事实批准及发布证明仍为空；具体生产读取/写入继续另审。09:07事实仍只至今天14:07:12.204 CDT、原basis至10月30日10:08:09.592 CDT，不重计或先开窗。以下为已完成沿革，不是重复执行指令。

**最新08:37 CDT（10月29日）：buyer自定义域名安装及独立静态验收已通过，下一只准备新的合法后端请求/准确buyer CORS材料、必要来源绑定和Review→RunOnce→独立Inspect的集中范围。** [完整结果](aws-buyer-web-domain-install-observed.md)。实际STS3/AWS元数据53/公开DNS4/HTTPS2/直接写3，原六物理ID/IAM模板保持；证书ISSUED、原栈UPDATE_COMPLETE、CDN Deployed，CNAME/A/AAAA与两条静态HTTPS200/TLS均匹配。无私密读取、SQL、IAM写、上传、dispatch、后端或代理重试/清理；未执行JS/业务，wholeProductAccepted=false。

恢复读F:/ChatGPT_workshop/techlong-buyer-domain-install-20261029-a/executed-verified.json，raw SHA bf5a03fc9687e67084acff917c8eb8b980eb6844bde20d00e3ae9b977dff52f7；149原件已本地重建，永久槽消费，独立验收/重建后main结束冻结。不再按下方历史待审段申请证书、写DNS或执行原Change Set，不重发前端/HMAC。后端/Neon旧事实已过期，新的必要读取、请求/材料/来源与云部署仍准确另审，不先开短窗口、不重放旧成功任务或已删栈UUID。

**当前后端事实准备已完成（10月29日09:07–09:08 CDT）**：用户另允官方STS诊断成功后，c记录取得STS1/AWS元数据57/GitHub9/配置1/验证TLS1/SQL15；角色/策略/固定Secret版本和完整12任务/17/12/12账本、业务/保护均匹配，无活跃任务/lease。写/任务/槽/Secret值/PEM/HMAC/DDB项/dispatch均0，a/b失败保留不重跑，也不倒推其原因。恢复F:/ChatGPT_workshop/techlong-backend-integration-readiness-20261029-c/verified.json，raw SHA 0febbdba1fd957cb1d24a5f88d0b03d2b6e4536d6430d32125cc9fe449b95eeb；仅5小时准备至今天14:07:12.204 CDT，不是新执行/TTL批准。

下一只做[既有单INSERT请求与精确buyer CORS材料/SOURCE的最小兼容接线和定向测试](aws-backend-integration-preparation.md)。旧110闭包、原历史body/pin保持；新body仅增buyer一来源。实际V5 Review/模板重建和云端绑定必须通过、默认仍关闭，不能只测字符串后声称已接通。未通过准确CI前，不创建任务或新建运行时/通用框架；必要材料/来源/trust、请求及整轮实际副作用后继集中另审，不先开短窗口。

该项现已编码为原目录内单个buyer组合候选：复用原单INSERT、genuine恢复锚/accepted后继链、V5根与V6 mode bridge；35项定向检查通过，完整模板/七资源不变，旧110/body/pin保持，新增文件另计111闭包，默认SOURCE仍null。只提交无AWS CI，不更新线上旧recovery-envelope/v1绑定。准确CI通过后下一只准备真实原件支撑的请求/后继链/准确buyer材料与必要发布组合差异；先证明原发布/整轮可承载，不把合成Review当已发布或整轮通过，不复制执行器、不提前开窗。详见同一[准备文档的当前候选与未完成项](aws-backend-integration-preparation.md)。

**该代码阶段已收尾**：ed4d15d/准确[CI40894623180](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40894623180)成功，16报告步骤全部通过；本机35定向＋81旧回归及类型/lint通过。恢复F:/ChatGPT_workshop/techlong-buyer-compatibility-code-verified-20261029-a.json，raw SHA 9beba5a3bd1fa7954df2ebc68935b81843669e9ad739d5524ac6ce8b69e67254。下一只按上段准备真实请求/后继链/材料与必要发布组合，不重复代码阶段或先做生产读取/任务写；本轮生产调用/私密读取/槽/调度为0，旧事实期限不重计。

**集中草案与No-Go已核实（09:57 CDT）**：54封存原件/11固定对象记录及原basis已本地核对，新单INSERT和准确buyer body草案已编译，候选b236只是私有草案、未创建或占槽。旧package仍要求取消handoff，原发布/整轮/云运输仍固定恢复信封；即使换原native publisher也会读取旧capsule，不能直接发布111候选。下一唯一代码动作只修原发布/整轮组合接线，不新建执行器或改旧110；[准确差异与集中范围草案](aws-backend-integration-preparation.md)。唯一缺失provider原件的另批补件在10:03官方STS尝试1/CLI255停止，GET0/其他读写槽0，原因未知、不重跑或盲刷，必要时重新准确另批。恢复F:/ChatGPT_workshop/techlong-buyer-backend-material-prepared-20261029-a.json，raw SHA a362f39693f14d80d8f59fa788b0aa8b986f179fa16c02e0dd13b8f555a40223；准备14:07:12.204、原basis明日10:08:09.592均不延期，无部署SHA/新任务/窗口。

该组合缺口已按同一[准备文档的代码阶段](aws-backend-integration-preparation.md)修复并准确收尾：4a62d74/[CI40926305909](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40926305909)成功、16报告步骤全过；genuine buyer能力接入原publisher/continuous/whole/capture与本地SOURCE选择，原两次三写、完整历史核验和独立Inspect保持。46定向＋81旧回归及类型/lint通过，旧110不动，没有新执行器/运行框架或生产操作；当前111闭包caeca1f9…。新原生manifest不伪装成旧信封；SOURCE保留原四项并额外明确派生buyer code/context hash两项，未来须新SHA审。恢复F:/ChatGPT_workshop/techlong-buyer-publication-composition-code-verified-20261029-a.json，raw SHA 1d75807adc81ba7a9c50b9ca228410f2b62ac576afbc5e96d0644208b2768512。下一只补齐已知固定原件、重建真实来源并集中准备原双workflow/trust候选，不重复代码阶段；生产装配未发布、缺件/CLI255不重试、旧期限不延长，不把组合测试当已部署。

用户批准外层913ea70a…并本人完成三次环境审批后，同一a00任务已连续完成Review40751073822、RunOnce40751515012和独立Inspect40752434574，最终 `WHOLE_CYCLE_INDEPENDENTLY_VERIFIED`。执行源码284f6ad/准确CI40748831700；一次CreateStack/受审7资源、两次认证GET、同任务成功及租约清空，旧11job/14旧plan/9批准/9尝试及保护保持。Inspect没有云写、DB写或控制私密包读取；没有自动重试、清理、新IAM或agent代批。[完整实测与次数](aws-auto-deployment-reviewed-cycle-observed.md)。

恢复先读 `F:/ChatGPT_workshop/techlong-reviewed-cycle-whole-executed-verified-20261028-a.json`（原始字节SHA `51d1896f6075d07646ce62d3d2f350d99754a5c5ad13cdead6a470b002f94359`），其54原件和最终proof已本地重建核对，7个永久槽已消费，不再RunReviewed或重做来源/包/任务。最终证明未额外导入Inspect账本，wholeProductAccepted=false，不为页面标签扩UI支线。

下一只准备现有客户端、服务端、租户数据库的有限真实业务验收和整套AWS交付，明确具体场景与读取/登录/业务写范围；不继续扩部署基础设施。工作负载意图为今天10月28日16:06:01（温尼伯），不是自动停费/销毁；当前资源可能持续计费，清理按准确资源另审。若恢复时已过期，先另审现状/清理，不自动延期、重新部署或假设费用已停止。

产品阶段的[当前最小继续点与副作用边界](aws-product-acceptance.md)：客户端源码3ad0ea8仅对齐两workflow三处SDK pin，准确CI40755064679全部通过、deploy跳过。随后用户允许的限定核对已确认租户revision9/运行1、health/ready均200；仓库配置的旧S3/CloudFront分别NoSuchBucket/NoSuchDistribution，API仍指向旧api.techlong.cloud，不是本次sandbox。检查点 `F:/ChatGPT_workshop/techlong-product-online-check-verified-20261028-a.json`（原始字节SHA `3258c70b983e0354e4e15eac50327eaa9de77ab0923cf24195ae62894976187a`），实际预算占用GitHub10/STS1/AWS元数据7/无身份HTTP2，无写或私密读取。对应最小独立sandbox买家Web承载/发布及准确API/CORS/输入来源候选现已按下述完成，真实变更另审；不自动重建旧目标、不续窗口或重做租户部署，也不将会写访问租约的买家页面当纯只读。

上述候选现已完成，[六资源模板、准确差异、门禁/私密边界和费用](aws-buyer-web-sandbox-plan.md)均为DRAFT_NOT_EXECUTABLE。本次另允元数据实用GitHub9/STS1/AWS11，无写或私密值读取，发现旧production无required reviewers、旧publisher只信任production且绑定已删目标、revision9的准确CORS尚未允许新来源。对应现有客户端workflow的sandbox选择/独立Secret名称/无delete适配已按下方完成；仍不安装六资源、新环境或HMAC，不续旧窗口、不扩部署控制面。

恢复先读 `F:/ChatGPT_workshop/techlong-buyer-web-candidate-verified-20261028-a.json`（原始字节SHA `aca73213e1aac68293c5f4fae43b1df752a6aa91eab6eb3c443d19f0cee70ce7`）；10组本地候选检查/162链接已通过，没有AWS模板验证或安装。18:23恢复时原窗口已过期，只做本地收尾，不重跑已用元数据许可，不假设停费或当前健康。

最新代码阶段已收尾：客户端602e543/准确CI40789471388全部通过，23项本机定向测试和原production10步投影保持，deploy skipped；只复用原workflow接入sandbox、独立Secret/no-delete和900秒账号限定认证，没有AWS调用、Secret值、GitHub设置或dispatch。恢复读 `F:/ChatGPT_workshop/techlong-buyer-web-workflow-code-verified-20261028-a.json`（原始字节SHA `2a2febf19e922faae7b1906490069479debcf9edf9d239f9133eef1139e62a63`）。代码成功不是已安装发布门禁、客户端上线或整套验收。

**最新事实与唯一继续点（10月28日18:54限定只读核对后）：原租户栈已DELETE_COMPLETE、ECS INACTIVE/运行0，health/ready均404。** 根事件16:08:39开始删除、16:16:37完成；通用“User Initiated”不能确定操作者，本轮未删除资源或查询CloudTrail。不能再UpdateStack旧UUID/CORS、重放a00任务或用14:41健康替代现状；原整轮成功保留为历史事实，整体费用未核清，不宣称停费。

本轮另允读取实际为GitHub9/STS1/AWS元数据16（含一次ValidateTemplate）/无身份GET2，云/配置写、私密值、数据库、续租和dispatch均0。模板AWS验证通过；新role/policy/stack不存在，OAC名称无冲突，桶HEAD404不保证全球可用；新environment404，未创建。

**前端承载与本人门禁已真实安装通过**：用户随后确认[清单](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.bootstrap-execution.json) SHA `e66544260e91a60af62e7275dd69522e406c27aa70f1a5ebb033b066b02570ae`，19:19:28–19:24:25执行两次GitHub配置写，独立证明门禁后一次CreateStack/六项前端资源；最终原模板、UUID/资源/策略/输出与门禁均独立核验通过。新栈UUID71751190…，CloudFront EDJYJUKAZ12BO；新窄IAM持久保留，不是临时Grant。实际GitHub GET11/配置写2、STS2/AWS元数据32（9次观察）/CreateStack1，私密值、DB、发布/dispatch、后端/CORS/TTL、重试及清理均0。[完整实测及后继边界](aws-buyer-web-sandbox-bootstrap-observed.md)。

恢复先读 `F:/ChatGPT_workshop/techlong-buyer-web-bootstrap-20261028-a/executed-verified.json`（raw SHA `6b174ae265ac4b2d9dda45ebcf5002d267654912b28a824d51df510fd1ee69fc`），绑定9原件；48条提供者调用与本地证据已重建核对。永久标记已消费，不再运行安装脚本/CreateStack、不重跑准备器或复位标记，原PENDING准备材料保持不改写。原后端16:06意图不延长，整套仍未验收。

以下为**已完成的客户端准备与发布沿革**，不再作为待办：新CDN来源为https://d3a0kml1xanzgt.cloudfront.net；准备范围、私密使用和单次发布均另按下方准确批准执行，没有新增运行器或固定任务代码分支。当前唯一继续点见下方真实完成记录后的后端联调/CORS准备，不重复开客户端窗口。

[最小发布准备表](aws-buyer-web-sandbox-publication-plan.md)与原机器草案保留。用户另允的新元数据核对已于19:46:35–19:47:02完成，实用STS1/AWS元数据16/GitHub GET17；承载/IAM/门禁和602e543/CI匹配，五变量为空、目标Secret不存在，两个公有变量摘要匹配、无冲突发布运行，固定runtime版本仍AWSCURRENT，旧准确backend UUID仍DELETE_COMPLETE。私密值、DB、配置/云写、dispatch及执行槽消费均0。

**客户端真实静态发布及独立核验已完成**：用户随后确认[清单](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.publication-execution.json) SHA `abf867cc61e01a9450763aec66fa7c5e27236b71967c5e39f966a0f73067ace7`，本人批准准确run40799958045环境，20:21:09–20:26:05完成五变量/一个环境Secret及单次sandbox发布；326对象/51,149,344字节，准确invalidation Completed、三份静态文件200且ETag/大小与S3相符。源码602e543不变，production步骤全部跳过；未执行JS或调用API/DB/后端/CORS/TTL，没有新基础设施/IAM、重试或清理。[完整实测](aws-buyer-web-sandbox-publication-observed.md)。

恢复先读 `F:/ChatGPT_workshop/techlong-buyer-web-publication-20261028-a/executed-verified.json`（raw SHA `379c64cbe93ff4fd7fd824476c4da791f1e001f8c7aa419c5ce826c950e4be80`），绑定10原件，72条提供者记录已本地重建核对。实际GitHub GET35/写7、Source STS3/AWS元数据23/固定版本秘密GET1、静态HTTPS3；不是云端上传内部API次数。Secret/密文正文未保存，HMAC按已接受设计进入公开JS可被提取，持久配置/Secret/IAM和对象版本保留；不自动撤权或清理。永久标记已消费，不再运行发布脚本、重读秘密或dispatch，原PENDING/准备材料保留，不restamp或复位。

**当前唯一动作：准备新的真实后端联调/CORS与有限业务验收窗口。** 复用现有请求/Review→RunOnce→Inspect能力、镜像/数据库和已发布客户端；先核对新合法请求/来源/期限及当前资源，实际读取/恢复/业务写仍准确另审。不更新已删旧UUID、不重放已消费job，不再改前端、扩执行器/探针/UI或复制固定任务代码分支；旧backend意图未延长、wholeProductAccepted=false。

[本轮后端准备与停止点](aws-backend-integration-preparation.md)已记录：旧两项CORS固定在capsule哈希/冻结源码中，需受审地只追加真实CloudFront来源，不能绕过参数校验或改旧pin；原部署代码/材料/工作流未改，候选差异哈希不是执行批准。20:39的Source失败A原件保留，未重放。

Source刷新及新同范围许可后，20:56–20:59的B记录取得AWS/GitHub部分事实：旧UUID删除、同名栈不存在、ECS空闲，原镜像/固定Secret版本和本人门禁保持；文档提交未触发CI，只核对未变运行时代码对应的成功CI40748831700，不冒称当前HEAD跑过。累计STS1/AWS57/GitHub9/配置1/TLS1/SQL4，持久写/秘密值/槽/调度0。Neon在身份/只读/数据库侧TLS组合检查停止并回滚，未取得业务/保护快照，不能生成执行SHA。原B停止及未用额度继续记录均保留，后者raw SHA f60aa42991df400518a698fbc498ca717c9ccd6f19d8827c0a919128fce134c4，路径 F:/ChatGPT_workshop/techlong-backend-integration-readiness-20261028-b-continuation/result.json。原准备期限10月29日01:56:03 CDT不重计。

**数据库补核已完成（23:29 CDT）**：用户确认下一步后，独立C记录配置1/TLS1/SQL15、AWS/GitHub及持久写均0。客户端TLSv1.3/证书验证及身份/只读全部匹配，本次唯一诊断差异为数据库侧TLS视图false；沿用原显式证书及完整catalog/准入/保护校验，没有改线上或降低身份/证书要求。12任务、17/12/12完整账本、deployment/admission及保护与上一轮封存Inspect snapshot逐字段完全一致，任务均终态/lease清空；纯投影可准备新held请求，但未编译或提交写入。

恢复读 F:/ChatGPT_workshop/techlong-backend-integration-database-supplement-20261028-c/verified.json，raw SHA 21ac8c94e8cb851564e4923f6d4d81627a0a90ee113a2e92e84b6fa4bfefaae8；业务正文只在本地，原A/B不覆盖，AWS/GitHub原准备期限10月29日01:56:03 CDT不延长。

**用户已明确调整当前方向：先准备给已部署CDN绑定buyer.sandbox.techlong.cloud的方案。** 本地实际V5 Review测试发现除capsule固定哈希外，parameters.ts还强制CORS为techlong.cloud域内；直接追加cloudfront.net仍被拒绝，不能宣称最小接线已接通。未接通原型已撤回，没有改旧110文件内核、放宽校验或发布源码。新边界及既有单INSERT请求19项定向回归通过，已加入原无AWS CI，不新增部署工作流。

**当前唯一继续点：完成[自定义域名候选](aws-buyer-web-custom-domain-plan.md)的准确CDN/证书/DNS差异、测试与待审材料。** 本地候选和原请求合计23项检查已通过，精确CI结果另据真实run封存。当前不批准ACM申请、DNS/CDN写入、新IAM或后端部署，不为绕过校验创建新执行器。复用原CDN/桶/角色、原请求编译器及7资源后端，后继CORS只追加准确buyer域名；新合法请求/材料/来源发布与整轮执行仍集中准备并另审，不取消成功a00、不走旧pending两行handoff或复制固定任务分支。

该候选源码aad23fa/准确CI40820296477全部成功；23项定向检查、类型/lint/YAML及原110闭包保持。代码检查点F:/ChatGPT_workshop/techlong-buyer-domain-code-verified-20261028-a.json保留，不当云安装证明。用户随后允许本轮域名元数据预检，于10月29日00:05–00:06 CDT实用STS1/AWS11、零写/秘密值/SQL/GitHub/执行槽；原模板一致、CDN Deployed无alias、准确buyer DNS空、没有可覆盖buyer的现有证书。IPv6字段映射造成的本地停止原件保留，只用未用额度继续，没有重发已获AWS返回，不改真实采样时间。公开事实见[预检摘要](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-preflight.json)。

**证书单写及独立回读已完成（10月29日00:28 CDT）**：用户确认8b2a6ab9…后，仅一次RequestCertificate，准确ARN68a43688…及唯一buyer域名/DNS/RSA2048/不可导出/六标签均通过，实际CNAME已返回，状态PENDING_VALIDATION。实际STS2/AWS元数据5/申请1，DNS/CDN/CFN/IAM、私密读取/SQL/调度/后端/重试均0。[结果和完整边界](aws-buyer-web-certificate-observed.md)。恢复读F:/ChatGPT_workshop/techlong-buyer-domain-certificate-20261029-a/executed-verified.json，raw SHA 66f44538329211818525cb446f401d0fe160e0395d7a1b7dbf1eaa7ecd7f996f；26份原件已本地重建，永久槽已消费，不重新申请/回读、复位或改写原准备记录。独立核验与重建后main结束冻结，仅正常记录结果。

**下一唯一动作：准备准确验证CNAME、证书签发等待及现有CDN栈更新的集中审批清单。** 复用原CDN/桶/角色，不扩IAM、不重发客户端；实际新鲜读取和DNS/CDN/CFN写仍另审，不自动进入后端恢复。原00:05:04.864至05:05:04.864 CDT准备期限不重计，PENDING_VALIDATION不是域名可用或产品验收，wholeProductAccepted=false。

10月29日早间仅展开[集中草案](aws-buyer-web-domain-install-review.md)：完整八资源模板等于原已测试差异、验证批次仅CREATE真实CNAME，25项定向检查及类型/lint/YAML/177相对链接/旧110闭包通过，不新增执行器。准确源码d869f47/CI40875734305全部成功；代码检查点F:/ChatGPT_workshop/techlong-buyer-domain-install-code-verified-20261029-a.json，raw SHA 306390108b9ac4aa5c9f6604833ba5fb2c18aa7c84fd148badbf93637ab9efbd。当前只等本轮限定只读许可，实际GitHub GET4、AWS/公开DNS/私密读取/SQL/云写/槽/dispatch均0；新事实真实通过后才生成5小时审批SHA，不重申证书或复用凌晨快照。

该新许可已由用户确认，07:57主快照及08:07:17原剩余额度一次验证名补核完成：累计STS1/AWS元数据14/公共DNS2，补查从A类型起覆盖验证名全部类型，不重发原调用或重计原事实时间。原栈/六资源/模板、空Change Set、CDN/证书/标签和DNS空缺均匹配，两公共递归NS与zone一致，完整候选模板AWS验证成功；写/私密/SQL/槽/dispatch均0。只读检查点F:/ChatGPT_workshop/techlong-buyer-domain-install-readonly-20261029-a/verified-with-validation-name.json，raw SHA 02650c15d096cf5de702258852329ab00f5aed493077bf184154f994b01b760f，38原件已本地重建；不冒称全局alias或权威父区逐跳已证明。**下一只等[集中范围](aws-buyer-web-domain-install-review.md)的新SHA确认**，准确原件F:/ChatGPT_workshop/techlong-buyer-domain-install-20261029-a/prepared-verified.json未生成/不匹配即未准备完成。原事实至12:57:00.563 CDT、最晚12:12:00.563启动，main在清单真实生成后冻结；不先写DNS、CFN、恢复后端或占永久槽。

### 本轮旧测试与整轮准备历史（保留，不重复执行）

发布后CI40747653765的旧来源比较问题已仅在 `tests/platform-recovery-cloud-v1.test.mjs` 最小修复：保留历史发布SHA/a604 provenance，再识别已安装reviewed-cycle SOURCE、准确模板与原observedBy，完整比较workflow全文、reusable pin和本人门禁。352项相关本机回归、类型/lint/diff与110闭包核验通过；不改线上workflow/云代码/IAM、不重做发布，本轮生产调用/私密读取/SQL/云写/dispatch均0。原失败诊断 `F:/ChatGPT_workshop/techlong-reviewed-cycle-publication-post-ci-20261028-a.json` 保留；准确源码/CI只在真实成功后封存 `F:/ChatGPT_workshop/techlong-reviewed-cycle-legacy-test-fix-verified-20261028-a.json`，未封存前先查同一提交CI，不开始生产准备。

用户批准42a33afc…后，现有双workflow/SOURCE绑定和角色一项trust pin已发布，独立核验为 `APP_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH`，原栈UPDATE_COMPLETE；原权限/RoleId/门禁/110云闭包不变，没有调度或部署。reusable为1120f510…，caller为5b98b362…。执行源码573bdb5的准确CI40745969505全部15步骤通过，实际push/Create/Execute/快进各1，writer AWS元数据含STS53/GitHub43＋CI3、独立10/11；私密内容、SQL、包上传、承载或租约变更均0。

恢复先读 `F:/ChatGPT_workshop/techlong-reviewed-cycle-publication-executed-verified-20261028-a.json`（原始字节SHA `812544109e02b2e70715e66ce3044828788498cb00de9ce9178328c22ed58441`）；15原件及完整reconcile已核对，两发布槽永久消费，不再Publish/Inspect或改写准备记录。完成后main冻结已结束，仅正常记录结果，不重新发布工作流。

下一只按已安装整轮入口准备同一a00任务的外层SHA：先准确CI，再另征当轮必要只读范围，用真实状态集中绑定Review→RunOnce→独立Inspect的材料、累计副作用、期限及三次本人GitHub审批。当前不读配置/私钥/Secret值、不连生产数据库、不调度或部署，不新增接线/身份/任务或重传包。原facts10月30日10:08:09.592到期不延长；来源发布不能替代真实整轮验收，最终通过后立即转向产品与AWS交付。

### 本轮来源发布准备历史（保留，不重复执行）

来源发布的最小接线已完成：原Git三文件对象准备器仅增加SOURCE能力复用，原Git/CFN发布器不变；新本机operator绑定在110云闭包外，云端默认selection仍null，受审reusable携带准确SOURCE和原四项自引用规则。新旧相关115项检查（新周期73＋旧发布42、含15新增）和类型/lint通过；冻结0e18a25内核、包原件与角色/权限均未改变。[完整发布范围与风险](aws-auto-deployment-reviewed-cycle-source-publication.md)。

用户已允许准确CI通过后一次限定核对（1STS＋12AWS元数据＋20GitHub GET），不读私密配置/Secret/PEM、不连数据库或写资源。恢复先读 `F:/ChatGPT_workshop/techlong-reviewed-cycle-publication-20261028-ready-a/prepared-verified.json`；它只在该次真实Capture及Prepare成功后生成。不存在时检查准确CI/readonly-a原件及是否已用许可，不自动重新Capture。准备只创建未引用Git对象/私有候选，不改受保护workflow、refs或分支。

新的metadata观测从Capture真正开始计时，准备5小时、审批24小时及20分钟执行预留仍受固定10月30日10:08:09.592（温尼伯）facts到期约束，不restamp或延长旧窗口。生成准确清单后main冻结，下一只请求用户确认新SHA；实际一次push/CreateChangeSet/Execute及独立核验另审，不调度或部署。

本次P4包上传已按用户确认的ce3a497b…准确清单完成：一次403623字节条件PUT＋独立一次准确版本GET，大小/SHA/checksum/AES256/版本和原basis重建全部通过；VersionId `PCD4J0_Ydp1lpa1BzFeKhDbNIEiUK1HC`，包SHA `e908e74b0de03ae61a2f36bfe1e9f0423ce3850e341a1a3cdf5f9676553b0700`。新basis facts批准固定至2026-10-30 10:08:09.592（温尼伯），旧basis/Review不延期，SOURCE和运行时仍关闭。

恢复先读 `F:/ChatGPT_workshop/techlong-reviewed-cycle-package-executed-verified-20261028-a.json`（原始字节SHA `044bae2e914647b6b479c35f5be6c33345eb8d5aef96cabaf50aa3372bc14706`），不重放旧上传或Inspect。执行源码0e18a25/准确CI40721151594通过；实际Source STS3、桶元数据6、HEAD2、PUT1、GET1、候选内容1/readiness4/CI GET3；无SQL、私密配置/PEM/Secret值、IAM写、workflow发布或dispatch。两永久槽已消费；仅本地领取时刻可追溯，不声称AWS创建时间。writer/Inspect和本地核验完成后main才结束冻结，原件与原NOT_APPROVED准备记录均保留。

该项必要来源接线已按顶部实现，不重复上传、新建任务/镜像/身份或扩权限；实际来源/trust变更与整轮执行仍分别准确审批，不先发布或部署。包成功不是完整Review或部署验收，更不是整套AWS上线。

以下为本轮代码与准备阶段记录，保留追溯，不构成再次上传或读取许可。

本次包上传接线已实现，复用原 `packageUploadRunner` / `createPackageIo`，新旧上传47项本机测试及真实封存body/四原件核对通过；不修改旧上传器或新增AWS执行器。只拟新key一次条件PUT、独立一次固定版本GET及准确新basis事实批准，不发布来源或部署。[完整风险和边界](aws-auto-deployment-reviewed-cycle-package-upload.md)。

最终准确CI通过后，在原五小时准备截止前PrepareSaved生成清单；恢复先读 `F:/ChatGPT_workshop/techlong-reviewed-cycle-upload-20261028-a/prepared-verified.json` 并核对实际源码/CI/原件/SHA。它只在准备真实成功后封存，不存在时不能靠本手册声称已获准。新清单最长24小时，最晚启动提前2分钟；新facts仅按真实10月28日10:08:09.592起至10月30日同一时刻，不给旧basis延期。

生成清单后main冻结，不追加文档提交或重写原件；下一只请求用户对准确SHA及新事实/上传范围确认。本轮尚无AWS、SQL或私密配置读取、上传、新槽或dispatch。Prepare不调用AWS；真正获批上传前仍实时核验IAM用户/桶/目标，不因准备完成预先要求Source刷新。包VersionId必须来自真实ACK和独立核验，后继来源发布及整轮执行仍另审。

完整历史最小兼容已完成：源码d8c3de1的准确CI40717621406通过，本机121项（新周期45＋旧入口76、含12新增）及类型/lint/diff通过。新周期仅复用原核验后的现有只读reader，一次固定SOURCE范围SELECT替代12行显示RPC；53行合同不变、54行只作溢出拒绝；status/runStatus显式冲突停止。旧安装函数、权限、保护、入口、包和事实时刻不变，110云闭包保持。每次仍仅一条status查询，计入原单次100/整轮635预算，不增连接或读取配置。

恢复先读 `F:/ChatGPT_workshop/techlong-reviewed-cycle-history-fix-verified-20261028-a.json`（原始字节SHA `14ce5f3744cab426296719fcb163f1dd38579da2bf88f595a89d65a8d5b32247`）；它绑定准确源码/CI和本地归档映射结果，不是生产观测。本轮无AWS、生产配置/SQL连接、私钥/Secret值、权限安装、上传、槽消费或dispatch，仅6次GitHub只读GET核验CI。

P4本地包候选已从真实handoff和七份历史原证据完整重建：11旧job/14历史plan保留，canonical包403623字节；未上传/启用来源。源码630fcf4的准确CI40715649202全部15报告步骤及本机33项定向测试、类型/lint通过。恢复先读 `F:/ChatGPT_workshop/techlong-reviewed-cycle-package-20261028-a/verified.json`（原始字节SHA `056168741efc03aa93bf528e455f5b0aa6223aa40f0fa5366d4ff4266f71f84a`）；它绑定candidate/source/result原件及SHA。该阶段无AWS/生产配置/SQL/私钥/Secret值/新槽/上传/dispatch，仅GitHub只读CI核验。

该项上传接线现已按顶部实现，不重建包/改历史基准或新建任务。实际上传另按新SHA批准；真实VersionId只有经ACK和独立核验后才能填入后继来源；现有双workflow/SOURCE/trust-only发布及整轮执行仍另审。原准备发现的12行/状态字段问题已最小修复，旧阻塞记录保留不覆盖。当前selection仍null，没有上传、事实窗口、来源发布或整轮批准。[总清单当前P4](aws-auto-deployment-next-cycle-plan.md)。

P2只读事实及P3[两行原子任务衔接](aws-auto-deployment-reviewed-cycle-handoff-v1.md)已完成。用户批准 `89bf6dcd…` 后，执行源码 `a87d2fe`（准确CI40704097228通过）于2026-10-28温尼伯10:08:09.592提交、10:08:21.656独立回读通过：旧a604原行保留为canceled，新 `job_a00fc18c13a5d6c6616c8039` 为pending/attempt0/max1、永久held、无lease或云执行授权；其他10旧job、14/9/9完整控制账本、业务与保护保持。实际配置读取2/TLS2/SQL79/CI GET6，AWS/Secret值/PEM/控制表写/dispatch/部署均0。写与Inspect两槽永久消费，绝不重放或复位。

P3原件仍在 `F:/ChatGPT_workshop/techlong-reviewed-cycle-handoff-executed-verified-20261028-a.json`（原始字节SHA `c5b365acc3d812b7102f282a6cc3302aa42fb3e67a3a75d8cf538f594cf954bf`）；它索引真实writer/Inspect原件及SHA，不含私密配置或业务正文。P4只排除新held行，保留canceled a604及完整旧历史；原成功前驱9db不变。原最早事实时间及13:42:18准备截止不改，不自动赋予新事实窗口，不重复生产读取、不建固定任务分支或新执行器。

G1受审新周期接入与G2整轮衔接的[最小接线与累计执行上限](aws-auto-deployment-reviewed-cycle-v1.md)已编码并通过准确CI，复用原编译器、单次调度和独立三写核验；默认云周期source仍为null。新事实窗口、包上传、必要来源发布及整轮SHA仍须另审，不先开Review或部署，不扩运行时框架或调度平台。真实请求已按准确批准完成，后续按总清单P4–P5集中落实材料与执行范围。

该项的[准备总清单、时序及开窗阻塞](aws-auto-deployment-next-cycle-plan.md)现已落地；其[机器摘要](aws-auto-deployment-next-cycle-plan.json)明确不可执行。它只是本节附表，不另建平行手册；后续以其中No-Go条件和最小范围提案继续，不把草案摘要当批准SHA。

新SOURCE/包及必要来源发布尚未完成，当前仍**不启动Review、不新建业务任务、不做云写入**。需要新的生产事实时，先取得当轮明确的限定只读许可；旧读取批准和旧快照不自动延用。

总清单必须在开窗前覆盖：

- 新周期所需准确任务、必要请求衔接和来源绑定；不能只替换job ID、自动新建任务或复制一套固定任务分支来绕过旧槽。
- 现有镜像、角色、Secret版本元数据和承载模板的复用关系；仅列出主线确实必需且另待批准的差异，不默认重建平台或扩权限。
- 连续Review及后继发布、RunOnce、独立Inspect的全部读取/写入/私密使用范围、资源与次数上限、源/CI/版本引用、风险和独立核验方式。
- 运行时派生SHA的固定规则与批准边界；若现有入口不覆盖某步，必须先明确该缺口，不能声称已经全程自动化或用旧Review-only批准扩权。
- 每个实际期限、剩余预留、本人GitHub审批点、失败/未知停止点，以及已知收费资源的清理审核安排；清理不自动执行。

材料和授权都齐备后，再按获批范围连续执行 Review → RunOnce → 独立 Inspect。能合并的准备与审批集中完成，避免在短执行窗口内来回聊天；**合并审批不等于省略资源边界、证据校验或本人GitHub审批**。整轮通过后立即转向完整产品与AWS交付，不继续扩部署基础设施。

## 4. 禁止偏离与最小修复门槛

默认不再推进 F3c9、窄屏退出/UI美化、身份探针、更多离线模拟、通用恢复/补偿框架、新的调度平台、无关重构或“先搭底座”的旁支。不重复已完成的包上传、镜像发布、工作流/trust发布或历史成功验收。

遇到阻塞，只先做安全、在范围内的诊断。任何额外修复都要说明：阻塞当前哪项验收、为何不能复用现有能力、最小文件/资源差异、验证及停止条件；需要扩大范围时先请求明确方向。只处理阻断主线的最小问题，不借修复扩大权限或功能。

## 5. 时间、授权与证据规则

- 准备快照按真实观测后不足5小时核验，不改写采样时间；这不是Review/claim/workload/事实窗口延期。旧执行时限及8+2分钟预留不因额度中断或本手册延长。
- 不复用旧批准、不重放未知写入、不删除/改名/复位永久槽；窗口不足就停止。未知结果先按另批范围独立回读，不自动补齐、回滚或重试。
- 新AWS权限、真实部署/资源更新、数据库业务写入、私密读取、任务创建/取消及删除，仍按具体清单与风险确认。GitHub environment始终由用户本人批准；不修改门禁或代批。
- 代码/文档提交和推送沿用既有授权，直接main，不新建本地分支；允许必要Account ID/ARN/状态摘要，禁止提交凭据、PEM、Secret值、业务快照正文、签名URL或原始私密日志。
- CI通过、GitHub运行成功、固定对象SHA通过、完整受信证明、独立部署验收和整套系统上线是不同层级，分别记录，不混称。历史资源事实不冒充当前健康或费用。

## 6. 每阶段交付与恢复

开工先读本手册和主线顶部，只做当前唯一继续点。每个小阶段交付一份简洁状态：源码/准确CI、已完成与未完成、实际副作用、原始证据位置、停止原因及下一唯一动作。额度或进程中断时保存最小检查点，恢复先读它，不重做已验证工作、不重放已消费槽，也不再建立一套平行手册/历史基准。

本轮代码和文档收尾完成后，下一次工作从第3节开始。任何新执行周期仍未获本手册授权。
