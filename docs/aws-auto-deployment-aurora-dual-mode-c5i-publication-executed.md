# C5i已完成：修复镜像发布及独立Locked/v10核验

批准 `1d6b5415c3498e0a1e16add63b0b914215343bde51c2db05a75b47788de68ef1` 已消费，不可刷新、复位或重跑。[完整原范围与风险](aws-auto-deployment-aurora-dual-mode-c5i-publication-review.md)及旧记录保持。当前不是应用ready证明，ECS仍未更新。

## 实际发布

2026-10-15 UTC，[唯一发布38807901068](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38807901068) / job116673423175 / attempt1成功。发布控制HEAD为a9cd71fafea024dc2214637bc414caab9318bfc4；镜像源码是10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2。提升原候选38803364109的准确字节，没有重建或替换来源。

真实app URI：

`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`

真实lifecycle URI：

`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:34ba02327b5e7ed311e6c706790c16c5d97c5d1419584cc47df98a4d7b09714e`

上述为registry manifest digest，不是config或artifact ZIP digest。Source独立进程重新hash实际registry manifest字符串，逐项核对tag/config，repo仍IMMUTABLE/scanOnPush/BASIC，两扫描COMPLETE、HIGH/CRITICAL0。扫描完成于UTC21:11:56/21:12:17，只证明该时点的扫描结果。

## 立即撤权与独立回读

| 事件 | UTC2026-10-15 |
| --- | --- |
| Grant UpdateStack意图 | 21:10:05.3347178 |
| Grant完整文档回读v9 | 21:11:03.3468514 |
| 发布workflow完成 | 21:12:22 |
| Source立即Revoke意图 | 21:12:34.5070456 |
| deny-all Locked完整回读v10 | 21:13:32.7488376 |
| 新进程独立Inspect/ECR核验结束 | 21:15:24.858 |

role ID AROAV3GNMXTZGGMKJ24YR、policy ID ANPAV3GNMXTZPARAIKHN5保持。真实版本变更v8/v7→v9/v8→v10/v9；CFN正常清理了旧v7/v8，原文档备份保留，但不能恢复已删除的云版本ID。v9非默认审计版本不是当前生效权限。以上为观察/意图时间，不保证精确IAM传播时刻或消除并发风险。

## 证据与边界

- 固定执行目录 `F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-1d6b5415c349`：22份文件，包含完整manifest、原policy备份、两个模板、两次提交及回读、dispatch和workflow结果；包含从完成job结构化stdout转录的一份publication receipt，明确不是artifact原字节下载。
- 独立目录 `F:/ChatGPT_workshop/techlong-c5i-publication-inspect-20261015-r1`：5份只读证据。另起Inspect验证原deny-all trust/inline/boundary/两资源及ID，再经7条只读CLI核对版本、registry/config digest与扫描。
- 27份raw SHA见[版本化执行摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5i-publication.executed.json)。没有覆盖旧记录或重试发布。
- 直接提交2次UpdateStack、1次GitHub dispatch和2次Docker push命令；分层上传内部有多次API，不称总共两次AWS写。除已批准policy版本清理外，未直接删除其它资源。
- ECS/数据库/Neon/job/epoch/业务/TTL写、SQL连接、Secret值/私密bundle读取、provision/其他应用请求均0；发布角色已Locked。新镜像继续占ECR存储，原网络/数据库/Fargate继续计费，50USD目标非硬cap。

额度中断发生在上述发布及撤权之后，仅结果文档尚未入Git。恢复时不再执行发布。原workload child截止标签UTC22:10:27、原job租约均已过期；标签不会停费，恢复不能假定旧租约有效，也不能静默续期或重跑C5h2的17个槽。

## 下一步

只准备原workload镜像窄更新：`ImageUri`换成上面真实app URI，模板中`APP_IMAGE_REVISION`同步该registry digest；其余资源、角色、Secret固定引用、配置、tags不改。需要新清单批准一次原UUID的UpdateStack；不把本次发布批准当成部署或初始化重试许可。

服务更新后仍须新的受审只读状态核验及恢复方案，证明首次500后的真实业务状态和owner/epoch/幂等/lease坐标，才能考虑新的单次provision与最终平台ready。不得从ROLLBACK代码、健康target或剩余槽推导初始化成功或可重试。
