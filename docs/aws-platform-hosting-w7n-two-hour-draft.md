# W7n：两小时 HTTPS 承载草案（禁止按access批准执行）

目标仅首轮平台Web验收：既有管理员登录、overview及实例只读页面。后端tenant、餐厅客户端、平台部署controller和写业务功能不在这次承载范围；这不是整套系统所有功能完成上线。无需本地Docker，不再构建镜像，不使用Sites。

## 固定11项资源

未来独立栈 `techlong-sandbox-platform-hosting-v1` 草案包含：task安全组、ALB安全组、独立task入站规则、7天保留日志组、ECS cluster、internet-facing ALB、IP target group、HTTPS443 listener、Fargate task definition、desiredCount=1 service、console域名A alias。无IAM、Secret、数据库、VPC/subnet/路由/NAT创建，不改现有网络。使用现存VPC两个AZ的公网子网与既有wildcard证书/Route53 zone。

- `https://console.sandbox.techlong.cloud`；只开放443，不创建80 listener。TLS1.2/1.3既有标准policy，ALB到task为VPC内HTTP3000。
- ALB入站公网IPv4:443，出站仅task安全组:3000。task仅允许ALB安全组入站3000，出站公网TCP443供Neon HTTP/ECR/Secrets/日志通信；不是域名级出站隔离。
- task 0.5 vCPU / 1GiB，Fargate Linux1.4.0/X86_64，单副本，public IP用于出站，不创建NAT。旧GHA smoke用1GiB，CPU限制不等于云端性能保证。
- 固定既有镜像manifest `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612`，不是tag/config digest；ECR仓库仅引用，不改发布角色或重新push。
- 只用独立execution role取准确Secret JSON key `databaseUrl`及UUID `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f`，注入DATABASE_URL。**不分配application task role**，无AWS访问凭据、私钥或Stripe密钥注入。
- 非root UID1000、drop ALL capabilities、禁ECS Exec；保留可写临时根文件系统用于现有镜像兼容，不宣称只读容器。Fargate不支持旧Docker smoke的tmpfs参数，因此不盲目复制只读+tmpfs组合，也不加root init容器或重建镜像。
- controller/request/worker/apply及本地授权lease保持closed；AUTH_SESSION_DAYS=1。健康检查只读/api/health，不查询DB；真实管理员登录需后续明确验收，会产生正常session/失败计数等授权内数据库写。
- circuit breaker启用、rollback=false，maximumPercent100/minimumHealthyPercent0；可中断服务。desiredCount1不是总任务启动次数上限，ECS会按健康/调度自动替换任务、重复拉取镜像与Secret，可能增加请求、IP和日志费用。

## 两小时与费用

模板仅有 `HostingExpiresAt` 参数，由未来已批准CreateStack启动时计算+2小时，避免在准备/人工审批期间提前耗尽窗口；本阶段不确定实际启动时间。资源上该参数只是标签/输出，**不会自动停止、删除或撤权**。若未及时另批清理，服务/ALB/公网IP/日志可能持续收费，IAM/Secret/LOGIN也不会自动失效。

准备程序从AWS区域公开价目表读取ca-central-1的现行SKU，绑定原文hash、发布日期及费率。按既有同价快照示意，单task+ALB+3个公网IPv4+平均0.1LCU的2小时变量费约0.13555USD；实际新清单以fresh价目表为准。该数值不含既有资源、ECR、日志、流量、额外容量/IP、任务重启、创建清理时间、税费等，不是单次上限。全天常驻核心示意约49.88USD/月，仍未含上述成本，因此沿用先2小时验收、部署/清理分审的方向。50USD/月预算只告警，不是停止器。[AWS Fargate](https://aws.amazon.com/fargate/pricing/)、[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/)、[公网IPv4](https://aws.amazon.com/vpc/pricing/)

## 后续执行清单仍须绑定

1. access栈真实RoleId/BoundaryId、准确策略、固定Secret UUID及资源策略handoff成功证据。
2. 新栈/cluster/ALB/TG/log/DNS名称仍空闲，镜像digest存在；旧资源不接管。
3. VPC有效路由（含main隐式关联及不存在其他显式覆盖）、两个AZ/可用IP、IGW、DNS属性、默认NACL、证书ISSUED且有效、A/AAAA/CNAME未占用。新资源创建非跨服务CAS，检查后仍有竞态。
4. 既有ECS/ELB service-linked roles存在，避免意外自动创建额外IAM；不凭历史快照认定当前状态。
5. fresh批准的创建范围、20分钟启动余量/观察上限、两小时意图及明确独立验收/清理方案。当前仅有草案和ValidateTemplate，不是可执行部署批准。

公网ALB/DNS/登录页面会被扫描与攻击；应用仍可能有漏洞，既有镜像安全扫描只是历史快照。Secret环境变量可被容器进程或日志暴露，角色认证通过不等于真实平台登录通过。必须独立验收TLS、路由/host/Origin/Secure Cookie、健康服务、管理员登录及只读实例页面后才能宣告首轮上线；不因CFN成功就宣告业务通过。[ECS Secret注入](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
