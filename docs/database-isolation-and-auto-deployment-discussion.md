# SaaS 自动部署与 PostgreSQL 数据隔离讨论记录

> 整理日期：2026-08-11  
> 形式：根据本次对话整理的问答记录，保留主要结论、设计约束和示例。

## 1. 当前项目是否前后端分离

### 问题

目前项目是前后端分离的设计吗？

### 回答

当前是“分层分离”，但 SaaS 管理平台自身不是严格的前端、后端双仓库结构。

| 部分 | 当前设计 |
| --- | --- |
| SaaS 管理平台 `TechlongSoftware` | 全栈项目，React 页面、API 路由、权限和数据库访问位于同一仓库 |
| 餐饮订单系统服务端 | 独立的 `SpeedFeast_Backend_main` 仓库，目标为每租户独立 ECS Service |
| 买家端 Web | 与服务端分离，规划为共享 CloudFront + S3 |
| 商户端 | APK 独立发布，由 SaaS 平台展示下载地址 |
| 数据库 | 前端不直接访问，只能通过 SaaS 后端或餐饮订单系统服务端访问 |

因此：

- 从整个产品体系看，前后端是分离的。
- 从 `TechlongSoftware` 控制平面看，它是全栈单体。
- 从餐饮订单系统看，买家 Web、商户 APK、服务端和数据库是分离的。

## 2. 自动部署代码如何调用

### 问题

当前代码是怎么调用自动部署的？

### 回答

设计不是让 Stripe Webhook 直接调用 AWS，而是：Webhook 只持久化部署意图，独立 Worker 异步执行部署。

```mermaid
flowchart LR
    A["Stripe Webhook 验签成功"] --> B["付款记录 paid、订阅 active"]
    B --> C["创建或复用 pending 应用实例"]
    C --> D["生成部署计划和 apply Job"]
    D --> E["独立 Deployment Worker"]
    E --> F["准备租户 Database、Role、Secret"]
    F --> G["CloudFormation 创建租户 ECS 资源"]
    G --> H["等待 ECS 健康"]
    H --> I["调用 /api/saas/provision"]
    I --> J["读取 /api/saas/control 对账"]
    J --> K["实例 active，写入 access_url"]
```

主要步骤：

1. Stripe Webhook 核对金额、币种和签名。
2. 系统更新付款记录和订阅状态。
3. 创建或复用状态为 `pending` 的应用实例。
4. 生成不可变部署计划和幂等 `apply` Job。
5. Worker 使用数据库租约领取任务。
6. Worker 准备租户 Database、Role 和运行时 Secret。
7. Worker 渲染并校验 CloudFormation 租户模板。
8. CloudFormation 创建或更新 ECS Service、Task Definition、Target Group、Listener Rule、日志和 TTL Schedule。
9. ECS 健康后，通过 mTLS 和 JWT 调用餐饮订单服务端 `/api/saas/provision`。
10. 再读取 `/api/saas/control`，核对配置哈希和镜像摘要。
11. 全部一致后，原子更新 Deployment 为 `ready`、应用实例为 `active`，并保存 `access_url`。

### 当前状态

以下能力已有代码基础：

- 部署计划和任务生成。
- Worker 状态机和租约围栏。
- CloudFormation AWS SDK Adapter。
- SaaS 控制接口客户端。
- 配置哈希、镜像摘要和幂等校验。

但真实部署仍然硬禁用：

```ts
applyRuntimeReady: false
cleanupRuntimeReady: false
```

当前还缺少真实 Tenant Database/Secret Adapter、外部 ownership epoch、完整可恢复清理流程，以及正式 Shared Cell 环境。因此即使修改 `AWS_APPLY_ENABLED`，当前入口也不会创建 AWS 资源。

## 3. 不同套餐能否采用不同数据库布局

### 问题

小型客户使用一个 database 多个 schema，大型客户使用独立 database，这种设计是否灵活？

### 回答

目标方向是灵活的，但当前执行层还没有完整支持这种组合。

建议最终支持三个数据隔离等级：

| 数据隔离模式 | 适用客户 | 数据库布局 |
| --- | --- | --- |
| `shared_schema` | Basic、小型客户 | 同一集群、同一 database、每租户独立 schema 和 role |
| `tenant_database` | Plus、中型客户 | 同一集群、每租户独立 database 和 role |
| `dedicated_cluster` | Enterprise、大型客户 | 每租户独立 Aurora/RDS 集群、database 和 role |

当前代码中：

- `standard-v1` 和 `large-v1` 使用 `tenant_database` 目标。
- `large-dedicated-db-v1` 已表达独立数据库集群目标。
- 数据库生命周期执行器当前只允许 `tenant_database`。
- 当前还没有 `shared_schema` 执行模式。

### 当前 Schema 模式的阻断

订单服务端大量使用显式的 `public.*`：

```sql
SELECT * FROM public.orders;
```

即使设置：

```sql
SET search_path TO tenant_123, public;
```

显式的 `public.orders` 仍会访问 `public` schema，不会访问 `tenant_123.orders`。在共享 database 中直接启用 Schema 多租户会产生串租风险。

要安全支持 `shared_schema`，必须先：

- 移除业务 SQL 中显式的 `public.` 限定。
- 使用租户 Role 固定 `search_path`。
- 防止连接池复用时遗留上一个租户的上下文。
- Schema 名称只能由后端根据应用实例 ID 生成。
- 为每个 Schema 配置最小权限。
- 增加跨租户隔离集成测试。

### 更灵活的领域模型

建议拆分计算档位和数据库隔离策略：

```ts
{
  computeProfile: "standard" | "large",
  dataIsolation: "shared_schema" | "tenant_database" | "dedicated_cluster"
}
```

这样可以组合出：

- 标准 ECS + 共享 Schema。
- 标准 ECS + 独立 Database。
- 大型 ECS + 独立 Database。
- 大型 ECS + 独立 Cluster。

并为数据库操作提供统一接口：

```ts
interface TenantDataProvisioner {
  inspect(): Promise<Inspection>;
  prepare(): Promise<Receipt>;
  migrate(): Promise<Receipt>;
  verify(): Promise<Receipt>;
  destroy(): Promise<Receipt>;
}
```

不同模式由以下实现负责：

- `SharedSchemaProvisioner`
- `TenantDatabaseProvisioner`
- `DedicatedClusterProvisioner`

套餐购买时必须保存数据库隔离策略快照。套餐后来被管理员编辑，不能自动改变已购买租户的数据布局。租户从 Schema 升级到独立 Database 或独立 Cluster，应通过专门的数据迁移 Job 完成。

## 4. 多个 Database 是否会增加 AWS 成本

### 问题

创建太多 database 会不会增加成本？

### 回答

需要区分两种情况。

### 同一 Aurora Cluster 中的多个逻辑 Database

```text
1 个 Aurora Cluster
├── tenant_a_db
├── tenant_b_db
└── tenant_c_db
```

AWS 不会因为多执行几次 `CREATE DATABASE` 就收取多份实例费。Aurora 主要按以下资源收费：

- Writer/Reader 实例或 Serverless ACU。
- 总存储量。
- I/O 请求。
- 备份存储。
- 可选服务。

逻辑 Database 数量会带来间接成本：

- 每个 Database 有独立系统目录。
- 每个租户会复制表、索引、迁移记录和部分基础数据。
- 每个租户服务通常需要独立连接池。
- 迁移、备份验证和故障恢复工作量增加。
- 所有租户负载汇总后，可能让 Serverless 提高 ACU。

最大的间接成本通常是连接数：

```text
活跃租户数量 × 每租户连接池上限 = 潜在数据库连接数
```

需要限制每个 ECS Service 的连接池，并监控数据库连接数、ACU、CPU、内存、I/O 和存储。

### 每个租户一个独立 Aurora Cluster

```text
tenant_a → Aurora Cluster A
tenant_b → Aurora Cluster B
```

这会显著增加成本，因为每个 Cluster 都有自己的 Writer、最低计算容量、存储、备份、日志和网络资源。独立 Cluster 应仅用于能覆盖这些成本的大型客户。

## 5. PostgreSQL Database 是否等于 AWS 数据库实例

### 问题

一个 database，就是一个数据库实例吗？

### 回答

不是。Aurora PostgreSQL 的层级是：

```text
Aurora Cluster
├── Writer DB Instance
├── Reader DB Instance（可选）
└── PostgreSQL 逻辑数据库
    ├── postgres
    ├── tenant_a_db
    └── tenant_b_db
```

| 名称 | 含义 |
| --- | --- |
| DB Cluster | 管理存储、复制和高可用的一套 Aurora 集群 |
| DB Instance | 提供 CPU、内存和数据库进程的计算节点 |
| Database | PostgreSQL 中通过 `CREATE DATABASE` 创建的逻辑数据库 |
| Schema | Database 内部的命名空间 |

以下连接使用相同的 Aurora Cluster 地址，只是进入不同逻辑 Database：

```text
postgresql://role_a@cell.cluster.example:5432/tenant_a_db
postgresql://role_b@cell.cluster.example:5432/tenant_b_db
```

项目中应使用明确术语：

- `tenant_database`：共享 Cluster，租户拥有独立逻辑 Database。
- `shared_schema`：共享 Cluster、共享 Database，租户拥有独立 Schema。
- `dedicated_cluster`：租户独占 Cluster 和数据库计算实例。

## 6. PostgreSQL 的 Schema 和 Database 有什么区别

### 问题

为什么 PostgreSQL 的 Schema 不是 MySQL 中的 Database？

### 回答

在 MySQL 中，`DATABASE` 和 `SCHEMA` 基本是同义词。PostgreSQL 把它们分成两个层级：

```text
PostgreSQL Server / AWS DB Instance
└── Database
    └── Schema
        └── Table
```

可以类比为：

- AWS DB Instance：园区。
- PostgreSQL Database：一栋楼。
- Schema：楼里的部门。
- Table：部门里的房间。

一个 Database 多个 Schema：

```text
saas_cell_db
├── tenant_a
│   └── orders
└── tenant_b
    └── orders
```

查询：

```sql
SELECT * FROM tenant_a.orders;
SELECT * FROM tenant_b.orders;
```

多个 Database 各自使用 `public` Schema：

```text
tenant_a_db.public.orders
tenant_b_db.public.orders
```

连接建立时必须选择 Database；连接后可以通过完整名称或 `search_path` 选择 Schema。同一事务可以直接访问多个 Schema，但不能像访问 Schema 一样直接跨 PostgreSQL Database 查询。

## 7. Schema 存在的意义

### 问题

既然有 Database，Schema 有什么意义？

### 回答

Schema 是同一 Database 内的轻量命名空间、模块组织和权限边界。

主要用途：

1. 避免表名冲突，例如 `sales.orders`、`archive.orders`、`audit.orders`。
2. 按业务模块组织数据，例如 `auth`、`billing`、`restaurant`、`audit`。
3. 为不同服务或角色配置 Schema 级权限。
4. 支持大量小型租户的 Schema-per-tenant 模式。
5. 在同一事务中访问多个模块。
6. 共享 `countries`、`currencies` 等公共数据。

示例：

```text
app_database
├── auth
│   └── users
├── billing
│   └── payments
├── restaurant
│   └── orders
└── audit
    └── events
```

Schema 本身不是天然的安全隔离。必须正确配置 `USAGE`、表权限、默认权限和连接上下文。

## 8. 多个 Database 比多个 Schema 多出哪些 AWS 成本

### 问题

在同一个 AWS Aurora Cluster 中，多个 Database 比多个 Schema 多出哪些成本？

### 回答

在同一个 Cluster 中，两种方式的实例或 ACU 直接费用基本都由总负载决定，不按逻辑 Database 数量计费。差异主要是间接成本。

| 成本项目 | 多 Database | 多 Schema |
| --- | --- | --- |
| Aurora 实例/ACU | 按总负载 | 按总负载 |
| 数据存储 | 略高 | 略低 |
| 数据库连接 | 通常更多 | 可以更少 |
| 系统目录 | 每个 Database 独立一套 | 共用一套 |
| 公共数据 | 通常需要复制 | 可以放在共享 Schema |
| 数据迁移 | 每个 Database 分别运行 | 可从一个连接管理多个 Schema |
| 扩展安装 | 通常每个 Database 单独安装 | 同一 Database 内可共用 |
| 备份计费 | 按 Cluster 总数据量 | 按 Cluster 总数据量 |
| 运维工作量 | 更高 | 较低 |
| 数据隔离 | 较强 | 较弱 |

对当前项目的建议：

- 早期客户数量不多时，使用共享 Aurora Cluster + 每租户独立 Database，优先保证隔离安全并兼容现有 `public.*` SQL。
- 完成订单服务端 SQL 和连接池改造后，再为 Basic 客户引入共享 Database + 独立 Schema。
- Enterprise 客户使用独立 Cluster，并让套餐价格覆盖独立计算、存储、备份和运维成本。
- Cell 是否接收新租户，应根据连接数、ACU、CPU、I/O、存储和活跃租户数量综合判断，而不是仅按 Database 数量判断。

## 9. 当前决策摘要

1. SaaS 控制平面保持全栈项目，餐饮订单系统运行时继续独立部署。
2. 支付成功只生成部署 Outbox Job，不在 Webhook 中直接调用 AWS。
3. 当前安全可用的数据隔离目标是共享 Cluster + 每租户独立 Database。
4. Schema 多租户必须等待订单服务端移除显式 `public.*` 并完成连接池隔离。
5. 计算规格和数据隔离策略应拆分建模。
6. 大型客户的真正物理隔离应使用独立 Cluster，而不是仅创建独立逻辑 Database。
7. 真实 AWS Apply 和 Cleanup 继续保持关闭，直到真实 Adapter、ownership epoch、完整清理和迁移演练完成。

## 10. 参考资料

- [Amazon Aurora Pricing](https://aws.amazon.com/rds/aurora/pricing/)
- [How Aurora Serverless v2 works](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.how-it-works.html)
- [Performance and scaling for Amazon Aurora PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Managing.html)

