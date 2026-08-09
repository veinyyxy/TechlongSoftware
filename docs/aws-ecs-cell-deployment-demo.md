# AWS ECS Cell 部署与执行基础（S0–S2）

## 当前结论

本阶段已经从“只保存一份资源计划”推进到可审计的部署执行基础，但仍然没有真实 AWS Apply 能力：

- S0 提供静态配置、预算模板、IAM 权限边界和高风险动作 Deny 示例。
- S1 提供部署环境、状态机、持久任务、租约/重试、步骤记录、预检和 CloudFormation 租户模板渲染。
- S2 在独立的订单服务仓库定义实例控制契约、幂等配置和生产 mTLS 边界。
- `AWS_APPLY_ENABLED=false` 必须保持不变；S1 还会在代码中硬拒绝 Apply，不能靠修改环境变量绕过。

当前代码不会调用 AWS API，不会创建 ECS、ALB、Aurora、S3、CloudFront、VPC、Secret、日志或 DNS 资源，也不会因本阶段的本地验证产生 AWS 云费用。AWS CLI v2 已位于 `D:\Amazon\AWSCLIV2\aws.exe`，当前 PATH 可能尚未刷新；真实 Windows 用户上下文已只读验证 Profile `techlong-sandbox-user`、Account `402010193138`、Region `ca-central-1` 和 IAM User ARN，未读取或输出密钥，也未执行 AWS 写操作。

详细的阶段清单与未来启用门禁见 [AWS Sandbox S0–S2 说明](./aws-sandbox-s0-s2.md)。

## 购买到部署任务的当前链路

```text
管理员维护共享 Plan 和已发布模板版本
→ 企业 Owner 选择 Plan 并填写允许的客户参数
→ 服务端根据数据库中的价格创建 Stripe Checkout
→ Stripe 签名验证通过的 Webhook 确认付款
→ 创建或续期 Subscription
→ 创建或复用 pending App Instance
→ 幂等保存 app_instance_deployments 目标计划
→ 同事务准备唯一 deployment_jobs apply 任务
→ 停止：当前没有会领取任务并调用 AWS 的 Worker
```

Plan 是平台维护的共享商品定义，不会因客户购买而复制。购买订单会固定套餐、模板配置和部署档位快照；部署计划再使用稳定数据库标识生成幂等键。`pending` 应用实例表示“等待开通”，`planned` 部署表示“目标已记录”，`pending` 部署任务只表示“可被未来 Worker 领取”，三者都不表示任何 AWS 资源已经存在。

## S0：固定 Sandbox 护栏

当前静态基线为：

| 项目 | 固定值或限制 |
| --- | --- |
| AWS Account | `402010193138` |
| Region | `ca-central-1` |
| 账号归属 | standalone；当前未使用 AWS Organizations |
| 月预算 | `10 USD` |
| 单次部署 TTL | `7200` 秒（2 小时） |
| 最大并发 Cell | `1` |
| 最大并发租户 | `1` |
| Sandbox 域名 | `sandbox.techlong.cloud` |
| AWS Apply | 禁用 |

表中的 `10 USD` 是 S0 Guardrail 模板目标，该模板尚未部署。账号当前只读核验到一个既有的 `My Zero-Spend Budget`，Limit 为 `1 USD`，本阶段没有修改它。任何 Budget 都只是有延迟的告警，不是实时断路器；未来真实部署前必须先有可用的 TTL Janitor 和一次性清理任务，并在创建任何收费资源前确认清理计划已建立。S0 文件只供静态审查，模板和策略尚未部署到 AWS。

只读 Organizations 查询返回 `AWSOrganizationsNotInUseException`，账号类型已经确认为 standalone。SCP 当前不可用，也不应为了本 Sandbox 方案加入 Organizations。高风险动作 Deny 示例应作为 IAM Policy 使用，并与 Permissions Boundary、窄权限 Allow Policy 和专用 AssumeRole 角色共同生效；Boundary 限制最大权限，但自身不授予资源权限。除非账号归属后来被人工改变，S3 无需再次确认账号类型。

## 目标 Cell 架构

### 共享平台层

- 一套 CloudFront + S3 承载买家端 Web。
- 一套 SaaS 控制平面负责身份、套餐、购买、付款、租户配置和部署编排。

### 每个 Cell 共享

- 一个 ALB。
- 一个 Aurora PostgreSQL Serverless v2 集群。
- 一组 VPC 与子网。Sandbox 禁止 NAT Gateway 和 Interface VPC Endpoint，除非未来经过单独成本评审并修改护栏。

当前 Sandbox 最多只允许一个 Cell。该 Cell 的数据库目标固定为 Aurora PostgreSQL Serverless v2，`minAcu=0`、受控 `maxAcu=1`，允许空闲自动暂停；不允许 DB Proxy、Global Database、快照恢复、预留购买、额外 Reader 或传统 Multi-AZ 数据库。只读查询显示 `ca-central-1` 当前提供普通（非 Limitless）Aurora PostgreSQL 16.8–16.14，16.3 不在当前返回列表；配置中的 `>=16.3` 是兼容下限而非固定创建版本，后续 S3 必须动态核对并选择当时可用的非 Limitless 16.x。

### 每个租户独立

- 一个 ECS Service、一个 Target Group 和对应 Listener Rule。
- Aurora Cell 内一个独立 database 和一个独立 role。
- 一个 Secret 引用；任何 Secret 值都不得进入计划、模板日志或审计记录。
- 独立日志命名空间和成本标签。

订单服务当前大量访问 `public.*`。因此隔离边界是“每租户独立 database + role”，每个租户数据库继续使用自己的 `public` schema；不得让多个租户共用同一个 database。

Sandbox 固定最多一个租户、一个 Task，不支持大型租户档位、独立 Aurora Cluster 或多任务扩容。生产环境未来可以在独立评审后增加 Cell 和扩容策略，但不能把生产档位当作绕过 Sandbox 限制的入口。

## S1：本地执行基础

S1 当前只提供以下能力：

1. `deployment_environments` 保存受控环境、预期 Account/Region、Cell、域名和策略快照。
2. `app_instance_deployments` 保存不可变目标计划哈希、配置哈希、幂等键、状态和脱敏输出。
3. `deployment_jobs` 支持任务去重、`FOR UPDATE SKIP LOCKED` 领取、租约、心跳、重试和死信状态。
4. `deployment_step_runs` 保存步骤输入哈希、尝试次数、结果摘要和脱敏错误。
5. 状态机限制 `planned`、`queued`、`preflight`、准备/迁移/基础设施/健康检查/配置/验证、`ready`、重试、失败、取消与回滚之间的合法转换。
6. 预检核对环境状态、Account、Region、部署档位、Cell/租户计数和受控数据库策略；Apply 操作无条件失败。
7. CloudFormation 渲染器只生成租户栈 JSON 工件，固定一个 Task，并声明 `renderOnly=true`、`callsAws=false`、`createsDatabaseResources=false`。

只渲染的租户模板可以描述 ECS Task/Service、Target Group、日志和 ALB 路由，但不会提交给 CloudFormation。数据库属于未来 Cell 层，不由当前租户模板创建。S1 当前也没有 AWS SDK 客户端、凭据加载、真实 Worker 进程或资源状态回写。

## S2：订单服务控制契约

订单服务控制契约位于独立仓库的 [`SAAS_CONTROL.md`](https://github.com/veinyyxy/SpeedFeast_Backend_main/blob/main/SAAS_CONTROL.md)。平台侧只把它作为未来配置步骤的接口约定，当前不会向订单服务发送请求。

生产契约至少要求：

- 非对称 JWT，限定 issuer、实例级 audience、`speedfeast:control` scope 和准确的 instance claim。
- 首次 provision 使用稳定 `Idempotency-Key`，同一实例和配置哈希可安全重放。
- 配置使用规范化哈希校验，平台只发送模板编译后的非敏感控制数据。
- 生产 `SAAS_REQUIRE_MTLS=true`；只有受信 ALB 的 mTLS 控制监听器可转发 `/api/saas/*`，公共业务监听器必须拒绝该路径。
- 任务安全组只接受受信 ALB 流量，不能信任来自公网的伪造证书头。

模板参数编译规则见 [应用实例模板管理](./app-instance-template-management.md)。S2 契约存在不等于 mTLS 基础设施已经创建，也不等于租户配置已经下发。

## 域名规划

| 用途 | 规划域名 |
| --- | --- |
| SaaS 管理与客户控制台 | `console.techlong.cloud` |
| Sandbox 租户入口 | `{tenant}.sandbox.techlong.cloud` |
| 生产租户入口 | `{tenant}.apps.techlong.cloud` |
| 商户端 APK/制品下载 | `downloads.techlong.cloud` |

本阶段不创建或修改 Route 53 Hosted Zone、DNS 委派、证书或记录。`sandbox.techlong.cloud` 只是预检允许的域名边界；渲染得到的 hostname 不是可访问地址。

## 安全与幂等边界

- 只有 Stripe 原始请求体通过签名验证、服务器金额/币种核对成功且订阅成为 `active` 后，才准备实例和部署计划。
- 价格、套餐、模板版本、配置快照、部署档位和环境均以后端数据库为准。
- 计划生成器、环境和部署档位使用允许名单；数据库内容不能成为任意脚本或命令。
- 计划和渲染工件不保存 AWS 凭据、数据库密码、Token、Secret 值或私钥。
- 重复 Webhook、相同实例和相同配置不能重复创建付款、实例、部署或任务；受控配置变化产生新的哈希与审计记录。
- 客户不能创建 `active` 实例、提交云资源规格、触发 Apply 或填写控制面凭据。

## 本地验收

1. 运行 `npm --prefix .\ops\aws-sandbox test`，验证 S0 JSON、固定值、预算模板、权限边界和秘密扫描。
2. 运行平台 `npm run typecheck`、`npm run build` 和 `npm test`，验证 S1 状态机、任务租约/重试、预检和模板渲染。
3. 使用 Stripe 测试模式完成购买，确认创建 `active` 订阅、`pending` 应用实例、唯一部署计划和唯一待处理任务。
4. 重投同一 Stripe 事件，确认付款、订阅、实例、部署和任务均未重复。
5. 对 Apply 预检传入任何配置，确认仍被硬拒绝；确认没有代码路径调用 AWS。
6. 本地自动测试不得调用 AWS。需要人工复核时，只能显式使用已经验证的 `techlong-sandbox-user` Profile 执行只读 STS、Budget 或 RDS 查询，并确认本阶段没有创建资源；不得把此核验嵌入普通测试或执行写操作。

## 真实 Apply 的后续门禁

真实 AWS 阶段必须另行批准，并至少同时满足：

1. 将已验证的 `techlong-sandbox-user` IAM User 收敛为只允许 AssumeRole；建立专用 Sandbox/Execution Role，使用短期凭据，并用 STS 再次确认 Account `402010193138` 和 Region `ca-central-1`。
2. 评审既有 `1 USD` Zero-Spend Budget 与未部署的 `10 USD` Guardrail 模板，确定唯一告警方案后再部署并验证通知；明确预算有延迟，不能替代强制清理。
3. 先实现和演练 TTL Janitor，保证每个资源在 2 小时后可幂等清理，并在创建资源前建立一次性清理任务。
4. 使用最小权限 CloudFormation Execution Role、IAM 高风险动作显式 Deny、Permissions Boundary、资源标签和固定 Stack 前缀；standalone 账号不使用 SCP，也不为此加入 Organizations。
5. 单独实现并审查 Cell 模板：最多一个 Aurora Serverless v2 Cluster，每租户独立 database + role，禁止 dedicated Cluster 和 Multi-AZ。
6. 镜像必须来自同 Account/Region 的私有 ECR，并固定不可变 digest。
7. 完成 Sandbox DNS 委派、证书、ALB 公共/控制监听器分离和生产 mTLS 验证。
8. 独立 Worker 必须重新验证计划哈希、订阅/实例状态、Account/Region、预算/TTL 和清理任务，再进行每一步 Apply。
9. 完成故障注入、回滚、清理、跨租户隔离和费用复盘后，才允许提出修改硬禁用边界。

在这些门禁全部通过前，S0–S2 只是生产兼容的本地执行基础，不是可部署产品。
