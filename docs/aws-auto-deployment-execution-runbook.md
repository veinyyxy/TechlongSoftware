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
