# M1：首个 sandbox 业务输入与六 DML 原子提交待审

2026-10-13 America/Winnipeg，继续 [D001 主线](./aws-auto-deployment-single-tenant-acceptance.md)。已安装 Cell IAM 保持不变；本阶段完成真实业务配置、原子提交入口/永久 journal/独立回读，并修正新 Cell 模板与 IAM 的标签差异。**本轮只是代码与只读准备：数据库/AWS 写、Secret 值读取、收费创建、槽消费均 0，运行时仍关闭。**

## 准确拟提交范围

管理员归属复用用户指定邮箱的准确 active 管理员，身份只保留于私有材料；用户另行确认店铺名 `Techlong Sandbox`、商户管理员用户名 `techlong_sandbox_admin`。这是商户登录用户名，不是平台邮箱；本次不创建商户密码或账号，实际首位商户账号在日后 SaaS provision 时生成。

复用 active plan `pln_5303b097f504453caaca07715d1d7dbe`、产品 `prd_restaurant_order_system` 和其 published schema-v2 `tplver_9c175436f0a14d9aa7f5fdfc2b5c139e`。按现有 billing 规则合并 template defaults 与 plan template_configuration，后者优先，再解析用户输入。23 个 schema 字段得到 22 个合法配置值（可选 firstOwnerDisplayName 未设置）。不改已发布版本、套餐内容或旧客户配置。

一次 Serializable 事务，仅六条 DML、每条必须命中一行：

| 操作 | 准确作用 |
| --- | --- |
| INSERT workspaces | 新独立 `Techlong Sandbox Acceptance`，用户选定 owner，active；subscription 状态 active、app 状态 pending |
| INSERT workspace_members | 该新 workspace 的一条 owner membership，不创建/修改 users |
| INSERT subscriptions | 新 workspace/product 的一条 admin_manual/standard-v1/active 订阅，当前批准时间起 31 天，存同一 configuration；不创建付款、订单或账单 |
| INSERT app_instances | 新 `first-acceptance`，pending，绑定该新 subscription/template/configuration；拟 URL `https://first-acceptance.sandbox.techlong.cloud`，尚不可用 |
| INSERT workspace_product_entitlements | 只绑定以上新 workspace/subscription/app，pending；不用 upsert 覆盖既有权益 |
| UPDATE deployment_environments | 仅准确 `env_aws_sandbox_ca_central_1` 的 policy `budgetLimitCents:1000→5000` 及 updated_at；其他 policy、apply_enabled=0、open/epoch0/无 stack 保持 |

五个新 ID 在本地分配并经数据库查空，完整参数仅在私有 manifest。**不插入 deployment/job，不 claim、注册 execution binding/activation、改 admission 或启用 Worker，不启动租户/Cell TTL。** configuration hash `06d3cb50dd46b5f32771c356b7e7cd7d524a0707799ae24b9ace0672ef7281c9`；规划 hash `c45dafe1d1c65609eed08ff397d899aeaa0e55092312e330a0b4eef507434e5a`。可提前计算与 management.ts 一致的未来 deployment/scope，但尚未写入；真实 enqueue 的 created_at/TTL 等依赖 Cell 与执行材料就绪后 fresh 审阅，不挪用本次订阅时间。

## 当前 SHA、截止及执行边界

- Manifest SHA：`7b741e2278d93c23c1885d33df89469ec03012b6842766a39e95d69083d32afc`。
- 生成：**19:08:45.326 UTC / 14:08:45.326 CDT**；截止 **20:08:45.326 UTC / 15:08:45.326 CDT**，均为 2026-10-13。
- 14 源码 UTF8/LF binding：`8c57b72d76aa9a154457a7c726e413ddc793c6f721a79a92ec8913c87c0f5ba8`。
- 私有文件：`F:/ChatGPT_workshop/techlong-d001-business-review-20261013-r3/manifest.json`；文件 SHA `a9090da352a1c510effa5e59e7838bb8a12b5c0435bcb001ff97716164b49918`。
- 固定永久槽：`F:/ChatGPT_workshop/techlong-d001-business-bootstrap.permanent-slot.json`，**未创建/消费**。

`review-single-tenant-business.ts` 提供 Review/Run/Inspect。Review 仅 TLS verify-full 的 Serializable READ ONLY；Run 必须 exact SHA、有效期和当前源码绑定，BEGIN 后只锁准确 owner/product/plan/template/env 源行，重读完整源状态、旧隔离指纹、业务 schema、权限/无 RLS 与新 ID/slug/tenantKey 碰撞；一致后才消费永久槽。六条参数化 DML 不含 ON CONFLICT、schema/grant/角色/password 修改或删除；env 更新另有原 policy bytes/updated_at 与关闭状态条件。

同事务再检查五行的全部关键归属/配置/状态/时间、env 唯一 policy 差异、原隔离/业务 schema 不变、没有 deployment/job，全部通过才 COMMIT。原子性不是执行成功保证；槽消费后的失败也不重放。另一个进程 Inspect 绑定原 manifest/run/slot，只读回读；成功、部分停止或 COMMIT 不确定都可进入独立观察，不因此自动补写或重试。正常提交须返回 `BUSINESS_BOOTSTRAP_VERIFIED_NO_JOB_NO_TTL`；未消费槽的前置停止需先只读人工核对，不凭错误文本认定已提交。

过期只做只读刷新并重新确认 SHA。`Review --seed <先前私有seed.json>` 可保留拟议五个 ID；不能绕过已消费槽。r1/r2/r3 都保留，只有 r3 为当前待审；修订没有数据库写，也没有新建代际/换槽重试。

## 必须接受的完整风险

1. 新 active 手工订阅没有付款/订单记录，会出现在平台客户/权益视图；31 天为本测试订阅期限，不是费用承诺，也不是部署 TTL。
2. 新 pending app/active 订阅会改变容量/客户统计，可能阻止历史 zero-tenant 门禁；**不能像旧 plan_only 证书一样排除它们**。F3c9 封存，不为此改旧查询/证书或清理旧客户。
3. 共享 sandbox env 的 50 USD policy 影响未来该环境规划，不是 AWS Budget 更新或账单硬 cap。apply 始终关闭，不因 policy 改变获得部署许可。
4. Serializable/源行锁可能短暂阻塞并发操作，遇唯一冲突、触发器、序列化或锁超时即中止，无应用自动重试。目录指纹与行锁不消除所有外部 DDL/函数/权限竞态；provider 超时/取消不能证明服务端没有执行。
5. 数据库/提供者日志可能记录非秘密配置/SQL 参数。manifest 与配置快照不包含密码、Stripe/JWT/private key/Secret 值；邮箱/owner identity/权益配置仅保存在本地私有材料，不公开提交。
6. COMMIT 回应丢失是不确定，不冒充 rollback。COMMIT 前失败只回滚未提交事务；进入 COMMIT 后不做自动 down/delete/补偿。接受提交后不自动删除/down、永久槽不复位、不自动补齐或重试，必须独立核对。
7. pending URL/未来 scope 不是真实 endpoint、ready、任务或 runtime 证明；后继 cloud/DB/Secret/DNS/activation/cleanup 范围另批。原客户、实例、订阅、旧部署/封存证据和引用保护都不修改。

这些与 manifest 七项风险一致。此批准不含 IAM、AWS/Secret 写、付费 Cell 或 ECS 调用。

## 真实只读证据与本轮修正

**19:08:45.266 UTC / 14:08:45.266 CDT** Neon 预检通过：准确 owner/active product/plan/published template，env active/open/epoch0、apply=0、budget 仍1000；新 ID/slug/tenantKey 碰撞0；六项当前源权限为 true、目标六表无 RLS；旧原件 hash 与密封证书吻合、fence sealed。保护 schema SHA `41eea5ac8b64801144fa568dce2b42d5dcb350a520a82df91f973c23bedab168`，六表 columns/constraints/triggers/functions 指纹 `cb04243a151b818e31872a7ba54dacfd430fafd1a297cb8b919862b3fce84fe1`。这些是当次事实，不是未来权限/并发保证。

首次按 `aws-sandbox` 别名查询环境未命中，随后只读改按 kind/准确 key `aws-sandbox-ca-central-1` 核对；没有伪造环境、创建记录或修改 source。

接线发现独立 Cell renderer 原 `ManagedBy=techlong-cell-operator` 与刚安装 IAM 的 `techlong-provisioner` 条件不匹配；**仅新 D001 renderer** 及其资源标签对齐，加入与实际编译 IAM 五个 ownership 标签的一致性检查。原 shared-cell renderer/F3c9 132 pins、现有 IAM 四执行 pins与云策略完全不改。这里属于本地修正，未来收费批准须绑定新模板，不能沿用旧模板 SHA。

**19:06:20.616 UTC / 14:06:20.616 CDT** 准确 Source `ValidateTemplate` 成功：25 resources、4 parameters、capabilities 空；模板 SHA `7ee8d52b29a5ec9649f376fdd1236b791d8b1a0b662f2c5baa4b55edda93f895`，requestId `2335fbbf-e019-4b2f-aa3c-1f45674f3496`。原件 `F:/ChatGPT_workshop/techlong-d001-cell-template-20261013-r2`；渲染使用**拟**5000 policy，不表示 Neon 已更新，也不是 cloud 执行 SHA。没有创建 Stack/Change Set、IAM 修改或 Secret 读取。

24 项定向/相邻检查通过，typecheck、定向 lint 零警告通过，无本地 Docker/数据库模拟或镜像重建。发现上一轮新增测试里 failureCode 访问缺少静态类型收窄，本轮只补测试的 `in` 断言；原 IAM 执行代码/云安装与回读不受影响，本轮重新 typecheck 成功。测试 fixture 初稿漏 schema-v2 文字长度约束，补齐后全部通过，没有降低真实 validator。

**19:15:27.849 UTC / 14:15:27.849 CDT**，另一进程在真实 Neon Serializable READ ONLY (`transaction_read_only=on`) 中对全部六条参数化语句做普通 `EXPLAIN (FORMAT JSON)`，均通过；**不使用 ANALYZE、不执行 DML**。计划原件仅私有 `r3/sql-explain.json`，文件 SHA `11a0c587d9a62bfe30cac6150694092d65a3d3db962b3ad1df906a8c7877de84`；它核对实际 schema/类型/规划，不证明未来触发器、并发或提交成功。参见 [PostgreSQL EXPLAIN](https://www.postgresql.org/docs/18/sql-explain.html)。

摘要见 [本轮 capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.business-bootstrap.json)。事务与行锁行为依据 [PostgreSQL 18 isolation](https://www.postgresql.org/docs/18/transaction-iso.html)、[explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)；本执行边界不采用文档建议的自动序列化重试，而是一次受审提交、失败独立观察。

## 下一主线

本六 DML 获批并独立核验后，复用这些真实 app/config/scope 收尾 control signing/mTLS/payment 的安全来源、准确 lifecycle/worker 权限及 live guard/journal/cleanup-readiness，再集中提交准确 Cell/DNS/费用/清理创建范围供审批。依赖准备完成前不创建 deployment/job、启动新 TTL 或改 prepared false；M1仍未完成，不返回 F3c9。
