# 已封存新周期包：一次条件上传、新事实批准与独立版本回读

本文件是[执行手册](aws-auto-deployment-execution-runbook.md)当前P4的准确风险附表，不是部署批准。本轮仅实现既有上传器的SOURCE接线、测试和待审清单；不会因为代码/CI或Prepare成功而上传或批准事实。实际操作须用户确认新清单SHA。

## 固定对象与新事实范围

- 复用私有桶 `techlong-sandbox-cloud-worker-evidence-402010193138`，账户 `402010193138`、区域 `ca-central-1`。Source必须是既有IAM用户 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，不接受assumed-role替代。
- 新key为 `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-2cf26916af4f9d8734da18231d2571b23758397c72f1a5566bee5656623d8045.json`。仅一次条件PUT：`IfNoneMatch=*`、AES256、Content-Type application/json、准确Content-Length及SHA256 checksum；不覆盖、列举或删除任何对象。
- 上传的是已封存候选中的canonical package，**403623字节**，SHA `e908e74b0de03ae61a2f36bfe1e9f0423ce3850e341a1a3cdf5f9676553b0700`；不是605958字节的候选wrapper。basis为 `2cf26916af4f9d8734da18231d2571b23758397c72f1a5566bee5656623d8045`，包含七份原证据、11旧job及完整14条旧控制计划；业务正文不进Git。
- 仅批准准确新任务 `job_a00fc18c13a5d6c6616c8039` 的拟议basis事实窗口。profile SHA `e3602b2c4cd7d298c223ed69b0d1ffe4706ef8b2c13fa4bdd96911423f46763d`；factsAt为真实事务时间2026-10-28 **10:08:09.592 CDT**，数据库独立回读时间10:08:21.656。拟议到期固定为2026-10-30 **10:08:09.592 CDT**，不是批准后重新48小时。原a604/9b basis和旧Review期限均不延长，成功前驱仍为原9db。

新事实批准只有本清单的明确用户批准来源；仅当上传ACK和独立准确版本回读成功后输出该批准的provenance。它不安装任何运行时能力、不重开旧周期；失败/未知时不能拿未核验的引用继续发布。

## 准备和执行时限

PrepareSaved只读本地固定原件、源码/pins和准确CI，不构造或调用AWS客户端。原最早观测08:42:18.110起的五小时准备截止仍为2026-10-28 **13:42:18.110 CDT**；不能重新采样或倒填时间。清单明确档案的原采样/执行源码与本次新CI源码不同，旧原件不是当前资源/数据库健康证明。

清单有效期为 `min(生成时刻+24小时, 新basis固定到期)`，最晚启动比该时刻早2分钟。准备五小时只限制Prepare，不被当作claim/workload续期；本次24小时待审许可须新SHA明确批准，不改变历史时限。上传前仍实时核验Source、桶和准确目标，之后真正worker仍需原业务/权限/namespace及保护检查。

**清单生成后main保持冻结，不追加文档提交。** 入口要求同一clean main、源码/pins、准确CI和110文件云闭包；任何代码/提交或事实绑定漂移都停止，不把旧SHA迁移到新HEAD。准备输出及私有检查点位于 `F:/ChatGPT_workshop/techlong-reviewed-cycle-upload-20261028-a/`，不是公开Git证据。

## 复用顺序与硬上限

`upload-local.mjs`复用原 `packageUploadRunner` 和 `createPackageIo`，不另写AWS上传/回读执行器。

1. 新SHA、源码/CI、四份本地固定readiness文件及包字节/七原证据完整重建全部匹配，两个固定永久槽未占用，才可能进入上传流程。
2. Source STS核对；桶区域/版本化Enabled/AES256/所有权BucketOwnerEnforced/四项PublicAccessBlock及非公开策略匹配；准确目标HEAD必须是无delete marker的确定404。403、已有对象或未知结果均不允许PUT。
3. 一次读取本地候选并只序列化已绑定package；消费按准确job固定的上传槽。再次Source/目标HEAD核对、30秒最终事实窗口内，最多一次PUT；一次性槽不随清单、包、输出目录或时限变化复位。
4. 收到完整ACK后关闭上传客户端，创建新的只读SDK实例；消费独立Inspect槽，用准确key＋ACK VersionId读取一次，逐字节核对大小/SHA/checksum/AES256/版本及canonical表示，并经原编译器重建basis。只有全部通过才给后继真实固定版本引用。

| 效果 | 最大范围 |
| --- | --- |
| 上传Source STS / 桶元数据 / 目标HEAD / PUT | 2 / 6 / 2 / 1 |
| 独立Source STS / 固定版本GET | 1 / 1 |
| 本地候选内容 / 本地readiness内容 / 执行时准确CI GET | 1 / 4 / 3；另有正常源码/pins读取，不读私密配置 |
| SQL连接、Secret值、PEM、IAM写、workflow发布、dispatch、Cell创建、自动写重试 | 全部0 |

Prepare自身另需一次候选内容、四份readiness内容及3次CI GET，无AWS或槽消费。SDK维持maxAttempts=1，既有Source AWS Login凭据只在明确获批执行时解析，可能自动刷新；不提前要求用户刷新，不读取或输出密钥。独立Inspect的只读实例不能PUT、HEAD目标、读取本地包或消费上传槽。

上传槽为 `techlong-reviewed-cycle-job_a00fc18c13a5d6c6616c8039-package-upload.intent.json`，回读槽为同前缀 `-package-inspect.intent.json`，均在F:/ChatGPT_workshop且永不自动删除/复位。手动Inspect也要求同一SHA和本次真实写槽/ACK/manifest绑定；仅允许尚未消费的独立回读，不允许重新上传或覆盖原输出。

## 完整风险与明确不授权范围

批准必须接受：历史业务/管理员元数据及AWS Account ID/ARN进入原私有桶；SSE及私有桶不消除已有IAM读取者可见性，Source凭据在内存使用，网络/提供者/审计日志可能保存元数据；canonical算法是此协议的固定规则。HEAD只代表当前版本且读与写非跨服务CAS；并发、Source自动刷新失败、网络断连或ACK不明，可能留下收费对象或已消费槽但没有可用回读证明。

失败不自动重试、补齐、覆盖、删除、回滚、down、换key/任务或复位槽；独立Inspect失败也不自动再GET。没有可用准确VersionId时停止并保留原件，不能根据当前HEAD猜版本。锁定源码不等于全局无并发，historical readiness不替代未来worker实时检查；新basis批准也不能把a604 Review变成成功/accepted lineage。

接受低额但非零费用；50 USD/月只是目标，不是硬上限。此操作不续租或清理现有平台，不会自动停费。**不发布双workflow/SOURCE、不修改trust或其他IAM、不读取Secret/PEM/.env、不连接Neon/Aurora、不登记控制计划、不调度Review/RunOnce/Inspect、不创建付费Cell或部署。** 包独立成功后，必要来源发布和整轮部署仍各按准确范围新审批；GitHub环境只能用户本人批准。
