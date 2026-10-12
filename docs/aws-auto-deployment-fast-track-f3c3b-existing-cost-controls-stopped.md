# F3c3b：一次 Execute 已提交，成本栈失败，未更新表

执行发生于 Winnipeg 2026-10-11 23:53，本文于 Winnipeg 2026-10-12 更新。用户明确确认清单 `b28a77533adcedb7d897112441a1fa5fb235995cef94f2716076e28a8580ad48` 及完整风险后，在有效窗口运行一次已绑定helper。仅1次直接写 ExecuteChangeSet 成功提交；后续预算核验失败，**UpdateTable为0，50 USD/read100费用门禁未完成**。没有创建CS、安装IAM、连接Neon、调用Lambda、修改表Item或创建Cell。

## 实际结果，不把提交成功当作部署成功

- 准确成本栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-cost-guardrails/b91bb3d0-9424-11f1-8b02-02a8988b0b23` 已进入 **UPDATE_FAILED**，DisableRollback=true。
- 准确CS `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-f3c3a-cost50-d662dab65100299ee922/f9ff4310-233f-4c83-bf81-19f8146895a3` 按ARN直接Describe仍可读取，Status=CREATE_COMPLETE / ExecutionStatus=**EXECUTE_FAILED**；不在ListChangeSets中。原Inspector仅从List取own，返回ownChangeSet=null，不代表对象缺失，原结果保留。
- 预算名 `techlong-sandbox-402010193138-ca-central-1` 实际仍为 **10 USD / HEALTHY**；准确表 `techlong-sandbox-tenant-external-epoch-authority` / TableId `58c851f4-5b8e-45ce-8933-05c33b17fb21` 仍 **ACTIVE / read5 / write2**。
- 栈的MonthlyBudgetUsd参数和模板已保留为50候选，实际预算仍10；这是失败后的部分配置状态，不能称CFN与实际费用配置一致。
- **预算Start确实变化**：原 `2026-08-01T00:00:00.000Z` → 实际 `2026-10-01T00:00:00.000Z`；End仍 `2087-06-15T00:00:00.000Z`。此变化伴随失败资源回滚，最终金额仍10，不能证明曾成功更新为50或完整恢复原预算；不排除外部并发。其余已绑定预算字段、标签、五通知/订阅保持，表全部绑定配置相同；不能称整个预算未变。

时区说明：上述实际UTC执行事件为 **2026-10-12 04:53**，对应Winnipeg **2026-10-11 23:53**。记录时已跨Winnipeg午夜，不将执行误写为10月12日凌晨。

## 失败证据及诊断边界

同一个准确ClientRequestToken `f3c3b-execute-b28a77533adcedb7d897112441a1fa5fb235995cef94f2716076e28a8580ad48` 的事件顺序：

| UTC时间（2026-10-12） | 事件 |
| --- | --- |
| 04:53:09.174 | 成本栈UPDATE_IN_PROGRESS，User Initiated |
| 04:53:11.668 | Budget UPDATE_IN_PROGRESS |
| 04:53:12.309 | Budget UPDATE_FAILED：CloudFormation is unable to provision/access this resource type |
| 04:53:13.924 | Budget UPDATE_ROLLBACK_IN_PROGRESS：仅回滚失败资源 |
| 04:53:14.513 | Budget UPDATE_ROLLBACK_COMPLETE |
| 04:53:14.775 | 成本栈UPDATE_FAILED |

04:55:28.406UTC准确ca-central-1只读DescribeType返回AWS::Budgets::Budget / PUBLIC / LIVE / **NON_PROVISIONABLE**，schema没有handlers，primaryIdentifier为Id、createOnly为NotificationsWithSubscribers。这是与此次provider无法provision/access一致的诊断线索，但**尚未唯一解释服务内具体失败原因**：不能据此断言所有地域或旧式CloudFormation Budget实现都不支持，也不能把NON_PROVISIONABLE简单等同于所有CloudFormation原生路径不支持。[AWS注册表定义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeType.html)和[Cloud Control支持列表](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)是不同能力视图。

实际Source身份与批准的Account/Arn/UserId相同、请求已成功提交，未观察到登录过期；失败事件不是AccessDenied或固定名称替换冲突，不擅自归因为缺IAM或凭据过期。Source三项模拟allowed仍只是模拟；没有据此安装任何权限。

请求DisableRollback=true和实际栈状态均已核对；这**不保证更新失败的单个资源不会被AWS回滚**。[AWS失败选项说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)明确说明更新/change set保留成功资源，同时可回滚失败资源到稳定态。本次确实观察到Budget服务内回滚；没有应用调用RollbackStack、UpdateStack、Budget补偿或Delete操作，不能把“没有应用回滚”表述为“服务端完全没有回滚”。

## 两条旧CS的准确状态：OBSOLETE，不宣称已删除

执行后ListChangeSets为空，原Inspector给oldFailedChangeSetsRemaining=[]。初始进度按List称“已清理”，后续直接Describe已更正：以下两准确旧对象**仍可读取**，Status=FAILED，ExecutionStatus从UNAVAILABLE变为 **OBSOLETE**。List缺失不是删除证明，不再称对象已不可恢复删除；原审批接受删除风险及原Inspector文件保持，不把它们改成实际删除证明。

- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786302438/652e5dd5-e04b-4d8f-b7ee-04af0b2c52d9`
- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786306192/f3adc3b8-2caa-4280-b697-aec9c934ed2e`

完整旧本地记录均保留，不调用DeleteChangeSet，不复位、重建或试图使OBSOLETE对象重新可执行。

## 独立核验、绑定与停止位置

- Run回执SHA `ca39ab0a5ead43ad975a4fc33de6820f1376c5ffa9b108083c77d975b6c05d60`；outcome=EXISTING_COST_STOPPED_INSPECT_ONLY，writeAttempts=1、slotConsumed=true、completed=[]、failureStage=EXECUTE_EXISTING_CHANGESET、failureCode=EXISTING_COST_BUDGET_UPDATE_UNVERIFIED。completed表示完成预算核验的阶段，不否认execute-confirmed marker所证明的提交响应。
- Run内Inspect 04:53:17.840UTC，SHA `5bb7d058a7fe263521fff1841cc65238fc07248aa43aff0d62c6e88aad1c590e`，当时栈UPDATE_IN_PROGRESS。
- 独立新进程Inspect 04:53:23.580UTC，SHA `b59ba932d50f75c8e2954d4d72dff34d9ee62172d10b732abe80c8b84b926d0b`，栈UPDATE_FAILED。
- 后续独立只读最终Inspect 04:57:34.117UTC，SHA `9bbac3754c28babdc1442fc120de5f7e239fd8408d9d4fc67715c8e0d82302c1`；与前一个结果除时间外相同，stable SHA `773ca0857c1f53348b892794f2c9fd04c8339851a33a308f2b1b8506a7c70f3b`。
- 最终settings SHA `ac7dfa38adaf09cdf29c7e1aab358a5753f2787e73a2f2540658cd592386baa2`；完整差异仅 `/stack/parameters/MonthlyBudgetUsd`、`/stack/templateSha256`、`/budget/config/TimePeriod/Start`。原完整设置未变标志false正确，不修饰为true。
- 独立差异比较确认通知/订阅SHA仍 `d453801fe2a4c092747c76a7a85b0817caa245b8bd790bbd8b11ac7e87c54060`，表组件SHA前后同为 `eec2f1271ce640fd09d562c8ea302ec97ad4a5fe25971356fdb9e33517f95453`。
- 新十代码 `41dfdf85b2b3e01d29737aac8dccd3846229a23cbedc5b2e871d5abedd67bf9c` 与原七代码 `389e66ad5eab75416009e316b70ab86bd52ca45ac69e0b5c6ca43ae10f85dccc` 保持；没有代码变化，不重复原25测试/build/镜像构建。此前测试通过不代表云门禁完成。
- 新slot `techlong-f3c3b-existing-cost-controls-v1-consumed` 永久消费，准确三个marker：approved-manifest / execute-attempt / execute-confirmed；没有budget-verified、read-limit-attempt或read-limit-confirmed。原F3c3a槽位三个marker不变，两个原Run/helper都禁止重放，即使清单尚未过期。
- 私有诊断 `F:/ChatGPT_workshop/techlong-f3c3b-existing-cost-controls-20261012-r2-diagnostics.json`，SHA `ca745c83ade9471970e01c661e10fe59f2f1fd079798522826fe9529e60a01f1`，含事件/注册表/准确旧CS/配置差异，多时点非原子只读观察；公开不存邮箱/Context原文。[执行停止摘要](../ops/aws-sandbox/reviews/f3c3b-existing-cost-controls.stopped.json)。

本次到此停止云写入，不自动回滚/删除/补齐/复位/重试。预算50不是费用硬cap，实际仍10，付费Cell和runtime未授权。

建议下一步**只准备费用控制解耦与失败栈恢复评审**：研究用准确Budgets API更新既有预算及时间段、独立表read cap入口，明确处理CFN所有权/模板与实际值不一致及失败栈恢复，而不是再重放此CS。直接Budget API会改变此前CFN单一管理边界，恢复栈/预算/表实际写入也不在本次授权内；需先确认准备方向，随后资源范围与fresh SHA单独批准。不直接删除/迁移预算或成本栈，不扩展IAM，不跳过费用/TTL门禁推进付费Cell。
