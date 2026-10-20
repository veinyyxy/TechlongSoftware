# W6g：可信 publisher 生产 I/O 接线与 LOGIN 前权限审计

2026-10-20。紧接已完成的W6f，不重做身份实验或安装账本。本步补齐原可信重建器的实际连接器，并只读盘点新角色的有效权限；**没有激活任何生产写入口或LOGIN，没有创建Secret、改AWS/trust、调度或部署**。

## 已实现的实际接线

`ops/platform-publisher-v6/io.mjs` 只供独立可信operator/publisher使用，不被平台HTTP导入：

- 固定Neon目标指纹，显式Postgres TLS证书验证、空连接options、超时；固定已安装owner/角色/schema OID。连接后只读回看9个函数的服务端函数体、owner、类型、definer、search_path和授权，漂移拒绝。
- 数据库适配器只接受 `publish_plan` 和 `attest_evidence` 两段固定SQL。计划写前重新计算plan/action/risk绑定，不接收任意SQL；单阶段最多1写，AttestAndAdvance最多2写。写次数在提交点再次检查，未知ACK即关闭适配器，不重试或补偿。
- `load_plan` 和准确新held job的既有 `techlong_cloud_worker_v5.read_state` RPC均置于Repeatable Read READ ONLY事务；不扫描/领取普通队列，不接受已完成W5r job。
- S3只发准确固定bucket/owner/key/version的GetObject，限长流式读取、AES256/版本/长度/完整文档摘要检查，拒绝能力字段。没有Put/Delete或私密包/Secret读取。
- GitHub只GET固定仓库的准确run，显式只读token、禁止redirect、流式限长；不读日志/artifact、不签App JWT、不mint token、不dispatch或代批environment。原publisher继续交叉核对App actor、caller/reusable、run与完整云证据。
- `ReviewPlan` / `AttestAndAdvance` / `FinalAttest` 的模式在首写前检查；发布计划不是批准或调度。两写之间不是原子操作，第一写已提交而第二写失败时必须独立回读，不能重放整组。

生产连接入口 **`PUBLISHER_RELEASE_V6`仍是代码绑定的UNPUBLISHED**，必须后续单独受审发布准确release/source绑定；caller传一个PUBLISHED对象或改环境变量不能激活。运行时仅接受显式临时AWS凭据与显式GitHub只读token，没有默认AWS凭据链、owner DATABASE_URL fallback或文件PEM加载。工厂导入不连接/读凭据；本机只读审计是单独入口，不是publish命令。

适配器内“一次操作”是内存级防误用，不冒充持久执行授权或提供者ACL。实际operator入口仍须把fresh批准和持久intent置于读取能力材料之前；数据库自身plan/proof唯一槽保持。owner是高权限凭据，固定两条SQL是代码边界，不是数据库对owner的权限收紧。本步不把它带入平台HTTP，也不宣称无人值守生产publisher已启用。

## Neon真实只读结果：27个旧invoker触发器需明确兼容

13:34Z首次审计发现27项非控制函数可通过PUBLIC执行；13:36Z补充类型/语言/owner/源码摘要核对，旧结果保留。第二次结果：

- 服务角色OID180224仍NOLOGIN，未加入其它角色；无数据库/schema CREATE或所有权，无业务/控制表与列/sequence权限，无EXECUTE grant option或foreign server能力。
- 27项全是public schema、owner16392、PL/pgSQL、SECURITY INVOKER、返回trigger的旧函数；逐个OID/签名/config/源码SHA记录，没有调用它们。当前角色通过既有PUBLIC拥有TEMP能力，明确记录，不自动撤销。
- 严格审计状态仍为 `LOGIN_ACTIVATION_BLOCKED_REQUIRES_REVIEW`。只读结果没有把27项自动加入允许列表，没有执行REVOKE、GRANT、ALTER ROLE或改业务触发器。
- 普通SQL不能把trigger返回类型函数当通用RPC调用，但具有TEMP能力的角色可能在自有临时表上挂触发器；SECURITY INVOKER不自带owner权限。这是应绑定准确类型/owner/摘要审查的兼容面，不应把“非definer”单独当作全面安全证明。

建议下一清单**保留旧业务PUBLIC权限，仅为准确27项invoker trigger提议兼容**，不全局撤权或修改业务原件。提案 [精确函数快照](../ops/aws-sandbox/reviews/platform-publisher-v6.legacy-trigger-proposal.json) 的摘要为 `ba28793914eae30cb2cd1dc3a9d8cd5ce61553250f68ddf6edd3d2cd93f2d5d2`，状态PROPOSED_NOT_APPROVED_NOT_ACTIVE，当前检查仍拒绝LOGIN。未来激活必须新鲜核对相同OID/owner/类型/语言/config/函数体，以及其它所有阻断项为零；任何新增或漂移不自动兼容。系统pg_catalog函数/提供者行为和并发风险不能由本审计穷尽。

原件在 `F:/ChatGPT_workshop/techlong-w6g-privileges-20261020-a` / `-b`；公开[准备证据](../ops/aws-sandbox/reviews/platform-publisher-io-v6.prepared.json)保存4份raw摘要。仅目录元数据和函数体摘要，无业务行/私密包/Secret/App key读取，数据库/AWS写0。

## 验证

本机10项新I/O/权限检查+6 publisher+12安装回归共28项通过；scoped lint零警告。云候选/旧闭包均未变化（81文件828491ec…，旧76文件70ee60eb…）。

准确源码 `01083e48673d0bf3afd75e484954f60d0e979fc0` 的[无AWS CI39432718217](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39432718217)已completed/success，attempt1、job118661625173所有步骤成功。日志13:43:02.9331005Z独立确认 `PASSED_REAL_PUBLISHER_IO_PRIVILEGE_PREFLIGHT_POSTGRESQL_18`，原9+3组PG证明、目录证明、类型/lint/构建也全部通过。不要重跑；结果文档提交不是新的执行代码版本或激活批准。

无AWS CI新增真实PostgreSQL检查：使用相同SQL适配器提交已验证计划/证明/后继；在临时库中真实授予一列SELECT和创建一个默认PUBLIC函数，确认审计阻断，再只在临时库撤销，继续真实publisher测试。生产没有做这些授权实验。临时PG验证不证明真实Neon LOGIN、AWS凭据、App发布/trust或端到端部署成功。

## 唯一后续主线

1. 本次准确源码CI真实PG、类型/lint/构建已独立确认全成功；保留只读原件，不重跑本CI或旧W6e/W6f。
2. 将准确27函数兼容、平台专用窄凭据及App caller/reusable/trust接线集中准备为明确资源清单。优先复用现有组件，不扩F3c9；owner计划/证明导入仍留在独立可信边界。实际LOGIN/Secret、发布和IAM变更各按fresh具体范围另批，不能借本步代码提交授权执行。
3. 激活后只用新held job完成Review→人工environment批准→RunOnce→独立Inspect，不重放已完成W5r任务；整套系统AWS上线仍是最后阶段，50 USD/月目标、Aurora双模式与不升级plan保持。

本步没有待执行生产manifest，也没有到期须急批的窗口。代码/文档照旧提交两个main；执行前必须重新核对当前事实和准确批准，不能拿本次兼容提案当LOGIN批准。
