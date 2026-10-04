# J5g-j21：generation4 DescribeChangeSet 拒绝的只读诊断

本阶段已完成真实 Source-only 取证及独立本地复算，没有修复部署、扩大权限、再次登录 Operator、重试探针或开启新批准窗口。此前 J20 两次拒绝不是安装/撤权流程失败，当前仍保持准确 Locked/v7；本页区分 AWS 明确报告的拒绝层与尚未证明的根因。

## 本次确认的事实

取证于 `2026-10-04T17:17:42.499Z`（Winnipeg 12:17:42.499 CDT）完成，Source 为 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，区域 `ca-central-1`。只使用既有严格 login provider；SDK `maxAttempts: 1`，拒绝环境凭据/配置/endpoint override，TLS 验证保持开启。

- 实读仍保留的**非默认 v6**，整个 PolicyDocument 与 J20 generation4 准确批准模板相同，canonical SHA `0cf3323a9a746e0779ab41ce44da438d99f08ec55887b9768e0d8da3f962a1b3`。
- 完整 Source 管理前后观察为 `17:17:37.688Z` 和 `17:17:42.420Z`；仅 observedAt 不同，且均与 J20 独立 Locked Inspect 完整对象相同。Operator 默认仍 **v7**，准确 Locked 文档 SHA `2d0664ef47efebdbc9e06038562d116bc2307a8b940f0042d0942a1b18d75938`。
- Operator 唯一 identity-attached policy 和 permissions boundary 同为 `arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary`，没有 inline policy；角色/trust/attachments、四个 IAM 资源及 execution boundary v1 未变。
- 管理 Stack `UPDATE_COMPLETE`，raw/canonical Original 模板均准确 Locked，Cell `MISSING`、authority `ABSENT`。
- CloudTrail 只查询 `2026-10-04T17:01:10Z`–`17:01:30Z` 的 `DescribeChangeSet`，一页7条，无后续 token。只导出两条准确 request ID 匹配的允许字段，不保存原始事件、IP、access key、令牌或任意错误文本。

| 原 run 请求形式及 request ID | CloudTrail eventTime（UTC） | AWS 明确报告 | MFA |
| --- | --- | --- | --- |
| FULL_ARN_REQUEST / `3ed2c43d-b5e4-46c7-aacb-18f9d2da9b1c` | `17:01:18Z` | 准确 fixture Stack 上没有匹配的 identity-based Allow | true |
| EXACT_NAME_REQUEST / `c6e25036-92b6-4369-a019-947876f86759` | `17:01:25Z` | 同上 | true |

两条事件 caller 都是固定 `arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator`，sessionIssuer 是准确 Operator Role ARN，账号、区域与原 run 相同，errorCode=AccessDenied。分类要求完整已知 caller/action/准确 Stack/错误文本严格相等，不从模糊 SDK 错误猜测。两条错误文本 SHA 同为 `75e988f807c2c64501d8fdc0ac3695699ae79eae9d86497fc6a7f823161fd21c`。

本轮不是“忘记带 MFA”或“用错本地 profile”得到的证据：日志明确标记同一固定 MFA Operator。它也不是批准或 policy 已过期导致的请求：事件和 run 均在原窗口内。但不将这些事实扩展为已经排除全部授权层/传播问题。

## 策略与实际请求核对

J20 使用 `EXACT_NAME_CONDITION`。唯一针对 fixture 的临时 `DescribeChangeSet` Allow 为：

```json
{
  "Sid": "TemporaryAllowComparisonChangeSetRead",
  "Effect": "Allow",
  "Action": "cloudformation:DescribeChangeSet",
  "Resource": "arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-arn-compatibility-probe/e5fcb450-bf3d-11f1-8f15-02cdaaa60ec7",
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": "ca-central-1",
      "cloudformation:ChangeSetName": "techlong-sandbox-arn-compatibility-probe-08b7955eb7029b3a"
    },
    "DateGreaterThanEquals": { "aws:CurrentTime": "2026-10-04T16:43:07.274Z" },
    "DateLessThan": { "aws:CurrentTime": "2026-10-04T17:13:07.274Z" }
  }
}
```

两种已批准请求都传同一准确 Stack ARN；一个 ChangeSetName 传完整 provider ARN，一个传上述短名称。原 run 的请求 SHA、Source Grant/v6 前后 bracket、实际 manifest 及六步永久 journal 已重新验证一致。

[AWS CloudFormation 服务授权表](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudformation.html) 为 DescribeChangeSet 列出的必需资源是 stack，并列出 `cloudformation:ChangeSetName`；不能称该动作不支持此条件键，或把仅增加 Change Set ARN Resource 当作已证实修复。准确 Stack ARN 已同时出现在临时 Allow 和 AWS 拒绝消息中。

[CloudFormation IAM 说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html) 将同名条件键与 API 参数关联；它不是这两条请求的实时授权上下文记录。普通 StringEquals 对不匹配/缺失值不能满足 Allow，多个条件需要一并成立，见 [IAM Condition](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html) 和[多条件规则](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-logic-multiple-context-keys-or-values.html)。本轮短名称请求也失败，因此不能继续把“只将完整 ARN 条件改为短名称”当作可用方案。

两条 CloudTrail 记录均未报告 stackName/changeSetName 参数，也未提供实际 `cloudformation:ChangeSetName` 授权上下文。**日志字段未报告不等于条件键缺失**；没有证明 ARN 被转换成短名称，也没有证明短名称条件值错误。

Source 首次观察 Grant/v6 为 `17:01:13.679Z`，两个 run 结果 recordedAt 相距约5.5秒和12.5秒。[IAM 文档说明更新存在传播及缓存延迟](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html#troubleshoot_general_eventual-consistency)；这些时距仅说明传播仍是候选因素，不能认定本次就是传播故障，也不授权自动等待后重试旧槽位。

[AWS 拒绝错误说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_access-denied.html) 提醒：多个策略类型拒绝时错误可能仅报告其中一种。因此本轮确认的是 AWS 报告没有匹配的 identity Allow，并未读取/排除所有 SCP/RCP 或其他授权层。本地固定 AssumeRole 实现没有附加 session Policy/PolicyArns；这也不能代替服务端完整授权决策记录。

结论保持 `authorizationContextObserved=false`、`rootCauseProven=false`、`productionCompatibilityVerified=false`。没有 IAM simulation，不用模拟替代真实兼容性证明。

## 证据与独立验证

原件均保留于 `F:/ChatGPT_workshop`，不加入真实凭据或 MFA。取证脚本只构造 Source 读取/历史 LookupEvents 请求，没有 AWS mutation command、Operator 会话、simulation 或账本写能力；CLI 仅获得同一已核验 Source 的临时凭据，通过子进程环境传递，绝不打印或持久化。

| 绑定项 | SHA-256 |
| --- | --- |
| 本次 diagnostic receipt | `74e70dd6e0ec0e45ddec6fbfe9df813d763f87d3ba7a44e7e1f7b367397968a1` |
| 原 generation4 execution manifest | `5ae7757a35c168c2887a3bbb2bb118460ef9fca619c464e14de567daa2f09ee9` |
| 原 run receipt | `32ab743d159ff3654238bfd04650ac938e24c9478dde80b96c5efec362711471` |
| 原独立 Locked Inspect receipt | `a88547d5a0249bbbac7a273566111b9b087d8fd1eedb3cff5b1bd9ea0c8616ed` |
| 本次前后 generation4 claim/六步 journal snapshot | `6ec0eae446692285efe64e844eca3cb9f9e24ced36d5fb268b8f1ba66872b192` |

- 取证入口：`diagnose-techlong-j21-generation4-describe.mjs`；Node parser 检查通过。
- 原件：`techlong-j5gj21-describe-diagnostic-20261004T171730270Z.json`。
- 独立验证入口：`verify-techlong-j21-generation4-describe.mjs`；另起进程复算 receipt/模板/manifest/真实旧三代退役链、角色/策略/请求/时间窗、两条准确事件、MFA、前后管理状态与真实六步 journal，并检查敏感字段未导出，通过。验证入口不读取凭据、不联网、不写账本。

generation4 slot 仍准确七个文件（claim 加六步 intent），snapshot 前后相同且与独立重新读账本相同；所有固定槽位永久消费，不能重放或生成下一代。generation3 退役 proof/真实永久 intent 与前驱链相同。现有原件不覆盖、旧记录不删除。

本次没有再次读取原 fixture，原 fixture READY_UNEXECUTED/资源0/准确 ARN 和模板的证明引用 `17:03:35.508Z` 的 J20 独立 Inspect，不冒充本次 fresh fixture 检查。新鲜实读覆盖当前完整管理/IAM/Cell/authority，以及上述历史 CloudTrail 事件。

本次 `mutationPerformed=false`、`iamSimulationPerformed=false`、`operatorSessionCreated=false`、`probeAttemptedByDiagnostic=false`、`newWindowOpened=false`、`retryAuthorized=false`、`runtimeEnabled=false`。执行代码/旧 compiler 未修改；只做必要只读取证、独立复算和文档归档，没有重跑全量离线模拟。Git 按用户持续授权直接提交及非强制推送，不等同于 AWS 授权。

## 下一阶段建议（仅供审阅，尚未实现或批准）

当前只读证据无法观察缺失的 IAM 决策上下文，不宜继续反复使用同一个条件重建候选。建议先由用户明确同意下列**新的只读对照范围**，再实现独立受审入口：

1. 仅针对准确原零资源 fixture Stack 的 `DescribeChangeSet`，临时对照 Allow 不附加 `cloudformation:ChangeSetName` 条件；仍要求准确 Stack ARN、ca-central-1 和严格时间窗，不使用 Resource `*`。这会将该 Stack 内的只读权限从条件限定变为 Stack 限定，属于有意义的授权范围变化，不能默认批准。
2. 保留所有原删除/执行权限条件，不改成 IfExists、不放宽 DeleteChangeSet/ExecuteChangeSet/DeleteStack，也不把只读成功当作写权限证明。
3. 重新核验同一零资源 fixture 与完整唯一对象清单；只在新的独立围栏和 fresh SHA 分别批准后，固定 MFA Operator 至多各一次 full ARN/exact name Describe，无授权失败后自动重试。可单独审阅有界传播等待，但等待不证明传播完成，不延长原 policy/批准窗口。
4. 原记录及 consumed slot 不复位；任何新代、必要的管理对象处理、创建或安装均按各自准确清单批准；成功/失败/取消后立即 Source Revoke 与独立 Locked 核验，所有生产 gates 仍 false。

该对照用于缩小“ChangeSetName 条件”与其他因素的排查范围，不保证成功或单次证明根因。此页没有新候选模板、执行 SHA、批准命令、窗口、账本或云安装；也未联系 AWS Support 或创建外部工单。用户未同意这个新范围前，保持 Locked 并停止进入实施阶段。低成本仍非绝对零费用，10 USD/月仍是告警不是硬上限。
