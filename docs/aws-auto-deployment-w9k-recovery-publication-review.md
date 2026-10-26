# W9k — recovery 工作流和 trust-only 发布

## 主线范围

复用 `platform-publication-v6` 已有严格发布器；新增代码限定的 recovery profile，旧入口默认行为不变。不再扩展 F3c9，不修改 UI，不创建分支。代码/文档提交沿用授权，下面的实际发布仍须准确新 SHA 单独确认。

本阶段仅准备：更新两个**现有**手动工作流，固定 W9g 源码 `0494b2be7b0f559ac991533137dfb1b0388ac7a9`、97 文件 closure `30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374`。保留七项外部输入、GitHub App actor、main 分支、human environment 门禁及单一并发组；caller 引用准确 reusable commit。新 Git 对象只保存在本机，无新分支、不移动 main、不推送运行工作流。

实际批准后的上限：一次 non-force Git push（两项现有工作流修改）、一次 CreateChangeSet、严格核对后一次 ExecuteChangeSet，以及本地 main 一次快进。准确栈为 `ca-central-1 / techlong-sandbox-cloud-worker-foundation-v5 / 308174f0-ca9e-11f1-a04d-02569e9287b5`。只改现有 `TechlongSandboxGitHubDeploymentWorkerRole` trust 的 `job_workflow_ref`，从 `4588febb7b33378ccf2aa1a2b552a18660be8292` 到清单固定的新 R。actor、权限、boundary、其他四个资源及所有模板内容不变。

不上传恢复包，不读私钥、Secret 值、`.env`，不连接 Neon/Aurora，不写业务状态，不激活控制器，不调度 Review/RunOnce/Inspect 工作流，不创建 Cell/ECS。月预算目标仍为50 USD，预算不是绝对费用硬上限。

## 事实与执行门禁

PrepareSaved 只读取已获准并完成的 W9i/W9j 本地不可变证据，校验两份封口及其全部附件原始 SHA。不会因为证据不足而扩大在线读取。它仅额外认证查询准确源码的 No-AWS CI run 和 jobs；不请求 AWS。

旧读范围没有证明聚合栈状态、stack RoleARN、当前未完成运行、管理员 bypass 或 OIDC customization。清单将这些明确列为**执行要求，而非已观察事实**：执行前使用 Source 身份读取完整现状，要求 UPDATE_COMPLETE、无自定义栈角色/参数、原角色 ID、原模板/权限/资源、main-only human environment、不可 bypass、immutable OIDC subject、无未完成 deployment run，且 main 等于准确清单 parent。既有两工作流的 blob、内容及 ID 也须匹配。

完整前置快照须在180秒内完成，先保存再消费永久槽；槽绑定该快照 SHA。发布中再次比较完整快照，除 main 和唯一 trust pin 外不允许漂移。总执行窗口20分钟，AWS元数据最多180次、GitHub GET最多160次，每个 SDK `maxAttempts=1`、固定官方 endpoint，无自动写重试。读取原模板不解析 dynamic reference；不会主动读取参数 Secret。由于 DescribeStacks 的响应可能包含现有参数，执行要求参数为空，若有即停止且不输出其值到聊天。

清单最长24小时，且不得超过最早 W9i 事实采样结束后24小时；刷新材料不能重置事实时间。过期只重新审核，不重放旧清单。

## 完整风险与失败处理

- GitHub 与 AWS 非原子；并发读取不是跨服务 CAS。读取后仍可能被其他操作者改变。CFN role ID/模板比对不能完全消除竞态。
- 工作流先发布、trust 后更新。任何失败可能遗留已发布工作流、未执行 Change Set、部分 trust 更新，旧版本工作流可能失去角色入口；不代表平台已激活或业务部署成功。
- Execute 使用 DisableRollback。失败不会自动回滚；不执行删除、补齐、撤权、恢复旧 pin、重推、重放、重置槽或自动新尝试。CFN 服务自身处理更新仍有非零费用和资源风险；预期仅一个非替换 trust Modify，实际变更不匹配即禁止执行。
- Source Login 可能失效，API超时或响应丢失可能导致提交结果不明；保留证据，只做独立检查，不自动重试写入。Git push 无多服务 CAS，GitHub main 漂移会停止后续操作。
- 凭据在进程内存使用；网络、AWS/GitHub/提供者审计日志可能记录 Account ID、ARN、模板、部署元数据。证据文件包含这些内容，不能视为绝对无敏感信息。低成本但非绝对零费用。
- 使用固定新永久发布槽及独立 Inspect 槽。占用后不自动复位；未知失败也不能自动重放。同一槽不因新的审批 SHA 复用。Inspect 使用另一进程/SDK客户端及保存的前置快照，只读核验完整布局、准确工作流，不修复资源；调用写方法在能力层直接拒绝。独立核验失败或漂移时不宣称成功。

## 入口与后续

入口：`node --experimental-strip-types ops/platform-recovery-publication-v1/local.mjs --mode PrepareSaved --output F:/ChatGPT_workshop/techlong-w9k-recovery-publication-<unique> --ci-run <exact-successful-run>`。仅产生未发布 R/caller、模板和 `manifest.json`。

Publish 必须显式提供该 manifest 和完全相同的 `--approved-sha`；Inspect 仅在发布槽及其快照哈希正确时允许。目录固定在 F 证据根、文件以 wx 写入；环境注入、额外 CLI 参数、profile/endpoint/retry 覆盖均拒绝。

通过后再分别准备恢复包一次上传、固定 VersionId 的控制器绑定/激活、以及有人在线配合的 Review → RunOnce → 独立验收。当前持有任务 `job_9b57b43a6b88f37202b29170` 不在本阶段领取或重放，原恢复事实截止不延长。W9i/W9j 已消费的在线读取额度不复用。
