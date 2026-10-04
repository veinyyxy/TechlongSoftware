# J5g-j22A：准确 Stack 限定只读对照的受审准备入口（code-only）

用户已同意先实现新的只读范围、不部署：仅对原准确零资源 fixture Stack 增加 `cloudformation:DescribeChangeSet` Allow，不附加 `cloudformation:ChangeSetName` 条件，保留区域和时间限制，不改变删除/执行权限。实际云创建、安装等操作仍各需 fresh SHA 单独批准。

本小阶段完成 generation4 的严格关闭前驱、独立新围栏描述、未部署候选 compiler 和仅本地 `CheckPreparation` 入口。**持久化以及创建、安装、Operator 读取、撤权的云执行工具尚未接线**；`persistenceImplemented` 和 `executionImplemented` 均为 false。本轮没有 AWS/Neon 网络调用、身份刷新、MFA、云写入、新 registry 或新批准窗口。

## 已实现的边界

- 严格验证原 generation4 创建/执行清单、两次不同 request ID 的明确拒绝、Source 读取前后括号、立即撤权与后续独立 Locked/v7 Inspect、准确原 fixture、J21 诊断，以及全部六步永久 intent 的绑定和先后顺序。完整链缺失、对象漂移、未知结果、成功读取或重复 request ID 均不能替代已归档的真实前驱。
- 本地证据入口绑定完成记录的固定 SHA，回读真实旧 claim/六步 journal，并验证原三代退役链。测试替身不能成为真实入口的前驱。
- 新围栏描述使用独立 `.aws-sandbox/j5gj22-stack-scoped-read-control/<targetFenceKey>/slot-000005`，绑定原 generation4 claim 和 journal；不创建物理槽位、不预留 intent、不复位旧记录。新 registry 若已存在则停止，要求人工核对，不自动清理或重放。
- 候选从准确 Locked 撤权模板出发，仅新增 `TemporaryAllowStackScopedControlDescribeChangeSet`：Action 只有 `cloudformation:DescribeChangeSet`，Resource 只有原 fixture 完整 Stack ARN，Condition 只有 `aws:RequestedRegion` 与上下限 `aws:CurrentTime`。新增 statement 不含 `ChangeSetName`、`IfExists`、Delete 或 Execute；所有旧资源、trust、policy statement 和删除/执行限制保留。
- 候选定义完整 ARN 与准确名称两个只读请求，各最多一次，并要求返回完整准确 ID；不因拒绝自动重试，不宣称 Delete 或生产兼容性已证明。
- 候选 compiler 只接受显式、规范 UTC 起止时间，窗口必须恰为 30 分钟且不得早于旧 policy 过期及 J21 诊断；不读取当前时间、默认生成窗口或复用旧批准。未来至多 5 分钟批准、至少 10 分钟撤权余量等仍是后续执行接线要求，本轮未开启。
- 新候选没有可供云创建/执行的顶层 AWS `request`，不能进入旧 generation4 创建/执行 compiler；`allowedWriteActions` 为空，创建、安装、Operator、运行和生产验证授权均关闭。旧 compiler、SDK、Source channel 和 live Worker 未改。

AWS 授权表列出 DescribeChangeSet 的 Stack 资源类型；这里采用准确 Stack ARN 的新只读对照范围，不据此断言旧拒绝的根因已解决。J21 未取得实际条件上下文，根因仍未证明。见 [AWS CloudFormation 服务授权参考](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudformation.html) 与 [J21 诊断限制](./aws-sandbox-j5gj21-generation4-describe-diagnostic.md)。

## 本地准备入口与真实原件核验

入口为 `ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control.ts`，仅接受：

- `--mode CheckPreparation`
- `--evidence`：准确证据路径映射的绝对路径
- `--output`：父目录已存在、文件尚不存在的绝对路径
- `--acknowledge-local-read-only`

不接受时间、批准 SHA、Create 或 Run 参数；没有 AWS SDK、凭据 provider、Operator 或云写能力，也不调用候选 compiler。输出以 `wx` 新建，拒绝覆盖文件、隐藏文件，以及包含 `.git`、`.aws`、`.codex`、`.agents`、`.aws-sandbox` 的路径段。本地报告的文件写入不代表云 mutation。

实际证据路径映射保存在 `F:/ChatGPT_workshop/techlong-j5gj22-stack-scoped-read-control-evidence-paths.json`。真实原件/账本核验报告：

- 首次：`F:/ChatGPT_workshop/techlong-j5gj22-local-preparation-20261004T174348848Z.json`
- 最终入口核验：`F:/ChatGPT_workshop/techlong-j5gj22-local-preparation-20261004T175333686Z.json`
- 两份报告相同，outcome 为 `CLOSED_GENERATION4_STACK_SCOPED_PREPARATION_VERIFIED`。

| 绑定 | SHA-256 |
| --- | --- |
| 本地准备报告 | `37499bf6a771c1ce5bc3fb7523955dd0b027fa5e62110ae7a2087dbe215e0bf1` |
| 严格关闭前驱 | `c0a9db665633fd6cbfd29b732bd6099d93cf7ea12aac2e23c506ecb89cc57b63` |
| 原 claim/六步 journal 快照 | `6ec0eae446692285efe64e844eca3cb9f9e24ced36d5fb268b8f1ba66872b192` |

另起进程从真实原件和真实账本独立重算，完整报告一致，旧 journal 未变，新 registry absent。报告不包含 issuedAt/expiresAt、manifest 或批准命令；文件名时间仅为归档时间，不是权限窗口。

本阶段没有重新读取线上 AWS 状态。以上是历史完成证据的本地完整性核验，不是当前 fresh Source 证明：J21 诊断 observedAt 为 `2026-10-04T17:17:42.499Z`，J20 独立 fixture Inspect 为 `2026-10-04T17:03:35.508Z`，均不可直接作为未来云写入前置批准。

## 验证结果

- 新契约/入口 13 项测试、原 generation4 workflow 24 项回归，共 37/37 通过。
- TypeScript `--noEmit --incremental false` 通过；五个新 TypeScript 文件 ESLint `--max-warnings 0` 通过。
- 最后加固本地输出路径保护后，单独重跑入口测试 1/1 及五文件 lint，通过。
- 测试采用固定时间的内存替身，不访问 AWS、凭据或真实 ledger；真实原件/账本核验由上述独立本地准备入口完成。未重复全量 build 或云流程离线模拟。

## 下一小阶段：继续代码接线，不部署

1. 实现独立固定槽位的永久 claim/六步 intent 持久化，禁止旧批准跨代使用、复位、自动 successor 或重放。
2. 接入 fresh Source 完整 Locked、准确原 fixture 唯一清单与管理 Change Set 清单核验。旧已执行 Grant/Revoke 的准确 UUID 必须在新回读中核对，不能假定管理清单为空、忽略陌生终态对象或自动删除历史。
3. 接入分别受审的创建/安装清单、三项 action SHA、本地固定 MFA Operator 至多两次 Describe，以及成功、失败或取消后的立即撤权和独立 Locked 核验；丢失或过期后只允许安全撤权，不允许重放。

上述持久化和云工具尚未在本阶段实现。完成接线后才生成实际 fresh 审阅清单，再由用户逐项批准云操作。本地代码/测试/文档按持续授权直接提交并非强制推送 main，不新建分支。
