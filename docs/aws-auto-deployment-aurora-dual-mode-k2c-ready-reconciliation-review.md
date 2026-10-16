# K2c 最终待审：把已初始化租户收口为平台 ready

> **已执行并消费，不再运行。**用户确认准确f98bcd6c…及完整风险后，Winnipeg 2026-10-16 01:30:52.825唯一三行事务提交；01:31:26.312新进程独立认证验收通过。平台active/ready/succeeded、旧lease已清、原attempt1/max1/计划/错误证据保持。共两次私密加载/四GET，三个永久槽和全部本轮批准消费，不重试、不再次Inspect/POST；固定07:04:28.726 CDT到期不延长。[实际结果、22份证据和唯一继续点](aws-auto-deployment-aurora-dual-mode-k2c-ready-reconciliation-executed.md)。下方为原审批历史。

状态：**实现、39项测试、types/零警告lint、真实只读Review及独立绑定复核通过；尚未执行、平台仍非ready。** K2b初始化已成功并封存，不再POST或重做初始化。新增的是独立人工协调入口，不放宽旧worker的有效lease门禁。

## 最终清单与时间

- SHA：`f98bcd6ce2123c1e99085097e846937a8f389002f7637acd6cb1547efce2c5c0`。
- 原件：`F:/ChatGPT_workshop/techlong-express-k2c-review-20261016-r2/manifest.json`。
- 生成：Winnipeg **2026-10-16 01:13:10.481 CDT**（UTC06:13:10.481）。
- 入场严格早于 **03:13:10.481 CDT**（UTC08:13:10.481）。
- 事务及独立Inspect严格早于 **03:28:10.481 CDT**（UTC08:28:10.481）；过期不读私密材料、不签JWT/调用应用、不执行写入。
- 原workload到期仍为 **07:04:28.726 CDT**（UTC12:04:28.726），不延长、不停Janitor；50 USD/月为目标非cap。

## 一次事务，三条已有记录

准确deployment `dep_7c99bd249470184852f0dc74`、instance `app_e897a4377bce498b9c5ee9e64509dcad`、job `job_202c8dc12a8bf379f3a7c693`：

| 对象 | 当前真实状态 | 唯一允许变更 |
| --- | --- | --- |
| instance | pending，准确access URL已存在 | active，保留准确URL，写provisioned/updated时间、suspended=NULL |
| deployment | configuring，旧artifact，outputs={} | 实际新artifact、ready及时间；准确stack/observation、人工恢复receipt，嵌套保留旧outputs |
| job | running，attempt1/max1，旧lease已过期 | 人工协调为succeeded，清lease，写完成/更新时间；不续租、不增加attempt |

一个SERIALIZABLE事务、七条固定语句；锁定九条关联行并用服务端整行摘要精确比较，DB身份/endpoint/catalog、DB时钟/订阅/环境及30秒事实窗口门禁，修改后允许列以外全部字段保持。不INSERT/DELETE/DDL或创建job，不改原desired_plan/plan_hash/幂等键、错误字段、generation/epoch/authority。旧artifact、lease归因及旧输出/整行摘要入人工receipt；原token不离开数据库。**这是人工恢复的终态协调，不冒充旧worker持有效lease完成。**

执行前重新核对承载，Run和新进程Inspect各重新读原私密包一次并各做readiness/control两个mTLS/JWT GET，共两次私密加载/四GET；旧loader会读入未使用的测试Stripe材料，不调用Stripe。0 Secret值读取、0 Aurora连接、0 POST、0 AWS/IAM/Secret/DNS/DDB写，不更新镜像或部署资源。

## 已完成的只读准备

最终r2现场35 SDK/11 CLI/2 Neon只读事务通过：准确新栈UUID `f71252c0-c917-11f1-8148-02ff648cb917`、task definition:2、digest `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，1运行/healthy target；Cell/IAM/固定Secret元数据/DNS/DDB/Janitor保持。平台仍旧configuring/pending/running-expired，三条终态时间为空，原attempt1/max1及空outputs不改。

Neon身份为neondb/OID16396、neondb_owner/OID16392、PG18.6/GMT。九条整行摘要、三表目录及公共非extension函数定义真实回读，catalog服务端SHA `3acdd88bfd8f8320a0191dcc97189b8ea39b08a34f0296e4df373abb43d84a1e`。三表相关非internal触发器及完整函数定义已检查：pending→active、configuring→ready均在现有admission函数提前返回；sealed-plan guards只保护另一个旧app/deployment，本次准确坐标不触及该fence；其余仅INSERT/DELETE/未修改列的触发器不在本次路径。未修改/停用任何触发器或约束。函数catalog摘要不是消除并发DDL的全局锁。

13项新测试+26项相邻测试、typecheck、五文件ESLint零警告、四脚本syntax及最终Check通过。另进程重算canonical manifest、全部当前binding、同一计划派生、五份最终证据hash，三新槽均空。5新raw pins、20项初始化历史pin、旧23raw及70旧规范化import pins存在重复，不称为独立文件总数或第三方包安全审计。[脱敏准备记录](../ops/aws-sandbox/reviews/aurora-dual-mode-k2c-ready-reconciliation.prepared.json)保存准确原件hash。

r1只读Review保留；补充current_step/suspended/时间验证及准确新栈绑定后，由r2取代。r1从未获批或执行，不可运行。两轮共70 SDK/22 CLI，另包括前期探索在内合计5次Neon只读事务。本轮私密包、Secret值、Aurora、应用HTTP、云/平台写、槽消费均0；应用已初始化的证明来自K2b历史，未冒充新的认证GET。

## 确认范围与完整风险

请先阅读[固定完整风险 v1](aws-auto-deployment-aurora-dual-mode-k2c-ready-reconciliation-risk.md)，raw SHA `1ea38af7e2d2a1f42f44cc0e409ff152e08fd453e2c7be4ffde13b8ba8f41bd1`。需明确接受：真实平台三行终态改变、人工收口不是完整无人值守链路验收、私密材料进入内存/提供者日志、短暂行锁/序列化失败、跨服务非原子/30秒事实仍可能漂移、提交结果不明、非零持续费用，以及三个新永久槽消费后不自动复位/补齐/回滚或重试。独立Inspect一次，不能因无ack就再次写入或恢复旧POST。

建议确认文本（尚未发送，代码提交不是执行授权）：

> 我确认按清单 `f98bcd6ce2123c1e99085097e846937a8f389002f7637acd6cb1547efce2c5c0` 执行K2c：一次Neon三行原子协调，Run/Inspect各一次原私密包加载及两个认证GET，独立核验平台ready；明确这是人工恢复，不续租或增加attempt、不再次初始化、不改AWS/IAM、不延长期限，并接受完整风险及永久槽不自动复位或重试。

## 获准后唯一继续点

先核对仍在窗口、全部绑定与三槽仍空；获准后从平台仓只运行一次：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-ready-reconciliation-v1.mjs --mode Run --manifest F:/ChatGPT_workshop/techlong-express-k2c-review-20261016-r2/manifest.json --approved-sha f98bcd6ce2123c1e99085097e846937a8f389002f7637acd6cb1547efce2c5c0 --output F:/ChatGPT_workshop/techlong-express-k2c-run-20261016-r1
```

准确write intent和submission已保存后，由新进程执行唯一只读Inspect（不要求成功ack；失败不重放Run）：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-ready-reconciliation-v1.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-express-k2c-review-20261016-r2/manifest.json --approved-sha f98bcd6ce2123c1e99085097e846937a8f389002f7637acd6cb1547efce2c5c0 --run F:/ChatGPT_workshop/techlong-express-k2c-run-20261016-r1 --output F:/ChatGPT_workshop/techlong-express-k2c-inspect-20261016-r1
```

若提交未发生/证据不足、旧行不符、提交不明或窗口过期，保留原件停止，不自动重试、换槽、延时或恢复其它支线。最终如成功，只报告当时承载/配置及平台终态；下一是核对首轮剩余验收项和资源清理，不再默认增加Grant/generation功能。
