# K2b 已完成：真实初始化成功，独立认证验收通过

用户对[准确清单及完整风险](aws-auto-deployment-aurora-dual-mode-k2b-initialization-recovery-review.md)回复“确认”后，按 SHA `7596abc946c49640de42832aab432bcbe437f51bcd81136221a692aebe1d3017` 执行唯一Run，再由新进程执行唯一Inspect。**两个永久槽、批准及本轮私密/HTTP读取次数均已消费；不重放Run，不再次Inspect、POST、连接Aurora或读取私密值。** 原风险、源码闭包、K2a及更早证据未改动。

## 实际时间与结果

以下均为 Winnipeg **2026-10-16 CDT**，括号内为同日UTC：

- 00:31:28.897（05:31:28.897）：入场元数据核验完成。
- 00:31:29.425（05:31:29.425）：根永久槽独占写入并fsync。
- 00:31:36.031（05:31:36.031）：唯一新的postgres TLS只读事务完成，10 SELECT/14 query、0额外ROLLBACK；当前目录/ACL/73表计数/默认entitlements/原UUIDv8店铺仍完整pristine。
- 00:31:45.232（05:31:45.232）：POST前完整元数据核验完成。
- 00:31:45.398（05:31:45.398）：唯一POST intent槽消费；pristine回执距此9.367秒，元数据回读距此0.166秒，落盘后时限/事实窗口复核均通过。
- **00:31:45.991（05:31:45.991）：唯一真实provision POST成功返回并验证receipt、准确store及新建首位owner。**
- 00:31:47.304（05:31:47.304）：Run认证readiness/control确认初始化及有效配置；00:31:53.806后置承载/平台元数据核验通过。
- **00:32:19.910（05:32:19.910）：新进程重新加载私密控制来源、签新JWT、经mTLS独立readiness/control验收通过**；未建立第二次Aurora连接或再次读Secret值。

最终结果 `INITIALIZED_CONFIGURATION_INDEPENDENTLY_VERIFIED_PLATFORM_UNCHANGED`。实际新镜像为 `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，期望配置hash `06d3cb50dd46b5f32771c356b7e7cd7d524a0707799ae24b9ace0672ef7281c9`；准确新栈UUID `f71252c0-c917-11f1-8148-02ff648cb917`、task definition:2、1运行及healthy target保持。

初始化验证包括13项readiness绑定与实际image、准确原store `add89a8c-f43e-81b9-8287-0cb6c5c54f87`、店铺名`Techlong Sandbox`、原八项entitlements、buyer/merchant主题及重算有效配置摘要。首位owner `techlong_sandbox_admin` 的准确用户名/active/owner role与created=true由POST回执验证；独立readiness复核owner存在，**没有另外读取商户用户行或密码来声称独立复验用户名**。

## 实际副作用、证据与范围

一次POST确实在租户库执行初始化业务写：instance/epoch/receipt、entitlements、店铺profile/主题/配置历史、首位owner/password hash、操作及audit等。这不是只读探针，也不称为全系统只有一次SQL写。操作器直接AWS/IAM/Secret/DNS/DDB/Neon平台写均0，未创建/删除或更新云资源，未轮换Secret/密码、变更代码或调度；没有额外provision或自动重试。

Run四个应用请求：bootstrap GET、provision POST、readiness GET、control GET；独立Inspect两个GET。总计**1 POST + 5 GET**。准确固定Secret版本读取1次；原私密包共加载2次，其中旧loader必读的测试付款材料仅在内存校验，不使用payment委托或调用Stripe。owner密码按既有HKDF派生后只交给固定租户服务，不打印/保存或交付聊天；请求/响应正文及password-bearing body hash不落盘。

四组元数据各35 SDK/11 CLI/1 Neon只读：共140项metadata SDK、44项CLI、4次Neon只读事务；固定成功编译路径另5次Neon绑定SELECT只读，以及SQL入口1次STS、密码来源1次STS/2次Secret Describe/1次Get。上述后两类按固定成功调用路径计算，不冒充完整CloudTrail遥测；凭据提供者内部刷新和应用/提供者内部活动不含在操作器计数中。

Review4文件、Run8文件、Inspect4文件及两个永久槽，共18份raw hashes及脱敏结果见[执行摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-k2b-initialization-recovery.executed.json)。旧r1/r2准备记录、原17槽、K2a读槽和所有历史原件保留。两次认证观察是分别当时的真实应用读回，不是跨服务CAS，也不证明未来无人修改。

## 平台仍未ready——唯一下一步 K2c

本次是明确批准的人工恢复，不是续租或冒充旧worker成功。原deployment `dep_7c99bd249470184852f0dc74` 仍configuring、instance仍pending，原job `job_202c8dc12a8bf379f3a7c693` 仍running/attempt1/max1且lease过期；desired_plan/plan_hash/idempotency_key、旧artifact_ref、空最终stack/observation输出、generation1/epoch1及ownership/authority原状保持。

**不要再次初始化。** 下一步只准备K2c：基于当前已初始化证据，独立核对新的承载/应用状态和原平台精确旧值，设计一个SERIALIZABLE/CAS短事务协调实际artifact_ref、新stack/observation、实例active/access URL、deployment ready及旧job终态/清lease，保存原旧artifact、失败/人工恢复归因和回执摘要。不新建job、不自动续租/增加attempt或把人工执行伪装成旧worker；具体字段/门禁需代码及现场准备后fresh SHA另审，不能直接套用要求有效lease的旧finishReady。

K2c新的私密加载/认证GET和Neon平台写均未包含在已消费K2b范围内；不得以“只读”或审批窗口尚未结束为由追加调用。无需重发镜像、restore/seed、改IAM/Secret或重建资源。若之后workload被清理，初始化证据仍须保留，不因服务缺席就再次provision；先另审承载处理。

**workload固定到期仍为2026-10-16 07:04:28.726 CDT（UTC12:04:28.726）**，旧Janitor保持启用，没有续期、关闭清理器或新建替代资源。既有Cell/Aurora/Fargate/Secret/ECR持续计费，50USD/月是目标而非cap。不扩展F3c9/Grant或其它支线。
