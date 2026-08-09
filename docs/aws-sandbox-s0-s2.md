# AWS Sandbox S0–S2 说明

## 本阶段状态

S0–S2 是真实 AWS 部署前的执行基础，不是一次 AWS 部署。本页包含比 S0 静态骨架创建时更晚的只读账号核验结果。本阶段只产生本地代码、数据库结构、静态 CloudFormation/IAM 文件和可审计渲染结果：

- 不调用任何写 AWS API。
- 不创建、更新或删除 AWS 资源。
- 不修改 Route 53、域名或证书。
- 不产生由本阶段操作造成的 AWS 云费用。
- `AWS_APPLY_ENABLED=false`，并且 S1 代码会无条件拒绝 Apply，不能靠改环境变量开启。

AWS CLI v2 位于 `D:\Amazon\AWSCLIV2\aws.exe`，当前终端 PATH 可能尚未刷新，可以使用绝对路径。在真实 Windows 用户上下文中已经只读验证 Profile `techlong-sandbox-user`：Region 为 `ca-central-1`，STS 返回 Account `402010193138`、ARN `arn:aws:iam::402010193138:user/techlong-sandbox-dev`。验证没有读取或输出密钥，也没有执行任何 AWS 写操作。

只读 `organizations describe-organization` 返回 `AWSOrganizationsNotInUseException`，账号当前是 standalone。SCP 当前不可用，本方案不为使用 SCP 而让账号加入 Organizations。后续权限护栏由 IAM 高风险动作显式 Deny、Permissions Boundary、窄权限 Allow Policy 和专用 AssumeRole 角色组合实现。

进入后续 S3/真实 Apply 前，建议把该 IAM User 收敛为只允许 `sts:AssumeRole` 到专用 Sandbox 角色；预检、Worker 和 CloudFormation 均使用短期角色凭据，不应给 IAM User 长期直连资源权限。

## 三阶段边界

| 阶段 | 所在位置 | 已有基础 | 当前停止点 |
| --- | --- | --- | --- |
| S0 | 本仓库 `ops/aws-sandbox/` | 固定 Sandbox 配置、Budget CloudFormation、Permissions Boundary、Deny 示例、纯本地静态检查 | 所有文件均未部署到 AWS |
| S1 | 本平台仓库 | 部署环境、状态机、持久任务/租约/重试、步骤记录、预检、CloudFormation 租户模板只渲染 | 没有 AWS SDK Apply Worker；Apply 预检硬失败 |
| S2 | 独立订单服务仓库 | 实例级控制契约、配置哈希、幂等 provision、JWT 与生产 mTLS 约束 | 平台当前不调用接口，也没有创建 mTLS/ALB 基础设施 |

架构细节见 [AWS ECS Cell 部署与执行基础](./aws-ecs-cell-deployment-demo.md)，S0 静态文件说明见 [AWS Sandbox S0 静态骨架](../ops/aws-sandbox/README.md)，订单服务契约见独立仓库的 [`SAAS_CONTROL.md`](https://github.com/veinyyxy/SpeedFeast_Backend_main/blob/main/SAAS_CONTROL.md)。

## 固定 Sandbox 基线

| 配置 | 当前基线 |
| --- | --- |
| AWS Account | `402010193138` |
| Region | `ca-central-1` |
| 账号归属 | standalone；未使用 AWS Organizations，SCP 不可用 |
| 已只读验证 Profile | `techlong-sandbox-user` |
| 账号当前既有 Budget | `My Zero-Spend Budget`，`1 USD`（只读核验，未修改） |
| S0 Guardrail 预算目标 | `10 USD`（模板尚未应用） |
| 单次部署 TTL | `7200` 秒（2 小时） |
| Janitor 目标扫描周期 | `900` 秒 |
| 最大并发 Cell / 部署 / 租户 | `1 / 1 / 1` |
| 最大租户 Task | `1` |
| Sandbox 域名边界 | `sandbox.techlong.cloud` |
| 允许的 Sandbox 档位 | `standard-v1` |
| AWS Apply | 硬禁用 |

既有 `1 USD` Zero-Spend Budget 和 S0 规划的 `10 USD` Budget 都只是告警，不是费用上限，也不会实时停止资源。S3 前必须先决定是否保留、替换或并行使用它们，避免通知语义冲突；未经明确评审不得修改既有 Budget。真正的费用硬闸必须由允许名单、最小权限、资源数量限制、先建清理任务、TTL Janitor 和人工审批共同实现。

账号类型已经通过只读查询确认，S3 前无需重复执行“确认账号类型”任务。只有账号后来被人工加入 AWS Organizations 时，才需要重新评审 SCP、Credits 和组织级治理影响；本方案不会主动进行该变更。

## 数据库边界

未来 Sandbox 唯一允许的数据库形态是最多一个 Aurora PostgreSQL Serverless v2 Cell：

- Engine：Aurora PostgreSQL 16.x。只读查询显示 `ca-central-1` 当前提供普通（非 Limitless）16.8–16.14，16.3 不在当前返回列表；配置的 `>=16.3` 只是兼容下限，实际 Apply 前必须动态选择当时可用的非 Limitless 版本并验证自动暂停能力。
- 容量：`minAcu=0`、受控 `maxAcu=1`、空闲后自动暂停。
- 隔离：每个租户一个独立 database 和一个独立 role。
- Schema：租户数据库内部继续使用订单服务现有的 `public.*`。
- 禁止：每租户独立 Cluster、额外 Reader、传统 Multi-AZ、DB Proxy、Global Database、快照恢复和预留购买。

“每租户独立 database”不等于“每租户独立 Aurora Cluster”。当前 S1 租户 CloudFormation 渲染器明确不创建数据库资源；Cell Cluster、租户 database/role 和迁移必须由后续受控步骤单独实现。

## 域名规划

| 入口 | 规划域名 | 本阶段动作 |
| --- | --- | --- |
| SaaS 管理与客户控制台 | `console.techlong.cloud` | 不创建 DNS |
| Sandbox 租户 | `{tenant}.sandbox.techlong.cloud` | 仅用于本地预检和渲染 |
| 生产租户 | `{tenant}.apps.techlong.cloud` | 不创建 DNS |
| APK/制品下载 | `downloads.techlong.cloud` | 不创建 DNS |

本阶段不委派 `sandbox.techlong.cloud`，不创建 Hosted Zone、ACM 证书或记录。只有未来明确批准 AWS Apply 后，才可把 Sandbox 子域单独委派给受控 Route 53 Zone；生产和 Sandbox 必须保持独立域名边界。

## S1 的可执行与不可执行部分

当前可以在本地执行：

- 校验环境策略、Account/Region 期望值、Cell/租户数量、部署档位和数据库约束。
- 幂等生成部署计划、任务和步骤审计记录。
- 领取/续租/重试本地数据库中的部署任务。
- 生成只渲染的 CloudFormation 租户栈 JSON，并检查 ECR digest、域名、Task 数和路由安全边界。

当前不能执行：

- 调用 CloudFormation、ECS、ELBv2、RDS、Secrets Manager、Route 53 或其他 AWS API。
- 创建 Aurora Cell 或租户 database/role。
- 推送/拉取镜像、创建 ECS Service 或等待健康检查。
- 向订单服务发送配置、创建 mTLS 通道或回写正式 URL。
- 将应用实例自动改为 `active`。

即使有人把 `AWS_APPLY_ENABLED` 改为 `true`，S1 的 Apply 预检仍会返回硬失败。这是代码边界，不是单纯配置约定。

## S2 控制契约边界

未来平台只能通过订单服务定义的控制契约配置租户：

- 使用实例级 audience、scope 和 instance claim 的非对称 JWT。
- 生产要求 mTLS，公共 ALB 监听器拒绝 `/api/saas/*`，只有受信控制监听器可转发。
- provision 使用稳定 `Idempotency-Key`，配置使用规范化 hash，重试不得重复创建租户状态。
- 平台不发送密钥、任意脚本或模板未声明字段；日志不得记录 Token、证书或初始密码。

本平台文档只是链接并约束 S2 契约。当前平台没有跨仓库调用，也不会因为 S2 文件存在而自动配置实例。

## 当前零费用与未来收费项

S0 静态测试、S1 本地状态机/数据库测试、CloudFormation 只渲染和 S2 契约测试本身不创建 AWS 账单项。将来一旦批准 Apply，下列资源即使位于“Sandbox”也可能收费：

- Aurora Serverless v2 的 ACU、存储、I/O、备份和数据传输。
- ALB 的运行时长和 LCU。
- ECS/Fargate 的 vCPU、内存、临时存储和公网 IPv4。
- ECR 存储/传输、Secrets Manager Secret、CloudWatch Logs/指标。
- Route 53 Hosted Zone/查询、ACM 以外的证书相关服务、S3/CloudFront 请求与传输。
- NAT Gateway 和 Interface VPC Endpoint 的小时费与流量费；因此当前 Sandbox 明确禁止两者。

AWS Free Tier、Credits 和 Budget 都不能证明“不会收费”。未来每次试验必须先评估价格、限制 TTL、确认清理任务，再创建资源。

## 本地验收

```powershell
npm --prefix .\ops\aws-sandbox test
npm run typecheck
npm run build
npm test
```

这些命令不需要 AWS Profile，也不应发起 AWS 网络请求。使用 Profile 的 STS 复核属于只读运维检查，不是上述本地测试的前置条件，也不能被普通测试脚本自动触发。

验收时还应确认：

1. 固定 Account、Region、预算、TTL、数量限制和域名没有漂移。
2. Apply 预检始终失败，CloudFormation 结果只存在于内存或本地测试输出。
3. 渲染模板不含 Secret 值，不创建数据库资源，不允许 NAT/VPC Endpoint，Task 数固定为 1。
4. 重复付款事件不会重复创建订阅、实例、部署或任务。
5. Git diff 中没有 Access Key、Secret Access Key、数据库 URL、Stripe Secret 或私钥。

## 进入真实 AWS 前的强制门禁

1. 将 `techlong-sandbox-user` 收敛为只允许 AssumeRole，并让专用 Execution Role 承担最小资源权限；用 STS 再次核对 Account/Region。
2. 人工审查既有 `1 USD` Zero-Spend Budget 与未部署的 `10 USD` Guardrail 模板，决定唯一告警策略后再变更并验证收件链路；不得把 Budget 当作自动断路器。
3. 实现 EventBridge Scheduler + Janitor，先成功演练创建前排程、2 小时到期和失败重试。
4. 所有资源强制标签 `Environment`、`ManagedBy`、`DeploymentId`、`AppInstanceId`、`ExpiresAt`，并限制固定 Stack 前缀。
5. 审查 Cell 层 Aurora 模板、租户 database/role 创建和订单服务 `public.*` 迁移，验证不同租户不会共用同一个 database。
6. 镜像来自同 Account/Region 的私有 ECR，并固定不可变 digest。
7. 完成 Sandbox DNS 委派、ACM、ALB 公共/控制监听器隔离和 mTLS 验证。
8. 独立 Worker 在每一步 Apply 前重新核对计划哈希、当前订阅、实例状态、Account/Region、TTL 和清理任务。
9. 完成失败注入、回滚、Janitor、资源清零、费用复盘和跨租户隔离测试。
10. 通过单独代码评审和人工批准后，才可在新的实施阶段讨论解除硬禁用；S0–S2 本身不得解除。

以上任一门禁未完成，都应保持本地渲染和管理员手工开通流程。
