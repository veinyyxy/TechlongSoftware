# B5-J5g-j16：未部署的独立只读对照候选

本阶段按“开始下一步”完成候选编译、Source-only只读审阅和独立证据复算。没有推送尚未获准的提交，没有创建/执行 Change Set、安装 IAM 权限、Operator AssumeRole/MFA、删除、Neon 写入或新槽位。

## 候选与读请求分离

两个候选都从准确 Locked 模板开始，不从旧 Delete Grant 改写；只在既有 Operator policy 末尾增加两条只读 Allow：精确 fixture Stack 的 DescribeStacks/ListStackResources/GetTemplate，以及精确 Stack 的 DescribeChangeSet。两个 IAM 文档唯一差异是后者的普通 StringEquals 条件值；无通配、IfExists 或无条件 fallback。execution boundary、两个 Role/trust、Parameters/Conditions 均不变；原 Delete Grant compiler 和删除全 ARN 规则没有修改。

| 互斥 IAM 候选 | `cloudformation:ChangeSetName` 条件值 | 提议的 API 对照 |
| --- | --- | --- |
| `FULL_ARN_CONDITION` | 原 fixture 完整 Change Set ARN | 完整 ARN / 精确短名称，各最多一次 DescribeChangeSet |
| `EXACT_NAME_CONDITION` | 原 fixture 精确 Change Set 名称 | 完整 ARN / 精确短名称，各最多一次 DescribeChangeSet |

四个提议请求均显式绑定原精确 StackId；即使请求传名称，未来回读仍必须核对原完整 StackId/ChangeSetId/ChangeSetName。两候选必须分开安装和撤权，不能同时挂载而混淆 Allow 来源。[DescribeChangeSet API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html) 支持名称或 ARN 参数，但本阶段没有执行这四个 Operator 请求，不推断上下文转换、删除授权或生产 ARN 兼容性已证明。

这不是可执行清单：输出使用 `proposedTemplateBody`，不生成 AWS Create/Execute/Delete request 或执行短语；`allowedWriteActions=[]`，`generationProposal=null`、`fenceImplementationAvailable=false`、`operatorReadExecutionImplemented=false`。J9/J10/J11/J14 原写入口不接受新 stage/plan。提议政策30分钟时间窗只存在于未部署的 JSON 中，五分钟 Review 也不授权任何写入。

## 已消费前驱和真实 Source 审阅

新的只读磁盘 loader 固定核对 J14 creation review、原 claim、J11新manifest/Run/独立Inspect、J15诊断、旧六份archive及当前四份journal摘要。只接受同一targetKey下唯一 `slot-000001` 及准确五个文件，缺失 probe-delete intent 是已阻断且已消费状态；新目录、未知文件、链接、损坏/部分记录、摘要或时序漂移全部fail closed，不创建/修复/清理。文件只读、最多600KB，输出不能放入 `.aws-sandbox` ledger。Prepare不加载AWS运行时；Review只构造固定Source的read adapter和读取Command，拒绝凭据/config/endpoint覆盖及关闭TLS，SDK `maxAttempts=1`，无mutation/Operator能力。

实际 Prepare receipt SHA `ad8e317d541231db37c1d3c55dad777936be25db3dd190aa0566fdb47a8c00ad`，原件 `F:\ChatGPT_workshop\techlong-j5gj16-read-comparison-prepare-202610032225.json`。真实 Source Review 于 `2026-10-03T22:23:14.848Z`（Winnipeg17:23:14）完成，review SHA `aebf0799583df1d91e867d974ab563a6e13d186d9091f487403d209f406cc980`，candidate plan SHA `8cf8ae7c64ff0bc8aebaf5bf4d5c864cca081b3683e61e85a6590c4874506614`，原件 `F:\ChatGPT_workshop\techlong-j5gj16-read-comparison-review-202610032227.json`。Review 到期 `22:28:14.848Z`，不把历史审阅用作下一轮创建/安装授权。

Source前/后 `22:23:11.558Z` / `22:23:14.818Z` 均准确Locked，Operator默认v5、execution boundary v1、Cell MISSING、authority ABSENT、Role/IAM/模板稳定；前后管理Change Set清单完整且均空。fixture末读 `22:23:12.776Z` 仍原READY_UNEXECUTED/资源0，原模板和两个前后读身份一致。旧archive、原claim及四份intent前后相同，没有generation2或任何新registry/slot。这个新全量Source证据替代此前“只确认管理IAM”的状态限制，但仍不证明Operator读取或删除权限。

| 候选 | 模板 canonical SHA | Operator policy canonical SHA |
| --- | --- | --- |
| Full ARN | `4bc39924ea3cce4926f369b22163869aaf3b3d579edeb797fbef4e4175791869` | `556e577ea13d7ac13ec0582e7694a4459305fdcbce22c4995b98027e949935a5` |
| Exact name | `d8d1cff0f0385144c2cbee6adaefef2e9e56e80efa93a015e2536539506452a9` | `ea18a4c8836efe86ef9baff2b27be1a35b30499240b6124120e3b07be09ce613` |

另起进程 `F:\ChatGPT_workshop\verify-techlong-j16-read-comparison.mjs` 严格重编译两个plan、校验Review摘要/身份/时间窗/前后观察，复算每个完整模板和政策摘要/只读增量/Role不变，再次从磁盘核对新旧前驱，均通过。新代码11项定向测试和原Grant/workflow回归合计64/64；typecheck、变更文件eslint、原management模板验证通过。新测试已接入npm test；未为本轮重复完整build/全量离线云模拟，未执行IAM simulation。

## 下一阶段边界

先审阅并实现独立只读对照所需的固定fence和creation-only受审入口；任何新generation必须显式继承已消费前驱并经准确批准，不能复用/清空原slot或用nonce/time绕过。之后才另行fresh审阅、准确批准未执行Grant创建，以及独立的Grant安装/固定MFA Operator只读对照/立即Source Revoke。新读候选不含DeleteChangeSet/ExecuteChangeSet/DeleteStack；不能退回旧J11删除流程进行对照。所有provider/production compatibility、registration/readback/apply/cleanup runtime gates继续false。
