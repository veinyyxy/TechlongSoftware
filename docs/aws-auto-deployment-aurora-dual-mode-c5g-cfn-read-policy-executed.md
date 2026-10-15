# C5g 已执行：CFN 读取策略 v8 默认，旧 v7 完整保留

2026-10-15 America/Winnipeg。用户在唯一 fresh SHA `dee0a0003308e809cb1d767d07756243507a99cb683b5181452e54168e77d9da`、准确一次写入范围及完整风险呈现后回复“确认”。仅据此执行该 IAM 更新及成功/失败后的独立只读核验，没有推定后续部署或其他写入许可。

**结果：`EXACT_NEW_READ_POLICY_DEFAULT_V7_RETAINED`。本阶段完成；不是应用已部署或 ready。**

## 实际执行

- 写前9次只读核对确认准确Source、CFN RoleId/PolicyId、完整trust/原policy、唯一attachment/空inline、仅v7库存，以及identity/boundary两类唯一消费者均无漂移；清单未过期，7源码/依赖pins及3历史证据保持。
- UTC **16:11:49.637** / Winnipeg **11:11:49.637 CDT** 消费唯一永久槽。随后仅一次 `CreatePolicyVersion(SetAsDefault=true)`，UTC **16:11:49.797** 捕获实际新版本 **v8**，没有预设版本ID、删除v7或发起第二次写调用。
- 另一进程立即执行 Inspect，UTC **16:11:55.488** / Winnipeg **11:11:55.488 CDT** 保存独立inventory：默认v8、v7非默认，两版本且无额外版本；当前完整v8文档与已批candidate digest一致，role/trust/consumer保持。另一次GetPolicyVersion(v7)按原完整文档digest比较通过。该旧版响应未另存独立raw文件；核对范围由绑定源码与Inspect结果记录，不冒称存有全部原始provider响应。
- 本地提交回执version与request SHA匹配当前default，因此 `attributed=true`。request SHA `61dee97ceb2eb4ea5d0026d379fcc87f9c19378b6526465711094f741a3e023f`。

准确policy：`arn:aws:iam::402010193138:policy/TechlongSandboxCloudFormationExecutionBoundary`，PolicyId `ANPAV3GNMXTZOQPIXOKJ4`；唯一角色 `TechlongSandboxCloudFormationExecutionRole`，RoleId `AROAV3GNMXTZKHYBCRSOE`。同一policy的identity与boundary两种用途均使用新default。原v7 digest `7b1d73a2defce79a34dc6e18ffa6f349302e2b1046b99256d86708ee5bb950d5`，新v8 digest `bd2bd7d52bfdcc1f9c97230f510867d7be10a15f1a1269aa9e0f068add7f70ad`。

新增仍仅六statement/八读取action；除准确service/deployment、target group、两listener子rule及log group外，两项Logs inventory为ca-central-1区域Resource:*。完整范围与持续风险见[原安装审阅](aws-auto-deployment-aurora-dual-mode-c5g-cfn-read-policy-review.md)。旧历史权限不收窄；不改task execution inline或七消费者共享service boundary，不自动撤销。IAM传播、并发或未来CFN覆盖/drift的风险并不因这次回读消失。

## 调用、证据和已消费状态

本轮实际 **19次只读调用（Run9 + 独立Inspect10）+ 1次IAM写**，自动重试0。没有模拟、其他IAM或资源写、Secret值/私密包读取、Aurora/Neon SQL、owner/authority/业务写、job/TTL、workload/DNS部署、镜像构建或发布。没有修改执行代码或重复上一阶段25项tests；本次验证是实际单次安装及独立在线回读。

- Run：`F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-run-20261015-r1/`。
- 独立Inspect：`F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-inspect-20261015-r1/`。
- 永久槽：`F:/ChatGPT_workshop/techlong-express-c5g-workload-cfn-read-policy-v1.permanent-slot.json`，**已消费，retryAuthorized=false**。
- 原批准清单：`F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-review-20261015-r1/manifest.json`，原Review与prepared capsule保留为历史，不回填。
- [版本化已执行摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5g-cfn-read-policy.executed.json)绑定本轮10项证据及原prepared capsule。完整IAM文档仅存本地，不复制到Git。

**不得重跑Run、复位/替换槽或以此SHA再次安装，即使原12:04清单时间尚未到期。** 原v7保留不等于获准回滚；回滚/撤权也需新具体许可。成功安装只证明当前文档/default状态，不证明CFN provider、ECS日志、Secret/KMS、IAM数据库连接或应用initialized-ready已经通过。

## 唯一继续点：回到实际交付闭环

现在权限前置已安装。下一阶段集中完成**实际first-claim/epoch条件安装及激活 → 七资源workload/DNS → provision → 独立initialized-ready与平台原子回写**，不再增加日志模拟、恢复/Grant或F3c9支线。完整live root仍未完成；不先创建running job后再补代码，不以bootstrap 200替代initialized-ready，不重放C5e私密读取、seed或ECR发布。

实际部署、私密重载/Secret值、Neon/authority/SQL写仍需新的准确范围。尤其现有Cell标签仍为UTC **16:44:56.246** / Winnipeg **11:44:56.246 CDT**，没有续期；首次交付草案要求至少30分钟余量，不能为了赶窗口绕过时间检查或提前认领。后续时间不足/过期时，把新的交付时间范围纳入下一真实部署清单重新审阅，不把旧IAM许可当作续期、部署或清理许可。

现有资源继续计费；标签不自动删除或停费。50 USD/月仍是目标而非硬cap，本次没有新付费Cell，但没有停止已有费用。
