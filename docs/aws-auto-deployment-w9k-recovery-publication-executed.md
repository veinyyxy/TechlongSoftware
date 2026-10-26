# W9k — 工作流及 trust-only 发布已独立验收

2026年10月25日（温尼伯晚间）完成。批准清单 SHA：`c53c7f8ef5758afe35ef7d5397fb3489cf650d3dbb199fd0d41df66ca03b290c`；完整批准范围和风险保留于 `aws-auto-deployment-w9k-recovery-publication-review.md`。

## 已完成

两份**既有**工作流更新已发布，无新增分支：

- reusable：`4c09548ab9852a4f3e948f0686f8c81251cda73b`，GitHub workflow ID `390829324`。
- caller：`f76d8264e7805a1a9c3eedb0fbd40cd1b0ad0a92`，GitHub workflow ID `390829326`。
- 云端执行源码仍冻结为 `0494b2be7b0f559ac991533137dfb1b0388ac7a9`，97文件 closure `30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374`。

准确 foundation 栈 `ca-central-1 / techlong-sandbox-cloud-worker-foundation-v5 / 308174f0-ca9e-11f1-a04d-02569e9287b5` 的 Change Set `recovery-app-v1-f76d8264e7805a1a9c3eedb0 / 7b7f413f-e5fc-42c2-8e80-fa8123cc8e4b` 仅包含 WorkerRole 的静态、非替换 trust Modify。创建、严格比对、执行各一次；新 trust 仅将 `job_workflow_ref` 固定至上述 reusable commit。

角色 ID `AROAV3GNMXTZK5O45RG24` 未变。独立进程读取确认新模板、新 trust、两份工作流及 blob 匹配；完整剩余布局与执行前快照一致，包括原策略、boundary、其他资源、审批与 OIDC 限制。结果为 `APP_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH`。发布后的 main 在验收时为上述 caller commit；后续普通文档/测试提交不改变该固定 reusable 或云端源码。

## 执行与证据

首次调用在 Source 凭据失效时、占槽前停止，未推送或调用云写。原失败目录保留。用户刷新后先独立只读核对（AWS元数据10次、GitHub GET11次），用户再明确回复“继续发布”，随后在新输出目录恢复唯一一次实际写入。

发布统计：non-force push1、CreateChangeSet1、ExecuteChangeSet1、本地 main 快进1、AWS元数据54次、GitHub GET45次。独立 Inspect：AWS元数据10次、GitHub GET11次、外部写0。发布槽和独立 Inspect 槽均已永久占用，不得重跑、复位或删除；未发生自动写重试、回滚或清理。

工程内摘要：`ops/aws-sandbox/reviews/platform-recovery-publication-v1.executed.json`。保留 manifest、原始结果及前置快照等11项本地证据引用和原始文件 SHA；完整证据在 `F:/ChatGPT_workshop/techlong-w9k-recovery-publication-run-20261025-b/` 与 `...-inspect-20261025-a/`。旧失败目录 `...-run-20261025-a/` 不覆盖。

一条发布前测试曾要求运行工作流仍指向旧 V6 入口；该假设在批准发布后不再成立。现仅将测试改为校验本次已验收固定版本的完整 renderer 文本及 SHA，不放宽手动输入、人类环境门禁、closure 或默认关闭要求，不修改运行时代码。

## 尚未完成，不得混淆

本阶段没有读取 Secret/私钥/配置值、连接数据库、上传恢复包、激活控制器、调度 Review/RunOnce/Inspect 工作流，或创建 Cell/ECS。控制器编译绑定仍为 `CANDIDATE`，默认入口保持关闭；“发布成功”不等于“业务自动部署已验收”。

下一小阶段：分别准备恢复包的一次受审上传，取得固定 S3 VersionId，再准备准确 release/controller 绑定及激活清单。实际上传、激活和部署仍分别批准。现有持有任务 `job_9b57b43a6b88f37202b29170` 尚未领取，原恢复事实截止不延长。F3c9 继续停止。
