# J5g-j20：generation4 两次读取被拒绝、立即撤权及独立 Locked 收尾

2026-10-04，用户分别按准确 fresh SHA 在本地创建 generation4 Grant，并运行另行批准的安装、两次固定 MFA Operator 读取及立即 Source Revoke。随后 wrapper Inspect、另起 Source-only Inspect 和本地原件/真实账本复算完成。

本阶段安全收尾通过，**不是 compatibility 通过**：run 为 `LOCKED_READ_COMPARISON_RECORDED`，两次读取均为 `READ_DENIED` / `AccessDenied` / HTTP 403；后续独立 Inspect 为 `LOCKED_VERIFIED`。没有执行 child、删除原 probe/Stack、创建付费 Cell、写 Neon 或开启 live Worker/readiness。

## 创建及独立安装批准

generation4 创建准确绑定此前独立 generation3 退役 proof `9956f626d1c03f6393fc263dbf1df3f84a19f2f057443390bd1979764741f5bc`，保留旧三代原件和永久 intent；固定 `slot-000004` 不复位、不重试、不自动 generation5。

- 创建审阅 SHA：`23cd5982d6f3eec53e21c57f16f3070afd7802d8218bf5dde0cb885ac2bbbfb0`。
- plan SHA：`1c6b42c4a6fcabd14049edf61c68bebcbc18ff84fb2b99545a62c690bbdd6bd9`。
- 创建请求 SHA：`c266b2c7cb07541c75433918e4c3a1f20b38586e988d8ed33c73662a6eef27be`。
- 永久 claim SHA：`b1f4c1c51a5a31a1c5865b960817a6a35321740bf6c1952af99186ef9557fa85`，reservedAt `2026-10-04T16:47:04.316Z`，在创建批准到期 `16:48:07.274Z` 前。
- 用户创建 receipt 为 `CREATE_SUBMITTED`；wrapper RecoverCreate 和后续独立 Source RecoverCreate 证明准确 Grant `READY_UNEXECUTED`、Locked/v5 与原 fixture 未变，未批准安装。

准确 generation4 Grant：

```text
arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj20-read-grant-73d3f07f4a4e783a/d17d5404-4931-42d5-a87a-5c01b51bc0eb
```

最初安装 manifest `8a4d8522f437443b54702920802de3b6250ae1f520ff5279561502a94ce229b8` 于 `16:52:26.013Z` 过期，未用于安装；旧清单和批准脚本保留。随后仅 Source 只读刷新同一个 Grant/claim 的执行审阅，并独立复算 manifest、三项 action SHA、完整 Locked/fixture 和全部 intent 缺失。没有重新创建 Grant、重置槽位或延长 policy。

实际安装批准窗口为 `2026-10-04T16:56:39.087Z`–`17:01:39.087Z`（Winnipeg 11:56:39–12:01:39 CDT）。原 policy 到期仍是 `17:13:07.274Z`，安装截止仍是 `17:03:07.274Z`，至少十分钟撤权余量未改变。用户通过本地命令显式提供新完整 SHA，MFA 仅本地终端输入。

| 实际执行绑定 | SHA-256 |
| --- | --- |
| fresh installation manifest | `5ae7757a35c168c2887a3bbb2bb118460ef9fca619c464e14de567daa2f09ee9` |
| Grant Execute action | `38ae589c2120878a99a591e0f504613d544ab723a9ff83040b2b5a61b8779741` |
| 两次 Operator reads action | `797edb50c11355a3e63d8770a34c495e6b8c5b35d49cac75bfbe32a82fbf0e66` |
| 立即 Source Revoke action | `00852e84e4dfb82a586af5976ffaa30f3cb71bc61939aebaaf0c5d57de661ed7` |

## 实际探针与撤权

本轮候选为既定 `EXACT_NAME` variant，Operator 身份为固定 `arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator`。Source 在两次读取前后均观察到准确 Grant 模板/默认 IAM 文档；不能把这些 Source 观察等同于已观察到 AWS 实际授权上下文。

| Operator 请求形式 | observedAt（UTC） | 结果 | AWS request ID |
| --- | --- | --- | --- |
| FULL_ARN_REQUEST | `17:01:19.151Z` | READ_DENIED / AccessDenied / 403 | `3ed2c43d-b5e4-46c7-aacb-18f9d2da9b1c` |
| EXACT_NAME_REQUEST | `17:01:26.172Z` | READ_DENIED / AccessDenied / 403 | `c6e25036-92b6-4369-a019-947876f86759` |

每种形式仅提交一次，未执行授权传播重试。两项 request SHA、manifest SHA、身份及 Source before/after bracket 都与原批准一致；两次结果均在实际安装批准到期前。两项 `providerEvidenceSha256` 均为 null，没有成功读取的 provider body。`authorizationContextObserved=false`、`productionCompatibilityVerified=false`，不能从两个 403 单独确定是资源匹配、条件匹配、传播或其他授权层导致，也不能宣称精确名称或 ARN 已验证可用。

Grant intent 于 `17:00:45.974Z` 落盘，Source 在 `17:01:13.679Z` 观察到准确 Grant/v6。两次读取完成后，Revoke Create intent 于 `17:01:32.972Z`、Revoke Execute intent 于 `17:01:43.391Z` 落盘。撤权继续使用原批准绑定的唯一请求；即使五分钟安装/读取批准已经到期，也只完成其授权的清理，不重放 Grant/reads。

准确 Revoke Change Set：

```text
arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj20-read-revoke-86405217b411a357/e11a7ea6-10f0-4e8a-9160-a57c89987957
```

cleanup 两次 Locked 观察为 `17:02:12.060Z`、`17:02:14.329Z`；run observedAt `17:02:15.605Z`，cleanup `LOCKED_VERIFIED`，顶层流程 failures=[]。这不把两项 `READ_DENIED` 当成功。run 的通用 `mutationPerformed=null` 不是“未发生写入”：实际 Grant/v6 与撤权 Locked/v7 的云观察证明了 IAM 变更与恢复。

## 独立证据与当前真实状态

执行原件均保留在 `F:/ChatGPT_workshop`；真实 `.aws-sandbox` 账本不加入 Git，不提交凭据、MFA 或数据库秘密。

| 原件（相对上述目录） | canonical receipt/review SHA-256 |
| --- | --- |
| `techlong-j5gj20-generation4-create-run-23cd5982.json` | `9983a7964a1bc33b9900c757a3a848752647086f48bc7bd8de8ad2120e3345d0` |
| `techlong-j5gj20-generation4-create-run-23cd5982.recover.json` | `7bf576f30545ce8754362c5e34ac85ebfe831ea4e50b99f0b29df164ab29c33c` |
| `techlong-j5gj20-generation4-independent-recover-20261004T164852706Z.json` | `71005457eae9015e12db43ebfdd524b342edb6b8b3da965cce7d182c594668bb` |
| `techlong-j5gj20-generation4-create-run-23cd5982.execution-review.json`（已过期） | `738f93000932ee13a8a8db17b3bffad61e3326b6480c622bf76c3427ee671042` |
| `techlong-j5gj20-generation4-execution-review-20261004T165628157Z.json` | `b3d2d09df7d9b9f60381ae00bb3c8833da8a269391c2b2231a6648fd22e1f794` |
| `techlong-j5gj20-generation4-execute-run-5ae7757a.json` | `32ab743d159ff3654238bfd04650ac938e24c9478dde80b96c5efec362711471` |
| `techlong-j5gj20-generation4-execute-run-5ae7757a.inspect.json` | `85f8b45e867d650af440e32dab2ab41b43b28bc97c6b0d163d4555d8567165ed` |
| `techlong-j5gj20-generation4-independent-inspect-20261004T170324956Z.json` | `a88547d5a0249bbbac7a273566111b9b087d8fd1eedb3cff5b1bd9ea0c8616ed` |

后续独立 Source Inspect observedAt 为 `2026-10-04T17:03:35.508Z`（Winnipeg 12:03:35.508 CDT），只读、不构造 Operator 会话、不重放 Grant/reads。另起本地进程复算创建审阅/receipt、独立 RecoverCreate、实际执行审阅/run、wrapper 与后续 Inspect 的 canonical SHA；重编译 manifest、验证真实 claim 和六步 filesystem journal、请求/时间顺序以及完整 Source 管理与 fixture，全部通过。此前已独立核验的旧三代退役链由本次 Source CLI 真实 evidence loader 再核验。

最终准确状态：

- Locked 原模板 raw/canonical SHA 均恢复准确 baseline；默认 Operator policy 为 **v7**，默认文档 SHA `2d0664ef47efebdbc9e06038562d116bc2307a8b940f0042d0942a1b18d75938`，保留版本列表 `v6/v7`。非默认 v6 的存在不表示默认 Grant 仍安装，也不授权删除版本。
- execution boundary 默认文档与版本 **v1** 未变；准确四个 IAM 资源、两个策略、两个角色及完整 trust/attachments/boundary usage 稳定。
- Cell `MISSING`、authority `ABSENT`；原 fixture `READY_UNEXECUTED`、资源0、准确 Stack ID/Change Set ARN/模板 SHA 未变。
- wrapper、cleanup 两次观察及后续独立 Inspect 的完整管理对象仅 observedAt 不同，其他字段相等。
- `probeDeleted=false`、`childExecuted=false`、`deleteStackPerformed=false`；`runtimeEnabled=false`、`productionCompatibilityVerified=false`、`retryAuthorized=false`，readiness gates 未打开。

generation4 固定账本目录只有以下七个文件，所有六步 intent 均绑定新实际 manifest；真实加载器验证其不可覆盖与前置顺序。旧 generation3 slot 仍只含原 `claim.json`，原退役记录保留，没有自动创建 successor。

```text
.aws-sandbox/j5gj20-read-comparison/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000004/
  claim.json
  run-intent.json
  grant-execute-intent.json
  read-full-arn-intent.json
  read-exact-name-intent.json
  revoke-create-intent.json
  revoke-execute-intent.json
```

## 下一步与边界

本小阶段已安全闭合，不能重跑本地 Execute 脚本、刷新旧批准、复位槽位或删除/重建管理 Change Set。下一步应先做只读拒绝原因诊断：使用本轮实际请求、安装 policy/条件、身份及 request ID 核对授权链，区分已观察事实与未证实原因；不扩大 IAM 权限、不重复探针、不自动下一代。

真实云删除、创建或安装仍需分别 fresh SHA 独立批准；当前 Git 持续授权只涵盖代码/测试/文档提交与非强制推送。本轮仅更新完成证据与 README，未修改执行代码，沿用上一代码阶段85项定向验证，不重复全量离线模拟。归档和推送在 Locked 收尾之后进行，没有夹入短时云窗口。10 USD/月仍是告警而非硬费用上限；未进行账单读取，不声称绝对零费用。
