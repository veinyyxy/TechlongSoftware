# F3c4：费用覆盖验收接线、单租户IAM编译与v3调度前置

2026-10-12 Winnipeg。本阶段完成三项复用编译器和一次新的真实只读评审，**云写0**。不安装权限、不读Secret值、不连接Neon、不调用Lambda、不创建付费Cell或启用运行时。它不是可执行云批准清单，不能凭报告SHA申请或执行泛化安装。

## 已实现

1. **明确的费用覆盖验收**：`compileLiveDirectCostReadinessV1`独立验证已执行F3c3d原SHA/代码与签名清单，再核对新鲜完整云状态。仅接受实际Budget50、准确TableId ACTIVE/read100-write2、CFN模板参数10及其它绑定配置完全一致。金额覆盖必须来自准确批准记录与已消费槽位，不接受任意50值、读cap≥100或静默CFN纠正；旧cost/readiness v1检查和原16文件不修改。
2. **专属lifecycle TaskRole权限编译**：`compileSingleTenantLifecycleIamV1`复用prepared-v2审阅，输出一项新专属boundary与一项新inline候选，目标仅现有`TechlongSandboxTenantLifecycleTaskRole`。精确绑定单租户/单代次两个authority keys、两pinned baseline对象、单代次immutable receipts、实际管理/代次Secret完整ARN，以及实际KMS Key。保留原共享boundary对象，拟更新角色的boundary指向而非修改所有角色共用policy；**共用TaskExecutionRole不变**，避免影响将来的公开应用Secret注入。
3. **schema3 DISABLED drain调度片段**：`compileDisabledSealedDrainScheduleV3`要求真实、完整校验的provision_verified item与准确Stack ARN，绑定其item SHA/drain intent SHA及已登记sealed certificate，目标为现有drain coordinator。State=DISABLED、Scheduler retries=0、事件年龄60秒、ActionAfterCompletion=NONE；秒级执行时间向上取整，不能提前于Cell到期。无虚构Stack ARN、Future Secret、TaskDefinition revision或占位SHA生成真实评审文件。

新编译器均深冻结数据且authorization/runtime标志固定false，没有云writer或安装入口。IAM候选需真实Cell管理端点、完整Secret/KMS、租户fence和TaskDefinition坐标，当前尚无这些资源，因此**未生成可安装IAM清单或真实调度对象**。测试只用明确fixture；fixture不进入云报告或审批材料。

## 刷新后的真实只读结果

首次r1在CredentialsProviderError停止；单独STS CLI也未取得身份，失败摘要SHA `49c72bcf339c8b5c54514802d05109841e712b751f3fa44b94db95d4888eca5a` 保留。用户刷新Source后生成全新r2目录，不重跑旧费用helper或消费槽位。

最终只读报告：2026-10-12 **16:12:51.008 UTC / Winnipeg11:12:51.008**。

- 新费用readiness真实通过：observedAt **16:12:45.957 UTC**，settings仍 `575a194a1f4e2d8c73ace3f2ab36584aa30bdc19fbbe487ff774b95b4842220d`，实际Budget50/表100-2、CFN10覆盖及所有绑定配置保持。旧写批准已过期不影响读取历史成功证据，绝不续期旧执行授权。
- 费用证据仅在观测后30秒有效（至16:13:15.957 UTC）；此归档报告现在只是观测记录，**不能缓存为后续付费执行的当前门禁**。任何未来安装/付费执行必须重新在线取证与另fresh准确清单。
- 两现有Task角色均仍共享`TechlongSandboxServiceRoleBoundary`默认v3、无attached policies、各一inline。Lifecycle RoleId `AROAV3GNMXTZDIWVT3BKN`；Execution RoleId `AROAV3GNMXTZJHJWAN4IR`。Lifecycle inline允许动作仍只有S3 Get/Put与Secret Get，没有DDB activation读取；旧receipt scope不等于新baseline读取。
- 准确activation GetItem与准确baseline GetObject模拟均**implicitDeny**，MissingContext非空，只报告本次Context下模拟结果，不把它当全面有效权限结论。边界/identity/RB policy、SCP或后续并发仍需未来实际验收。[AWS权限boundary说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)
- `runtime:cell-sandbox-1:lifecycle-v2` Item缺失，ECS `cell-sandbox-1` MISSING，不能伪造管理端点、master Secret或真实任务修订。
- 两清理Lambda均Active/Successful；CodeSha256解码后仍匹配已安装business ZIP `621a8cd5...` / `20554427...`，Revision仍为 `281d13a3...` / `333d8639...`。这只是元数据保持，不是实际Invoke、Neon写、自动授权或清理通过。
- 两函数均无显式FunctionEventInvokeConfig。Scheduler重试为0不等于Lambda异步队列零重试；[AWS异步说明](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)指出默认会对函数错误重试，并可能重复投递。未来enable需另审异步配置、幂等journal、事件有效期及失败目的地，本轮不写此配置。
- 默认Secrets Manager KMS Key元数据ARN为 `arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570`。仅alias元数据不证明未来两Secret实际使用该Key，不以它填补未存在资源。

## 权限与调度候选的风险边界

新TaskRole boundary/inline的DDB仅GetItem，LeadingKeys准确限制activation与一租户epoch，并要求该Context存在；不包含Put/Update/DeleteItem、authority发行、RunTask、PassRole或Secret写/删。S3两baseline只Get；receipt仅本代次Get/条件Put，继续要求AES256/If-None-Match。DDB细粒度条件参见[官方说明](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html)。DescribeTaskDefinition仍必须Resource=*并限制region，这是既有prepared-v2例外，不扩大写能力。

加入KMS Decrypt是避免再次出现只允许Secret Get却被boundary挡住解密：只允许准确Key、Secrets Manager ca-central-1转发、CallerAccount402010193138、准确两Secret的EncryptionContext。不是直接Decrypt任意密文，也不改Key或Secret；依据[Secrets Manager加密说明](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)。实际Key策略及角色读取仍需独立权限与Fargate验收。

角色boundary替换会缩窄既有权限，不能直接把数据型候选当安装批准；当前trust、RoleId、policy/default version、其它依赖、并发/非CAS及失败部分安装影响，需未来明确清单。新boundary不自动授权，也不以候选哈希推导云资源存在。

DISABLED调度片段不是完整Cell模板或清理保证。只做drain/enqueue，不安装v3删除authority/journal、不DeleteStack；Scheduler role调用新函数的权限未验收，Lambda异步retry也未配置。由于TTL executor要求到期后zero证据及准确删除plan SHA，**不能在创建前用占位删除SHA写入ENABLED schedule**。未来自动授权/精确删除权限、失败创建补偿及实时到期清理必须先闭环。

旧`shared-cell-stack.ts`仍是schema1/PLAN_ONLY Janitor/ENABLED/10 retries，旧provision证据adapter又会重新渲染该模板做完整指纹检查。因此不能仅替换旧模板中的目标ARN，或把本片段嵌入后绕过旧验证。本轮旧模板/旧adapter不改；下一阶段需独立v3 Cell renderer与匹配证据adapter、自动清理授权及失败补偿组合，仍保持付费apply关闭。调度状态和retry参数依据[AWS Schedule](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-scheduler-schedule.html)、[RetryPolicy](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-scheduler-schedule-retrypolicy.html)。

## 验证与材料

9新+11相邻共 **20测试通过**；类型fixture修正后9新测试再次通过（不重复合计）。typecheck、定向lint（无剩余warning）、CLI syntax通过。未跑全量离线模拟、build、镜像重建或旧云探针。

私有r2：`F:/ChatGPT_workshop/techlong-f3c4-deployment-prerequisites-20261012-r2/`。

- 报告文件SHA `5539d1233e3f7c22fde58afb39603d19cb5331b3ced78689743df7df3c773987`。
- 原始snapshot文件SHA `cb29df7c797223517dd6595daff3d948002bc2bc1b15796f4fa239e23f0668ed`，其中原始IAM文档不提交Git。
- 24文件代码绑定SHA `66415f118d24c81249ebe9dbcf12ed85a64c5ba7a3c5d674deeb8febe15fbe5e`；最后本地回读均未改，原16/b8672d4a...保持。旧清单、已消费七marker及其它原记录不改。[公开安全摘要](../ops/aws-sandbox/reviews/f3c4-deployment-prerequisites.prepared.json)。

下一阶段沿主线集中实现v3 Cell模板/证据与自动授权/失败补偿，不重做已完成Budget/DNS/baseline，也不为当前未知未来资源编造IAM批准SHA。真实新权限安装/函数配置/付费部署仍按具体资源与fresh SHA确认；50 USD预算目标不是硬cap。
