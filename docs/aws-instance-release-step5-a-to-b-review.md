# D2-6 步骤5：首次正常更新 A→B（仅准备）

本轮只准备[固定范围清单](../ops/releases/d2-6-step5-a-to-b.prepared.json)，不调度，也不查询生产状态或读取凭据。第4步的[真实回执](aws-instance-release-step4-finish-observed-20261117.json)证明初始 A/revision 0 和 runtime 启用已经完成；它是待核对的基线，不是此刻健康报告。正常更新为 **0/2**。本清单不包括第二轮 B→A。

## 唯一入口与目标

| 项目 | 固定值 |
| --- | --- |
| 仓库／分支／工作流 | `veinyyxy/TechlongSoftware` / `main` / `instance-release.yml`（Instance API release） |
| `instance_id` | `app_e897a4377bce498b9c5ee9e64509dcad` |
| `release_id` | `release_afcc95f9eaa20785265300c801fd7618`（B，已登记未晋升候选） |
| `environment` | `sandbox`；受保护 job 的 GitHub environment 为 `techlong-sandbox-deploy` |
| A 预期基线 | `release_00b9c5cfa6bceedc5fd05aa451dca811`，revision 0、无占用，原 digest `sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0` |
| B 固定来源 | 后端原 run `44129167654` 的 attempt 1、artifact `14349965129`，原候选 SHA `de1cfdb8b2a431efeb4241f71f70cd602587badf4470b797dc85c043f73dbf52` |

B 与 A 的原构建使用同一源码提交，但已核验的镜像配置摘要不同。B 的目标 ECR manifest 和运行平台 digest **尚未知**，不得拿配置摘要、tag 或 ZIP 摘要代替。仍使用原 ECR 不可变仓库和 B 的准确 tag，由实际 registry 原文、`linux/amd64` 映射和候选配置摘要共同派生；结果必须区别于当前 A。

## 未来顺序与审批边界

1. **获得本清单的单次调度授权后**，才可核对远端 `main`、已安装的人工门禁和该工作流是否已有未终态运行，再由 GitHub 单次 dispatch，记录实际 run ID、attempt 1、准确 SHA 和三输入。`main` 须包含已启用 runtime 的 `aeac8ea`，相对该锚点只可有清单列出的文档差异；发现其他更改或已有未决 run 即停。一旦 POST 去向不明，只核对同一请求可能产生的 run，不再 POST 或 Re-run。
2. **dispatch 不是零副作用预览。** 既有 `prepare` job 会经 planner OIDC 使用固定版本的 planner DB Secret，窄读 Neon 里的候选、绑定和占用，重新采样准确旧栈、AWS/ECR 等元数据。预期 B 候选路径只产出 `PROMOTION_PLANNED` 摘要和与该 run 绑定的 handoff，不推 ECR、不创建 Change Set、不登记正常部署请求。现有入口也支持已晋升版本；若 B 状态在调度前后发生变化，通用 `prepare` 分支可能登记一条该 run 的计划或非执行决定，**因此调度批准须接受这项有限账本副作用**；遇到非 `PROMOTION_PLANNED` 一律不批准部署。以新采样核对 A 基线、实际拓扑、兼容性及持久化指纹；只有原 revision 0 与无占用相符才继续，历史快照的期限不重计。新 run 审批前材料未能证明这一点时不先批准，确有需要才另审准确只读补核。
3. **只在摘要匹配后，由用户本人批准准确 run 的 `techlong-sandbox-deploy` 一次。** 审查实例、A 基线指纹、B 候选／校验摘要、原不可变仓库与 tag、run/source 绑定及原 `writeBefore`。审批界面或 job 参数不符、窗口不足或过期，不批准。既有受保护 job 才可读取准确原 run/artifact、下载一份 ZIP 并验证原字节，按条件加载／标记／推送一份 app，核对实际 ECR 原文并通过窄权限确认 B 目录。没有本机构建、重新登记、额外镜像或挑选新版本。若准确 tag 已存在，既有代码只在验证确为同一候选时复用，不覆盖，不假定本次一定发生推送。
4. 同一受保护 job 保留原栈与所有其他参数，仅用 `UsePreviousTemplate` 更新 `ImageUri`；仅允许 `TenantTaskDefinition` 和 `TenantService` 的原受审变更形状。一次 CreateChangeSet、严格检查实际模板/参数和当前 A 后最多一次 ExecuteChangeSet。独立 verifier 核对真实平台 digest、健康任务、归属与配置、`/health` 和 `/ready`，保存带准确 VersionId 和内容 SHA 的私有证据并回读，最后由 executor 执行 CAS：成功才写 B/revision 1、释放占用。

## 上限、期限和失败处置

- 原工作流：prepare 最多 15 分钟、deploy 最多 60 分钟；审批等待另计。B 原 artifact 到期 **11 月 18 日温尼伯 10:45:19（16:45:19Z）**；扫描数据库原 48 小时窗口到 11 月 19 日 07:00:16（13:00:16Z），不因执行刷新。以 artifact、扫描、新 handoff `writeBefore` 的更早限制为准。按 15 分钟准备、15 分钟人工预留、60 分钟部署倒排，建议最晚 **11 月 18 日 09:15:19** 前调度，最晚 **09:45:19** 前批准；这是操作预留，不是修改工作流的倒计时。实际剩余不足则不启动／不批准。
- 既有 job 范围：四个用途各一次 OIDC/STS 交换及身份校验；固定版本 Secret 值最多五次（四个 DB 登录及一个后端 artifact token），只在运行器内使用；不读本机配置、PAT、PEM 或未列入范围的 Secret。正常成功链最多六次元数据采样（每次 40，最后一次为独立 verifier）、两次技术 GET、一个原 ZIP（既有 500 MiB 保护上限，封存实际为 72,662,028 字节）、最多一次 Docker push（底层可有多次 ECR 层/manifest 请求）、最多八次晋升 ECR CLI 调用、四次晋升证据的条件 S3 PUT，另有独立核验证据的一次条件 PUT/准确版本 GET。Change Set/栈轮询上限分别 40/60 次，10 秒间隔，仍受原写时限、执行读取时限和 job 超时保护。
- GitHub job 以候选原件、窄目录确认、原 stack 和 release 账本为唯一作用范围；不改 IAM、Secret 版本、模板、网络、Aurora、图片、业务表、工作流或 GitHub environment。不新设资源到期，不自动回滚、重试、补齐、重部署或清理；仅允许原 CFN/ECS 自身受管行为，不另发人工回滚。
- 晋升、目录与部署不是一个事务。可能留下部分 ECR 层、已晋升 B、证据、Change Set、活动占用或已变更但未确认的服务；未知结果进入核对，不重派。现有 ALB/ECS/Aurora 等可能持续计费；滚动期间可能短暂并行任务，另有 ECR、证据存储、传输及 GitHub 运行费用。50 USD/月不是硬限额，计划截止不是停费时间。
- **判定 1/2** 需要准确 run、`SUCCEEDED / INDEPENDENT_RESULT_RECORDED`、同请求的固定版本独立证据和控制面 B/revision 1/无活动占用相符。GitHub 绿色、`NO_CHANGE` 或受管回滚均不计。若运行结果不足以证明最后三项，先保存回执，只另审准确请求／实例及证据版本的只读补核；不临时扩大权限或再部署。

本文件是待审范围，不是现成的 run 批准。此次只生成材料与做本机现有回归，不生成真实 handoff、目标 digest 或一次性执行槽。B→A 只有在首轮真实验收后，才按同一部署源码、工作流和配置单独准备、批准。
