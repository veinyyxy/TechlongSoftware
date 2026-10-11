# F3b3：Neon 只读探针代码已更新，RevisionId 门禁停止，未调用

2026-10-11 Winnipeg。用户确认清单 `c3635097594bdd1443fe4cf814507da14a33ab4723c668ab7a068b5e1cd756f1` 后，在有效期内一次 Run 提交了 **1 次现有 TTL UpdateFunctionCode**。后续检查返回 `NEON_UPDATE_POSTSTATE_DRIFT`，阶段 `READONLY_WAIT`；**同步 Invoke=0，未读取 Secret 值、未连接 Neon、未执行十 SELECT 批次，不能称只读数据源验收通过。**

Run 已停止，没有重试、补调、补齐、回滚或重新更新代码。新永久槽位已消费；本次批准不能转移到另一入口或复位槽位。

## 已证明的安装状态与准确差异

| 检查点 | 结果 |
| --- | --- |
| 原批准的更新前 RevisionId | 0ce68252-11fe-4cd8-9fc6-9fdc1ec44e9f |
| UpdateFunctionCode 响应 RevisionId | 09c85932-67d4-4bce-9924-33c1aea8f14b |
| 两次独立回读 RevisionId | 80270648-9f62-488b-a99c-4d6a86558302 |
| 函数最终状态 | CANDIDATE_READY，Active / LastUpdateStatus=Successful |
| 已安装 ZIP SHA / bytes | 0f2330afbef3e801faf3645f96610d293349705743ae0748de22198391a25533 / 277794 |
| LastModified | 2026-10-11T16:08:53.000+0000 |
| 配置 SHA | 5fac346522f4cbc64c60d70a73493772b14ea2fc87aa1faed350b977101845ae，未变 |
| stable anchor SHA | 3d373a6602d2bbcc111b8879ffa37385ef5a7ce74d9bbad1f7390dbe18d5689a，未变 |

批准的代码已经实际就绪。现有 core 要求更新响应 RevisionId 与就绪回读完全一致；本次两值不同，触发 fail-closed，未创建 `invoke-attempt.json` 或 `invoke-response.json`。旧代码和这个门禁的已批准 binding **不修改**，不据新代码已就绪而补齐未执行调用。

两个 Inspect 观察起点 **2026-10-11 16:09:06.893 UTC / Winnipeg 11:09:06.893 CDT**、**16:09:38.539 UTC / 11:09:38.539 CDT**；第二次为独立新进程。两次均严格验证 TTL 候选字节/配置/7天日志/准确角色，drain 原 p2 字节/RevisionId/配置保持；两 IAM boundary v2 / inline、原 v1/信任/RoleId/标签、两个 Secret 的唯一初始版本/标签与 managed Key/policy 均不变。stable anchor 只排除本次拟改变的 TTL zipSha/RevisionId/LastModified，不忽略其他配置或 IAM 漂移。

`sourcePermissionsAllowed=false` 和空 permissionChecks 是 Inspect 不重复写/调用权限模拟，不是 Source 拒绝。`readProofVerified=false` / 无日志 marker 是本轮没有 Invoke，不是观察到 Neon 连接或 SQL 失败。

## 独立只读诊断

新增独立诊断脚本 `inspect-neon-sealed-update-revision-v1.mjs`，不导入 executor、不改旧 binding/槽位，只用准确 Source 身份读取固定五分钟 Lambda 管理事件窗口并保留闭合摘要。

在 **16:11:13.298 UTC** 的 CloudTrail 两页读取中，只观察到目标函数一次 `UpdateFunctionCode20150331v2`：**16:08:53 UTC**，eventId `9d1bcef2-9555-4958-9604-2867e0a65907`，准确 Source IAM user、准确函数、原 RevisionId 与 Publish=false 匹配，未记录错误。没有在该次响应中观察到目标的额外代码/配置/版本/别名/运行时管理更新；CloudTrail 可能延迟，这不排除所有并发。

AWS 使用 LastUpdateStatus 表示异步更新进度，RevisionId 是当前更新修订标识；这支持“更新响应与完成后的快照修订不同”这一排查方向，但本次记录**不唯一证明是正常异步内部变化，也不证明无其他管理员并发**。[AWS 函数更新状态](https://docs.aws.amazon.com/lambda/latest/dg/functions-states.html)、[UpdateFunctionCode / RevisionId](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionCode.html)。CloudTrail 的该事件名和管理事件性质见[官方日志说明](https://docs.aws.amazon.com/lambda/latest/dg/logging-using-cloudtrail.html)。因此没有放宽原门禁或重放。

## 留存证据

私有根目录 `F:/ChatGPT_workshop/`：

| 文件 | 文件 SHA256 |
| --- | --- |
| techlong-f3b3-neon-sealed-review-20261011-r1-run/submission-receipt.json | 996477536dc68fb9b881149431824131631bd7b545723dd2b628ccb4a799aa0b |
| techlong-f3b3-neon-sealed-review-20261011-r1-run/independent-inspect.json | 1750fbd0471720b467cecd43338e2f8eeb6c5f411c67c44aae65c66924b860d0 |
| techlong-f3b3-neon-sealed-review-20261011-r1-verify/independent-inspect.json | 5ebd0746af63127e2a1d7802f7462d21cc3f18d2a13ecfd68caa5549f889e6d9 |
| techlong-f3b3-readonly-neon-sealed-probe-v1-consumed/update-code-confirmed.json | 96cd762447da182110d1994ffde314f1639a347915180de4bd3b62854bb32df2 |
| techlong-f3b3-neon-sealed-revision-20261011-d1/read-only-diagnostic.json | c93db5ff84532e6b7413c99489ee92bae87536bebb5f0acd4c5c89315d15ac78 |

新 slot `techlong-f3b3-readonly-neon-sealed-probe-v1-consumed` 保留 approved-manifest/update-attempt/update-confirmed；无 Invoke marker。原 17 文件 code SHA `d7919f4aa2827b89276198d731c2e2f444d88b4165a7c52a81c3e58d6c172aba`、候选 p1 source pins/ZIP、旧 KMS 8文件 f382bda1... / 原安装10文件064119b9...保持。所有旧记录/槽位和失败结果保留，不自动删除/撤权/down/reset。

业务 runtime 仍关闭，无 IAM/Key/Secret/Neon role/schema/密码/业务数据/admission/authority/付费 Cell/ECS/Schedule 变更；没有 SecretString/URL/密码或原始 provider/CloudTrail 记录落盘/Git。50 USD/月仍是目标，更新及只读请求不能保证绝对零费用。代码更新就绪不等于源数据、业务 drain、真实 Cell/清理或自动部署验收。

## 下一步：仅调用已安装候选，不再更新代码

先准备独立 **invoke-only** 审阅入口/新槽位/fresh SHA：绑定本次失败回执、两独立 Inspect、候选准确 ZIP/配置、最新完成态 RevisionId 和 stable anchor；仅拟一次新的同步只读探针并独立分页日志核验。**不再 UpdateFunctionCode、不放宽原 consumed 协议、不自动恢复旧代码或补齐本次未执行调用。**

该后继代码准备和实际调用不是本次批准的重放；实际新调用需 fresh SHA 明确确认。准备时再次只读核对最终 RevisionId，任何变化先拒绝，不把异步修订猜测当授权。没有真实 Neon 回执前继续保持 source/业务门禁关闭，不改变 admission 或生成假 authority。
