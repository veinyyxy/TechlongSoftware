# F3c3d：直接费用控制更新清单，未执行

历史批准前清单。用户随后确认该SHA及完整风险，有效窗口一次helper完成两写，实际Budget50/原表ACTIVE read100-write2，两个Inspect（第二次独立新进程）均targetVerified=true。新slot已永久消费七marker，不得重跑下方命令；CFN10/实际50漂移按批准保留。见[实际执行证据与下一阶段](./aws-auto-deployment-fast-track-f3c3d-direct-cost-controls-executed.md)。下方原范围、风险和准备时状态保留。

2026-10-12 Winnipeg。F3c3c已恢复准确成本栈；本轮只实现独立入口、测试及真实只读Review，AWS写入0。当前仍是Budget **10 USD**、表 **read5/write2**，不是50 USD费用门禁完成。

## 本次待批准范围

清单SHA：`b9193bbd7959159400e659f14179943a236eadd8f1ff68f13d385a5713155026`。

评审：2026-10-12 **15:08:51.610 UTC / Winnipeg10:08:51.610**。
截止：2026-10-12 **16:08:51.610 UTC / Winnipeg11:08:51.610**，每次写前保留5秒安全余量。过期只能只读刷新、确认新SHA，不转移旧批准或重放旧helper。

最多两个直接写请求，顺序固定：

1. Budgets API `UpdateBudget`（对应IAM权限为`budgets:ModifyBudget`），AccountId402010193138，准确预算 `techlong-sandbox-402010193138-ca-central-1`，仅金额10→50 USD。NewBudget发送BudgetName、BudgetLimit、BudgetType、TimeUnit、CostFilters、CostTypes、TimePeriod七项可写配置，除金额外都按批准前实值保留。时间段固定 **2026-10-01T00:00:00Z至2087-06-15T00:00:00Z**，CLI请求以Unix秒表示；不恢复历史Aug1，不迁移过滤器格式，不发送CalculatedSpend/HealthStatus/LastUpdatedTime，不调用通知、订阅、标签或Budget action变更API。
2. 预算50及其余完整绑定配置核验通过后，`dynamodb:UpdateTable`，准确表 `techlong-sandbox-tenant-external-epoch-authority`，OnDemandThroughput MaxReadRequestUnits **5→100**，MaxWriteRequestUnits **2不变**。TableId固定 `58c851f4-5b8e-45ce-8933-05c33b17fb21`，写前/响应/回读均检查准确ARN与ID；不改表数据、计费模式、索引、流、加密、标签等绑定设置。

预算API位于us-east-1；表和成本栈位于ca-central-1。预算ARN为 `arn:aws:budgets::402010193138:budget/techlong-sandbox-402010193138-ca-central-1`；表ARN为 `arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority`。

**不新增或撤销IAM，不操作CFN栈/Change Set，不删除资源，不改Secret/Neon/authority，不调用Lambda，不部署Cell/ECS或启用运行时。** 本次没有临时grant，因此不混入额外撤权写入。

## CloudFormation所有权与金额覆盖

准确成本栈仍 `UPDATE_ROLLBACK_COMPLETE` / DisableRollback=true，原模板SHA `81fbf96d996ee84f5b1ac2337442f0b931815b24a24995b5c73d952097728cdf`、MonthlyBudgetUsd参数 **10** 不改；预算CFN资源记录与标签保留。若本次直接更新成功，实际Budget50、CFN模板/参数10将形成**明确批准的金额漂移**，不是整栈无漂移。

不做detach/Retain迁移、UpdateStack、模板纠正或自动回写10。旧cost-stack apply/Run按操作规程封存；本轮未撤销现有技术权限，不能阻止所有外部手动操作。将来任何CFN更新/回滚/删除都可能覆盖直接配置或删除预算，必须另行评审，不能重放旧已消费槽位。

新永久槽位 `techlong-f3c3d-direct-cost-controls-v1-consumed`；执行完成后保存本地 `explicit-override-verified.json`，绑定实际配置及CFN10/实际50。此记录只是本次覆盖证据，不是Neon authority、bootstrap证书或运行时激活许可。后续成本readiness需独立接入实际Budget50与明确覆盖证据，不能静默放宽旧10参数检查。

## 真实只读结果与执行门禁

Source Account/ARN/UserId实核为402010193138 / `arn:aws:iam::402010193138:user/techlong-sandbox-dev` / AIDAV3GNMXTZEO7SHLC2X。准确预算 `budgets:ModifyBudget` 和准确表 `dynamodb:UpdateTable` 模拟均allowed，无需本次新增权限；模拟不是服务实际成功保证。

- 15:08:42.215 UTC只读证据与恢复完成配置一致，settings SHA `f04b68099b0e4566c21e817fc3e4a96723145d2bdb21cddaec0ef610cc0ba291`。Budget10/固定Oct1时间段，表ACTIVE/read5/write2；栈准确恢复事件 `d0ad64a0-c64a-11f1-a7c2-026a0543e9bf` 与原token仍为最新事件。
- 原三Change Set逐项直接Describe仍可读：两FAILED/OBSOLETE，一CREATE_COMPLETE/EXECUTE_FAILED。List为空不被解释为旧对象已删除；不得新建或重放它们。
- 原预算五个比例告警及订阅、标签、actions均绑定；公开只存通知与订阅哈希 `d453801fe2a4c092747c76a7a85b0817caa245b8bd790bbd8b11ac7e87c54060`，不提交邮箱/原始Context。
- 原七/十/十三文件及历史清单、回执、Inspect、三个旧永久槽位完整核对保持。新十六文件绑定为 `b8672d4a854a12529f34af29114505afd545a7632c38233a4945996b602927cd`；新slot尚未消费。

每次写前重新核对全部绑定状态、身份、权限和新批准；自动刷新/STS之后再次检查审批和读证据新鲜度≤30秒。SDK/CLI maxAttempts=1，无应用写重试。Budget结果完整核验后才允许表写，表等待ACTIVE后才能通过；每阶段独立固定配置，未绑定或漂移即停。

## 必须接受的完整风险

- **直接API不是CAS，预算是完整配置覆盖**：最后一次只读到请求提交之间仍可能外部并发，批准时已观察配置可能覆盖外部更新。预算API没有请求幂等令牌，响应丢失不能证明未写入；准确名称/ID检查也不能消除替换、删除再创建或并发竞态。
- [AWS UpdateBudget说明](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_UpdateBudget.html)指出更新后CalculatedSpend会暂时归零、等待新usage更新；这**不是实际账单为零**。金额变大改变同一比例告警的美元触发点；即使通知/订阅配置相同，也不能保证告警投递、状态或历史连续性。
- CFN所有权/标签保留但金额10与50漂移被有意接受，旧技术权限未撤销。未来CFN操作可能覆盖/删除预算，不能自动纠正或称无漂移；只读比较不是CFN DetectStackDrift。
- 两写跨服务非原子，可能只达到Budget50/read5，或表UPDATING/响应丢失/部分配置遗留。AWS Login自动刷新可能失效，独立Inspect也可能因此无法完成。失败只保留证据并只读检查，不自动撤销预算、回滚栈、删除、补齐、复位槽位或重试写入。
- 固定新槽位一经占用永久消费，即使尚无成功写入；本地marker失败也停止后续写。最多两次是应用直接请求上限，不限制AWS服务内部操作；进程中断/磁盘失败不能保证有完整回执。
- 50 USD/月是预算告警目标，**不是实时费用硬cap**；DynamoDB最大吞吐是[best-effort限制](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode-max-throughput.html)，不是绝对流量/费用上限或100读取吞吐保证。接受低成本但非绝对零费用。没有借本清单批准任何付费Cell或运行时。

## 验证与一次性命令

8项新测试与15项相邻测试共 **23通过**；typecheck、定向lint、两个脚本syntax通过。真实Review成功验证生产清单编译与历史绑定，未调用Run，未重建镜像或增加离线模拟。测试与权限模拟不代替实际云验收。

私有目录 `F:/ChatGPT_workshop/techlong-f3c3d-direct-cost-controls-20261012-r1/`：

- review-manifest文件SHA `82c2156674a12caf8f6d813030a65962acba14715aecb9893c55858919146c71`。
- read-only-snapshot文件SHA `5d6270466384db526dce9a59fa64a39128dd31c8e998d00a62819ecaf6aad967`。
- budget-request文件SHA `a54490c2fc4cadf880b7405992c9ec01f6a50973803a2063a8253b9d5a794c36`，table-request文件SHA `8b10285a7b2f35a97d7f2a9a0fb91dc5d8d7922ebb1cc4c76dac51e70f8da616`。
- 全部目标配置期望SHA `575a194a1f4e2d8c73ace3f2ab36584aa30bdc19fbbe487ff774b95b4842220d`，仅金额与读cap变化，其余绑定字段保持。仅是期望，不是执行证据。

[一次性批准helper](F:/ChatGPT_workshop/Run-ReviewedDirectCostControls-b9193bbd.ps1)只创建和语法解析，尚未运行。准确新SHA与完整风险确认后才能一次Run，随后独立新进程Inspect；失败不重跑helper。

helper文件SHA `a4c42881e8ae9bb73ff303f138ab8d6b304fdf8aa61af563779f999cf62c7bce`；[公开安全摘要](../ops/aws-sandbox/reviews/f3c3d-direct-cost-controls.prepared.json)不包含订阅邮箱或原始Context。

```powershell
& 'F:/ChatGPT_workshop/Run-ReviewedDirectCostControls-b9193bbd.ps1' -ApprovedManifestSha 'b9193bbd7959159400e659f14179943a236eadd8f1ff68f13d385a5713155026'
```

建议确认：“我确认按清单b9193bbd7959159400e659f14179943a236eadd8f1ff68f13d385a5713155026执行最多两写：准确Budget10→50，完整核验后准确表read5→100/write2不变，随后独立只读核验；接受本页完整风险，包括保留CFN10与实际50金额漂移、整预算非CAS覆盖/无幂等令牌、CalculatedSpend暂时归零不是零账单、并发/刷新失败/异步表/部分遗留、非零费用、永久槽位不自动回滚删除补齐复位或写重试；不改IAM/Secret/Neon/CFN，不部署Cell或启用运行时。”

未确认不Run。费用门禁实际通过后再推进专属任务IAM及v3TTL清理兼容Cell模板评审，具体云部署仍另批。
