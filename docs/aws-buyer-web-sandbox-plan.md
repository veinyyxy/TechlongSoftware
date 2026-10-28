# 买家Web最小承载与发布候选

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)。状态为 **DRAFT_NOT_EXECUTABLE**：本阶段只完成元数据核对、模板和范围准备；没有安装IAM、创建资源、改GitHub配置、读取私密值或调度。下文不是执行批准清单，机器摘要中的executionApprovalSha256仍为null。

## 已核实的缺口

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

模板里的PreparationOnly标签不是AWS强制安全门；它仍是可部署的CloudFormation语法，因此禁止未经批准直接应用。当前仅JSON/绑定/权限范围本地核验，未调用AWS ValidateTemplate，不声称AWS验证或Change Set审查通过。

## 接线和实际副作用必须集中审批

1. **GitHub环境**：新环境只允许master，required reviewer为用户veinyyxy（14145707），禁管理员绕过；允许该用户对自己手动发起的run审批（prevent_self_review=false），agent永不代批。当前旧production无此门禁，不能直接复用。[GitHub门禁与自审语义](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。OIDC sub不能独立限制workflow文件，同环境的其他workflow也可能申请角色；必须核对准确源码/run并由用户本人批准。
2. **五项环境变量**：AWS_ROLE_ARN/S3_BUCKET/CLOUDFRONT_DISTRIBUTION_ID只取经独立核验的新栈输出，AWS_REGION固定ca-central-1，BUYER_API_BASE_URL固定准确租户API。不改仓库级旧值或production变量。现有CLIENT_ID/VAPID公有配置只有存在性/长度/摘要证据，后续必须保留其版本来源并验证兼容。
3. **构建HMAC**：sandbox独立使用 `SANDBOX_BUYER_HMAC_SECRET_KEY`，缺失即停止，禁止回退旧production Secret。拟来源仅为上述准确固定版本的hmac_secret_key；其值尚未读取、传输或安装。若由agent后续传输，需明确批准一次AWS Secret取值、字段挑选、GitHub环境Secret加密写入及私密进程风险；AWS返回的是整个Secret JSON，其他字段也会进入该进程内存。新publisher不因此获得Secret读取权限。也可由用户通过安全界面配置，但不要把值发到聊天。
4. **公开产物风险**：当前客户端通过dart-define编译HMAC；Web产物的JavaScript可被CDN读者获取和分析。因此即便输入来自GitHub Secret，**该HMAC也不能视为对客户端用户保密**。后续批准须明确接受sandbox下的现有设计边界；本轮不为此扩认证框架，也不暴露JWT、数据库或Stripe私密字段。
5. **CORS**：只在准确现有租户栈追加从新栈输出派生的单一ClientOrigin，保留原两个来源；不使用`*`、不替换API域名，不更新镜像/其他参数。此项将导致task definition替换与ECS滚动，可能有托管旧revision清理、回滚/部分失败或短时不健康，**不是纯前端变更**，必须包含在实际审批中；不在本轮执行。
6. **发布**：复用 `.github/workflows/web-deploy.yml` 的构建及验证，增加明确sandbox目标选择和环境绑定；sandbox上传去掉`--delete`，保留原production路径。不在此阶段上传对象、生成cache invalidation、手动dispatch或新增tag。源码/准确无AWS CI先完成，再安排本人environment审批及真实发布。
7. **验收与清理**：先不执行JS的产物/HTTPS/CORS核验，再另经批准打开客户端；买家启动会写访问租约及heartbeat，不能算纯只读。下单/支付/商户登录等另定范围。桶与对象版本Retain且没有自动停止，CFN失败、CDN传播、缓存和部分上传均可能留下计费资源；后续清理另审，不自动删桶、清旧版本或重试未知结果。

## 增量费用模型（不是整套系统费用）

按加拿大S3官方区域offer，Standard首档0.025 USD/GB月，PUT/LIST每次0.0000055、GET每次0.00000044；[公开价格原件](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ca-central-1/index.json)。按北美CloudFront付费档保守使用0.085 USD/GB和0.01 USD/万HTTPS，不抵扣账户共享免费额度或credits。[CloudFront官方价格](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/)。

假设总存储（含版本）1GB、每月10GB CDN传出、10万HTTPS、2000次S3 PUT/LIST和1000次GET，模型合计约**0.99 USD/月**，未含可能收费的invalidation路径、税、GitHub额度或超量。详见[机器模型](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.prices.json)。不是上限，不承诺整套50 USD/月已达标；既有后端/平台/数据库费用不在此小计，TTL和Retain都不自动停费。

## 当前唯一继续点

[候选总清单](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.plan.json)已绑定本次事实和模板，但仍不可执行。下一**仅实现现有客户端workflow的sandbox选择、独立环境/Secret名称和无delete适配，做定向检查及准确无AWS CI**；不安装云/GitHub环境或私密材料。无需重跑已通过的原SDK CI，不再扩控制面。

代码/材料齐备后才集中准备实际六资源、GitHub设置/私密输入和准确CORS变更的执行批准与新时序。现在不发执行SHA、不抢用原16:06:01窗口，也不自动给它延期；原到期后若要继续在线验收，先按手册另审现状/清理及所需新窗口，不重启整轮部署或伪造新TTL。

本轮因额度中断，恢复时已为温尼伯18:23，原意图已过期；仅继续本地验证/记录，没有重新查询健康、资源或费用。不能把15:35元数据、14:41健康或仍在5小时内的准备快照当作新的执行窗口；资源可能继续计费，当前现状与清理仍待另审。

本地收尾已通过10组定向检查：准确六类资源、不可执行状态、私有/加密/保留桶、签名HTTPS静态origin、准确分布桶策略、publisher动作白名单及boundary、intrinsic引用、原证据/次数/CORS绑定、费用算术、不延长窗口或私密权限；162个本地Markdown链接有效，git diff检查通过。没有新增运行时代码、AWS模板验证或云部署测试。

恢复检查点 `F:/ChatGPT_workshop/techlong-buyer-web-candidate-verified-20261028-a.json`，原始字节SHA `aca73213e1aac68293c5f4fae43b1df752a6aa91eab6eb3c443d19f0cee70ce7`，绑定原只读结果和三份候选的LF摘要。不重新执行只读脚本、不把本地检查当安装证明；下一只从上述workflow最小适配继续。
