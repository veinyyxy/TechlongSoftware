# C5j 主线检查：原 workload 已被旧 Janitor 删除

状态：**镜像窄更新预检已停止；没有有效执行清单，不能审批/执行原 UpdateStack。**

## 真实时间线（2026-10-15 UTC / Winnipeg CDT）

| 时间 UTC | CDT | 已独立核对的事实 |
| --- | --- | --- |
| 21:12:22 | 16:12:22 | C5i GitHub 38807901068 两份修复镜像发布成功 |
| 21:13:32 | 16:13:32 | Source 立即撤权 readback 为 Locked/v10；21:15:24 新进程独立核验通过 |
| 22:10:27 | 17:10:27 | 原 workload ExpiresAt；这是旧部署窗口，不是本次新批准 |
| 22:23:38.126 | 17:23:38.126 | CloudTrail 记录旧 Janitor assumed role 对原准确 stack name 调用 DeleteStack；CFN 同时进入 DELETE_IN_PROGRESS |
| 22:31:36.285 | 17:31:36.285 | 准确旧 UUID 栈 DELETE_COMPLETE，七资源全部 DELETE_COMPLETE |
| 10月16日 00:29:36 | 10月15日 19:29:36 | 本次独立只读核对原 ECS INACTIVE、desired/running/pending=0、task definition INACTIVE、target group 缺失 |
| 10月16日 00:32:01 | 10月15日 19:32:01 | 现有 Cell/Aurora/Secret 及 Neon 控制记录核对，见下 |

CloudTrail event ID `967def00-afc8-4362-8d7c-82b9af7771fa`，删除身份：
`arn:aws:sts::402010193138:assumed-role/TechlongSandboxJanitorExecutionRole/techlong-sandbox-janitor`。

旧全局定时器 `techlong-sandbox/global-expired-stack-scan` **仍 ENABLED / rate(15 minutes)**，目标是既有 `techlong-sandbox-janitor` Lambda（Active，2026-08-22版本）。不是本轮脚本删除，不是 CFN 创建失败回滚。没有证明被删日志或物理UUID可恢复；CFN历史/既有备份证据保留。

## 对先前表述的更正

先前“ExpiresAt不是自动TTL、未安装自动清理”只能说明新验收路径未新增清理器，**不能推出旧 Janitor 不会匹配它**。这次 CloudTrail 证明旧 Janitor 确实删除了验收 workload；不能再沿用“旧过期标签不影响继续更新”的前提。原 C5h/C5i 风险和审批文件不回写，本文件作为更正和继续点。

仓库 `ops/aws-sandbox/lambda/janitor.cjs` 的旧匹配规则读取 stack prefix、Environment、ManagedBy、DeploymentId/AppInstanceId/CellId/ResourceGeneration 和 ExpiresAt；没有针对 DeliveryTrack/CleanupMode 的排除。此为本地代码的兼容性说明，不等同于下载并证明线上完整源码；线上实际删除、角色和启用的调度均已有独立 provider 证据。不要混淆它与已封存的 Cell Janitor/F3c9。

## 当前还保留什么

- C5i 修复镜像已发布及 Locked/v10 证据仍完整；本轮没有再发布、安装权限或读取 Secret 值。
- 原 shared Cell 栈 UUID `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` 仍 CREATE_COMPLETE；不重建 Cell。
- Aurora `techlong-sandbox-express-d001` / resource `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM` 仍 available、PG17.9；**只查集群元数据，没有连接租户库，不能声称库内业务状态已验证**。
- 原 runtime Secret 未标记删除，固定 version `0f45d29f-02d4-4117-99b1-c06645aa3c6e` 仍 AWSCURRENT；没有读取值。
- 原 DNS A alias 仍指向 shared ALB，是残留配置，不表示租户服务还存在；本轮未删除或改写 DNS。
- legacy DDB epoch1/revision1 完整记录仍匹配旧原件；本次 aurora-v2 namespace 读取失败，**其缺失状态本轮未证明**，不能拿旧快照替代。
- Neon 准确 deployment `dep_7c99bd249470184852f0dc74` 仍 configuring、instance pending；job `job_202c8dc12a8bf379f3a7c693` running / attempt1/max1，lease已过期、未清除；旧 plan/artifact仍指向旧镜像。generation1资源仍标 verified、未标 destroyed，provision epoch1仍 active；这不等于AWS服务仍存在，也不等于数据库应被销毁。没有写平台ready或修改这些记录。

Cell/ALB/Aurora/Secret/ECR等仍可能收费。workload删除不等于账单停止或总费用被50USD硬封顶；原7资源/日志组由旧 Janitor/CFN删除，不能自动恢复。

## 本轮实现与停止点

已实现准确旧栈镜像更新的纯计划、只读预检、单次受审入口与独立Inspect；两个允许差异是 ImageUri 和 APP_IMAGE_REVISION，19项参数沿用、原角色不增权。8项针对性测试（包括 DELETE_COMPLETE 拦截回归）通过，未做大量离线模拟。

Review r1 在本地历史 tags 的对象/数组适配处停止，0 AWS calls；代码已修正，旧失败目录保留。Review r2 完成身份/IAM读取后，因准确旧栈不是 CREATE_COMPLETE而拒绝；**没有生成有效manifest**。随后做独立只读删除归因和幸存资源/控制面核验。

本轮**云写入、业务写入、Aurora连接、原私密包/Secret值读取、应用调用、永久执行槽消费均为0**；Neon只有一条受限 SELECT 的只读事务。没有把两个Review失败换目录当作写重试；两次均未进入写许可/槽位。

原 C5j 入口仅保留历史用途，准确UUID无法用同名新栈替代；**不要批准旧 UpdateStack、不要运行旧 C5h/C5i，不自动重建或更换generation/epoch**。

## 距主目标最近的下一步（待确认方向与新的具体批准）

1. **只恢复 workload，不重建数据库/Cell，不扩展清理支线。**先准备独立受审恢复计划，复用已发布 UUIDv8 修复镜像、同一租户/固定Secret/数据库；定义新的 CFN物理身份及准确费用/运行窗口，保留原失败记录与17槽。
2. 新恢复计划必须把旧 Janitor 的实际启用状态纳入前置条件。建议先采用明确、足够完成验收的新 workload期限，保留现有全局安全网；不默认关闭它，也不假装 CleanupMode 能排除它。若要暂停调度/改策略，必须另列具体影响范围并单独批准，不能扩大成清理器重构。人工/额度中断超出期限时不能自动续期或假定存活。
3. 受审协调**旧 lease/job/plan/artifact/CFN identity** 与外部 epoch：先明确原状态的保留/新恢复关联方式及CAS，不自动重置attempts、旧槽或更换数据库generation。必须查明 aurora-v2读取失败，不为未知状态增权或伪造absence。
4. 进入新受审应用/SQL只读状态核验；不能假设上次HTTP500已全部回滚。只有证明未初始化并取得新的单次批准才再POST；已初始化则仅reconcile，不再POST。最终独立 initialized/effective config/真实image/健康/DNS及原子平台ready仍是主目标。

这不是创建或运行上述资源的授权；旧批准不覆盖重建、续租、SQL/应用调用或旧Janitor改动。应先取得方向确认，再准备具体新SHA；不要求重新确认代码提交/推送。

证据索引：[C5j 阻断记录](../ops/aws-sandbox/reviews/aurora-dual-mode-c5j-image-repair.blocked.json)。后续直接从此处接续，不重做C5i发布或F3c9。
