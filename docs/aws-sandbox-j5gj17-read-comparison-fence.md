# B5-J5g-j17：独立只读候选的固定 generation2 与 creation-only 入口

本阶段完成代码、定向测试、真实 Source-only 审阅和另起进程的独立只读验证。没有占槽、AWS/Neon 写入、创建或执行 Change Set、安装权限、Operator MFA/AssumeRole、删除资源或付费 Cell。新提交仅保存在既有本地 main，推送另行授权。

## 固定围栏，不是重放原 J11

J14 原 `slot-000001`、原 claim 和四份 intent、J10/J11 旧 archive 全部保留。新 fence 显式标记 `priorGeneration=1`、`generation=2`，固定继承 J16 的全部前驱锚点及其 snapshot SHA；仍使用同一个 targetFenceKey。新路径固定为：

```text
.aws-sandbox/j5gj17-read-comparison/
  9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/
    slot-000002/claim.json
```

独立 namespace 保持原 generation1 loader 的严格完整清单不变，不向原目录加入文件，也不把缺少 probe-delete intent 当作可重试。候选、时间窗、清单 SHA、Change Set 名称和 ClientToken 不决定物理槽位；两个候选与所有后续审阅竞争同一个 generation2。仅支持这一固定 generation，没有 generation3、自动换候选、nonce fallback 或 reset/repair/delete API。只有获批的 CreateReviewed 才 mkdir；ReviewCreate/RecoverCreate 都不建目录。

创建前必须有完整、准确且未过期的五分钟审阅、四项明确 ack 和精确 SHA/phrase，再重新进行 Source-only Locked/空清单/原 fixture/磁盘前驱核对，并比较审阅时 IAM/Role/模板证据。候选模板不能被新预检重新生成的窗口替换。之后 exclusive mkdir 抢唯一槽位，claim 使用 wx、fsync、严格回读，绑定准确 review/plan/request SHA、variant、前驱及时间窗；完成持久化才可能提交一次 AWS 请求。并发输家、已有槽位、未知目录/文件、链接、损坏或部分 claim 全部 fail closed，不能恢复为“空闲”。这只是单个本机仓库的围栏，不声称为跨机器分布式锁，也不能抵御有权手动篡改本机 ledger 的操作者。

## 受审创建与只读恢复分离

J17 编译器只选一个 J16 模板；本轮审阅选 `EXACT_NAME_CONDITION`，Full ARN 是替代选项而非同时挂载或自动下一轮。原四格矩阵仍只是提议；本 generation2 不能授权两份候选都创建/安装。任何将来另一个 generation 必须再次显式审阅并实现，不能本脚本自动选择。

唯一 AWS 写能力是一次准确管理 StackId 上的 `CreateChangeSet` UPDATE，`CAPABILITY_NAMED_IAM`、三个 UsePreviousValue 参数、准确 TemplateBody、固定推导名称/ClientToken；不传 RoleARN/TemplateURL，不允许 nested/import/替换角色。策略增量仍只有读 Allow，没有 Delete/Execute/写探针。创建与安装不同：[CreateChangeSet API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html) 不应用计划中的资源变更，必须另行 Execute 才会实施；本入口没有 Execute 权限通道。

SDK `maxAttempts=1`，adapter 还在进程内限制 single-submit。成功为 CREATE_SUBMITTED；响应丢失/身份不符为 CREATE_UNCERTAIN，mutationPerformed=null；claim 后取消或过期可为 NO_CREATE_SUBMITTED_SLOT_CONSUMED。所有情况均保留消费槽位，receipt 丢失也不授权重试。入口异常保守记录需要只读协调，不把不确定状态写成“肯定无 mutation”。没有自动清理 Change Set、重新提交或回滚旧槽位。

RecoverCreate 不要求旧批准窗口仍有效，但要求完整 claim 与原 reviewed request 严格一致；无 claim/部分 claim 只可人工只读协调，不补写 claim。Source 前后核对准确 Locked/原 fixture，读取完整管理 Change Set 清单，拒绝 pagination/竞争中的管理变更；发现后只用 full ARN 双 Describe 和 Original template 核对。READY_UNEXECUTED 必须只有一项准确 CellOperatorBoundary 非替换 Modify，无角色/nested/import/其他资源变化；缺失为 MISSING_SLOT_CONSUMED，不是可重建。Pending/Failed/Executed/漂移返回阻断，不自动删除。

Source 运行时仅固定 `techlong-sandbox-user` login provider，拒绝 ambient 凭据/config/endpoint 覆盖和关闭 TLS；只构造 STS/CF/IAM/DynamoDB read Commands。创建 CF capability 只在 CreateReviewed 分支构造；无 Execute/Delete/Operator/Neon 能力。artifact 必须是明确的绝对路径，拒绝 ledger 路径，wx+fsync，输出失败不改变围栏恢复规则。

## 真实只读证据与验证

ReviewCreate 原件：`F:\ChatGPT_workshop\techlong-j5gj17-create-review-202610032321.json`。

| 摘要 | SHA-256 |
| --- | --- |
| J17 创建审阅 | `f39fca883cfc475c8c94e966686fb867723c61eeaf367c69d93f738064740a7a` |
| creation plan | `bd71f7a61bb0b2f17910a864e6643a35838dda11c67b3dc8261a6b702bdac857` |
| exact Create request | `89b6234c0bcdfc1dda7a126db04be58ab76b55e118c2ff7a79ecde04e34a4b54` |
| selected template canonical | `70a63ca8a6d30ebb2af8e95aff367871bbe47eace359d149523b3d583a99fd7e` |
| 独立只读验证 receipt | `3d5b022a15764d1b3dbaa470bddae21abefa2dbded839137229f4be149641e12` |

审阅签发 `2026-10-03T23:20:19.638Z`（Winnipeg18:20:19），到期 `23:25:19.599Z`，未获创建批准，不将它作为后续长期授权。计划名称 `techlong-j5gj17-read-grant-b28e96abda11d25b` 仅在本地 JSON 中，没有发送 Create。

另起进程 `F:\ChatGPT_workshop\verify-techlong-j17-create-review.mjs` 严格重编译审阅/request/候选、复算模板/策略增量、确认 Role/trust 和 execution boundary 不变，再进行独立 Source-only 全量审阅。原件 `F:\ChatGPT_workshop\techlong-j5gj17-independent-verify-202610032324.json`，独立 Source Review SHA `96affaed7f5f3128dd6397c8eb73a8530f60a3d44df956c99e64a63ccfb787ff`；末管理读 `2026-10-03T23:21:56.088Z`（18:21:56）仍 exact Locked，Operator 默认 v5（v4/v5）、execution boundary v1，Cell MISSING、authority ABSENT，前后 IAM/Role/模板稳定，两次完整管理清单均空，原 fixture 未执行资源0。磁盘前驱前后相同，generation2 registry/claim 均 ABSENT。这不证明 Operator 真实权限、授权上下文、删除兼容性或生产兼容性。

18 项新增定向测试和原 grant/workflow/J16 回归共 82/82；typecheck、变更文件 eslint、原 management template validator 通过。新测试接入 npm test，没有重复全量 build/大规模离线云模拟或 IAM simulation；测试只在验证过路径的临时目录占槽并清理，从未操作真实 ledger。backend 无修改。所有 compatibility/readiness/runtime gates 继续 false。

## 下一小阶段

先完成 J18 的受审安装 → 固定 MFA Operator 只读请求 → 成功或失败立即 Source Revoke → 独立 Locked 核验控制器及 write-ahead journal，再安排新鲜创建审阅和准确批准。当前只有创建能力，安装/Operator/Revoke 流程未实现；不要提前创建一个时间窗即将过期且固定槽位永久消费的候选。以后每一个云动作按实际 fresh SHA 单独批准，保留 $10/月预算及低成本不等于绝对零费用的边界，不执行 child/DeleteStack/付费 Cell，不复用旧 J11 删除流程。
