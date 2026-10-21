# W7b：平台独立托管资源盘点与费用决策

2026-10-21 12:49–13:01（America/Winnipeg/CDT）的只读快照；不是原子快照，也不是部署许可。Source过期后由用户刷新，STS准确验证账户402010193138/IAM用户techlong-sandbox-dev。完成27项资源/预算/费用投影查询、一次额外Hosted Zone读取和公共DNS NS核对；无Secret值、PEM、Neon连接、IAM/资源写入或新执行槽。

## 结论

平台的Linux Node候选已经过[W7a真实镜像CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39626016929)，源码仍为f0da4df，不因新文档更改历史验收锚点。本阶段找到可供新平台考虑的持久网络、已有证书/域名委派，但**不能照搬现有Cell承载资源，也不能将新平台常驻承诺为50USD/月以内**。

盘点时建议只准备两小时受控验收路径，常驻另定全项目预算；用户后续已选择该两小时准备方向，详见[W7c方案及HTTPS接线](aws-platform-hosting-w7c-two-hour-https.md)。这不是执行许可，任何部署、权限安装和实际清理仍需具体范围/fresh SHA。没有创建可执行写入清单；下述JSON和资源事实保留原观测时间。

## 当前资源事实

| 范围 | 只读结果 | 平台方案的处理 |
| --- | --- | --- |
| 现有Cell | 一套ALB/VPC/ECS集群，CellStack为CREATE_COMPLETE，ExpiresAt=2026-10-15T16:44:56.246Z | 不复用其ALB/VPC/集群，不续期、不自动删除；它们仍在，可能继续产生费用 |
| 既有租户 | 上午验收的准确栈c0d3bbb0…已DELETE_COMPLETE，2026-10-21 10:23:39CDT删除；集群active services/running tasks/pending tasks均0 | 历史验收依然是历史事实，不代表当前常驻在线；本轮不恢复、不重跑。没有查询删除操作者或原因，不将其猜测为已证明的TTL行为 |
| 默认VPC | vpc-011dab69fff93972b；3个默认public子网、main路由表与IGW有active的0.0.0.0/0路由 | 可考虑使用其中a/b两个AZ及独立新安全组；没有复用Cell资源，不修改默认安全组/路由 |
| NAT | ca-central-1 available/pending NAT Gateway查询为空 | 首提案不新增NAT；使用public子网+任务公网IP，仅接受ALB安全组入站 |
| DNS | sandbox.techlong.cloud公共区Z01473621BTTHKXBGOOEJ；本机公共NS查询与Route53的4个NS一致；console准确记录查询为空 | 可准备console.sandbox.techlong.cloud的准确别名记录，尚未批准写入 |
| 证书 | 既有ca-central-1证书6d1f2880…为ISSUED，SAN含*.sandbox.techlong.cloud，2027-04-27T00:59:59Z到期；不在Cell栈资源列表中 | 候选复用准确证书ARN，不请求新证书/CT记录；执行前仍须fresh核对 |
| ECR/发布身份 | 现有2仓库，无platform-web仓库；旧ImagePublisher的WebIdentity trust明确Deny | 不借用或解锁旧授权；新的平台仓库及发布权限另审 |
| 平台凭据 | techlong前缀7个Secret元数据中没有计划中的platform-web/neon-v1 | 不读窄controller/worker Secret值、不把它们当平台业务数据库凭据；专用凭据来源/权限另审 |
| 客户端Web | 当前账户CloudFront分布列表为空；5个project匹配S3桶中未识别出已确认的buyer-web目标桶 | speedfeast有发布配置不等于此账户已发布；media桶不自动改作Web桶，更不执行sync --delete |
| 数据库/日志 | 已见Aurora Express集群和另一个db.t4g.micro PostgreSQL实例；仍有旧短保留日志组 | 都不是本轮的新建资源，也不删除/迁移；其常驻费不能从平台预算估算中忽略 |

选中的默认VPC子网：`subnet-023b1a81311709ed3`（ca-central-1a）、`subnet-059d0bb14c42ff523`（ca-central-1b）；IGW=`igw-0bd95cc8d2c24d5d5`，main route table=`rtb-006fb14f444eec219`。本轮只证明观测时存在合适路由，不是未来流量/容量/安全或不被他人改变的保证。

## 费用：区域准确价格，不混用美国东部示例

从AWS公开区域价格目录获取ca-central-1 x86 Linux On-Demand价格；没有调用需身份的Pricing API。完整SKU/版本/目录原文摘要见[价格快照](../ops/aws-sandbox/reviews/platform-hosting-w7b.prices.json)。假设单任务0.5vCPU/1GB、独立IPv4 ALB两个AZ、ALB2个+任务1个公网IPv4、平均0.1 LCU示例、1个Secret，使用730小时平均月：

| 项目 | 单价/假设 | USD/月 |
| --- | --- | ---: |
| Fargate CPU+内存 | 0.5×0.04456+1×0.004865 USD/小时 | 19.81585 |
| ALB基础小时 | 0.02475 USD/小时 | 18.06750 |
| 公网IPv4 | 3×0.005 USD/小时 | 10.95000 |
| ALB容量示例 | 0.1×0.0088 USD/小时 | 0.64240 |
| Secret | 1×0.40 USD/月 | 0.40000 |
| **仅上述核心合计** | **730小时** | **49.87575** |

来源：[Fargate区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ca-central-1/index.json)、[ALB区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ca-central-1/index.json)、[IPv4区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ca-central-1/index.json)、[Secrets区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ca-central-1/index.json)。目录版本/发布日期不同不代表价格可永久固定，实际执行前应再核对。

0.1LCU是示例而非保证；公网IPv4数量会受ALB规模/滚动任务影响。**31天744小时核心约50.82460USD**，还未包含旧数据库/ALB/Secret、平台ECR存储/日志/请求/流量、部署重叠、税费或客户端S3/CloudFront。不抵扣临时免费额度/credits，也不承诺完整总费用或硬上限。

两小时运行的上述小时型核心增量约0.13555USD；这不是完整验收账单。若新Secret保留一个月，再加约0.40USD，另有镜像、日志及创建/清理耗时等费用。到期标签/审批窗口不会自行删除资源，清理不执行或失败仍会继续收费；本提案不安装新的Janitor/定时授权支线。将来若选限时路径，应同时准备部署和准确清理的审阅材料，实际两项仍各自批准。

## 现有Budget不等于全项目总账单

现有预算准确金额50USD，本月ActualSpend=5.325USD、ForecastedSpend=9.288USD，但过滤器为`user:Environment$aws-sandbox`。已见部分Secret标记为`sandbox`、Aurora集群没有该Environment标签；该预算不能代表全项目，更不是硬停费。旧cost-guardrail栈仍UPDATE_ROLLBACK_COMPLETE；沿用F3c3d直接覆盖的实际50USD，旧栈apply继续冻结，不因本阶段自动复原模板中的10USD。

仅一次Cost Explorer查询覆盖2026-10-01（含）至2026-10-21（不含），按SERVICE分组，UnblendedCost/AmortizedCost，返回Estimated=true、未分页。净额约-0.0000001727USD（接近零）；没有按record type拆分原始使用费/credits/折扣/退款，不据此推断具体抵扣原因或未来免费。它与上述tag过滤、排除credits的Budget口径不同；**不能直接相加或互相替代为全项目gross费用预测**。

本轮Cost Explorer API仅1次，按官方费率预计0.01USD；没有为了追查净额再发查询。[官方API计价](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/)。若要承诺常驻，需先补齐gross成本口径和其他区域/无标签资源覆盖，而不是将未查询当作不存在。

## 最小部署准备顺序（未批准）

1. 明确限时验收或长期常驻及全项目费用目标；后者不能静默扩展原50USD目标。
2. 工程实现并测试固定HTTPS Origin、受信ALB代理头、Secure Cookie/CSRF边界。W7a目前会拒绝代理信任配置，不能直接改环境变量上线；部署/worker/payment/controller继续关闭。
3. 新独立ECR仓库`techlong-sandbox-platform-web`、准确源码/镜像digest和窄GitHub OIDC发布角色；保留旧Publisher锁定布局，不新借旧一次grant。
4. 核对平台业务数据库的最小权限角色与安全凭据供给，准备准确版本Secret及task execution role；没有这项实际检查就不提交持有owner凭据的服务。不会把该阶段混入当前只读盘点。
5. 编译`techlong-sandbox-platform-hosting-v1`的精确CloudFormation计划：独立cluster/service/log group、ALB/listener/host规则/target group、两安全组、task definition及准确DNS别名；引用上述既有网络/证书和预先审过的execution role/Secret，web task本身不授予AWS任务角色权限。不改Cell、旧租户、生产RDS、预算或旧记录。
6. 若用户选择限时，明确创建/运行/检查/清理时长与失败留存风险；部署及删除均需fresh具体批准。常驻则先核对新预算与持久运维安排。没有原始owner私密包读取、旧job重放、平台账本proof导入或hosted controller自动启用。

这些是准备工作依赖，不是本页可执行命令。当前`executionReady=false`，**没有用于批准AWS写入的新SHA**。下一代码阶段应优先完成第2项，避免先发布镜像/装IAM后再发现HTTPS缺失。

## 可追溯记录

[准备摘要](../ops/aws-sandbox/reviews/platform-hosting-w7b.prepared.json)与价格快照只含必要资源/费用元数据，不含Secret值、业务数据、源码私密包或AWS临时凭据。完整投影原件留在外部证据目录，文件摘要为`f6fa1a2dad8e65f34e258270c25c09212f2e8817774eccd6390f5b6004c1ea47`；DNS委派另经只读确认。旧证据、永久槽、客户端仓库和已验收镜像源锚点不动。本轮仅文档/数据快照提交，不需要重建已经通过的容器或重复云验收。
