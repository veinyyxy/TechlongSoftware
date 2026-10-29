# 买家Web最小承载与发布候选

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)。本文件保留初始 **DRAFT_NOT_EXECUTABLE** 候选及后继沿革；初始机器摘要的executionApprovalSha256仍为null，不改写成批准。随后另批的六资源/门禁已真实安装，最新结果见下节及[实测记录](aws-buyer-web-sandbox-bootstrap-observed.md)；原草案和本文件都不是后继私密使用或发布授权。

## 最新限定核对与实际安装待审（18:54，原后端已退役）

用户新批准的限定读取已完成：GitHub9、STS1、AWS元数据16（含一次ValidateTemplate）、无身份HTTPS2；云/配置写、私密值/配置读取、DB、JS、续租、dispatch及重试均0。两份原件为 `F:/ChatGPT_workshop/techlong-buyer-web-execution-readiness-20261028-a.json`（raw SHA `d15b9116a00d864c1fceab20ad9c01f50430302a3f92824573e515dc1f9112a2`）及其 `.supplement.json`（raw SHA `14295af89e49526bdf3b28e7868126cc85a226ceb434b465fe53cdebeeb5d812`）。

原租户栈UUID2b604c90…已DELETE_COMPLETE，ECS INACTIVE、任务0，health/ready均404。根事件显示16:08:39.496删除开始、16:16:37.415完成；“User Initiated”不能确定操作者，本轮没删除、读CloudTrail或直连数据库。**下方对原栈追加CORS的方案仅为准备时历史，现已不可用，不执行或重放旧任务。** task definition9和固定Secret版本元数据仍能读到不代表服务还运行；不宣称其他资源停费。

原六资源模板LF SHA `2a582f4d1e69c69fead459d921ed9ed35e62f9711d9d5e7f4d4fab7e666a6630` 已被AWS ValidateTemplate接受，报告CAPABILITY_NAMED_IAM；不改写原“尚未验证”的历史检查点。新role/policy/stack不存在，OAC候选名称无冲突；桶HEAD404并非全球名称预留。新环境404仍不等于已安装门禁；客户端602e543/CI40789471388保持匹配。

用户随后确认[实际清单](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.bootstrap-execution.json) SHA `e66544260e91a60af62e7275dd69522e406c27aa70f1a5ebb033b066b02570ae`，**19:19–19:24已完成前端承载与人工门禁安装和独立核验**。GitHub环境/master规则两写，独立证明门禁后一次CreateStack/六项准确资源；新栈UUID71751190…/CREATE_COMPLETE，分布EDJYJUKAZ12BO、OAC E2RCLW5N96SAFV、来源https://d3a0kml1xanzgt.cloudfront.net。窄IAM持久保留；没有私密值、变量/Secret设置、发布、CORS、后端恢复或清理。[完整实测、实际次数及下一边界](aws-buyer-web-sandbox-bootstrap-observed.md)。

原准备 `prepared-verified.json` 和三请求体保持原样，不改写PENDING标签或事实起点。恢复改读 `F:/ChatGPT_workshop/techlong-buyer-web-bootstrap-20261028-a/executed-verified.json`（raw SHA `6b174ae265ac4b2d9dda45ebcf5002d267654912b28a824d51df510fd1ee69fc`），绑定9原件与48调用；永久标记已消费，不重复安装/捕获/准备或复位标记。下一仅准备现有workflow所需准确sandbox变量、私密来源与发布清单，并明确新的后端联调/CORS窗口；仍须另审，不延长旧16:06意图或扩控制面。

后继[发布最小准备表](aws-buyer-web-sandbox-publication-plan.md)已固定新输出、五变量和一个Secret来源，但尚无当前元数据/加密步骤的完整执行绑定，执行SHA为空。仅请求新的限定只读许可，不因“开始下一步”自动读Secret、写GitHub配置或调度；不修改本页保留的历史准备原件。

## 15:35已核实的缺口（历史）

[上一实测](aws-product-acceptance.md)已确认旧客户端目标不存在、API配置不对应本次sandbox。客户端3ad0ea8的准确CI40755064679通过，现有Web构建步骤可复用，不再修部署控制器或重复租户部署。

用户另允本阶段最多10次GitHub GET、1次STS＋18次AWS元数据。本次15:34:56.649–15:35:16.248实际用了**9/1/11**，写入、HMAC/Secret值/PEM/.env读取、直接数据库连接、网页JS、调度和提供者重试均0；Git/Source凭据仅按既有路径在进程内使用。旧读取许可未复用。

原件 `F:/ChatGPT_workshop/techlong-buyer-web-plan-readiness-20261028-a.json`，原始字节SHA `7b9357e364f718e54ca0c01050f9082776bdf8145e3272f01785f58dd677f3cd`。准备快照按真实起点5小时至**20:34:56.649**；不改写原16:06:01工作负载意图，旧API健康证据仍仅是14:41的观察。

| 项目 | 本次事实 |
| --- | --- |
| 旧发布角色 | `SpeedFeastBuyerWebDeployRole` / RoleId `AROAV3GNMXTZEM6R2Y7BI`；只信任repo的production环境；无boundary；一份v1策略只允许已不存在的旧桶/分布，无inline |
| production门禁 | environment18478836755只限制master分支，**没有required reviewers**；不能把有environment标签误当本人审批门禁，不在本轮修改它 |
| 拟用sandbox环境 | `techlong-sandbox-buyer-deploy` 返回404（未设置或不可见），未创建 |
| 后端CORS | 准确原栈UUID及task definition revision9均为 `https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud`；未允许新CloudFront来源 |
| HMAC来源引用 | revision9固定指向runtime/g1-T9CqN5的 `hmac_secret_key` 字段、版本0f45d29f-02d4-4117-99b1-c06645aa3c6e；DescribeSecret确认该版本AWSCURRENT，无取值或比较 |
| 新目标占用 | `techlong-sandbox-buyer-web-v1`准确DescribeStacks证实不存在；拟用桶HEAD404不保证全球名称可用；新角色/policy/OAC名称尚未查占用 |

## 选定最小结构

先使用CloudFront默认HTTPS地址，不等待新域名/证书；现有租户API仍独立访问。不加API代理，不丢弃Origin头绕过CORS，不新增ALB/ECS/RDS/WAF、Lambda@Edge、调度平台或固定任务分支。私有S3使用REST origin、OAC和准确分布SourceArn策略，符合[AWS OAC方案](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)。

[候选模板](../ops/aws-sandbox/cloudformation/buyer-web-sandbox-v1.candidate.template.json)共6项：

| 逻辑资源 | 拟新增范围 |
| --- | --- |
| BuyerAssetsBucket | `techlong-sandbox-buyer-web-402010193138-ca-central-1-v1`，全PublicAccessBlock、禁ACL、AES256、版本化、Retain；无website endpoint或自动过期删除 |
| BuyerOriginAccessControl | 仅S3，SigV4 always签名 |
| BuyerDistribution | 一条S3 origin、只读GET/HEAD、HTTPS-only、PriceClass100、无alias/新证书/API缓存/函数；默认缓存300秒，最大86400秒 |
| BuyerAssetsBucketPolicy | 拒绝非TLS，只允许该新分布读取对象，无公开读取 |
| BuyerPublisherBoundary | 仅准确新桶List/Get/Put及终止未完成分片，准确新分布Create/GetInvalidation；同时作为角色的identity managed policy与permissions boundary |
| BuyerPublisherRole | `TechlongSandboxBuyerWebPublisherRole`，仅准确repo＋新sandbox environment的OIDC sub、sts audience；workflow请求900秒会话 |

后两项是**新IAM权限**，实际创建必须另审并声明CAPABILITY_NAMED_IAM。新角色没有DeleteObject、DeleteBucket、Secret、IAM、ECS、CFN或数据库权限；AbortMultipartUpload只终止未完成上传，不是删除已提交对象。旧角色、旧v1 policy及production配置全部保持。不创建新OIDC provider。

模板里的PreparationOnly标签不是AWS强制安全门；它仍是可部署的CloudFormation语法，因此禁止未经批准直接应用。15:35准备时仅有JSON/绑定/权限范围本地核验，尚未调用AWS ValidateTemplate；18:54后的实际AWS验证见顶部，仍没有Change Set或安装成功证明。

## 接线和实际副作用必须集中审批

1. **GitHub环境**：新环境只允许master，required reviewer为用户veinyyxy（14145707），禁管理员绕过；允许该用户对自己手动发起的run审批（prevent_self_review=false），agent永不代批。当前旧production无此门禁，不能直接复用。[GitHub门禁与自审语义](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。OIDC sub不能独立限制workflow文件，同环境的其他workflow也可能申请角色；必须核对准确源码/run并由用户本人批准。
2. **五项环境变量**：AWS_ROLE_ARN/S3_BUCKET/CLOUDFRONT_DISTRIBUTION_ID只取经独立核验的新栈输出，AWS_REGION固定ca-central-1，BUYER_API_BASE_URL固定准确租户API。不改仓库级旧值或production变量。现有CLIENT_ID/VAPID公有配置只有存在性/长度/摘要证据，后续必须保留其版本来源并验证兼容。
3. **构建HMAC**：sandbox独立使用 `SANDBOX_BUYER_HMAC_SECRET_KEY`，缺失即停止，禁止回退旧production Secret。拟来源仅为上述准确固定版本的hmac_secret_key；其值尚未读取、传输或安装。若由agent后续传输，需明确批准一次AWS Secret取值、字段挑选、GitHub环境Secret加密写入及私密进程风险；AWS返回的是整个Secret JSON，其他字段也会进入该进程内存。新publisher不因此获得Secret读取权限。也可由用户通过安全界面配置，但不要把值发到聊天。
4. **公开产物风险**：当前客户端通过dart-define编译HMAC；Web产物的JavaScript可被CDN读者获取和分析。因此即便输入来自GitHub Secret，**该HMAC也不能视为对客户端用户保密**。后续批准须明确接受sandbox下的现有设计边界；本轮不为此扩认证框架，也不暴露JWT、数据库或Stripe私密字段。
5. **CORS（原方案现已失效）**：准备时曾拟只在准确现有租户栈追加从新栈输出派生的单一ClientOrigin并保留原两个来源；这会导致task definition替换与ECS滚动，原本就必须单独受审。18:54已确认该UUID退役，禁止按此旧描述UpdateStack或自动恢复；新的后端验收窗口和CORS来源以后另定，不包含在当前前端安装范围。
6. **发布**：复用 `.github/workflows/web-deploy.yml` 的构建及验证，增加明确sandbox目标选择和环境绑定；sandbox上传去掉`--delete`，保留原production路径。不在此阶段上传对象、生成cache invalidation、手动dispatch或新增tag。源码/准确无AWS CI先完成，再安排本人environment审批及真实发布。
7. **验收与清理**：先不执行JS的产物/HTTPS/CORS核验，再另经批准打开客户端；买家启动会写访问租约及heartbeat，不能算纯只读。下单/支付/商户登录等另定范围。桶与对象版本Retain且没有自动停止，CFN失败、CDN传播、缓存和部分上传均可能留下计费资源；后续清理另审，不自动删桶、清旧版本或重试未知结果。

## 增量费用模型（不是整套系统费用）

按加拿大S3官方区域offer，Standard首档0.025 USD/GB月，PUT/LIST每次0.0000055、GET每次0.00000044；[公开价格原件](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ca-central-1/index.json)。按北美CloudFront付费档保守使用0.085 USD/GB和0.01 USD/万HTTPS，不抵扣账户共享免费额度或credits。[CloudFront官方价格](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)。

假设总存储（含版本）1GB、每月10GB CDN传出、10万HTTPS、2000次S3 PUT/LIST和1000次GET，模型合计约**0.99 USD/月**，未含可能收费的invalidation路径、税、GitHub额度或超量。详见[机器模型](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.prices.json)。不是上限，不承诺整套50 USD/月已达标；既有后端/平台/数据库费用不在此小计，TTL和Retain都不自动停费。

## 已完成：现有客户端workflow的sandbox接线

客户端源码 **`602e543c03564898625618ec3327720d56be04e4`** 已推送到既有master，新增明确sandbox选择但未创建分支。准确[CI40789471388](https://github.com/veinyyxy/speedfeast/actions/runs/40789471388)，push/attempt1、head等于该源码，于温尼伯18:46:20报告completed/success；verify job123170803785的工作流合约、依赖、Analyze、Test、Web release build及收尾步骤全部success。deploy job123170806092为skipped，没有手动dispatch或实际AWS发布。

改动仅原web-deploy.yml、一个纯配置校验器/定向测试和客户端README；不新增部署工作流或通用执行框架：

- 手动target为production/sandbox；production保留原默认、原配置与上传行为。新sandbox名称绑定到techlong-sandbox-buyer-deploy，但这**不等于已安装或核验reviewer设置**；旧production无人工reviewer的事实未在本轮修复，不能误调度旧路径。
- sandbox配置独立读取SANDBOX_BUYER_HMAC_SECRET_KEY；共享build选择的是Secret名称，不是以生产值作兜底。缺失时在AWS认证前拒绝，错误只输出枚举码，不输出输入值。
- 校验器锁定候选账号/role/region/bucket/API，拒绝旧distribution；新distribution仍须由后续真实栈输出与执行清单独立绑定，格式检查不证明资源存在。
- sandbox角色会话请求900秒、限制账号、关闭认证重试；上传不含--delete、CLI最多一次尝试，不取消正在执行的sandbox run。production的原10个step在按production选择投影后与3ad0ea8一致（仅新增分支条件及Secret名称选择）。
- 本机23项定向Node测试、两文件语法、YAML解析/production投影及diff检查通过；CI也实际运行这些合约检查和原Flutter测试/构建。CI只使用合成配置与api.example.invalid，不读生产私密输入、不触发认证或上传。

恢复检查点 `F:/ChatGPT_workshop/techlong-buyer-web-workflow-code-verified-20261028-a.json`，原始字节SHA `2a2febf19e922faae7b1906490069479debcf9edf9d239f9133eef1139e62a63`，绑定四个源码文件LF摘要、准确run/job与成功步骤。本轮AWS调用/写入、私密配置/PEM/HMAC或AWS Secret值读取、DB连接、GitHub环境/Secret设置、手动dispatch、agent审批均0；只推送代码并观察无AWS CI，没有新健康/费用核验或清理。

[原候选总清单](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.plan.json)及三份候选摘要原样保留，其中3ad0ea8和workflowPatchNotImplemented描述的是准备当时状态，不改写为安装事实；实际后继材料必须改用本节602e543及其准确CI，不把原草案直接用于执行。

## 18:23本地收尾历史（当前继续点见顶部）

工作流最小接线和准确无AWS CI完成后，不再加功能或重跑该CI。18:23时实际待审范围尚未备齐、没有执行SHA；原16:06:01窗口已过，因而先申请新限定只读许可。该次核对后来按顶部完成并发现退役，不能再沿用当时的现有栈CORS方向；不复用旧读取许可、秘密输入、旧TTL或旧批准。

顶部新清单只申请独立前端承载与门禁，其他输入、发布及后端验收仍未准备执行批准。不抢用或延长原16:06:01窗口，不重启旧整轮部署或伪造新TTL。

本轮因额度中断，恢复时已为温尼伯18:23，原意图已过期；仅继续本地验证/记录，没有重新查询健康、资源或费用。不能把15:35元数据、14:41健康或仍在5小时内的准备快照当作新的执行窗口；资源可能继续计费，当前现状与清理仍待另审。

本地收尾已通过10组定向检查：准确六类资源、不可执行状态、私有/加密/保留桶、签名HTTPS静态origin、准确分布桶策略、publisher动作白名单及boundary、intrinsic引用、原证据/次数/CORS绑定、费用算术、不延长窗口或私密权限；162个本地Markdown链接有效，git diff检查通过。没有新增运行时代码、AWS模板验证或云部署测试。

候选准备阶段检查点 `F:/ChatGPT_workshop/techlong-buyer-web-candidate-verified-20261028-a.json`，原始字节SHA `aca73213e1aac68293c5f4fae43b1df752a6aa91eab6eb3c443d19f0cee70ce7`，绑定原只读结果和三份候选的LF摘要。不重新执行只读脚本、不把本地检查当安装证明；workflow阶段已由本节新源码/CI检查点收尾。
