# B5-J5g-j18：受审安装、固定 MFA 只读对照与立即撤权

本阶段完成控制器、独立 SDK 能力、固定槽位 journal、命令行入口、定向回归及真实 Source-only Review/独立 Inspect。**没有执行云端写入**：未创建或执行 Grant/Revoke Change Set、安装权限、占用 generation2、登录 Operator、删除探针、执行 child、修改 Neon/backend 或创建付费 Cell。新提交仅保存在既有本地 main，推送需准确 SHA 授权。

## 已实现的执行边界

J18 接受准确的 J17 creation review、永久 claim 和独立发现的 full Grant ARN，重新编译所有摘要；没有 claim 或真实 READY_UNEXECUTED Grant 就不生成执行 manifest。历史创建 review 只能用于只读核验，不能转换为新的创建批准。执行清单最多五分钟，必须在候选 policy 到期前保留十分钟撤权余量，并分别绑定 Grant Execute、两次 Operator reads、Source Revoke 的 action SHA 和准确确认短语。

一次 RunReviewed 的顺序为：

```text
Source fresh Locked/fixture/Grant/旧 ledger 核验
  → 固定 MFA Operator 身份准备（至少十分钟会话余量）
  → 再次 Source fresh 预检 → durable run / Grant Execute intent
  → 一次准确 Source Grant Execute → 等待 Grant 终态及完整 IAM 核验
  → 同一候选：一次 full-ARN 请求、一次 exact-name 请求
  → 成功、拒绝、取消、过期或响应丢失后，独立 Source Revoke
  → 两次完整 Locked 回读 → 另起进程只读 Inspect
```

只安装本 generation2 选定的一个 J16 候选；不会自动切换另一候选或执行四格矩阵。每种请求最多提交一次，SDK `maxAttempts=1`，没有授权传播重试。每次 Operator DescribeChangeSet 前后由 Source 完整读取同一已安装 Grant，调用前再核验原 fixture、固定 Operator 身份及磁盘前驱。返回仍必须是原完整 StackId/ChangeSetId、准确未执行 fixture、单一 ProbeHandle Add，以及有效 HTTP/requestId；短名称请求不放宽返回身份检查。拒绝可继续另一个不同请求，传输丢失/漂移/不确定则停止并撤权。

完整 Source IAM 读取使用新增且隔离的 `ArnProbeReadComparisonGrant` 通道，核验两项 managed policy 默认文档、两项 role/trust/attachment/boundary、四个 stack resources、模板和 Cell/authority。原 J11 Delete Grant 及通用 production renderer 不接受这个新形态，原删除编译器和权限不改变。Operator receipt 仅保留摘要、身份和清洗后的分类，不保存原始错误、完整 provider 回复、MFA 或凭据。即使两次读都成功，也不证明授权上下文、根因、Delete 兼容性或生产可用性，所有 readiness/runtime gates 仍 false。

Source 写 capability 仅有准确管理栈的一次 Grant Execute、一次 Locked Revoke Create、一次发现 full ARN 后的 Revoke Execute；没有 child、DeleteStack/DeleteChangeSet、直接 IAM mutation 或 Neon 能力。请求严格重编译，`DisableRollback=false`。AWS [ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html) 接受请求后才启动栈更新，因此不能把一次旧 Locked 回读当作丢失 Execute 响应后的安全结论；本控制器先协调 Grant 终态，再完整核验 IAM。固定 MFA 会话请求 900 秒，符合 [AssumeRole](https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html) 最低时长要求。

## 同一固定槽位，失败不重放

J17 固定路径仍为 `.aws-sandbox/j5gj17-read-comparison/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000002`。未来真实 claim 后，J18 只在该槽位允许以下六份 write-ahead intent：

- `run-intent.json`
- `grant-execute-intent.json`
- `read-full-arn-intent.json`
- `read-exact-name-intent.json`
- `revoke-create-intent.json`
- `revoke-execute-intent.json`

每份绑定准确 claim/manifest/operation/request 摘要、请求及 chronology，必须 wx、fsync、完整 inventory 和严格回读后才能提交对应调用。读取不 mkdir；未知、部分、损坏、链接、缺少前置步骤或更换 manifest 全部阻断，不能自动修复、reset、generation3 或重放。旧 generation1 的 claim/四份 intent、legacy archive 与前驱摘要保持不变。此围栏只适用于这一个本机仓库，不声称跨机器分布式锁或防止有权人员手改 ledger。

Grant Execute intent 写入后，撤权在独立的有界 240 秒流程中运行，不使用用户取消信号或原批准到期条件来跳过；Grant 丢失响应也必须先协调，不接受早期 Locked 作为完成证据。Revoke Create/Execute 各最多一次；持久化 create intent 后找不到目标时只报告 `REVOKE_REQUIRED`，不重新创建。网络、权限、栈漂移或损坏可能让撤权无法完成，控制器不保证总能 Locked，也不把失败写成成功；必须只读协调并按准确 manifest 另行批准 revoke-only recovery。

`RecoverRevoke` 可在原执行窗口过期后运行，但必须有原 run/Grant intent、准确 manifest/revoke SHA 及新批准，且没有 Grant 或 Operator capability。已消费动作只读协调、不补写重试。另起进程 `Inspect` 无 mutation 能力，不能用它代替真实撤权。

## 真实 Source-only 证据

本轮沿用已过期、未执行的 J17 review `f39fca883cfc475c8c94e966686fb867723c61eeaf367c69d93f738064740a7a`，只核对其准确历史身份和当前状态，不批准创建或安装。

| 原件 | 准确摘要 | 结果 |
| --- | --- | --- |
| `F:\ChatGPT_workshop\techlong-j5gj18-source-review-final-202610040018.json` | `0ac1ceeb0d433b4c2a8cbeb3c7625bd882a93ecb6661c65a02620a76a117c6f0` | `PREPARE_FENCED_GRANT_REQUIRED`，manifest/claim 均 null |
| `F:\ChatGPT_workshop\techlong-j5gj18-independent-inspect-202610040019.json` | `c0f75d6fff4ab3ee92424f5391cf5d27aeb512c264f7ba6f3c6cd102a50c5ca1` | 独立 Source `LOCKED_VERIFIED` |
| `F:\ChatGPT_workshop\techlong-j5gj18-independent-artifact-verify-202610040020.json` | `bf70f6b460ec549ae93a6aa18112d50eba4d74f5a873e16ab576e4b46ababaed` | 独立 artifact/磁盘前驱复算通过，无 AWS 调用 |

Review 签发 `2026-10-04T00:15:49.028Z`，独立 Inspect 末管理读 `00:16:01.062Z`、receipt `00:16:01.134Z`（Winnipeg 2026-10-03 19:16:01）。Account `402010193138`、region `ca-central-1`、Source `arn:aws:iam::402010193138:user/techlong-sandbox-dev` 均准确；管理栈仍 UPDATE_COMPLETE/Locked，Operator 默认 v5（保留 v4/v5）、execution boundary v1、Cell MISSING、authority ABSENT。Review 前后与独立 Inspect 的完整模板/IAM/role 证据一致，原 fixture READY_UNEXECUTED、资源0。

完整管理 Change Set 清单证明计划 Grant `techlong-j5gj17-read-grant-b28e96abda11d25b` MISSING；真实 generation2 registry、slot、claim 不存在。新独立验证器 `F:\ChatGPT_workshop\verify-techlong-j18-read-comparison.mjs` 严格重编译 J17 review、复算两份 J18 receipt、比对真实完整管理/fixture证据，再前后读取准确旧 ledger；不补写目录。中间 Review `techlong-j5gj18-source-review-202610040015.json` 仅作保留历史，不是最终绑定完整的 Review。

新增 23 项定向测试（workflow 22 项及隔离 management 通道 1 项），相关 grant/workflow/J16/J17/management 回归共 125/125；typecheck、变更文件 eslint、原 management validator 通过，新测试接入 npm test。测试仅使用独立临时目录/注入 provider doubles，没有真实 ledger writes、全量 build、大规模离线模拟或 IAM simulation。Backend 未修改。

## 下一在线小步骤

先按准确新提交 SHA 授权推送 main；推送后重新生成 **fresh J17 ReviewCreate**，展示新 SHA 与时间窗，并单独批准仅创建未执行 Grant。创建后独立 RecoverCreate 必须证明准确 READY_UNEXECUTED 与管理仍 Locked；再生成 fresh J18 execution review，展示 manifest 及三项 action SHA，另行批准 RunReviewed，用户本地输入固定 MFA，成功或失败立即 Source Revoke，再独立 Inspect。

本轮最终 Review 的 `manifest=null`，不可用于 RunReviewed；旧 J17 SHA/窗口不可用于创建，也不提前占槽以等待审批。保留每月 10 USD 预算及低成本不等于绝对零费用的边界，费用告警不是硬上限；不合并批准 paid Cell、child、探针删除、生产 readiness 或数据库变更。
