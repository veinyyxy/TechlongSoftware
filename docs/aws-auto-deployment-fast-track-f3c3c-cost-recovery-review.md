# F3c3c：失败成本栈恢复与直接费用控制分离评审，未执行

历史批准前清单。用户随后确认该SHA并一次运行，准确成本栈已UPDATE_ROLLBACK_COMPLETE、两次独立Inspect恢复通过；新slot永久消费四marker，不能重跑本页命令。预算仍10/read5-write2、时间段仍Oct1，直接费用更新未授权。原范围/风险与批准记录保留，见[实际恢复完成证据](./aws-auto-deployment-fast-track-f3c3c-cost-recovered.md)。

2026-10-12 Winnipeg。用户同意“失败成本栈恢复 + 直接Budgets API费用控制”的准备方向；本轮仅代码、候选数据和真实只读核验，AWS写入0。实际仍为成本栈UPDATE_FAILED、预算10 USD、表read5/write2，不能称50 USD费用门禁或自动部署已完成。

## 两步顺序与所有权决策

1. **当前仅审批失败栈恢复**：准确成本栈一次RollbackStack，随后独立只读核验。若恢复失败或结果不确定，只停在Inspect，不追加恢复、删除、重试或预算/表写入。
2. **恢复成功后重新审批费用更新**：根据实际恢复后的预算、时间段与栈配置，重新生成准确UpdateBudget及UpdateTable清单。预算金额拟10→50，表拟read5→100/write2不变；不再通过Budget CloudFormation属性更新绕回旧失败路径。

选择“受审直接API覆盖”，不是删除/迁移/剥离CloudFormation所有权：CFN资源记录和aws:cloudformation标签保留，恢复后旧模板/参数预计为10；未来直接更新到50会留下**明确的金额漂移**。实际预算50与CFN模板10必须分别报告，不能称整栈无漂移或自动纠正成10。旧cost-stack apply/Run需操作规程封存，后续自动部署不得重放它们；本轮未撤销既有技术权限，也不宣称能阻止所有外部手动操作。

如果将来再对成本栈执行更新、回滚或删除，可能覆盖直接API配置或删除预算，必须另行评审该所有权风险。完整“Retain再剥离资源”迁移会引入额外CFN变更，本轮不做。新的成本验收应校验实际预算/表及批准覆盖记录，不把旧CFN参数10当作实际Budget50已通过，也不放宽原已绑定检查或启用运行时。

先恢复再更新的原因：恢复可能重新触碰预算及时间段；若先把预算改50，再恢复旧栈，50设置可能被覆盖。本页当前SHA**不包含第二步执行授权**。

## 当前恢复清单：最多一次直接写

待确认SHA：`22fe4989d099196e75c14c148da19a90c3ff860bebed733cd2db354904ce9c36`。

评审：2026-10-12 14:25:15.884 UTC / Winnipeg **09:25:15.884**。
截止：2026-10-12 15:25:15.884 UTC / Winnipeg **10:25:15.884**，写前保留5秒安全余量；过期仅只读刷新并重新确认，不转移旧审批。

唯一直接写调用：`RollbackStack`，StackName完整ARN为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-cost-guardrails/b91bb3d0-9424-11f1-8b02-02a8988b0b23`，RetainExceptOnCreate=false，派生准确ClientRequestToken `f3c3c-recover-<本清单SHA>`；不提供新RoleARN/模板/DeploymentConfig，不Create/Execute/DeleteCS，不UpdateStack，不直接DeleteStack、Create/Delete/UpdateBudget、UpdateTable或安装IAM。

已有Source Account402010193138 / `arn:aws:iam::402010193138:user/techlong-sandbox-dev` / UserId AIDAV3GNMXTZEO7SHLC2X真实核对成功。RollbackStack准确栈权限及预算ModifyBudget模拟均allowed，只是模拟，不能保证服务内部成功。每次请求前身份核对；写前在自动刷新/身份检查之后再检查新审批与只读证据新鲜度，SDK maxAttempts=1。

本次Review核对：

- 准确栈仍UPDATE_FAILED/DisableRollback=true/RoleARN=null，唯一资源是原Budget，无新/嵌套资源；完整失败状态settings SHA仍 `ac7dfa38adaf09cdf29c7e1aab358a5753f2787e73a2f2540658cd592386baa2`。
- 直接Describe三条准确CS仍为原两FAILED/OBSOLETE、新CREATE_COMPLETE/EXECUTE_FAILED；List为空不当作删除证明，不能出现新活动/第三方CS。
- 该栈最后稳定事件为CREATE_COMPLETE，EventId `bea3dee0-9424-11f1-a75e-066ead6012ed` / 2026-08-09T19:01:36.318Z；当前最后失败事件仍为原 `d5689c00-c5f8-11f1-906f-06ffe310ff0d` / 2026-10-12T04:53:14.775Z / 原f3c3b token。最新事件或完整状态变化即停止。
- 原七/十文件绑定、两个永久消费槽位各三个marker、准确原清单与失败回执均保持。新槽位 `techlong-f3c3c-cost-stack-recovery-v1-consumed` 目前空，不借旧批准、不复位旧槽位。

恢复验收不是仅检查COMPLETE：必须有**本次准确token的栈完成事件**、原模板SHA `81fbf96d996ee84f5b1ac2337442f0b931815b24a24995b5c73d952097728cdf`/MonthlyBudgetUsd10、实际预算10/原其它绑定预算与告警标签、准确表全部绑定配置不变且ACTIVE/read5/write2。预算Start仅接受原2026-08-01或当前2026-10-01，End固定2087-06-15；不会主动写日期，实际完成值需独立记录。出现其它时间段或配置、费用更新、活动CS、缺少本token证据，均不得称恢复通过。

## 当前一步必须接受的完整风险

- **这是一次明确、主动批准的恢复回滚**，不是原协议的自动补偿。它可能再次调用Budget处理器，改变预算、时间段、告警状态/历史或CalculatedSpend，也可能因此前provider问题失败。一次直接API尝试不限制AWS内部操作数量，不能保证恢复只改栈元数据。
- [RollbackStack官方说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_RollbackStack.html)指出：若服务判断没有last known stable state，会删除栈。已绑定历史CREATE_COMPLETE/原资源证据可降低不确定性，但不是对服务内部稳定状态的原子保证；必须接受**意外栈/预算删除或部分遗留风险**。本入口不直接DeleteStack/Budget，亦不自动创建补偿资源。
- AWS可能回滚/删除没有稳定态的资源、使历史CS失效/清理记录；三个准确CS记录已保存，不手工删除或重建。准确栈只绑定一个已有Budget，不授权其它资源、付费Cell或权限变更。
- 恢复非原子、非CAS，读后仍可能有外部并发；Source自动刷新或服务调用可能失败，响应丢失/有限等待超时不能证明无写入。失败或不确定时只读Inspect，不自动追加RollbackStack、delete、fill、reset或写重试；永久新槽位一经占用就不自动复位。
- 验收接受预算Start为上述两个明确日期之一，不保证历史开始时间一定恢复；这一步不修改预算至50或表至100，不以恢复成功代替费用门禁完成。接受低成本但非绝对零费用；50 USD/月目标仍非硬cap。

## 第二步草案：明确未授权、恢复后必须重编译

私有 `unapproved-direct-cost-draft.json` 是准备数据，无对应预算/表写入口。NewBudget拟保留准确预算名、COST/MONTHLY、CostFilters、CostTypes及实际观察TimePeriod，仅BudgetLimit.Amount改50/USD；只发送可写字段，不发送CalculatedSpend/HealthStatus/LastUpdatedTime，不修改通知、订阅、标签或Budget actions。Table拟准确TableName与read100/write2，执行前还须绑定原TableId。

草案当前时间段是恢复前Oct1；恢复后的Aug1或Oct1必须重新取证、生成新的SHA，不能直接运行本草案。直接UpdateBudget没有CAS/应用幂等令牌，失败不自动重试；[AWS说明更新会使CalculatedSpend暂时归零](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_UpdateBudget.html)，不代表实际消费为0。金额覆盖漂移、告警/历史、非原子与独立表更新的部分状态风险届时单独确认。当前代码没有安装Budgets依赖、改变package/lock或修改原执行代码，旧绑定保持。

## 验证、记录和批准命令

7项新+21项相邻测试共28通过；typecheck、定向lint、两个新脚本syntax通过。未重建镜像、运行旧探针或应用恢复写入；测试不代替云验收。

- 新十三文件代码绑定：`8a3a02add2954fff7c2e7577d72564817ed04ffb3f6b5356e017016cb7ceaafc`。
- 原七/十代码仍 `389e66ad5eab75416009e316b70ab86bd52ca45ac69e0b5c6ca43ae10f85dccc` / `41dfdf85b2b3e01d29737aac8dccd3846229a23cbedc5b2e871d5abedd67bf9c`。
- 私有清单文件SHA `9aaf2dcc1bb9e865730e74317fc3f522636a86f393ebde0a77cbb02fe038bb02`；只读snapshot文件SHA `6a58f917d870bc73894ecd458b57a87bb0b22cab4686ece393712422ca19abda`。
- 未授权直接API草案SHA `589ca07b80366bfe1d0e245b496b50b447ddb75c115c0369b610c2a31a10f517`；均在 `F:/ChatGPT_workshop/techlong-f3c3c-cost-stack-recovery-20261012-r1/`。公开Git不存预算邮箱/完整Context，见[安全摘要](../ops/aws-sandbox/reviews/f3c3c-cost-stack-recovery.prepared.json)。
- [一次性批准命令](F:/ChatGPT_workshop/Run-ReviewedCostStackRecovery-22fe4989.ps1)仅创建并解析，尚未运行。新确认后保存Run内Inspect和独立新进程Inspect；完成也不执行预算/表更新。

```powershell
& 'F:/ChatGPT_workshop/Run-ReviewedCostStackRecovery-22fe4989.ps1' -ApprovedManifestSha '22fe4989d099196e75c14c148da19a90c3ff860bebed733cd2db354904ce9c36'
```

建议确认：“我确认按清单22fe4989d099196e75c14c148da19a90c3ff860bebed733cd2db354904ce9c36，仅一次RollbackStack恢复准确失败成本栈，随后独立只读核验；接受本页完整风险，包括服务内部预算/时间段变更、历史稳定证据非原子、缺稳定态可能意外删除栈/预算、处理器失败、并发/刷新失效/部分遗留、非零费用及永久槽位不自动补偿/复位/重试；不更新预算金额或表上限、不新增IAM、不执行CS或部署Cell。”

未取得新确认，不调用Run。恢复成功后第二步另fresh SHA；恢复失败则保留所有结果，不借本方向授权补写或重试。
