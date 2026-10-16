# K3r：保留已初始化数据库的承载恢复及公网验收——固定范围/完整风险 v1

用户仅同意此方向，**不等于实际创建或写入批准**。Check本地闭包，Review只读现有AWS元数据和Neon控制面；均不加载私密包/Secret值、不连Aurora、不调用应用、不消费槽或创建资源。最终fresh SHA须明确批准，提交代码不是授权。旧K1/K2/K3a批准、期限、槽、失败记录全部保留且不重放。

## 一次新许可集中完成的范围

1. **一次Source CreateStack**：账户402010193138 / ca-central-1；名称`techlong-sandbox-tenant-9c5ee9e64509dcad`，准确前任`.../f71252c0-c917-11f1-8148-02ff648cb917`已删除。创建全新UUID，不Update旧栈，不删除其它资源。仍七资源：log group、task definition、target group、三条listener rule、ECS service。1副本、512CPU/1024MiB、标准Fargate/公网IPv4，复用现有Cell/ALB/网络、CFN/task/execution角色、固定Secret版本及DNS。镜像仍`sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，不重建/发布、部署lifecycle镜像或创建Cell/库/IAM。
2. **三个固定无认证公网GET**：仅`first-acceptance.sandbox.techlong.cloud:443`，依次`/health`→200/ok、`/ready`→200/ready、`/api/merchant/stores`→401/准确Invalid signature。固定公开store header，TLS/SNI/主机验证开启，不带HMAC/JWT/Cookie/设备ID、不follow redirect、不登录/签token/派生密码或provision。每次10秒、body4096字节、共45秒；逐次exclusive intent，最多各一次，失败即停。复用的是K3a固定GET传输代码，**不是复用过期K3a runner/许可/槽**。
3. **一次Neon SERIALIZABLE事务、五固定语句、只改一条现有deployment的outputs及updated_at**：准确`dep_7c99bd249470184852f0dc74`仍ready；把实际stackId/observation指向新承载，新增`workloadRestorationV1` receipt并完整嵌套保留前outputs。原`manualReadyReconciliationV1`保持，instance active、job succeeded及其attempt1/max1、清空lease、原计划/错误/幂等键、generation1/epoch1/authority均不改。不创建job/业务行，不续租或再次初始化。九条关联行整行摘要/CAS及行锁、DB endpoint/身份/OID/版本/时区、原receipt、catalog摘要、环境/订阅及DB时钟门禁；修改后仅扣除deployment outputs/updated_at，九条其它内容全部必须不变。新承载与公网证明距事务分别最多30秒，不重新标记旧证明时间。
4. **新进程Inspect只读验收**：重新核对AWS承载与Neon回执/九行不变量/原输出及catalog，不追加应用请求或私密加载，不写任何记录。它需要准确新execution binding、write intent、program及三GET证明；没有这些完整证据时只能保存现有结果、另做只读诊断，不自动补齐Create/HTTP/SQL。

没有操作器GetSecretValue/私密包/直连Aurora、应用POST、IAM/DNS/DDB或数据库schema/权限写。任务启动仍由既有执行角色注入固定Secrets，应用readiness/store-context会正常使用Aurora；**不是全系统零Secret使用/零数据库活动**。仅保存脱敏响应验证、公开TLS信息与摘要，不存HTTP正文/headers、凭据、token、原始异常或原私密包。

## 审批24小时，但资源两小时从实际执行算

清单有效期为Review生成后24小时，实际执行前必须重新完整只读核对当前资源、IAM/固定Secret元数据、ECR/扫描、DNS/DDB/Janitor及精确旧Neon九行/catalog；任何差异停止，不自动采用新前态。

清单明确批准**确定性相对时间规则**，不是提前绑定一个很快过期的ExpiresAt：Run通过新前置检查后，唯一生成`startedAt`；新workload `ExpiresAt=startedAt+7200秒`，与现有两小时环境policy相符。只允许把模板与stack中固定ExpiresAt占位符替换为这个值，并添加受审恢复metadata、由manifest/start/request派生ClientRequestToken，其余20参数/角色/镜像/资源配置保持。准确request/body/hash、ISO到期、startedAt与execution hash先exclusive落盘并fsync，再消费固定根槽；一经固定不随等待、创建、失败或重试移动，不延长TTL。不是更新原已删除对象的到期，也不改变父Cell旧tag/环境policy/调度。

CreateStack仍OnFailure=ROLLBACK、TimeoutInMinutes=25；最多30分钟/122次只读状态轮询，15秒间隔。Run/Inspect严格在新到期前5分钟完成，各元数据组180秒，各AWS请求30秒，SQL30秒（server statement15秒/lock5秒）。若审批迟到或当前前态变化，不创建资源；不能绕过新SHA或固定槽。旧Janitor保持启用/原code/rate15分钟，可删除到期新workload，但不保证及时、必然或覆盖全部费用。

## 必须接受的完整风险

- **真实收费创建/保留数据**：CFN会登记新task definition、创建service/task/ENI/日志/规则等；新UUID不可预知，必须由真实响应、模板/参数/tags、根CREATE_COMPLETE事件及准确ClientRequestToken、7资源、实际task digest/spec/target health绑定，不能捏造或沿用前任UUID。DB已有初始化数据保留，不恢复/seed/迁移、不重做provision；readiness/未签名401不等于商户登录/订单/付款或浏览器UI/CORS验收。
- **动态期限与不可原子**：明确接受上述相对时间派生，不把manifest中占位符直接当AWS请求，也不任意刷新日期。AWS、Neon、HTTP、文件系统无跨服务CAS；即使九行锁、Serializable、catalog及30秒窗口，也可能并发改权限/函数/DDL/服务、Janitor删除或资料变化。行锁短暂阻塞，死锁/序列化失败不重试。
- **部分成功/UNKNOWN**：CFN可能创建后响应丢失，或自动ROLLBACK/失败遗留收费资源；HTTP可能到达但回执丢失；Neon可能提交但本地/网络/后验失败。恢复承载可能成功但平台仍引用旧stack，或公开检查通过但一行rebind未完成；不能冒充全成功。脚本不再Create、重发GET/SQL、Delete/rollback/down、补齐或补偿。CFN提供者自身既定ROLLBACK可能删除新资源，这与操作器额外删除不同。独立Inspect可能因缺证据/漂移/到期不能完成，保留结果后需新范围处理。
- **身份与私密/提供者日志**：Source AWS Login自动刷新也可能失效；不改profile/权限/Trust来继续。操作器不读Secret值，但新任务/已有角色仍可读取固定版本，数据面沿用持久DB访问；应用启动、只读GET、ALB健康检查、日志/指标可能产生数据库/网络副作用与暴露。原始响应只在内存，不保证缓冲/JS字符串或provider日志物理擦除。Neon URL只交其提供者，不打印。
- **证明的准确含义**：新AWS运行镜像/承载和新公开readiness/401为当前检查；有效配置/准确store/owner由K2b/K2c历史认证证明保留，**没有新的mTLS/JWT控制配置读取或owner行回读**。不得把该历史证明冒充本轮重新认证的有效配置，也不证明无人值守申请→部署、失败补偿和全系统清理已全部验收。
- **三个新永久槽**：`F:/ChatGPT_workshop/techlong-express-k3r-hosting-resume-v1.permanent-slot.json`、同prefix `.write-slot.json`、`.inspect-slot.json`。根在Create前、write在唯一SQL前、Inspect在独立网络前exclusive+fsync；落盘后再次检查时间/事实。槽消费即使尚未实际调用/部分文件/网络失败也不自动删除、复位、换manifest绕过、恢复Run/Inspect或重试；旧槽保留。若Create结果不明且未到SQL，Inspect所需program可能不存在，只能停止另审只读核对，不自动补造证据或承诺自动恢复。
- **调用范围/费用非cap**：正常Run前+Run新承载+独立Inspect三组，每组最多45 SDK/20 CLI/一个Neon只读平台SELECT；另Run前、rebind前/后、独立Inspect各一个三语句只读状态事务。外加最多122个CFN只读轮询、一次CreateStack、一次五语句Neon写事务、三个公开GET。Review另只读组/三语句事务，不算执行。提供者凭据刷新/底层调度和正常应用活动不计为已逐项遥测。

## 费用背景，不是总价保证

2026-10-16读取[AWS加拿大ECS公开目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ca-central-1/index.json)：Linux/x86 vCPU为0.04456 USD/h、内存0.004865 USD/GB-h。单task 0.5vCPU/1GiB持续2小时约0.05429 USD；另一个公网IPv4按[AWS VPC费率](https://aws.amazon.com/vpc/pricing/)0.005 USD/h约0.01 USD，合计**约0.0643 USD增量task计算+单任务IPv4**。不含既有Cell/ALB/IP/Aurora/Secrets/ECR、日志/流量/存储、额外调度/删除滞后、税费；不是本次或本月完整费用上限。Fargate按实际运行与下载时间计费且有最低粒度，见[官方计费](https://aws.amazon.com/fargate/pricing/)。

两小时tag不保证任务准时停止或账单归零；父Cell/数据库等仍可能收费，50 USD/月只是目标非硬cap。不升级AWS plan、不修改Budget、IAM/Secret、TTL调度或默认开启新监控。实际后续删除/收费续用/状态退出另审，不扩展F3c9/Grant支线。
