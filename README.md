# 餐饮 SaaS 平台

2026-10-23主线：**W8d已按02d50822…清单安装成功，另进程独立Inspect通过，errors为空。** 11:38–11:40CDT完成七次顶层写、一次受审PEM读取；新App Secret固定版本、原access栈UPDATE_COMPLETE、原身份/两资源及boundary默认v2均匹配，v1保留，两控制凭据读取例外到位且管理仍Source-only。原Web凭据版本/策略保持，未GetSecretValue、连SQL、申请App token、发布镜像或部署ECS。**新安装槽已消费，禁止重跑或复位；Secret会持续计费、权限不会自动到期，运行时仍关闭。** 下一仅准备W8b真实镜像产物封验和原publisher发布/立即撤权编排的新清单，不新增身份/执行器/UI，不沿用本次安装批准发布镜像。[完整范围与风险](docs/aws-auto-deployment-platform-w8d-supply-review.md) / [安装及独立核验证据](ops/aws-sandbox/reviews/platform-hosted-access-w8d.review.json) / [准确CI证据](ops/aws-sandbox/reviews/platform-hosted-access-w8d.verified.json)。下方为历史记录，不能重放旧清单。

2026-10-23主线：**W8c现有资源核对与最小接入范围已收敛。** 两个数据库Secret的固定版本、原execution身份/权限及publisher Locked状态匹配；拟用App私钥Secret尚不存在，平台承载栈已不存在，ECR仍只有旧镜像。下一复用原入口准备“一项新密钥Secret＋既有execution权限补充＋W8b单次镜像发布”的具体执行材料，之后另审两小时托管验收；不新增身份/执行器/数据库或UI。只读33项AWS元数据操作（含预检/Key），未读私密值、未写云或SQL、未消费执行槽。本计划不是可执行清单，也不授权安装/发布/部署。[准确范围与唯一继续点](docs/aws-auto-deployment-platform-w8c-activation-scope.md) / [核对事实](ops/aws-sandbox/reviews/platform-hosted-controller-w8c.inventory.json)。

2026-10-23主线：**W8b已接通显式Node托管启动与受控私密binding候选，本机87项新旧回归通过；准确f3cea2d源码CI39960583333的18报告步骤全成功，含真实容器启动/25秒到期/安全扫描。** 默认入口仍关闭；新模式先验证固定HTTPS/release/源码/租约，再按需供给原控制器凭据。到期只关控制能力，Web仍运行且继续可能计费，不自动清理或重建。未读真实Secret/key、未改IAM、发布ECR或部署AWS，UI不改。下一仅集中具体资源、固定版本、权限及发布/部署审核材料。[范围、风险和唯一继续点](docs/aws-auto-deployment-platform-w8b-hosted-startup.md) / [CI机器证据](ops/aws-sandbox/reviews/platform-hosted-startup-w8b.verified.json)。

2026-10-23主线：**W8a控制器托管来源/租约兼容已编码，本机79项新旧回归、类型和定向lint通过；准确9f241d6源码的三项No-AWS CI全部成功（51报告步骤），含真实Docker构建/容器冒烟/安全扫描。** 复用既有Review/RunOnce/Inspect控制器，增加准确HTTPS来源、互斥模式和原30分钟上限；Node默认入口仍关闭，未装载密钥/凭据或启用部署。下一集中Node受审托管启动及私密供给，不重建只读壳、不扩F3c9。**用户明确窄屏退出按钮不修复，历史UI修复建议已撤回。** 本阶段AWS/Secret/生产SQL/真实App调度为0，实际权限和部署仍具体确认。[主线范围与继续点](docs/aws-auto-deployment-platform-w8a-hosted-controller.md) / [CI机器证据](ops/aws-sandbox/reviews/platform-controller-hosted-w8a.verified.json)。

2026-10-23 07:17CDT当前：**W7r第二轮临时承载已清理并独立核验：HOSTING_CLEANUP_INDEPENDENTLY_VERIFIED，errors为空。** 按批准`6c74ce1e…f344`仅一次标准DeleteStack，准确新UUID `2d7d45a0-ced0-11f1-acc8-0effedbce869` 的11项CFN资源DELETE_COMPLETE、11项服务检查通过；ALB/入口DNS/安全组/日志组已移除，ECS仅保留INACTIVE历史、无运行任务。cleanup-v2槽已消费，禁止重放或补删。**临时承载入口已移除；IAM/Secret/Neon/ECR/证书/zone/VPC等保留，仍可能收费，不是全账户零费用。** 日志及容器临时数据未备份、不可恢复。应用/镜像/权限未改，窄屏退出缺陷仍待修，非完整生产验收。[实际清理及下一步](docs/aws-platform-hosting-w7r-cleanup-observed.md) / [机器证据](ops/aws-sandbox/reviews/platform-hosting-w7r.cleanup-observed.json)。

以下为W7r验收和清理准备时的历史状态（当时仍在计费、删除待批准，现已由上方实际结果取代）。原清单与哈希保留，不可重放。

2026-10-23 06:35CDT当前：**W7r公网与管理员有限闭环已验证，存在未修复的窄屏退出入口缺陷。** 本轮新栈/DNS绑定核对后，三次无身份GET确认TLS1.3、health/login200、未登录admin307；用户自行登录后只读查看概览/实例列表/准确详情，随后一次成功登出，访问admin跳登录。没有读取密码/Cookie值、导出业务数据或创建/批准/观察/调度任务。<=900px布局隐藏退出按钮，临时桌面宽度完成登出后已恢复视口；**缺陷未修复，不代表全产品或移动端生产验收通过**。[有限验收及缺陷](docs/aws-platform-hosting-w7r-acceptance.md) / [机器证据](ops/aws-sandbox/reviews/platform-hosting-w7r.acceptance.json)。

**承载仍在计费，今天07:54:53CDT仅标签，不会自动停止。** 已fresh只读准备仅针对新UUID `2d7d45a0-ced0-11f1-acc8-0effedbce869` 的清理清单：`6c74ce1e002f31e1b3061cc29122f63f8d0c4c4491bcdbabd5c0360a8156f344`，原件`F:/ChatGPT_workshop/techlong-platform-hosting-cleanup-review-w7r-20261023.json`。拟议一次标准DeleteStack删除当前11项承载资源及日志，保留IAM/Secret/Neon/ECR/证书/zone/VPC等；不force/retain/换角色/补删或自动重试。**删除未批准、未提交、新cleanup-v2槽未消费**。[完整清理风险](docs/aws-platform-hosting-w7r-cleanup-review.md) / [待审索引（非原件）](ops/aws-sandbox/reviews/platform-hosting-w7r.cleanup-review.json)。清单到期10月25日06:35:06CDT、最晚启动06:05:06CDT，仅为审核期限，不建议继续收费48小时；实际执行仍需明确新SHA/风险确认。旧W7p删除目标不同，不可重放。窄屏修复与镜像重发另审，不为等待修复自动续费或保留承载。

以下为W7q部署完成时的历史记录（当时应用验收待进行）。

2026-10-23 05:59CDT当前：**W7q第二轮承载已创建并独立核验通过：HOSTING_METADATA_VERIFIED_APPLICATION_ACCEPTANCE_PENDING。** 按批准08d13df8清单仅一次CreateStack，新UUID `2d7d45a0-ced0-11f1-acc8-0effedbce869`、11项资源CREATE_COMPLETE，真实task健康/固定digest/target、443listener/SG/DNS及原access绑定一致，任务定义为`:2`、errors为空。**尚未做本轮公网HTTP或管理员登录验收，不代表整套系统上线。收费资源现在存在；今天07:54:53CDT仅是意图标签，不会自动停机/清理。** 创建槽已消费，以下命令仅历史，不可重放；旧W7p删除目标是不同UUID，不可用于本轮。[实际结果、证据与下一步](docs/aws-platform-hosting-w7q-deployed.md) / [机器核验](ops/aws-sandbox/reviews/platform-hosting-w7q.observed.json)。下一步仅准备有限公网/人工认证验收及准确新UUID清理，分别确认；controller/worker/apply仍关闭。

以下为已批准并完成的W7q历史准备记录（不再待批准）。

W7q清单于**2026-10-22 23:56CDT**准备完成：准确源码`bd70439f59a52fca363c93bd5b127e093ff2b286`的[No-AWS CI39902733486](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39902733486)全部10报告步骤成功（29项新旧测试、类型、lint），fresh AWS元数据与模板验证通过。**尚未部署，入口仍下线，第二轮槽未消费。** 新清单只拟议一次CreateStack、新UUID、原布局11项承载资源，复用既有镜像/权限/固定Secret，不新增IAM、不改数据库；ECS未来会读取真实Secret，公开应用可能产生认证写。两小时意图不自动停机/清理；官方区域价格示例变量费0.13555USD/2h（不含既有资源/日志/流量/额外容量/创建清理耗时等，不是上限）。33源码pin、7父证据及4产物已绑定。[完整范围、风险与认证步骤](docs/aws-platform-hosting-w7q-acceptance-review.md) / [脱敏待审索引（非原件）](ops/aws-sandbox/reviews/platform-hosting-w7q.review.json)。人工登录及后续准确新UUID清理仍分别确认，不能宣称管理员或整套系统验收通过。

待批准SHA：`08d13df8f84a9e560bbf754a0bd1316cf5adff9f80dabc02a3c44a133b1e487d`；原件`F:/ChatGPT_workshop/techlong-platform-hosting-review-w7q-20261022.json`。有效期至**2026-10-24 23:56:25CDT**，最晚启动**23:26:25CDT**（UTC分别为`2026-10-25T04:56:25.642Z`和`04:26:25.642Z`）。只有新SHA及完整风险明确确认后才能运行`DeployTrial2Reviewed`；不要执行旧W7o命令或重置旧槽。T0+2小时从实际创建开始计算，不从清单准备开始；新槽一经消费也不自动重试或复位。

以下为W7q代码实现时的历史准备记录。

2026-10-22 23:51CDT当前：**W7q第二轮管理员验收准备已编码，本地29项新旧契约测试、类型及lint通过，fresh AWS只读inventory通过；尚未部署。** 复用固定镜像/权限/Secret/证书/网络，在原部署入口增加显式Trial2模式，仅兼容W7p已证明清理的准确旧UUID、INACTIVE且任务0的cluster/service和旧任务定义`:1`；未知/活跃/删除中对象仍拒绝。旧创建/删除intent保留，第二轮新槽未消费。下一步验证准确源码的No-AWS CI并生成48小时待审清单，实际新栈、人工认证和清理分别确认。[范围、完整风险与最小人工验收步骤](docs/aws-platform-hosting-w7q-acceptance-review.md)。没有新增IAM、重建镜像、读Secret值、连SQL或重启F3c9。

以下为W7p已完成记录。

2026-10-22 23:35CDT当前：**W7p承载栈已按批准清单单次删除并通过独立核验：HOSTING_CLEANUP_INDEPENDENTLY_VERIFIED。** 准确栈及11项逻辑资源全部DELETE_COMPLETE；服务级确认ALB/listener/target group、准确DNS A、日志组、两安全组及入站规则已移除，ECS服务/cluster为INACTIVE且任务0，任务定义注销为INACTIVE。公网试验入口现已下线，日志未经导出已删除。IAM/Secret/Neon/ECR/证书/zone/VPC等未操作，保留资源仍可能收费，不等于账单归零。创建及删除永久槽均已消费，以下旧命令不可重放。[实际结果与续接边界](docs/aws-platform-hosting-w7p-cleanup-observed.md) / [独立机器证据](ops/aws-sandbox/reviews/platform-hosting-w7p.cleanup-observed.json)。本轮完成两小时承载试验闭环，但尚未做管理员认证/完整业务验收，也不代表整套系统上线；下一阶段只准备新的受控端到端验收，实际部署和认证范围另审。

以下为W7p清理已完成前的历史准备状态（不再待批准）。

2026-10-22 23:18CDT当前：**W7p Source已刷新，准确承载栈清理清单已fresh只读核对并准备，尚未批准或删除。** 唯一目标为W7o栈UUID `54a0d7d0-ce87-11f1-aa1a-0eb4b7868f6f`，仍CREATE_COMPLETE、11项物理资源/原模板一致、termination protection关闭且无额外CFN service RoleARN。拟议仅一次标准DeleteStack，保留IAM/Secret/Neon/ECR/证书/hosted zone/VPC等旧资源；无force、retain、补删或自动重试。[准确待审索引（非原件）](ops/aws-sandbox/reviews/platform-hosting-w7p.cleanup-review.json) / [完整删除风险](docs/aws-platform-hosting-w7p-cleanup-review.md)。两小时标签已过，**资源不会自动停止，删除尚未提交，仍可能持续计费**。

W7p待批准删除SHA：`d71670b132fe6e0613ff4f9a97970d5a89fa05b118c04ee5366c7d40eac7829d`。原件`F:/ChatGPT_workshop/techlong-platform-hosting-cleanup-review-w7p-20261022-refreshed.json`，到期2026-10-24 23:18:31CDT，最晚启动22:48:31CDT。确认后先原样fresh核对、消费独立永久槽，再单次DeleteStack及最多约25分钟独立只读观察；失败/提交不明不重试、不强制或补删。删除会停止公网应用并不可恢复地移除该日志组日志，可能异步部分失败或遗留费用；新确认不可由“优先准备清理”或“Source已刷新”代替。旧未审批原件0a19d353保留，仅澄清风险文档历史凭据状态后重绑SHA，删除范围/API/nonce/fresh云快照均未改变。

以下为W7p已完成公网核验及过期凭据的历史记录。

2026-10-22 23:09CDT当前：**W7p公网TLS/健康/登录页及未登录重定向三次GET已通过；用户选择优先准备清理，不继续登录验收。** 未发送Cookie/密码或提交表单，未验证管理员认证/业务页面。Source会话过期，fresh清理清单尚未生成、删除写入0、清理槽未消费；需要刷新Source后只读核对准确已建栈，再单独确认删除SHA。[有限公网结果](docs/aws-platform-hosting-w7p-public-readback.md) / [清理范围与完整风险，尚未批准](docs/aws-platform-hosting-w7p-cleanup-review.md)。**今晚23:13:24仅是标签，服务不会自动停机；未清理会继续计费。**

以下为W7o已完成部署记录。

2026-10-22当前：**W7o HTTPS承载已创建并通过独立元数据核验：HOSTING_METADATA_VERIFIED_APPLICATION_ACCEPTANCE_PENDING。** 21:13–21:17CDT按准确289e7cdc清单，仅一次CreateStack创建11项承载逻辑资源；栈CREATE_COMPLETE，实际单task健康、固定digest、ALB target/443listener/SG/DNS及原access身份均通过，errors为空。入口为[console.sandbox.techlong.cloud](https://console.sandbox.techlong.cloud)，尚未执行公网HTTP或管理员登录验收，不代表整套系统上线。**收费资源现在存在；两小时意图截止今晚23:13:24CDT，但不会自动停止或销毁，清理仍需另审。永久槽已消费，下方部署命令仅历史，不可重放。** [部署结果与边界](docs/aws-platform-hosting-w7o-deployed.md) / [机器证据](ops/aws-sandbox/reviews/platform-hosting-w7o.observed.json)。下一步先做独立应用验收并尽快审批准确栈清理，controller/worker/apply保持关闭。

以下为W7o已完成的历史准备记录（不再待批准）。

2026-10-22当前：**W7o 两小时HTTPS承载部署入口及48小时清单已准备，CI和AWS只读模板验证通过；尚未部署。** [准确CI39886264015](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39886264015)绑定源码`281933ba4064fbde4978d4d2f3cc214bcdef1fb5`，全部10报告步骤成功（21项新旧测试、类型、lint）。沿用W7n真实RoleId/PolicyId、固定Secret UUID及已发布单平台manifest；fresh inventory已核对原权限/Secret元数据、网络/路由/证书/预算及承载名称/task family空闲。无新IAM或Secret策略修改，未来新栈仅11项承载逻辑资源；2小时变量费示例0.13555USD，不含既有资源/日志/流量/额外容量等，不是上限。本轮AWS写/Secret值读取/SQL均0，29项源码及4份产物已绑定，永久部署槽未消费，hosting窗口未开始。[完整部署范围与风险](docs/aws-platform-hosting-w7o-deployment-review.md) / [脱敏待审索引（非原件）](ops/aws-sandbox/reviews/platform-hosting-w7o.review.json)。

W7o待批准SHA：`289e7cdcb09630b2b851fe5fa493477f1d7a642bbe10509efa21bf3ccac178ab`。原件仅保留`F:/ChatGPT_workshop/techlong-platform-hosting-review-w7o-20261022.json`；到期 **2026-10-24 20:52:52 CDT（America/Winnipeg）**，最晚启动 **20:22:52 CDT**（分别`2026-10-25T01:52:52.306Z`、`01:22:52.306Z`）。拟议仅一次CreateStack创建11项承载资源并独立元数据核验；允许ECS按固定任务定义启动/替换任务、读取并注入真实固定版本Secret，公开应用可能产生数据库访问或认证写，不等于部署程序主动读取值/SQL。DisableRollback=true/20分钟CFN超时，失败不自动重建/回滚/清理，永久槽不复位；T0+2小时仅标签/输出，**不会自动停止收费**。实际管理员登录/公网应用验收及后续清理另审。只有该SHA和完整风险明确获批后才使用：

```powershell
node 'E:/NodejsProject/TechlongSoftware/ops/platform-hosting-deploy-v1/local.mjs' DeployReviewed 'F:/ChatGPT_workshop/techlong-platform-hosting-review-w7o-20261022.json' '289e7cdcb09630b2b851fe5fa493477f1d7a642bbe10509efa21bf3ccac178ab'
```

以下为已完成W7n历史。

2026-10-22当前：**W7n execution角色、权限边界及固定Web Secret读取接线已安装，独立核验通过：ACCESS_HANDOFF_INDEPENDENTLY_VERIFIED。** 16:31–16:32CDT按准确9cdfcdc0清单执行一次两项IAM建栈和一次Secret策略更新，两个ACK、CREATE_COMPLETE、相同实际RoleId/默认v1/准确权限及独立HANDOFF均通过，errors为空。实际41次元数据读取/2次顶层写；没有读Secret值、连Neon或部署ECS。**永久槽已消费，下方准备命令只作历史，不可重放。** 额度中断仅延迟文档发布；恢复后只核本地证据，未重试安装。[实际结果与下一步](docs/aws-platform-hosting-w7n-access-observed.md) / [机器证据](ops/aws-sandbox/reviews/platform-ecs-w7n.observed.json)。下一步仅准备绑定真实RoleId的11项两小时HTTPS承载执行清单，实际部署/验收/清理另审；角色权限持续存在，平台尚未上线，hosting窗口未开始。

以下为W7n已完成的历史准备记录（不再待批准）。

2026-10-22当前：**W7n ECS execution角色/Secret读取接线与两小时HTTPS承载草案验证完成；48小时权限清单待批准，尚未安装或部署。** [准确CI39856557759](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39856557759)绑定源码`ceaaf92c7298ed67039ead2ca6cd059ea3722479`，全部10报告步骤成功（10项契约测试、类型、lint）。AWS只读验证两份模板、Secret资源策略及身份/trust策略通过，Access Analyzer均零发现；新名称空闲、固定Secret/镜像、网络/证书/DNS/service-linked roles及50USD月预算已核对。公开区域价目表按单task/ALB/3公网IPv4/平均0.1LCU估算未来两小时变量费约0.13555USD，未含既有资源、日志、流量和额外容量等，不是上限。路由支持main隐式关联并拒绝显式覆盖；CloudFormation读取已修复transport超时，不涉及云写。本轮AWS写/Secret值读取/Neon连接/新槽消费均0，hosting窗口未开始。[完整access风险](docs/aws-platform-hosting-w7n-access-review.md) / [11项承载草案，非部署批准](docs/aws-platform-hosting-w7n-two-hour-draft.md) / [待审索引（非原件）](ops/aws-sandbox/reviews/platform-ecs-w7n.access-review.json)。

W7n待批准SHA：`9cdfcdc03a33cbcc22ca749bbb84294054bdeb58439447656e337ae4ad592e09`。原件仅保留`F:/ChatGPT_workshop/techlong-platform-ecs-access-review-w7n-20261022.json`；到期 **2026-10-24 16:24:46 CDT（America/Winnipeg）**，最晚启动 **16:04:46 CDT**（分别`21:24:46.377Z`、`21:04:46.377Z`）。最多一次CreateStack创建两项具名IAM逻辑资源（role含inline及boundary），一次准确Secret读取Deny例外更新，随后独立只读核验；CloudFormation内部操作不受“两次顶层提交”计数约束。权限安装后不会随清单到期失效，失败不自动回滚/补齐/撤权/删除/重试；实际两小时承载和后续清理另审。只有该SHA及完整风险明确获批后才使用：

```powershell
node 'E:/NodejsProject/TechlongSoftware/ops/platform-ecs-v1/local.mjs' InstallAccessReviewed 'F:/ChatGPT_workshop/techlong-platform-ecs-access-review-w7n-20261022.json' '9cdfcdc03a33cbcc22ca749bbb84294054bdeb58439447656e337ae4ad592e09'
```

以下为W7m已完成历史。

2026-10-22当前：**W7m Web固定凭据已安装并通过真实独立认证：WEB_CREDENTIAL_INDEPENDENTLY_VERIFIED。** 15:46CDT按准确a93b6416清单执行三次Secret写/一次既有Web角色密码LOGIN，提交ACK、独立完整目录及准确UUID的一次Secret读取后只读认证均通过，授权未变。Source-only策略仍保护准确Secret，未来execution role尚不能读取；没有改IAM或部署，管理员账号密码未变。**永久槽已消费，以下准备命令仅历史，不可重放。** [实际证据与下一步](docs/aws-platform-hosting-web-credential-w7m-observed.md) / [脱敏机器摘要](ops/aws-sandbox/reviews/platform-web-credential-w7m.observed.json)。下一步准备execution-role/固定版本handoff及两小时HTTPS部署的独立清单；角色LOGIN与收费Secret将保留至后续明确处置，平台仍未上线、hosting窗口未开始。

以下为W7m已完成历史准备记录（不再待批准）。

2026-10-22当前：**W7m 固定 Web Secret/Neon LOGIN 及task接线准备完成，48小时清单待批准；尚未执行。** [准确CI39850777219](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39850777219)绑定源码`00b4189e44097bd8c7708013e41c95726235731a`，全部13步骤成功：8项新契约测试、真实PG18.6原密码认证/错误密码拒绝/事务回滚/独立回读、类型及lint；AWS在CI中仍是内存double，不是生产安装证明。本机新旧25项及类型/lint通过。已只读确认Source身份、Secret名称空闲、现有AWS-managed Key及Source-only候选策略验证通过；生产Secret值读取/Neon连接/新槽消费/密码生成均0。新清单最多三次Secret写、一次既有角色密码LOGIN、一次固定版本读取及只读认证；不改IAM、不部署。[完整风险](docs/aws-platform-hosting-w7m-credential-review.md) / [后续task接线约定](docs/aws-platform-hosting-w7m-task-handoff.md) / [脱敏索引（非原件）](ops/aws-sandbox/reviews/platform-web-credential-w7m.review.json)。两小时hosting窗口未启动。

W7m准确待审SHA：`a93b64169dd598d45832a7e9e0fc7317395fdd907cb7baa8c0f4a935b7c45b09`。原件只在`F:/ChatGPT_workshop/techlong-platform-web-credential-review-w7m-20261022.json`，不公开生产host/actor/database。到期 **2026-10-24 15:41:48 CDT（America/Winnipeg）**，最晚启动 **15:31:48 CDT**（分别`20:41:48.651Z`、`20:31:48.651Z`）。Source-only显式Deny在凭据写入前安装；未来task execution role尚不能读，后续IAM/资源策略handoff另审。Neon仅支持原密码接口，服务端日志/非原子/失败残留等完整风险需接受。只有该新SHA明确获批后使用：

```powershell
node 'E:/NodejsProject/TechlongSoftware/ops/platform-web-credential-v1/local.mjs' InstallReviewed 'F:/ChatGPT_workshop/techlong-platform-web-credential-review-w7m-20261022.json' 'a93b64169dd598d45832a7e9e0fc7317395fdd907cb7baa8c0f4a935b7c45b09'
```

以下为W7l已完成历史。

2026-10-22当前：**W7l NOLOGIN Web角色安装及独立验收完成：NOLOGIN_ROLE_INSTALLED_AND_INDEPENDENTLY_VERIFIED。** 15:15CDT按准确38e987e1清单执行一次七条SQL事务并收到COMMIT ACK；独立只读连接核验实际OID196608、NOLOGIN/连接上限5/准确search_path、13表SELECT及认证窄授权全部一致，无未审目录差异。没有设置密码、启用LOGIN、读/写Secret、改AWS或部署，保留PUBLIC TEMP及创建者ADMIN（无SET/INHERIT）。**永久槽已消费，以下准备命令仅历史，不可重放。** [执行结果与下一步](docs/aws-platform-hosting-w7l-nologin-role-observed.md) / [脱敏机器证据](ops/aws-sandbox/reviews/platform-web-database-w7l.nologin-observed.json)。下一步只准备固定Secret/LOGIN及task接线的独立待审方案；平台仍未上线，两小时hosting窗口未启动。

以下为W7l历史准备记录（已批准并完成，非当前待办）。

2026-10-22当前：**W7l 单一 NOLOGIN 平台 Web 数据库角色与窄授权已实现、真实 PostgreSQL CI 通过，48小时安装清单待批准；生产尚未安装。** [准确CI39845273491](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39845273491)绑定源码`f78ec0f999a9ee839d6b3d135d7280eb7e510aeb`，全部13步骤成功：8项新契约测试、真实七条SQL/事务失败回滚/独立回读、9种禁止操作、类型和lint。本机新旧共17项及类型/lint通过。准确范围仅一个禁用角色、七条持久语句、两次连接（安装及独立只读核验）、最多23条目录SELECT；不设置密码、不启用LOGIN、不创建Secret、不改AWS、不部署。保留PUBLIC TEMPORARY及创建者自动ADMIN（无SET/INHERIT）风险，列授权不等于行隔离。[完整风险](docs/aws-platform-hosting-w7l-nologin-role-review.md) / [脱敏索引，非原始清单](ops/aws-sandbox/reviews/platform-web-database-w7l.nologin-review.json)。两小时hosting窗口尚未启动。

W7l准确待审SHA：`38e987e12585c6494990ac7fc68b0222ee12828a05fd248703885a6f95ac8154`。原件只在`F:/ChatGPT_workshop/techlong-platform-web-role-review-w7l-20261022.json`，不公开生产目标字段。到期 **2026-10-24 15:03:54 CDT（America/Winnipeg）**，最晚启动 **14:58:54 CDT**（分别`20:03:54.026Z`、`19:58:54.026Z`）。新永久槽未消费，本轮生产连接/SQL写/AWS调用均0；旧W7k审计槽保持已消费。仅该新SHA获得明确批准后使用下列命令，不可重放旧只读命令或把此批准扩展到Secret/LOGIN/hosting：

```powershell
node 'E:/NodejsProject/TechlongSoftware/ops/platform-web-database-role-v1/local.mjs' InstallReviewed 'F:/ChatGPT_workshop/techlong-platform-web-role-review-w7l-20261022.json' '38e987e12585c6494990ac7fc68b0222ee12828a05fd248703885a6f95ac8154'
```

以下 W7k 为已完成历史。

2026-10-22当前：**W7k Neon生产只读目录审计完成：READ_ONLY_CATALOG_CAPTURED_NOT_INSTALLED。** 14:29CDT按准确cdf4f18d清单执行一次TLS连接/七条目录SELECT；候选Web角色尚不存在，15张所需表及认证列齐全，已审计范围内PUBLIC可达definer路径和认证表用户触发器均0。没有SQL写、授权安装、LOGIN/Secret或AWS调用。发现现有PUBLIC CONNECT/TEMPORARY，下一窄授权清单必须明确临时表继承风险，不能宣称完全禁止DDL；本轮不动共享权限。**永久审计槽已消费，以下命令仅历史，不得重放。** [完整观测与下一步](docs/aws-platform-hosting-w7k-database-catalog-observed.md) / [脱敏机器摘要](ops/aws-sandbox/reviews/platform-web-database-w7k.catalog-observed.json)。下一步仅准备单一NOLOGIN Web角色与窄授权，实际写入、Secret/LOGIN及hosting仍单独审批；两小时窗口尚未启动。

2026-10-22准备记录（已执行，非当前待办）：**W7k 平台 Web 数据库接线的只读目录审计已实现、云端验证通过，具体清单待批准；生产审计尚未执行。** [准确CI39838810686](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39838810686)绑定源码`526a3323350e3013c3f09562ff2364e1a4f0e385`，全部13项步骤成功，包含真实一次性PostgreSQL查询、9项契约测试、类型/lint；本机同样通过。首次CI的sequence默认ACL类型码错误已修正，失败证据保留，原断言未放宽。本轮未改动W7j发布权限或镜像，不重建300MB产物。只读执行拟为一次TLS连接、七条固定系统目录SELECT；不读业务行/口令哈希/函数正文，不安装角色/授权/Secret，不改AWS或部署。[完整风险](docs/aws-platform-hosting-w7k-database-catalog-review.md) / [待审索引（非原始清单）](ops/aws-sandbox/reviews/platform-web-database-w7k.catalog-review.json)。生产连接/执行槽消费仍为0。

W7k准确清单SHA：`cdf4f18d0989075ba364b503b0f82effc0ee0aa123d9b0468d149937e3d5e27f`；原件仅保留`F:/ChatGPT_workshop/techlong-platform-web-db-review-w7k-20261022.json`，项目索引不公开生产host/actor/database，只绑定目标指纹。到期 **2026-10-24 14:19:33 CDT（America/Winnipeg）**，即`2026-10-24T19:19:33.612Z`。稳定只读审计槽尚未消费；确认该SHA只授权目录读取，不授权未来grant/LOGIN/Secret或部署。仅明确批准后才使用：

```powershell
node 'E:/NodejsProject/TechlongSoftware/ops/platform-web-database-v1/local.mjs' ReadReviewed 'F:/ChatGPT_workshop/techlong-platform-web-db-review-w7k-20261022.json' 'cdf4f18d0989075ba364b503b0f82effc0ee0aa123d9b0468d149937e3d5e27f'
```

以下为历史。

2026-10-22当前：**W7j 平台镜像首次 ECR 发布与 Source 独立撤权验收已完成。** [运行39801811721](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39801811721)的12项报告步骤全部成功；恰有一份预期镜像，registry manifest digest=`sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612`。两次准确V2角色栈UpdateStack完成，Source结果PUBLISHED_AND_INDEPENDENTLY_LOCKED，额外只读Inspect确认Locked；角色no-Allow trust/显式ECR Deny、原boundary不变。**永久槽已消费，不得重放下列历史命令。没有部署ECS，未证明真实数据库/管理员登录或整个平台上线，两小时hosting窗口未启动。** [执行证据与下一步](docs/aws-platform-hosting-w7j-publication-verified.md) / [机器摘要](ops/aws-sandbox/reviews/platform-publication-w7j.verified.json)。下一主线仅准备最小权限平台web数据库/固定Secret版本与后续两小时HTTPS部署清单，实际写入、部署、清理分别审批。以下为历史准备记录。

2026-10-21准备记录（已执行，非当前待办）：**W7j Source生产控制器、固定caller和完整待审清单已准备，尚未执行。** 源码5670b889的30项Node/类型/lint与[准确No-AWS CI39698015750](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39698015750)全部9步骤通过。固定caller引用已验收R=c35dd66e；现有V2角色no-Allow/原boundary/空ECR/BASIC扫描及GitHub真实账号、immutable subject、人工环境和main门禁均已fresh只读核验。最多两次V2单Role UpdateStack/一次GitHub dispatch/一次顶层ECR push，失败也进入Source Revoke及独立核验；不改旧栈、不部署、不删除。[完整风险](docs/aws-platform-hosting-w7j-source-review.md) / [精确待审清单](ops/aws-sandbox/reviews/platform-publication-w7j.review.json)。以下为历史。

W7j待批准SHA：`d902a5f5bfdb7f1a0f5ae33e729f306c13dfeb4a15832a67539cd53cd9aedc56`。
外层到期2026-10-23 **19:11:32 CDT（America/Winnipeg）**，最迟启动为当日 **18:11:32 CDT**；
Source在实际RunReviewed时才生成最多1小时的Grant窗口，不提前开放权限。稳定永久槽尚未消费，当前AWS写/dispatch/角色会话/ECR push均为0。
执行命令只在上述完整SHA另行批准后使用：

```powershell
node 'E:/NodejsProject/TechlongSoftware/ops/platform-image-source-v2/cli.mjs' RunReviewed 'F:/ChatGPT_workshop/techlong-platform-source-v2-review-w7j-20261022.json' 'd902a5f5bfdb7f1a0f5ae33e729f306c13dfeb4a15832a67539cd53cd9aedc56'
```

准备facts：`F:/ChatGPT_workshop/techlong-platform-source-v2-review-w7j-20261022.json.facts.json`，SHA `8bb9666d651a5a914fe40a19cd269b89a3b6b8800648b7880baeeb2e183fcd9e`。
CI独立元数据：`F:/ChatGPT_workshop/techlong-platform-source-v2-ci-39698015750.json`，SHA `c5fc54222023043d22e4000bce3513258043f7e62e93c9924338a62c4a055dc7`。
AWS只读ValidateTemplate两模板通过；Access Analyzer的两个inline和Revoke trust零发现，Grant trust仅一项 `CONFIRM_AUDIENCE_CLAIM_TYPE` SUGGESTION，无ERROR/SECURITY_WARNING。
当前aud使用单值StringEquals、没有集合限定符，符合[该提示的AWS说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-reference-policy-checks.html#access-analyzer-reference-policy-checks-suggestion-confirm-audience-claim-type)。
只读验证原件：`F:/ChatGPT_workshop/techlong-source-v2-validation-20261022.json`（SHA `e84cb0ea0d67b695dbbbd714916ae161e4ad952cfff3726a966194ddb27c7d97`）、
`F:/ChatGPT_workshop/techlong-source-v2-inline-validation-20261022.json`（SHA `1a6fc4cd3aee3babc4825f54c16dfab3a536fe3e76f582485ef55084dd6be1bd`）。
它们是生成算法的静态结构预览，不是已安装的Grant、真实OIDC成功证据或未来执行时刻的内层JSON原件。

2026-10-21当前：**W7i发布前字节复核和云端发布入口已验收，尚未开放权限或发布。** 新v2明确绑定W7h安全候选，保留旧失败产物/批准；20项Node/3项ZIP及类型/lint通过，[最终源码c35dd66e的No-AWS run39695238725](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39695238725)两个job全部18步骤成功。准确原ZIP/archive/load/双smoke与新DB的0 HIGH/0 CRITICAL均独立核对；V2角色仍no-Allow、boundary未变、ECR空。已实现固定reusable源码bootstrap和单次云端push入口，但Source生产写入适配器/固定caller/完整执行清单尚未完成，不能直接dispatch或申请执行批准。[证据、边界与唯一下一步](docs/aws-platform-hosting-w7i-publication-entry.md)。以下为历史。

2026-10-21当前：**W7h平台镜像修复已通过真实云端验收，尚未发布或部署。** 原Debian镜像扫描64 HIGH/4 CRITICAL被拦截，证据保留；新固定官方Alpine3.24/Node24.18候选已构建、双模式smoke及OS扫描成功（0 HIGH/0 CRITICAL），producer仅在扫描通过后上传准确产物。54项本机回归/类型/lint通过，[准确云端run39692352506](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39692352506)17步骤成功，独立小型证据已核对。下一准备新候选一次ECR发布/立即撤权清单；不运行旧proposal，不改IAM或创建部署。[完整证据、限制和唯一继续点](docs/aws-platform-hosting-w7h-os-remediation.md)。以下为历史。

2026-10-21历史：**W7g先对原镜像做真实云端发布前自检，尚未授权或发布。** 当前GitHub immutable subject/既有环境与V2角色/ECR元数据已只读核对；新No-AWS CI校验官方ZIP、精确解包、load/inspect同一image ID、两种无网络容器自检及新DB的OS高危扫描，不重建或推镜像。已实现限时grant/关闭trust并Deny ECR的纯模板候选，尚无真实publish/收尾执行入口或新执行清单；本机22项Node/3项ZIP测试及类型/lint通过，实际云端结果见W7h。原身份仍锁定，旧栈/Change Set不动。[范围、证据、限制和下一步](docs/aws-platform-hosting-w7g-image-publication-preflight.md)。以下为历史。

2026-10-21历史：**W7f独立V2锁定发布角色已创建，独立语义验收通过。** 唯一一次CreateStack成功，新角色真实RoleId已核验，trust无Allow、唯一ECR-only inline及准确原boundary；usage按批准从0变为1，原ECR零镜像。旧栈仍CREATE_FAILED、旧Change Set保持AVAILABLE/V1角色缺失，均未更新或执行。IAM单项Action序列化及边界类型显示诊断已原样保留，没有修改云策略或重试建栈。下一准备绑定新角色的受控单次镜像发布，grant/push/部署仍分审，两小时hosting未开始。[实际安装、诊断与继续边界](docs/aws-platform-hosting-w7f-publisher-created.md)。以下为历史。

2026-10-21历史：**W7f独立锁定publisher候选与48小时创建清单已准备，未安装。** 同一旧Change Set普通视图三项、属性级视图仅缺失角色，仍不足以保证Replacement=True可安全保留恢复；不修改原门禁或执行旧计划。新候选栈只创建V2新名称角色，引用现存ECR/boundary，不接管或更新旧栈；trust无Allow，安装和镜像发布分审。本机14项/类型/lint及准确源码[No-AWS CI39664792753](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39664792753)通过；仅待新SHA批准，本轮云写/新槽消费为0。[只读证据、候选范围及完整风险](docs/aws-platform-hosting-w7f-independent-publisher-review.md) / [准确创建清单](ops/aws-sandbox/reviews/platform-image-publisher-w7f.create-review.json)。以下为历史。

2026-10-21历史：**W7e已创建未执行Change Set，实际差异超出门禁，停止推进执行。** 仅一次CreateChangeSet；独立回读显示ECR和boundary的Tags变更、publisher的Replacement=True，不符合仅角色Add或无替换trust修改的批准范围。候选模板SHA正确，但不能据此忽略真实计划；未执行、未建角色或授权发布。原栈仍CREATE_FAILED、角色实际不存在、仓库零镜像、boundary未使用；新旧永久槽和Change Set全部保留。下一步先重新审查恢复范围，不能执行当前计划或重放创建。[实际差异、独立证据与继续边界](docs/aws-platform-hosting-w7e-changeset-blocked.md)。以下为历史。

2026-10-21历史：**W7e仅准备保留现有资源的恢复审阅。** Access Analyzer复现旧Principal错误，新“明确账户Deny＋无Allow”策略零发现；原栈仍CREATE_FAILED、角色缺失、ECR零镜像、boundary未使用。新模块仅编译候选模板和检查窄差异；拟议下一步最多创建一个未执行UPDATE Change Set，仍需新SHA批准，不重放原CreateStack或消费新槽。新代码CI不重建/上传镜像。[恢复范围、服务验证及完整风险](docs/aws-platform-hosting-w7e-recovery-review.md)。以下为历史。

2026-10-21历史：**W7d已批准的唯一一次建栈部分失败，独立核验已完成。** 模板Principal格式被IAM拒绝：新ECR和未附加boundary已创建，发布角色不存在，仓库零镜像；栈CREATE_FAILED，永久槽已消费。没有补齐/重试/删除/解锁或部署；原清单、模板、风险文档和证据保留。下一步须另审保留已建对象的锁定trust恢复方案，不能重放原CreateStack。[实际结果、错误原因与恢复边界](docs/aws-platform-hosting-w7d-foundation-partial-result.md)。以下为历史。

2026-10-21历史：**W7d准备可追溯镜像发布产物、独立ECR/锁定身份模板及首轮数据库权限矩阵。** No-AWS候选CI仅在同一镜像双模式自检后保存三天产物；盘点时精确ECR/role/boundary/stack不存在，锁定模板通过AWS只读ValidateTemplate。数据库角色仅是登录/会话＋管理概览/实例浏览提案，未连Neon、读Secret或安装授权。两小时部署和清理仍分审，旧Publisher/F3c9/租户不动。[工程入口、资源权限、凭据风险与后续审查](docs/aws-platform-hosting-w7d-image-and-db-preparation.md)。以下为历史。

2026-10-21历史：**W7c按用户选择准备两小时受控平台验收，部署与清理分别审核。** Node候选补齐固定HTTPS Origin/ALB头、重复Host拒绝、写请求Origin和Secure Cookie边界；默认只监听本机，部署/支付/controller继续关闭。新增合成测试及真实镜像双模式No-AWS自检，不代表真实TLS/管理员登录/AWS部署通过。尚未创建ECR、IAM、Secret或平台承载；两小时不是硬停费/自动销毁。[方案、入口契约、部署/清理分审及验证](docs/aws-platform-hosting-w7c-two-hour-https.md)。以下为历史。

2026-10-21历史：**W7b完成平台独立托管资源/区域价格只读盘点，尚未创建资源或生成写入批准清单。** 默认VPC/公共子网与现有sandbox通配证书可作候选；现有Cell承载不复用，上午验收的旧租户栈已删除且集群零服务，不自动恢复。独立平台730小时核心估算约49.88USD（744小时约50.82USD），尚未含既有资源/日志/流量；当前50USD Budget只覆盖指定标签，账号CE净额不能作为未来免费承诺。用户后续已选择两小时准备方向，真实IAM、Secret、ECR和部署另审。[盘点、费用、风险与准备顺序](docs/aws-platform-hosting-w7b-inventory-and-cost.md)。以下为历史。

2026-10-21当前：**W7a开始平台管理端AWS托管的独立Node容器候选。** 复用现有页面/Neon/认证，通过单独构建配置移除候选对Workers/Sites运行时的依赖；编译隔离本地dotenv/凭据、固定关闭部署与支付能力、无外网容器匿名GET自检。新GitHub No-AWS CI实际编译/构建/检查；未发布ECR、改IAM/Secret/数据库/DNS或部署平台，正常账号/HTTPS和托管controller尚未验收。[范围、工程入口、资源提案和下一步](docs/aws-platform-hosting-w7a-node-candidate.md)。以下为历史。

2026-10-21当前：**W6w sandbox自动部署已通过独立云端验收；W6x纯运维核心已收敛，W6y新增工程内受审Inspect命令。** 新入口支持48小时清单准备、单次调度/准确run观察和离线证据复核，路径可配置，ACK先保存后撤权，审批链接即时提示；真实调用仍需fresh SHA另审，本轮仅编码/合成测试与No-AWS CI。旧脚本、证据和永久槽保留，81/76云闭包、IAM及业务状态不改；平台账本未导入，不代表整套系统已AWS上线。[入口、完整风险与命令](docs/aws-auto-deployment-platform-w6y-operator-entry.md) / [独立验收摘要](docs/aws-auto-deployment-platform-w6w-independent-acceptance.md) / [核心收敛来源](docs/aws-auto-deployment-platform-w6x-code-consolidation.md)。以下为历史。

2026-10-20当前：**W6n 页面传输兼容修复已编码，旧 Review 计划停止使用、原件和槽位保留。** 用户同意解除旧链条 main 冻结；账本/GitHub 请求使用 workerd 兼容且不跟随跳转的 manual，仍严格拒绝3xx，旧认证审计守卫同步，历史批准不改写。124项本机回归/类型/定向lint通过，新实际workerd回归已接入现有No AWS CI，发布后核对准确提交Checks。本轮未读真实凭据、重开入口、改权限或部署；真实页面尚未复测。[诊断、旧计划处置及唯一继续方向](docs/aws-auto-deployment-platform-w6n-transport-fix.md)。以下为历史。

2026-10-20当前：**W6l新heldjob固定请求窗口及独立回读入口已编码，尚未开启或登记。** 固定管理员/nonce/预期job，刷新不换ID，进程内一次尝试及SQL前截止复核；复用原SERIALIZABLE登记SQL，controller/key/Secret能力关闭，不改81/76云闭包。67项本机回归/类型/lint通过，下一准确CI验证真实请求专用child与新SELECT，再只读Prepare48小时新SHA；实际新请求和两次认证文件读取另审，本轮生产私密/SQL/AWS/新任务/调度0。[准确范围、完整风险与命令](docs/aws-auto-deployment-platform-w6l-held-request-review.md)。下文为历史。

2026-10-20当前：**W6k真实本机启动/管理员登录查看已完成，服务已关闭并独立核验。** 按2a50da9d…单次供给/启动，用户确认登录及页面正常；原PID退出、3100无监听，永久槽已消费，不再重启。48项本机与准确CI39476628734全部17步骤通过，7项公开原件/23源码pin已核对；没有AWS写、新任务或调度，正常登录会话写不是“SQL为0”。下一集中新heldjob及独立受审运行窗口，完成平台Review→RunOnce→Inspect；不重放旧槽或扩支线。[完成记录、证据与唯一继续点](docs/aws-auto-deployment-platform-w6k-local-runtime-verified.md)。下文为历史。

2026-10-20当前：**W6k最小受审本机启动器已编码，尚未读取真实凭据或启动服务。** 独立配置/白名单内存传递、固定Secret版本/key元数据、30分钟许可、前台停止及只读Inspect；原launcher与81/76云闭包不变。10新+4原launcher+34回归通过；真实Wrangler仅合成变量检查通过，下一准确CI再验证一次性runner本机服务并只读Prepare48小时清单，Start另按新SHA批准。本轮生产SQL/AWS写/私密读取/新任务/调度0。[范围、完整风险与命令](docs/aws-auto-deployment-platform-w6k-local-runtime-review.md)。下文为历史。

2026-10-20当前：**W6j公开绑定已按752a9ee9…单次发布并独立核验成功，运行时尚未启动。** 仅一个binding文件变为PUBLISHED，真实workflow/R与release摘要匹配；一次非强制push/本地ff，永久槽已消费。发布后34项本机检查/typecheck及准确提交两项云CI全部通过；无AWS写、生产SQL、私密读取、任务创建、服务启动或部署。下一集中受审本机最小启动器/私密供给和一个全新任务的Review→RunOnce→Inspect验收，不重放旧任务或扩支线。[完成事实、证据与唯一继续点](docs/aws-auto-deployment-platform-w6j-binding-published.md)。下文为历史。

2026-10-20当前：**W6j真实workflow/R绑定候选、限时本机运行门禁及单公开文件发布入口已实现，未启用。** 12新+22回归/实际入口渲染共34项通过；只拟将一个独立binding文件受审发布，原contract/云81及76闭包保持。运行仍需另审供给的30分钟本机许可/准确源码/专用TLS凭据，错误来源或Neon全局fetch覆盖拒绝；原launcher不变。本轮未读私密值、连生产SQL、创建任务/启动服务/dispatch。下一准确CI后只读准备48小时新SHA，实际binding发布另批。[完整范围、运行风险和继续命令](docs/aws-auto-deployment-platform-w6j-runtime-binding-review.md)。下文为历史。

2026-10-20当前：**W6i App双工作流与worker trust已单次发布，独立核验成功，尚未dispatch。** 真实caller390829326/reusable390829324、固定R4588febb…、准确Change Set及UPDATE_COMPLETE匹配；仅两trust字段变化，原policy/boundary/其它绑定布局保持。一次push/Create/Execute/ff，永久槽已消费，不重放；未读私密值、连接Neon或部署，平台/publisher仍UNPUBLISHED。下一集中真实workflow/R的平台发布绑定及新任务端到端验收，私密读取/调度另审。[完成证据和唯一继续点](docs/aws-auto-deployment-platform-w6i-app-published.md)。下文为历史。

2026-10-20当前：**W6i App双工作流发布/现有worker trust-only受审入口已实现，尚未发布或改trust。** 12新边界+18回归共30项、零警告lint通过，81/76云闭包保持；拟一次非强制push、一Create、一严格准确ARN/模板核验后Execute及本地ff，旧个人worker将失去角色访问权。下一准确无AWS CI后只读准备48小时新SHA，实际发布另批；不读Secret/App key、连Neon、dispatch或部署，平台/publisher仍UNPUBLISHED。[完整范围、风险和命令](docs/aws-auto-deployment-platform-w6i-app-publication-review.md)。下文为历史。

2026-10-20 10:43温尼伯：**W6h单窄凭据已按a9b5e2ce…清单安装并独立核验成功。** 一个受保护Secret/固定版本、既有角色密码及LOGIN一事务COMMIT、两次专用TLS只读认证通过；目录/权限除LOGIN外不变，三张控制表仍空。三次Secret写/一SQL事务/一次独立值读取，两个永久槽已消费，不重放。未读App key、发布workflow、改worker trust、dispatch或部署，平台/publisher仍UNPUBLISHED。下一集中最新main上的App发布/trust-only待审清单，旧未发布R/S仅保留证据，不直接推送。[完成事实、原件和唯一继续点](docs/aws-auto-deployment-platform-w6h-credentials-installed.md)。下文为历史。

2026-10-20当前：**W6h精确27触发器兼容、单窄凭据安装入口与App发布材料准备代码完成，未安装/激活。** 38本机检查和零警告lint通过；只读确认新Secret缺席、仍NOLOGIN及准确快照匹配，兼容仍未批准。拟1个空Secret→Source-only保护→固定版本→一事务LOGIN，再独立只读认证；App私钥不读/不复制。下一准确新CI通过后生成48小时凭据SHA；App两workflow/两trust字段材料仅不可达Git对象，另审发布，runtime仍UNPUBLISHED。[具体范围与完整风险](docs/aws-auto-deployment-platform-w6h-activation-review.md)。下文为历史。

2026-10-20当前：**W6g可信publisher实际I/O适配器及LOGIN前只读权限审计完成，准确CI已全通过，未激活。** 固定TLS/owner/OID/函数体、S3版本摘要、准确GitHub run、两段固定SQL及单阶段写预算；28项本机/零警告lint、CI39432718217真实PG适配器/权限负例/类型/构建通过。Neon发现27个旧PUBLIC invoker触发器，逐个摘要已记，兼容仅提案、不自动放行/撤权；LOGIN/Secret/AWS/dispatch仍0，平台与publisher仍UNPUBLISHED。下一集中兼容与窄凭据/App发布材料，不扩身份实验。[实现、实际阻断和继续点](docs/aws-auto-deployment-platform-w6g-publisher-io.md)。下文为历史。

2026-10-20当前：**W6f NOLOGIN控制账本已单次原子安装，独立新连接核验通过。** 1角色/1 schema/3空表/9函数体/7窄EXECUTE准确匹配，COMMIT ACK及10原件摘要已保存，永久槽已消费、禁止重放。未设密码/LOGIN、读Secret/App key、改AWS或业务状态；平台仍UNPUBLISHED。下一集中可信publisher生产I/O、窄凭据与App云发布接线，具体安装/权限/部署另审，不再身份探针。[完成证据与唯一继续点](docs/aws-auto-deployment-platform-w6f-control-installed.md)。下文为历史。

2026-10-20更新：**应用户要求，W6f NOLOGIN账本安装清单改为7天（168小时），安装范围不变、生产未执行。** 12安装+6 publisher检查及零警告lint通过；仅该准备窗口延长，执行前源码/CI/目录fresh核对、同一永久槽及不自动重试保持。旧203cda41…清单保留但不执行，新源码准确CI后生成新SHA，明确完整日期与America/Winnipeg时区；其它权限启用/部署窗口不变。[范围、风险与命令](docs/aws-auto-deployment-platform-w6f-control-install.md)。下文为历史。

2026-10-20当前：**W6f最小激活先落控制账本，单次原子安装/独立目录核验入口已实现，未生产安装。** 复用原SQL，只拟1 NOLOGIN角色/1 schema/3表/9函数/7窄EXECUTE；10新+6回归通过，Neon18.6只读确认目标缺席、无业务行读取或写入。下一准确临时PG CI验证后生成48小时安装SHA；不设密码/LOGIN、读App key/dispatch或改AWS。后续publisher/窄凭据/App发布集中准备，不再扩身份探针。[完整风险和最短路线](docs/aws-auto-deployment-platform-w6f-control-install.md)。下文为历史。

2026-10-19当前：**W6e真实App身份验收成功，令牌撤销204已观察；尚非AWS部署授权。** 单次run39312477081成功，actor/sender/nonce/caller/冻结源码及公开artifact摘要独立比对通过，新槽保留不重放。未改AWS/SQL、workflow或激活平台。下一收口控制器SQL/可信publisher生产接线与App云发布最小激活清单，不再做身份探针，实际安装/权限/部署仍另审。[完成事实、原件与下一步](docs/aws-auto-deployment-platform-w6e-app-identity-verified.md)。下文为历史。

2026-10-19当前：**W6e无AWS实际App身份验收的单次调度/独立Inspect入口已实现，尚未执行。** 绑定真实workflow389772013、fresh caller/nonce及15项pin；槽先于读钥、ACK先于立即撤权，Inspect只读准确run和公开proof，不自动重试或代批环境。下一最终main准备48小时fresh清单，再单独批准真实PEM/token/一次dispatch；本轮没有这些操作或AWS/SQL调用。[完整范围、风险与继续命令](docs/aws-auto-deployment-platform-w6e-app-identity-dispatch.md)。下文为历史。

2026-10-19当前：**W6d身份工作流已按cf521abb清单单次发布并独立核验，尚未调度。** workflow389772013、准确内容/发布commit及本地main快进均匹配，永久槽已占用；未读App key/mint token、改AWS/SQL或激活平台。下一只准备一次无AWS真实App身份调度验收，新私钥/token/dispatch范围仍单独批准，不重跑发布。[完成事实、原件及唯一继续点](docs/aws-auto-deployment-platform-w6d-identity-publication-executed.md)。下文为历史。

2026-10-19当前：**W6c准确CI已全成功（16步骤、12组真实临时PG检查），W6d“仅发布身份工作流”的受审入口已完成。** 8项定向检查/零警告lint通过，准备不挂ref的单文件Git对象并绑定48小时fresh SHA；尚未发布、读App key、调度、改AWS/SQL或激活平台。下一只审最终发布清单，不重做CI或扩支线；发布后身份dispatch仍另审。[范围、完整风险与继续命令](docs/aws-auto-deployment-platform-w6d-identity-publication-review.md)。下文均为历史快照，旧queued结论已被[成功证据](ops/aws-sandbox/reviews/platform-cloud-v6.verified.json)取代。

2026-10-19最新：**W6d身份草稿已固化，不可执行；最终job日志已确认12组PG检查通过，但CI元数据仍queued，整轮success未确认。** 用户UI无额外提示、无待批环境，准确attempt接口也与已完成日志不一致，不猜额度/权限原因。候选保留在非.github目录，本轮未重跑/新增CI、读key/调度或改AWS/SQL。下一只回读原CI终态，确认成功后定稿fresh发布SHA；当前无需用户点击或升级。[证据、风险和继续点](docs/aws-auto-deployment-platform-w6d-identity-publication-review.md)。以下为历史。

2026-10-19最新：**W6c云V6候选、无AWS实际App身份候选和可信导入代码已实现，未发布/启用。** Review/RunOnce/Inspect复用原部署核心，固定OIDC/角色/版本化材料；可信导入重建完整manifest和准确run，分开写待审计划/证明，不自动批准。旧76闭包/个人V5工作流/trust/永久槽保持；本轮未读真实key或改AWS/Neon。下一准备一次无AWS真实actor发布/调度清单，再另审安装/发布并验收新任务。[实现、剩余接线和风险](docs/aws-auto-deployment-platform-w6c-cloud-candidate.md)。以下为历史。

本阶段本机105项/类型/lint/构建通过；最终源码ca2b38d的[无AWS CI39278613827](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39278613827)仍排队，真实PG导入待验证，不能冒充云端通过。下一只回读此run，不重做实现或追加CI轮次；[准确继续记录](ops/aws-sandbox/reviews/platform-cloud-v6.prepared.json)。

2026-10-19最新：**W6b真实App只读认证成功，令牌撤销HTTP204已观察，本地回执独立回读通过。** 按22dc06b2清单一次读取固定PEM、创建单仓最小read token、六请求完成；永久本地槽已占用，不重跑。未调度/改AWS/Neon/业务或启用控制器；真实actor与V6发布/可信导入仍待后续实现及另审，W6未完成。[完成事实、证据及唯一继续点](docs/aws-auto-deployment-platform-w6b-app-auth-completed.md)。以下为历史，旧“未读钥”仅表示当时准备状态。

2026-10-19最新：**W6b 一次 App 只读认证入口及48小时待审清单已准备，未执行。** 固定现有PEM/ACL元数据和九项源码，永久本地槽先于读钥；最多一次最小read token及finally一次撤销，六API白名单，不调度/改AWS/SQL/启用运行时。真实私钥内容未读，App身份/撤销尚未实测；响应丢失或撤销失败不自动重试。[范围、完整风险及命令](docs/aws-auto-deployment-platform-w6b-app-auth-review.md)。以下为历史。

该入口准确源码 `30bdcfd` 的[无AWS CI 39273460659](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39273460659)已独立回读全步骤成功，含真实临时PG九组检查；本机10新增+73原相关测试共83项/类型/lint/构建通过。最终待批SHA `22dc06b289f5964464ec27f537540d68a006f20fd68d391239956af3bbf48782`，截止2026-10-21 09:55:37温尼伯时间；它不授权旧job重放或其它步骤。[准备验证记录](ops/aws-sandbox/reviews/platform-controller-auth-v6.verified.json)。

2026-10-19最新：**W6b 平台控制器候选已编码，未激活，W6 未完成。** 新管理员 API/页面、App 内存认证客户端及独立审批/intent/ACK 账本接线；SQL 候选不在自动迁移中，角色初始 NOLOGIN，环境变量不能绕过 UNPUBLISHED 绑定。UNKNOWN 不重发，GitHub success 不冒充部署验收；旧工作流/云闭包/槽不动。未读取真实 PEM、安装 Neon、mint App token、dispatch 或改 AWS；新云 worker 与可信 capsule/证据导入仍待后续实现和受审接入。[代码范围、完整风险及下一步](docs/aws-auto-deployment-platform-w6b-controller-implementation.md)。以下为历史。

2026-10-19最新：**W6b App 注册/安装已由用户报告，尚未验收或激活。** App 5381160、installation 173033406；仅候选 bot 344813947 的公开 API 核对通过，不证明安装权限/单仓范围或实际调度身份。误生成的未用私钥已记录，未读取、使用或自动轮换，先核对保管状态及非敏感设置；不重建 App、不触发部署，原准备清单/云闭包/工作流保持。[当前状态与继续边界](docs/aws-auto-deployment-platform-w6b-controller-plan.md)。以下为历史。

2026-10-19最新：**W6b 控制器路径定案，单仓 GitHub App 注册清单待批准。** 复用本地平台和 Neon 独立审批账本，不新增常驻控制服务；旧 caller/runtime 固定个人 actor，后续候选绑定实测 App 身份，不能只换 token。已编码公开注册预填/元数据窄输出核对、九文件摘要清单及无凭据校验；未注册/安装/读 key/改 SQL/dispatch/部署。Actions write 是仓库级权限，注册安装单独确认，旧两部署 workflow/IAM/云闭包保持。[具体方案、完整风险和下一动作](docs/aws-auto-deployment-platform-w6b-controller-plan.md)。以下为历史。

2026-10-19最新：**W6a平台只读部署进度面板已实现。** 管理员实例页回显匹配当前数据库回执的Review/RunOnce/Inspect历史运行、批准与验收摘要、承载标签倒计时；新待审任务不借用旧成功，不声称实时在线。原归档digest固定，真实Neon只读核对匹配；不新建任务/dispatch/改IAM或启用队列。W6b身份、固定任务参数化和审批持久化已集中列出待审边界，尚未实现云调度。新增无AWS CI；代码/文档沿用两个main。[实现、验证与W6b继续位置](docs/aws-auto-deployment-platform-w6.md)。以下为历史。

2026-10-18最新：**W5r真实受控云部署闭环已独立验收通过。** Review 39200031548、RunOnce 39200300265、独立Inspect 39200910036均成功；一次七资源CreateStack、两认证GET、原任务完成，旧READY/前驱任务保持。三阶段分别fresh批准及人工environment批准；IAM/云C/R/工作流不改，旧失败及全部永久槽保留。此结论限一条已有初始化sandbox任务，不是任意租户或整套平台已AWS上线。资源继续保留并可能收费，50 USD目标不是硬cap；不自动清理/续期/重放或创建新请求。[完成事实、证据及继续边界](docs/aws-auto-deployment-cloud-worker-w5r-completed.md)。以下为历史。

2026-10-18最新：**W5r本机审批交接已实现，未开始新云轮次。** W5q云Review成功，但RunOnce实际开始晚于15分钟窗口；任务/业务/五云槽未变，失败原件和本地旧槽永久保留。新增一次只读Handoff直接回读Review并生成下一SHA/范围，RunOnce不足8分钟余量就在本机停止；不改云时间、IAM、C/R或部署工作流，旧入口保持。Review-v6/RunOnce与Inspect-v5独立槽，下一最终main无AWS CI后只读Prepare，实际动作fresh另批并先确认可连续人工审批。[范围、失败事实及完整风险](docs/aws-auto-deployment-cloud-worker-w5r-approval-handoff.md)。以下为历史。

2026-10-18最新：**W5q已接线修正后policy的同任务云Review续接，未调度。** 新本机严格metadata核验绑定W5p 31原件/164历史pins，旧W5o断言和失败槽保持；Review-v5/RunOnce与Inspect-v4独立槽，原job/云C/R/76闭包/工作流/权限不再改变。下一最终main两项无AWS CI通过后仅只读Prepare并请fresh SHA；不领取/部署或重新发布。[完整风险和继续命令](docs/aws-auto-deployment-cloud-worker-w5q-corrected-review.md) / [准备记录](ops/aws-sandbox/reviews/cloud-worker-w5q-corrected-review.prepared.json)。以下为历史。

2026-10-18最新：**W5p单项读取权限已修正，独立Inspect通过。** 按b212b017批准完成一次Create/严格Policies-only核验/Execute，foundation为UPDATE_COMPLETE；仅DescribeTaskDefinition的Resource改为*、保留ca-central-1，持续扩大区域读取能力，不自动撤权。trust/boundary/五资源身份/云C/R/76闭包保持；未读Secret值、dispatch、领取或部署，31份原件及新旧槽保留。下一只将本机Review核验显式绑定新policy及独立Review-v5槽，另备fresh清单；不能复用旧W5o核验或把配置回读当真实worker授权验收。[完成事实和唯一继续点](docs/aws-auto-deployment-cloud-worker-w5p-corrected.md) / [执行证据](ops/aws-sandbox/reviews/cloud-worker-w5p-task-definition-read.executed.json)。以下为历史。

2026-10-18最新：**W5p单项读取授权修正入口已准备，未改AWS。** W5o Review-v4失败的明确阻断是DescribeTaskDefinition的无效ARN级Allow；任务/业务/证据目录未变，无成功manifest，旧槽保留。候选只将该现有inline声明Resource改为*并保留ca-central-1，会持续扩大区域任务定义读取范围，须fresh另批；trust/boundary/写权限/云C/R/76闭包不改。7新+相邻回归共72本机通过；下一最终main无AWS CI后只读Prepare准确Create/严格核验/Execute清单，不执行、不重跑Review或部署。[完整风险与继续位置](docs/aws-auto-deployment-cloud-worker-w5p-task-definition-read.md) / [准备记录](ops/aws-sandbox/reviews/cloud-worker-w5p-task-definition-read.prepared.json)。以下为历史。

2026-10-18最新：**W5o已接线ECS修复版的原任务Review/RunOnce/Inspect，尚未调度。** 云C=d8cb996/R=7f0fbf2、76闭包/两工作流/权限不改；Review-v4和后续v3独立槽，W5l失败/旧槽保留。152历史pins/27发布原件/修复及失败证据门禁保持，9新+相邻回归共65本机通过；旧DNS测试改用历史fixture，新测试检查当前真实工作流。下一最终main无AWS CI后只读Prepare新Review清单，再请fresh SHA；不重新发布、领取或部署。[完整范围及继续命令](docs/aws-auto-deployment-cloud-worker-w5o-review-continuation.md) / [准备记录](ops/aws-sandbox/reviews/cloud-worker-w5o-review-continuation.prepared.json)。以下为历史。

2026-10-18最新：**W5n ECS缺失兼容修复已发布，独立Inspect通过。** 用户确认f51a4de2后完成一次双workflow发布、现有角色trust-only Create/严格核验/Execute及本地FF，栈UPDATE_COMPLETE；运行C=d8cb996、R=7f0fbf2、caller S=68a476b，76闭包70ee60eb保持，无权限扩张。27份原件/新永久槽及旧失败槽保留，未读Secret值/dispatch/领取或部署。下一只显式接线新C/R、准备原held job的新云Review；旧W5l不能重用，实际Review/RunOnce仍fresh另批，不重做发布或扩支线。[完成事实及唯一继续位置](docs/aws-auto-deployment-cloud-worker-w5n-published.md) / [执行证据](ops/aws-sandbox/reviews/cloud-worker-w5n-ecs-publication.executed.json)。以下为历史。

2026-10-18最新：**W5n修复版受审发布入口已实现，尚未发布。** 只替换两份固定workflow及现有角色trust的准确R引用；新schema/独立发布槽，旧W5k及失败Review-v3记录/槽保持，142历史Git pins/26发布原件/W5m修复证据门禁保留。候选76闭包仍70ee60eb，9新+61回归共70项本机通过；下一最终main无AWS CI后只读Prepare，再请fresh SHA批准单次push/Create/严格核验/Execute与独立Inspect。不扩权、不调度Review/领取或部署。[完整风险和命令](docs/aws-auto-deployment-cloud-worker-w5n-ecs-publication.md) / [准备记录](ops/aws-sandbox/reviews/cloud-worker-w5n-ecs-publication.prepared.json)。以下为历史。

2026-10-18最新：**W5m仅代码修复/测试，未发布或重跑。** 用户允许结束失败main冻结；只在准确服务唯一MISSING与同服务ListTasks HTTP400/ServiceNotFoundException同时成立时兼容空任务，其余异常和全部原门禁保留。8新+53回归共61项本机通过；76云闭包仅provider变化并更新本地ROOT绑定。实际云C/R、权限/旧槽/业务不改，旧Review-v3失败且无manifest；下一推进发布需另行请求及fresh审批，不直接使用旧入口。[修复范围与继续边界](docs/aws-auto-deployment-cloud-worker-w5m-ecs-absence-fix.md) / [记录](ops/aws-sandbox/reviews/cloud-worker-w5m-ecs-absence-fix.prepared.json)。以下为历史。

2026-10-18最新：**W5l同任务云Review的本机新版本衔接已实现，未调度。** 固定W5k已发布C/R不变，Review-v3、RunOnce/Inspect-v2独立槽，七输入/准确ACK/条件版本/冻结caller合同保持；核对134历史Git pins、26发布原件、旧失败和管理员来源，再核对实际布局/业务/最终main无AWS CI。旧controller/记录/槽保留，兼容测试改读历史caller，新测试直接查当前工作流。下一最终CI后只读Prepare准确原job的新Review清单并请fresh SHA，不重新发布/扩权/领取或部署。[完整风险及继续命令](docs/aws-auto-deployment-cloud-worker-w5l-review-continuation.md) / [准备记录](ops/aws-sandbox/reviews/cloud-worker-w5l-review-continuation.prepared.json)。以下为历史。

2026-10-18最新：**W5k DNS修复固定版本已发布并独立Inspect通过。** 获批62bbe2c1清单下完成一次双workflow非force发布、一trust-only Create/严格核验/Execute及本地FF；栈UPDATE_COMPLETE，角色/权限/固定材料及Neon目录保持。运行C=e55367c、reusable R=46312ff、caller S=d25c97f，发布槽永久保留，26原件摘要已记；未读Secret值/dispatch/领取或部署。下一仅接线同held job的新云Review准备，旧W5i固定旧版本不可重用，实际Review另批；不重做发布或扩支线。[完成结果与继续位置](docs/aws-auto-deployment-cloud-worker-w5k-published.md) / [执行证据](ops/aws-sandbox/reviews/cloud-worker-w5k-dns-publication.executed.json)。以下为历史。

2026-10-18最新：**W5k DNS修复的受审发布入口已实现，尚未执行。** 新执行schema/fresh SHA、单次永久槽、一push/一Create/一Execute、严格准确ACK ARN与trust-only模板/ChangeSet门禁、部分失败只读Inspect；不自动补齐/回滚/重试/dispatch。96项/类型/lint通过，129旧pins和76闭包保持，实际工作流/trust/Secret/业务未改。下一最终main CI成功后只读Prepare新执行清单，请用户准确新SHA批准；旧823d准备材料不能执行。[完整风险与命令](docs/aws-auto-deployment-cloud-worker-w5k-dns-publication.md) / [准备状态](ops/aws-sandbox/reviews/cloud-worker-w5k-dns-publication.prepared.json)。以下为历史。

2026-10-18最新：**W5j DNS规范化小修复及发布材料准备入口完成，未发布云版本。** 用户同意结束失败Review冻结；只修末尾点/dualstack转义及ROOT摘要绑定，云闭包仍76且仅provider一项改变；另纠正旧测试对已安装workflow的“不存在”断言，88项/类型/lint通过。Prepare只生成无ref移动的R2/S2候选与既有trust固定SHA替换提案，工作流/IAM/Secret/Neon/旧槽不改，不重跑Review或部署；现有云仍旧C/R。实际版本切换另建受审入口并fresh批准，不用准备材料代替执行授权。[范围、完整风险及继续位置](docs/aws-auto-deployment-cloud-worker-w5j-dns-fix.md) / [准备状态](ops/aws-sandbox/reviews/cloud-worker-w5j-dns-fix.prepared.json)。以下为历史。

2026-10-18最新：**W5i单次Review dispatch返回422，独立确认无新run、业务不变；本机参数映射已修正，未重发。** runtime-only installationSha误入外部七字段合同；已改投影并新增真实workflow定义回归，30项/类型/lint通过，116旧pins/76云闭包/工作流不动。旧Review-v1槽永久保留，下一只准备绑定新独立v2槽的fresh Review清单，再请准确新SHA批准；旧授权不复用，不领取/部署。[失败证据与完整新风险](docs/aws-auto-deployment-cloud-worker-w5i-dispatch-recovery.md) / [机器记录](ops/aws-sandbox/reviews/cloud-worker-w5i-dispatch.stopped.json)。以下为历史。

2026-10-18最新：**W5i准确job的单次云调度/回读接线已完成，尚未调度。** 新11+原17检查通过、类型/定向lint通过，原116pins/76闭包/两工作流不动；Review、RunOnce、Inspect各自fresh批准/新永久槽，未知ACK不重试。下一在最终clean main只读Prepare准确job_ecbf09030d3da7286ea3ef93的Review清单，再批准固定DB读取+一个私有S3 manifest写；不领取/部署。后两模式预先备好以免云Review后15分钟窗口内改main；实际Review后冻结caller SHA，不自动扩大授权。[完整风险和命令](docs/aws-auto-deployment-cloud-worker-w5i-job-dispatch.md) / [准备记录](ops/aws-sandbox/reviews/cloud-worker-w5i-job-dispatch.prepared.json)。以下为历史。

2026-10-18最新：**W5h真实管理员新请求已登记，独立回读通过且本机入口已关闭。** 新job_ecbf09030d3da7286ea3ef93 pending/attempt0/max1/审核挂起，无lease/云授权；原9行和3旧job完整摘要不变，无AWS写/Secret值/dispatch/领取或部署。端口主机可见性误判、只读工具raw-int8/JSONB类型差异均已更正并保留失败记录，未改生产代码或重试提交。下一只准备该准确job的云Review新批准（固定DB读取+私有S3待审manifest写），不再登记或运行旧根；Review前提交全代码，随后冻结caller main跨RunOnce/Inspect。[实际结果与唯一继续点](docs/aws-auto-deployment-cloud-worker-w5h-request-recorded.md) / [证据](ops/aws-sandbox/reviews/cloud-worker-w5h-request-recorded.json)。以下为历史。

2026-10-18最新：**W5h本地请求入口已获明确批准并开启，等待管理员单次创建heldjob。** 仅127.0.0.1:3100，request ON/worker/apply OFF，健康/登录200、未登录API401；未代登录/POST或dispatch/部署。原9行/3成功job摘要已存，提交有任何结果后关闭准确当前listener32800/launcher34096并独立回读，不重试。准备期隔离端口诊断不代表主机空闲，已更正：只替换原default-OFF项目进程，无文件删除或业务重试。[人工动作、准确进程和完整风险](docs/aws-auto-deployment-cloud-worker-w5h-request-entry.md) / [开启回执](ops/aws-sandbox/reviews/cloud-worker-w5h-request-entry.activated.json)。以下为历史。

2026-10-18最新：**W5h只读前置核对完成，当前只缺一条新的真实管理员待审请求。** 12次AWS读/1个Neon只读事务确认旧3任务成功无活动、新待审0、旧七资源栈删除、ECS空闲、固定镜像扫描无报告HIGH/CRITICAL。父Cell旧过期标签保留，沿用独立child窗口，不续期或重建。复用现有页面/协议14项检查通过，无新业务代码或云模拟，116旧pins保持。下一只请求批准临时loopback入口，由管理员单次登记heldjob；尚未开启入口/写DB/dispatch或部署。[实际盘点、准确下一范围及完整风险](docs/aws-auto-deployment-cloud-worker-w5h-request-entry.md) / [证据](ops/aws-sandbox/reviews/cloud-worker-w5h-request-entry.prepared.json)。以下为历史。

2026-10-18最新：**W5g真实云VerifyInstall已完成，独立公开proof核验通过。** 用户人工批准准确run39126114772后，真实OIDC/STS身份、固定S3绑定、一次固定DB Secret读取/窄角色只读catalog均成功，control Secret读/云与DB写0；未部署租户。18新原件/116pins及旧110pins/28激活原件、107pins/23旧原件完整，新槽永久消费不重跑。下一直接准备新的准确held job及有效Cell窗口下的云Review/RunOnce验收，新增业务/私密/部署变更另审，不重开旁支。[完成结果与下一范围](docs/aws-auto-deployment-cloud-worker-w5g-verified.md) / [机器证据](ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.executed.json)。以下为历史。

2026-10-18最新：**W5g按a44dfaff批准只dispatch一次，已取得准确run 39126114772，首次独立Inspect为waiting。** 新永久槽已消费，不再Review/Dispatch或rerun。下一仅用户在该准确run人工批准techlong-sandbox-deploy，再独立只读Inspect公开proof；目前不称云端OIDC/DB验收通过，不部署资源。排队head固定90693a8，后续文档提交不替换它。[准确链接、待审批状态与继续命令](docs/aws-auto-deployment-cloud-worker-w5g-dispatched.md) / [ACK及原件摘要](ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.dispatched.json)。以下为历史。

2026-10-18最新：**W5g单次VerifyInstall调度/准确运行回读入口已实现，尚未dispatch。** 只接现有冻结C/R与固定S3/DB版本；fresh SHA、新永久槽、一次带run ID ACK的POST、人工environment审批、独立公开proof回读，不自动rerun或部署。新9+原14测试、类型/定向lint通过，云运行源码/原110pins不改。Source首次只读核对不可用，用户已报刷新；下一仅最终clean main只读Review及新SHA确认，当前云写/Secret值/新槽0。[最小范围与完整风险](docs/aws-auto-deployment-cloud-worker-w5g-verify-install.md) / [准备证据和继续点](ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.prepared.json)。以下为历史。

2026-10-18最新：**W5f已按f8786e44批准完成六项激活提交，独立Inspect通过，未运行云worker。** environment仅main/唯一人工reviewer/admin bypass=false、准确S3绑定版本、两固定工作流发布及foundation仅trust更新均验证；原IAM/边界/Secret版本和Neon目录保持。110源pins/28新原件及107旧pins/23旧原件核对，通过后本地main已ff-only同步；Secret值/原包/dispatch/job或部署写0。下一仅另审单次VerifyInstall，验证真实OIDC和固定数据库Secret/只读catalog，不自动触发或部署、不重开支线。[执行结果与唯一继续点](docs/aws-auto-deployment-cloud-worker-w5f-activation-executed.md) / [机器证据](ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json)。以下为历史。

2026-10-17最新：**W5f集中激活入口/冻结源码工作流已准备并通过云CI，未激活。** 新reusable不再检出变化main；本地独立index可生成两枚准确待审提交对象，不建分支/移动main，批准后一次ff发布。拟6顶层提交：environment/main规则、公开绑定私有S3对象、两文件发布、foundation仅trust ChangeSet创建/执行；不自动dispatch或部署。新14项、原60及续接25/真实PG18证明通过，原ZIP/76闭包/107旧源码保持。下一只最终main准备对象、只读fresh Review及新SHA批准；源码之外的实际工作流/environment/IAM/S3仍0写，Secret值/原包0读。[完整范围与风险](docs/aws-auto-deployment-cloud-worker-w5f-activation.md) / [CI证据及继续位置](ops/aws-sandbox/reviews/cloud-worker-w5f-activation.prepared.json)。以下为历史。

2026-10-17最新：**W5e-C1按0f0e2c02批准单次完成，独立Inspect通过，Locked安装已完成。** 复用固定DB版本Get1/原包1、缺失控制Put1、Neon事务1且COMMIT ACK、真实窄角色catalog认证1；DB Secret写/新密码0，第一轮元数据通过。实际role/schema/四函数OID及准确Secret版本已保存公开绑定 `0edfa9d7…`；107源、23回执/槽、旧99源码/25原件保持。deny-all trust及旧IAM/DDB/S3保护不变，部署worker未激活/无job或workload写，不是自动部署已上线。下一只准备集中的OIDC/workflow/公开绑定激活审批，不重开恢复或模拟支线。[实际结果与继续位置](docs/aws-auto-deployment-cloud-worker-w5e-neon-continuation-executed.md) / [机器证据](ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.executed.json)。以下为历史。

2026-10-17最新：**W5e-C1复用已存数据库版本的窄续接已编码并通过云CI，未执行。** 一个准确固定版本Get、一次原控制包新读、一个缺失控制版本Put和一个Neon事务，数据库Secret写/新密码生成0；新独立槽，先API ACK落盘、最多5轮只读发布核验，具体检查点/固定断言脱敏。新15+旧10测试、真实PG18十组以及原60回归/十五组通过，76闭包不变、原99源码/两旧槽/原件保持；首轮CI漏装独立依赖已修正并保留失败产物。下一仅最终main只读fresh Review和新SHA批准，不读生产值或激活部署。[完整新范围及风险](docs/aws-auto-deployment-cloud-worker-w5e-neon-continuation.md) / [CI与证据](ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.prepared.json)。以下为历史。

2026-10-17最新：**W5e-R1按4f82199f批准单次执行，数据库Secret固定版本已保存，随后停止。** 独立Inspect确认数据库唯一AWSCURRENT版本/隔离策略、控制Secret仍空、Neon role/schema不存在且catalog未变、foundation完整Locked。1次私密包读取/密码生成、Put尝试及ACK各1，Neon写0；写后具体检查失败原因未保存，不伪称传播或权限问题。新旧槽永久保留，未改IAM/激活/部署；99源和25旧原件复核。下一如获新授权，只准备复用已存数据库版本的窄续接，不重跑或自动读Secret值/补齐。[实际结果与继续边界](docs/aws-auto-deployment-cloud-worker-w5e-neon-recovery-partial.md) / [证据](ops/aws-sandbox/reviews/cloud-worker-w5e-neon-recovery.executed.json)。以下为历史。

2026-10-17最新：**W5e-R1兼容恢复入口和清单合同已准备，未执行。** 仅复用准确Locked基础栈和两空Secret；新独立槽，原密码经TLS/Neon SQL，先两固定Secret版本后一个Neon事务，脱敏SQLSTATE/ACK分开记录。云CI 60项、新10组真实PG18（非超级用户创建者）及原15组通过，原ZIP/76闭包独立核验；提供者GUC模拟，不冒充真实Neon托管转发成功。原90源码/25原件/旧槽不变，下一最终main只读fresh Review后请用户新SHA批准，不自动恢复/重读私密包/激活/部署。[恢复完整风险](docs/aws-auto-deployment-cloud-worker-w5e-neon-recovery.md) / [证据](ops/aws-sandbox/reviews/cloud-worker-w5e-neon-recovery.prepared.json)。以下为历史。

2026-10-17最新：**W5e已按439ab7dc批准单次执行，Neon阶段停止，不能激活。** 五资源foundation完整Locked、两Secret已隔离但没有值，私密包校验1次；AWS安装请求5/Neon事务尝试1，无重试或补齐。两次独立只读确认目标Neon角色/schema/函数不存在，旧IAM不变；发现SCRAM预哈希与Neon接口冲突，是实现未复用既有兼容结论的遗漏，未保存原异常故不伪称唯一根因。旧槽永久保留，下一只准备新的TLS原密码兼容恢复清单，不重跑旧安装、不再建栈/Secret或自动重读私密材料。[部分结果与继续位置](docs/aws-auto-deployment-cloud-worker-w5e-partial.md) / [原件摘要](ops/aws-sandbox/reviews/cloud-worker-w5e.executed.json)。以下为历史。

2026-10-17最新：**W5e一次性Locked安装器已完成候选验收，尚未安装或激活。** 已接源/动作/fresh SHA、固定单次槽、五资源foundation、先隔离后写值的两Secret、Neon角色/四函数原子安装及独立Inspect；候选工作流仍在非活动目录。云CI 50项及真实PG18十五组通过，原ZIP/76源码闭包独立核验、旧99 pins保持。下一只生成fresh集中Locked安装审批，不直接启用OIDC或部署。真实ID核验后单独收口激活，不扩观察器支线。[完整风险](docs/aws-auto-deployment-cloud-worker-w5e-installer.md) / [准确证据及继续位置](ops/aws-sandbox/reviews/cloud-worker-w5e.prepared.json)。以下为历史。

2026-10-17最新：**W5d集中安装盘点/材料已准备，未执行安装。** 实际AWS/GitHub/Neon catalog只读核对完成；发现并绑定新版immutable OIDC subject，候选为五资源foundation、Neon窄角色/四函数、两个先隔离再写值的Secret及受审workflow。现有task宽Secret读取需用新Secret资源策略隔离，不改旧IAM。AWS策略/模板只读验证通过（有已说明warning/suggestion），云CI 42项及PG18十二组通过，原件/75闭包/旧99 pins保持。没有可执行批准清单、未读Secret值或部署；下一直接封装一次性安装入口与fresh source/action SHA，再集中确认安装。见 [具体范围、风险和继续位置](docs/aws-auto-deployment-cloud-worker-w5d-install-review.md) / [只读证据](ops/aws-sandbox/reviews/cloud-worker-w5d.prepared.json)。以下为历史。

2026-10-17最新：**W5c统一云执行根与最小Neon权限合同已完成候选验证**。一个Review/RunOnce/独立Inspect接五个永久槽、七资源一次建栈、最小Secret及两认证GET、同job原子完成和私有条件写回执；W4c之后沿革可继续，无需每次改源码。云端36项回归、真实PG18十二组（含并发/越权/回滚）及75文件闭包通过，原ZIP/五回执独立核对；旧99 pins保持。未安装权限/读生产私密值或部署，不是无人值守已上线。下一集中盘点/审核最小云安装资源，不扩观察器。见 [W5c实现、完整风险及下一范围](docs/aws-auto-deployment-cloud-worker-w5c.md) / [准确云CI证据](ops/aws-sandbox/reviews/cloud-worker-w5c.prepared.json)。下方进度为历史。

2026-10-17当前进度：**W5b云adapter与最小材料候选已完成**：SDK替代本机CLI/Login、独立依赖锁、准确W4c :5沿革公开capsule和受限JWT/mTLS Secret接口；本地29项、Linux 20+8项/60文件闭包通过，原始回执独立核实。尚未启用执行入口/安装权限或读取真实私密值；下一收口一个Review/Run/Inspect根及最小Neon权限合同，不重复W4c验收或扩支线。见 [W5b实现、验证与继续位置](docs/aws-auto-deployment-cloud-worker-w5b.md)。

2026-10-17当前进度：W4c真实闭环已完成，现推进 **W5云端单次worker**。W5a独立DynamoDB永久围栏及无AWS凭据的Actions验证工作流已完成，两轮云临时服务各7组通过、原始回执/清理独立核实；本地17项相邻测试/type/lint及旧99 pins通过。未安装/启用AWS资源，下一W5b云provider与最小材料，不重复请求/部署验收。见 [本次实现、云CI边界及继续位置](docs/aws-auto-deployment-cloud-worker-w5a.md)。

当前唯一主线（2026-10-16）：**先完成AWS自动部署，最后整套系统在AWS上线；不发布Sites，F3c9等支线冻结。** W4c本地管理员真实请求 `job_fe5ced28b698d0bf128e7b42` 已单次部署成功并独立Inspect通过：准确同job succeeded/lease清除、七资源新栈:5/aa96、两认证GET、旧ready/store/历史保留。五槽永久消费不可重放，本地结果展示三gate OFF，新承载10月17日01:35:34 CDT固定到期、不保证准时停费。下一仅准备执行器云化/材料迁移，不重复验收或先迁整个平台。见 [实际结果、原件及继续位置](docs/aws-auto-deployment-aurora-dual-mode-w4c-executed.md) / [主线与完成标准](docs/aws-auto-deployment-mainline.md)。下方为历史，不作为当前指令。

2026-10-08 F3b3 PG18/source-v3切片完成：固定PG18.6镜像的GitHub临时服务两次success（11/14组真实证明），数据库drop/容器stop与原ZIP/digest独立核对；无需本地Docker，未使用AWS/Neon凭据。新增独立只读schema3 source，精确证书/原件/永久fence与inline catalog指纹校验、不执行可替换helper、完整保留raw witness与future部署可见性。152项相邻回归/type/lint/build通过。未Neon安装/登记或把v3接入删除入口，旧source/root和规划门禁保持。下一步v3 freshness/admission/authority/deletion适配。见 [真实PG18证据与继续位置](./docs/aws-auto-deployment-fast-track-f3b3-pg18-ownership-v3.md)。以下保留历史。

2026-10-08 F3b3密封schema切片完成：未注册候选含两内部表/八函数/十六Always guards，覆盖九类表的十个引用列、永久原件保留与版本化fence；真实隔离PG16.14通过11组保护/并发证明且server已停，9项定向检查/type/lint通过。Neon实际只读确认十个FK/空新槽位、旧记录保留，但其版本为18.6，不能将PG16证明视为线上兼容。未安装schema/登记/新ownership source，旧严格查询和业务状态不改。下一步PG18隔离验证与独立版本化ownership接线。见 [候选、真实证据与边界](./docs/aws-auto-deployment-fast-track-f3b3-sealed-schema-candidate.md)。以下保留历史。

2026-10-08 F3b3独立Executor v2切片完成：旧Janitor身份/协议保持不变，新入口固定专属role，schema2计划SHA绑定协议/完整role ARN，持久化intent/receipt隔离旧版本，单次删除与只读恢复约束保留。143项相邻回归/type/lint/build及新ZIP自检通过；AWS只读确认新role ABSENT，没有创建。旧规划密封隔离协议仍为候选，无DDL/新source接线，严格零租户门禁仍1/1。未安装IAM/Secret/函数或启用Worker。见 [新产物、证据与下一小阶段](./docs/aws-auto-deployment-fast-track-f3b3-dedicated-executor-v2.md)。以下保留历史。

2026-10-08 F3b3只读审阅切片完成：旧pending实例/active订阅及原行保留，live trigger禁止直接迁移environment_id，隔离登记仅为设计，零租户门禁仍1/1。Source刷新后真实AWS核验确认旧Janitor仍PLAN_ONLY；其boundary v2同时作为身份策略附加且显式Deny变更，仅换boundary不能复用。准备独立executor身份修订，当前Janitor绑定产物不能直接改role安装；新候选role存在性仍需单独读取。6项审阅器/类型/lint/AST通过。无云/数据库写或Worker启用，F3b3未整体完成、无可执行安装SHA。见 [准确证据与继续位置](./docs/aws-auto-deployment-fast-track-f3b3-isolation-review.md)。以下保留历史。

2026-10-07 F3b2代码切片完成：接通真实Neon draining→owned cleanup/rollback幂等入队→独立serializable零租户快照，构建独立drain/executor自包含Lambda候选，读写DB角色/Secret不混用。131项清理相邻测试、type/lint/build及无凭据包自检通过；Neon实际READ ONLY EXPLAIN通过，无写入。发现旧planned/plan_only记录1条（资源/作业0），保留并作为零租户门禁；专属DB角色未创建。未安装IAM/函数/调度或启用Worker，完整自动TTL尚未完成。下一步F3b3准备旧记录处置和准确安装审批。见 [F3b2产物、在线只读证据与边界](./docs/aws-auto-deployment-fast-track-f3b2-drain-coordinator.md)。以下保留历史。

2026-10-07 F3b1代码切片完成：复用既有准确Cell删除core，新增永久一次性intent槽位、独立缺失回读及不可变receipt的TTL执行入口和实际SDK组合；不确定/重启/并发只能读恢复，不重复删除。102项相邻清理、129项租户TTL/rollback主链、类型/定向lint/build通过。未安装新权限或Janitor、未启用Scheduler/Worker、未做云/数据库写入；自动drain/事件生产和云端TTL仍未完成。下一步F3b2接生产协调入口与受审artifact/权限材料。见 [F3b1实现、边界与继续位置](./docs/aws-auto-deployment-fast-track-f3b1-cell-ttl-execution.md)。以下保留历史状态。

2026-10-07 F3a2实际完成新prepared root两镜像ECR发布：Actions唯一run37714817734 success，原始云回执与Source独立manifest/config bytes及COMPLETE扫描一致，无报告HIGH/CRITICAL。Source立即Revoke后独立Locked/v6；CloudFormation实际清理旧policy v3/v4，写前原文备份保留但云version ID不可恢复。六份旧镜像保留、当前共八份，Cell仍MISSING；未部署ECS/上传baseline/启用Worker。新批准slot已消费、窗口过期，不重跑。下一代码切片为owned-resource可执行TTL/失败清理，其他权限和付费资源另按fresh范围批准。见 [F3a2发布、撤权及独立证据](./docs/aws-auto-deployment-fast-track-f3a2-ecr-published.md)。以下保留历史状态。

2026-10-07 F3a完成集中在线只读核验和原始候选ZIP/收据保存，Aurora16.14/db.serverless可用，Cell缺失、publisher仍Locked/v4；自动清理/证书mTLS/DNS/专属IAM/baseline/读cap/线上50USD预算等仍有缺口，付费部署未放行。官方区域4h核心验收估算约0.84USD但不含额外费用，不是上限；常驻明显超过50USD目标。新的仅两镜像发布fresh清单已ReviewOnly，不安装Grant/不dispatch，实际执行另确认。9项publisher/3项F3/65项协议、类型/lint/UTC语法验证通过。见 [F3a真实结果、范围与继续位置](./docs/aws-auto-deployment-fast-track-f3a-readonly-preflight.md)。以下保留历史状态。

2026-10-07 F2g2完成：平台 runner/真实 SDK adapter 显式选择 prepared-v2 与 raw receipt schema2，严格绑定完整身份/owner/本次数据库与角色/请求 hash；旧协议默认不变。65项协议/收据测试、129项主链回归、跨仓六操作 wire 校验、typecheck/lint/production build通过；SDK transport为测试替身，不是线上验收。数据型 TaskDefinition/activation/单租户最小权限草案已加入，无installer，所有readiness/安装授权false。Source实际只读仍Locked/v4；未发布候选/上传baseline/注册ECS/安装权限/创建Cell/启动Worker。下一阶段F3集中只读preflight、PG版本/费用与fresh云清单，仍按50USD/月目标和具体批准边界。见 [F2g2记录与继续位置](./docs/aws-auto-deployment-fast-track-f2g2-prepared-runner.md)。以下保留历史状态。

2026-10-07 F2g1完成代码切片：生产admission/CLI root绑定实际TaskRole/Fargate/TaskDefinition/image、完整平台identity/owner与强一致runtime/epoch记录，准确S3 baseline loader、opaque capability、SQL/receipt前后围栏和deadline接通；平台新单参数CMD材料编译保持旧协议独立。41项backend/6项平台定向验证、真实隔离PG16全链路与完整CI/双镜像Actions自检、OS HIGH/CRITICAL均0通过。AWS admission/S3仍是local test seam，新候选未发布，runtime record/权限未安装，Source只读仍Locked/v4；没有ECS/Cell、云或源库写入、Worker启用。下一步显式runner/SDK v2接线与受审部署材料，云变更另按fresh范围确认。见 [代码、真实证据与继续位置](./docs/aws-auto-deployment-fast-track-f2g1-admitted-root.md)。以下保留历史状态。

2026-10-07 F2f6实际完成：按fresh 15d30e5e清单唯一更新现有publisher IAM并Actions单次发布两份修复镜像，独立registry/config/COMPLETE扫描读回均通过，无报告HIGH/CRITICAL。Source立即Revoke，独立完整Locked/v4、模板与原两资源核验通过；旧镜像/策略原文/本地记录保留。但CloudFormation内部清理了旧IAM版本v1/v2，已用准确CloudTrail证明并显式记录，不能声称所有AWS历史版本仍在。没有ECS/Cell/数据库或baseline写入、Worker/root启用；下一步为production admission/CLI接线，实际付费部署另行批准。见 [实际发布、完整收尾与继续位置](./docs/aws-auto-deployment-fast-track-f2f6-ecr-published.md)。以下为历史状态。

2026-10-07 F2f5登录前置检查已修正：旧c9fa清单虽获批准，但一小时临时凭据门禁误判AWS Login的15分钟自动刷新机制，未执行任何云写入或占槽。Source真实调用仍有效；改为准确login provider/身份与当前凭据120秒检查，Grant/Revoke前复验，17项定向测试、完整在线Backend CI和真实ReviewOnly/独立Inspect通过，IAM仍Locked/v2、新tag absent。新清单保持IAM/镜像/date边界不变，需新SHA确认；旧批准/模板/镜像/记录保留，50USD目标不变。见 [修正与新的准确批准](./docs/aws-auto-deployment-fast-track-f2f5-login-preflight-fix.md)。以下为历史状态。

2026-10-07 F2f 第五批发布审阅完成：新schema2清单绑定第四批两份修复镜像的准确ZIP/receipt/config/前置scan和执行器；原始ZIP及全部成员checksum实际校验通过，16项相邻测试、完整在线Backend CI、AWS只读模板校验和新控制器ReviewOnly通过。独立Inspect/完整云模板比较再次确认发布IAM仍Locked/v2，两新immutable tag未占用；原已消费清单/模板/镜像/记录保留。尚未AWS写入或新ECR发布，下一步按fresh SHA确认仅更新现有两IAM资源→Actions单次发布→独立ECR门禁→成功或失败立即Source Revoke；不包含ECS/Cell、baseline或数据库写入。见 [准确新清单、窗口和确认范围](./docs/aws-auto-deployment-fast-track-f2f5-republish-review.md)。以下记录保留历史状态。

2026-10-07 F2f 第四批完成：lifecycle改为非root最小distroless运行层，保留Node24.18/PG16.14，使用实际修补的Python3.14.8并移除无用GUI/交互/nativeUUID依赖；app同步修复旧OpenSSL层。新增Actions发布前OS扫描与准确包metadata/DB/image校验，最新双镜像真实构建、隔离compiler自检、Trivy HIGH/CRITICAL均0及完整Backend CI通过。没有本地Docker安装、AWS写入或新ECR发布，发布IAM只读确认仍Locked/v2。下一步为修复候选准备新的IAM更新/发布清单，再按新SHA确认；ECR独立扫描门禁不降低。见 [最小运行层与真实云端扫描证据](./docs/aws-auto-deployment-fast-track-f2f4-minimal-runtime.md)。以下记录保留历史状态。

2026-10-07 F2f 第三批实际执行完成并安全收尾：按批准清单创建专用两项 IAM 资源，单次 Actions 校验原始镜像并 OIDC 发布两镜像至现有 immutable ECR；app BASIC扫描空结果，lifecycle报6项CRITICAL/19项HIGH，严格门禁阻断部署。Source立即Revoke，栈UPDATE_COMPLETE、boundary v2/inline DenyAll和trust Deny独立核验，原资源/镜像/记录保留，不重试。没有ECS/Cell或数据库写入；下一步先修复lifecycle系统依赖、Actions重建，新发布另按fresh清单批准。见 [实际ECR证据、扫描阻断与Locked收尾](./docs/aws-auto-deployment-fast-track-f2f3-ecr-scan-blocked.md)。以下记录保留历史状态。

2026-10-07 F2f 第二批完成：不安装本地 Docker，GitHub Actions 实际构建并隔离自检 app/lifecycle linux/amd64 镜像，完整 Backend CI 通过；精确镜像产物和手动 ECR promotion/短时最小权限 Grant＋Locked Revoke 清单已准备，尚未批准或执行云发布。只读确认现有 immutable sandbox ECR/OIDC、专用 publisher absent、sandbox Cell MISSING。代码与记录按默认授权提交推送；新增 IAM/实际发布仍需准确清单确认，ECS/生产 baseline 与 CLI 写 root 未启用，50 USD/月目标不变。见 [真实镜像证据与 ECR 确认范围](./docs/aws-auto-deployment-fast-track-f2f2-cloud-images.md)。以下记录保留历史状态。

2026-10-07 F2f 第一批完成：固定 RDS owned-session/Secret 工厂、prepared task 的 SQL verify＋真实 app 数据库登录、严格 v2 回执与平台 proof 传播；实际本地 PG16 验证 receipt 重放不调用 providers、业务修改后 active verify 不覆盖、取消/cleanup 与独立回读。97 项 backend Node、28 项 Python、64 项平台测试、类型/定向 lint 通过，四实例停止。公开 RDS 根 CA 包已独立审阅并更新候选 pin。镜像候选已写，但本机无 Docker/WSL，尚未构建；生产 CLI 写 root、实际 RDS/ECS 验收仍未启用，无源库/AWS/Neon 写入。见 [RDS 工厂、任务与 v2 回执证据及下一批](./docs/aws-auto-deployment-fast-track-f2f-rds-task.md)。以下记录保留历史状态。

2026-10-07 F2e 完成：prepared 应用数据库最小授权、原子 LOGIN、实际 TLS 登录与精确 ACL 回读恢复；安全退役先永久 claim/关闭新连接，有旧会话则不强制删除，关闭后准确 cleanup 和后继 generation 释放。75 项 Node、28 项 Python 与 backend typecheck 通过；应用闭环和原 NoLOGIN/响应丢失路径在独立真实 PG16.14 实例通过，五实例停止。无源 PG15/AWS/Neon 写入，Worker/默认 CLI 和生产 baseline 批准仍 false。下一步 RDS owned-session factory、CLI/receipt/镜像接线；数据库登录不是 HTTP/tenant ready。见 [应用授权、实际登录和退役证据](./docs/aws-auto-deployment-fast-track-f2e-application-access.md)。以下记录保留历史状态。

2026-10-07 F2d 完成：prepared SQL service 已接通准确部分 prepare 恢复、四阶段实际校验、正常 cleanup tombstone 和后继 generation 释放；PG16.14 非 superuser TLS 实测两类删除/提交响应丢失恢复及旧 cleanup 不删除第二代。旧 registry parsed prefix mismatch 已实际确认，新方案使用独立 cleanup journal 和显式 prepare-v2 升级，旧记录不删除、云端未迁移。70 项 Node、28 项 Python 回归及 backend typecheck 通过，本轮四实例停止。应用账户仍 NOLOGIN，下一步权限/真实登录、安全退役及 RDS/CLI/receipt/镜像接线；runtime/生产 baseline 批准仍 false，无源库或云写入。见 [prepared service 与正常清理证据](./docs/aws-auto-deployment-fast-track-f2d-prepared-cleanup.md)。以下记录保留历史状态。

2026-10-07 F2c 第三批完成：原子 baseline restore 在真实 PG16.14 TLS、非 superuser cell_admin 上通过 DDL/marker 回滚、管理连接丢失、提交响应丢失恢复、零行/profile/catalog 独立只读核验及额外列漂移拒绝；prepare→restore→migrate→verify SQL 链路跑通。62 项 Node、28 项 Python 相邻校验及 backend typecheck 通过，本轮四个实例停止，无源库/AWS/Neon 写入。应用账户仍 NOLOGIN，runtime 和生产 baseline 批准仍 false；下一步生产组合、正常清理和 RDS/CLI/receipt/镜像接线。见 [原子恢复证据与继续位置](./docs/aws-auto-deployment-fast-track-f2c-atomic-restore.md)。以下记录保留历史状态。

2026-10-07 F2c 第二批完成：真实 prepare/失败补偿 SQL capability 在隔离 PG16.14 TLS、非 superuser cell_admin 上验证准确 OID 创建、三类响应丢失恢复、失败回滚和补偿恢复；永久 journal、同名对象/旧 epoch/不同 OID 拒绝及独立只读回读通过。45 项相邻 Node 回归和 backend typecheck 通过，所有临时实例停止，源库/AWS/Neon 未写入。下一步是受批 baseline restore，再接 recovery/正常 cleanup/RDS/CLI/镜像；runtime 和生产 baseline 批准仍 false。见 [prepare 验收与继续位置](./docs/aws-auto-deployment-fast-track-f2c-prepare.md)。以下记录保留历史状态。

2026-10-07 F2c 第一批完成：真实 `migrate_saas/verify` SQL provider 在隔离 PG16.14 TLS、非 superuser 管理账户上通过事务回滚、重放、COMMIT 响应丢失恢复、管理会话丢失中止和旧 epoch 拒绝；独立只读回读 1+8 条初始化行、其余业务表零行，临时实例已停止。prepare/restore、RDS/CLI/镜像接线尚未完成，runtime 和 baseline 批准仍 false；本轮无 AWS/Neon/源库写入。见 [真实 SQL provider 与继续位置](./docs/aws-auto-deployment-fast-track-f2c-saas-transactions.md)。以下记录按历史状态保留。

2026-10-06 F2b 真实验收已完成：上一批次 PG15 schema-only 候选在独立 PostgreSQL 16.14 上恢复成功，73 张表全零行、扩展/5个函数/4个触发器独立只读核验通过，临时实例已停止。源 PG15/原件未变，无 AWS/Neon 调用、付费资源或 runtime 启用；baseline 尚未批准/发布。下一步 F2c 是真实 prepare/restore/migrate/verify provider，随后再审阅云发布和单租户上线。见 [PG16 真实验收与继续边界](./docs/aws-auto-deployment-fast-track-f2b-pg16.md)。以下记录保留历史状态。

2026-10-05 已按用户要求切换到“单租户 AWS 自动部署最快交付”主线，预算目标改为 50 USD/月，最低费用优先不再主导方案。F1 已完成租户独立运行凭据生成和真实 Worker prepared composition；部署/清理使用同一组 Secret/lifecycle/ownership adapter，未开启 runtime。用户启动本地 PostgreSQL 后，F2a 真实 schema-only 候选已导出：73 张表、无业务行，固定 profile 核验所需扩展/5个函数/4个触发器的完整定义通过；失败记录保留。候选尚未 approved，也未恢复数据库。下一步是独立 PostgreSQL 16.14 恢复验收并补齐 production provision provider；不自动进入新的 Grant generation。当前没有 AWS/Neon 写入或付费资源。见[最快交付方案与继续位置](./docs/aws-auto-deployment-fast-track.md)。以下历史记录按其当时状态保留。

最新 J5g-j23 generation6 已按准确 fresh 创建 SHA 单次创建未执行 Grant，独立 RecoverCreate 证明 READY_UNEXECUTED。安装入口返回非零并在正式执行意图之前被拦截；wrapper Inspect 与新的独立 Source Inspect 均证明完整 Locked/v7、execution boundary v1、准确 Grant AVAILABLE、原零资源 fixture 未变，真实槽位仅有永久 claim，没有 run/Grant/reads/Revoke intent。MFA 提示出现过，但不能据此证明登录成功；失败时已晚于安装批准截止，具体内部原因未被脱敏收据保留，不能将其断言为 MFA 或 AWS 权限错误。旧批准与原计划安装审阅余量均已关闭，不重放、不延长 policy、不复位或自动下一代。下一步建议先改进前置校验耗时和安全诊断（需用户确认代码范围），之后才另行审阅严格退役/后续轮次；云删除/创建/安装仍各按 fresh SHA 批准。见[创建、安装前拦截与独立安全收尾](./docs/aws-sandbox-j5gj23-generation6-creation-entry-blocked.md)。以下记录按其当时状态保留。

最新 J5g-j23 generation6 已按准确 fresh 创建 SHA 单次创建未执行 Grant，独立 RecoverCreate 证明 READY_UNEXECUTED。安装入口返回非零并在正式执行意图之前被拦截；wrapper Inspect 与新的独立 Source Inspect 均证明完整 Locked/v7、execution boundary v1、准确 Grant AVAILABLE、原零资源 fixture 未变，真实槽位仅有永久 claim，没有 run/Grant/reads/Revoke intent。MFA 提示出现过，但不能据此证明登录成功；失败时已晚于安装批准截止，具体内部原因未被脱敏收据保留，不能将其断言为 MFA 或 AWS 权限错误。旧批准与原计划安装审阅余量均已关闭，不重放、不延长 policy、不复位或自动下一代。下一步建议先改进前置校验耗时和安全诊断（需用户确认代码范围），之后才另行审阅严格退役/后续轮次；云删除/创建/安装仍各按 fresh SHA 批准。见[创建、安装前拦截与独立安全收尾](./docs/aws-sandbox-j5gj23-generation6-creation-entry-blocked.md)。以下记录按其当时状态保留。

最新 J5g-j23B 已接通 generation6 独立安装审阅、固定 MFA Operator 至多两种准确 Describe、异常路径立即 Source Revoke、独立 Locked Inspect 与单独批准的 revoke-only 恢复；真实固定六步 journal 不复位或重放。38项定向测试/必要共享通道回归、类型检查、lint及两个独立进程的真实本地归档/账本核验通过；旧记录未变，generation6 registry 仍 absent，本轮无 AWS/Neon 调用、真实批准窗口或云写入。完整工具先于在线创建准备完毕，下一步仅 fresh Source-only 创建审阅；真实创建和安装仍各按 fresh SHA 单独批准，不在二者之间插入代码/Git工作。见[完整受审执行工具及在线下一步](./docs/aws-sandbox-j5gj23b-generation6-reviewed-workflow.md)。以下记录按其当时状态保留。

最新 J5g-j23A 已接入 generation6 紧凑候选编译、独立固定永久 claim、单次受批创建、精确 Source 只读回读及完整 SHA 本地批准入口。28项定向测试/必要回归、类型检查、lint与两个独立进程的真实本地归档/账本核验通过；旧记录未变，generation6 registry 仍 absent，本轮无 AWS/Neon 调用、真实候选窗口或云写入。安装/固定 MFA Operator/立即撤权链尚未接线，下一小阶段先完成这些代码工具；真实创建与安装仍各按 fresh SHA 单独批准，不在二者之间插入代码/Git工作。见[独立候选、固定持久化与受审创建工具](./docs/aws-sandbox-j5gj23a-generation6-reviewed-creation.md)。以下记录按其当时状态保留。

最新 J5g-j23 已按准确 fresh SHA 单次退役旧未执行 generation5 管理 Grant，并由另起 Source Inspect 证明 RETIRED_LOCKED_VERIFIED：完整管理 Change Set 清单为空、完整 Locked/v7 与原零资源 fixture 未变。旧云对象不可恢复，历史记录/claim 全部保留，永久 delete intent 不复位或重试；两个独立本地进程复算通过，generation6 registry 仍 absent，没有创建后继、安装权限或登录 Operator。下一步仅继续 generation6 候选/持久化/受审工具代码接线，真实创建与安装仍各按 fresh SHA 单独批准。见[准确退役、独立证据与后续边界](./docs/aws-sandbox-j5gj23-generation5-retirement-execution.md)。以下记录按其当时状态保留。

最新 J5g-j23 已按仅代码范围实现 generation5 严格一次退役入口、独立只读 Inspect、完整 SHA 本地批准脚本和 generation6 围栏/admission。15项定向测试/相关回归、类型检查、lint及两个独立进程的真实本地归档/账本核验通过；旧 claim/记录未变，退役 intent absent、generation6 registry absent。本轮无 AWS/Neon 调用或新批准窗口，没有实际删除、创建或安装；generation6 候选/云执行链尚未接线，真实退役、后继创建和安装仍各按 fresh SHA 单独批准。见[严格退役工具、独立围栏与执行边界](./docs/aws-sandbox-j5gj23-generation5-retirement-generation6.md)。以下记录按其当时状态保留。

最新 J5g-j22 generation5 已完成窗口关闭后的独立只读收尾：Source 刷新后，完整 Inspect 与本地原件/实际账本复算证明准确 Grant 仍 READY_UNEXECUTED、完整 Locked/v7 与原零资源 fixture 未变，固定槽位仅含 claim、没有执行 intent。安装及原 policy 截止均已关闭，Source-only 安装审阅从未获得执行批准；本轮无云写入、Operator 登录、删除或下一代创建。失败记录保留，不延长窗口或复位；后续严格本代退役/独立下一代仍须另行审阅及各自 fresh 云批准。见[窗口关闭、独立证据与后续边界](./docs/aws-sandbox-j5gj22-generation5-window-closure.md)。以下记录按其当时状态保留。

最新 J5g-j22 已按准确 fresh 创建 SHA 单次创建 generation5 Stack-only Describe Grant，并由独立 Source RecoverCreate 证明 READY_UNEXECUTED、完整 Locked/v7 与原零资源 fixture 未变。真实固定槽位只有永久 claim，旧账本稳定；未执行 Grant/child、安装权限或登录 Operator/MFA，也未删除资源或创建付费 Cell。独立本地原件/账本复算通过，wrapper 文件限额收尾及3项相关回归/lint通过；下一步仅生成 fresh 安装 manifest/三项 action SHA，仍须单独批准且不能延长原窗口。见[generation5 创建、独立证据与截止边界](./docs/aws-sandbox-j5gj22-generation5-creation.md)。以下记录按其当时状态保留。

最新 J5g-j22D 已完成实际 Source-only 在线核验：完整 Locked/v7、四个 IAM 资源、Cell MISSING/authority ABSENT、原零资源 fixture 与完整清单通过，管理 Change Set 完整清单为空，旧账本未变、新 registry absent。真实新清单约916KB，已修复 J22 专用有界读取入口（旧证据/账本仍保持600KB限制），4项直接相关测试、类型检查和lint通过；随后生成 fresh 创建审阅，创建尚未批准或提交，无 Operator/MFA/云写入。创建与安装仍各按 fresh SHA 单独批准。见[在线证据、入口修复与创建批准边界](./docs/aws-sandbox-j5gj22d-online-creation-review.md)。以下记录按其当时状态保留。

最新 J5g-j22C 已接通准确 Stack-only Grant 安装、固定 MFA Operator 至多两种 Describe、异常路径立即 Source Revoke、独立 Locked Inspect 与 revoke-only 恢复工具。23项定向测试/相关回归经修正夹具后全部通过，类型检查、lint 和真实原件/账本的独立本地复算通过；旧记录未变，新 registry 仍 absent，本轮无 AWS/Neon 调用、真实新窗口或云写入。下一阶段转回 fresh Source-only admission/创建审阅，实际创建和安装仍分别按 fresh SHA 批准；不执行 child、不删除资源、不创建付费 Cell、不打开 runtime。见[完整受审执行工具、核验与在线下一步](./docs/aws-sandbox-j5gj22c-reviewed-stack-read-workflow.md)。以下记录按其当时状态保留。

最新 J5g-j22B 已接入独立 generation5 固定磁盘 claim/六步 journal、准确 Stack-only Grant 的受审创建及独立 Source 只读恢复工具。30项定向测试/回归、类型检查、lint 与真实原件/旧账本的独立本地复算通过；新 registry 仍 absent，无 AWS/Neon 调用、真实新窗口或云写入。创建工具不等于安装工具：Grant/固定 MFA Operator 两次 Describe/立即 Revoke/独立 Locked 执行链尚未接线，下一 J22C 继续代码实现、不部署；实际创建和安装仍各按 fresh SHA 单独批准。见[固定账本、受审创建与后续接线](./docs/aws-sandbox-j5gj22b-fixed-storage-reviewed-creation.md)。以下记录按其当时状态保留。

最新 J5g-j22A 已按用户同意的新只读范围实现 generation4 严格关闭前驱、独立新围栏描述、准确 Stack 限定的未部署 DescribeChangeSet 候选，以及仅本地 CheckPreparation 入口；只新增一条不含 ChangeSetName 的只读 Allow，旧删除/执行条件、资源和 compiler 不变。37项定向测试/回归、类型检查、lint 及真实原件/账本独立复算通过；无 AWS/Neon 调用、真实新 registry、候选窗口或批准。持久化和创建/安装/Operator/撤权云工具尚未接线；下一小阶段继续代码接线、不部署，实际云操作仍各按 fresh SHA 单独批准。见[受审准备入口、验证与后续接线](./docs/aws-sandbox-j5gj22-stack-scoped-read-control-preparation.md)。以下记录按其当时状态保留。

最新 J5g-j21 已完成 generation4 两次 DescribeChangeSet 拒绝的 Source-only 诊断：CloudTrail 准确匹配两条 request ID，MFA 均 true，AWS 均报告准确 fixture Stack 上无匹配 identity-based Allow；实读保留 v6 与原批准一致，当前完整 Locked/v7、execution boundary v1 和真实 claim/六步 journal 未变。实际条件上下文未报告，根因仍未证明；无新窗口、云写入或 Operator 重试。下一对照建议仅供审阅：准确零资源 Stack 限定的 Describe 只读 Allow，不附加 ChangeSetName 条件；此权限范围变化须用户明确同意，尚未实现/部署或自动下一代。见[只读诊断、证据限制与后续范围](./docs/aws-sandbox-j5gj21-generation4-describe-diagnostic.md)。以下记录按其当时状态保留。

最新 J5g-j20 已按两项独立 fresh 批准完成 generation4 创建与安装/两次读取/立即撤权。两次固定 MFA Operator Describe（full ARN、exact name）均收到 AccessDenied，compatibility 仍未证明；wrapper 与后续独立 Source Inspect、真实账本复算确认 Locked/v7、execution boundary v1、原零资源 fixture 稳定，Cell MISSING、authority ABSENT。固定 claim/六步 intent 永久消费，旧记录保留、不重放或自动下一代；下一步先只读诊断拒绝原因，不扩大权限。见[generation4 执行、拒绝证据与独立 Locked 收尾](./docs/aws-sandbox-j5gj20-generation4-execution.md)。以下记录按其当时状态保留。

最新 J5g-j20 已由用户按准确 fresh SHA 在本地退役唯一旧未执行 generation3 Grant，并经 wrapper Inspect、后续独立 Source Inspect 与真实账本复算证明 RETIRED_LOCKED_VERIFIED：完整管理 Change Set 清单空、Locked/v5 和原 fixture 未变。旧三代记录/claim 保留，退役 intent 永久消费；generation4 只读 admission 通过，但新 registry/claim 仍 absent，没有创建或安装权限。下一步仅生成新 generation4 创建审阅清单，创建与安装仍分别批准。见[准确退役、独立证据与下一步](./docs/aws-sandbox-j5gj20-generation3-retirement-execution.md)。以下记录按其当时状态保留。

最新 J5g-j20 已补齐 generation4 受审创建、独立回读、安装审阅、固定 MFA Operator 两种准确 Describe 和立即撤权工具，85项定向测试/回归、类型检查、lint 与 Source-only 准备核验通过。旧 generation3 Grant/claim、Locked/v5 和原 fixture 未变，两个新 registry 仍 absent；本轮无云写入、无新执行窗口。代码工具已接线不等于 Worker/readiness 开启；真实退役、创建、安装仍各按 fresh SHA 单独批准，代码提交/推送则按持续授权直接执行。见[接线边界、证据与下一步](./docs/aws-sandbox-j5gj20-generation4-reviewed-tools.md)。以下记录按其当时状态保留。

最新 J5g-j20 已按代码-only批准实现 generation3 严格退役入口、完整 SHA 本地批准命令及独立 generation4 compiler/围栏/固定槽位；78项定向测试、类型检查与 Source-only 准备核验通过。旧三代记录、准确未执行 Grant、Locked/v5 和原 fixture 保持不变，两个新 registry 均 absent；本轮无云写入、无新批准或 policy 窗口。generation4 的真实创建/回读/安装/撤权执行链仍未接线，下一代码阶段完成后，真实删除、创建和安装才可各按 fresh SHA 单独批准。见[本阶段实现、证据与下一步](./docs/aws-sandbox-j5gj20-generation3-retirement-generation4.md)。以下记录按其当时状态保留。

最新 J5g-j19 已完成 generation3 安装截止后的 Source-only 窗口收尾：准确 Grant 仍 READY_UNEXECUTED、完整 Locked/v5 和原 fixture 未变，真实固定槽位只含 claim，没有 workflow/Operator intent；旧三代记录保留。本轮无云写入，旧窗口不能刷新身份后继续安装，也不复位或重建。后续严格 generation3 退役/独立 generation4 与准备前置方案仅供审阅，尚未实现或授权。见[窗口收尾及下一轮方案](./docs/aws-sandbox-j5gj19-generation3-window-closure.md)。以下记录按其当时状态保留。

最新 J5g-j19 已按准确创建清单唯一创建 generation3 只读对照 Grant，并经独立 Source RecoverCreate 证明 READY_UNEXECUTED、Locked/v5 和原 fixture 未变；新固定槽位永久占用且仅含 claim，没有安装权限或 Operator 登录。旧两代与退役记录保留；未来安装仍需 fresh execution manifest 和三项 action SHA 单独批准，窗口不延长、不复位或重放。另修复本地 wrapper 多 Node 路径选择问题。见[generation3 创建证据及下一步](./docs/aws-sandbox-j5gj19-generation3-creation.md)。以下记录按其当时状态保留。

最新 J5g-j19 已按独立准确批准退役唯一旧未执行 generation2 管理 Grant，并另起 Source-only Inspect 证明对象缺失、完整管理清单空、Locked/v5 与原 fixture 未变；旧记录保留，退役 intent 永久消费，generation3 registry 仍 absent。已修复本地 PowerShell JSON DateTime 的 UTC 窗口误判，云创建/安装仍须各自 fresh SHA 单独批准。见[退役执行证据及下一步](./docs/aws-sandbox-j5gj19-retirement-execution.md)。以下实施段落按当时状态保留。

最新 J5g-j19 已按代码-only批准实现旧未执行 Grant 的严格退役入口、保留两代前驱的独立 generation3 固定围栏及本地完整 SHA 批准命令。真实 Source 只读和独立复算通过；旧 Grant/claim 未变，新两个 registry 均 absent，本轮无云写入/Operator 登录。删除、创建、安装各需 fresh SHA 单独批准；所有门禁仍 false。见[退役、generation3 与本地批准顺序](./docs/aws-sandbox-j5gj19-retirement-generation3.md)。下文各历史段落按其当时状态保留。

面向企业客户的 SaaS 平台，逐步实现用户、企业工作区、套餐、收费和餐饮订单系统实例管理。

当前已在阶段 8 基础上完成客户自助购买一期、Neon PostgreSQL 迁移、自有认证一期，并建立 AWS Sandbox S0–S3 执行基础：企业用户可用邮箱密码注册/登录，选择管理员维护的共享套餐并配置允许的租户参数；只有 Stripe 已验证 Webhook 才会创建或续期订阅、准备待开通实例并生成可审计的 AWS 目标计划。S0 提供静态费用与权限护栏，S1 提供部署状态机与任务，S2 加固订单服务控制契约，S3 新增默认关闭的独立 Worker、STS/CloudFormation Adapter、租户 TTL 清理和 mTLS 控制边界；S3-B B0–B4 补齐了离线可测试的租户资源生命周期、不可变模板编译、RS256/mTLS 客户端、Shared Cell 只读证据以及独立 Cell 渲染/Janitor 基础。B5 当前完成的是默认关闭的安全基础：每次任务领取使用独立 lease token、长操作持续续租并隔离迟到结果、原子 external epoch authority 契约、generation-bound 单一 JSON Secret、workload → database/role → Secret 的可恢复分阶段清理、可信 S3 raw receipt publisher/reader、exact provision predecessor cleanup 接线，以及注入式 ECS、S3、Secrets Manager、DynamoDB SDK 适配器源码和默认 `offline_only` 的 Worker root composition。B5-I 已通过三阶段受审 Change Set，把 exact receipt Bucket、PAY_PER_REQUEST authority table、去除 Sandbox S3 通配权限的普通 TaskRole、专用 LifecycleTaskRole、最小 WorkerRole 和 Shared Cell 只读证据权限部署到既有 Bootstrap；没有创建 Cell 或租户 Stack。B5-J4b 又于 2026-08-26 在 Account `402010193138`、Region `ca-central-1` 部署并严格回读 IAM-only 管理 Stack 与仅含 4 个非 IAM 资源的 cleanup-only 子 Bootstrap，最终管理状态为 `LOCKED`，Schedule 保持 `DISABLED`；这仍没有创建 Shared Cell、租户 Stack 或打开任何 readiness gate。订单服务端也已加入默认禁用的六命令租户生命周期入口和一次性 PostgreSQL 16.14 集成测试基础。当前所有执行 gate 保持关闭；这些适配器仍未注入 live Worker，也仍缺 Secret material generator、后端 PostgreSQL lifecycle provider、已批准 baseline 和 Shared Cell/控制凭据 root wiring。J5g-e1 已对真实 Neon 做严格只读检查，J5g-e2又于2026-09-09使用fresh manifest在单个受审事务中应用 `0005`–`0008`，并经独立只读连接确认最终exact `0001`–`0008`、完整schema对象及默认关闭围栏状态。普通网站启动和测试不会调用 AWS、Neon 或任何真实数据库。

B5-J5e 已于 2026-09-01 完成 Shared Cell provision-authority 最小 IAM channel drill并恢复 locked baseline：Provisioner 只保留 exact Cell Stack/GetItem 读取，临时 Put grant 已显式撤销，线上仍为 Cell `MISSING`、authority key `ABSENT`。B5-J5f 补充了 reviewed candidate/install/recovery operator 与受控未来在线 CLI；J5g-f 又把 authority 本体显式升级为 schema v2，并以 `cloudFormationRoleArn` 持久化 exact Cell CloudFormation execution RoleARN。J5g-f 仍是默认关闭的离线代码契约，不调用 AWS/Neon、不写 authority、不创建 Cell，也不改变任何 blocker 或 readiness gate。

## 已实现

- 使用应用自有的邮箱密码完成注册和登录，不再依赖 ChatGPT 账号。
- 密码使用随机盐和 PBKDF2-SHA256 哈希保存；连续失败会触发临时账号锁定。
- 登录态使用数据库保存的随机会话 Token，浏览器只接收 `HttpOnly`、`SameSite=Lax` Cookie。
- 企业用户自助注册时自动创建企业工作区和 `owner` 成员关系。
- 管理员创建的客户不会获得默认密码；管理员可生成 48 小时有效的一次性激活链接，由客户自行设置密码。
- 企业工作区状态：`active`、`suspended`、`disabled`。
- 工作区成员角色：`owner`、`member`。
- 用户表中的 `is_platform_admin` 平台管理员标记。
- 平台管理员邮箱允许名单。
- 客户控制台、成员页面和工作区设置基础页。
- 管理员概览、用户列表和工作区列表基础页。
- 服务端工作区成员校验和平台管理员校验。
- 无权限页面及统一的 `401` / `403` API 响应。
- 管理员客户列表、搜索、状态筛选和客户详情。
- 创建、编辑、暂停及恢复企业客户工作区。
- 创建、编辑、启用及停用套餐。
- 管理员可以创建应用实例模板、维护草稿版本、发布不可变版本和归档旧版本。
- 模板配置字段区分客户需求与套餐参数；餐饮订单系统新版本会带入与 `SAAS_CONTROL.md` 对齐的 23 项动态字段，套餐参数由后端读取，不能由客户覆盖。
- 模板部署标识和 AWS 部署计划驱动都采用受控允许名单，不接受脚本、密钥或任意部署命令。
- 每个套餐必须归属一个产品；同名套餐可存在于不同产品中，套餐创建后不能跨产品转移。
- 每个套餐必须绑定同一产品下的已发布实例模板版本；套餐创建后不能更换模板版本。
- 选择模板版本后，套餐表单会直接展开模板参数：`plan` 参数在套餐中以 number / boolean / null 原生类型固定，`customer` 参数可设置默认值并在购买或创建订阅时填写。
- 套餐价格使用最小货币单位保存，功能和限制保存在数据库中。
- 客户详情和客户控制台读取当前套餐、订阅状态和应用实例状态。
- 客户 Owner 自助选择共享套餐并填写模板允许的实例配置；付款成功后系统根据套餐、模板版本和配置快照自动创建订阅，不会为每个客户复制一条套餐记录。
- 管理员仍可查看和编辑客户订阅；手动创建订阅仅作为特殊客户或故障恢复的应急兜底。
- 创建订阅时根据套餐绑定的模板解析实例配置，并把模板版本和已解析配置固定在订阅中。
- 订阅支持 `manual_pending`、`active`、`past_due`、`paused`、`canceled`。
- 一个工作区可保留多个产品、多个历史订阅；同一工作区的同一产品同一时间只允许一个当前订阅。
- 创建订阅时只显示所选产品下的套餐，服务端和数据库都会阻止跨产品套餐组合。
- `manual_pending`、`active`、`past_due`、`paused` 视为当前订阅，`canceled` 视为历史订阅；取消后可为同一产品重新创建订阅。
- 管理员可以暂停、恢复和取消订阅。
- 管理员手工录入并筛选付款记录。
- 付款金额使用最小货币单位整数保存。
- 付款状态支持 `pending`、`paid`、`failed`、`canceled`。
- 客户只读查看本工作区的订阅、当前账期和付款历史。
- 非有效订阅或最近付款失败时，客户控制台显示明显提醒。
- 内置一个可分配产品：`餐饮订单系统`（`restaurant-order-system`）。
- 管理员可以创建、编辑、筛选和查看客户应用实例。
- 应用实例关联工作区、产品，并可选关联订阅。
- 新应用实例从订阅复制模板版本和配置快照；管理员不能在实例编辑页任意更换这些归属。客户结束旧订阅后重新购买同一产品时，系统会把唯一实例安全重绑到新订阅、刷新受控配置快照并恢复为 `pending`，等待重新开通。
- 应用实例通过关联订阅读取对应套餐，管理员实例列表和详情会显示该套餐；实例表不重复保存 `plan_id`。
- 应用实例状态支持 `pending`、`active`、`suspended`、`failed`。
- 只有关联有效订阅的实例允许被标记为 `active`。
- 管理员可以暂停和恢复应用实例；所有实例管理接口均要求平台管理员权限。
- 客户只能查看自己工作区的“我的应用”、应用状态和管理员登记的访问地址。
- 买家端 `access_url` 与卖家端 `seller_apk_url` 由管理员在后端记录中维护；平台不会自动部署或修改餐饮订单系统。
- 客户 Dashboard 显示企业名称、当前套餐、订阅状态、当前周期结束时间和最近付款状态。
- 客户 Dashboard 显示餐饮订单系统状态与管理员登记的访问地址；仅在有效订阅、已开通实例和有效 URL 同时满足时显示进入按钮。
- `manual_pending`、付款已确认但未开通、订阅异常、服务暂停、开通失败和未创建实例均有明确客户侧提示。
- 健康检查会返回当前发布阶段；被暂停或停用的工作区会收到明确提示，不会被循环跳转回受限的客户控制台。
- 客户工作区 Owner 可自行选择套餐、填写模板允许的客户参数并跳转至 Stripe Checkout；管理员预先创建的 `manual_pending` 订阅仍可继续使用原有付款入口。
- Checkout 金额、币种和套餐名称只由后端套餐记录生成；前端不会提交价格或付款状态。
- Stripe Webhook 使用原始请求体和签名密钥验证事件，保存事件摘要并按事件 ID 去重。
- 已验证的 Stripe 付款会写入付款记录并激活或更新订阅；若该工作区尚无餐饮订单系统实例，会自动创建一条 `pending` 待开通记录。
- 自动创建的实例没有访问入口且绝不会直接开通；管理员必须填写有效的买家端 `access_url` 后才可标记为已开通，并可同时维护卖家端 `seller_apk_url`。
- 每个工作区的每个产品最多一条应用实例，避免重复 Webhook 或重复付款生成多个入口；实例来源可区分“付款成功自动创建”和管理员手动创建。
- 管理员“补建遗漏实例”只选择订阅，企业、产品和套餐归属全部从订阅自动确定，不允许手工指定其他企业。
- 管理员原有的手动订阅、手动付款记录和订阅状态调整能力继续保留；付款记录标记来源为 Stripe 或人工记录。
- 企业客户可在“选择套餐”查看所有已启用、可购买的产品套餐，价格、功能、限制和模板参数全部来自后端。
- 只有工作区 `owner` 可以发起购买、续费、取消待付款订单或设置到期取消；普通成员只有查看权限。
- 客户新购先创建 `subscription_purchase_orders`，不会在浏览器或付款前创建有效订阅。
- Stripe Webhook 会再次核对服务器订单金额和币种；成功后才创建 `customer_checkout` 来源订阅，续费则延长原订阅周期。
- 客户可以对有效或逾期订阅发起同套餐续费，并可为有效订阅设置或撤销“周期结束后取消”；本期不提供即时取消、升级、降级或按比例计费。
- `workspace_product_entitlements` 按工作区和产品保存当前订阅与唯一应用实例的对应关系；重新购买不会重复创建同产品实例。
- 管理员可在“购买订单”查看客户新购/续费订单、Stripe 状态、关联订阅和失败原因。
- 套餐绑定版本化的受控 AWS 部署资源档位，档位会随购买订单和订阅快照固定，客户不能自行篡改；当前 Sandbox 环境策略只允许 `standard-v1`，历史或生产目标档位不能绕过 Sandbox 的 Cell、任务数和数据库限制。
- 已验证付款在生成或复用 `pending` 应用实例后，还会幂等生成一条 `app_instance_deployments` 计划记录，描述共享层、Cell 层和租户层资源的逻辑目标。
- S1 已建立持久化部署环境、状态机、可租约任务、步骤执行记录、预检和 CloudFormation 租户模板渲染基础；渲染产物不包含 Secret 值，也不会被提交到 AWS。
- `DEPLOYMENT_WORKER_ENABLED=false` 与 `AWS_APPLY_ENABLED=false` 是默认安全边界；单独开启 Apply 变量仍会被数据库环境、执行绑定、参数、清理计划、STS 身份和未配置 Adapter 等其余门禁拒绝。Apply 关闭并不被设计为删除 kill switch，但 cleanup/rollback 只有在完整 fenced cleanup coordinator 明确就绪时才会领取；当前默认依赖未接线，所以不会调用 AWS。要停止未来包括删除在内的所有 AWS 调用，必须关闭 Worker。
- Sandbox 的未来数据库目标限定为最多一个 Aurora PostgreSQL Serverless v2 Cell；每个租户在该 Cell 内使用独立 database 和 role，订单服务继续使用该租户数据库自己的 `public.*`。
- S3-B 已提供类型化的 database/role/Secret 所有权、approved baseline、幂等创建/迁移/验证/反向清理契约，以及只保存引用与证据的 `deployment_tenant_resources` 当前状态和 append-only 事件审计；`0005` 已受审应用到 Neon。当前 owner/generation 围栏禁止未销毁资源被另一个 deployment 接管。
- B5-A 新增 `0006` lease-token 围栏：每次 claim/takeover 都使用新的不可复用 token，Repository 写入同时校验 job、deployment、worker、attempt、token 与数据库时间下仍有效的租约；长时间外部调用持续续租，现有 AWS SDK、HTTPS、控制接口、Shared Cell 与类型化 Tenant DB/Secret 边界都会消费同一个 `AbortSignal`，丢租后的迟到结果不能写回。`0006` 已应用到Neon；provider与live root尚未接线，跨deployment live handoff继续禁止。
- B5-B 把租户运行时凭据收敛为当前 generation 的单一 Secrets Manager JSON Secret；ECS 只按 JSON key 注入数据库、HMAC、JWT 与 Sandbox Stripe 参数，环境 binding 不再承载这些租户密钥。健康检查已改为兼容 Distroless 的无 Shell 命令，控制通道域名由 execution environment 的受控 base domain 决定。
- B5-E 新增 `0007` 外部 ownership epoch：数据库只能先产生 `pending_external` 意图，必须由注入的 provider 把精确 marker 安装到外部资源并重新观察后才能激活；provision 与 cleanup 使用不同的单调 epoch，旧 epoch 不能记录生命周期或执行清理。CloudFormation 计划、所有权标签和 SaaS 控制请求现已携带当前 epoch；清理以持久化 run/phase 顺序执行 workload → database/role → Secret，稳定 operation ID 和阶段回执支持崩溃恢复，最终在一个事务中收口资源、部署、实例、TTL 计划和容量占位。`0007` 已受审应用到Neon。
- B5-F 新增原子 authority 接口和 SDK-free ECS one-shot/exact-five-key Secret 离线适配边界。authority 要求 provider 在一次线性化条件写入中执行 compare-and-set 并保留 predecessor，默认实现明确禁用；CloudFormation 只负责前后只读对账，标签不是 CAS。数据库任务只允许 generation-bound Secret ARN、代码固定命令、active epoch 与必要的 approved baseline digest；失租、超时或回执失败会停止已知任务并确认 `STOPPED`。`RunTask` 返回不确定时会在独立恢复窗口内按稳定 `startedBy` 轮询：一旦发现任务便停止并确认，持续不可见则以专用“结果未知”错误 fail closed，绝不把空列表当成“没有任务”。物理 Secret 名为逻辑 `/runtime` 加 `/gN`，回读证据精确绑定租户、generation、账号、区域及五个 JSON key。订单服务 `POST /api/saas/provision` 已在源码实现 control API v1.2 事务单调 epoch CAS；其他控制写接口仍未加 fence，这些 SQL 也未应用或部署。真实 SDK adapter 与 lifecycle 入口源码已经存在；destroy-capable Build #7 已构建、零发现扫描并以 inspect-default revision 2 注册回读，但 Worker root 仍未接线，两个 runtime gate 均为 `false`。
- B5-G 新增可注入的 AWS SDK v3 ECS one-shot、Secrets Manager exact-five-key Secret 与 DynamoDB 单调 authority 适配器源码。ECS Runner/Adapter 显式固定 environment kind、账号、区域、集群、revision-pinned Task Definition、subnet 列表、唯一 one-shot SG 和命令；Sandbox 只接受 `AssignPublicIp=ENABLED`，production 只接受 `DISABLED`，任一漂移都会在 SDK 调用前 fail closed，并支持不确定 `RunTask` 的有界恢复。Secret Adapter 只返回 ARN、版本和标签证据，不返回 Secret value；DynamoDB Adapter 使用强一致读取与 revision/旧记录条件写入。订单服务 lifecycle service 保留 `inspect`、`prepare_empty_database`、`restore_approved_baseline`、`migrate_saas`、`verify`、`destroy` 六种类型化操作契约；当前 B5-J2 production CLI 已进一步收窄为只接受 exact `inspect`，其余操作继续禁用。另有只允许本机 PostgreSQL 16.14、随机一次性数据库和双重 marker 清理的手动集成测试入口。
- B5-H 在 B5-G 基础上补齐了可信 S3 raw receipt publisher/reader、exact provision predecessor cleanup 接线，以及默认 `offline_only` 的 Worker root composition。订单服务只向 account/region/tenant/generation 绑定的固定 S3 key 写入 canonical raw envelope，平台在独立验证 exact ECS task/request、`ExpectedBucketOwner`、AES256 和 full-object SHA-256 后才构造最终 receipt hash；cleanup 现在要求 authority-derived predecessor 逐层传入 workload、database/role 和 Secret 删除路径，缺失、跨代、非 provision 或漂移 predecessor 都会在 provider 调用前 fail closed。默认 root 仍只暴露 disabled ports，`applyRuntimeReady=false`、`cleanupRuntimeReady=false`。B5-I 已部署 receipt/DynamoDB/IAM 支撑资源；B5-J2 又实现了受严格 runtime mode 和 management target 约束的真实 inspect-only Secrets Manager → PostgreSQL → S3 receipt 组合，但完整的 prepare/migrate/verify/destroy PostgreSQL provider、approved baseline、Worker live wiring 和真实租户崩溃/删除演练仍未完成，Neon 与真实 PostgreSQL 也仍未连接。
- B5-I 为受控在线快速模式补齐并部署低成本支撑 IaC：既有 Bootstrap 已创建 exact SSE-S3/conditional-write receipt Bucket、带 `5 RRU/s`/`2 WRU/s` best-effort ceiling 的 on-demand authority table；公网租户服务使用的普通 TaskRole 不再拥有任何 S3 identity permission，只有专用 LifecycleTaskRole 可以 conditional-write/read receipt，并按 generation 标签读取 runtime Secret。WorkerRole 只增加 one-shot canary 所需的 exact Cell/`tenant-lifecycle:*` ECS、Pass exact TaskExecutionRole/LifecycleTaskRole、generation-bound Secret、receipt read 和 authority CAS 权限，没有 CloudFormation/ALB/RDS 写权限；Provisioner 仍只可 Assume 该 Role。source user 的一次更新严格拆成 create/inspect/execute，并要求 AWS CLI `login_session`、exact MFA device 和 `GetTemplate(Original)` canonical exact match；scoped rollback 删除五个新增资源并撤销两项既有 boundary 中的 B5 能力，同时保留普通 TaskRole 的通配权限移除硬化。2026-08-22 执行的 Change Set `techlong-s3-b5-support-1fb78e3a91ede382` 已使 Bootstrap 达到 `UPDATE_COMPLETE`；在线 IAM 模拟确认区域限定的 Shared Cell 读取动作允许，而 `CreateVpc`/`CreateDBCluster` 继续隐式拒绝。Worker root 未接线，所有 runtime gate 仍关闭。
- B5-J1 新增纯离线 lifecycle TaskDefinition binding/compiler，并修正此前“同一 TaskDefinition ARN 只能允许一条命令”的配置缺口。现在 Runner 与 AWS ECS Adapter 都只接受一个 exact `tenant-lifecycle:<revision>` ARN，并要求请求 operation/argv 与 Runner 独立传入的原始 `expectedOperation` 一致后，才匹配六条代码自有命令；compiler 只记录 Sandbox ECR `@sha256`、预期 Cell cluster、TaskExecutionRole/LifecycleTaskRole、receipt Bucket、六条命令和候选 subnet/one-shot SG 的冻结 intent。候选网络值不代表已证明属于公共 Cell subnet 或已验证 one-shot SG，compiler 也不会产出 Runner/API 运行时配置；只有未来同时消费 `DescribeTaskDefinition` 与 Shared Cell 证据的 live readback verifier 才能产出该配置。intent 固定 `registrationReady=false`、`liveReadbackReady=false`，默认 root 新增 live readback blocker；本切片不注册 TaskDefinition、不调用 AWS，也不打开 gate。
- B5-J2 补齐 reference-only lifecycle 管理目标契约。Shared Cell Adapter 仍兼容原有 `verify()`；完整安全 preflight 现在还要求 RDS-managed master Secret 的 `SecretStatus=active`，并只在同一次受 `AbortSignal` 约束的观察全部通过后，由模块私有 `WeakSet` 标记可信 runtime provenance。复制或伪造的 evidence 不能进入 target compiler；稳定资源哈希排除 `observedAt`/`callerArn` 等瞬态值，并规范化数组顺序。compiler 与 backend projection 都只接受 5 分钟新鲜度窗口内、时钟未回退的 branded evidence/target。compiler 继续对账 B5-J1 intent 与当前 `TenantResourceFence`，要求 `tenant_<stem>_db` 和 `tenant_<stem>_role` 使用同一个 stem，然后产生深冻结 reference-only target 及 canonical 11-key backend projection；其中没有 Secret value、password、`DATABASE_URL` 或 Runner/API config，`registrationReady=false`、`liveReadbackReady=false` 保持不变。
- B5-J5c 已加入 dormant Shared Cell provision predecessor：只读 adapter 对账固定 root Stack、Original template 与完整资源 inventory，再由独立 absent-only installer 契约生成同 key 的 `provision_verified` 首项；cleanup CAS 只能把它推进为现有 `cleanup_authorized`，不能从空表自举。J5c 当时尚无 production DynamoDB installer，且 IAM/root wiring 与线上 authority 写入均未发生；两个 blocker和四个 readiness gate不变。
- B5-J5d 已加入 dormant production DynamoDB provision installer 与共享身份构造：exact table/key 上只允许 compiler-branded generation 1/epoch 1 首项使用 `attribute_not_exists` 条件写，冲突与成功后都做 full consistent readback；固定 MFA profile/device 的 STS/CloudFormation/DynamoDB 共用一个 refreshing credential provider并忽略 configured endpoint override。默认 runtime 仍不暴露该能力，IAM、线上安装、cleanup adapter online/root wiring和 J4c mutation均未批准或执行，两个 blocker与四个 readiness gate不变。
- B5-J5e 已部署 Provisioner 对 exact Cell Stack 和 exact authority key 的稳定只读边界，并演练短时 exact `PutItem` grant/revoke channel。Grant 期间未调用 installer；Revoke 后 policy readback/IAM simulation/readback 全部通过，随后只读 preflight 再次证明 Cell `MISSING`、key `ABSENT`。临时写权限已撤销，两个 blocker与四个 readiness gate不变。
- B5-J5f 增加 reviewed provision-authority operator 与受控未来在线 CLI（`scripts/run-shared-cell-provision-authority-operator.ts`，由 `ops/aws-sandbox/scripts/s3-b5-shared-cell-provision-authority-operator.ps1` 包装）：inspect 要求 live evidence 前后两次 strong read 均为 `ABSENT`，只返回脱敏摘要和 candidate digest；execute 必须重新采集 fresh evidence、重编译并 exact-match 人工确认的 digest后才能进入既有 absent-only installer；recover 仅 strong read authority 并校验 exact item/digest/owner/generation 1/epoch 1/revision 1，`evidenceObservedAt=null`，不读取 Stack、不重编译且绝不 Put。在线路径以 10 秒 connect / 20 秒 read 的 STS CLI identity检查开场；首次 AssumeRole MFA只从 TTY隐藏输入，MFA 等待及 evidence/authority SDK 请求共用 120 秒 `AbortSignal`，但凭据提供器内部网络解析能否被该信号严格取消仍须在启用线上模式前验证。PowerShell与 root CLI独立校验 Execute 确认，并在实际 install delegate前复检 2–60 分钟 grant window。本轮只运行 `LocalValidate`，没有 AWS 调用或线上 candidate，也未接入默认 Worker/J4c/Schedule，两个 blocker与四个 readiness gate继续不变。
- B5-J5g-f 将 Shared Cell authority 数据契约升级为显式 schema v2：DynamoDB item 固定 `schema_version=2`，`record_json` 内固定 `schemaVersion=2`，`provision_verified` 与 `cleanup_authorized` 都必须持久化 exact `cloudFormationRoleArn=arn:aws:iam::402010193138:role/TechlongSandboxCellCloudFormationExecutionRole`。该字段同时进入 provision/cleanup operation hash、record hash、同 lineage 比较与 admission-drain lineage；live provision evidence与online provision/cleanup operator summary也升级为v2并携带该RoleARN，plan-only Janitor源码只解码v2 authority，并在仍为v1的 `PLAN_READY_MUTATION_DISABLED` result中投影该字段。读取端以无 Projection 的完整强一致 Item 执行 exact v2校验，旧 v1、缺失或额外字段记录均fail closed且不会自动迁移；本轮涉及的入口边界中，LocalValidate envelope与Schedule event继续保持v1，其他独立协议版本也未因authority升级而自动改变。本切片没有新增 online CLI或 root wiring，只做离线源码与定向测试，不调用 AWS/Neon；账号仍无 Cell、authority key仍为 `ABSENT`，已部署J4c仍为 `PLAN_ONLY`，Schedule仍为 `DISABLED`，两个 blocker和四个 readiness gate均不变。线上J4c consumer升级前置现已由J5g-g完成；authority item仍未安装，Schedule仍未启用。
- B5-J5g-g 已完成 J4c authority-v2 plan-only consumer 的受控上线。child Stack `techlong-s3-b5-cell-bootstrap` 当前为 `UPDATE_COMPLETE`，目标模板 raw/canonical SHA-256 为 `a768753c50de3fd3e13a1366ac5493768f794a0635c54274438c9606c1ad11e6` / `4f42f95d7e0b43b309d87acf2fb4795b136a1b40643d433e84606849d46d4673`；已执行 Change Set `techlong-s3-b5-cell-bootstrap-a768753c50de3fd3`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-a768753c50de3fd3/38bd29a4-6926-4a24-947f-1d3c70a80030`）只修改 `CellJanitorFunction.Code`、`Replacement=False`，Schedule 未进入变更集合并继续为 `DISABLED`。实际 Lambda ZIP `CodeSha256=ste9pzx4E+qEezhoPwB+oZRtJv/iYC2szaOhlFVdozI=`，严格 readback evidence 为 `9010a454f0a7573235e6532a2155f102cf211302b711fb7a41af7a38c5d129b8`；两次低成本 probe 逐字一致返回 `ABSENT_SAFE`、`mutationPerformed=false`、`cellStack=MISSING`、`tenantStacks=[]`，evidence 为 `ef7699c9c005eed98077f2e43ebfae8caa78069fff269b5b7db6a645875f3835`。Author/Execute 临时 grant 均已撤销，management 最终为 `LOCKED`（raw/canonical `93f37b585812b49f540a317bfdbdd45a374705347288a2c998c229d31231f9ec` / `1be6a039a759acbf9c8d3211981400122c549bff0be6073e3df008c51b08ae12`）；反向回退目标保持休眠，未创建、未执行。Cell/authority key 仍为 `MISSING`/`ABSENT`；未创建付费 Shared Cell、VPC、ALB、ECS cluster/service、Aurora/RDS 或 Route 53，也未执行 `RunTask`，但两次 Lambda 调用及日志仍可能产生极少量费用。四个 readiness gate 仍全部为 `false`。
- B5-J5g-h 已完成 `PLAN_ONLY` delete-intent reviewed target 与受控 rollout/rollback 形状；本条记录上线前态，实际 live Lambda 更新见本组末条。commit `f7453eef3b500f3808de96c9238ba7999bef8c1d` 固定的目标模板 raw/canonical SHA-256 为 `77a57afeaafc2f26b14ad5d1374c816196395a55720de7ab68dea68ac8c802d7` / `d22612f92f46ba9c060166455cd3e3fc9aa2a12fbb2093e892bfbcf9dc39f142`；目标只精确接受既有 inspect event 与四字段 `delete_shared_cell_stack` event，后者仅别名到同一个只读 planner，输出仍为 `inspect_cell_cleanup_plan`、`PLAN_ONLY`、`mutationPerformed=false`，没有 `DeleteStack` 命令或写权限。上线前 candidate 固定为 `compatible=false`、`reviewedTargetCompatible=true`、`deployedCompatibilityVerified=false`，并保留 `DEPLOYED_JANITOR_EVENT_COMPATIBILITY_NOT_VERIFIED` 与 `PLAN_ONLY_JANITOR_MUTATION_DISABLED` 两个门禁。`DeleteIntentCompatibilityUpdate` 仅允许 `CellJanitorFunction.Code` 单一原地修改；固定 rollback 以 J5g-h 为 exact predecessor、退回 J5g-g 模板，Schedule/IAM 均不变且 Schedule 继续 `DISABLED`。`2026-09-21` 首次只读 `OnlineValidate` 因 J4c 旧代码把已合法部署的 J5g-a 两个 Role 误当作必须缺失而安全失败；controller 随后改为独立调用 lifecycle `InitialLocked` strict readback，并继续保留 Cell/VPC/ALB/ECS/RDS/tenant absence 门禁。修复后的只读重试证明 J5g-a 四资源根为 exact `InitialLocked`、J4c management 为 exact `LOCKED`、当时线上 child 仍是固定 J5g-g 模板和实际 Lambda ZIP（readback evidence `9010a454f0a7573235e6532a2155f102cf211302b711fb7a41af7a38c5d129b8`）；该只读阶段没有 AWS mutation。四个 readiness gate 仍为 `false`。
- 同日已在明确授权下写入并严格回读 J5g-h immutable child template object，并创建、独立检查和执行 BootstrapAuthorGrant Change Set `techlong-s3-b5-cell-bootstrap-management-bootstrap-author-grant-564500d8de43a791`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-management-bootstrap-author-grant-564500d8de43a791/107637ed-4e23-43b4-9074-219f953a2f2c`）。AuthorGrant 模板 raw/canonical 为 `c2ede193a427e94138576c6c4bcfd5e4a1a9a0d98c5aaa8f758cd4b17ba59aa7` / `d270c7f46e1a3f4feada2f9af669bede778aae09df6b21a4f175b734b0dd1fde`，到期时间为 `2026-09-21T14:07:00.000Z`。短时 AUTHORGRANT 内创建并严格核验但未执行 child Change Set `techlong-s3-b5-cell-bootstrap-77a57afeaafc2f26`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-77a57afeaafc2f26/c23635d0-f9e6-45f0-b7a9-d322ce17dacc`）；撤权后的最小只读查询仍确认其为 `CREATE_COMPLETE / AVAILABLE`，唯一变更是 `CellJanitorFunction.Code` 原地 `Modify`、`Replacement=False`、`RequiresRecreation=Never`。随后创建并独立检查 BootstrapAuthorRevoke Change Set `techlong-s3-b5-cell-bootstrap-management-bootstrap-author-revoke-cc929043094d0529`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-management-bootstrap-author-revoke-cc929043094d0529/15645fc0-8e63-4045-ae7b-10b6f0fee395`），确认它只修改 `CellBootstrapManagerBoundary`、`Replacement=False` 后立即执行；management 最终严格回读为 `LOCKED`（raw/canonical `93f37b585812b49f540a317bfdbdd45a374705347288a2c998c229d31231f9ec` / `1be6a039a759acbf9c8d3211981400122c549bff0be6073e3df008c51b08ae12`）。child 未执行，Lambda/Schedule/authority 均未改变，也未创建 Shared Cell、VPC、ALB、ECS 或 RDS 资源；随后已另行批准创建 ExecuteGrant candidate，见下一条。
- J5g-h BootstrapExecuteGrant 已使用新的短时到期时间 `2026-09-21T19:30:00.000Z` 完成 `LocalValidate` 与只读 `OnlineValidate`；目标 management 模板 raw/canonical 为 `0df6acb22815883c54831c0b0f86264745bcc150bd37e422f0df019ae5c3edfd` / `b2b1ba02ea77b29ca9fc0c3896d1a6c57b1d09c82b2df069d04f20db44a61524`。在独立创建授权下创建 Change Set `techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-grant-ad19050452566cc7`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-grant-ad19050452566cc7/c94f6f20-c9fa-4e63-8422-3e93fc5986cd`）；独立 Inspect 确认其为 `CREATE_COMPLETE / AVAILABLE`，且唯一变更为 `CellBootstrapManagerBoundary` 的 `Modify`、`Replacement=False`。该候选随后已在另一项明确授权下执行，management 严格回读为 exact `EXECUTEGRANT`；child 执行不属于该授权，见下一条。
- BootstrapExecuteGrant 后的最小只读查询确认 child Change Set 仍为 `CREATE_COMPLETE / AVAILABLE`、没有执行。CloudFormation 不含 property values 的摘要将 `CellJanitorFunction.Arn` 引用显示为 `CellGlobalJanitorSchedule.Target` 的 `Dynamic / ResourceAttribute`、`Replacement=False`；严格 `--include-property-values` 视图只包含 `CellJanitorFunction.Code` 的 `Static / DirectModification`、`RequiresRecreation=Never`。因此没有 Schedule 或 Lambda 写入，也没有创建 Shared Cell、VPC、ALB、ECS 或 RDS；随后已另行批准 child 执行与立即 BootstrapExecuteRevoke，结果见下一条。
- child 执行授权在 `19:15:37 UTC` 到达，距 `19:30:00 UTC` grant 到期只剩约 14 分钟。为保证补偿路径，先创建并独立检查 BootstrapExecuteRevoke Change Set `techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-revoke-645f5e6490b705a6`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-revoke-645f5e6490b705a6/f6fc7e51-ed67-4cc7-8f84-9631d08f6a1a`），确认它只修改 `CellBootstrapManagerBoundary`、`Replacement=False`。child controller 的严格线上预检没有在 grant 到期前完成，因此没有绕过 controller 直连执行；到期后中止预检并执行该撤权 Change Set，management 最终严格回读为 `LOCKED`。最终只读证据确认 child 仍为 `CREATE_COMPLETE / AVAILABLE`，Lambda `CodeSha256` 仍为 J5g-g 的 `ste9pzx4E+qEezhoPwB+oZRtJv/iYC2szaOhlFVdozI=`、`LastModified=2026-09-13T04:34:05.000+0000`，Schedule 仍为 `DISABLED`。J5g-h live deployment 因此仍未执行；下一次必须建立新的 ExecuteGrant 窗口并为完整预检、child 更新和撤权预留更长时间，新的候选已按下一条建立。
- 第二个窗口固定为 `2026-09-21T20:39:00.000Z`，BootstrapExecuteGrant raw/canonical 为 `ae7d9cb0c675d00ef8a1428a17becc0e734bbeb8dcd5d94007fbc03a7e37def8` / `75e7513628500fd3d16b7814d8dd6f4200abb930082e46ec1a4b7cb26511a11b`；Grant `techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-grant-ea884efb97201adf` 已执行，但 child controller 在 Manager STS 身份检查处等待刷新，未提交 child Execute。预先检查的 Revoke `techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-revoke-f17fe09d00f11beb` 随即执行，management 恢复 exact `LOCKED`；child 仍为 `CREATE_COMPLETE / AVAILABLE`，Lambda 仍是 J5g-g 哈希，Schedule 仍为 `DISABLED`。该失败窗口已闭合，最终成功窗口见下一条。
- `2026-09-22` 在刷新 Manager 后建立第三个短时窗口，到期时间 `2026-09-22T05:05:00.000Z`。BootstrapExecuteGrant 目标 raw/canonical 为 `dec70f8f586a2b06b9df4ae1760f1503a8be269b13d01e2da76e69f6d7a5e6bc` / `f6f0691511c62b68f8289d3f056623e8c567ed1cf702b0ed6a9c26adfd75e3ed`；Change Set `techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-grant-44c854a1f9c7bda4`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-grant-44c854a1f9c7bda4/22b70c3d-b10c-4dfb-93db-73a90d18054a`）已创建、独立检查、执行并严格回读为 exact `EXECUTEGRANT`。执行 child 前已创建和独立检查 BootstrapExecuteRevoke `techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-revoke-9874e01a96b258cb`（ID `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-bootstrap-management-bootstrap-execute-revoke-9874e01a96b258cb/87e55f2d-fa17-474b-815b-fcc167b971d4`），确认仅修改 `CellBootstrapManagerBoundary`、`Replacement=False`。随后成功执行原有 child Change Set `techlong-s3-b5-cell-bootstrap-77a57afeaafc2f26`，child Stack 于 `2026-09-22T04:43:28.069Z` 成为 `UPDATE_COMPLETE`；严格回读确认目标 Original template、四资源清单和 Lambda ZIP，`CodeSha256=3cC05X0dGdj6RZpQLW9n5jwJ6Ln9oLfWqCNaZPQdO3k=`、`LastModified=2026-09-22T04:43:33.000+0000`、`RevisionId=dc3da46a-3f72-46dd-9641-42955d56ebb3`、`LastUpdateStatus=Successful`，evidence canonical SHA-256 为 `5c024ac0f296f8ab7aa2a782f711ffbf897c41c4a6ad16b284a322b63ef5339c`。Revoke 随即执行，management 最终恢复 exact `LOCKED`（raw/canonical `93f37b585812b49f540a317bfdbdd45a374705347288a2c998c229d31231f9ec` / `1be6a039a759acbf9c8d3211981400122c549bff0be6073e3df008c51b08ae12`）；Schedule 仍为 `DISABLED`、`rate(15 minutes)`、flexible window `OFF`，四个 readiness gate 仍为 `false`，没有创建 Shared Cell、VPC、ALB、ECS、Aurora/RDS、tenant Stack 或执行 `RunTask`。执行后的 child Change Set 已由 CloudFormation 清理，Source `DescribeChangeSet` 返回 `ChangeSetNotFound`；Stack、Original template 与实际资源回读是完成证据。独立重复 Readback 已再次证明 management 为 exact `LOCKED`，随后 Manager 会话在只读 `ValidateTemplate` 处需要刷新并被安全中止；下一步先刷新 Manager，再单独批准 inspect/delete-intent 两次低成本探针，探针完成前 `deployedCompatibilityVerified` 仍保持 `false`。
- B5-J5g-a-online-1 已把专用 Cell lifecycle IAM 的 `Locked` 管理根扩展为受控线上 controller。固定 management Stack 为 `techlong-s3-b5-cell-lifecycle-management`；入口提供 `LocalValidate`、`OnlineValidate`、`CreateChangeSet`、`InspectChangeSet`、`ExecuteChangeSet`、`Readback`，且 `UpdateShape` 只接受 `InitialLocked`。本切片只允许创建和严格回读四资源、无临时 grant 的 Locked IAM root；原有 `AuthorGrant`、`ExecuteGrant`、`RollbackGrant` 仍只能离线渲染，不能通过该 controller 部署，也不批准付费 Cell。`2026-09-13` 的只读 `OnlineValidate` 已以 raw/canonical SHA-256 `acaa2b5e65361b84ed8fd3fb55d5a512b64bbf51b9fd855837d0adeef2f06bc1` / `803f28a0741f411493852dbaa2282fba2aa109b4f64b4986ee85d97e39eccda5` 通过；随后创建、独立检查并在另一项明确批准下执行 InitialLocked Change Set `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-cell-lifecycle-management-initial-locked-56020f776e9dc476/c546bbff-48b6-40b7-b245-a575d8307f11`，对应 StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-lifecycle-management/fb742b50-afb2-11f1-85b7-02588681429d`。Change Set最终为 `CREATE_COMPLETE` / `EXECUTE_COMPLETE`，Stack与两个 `AWS::IAM::ManagedPolicy`、两个 `AWS::IAM::Role` 均为 `CREATE_COMPLETE`；完整严格 Readback验证了 Original template、参数、标签、输出、policy v1、trust、boundary、attachment和zero-inline。首次执行后的 simulation因缺少 `cloudformation:ChangeSetName` context而 fail closed；补入 deterministic sentinel后，所有目标均精确返回 `implicitDeny`、`MissingContextValues=[]`、`AllowedByPermissionsBoundary=false`，完整 Readback通过。Cell仍为 `MISSING`、authority key仍为 `ABSENT`，四个 readiness gate保持 `false`。AWS 对普通 Stack 的 CloudFormation service-role trust 是否稳定提供 `aws:SourceArn` / `aws:SourceAccount` 没有官方保证，因此当前继续使用 service principal trust，并依靠 exact boundary、inline policy、Change Set 与 readback收口。
- B5-J5g-a-online-2 已完成本地安全收口，但尚未调用 AWS：lifecycle controller 现在只新增 `AuthorGrant` / `AuthorRevoke` 两个线上 UpdateShape，并把已部署 management StackId、child raw/canonical SHA-256、reviewed/grant/cell 三个时间点和 digest-derived Change Set name纳入同一不可替换契约；grant最长60分钟，创建/检查、执行管理更新、更新后回读分别要求剩余15/10/5分钟，UPDATE只允许 `CellOperatorBoundary` 的单一 `Modify` 且 `Replacement=False`。`ExecuteGrant` / `RollbackGrant` 和付费Cell执行继续无法通过该controller选择。新增确定性candidate compiler固定18种资源、三小时Cell TTL、四tag和成本上界，但明确输出`PLAN_ONLY_JANITOR_EVENT_INCOMPATIBLE`、`cloudApplyReady=false`；只读preflight还核验Locked根、Cell `MISSING`、authority `ABSENT`、J4c PLAN_ONLY/DISABLED、AZ、ACM、Trust Store、Aurora与service-linked roles。build-source Bucket的digest路径不可覆盖/不可删除策略目前只写入IaC，尚未部署。CREATE型child Change Set会产生`REVIEW_IN_PROGRESS`占位Stack并与当前AuthorRevoke的Cell=MISSING围栏冲突，因此本切片不提供child author写入口、不创建Change Set，也不打开任何readiness gate。
- `2026-09-19` 已使用精确 Source login session 完成 J5g-a-online-2 之后的只读线上 prerequisite inventory；因账号内没有 ELB Trust Store，未伪造 ARN、也未绕过完整入口的 exact-ARN 门禁，而是逐项运行入口内的原始检查函数。修复 PowerShell 对 DynamoDB 精确空对象 `{}` 的 member-enumeration 假阳性后，12 项中 7 项通过：Source/MFA、Locked 四 IAM 资源、Cell `MISSING`、authority `ABSENT`、J4c PLAN_ONLY/DISABLED、两 AZ、Aurora PostgreSQL 16.14 Serverless v2。5 项保持 blocker：Janitor 仍不接受 `delete_shared_cell_stack`；唯一 ISSUED 证书仅覆盖 `api.techlong.cloud` 而非 `*.sandbox.techlong.cloud`；Trust Store 数量为零；ELB service-linked role 缺失（ECS/RDS 两项存在）；build-source Bucket Policy 尚无 `DenyMutableSharedCellTemplateOperation`。本次没有任何 AWS mutation，也没有批准 AuthorGrant、child Change Set、付费 Cell、DNS、证书或 Trust Store 创建。
- 同日新增专用 `SharedCellTemplateImmutability` 受控更新形状，用于单独闭合上述 build-source blocker。它把 Source、固定 Bootstrap StackId、线上 J5e Revoke baseline canonical SHA-256 `8231ff876b99b3f5374d1ee2978736f8ba3a48f1260f3d85382e67e9a453caf9`、exact三项Stack tag、完整旧 Bucket Policy/public-access/ownership/versioning/lifecycle readback 和唯一 `CodeBuildSourceBucketPolicy` `Modify`/`Replacement=False` Change Set纳入门禁；目标四statement策略分别保持TLS deny、仅允许`If-None-Match: *`首次写、无条件拒绝对象/版本删除、拒绝修改Bucket lifecycle，并同时保护`b5-shared-cell/templates/sha256/*`与`b5-cell-bootstrap/templates/sha256/*`两个digest前缀。下游child controller同步改为严格接受该策略并永久保留digest对象。Execute在调用成功后必须先观察到同一 ClientRequestToken 的根 Stack `UPDATE_IN_PROGRESS`事件，才进入完成 waiter，随后及独立`Readback`都要求目标 Original template和完整四statement策略精确匹配。目标raw/canonical SHA-256为`13d4bcb5cc799fc54610a4398aa2cbaf13a410354eb83e720db4116ad3d71435` / `ccf14717e1fa8ec1ccfe453b2d96211022e0df4bf060105b7f4c3a6b98cd745a`。只读 `OnlineValidate` 已通过；Change Set `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-s3-b5-support-shared-cell-template-immutability-13d4bcb5cc799fc5/bec0ec64-40a7-4684-b755-7aad4b156aac` 的唯一资源差异为既有 Bucket Policy 原地修改，控制器还按 AWS 实际展开结果精确校验完整 `BeforeContext`/`AfterContext`、四个静态 statement `Add` detail及其值。该 Change Set 已于 `2026-09-20` 执行完成，最终为 `CREATE_COMPLETE / EXECUTE_COMPLETE`；Bootstrap Stack 于 `2026-09-20T19:13:07.274Z` 成为 `UPDATE_COMPLETE`。自动回读和随后独立 `Readback` 均验证目标 Original template及完整四statement Policy，期间未写入或删除任何S3对象，所有 runtime readiness gate 仍为 `false`，也未创建 Cell。
- B5-J2 的订单服务源码已实现真实 inspect-only production composition：只用 RDS-managed Secret ARN 读取 exact username/password，以校验过的 management endpoint/port/database 和目标 database/role 建立 PostgreSQL TLS 只读连接，读取有界 catalog/ownership marker，再通过既有 immutable publisher 写入受约束的 S3 raw receipt。该入口不实现 `prepare_empty_database`、`restore_approved_baseline`、`migrate_saas`、`verify` 或 `destroy`，也没有运行 ECS task。对应 CloudFormation IAM 变更已通过 `LifecycleReadback` 三阶段增量 Change Set 部署并在线回读：只修改两个 boundary 和两个 role，全部无 replacement；Build #4 也已由当时后端提交构建并完成零发现扫描。该阶段结束时还没有 TaskDefinition；runtime config 与四个 readiness gate 均未打开。
- B5-J3 当前通过单资源 Stack `techlong-sandbox-tenant-b5j3`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-b5j3/5e145df0-a4f2-11f1-b674-0e76530b9cdf`）注册并严格回读 `arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-lifecycle:2`；旧 revision 1 已为 `INACTIVE`。revision 2 固定 destroy-capable Build #7 digest、inspect-default 命令和原有 Fargate/hardening 边界；模板 raw/canonical SHA-256 为 `68af0afca7b18827ab50fe493137b299a884b701773b025546d1ecdf2e14af11` / `127b4bf5cf634c84737df5fd7cba2eac94424a42e7974166b607036b42df1962`，properties canonical SHA-256 为 `f580ece0458b701091802dc3ca2789dccc2e5d85732c5932d65400eb87453850`，回读证据 canonical SHA-256 为 `f3b8fb0d9eeb2386658f49e51fe4687da8a7e345c443934a98171f7e512b51cb`。临时 grant `techlong-s3-b5-support-lifecycle-task-registration-grant-a24567a02879a2be`（UUID `f4ae26bb-b5c6-4537-8b82-10a1414479fc`）将 boundary 推进至 `v6` 后，revoke `techlong-s3-b5-support-lifecycle-task-registration-revoke-68a34349f703dd52`（UUID `f703d78e-f368-41f5-8d08-45dea15c8310`）恢复 `v7` `LOCKED`，只保留两个 baseline PassRole。没有 `RunTask`、Cell 或 runtime config；四个 readiness gate 继续为 `false`。
- B5-J4a 已通过独立单资源 Stack `techlong-sandbox-tenant-b5j4logs` 创建并两次严格回读 lifecycle LogGroup `/saas/cell-sandbox-1/tenant-lifecycle`。模板 raw/canonical SHA-256 为 `65c00d1c139991627a6f1801cc4887de53352b6e884064850df339cd6da0455c` / `4999c5fd89edd2aa9476cafc2a802871198b88bbdf103305dd442713281a90c2`，live evidence canonical SHA-256 为 `c2270d6344b1b93e80af9c41c47cfbfcec5ac45c14b5b93692aeb98f4f3086c6`。唯一日志组为 `STANDARD`、保留 1 天，零 stream/bytes/metric filter/log-group subscription/account subscription，无 KMS/data protection/bearer-token authentication。Provisioner 只通过 exact CloudFormation execution role 创建，Logs 直接只读回读使用现有 source AWS CLI `login_session` profile，没有扩展 IAM。`ExpiresAt` 不会触发 Janitor 自动删除；B5-J3 模板不改、精确 Cluster 仍为 `MISSING`、四个 gate 仍为 `false`，没有执行 `RunTask`。
- B5-J4b 已于 2026-08-26 在 Account `402010193138`、Region `ca-central-1` 完成受控在线部署。IAM-only 管理 Stack `techlong-s3-b5-cell-bootstrap-management`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap-management/e1bacdf0-a0ca-11f1-a27e-0e9a646108cf`）在 J4b 阶段结束时为 `UPDATE_COMPLETE`，集中持有 Manager、CloudFormation execution、Janitor 与 Scheduler 四组 boundary/role，共 8 个 IAM 资源；当时状态已回到 `LOCKED`，J4b locked 模板 raw/canonical SHA-256 为 `15ec52203f390d29858fb77e032c4d6bff83d5c3678397bf133bf60e6ab9d553` / `5d09bbc9010de13dfdba09b71c13c58711a9238cb09cd78eb767f509b29c07a1`。子 Bootstrap 的 author、execute 和 rollback 权限继续拆成短时、摘要绑定的 grant；本次实际执行遵循 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked`，每个授权窗口后立即撤销。child 模板按 raw SHA-256 内容寻址存入私有 build-source Bucket 的 `b5-cell-bootstrap/templates/sha256/<raw>.json`，位于 Provisioner 可写的 `source/*` 之外；AuthorGrant 精确锁定 `TemplateUrl`、CloudFormation `RoleARN`、deterministic `ChangeSetName`、4 种 `ResourceTypes` 和 exact object，ExecuteGrant 前完成了 exact child Change Set 与原始模板预检。子 Stack `techlong-s3-b5-cell-bootstrap`（StackId `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-s3-b5-cell-bootstrap/2477b820-a174-11f1-aca9-0668f7a50fdf`）在 J4b 创建完成时为 `CREATE_COMPLETE`，经后续 J4c/J5g-g 原地更新后当前为 `UPDATE_COMPLETE`；J4b child 模板 raw/canonical SHA-256 为 `8eeef35a7936cdd1f4613434d8b7990630b192707e92ea4b5f21637f7cdaf15f` / `2bfe9ec02c7939abbab48fb07a9126e7dc7684472607c2d8787623720e88f389`。它精确只有 4 个非 IAM cleanup/read-only 资源：1 天 STANDARD LogGroup、只读 inventory Lambda、Scheduler Group 和保持 `DISABLED` 的 15 分钟 Schedule，Lambda 未配置 reserved concurrency。J4b 严格回读 evidence hash 为 `b6e8083c3c04de9daccecfe3ca1e0c242ae2b27131f0c683ec2097f795ae97cc`，两次空 inventory `ProbeJanitor` 的 evidence hash 为 `d77199f776408f75d722176805ba09853caee51ee4639b87d879b013d4a967ca`。child 不拥有 IAM lifecycle，外置 execution role 仅可 `PassRole` 两个由管理栈持有的外部最小角色；账号仍没有 Shared Cell、VPC、ALB、ECS cluster/service 或运行中的 task、RDS、Route 53，也没有执行 `RunTask`。J4b 当时既有 inspect-only revision 1 未变；后续已由 Build #7 的 inspect-default `tenant-lifecycle:2` 取代，revision 1 现为 `INACTIVE`。本切片是低成本而非零费用，S3、CloudWatch Logs、Lambda 与 Scheduler 请求仍可能产生少量费用；它不构成付费 Cell 批准，`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false` 全部保持不变。
- 单租户 Sandbox canary 暂时不恢复普通 TaskRole 的任何 S3 权限。租户模板固定注入 `APP_RUNTIME_MODE=aws_sandbox_ephemeral_canary`、`ALLOW_EPHEMERAL_IMAGE_STORAGE=true` 与 `IMAGE_STORAGE_PROVIDER=local` 三个值，订单服务只有在前两个精确门禁同时匹配时才允许 production-mode 本地图片目录。`/app/images` 是 task-local 临时存储：重启、替换、重新部署或删 Stack 都会永久丢失上传文件并可能留下失效数据库 URL。canary 禁止上传真实客户素材、不验证图片持久性，也不能据此宣称 production-ready；正式资产方案仍必须使用每租户/每 generation 专用 TaskRole 与 exact S3 prefix，另行评审 IAM/CloudFront 后实施。
- S3-B 已提供不可变模板 v2 编译器、2048 位以上 RS256 实例 JWT、固定 8443 的 mTLS HTTPS transport，以及 POST provision 后再 GET control 对账的严格闭环；首位 Owner 密码不会写入部署记录。
- Shared Cell B3/B4 仍只生成 `renderOnly=true`、`applyReady=false` 的独立模板。模板现有独立 one-shot SG：零入站，出站仅 TCP 443 到公网和 5432 到 exact DB SG；DB 的 5432 入站只接受 app/one-shot 两个 SG，普通 app SG 仍只收 ALB:3000。只读 preflight 会验证公共 task subnet、SG/VPC/输出/所有权/TTL 绑定及这些 exact 规则。Sandbox 公网 IP 是无 NAT/endpoint 的低成本出站权衡，不等于开放入站；production 保持私网 `AssignPublicIp=DISABLED`。B5-J4b 已把持有 8 个 IAM 资源的管理根与只含 4 个非 IAM 资源的 cleanup-only 子 Bootstrap 分离，并在 AWS 完成部署、严格 readback/IAM simulation 与两次空 inventory probe；管理 Stack 最终为 `UPDATE_COMPLETE`/`LOCKED`，子 Stack 在 J4b 创建时为 `CREATE_COMPLETE`，经 J4c/J5g-g 原地更新后当前为 `UPDATE_COMPLETE`。子执行角色没有 IAM lifecycle，只能 Pass 两个管理栈外部最小角色，Schedule 固定 `DISABLED`，Lambda 没有 reserved concurrency；账号仍没有 Shared Cell、Cell apply/delete role、VPC、ALB、ECS cluster/service 或运行中的 task、RDS、Route 53，也没有执行 `RunTask`。J4b 当时既有 inspect-only revision 1 未变；后续已由 Build #7 的 inspect-default `tenant-lifecycle:2` 取代，revision 1 现为 `INACTIVE`。未来 Cell TTL 仍固定 3 小时、租户 TTL 为 2 小时，创建/校正前还要求至少 15 分钟清理缓冲。

- `2026-09-22` 刷新 Manager 后，`ProbeJanitor` 再次完成 management/child strict readback，并按批准各执行一次 inspect 与 exact 四字段 delete-intent 低成本调用。两次响应逐字一致：`action=inspect_cell_cleanup_plan`、`coordinatorMode=PLAN_ONLY`、`decision=ABSENT_SAFE`、`mutationPerformed=false`、`cellStack=MISSING`、`tenantStacks=[]`；canonical evidence SHA-256 为 `f98e7468920b42403aa04c8323b1f7dd46b85121a1354933083a6158f2a7ea47`。当前 candidate 已将 `deployedCompatibilityVerified` 绑定该证据并置为 `true`，只关闭 `DEPLOYED_JANITOR_EVENT_COMPATIBILITY_NOT_VERIFIED`；整体 `compatible=false`、`PLAN_ONLY_JANITOR_MUTATION_DISABLED`、`cloudApplyReady=false`、`executionReady=false` 与四个 runtime readiness gate 全部保持不变。Schedule 仍为 `DISABLED`，management 仍为 exact `LOCKED`，没有创建/删除 Cell、tenant Stack 或 authority item；两次 Lambda 调用及日志可能产生极少量费用。随后已进入下一条所述的失败补偿离线实现；这不是 Cell Apply。
- B5-J5g-i-offline-1 已实现 `REVIEW_IN_PROGRESS → DELETE_IN_PROGRESS → MISSING → AuthorRevoke` 前半段的可执行补偿状态机与离线 IAM 候选，但尚未接到 AWS。状态机只接受 exact CellOperator 读/写端口身份与区域、authority strong `ABSENT`、同一 StackId/四标签/execution RoleARN 的顶层零资源占位栈和 immutable candidate；补偿 review/expiry 也进入独立 plan digest，`DeleteChangeSet`和`DeleteStack`前分别要求严格多于 10/5 分钟授权余量。`REVIEW_IN_PROGRESS + Change Set present`先删 exact ARN，已删除则在新批准的 Execute 中跳过该步；跨新窗口 plan digest 会改变，但同一删除意图的 DeleteStack client token 保持稳定；`DELETE_IN_PROGRESS`绝不重提删除，只做有界只读等待，提交后取消则明确返回 post-submit uncertain。只有 name-bound `DescribeStacks`、`GetTemplate(Original)`、`ListStackResources`和 exact ARN `DescribeChangeSet`连续两轮都证明不存在，且 authority仍为`ABSENT`，才输出`safeToAuthorRevoke=true`。Recover没有mutation port，但可只读收敛异步删除；REVIEW、AccessDenied、超时、漂移或非空资源仍 fail closed。纯核心不提供跨进程持久锁，production controller必须对同一plan实施single-flight/持久claim，不能并发启动两个Execute。`AuthorCompensationGrant`仅在模板元数据记录 approved plan/Change Set ARN，并未在 renderer 内重算或验证 plan；IAM限定 exact StackId + Change Set name、四标签、review下界、动作级10/5分钟截止且禁止请求覆盖RoleARN。IAM也不能证明零资源状态或删除顺序，因此该组合 grant 继续`LocalValidateOnly`且明确要求上线前拆分 DeleteChangeSet/DeleteStack 两个 grant；它不含Create、Execute、PassRole、S3或execution-role inline policy。AuthorRevoke仍是独立审批动作；本切片没有AWS调用或线上状态变化，readiness与`PLAN_ONLY_JANITOR_MUTATION_DISABLED`均不变。
- B5-J5g-j1 已完成补偿的 dormant AWS SDK 基础与两段能力拆分，仍未接默认 runtime。核心只把 `DescribeChangeSet` 可观察字段、Stack 上的 RoleARN 和 `GetTemplate(ChangeSet ARN, Original)` 当作 provider evidence，并将跨 grant 窗口稳定的 operation identity、窗口绑定的 base plan 与 DeleteChangeSet/DeleteStack phase plan 分开编译。两个新 executor 分别只持有一种写能力并要求 base + phase 双摘要；SDK adapter 固定 CellOperator profile、MFA、`ca-central-1`、共享 lazy credentials、隔离的 read/write clients 和写侧 `maxAttempts=1`，只发送 exact reviewed envelope。renderer 也新增两个 offline-only split grant；它们继续 `CloudApplyEnabled=false`，且明确记录 exact ARN 写请求与短名称 `cloudformation:ChangeSetName` 条件的 AWS-backed 兼容性尚未验证。本切片没有 AWS/Neon 调用、云端写入或费用变化。
- B5-J5g-j2 已完成离线持久 claim 与 phase write-ahead controller。独立 `0009` 建立 operation、append-only review window、recover-only attempt与event；Neon store以数据库时钟及完整token/attempt/revision/lease fence执行CAS。每个DeleteChangeSet/DeleteStack窄delegate前必须先落库exact mutation，响应不确定后只能由无mutation port的Recover收敛；phase完成停在`*_revoke_required`，不会自动撤权或推进。`0009`尚未应用，controller仍default-off且未接runtime。
- B5-J5g-j3 已继续离线补齐Grant/Revoke本身的持久生命周期。`0010`新增不可删除的GRANT/REVOKE action账本和statement-end约束，封死legacy prepared→ready、过期ready直接换窗及未Locked直接推进三条旁路，并用strict `IS TRUE`约束阻断PostgreSQL `CHECK UNKNOWN`旁路。Grant、phase-completed Revoke与window-expired Revoke都必须先durable write-ahead；最后一次caller abort检查后的CAS和唯一delegate分别使用独立30秒协作式abort signal，响应不确定只允许只读reconciliation，CAS与delegate之间的进程崩溃仍明确保留人工裁决边界。可信回执生产器要求固定management Stack、四个IAM资源、Original template、Cell `MISSING`、authority `ABSENT`在30秒内两次稳定回读；cutoff前回执为`PHASE_EXECUTION_ALLOWED`，跨cutoff晚到对账只能标记`REVOKE_ONLY`并沿同一live claim立即撤权；phase完成CAS也返回递增revision的live claim供立即撤权，phase入口会在claim前拒绝`REVOKE_ONLY`。`0009`/`0010`均未应用，真实management adapter、AWS-backed ARN/IAM兼容性与线上分段演练仍未完成；没有AWS/Neon调用、IAM变化、Cell或费用变化。

- B5-J5g-j4 已离线完成真实 management 读取适配器、只执行预审 Change Set 的窄写端和受控入口组合。local review 重渲染前置/目标模板并绑定完整 Change Set ARN、lifecycle contract 与双摘要，输出 `preparedActionSha256`；Source login-only SDK 构造无 I/O，IAM/Cell/authority readback 失败则关闭，单次 Execute 使用稳定 token、`maxAttempts=1`，并发与响应丢失均不重提。CLI 仅 LocalValidate/ReviewManagement，default runtime 未接线。`0009/0010`、split grant cloud-apply、ARN/IAM compatibility 与线上演练仍未闭合；J5g-j3 的 Cell `MISSING` 回执也尚不能覆盖真实零资源占位栈，下一阶段先闭合这项语义差异。本阶段没有 AWS/Neon 调用或线上状态变化。

- B5-J5g-j6 已完成 0009/0010 独立迁移审阅入口，并于 `2026-10-03` 对同一 Neon 目标执行一次真实 READ ONLY 检查：已应用 catalog 仍为 exact 0001–0008，critical schema/counters/admission 与封存 receipt 一致，补偿 namespace 为空，pending 仅为固定校验和的 0009/0010。保存后独立复验 manifest SHA-256 `15f2d38567e897ae9cd7e1a399b9baa868ea45011cac180db0698c1984ba295f`，固定 `applyEnabled=false`、`mutationPerformed=false`；15 分钟检查有效期不是写入授权，后续执行前必须刷新。没有应用 migration、访问 AWS 或改变 readiness gate；全量测试 718/718 通过。下一阶段是受控 migration 写入/独立回读恢复入口审阅，实际数据库写入、IAM 兼容性证明和分段补偿演练仍分别审批。

- B5-J5g-j7 已实现独立 0009/0010 atomic Apply 与只读 Recover 入口，默认关闭、未接 runtime。锁先于 snapshot、固定 review/目标/checksum、PG18 精确结构基线、COMMIT 前再验及独立 pool 回读共同约束唯一写入；提交响应不确定时只读对账，不自动重放/down migration。真实 Neon Recover 于 `2026-10-03` 返回 `RECOVERED_NOT_APPLIED`，仍为 exact 0001–0008 / 补偿 namespace ABSENT，回执 SHA-256 `dedb131f39196c53b6028e52957f50d4d09b6e668e71a46422e2afc3c18fcae8` 已独立复验；全量 726/726 测试通过。本轮未执行 Neon 写入或 AWS 变更。下一步重新采集 fresh review，再单独批准 0009/0010 实际应用；这不批准 IAM grant 或 phase mutation。

- B5-J5g-j7-online-1 已按明确批准的 fresh manifest `b4a92d3ea0549e2dc4f15a8dce8efadd7c0c23dee77bc7d1df504b444fe76d48` 原子应用 Neon 0009/0010；执行器独立回读 `APPLIED`，随后单独进程只读 Recover再次证明 exact 0001–0010、全结构与补偿表零数据状态。Apply / 独立 Recover receipt SHA-256 分别为 `22b303e4863b1a623990a80587b5bc28febbbb8929769df1cad84385df1c8400` / `1099061d4bd34fb86849088c6302813448d30dbc17bdab5e3d30976f334fa09c`，保存后独立验证通过。旧 J5g-e2 receipt/catalog未改写；没有 AWS 调用、IAM grant 或 runtime/gate变化。补偿 schema 安装门禁已闭合，下一步独立准备 AWS exact ARN/IAM compatibility 证明，实际 grant/mutation 继续分别批准。

## 当前没有实现

- Paddle、自动续扣、Stripe 订阅模式、退款自动化、优惠券和复杂发票系统。
- 复杂发票、优惠券和自动退款。
- B5 的离线 ownership epoch、schema v2 RoleARN-bound 原子 authority 契约、可恢复 cleanup 状态机、AWS SDK v3 ECS/S3/Secrets Manager/DynamoDB 适配器源码、可信 receipt publisher/reader、订单服务 lifecycle 入口、真实 inspect-only Secrets Manager/PostgreSQL/S3 receipt provider、default-disabled Worker root composition、低成本 receipt/DynamoDB/IAM 支撑资源、已上线且保持锁定的 cleanup-only Cell Bootstrap，以及严格校验和一次性 PostgreSQL 测试基础已经存在，但仍没有生产 material generator、完整的 PostgreSQL 变更/销毁 provider、approved baseline、Shared Cell 证据客户端 live root wiring、稳定且可清理的 Owner Secret 数据源，以及 Shared Cell 的实际部署。订单服务只有 `POST /api/saas/provision` 已实现单调 epoch CAS，其他控制写接口尚未加 fence；相关应用源码仍未部署。J5g-e1 的真实 Neon `OnlineInspect` 已证明迁移前 exact `0001`–`0004` 与仓库一致，J5g-e2随后已原子应用 `0005`–`0008`，并独立只读回读 exact `0001`–`0008`、23个启用trigger、20个索引、23个已验证constraint及默认admission状态。J5g-f 只闭合了 authority 记录自身的 execution-role lineage；它尚未接入 production collector/root，也没有在线 authority item可迁移或回读。`registrationReady=false`、`liveReadbackReady=false`、`applyRuntimeReady=false`、`cleanupRuntimeReady=false`，因此当前不会真实创建 Cell、租户资源或自动回写正式入口。
- 平台尚未实际调用订单服务 S2 控制接口，也没有部署生产 mTLS 证书、Trust Store 或 DNS；模板部署驱动和 `app_instance_deployments` 仍不会触发真实自动部署。
- 多产品市场。
- 成员邀请和角色变更。
- 邮箱验证、忘记密码/重置密码、MFA、邮件自动发送和第三方 OAuth。
- 面向公网的 IP 级限流、验证码和完整安全告警。

当前认证一期适合本地和受控测试。密码不会以明文保存；正式公开上线前仍应补齐邮箱验证、密码重置、IP 级限流和安全监控。

## 技术栈

- TypeScript
- React 19
- Next.js 16 API / App Router 风格
- Vinext + Vite
- Tailwind CSS 4
- Drizzle ORM + Neon PostgreSQL
- Vinext + Vite 本地运行（可后续部署到自有托管环境）

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm ci
copy .env.example .env.local
npm run dev
```

在 `.env.local` 设置 Neon 和 Stripe 服务端配置：

```env
DATABASE_URL=postgresql://app_user:password@example-pooler.neon.tech/neondb?sslmode=require
AUTH_SESSION_DAYS=7
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
AWS_REGION=ca-central-1
AWS_DEFAULT_CELL_KEY=cell-sandbox-1
AWS_DEPLOYMENT_ENVIRONMENT_KEY=aws-sandbox-ca-central-1
AWS_APPLY_ENABLED=false
AWS_SANDBOX_ACCOUNT_ID=402010193138
AWS_SANDBOX_BUDGET_LIMIT_USD=10
AWS_SANDBOX_TTL_SECONDS=7200
AWS_SANDBOX_MAX_CELLS=1
AWS_SANDBOX_MAX_TENANTS=1
AWS_SANDBOX_BASE_DOMAIN=sandbox.techlong.cloud
```

首次切换现有 Neon 数据库时，先应用增量迁移，再初始化或重置一个平台管理员密码：

```powershell
npm run db:postgres:migrate
$env:AUTH_BOOTSTRAP_EMAIL="admin@example.com"
$env:AUTH_BOOTSTRAP_NAME="平台管理员"
$env:AUTH_BOOTSTRAP_PASSWORD="请替换为至少12字符的临时密码"
npm run auth:bootstrap-admin
Remove-Item Env:AUTH_BOOTSTRAP_PASSWORD
npm run dev
```

`auth:bootstrap-admin` 会复用同邮箱的现有用户，并设置 `is_platform_admin=1`；重复运行会重置该管理员密码并注销其旧会话。不要把真实密码写入 `.env.example`、源码或 Git。

常用命令：

```bash
npm run db:generate
npm run db:postgres:init
npm run db:postgres:migrate
npm run auth:bootstrap-admin
npm run typecheck
npm run build
npm run lint
npm test
```

## 环境变量与管理员初始化

`NEXT_PUBLIC_PLATFORM_NAME` 仅用于公开品牌名称。`AUTH_SESSION_DAYS` 控制自有登录会话有效天数，可设为 1–30，默认 7 天。平台管理员权限只由数据库 `users.is_platform_admin` 决定，不再通过邮箱允许名单自动提升。

`DATABASE_URL` 是服务端使用的 Neon PostgreSQL pooled connection string。本地通过未提交的 `.env.local` 配置，未来部署时应使用目标托管平台的 secret；不要添加 `NEXT_PUBLIC_` 前缀，也不要把真实连接串提交到 Git。`npm run db:postgres:init` 只用于初始化全新的空 `public` schema，检测到已有表时会拒绝执行；已有数据库使用 `npm run db:postgres:migrate`。

Stripe 一期只需要服务端环境变量：`STRIPE_SECRET_KEY` 和 `STRIPE_WEBHOOK_SECRET`。本地测试使用 `sk_test_...` 和 Stripe CLI 生成的 `whsec_...`；生产环境在目标托管平台配置对应的 secret。两者都不能以公开环境变量、前端代码或 Git 提交方式保存。

AWS Sandbox 固定目标为 Account `402010193138`、Region `ca-central-1`、月预算 `10 USD`、TTL `7200` 秒、最多一个 Cell 和一个租户、基础域名 `sandbox.techlong.cloud`。默认 `DEPLOYMENT_WORKER_ENABLED=false`、`AWS_APPLY_ENABLED=false`；单独修改任一变量都不能执行。数据库环境开关、assumed-role STS 身份、严格参数、cleanup 记录、租户数据库迁移和 mTLS 控制对账必须同时通过。这些变量不代表资源已创建。

在线核验显示：AWS CLI Profile `techlong-sandbox-user` 固定在 Region `ca-central-1`、Account `402010193138`，身份为 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`；该 IAM User 绑定 exact MFA，本机 `techlong-sandbox-provisioner` Profile 产生的会话身份为 `arn:aws:sts::402010193138:assumed-role/TechlongSandboxProvisionerRole/techlong-sandbox-provisioner`，核验过程没有读取或输出密钥。S3-A、B5-I、`LifecycleReadback`、历史 Build #4 与当前 Build #7 均已部署/构建并独立回读。B5-J3 单资源 Stack 当前输出精确绑定 ACTIVE `tenant-lifecycle:2`，镜像为 Build #7 digest，默认命令仍仅为 `inspect`；revision 1 已为 `INACTIVE`。临时 grant 与随后 revoke 都只修改 `ExecutionRoleBoundary` 且 `Replacement=False`；最终 boundary `v7` 为 `LOCKED`，PassRole 仅保留 TaskExecutionRole 与普通 TaskRole。B5-J4b 的 8-IAM-resource 管理 Stack 已达到 `UPDATE_COMPLETE` 并回到 `LOCKED`；4-resource cleanup-only 子 Stack 在 J4b 创建时为 `CREATE_COMPLETE`，经 J4c/J5g-g 原地更新后当前为 `UPDATE_COMPLETE`。J5g-g 的严格 readback 与两次 `ABSENT_SAFE` probe 均通过，Schedule 为 `DISABLED`，Lambda 未配置 reserved concurrency。精确 Cell cluster 仍为 `MISSING`，账号未创建 Shared Cell、ALB、Aurora/RDS、VPC、Route53、租户服务或正式租户 Stack，也没有执行 `RunTask`。进入真实租户 Apply 前，应继续使用短期角色会话；不要在仓库或 `.env.local` 中配置长期 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`。

只读 `organizations describe-organization` 返回 `AWSOrganizationsNotInUseException`，因此账号当前是 standalone，不属于 AWS Organizations。SCP 当前不可用，本方案也不会为了获得 SCP 而让账号加入 Organizations；S3 使用窄权限 IAM Policy、高风险动作显式 Deny、Permissions Boundary 和专用 AssumeRole 角色组合控制权限。账号类型已经确认，S3 前无需重复把“确认账号类型”列为门禁，除非账号归属后来被人工改变。

账号原有的 `My Zero-Spend Budget`（`1 USD`）保持不变；S3-A 已另行部署按 `Environment=aws-sandbox` 过滤的 `10 USD` Budget，并配置 10/30/50/80/100% 邮件告警。两者都只是有延迟的告警，不是费用硬停。只读 RDS 查询显示 `ca-central-1` 当前提供普通（非 Limitless）Aurora PostgreSQL 16.8–16.14，16.3 不在当前返回列表；S0 的 `>=16.3` 只表示最低兼容约束，真实创建前必须动态核对非 Limitless 版本。S0–S2 基线见 [AWS Sandbox S0–S2 说明](./docs/aws-sandbox-s0-s2.md)，S3 门禁与 Worker 说明见 [AWS Sandbox S3 部署执行器](./docs/aws-sandbox-s3-worker.md)。

平台首个管理员通过 `npm run auth:bootstrap-admin` 初始化。管理员在“客户管理”创建企业后，需要进入客户详情生成一次性激活链接并发送给 Owner；系统本期不自动发送邮件。

## 上线试运行

发布前依次执行 `npm run lint`、`npm run typecheck`、`npm run build` 和 `npm test`。完整的管理员流程、客户流程、状态提示、权限隔离和数据来源验收步骤见 [上线检查清单](./docs/launch-checklist.md)。Stripe 测试模式、Webhook 与上线操作见 [Stripe 支付操作说明](./docs/stripe-payment-operations.md)。

本地试运行时，应至少使用两个不同浏览器配置文件或一个普通窗口加一个无痕窗口：一个登录平台管理员，另一个注册普通企业客户。主流程应由企业 Owner 自助选择共享套餐、填写参数并完成 Stripe 测试付款；管理员手工订阅仅用于应急验证。支付后待开通流程见 [支付后待开通实例说明](./docs/auto-pending-provisioning.md)，AWS Cell 目标架构见 [AWS ECS Cell 部署与执行基础](./docs/aws-ecs-cell-deployment-demo.md)，S0–S2 操作边界见 [AWS Sandbox S0–S2 说明](./docs/aws-sandbox-s0-s2.md)。

## 数据库

当前生产主数据库为 Neon PostgreSQL，应用只从服务端 `DATABASE_URL` 读取连接串。权威 DDL 位于 `db/postgres-schema.sql`，Drizzle 模型位于 `db/postgres-schema.ts` 和 `db/postgres-relations.ts`；`drizzle.config.ts` 已切换为 PostgreSQL。

原 Sites D1 的逻辑绑定名仍为 `DB`，但不再承载应用请求，只暂时保留为切换前的回滚备份。`db/schema.ts` 与 `drizzle/*.sql` 是旧 D1 结构和迁移历史，不能用来初始化 Neon。迁移、连接和回滚注意事项见 [Neon PostgreSQL 操作说明](./docs/neon-postgresql.md)。

以下列表记录业务数据结构的演进；这些表已经完整映射到 PostgreSQL。

阶段 1 创建：

- `users`
- `workspaces`
- `workspace_members`

阶段 2 新增：

- `plans`
- `workspaces.contact_name`
- `workspaces.contact_email`
- `workspaces.plan_id`
- `workspaces.subscription_status`
- `workspaces.app_instance_status`

阶段 3 新增：

- `subscriptions`
- `payment_records`

阶段 4 新增：

- `products`
- `app_instances`

阶段 7 新增：

- `payment_checkout_sessions`
- `payment_webhook_events`
- `payment_records.provider`
- `payment_records.provider_payment_id`
- `payment_records.provider_event_id`
- `payment_records.failure_reason`

阶段 8 新增：

- `app_instances.provisioning_source`（`manual` / `payment_success`）
- `app_instances` 的 `(workspace_id, product_id)` 唯一约束，当前 MVP 每个工作区仅允许一个产品实例

客户自助购买一期新增：

- `subscription_purchase_orders`：保存新购/续费订单、套餐与模板快照、服务器金额、Stripe 会话和处理状态
- `workspace_product_entitlements`：保存 `(workspace_id, product_id)` 对应的当前订阅和唯一应用实例
- `subscriptions.creation_source`：区分 `admin_manual` 与 `customer_checkout`
- `payment_webhook_events.purchase_order_id`：把已验证 Stripe 事件关联到客户购买订单

AWS Cell 部署计划与 S1 执行基础新增：

- `plans.deployment_profile_key`：管理员为共享套餐选择的受控资源档位
- `subscription_purchase_orders.deployment_profile_key`：购买时固定的套餐资源档位快照
- `subscriptions.deployment_profile_key`：付款成功后固定到订阅的资源档位快照
- `deployment_environments`：保存受控环境、预期 Account/Region、Cell、域名和策略快照；`apply_enabled` 在当前 Sandbox 保持关闭
- `app_instance_deployments`：保存应用实例对应的目标计划、哈希、幂等键、环境关联、状态和非敏感输出；不保存凭据或 Secret 值
- `deployment_jobs`：保存 Apply/回滚/校正/清理任务的幂等键、租约、不可复用的 claim token、重试与死信状态；`0006` 迁移已应用，独立 Worker 的真实 Adapter 与运行门禁仍未启用
- `deployment_step_runs`：保存每个部署步骤的输入哈希、尝试次数、结果摘要和脱敏错误，支持将来的可审计执行
- `deployment_tenant_resources`：按应用实例保存租户 database/role/Secret 的当前 owner、generation、Secret ARN 引用和脱敏生命周期证据；对应 `0005` 已应用
- `deployment_tenant_resource_events`：append-only 保存 claim、状态推进、清理和 reopen 的 generation 审计事件；对应 `0005` 已应用
- `deployment_tenant_external_operations` / `deployment_tenant_external_operation_events`：保存 provider 已证明的 provision/cleanup ownership epoch 及 append-only 审计；当前资源只指向一个 active epoch，对应 `0007` 已应用
- `deployment_tenant_cleanup_runs` / `deployment_tenant_cleanup_phases` / `deployment_tenant_cleanup_events`：保存 workload → database/role → Secret 的可恢复清理阶段、稳定 operation ID、脱敏回执与审计；对应 `0007` 已应用

自有认证一期新增：

- `user_credentials`：保存加盐密码哈希、算法迭代次数和登录失败锁定状态
- `auth_sessions`：保存会话 Token 的 SHA-256 摘要和过期时间，不保存浏览器收到的原始 Token
- `auth_invitations`：保存管理员为既有客户生成的一次性激活邀请摘要
- `schema_migrations`：记录已应用的 PostgreSQL 增量迁移及校验和

多产品订阅升级：

- `subscriptions.product_id`（必填）
- `plans.product_id`（迁移回填并由数据库触发器强制必填）
- 套餐名称唯一约束改为 `(product_id, name)`
- 移除 `subscriptions.workspace_id` 的旧唯一约束
- 当前订阅的 `(workspace_id, product_id)` 条件唯一约束
- `payment_checkout_sessions.subscription_id`（必填）及进行中 Checkout 唯一约束

应用实例模板扩展：

- `app_instance_templates`：归属产品的模板主记录
- `app_instance_template_versions`：草稿、已发布、已归档的版本记录
- `plans.template_version_id`：套餐绑定的不可变模板版本
- `plans.template_configuration`：套餐级参数与客户参数默认值（保留原生 number / boolean / null）
- `subscriptions.template_version_id` 与 `subscriptions.instance_configuration`
- `app_instances.template_version_id` 与 `app_instances.configuration_snapshot`
- 默认写入并复用“餐饮订单系统标准模板 v1”，旧套餐和订阅由迁移安全回填
- 数据库触发器阻止跨产品模板、套餐/订阅模板不匹配、已发布版本内容修改以及实例快照与订阅不匹配
- 模板 Schema v2 使用 `outputPath` 将版本快照编译为订单系统的 `entitlements`、`default_store` 和非敏感 `first_owner` JSON；订单控制面本身不接收 XML

订阅必须关联 `workspace`、`product` 和该产品下的 `plan`。数据库使用触发器阻止产品与套餐不匹配，并使用条件唯一索引保证同一 `(workspace_id, product_id)` 同一时间最多一个当前订阅，同时保留已取消订阅作为历史记录；其他产品的当前订阅互不影响。付款记录关联 `workspace`，并可选关联订阅。`amount` 使用最小货币单位整数，避免浮点金额误差。应用实例关联 `workspace`、`product`，并可选关联订阅；对应套餐通过订阅读取，不在实例表重复保存。实例同时保存管理员填写的买家端 `access_url`、卖家端 `seller_apk_url`、`domain` / `slug` 和 `tenant_key`。

迁移会幂等写入默认产品：`餐饮订单系统` / `restaurant-order-system` / `active`，并将旧订阅安全回填到该产品。工作区上的 `plan_id`、`subscription_status` 和 `app_instance_status` 仅作为兼容状态快照，由订阅和应用实例管理操作同步更新；实际订阅以 `subscriptions` 为准，实际应用实例以 `app_instances` 为准。

所有客户业务查询必须通过 `workspace_id` 和成员关系限制范围。平台管理员是唯一允许跨工作区读取基础数据的角色。

## 当前路由

公共路由：

- `/`
- `/login`
- `/register`
- `/unauthorized`
- `/api/health`
- `/api/auth/login`
- `/api/auth/register`
- `/api/auth/logout`

客户路由：

- `/dashboard`
- `/dashboard/members`
- `/dashboard/settings`
- `/dashboard/billing`
- `/dashboard/billing/payment-result`
- `/dashboard/plans`
- `/dashboard/plans/:planId/purchase`
- `/dashboard/apps`
- `/dashboard/apps/:instanceId`
- `/api/account`
- `/api/workspaces/:workspaceId`
- `/api/workspaces/:workspaceId/billing`
- `/api/workspaces/:workspaceId/apps`
- `/api/workspaces/:workspaceId/checkout`
- `/api/workspaces/:workspaceId/purchase-orders`
- `/api/workspaces/:workspaceId/purchase-orders/:orderId`
- `/api/workspaces/:workspaceId/subscriptions/:subscriptionId/cancel-at-period-end`
- `/api/stripe/webhook`

管理员路由：

- `/admin`
- `/admin/users`
- `/admin/customers`
- `/admin/customers/new`
- `/admin/customers/:customerId`
- `/admin/customers/:customerId/edit`
- `/admin/plans`
- `/admin/plans/new`
- `/admin/plans/:planId/edit`
- `/admin/templates`
- `/admin/templates/new`
- `/admin/templates/:templateId`
- `/admin/templates/:templateId/edit`
- `/admin/templates/:templateId/versions/new`
- `/admin/templates/:templateId/versions/:versionId/edit`
- `/admin/subscriptions`
- `/admin/subscriptions/new`
- `/admin/subscriptions/:subscriptionId`
- `/admin/subscriptions/:subscriptionId/edit`
- `/admin/payments`
- `/admin/payments/new`
- `/admin/purchase-orders`
- `/admin/instances`
- `/admin/instances/new`
- `/admin/instances/:instanceId`
- `/admin/instances/:instanceId/edit`
- `/api/admin/overview`
- `/api/admin/customers`
- `/api/admin/customers/:customerId`
- `/api/admin/customers/:customerId/invitation`
- `/api/admin/plans`
- `/api/admin/plans/:planId`
- `/api/admin/templates`
- `/api/admin/templates/:templateId`
- `/api/admin/templates/:templateId/versions`
- `/api/admin/templates/:templateId/versions/:versionId`
- `/api/admin/subscriptions`
- `/api/admin/subscriptions/:subscriptionId`
- `/api/admin/payments`
- `/api/admin/purchase-orders`
- `/api/admin/instances`
- `/api/admin/instances/:instanceId`

保留的后续阶段占位路由不会出现在当前导航中。

## 下一步建议

下一步不是打开 runtime gate、复用已撤销的 J5e grant、创建付费 Shared Cell 或运行现有 TaskDefinition。B5-J5c/J5d 已提供可信 live evidence compiler、absent-only production installer和共享 MFA credential bundle；J5e 已部署 stable exact reads并完成 Grant → Revoke channel drill；J5f 已实现受控未来在线 CLI；J5g-f 已让 future authority item 以 schema v2持久化 exact Cell CloudFormation execution RoleARN，但只完成默认关闭的离线契约。账号当前仍没有 Shared Cell、公共 subnet、one-shot SG、RDS-managed Secret、ACM/ACTIVE Trust Store 或正向 management evidence，authority key 仍为 `ABSENT`，因此没有 v1 item被迁移，也不得执行 CLI 的 Inspect/Execute/Recover 线上操作、产生可执行 live candidate/runtime config或执行 `RunTask`。未来若读到 v1或缺失 `cloudFormationRoleArn` 的 item必须 fail closed，不能自动升级。

J5g-g 已按独立受审的 `Locked → AuthorGrant → Locked → ExecuteGrant → Locked` 序列上线 authority-v2 consumer；J5g-h随后只修改同一 Lambda Code，使其精确接受 inspect 与四字段 delete-intent event，并完成严格 ZIP/readback 与两次逐字一致的 `ABSENT_SAFE` 探针。delete intent仍只归一到`PLAN_ONLY` planner，不能被解释为真实清理能力。J5g-a-online-1 已完成专用 Cell operator/execution role 的 InitialLocked IAM root执行与严格 Readback，四个 IAM资源已创建但有效权限保持 Locked；这不启用任何临时 grant，也不批准付费 Cell。J5g-i-offline-1 已把 exact placeholder补偿建成经测试的状态机；J5g-j1加入真实 CloudFormation/STS SDK adapter和两个隔离phase executor，J5g-j2加入数据库时钟claim、phase write-ahead与只读Recover，J5g-j3又把Grant/Revoke自身纳入不可变持久账本，并要求双次稳定management readback才能签发Grant或Locked回执。全部controller仍default-off且未接runtime，`0009`/`0010`已在J5g-j7-online-1独立批准下原子应用并完成独立只读回读，`cloudformation:ChangeSetName`对exact ARN请求的AWS语义仍待验证，因此所有补偿shape继续`CloudApplyEnabled=false`。J5g-j4已离线补齐真实management read/mutation adapter与受控入口，J5g-j5以完整candidate/摘要绑定和exact零资源双读闭合占位栈回执语义；J5g-j6已用真实Neon只读检查证明exact 0001–0008与补偿namespace ABSENT，并生成独立0009/0010 review；J5g-j7受控入口已完成真实Neon Apply与独立Recover，补偿schema安装门禁已闭合；J5g-j8已收紧split候选为exact ARN condition并完成13项AWS只读custom-policy检查；这不证明真实服务context兼容，J5g-j9已完成独立零资源占位栈Create/Recover入口与真实只读review；J5g-j9-online-1在exact manifest批准下仅提交一次fixture Create，修正实际provider空Stack Tags/空Original模板的只读校验后独立Recover为READY_UNEXECUTED、零资源，management保持Locked；J5g-j10已实现probe-only Grant候选、Create/Recover入口并完成真实只读审阅与独立Grant MISSING回读，未创建或执行Grant；下一动作先补齐Grant Execute/删除探针/立即独立撤权与恢复入口，再刷新短窗口清单，grant安装、实际探针及每段 Grant → mutation → immediate Revoke/Locked仍必须分别明确批准，不能把本地通过当作线上就绪。随后仍须闭合EC2资源上界、RDS-managed Secret权限、schema v2 production collector/root、authority-bound真实回退与TTL cleanup，以及ACM、Trust Store、AZ/引擎/配额、空tenant inventory和最坏费用预检。当前 Shared Cell 模板仍是`renderOnly=true`、`applyReady=false`；即使未来模板创建`ENABLED`的三小时TTL Schedule，当前线上全局Schedule仍为`DISABLED`，且Janitor没有删除命令，所以不能把事件兼容性当成有效删除保证。在这些条件闭合并另行获得付费Cell Execute明确批准前，不得创建Shared Cell、VPC、ALB、ECS service、RDS/Aurora或Route53。

J5g-j11 已补齐独立 probe-only Grant Execute、固定 MFA Operator 单次精确 ARN DeleteChangeSet、立即 Source exact Locked Revoke、只读 Inspect 与单独批准的 revoke-only 恢复入口；默认 runtime及production gates未打开。真实 AWS Inspect仍证明管理IAM Locked、Cell MISSING、authority ABSENT、未执行探针资源0；新的 J10只读创建审阅仍为Grant MISSING，J11执行清单因此保持manifest null/executionReady false。本阶段没有AWS写入、AssumeRole或Neon访问。下一动作先单独批准fresh J10“创建不执行”，回读真实Grant ARN后再审阅并分别批准J11的Grant/单次探针/立即撤权三个action SHA；过期或中断不能自动重放，cleanup无法证明时报告REVOKE_REQUIRED。详见[实施记录](docs/aws-sandbox-b5-implementation.md)。

J5g-j10-online-1 已按明确批准仅创建一次待审 Grant Change Set，并独立回读为READY_UNEXECUTED、精确候选模板及唯一operator boundary非replacement修改；management实际仍Locked、Cell MISSING、authority ABSENT、探针资源0且未执行。J11现已能对真实Grant ARN生成只读执行候选，但Grant Execute/单次删除/立即Revoke尚未批准或执行，production compatibility/readiness/runtime gates保持关闭；禁止重建Grant或自动重放，过期只读刷新后重新请求准确授权。实现提交5a755e1已获批推送并核验github/main，新部署记录另行按完整提交SHA送审。

J5g-j11-online-1 已实际完成Source Grant→固定MFA Operator单次删除请求→失败后立即Source Revoke及双次Locked回读。CloudTrail证明删除于19:00:01Z被AccessDenied拒绝，而不是清单过期；独立Source Inspect再次确认operator默认v3精确Locked、Cell MISSING、authority ABSENT、探针仍未执行且资源0。该负向探针不满足compatibility/readiness/runtime门禁，这些门禁继续保持关闭；也不能单独区分IAM传播与ARN条件上下文差异。全部intent保留，禁止重放；后续先明确授权补充只读就绪/脱敏失败诊断，再单独批准新的探针轮次。实际撤权链路已验证，删除成功证据仍未取得。

J5g-j12 已补齐脱敏phase/code/requestId失败收据和固定MFA Operator真实全ARN只读就绪屏障（连续两次、最多三轮/30秒，只读成功不证明Delete权限）；未就绪/取消/过期仍立即独立Revoke，写请求不重试。全量783/783、typecheck/lint/sandbox验证通过，真实Source只读Inspect再次Locked、Cell MISSING、authority ABSENT、probe未执行且资源0；新Operator gate尚未做在线正向验证。没有新Grant/删除/付费Cell/Neon写入，旧intent全部保留；下一阶段先审阅新的grant/window/fence，不直接重跑旧脚本。

J5g-j13 已完成新的只读续轮审阅入口及target-bound固定槽位方案：真实回读仍Locked、两次管理Change Set清单均空、原probe未执行资源0，旧Create和五步intent完整且不改写。新nonce/time仍映射同一generation1槽位，避免未来用新operation目录绕过防重放；当前只提出方案，`persistenceImplemented=false`、无新写入口/槽位/Grant。workflow36/36、全量789/789及typecheck/lint/sandbox通过；下一阶段先实现和审查该固定槽位持久化，再fresh审阅、准确批准创建，不直接重跑旧脚本。

J5g-j14 已实现本仓库单主机固定槽位持久化和creation-only受审入口：排他占用槽位目录、create-only claim并fsync后最多一次Create；缺失/部分/损坏记录不自动修复，响应不确定只读Recover。新J11执行/撤权均强制共用同一槽位，fresh manifest不能用新operation目录重放。workflow46/46、全量799/799、typecheck/lint/sandbox通过；真实审阅及独立Inspect仍Locked/Cell MISSING/authority ABSENT/未执行probe资源0，旧摘要一致，实际新registry不存在。此阶段无AWS/Neon写入、无新槽位占用，所有runtime/compatibility gates仍false；后续先fresh审阅并准确批准仅创建未执行Grant Change Set，不执行Grant/删除探针。

后续 J5g-j14-online-1 已按 fresh 清单 `0c6ac6f6641bd446b052d76968157acec7d062ce1b84a9ed52120735d0a36a77` 的明确批准，于 `2026-10-03T20:59:08.792Z` 完成唯一一次Create；固定generation1槽位已占用并保留。独立Recover确认新Grant Change Set READY_UNEXECUTED，管理权限仍Locked、Cell MISSING、authority ABSENT、原probe未执行资源0；旧archive摘要不变、新workflow intent数0。没有Execute/Delete/AssumeRole/IAM执行/Neon写入，compatibility/runtime gates仍false；不能重放创建或清空槽位，后续J11执行需要fresh清单和另行准确审批。

后续 J5g-j11-fenced-online-1 已按新清单 `1969abf2c05311c40fd93ded0bd195c994bd654b17a73abaa8104539d719630b` 获批并由用户本地MFA执行。Grant曾安装，但Operator真实全ARN DescribeChangeSet连续三次403/AccessDenied，就绪屏障拒绝进入Delete；probeAttempted=false、无probe-delete intent。Source立即Revoke并双Locked核验，独立Inspect再次LOCKED_VERIFIED/operator默认v5/Cell MISSING/authority ABSENT、原probe未执行资源0。slot内claim及四个已绑定intent永久保留，旧archive不变；不是ARN兼容性成功，全部runtime gates仍false。下一步先只读诊断该DescribeChangeSet拒绝，禁止清空槽位、重放或自动放宽权限。

J5g-j15 已完成真实Source只读诊断：保留Grant v4整个策略与批准plan一致，当前默认v5和管理模板仍准确Locked；三条CloudTrail拒绝均准确匹配，AWS报告exact Stack上没有匹配的identity-based Allow。完整ARN条件匹配是优先待验证假设，但日志未提供授权上下文，不能声称已证实短名称转换/条件键缺失。取证摘要及旧archive/固定slot独立复算通过；无IAM模拟、AWS/Neon写入或新Grant，所有runtime gates仍false。下一步先准备独立只读对照候选和审阅方案，不安装权限、放宽删除规则或复用消费槽位。见[只读诊断及证据限制](./docs/aws-sandbox-j5gj15-describe-diagnostic.md)。

J5g-j16 已实现两个互斥、未部署的只读候选（完整ARN条件/精确名称条件）和Prepare/Source-only Review入口：均从Locked开始，无删除Allow、不改旧删除编译器，不生成AWS写请求或新generation。新loader只读严格核对已消费slot及所有前驱摘要；真实Source审阅仍Locked/v5/Cell MISSING/authority ABSENT、两次管理清单空、原fixture未执行资源0，独立重编译/证据复算通过。11项新测试及相关回归合计64/64、typecheck/定向lint/management验证通过，不重复全量离线模拟。Operator四格对照未执行，compatibility/runtime gates仍false；下一步先实现独立固定fence/creation-only审阅，不安装权限或复用旧slot。见[只读对照候选](./docs/aws-sandbox-j5gj16-read-comparison.md)。

J5g-j17 已实现独立 generation2 固定围栏及 ReviewCreate/CreateReviewed/RecoverCreate：显式保留原消费前驱，两个候选及所有窗口共享唯一新槽位；先持久化 claim 才允许一次精确 CreateChangeSet，异常/丢失/MISSING 永不自动重试或复位。真实 Source 审阅与独立回读仍 Locked/v5/Cell MISSING/authority ABSENT、管理清单空、原probe未执行资源0；新registry/claim不存在，无AWS/Neon写入或Operator登录。18项新增测试与相关回归82/82、typecheck/定向lint/management验证通过。下一阶段先完成受审安装→固定MFA只读请求→立即Revoke控制器，再fresh审阅批准云创建，不提前消费固定槽位；runtime gates仍false。见[固定围栏与创建边界](./docs/aws-sandbox-j5gj17-read-comparison-fence.md)。

J5g-j18 已实现受审 Grant Execute、固定 MFA 两次只读 Describe 对照、独立立即 Revoke 和 revoke-only recovery；六份 write-ahead intent 绑定同一 generation2，不重放或重置，原删除/production renderer 不接受新读 Grant。真实 Source Review 为 PREPARE_FENCED_GRANT_REQUIRED（manifest/claim=null），另起进程 Inspect 为 LOCKED_VERIFIED/v5/Cell MISSING/authority ABSENT、原probe未执行资源0；独立证据/旧ledger复算通过，新registry仍不存在。本轮无AWS/Neon写入、Operator登录或占槽；新增23项及相关回归125/125、typecheck/定向lint/management验证通过。下一步推送后fresh创建审阅并单独批准，再独立核验和fresh安装/只读/撤权批准；compatibility/runtime gates仍false。见[受审只读对照控制器与证据](./docs/aws-sandbox-j5gj18-read-comparison-workflow.md)。

随后 J17 generation2 已按准确清单 `5fe8ada96f680dd0e50c249f1caa274c2a76ea155123a50ba77faef473675b69` 唯一创建并独立 READY_UNEXECUTED 回读；固定新槽位现已永久占用，只有claim，无workflow intent。J18 首份安装批准到期，刷新后的本地SHA确认也阻断在SDK前；两轮均无Grant Execute/Operator调用。末Source receipt `2026-10-04T04:41:27.194Z` 仍Locked/v5/Cell MISSING/authority ABSENT、原probe未执行资源0，证据/旧ledger复算通过。policy窗口及十分钟撤权余量不延长，现有槽位不重置。下一轮仅提出独立旧未执行Grant退役/generation3/本地准确批准命令方案，尚未实现或批准删除/新generation/创建/安装；见[窗口收尾与下一轮审阅方案](./docs/aws-sandbox-j5gj18-window-closure-and-renewal-review.md)。

未来真实 authority install 还必须重新走 J5e 短时 Grant → Inspect → Execute，随后以 fresh schema v2 live evidence、持续 `ABSENT` strong read、exact `cloudFormationRoleArn`和已批准 candidate digest执行唯一 conditional Put/readback，并立即独立 Revoke → Inspect → Execute；这不与付费 Cell批准、cleanup mutation或 Schedule enable合并。J5g-e1 已把 `0005`–`0008` 的真实只读迁移前状态固定为短期 review manifest；J5g-e2随后已用fresh manifest、数据库advisory/table lock、worker quiescence复验、四migration单事务和提交后独立强回读完成受审执行。生产 material generator、Worker live wiring、其余控制写接口 fence 和空租户 PostgreSQL 16.14 baseline仍需继续审查。一次性 PostgreSQL 与受控 AWS Sandbox 中的并发 CAS、崩溃恢复和删除演练，以及 DNS/ACM/ACTIVE Trust Store，仍需分别批准。所有门禁、真实 TTL 删除和费用核对通过后，才可另行批准一个付费 Sandbox Cell；`registrationReady`、`liveReadbackReady`、`applyRuntimeReady` 与 `cleanupRuntimeReady` 在此之前必须保持 `false`。升级/降级、退款和多实例仍不属于当前版本。模板使用说明见 [应用实例模板管理](./docs/app-instance-template-management.md)，执行门禁见 [AWS Sandbox S3 部署执行器](./docs/aws-sandbox-s3-worker.md)，本次边界见 [AWS Sandbox B5 实施边界](./docs/aws-sandbox-b5-implementation.md)。
