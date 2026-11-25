# SaaS 数据库迁移与 ECS 开通私网改造

**变更草案 · 2026-11-24（温尼伯）**

将现有 Aurora PostgreSQL 租户库与 SaaS 的 Neon 控制库分别迁移到 **Amazon RDS for PostgreSQL**。两套数据库通过私网访问。下一轮 T4 按私网方案准备安装差异。待数据切换和开通任务的全部连接验证通过后，退役开通专用的公网出口及相关配置。迁移、切换及资源退役按各自的准确范围审批。 [现有首开方案](saas-first-open-ecs-migration-plan.md) · [执行手册](aws-auto-deployment-execution-runbook.md)

## 1. 迁移两套 PostgreSQL 数据库

| 迁移对象 | 目标与改动 | 数据核验 |
|---|---|---|
| **租户业务库** | 现有 Aurora PostgreSQL → RDS for PostgreSQL。租户 API 和开通程序改用获准的 RDS 端点。重新绑定数据库归属、租户角色、开通管理权限和首版初始化。 | 逐租户核对数据库及角色归属、业务记录、序列、扩展和架构版本。用现有租户验证业务读取，用隔离租户验证新建、基线恢复、迁移和 API 就绪。 |
| **SaaS 控制库** | 现有 Neon → RDS for PostgreSQL。Web、使用控制库的调度组件和开通程序通过 PostgreSQL TLS 连接访问控制库，复用既有 SQL 和事务边界。将 Neon HTTPS SQL 适配换成原生 PostgreSQL 连接，重新验证连接池、参数类型和批量事务行为。 | 对账订单和支付事件、租户与实例映射、审批、待执行任务、租约、日志及开通结果。核验重复审批和支付回调去重、单次领取、失败回滚及独立回读。 |

两套库分别核对源版本、目标版本、扩展、编码、排序规则和实际数据范围。现有 Sandbox Aurora Express 记录为 PostgreSQL **17.9**，执行手册的正式上线版本目标为 **16.14**。涉及现有 17.9 数据时，可先在同主版本的 RDS 目标上验证迁移。如果数据最终需要进入 16.14，则单独验证降主版本的数据与架构迁移。`pg_dump` 向更早主版本恢复没有兼容保证。 [项目版本约束](aws-auto-deployment-execution-runbook.md#production-postgresql-version) · [PostgreSQL 导出兼容性](https://www.postgresql.org/docs/17/app-pgdump.html)

分别演练逻辑导出和恢复，测量停写时长，并核对备份可恢复。按目标 RDS 能力重建所需的角色、所有权、授权和扩展。数据库角色按 SaaS Web、租户 API、开通程序、迁移管理和只读核验各自的用途分配。连接时验证 RDS CA 与端点主机名。采用 IAM 数据库认证时，用目标 RDS 实例的资源 ID 和数据库用户名重绑 `rds-db:connect`，并用实际角色验证权限。 [RDS 数据导入](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Procedural.Importing.html) · [RDS PostgreSQL TLS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.SSL.html) · [IAM 数据库权限](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.IAMDBAuth.IAMPolicy.html)

## 2. 设计开通任务的私网访问

两套 RDS 均使用私有子网并关闭公开访问。控制库优先布置在平台 VPC，租户库优先布置在租户 API 所在的 Cell VPC。开通任务继续使用私有子网，关闭公网 IP，安全组入站留空，出站只允许下表中实际需要的目的地。若任务需要跨 VPC，优先复用已验证的私网连接。采用 VPC 对等连接时，先确认 CIDR 无重叠，再限定双向路由、DNS 和安全组范围。实例规格、实例数量及可用区配置在 T4 费用与隔离评审中确定。 [RDS 私网接入](https://docs.aws.amazon.com/AmazonRDS/latest/gettingstartedguide/security-public-private.html) · [VPC 对等连接的限制](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-basics.html) · [跨 VPC 安全组引用](https://docs.aws.amazon.com/vpc/latest/peering/vpc-peering-security-groups.html)

| 连接 | 私网路径与验收 |
|---|---|
| **控制库和租户库 `5432`** | 连接经过验证的 RDS 私有端点，数据库安全组只允许对应工作负载访问。核对目标实例、数据库名、数据库角色和 TLS，证明控制库与租户库的权限相互隔离。 |
| **镜像和日志 `443`** | Fargate 从 ECR 拉取固定镜像摘要。通过 ECR API、ECR DKR 和 S3 网关端点拉取镜像层，通过 CloudWatch Logs 接口端点写日志。核对端点策略是否允许所需仓库和镜像层。 [ECR 私网拉取](https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html) |
| **基线、证据和 AWS API `443`** | 用 S3 网关端点读取本区域的固定版本基线和证据。按最终运行适配器的实际调用清单复用或增补 CloudFormation、区域 STS、Secrets Manager、RDS、ECS 等接口端点。按资源和 API 操作限制 IAM 与受支持的端点策略，并从开通任务实际位置验证。 [S3 网关端点](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html) · [CloudFormation 私网端点](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/vpc-interface-endpoints.html) · [AWS PrivateLink 服务清单](https://docs.aws.amazon.com/vpc/latest/privatelink/aws-services-privatelink-support.html) |
| **Route 53 自检 `443`** | 保留对目标租户 DNS 记录的只读核验。在加拿大中部区评估 Route 53 跨区域接口端点 `com.amazonaws.route53`，验证私有 DNS、TLS 与准确 hosted zone 的读取。 [Route 53 私网 API](https://aws.amazon.com/about-aws/whats-new/2025/11/amazon-route-53-dns-service-aws-privatelink/) |
| **租户 API `443` 和 mTLS `8443`** | 验证健康检查和配置下发能走 Cell 的私网入口。现有监听器若只通过公网可达，先定稿可复用的内部入口或必要的内部负载均衡差异。实际验证主机名、证书、客户端身份和实例归属。客户使用的公开业务入口单独核验。 [负载均衡公网与私网地址](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html#load-balancer-scheme) |

任务子网采用明确的私网路由和服务端点路由，移除通向公网的默认路由。保留 TLS 和 mTLS 核验、拒绝未获准目的地及 GitHub 阻断要求。SaaS Web 的 Stripe 和客户入口继续按 Web 的网络边界管理。 [现有出站和 Web 边界](saas-first-open-ecs-migration-plan.md)

## 3. 退役开通任务专用的公网配置

原 T4 公网候选已撤下。旧 NAT 与防火墙差异可从仓库历史提交 `f79dd080` 查阅，新 T4 候选按下表准备。

| 处理项 | 审定条件 |
|---|---|
| **开通专用 NAT、EIP 和默认路由** | 从安装差异排除 `FirstOpenZonalNat`、`FirstOpenEgressAddress` 以及把 `0.0.0.0/0` 导向 NAT 或防火墙的 `FirstOpenDefaultRoute`。专用 NAT 子网、路由表、关联和回程路由按实际依赖一并剔除。 |
| **只用于公网出站的防火墙配置** | 排除只服务该公网路径的 Network Firewall、端点、专用子网、路由及 Resolver DNS Firewall 关联。通过任务路由、安全组和端点策略维持最小访问。共享 Web 或 Cell 资源按各自归属与依赖审定。 |
| **旧数据库和控制入口规则** | 随对应数据库切换撤下开通路径上的 Neon HTTPS 和 Express 公网 writer 放行，换成两个 RDS 私有目的地。私网 mTLS 通过并确认无其他用方后，退役仅供开通的公网控制入口与放行。 |

上述配置在安装候选里按模板差异剔除。若实际核对发现已有专用资源，先确认无其他消费者，再按原 CloudFormation 栈审批退役。收尾核对 NAT 已删除、EIP 已释放、无旧路由指向已删除的目标。费用评审对比原公网候选和新方案的 RDS、备份、接口端点、跨区域或跨可用区传输及可能的内部入口费用。 [NAT 删除和 EIP 释放](https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-working-with.html) · [PrivateLink 计费](https://aws.amazon.com/privatelink/pricing/)

## 4. 切换顺序和验收

1. **确认目标和演练恢复。** 定稿两套源库与目标实例、版本、网络位置、授权范围、数据核对项和停写窗口。分别完成恢复与兼容性演练，记录可接受的停写时长和回退点。
2. **分别切换租户库和控制库。** 暂停新开通并确认在途任务状态。受影响的数据停止写入后做最后同步和对账。核对订单、审批和任务的原有标识及幂等记录，再让应用切到唯一写入目标。验证停写窗口内的 Stripe 回调可重送并按原事件 ID 去重。保留源备份及经验证的回退路径。若新库已接收写入，先停止写入、对账并处理差量，再决定是否回切。
3. **验证最终私网。** 从固定镜像冷启动单个私有 ECS 任务，验证镜像拉取、日志、两套数据库、基线读取、CloudFormation、Route 53、健康检查和 mTLS。测试同一任务网络无法连接 GitHub、未授权的公网 IP 和其他未授权目的地。T4 记录真实 AWS 连通和阻断回执，实际客户开通在 T5 另审。 [现有实施与验收顺序](saas-first-open-ecs-migration-plan.md)
4. **按范围收尾。** 核对真实任务退出、源库回退条件、旧网络配置归属和依赖，再按获批范围清理。从路由、ECS 任务详情和连接日志核对任务无公网 IP 与公网出站路径，再按账单周期核对专用 NAT、EIP 和公网防火墙的常驻费用。

