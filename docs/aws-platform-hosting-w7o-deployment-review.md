# W7o：平台 Web 两小时 HTTPS 承载执行待审

本轮仅准备/测试/只读验证；**只有新的准确清单SHA和本页完整风险明确获批后，才能执行DeployReviewed**。W7n角色/Secret接线已经完成、槽位已消费，不得重放。代码提交推送、Source刷新和本页发布均不是部署批准。目标仅既有管理员登录、overview及实例只读首轮验收，非整套系统上线。

## 固定范围

账号402010193138、ca-central-1，Source为techlong-sandbox-dev准确IAM User/UserId。最多一次CreateStack，新栈 `techlong-sandbox-platform-hosting-v1`，固定11项逻辑资源：task安全组、ALB安全组、独立task入站规则、7天保留日志组、ECS cluster、internet-facing ALB、IP target group、HTTPS443 listener、Fargate task definition、desiredCount=1 service、Route53 A alias。没有Change Set、模板上传、nested stack、macro或自由模板/名称参数；不更新或接管旧栈。

承载Resources及Parameters沿用[W7n已审草案](aws-platform-hosting-w7n-two-hour-draft.md)，仅Description/Metadata绑定新阶段、nonce及真实身份，不改变11项资源规格。时间正则已直接测试可匹配ISO时间，无需修复W7n模板。

- 域名 `https://console.sandbox.techlong.cloud`，现存wildcard证书和public sandbox zone；只建443 listener，无80。公网IPv4 ALB，ALB到task为VPC内HTTP3000。task入站仅ALB SG:3000，出站公网TCP443，不是域名级出站隔离；无NAT或VPC/subnet/route变更。
- 复用两AZ既有公网子网、已安装execution角色 `TechlongSandboxPlatformWebExecutionRoleV1` / **AROAV3GNMXTZJ45S2ANZ7**，boundary **ANPAV3GNMXTZP7KMHXNYF / 默认v1**。新IAM逻辑资源及Secret策略写均0，无application TaskRole，Source不新增权限。创建前核对既有ECS/ELB service-linked role，检查不是防并发删除的CAS；服务自身内部操作不受本程序计数控制。
- 固定镜像manifest `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612`，不构建/推送；只引用固定Web Secret ARN、JSON key databaseUrl及UUID `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f`。Source/本地/CI不调用GetSecretValue、SQL或应用HTTP；**ECS执行角色按任务启动读取并向容器注入真实Secret，这是本次部署的明确效果，不是“无人读取凭据”**。[AWS说明](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- 单副本0.5vCPU/1GiB，Fargate Linux1.4.0/X86_64，非root1000/dropALL/Exec关闭，可写临时根文件系统。controller/request/worker/apply/local lease关闭，AUTH_SESSION_DAYS=1，不注入AWS/私钥/Stripe凭据。

## 清单、执行和独立观察

清单48小时，最晚启动为到期前30分钟。Prepare只读验证已安装access实际栈/RoleId/PolicyId/默认v1/原策略/准确Secret版本；核对镜像、未占用承载名称与task family、网络/有效main路由/证书/DNS、service-linked角色和50USD月预算，查询AWS公开区域价目表并ValidateTemplate。不能使用旧accessAbsent预检，也不把历史16:32结果当作当前云事实。

DeployReviewed验证准确原件SHA、源码/CI/四份产物/三份父阶段回执，要求clean main（只允许审批索引/README元数据快进）。重新做只读preflight与Source身份核对后，wx+fsync消费固定永久槽 `F:/ChatGPT_workshop/techlong-platform-hosting-deploy-v1.intent.json`；写前再核对access/Secret元数据。任一消费前检查失败，不写云或消费槽；本地nonce输出目录仍可能占用，不自动删除或重用。

最多一次顶层CreateStack，固定TemplateBody、唯一ClientRequestToken，无RoleARN/TemplateURL/IAM capabilities，DisableRollback=true，TimeoutInMinutes=20。Source使用既有权限执行固定模板；SDK应用maxAttempts=1。**这不是对CloudFormation各provider或ECS调度器的底层写/重试次数限制**，也不是权限沙箱。[CreateStack API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)

HostingExpiresAt仅在实际写前计算T0+2小时，保存create-intent及ACK，不在Prepare时提前启动。创建提交受20分钟活动窗口/清单外层期限约束；最多观察到T0+25分钟（单个在途API及最终独立读取可能稍超），间隔10秒仅只读poll。成功或失败均尝试独立元数据观察：准确栈ID、11项资源/原模板/参数、ALB及443listener/证书/target、ECS service/task definition/实际单healthy任务和镜像digest、实际安全组入出站规则、7天日志保留、DNS alias、原access身份。准备时另核镜像是单平台manifest而非索引，避免混用父子digest。成功仅为 `HOSTING_METADATA_VERIFIED_APPLICATION_ACCEPTANCE_PENDING`，不是HTTPS外部访问或管理员业务验收。

Create ACK不明、CFN失败/超时、元数据漂移或回执失败，均停止 `HOSTING_REQUIRES_REVIEW_NO_RETRY`；保留槽/资源/原件，无自动重建、补齐、删除、回滚、撤权、换槽或重放。无ACK时独立按准确栈名读状态，但不因发现栈就接管或视作成功。后续处置另审。DisableRollback不保证AWS provider内部不会补偿清理本次新对象，不删除任何旧资源。

## 必须接受的完整风险

1. **真实公开与凭据暴露。** 公网DNS/ALB/登录入口上线即可能被扫描和攻击；容器进程/环境/日志/提供者可接触真实数据库URL及密码。镜像历史扫描不是当前漏洞或应用安全保证。原Web角色包含读取口令哈希、认证计数更新、会话S/I/D、非行隔离、PUBLIC TEMP及创建者ADMIN等已接受风险，均未消除。即使本程序不发HTTP/SQL，外部请求或应用运行仍可能连接Neon、读业务数据或写认证会话/计数，不能承诺“部署绝无数据库变化”。管理员自行登录验收及更广业务操作另行明确授权，不要求聊天提供密码。
2. **非原子与竞态。** 跨CFN/IAM/Secret/ECS/DNS无CAS；预检/RoleId不能阻止核验后的删除重建或漂移。RoleARN例外、Source既有权限和托管服务权限不是镜像/任务不可变围栏，传播/容量/配额/DNS/健康检查都可能导致部分安装。可能有真实已运行任务但回执不明。CFN20分钟超时和ECS circuit breaker都不保证没有收费遗留。[ECS circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
3. **重复托管操作和费用。** desiredCount=1只限制期望并发，不限制累计任务、Secret读取、镜像拉取、日志/ENI/public IP和健康检查次数。ECS会替换失败任务，Fargate/Node可有托管补丁变化。7天日志及non-blocking1MiB缓冲可能丢日志，不能保证日志完整或全局脱敏；保留了可写临时根文件系统。无ECS Exec/应用AWS角色不等于绝对隔离。
4. **两小时不是自动停止器。** HostingExpiresAt只有参数/标签/输出，程序不会到点自动停止/删除；默认没有后台Janitor、EventBridge或新Lambda。实际部署和后续清理分审，若错过清理，ALB、任务、IP、日志/Secret/既有资源继续收费。Source刷新失败、额度中断、机器离线都可能延误观察/清理。角色、Secret及Neon LOGIN不会随hosting窗口到期失效。
5. **预算不是上限。** fresh区域公开价目表示例按0.5CPU/1GiB/ALB/平均0.1LCU/3公网IPv4计算；此前2小时变量费约0.13555USD、730小时核心加Secret约49.87575USD。排除既有资源、ECR/扫描、日志、流量、额外容量/IP、重启重叠、创建清理时间及税费，不承诺单次或每月硬上限。50USD/月只是目标与告警，不能保证绝对不超支。
6. **永久尝试与人工边界。** 槽一经占用不复位/重试；失败可留下收费资源和有效权限，不能自动回滚/down。Source自动刷新可能失败；成功也不代表清理完成或完整系统上线。不启动旧F3c9/租户/失败publisher支线，不升级计划、不改账单/Namecheap，不借本批准扩展功能。

部署后再准备独立公网HTTPS、Host/Origin/Secure Cookie、既有管理员登录及overview/实例页面验收；完成或受阻后准备准确已建栈的清理清单，清理另审。本轮不生成管理员密码、不创建付款/账号或更改业务记录。
