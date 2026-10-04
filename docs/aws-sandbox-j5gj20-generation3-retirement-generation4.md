# J5g-j20：generation3 严格退役入口与独立 generation4 围栏

本页保留第一个代码小阶段当时的实现与证据。后续已完成 generation4 受审创建/回读/安装/撤权工具接线，见[后续接线阶段](./aws-sandbox-j5gj20-generation4-reviewed-tools.md)；这不改变本页旧云状态，也不代表任何云写入已获批准。

用户已明确同意：推送已审阅提交 `0749e8eae3a32567780d456968cd8e8b4e7d1e54`，并仅实现 generation3 严格退役入口、独立 generation4 围栏和本地批准命令。旧提交已准确、非强制推送到 `github/main`，随后独立远端回读确认相同 SHA。

2026-10-04 用户追加持续授权：本任务范围内 TechlongSoftware 与服务端仓库的代码、测试和文档提交，以及非强制推送到各自 `github/main`，默认同意，不再按提交 SHA 逐次询问；这包括既有 AWS Account ID、ARN、部署状态和只读证据。仍须检查并排除凭据、私钥及数据库连接密文，保留用户无关修改，不新建分支、不改写历史。该 Git 授权不扩展云操作范围：真实删除、创建和权限安装仍各按 fresh SHA 单独批准。

本阶段没有 AWS 写入、Operator 登录、IAM 安装、资源删除/创建、Neon 写入或付费 Cell。没有生成真实删除/创建/安装执行清单，没有开启新的批准或候选 policy 窗口。所有 compatibility、readiness、live Worker/runtime gates 仍关闭。以下代码完成不代表整个 generation4 云端流程已可运行。

## 实现范围

新增 generation3 专用退役 domain、原件加载器、独立永久 intent ledger、Source SDK adapter、四模式 CLI 和完整 SHA 的本地 PowerShell wrapper；旧 generation2 退役和 generation3 创建/执行入口保持不变。

严格退役入口仅接受这一准确未执行对象：

```text
arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj19-read-grant-5d51369f11eec775/1a1782fb-40f7-4f3f-8bd5-85a6ca05ed89
```

它逐层加载旧 generation1/legacy、generation2 创建/关闭/独立退役 proof 和真实永久 intent，以及 generation3 创建、回读、未批准执行审阅、窗口收尾原件与真实 claim。仅有文件名或自述 SHA 不足以通过；原件需要复算、重编译并与准确锚点和真实固定槽位比较。

退役前必须同时证明：旧 policy 已到期；完整 Locked/v5 IAM 快照不变；原 fixture READY_UNEXECUTED、资源0且模板不变；管理清单前后完整且仅有准确目标（不忽略 terminal 对象）；目标 root/non-nested/AVAILABLE、Original 模板和单个非替换 Operator policy Modify 准确；旧三代记录和 claim 不变且没有 workflow intent。SDK 对 nested/import 标志的未知类型也拒绝。

真实删除仍须未来 fresh 五分钟清单的完整 SHA、准确确认短语和不可恢复/低成本确认。永久 intent 先独占落盘、fsync、回读，之后至多提交一次准确 full ARN `DeleteChangeSet`；取消、过期、拒绝或回包丢失均不复位、不自动重试。提交成功也不是退役证明；必须另起 Source-only Inspect 证明准确对象缺失、完整管理清单为空、Locked 和原 fixture 不变，才能接纳后继。外部缺失而没有本流程准确 intent 不能作为后继凭据。

不允许删除原 probe 或 Stack，不执行 Grant/child，不安装 IAM，不创建其他资源。严格排除 nested 目标尤为重要：[AWS DeleteChangeSet 文档](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeleteChangeSet.html)说明 nested Change Set 的删除可能涉及层级内其他 Change Set。

## 本地入口与固定槽位

CLI 为 `ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-generation3-retirement.ts`。

| 模式 | 边界 |
| --- | --- |
| `CheckPreparation`（默认） | 只读准备检查；无执行清单、过期时间或确认短语，不开启批准窗口 |
| `Review` | 未来显式生成五分钟准确退役清单；只读、不批准删除 |
| `RetireReviewed` | 仅接受新清单准确 SHA 与明确确认；一次永久 intent 后至多一次准确删除 |
| `Inspect` | 独立只读退役核验；不能重试删除，也不能自动创建后继 |

`Invoke-ReviewedGeneration3Retirement.ps1` 必须显式提供绝对 Evidence、Manifest、Output 路径和完整 `-ApprovedManifestSha`；不自动补 SHA、不接受旧 generation2 批准、不获取 Operator/MFA。执行前检查两份输出均不存在，沿用准确 UTC 窗口解析和单个 Node 路径选择。它只串联一次退役和独立 Inspect，不串联后继创建或安装。

下面只是准备检查用法，**不是云删除命令**。Output 必须选择新的绝对文件路径；本阶段已保存的输出不能覆盖：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/s3-b5-arn-probe-read-comparison-generation3-retirement.ts `
  --mode CheckPreparation `
  --evidence F:/ChatGPT_workshop/techlong-j5gj20-generation3-retirement-evidence-paths.json `
  --output F:/ChatGPT_workshop/NEW-generation3-preparation.json `
  --acknowledge-read-only
```

新增 generation4 compiler、review、claim binding 与固定 filesystem fence，stage 为 `B5-J5g-j20`，generation4/prior3。只选原 exact-name 只读候选，围栏绑定全部旧三代记录、准确 generation2 退役 proof、封闭 generation3 前驱和未来独立 generation3 退役 proof。旧 generation2 proof、旧 generation3 计划/批准和未来 generation5 均不能替代。

```text
旧 generation3 claim（已占用，保留）：
.aws-sandbox/j5gj19-read-comparison/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000003

未来 generation3 退役 intent（本阶段未创建）：
.aws-sandbox/j5gj20-read-retirement/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000003

未来 generation4 claim（本阶段未创建）：
.aws-sandbox/j5gj20-read-comparison/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000004
```

读 ledger/slot 不创建目录；写入只能独占建立固定槽位并 fsync/readback。多个候选或后续窗口竞争同一个物理槽位；半成品也永久消费。保留旧记录，不提供 reset/replay、自动 generation5 或损坏修复入口。30分钟候选 policy、最多5分钟批准、至少10分钟撤权余量保持不变；创建批准与安装批准分离。

**generation4 的真实 Create/RecoverCreate SDK、运行时 CLI、Grant Execute/Operator Describe/立即 Revoke controller 与本地执行接线尚未实现。** 本阶段导出 `GENERATION4_LIVE_EXECUTION_IMPLEMENTED=false`，仅编译请求和预留固定围栏，并没有可调用的真实 generation4 创建/安装入口。测试内生成的 proof/窗口只用于固定时间、内存或临时目录验证，不是云执行授权。

## Source-only 真实准备检查及独立验证

原件：`F:/ChatGPT_workshop/techlong-j5gj20-code-preparation-readonly-20261004T152339868Z.json`。

- receipt SHA：`f70d0fe1bb6ae23baf306f9cf8cff7ae9b4e2477c7438ff2aac8aee48f049afb`
- observedAt：`2026-10-04T15:23:50.521Z`（Winnipeg 10:23:50.521 CDT）
- outcome：`EXACT_UNEXECUTED_GENERATION3_PREPARATION_VERIFIED`
- 封闭 generation3 前驱 SHA：`b81b72b44d2c46e5c8f8ea514bb876c4216c9a32a47174e54416b324c69af0eb`
- 保留的 generation2 独立退役 proof SHA：`64fd0e26e7aee9d3c3a8170def5995c3e06481879c1ebbaf1ef511d7d7337497`

两次完整管理清单均只有准确 generation3 Grant；它仍 READY_UNEXECUTED，完整 Locked/v5、execution boundary v1、四个 IAM 资源/两策略/两角色及 trust/attachments/版本与准确旧基线相同。Cell MISSING、authority ABSENT，原 fixture 前后不变。

旧 generation3 真实槽位仍只含 `claim.json`，claim SHA 为 `c38e7a12decc82b68916c4423b39df29c7b7dbc2e0eca2b8930d5d0cc9b9660c`；没有 workflow intent。两个新的 j20 registry 均 absent，新退役 ledger 为 null。

另起本地进程重新加载三代实际原件和 generation2 真实退役 intent，独立复算准备 receipt 和前驱 SHA，按原 observedAt 检查完整前后 Locked/fixture/清单/claim、精确非执行 scope，通过。`approvalWindowOpened`、`manifestCreated`、`deletionAuthorized`、`creationAuthorized`、`mutationPerformed` 均为 false。此原件是该时点的只读证据，不能代替未来 fresh preflight 或执行清单。

## 验证与后续顺序

定向测试共 **78/78 通过**：新增28项 generation3 退役/generation4 围栏测试，加旧退役28项与既有 generation3 workflow 22项回归。覆盖旧批准拒绝、重新计算 digest 后的对象/前驱漂移、完整清单、永久 intent 与 lost reply、过期/取消、独立缺失证明、固定槽位竞争/半成品/未知文件、SDK nested/import 类型拒绝和实际 PowerShell 旧批准阻断。`tsc --noEmit` 通过，新增 TypeScript 的 ESLint 零错误/零警告；新增公开元数据 fixtures 不含凭据。未重复全量离线模拟或开启 live Worker。

下一小阶段应先完成并验证 generation4 真实创建/独立回读/安装读取/立即撤权与本地准确 SHA 接线，并完成代码审阅、推送和 Source/本地 MFA 准备，**再**考虑真实退役或开启新候选窗口。不能先删除 generation3，然后在短窗口内临时补齐代码。

所有代码准备完成后，真实 generation3 删除、generation4 创建、generation4 安装各自仍需 fresh SHA 单独批准。创建与安装之间只保留必需独立回读与 fresh execution review；证据归档/提交/推送放在云流程收尾之后。MFA 只在本地终端输入，不发到聊天。预算10 USD/月仍是告警而非硬费用上限，接受低成本不代表绝对零费用。
