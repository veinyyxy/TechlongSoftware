# W9o — 新恢复镜像发布完成，撤权已独立核验

2026年10月26日按清单 `67782d1e0f5e2e4f661f9deef8214c74590d16c2b994d2a6a07667b036cba4eb` 执行。用户随后亲自批准准确GitHub environment；完整范围与风险保留在 [原执行清单](aws-auto-deployment-w9o-recovery-image-publication-review.md)。本记录不授权后续ECS部署或续租。

## 结果

单次发布 [GitHub run 40348522944](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40348522944) completed/success、attempt1，job121661905358的12个步骤全部成功。dispatch源码 `3dbe4dcfef2ca7f415185edd34181f9aadf320eb`，冻结reusable `9b26b7c7d16929d50c0e14e05d92f1e7fe40eb75`；镜像仍来自W9n producer40340097784、artifact12658433499，没有重新构建。

准确ECR不可变引用：

`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web@sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a`

registry manifest SHA为 `sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a`，其原始JSON摘要及config链接已回读核对；config digest为 `sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90`，共14层。两者不是同一种摘要。仓库最终恰为两份旧镜像加本轮一份新镜像，旧tag/digest均保留。

Source流程结果 `PUBLISHED_AND_INDEPENDENTLY_LOCKED`；另起进程只读Inspect结果 `LOCKED_PUBLISHED_INDEPENDENTLY_VERIFIED`，记录时间 `2026-10-26T15:26:31.961Z`。角色ID `AROAV3GNMXTZID6CJJBA2`、trust无Allow、inline显式Deny全部ECR、原boundary/单角色资源及完整授权布局均匹配预期。独立核验不写云，不是对已签发token立即无效的绝对保证。

## 执行及撤权顺序

- 实际Grant开始 `2026-10-26T15:20:50.531Z`，原截止 `2026-10-26T16:20:50.531Z`，没有延期。
- Source Grant ACK记录 `2026-10-26T15:20:53.898Z`；严格回读后仅调度一次准确caller。只读API确认环境门禁就绪后，用户亲自批准此run，没有Run/Re-run或再次调度。
- run完成记录在15:25:22Z；Revoke intent记录 `2026-10-26T15:25:23.560Z`、ACK `2026-10-26T15:25:24.624Z`。随后原流程及独立进程分别回读Locked，而非等一小时日期条件自然到期。
- Source顶层CloudFormation UpdateStack恰两次（Grant/Revoke，两ACK均attempts1）；云端一次900秒角色会话及一次顶层docker push。后者不等于底层上传网络请求只有一次。无回滚、删除、补齐或写重试。

云端小型产物 `12662567754` 的官方ZIP2405字节、SHA `0f9aafe762d59ebbb7d4641b7bb808fe325ce214378a199ab3cab58e23174075` 已独立下载并校验固定四项JSON。它证明同一产物、run、角色、manifest以及pushProcessCalls1。云端自身的 `iamRevokeProved:false` 仅表示worker没有撤权证明能力；撤权证明来自其后Source与独立Inspect，不改写原worker回执。

## 永久槽与追溯

`F:/ChatGPT_workshop/techlong-recovery-image-v1.source.intent.json` 已永久消费；**即使原批准尚未过期，也不得重跑RunReviewed、复位/删除槽或换新SHA重放本次发布。** 独立Inspect本轮已完成，无需重复读取。

原始执行目录 `F:/ChatGPT_workshop/techlong-platform-recovery-image-v1-1c2128dd545678b31faa3272128fde32/`，独立Inspect `F:/ChatGPT_workshop/techlong-w9o-recovery-image-inspect-1793028391968.json`。公开摘要 `ops/aws-sandbox/reviews/platform-recovery-image-v1.executed.json` 包含21项原始证据长度/SHA并链接准备封口记录，原文保留不覆盖。

## 未执行及下一步

未改boundary、创建身份或Secret，未读Secret/PEM/.env或连接数据库，未部署ECS/Cell、改域名、续租、领取业务任务或删除资源。本轮只增加ECR镜像存储；镜像和旧承载仍保留，可能持续收费，50USD/月不是硬上限。

下一步仅准备：以本真实registry digest、既有三项固定Secret版本和原承载栈，生成一次短租约/服务更新清单；优先只改TaskDefinition和Service，不重新创建凭据/IAM。实际托管Secret重注入、替换/旧revision清理、正常CFN回滚与部分遗留、服务中断和费用风险须在新清单说明并另审。原业务基础事实截止仍为 `2026-10-27T18:47:57.695Z`，本次镜像发布不延长它。F3c9/UI支线保持停止。
