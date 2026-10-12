# F3c3a：现有费用门禁更新清单（未执行）

用户已确认本页SHA，随后一次执行在凭据预检处停止，写调用0、slot未消费，两独立Inspect均因CredentialsProviderError未完成。原输出目录已存在，不重放本页辅助脚本；当前状态和Source刷新后只读继续步骤见[预检停止记录](./aws-auto-deployment-fast-track-f3c3a-cost-controls-preflight-stopped.md)。以下保留批准前记录。

2026-10-11 Winnipeg。本小阶段打通费用门禁，复用已安装F3c2材料及已发布镜像，不重复材料探针、导出或构建。新增一次Review/Run/独立Inspect入口，13新+4相邻共17定向测试、typecheck、定向lint/语法通过。**AWS写入0，新slot空，没有更改Budget/表/IAM/运行时。** 专属任务IAM及v3清理模板接在本批之后，未实现部分不冒充完成。

## 实际发现和准确变更

只读回读 2026-10-12T00:00:41.289Z：准确Source UserId `AIDAV3GNMXTZEO7SHLC2X`、ARN `arn:aws:iam::402010193138:user/techlong-sandbox-dev`；预算仍10USD，表仍read5/write2。四项Source当前模拟CreateChangeSet/ExecuteChangeSet/ModifyBudget/UpdateTable均allowed；不是新IAM授权，也不保证实际成功。

预算 `techlong-sandbox-402010193138-ca-central-1` 由现有成本栈管理：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-cost-guardrails/b91bb3d0-9424-11f1-8b02-02a8988b0b23`，实际CREATE_COMPLETE，无服务RoleARN；仅一个资源 `SandboxMonthlyCostBudget` / AWS::Budgets::Budget。原模板MonthlyBudgetUsd固定10，本批通过原CloudFormation管理入口更新，不直接调用UpdateBudget造成配置漂移。

候选原模板canonical SHA `81fbf96d996ee84f5b1ac2337442f0b931815b24a24995b5c73d952097728cdf` 与线上一致；只把MonthlyBudgetUsd Default/Min/Max/AllowedValues改为准确50，并在唯一Budget中显式写入已有TimePeriod：2026-08-01T00:00:00.000Z 至 2087-06-15T00:00:00.000Z，避免重新采用默认日期。其它resource/参数/邮箱/通知/标签/CostFilters/CostTypes/输出/静态TTL都不变；旧本地 `guardrails.template.json` 不改，候选模板保存在私有目录并在manifest内完整绑定。

| 控制 | 当前 | 确认后目标 | 保持 |
| --- | --- | --- | --- |
| tagged MONTHLY COST budget | 10 USD | 50 USD | Environment筛选、gross成本口径、既有5告警与订阅地址/标签/时间段 |
| 准确DDB表最大读请求单位 | 5 RRU/s | 100 RRU/s | 准确TableId、PAY_PER_REQUEST、最大写2及已绑定表配置/标签 |

表为 `arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority`，不可复用TableId `58c851f4-5b8e-45ce-8933-05c33b17fb21`，实际ACTIVE。不扫描/读写Item，不增加write权限，不修改索引/副本/流/密钥/账单模式，也不设置WarmThroughput。

## 最多3次直接写：同一份批准覆盖创建、严格核对、执行及表更新

1. 在准确已有成本栈一次CreateChangeSet（UPDATE），名称 `techlong-f3c3a-cost50-c43a9aea8323ab22fab9`，template/所有参数/标签/描述及ClientToken绑定本SHA。无IAM capabilities、嵌套栈或新execution role。
2. 有限只读等待创建完成，GetTemplate复核完整模板及参数；DescribeChangeSet必须只有上述准确预算resource的Modify、Replacement=False、Scope=Properties、Details仅Budget且RequiresRecreation=Never。准确ARN/栈/名称/标签/描述也必须匹配，发现额外资源/替换/IAM/漂移即停，不能执行。通过后一次ExecuteChangeSet，**DisableRollback=true**，再有限只读等待UPDATE_COMPLETE及真实预算50、原告警/订阅/时间段/其它配置一致；不能把“提交成功”当生效。
3. 只有预算已独立回读通过，才对准确原TableId一次UpdateTable，唯一输入变更OnDemandThroughput read100/write2。随后新的独立Inspect核验实际ACTIVE、两门禁及全部本批绑定配置一致。不保证100吞吐、实时计费或其它未绑定服务元数据不变。

3是助手直接写调用上限，不是CloudFormation内部写入上限；Budget资源provider可能重写同内容通知/订阅。AWS执行Change Set会删除该栈其它Change Set，当前仅有下列两条准确旧FAILED/UNAVAILABLE对象，**本次执行接受它们被AWS自动删除、不可恢复**，不调用DeleteChangeSet，也不接受其它对象删除。两完整DescribeChangeSet记录已保存在私有只读库存中；外部新增/状态变化即停，本批不能因此删更多记录。[AWS执行语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。

- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786302438/652e5dd5-e04b-4d8f-b7ee-04af0b2c52d9`
- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786306192/f3adc3b8-2caa-4280-b697-aec9c934ed2e`

## Fresh SHA、证据和入口

- Manifest SHA `c43a9aea8323ab22fab9e510db83b18beecfe90de4852df3d23cdc599f4e58e7`，文件SHA `69442fd39c0a92897c0d6de1892e307ab34a8629fa4e76a305dcd75236e7dbef`。
- Review 2026-10-12T00:00:46.364Z，截止 **2026-10-12 01:00:46.364UTC / Winnipeg 2026-10-11 20:00:46.364**。
- 7文件代码绑定 `389e66ad5eab75416009e316b70ab86bd52ca45ac69e0b5c6ca43ae10f85dccc`；库存文件SHA `10c493638658feabfc726deac01bc0e3a44e0b5fae67693a976a4cd402d102b0`。
- before settings SHA `a6433291649fe7ab0fe2d0693d0424835ad3f681789fc059e6eb0f0ed0513d2d`；原通知/订阅组合SHA `d453801fe2a4c092747c76a7a85b0817caa245b8bd790bbd8b11ac7e87c54060`，公开摘要不包含邮箱地址。
- 候选template canonical SHA `cd7e99100d90225f7ba88538f8888a006f446f6b1a873e5da655ee9e815f496b`，文件SHA `3a693ce58300fd18d257b14ffc169d993c4c7505ee11a03885044c5d3bb8459b`。
- 私有Review目录 `F:/ChatGPT_workshop/techlong-f3c3a-cost-controls-20261012-r1`；新永久slot `techlong-f3c3a-sandbox-cost-controls-v1-consumed` 尚未消费。
- 公开[准备证据JSON](../ops/aws-sandbox/reviews/f3c3a-cost-controls.prepared.json)；入口 `ops/aws-sandbox/scripts/review-sandbox-cost-controls-v1.mjs`，辅助脚本 `F:/ChatGPT_workshop/Run-ReviewedCostControls-c43a9aea.ps1` 加准确ApprovedManifestSha，**尚未获本页批准，不可运行**。

确认后一次Run和独立新进程Inspect；代码/manifest/原设置/stackId/TableId/旧CS列表漂移或过期均拒绝下一写。新slot一经消费，不自动复位、补齐、重新创建/执行/写重试、资源回滚或删除。失败仅Inspect，不利用读取结果自动恢复写入。r1及所有旧S0/F3c1/F3c2记录和绑定保留；已有F3c2辅助脚本不可重放。

## 必须接受的风险和费用边界

接受3调用跨CloudFormation/DDB非原子、无服务端整批CAS、检查与写之间竞态、预算更新异步、AWS Login自动刷新或网络/响应/保存失败、部分更新和未执行新CS可能遗留；禁用自动失败回滚后成本栈可能停UPDATE_FAILED，预算可能已50而表仍5。不会自动回到10、恢复旧云CS或放宽门禁。

原五个百分比仍为10/30/50/80/100%，金额随预算改为5/15/25/40/50USD，不是保留原1/3/5/8/10USD金额。只保留原实际费用告警及已绑定地址，不新增forecast/自动预算动作。更新Budget后CalculatedSpend可能短暂归零，不能将其称零费用/余额；费用和邮件均存在延迟。[预算更新行为](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_UpdateBudget.html)。

预算只统计既有Environment标签筛选，不覆盖未标记/标签分配延迟的所有账户费用，**50USD/月不是硬截断或全账户绝对上限**；原其它预算不改。监控和通知本身免费，本批不添加收费action/report；已有/后续AWS资源、DDB有效用量仍收费。[Budgets价格](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)。

提高read cap不预置100容量，保持PAY_PER_REQUEST，但可能允许更多有效请求和费用；max read/write是best-effort目标，burst可暂时超过，既不保证100读吞吐，也不保证瞬时/月底费用上限。既有live应用若已在读，可在改上限后增加用量；本批不启用Worker来消耗它。[DDB最大吞吐限制](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/on-demand-capacity-mode-max-throughput.html)、[异步UpdateTable](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateTable.html)。

不新增/更新IAM、Secret、Key、数据库schema/业务行/authority；不调用Lambda，不创建Cell/ECS/RDS/ALB/Listener，不改DNS/ACM/S3材料/镜像，不启用运行时。费用門禁通过不等于可部署：后续专属任务最小权限、v3调度/准确stack ARN/真实authority/失败创建补偿及短TTL端到端仍各按fresh SHA另批，旧schema1/PLAN_ONLY模板仍不能直接apply。Git两main按既有默认授权直接提交推送。
