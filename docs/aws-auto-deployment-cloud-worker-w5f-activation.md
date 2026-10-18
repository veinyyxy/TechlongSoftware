# W5f：集中激活清单与完整风险

2026-10-17 Winnipeg。用户“开始下一步”仅授权准备激活接线、验证与新清单，**没有授权当前执行激活、读取Secret值或部署**。起点是 [C1已完成的Locked安装](aws-auto-deployment-cloud-worker-w5e-neon-continuation-executed.md)，实际安装绑定 canonical SHA `0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1`。原三槽、107源码和历史原件保留，不再重跑恢复或扩展F3c9/Sites/观察器。

## 一个激活范围，六个顶层提交

执行入口是 `ops/cloud-worker/activation/run-activation-v5.mjs`。PrepareRelease/Review只是准备；只有用户以后明确批准本轮fresh SHA，Activate才可消费新独立槽。所有目标仍为账户 `402010193138`、区域 `ca-central-1`、仓库 `veinyyxy/TechlongSoftware`。

| 顺序 | 最多一次的顶层提交 | 准确目标与限制 |
| --- | --- | --- |
| 1 | GitHub environment PUT | 新建 `techlong-sandbox-deploy`；唯一审阅者User ID `14145707`，允许本人审阅、禁止admin bypass，custom deployment branches |
| 2 | GitHub branch policy POST | 该environment只允许名称准确为 `main` 的branch，不是tag、通配符或全分支；独立回读配置，不满足即停 |
| 3 | S3 PutObject | 现有私有证据桶 `techlong-sandbox-cloud-worker-evidence-402010193138`，准确key `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/installation/0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1.json`；仅公开绑定内容，AES256、IfNoneMatch=*，保存实际VersionId/整文档SHA并独立回读 |
| 4 | Git push一次fast-forward | 仅将两枚准确待审提交发布到GitHub main，新增 `.github/workflows/cloud-worker-job.yml` 和 `cloud-worker-execute.yml`，不force、不建分支、不改应用/权限代码或其它文件 |
| 5 | CloudFormation CreateChangeSet | 仅现有foundation栈UUID `308174f0-ca9e-11f1-a04d-02569e9287b5`，UPDATE、CAPABILITY_NAMED_IAM；模板仅改变WorkerRole的AssumeRolePolicyDocument |
| 6 | CloudFormation ExecuteChangeSet | 仅执行上一准确ARN；必须只含WorkerRole非替换Modify/静态AssumeRolePolicyDocument属性，DisableRollback=true；完成后独立新进程核验 |

不是六个总API请求：读取/等待/验证另计，CloudFormation及GitHub/Git服务还有内部行为。不会直接调用IAM写API，不改变inline/boundary、表/桶/Secret策略或Neon；不新建付费Cell/ECS/ALB/RDS，不创建job、调用业务函数、签JWT、访问应用或原私密包。

## 准确固定：工作流和实际执行源码都必须不可变

旧候选job固定了reusable SHA，却检出会变化的 `github.sha`。本轮不改旧候选或已受审源码，而采用新生成的发布文件：reusable workflow检出**已通过CI的固定运行源码commit C**，执行前用 `git rev-parse HEAD`核对，再计算原76文件闭包SHA；dispatcher用准确commit R引用reusable。入口同时固定repo/owner/actor ID、main、workflow_dispatch、run_attempt=1及准确安装绑定。

为消除“把自己的SHA写入自己”的循环，PrepareRelease先在**独立临时Git index**中生成两枚待审提交对象：R新增reusable并以当前main D为父；第二枚S新增dispatcher、固定引用R并以R为父。当前main仍是D，工作区不改，不新建任何分支，不推送R/S。准备清单包含C、R、S、父链/tree/blob/文件摘要和两文件准确diff；未来批准后仅一次正常fast-forward把main从D推进S，R随祖先发布。未签名对象和临时index保留原件，不自动删除；不是隐藏分支。

GitHub运行的 `GITHUB_SHA` 是dispatcher所在调用提交，原worker manifest的 `code.commitSha` 保持绑定这个调用提交；物理执行源码另由固定C检出和闭包证明，VerifyInstall报告明确记录C。这两个身份不能混为一谈。Review/RunOnce/Inspect仍要求调用提交相同，生成待审部署manifest后不要推进main，否则应重新Review，不重放旧SHA。

## 信任策略和人工入口

新信任策略只Allow既有GitHub provider，aud=sts.amazonaws.com，准确immutable sub `repo:veinyyxy@14145707/TechlongSoftware@1323312747:environment:techlong-sandbox-deploy`，repo/owner ID、main、environment、actor ID `14145707`及 `job_workflow_ref=veinyyxy/TechlongSoftware/.github/workflows/cloud-worker-job.yml@R`。不改repo OIDC subject，未匹配的身份不会被本策略授权。原deny-all将被替换，因此这是**真实打开既有worker能力**，不是只读或零权限变化。

[AWS当前GitHub条件键说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)列出这些GitHub条件键；[GitHub immutable subject说明](https://docs.github.com/en/actions/reference/security/oidc)要求匹配实际不可变格式。文档/模板/条件检查不证明真实STS交换成功，必须在另获批准的云端VerifyInstall中验证；条件不匹配不能自动删减或改为宽sub。

Environment按唯一当前owner审阅，不防同一个owner修改仓库/环境或代码。`prevent_self_review=false` 是单人项目的明确取舍，不构成双人分权。拟发送 `can_admins_bypass=false` 后必须实际回读为false，API忽略/不支持或未知状态即停，不伪称已禁用，也不自动换UI或补权限。[GitHub environment保护说明](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

发布的dispatcher**只有手动workflow_dispatch**，默认VerifyInstall，但也列出Review/RunOnce/Inspect；没有push/schedule/polling自动触发、不自动dispatch/审批。Activate不会调用这些模式。用户未来仍需确认准确模式和私密读取/任务/费用范围，并亲自通过environment审阅；仅安装/激活批准不是运行或部署批准。

## 为下一步准备的VerifyInstall，不在本轮激活执行范围

此模式不需要新job或可部署Cell窗口，仅一次GitHub OIDC取token和STS换取最多1小时短期凭据，核对实际role ID/会话、读准确S3绑定版本、读准确数据库Secret固定版本一次，执行一个窄角色只读catalog事务。不读控制Secret/原包、不调用四业务函数、应用HTTP、DDB写、S3写或CloudFormation部署。只输出公开身份/摘要/计数，不上传私密Actions artifact。

**当前准备和未来Activate均不运行该探针，也不证明云端Secret/数据库连接已通。** 探针会增加真实凭据读取/提供者日志风险，另行获批后才能手动触发。真实Review之后仍受现有Cell期限、空闲/命名空间及准确待审job门禁约束，不能因为激活就延长旧TTL、重用已成功job或重建租户。

## 完整风险与停止规则

- 激活后既有inline/boundary允许准确租户CreateStack、受限DDB/S3写及两固定Secret读取；数据库凭据拥有claim/complete窄写函数。环境/冻结代码限制的是可信执行路径，不是把IAM变成只读，也不是仅凭chat“确认”就有密码学签名。owner/admin仍可能修改保护，不能称为绝对防绕过。
- GitHub、S3、Git push与CloudFormation没有跨服务原子性。失败可能留下environment/branch规则、收费对象版本、已发布工作流/提交、AVAILABLE ChangeSet，或已开启信任但独立核验未完成。流程失败**不自动撤权、禁用、删除、回滚、补齐、复位或重试**。新永久槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-activation-v1.permanent-slot.json` 一经占用不自动复位；旧三槽不变。
- CloudFormation执行显式禁用失败自动回滚，可能停在UPDATE_FAILED并需要另审处置；Create/Execute还可能处理同栈旧FAILED/obsolete ChangeSet记录。仅信任属性的ChangeSet检查和完整回读降低范围，不保证消除提供者内部或并发副作用。[DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)、[ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)
- Role/Policy ID、当前main、environment、S3完整版本空集和安装元数据会先严格核对；每次写前验证新批准、有效期和20分钟执行时限。入场只读采集不超过180秒，完成后30秒内才占槽。没有跨服务CAS；fast-forward/no-force也不能防所有管理员竞态。新版本/未知/漂移立即停止，不自动接纳现有对象。
- 新清单有效2小时；临时AWS Login/GitHub凭据刷新失败或权限不足会停止并可能留部分状态。SDK maxAttempts=1、每项仅一次提交，不约束平台内部重试；失去ACK不等于未发生变更，ACK先独立落盘也不保证磁盘永远可用。错误只留固定断言、阶段、有限HTTP/SQLSTATE，不留原provider消息/堆栈/凭据。
- 待审Git对象未由branch保护且未签名，可能被本机管理员修改环境/源码或被GC清理；执行前必须重新验证对象父链/精确diff/内容。对象缺失或main推进就停止，不能偷偷重建后沿用旧SHA。必要时重新准备对象与fresh清单，再请用户确认。执行后的本地main仅可在准确远程核对后ff-only同步，不reset/force或创建新分支。
- 安装绑定内容只含公开ARN/OID/摘要，但S3对象仍是私有、启用版本化和防公有配置；不读取任何Secret值核验发布。版本化/条件写和现有显式Delete拒绝不是WORM，管理员仍能改策略。代码/公开ARN和部署状态按常驻授权提交GitHub，不包含owner DSN/密码/PEM。
- 保留[C1](aws-auto-deployment-cloud-worker-w5e-neon-continuation.md)与[原安装](aws-auto-deployment-cloud-worker-w5e-installer.md)的权限、并发、公开main未保护、区域metadata Resource:*等风险。本轮不升级plan、创建角色/策略/Secret、改私密值/数据、扩grant或发布Sites。
- 不新建常驻计算，但GitHub Actions、S3版本/API及既有Secret/Cell/ALB/Aurora等可能收费。50 USD/月为目标不是硬cap或停费承诺；不自动删除既有资源省费。

## 命令与唯一继续位置

```powershell
# C是实际已通过CI且本地pins一致的运行源码commit；这里只生成待审对象，不动main/分支/远程。
node --experimental-strip-types ops/cloud-worker/activation/run-activation-v5.mjs --mode PrepareRelease --runtime-commit <C> --output F:/ChatGPT_workshop/techlong-w5f-release-<fresh-id>
node --experimental-strip-types ops/cloud-worker/activation/run-activation-v5.mjs --mode Review --release F:/ChatGPT_workshop/techlong-w5f-release-<fresh-id>/release.json --output F:/ChatGPT_workshop/techlong-w5f-review-<fresh-id>
# 只有用户明确批准新fresh SHA才执行；本次“准备”不是批准。
node --experimental-strip-types ops/cloud-worker/activation/run-activation-v5.mjs --mode Activate --manifest F:/ChatGPT_workshop/techlong-w5f-review-<fresh-id>/manifest.json --approved-sha <NEW-EXPLICIT-SHA> --output F:/ChatGPT_workshop/techlong-w5f-run-<fresh-id>
node --experimental-strip-types ops/cloud-worker/activation/run-activation-v5.mjs --mode Inspect --run-directory F:/ChatGPT_workshop/techlong-w5f-run-<fresh-id> --output F:/ChatGPT_workshop/techlong-w5f-inspect-<fresh-id>
```

先完成无AWS/OIDC的候选云CI、最终clean main上的本地待审对象和在线只读Review，再独立重构全部SHA/父链/现状并集中请求上述六提交范围的新批准。执行后不自动dispatch；下一个最小验收才是另审VerifyInstall，再接准确job的云Review/RunOnce/Inspect。不重复旧恢复验收，不扩观察器支线。
