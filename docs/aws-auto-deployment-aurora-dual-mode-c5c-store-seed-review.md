# C5c：默认店铺单次初始化执行包（待批准）

执行完成更新（2026-10-15）：用户已确认本清单；Run唯一一次INSERT收到COMMIT确认，独立Inspect确认准确store1、其他业务0、技术9seed及目录/权限不变。两永久槽已消费，**禁止重放本页命令**。见[实际结果与下一步](./aws-auto-deployment-aurora-dual-mode-c5c-store-seed-executed.md)；下文和prepared capsule保留为批准前历史。

2026-10-15 America/Winnipeg。沿用 Express 单租户交付主线、现有两份已发布镜像及50 USD/月目标；Full路径、F3c9封存和全部旧记录不变。**实际执行器已实现，当前仅完成Review；店铺未创建，尚无owner/epoch/job/TTL/Cell/ECS/ready写入。**

## 为什么先做这一步

已发布镜像的provision只查既有active store，缺失时返回STORE_NOT_FOUND。这次把[上阶段候选](./aws-auto-deployment-aurora-dual-mode-c5c-first-claim.md)补成真实Source/TLS/IAM执行入口，不再增加单独的SQL诊断、权限安装或镜像发布。为了不在计算层就绪前启动job/TTL，首个执行包**仅初始化默认店铺**；首次owner/epoch登记仍待后续部署执行包，不在这里提前伪造或激活。

## 本次准确批准范围

- 准确集群`techlong-sandbox-express-d001`、resource ID `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，现有5432公共TLS入口，PG17.9。
- 仅数据库`tenant_a0da1748bc4d5419_db`/OID16459；Source IAM签发的`postgres`/OID16410登录。应用角色仍为`tenant_a0da1748bc4d5419_role`/OID16456，不改角色、权限、comment或数据库owner。
- 一次Run连接：SERIALIZABLE事务、pg_catalog search_path、5秒锁等待/15秒语句超时，准确stores表锁；实际全目录/角色/四库ACL、原bootstrap comments/guard缺失、73表行数和技术singleton/8项原始entitlements均核对。
- 唯一业务写为一条绑定5个参数的`INSERT public.stores`。UUID `add89a8c-f43e-81b9-8287-0cb6c5c54f87`、code `TECHLONG_SANDBOX`、slug `first-acceptance`、Winnipeg/CAD、active/default，空联系信息；不是upsert，不改既有行，不插入用户或密码。
- 写后核对真实73表计数：stores0→1，其余业务表0，技术种子仍9。全catalog/ACL/角色保持原实际hash，不修改观察向量去“通过空库校验”；同一事务内COMMIT。
- 之后独立新进程、单独一次只读TLS/IAM连接执行Inspect；仅接受准确原空状态或准确新店铺，不能把Inspect结果当作provision/initialized ready。读取允许的业务内容只包括这条准确store及原技术seed，其他业务表只读行数。

Run正常最多22条SQL、Inspect正常最多12条SQL；各自故障时至多一次未提交事务ROLLBACK，没有第二次连接或INSERT重试。无AWS写、IAM修改、Secret值/私密bundle读取、恢复/迁移、Neon业务/authority写、owner/epoch认领、enqueue/TTL、ECR发布、旧栈删除或付费资源部署。

## 当前实际Review与清单

最终Review于UTC `2026-10-15T09:42:43.354Z`完成；准确Source、集群创建时间/resource ID/engine/IAM/IAG/scaling、Source准确postgres connect模拟均匹配。新只读控制面观察仍为两套DDB key缺失、Neon deployment/job/resource/operation均0；订阅、配置及50 USD环境策略匹配。**Review不连接Aurora，当前SQL数据状态尚未证明，批准Run会在同一写事务内先验证。**

- 执行清单SHA：`d53b2572aac78bba7cc007b53315adc8f4edeb9f3d127d909d7e013ff328bfc0`。
- 截止：UTC **2026-10-15 15:42:43.354**，Winnipeg **2026-10-15 10:42:43.354 CDT**。Run及Inspect都受时限约束；失效只重新准备/审批，不延长旧清单或重跑已消费槽。
- 目录：`F:/ChatGPT_workshop/techlong-express-c5c-store-seed-review-20261015-r2/`，有manifest/program/code-binding/metadata/result及本地compiled产物。
- 代码绑定SHA `b53b0b11172dce00208de38180e999f73162033548378efd0ae091cbd42bb088`，83个本地依赖/编译资产/依赖锁文件（LF规范化），两份原本地工具原始字节hash，另绑定7个历史输入文件。原基线归档/manifest仍由原私有编译器验SHA/语法，未恢复SQL或伪造private brand。
- 新永久槽：`techlong-express-c5c-store-seed-run-v1.permanent-slot.json`、`techlong-express-c5c-store-seed-inspect-v1.permanent-slot.json`；目前均未消费。C4及其他旧槽/对象保持，不重放旧控制器。
- r1为较早源码的成功Review，因增加有序SQL传输围栏/时间校验而被r2取代，不是失败写入或重试授权。两次Review总计STS4、RDS Describe4、IAM模拟2、DDB强一致GetItem4、Neon只读SELECT2；底层凭据获取HTTP另计。Aurora连接、业务写、私密值读取、执行槽消费均0。

[版本化摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5c-store-seed.prepared.json)保存结果/hash，不替代完整待审manifest或用户确认。

## 完整风险

1. 唯一INSERT仍是永久业务数据，不是只读探针；seed不等于provision、owner/epoch登记或ready。没有自动down、删除新店或恢复旧状态。
2. SERIALIZABLE、表锁、完整检查会产生短暂阻塞或序列化失败。目录/行数、AWS/DDB/Neon不是跨服务CAS；特权并发写、检查后及提交后变化仍可能发生。Source postgres权限较大，不代表ECS task role实际登录成功。
3. COMMIT可能已成功但响应/本地证据丢失。提交尝试后不自动ROLLBACK、补偿或重复INSERT；独立回读不是Run的原子延伸。若状态不同或凭据不可用，停止并核对，不能据本地失败推断未写入。
4. Run/Inspect各自的新永久槽在建立SQL连接前占用，失败也不复位、补齐、重试或重新连接。Inspect若只见空状态，只证明未观察到seed，不授权再次写。旧槽及原件全部保留。
5. IAM凭据/token仅驻内存，清理是best effort；AWS/数据库/网络提供者日志可能保留连接和查询元数据。没有读取AWS Secret值或本地private-material.json，但TLS/IAM鉴权会将临时认证token交给准确Aurora端点。
6. 最多两次SQL连接可能唤醒Aurora并产生ACU/I/O费用；50 USD/月是目标，不是硬限额，不保证零费用，也不会自动销毁资源。
7. 当前Review只有元数据/控制面事实，不能替代Run里的当前Aurora校验。技术singleton必须尚未provision且无epoch/request/result，8项entitlements必须仍是准确migration默认值；偏差直接终止，不“适配”或重放旧恢复/授权流程。

## 执行与失败继续点

本页不代表用户已确认。获准确SHA批准后，在仓库根目录使用**不加载.env.local的主进程**：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-store-seed-v1.mjs `
  --mode Run --manifest F:/ChatGPT_workshop/techlong-express-c5c-store-seed-review-20261015-r2/manifest.json `
  --approved-sha d53b2572aac78bba7cc007b53315adc8f4edeb9f3d127d909d7e013ff328bfc0 `
  --output F:/ChatGPT_workshop/techlong-express-c5c-store-seed-run-20261015-r1

# Run成功或失败，只要已消费Run槽，在同一批准窗口内独立执行一次Inspect；不重跑Run。
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-store-seed-v1.mjs `
  --mode Inspect --manifest F:/ChatGPT_workshop/techlong-express-c5c-store-seed-review-20261015-r2/manifest.json `
  --approved-sha d53b2572aac78bba7cc007b53315adc8f4edeb9f3d127d909d7e013ff328bfc0 `
  --output F:/ChatGPT_workshop/techlong-express-c5c-store-seed-inspect-20261015-r1
```

Source不可用时只请用户刷新现有`techlong-sandbox-user`；刷新不授权写入，不重试已消费槽。主进程拒绝静态AWS/PG/DATABASE_URL/不安全TLS环境；已有Neon只读核对在隔离子进程中加载现有.env.local，URL只发往Neon，不能影响Aurora目标。实际会话仅允许准确顺序/文本/参数；不暴露任意SQL、callback、额外query配置或重连。未提交事务的ROLLBACK可在批准过期时执行以安全退出，绝不对已提交数据做down。

54项相关测试（新增9项）、类型检查和定向lint通过；本地真实私有归档编译及最终Review通过，测试fixture不是实际写入/ready证据。此步不改服务端镜像源码，不再构建或发布ECR。确认seed独立观察后，下一包回到计算层/准确旧失败栈处置、首次owner/epoch、workload/DNS/私密来源/provision/ready闭环；各删除、权限、付费部署和私密读取仍具体确认，不扩展F3c9。
