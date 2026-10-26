# W9p：新只读核验完成，现有 ECS 更新待批准

2026-10-26。Source 已切回固定 IAM 用户 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，UserId 与原绑定一致。此前身份不匹配的失败材料和原快照均保留，没有放宽校验或重跑旧输出。

## 本次真实只读结果

新快照开始于 `2026-10-26T19:29:27.729Z`，完成于 `2026-10-26T19:29:56.821Z`，实际 **STS1、AWS元数据43、写0**。没有读取 Secret 值、`.env.local`、PEM，没有数据库连接、租约启动、调度或执行槽消费。

准确承载栈仍为 `techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`，原11项资源。运行服务/任务/ALB健康、DNS别名匹配，TaskDefinition仍为 `techlong-sandbox-platform-web-v1:8`。原执行角色、边界/inline/trust与三个固定 Secret 版本元数据均匹配；未读取其值。Source 对准确栈的 UpdateStack/SetStackPolicy 模拟为 allowed，这不是实际更新成功保证。

已发布镜像的原始 registry manifest 已回读并核对 digest `sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a` 和 config `sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90`，无需重新 build/push。快照原始SHA为 `2aa83db27527b0f3786ca9276bd4e614c4abaa6ec1150595a24110f9bce89abb`，原件只保存在本地私有证据目录。

## 下一份准确批准清单的固定范围

- 一次顶层 UpdateStack，只替换现有 TaskDefinition 的镜像/公开执行源码与模板Metadata，并更新其 Service 引用；保留其他10项物理身份、角色、三个 Secret 固定版本、网络/DNS/证书/日志、单任务512CPU/1024MiB。
- 不创建新栈/IAM/Secret/Cell，不读本地私密材料或直接 GetSecretValue，不连接数据库、不调度 Review/RunOnce。ECS替换任务会由托管服务重新读取并注入既有三个 Secret 版本；不是整个部署不涉及私密值。
- 实际执行先重新核对基线（读预算最多240次元数据、1次STS），新鲜事实通过后才消费单次槽；最多一次 UpdateStack，不自动重试。另起进程独立只读 Inspect（最多65次元数据、1次STS），核对实际新revision、镜像、source、lease、资源和权限；这两段未来读取/更新均须随准确SHA另批，不属于本轮已完成的只读许可。
- 正常 CloudFormation 失败回滚、替代资源/旧revision托管清理、任务中断、并发/非CAS、Secret托管重注入、凭据失效、部分状态/持续费用及永久槽不复位风险，完整见[原受审风险文件](aws-auto-deployment-w9p-recovery-hosting-update-review.md)。不自动额外清理或补偿；50USD/月不是硬上限。

## 源码、批准和时间

实测代码为 `6fa0650544cded5dd6fda90fab0bdedd12960874`，[No-AWS CI40382378149](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40382378149) 的准确源码/全部步骤已独立核验成功。本次公开记录仅为CI允许的两份元数据文件；之后 PrepareSaved 将在 clean main 上绑定实际执行源码，单独记录实测源码，不冒称文档提交运行过CI。

本文及机器索引不是执行批准 SHA。实际 SHA 由工程入口 `ops/platform-recovery-hosting-v1/local.mjs --mode PrepareSaved` 在该元数据提交完成后生成，保存在本地新的 manifest，并另交用户确认；不在文件内嵌入自引用提交/manifest SHA。

清单最长24小时，且受原业务基础 `2026-10-27T18:47:57.695Z`（温尼伯10月27日13:47:57）限制；最晚启动至少提前35分钟。30分钟控制租约仅在实际更新意图时开始，不因只读准备提前起算或延长。执行前须新的可连续配合约40分钟确认。控制租约到期不停止Web或计费。

启动后冻结main，窗口结束再提交结果。后续 Review → RunOnce → 独立 Inspect 仍按[唯一主线操作顺序](aws-auto-deployment-recovery-launch-readiness.md)和各自准确范围批准；此更新不替代其授权，也不宣称整套系统已上线。
