# F3c3a：已创建未执行 Change Set，Conditional 替换语义触发停止

2026-10-11 Winnipeg。用户明确确认清单 `d662dab65100299ee922b84a88cc0a8c42db2f16bfbeb6597827b01dbf8903fe` 后，在有效窗口一次Run。仅1次直接写CreateChangeSet得到成功响应，后续严格范围检查拒绝，未执行预算变更、未更新DDB，未删除两旧失败CS，未安装IAM或部署Cell。**F3c3a费用门禁尚未完成。**

## 实际云状态与停止原因

新对象 `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-f3c3a-cost50-d662dab65100299ee922/f9ff4310-233f-4c83-bf81-19f8146895a3`，准确成本栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-cost-guardrails/b91bb3d0-9424-11f1-8b02-02a8988b0b23`；CREATE_COMPLETE、AVAILABLE、未执行、无嵌套/无IAM capabilities。仅一个资源SandboxMonthlyCostBudget / AWS::Budgets::Budget / Modify，PhysicalResourceId为原预算名。实际返回Replacement=**Conditional**，三Details均RequiresRecreation=**Conditionally**；用户批准协议只允许False/Never，因此返回 `COST_CONTROL_CHANGESET_SCOPE_UNREVIEWED`、failureStage=REVIEW_CREATED_CHANGESET。原代码与审批没有改为接受Conditional，也没有用旧批准强行继续。

04:17:29UTC / Winnipeg23:17:29的IncludePropertyValues只读审阅再次确认新CS仍AVAILABLE；完整Before/After Context递归比较，唯一两类属性差异为：

- `/Properties/Budget/BudgetLimit/Amount`：10→50（Dynamic和ParameterReference两条细节记录，不是两份预算）。
- `/Properties/Budget/TimePeriod`：在模板中显式增加既有2026-08-01至2087-06-15的准确时间段；原云预算已有该时间段，旧模板未显式设置。
- 其它上下文属性（预算名、COST/MONTHLY、CostFilters/CostTypes、原五通知/订阅）完全一致；公开Git不存Context中邮箱原文，只存两个Context SHA。

[AWS BudgetData文档](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-budgets-budget-budgetdata.html)把BudgetLimit/TimePeriod更新列为不需中断；本次注册表只读也显示createOnlyProperties为NotificationsWithSubscribers。但这些一般资料不能把本次实际Conditional改报False，不能保证“不替换”。[AWS Replacement定义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ResourceChange.html)与实际计划应一起评审；provider为何给出该条件标志尚未完全解释。**本轮没有授权可能的预算替换/重建。**

两次真实Inspect（第二次独立新进程）成功读到预算10USD、表read5/write2/ACTIVE、准确TableId `58c851f4-5b8e-45ce-8933-05c33b17fb21`，成本栈仍CREATE_COMPLETE；原两FAILED CS保留。已绑定settings SHA `a6433291649fe7ab0fe2d0693d0424835ad3f681789fc059e6eb0f0ed0513d2d` 与批准before完整相同，证明本批原设置未变。原Inspect的costControlsVerified及exactPriorAlertsSubscribersTagsAndOtherSettingsPreserved总完成标志仍false，原文件不改；“原已绑定设置未变”是根据settings SHA与before比较得出的独立结论，不把未完成目标标成成功。

## 证据与不可重放边界

- 批准manifest文件SHA `4dfbffe855d1ac91cf887288dbe375aac3a6867081023641a5a24845fa56abb2`，七代码绑定 `389e66ad5eab75416009e316b70ab86bd52ca45ac69e0b5c6ca43ae10f85dccc`，执行后复算完全不变。
- 一次Run回执SHA `068bc6e413640924256e24271a53ea78631512e01cb5a974fccf0a1cdaddc333`，direct writes=1、completed仅CREATE_CHANGESET、retryAuthorized=false。
- 首次Inspect 2026-10-12T04:10:32.255Z / Winnipeg23:10:32.255，SHA `e1bb0a65cfb2dee58dfd07718fbdf9fafde38c939366cbf29351185a2c81c88f`。
- 独立新进程Inspect 2026-10-12T04:10:37.205Z / Winnipeg23:10:37.205，SHA `ba0bf7a43bccf545636eb6cbd3cfa0e50eb29aa50336f7fa9a4b72ffafd03f4c`；两结果除时间外完全相同，stable SHA `0a8de1c55962323c08389241ddbf6f2f96627f91d510788a5ad5f812a6b75ee5`。
- IncludePropertyValues完整私有审阅 `F:/ChatGPT_workshop/techlong-f3c3a-cost-controls-20261012-r2-scope-audit.json`，SHA `cad29da41c7a7be10e8269404bec73c76cacd6c6948deb2801baa3a0907a179c`；before/after Context SHA分别 `057d3c1eb05ed22a0aa291484998c8dc320e1f17c723ce158c8e13d7295e3d10` / `c007fb993a12e33ac64293e3789e1ea3f36dd128a6f1ef4080f5b38e61da7da5`。邮箱原文仅私有审阅，不入公开摘要。
- 私有r2-run/r2-verify目录及r1的0写凭据失败输出全部保留；[公开范围停止摘要](../ops/aws-sandbox/reviews/f3c3a-cost-controls.scope-stopped.json)。
- 原slot `techlong-f3c3a-sandbox-cost-controls-v1-consumed` 已消费，3个准确marker（approved-manifest/create-attempt/create-confirmed）保留。**禁止重跑原Run/helper、复位slot、删除/重建新CS或自动补齐/写重试。**

没有ExecuteChangeSet，因此未触发旧云CS自动删除，旧两FAILED/UNAVAILABLE和新AVAILABLE共3条记录均保持。没有Budget更新、表Item读写、IAM/Secret/Key/Neon/authority/Lambda/Cell/运行时变化；既有材料/镜像/旧模板和记录不改，没有资源自动删除或回滚。50USD目标仍不是硬上限，实际本批尚为10USD/read5/write2。

## 建议的继续方向，需要新的用户决定

建议**复用准确现有未执行CS**，不再Create同类对象：先准备独立的只读路径级审核及新执行清单，完整绑定Before/After、template/参数/准确资源/已保存旧对象和当前before设置，单独接受或拒绝Conditional可能替换/失败/告警间隙等风险。不能只把原False/Never检查改成放行。

准备新协议需用户先明确同意方向；实际Execute与表更新仍须该新协议生成的fresh SHA另批。新入口不得复用/复位本次已消费slot、借旧批准执行，也不隐式增加Budget删除/重建或其它资源范围。尚未准备/批准该新入口，本轮到此停止；原[完整批准范围与风险](./aws-auto-deployment-fast-track-f3c3a-cost-controls-refreshed.md)与失败记录仍保留。
