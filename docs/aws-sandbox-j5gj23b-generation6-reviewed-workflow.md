# J5g-j23B：generation6 完整受审执行工具

沿用已确定的准确原零资源 fixture Stack 限定 Describe 范围。本轮只接线代码、必要定向验证及真实本地归档/账本核验，没有 AWS/Neon 调用、真实候选或批准窗口、云创建/安装、Operator/MFA 登录，也没有实际 generation6 registry、claim 或 workflow intent。代码提交/推送沿用持续授权；云创建和安装仍分别需要 fresh SHA 明确批准。

## 实现边界

- 独立 generation6 actions/workflow/SDK/CLI，不改写旧 compiler、批准值、权限和工具。紧凑 context 绑定成功退役 proof；入口及重要边界仍完整重读真实旧归档和实际永久退役 intent，不能用摘要代替原件。
- 安装清单必须来自 fresh Source 对准确新未执行 Grant 的完整观察，而不是 pure future action binding。完整 Locked/v7、四个 IAM 资源、角色 trust/attachments/全部 policy、原 fixture singleton 与完整管理库存必须稳定。批准窗口至多5分钟，保留至少10分钟原 policy 截止余量；不延长创建时绑定的30分钟候选窗口。
- 四个准确批准值：Manifest SHA，以及 Grant Execute / 两次 Operator Describe / 立即 Revoke 各自 action SHA。创建批准、旧代批准或展示 SHA 都不是安装授权。入口和 SDK 提交前再次检查 live window；没有默认 SHA 或自动批准。
- 固定 MFA Operator/caller/account，最多各一次 full ARN 和 exact name `DescribeChangeSet`。每次前后 Source 核验完整安装模板/权限与原 fixture；身份再核验、永久 intent 落盘后才提交。准确 ARN/UUID、fixture identity/role/tags/单一 WaitConditionHandle Add 与 HTTP/request ID 必须匹配。拒绝只记录，不做权限传播重试；不确定第一读停止第二读。
- Grant Execute 和准确 Locked Revoke Create/Execute 均单次提交。丢失响应只读收敛，不重发已有 intent；成功、失败、取消或窗口过期后，撤权使用独立限时信号继续。已消费但对象缺失的 revoke-create 不得重建，未认领的外部 Revoke 不得采用。
- Grant 必须先按准确 Change Set 收敛，再读取完整管理模板，不能用旧终态 Locked 根栈快照误判成功。独立 Inspect 若有永久 Grant 执行 intent，也执行该只读收敛屏障；不确定时不签发 Locked 成功。
- 安装后仅接受准确 Grant 或完整原 Locked 模板。恢复 Locked 可产生新 IAM default/version IDs，但默认 policy 文档 SHA、附加/边界用法、trust、资源和 execution boundary 必须精确匹配；不强行要求仍是 v7，不放宽权限。
- 独立管理库存只能含本代准确 CURRENT_GRANT/CURRENT_REVOKE，不过滤或接纳任意旧终态对象。分页、重复、root/rollback/参数/模板漂移均拒绝。
- revoke-only 恢复单独批准，必须有原 run/Grant intent；允许安装窗口过期，但不构造 Operator 登录或 Grant 执行能力，不重放读取/撤权或自动下一代。收尾始终另起 Source-only Inspect 进程。

## 固定账本与入口

唯一固定目录仍为：

```text
.aws-sandbox/j5gj23-stack-control/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000006
```

在 J23A 的普通单链接、bounded/stable 读取和永久 claim 上增加六步 journal：`run`、`grant-execute`、`read-full-arn`、`read-exact-name`、`revoke-create`、`revoke-execute`。完整 manifest/action/request/claim SHA、窗口、次序与前置关系必须一致；每步 `wx`、fsync、完整回读后才能进入下一动作。并发 run intent 只有一个赢家；读取不能晚于 Revoke intent。重复、部分/损坏、未知路径/代数、hardlink/junction 都拒绝，不修复、复位或重试；构造或读取 slot 本身不创建目录。

- 核心：`arn-probe-stack-control-generation6-actions.ts`、`arn-probe-stack-control-generation6-workflow.ts`、`arn-probe-stack-control-generation6-storage.ts`，位于 `lib/deployments/execution/`。
- SDK：同目录 `aws-sdk-arn-probe-stack-control-generation6-workflow.ts`，共享完整 IAM collector 仅增加独立 generation6 读取通道，不改变旧通道。
- CLI：`ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-control-generation6-workflow.ts`，互斥 `Review` / `RunReviewed` / `RecoverRevoke` / `Inspect`。
- 本地批准：`ops/aws-sandbox/scripts/Invoke-ReviewedGeneration6ReadControl.ps1`，仅 Execute / RecoverRevoke 参数集。Execute 要求人手明确提供四个 SHA，finally 另起独立 Source-only Inspect；不自动恢复。
- 已有 `Invoke-ReviewedGeneration6Create.ps1`：单次受批创建，finally 独立 RecoverCreate；只有证明 `READY_UNEXECUTED` 后立即 Source-only Review，并展示四个 SHA 和 UTC 截止。展示不授权安装/Operator；不会在云创建后插入代码、测试或 Git 工作。

新入口采用600,000 bytes普通本地 JSON 限制、受保护路径检查、固定 Source 登录凭证链和 SDK `maxAttempts: 1`；无可配置身份/区域/endpoint 或 ambient credential fallback。严格互斥参数、完整 SHA、实际 claim/journal/context 在 SDK/MFA 前核验。PowerShell 继承已验证 UTC/DateTime 模块，Node 完整复算。MFA、凭证、原始 provider 错误不写入证据。

## 验证及本地证据

22项 workflow 测试、13项紧邻 generation6 创建回归、3项共享 IAM 读取/SDK 构造通道回归，共38项通过；全项目 TypeScript 检查及本轮 TypeScript lint 通过。覆盖批准/Source 快照、两种读、拒绝/不确定、取消/过期、响应丢失、立即撤权、独立收敛、revoke-only、磁盘六步持久化/次序/并发、防重放、SDK 原件/库存及 CLI/PowerShell 早拒绝。新增 Inspect 收敛屏障后，测试同步允许该一次只读 settlement，不允许新增写入或重试。耗时旧代整套模拟已停止，仅保留本次涉及的定向共享通道回归。运行：`npm run test:aws:generation6-workflow`。

两个独立本地进程完整加载真实旧归档及实际账本：

- `F:/ChatGPT_workshop/techlong-j5gj23b-generation6-local-preparation.json`。
- `F:/ChatGPT_workshop/techlong-j5gj23b-generation6-independent-local-preparation.json`。
- 均为 `RETIRED_GENERATION5_GENERATION6_PREPARATION_VERIFIED`，receipt SHA 一致：`668ae1efd7a7fdae294586681337acd057d14be1a7aede1a14d82ba0b1bb1bb4`。
- context SHA `426eca37ec3c26bb46f49c142c2294c7690d2b08d73e34efdb840914d65e26eb`，围栏 SHA `21efd42ed85140dceddf19a2d4891ec4b8d0cd015b9750433251a19c7f491949`。
- 原成功独立退役 proof `6a18e4047f492da5459e2c6fac077b310301ef25a9cdaefe61e570b816fd86e3`，实际永久 intent `63f1a488c318337fb8a53a3895b1f261d0f0695c68ee5d50bf2bb9d8b1b4d06e`。
- generation5 claim、generation4 journal 与旧归档未变；generation6 registry absent，没有真实新 claim/intent。

这是本地实读，不是新 AWS 核验。最后真实独立云观察仍为温尼伯2026-10-05 08:43:07 CDT（UTC−05）：成功退役、完整管理空库存、Locked/v7 与原零资源 fixture 未变，Cell MISSING、authority ABSENT。后端仓库未修改。

## 在线下一步

全部工具/验证/推送完成后，进入 fresh Source-only generation6 创建审阅。先确认 Source 会话可用；失效只刷新 Source，不重放旧窗口。实际 Create 仍须新创建 SHA 明确确认，创建后立即独立回读并只读生成安装清单；用户再明确确认新 Manifest 与三项 action SHA，才安装/两次读取/立即撤权。

过期不延长 policy、不复位槽位、不复用旧批准。保持不执行 child、不 DeleteStack、不删除原 fixture、不创建付费 Cell、不打开 Worker/runtime/readiness；低成本不等于绝对零费用，生产兼容性仍未证明。
