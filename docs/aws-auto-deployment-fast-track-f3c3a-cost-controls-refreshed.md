# F3c3a：Source 刷新后的新执行清单（未执行）

2026-10-11 Winnipeg。用户报告Source已刷新后，CLI只读核验准确UserId `AIDAV3GNMXTZEO7SHLC2X`、账户402010193138、ARN `arn:aws:iam::402010193138:user/techlong-sandbox-dev` 成功；随后只运行一次新的Review，不重放r1失败辅助脚本。

2026-10-12T04:03:15.406Z / Winnipeg10月11日23:03:15.406的集中实际回读：原成本栈CREATE_COMPLETE，预算仍10USD，准确TableId `58c851f4-5b8e-45ce-8933-05c33b17fb21` 的表ACTIVE/read5/write2；准确两条旧FAILED/UNAVAILABLE Change Set未变，完整只读原件再次保存。四项Source权限模拟均allowed，尚不保证实际执行成功。新永久槽位仍未消费，**本轮AWS写0，尚未创建新CS、更新预算/表或删除旧CS**。

新旧manifest完整比较，只有reviewedAt、expiresAt、manifestSha256三个字段变化；代码、before设置、资源范围、候选template和风险均完全一致。原13新+4相邻17测试/type/lint准备结果仍适用，本次无代码修改，不重复离线模拟、镜像构建或材料探针。旧r1、其批准、0写失败回执/Inspect失败和原辅助入口保留，不覆盖、不转移旧审批到新SHA。

## 新 SHA 与证据

- 新Manifest SHA：`d662dab65100299ee922b84a88cc0a8c42db2f16bfbeb6597827b01dbf8903fe`。
- 文件SHA：`4dfbffe855d1ac91cf887288dbe375aac3a6867081023641a5a24845fa56abb2`；7文件代码绑定：`389e66ad5eab75416009e316b70ab86bd52ca45ac69e0b5c6ca43ae10f85dccc`。
- Review：2026-10-12T04:03:20.340Z / Winnipeg2026-10-11 23:03:20.340。
- 截止：**2026-10-12 05:03:20.340UTC / Winnipeg2026-10-12 00:03:20.340**。
- 库存文件SHA：`3fa3f1bd4b42043e153114cfd8776fa8018c1d6cdd570e9df1ffd3d2645f9fd6`；before settings SHA：`a6433291649fe7ab0fe2d0693d0424835ad3f681789fc059e6eb0f0ed0513d2d`。
- 原通知/订阅组合SHA：`d453801fe2a4c092747c76a7a85b0817caa245b8bd790bbd8b11ac7e87c54060`，公开摘要不包含邮箱地址。
- 候选template canonical SHA：`cd7e99100d90225f7ba88538f8888a006f446f6b1a873e5da655ee9e815f496b`，文件SHA：`3a693ce58300fd18d257b14ffc169d993c4c7505ee11a03885044c5d3bb8459b`。
- 私有Review目录：`F:/ChatGPT_workshop/techlong-f3c3a-cost-controls-20261012-r2`；[公开刷新摘要](../ops/aws-sandbox/reviews/f3c3a-cost-controls.refreshed.json)。

## 原定最多三写范围，仍须本新 SHA 确认

1. 在准确成本栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-cost-guardrails/b91bb3d0-9424-11f1-8b02-02a8988b0b23` 一次CreateChangeSet（UPDATE），名称 `techlong-f3c3a-cost50-d662dab65100299ee922`。候选只把MonthlyBudgetUsd固定50，并显式保留原Budget TimePeriod；其余模板/参数/标签/邮箱/五比例告警保持，不绕过CloudFormation直接改预算。
2. 有限只读严格核对准确ARN、完整template/参数/标签/描述和**仅准确SandboxMonthlyCostBudget的Modify、Replacement=False、Properties/Budget、RequiresRecreation=Never**，不存在额外资源/IAM/替换/嵌套/漂移才一次ExecuteChangeSet，DisableRollback=true。再实际回读UPDATE_COMPLETE和预算50、原通知/订阅及绑定配置一致。
3. 预算已核验通过后，才一次更新准确原DDB表 `arn:aws:dynamodb:ca-central-1:402010193138:table/techlong-sandbox-tenant-external-epoch-authority` 的OnDemandThroughput read100/write2；随后独立新进程Inspect。保留原TableId/PAY_PER_REQUEST和其它绑定配置，不读写Item。

执行仍接受CloudFormation自动删除该成本栈以下**准确两条旧FAILED Change Set**，云对象不可恢复，本地完整记录保留；其它对象出现或状态变更即停，不调用DeleteChangeSet。不以三次直接调用限制服务内部写入次数。旧预算通知比例10/30/50/80/100%保持，金额变为5/15/25/40/50USD；预算只是标签筛选告警，不是全账户硬费用上限，DDB cap是best-effort而非保证吞吐/瞬时上限。

- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786302438/652e5dd5-e04b-4d8f-b7ee-04af0b2c52d9`
- `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/awscli-cloudformation-package-deploy-1786306192/f3adc3b8-2caa-4280-b697-aec9c934ed2e`

原清单的全部费用/非原子/并发/无CAS/异步/凭据自动刷新失败/部分遗留风险保持；禁用CFN失败自动回滚，失败只Inspect，不自动复位/补齐/资源回滚/删除/写重试。[原完整范围与风险](./aws-auto-deployment-fast-track-f3c3a-cost-controls-review.md)、[r1零写失败记录](./aws-auto-deployment-fast-track-f3c3a-cost-controls-preflight-stopped.md)。无IAM/Secret/Key/Neon/authority/Item/Lambda/Cell/ECS/RDS/ALB/Listener或Worker激活，不重建或重发镜像。

## 一次执行入口与继续

新辅助脚本 `F:/ChatGPT_workshop/Run-ReviewedCostControls-d662dab6.ps1` 加准确ApprovedManifestSha；新输出仅 `...-20261012-r2-run` 和 `...-20261012-r2-verify`，两者当前不存在。slot `techlong-f3c3a-sandbox-cost-controls-v1-consumed` 仍空，批准后一次Run/新进程Inspect，消费即永久保留。

**Source刷新不是云写批准，旧批准不自动转移：目前等本页新SHA确认，不运行r1或r2辅助脚本。** 过期仅新的只读Review并重新确认；如果凭据再次不可用则预检停止，不绕过身份/权限/槽位门禁。门禁通过后才准备专属任务IAM/v3准确短TTL与真实清理，实际新云变更另批，旧PLAN_ONLY不能直接apply。两main按既有默认授权提交推送。
