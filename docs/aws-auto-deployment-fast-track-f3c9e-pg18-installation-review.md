# F3c9e：PG18目录兼容修正与独立受审安装清单

2026-10-12 Winnipeg。用户同意继续“仅准备PG18兼容修正和新的受审安装方案”后，新增独立 schema5 入口；**本次只有一次 Neon 只读评审，没有 DDL/GRANT、新槽消费、旧槽复位、AWS操作或runtime启用。** 原68文件、原 SQL、旧批准/停止回执/恢复记录及已消费槽保持不变。

## 当前待批准范围与 SHA

清单 SHA：`6c4f17278d9d6ff1271783b68e490f2d57f215e6ab683e7a14bd141210ac950d`。

截止 **2026-10-13 02:15:11.492 UTC / Winnipeg 2026-10-12 21:15:11.492**。过期或代码/目标/前态漂移只停止；不复用旧91a清单授权。

数据库范围与上次批准保持一致，执行相同两份 SQL，并在一个 SERIALIZABLE 事务中提交：

- 1个新空表 `public.deployment_failed_cell_birth_fences_v1`，4列、4 NOT NULL、5 CHECK、1 PK、1 FK，不插入业务围栏行。
- 3个新保护函数；仅替换现有 environment admission transition函数及两项CHECK；4个新Always触发器，并将原transition触发器设为Always。
- reader新表SELECT和jobs/steps的id/deployment_id/status三列SELECT；drain仅新增准确 `public.begin_failed_cell_birth_fence_v1(text,text)` EXECUTE。
- 不调用失败入口，不改环境行/admission状态/业务原件/旧证书与保护/密码/角色LOGIN/Secret/AWS，不登记parent、不创建RESERVED或付费Cell，不启用runtime。

SQL字节仍为原候选：schema `f4f0bf14bb0b5b126be50dae9c52e21c22ff88bfc36add877db97ae8a45188d9`，grants `a9b2bca56d3ead7d964f25c00a1a721f5a5fe7dd4a1105ab2c82efeb07391e92`。

**本次不是自动重试旧 Run。** 新批准还须明确允许一次独立受审安装尝试，并使用新固定私有保护文件 `F:/ChatGPT_workshop/techlong-f3c9e-pg18-reviewed-installation.permanent-slot.json`；当前该文件不存在。旧 `techlong-f3c9d-failed-birth-installation.permanent-slot.json` 永久保留，其 SHA `d113cae1...` 每次代码/证据核对都必须一致。旧槽、停止回执43077c96...和独立恢复报告3d2853a1...漂移即停止。

## 修正如何收敛

新 `failed-cell-birth-pg18-installation-v5.ts` 与 `review-failed-cell-birth-pg18-installation-v5.mjs` 只增加受审入口，不修改原写入器或旧68绑定文件。

PG18目录中的NOT NULL由`contype=n`表示，目录还提供enforced/validated、键列及FK动作字段。[PostgreSQL 18目录说明](https://www.postgresql.org/docs/18/catalog-pg-constraint.html)

新校验不是将7改为11：

1. 新表4列的名称/类型/位置/NOT NULL/默认值/identity/generated必须准确；4个n约束逐列一一对应，不能缺少、重复、映射到其它列，且须enforced、validated、非deferred/deferrable、无继承或period。
2. 按n/c/p/f分别要求4/5/1/1，不接受额外约束类型。所有新约束必须enforced和validated；PK准确为environment_id，FK准确指向原environment的id，DELETE RESTRICT/UPDATE NO ACTION/MATCH SIMPLE保持。
3. 两个被替换环境CHECK必须仍enforced/validated；其余环境列和约束完整前后比较，不只看状态字符串。
4. 两种目录查询的name/type/validated/definition必须一致。只有4个已独立完整验证的n行才在内部兼容视图中投影掉，继续运行原V4的权限增量、函数body/ACL、安全属性、触发器、表列/owner/RLS及旧证书/业务保留检查；不把投影视图当作真实状态或runtime proof。
5. 使用实际未投影完整状态作为最终摘要。提交前的完整安全目录快照先`wx+flush`保存，再验证；若校验失败，可看到具体当时的表/约束/ACL/函数/权限，而不是只有合并错误码。写请求和证据保存阶段及安全SQLSTATE单独记录，不保存密码/连接字符串或原始提供者报错。

原68字节仍被验证；先核对旧槽和历史恢复证据，再实时读取完整前态。新槽只有在fresh人工批准、代码及锁内前态全部通过后消费；任何已消费新槽也不会复位、补写或再创建一个自动重试槽。

## 必须接受的完整风险

- 单事务仍会取得环境ACCESS EXCLUSIVE及有关业务/旧保护表写锁；可能阻塞业务读写，锁/语句超时或约束验证失败使事务停止。未提交事务可ROLLBACK收尾，但提交后不自动down或恢复旧函数。
- 两角色已LOGIN。drain将新增受限SECURITY DEFINER写入口，别人持其现有凭据也可能调用；安装不调用入口不等于没有能力暴露。三列SELECT不是行过滤，涉及对应表全部行。
- 旧事务内目录未保存，前次失败原因没有唯一确定；新的兼容修正不保证其它owner/ACL/数据库或提供者问题已经解决。本次独立尝试仍可能在提交前失败，永久消费新槽。
- 管理员并发DDL/ACL、角色替换、提供者同步及最后检查后的变化不是全局CAS；元数据不能证明真实受限认证、有效Allow/Deny传播或失败清理行为。不得把本次评审或目录验收视为自动部署/运行许可。
- TLS连接、SQL、COMMIT响应及私有证据持久化可能失败；特别是后置快照保存失败时，即使未提交也可能消费新槽。COMMIT一经尝试，结果丢失只Inspect，不追加ROLLBACK、补偿或SQL重试。
- 新独立尝试不是取消永久槽约束：旧槽绝不删除、复位或重放，新槽一旦消费也永久保留。接受失败后不自动删除、down、撤权、补齐或继续尝试；后续处置需按实际状态另审。
- 本地/提供者日志可能记录SQL和标识；本工具不输出密码/连接字符串或原始异常，但无法保证提供者日志不记录信息。Neon/现有服务费用不承诺绝对零，50 USD/月不是费用硬上限。

## 真实只读证据与验证

- **2026-10-13 01:15:10.089 UTC / Winnipeg10月12日20:15:10.089**：PG18.6，完整旧前态摘要仍 `e2f42d036a44235ebfede2f0703336740df95d091551540ddf21a53920c26b88`，与批准前态及两次恢复回读相同；原证书/业务/权限完整，新保护对象不存在。
- 真实现有environment的17 NOT NULL列与17个n约束一一对应，全部enforced/validated；这是当前只读验证，不是对尚未安装新表的真实写行为验收。
- 新完整PG18前态 SHA `b411548358135344c3b4c248da0c94a79892bb04d3b14cab9546573e3abb95b7`；70代码SHA `1c1bc49285d6ef061e7fede2a82fd720c533fbbe00cff51cf5574bbed529e778`；manifest文件SHA `c3cf6d5b3f3855e2dc66b7ccaf1442939a2af9f633836f3f638e94e23a6ab38a`。
- 私有目录 `F:/ChatGPT_workshop/techlong-f3c9e-pg18-install-20261012-r1/`。新槽未消费，旧槽原样保持。本次DB连接1/只读事务1，数据库写/AWS调用/Secret值/Invoke均0。
- 10项新回归＋8项原安装器＋3项停止Inspector共21测试，typecheck、lint 0 warning、CLI syntax通过。没有运行隔离PG模拟；夹具测试只证明结构性规则，不宣称Neon新表已经创建或实际失败入口已验收。

下一步：用户批准上述新SHA、准确数据库范围及新独立槽位风险后，仅一次原子安装和新连接独立只读Inspect。安装完成之后，runtime reader/gate-capable最终包/async/RESERVED/最终IAM-table-parent及实际门禁仍为后续独立范围；不自动ARMED/PAID。
