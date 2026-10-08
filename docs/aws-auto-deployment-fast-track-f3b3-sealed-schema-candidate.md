# F3b3：密封登记与永久引用围栏候选完成，未安装

2026-10-08 Winnipeg。本切片实现准确旧计划的未注册 SQL 候选，并用真实隔离 PostgreSQL 16.14 验证保护与并发；随后对 Neon 做一次 READ ONLY/SERIALIZABLE/deferrable 结构核对。没有 Neon/AWS 写入、安装 schema、实际登记、修改业务状态、替换原trigger或启用 Worker。**Neon 实际为 PostgreSQL 18.6；PG16 结果不冒充 PG18 在线运行证明。**

## 候选实现与范围

SQL 位于 `ops/aws-sandbox/sql-candidates/f3b3-sealed-plan-isolation.sql`，LF文本 SHA `c088d1a8c75705c88d3f2bfc38cc6070c731de4cac6cd891c91af821a4e3a57a`。它不在 `db/postgres-migrations`，自动migration runner不会加载；本阶段没有新增迁移编号、修改基线schema或提供生产Apply/登记CLI。安装scope数据见 `ops/aws-sandbox/reviews/f3b3-sealed-plan-schema.prepared.json`，不是执行批准清单。

准确目标仍为 `dep_d00144511731f1c20991aa56` / `env_aws_sandbox_ca_central_1` / `app_fb1962e93a9a4cc2acf046170593d9e3`。候选新增两个内部表、八个SECURITY DEFINER函数和十六个ENABLE ALWAYS触发器；函数search_path仅pg_catalog，关系全部public限定。默认撤销PUBLIC对新表/函数的访问，不授予登记者或Worker新权限。未来实际安装会seed**未密封内部fence行**，但不seed登记行；这项内部DML也必须纳入批准范围，不能称为纯零写DDL。

密封前必须原deployment planned/plan_only/cell-demo-1/attempts0，非执行safety三项全false；准确原行、plan原始bytes、现有plan_hash、业务状态预像和实际保护catalog均匹配。instance关联deployment须唯一，所有引用须为空。登记触发器不修改原行；AFTER INSERT永久密封独立fence，原行和登记不得更新/删除、内部fence不得reset/delete，相关TRUNCATE也被拒绝。

原候选五类执行表不足以覆盖实际schema，因此补齐九类表的十个deployment引用列：jobs、step_runs、capacity、cleanup_schedules、resources的created/owner两列、resource_events、external_operations、external_operation_events、cleanup_runs。所有INSERT/UPDATE都受围栏，不能用新增事件或外部epoch引用旧记录。实际外键闭包检查跨schema，新增未知引用失败关闭；保护hash覆盖十二张表的列/type/default/collation、约束、索引、所有trigger/function定义、RLS/owner及新函数/触发器。它不是只比对trigger数量或DDL文件名。

并发采用真实更新的内部fence revision，而非只锁一个不变的原行或使用advisory lock：写引用与登记争用同一versioned row，旧REPEATABLE READ/SERIALIZABLE快照在等待后会冲突，而不是看不到后来密封状态。这与PostgreSQL的行锁/隔离行为一致。[官方行锁说明](https://www.postgresql.org/docs/16/explicit-locking.html)

客户实例/订阅的普通状态更新不被新围栏冻结；同一实例的未来新deployment及其job仍允许，并须继续进入ownership集合。保留原件也意味着FK cascade造成原deployment删除/引用变更会被拒绝，**硬删除关联实例/订阅不能绕过原件保留**。`approved_registration_sha256`目前只存审计pin，本身不能证明人工批准；生产注册仍要独立fresh审批执行器、准确事务和最小权限角色，不能把DB owner当安全runtime角色。

## 真实验证与在线只读证据

`verify-f3b3-sealed-plan-pg16.mjs`复用已审阅的本地TLS/SCRAM隔离helper，新建独占目录/cluster/随机端口，仅加载完整平台schema与合成数据；不加载.env、不连接Neon/源业务PG/AWS。最终a4的11组真实数据库证明包括：原trigger不变、原行/业务预像保留、错误bytes/business/catalog拒绝、约束改变/未知跨schema FK失败关闭、引用先写阻止登记、登记先写拒绝旧RR及Serializable事务、十列未来引用/更新/删除/TRUNCATE/reset受阻、受限actor不可登记但可更新业务状态与创建可见的新live部署。全部通过，独立stop/status证明隔离server已停止。

最终私有目录 `F:/ChatGPT_workshop/techlong-f3b3-sealed-pg16-20261008-a4`：verification文件 SHA `d4ff47efc5a7744794e982a2398f57881dcdda1d63a70cbc08870d54895d9add`；含stopped证明的sessions receipt SHA `a73f329395b542704582b184cc10db7ddbe9b5b5482de980dc13d5523b58acfd`。本地catalog hash `0b8632d6176b2dbfe0e210683974433d646cb45fbeab1e63055ae391afaede9b`属于本地cell_admin/schema/PG16，不能作为Neon安装或登记批准SHA。

a1在合成fixture的published/template关系处被旧trigger拒绝，尚未执行候选；a2的保护/并发检查通过后，在PG16测试role的SET资格处失败。修正fixture与测试权限，不放宽生产guards；a3通过初版，a4补完整表结构指纹与约束改变反例后通过。四个目录/失败原件保留且server均已停止，没有复位旧云slot或污染生产数据。9项定向审阅/候选检查、typecheck、定向lint和脚本语法通过；本轮未修改应用/root/Worker代码，不重建镜像或Lambda包。

新 `inspect-f3b3-sealed-plan-prestate.ts` 实际只读结果：2026-10-08T14:55:06.876Z，Neon serverVersion180006，旧行仍planned/plan_only/attempts0、job0、关联deployment1；现有十个FK引用与候选闭包一致，新表/函数/触发器槽位全部0，原immutable trigger启用、replication_role=origin。私有 `F:/ChatGPT_workshop/techlong-f3b3-sealed-prestate-20261008-a1/sealed-plan-prestate.json` SHA `bbf6e8354d6efdda719176f2f3a85c1f1d13073f91a8c3cf84ccbfc1a1d0a7b8`。这是**结构准备相符而非PG18运行/安装许可**；不把本地测试版本或未来Aurora16.14目标套到Neon上。

## 下一小阶段

1. 对实际Neon同major的PG18做隔离运行验证，可用GitHub Actions云端PostgreSQL服务，不需要Docker Desktop；不在Neon偷偷执行“最后rollback”的DDL测试。
2. 实现独立certificate-bearing ownership source与版本化proof接线。旧schema2 source及两个deletion入口当前完全不改，不用plan_only过滤“凑零”，旧规划门禁尚未解除。
3. 完整审阅Neon准确schema/owner/minimum-role权限/catalog；新schema安装与单行永久登记分别绑定fresh具体scope/SHA后才执行。只读结果不授权安装，也不把保护hash或全a字符的fixture批准当真人许可。

独立Executor v2、既有a5/v2 ZIP和source19cc双镜像保持原样；IAM/Secret/authority/schedule/Cell未创建或改动，50USD/月目标保留。F3b3与端到端自动部署仍未完成。两仓main按默认授权提交推送，无新分支，服务端仅同步继续位置。
