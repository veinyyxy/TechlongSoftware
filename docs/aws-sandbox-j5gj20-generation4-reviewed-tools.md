# J5g-j20：generation4 受审云工具接线完成（code-only）

本小阶段补齐 generation4 创建、独立回读、Source 安装审阅、固定 MFA Operator 两种 Describe 和立即 Source Revoke 的独立工具接线。沿用既定方案和用户持续 Git 授权，代码/测试/文档可直接提交并非强制推送到 `github/main`，不再逐提交 SHA 询问。

本阶段仅代码实现、定向验证和一次 Source-only 准备检查；没有云删除、资源创建、Grant Execute、IAM 安装、Operator 登录、Neon 写入或付费 Cell。没有开启新的真实候选或批准窗口。generation3 与其旧 claim 保留，实际 generation3 退役、generation4 创建和安装仍各需 fresh SHA 独立批准。

## 接线与不变边界

generation4 保持独立 stage `B5-J5g-j20`、claim action `CLAIM_GENERATION4_BEFORE_CREATE`、固定 `slot-000004` 和 j20 请求名/token/确认短语。generation1/legacy、generation2 与 generation3 的原件、槽位及旧执行器不改动；新入口不能接受旧 generation3 计划或批准。

两个新 CLI 都要求显式 `--mode`，没有默认生成窗口的模式；必须提供绝对 Evidence、generation3 独立 retirement proof 和新输出路径。真实原件加载器先重编译并核验整个旧三代链及真实永久删除 intent，再构造网络 capability；新 receipt 使用 `wx` 保存，不能覆盖账本或历史原件。静态测试中的 proof/批准不能替代真实账本。

| 入口/模式 | 作用与边界 |
| --- | --- |
| generation4 create：`ReviewCreate` | Source-only 完整 Locked、原 fixture 和完整空管理清单；只编译 exact-name 候选，不批准创建 |
| generation4 create：`CreateReviewed` | 准确 fresh creation review SHA/确认及四项写确认；固定 claim 独占落盘后至多一次准确 `CreateChangeSet`，不执行 IAM |
| generation4 create：`RecoverCreate` | 独立只读完整清单、double-Describe 和 Original 模板核验；claim 消费后不能自动重建 |
| generation4 workflow：`Review` | 准确真实 claim/Grant 和完整前后 Locked/fixture；生成独立安装 manifest 与三项 action SHA，不执行 |
| generation4 workflow：`RunReviewed` | 独立准确安装 manifest 及其 Grant/reads/revoke SHA；本地 MFA 后 fresh preflight，至多一次 Grant Execute、一次 full ARN 与一次 exact name Describe；成功或失败后立即撤权 |
| generation4 workflow：`Inspect` | 独立 Source-only 管理/fixture 与本地记录核验；不给写权限、不登录 Operator |
| generation4 workflow：`RecoverRevoke` | 单独明确批准的原 manifest/revoke action；仅恢复 Locked，过期后也不重放 Grant/Operator 读取 |

创建时 fresh preflight 可能重新编译假设候选，但不会替换用户已经批准的准确请求或延长其 policy。30分钟候选、最多5分钟批准、至少10分钟撤权余量不变；安装审阅终点取“五分钟”与“policy 到期前十分钟”中更早者。过期的候选不能靠刷新 Source 或重新 Review 恢复安装。

创建回包丢失、取消或批准在落盘后到期仍消费固定 claim；只能独立读回，不能重复 Create。每个安装、读取与撤权步骤都先保存精确不可覆盖的 intent 并 fsync/readback，再提交一次请求；并发/重启/换 manifest/半成品/未知文件均不能复位或重放。新的 filesystem journal 允许固定六步文件，不接受其他文件或 generation5。

Source SDK 的完整 singleton 创建清单不忽略外来 terminal 对象。撤权阶段只容许本 manifest 的准确已结束 Grant 与其准确 revoke 共存；不能把其他 terminal 对象当作批准历史。nested/import 标志仅接受 absent/false，未知类型、父/根目标、UUID/模板/单一 policy Modify 漂移均拒绝。

Source 管理通道新增独立 generation4 compiler 验证入口，仍完整收集 IAM/Cell/authority 证据。新 workflow 比较准确四个 IAM 资源、所有角色/trust/attachments、execution boundary 文档/版本及 Operator attachment/boundary usage；撤权可产生新的 Operator policy 版本，但其默认文档必须准确 Locked，不能把版本变化当作新权限许可。旧管理读取通道保持严格隔离。

SDK 使用固定 region、Source 登录凭据、`maxAttempts: 1` 和禁用配置 endpoint override，不构造 Delete、child、付费 Cell 或 live Worker 接线。`GENERATION4_LIVE_EXECUTION_IMPLEMENTED=true` 仅表示受审工具代码已接线，**不是执行授权、生产 compatibility 或 readiness gate**；`runtimeEnabled`、`productionCompatibilityVerified` 和所有 Worker gates 仍 false。

## 本地准确批准命令

新 wrapper：`ops/aws-sandbox/scripts/Invoke-ReviewedGeneration4ReadComparison.ps1`，独立于旧 wrapper 和 generation3 退役 wrapper。

- Create 参数集必须显式 `-ApprovedCreationReviewSha`；只提交一次创建，再另起 Node 进程 RecoverCreate，证明 READY_UNEXECUTED 后生成 fresh execution review，并显示（不运行）下一准确批准命令和三项 action SHA。
- Execute 参数集必须显式 `-ApprovedManifestSha`，其三项 action SHA 从该完整批准 manifest 中取出并由 CLI 独立重编译；没有自动安装批准。MFA 只在本地终端输入。
- RecoverRevoke 参数集必须明确 `-RecoverRevoke` 和准确 `-ApprovedManifestSha`，不能安装 Grant 或构造 Operator 会话。
- 启动写入前，所有阶段输出和必需独立读回输出均须不存在；不会覆盖历史 receipt。沿用 UTC 窗口检查及单个 Node 路径选择。
- 创建/执行回包不确定时只做独立只读收尾；Execute/RecoverRevoke 后另起进程 Inspect。未证明 Locked 时明确停止，不能自动重试或执行 recovery 写入。

本页不提供可执行的云写入 SHA 或示例批准值；旧窗口与测试 SHA 均不能复用。实际生成清单并获新批准后，才提供绑定准确路径/完整 SHA 的本地命令。Git 持续授权不等于 AWS 写入授权。

## 验证及当前真实状态

定向验证 **85/85 通过**：generation4 创建11项、安装/撤权24项、generation3 退役与 generation4 围栏28项，以及旧 generation3 workflow 22项回归。覆盖 single-submit、旧代批准拒绝、expiry/cancellation、lost Create/Grant/Revoke reply、严格完整清单、双读取、独立 Locked 收尾、永久 intent 与固定槽位，以及真实 PowerShell 旧批准阻断。没有进行全量离线模拟。

`tsc --noEmit` 通过，所有新增/修改 TypeScript 的 ESLint 零错误/零警告，PowerShell parser 通过。测试使用固定时间、内存 provider 或经过路径验证的 OS 临时目录，不触碰实际 AWS 或真实 `.aws-sandbox` 账本。

本阶段唯一真实云检查为既有不可执行 `CheckPreparation`：

- 原件：`F:/ChatGPT_workshop/techlong-j5gj20-generation4-wiring-preparation-readonly-20261004T161055268Z.json`
- receipt SHA：`4d137931d17d0328ca1845a8c0f3765dac80abd0d33c04db063e6e830b8203d8`
- observedAt：`2026-10-04T16:11:04.925Z`（Winnipeg 11:11:04.925 CDT）
- outcome：`EXACT_UNEXECUTED_GENERATION3_PREPARATION_VERIFIED`

独立进程重新加载真实旧三代原件、generation2 retirement proof/永久 intent、generation3 claim，复算 receipt/前驱，核验完整前后清单/Locked/fixture 与精确非执行 scope，通过。准确 generation3 Grant 仍 READY_UNEXECUTED；Locked/v5、execution boundary v1、四个 IAM 资源/两策略/两角色及 trust/attachment/版本未变；Cell MISSING、authority ABSENT，原 fixture READY_UNEXECUTED、资源0。

旧 generation3 slot 仍仅有 `claim.json`，两个新 `.aws-sandbox/j5gj20-read-retirement`、`.aws-sandbox/j5gj20-read-comparison` registry 均 absent。`mutationPerformed`、`approvalWindowOpened`、`manifestCreated`、`deletionAuthorized`、`creationAuthorized` 均 false。此为上述时点的只读检查，不是未来执行清单。

## 下一步

代码准备与推送完成后，先确保 Source/本地 MFA 工具就绪，再按阶段生成 fresh 清单。顺序仍为：generation3 准确退役审阅 → 单独批准唯一 Delete → 独立 Inspect 证明 retired/Locked → generation4 创建审阅 → 单独批准 Create → 独立 RecoverCreate/fresh installation review → 单独批准 Grant/两次读取/立即 Revoke → 独立 Locked Inspect。

不把提交/推送或额外代码测试夹在创建与安装的短时窗口中；云阶段证据归档和推送放在收尾后。现在不自动生成即将过期的删除/创建/安装批准，也不为不存在的新 Grant 打开窗口。10 USD/月仍是预算告警，低成本不代表绝对零费用。
