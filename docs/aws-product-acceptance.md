# 产品真实验收：当前最小继续点

2026-10-31，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)；这是主线第二步的工作记录，不是新的云部署、私密读取或业务写入批准。

## 当前状态与唯一继续点：先准备现有承载保留至09:00

### 保留至09点的最小准备（2026-10-31）

用户已确认新的保留目标为**2026-10-31 09:00 America/Winnipeg（CDT）=2026-10-31T14:00:00.000Z**，并另允一次STS1＋最多12次元数据核对。现已实际使用全部范围，无重复API、云写/私密值/数据库读取，尚未续期。原SOURCE事实01:34:42.313、原部署意图01:47:54、任务/完成回执/535停止记录/永久槽均不改写或复用。09:00开始业务验收需新的现状与范围批准。

新只读事实：准确栈CREATE_COMPLETE/七资源稳定/原模板匹配，ECS任务定义11、desired/running/pending=1/1/0，PRIMARY COMPLETED；旧ExpiresAt仍06:47:54Z。租户Janitor函数Active、扫描计划ENABLED/rate(15 minutes)，Cell计划DISABLED。原父Cell仍稳定但标签早已过期，未续父Cell。一次租户并发请求退出0但响应未成功保存，限制保持UNKNOWN，不额外读取或据此断言清理器关闭。

初次本地参数比对停止保留：18是原显式传参数，AWS实际返回20个，其中JwtExpiresIn/MerchantJwtExpiresIn取原模板默认，另两值为NoEcho遮罩。全部可见值/默认已本地核对匹配；不能证明遮罩后的底层内容，但不需解密，更新对20参数全部UsePreviousValue=true，避免重置。其后并发响应解析停止原件同样保留；只补完未发请求，累计STS1/元数据12，未重复任何API。规则依据：[参数默认值与NoEcho](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html)、[UsePreviousValue](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_Parameter.html)。

**唯一待批执行清单raw SHA：`65f52068c4fdcd06c1e00a4ac7f9e829a17dca4ca94eb7618590f5899520ef4a`。** 本地 `F:/ChatGPT_workshop/techlong-tenant-retention-readonly-20261031-a/review/approval-manifest.json` 绑定准确CreateChangeSet请求、原件摘要、20个UsePreviousValue、严格Tags-only/无替换条件及独立核验。请求raw SHA `4eb88822bb97fc5506aaea76359ede64ef08a324cd465bb37171f9b1f1244e94`；同目录README.md完整风险raw SHA `cc82d653b0dfacfb6761437c6e263e76d065ba0fac2be3d3a3066bc62a443265`。本地材料已齐，不代表获准或已执行云写。

待批总上限：准确栈CreateChangeSet1，严格核验后ExecuteChangeSet1；新STS2/元数据65（有限监控及另一进程独立核验），无写重试/清理。最晚01:27:54 CDT启动、写提交最迟01:42:54；必须在旧到期前完成标签更新，不是等到09:00再批准。接受正常CFN回滚、标签传播/托管API、非原子/并发/清理器竞态、凭据刷新/日志、持续费用、遗留Change Set/部分状态及未知不重试风险；不新增权限、修改清理器/业务、读秘密或重部署。严格Change Set不能证明仅标签/无替换时停止，不执行或自动删除。保留成功只增加新回执，旧事实/批准/回执不改；09:00不保证自动停费，清理另审。

本次只读记录仍分阶段保留于上述目录run/result.json（raw SHA802a1c4b…）、remaining/result.json（885376fd…）及tail/result.json（`a6cad227e951e3b2f83830c9d3145df0826bfa11b4a1ba655e6bffed240f7900`）。最后结果明确APPROVED_CALLS_COMPLETE_LEGACY_CONCURRENCY_UNPROVED；不能改写为所有响应完整。prepared-verified.json绑定请求/清单/风险与本地候选验证；没有可重跑的读取许可，原始响应/模板不提交Git。

本地真实原件仍为 `F:/ChatGPT_workshop/techlong-reviewed-cycle-run-2cb0a046744fadf20bbc3aa7060934c0f11adc3e96c5e283ede35fd0566785bf/runonce-captured-material.json` 内的实际V5 workload；新保留记录不得覆盖它。准确目标为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/64fe0920-d4e7-11f1-8866-0eb4b7868f6f`，不是仅按同名栈猜测对象。

最小候选只允许将实际request的一个栈ExpiresAt及模板内TenantLogGroup、TenantService、TenantTargetGroup、TenantTaskDefinition四处ExpiresAt，从 `2026-10-31T06:47:54.000Z` 改为 `2026-10-31T14:00:00.000Z`。七资源数量、18显式/20有效参数、镜像/代码、角色、Secret版本、desired count、DNS/来源及其他模板内容全部保持。已以新元数据原模板逐字段比对，恢复这五个值后等于原件；准确清单已产生但等待新批准。

本地已从上述实际原件完成一次内存草案检查：准确四个资源标签及一个栈标签匹配旧值，资源7/参数18，恢复五处标签后与原件深比较完全一致，Metadata中的legacyJanitorExpectedEnabled=true。原TemplateBody原始字节SHA `4269cf201210698bd3dd45c188f80323c018e6e3a7a188d659b548106ff043ca`；仅该内存候选JSON.stringify字节SHA `b6135c5aa77f0d17e6dde9f7c03f3aee94b18cd64bda62aab4f43cbbcf711e95`。这些是本地内容摘要，**不是执行清单SHA或新云事实**；未保存/提交模板正文、未发AWS请求，不能据此执行更新。

AWS文档将[TaskDefinition.Tags更新标为No interruption](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html#cfn-ecs-taskdefinition-tags)，但这不是本栈的执行证明。后续应以准确[UPDATE Change Set](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)核对，拒绝新增/删除/替换、非标签改动或不明差异；创建/执行该Change Set本身也须新的准确云写批准，不能在只读准备中调用。

本次用户另允并实际使用的只读准备范围如下，已消费读取预算，不是未来重复读取许可。固定Source IAM身份STS1次及AWS元数据12次，无翻页/应用重试：

| 准确对象 | 元数据范围与上限 |
| --- | --- |
| 上述租户Stack ARN | DescribeStacks、GetTemplate(Original)、ListStackResources各1 |
| 原父Cell Stack ARN（b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1） | DescribeStacks 1 |
| cell-sandbox-1 / tenant-9c5ee9e64509dcad-ecs-service | DescribeServices 1及其返回的准确TaskDefinition的DescribeTaskDefinition 1 |
| techlong-sandbox-janitor、techlong-sandbox-cell-janitor | 各GetFunctionConfiguration/GetFunctionConcurrency 1；仅持久化去敏身份/代码哈希/状态/并发投影，不输出或持久化环境变量 |
| techlong-sandbox/global-expired-stack-scan、techlong-sandbox-cell/techlong-sandbox-cell-global-janitor | Scheduler GetSchedule各1；不调用/修改schedule或函数 |

不读取Secret值、PEM、.env、S3正文或DDB业务项，不连接数据库、请求业务API、写云/业务、占槽、dispatch或续期。仅生成准确新云变更材料；接受凭据进内存、网络/提供者日志及低额非零费用，准备快照最长5小时且不得越过本次目标或掩盖执行前状态变化。

本地 `janitor.cjs` 确实有按栈ExpiresAt执行DeleteStack的路径，本次元数据已核对函数Active/扫描计划ENABLED；未下载函数代码或证明其并发限制。旧01:47:54后可能被删除，不保证保留/及时清理/停费。发现UUID不符、删除中/已删除、非稳定状态、模板/角色/有效可见参数不符或存在其他到期机制即停止并报告，不自动重建/禁用清理器/扩IAM。09:00仍非硬停费线；保留期间费用继续，后续清理另审，不为此次等待创建自动化/新框架。

### 单设备验收原继续点（保留准备完成后再继续）

用户确认5353d319547d3e7b7071b7233079fd5dcd184e5073bd5502f35d0b2f3e2a5bed后，本轮已在温尼伯10月31日00:20:58–00:21:01单次执行并按规则停止：前端首页/manifest及后端health/ready均200，准确buyer Origin的CORS预检204通过；第一条签名店铺GET返回400，菜单GET没有发出。无重试、JS、登录或部署。

原响应正文没有持久化，但其89字节/原始SHA `c08f126b797dcc3e46d240d6242fe02fd6783280d7beafe43f59e04ed9aeda8b` 与已固定源码中 `BUYER_DEVICE_ID_REQUIRED` 的完整确定性JSON序列化逐字节匹配（不是仅凭400猜测）。原middleware先检查设备/额度，再进入route签名验证；因此当前唯一已证实阻塞是正常设备门禁，尚未证明HMAC认证成功，也不应据此改HMAC或云代码。

实际STS1/固定版本Secret GET1/公有CLIENT_ID GitHub GET1/HTTPS6，直接数据库连接/本机业务写/云写/重试均0；没有进入正常租约写分支。未直接回读数据库，不把本轮范围推成全局零变化/零费用保证。22原件已本地封存于 `F:/ChatGPT_workshop/techlong-buyer-business-read-20261031-a/stopped-verified.json`，raw SHA `0224e353c9c7fde39ffb0ef5020e06c0f857cf0d0302da59a3349ae9ae9c96ec`。原review、失败目录/单次执行记录及秘密不落地边界均保持，不再运行535清单或自动使用未用第7次请求。

**下一唯一动作仅准备一个正常测试设备ID的有限访问租约与店铺/菜单范围，取得新的准确批准后才执行。** 不改并发额度、跳过设备/签名门禁、修UI、重部署或加IAM。必须明确现有middleware会对同一设备记录INSERT/UPDATE/复用租约，原期限/额度不改；必要的新的私密使用、认证请求和正常业务副作用均另审，不复用本次Secret或读取许可。租约过期不等于自动删除行，不默认清理。真实客户端JS/登录/订单支付仍未验收，wholeProductAccepted=false。

原SOURCE事实01:34:42.313及工作负载意图01:47:54 CDT均不延期，TTL不自动停费；窗口不足或已过期先另审现状/清理，不自动续租/重部署。本轮源码冻结在停止证据封存后结束，仅正常记录文档；后续纯文档HEAD不是新运行代码/CI。

### 首轮有限API读取准备沿革（已执行并停止，不重放）

同一36735d后端已于10月31日通过Review41169905634 → RunOnce41170142255 → 独立Inspect41170837582，最终 `WHOLE_CYCLE_INDEPENDENTLY_VERIFIED`；[完整部署实测](aws-auto-deployment-reviewed-cycle-observed.md#2026-10-31买家来源后端整轮已独立通过)。准确新栈UUID64fe0920-d4e7-11f1-8866-0eb4b7868f6f、当前buyer域名/后端来源已接通受审部署材料，不再发布客户端、来源或重做整轮。59原件的执行证明93b96f9a…已封存；下方旧删除/待部署描述只保留追溯。

本轮只完成本地源码及已保存证据核对、有限读取方案和一次性本机调用准备，没有生产读取/写入、Secret或配置值读取。客户端仍602e543；服务端a79ed89在app/routes/services/security/DB连接代码上与受审镜像来源10fe3c41无差异。服务端现有无设备ID路径只在并发额度为null时放行；有设备ID会进入访问租约写事务，所以本轮不打开页面执行JS，不伪装成“浏览器零写入”。服务端工作区已有用户.vscode/settings.json未跟踪文件，未修改或提交。

当前仅等待以下准确范围的集中批准，不先发请求：

| 有限调用 | 上限与停止边界 |
| --- | --- |
| 客户端静态 | `https://buyer.sandbox.techlong.cloud/`、`/manifest.json` 各1次GET，不下载JS/图片或执行应用 |
| 后端健康 | `https://first-acceptance.sandbox.techlong.cloud/health`、`/ready` 各1次GET；ready由既有服务端连接Aurora读取，不直接连接数据库 |
| CORS | 对准确 `/api/products/get_list` 1次OPTIONS，Origin必须为buyer域名，检查允许GET及签名/店铺请求头，不移除Origin绕过 |
| 业务 | `/api/stores/bootstrap` 与准确默认店的 `/api/products/get_list` 各1次HMAC签名GET，均携带Origin，无Cookie/JWT/设备ID；总HTTPS最多7次，无重定向或重试 |
| 公有客户端参数 | 既有Git凭据1次GitHub GET读取speedfeast仓库BUYER_CLIENT_ID，仅在SHA等于已发布记录b0911104…时使用，不读或改GitHub Secret |
| 私密使用 | 固定Source IAM身份STS1、GetSecretValue1，Secret runtime/g1-T9CqN5、固定版本0f45d29f-02d4-4117-99b1-c06645aa3c6e/AWSCURRENT；整个JSON仅进内存，仅hmac_secret_key参与两个签名，不输出/落地或转发其他字段 |

原中间件门禁、固定版本/来源、公有参数摘要、完成回执中的准确默认店及CORS任何不符就停止，不补设备ID、不改配置或另建数据。菜单为空只记录“读取路径可用、菜单为空”，不能声称非空可购买菜单或完整产品已验收，不自动添加商品。响应正文/签名/密钥不持久化，仅保存去敏状态、大小/哈希及计数；接受内存、DNS/并发、服务端/提供者日志及低额非零费用风险。

一次性受审材料和完整风险位于 `F:/ChatGPT_workshop/techlong-buyer-business-read-20261031-a/README.md`，准确SHA只认该目录prepared-verified.json真实生成并匹配，不存在即尚未封存。仅本地调用，不新增工程运行模块、部署执行器/探针或UI改动；语法核对不是线上业务验收。清单生成后冻结本机调用/风险与main；实际私密读取、HTTPS及GitHub读取须另获该SHA批准。此前整轮剩余额度不延用。

原SOURCE事实仍10月31日01:34:42.313 CDT、工作负载意图仍01:47:54；本轮取更早01:34为硬截止并保留10分钟，最晚01:24:42.313启动，单次最多3分钟，不续租/重部署/删除。TTL不自动停费，50 USD/月不是硬上限；若窗口不足先另审现状/清理。通过API路径后仍需另审真实客户端渲染及其正常租约/心跳副作用；订单支付和整套产品交付未通过，wholeProductAccepted=false。

## 2026-10-28状态沿革（下方不是当前继续指令）

新一轮经批准的限定只读已证明：原租户栈DELETE_COMPLETE，ECS INACTIVE/任务0，health/ready均404。根事件16:08:39.496开始删除、16:16:37.415完成；“User Initiated”不能确定具体操作者。本轮没有删除、查询CloudTrail或连接数据库；以下14:41健康和整轮成功均保留为历史，不代表当前可用或整体停费。

客户端602e543/CI40789471388成功、deploy skipped，六资源候选的AWS ValidateTemplate已通过。新前端角色/policy/stack仍不存在，OAC名称无冲突，桶HEAD404非全球预留；人工sandbox门禁未安装。实际读取GitHub9/STS1/AWS元数据16/无身份HTTPS2，云/配置写、私密值、数据库、续租和调度均0。

用户随后确认e6654426…清单，**19:19–19:24已完成前端承载与GitHub本人门禁安装、独立核验**。先两次GitHub配置写并独立证明门禁，再一次CreateStack六项前端资源；新栈UUID71751190…/CREATE_COMPLETE、CloudFront EDJYJUKAZ12BO、来源https://d3a0kml1xanzgt.cloudfront.net。原模板/资源/策略/IAM和最终门禁全部回读通过，窄IAM持久保留；没有私密值、变量/Secret、发布、后端/CORS/TTL、删除或自动重试。[真实结果与准确边界](aws-buyer-web-sandbox-bootstrap-observed.md)。

恢复读 `F:/ChatGPT_workshop/techlong-buyer-web-bootstrap-20261028-a/executed-verified.json`（raw SHA `6b174ae265ac4b2d9dda45ebcf5002d267654912b28a824d51df510fd1ee69fc`）；9原件和48调用已重建核对，安装标记永久消费，不重复安装。**下一只准备现有workflow的sandbox发布变量/私密来源与单次发布清单，并明确新的真实后端联调/CORS窗口**；私密使用、配置写、发布/dispatch或后端恢复另审，不改旧意图、不重放任务或扩框架。`wholeProductAccepted=false`，前端承载创建不等于已发布应用或完整产品验收。

**静态客户端发布已真实完成并独立通过**：用户确认abf867cc…并本人批准run40799958045环境，20:21–20:26完成五变量/一个环境Secret、326对象/51,149,344字节、准确缓存失效Completed及三静态文件200/ETag/大小核对。秘密固定版本仅GET1次，未保存明文或密文正文；未执行JS、读JS正文、调用API/DB/后端或新增IAM/基础设施，没有自动重试/清理。[真实结果、风险与次数](aws-buyer-web-sandbox-publication-observed.md)。恢复读 `F:/ChatGPT_workshop/techlong-buyer-web-publication-20261028-a/executed-verified.json`（raw SHA `379c64cbe93ff4fd7fd824476c4da791f1e001f8c7aa419c5ce826c950e4be80`），永久标记已消费，不再发布/读秘密/dispatch。

**下一唯一动作是新的真实后端联调/CORS及有限业务验收窗口准备**，不是再改前端。新读取/合法请求/来源/恢复/业务操作另审；旧已删UUID不能UpdateStack、成功任务不重放。HMAC按受审设计可从公开Web提取，持久Secret/配置/IAM和对象继续保留；静态成功不代表访问租约、登录、订单或支付通过，wholeProductAccepted=false。

新的[后端准备记录](aws-backend-integration-preparation.md)确认当前材料/冻结SOURCE尚未包含CF来源，必须只做受审最小适配，不能绕过旧哈希校验。当前新事实读取因Source不可用停在STS1，其他元数据/配置/TLS/SQL和写入均0；等待刷新及新一次同范围只读许可，不自动重试/续期。首轮业务联调拟先覆盖已有店铺/菜单和后端/数据库读路径，实际客户端访问租约/heartbeat等正常写需另批，不默认创建订单、支付或新业务数据。

## 已完成与本轮阻塞

[同一 sandbox 的整轮恢复部署](aws-auto-deployment-reviewed-cycle-observed.md)已独立通过，不重跑 Review、RunOnce 或 Inspect，也不再扩部署框架。整套产品仍未验收。

客户端 `veinyyxy/speedfeast` 的默认分支是既有 `master`。原源码 `5a01ee49344c9c2cfc6c3c5ecfbea6db76fcf269` 的[准确 CI 31296964215](https://github.com/veinyyxy/speedfeast/actions/runs/31296964215)在依赖安装失败：运行环境 Dart 3.8.1，而 `pubspec.yaml` 要求 Dart ^3.12.2、Flutter >=3.44.9。Analyze、Test 和 web release build 均未执行，deploy 被跳过；历史旧源码的成功不能替代这次检查。

## 最小修复与验证

客户端提交 **`3ad0ea8b99c2f891bcc450cc006bc5a97000a337`** 已推送到原 `master`，没有新分支或更改默认分支。只修改两个工作流内三处 Flutter pin：

| 文件 | 唯一变化 |
| --- | --- |
| `.github/workflows/web-deploy.yml` | verify / deploy 使用的 SDK 从3.32.5改为3.44.9 |
| `.github/workflows/android-package.yml` | package 使用的 SDK 从3.32.5改为3.44.9 |

这是对齐项目已经声明的最低 SDK，不是依赖升级、功能或部署变更。[Flutter 官方归档](https://docs.flutter.dev/install/archive)与官方 Linux release 元数据确认3.44.9 stable携带Dart3.12.2，framework ref `6b182d2c7585eba26d4edce0f97630effd256c33`。

本机只检查 YAML、三处pin与pubspec一致、两个文件除版本替换外全文不变，以及push的无AWS路径；通过 `SDK_PINS_AND_NO_AWS_PUSH_SCOPE_VERIFIED` 和 `git diff --check`。本机没有Flutter SDK，不安装SDK或Docker，不将静态检查冒充Flutter测试。

准确云端检查为[CI 40755064679](https://github.com/veinyyxy/speedfeast/actions/runs/40755064679)，attempt1、push事件、head准确等于3ad0ea8，已于温尼伯14:34:26报告completed/success。verify job `123051667552` 的依赖安装、Analyze、Test及web release build均success，官方日志确认 `Built build/web`。该run的deploy job `123051670802` 为skipped。Android仅静态核对pin，本轮没有执行其打包工作流，不声称APK已验证。

恢复检查点：`F:/ChatGPT_workshop/techlong-product-client-sdk-verified-20261028-a.json`，原始字节SHA `c9749a74553e143ac44f631d85a2bbd2c0cd840b90ecc4ae48d97868296794d3`。它只记录代码、准确CI和零云写边界，不是新的生产快照或后继操作许可。

原触发及权限边界保持：master push只运行verify、使用无效示例API地址和测试值；没有AWS身份、真实HMAC或生产Secret。web部署仍仅手动dispatch、沿用production环境；Android仅tag或手动触发，本轮没有tag或dispatch。没有运行现有 `s3 sync --delete`、CloudFront invalidation、Android签名/打包或Release上传。

## 限定在线核对实测（温尼伯14:41–14:43）

用户明确允许最多10次GitHub GET、1次STS+20次AWS元数据及4次无身份HTTPS GET后，本轮已完成限定核对。Source准确为账号402010193138的 `user/techlong-sandbox-dev`。

| 实际核对项 | 观察与边界 |
| --- | --- |
| 准确租户栈 | 原UUID `2b604c90-d303-11f1-9e27-0eac036e5781`，CREATE_COMPLETE；不新建或更新栈 |
| ECS | `cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service`，ACTIVE；desired/running/pending=1/1/0，task definition revision9、PRIMARY rollout COMPLETED |
| 租户HTTPS | `https://first-acceptance.sandbox.techlong.cloud/health` 在14:41:22.992返回200/ok；`/ready` 在14:41:23.267返回200/ready |
| 客户端发布历史 | 最后列出的成功手动发布为run29945258964、源码df1ae366…；其旧日志当前不可获取，不重试，不据此推导历史配置或现存bundle |
| 变量来源 | 三个production环境级变量均404（可能未设置或不可见）；随后三个准确仓库级变量均200，不能把环境级404误判为整个配置缺失 |
| 已配置S3 | 仓库变量为 `speedfeast-buyer-web-402010193138-ca-central-1-an`；14:43:05.631开始的准确读取返回NoSuchBucket，带expected-owner402010193138；没有创建或列举其他桶 |
| 已配置CloudFront | 仓库变量为 `ERQVWHE0LMAMX`；14:43:03.975开始的准确读取返回NoSuchDistribution；没有创建或列举其他分布 |
| 客户端API配置 | 仓库级 `BUYER_API_BASE_URL=https://api.techlong.cloud`，不是本次sandbox入口；未请求该旧域名，也未读取JS来证明已发布bundle的实际编译值 |

结论为 **`TENANT_READY_CONFIGURED_CLIENT_TARGETS_ABSENT`**，不是整套产品验收通过，也不证明账号没有任何其他客户端承载。已配置目标当前不存在，因此没有猜测客户端URL或请求其首页/manifest。CORS仍未测试（两个租户GET没有Origin），没有打开页面、执行JS、登录、签HMAC或连接数据库。

实际累计：GitHub GET预算占用10（列表1、jobs1、旧日志保守记2、六个准确变量GET；不是十次底层传输的实测断言），STS1、AWS元数据7、无身份HTTPS GET2。私密配置/PEM/AWS Secret值/HMAC读取、直接数据库连接、业务写、云写、dispatch及提供者请求重试均0。既有Git凭据与Source身份仅在进程内使用；初次本机脚本在任何新网络/凭据使用前因Windows ESM路径退出，纯本地修正并检查后才发出尚未尝试的请求，原错误被保留，不冒充首次装载成功。

最终本地检查点：`F:/ChatGPT_workshop/techlong-product-online-check-verified-20261028-a.json`，原始字节SHA `3258c70b983e0354e4e15eac50327eaa9de77ab0923cf24195ae62894976187a`；绑定三份真实结果及其SHA，包含当前资源观察、变量来源、两个准确缺失错误和次数。记录不含凭据、HMAC、网页正文或业务快照；原始结果保留，不重新运行本轮脚本。剩余未使用次数不是后继阶段的自动读取许可。

## 14:43后的准备方向（历史；现状与继续点见顶部）

当前主线缺口是**可用客户端承载及其与准确租户API的接线**，不是控制器、队列或数据库恢复。上述准确CI已通过，不重跑或增加测试框架；不把测试中 `api.example.invalid` 的构建当sandbox产物，不重做已完成的租户部署。

下一仅准备一个独立sandbox买家Web承载/发布的准确变更提案，复用现有客户端与GitHub云构建工作流；集中列明目标桶/分布、现有或确需变更的发布身份、准确API与CORS、CLIENT_ID/HMAC的受审来源、GitHub本人门禁和费用/清理。尚未核对的项明确为待确认，不制造执行SHA或声称材料已齐；不自动复活旧分布、重建旧桶、修改production变量、扩权限、读取私密值或dispatch。本轮只读批准不能覆盖这些变更。

真实资源/配置/私密使用范围另经批准后，再进行客户端发布和有限真实业务验收，随后才商户认证及必要业务场景；不扩UI、探针、通用框架或新的固定任务分支。原工作负载意图和清理审核边界保持。

本次准备按另允范围核对角色/门禁/CORS，形成[六资源最小承载及接线候选](aws-buyer-web-sandbox-plan.md)；旧production没有required reviewers，因此候选使用独立sandbox环境/窄角色而不修改旧生产配置。原客户端workflow接线已在602e543完成，准确CI40789471388全部通过、deploy skipped；候选不是安装、私密读取或调度许可。其后限定现状核对与收缩后的实际待审范围见顶部，旧现有栈CORS更新方向不再适用。

### 为什么不直接打开买家页面“只读验收”

客户端 `lib/Controller/service_provider.dart` 在initialize中设置设备上下文并GET `/api/buyer/access`，随后开启定时heartbeat。服务端当前本地源码 `a79ed89cdb5dc788ec880d8dcbeeb875f1f19159` 的buyer middleware会据此INSERT/UPDATE `saas_access_leases`；GET不等于零业务写。商户 `/api/merchant/auth/login` 也更新 `merchant_users.last_login_at`。当前云镜像的源码及配置对应关系仍须核对，不能仅凭本地HEAD宣称线上已经包含这些行为。

因此本阶段不启动客户端JS、不读取签名私密材料、不登录、不创建样例商品/订单、不支付，也不自动续访问租约或发送通知。后续真正打开客户端时须明确接受这些正常应用副作用；不能用一个“只读页面”许可覆盖它们。

## 费用与停止条件

既有工作负载意图到期为**2026-10-28 16:06:01 CDT**。TTL不会自动删除、停机或停止计费，50 USD/月不是硬上限。本轮没有延长期限或清理许可；原窗口到期后停止业务验收方向，先另审准确现状/清理，不自动重新部署。代码CI与来源核对不等于整套产品通过；当前 `wholeProductAccepted=false`。
