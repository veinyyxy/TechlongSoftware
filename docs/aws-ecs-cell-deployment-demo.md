# AWS ECS Cell 部署计划 DEMO

## 本阶段交付边界

当前版本只把客户购买结果转换成一份可审计、可重复生成的 AWS 目标计划。它不会调用 AWS API，不会创建 ECS、ALB、RDS、S3、CloudFront、VPC、Secret 或日志资源，也不会生成 ARN、正式域名、访问 URL 或任何密钥值。

主业务链路是：

```text
管理员维护共享 Plan 和已发布模板版本
→ 企业 Owner 选择 Plan 并填写模板允许的客户参数
→ 服务端按数据库中的 Plan 生成 Stripe Checkout
→ Stripe 签名验证通过的 Webhook 确认付款
→ 自动创建或续期 Subscription
→ 自动创建或复用 pending App Instance
→ 幂等生成 app_instance_deployments 计划记录
→ 管理员检查并继续当前手工开通流程
```

Plan 是平台维护的共享商品定义，不会因为某个客户购买而复制。每次购买会固定套餐、模板配置和部署资源档位快照，并据此生成该租户自己的订阅、应用实例和部署计划。

## 目标架构

计划采用 Cell 架构限制故障域和资源规模。

### 平台共享层

- 一套 CloudFront + S3 承载买家端 Web。
- 一套 SaaS 控制平面负责身份、套餐、购买、付款、租户配置和部署编排。

### 每个 Cell 共享

- 一个 ALB。
- 一个 Aurora / RDS 集群。
- 一组 VPC、子网以及 NAT Gateway 或 VPC Endpoint。

### 每个租户独立

- 一个 ECS Service 和对应 Task Definition 配置。
- 一个 Target Group 和 Listener Rule。
- 一个数据库 Role。
- 一个数据库 Schema。
- 独立数据库档位会额外生成租户专属 Aurora / RDS 集群逻辑名；标准档位继续引用 Cell 共享集群。
- 一个 Secret 资源引用；计划中不包含 Secret 值。
- 独立 Auto Scaling 策略。
- 独立日志命名空间和成本标签。

### 大型租户

- ECS 最少运行两个 Task。
- 使用更高 CPU / 内存规格和更高扩容上限。
- 业务或隔离要求达到阈值时使用独立数据库。

## 受控部署资源档位

管理员创建套餐时必须从后端允许名单选择一个资源档位。客户只能选择套餐，不能从浏览器提交任意 CPU、内存、扩容上限或数据库隔离策略。

| 档位 | ECS 初始任务数 | 最小/最大任务数 | 单任务规格 | 数据库隔离 |
| --- | ---: | ---: | --- | --- |
| `standard-v1` | 1 | 1 / 4 | 0.5 vCPU / 1 GiB | Cell 集群内独立 Role + Schema |
| `large-v1` | 2 | 2 / 12 | 1 vCPU / 2 GiB | Cell 集群内独立 Role + Schema |
| `large-dedicated-db-v1` | 2 | 2 / 20 | 2 vCPU / 4 GiB | 独立数据库目标 |

档位键带版本号。以后调整资源规格时应增加新键，不能静默修改旧档位并改变历史订阅的含义。

## 计划记录与幂等性

`app_instance_deployments` 保存以下计划元数据：

- 应用实例、订阅和购买订单关联。
- 驱动 `aws_ecs_cell`、工作流版本和 `plan_only` 模式。
- 区域、Cell、部署资源档位。
- 目标计划 JSON、规范化哈希和幂等键。
- 当前计划状态、尝试次数和错误摘要占位。

计划使用应用实例等稳定数据库标识生成资源逻辑名和成本标签，不使用店铺名称、联系人或其他可变个人信息。重复 Webhook、相同实例和相同配置不会重复创建计划；配置发生受控变化时应生成新的幂等版本，而不是覆盖审计历史。

应用实例状态和部署计划状态相互独立：`pending` 说明客户服务尚待开通，`planned` 只说明目标计划已经持久化，不表示 AWS 资源存在或健康。

## 安全约束

- 只有 Stripe 原始请求体通过签名验证、服务器订单金额和币种核对成功，并且订阅成为 `active` 后，才会生成实例和计划。
- 价格、套餐、模板版本、配置快照和部署档位均以后端数据库为准。
- 计划生成器使用驱动允许名单；不能执行数据库中的脚本或任意命令。
- 计划 JSON 不保存 AWS 凭据、数据库密码、Token、Secret 值、ARN 或真实访问地址。
- `AWS_REGION` 与 `AWS_DEFAULT_CELL_KEY` 只是非敏感计划标签，不是 AWS 授权配置。
- 当前驱动的 Apply 操作必须明确拒绝执行。管理员手工填写的现有入口不代表 AWS 自动部署结果。

## 本地验收

1. 在 `.env.local` 配置 Neon、Stripe 测试密钥，以及可选的 `AWS_REGION=ca-central-1`、`AWS_DEFAULT_CELL_KEY=cell-demo-1`。
2. 管理员创建或编辑一个套餐，选择部署资源档位并启用套餐。
3. 企业 Owner 选择该套餐、填写租户参数并完成 Stripe 测试付款。
4. 确认 Webhook 创建 `active` 订阅和 `pending` 应用实例。
5. 在管理员实例详情确认存在一条 `plan_only` / `planned` 记录，并核对区域、Cell、资源档位及逻辑资源摘要。
6. 重投递同一 Stripe 事件，确认付款、订阅、应用实例和部署计划均未重复。
7. 确认 AWS 账号中没有因此产生任何资源，应用实例也没有被自动标记为 `active`。

## 下一阶段：受控执行器 / Worker

真实部署应在独立 Worker 中实现，而不是让 Webhook 请求直接调用 AWS。建议按以下顺序推进：

1. 增加 outbox / job 队列并落实 `planned → queued → provisioning → ready | failed | canceled` 状态机，Webhook 只提交事务内任务。
2. 使用专门的 AWS IAM Role 和短期凭据；按动作、区域、Cell 和资源标签配置最小权限。
3. 把 plan 与 apply 分离；Worker 必须再次校验计划哈希、当前订阅、实例状态和驱动版本。
4. 为每一步实现幂等资源标识、重试、超时、并发锁、补偿策略和人工恢复入口。
5. 将 Secret 值写入 AWS Secrets Manager，数据库只保存 Secret 引用；敏感值不得进入计划、日志或审计事件。
6. 增加 ALB、ECS、数据库迁移、健康检查和访问地址回写流程；全部成功后才允许把实例标记为 `active`。
7. 增加结构化部署事件、CloudWatch 指标、告警、成本标签验证和跨租户隔离测试。
8. 先在专用测试 AWS 账号和测试 Cell 完成故障注入与回滚演练，再考虑生产启用。

在上述执行器完成并通过安全评审之前，`plan_only` 是不可越过的产品边界。
