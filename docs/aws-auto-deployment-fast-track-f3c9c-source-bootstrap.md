# F3c9c：Source 登记入口与锁定控制面安装清单

执行后状态：用户批准 `0cb547a6...` 后已完成一次六写流程；2026-10-12 22:54:39.017 UTC独立双回读确认四对象均为LOCKED，原记录保留、永久槽已消费，不再运行本清单。详见[实际安装结果与下一切片](./aws-auto-deployment-fast-track-f3c9c-bootstrap-installation-result.md)。**下方保留执行前评审历史，不再是待执行清单；runtime仍未启用。**

2026-10-12 Winnipeg。已实现 Source SDK 登记入口、冷审批严格解码、永久尝试槽位、锁定控制面 Review/Run/Inspect 和安装顺序；本轮只准备代码与只读取证。**未安装任何 AWS 资源，未登记 parent，未修改 Neon，自动部署仍未启用。** 后续完整权限/表策略安装及运行许可的执行器与验收仍需对应切片完成，不能把本次锁定安装当作全流程就绪。

## 登记入口

`AwsSdkCellParentSourceRegistrarV4` 只接受独立 schema4 Source 登记清单及其准确 SHA。冷 JSON 不冒充旧 review WeakSet：复用现有 strict parent/plan decoder 重建真实 plan brand，再重新采集 Source 身份、双读 IAM/表策略/Function ZIP-Revision、真实准确 RESERVED、受限非 owner Neon open/epoch0/零占用证明。固定证书、保护目录和 DB state hash 不符即拒绝，不用 owner 回读冒充 runtime 证明。

最多两次 Source DDB 事务：先准确原子排除 parent、provision、activation、旧 failure/compensation、六 workflow 和旧 drain 登记，并占用 `cell-birth-v4:registration-attempt:cell:cell-sandbox-1`；只有成功响应产生 private ownership，重新读取全部证明后再准确条件发布 parent。新对象不更新、删除或复位旧记录；争槽 UUID 每次独立。额外固定私有文件用 `wx+flush` 先永久消费，避免 AWS 请求未提交/响应丢失后换进程重试。已占槽位、过期、漂移或不确定均 Inspect，不补写、不回滚、不新建槽位。

它不读取 Secret 值、不写 Neon、不安装权限/函数/表策略、不 Invoke 或创建 Cell。实际装配仍须在角色、完整最终代码、数据库保护和 RESERVED 就绪后提供已批准的受限数据库连接能力及实时 bindings；当前没有生产 RoleId/Revision/RESERVED，**没有生成可执行 parent 登记清单**，也没有消耗登记槽位。

## 本次可单独批准的锁定安装

当前待审批 SHA：`0cb547a6016a508ff5903fb99f804b6cb341147e273e262e1a7a43ef3362676c`。截止 **2026-10-12 23:11:50.948 UTC / Winnipeg 18:11:50.948**；过期或代码/前态变动只刷新只读 Review，不执行旧清单。

| 对象 | 准确目标与变更 | 最大写调用 |
| --- | --- | --- |
| 新 managed boundary | `arn:aws:iam::402010193138:policy/TechlongSandboxCellLifecycleCoordinatorBoundaryV4`，默认 v1 **Deny 全部 Action/Resource** | CreatePolicy 1 |
| 新 Lambda-only role | `arn:aws:iam::402010193138:role/TechlongSandboxCellLifecycleCoordinatorRoleV3`，绑定上述 boundary；无 inline、无 attached managed policy | CreateRole 1 |
| 新日志组 | `/aws/lambda/techlong-sandbox-cell-lifecycle-coordinator-v3`，7天保留、批准 SHA/项目/环境/用途标签 | CreateLogGroup + PutRetentionPolicy 2 |
| 新候选函数 | `arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3`；准确现有 ZIP，Node22/x86_64、120秒/256MB、`$LATEST`，不 publish；reserved concurrency 0 | CreateFunction + PutFunctionConcurrency 2 |

合计最多 **6 次 AWS 写调用**，只创建上述四对象并设置保留/并发。不赋予实际 AWS/Secret/数据库读写权限；不 Invoke、不创建 URL/trigger/schedule、不改原表 policy/Item、不写 Neon、不创建 RESERVED、ECS、ALB、Aurora 或付费 Cell，不删除任何资源。50 USD/月目标保持，不是 hard cap。

候选使用已完成的 F3c9b 包，不重建镜像/重复旧探针：bundle `6ea5a688...`、ZIP `405e6654...`，ZIP 429713 bytes；准确全摘要绑定在清单。未来需要的固定 gate-capable 入口/异步 age60、retry0 配置必须在保持锁定、parent 尚未登记时另行完成和冻结最终包，不能登记后静默换代码。

### 必须接受的完整风险

- IAM、日志与 Lambda 非原子；IAM 传播可能使函数创建失败。脚本只有受限只读等待/核验，**不重试写入**，也不把 GetRole 可见当作 Lambda 可 Assume 的证明。
- 每写之前验证准确 Source、代码字节和创建空槽；取得 RoleId 后，在后续写前核对准确 RoleId/trust/deny boundary。这些不是服务端跨服务 CAS，不能排除管理员并发、角色/策略替换或文件读到上传间的竞态。
- CreateFunction 和 concurrency0 是两次操作，存在函数先存在的间隔；该间隔中 role 的全拒绝 boundary 已安装。若后续操作失败，函数/角色/日志等可能遗留，并不自动删除、撤权、补齐、回滚、复位或重试。
- 永久本地槽位先消费；首个写调用失败、未提交或凭据自动刷新失败，也可能使本轮不可再运行。必须独立 Inspect 并按实际缺项另审范围，不能通过删除槽位/换目录重放。
- 此次没有有效权限 Allow-path 验收；角色只是 locked。Source 写权限能否实际通过、IAM 传播、后续 runtime 读取/清理权限均不由 metadata 或模拟保证。提供者日志可能记录 account/ARN/部署标识。
- Lambda/日志及 API 可能产生非零费用，失败遗留资源也可能收费；没有预算硬断路器。虽然本清单不创建付费 Cell，也不做调用，仍不承诺绝对零费用或总月费≤50 USD。

reserved concurrency 0 可阻止函数处理事件；reserved concurrency 本身不额外收费，但不代表其他资源/存储/API 免费。[AWS 并发说明](https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html)

获批准后只运行该六写流程，再用独立 `Inspect` 核对全拒绝 boundary、空 role policies、trust/RoleId、准确 ZIP/config/标签、并发0和7天保留；任何失败只保存安全摘要和事实，不自动修复。私有工具为 `ops/aws-sandbox/scripts/review-cell-parent-bootstrap-v4.mjs --mode Review|Run|Inspect`，实际 Run 仍需要本清单 SHA。

## 后续安装与真实验收顺序

1. 当前 locked bootstrap；没有 parent/运行权限。
2. 独立审批 Neon 保护及现有角色窄 grants。新 `f3c9c-failed-cell-birth-fence.sql` 仅修正旧未安装候选的 jobs 为实际 `pending/running/retry_wait`，保留旧文件；角色 grant 文件范围保持。需要在 PG18 上真实安装/验收，当前 owner read 不是验收。
3. 在锁定期完成必要的固定只读/条件失败 gate 代码及异步配置，冻结最终包。不会为实现期间过期的 TTL 提前创建 RESERVED。
4. fresh 单独审批零资源 RESERVED，取得真实 UUID Stack ARN；再审批准确 ARN 的最终 IAM 与 revision-conditional 表冻结/≤15分钟 Source 登记窗口。
5. Source fresh parent 登记。窗口截止后 Source data-plane 写应拒绝；metadata/`NO_POLICY` revision 检查只是并发前置，不是 deny 已传播证明。[AWS 表策略 API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutResourcePolicy.html)
6. 受审实际 gate 调用与独立回读：正常固定 metadata/DB read Allow；准确 DDB action 用必为假的条件证明允许路径而不写业务 Item；其它 key/activation/parent/writer 应 AccessDenied，旧主体也要实际拒绝。条件失败/ValidationError 不等同明确 Deny。需固定 gate code/请求 SHA，当前包尚未包含这套 gate 请求入口，**此处是计划，不是假称已经通过**。
7. CFN DeleteStack/PassRole 的实际成功不能靠无副作用模拟保证；真正清理验收仍需具体批准的 Cell/清理范围，保留可能失败/收费的风险。非破坏性 gate 未通过前不 ARMED/PAID；并发/异步/Scheduler 调用、费用和单租户运行许可仍另审。

## 当前取证与验证

- 12 项新增＋23 项 parent/cleanup 相邻测试共 **35 项通过**；typecheck、定向 lint 0 warning、两 CLI syntax 通过。真实 registrar/六写仍未调用；没有把 SDK/SQL 夹具当作真实安装验收。
- **22:11:50.949 UTC / Winnipeg17:11:50.949**：准确 Source 有效；新 boundary/role/function/log group 均 ABSENT，原 parent、六 workflow、旧原件排除槽和新 registration-attempt 两事务均 ABSENT；本地 bootstrap 槽未占、Cell 名称查询 ABSENT。本轮不刷新原 TableId/resource policy、DNS、ECR或费用状态，不引用它们作当前证明。
- `F:/ChatGPT_workshop/techlong-f3c9c-bootstrap-20261012-r3/`：63 code SHA `3fbde58c8f9a60a85f3174a3c36d1ab33e93da5b52100c124093892706757d34`；report SHA `986e79cb28cf24eef0253f871f028688258354f78b123154362fb5cee762bf9e`。r1/r2 清单和报告保留，不用于最终执行。原58文件/包/lock保持。
- **22:13:25.071 UTC / Winnipeg17:13:25.071** Neon 独立只读 r2：PG18.6、open/epoch0/apply0，原证书 `dc093614...`/保护 `41eea5ac...` 完整；新 fence表/entry/state 均不存在；两控制角色 LOGIN、非 superuser/非 bypassrls。原封存 active/deployment/association各1保留，其余占用/jobs/steps0；数据库 CHECK 确认真实 jobs 状态，不是 queued。
- `F:/ChatGPT_workshop/techlong-f3c9c-neon-prestate-20261012-r2/`：61 code SHA `981ae5f233db49fd9b866526065ec9a400036f03f7b82bbfb9daedea552aeb19`；report SHA `c828780fe3b8430fb282359b49ae1a28fe1f2cba311554adabd973867155662b`。新 schema候选 SHA `f4f0bf14...`、role grants `a9b2bca5...`；不生成 DB 写入审批，不读取 Secret 值。r1 依赖绑定补齐前的只读记录保留。
- 本轮总 AWS 写/Invoke/Secret值/Neon写 **0**；Neon仅两次只读连接。首次冷审批测试发现最终 structuredClone 丢失 plan brand，已复用 strict decoder 重建真实品牌解决，没有放宽 validator 或修改原58。

下一步：确认上述准确 locked bootstrap 清单及完整风险，然后执行一次六写和独立只读 Inspect；不自动推进任何后续写阶段。
