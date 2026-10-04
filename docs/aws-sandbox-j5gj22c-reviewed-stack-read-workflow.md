# J5g-j22C：Stack-scoped Describe 完整执行工具（未部署）

本阶段沿用 J22A/B 已同意的准确 Stack-only Describe 范围，完成安装、固定 MFA Operator 至多两次读取、立即 Source 撤权、独立 Locked Inspect 和 revoke-only 恢复的代码接线。保留旧记录、现有 main 和所有关闭的运行门禁；实际创建与安装仍分别需要 fresh SHA 批准。

本轮没有 AWS/Neon 调用、Source/Operator 登录、MFA、云写入、真实新 claim/intent 或真实候选/批准窗口。代码工具就绪不等于权限已安装，也不证明 J21 拒绝根因或生产兼容性。现在不需要刷新身份。

## 完成的执行链

| 入口 | 功能 | 边界 |
| --- | --- | --- |
| `Review` | 已创建准确 Grant 的 Source-only 安装审阅 | fresh 完整 Locked/v7、原 fixture、完整清单和真实 claim；不登录 Operator、不写云 |
| `RunReviewed` | 一次 Grant Execute、至多两种准确 Describe、立即 Revoke | manifest 与 Grant/Reads/Revoke 三项 action SHA 均须单独完整批准 |
| `Inspect` | 独立 Source 管理/IAM、原 fixture 和完整清单回读 | 原 manifest/claim 绑定，不依赖运行回包，不写云或登录 Operator |
| `RecoverRevoke` | 原运行的撤权专用恢复 | 原 run/Grant intents 和单独 manifest/Revoke SHA 批准；不重放 Grant/Operator |
| 本地 PowerShell wrapper | 分开的 Create、Execute、RecoverRevoke 参数集 | 无默认 SHA；Execute/Recovery 后另起进程只读 Inspect；没有自动批准或重试 |

执行 CLI：`ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-scoped-read-control-workflow.ts`。
本地批准 wrapper：`ops/aws-sandbox/scripts/Invoke-ReviewedStackScopedReadControl.ps1`。
创建 CLI 继续使用 J22B 的独立 `s3-b5-arn-probe-stack-scoped-read-control-create.ts`。

### 创建与安装批准不混用

J22B 的纯 future-action 绑定保持原 action/schema/hash 和 `installationToolsImplemented: false`，不能直接执行。J22C 使用独立 `REVIEW_STACK_SCOPED_READ_WORKFLOW`，完整绑定 fresh Source observation、准确未执行 Grant ARN、真实 claim、关闭前驱和三项 action SHA。`installationToolsImplemented: true` 只是工具状态，`executionApproved`、生产兼容性和 runtime 仍为 false。

安装批准最多 5 分钟，并至少保留 10 分钟 policy 撤权余量。MFA 前、之后、每种读取前及最终 SDK Grant 提交前均重新检查时间/身份；异步校验期间到期也不能提交 Grant。创建批准仍独立，不能由安装 SHA、旧代清单或旧运行回包替代。

实际 Create 前永久占用 generation5 的同一个 `slot-000005`，随后每项动作先持久化准确 request/claim/manifest/op SHA 的一次性 intent。J22C 绑定完整 Source manifest，B 的纯绑定仍可按原契约读取，但不能冒充执行清单。任一工作流 intent 已存在，就不能生成新执行审阅窗口或重放；旧槽位、坏/部分/未知/链接状态不自动复位或修复。

### 独立管理与 Operator 通道

新增专用 `StackScopedReadControlGrant` 管理回读通道，严格重编译 J22 plan 并读取完整管理 Stack、四个 IAM 资源、两个角色/trust/attachments、两个 policy 默认文档。旧 J11/J18/generation4 和生产 lifecycle reader/compiler 不扩大接受范围。

新通道只允许准确 J22 Grant 或准确 Locked 模板；execution boundary、角色/trust、附件和资源须与关闭前驱一致。Operator policy 的版本号允许本次安装/撤权造成的正常推进，但默认文档 SHA 必须匹配准确目标模板；不能把旧 v7 号硬套到新撤权结果，也不能只看模板而忽略 live IAM。安装前的 Source admission 仍须完整匹配原 Locked/v7。

固定 MFA Operator 使用既有准确 role/session，只能提交一次完整 ARN Describe 和一次精确名称 Describe，合计最多两次。每次前后用 Source 完整 Grant 快照夹住，核对原零资源 fixture 与完整 singleton 清单。403 可作为两种分别批准的请求证据，但不做权限传播重试；不确定结果停止后续读取。成功必须核对准确 fixture、状态、标签、单一 WaitConditionHandle Add 和 HTTP/request ID；保存摘要及脱敏结果，不保存 MFA、凭据或原始错误。

### 撤权和异常恢复

Grant intent 后无论成功、拒绝、到期、取消或回包丢失，都进入独立 Source 撤权路径。撤权使用自己的有界信号，不被主读取的取消/到期信号取消。若 Grant 提交结果不确定，先只读等待准确 Grant 结算，不能凭尚未执行完的旧 Locked 回读宣布清理完成。

撤权仅创建一次准确 Locked Change Set，再以独立清单发现的完整 ARN 执行一次。创建/执行回包丢失后只读核对，已有 intent 从不重提交；缺失对象且 intent 已消费、无 intent 的现存对象、外来模板/trust/清单漂移都阻止自动恢复。最终用两次完整 Locked 管理/IAM 回读证明稳定，再核对原 fixture 和旧原件/claim。

`LOCKED_STACK_READ_CONTROL_RECORDED` 表示执行记录与 Locked/fixture 收尾完成，不表示两次 Describe 一定成功。若权限已 Locked 但 fixture 收尾未证明，结果是 `LOCKED_RECONCILIATION_REQUIRED`；若 Locked 未证明则为 `REVOKE_REQUIRED`。不能把失败回包、截止时间或模板单独当作撤权证明。

revoke-only 恢复可在原批准过期后使用，但必须另行提供原 manifest/Revoke 的准确批准；只具备撤权能力，不构造 Operator 会话、不安装 Grant、不读取重试、不删除资源。即使无法完成也保留原 intents 和失败证据，交由只读核对，不自动重建/下一代。

独立 Inspect 核对完整准确 Stack 的前后稳定清单：仅允许原 generation4 完整 UUID 历史和本次准确 Grant/Revoke。现存历史必须验证实际 EXECUTE_COMPLETE 与 Original template；缺失须由完整真实清单证明。陌生终态不被过滤，分页、重复、未知对象、Role/rollback/嵌套覆盖和前后漂移均阻止核验。

## 验证与真实本地证据

- J22C 17 项定向测试：首轮 14/17 通过；修正三个测试夹具的 observation 字段、过期后的证据新鲜度断言和只读结算事件断言后，分别定向重跑通过。新增最终 SDK 提交时钟拦截、独立 Inspect 的完整 Stack 清单校验后，直接相关用例另行重跑通过。
- 另选取 4 项管理通道和 2 项旧六步 journal 回归通过，共 23 个不同用例。覆盖完整 Source manifest、独立批准、成功/拒绝/不确定读取、窗口/取消、丢失 Grant/Revoke 回包、禁止重放、撤权专用恢复、live IAM/旧通道隔离、磁盘 journal、完整 SDK 清单、单次 SDK 提交和 CLI/PowerShell 提前拒绝。未重复运行全量部署模拟或 build；测试只使用固定时间替身和经过路径校验的临时目录，不使用真实新账本或网络。
- TypeScript `--noEmit --incremental false`、11 个相关 TypeScript 文件 ESLint `--max-warnings 0` 和差异格式检查通过。具体最终测试计数在 README 最新记录中。

真实本地复算脚本为 `F:/ChatGPT_workshop/verify-techlong-j22c-local-workflow.mjs`；报告为 `F:/ChatGPT_workshop/techlong-j5gj22c-local-workflow-20261004T205200000Z.json`。它重新加载固定原件/真实旧账本，核对新 FS slot 的只读行为、registry absent 和九个执行源文件 SHA；随后另起进程独立复算。只加载工具导出，不执行 Review/Run/SDK 或生成新窗口。

| 绑定 | SHA-256 |
| --- | --- |
| J22C 本地工具准备报告 | `9b600de6002a09e813e48bf6c7c7c0c0425c19bd2cc4e584999d53be70446483` |
| 原严格关闭前驱 | `c0a9db665633fd6cbfd29b732bd6099d93cf7ea12aac2e23c506ecb89cc57b63` |
| 未变的原 claim/六步 journal | `6ec0eae446692285efe64e844eca3cb9f9e24ced36d5fb268b8f1ba66872b192` |

以上是本地完整性证明，不是 fresh AWS 状态证明，也不是任何实际云批准。

## 下一阶段

下一步转回受控在线：fresh Source-only admission，核对准确 Locked、原 fixture、完整历史清单和本地 registry absent，生成实际创建审阅清单。只有该清单 fresh SHA 经单独批准后才一次创建未执行 Grant；独立 RecoverCreate 后再生成安装清单，manifest 和三项 action SHA 再单独批准，才运行两次读取/立即撤权/独立 Inspect。

不执行 child、不 DeleteStack、不删除探针或历史、不创建付费 Cell、不改 Neon、不打开 Worker/readiness。费用接受低成本但非绝对零；每月 10 USD 是费用控制目标，不被当成 AWS 绝对硬上限。代码继续按持续授权提交/非强制推送两个现有 main 中实际有变更的仓库，不新建分支。
