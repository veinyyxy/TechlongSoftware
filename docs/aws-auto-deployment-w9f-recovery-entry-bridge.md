# W9f：恢复请求入口与发布证据桥

实现阶段只实现、测试和准备材料，没有生产写入。随后已按下述独立批准完成单行登记和只读回读；没有安装权限、发布云工作流、上传对象或调度部署。现有 81 项云发布闭包及已安装 binding 不变；F3c9 支线保持停止。

## 已批准执行记录（2026-10-25）

用户明确确认 operator 清单 `a1e8cbb0a015d6b933e2a200b0aa8cfc95ce4417dda490b66629dffd11d7f969` 及本文件完整风险后，入口以准确源码 `af51deeea382dbee1cb17d45ef21a24de898821d` 单次执行。执行前该源码 No-AWS CI `40243452430` 已通过。

数据库时钟 `1792970812292`（23:26:52.292Z）提交新 held 任务 `job_9b57b43a6b88f37202b29170`；独立只读连接随后返回 `RECOVERY_HELD_REQUEST_INDEPENDENTLY_VERIFIED`。共两次配置内容读取、两条经验证 TLS 连接，分别 55/18 次 SQL，自动重试 0。新任务 pending、attempt0/max1、无 lease、普通队列不可领取，云执行授权仍为 false。原九条任务、业务/保护状态和全部控制账本保持原样。

写槽及独立回读槽现已永久占用；不得再次执行此清单、复位槽或重建同一任务。原材料及原始输出保存在工程外，完整执行闭包为 `F:/ChatGPT_workshop/techlong-w9f-request-execution-completed-verified-20261025-a.json`，不把业务快照上传 Git。此结果只证明请求登记，不代表部署或云端独立验收。下一步是新恢复协议的最小生产组合及发布审查，而不是重复登记。

## 主线距离与交付边界

W9e 已验证旧执行成功但未完成独立验收、随后准确退役的完整证据。缺失的原始 execution-reference 已于 2026-10-25 获单独许可读回并核验，保存候选重建通过。本阶段不重复该 GET，也不把旧执行补记为 accepted lineage。

本阶段交付两项最小接线：

- `request-local.mjs`：真实本地待审请求入口，复用 source/CI/pins、配置 ACL 元数据、验证 TLS 和数据库 actor/session/database/OID 校验。写入与独立回读必须另获本次 operator manifest SHA 批准。
- `bridge.mjs`：恢复 envelope 的发布/证据验证适配器，沿用 V6 plan、owner SQL、批准和永久 dispatch 槽；不自带数据库客户端或调度能力。`publication.mjs` 只生成本地私有 package 和未批准 draft。

**尚未上线的部分**：消费新 envelope 的云入口、精确新闭包/reusable pin、controller release/risk binding、W9c followup 生产组合及必要 trust 核对。旧通用 PUBLISHED release 本身不能启用新桥；必须由受审代码提供绑定 source、frozen source、release SHA 和新协议的独立 PUBLISHED activation，并通过生产 guard。当前没有这样的安装记录。

因此，测试成功不表示 AWS 自动恢复已经上线；不要把候选 package 或 core candidate SHA 直接交给旧工作流执行。

## 准确请求与保存范围

固定实例 `app_e897a4377bce498b9c5ee9e64509dcad`，新任务仅为 `job_9b57b43a6b88f37202b29170`。旧任务 `job_9db8466fd95cef0c23ad6bfc`、成功回执、历史账本、订阅及权益均不更新。

请求入口只允许一条 reconcile/pending/attempt0/max1、无 lease、`available_at=9007199254740991`、`reviewRequired=true`、`cloudExecutionAuthorized=false` 的新 held 行；不创建 deployment、不启动 TTL、不领取或执行任务。事务复用原 admission SQL，锁定控制历史、业务准入和旧任务；最多一次永久声明、一次 INSERT、一次 COMMIT，独立连接回读新行与全部旧状态。

事实期限固定为 **2026-10-27T18:47:57.695Z（温尼伯 10 月 27 日 13:47:57.695）**，最晚启动提前两分钟；重新准备不延长。执行前完整状态若有漂移则停止，不自动“修复”历史。

准备入口仅在 clean main、准确成功 CI、完整本地证据和配置元数据核验后运行：

```powershell
node --experimental-strip-types ops/platform-recovery-v1/request-local.mjs --mode PrepareSaved --ci-run <本次成功CI> --output F:/ChatGPT_workshop/techlong-w9f-request-<新后缀>
```

输出 `manifest.json`、`publication-package.json`、`publication-draft.json`、`result.json`。PrepareSaved 只读本地固定档案、GitHub CI 和配置文件大小/ACL；不读取 `.env.local` 内容、不连接数据库或 AWS、不占用执行槽。package 含历史业务快照/审查元数据，只存工程外私有目录，不提交 Git，不自动 PUT。

未来仅在准确 SHA 获明确批准后，RunReviewed 使用同一 manifest；Inspect 使用另一个全新输出目录及独立永久槽，不复用写连接。命令不支持 endpoint、profile、SQL、job 或 scope 覆盖。core candidate SHA 不是 operator approval SHA。

## 后续请求登记执行的完整风险

以下是待审范围，不是本阶段执行授权：

1. 写执行最多一次读取现有 `.env.local` 全文件到进程内存、一次经证书验证的 TLS 连接、80 次 SQL 调用、一条新 held 行。独立 Inspect 最多另一次配置读取、另一个 TLS 只读连接和 80 次 SQL。凭据不输出，但现有 owner 凭据权限宽于本次一行范围；应用检查不是数据库权限隔离。提供者/本地日志和内存暴露风险仍在。
2. SERIALIZABLE、短暂行锁/表锁、1 秒锁超时及 15 秒语句超时可能影响并发写入；ACL/源码/元数据检查不是跨系统 CAS。完整读回不能消除所有并发竞态。
3. 永久写槽 `F:/ChatGPT_workshop/techlong-w9e-new-held-request.intent.json` 与独立 `.inspect.json` 槽一经占用不自动删除、复位、补齐或重试。槽已占但请求未写入，也不能自行再试。
4. COMMIT 提交后连接中断可能造成提交结果不明；不自动 rollback/down、补偿或重新 INSERT。必须保留 intent 和原输出，独立回读。缺失 intent 时只允许证明完整基准未变且新行不存在，不接受变化后的状态。
5. 登记不授予云执行权限，不自动发布计划、上传 package、读取 Secret/PEM、修改 IAM 或部署资源。后续发布/Review/RunOnce/Inspect 仍按具体资源、新 SHA 及 GitHub environment 人工批准。50 USD/月仍是预算目标，不是费用硬上限；本阶段不创建收费资源。

## 新发布桥的证据要求

package 保存准确固定版本原件；重建时检查每项 key/version/AES256/SHA、完整旧执行内容、retirement、state 及 branded basis，普通 JSON 本身不能成为 authority。云 envelope 的外层 recovery SHA 与 V5 inner manifest SHA 分开，不能混用证据路径。

Review 只能产生未批准结果；RunOnce 必须有准确 OBSERVED 成功账本、认证的准确 GitHub run、固定报告及 execution descriptor；Inspect 必须是另一 run 的独立只读报告、完整 hash、原期限内时间和精确 predecessor。只有通过验证的实际证明才能发布后继计划。桥不代替用户批准，不调度，不延长领取/TTL，不把未验收旧任务加入 accepted lineage。

## 验证与下一步

本地测试覆盖审批前零端口副作用、source/CI/ACL/state 漂移、永久槽、独立回读、丢失 intent、CLI 覆盖拦截、真实 V5 Review、新旧 SHA 路径、实际账本、三阶段证据链、activation 拦截及 draft 零授权。No-AWS CI 另在一次性 PostgreSQL 中验证真实 INSERT/失败/提交不明，以及新入口的完整历史账本读取；不使用本机或生产数据库。

这一条 held 请求已按上述批准完成登记；不要重复登记。最短后续顺序：完成新云协议的最小生产组合和源码固定审查，再独立批准发布/必要 trust 变更；最后用新 Review → RunOnce → 独立 Inspect 完成一轮验收。不要再扩展成本支线或重复旧过期验收。
