# C5f 日志模拟追加核对已完成：结果不足以定位权限原因

2026-10-15 America/Winnipeg。用户明确回复“确认允许”后，只执行此前列明的**四次 IAM 元数据读取与四次只读 custom simulation**。结果保存于 UTC **15:38:21.915** / Winnipeg **10:38:21.915 CDT**。本次有界检查已经完成，不需要刷新后重跑，也不授权任何新写入。

## 实际范围与结果

读取固定 `TechlongSandboxTaskExecutionRole`（RoleId 校验 `AROAV3GNMXTZJHJWAN4IR`）、其 `PullSandboxImageAndRuntimeSecrets` inline、共享 boundary 的元数据与准确默认 v4 文档。PolicyId 校验 `ANPAV3GNMXTZHXSTCQBZC`，没有修改文档或默认版本。

同一个准确 tenant log-stream ARN、两个 action（`logs:CreateLogStream`、`logs:PutLogEvents`）的四组结果：

| 传入模拟的策略 | 结果（两个 action 均相同） |
| --- | --- |
| 最小 Allow、准确 resource、不带 boundary | implicitDeny |
| 最小 Allow、Resource `*`、不带 boundary | implicitDeny |
| 现有 inline、不带 boundary | implicitDeny |
| 最小准确 Allow、现有 boundary v4 | implicitDeny |

八条 action 结果均 `MatchedStatements=[]`、`MissingContextValues=[]`。实际策略仍包含 `/saas/cell-sandbox-1/tenant-*:*`。**这些观测不能把拒绝归因于现有路径或 boundary，不能证明缺少权限，也不能证明真实日志访问已经可用。** SDK/请求构造、模拟器处理或其他上下文的具体根因未被本次检查证明；不把推测写成 AWS 故障结论，不假定这是可忽略的假阴性。

AWS 官方说明模拟与真实环境可能不同，最终需要真实环境验证；这不是跳过授权的理由。[IAM policy simulator 说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html)、[SimulateCustomPolicy API](https://docs.aws.amazon.com/IAM/latest/APIReference/API_SimulateCustomPolicy.html)。

## 证据与边界

- 原始本地证据：`F:/ChatGPT_workshop/techlong-express-c5f-log-simulation-20261015-r1.json`，raw SHA `7a6a1ee4c204d2da5e7ec983585419d28e4fbcf59fd488c76069d1df94565122`。含现有策略/ARN/模拟响应，不含凭据或 Secret 值；Git 不复制完整策略文档。
- [版本化结果摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5f-log-inspection.completed.json)绑定该证据、原预检 capsule 和执行入口源码 hash。
- 八次 SDK 调用，自动重试0；AWS/IAM/日志写、私密包或 Secret 值读取、Aurora/Neon SQL、永久槽消费、任务/部署/初始化均0。没有超出本轮四读四模拟的 AWS 调用预算。
- 本轮只追加结果文档与摘要，执行代码未改；没有重跑上一阶段16项测试或声称新增代码验证。原 C5f r1/r2/r3 预检与“当时尚未运行”的记录保持历史语义，原 capsule 不回填。

## 回到首轮交付主线

不继续增加日志模拟支线，也不据此追加日志 inline 或修改七消费者共享 service boundary。日志实际能力仍未验证，留作后续**另行批准的真实部署**中必须通过的日志流/应用健康验收条件；失败时停止并记录准确状态，不自动增权或重试写入。

下一实现点仍是准确既有 CFN 读取权限的最小差异和真实 first-claim/epoch → 七资源 workload/DNS → provision → initialized-ready/原子回写闭环。原 CFN 八个读取 action 候选也还未获安装批准，不能因本次只读许可执行。当前没有 fresh IAM 或部署执行清单，不先创建 running job、放开全局 apply 或启动 TTL；不重读 C5e 私密包，不重放 seed/ECR/F3c9。

计算层标签为 UTC **16:44:56.246** / Winnipeg **11:44:56.246 CDT**，只是标签，不会自动删除或停费。现有资源持续计费；50 USD/月仍是目标而非硬上限。后续若超过时间范围，应重新核对、准备准确范围，不复用旧批准延长标签或清理资源。
