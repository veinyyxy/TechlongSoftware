# C5k：原租户 workload 单次恢复——准确范围与完整风险 v1

本文件绑定未来清单 SHA；准备清单不等于执行授权。目标仅为重新提供同一租户的容器承载，**不是重试初始化、接管任务或证明平台 ready**。旧 C5h/C5i/C5j 批准及永久槽均不复用。

## K1 唯一可批准写入

仅 Source 对 `ca-central-1 / 402010193138` 提交一次 `CreateStack`，名称 `techlong-sandbox-tenant-9c5ee9e64509dcad`，得到**全新的 UUID**。准确前任为已删除的 `.../863828e0-c8d6-11f1-bd9d-06fff5ad0437`，不是对它 UpdateStack，也不删除历史记录。复用现有 CFN execution role（原RoleId/原v8边界）、task/execution roles（原v4共享boundary）、Cell/网络/ALB/listeners、Aurora17.9、固定Secret版本及DNS。

新栈仍只有七项：LogGroup、TaskDefinition、TargetGroup、三条ListenerRule、ECS Service。服务1副本、512 CPU/1024 MiB、标准Fargate/public IPv4；登记新的 task definition、task/ENI/日志流。镜像严格固定C5i的app digest `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，config digest `sha256:74d083066dd15c62e006cf9ad7154f1a2727e693fae4a47bffc0af0b109c63dd`。不再次构建或发布，不部署lifecycle镜像。

模板以原受审七资源模板为基础，只改：`APP_IMAGE_REVISION`及`ImageUri`为上述digest；stack和四项有tags资源的ExpiresAt；Metadata注明准确前任、原平台plan、旧Janitor实际启用、平台未rebind及禁止provision重试，并纠正旧AutomaticCleanupInstalled=false。其余资源/参数/私密引用/安全组/监听优先级/数据库绑定/期望配置hash不变。

CreateStack要显式重新提交20项参数（不是Update的UsePreviousValue）；其中原Stripe publishable key及NoEcho的Secret引用仅在本地F目录清单中保留，不提交Git、不输出值。**没有Secret值或原私密包读取。** CFN使用既有role，限制五种ResourceTypes，无IAM资源/macro/nested stack。`OnFailure=ROLLBACK`，`TimeoutInMinutes=25`；无DisableRollback同时指定。[AWS CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)。

## 清理窗口：不改旧Janitor，不扩展清理支线

清单生成后两小时内才可提交；新workload固定ExpiresAt为生成后八小时，因此提交时至少剩六小时。**只有新workload获批使用这一独立窗口**；父Cell旧tag、旧job租约、订阅及环境TTL policy均不更新。这不是关闭安全网、修改全局清理器或无限延期。

现有环境policy仍是 `ttlSeconds=7200`（两小时）；本次八小时是需要在新SHA中**明确批准的单次人工承载恢复例外**，不是通用Worker已经允许的时长，不改policy，也不作为后续自动部署可突破TTL的先例。未接受这一例外就不能执行本清单，应另准备更短窗口。

旧 `global-expired-stack-scan` 保持ENABLED / rate(15 minutes)，目标仍原Janitor CodeSha；预检必须确认。它可以在新ExpiresAt到达后扫描并删除新workload，包括日志，不能保证即时或必然删除/停费，也不能保证人工/额度中断后服务仍在。不得自动续期、改变tag来绕开清理器，或重新创建被删对象。本清单耗尽/失败/过期需只读核对，新动作另审。

## 平台协调：本步骤只保留，不“修复”原job

原deployment `dep_7c99bd249470184852f0dc74` configuring / instance pending、job `job_202c8dc12a8bf379f3a7c693` running(attempt1/max1、lease已过期)必须原样保留。原desired_plan、plan_hash、artifact_ref和outputs也不改；generation1/owner、legacy epoch1/revision1 active provision原记录必须保持，aurora-v2 namespace必须经当前SDK强一致读取缺失。不得伪装新镜像已完成原计划或只换artifact_ref而不协调plan hash。

本次独立Source批准只授权恢复承载，不借用过期lease。预检要求environment.apply_enabled=0、无额外部署/job、订阅仍有效、准确配置/owner/resource/epoch吻合；不创建新job，不清理/续租旧lease，不改attempts/原永久槽，不转移owner或假增数据库generation/epoch，不调用通用Worker。本次完成只能记为“恢复服务且bootstrap healthy，平台仍pending”。

**K2另审，不在本清单中：**先通过受审只读应用/SQL核验上次HTTP500之后是否已初始化。已初始化只reconcile，不POST；未初始化才可准备新的单次POST批准。随后为原job/desired_plan/artifact/新stack identity设计带准确旧值和DB时钟检查的SERIALIZABLE/CAS协调事务，保留旧计划及失败证据，再以独立initialized/effective config/image/health/DNS证明完成平台ready。K1不预先承诺具体lease接管或数据库事务，不绕过现有触发器。

## 必须接受的完整风险

1. 新栈/任务是真实收费资源。CFN单次API内部会进行多项创建；成功返回仅开始，轮询完成及新UUID/token、七资源、实际任务digest/spec/目标健康/DNS和平台原状独立回读才算K1完成。创建与ECS调度可能失败/响应丢失；部分资源或回滚失败会遗留。CFN/ECS提供者自动rollback可能删除新资源，但脚本不另调删除/回滚/补齐。
2. 读集合不是跨AWS/Neon的CAS。旧lease过期/apply_enabled=0、物理ID、IAM/trust/完整policy、DDB强读/无碰撞检查均不能完全防止特权并发创建、改权限/角色/网络/记录；同名资源碰撞时只停止，不删除占用对象。NoEcho引用不等于验证Secret内容。
3. 操作器不读Secret值、不连Aurora、不调用应用；新task仍用原执行角色注入五项固定Secret版本，并保留原数据库权限。启动/健康检查可能触发正常应用数据库连接/活动，重启可能唤醒Aurora。提供者/容器/日志有凭据与元数据暴露风险；不可宣称全系统零Secret读取或零数据库连接。
4. 新独立永久槽为 `F:/ChatGPT_workshop/techlong-express-c5k-workload-recovery-v1.permanent-slot.json`，写前独占创建+fsync；换SHA/目录不复位。一旦消费，不论提交拒绝/响应丢失/文件故障均不自动重试、复位、回滚、补齐、删除或重建。显式SDK/CLI maxAttempts=1；令牌只用于提供者幂等/事件归因，不授予重试。Inspect只读且不要求入场窗口仍有效，不做恢复写入。
5. 读取最多45项SDK、20条CLI、一次Neon单SELECT只读事务/每组；整组最多180秒，写距完成30秒内。Run最多30分钟只读轮询，再执行回读；随后必须新进程Inspect。Source AWS Login自动刷新依赖当前会话，刷新失败/传播延迟会停止；不能以CLI身份成功代替所有SDK成功。
6. 50USD/月是目标，非费用cap。2026-10-16读取AWS公开ca-central-1 Linux/x86目录，vCPU $0.04456/h、内存 $0.004865/GB-h；本task 0.5vCPU/1GiB，8小时约$0.21716，加单公网IPv4 $0.005/h约$0.04，合计约**$0.26增量计算+task IPv4**。不含既有Cell/ALB/公网IP/Aurora/存储/Secrets/ECR、流量/日志、可能额外任务/重试调度、税费。不是本次/全月总价或保证，旧资源会继续计费。[AWS ECS加拿大公开目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ca-central-1/index.json)、[Fargate计费说明](https://aws.amazon.com/fargate/pricing/)、[公网IPv4费率](https://aws.amazon.com/vpc/pricing/)。
7. 上次provision HTTP500的业务回滚尚未证明，K1不重复POST、不连接业务库、不读取私密控制材料，不迁移/restore/seed，不改数据库/Secret/IAM/DDB/DNS/定时器。新健康任务不等于initialized、平台ready或端到端自动部署成功；过期清理也不等于平台或数据库资源已应标destroyed。

## 执行审批要求

Review只生成待审材料。必须明确确认最终**manifest SHA、一次新CreateStack/七资源/独立8小时新workload窗口、保留旧平台记录与启用Janitor、上述完整风险**后，才可Run。准备清单、代码提交/推送授权不构成执行批准。实际新UUID仅由AWS返回，不预造；旧记录、失败目录、旧槽全部保留。

本风险文件不回填执行结果；执行与独立回读另存。F3c9及旧Grant/restore/seed支线继续封存。
