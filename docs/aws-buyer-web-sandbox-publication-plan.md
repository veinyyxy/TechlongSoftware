# 买家Web sandbox发布：最小准备清单

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)。**仅准备，未获执行批准**；[机器候选](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.publication-plan.json)的executionApprovalSha256为null，不是可重放命令或新事实窗口。已有承载和本人门禁的[真实安装](aws-buyer-web-sandbox-bootstrap-observed.md)不重做，客户端源码602e543/CI40789471388及现有workflow不改，不加运行器或部署框架。

## 本轮最小范围

复用veinyyxy/speedfeast的原web-deploy.yml，目标必须显式为sandbox、ref仅master，并固定到准确602e543源码；production默认值绝不能因漏传target被使用。新环境techlong-sandbox-buyer-deploy已安装，但其当前配置、Secret名称元数据和公开加密key仍需新的限定只读核对；未核对前不声称当前为空或已可发布。

| 拟新增sandbox环境变量 | 准确值/来源 |
| --- | --- |
| AWS_ROLE_ARN | arn:aws:iam::402010193138:role/TechlongSandboxBuyerWebPublisherRole |
| AWS_REGION | ca-central-1 |
| S3_BUCKET | techlong-sandbox-buyer-web-402010193138-ca-central-1-v1 |
| CLOUDFRONT_DISTRIBUTION_ID | EDJYJUKAZ12BO |
| BUYER_API_BASE_URL | https://first-acceptance.sandbox.techlong.cloud；仅编译目标，当前API可用未证明 |

这五项来源于新栈准确输出与现有配置校验器，不改仓库级或production变量。BUYER_CLIENT_ID和BUYER_FIREBASE_WEB_VAPID_KEY继续沿用原公有仓库变量，但须新核对其来源、非空/格式及原摘要，不能用合成测试值充当实际配置。五个目标名称若已有值或发生漂移则停止，不自动改成PATCH覆盖。

仅拟新增一个环境Secret：SANDBOX_BUYER_HMAC_SECRET_KEY。来源限定为已知runtime/g1-T9CqN5的固定版本0f45d29f-02d4-4117-99b1-c06645aa3c6e、字段hmac_secret_key；准确ARN在机器候选。准备阶段只允许另经同意的DescribeSecret等元数据，**不取值**。执行时若获批准，最多一次GetSecretValue，整个Secret JSON会进入受审进程内存，只有该字段经标准LibSodium sealed box加密后发送到准确GitHub环境；不落地、打印、提交明文，不转移JWT/数据库/Stripe等其他字段。GitHub Secret元数据不能读回值，因此后继元数据回读只能证明名称/时间，不能单独证明明文一致。[官方环境Secret加密接口](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret)。

## 拟连续执行顺序（仍待准确SHA）

1. 新限定元数据与本地封存安装证明完全匹配，确认本人reviewer/禁管理员绕过/唯一master规则、准确源码/CI、无冲突运行和目标空缺。发布前还须在批准范围内独立核对初始桶对象为空；不把安装时未上传推导成当前一定为空。
2. 五次环境变量创建、一次受审固定版本HMAC读取与环境Secret写入，随后独立回读配置/名称元数据。遇到非201、结果不明或任何漂移停止，不把创建静默换成更新，不重读秘密或补齐部分状态。[官方变量创建接口](https://docs.github.com/en/rest/actions/variables#create-an-environment-variable)。
3. 用户就绪后仅一次dispatch，body明确ref=master、inputs.target=sandbox，并请求return_run_details。以真实ACK的run ID回读head/source/target，随后只请用户本人批准该准确run的techlong-sandbox-buyer-deploy环境；不代批，不Run/Re-run，不根据时间范围猜测run。master的前后核对不是原子CAS；漂移或未返回准确run ID均停止，不重复提交。[官方单次调度及run引用](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。
4. 复用原云端Analyze/Test/Web build，AWS认证在构建后，仅900秒账号限定OIDC会话。现有S3 sync无--delete，可能执行多次List/Head/Put或multipart操作，不是“一次AWS写”；一次CLI invalidation仅准确新分布的/*。局部失败可留下对象版本、收费请求/缓存和持久配置；不自动删除、回滚、撤权或重跑。既有Actions/Flutter依赖下载的内部行为不等于所有网络请求绝无重试；不能把部署AWS操作的禁重试设置扩大为这种保证。
5. 独立核对准确run/head/步骤、S3对象元数据/缓存失效和有限无身份HTTPS静态响应；不取含HMAC的JS正文、不执行JS、不登录或调buyer/access。当前workflow没有部署产物artifact上传步骤，不能宣称会获得不存在的GitHub build artifact；实际审查需绑定真实run及S3元数据，静态成功不证明API/业务成功。

原无AWS CI已通过，不为准备工作再重跑。标准加密依赖/一次性执行步骤仍须在最终批准前固定和验证；本机未发现可直接复用的gh/PyNaCl工具，不因此下载/执行未审包、手写密码算法或增加云权限。候选只描述接口和范围，尚未声称转移入口已经就绪。

## 为什么先发布静态客户端，不现在重开后端窗口

旧租户UUID2b604c90…最后18:54证据为DELETE_COMPLETE、ECS INACTIVE/任务0；本轮没有新在线读取。不能UpdateStack旧UUID、重新领取a00、复位永久槽或延长旧16:06意图。静态构建与上传无需运行后端，先完成它可避免在Flutter构建和人工审批期间消耗新的付费后端联调窗口。

客户端编译API仍是first-acceptance.sandbox.techlong.cloud；这不是改指旧production API，也不是API健康证明。真正业务验收前，需要另行集中备齐新的后端窗口及合法请求/来源绑定，使用现有能力而非固定任务代码分支；新后端准确CORS须包含真实ClientOrigin https://d3a0kml1xanzgt.cloudfront.net，并核对/保留原两个来源，不能使用*或移除Origin绕过。该后端恢复/CORS、数据库业务状态、应用登录/访问租约/下单或支付均不在本次静态发布批准范围内。

## 风险、费用和当前停止点

HMAC通过dart-define进入Web JS，**即使输入保存在GitHub Secret，也可被产物读者获取和分析**；只能在明确接受这一sandbox现有设计边界后发布，不声称保密。不因本轮扩大到JWT、数据库或Stripe私密材料。

配置、Secret、dispatch与对象上传非原子；GET后再POST/PUT有并发竞态，缺少写后ACK时不自动重试。部分配置/Secret或对象可持续存在、产生费用；新窄IAM不自动撤销，桶Retain版本不自动清理。50 USD/月是整体目标，旧[小流量模型](aws-buyer-web-sandbox-plan.md)不是硬上限，也不包含全部平台/数据库/GitHub用量。新元数据快照按真实采样5小时；最终执行须设置真实起止与足够人工审批余量，不沿用已经消费的bootstrap批准、旧API TTL或旧事实时间。

**当前只请求新一轮限定只读准备**：Source最多1次STS＋16次AWS元数据、GitHub最多20次GET；仅核对已装前端/权限、固定Secret版本元数据、旧后端状态、源码/CI/门禁/变量/Secret名称/公钥和冲突运行。未得到该次许可前不使用既有凭据发这些认证请求，不读取私密值或配置、不写资源/变量/Secret、不消费执行槽或dispatch。材料完全齐备后才给准确执行SHA；这份草案不授予实际写入权限。
