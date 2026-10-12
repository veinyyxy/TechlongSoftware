# F3c3b：复用现有 Conditional Change Set，专项评审完成，未执行

2026-10-11 Winnipeg。用户“同意这个方向”只授权准备现有准确 Change Set 的独立评审和新清单。已实现独立 Review / 一次 Run / Inspect、本地批准命令及新的永久槽位；**本轮 AWS 写入为0，没有执行预算或表变更，也没有重建 Change Set。实际仍是 Budget10 USD / read5 / write2。**

## 新清单与准确资源

最终清单 SHA：`b28a77533adcedb7d897112441a1fa5fb235995cef94f2716076e28a8580ad48`。

只读评审时间：2026-10-12 04:45:42.463 UTC / Winnipeg **2026-10-11 23:45:42.463**。
审批截止：2026-10-12 05:45:42.463 UTC / Winnipeg **2026-10-12 00:45:42.463**，写前至少留5秒安全余量。过期不运行，先只读刷新并重新确认新SHA；旧审批不转移。

最多两次直接 AWS 写尝试，顺序不可变：

1. 一次 `ExecuteChangeSet`，只执行现有准确 ARN：`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-f3c3a-cost50-d662dab65100299ee922/f9ff4310-233f-4c83-bf81-19f8146895a3`。准确成本栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-cost-guardrails/b91bb3d0-9424-11f1-8b02-02a8988b0b23`，请求显式 `DisableRollback=true`。不 Create/重建CS，不直接 Update/Delete/CreateBudget。
2. 仅在成本栈 UPDATE_COMPLETE、上述CS EXECUTE_COMPLETE、实际预算50 USD及全部其余绑定设置相同、准确两旧CS已移除且无其它CS的只读核验通过后，一次 `UpdateTable`，准确表 `arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority`，TableId `58c851f4-5b8e-45ce-8933-05c33b17fb21`，仅 MaxReadRequestUnits5→100，MaxWriteRequestUnits保持2。

不改IAM、Secret/Key、表Item、Neon、authority、Lambda代码/调用、DNS/ACM、baseline/TrustStore、旧Cell模板/发布镜像或运行时；不创建付费Cell/ECS/RDS/ALB。新槽位 `techlong-f3c3b-existing-cost-controls-v1-consumed` 目前空，消费后不自动复位、补齐或重试。

## 对 Conditional 的独立、严格审核

新入口没有修改旧False/Never检查。原协议七代码SHA `389e66ad5eab75416009e316b70ab86bd52ca45ac69e0b5c6ca43ae10f85dccc`、原已消费槽位的三个marker、原清单/回执/失败与核验输出保持；新入口绑定这些历史内容，发现变化即拒绝。本次不是重放原Run，也不复用原槽位。

最终只读回读仍为单个 SandboxMonthlyCostBudget / AWS::Budgets::Budget / Modify，原准确预算名 `techlong-sandbox-402010193138-ca-central-1`，Replacement=**Conditional**；三条Details的RequiresRecreation均为**Conditionally**。新入口仅接受当前固定三条路径/值/表达式/来源细节：

| 属性路径 | 唯一允许变化 |
| --- | --- |
| `/Properties/Budget/BudgetLimit/Amount` | 10→50；Dynamic DirectModification和Static MonthlyBudgetUsd ParameterReference两条描述 |
| `/Properties/Budget/TimePeriod` | 模板显式增加原有 Start=2026-08-01T00:00:00.000Z、End=2087-06-15T00:00:00.000Z |

完整Before/After Context必须分别与原绑定预算、五通知/原订阅和准确时间段计算出的期望值相同。仅“差异路径相同”不足以通过：即使两边同时篡改未变字段也会拒绝。同时核对准确ARN/创建时间、template/全部参数和标签、单资源范围、无能力/嵌套/角色/额外部署设置、当前成本栈/预算/表/旧两CS。未知字段、缺失Context、任意新资源/第三方CS/值或表达式变化均停止。私有Context含原告警邮箱，公开Git仅保存SHA，不存邮箱/Context原文。

三项 Source 只读权限模拟（ExecuteChangeSet、准确预算ModifyBudget、准确表UpdateTable）均allowed；模拟不是实际成功或无并发证明。准确身份为账号402010193138 / `arn:aws:iam::402010193138:user/techlong-sandbox-dev` / UserId AIDAV3GNMXTZEO7SHLC2X。Source使用AWS Login自动刷新，每次请求前核对身份；两项写调用前在刷新/身份检查之后再检查新审批截止和只读证据新鲜度。SDK maxAttempts=1，不进行应用写重试。

## 必须另行明确接受的完整风险

- **Conditional不能解释成False。** 尽管[AWS BudgetData属性文档](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-budgets-budget-budgetdata.html)一般列为No interruption，[当前计划的Replacement语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ResourceChange.html)仍不能保证不替换。本次须接受CFN内部可能删除/重建该准确预算、预算历史/CalculatedSpend连续性及告警短暂间隙风险；不授权手工删除预算、改名或自动创建补偿预算。
- 准确BudgetName保持固定；若服务要求替换，可能因自定义名称/重复名称等原因失败，成本栈可能留在UPDATE_FAILED、预算及告警部分变更或缺失。本次禁用失败自动回滚，无资源补偿、down、撤权、删除、补齐或写重试。成功请求响应也不是预算完成证明。
- [ExecuteChangeSet会删除同栈其它CS](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。清单仅接受下述**两条准确旧FAILED CS不可恢复删除**，完整旧记录已私有保存；任何第三方CS出现即拒绝，但读取不是CAS，无法彻底排除读后并发新增/更新/删除。
- 两项直接写不是服务内部操作数量上限。CFN预算内部更新/潜在替换及旧CS清理可能产生更多服务操作；表更新异步，可能遗留Budget50而read仍5，或更新已提交但完成未核验。回执writeAttempts为保守尝试计数，不证明每次入口都发送到服务。
- Source自动刷新或提供者调用可能失效；过期/身份不符/不新鲜立即停止，结果可能不确定，不自动写重试。有限等待结束后只读Inspect，不把未完成状态记为通过。新槽位一经占用即永久消费；文件/marker失败也可能使槽位不可重用。
- 50 USD/月Budget只告警，不是费用硬上限；表读100/写2是best-effort上限，不保证吞吐或整月账单。接受低成本但非绝对零费用；不代表整套架构可在50 USD/月常驻，也不代表付费部署已批准。

接受自动清理的两个旧CS准确ARN：

- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786302438/652e5dd5-e04b-4d8f-b7ee-04af0b2c52d9`
- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786306192/f3adc3b8-2caa-4280-b697-aec9c934ed2e`

## 证据、本地命令与继续边界

8项新定向测试+17项原/相邻测试共25项通过，类型检查、定向lint及两个新脚本语法检查通过。测试仅验证检查与流程，不是云执行验收。真实Review已经按新入口完成全部只读校验；为写前凭据刷新后也检查证据新鲜度新增保护，最终r2重做一次只读Review，r1准备记录保留但不作为批准清单。

- 新十文件代码绑定：`41dfdf85b2b3e01d29737aac8dccd3846229a23cbedc5b2e871d5abedd67bf9c`；原七文件绑定未变。
- 私有清单：`F:/ChatGPT_workshop/techlong-f3c3b-existing-cost-controls-20261012-r2/review-manifest.json`，文件SHA `a94045e0f1c37330d458a786c198bc71398ce1c7f1c6e902358ba7216012fb64`。
- 最终完整只读snapshot文件SHA `59b62fb308fb64e0d3597dd2e7008f4706ef8251fc0efcdb491ae7c9299057a5`；规范化CS SHA `fc4349e7c97888865216f9865a7363e3bca87b7d6ea082f059ce15e6844c5704`。
- Before/After Context SHA：`057d3c1eb05ed22a0aa291484998c8dc320e1f17c723ce158c8e13d7295e3d10` / `c007fb993a12e33ac64293e3789e1ea3f36dd128a6f1ef4080f5b38e61da7da5`。
- 原已绑定设置SHA仍 `a6433291649fe7ab0fe2d0693d0424835ad3f681789fc059e6eb0f0ed0513d2d`，实际cost门禁未完成；[安全公开摘要](../ops/aws-sandbox/reviews/f3c3b-existing-cost-controls.prepared.json)。

本地helper仅创建并解析，**未运行**：[Run-ReviewedExistingCostControls-b28a7753.ps1](F:/ChatGPT_workshop/Run-ReviewedExistingCostControls-b28a7753.ps1)。只有用户在上述有效窗口确认新SHA与本页完整风险后，才可一次运行；它会保存Run内Inspect和独立新进程Inspect，无论Run成功或失败均不自动重试。

```powershell
& 'F:/ChatGPT_workshop/Run-ReviewedExistingCostControls-b28a7753.ps1' -ApprovedManifestSha 'b28a77533adcedb7d897112441a1fa5fb235995cef94f2716076e28a8580ad48'
```

建议确认语句：“我确认按清单 b28a77533adcedb7d897112441a1fa5fb235995cef94f2716076e28a8580ad48 执行F3c3b，仅一次执行现有准确Conditional Change Set，预算及其余绑定设置核验通过后准确表read100/write2，随后独立只读核验；接受本页完整风险，包括预算可能替换/重建、告警或历史间隙、固定名称失败及禁用失败自动回滚、两旧FAILED CS自动不可恢复删除、非原子/并发、刷新失效、部分遗留、非零费用及永久槽位不自动复位/补齐/重试；不重建CS、不改IAM/Item/Neon、不部署Cell或启用运行时。”

未取得这项新确认，不能调用Run。完成后才准备剩余专属任务IAM/v3短TTL与真实清理门禁；后续新权限或付费部署仍独立确认，不借本次成本清单授权。
