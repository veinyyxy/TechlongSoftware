# Sandbox买家Web：配置、一次发布与独立静态核验风险

2026-10-28，America/Winnipeg。**待用户确认准确执行SHA，尚未执行本文件中的私密读取、配置写入或发布。** [机器执行范围](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.publication-execution.json)绑定真实快照、五份非秘密变量请求体、单次dispatch输入、固定版本引用、标准加密步骤与依赖摘要；原[范围草案](aws-buyer-web-sandbox-publication-plan.md)保持历史状态，不作为执行批准。

## 已完成的准备，不重做安装

本轮19:46:35–19:47:02 CDT另允只读实际为Source STS1、AWS元数据16、GitHub GET17；私密值、DB、产品HTTPS、配置/云写、dispatch与执行槽消费均0。新栈71751190…/六资源、原模板、分布EDJYJUKAZ12BO/OAC、桶保护、原RoleId/PolicyId及trust/边界/策略均保持。GitHub环境25634086386、唯一master规则64728366和本人reviewer保持，五变量为空、目标Secret不存在；已取得公开加密key元数据，两个公有仓库变量格式/原摘要匹配，无queued/in_progress/waiting的Web发布运行。旧准确租户UUID仍DELETE_COMPLETE，不证明其他namespace全部为空或整体停止计费。

原件 `F:/ChatGPT_workshop/techlong-buyer-web-publication-readiness-20261028-a.json`，raw SHA `747dca413f92ebcff1a5e2f887cdec27ce92f7bf154a8ae4f6718ae47c696173`。客户端源码602e543/CI40789471388与原workflow摘要仍匹配，不改客户端源码或重新做无AWS CI。六资源及持久窄IAM已安装，不再CreateStack、扩权限或新建发布工作流。

## 本次申请的准确副作用

1. **预检**：用实际凭据证明固定Source IAM用户、repo权限、准确master/源码/CI、原人工门禁、固定版本元数据及新目标空缺；读取准确桶对象元数据证明初始为空，并记录准确分布现有invalidation。已有目标值、Secret、对象、冲突运行、key轮换或其他漂移均停止，不覆盖、采用旧值或换目标。
2. **五次GitHub POST创建变量**：仅techlong-sandbox-buyer-deploy的AWS_ROLE_ARN、AWS_REGION、S3_BUCKET、CLOUDFRONT_DISTRIBUTION_ID、BUYER_API_BASE_URL。准确值在机器清单/封存请求体；不改仓库级或production配置，不用PATCH补齐。BUYER_CLIENT_ID/VAPID只沿用并核对原公有仓库变量，不另写入。
3. **一次固定Secret读取、一次GitHub Secret PUT**：准确runtime/g1-T9CqN5 ARN、VersionId 0f45d29f-02d4-4117-99b1-c06645aa3c6e，要求仍为AWSCURRENT；整个AWS Secret JSON会进入受审本机进程内存，取hmac_secret_key，经已绑定的标准LibSodium sealed box，仅向准确环境的SANDBOX_BUYER_HMAC_SECRET_KEY发送加密值。不得读取PEM/.env/控制私密包，不传JWT/数据库/Stripe等其他字段；明文和密文请求体均不输出、落地或提交Git，仅记引用/ACK。JS字符串与GC无法保证安全擦除，Buffer清零只是尽力，不宣称彻底消除内存风险。
4. **独立配置回读后一次dispatch**：仅veinyyxy/speedfeast的既有web-deploy.yml、ref=master、inputs.target=sandbox、return_run_details=true。必须真实ACK返回run ID，回读准确head后才请用户本人批准该run的techlong-sandbox-buyer-deploy；agent不代批，不猜测run、不Run/Re-run，不自动重试未知POST。master前后核对不是跨服务CAS，若并发变更导致run源码不匹配，不让用户批准。
5. **云端原工作流发布**：复用Analyze/Test/Flutter build，随后900秒账号402010193138/ca-central-1限定OIDC会话；向准确新桶sync且无--delete，可能产生多次List/Head/Get/Put或multipart调用，没有总对象数/底层API写次数硬上限。仅一次CLI调用为准确分布EDJYJUKAZ12BO创建/* invalidation。权限不含对象删除、Secret、IAM、ECS、CFN或数据库。既有Actions/Flutter依赖下载等内部行为不保证完全没有网络重试，不能把AWS认证/CLI禁重试扩大成这个保证。
6. **独立静态核验**：回读准确run/head/步骤及S3对象元数据，核对index.html、main.dart.js、flutter_bootstrap.js元数据与准确分布的新增invalidation；最多3次无身份静态HTTPS请求，仅GET index.html和HEAD两份JS，不取JS正文、不执行JS、不调API或登录。可用ETag/大小等相互核对，但不冒充全部bundle内容的密码学审计。invalidation从准确分布前后集合差中只接受一个新ID，再准确GetInvalidation；并发/集合不唯一则不猜测。当前workflow没有artifact上传步骤，不虚构GitHub产物原件。静态成功不等于后端、支付或产品业务成功。

## 累计上限与时序

本次常规GitHub写最多**7次**（5变量＋1Secret＋1dispatch）；Source GetSecretValue最多1次，固定版本且不重读；Source STS最多3次、AWS元数据最多50次、GitHub只读GET最多140次、无身份静态HTTPS最多3次。准确run状态最多90次/间隔30秒；人类门禁等待最多15分钟、原job timeout30分钟；新增invalidation最多12次准确状态观察。以上是本机顶层调用预算，**不是云端构建、OIDC或S3托管操作的底层API次数上限**。

准备起点**10月28日19:46:35.184 CDT**，5小时到期为**10月29日00:46:35.184 CDT**；最晚启动为**10月28日23:46:35.184 CDT**，本机观察最多60分钟。开始与真正dispatch前分别核对时间，用户应在该次提示的15分钟门禁截止前批准；过期不要操作GitHub批准。不开新后端TTL，不给旧16:06意图或旧事实延期。

**现有workflow没有绝对墙钟截止输入。** GitHub排队/环境等待不受本机超时硬拦截，job timeout不涵盖全部排队时间；已ACK的唯一run可能在本机停止后继续或稍后完成。此审批只覆盖该一个准确run及其原job超时内的正常动作，接受其异步完成可能越过本机观察截止的风险；不声称本机退出会自动取消任务/停止写入。本轮不申请取消API或自动清理；结果不明先保留证据并请求新的限定回读，不重复dispatch，也不让用户过期批准。

## 加密依赖与明确风险

标准库只安装在本轮本地准备目录，固定libsodium及libsodium-wrappers **0.7.15**，官方npm tarball SHA512已锁定，禁安装脚本/审计/用户与全局认证配置；不改应用运行时依赖。三个合成测试通过：标准sealed-box往返、只选择HMAC/固定接收key、错误输入仅返回枚举码；未使用真实秘密。最终执行前核对helper、lock和全部包文件摘要后才导入，不自写密码算法，不在真实Secret进入内存时下载包。[标准wrapper包](https://www.npmjs.com/package/libsodium-wrappers/v/0.7.15)、[官方环境Secret接口](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret)。固定接收key_id为3380204578043523366，环境公钥是公开元数据，不是PEM私钥。

HMAC通过dart-define进入公开Web产物，**任何能读取JS的人都可能提取该共享密钥并构造签名**；GitHub Secret只保护输入环节，不让客户端密钥保密。必须明确接受sandbox现有设计边界后才能发布；本轮不扩大到生产、不重构认证方案或泄露其他字段。该值保留在GitHub环境，后续符合门禁的工作流可能使用它，资源与发布权限也不会自动撤销。

API/配置/Secret/对象上传非原子；GET后的并发创建可能让Secret PUT更新他人刚创建的同名Secret，不能声称404消除了覆盖风险。意外204、失败或ACK不明后立即停止后续写入，不自动改成覆盖/回滚/撤权/重试或补齐。部分变量/Secret、对象版本、CDN缓存和收费请求可能残留；Secret GET元数据不提供明文，独立名称/时间回读不能单独证明值正确。网络、provider/runner日志、内存或第三方依赖存在风险，错误仅记录枚举码，不复制原始私密异常。

桶版本Retain和持久IAM继续存在；发布、流量、缓存失效、对象版本及GitHub runner用量可能收费，50 USD/月只是整体目标，不是硬上限。本轮不删除对象/资源、停机或清理，也不保证共享平台/数据库费用停止。

## 后继业务边界

编译API准确指向first-acceptance.sandbox.techlong.cloud，不改到旧production API；旧准确后端已退役，本次不恢复、不UpdateStack旧UUID、不重放任务/Review或复位槽。真正业务验收前另集中准备新的真实后端窗口和合法请求/来源，CORS须允许真实ClientOrigin https://d3a0kml1xanzgt.cloudfront.net并核对保留原来源；不借发布自动写数据库或TTL。

本次不启动浏览器JS、访问租约/heartbeat、商户/买家登录、下单或支付，不新增Cell/ALB/ECS/RDS/DNS/IAM。一次尝试标记在预检通过、首个写/私密读取前创建，消费后不自动复位或重跑。实际获批后沿用既有REST/AWS CLI和本轮纯加密helper，不新增通用执行框架；`wholeProductAccepted=false`。
