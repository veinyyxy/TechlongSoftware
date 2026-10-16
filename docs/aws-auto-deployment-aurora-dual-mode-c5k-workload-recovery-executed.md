# C5k K1 已完成：workload恢复并独立核验，平台保持原状

用户对[准确清单与完整风险](aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-review.md)回复“确认”后，在时限内按 SHA `4b194dc34fa44bc23c1999d21363351b14177fd0e57e62bce5726f75c8e95e10` 唯一Run。**批准及固定写槽已消费，不得因原审批窗口仍开放而重放。** 没有更换源码/风险/时间、重建数据库或回放C5h/C5i/C5j。

## 实际执行时间

| 事件 | America/Winnipeg（2026-10-15 CDT） | UTC（2026-10-16） |
| --- | --- | --- |
| Run重新只读核对完成 | 23:13:38.132 | 04:13:38.132 |
| 唯一永久槽消费 | 23:13:38.190 | 04:13:38.190 |
| 唯一CreateStack获得新UUID | 23:13:38.502 | 04:13:38.502 |
| Run创建完成及只读回读通过 | 23:15:49.429 | 04:15:49.429 |
| 新进程独立Inspect通过 | 23:16:07.509 | 04:16:07.509 |

CreateStack request ID `69b7da4d-4f34-4ead-92ad-b966b68fdc63`，事件token `techlong-c5k-29dba3758258734556a9ee72daafa5a718976fd53d317ea9`。返回表示开始，之后确认准确token的新栈CREATE_COMPLETE事件、七资源全CREATE_COMPLETE及实际运行服务，才报告K1完成。没有CFN/脚本重试或补写。

## 新承载身份与实机结果

- 新栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/f71252c0-c917-11f1-8148-02ff648cb917`。旧UUID `863828e0-c8d6-11f1-bd9d-06fff5ad0437` 保持DELETE_COMPLETE历史，不冒充恢复旧对象。
- 新task definition：`arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:2`；独立检查实际task为 `...:task/cell-sandbox-1/3c586a7dd0094cbc8a0988a79297aa56`。
- 服务desired1/running1/pending0，一项完成的primary deployment；实际task RUNNING/HEALTHY，镜像registry digest准确为 `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`。新task完整运行spec与旧spec仅替换image/revision的预期hash匹配。
- Target为实际新task地址、3000端口healthy；DNS A alias保持原shared ALB。Source没有向应用发送请求，健康由ECS/ALB检查证明，不冒充认证initialized/effective configuration证明。
- CFN角色/边界、task两角色及共享边界、固定Secret版本、原Cell16资源/模板/输出、Aurora集群元数据、DDB legacy原件/aurora-v2缺失、旧Janitor代码和启用的15分钟扫描均保持。没有Secret值/原私密包读取或Source Aurora连接；应用自身注入Secret及启动数据库活动仍按已批准风险存在。

## 刻意未改的平台记录

deployment `dep_7c99bd249470184852f0dc74` 仍configuring、instance仍pending；job `job_202c8dc12a8bf379f3a7c693` 仍running、attempt1/max1、原lease已过期且未清除。原desired_plan、plan_hash、artifact_ref（旧镜像）、配置hash、outputs空最终stack/observation坐标、generation1资源verified、epoch1/provision/active均与批准前快照相同。

这是K1承载修复，不是把旧平台计划完成、续租、接管job或标记ready。上次HTTP500后的业务事务/初始化状态尚未独立核验，不因新镜像健康就再POST或假定可初始化。

## 副作用、证据与计费期限

一次Source CreateStack内部创建七项CFN资源及ECS task/ENI/日志等，不称“总共只有一次AWS资源写”。操作器没有IAM、Secret、DDB、DNS或Neon/业务写，没有Source应用请求/provision POST或SQL/Aurora连接；操作器私密读取0，新永久写槽消费1，自动写重试0。这些是操作器计数，不宣称应用/提供者内部零Secret读取或零数据库活动。

Run预检30 SDK+14 CLI，Run回读35 SDK+11 CLI，独立Inspect35 SDK+11 CLI；每组一次Neon单SELECT只读事务，共3次（此前Review另1次）。另有CFN状态只读轮询，不包含在这些分组计数中。独立结果为 `RECOVERED_HOSTING_INDEPENDENTLY_VERIFIED_PLATFORM_UNCHANGED`；两次回读的新stack/task/digest及baseline精确一致。

原Review4文件、Run5文件、Inspect3文件及永久槽1文件共13份raw SHA保存在[非秘密执行摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5k-workload-recovery.executed.json)。r1凭据失败、所有旧计划/原17槽与证据均保留，没有删除或覆盖。实际参数/Secret值/私密来源不入Git。

**固定ExpiresAt仍为 Winnipeg 2026-10-16 07:04:28.726 CDT（UTC12:04:28.726）**，没有因实际创建时间推后而延长。既有Janitor保持，可到期后删除该workload及日志，但不保证清理时刻或全账单停止；Cell、Aurora、Secret、ECR等仍收费。50USD/月是目标，非cap。禁止自动续期、关闭清理器或再次创建；暂停/清理/延期需要新的具体批准。

## 唯一下一步 K2

先准备新的**只读初始化状态核验**清单，核对上次HTTP500后的实际状态、同一owner/store/epoch、新真实image及预期配置。不使用旧lease/私密binding或历史回滚代码代替当前证据；Source Aurora/私密材料/控制调用如需要，必须明确列入fresh范围再批准。

若已初始化，只reconcile、不得POST；若确实未初始化，再另审单次provision恢复。随后为旧desired_plan/artifact/job/lease与新stack身份、必要control binding制定准确旧值和DB时钟约束的受审协调事务，保留旧计划/失败证据。最终initialized/effective configuration及独立image/health/DNS证明和原子平台ready仍未完成，不扩展F3c9/Grant/restore/seed支线。
