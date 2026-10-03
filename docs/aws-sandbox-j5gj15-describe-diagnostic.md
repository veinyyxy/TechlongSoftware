# B5-J5g-j15：DescribeChangeSet 拒绝的只读诊断

本阶段完成只读取证，不是修复部署或新的执行批准。`309c92afe37e7369909166be59351a57a32bd672` 已按用户明确授权推送到 `github/main`，独立 `ls-remote` 确认完整 SHA 一致。

## 已确认的事实

- 固定 Source 身份 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`、区域 `ca-central-1` 于 `2026-10-03T21:43:24.311Z`（Winnipeg16:43:24）完成取证；仅使用受审 login provider，无其他凭据来源、AssumeRole 或 MFA。
- IAM 实读保留的非默认 Grant v4，整个 PolicyDocument 与原 claim plan `126e3c22a3337e1fdc823f42dc5b92f7002e9fa4466461eaeb118e3db604e051` 严格相同，canonical SHA `3e309e9f6635a02d177aa2b7198fde6602e16391abe1e7e7db351971db3e997e`。这不是仅对本地模板的检查。
- Operator 当前唯一 identity-attached policy 和 permissions boundary 都是 `arn:aws:iam::402010193138:policy/TechlongSandboxCellOperatorBoundary`，无 inline policy。默认仍 v5，整个文档等于准确 Locked，canonical SHA `2d0664ef47efebdbc9e06038562d116bc2307a8b940f0042d0942a1b18d75938`；管理栈 `UPDATE_COMPLETE`，实读 Original 模板原始摘要与原 plan 的 Locked 撤权目标相同。
- Source 对 CloudTrail 的一次完整、无后续 token 的查询固定在 `21:22:40Z–21:23:10Z`，共14条 DescribeChangeSet事件；只导出三条匹配 requestId 的允许字段，不保存原始事件、IP、access key、令牌或任意错误文本。

| Run requestId | CloudTrail eventTime（UTC，秒级） | AWS 明确报告 |
| --- | --- | --- |
| `5bb50c3e-2f27-4213-81df-7cb458ad4391` | `21:22:52Z` | 精确 fixture Stack 上没有匹配的 identity-based Allow |
| `816e4b72-de4b-4c2b-93fb-7c3336b5be3c` | `21:22:55Z` | 同上 |
| `3660adf1-3de3-49a4-aa42-a67c7ab8e849` | `21:22:57Z` | 同上 |

三条事件 caller 都是固定 `arn:aws:sts::402010193138:assumed-role/TechlongSandboxCellOperatorRole/techlong-sandbox-cell-operator`，区域和 account 相同，errorCode 均为 AccessDenied。分类只接受完整、已知 caller/action/exact Stack/denial 文本严格相等，不从 SDK 错误猜测。三条相同错误文本 SHA 为 `75e988f807c2c64501d8fdc0ac3695699ae79eae9d86497fc6a7f823161fd21c`。

请求都在原 Grant 和删除 cutoff 窗口内。按未变更的真实 gate 执行顺序，每轮先完成 Operator identity、DescribeStacks、ListStackResources、GetTemplate，再到 DescribeChangeSet 被拒绝；不是登录失败、审批过期或探针缺失证据。不能据此排除所有 IAM 传播或其他策略层问题。

## 条件键假设与证据限制

实际 v4 的唯一 fixture DescribeChangeSet Allow 使用精确 StackId（及附加 Change Set ARN）作为 Resource，区域和时间限制外，还要求 `StringEquals` 的 `cloudformation:ChangeSetName` 等于原 probe **完整 ARN**。DeleteChangeSet 的 Allow 同样使用该条件，但本轮没有提交 Delete。

[AWS 服务授权表](https://docs.aws.amazon.com/zh_cn/service-authorization/latest/reference/list_awscloudformation.html) 列出 DescribeChangeSet 和 DeleteChangeSet 的必需资源类型为 stack，并支持 `cloudformation:ChangeSetName`；不能称 DescribeChangeSet 不支持该条件键，也不能把仅增加 Change Set ARN 到 Resource 当作修复。原策略已经包含 AWS 拒绝消息中的准确 StackId。

[DescribeChangeSet API 文档](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html) 允许 ChangeSetName 参数传名称或 ARN；[CloudFormation IAM 说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html) 说明条件键关联同名 API 参数。这不证明此次 ARN 请求的实时 IAM 上下文值就是原 ARN，也不证明它一定被规范化为短名称。

[IAM 条件规则](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition_operators.html) 中，普通 StringEquals 对缺失或不相等的上下文值不匹配。因此“完整 ARN 条件在服务端未匹配”是优先待验证假设。三条 CloudTrail 事件未报告 stackName/changeSetName 参数，也未提供授权上下文；**日志字段未报告不等于 IAM 条件键缺失**。当前 `authorizationContextObserved=false`、`rootCauseProven=false`，不将假设写成已确认的 ARN→短名称转换；无 IAM simulation，不以模拟证明 live compatibility。

## 证据与不可重放状态

取证原件 `F:\ChatGPT_workshop\techlong-j5gj11-describe-diagnostic-202610032144.json`，receipt SHA `2a07492d7b2415030b78a7fe709de72bd9564d832e41eeb666af68be8245e222`。本机只读入口 `F:\ChatGPT_workshop\diagnose-techlong-j11-describe-1969abf2.mjs` 无任何 AWS mutation command、AssumeRole、Operator session、simulation 或 journal 写能力；CloudTrail CLI 使用同一已核验 Source 临时凭据，只允许固定 LookupEvents 请求、单次请求不重试、最多三页，不输出原始 CLI 错误。没有安装新依赖。

另起进程 `F:\ChatGPT_workshop\verify-techlong-j11-describe-diagnostic.mjs` 复算取证摘要、完整计划政策摘要、准确两个临时 statement、三条 requestId/时间窗，并调用历史 Run 验证器再次核对原 archive、claim 和固定 slot。旧六份 archive SHA 仍 `c394afcd50d963af258b93ed2f8b3bc071582f67f4d08ea08bfaf0c597b4f916`，四步 journal SHA 仍 `5928f40e8148127269e9acb315c91d86d505375b0127493829e156592e238d59`，probe-delete intent 仍不存在；slot 已消费，不复位/修复/再次运行。

Cell MISSING、authority ABSENT、原 probe READY_UNEXECUTED/资源0 的完整独立证据仍引用上一轮 `21:27:33.208Z` 的 Inspect receipt `7859a669a4ed5b464bba86145daeebf21463874779ac6ed6841dd534db10eb88`；本次不把这些状态冒充新全量 Inspect。新实读确认的是当前管理模板和 Operator v5 Locked。原 Grant 及执行审批不因只读诊断而延长。

本阶段仅新增只读本机取证文件和状态文档，没有修改执行器/Grant compiler，没有 AWS/Neon 写入、新 Grant、DeleteChangeSet、child Execute、DeleteStack、付费 Cell 或槽位变动。所有 compatibility/readiness/runtime gates 仍 false。验证本机脚本语法和独立证据复算，不重复此前799/799离线云模拟，也不声称重新执行了该全量测试。

## 下一步

先准备一个**未部署的独立只读对照候选及审阅方案**，区分 API 请求标识与 IAM 条件键名称语义。优先审查 exact-name 条件的只读对照，不把删除规则改成短名称、不移除或改用 IfExists 来放宽删除条件，不把只读成功当作 Delete 授权证明。

任何新的授权窗口或固定槽位 generation 都属于新的审阅范围，必须显式继承旧 consumed slot/archive，并取得单独、准确的批准；目前没有批准、实现或创建新的 generation，没有新的 cloud write 清单。只读诊断完成不授权自动重放、重建 fixture、安装权限或 AWS Support 外部协调。
