# W5i：准确待审任务的云 Review → RunOnce → 独立 Inspect

2026-10-18，America/Winnipeg。本阶段只给[W5h真实管理员任务](aws-auto-deployment-cloud-worker-w5h-request-recorded.md)接上已经安装并真实验证的云工作流，不再创建任务、升级数据库、扩权限或重开F3c9/Sites。新增文件是本机调度/回读入口，不修改原116源码pins、76文件云闭包、C=`ac75c4bc…`、R=`7c02d9db…`或现有工作流。

唯一job `job_ecbf09030d3da7286ea3ef93`，requestId `682ec635d9d066cd547b1e060cefa9052d49ac425328047f8fb85e8289a4a07e`，管理员 `usr_4dcd0a09821fde2bb1801f58`。仍审核挂起，之前的入口登记批准不等于云执行批准。

## 三次调度分开批准

| 模式 | 允许的真实效果 | 不包含 |
| --- | --- | --- |
| Review | 单次workflow_dispatch；用户人工environment批准；OIDC/STS及固定S3绑定读取；一次固定DB Secret值读取、窄角色catalog/只读read_state和真实AWS前置核验；私有证据桶条件写一个不可变manifest | 不领取job、不读control Secret、不写DDB/业务、无CreateStack/应用GET |
| RunOnce | 再次fresh批准；同caller SHA、准确云manifest版本；固定DB值/catalog；五个永久DDB槽、同job领取、最多一次CreateStack（7资源）、一次control Secret读取、两次认证GET、原子完成；私有S3证据写 | 不新增job/IAM，不重做初始化，不自动重试或由本机补偿 |
| Inspect | 再次批准；Source向准确key条件写一个小型execution-reference对象，引用已独立下载核实的run报告版本；单次独立云运行，DB Secret/catalog/只读状态、DDB及真实资源回读、私有inspect报告写 | 不领取job/改业务、无control Secret/应用GET/CreateStack；不是完全零写，因为包含两种S3写 |

本轮只准备 **Review** 待审清单。RunOnce/Inspect接口预先完成是为了避免15分钟窗口内再写代码；没有默认授权后两种效果。每次均调用现有workflow388188162和environment `techlong-sandbox-deploy`，由用户自己批准，控制器不操作Review deployments。

## 时间、冻结与失败规则

代码和交接文档全部先提交并推送两个main，然后在最终clean main只读Prepare。**实际Review调度后，不再移动平台main，直到RunOnce/Inspect完成，或用户另行决定放弃窗口。** 冻结的是caller/GITHUB_SHA，物理运行源码仍是C、reusable仍是R；不把旧S提交当新caller。只读Observe/Prepare及F盘回执不移动main。

本地Review批准只约束两小时内提交dispatch，不能约束用户稍后批准environment的时间。云Review完成时才生成原始15分钟claimBy、一小时job deadline和两小时独立child TTL；RunOnce还要求child剩余至少90分钟。本地RunOnce批准不超过原claimBy，临提交及云执行入口再次检查，不给旧清单换时间。准备与人工批准应及时连续完成，过期就停止，不能自动重新Review或复用槽。

每个准确job/模式各一个新的F盘永久槽，wx落盘后才允许POST；未知ACK、错误、取消、环境未批准、过期都不复位、不重新dispatch、不使用Re-run。唯一允许的Inspect Source Put同样先消费Inspect槽，条件If-None-Match:*、AES256、固定bodySHA，保存ACK后独立读准确版本，再调度；VersionId只能采用此次Put ACK返回值，失败不再Put。云DDB五槽仍由原runtime负责，和本机槽不是一回事。若RunOnce没有成功run报告，当前普通Inspect准备入口会拒绝，不伪造成功引用；届时仅可只读盘点/另审恢复，不重试部署。

## 完整风险与沿用边界

- GitHub、AWS、Neon和本机文件不是同一事务；main未受保护，临POST分支重读也不是跨服务CAS。其他操作者仍可并发修改；精确SHA/版本/状态不符即停止，槽可能已消费而无完整效果。
- GitHub token仅经本机git credential helper在内存读取，只发GitHub API；API版本2026-03-10且必须200返回准确run ID，204/未知响应不降级重试。下载日志时只在GitHub API请求带token，签名日志URL无认证转发、仅HTTPS已知域；不保存原日志或签名URL。GitHub/runner/云提供者仍可能留日志，不能承诺绝不泄漏。
- Review用既有窄角色读取固定DB Secret版本并执行只读事务，不把窄角色有写函数执行权误说成账户完全无写能力。九行业务快照、队列和部分配置会保存到**私有**S3版本及F盘本地回读文件，可能含联系人/业务信息，不上传完整manifest到GitHub。摘要/ARN/状态可按此前授权提交。S3加密不等于匿名化；本机mode或wx不是Windows ACL证明，本机管理员/已授权云主体仍可读取。
- Source准备只读核对现有IAM/boundary/trust/环境保护、两Secret**版本元数据**、Neon目录及本机既有owner连接的两笔只读当前状态；不GetSecretValue、不连接Aurora、不读取原私密包、不改变页面入口。Observe只下载准确证据版本并重建原始cloud manifest，不重盖时间、执行SQL或代替真实资源验收。
- Review的前置资源核验不预留容量；RunOnce仍复核namespace/authority/镜像/Janitor等。七资源创建可能部分失败且有遗留费用；既有CreateStack请求OnFailure=ROLLBACK（CloudFormation自身可能回滚），不等于控制器自动回滚、可靠清理或零费用。失败可能已领取job、用掉DDB槽、留下栈/任务，不能从日志不明推断无副作用。
- 继续沿用Express/Full兼容方案和现有Express模式，不升级plan或改Aurora。父Cell过期保留tag不更新；独立child TTL不是续父TTL或可靠删除承诺。50 USD/月只是目标，不是硬cap；现有父资源、Secret、S3、DDB、runner/网络与短时ECS/ALB等均可能收费，不保证到期自动停费。
- RunOnce完整资源/私密/两GET/原子完成风险仍见[云执行根合同](aws-auto-deployment-cloud-worker-w5c.md)；新鲜云manifest才提供准确child时间与CreateStack body，必须另批。

## 命令（所有输出目录须为新目录）

入口 `node --experimental-strip-types ops/cloud-worker/job-dispatch-local-v5.mjs`。只允许F:/ChatGPT_workshop下 `techlong-w5i-*`，没有队列轮询器。Prepare不会消费槽/调度/读取Secret值。

```powershell
# 首次只读准备：在全部代码提交和push完成后
node --experimental-strip-types ops/cloud-worker/job-dispatch-local-v5.mjs --mode Prepare --cloud-mode Review --output F:/ChatGPT_workshop/techlong-w5i-review-20261018-a
# 用户确认manifest.json中的准确SHA后，另用新目录Dispatch
node --experimental-strip-types ops/cloud-worker/job-dispatch-local-v5.mjs --mode Dispatch --manifest F:/ChatGPT_workshop/techlong-w5i-review-20261018-a/manifest.json --approved-sha <fresh-sha> --output F:/ChatGPT_workshop/techlong-w5i-review-dispatch-20261018-a
# 人工批准准确run的environment后，只读Observe；未完成则使用新输出目录稍后再读，不重跑dispatch
node --experimental-strip-types ops/cloud-worker/job-dispatch-local-v5.mjs --mode Observe --dispatch-directory F:/ChatGPT_workshop/techlong-w5i-review-dispatch-20261018-a --output F:/ChatGPT_workshop/techlong-w5i-review-observed-20261018-a
# 原15分钟内，另准备并批准RunOnce；不提交新的main
node --experimental-strip-types ops/cloud-worker/job-dispatch-local-v5.mjs --mode Prepare --cloud-mode RunOnce --cloud-review-directory F:/ChatGPT_workshop/techlong-w5i-review-observed-20261018-a --output F:/ChatGPT_workshop/techlong-w5i-run-review-20261018-a
# RunOnce Dispatch同上，额外传同一--cloud-review-directory；Observe后才Prepare Inspect
# Inspect Prepare/Dispatch同时传--cloud-review-directory及--execution-directory（成功RunOnce Observe目录）
```

批准前应核对Prepare result和manifestSHA。Review成功也仅是待审材料，不是自动部署已验收；只有后续真实RunOnce成功及不同run的Inspect独立证明，才可宣称这一条任务完成云端自动部署验收。当前并未开放全局自动队列或把整套平台迁到AWS。
