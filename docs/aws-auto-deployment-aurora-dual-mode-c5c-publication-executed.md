# C5c 实际结果：双镜像已发布，独立 Locked/v8 通过

2026-10-14 America/Winnipeg，事件UTC2026-10-15。用户确认[清单与完整风险](./aws-auto-deployment-aurora-dual-mode-c5c-publication-review.md) `b7d4bb49a15c5b69aee22c456fea1d4e0bcd640a2e5dd32db32bf456bdfee792` 后，唯一一次发布成功，随即撤权并独立回读通过。[机器可读执行证据](../ops/aws-sandbox/reviews/aurora-dual-mode-c5c-publication.executed.json)。**批准已消费，不可重跑；尚未部署 ECS/Cell、初始化业务或达到租户 ready。**

## 实际发布与独立镜像回读

[发布任务38682952254](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38682952254) / job116251352632，run attempt1、所有steps success。发布控制执行HEAD为`169166273a828f1c75d08c35100783e618789164`；镜像源码仍是已检`8753546772476b018d33b96ab66db4837abde186`，不是控制HEAD。先验证准确artifact ZIP/receipt/OS扫描与加载后config/源码label，再以OIDC短期身份推送两准确不可变tag，没有重建镜像。

应用的真实 ECR pinned URI：

`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:5e42b2de7e0cc81b1c83a8abb21c866eeedc8801ddf50e686d116a5837caa004`

生命周期的真实 ECR pinned URI：

`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:c5ef6cf02f78fc61a4eff9a3c314a70ecf882f4189173464971c730ca3e2c759`

对应config digest分别仍为`sha256:334299151810ba19165ea694f0c8fe10f8f3162b72b4aac851e539fffa2364e1`、`sha256:24ddb8f9dd57c71dc7639336f6dc2e3fa04becce1e8cf2f98abaa7a74bf539f1`；**config、registry manifest、artifact ZIP是三种不同hash，不可互换。**

UTC04:47:56.549–04:48:02.103，撤权后独立Source进程执行7次只读资源API：准确STS身份、repo/registry扫描配置、两个BatchGetImage与两个DescribeImageScanFindings。重新hash实际manifest字符串并匹配ECR digest、tag和已批config；repo仍IMMUTABLE/scanOnPush/BASIC，两扫描COMPLETE，HIGH/CRITICAL均0。扫描更新时间分别04:44:38/04:45:01 UTC；这是当时BASIC扫描的结果，不保证未来无漏洞或已部署应用安全。

publication receipt取自完成job的JSON日志，并与独立ECR回读逐项一致。本机没下载artifact ZIP或运行Docker。小收据artifact11948254838（827 bytes，ZIP SHA`1d2d7d74627d6646dd4abfdc9245904433d67572b94d3ca4d9f467847199391a`）到UTC2026-10-22 04:45:03；metadata不是artifact原字节下载证明。原candidate artifact到期不等于已发布ECR立即失效，但后继使用仍要按digest核对当前存在/扫描；未声称仓库已有lifecycle policy或镜像永久保留。

## 撤权闭合及已接受的版本清理

| 事件 | UTC2026-10-15 |
| --- | --- |
| 唯一Grant UpdateStack intent | 04:42:22.3293153 |
| Grant独立文档回读，default v7 | 04:43:20.7348124 |
| workflow completed updatedAt | 04:45:07 |
| Source Revoke intent | 04:45:22.4778270 |
| deny-all Locked回读，default v8 | 04:46:20.1780258 |

以上是提交意图/观察时刻，不是精确IAM生效/失效时刻。控制器完成后，另起新的 `pwsh ... -Mode Inspect` 独立只读进程，再核对准确栈UPDATE_COMPLETE、role trust/inline/boundary全部与原deny-all模板一致、default v8，`mutationPerformed=false`。它不受旧安装时限限制，也不提供新Grant授权。

既有role ID/policy ID与写前一致，未创建或替换IAM对象。版本清单实际从v6/v5→v7/v6→v8/v7：**旧v5/v6已被CloudFormation正常更新清理**，这是已批准副作用；原文档在`boundary-pregrant-v5.json`和`boundary-pregrant-v6.json`保留，但云版本ID不可恢复。非默认v7只是保留审计版本，不是当前生效权限；default v8与trust/inline均Deny。回读不保证消除所有传播/并发或此前已签发会话风险，不再做越界写探针。

## 回执、费用和不重放边界

永久执行目录：`F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-b7d4bb49a15c`。原始21份控制器记录原字节保持，新增3份独立证据：`publication-receipt.from-job-log.json`、`independent-ecr-readback.json`、`independent-locked-inspect.json`；最后一份明确标注来自独立进程结构化输出的转录，不伪称第二份原stdout字节。24份raw SHA均在capsule记录；新证据未覆盖原件，未复位或另换槽。

本次直接提交：2次准确CloudFormation UpdateStack、1次GitHub dispatch、2次Docker push命令。Docker上传各层涉及多次内部API，不能把它们说成“总共两次AWS写”。无直接DeleteStack/镜像删除；上述服务内部policy version清理确已发生。两份新镜像仍占ECR存储，撤权不会自动删除；50 USD/月是目标，不是硬cap，本轮未读取账单或宣称实际新增费用为0。

Secret值/私密bundle读取、Aurora/Neon SQL、业务/activation/job/TTL写、baseline上传、ECS/Cell/ALB/DNS创建更新、旧失败栈删除均0。旧Full流程、C4h数据库/Secret、全部历史槽和F3c9保持。本轮只增加结果文档，不改已审执行代码、镜像或权限清单来重跑。

## 唯一继续位置

发布及撤权阶段已结束，不再刷新或重放b7d4...。继续同一个C5c：将上面**真实registry digest**接入新Express执行根、当前租户/数据库generation及监督清理，集中准备16资源计算层与7资源workload、地址和初始化验收清单。完整新root尚未实现，旧Full固定镜像/五键/恢复provider不能代替它，也不能伪造已完成的Express lifecycle证明。

旧失败Full栈上次仍ROLLBACK_COMPLETE并占名；准确删除、创建新计算层、Neon deployment/job/epoch/激活、真实Secret/私密材料读取及商户初始化仍须fresh具体范围单独批准。不据本次镜像发布批准部署、删除或改数据库，不扩展新的SQL/Grant/恢复/F3c9支线。
