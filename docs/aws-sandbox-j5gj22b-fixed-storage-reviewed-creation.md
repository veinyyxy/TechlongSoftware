# J5g-j22B：独立固定账本与受审创建/回读工具（未部署）

沿用用户同意的 J22 Stack-scoped Describe 只读范围、现有 main、保留旧记录、云操作各按 fresh SHA 单独批准的边界。本小阶段将 [J22A 准备契约](./aws-sandbox-j5gj22-stack-scoped-read-control-preparation.md) 接入真实磁盘槽位、受审创建入口和独立 Source 回读；**安装、Operator 两次读取和立即撤权的完整执行链仍留给 J22C，不把创建工具误标为安装工具**。

本轮仅实现和核验代码，没有调用 AWS/Neon，没有 Source/Operator 登录、MFA、新候选窗口、真实审阅清单、云写入或真实新 registry。现在不需要用户刷新身份或批准云写入。

## 本阶段接线

| 入口 | 接入状态 | 边界 |
| --- | --- | --- |
| 固定 generation5 槽位与六步 journal | 已实现 | 只读不 mkdir；一次 exclusive mkdir 胜者；完整 SHA、准确请求及顺序绑定 |
| `ReviewCreate` | 已实现，未实际运行 | Source-only fresh Locked、原 fixture、完整清单；生成未批准创建审阅 |
| `CreateReviewed` | 已实现，未实际运行 | 准确 fresh 创建 SHA/phrase 和四项确认；永久 claim 后最多一次 CreateChangeSet |
| `RecoverCreate` | 已实现，未实际运行 | 独立 Source 只读；过期/丢失回包也不复位或重建 |
| 后续 Grant/两次读取/Revoke action SHA | 纯绑定 compiler 已实现 | 仅供后续 journal 契约，不是 fresh 实读审阅或安装批准 |
| 安装、固定 MFA Operator、立即撤权、独立 Locked 收尾 | 尚未接线 | CLI 没有 Run/Execute/Delete/Operator 入口；J22C 再实现 |

J22A 的候选与围栏描述保持不变，其历史 `persistenceImplemented: false` / `executionImplemented: false` 不是新的安装授权。J22B 创建审阅另以 `persistenceImplemented: true`、`creationToolsImplemented: true` 和 `installationToolsImplemented: false` 明确区分；所有真实执行/readiness gate 仍关闭。

### 固定磁盘状态

位置仍只有 `.aws-sandbox/j5gj22-stack-scoped-read-control/<原 targetFenceKey>/slot-000005`，不按候选或窗口另起槽位。读操作不创建目录。实际创建前使用 exclusive mkdir 占位，以 `wx` 写 claim、sync 并读回；从占位开始，部分写入、进程退出或不确定结果均永久消费，不自动修复。

claim 绑定新审阅/计划/请求/严格关闭前驱 SHA、准确 Stack-only 范围、创建批准和 policy 窗口。最大创建批准 5 分钟，至少保留 15 分钟 policy 余量；后续 action 绑定批准最多 5 分钟、撤权余量至少 10 分钟。不复用旧四代清单或批准。

六个 intent 固定为 `run`、`grant-execute`、`read-full-arn`、`read-exact-name`、`revoke-create`、`revoke-execute`，各一次 `wx`、sync/readback。校验准确 manifest/claim/op/request SHA、完整字段和先后顺序；读取不能在过期或 Revoke intent 后新增。撤权 intent 可在原批准过期后持久化，但不扩展读取/Grant 权限。未知目标/代数/文件、部分 claim、坏 JSON、符号链接/junction、多硬链接、超限文件均停止，不删除或复位。旧四代 claim、intent 和原件不改。

### 创建和独立回读

新候选依然只追加准确原 fixture Stack ARN 上的 Describe Allow，无 ChangeSetName 条件，保留旧资源、trust、删除/执行限制。创建 request 只指向准确管理 Stack ARN，使用新的 `techlong-j5gj22-stack-read-grant-*` 名称、准确模板及 `CAPABILITY_NAMED_IAM`；不创建 Cell、子 Stack 或新增 IAM 资源，不执行 Change Set。

未来审阅和提交前都重新读取完整 Locked/v7 快照、原零资源 fixture 与前后完整 singleton fixture 清单，核对真实旧原件/账本前后未变。管理清单不套用“必须为空”：只有原 generation4 Grant/Revoke 的完整 UUID 可作为已知历史；若仍在清单中，必须分别双 Describe、Original template、准确名称/描述/参数/单一 Operator boundary Modify 和实际 EXECUTE_COMPLETE 终态验证。旧对象缺失只能由真实完整清单证明，不能合成空清单、过滤陌生终态或自动删除历史。

新目标必须唯一、完整准确 ARN、CREATE_COMPLETE/AVAILABLE、准确 Original template 且只修改 Operator boundary。分页、重复、陌生对象、嵌套/导入/Role/rollback 覆盖、模板或前后清单漂移、未完成创建状态均停止，只允许后续只读核对。完整清单前后比较使用真实响应，移除 request metadata 仅为稳定性比较，provider proof 仍散列完整响应。

上述状态与 ARN 字段对照了 AWS 官方 [ChangeSetSummary](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ChangeSetSummary.html) 和 [DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)。这些字段只用于证据核验，不代表原 J21 拒绝根因或兼容性已证明。

创建入口先检查本地 scope/SHA/window/claim，再构造已有严格 Source runtime；仍使用固定 Source login、TLS、无 ambient credential/endpoint 覆盖、SDK `maxAttempts: 1`。只有独立准确创建批准通过且重新 preflight 完成，才永久 claim 并单次提交。占位后过期或取消则零提交、槽位仍消费；提交错误、丢失回包或响应 ID 漂移则记录不确定结果，不能重试。

独立 `RecoverCreate` 不刷新批准，不创建缺失目标，不重建缺失 claim，不安装权限。准确目标不存在为 `MISSING_SLOT_CONSUMED`，确认为 `READY_UNEXECUTED` 也不产生安装/Operator 授权。此阶段没有自动等待或重试未完成目标；可以另起只读回读核对。

CLI 为 `ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control-create.ts`，模式必须显式指定，输入和新输出文件均用绝对路径。只读模式仅允许 `--acknowledge-read-only`；Create 另要求完整 `--approved-review-sha256`、`--execution-phrase` 和四个写入确认 flag。重复/陌生参数、安装模式、批准默认值或 protected 输出路径均拒绝；输出以 `wx` 防覆盖，失败信息脱敏，不保存凭据。

## 验证与真实本地证据

- 首轮新创建/存储 16 项与 J22A 13 项回归共 29/29 通过；追加链接祖先/多硬链接测试单独 1/1 通过，共 30 项。
- TypeScript `--noEmit --incremental false` 与七个相关 TypeScript 文件的 ESLint `--max-warnings 0` 通过。
- 覆盖准确 scope、创建/旧批准隔离、fresh Source 漂移、永久 claim 先于单次 Create、过期和丢失回包、并发占位唯一胜者、部分/坏/未知/链接状态、六步永久请求及时间顺序、完整管理/fixture 清单、历史模板与终态、pagination/未知对象、SDK 单次提交及 CLI 提前拒绝。
- 测试只用固定时间内存替身和专用临时目录，临时目录校验后清理；不使用真实新槽位、SDK 网络或凭据。未运行全量 build 或重复云流程模拟。

真实本地核验脚本：`F:/ChatGPT_workshop/verify-techlong-j22b-local-storage.mjs`。它从原固定 SHA 原件和真实旧账本重新加载前驱，构造新 FS slot 并只读，确认新 registry 仍 absent；没有生成候选、manifest 或时间窗口。

核验报告：`F:/ChatGPT_workshop/techlong-j5gj22b-local-storage-20261004T200350475Z.json`；随后另起进程从真实原件重新加载并核对完整报告一致。

| 绑定 | SHA-256 |
| --- | --- |
| J22B 本地存储准备报告 | `2570ec2050708d33a5673bfbe6584b4ee48d134911454343aae6ee6172e75fbb` |
| 原严格关闭前驱 | `c0a9db665633fd6cbfd29b732bd6099d93cf7ea12aac2e23c506ecb89cc57b63` |
| 未变的原 claim/六步 journal | `6ec0eae446692285efe64e844eca3cb9f9e24ced36d5fb268b8f1ba66872b192` |
| 原 J22A 准备报告 | `37499bf6a771c1ce5bc3fb7523955dd0b027fa5e62110ae7a2087dbe215e0bf1` |

本地核验不是 fresh AWS 证明；仍沿用历史 J20/J21 记录，不能据此直接批准未来云操作。

## 下一阶段 J22C

继续代码接线：独立新管理 Grant renderer/read channel、准确执行前的 fresh Source 审阅、固定 MFA Operator 至多两次 Describe、全结果路径立即 Source Revoke、独立 Locked Inspect，以及过期/丢失/取消后的 revoke-only 恢复。先实现、验证和提交，不部署。

完整链就绪后，才重新 fresh 读取并生成实际创建清单；云创建与安装仍分别按准确 fresh SHA 批准。代码提交/推送继续按持续授权直接处理 main，不新建分支。
