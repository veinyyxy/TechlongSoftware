# W5p：单项读取权限已修正，独立核验通过

2026-10-18，America/Winnipeg。批准清单 `b212b017b3580fdc9429a4e59c5548892c95780f3c51ff60fe95927e14f63236`；受审源码 main=`0b0d8739e78dfe0eb9143955539d76fe84c800ef`，164 pins。用户确认后仅运行一次 Apply，再新进程 Inspect，未运行 Review 或部署。

旧清单 `40c30223ad5473d5a1f041fc7672358971be2c255090b862c304bcf4d8f8a2c9` 过期未执行。只读刷新前置事实完全相同，只有时间、请求标识和 manifest SHA 改变；旧批准未转移，新 SHA 再次确认后才执行，旧材料保留。

## 实际执行与独立结果

- 永久槽于 `2026-10-18T22:19:35.104Z` 消费，不复位、不重试。
- CreateChangeSet 一次，采用本次 ACK 的准确 ARN：`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/taskdef-read-v5-0b0d8739e78dfe0eb9143955/779a0c2e-fd1e-436e-9477-380c967a4146`。
- 完整模板及 Change Set 严格核验：唯一 WorkerRole / AWS::IAM::Role / Modify / Replacement=False / Properties.Policies，没有 trust、boundary、其它资源或替换。
- ExecuteChangeSet 一次，DisableRollback=true；最终 foundation `UPDATE_COMPLETE`。Apply 结果为 `TASK_DEFINITION_READ_CORRECTED_REQUIRES_INDEPENDENT_INSPECT`。
- 独立新进程 Inspect 于 `2026-10-18T22:20:20.776Z` 完成，结果 `TASK_DEFINITION_READ_CORRECTION_INDEPENDENTLY_VERIFIED_NO_REVIEW`。当时本地/远端 main 均仍为受审源码，后续仅记录此执行交接才结束本次冻结。

唯一权限差异：现有 inline `ExactSandboxWorkerV5` 的 `ecs:DescribeTaskDefinition` 声明，Resource 从原租户 task-definition ARN 改为 `*`，保留 `aws:RequestedRegion=ca-central-1`。这是持续的区域级读取能力扩张，不自动撤权，可能读到其它租户任务定义及其敏感环境配置，程序固定目标不等于 IAM 租户过滤。沿用[完整风险](aws-auto-deployment-cloud-worker-w5p-task-definition-read.md)，不是零风险或零费用承诺。

独立核验确认：

- 新模板规范 SHA `1658cd87bd15fd469cd24f1dab7105f29ca2d02e2963fed882b0941bdf36dd3b`，新 inline SHA `ef09a5c638b600914cf0a29873a705432a5f96ffb9cdc20c6fa16aeaaa157bfd`。
- 角色 ID `AROAV3GNMXTZK5O45RG24`、trust、角色标签、boundary ID/默认 v1/文档、五项 physical ID 摘要及 executionRole=null 均保持。既有写权限不扩大、没有新 IAM 资源。
- 云 C=`d8cb99693231770de6a5d73e02dda42b87035714`、R=`7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c`、76 文件闭包 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`、两份工作流不变。
- Secret 值读取、workflow dispatch、Neon/S3 写、job 领取、workload 创建及自动写重试均为 0。执行前任务/业务/队列元数据与旧清单相同；Inspect 只覆盖准确 CFN/IAM/五资源身份/Git，不声称执行后重新核验 Secret/catalog/job 或租户健康。

独立回读证明配置已安装，不证明 worker 实际 `DescribeTaskDefinition` 调用成功、IAM 传播完成、没有其它阻断或自动部署端到端通过。50 USD/月仍只是预算目标。

## 原件和唯一继续位置

[机器执行记录](../ops/aws-sandbox/reviews/cloud-worker-w5p-task-definition-read.executed.json)列出 31 份 F 目录原件及 raw SHA：旧/新清单、两份准备证明、本次 Apply、独立 Inspect 及永久槽。22:21:01 UTC 独立重构完整清单，复验 164 当前 pins/159 失败 Review 历史 pins、旧证据和准确 ACK 链；同进程与独立布局一致。受审源码已有 7 新边界测试/相邻回归共 72 项本机通过，源 main 两项无 AWS CI 均 attempt=1/success：`39159562701`、`39159562723`。本次交接不改可执行源码。

下一阶段仅实现本机 Review 续接：显式绑定本次新 inline/template 摘要、此次执行原件和独立 Review-v5 永久槽，保留 W5o 旧布局断言、旧 v4 槽和失败记录。旧 W5o verifier 硬绑定旧 inline，现在应拒绝新布局，**不得直接重跑或绕过**。云 C/R 和权限不再变化，不需要重新发布。

完成该本机接线及最终 main 无 AWS CI 后，只读准备同 `job_ecbf09030d3da7286ea3ef93` 的 fresh 云 Review 清单。实际 dispatch、固定 DB Secret 读取、私有 S3 manifest 写仍另按准确 SHA 批准，且由用户批准准确 run 的 GitHub environment。没有成功云 manifest 就不准备 RunOnce；后续领取/部署/Inspect 仍各按原批准合同，不重新登记请求、不扩 F3c9 或平台上线支线。

本次 Apply 已成功且槽永久消费。不要重放 Apply，不因未来 main 文档提交而把原独立 Inspect 改称失败；其证明固定于上述受审源码和时间。后续只沿新续接入口推进，不再次修改 IAM。
