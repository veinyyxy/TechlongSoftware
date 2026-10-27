# a604 双工作流、固定本机绑定及 trust-only 发布

2026-10-27。本阶段只准备入口、测试、未发布Git对象和准确审批清单。没有实际工作流发布、IAM修改、运行时调用、部署或续租。GitHub environment 始终由用户本人批准，不能由本机operator代替。

## 已完成前提与最小范围

准确包上传及独立版本回读已完成，引用仅为 VersionId `WKWNfTsDXkQ5lZuqQRIG7YZw.4PERCEt`、内容 SHA `03e32f4b3f1f364cab53593d662b8744fb6081f7960d153c0da928946286986e`；新事实期限已按 af800cdb…79ebce 批准并固定至温尼伯10月29日09:06:24.483 CDT。原包、原期限和全部永久槽保持，不重新上传或修改事实。

本次拟议只有：

1. 一次无force推送两个预备Git提交：第一个只更新既有 reusable workflow，第二个更新既有 caller workflow 及 `ops/platform-a604-operator-v1/scope.mjs` 的准确本机SOURCE绑定（含移除不再使用的import）。合计两个工作流、一个本机绑定文件；不新建本地分支、不更新其他文件、不dispatch。当前源码绑定仍UNPUBLISHED，候选只写不可达Git对象和私有工作目录，不更新ref或工作区。
2. 创建、严格核对并执行一次准确现有 worker foundation 栈的 Change Set，仅把 WorkerRole 的 `job_workflow_ref` 从旧R改为新reusable提交。角色ID、actor、OIDC、boundary、inline、S3/DDB及所有权限/资源保持。Change Set必须仅一个WorkerRole、Static、无替换、仅AssumeRolePolicyDocument；任何额外变更都停止。
3. 执行后本地main仅快进到准确caller提交；再由新只读SDK实例独立核对两工作流、源码、环境、OIDC及完整既有布局。未成功独立匹配不能声称发布完成。

第三个本机SOURCE文件是必要接线：与同一包、事实、冻结104文件云闭包和新R同时绑定，避免后续另写一次启用入口。它不创建授权grant或计划，亦不读取配置、签名或调度。四个源码提交自引用字段仍只按原固定规则派生，不能输入任意JSON/env覆盖。SOURCE发布不等于任何单次操作已获批准。

## 准备及执行入口

`ops/platform-a604-publication-v1/local.mjs --check` 为零私密/网络I/O。`CaptureReadiness` 必须在准确CI通过、收到当轮明确只读授权后运行：最多一次Source STS＋12次AWS元数据（适配器合并上限13）、最多20次GitHub GET（其中CI三GET），核对既有准确角色/基础栈、main、两份工作流、环境/分支/OIDC及未完成运行。无Secret/PEM/.env/SQL或云/仓库写。失败保留输出，不自动重试。

首次捕获在GitHub前置校验停止：适配把Buffer传给JSON对象摘要函数，导致误报。实际6次GitHub GET（含CI三GET）、Source/AWS/写/槽均0；原失败保留。已改为base64解码成UTF-8文本再用原文本摘要，并对实际回调增加“正确两个旧工作流通过、内容或workflow ID变化拒绝”的无网络测试；不更改既有摘要基准。修复后的新一轮读取需新授权和新记录。

`PrepareSaved` 使用用户新批准的**5小时内**捕获结果、封存包执行证明及原件和准确CI，再写不可达Git候选；不再沿用2小时准备限制，没有实时AWS回退。验证旧工作流blob/hash、原SOURCE绑定hash、准确Git父链/tree/blob/diff和104/97云闭包。候选有且仅有前述三文件差异，ref/main/分支均不变。清单期限仍从真实观察时间起最多24小时、受新事实截止截断；最晚启动预留20分钟，不滚动补时。执行前仍必须在3分钟内完成实时preflight，不因5小时准备期而放宽。

本次已有快照观察时间为温尼伯10月27日14:38:53.490，其准备窗口因此截至19:38:53.490；先前17:38的一次性例外被本次5小时指示取代，旧记录不覆盖。不能改写观察时间为“现在”。为避免仅提交期限修复就使该快照源码失配，唯一允许迁移的是原始3b54f19快照（原始SHA及完整布局SHA固定），并且从该源码到新源码只能修改本地期限策略、接线、相应测试/文档六个准确文件；工作流、operator SOURCE和云源码任何变化仍阻断。准确新CI另行证明当前main，派生审查基准只把Git main改为该已验证源码；全部非main观测字段必须与原快照摘要一致。原快照不修改，清单明确记录原源码/观察时间/原件SHA及这种派生来源；这不是宣称重新读取了AWS。执行时仍用新鲜完整布局核验，实际发布仍需新SHA批准。

`PublishReviewed` 必须准确新SHA。复用原发布器：完整只读preflight、记录新事实→消费永久槽→一次push→核对工作流→旧布局核对→一次CreateChangeSet→严格核对→再次旧布局核对→一次ExecuteChangeSet→最终新布局核对→一次本地快进→独立Inspect。主流程最多180次AWS元数据（含Source核对）、160次GitHub GET、20分钟；独立读取最多13次AWS元数据（含一次Source）、17次GitHub GET。SDK maxAttempts1；轮询只观察同一Change Set/Stack，不重发写。

永久槽为 `techlong-a604-publication-v1.intent.json`、`techlong-a604-publication-v1.inspect.intent.json`，全部旧槽保留。缺少有效原writer槽/ACK/事实不得Inspect；未知提交或任一步失败不自动推送、补齐、回滚、删除、重放或复位。独立Inspect不授权重新执行写。

## 完整风险与剩余边界

GitHub发布、IAM/CFN、记录落盘及本地快进不是单一事务；检查不是跨服务CAS。可能工作流和SOURCE绑定已发布而trust仍旧、或trust已更新而本地未快进/独立读取失败。旧reusable pin失去角色访问；新的公开SOURCE绑定可能留在仓库，但没有单次grant/计划/dispatch仍不能自动执行。外部并发变化、未知ACK、Source会话过期或Git/服务故障可留下部分发布，需要另审处置。

执行明确设置 `DisableRollback:true`，不以自动回滚掩盖部分结果；现有资源可能进入失败状态。永久一次槽保证不自动重试，不保证自动恢复。没有自动清理、补偿或撤回旧工作流的授权。已有角色权限比某次Review所需更宽，本次不扩大它们；发布后只有固定App actor、仓库/main/attempt1/环境及新R条件符合才能换取身份，GitHub环境人工批准仍保留。

凭据、源码和审查元数据进入进程内存，可能涉及网络、GitHub/AWS/审计日志；不输出凭据不等于绝无暴露。公开提交包含包版本引用、Account ID/ARN及部署审查状态，不包含包正文/业务快照/私钥/Secret值。接受低额非零费用；50 USD/月仍是目标而非硬停费，既有承载可能继续收费，清理另审。

本清单不创建业务任务、计划或授权grant，不读Secret值/PEM/.env、不连Neon/Aurora、不上传包/镜像、不续租、不给GitHub自动批准、不运行Review/RunOnce/Inspect worker、不部署或删除Cell。发布成功后仍需另准备同任务的受审委托及准确计划；不得提前dispatch或把包/工作流发布当部署验收。
