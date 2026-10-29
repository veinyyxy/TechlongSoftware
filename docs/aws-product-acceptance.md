# 产品真实验收：当前最小继续点

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)；这是主线第二步的工作记录，不是新的云部署、私密读取或业务写入批准。

## 当前状态与唯一继续点（截至20:26）

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
