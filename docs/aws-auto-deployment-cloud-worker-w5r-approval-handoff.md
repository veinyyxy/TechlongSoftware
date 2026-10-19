# W5r：本机人工审批交接与独立新一轮（未执行云动作）

2026-10-18，America/Winnipeg。用户同意“先改善人工审批衔接，再准备新的 Review 和执行窗口；不改 IAM 或云代码”。本轮仅本机代码/测试、文档、CI 和只读 Prepare，结束已失败旧 RunOnce 的 caller 冻结以准备新源码；不 dispatch、新读 AWS Secret 值、领取或部署。

## 具体改进

1. 新 `approval-handoff-local-v5.mjs --mode Handoff` 在准确 Review 已调度且用户人工批准后，最多等待约两分钟（网络调用另有自身超时），仅只读跟进准确 run/attempt/caller。只在成功 Review 的私有固定版本 proof/manifest 完整重构后，立即只读准备 RunOnce 并生成 `approval-scope.md`。不再在原 15 分钟窗口内人工整理长文档、重复启动多个准备进程或改 main。
2. RunOnce 准备、批准校验、新本地槽消费前以及临 POST 的异步源码检查后，都要求原 claimBy 至少剩 **8 分钟**。不足就停止，不消费尚未消费的槽、不 POST；若耗时发生在消费之后，则保留已消费槽而不重试。这是更严的本机准入，不把云窗口延长为8分钟或保证排队完成。
3. 准备好 GitHub 审批页面、可连续操作后才确认新 Review SHA；成功后用 Handoff 输出的精确 RunOnce SHA 单独批准，再立即在准确新 run 人工批准 environment。readiness 是人的声明，不是程序证明浏览器在线；窗口、网络、队列或人工延迟仍可能失败。不代批、不自动执行、不批量预批未知 SHA。

云 C=`d8cb99693231770de6a5d73e02dda42b87035714`、R=`7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c`、76文件闭包 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`、两部署 workflow/七个外部输入、IAM/trust/boundary、依赖、业务/工作负载/原云时间合同全部不改。旧 W5q 入口保持字节不变；不重做发布，不新增服务或长期 AWS key。

新 schema `techlong/cloud-worker-approval-handoff-review/v5`；同一原 job `job_ecbf09030d3da7286ea3ef93` 的 Review-v6、RunOnce-v5、Inspect-v5 是新的固定永久槽。旧槽及成功/失败原件全部保留。每次新 Review/RunOnce 预检增加准确表ID、准确同job五项 DDB 的只读事务快照，只有五项全空才允许新的未批准计划；“空”不是复位、绕过或重试授权，云端固定job永久写围栏仍是最终保护。

本机13项新增边界测试及相邻回归共96项通过，类型检查、定向lint（零警告）和两仓diff检查通过；独立闭包检查确认原76文件/70ee60eb不变。最终main云CI和实际只读Prepare另验，不以模拟端口或本机测试代替真实云验收。

源码门禁先复用 W5p/W5q 历史核验，再核对 W5q 失败检查点/五原件、原 dispatch 的22原件和 Review 的16原件。原批准172 pins在 Git `1b6aafb36130658d79118a189ab61a22cad59301`核验后比较当前，仅允许README/主线/无AWS CI三项变化；旧入口、测试、metadata、云源码均不改。新增七文件纳入本轮179 pins。失败是历史事实，不把异常重放冒充原始详细错误。

## 必须分开的准确批准

本轮终点是新 Review 的只读待审清单。未来单次 Review 批准仍只允许：一 POST、用户人工环境批准、云端固定 DB Secret 一读、窄只读事务/原业务与资源核对，以及一份私有 S3 manifest 条件写；不领取 job、不读 control、不写 DDB、不 CreateStack 或访问应用。

Review 成功后保持 caller main 冻结。Handoff 只观察/准备，返回 `PREPARED_NOT_DISPATCHED`；它不是 RunOnce 授权。RunOnce 的单独 SHA 才允许同任务领取、最多一次准确七资源 CreateStack、五个永久 journal 动作、固定 DB/control 各一读、两认证 GET、原子完成与私有回执写。原 claimBy/deadline/workloadExpiresAt 均不重盖；另一次人工 environment 批准也必须赶上原领取窗口。Inspect 仍另一 run、单独批准条件 execution-reference Put/固定 DB读/私有报告，不自动跟进。

## 完整风险

- 旧15分钟规则不变，8分钟本机余量不是服务保证；人工环境批准、runner排队、依赖安装、网络或Source刷新仍会延迟。Handoff超时/失败/不足余量只保存已获证据，不生成/调度替代云Review、不跳过新批准、不延长时间；新槽消费后停止不自动复位。
- GitHub/AWS/Neon/本机非原子、无跨服务CAS；main未保护，核验后仍可并发漂移。历史DDB/业务为空不是当前证明，本轮新读也无法消除读取与写入之间的竞态。程序不保证防管理员篡改，本机/Git/hash不是外部签名或WORM。
- Review会把私有业务/队列快照存固定私有S3；RunOnce会使用DB/control凭据和JWT/mTLS。云内存、runner、提供者/管理员日志存在暴露风险，不能保证绝对无泄露。原日志/签名URL和私密快照不公开。本机只用既有owner URL作固定Neon HTTPS只读核验，不连接Aurora或读取AWS Secret值。
- 既有DescribeTaskDefinition区域级读取持续存在，可能读取其它租户敏感配置，不是IAM租户过滤；本次不新增/撤销该权限。IAM传播、镜像、网络、API、应用或业务门禁仍可能阻断。
- POST/条件Put/网络/落盘可能未知，可能留下审批run、收费对象或已消费槽。SDK maxAttempts=1，无自动rerun、取消、重发、补齐、删除、撤权、回滚业务、补偿或清理；失败只读核对。RunOnce CreateStack原有OnFailure=ROLLBACK允许CFN回滚本次新建资源，回滚也可能失败/遗留收费资源，这不是controller另行清理权限。
- 50 USD/月只是目标，不是硬cap；既有父Cell/数据库、API/Secrets/S3/DDB/CI/日志及未来ECS/Fargate等可能收费，到期标签/TTL/Janitor不保证清理或停费。代码/CI或Review成功不等于真实部署、独立Inspect或整套平台AWS上线。

## 命令和唯一继续位置

最终clean main两项无AWS CI attempt=1/success后，仅只读准备：

```powershell
node --experimental-strip-types ops/cloud-worker/approval-handoff-local-v5.mjs --mode Prepare --cloud-mode Review --output F:/ChatGPT_workshop/techlong-w5r-review-20261018-a
# 用户准备好连续人工审批、另批新SHA后才允许单次Dispatch（本轮不运行）：
node --experimental-strip-types ops/cloud-worker/approval-handoff-local-v5.mjs --mode Dispatch --manifest F:/ChatGPT_workshop/techlong-w5r-review-20261018-a/manifest.json --approved-sha <fresh-review-sha> --output F:/ChatGPT_workshop/techlong-w5r-dispatch-20261018-a
# 用户批准准确Review run后，以下只读命令一次衔接观察和下一清单：
node --experimental-strip-types ops/cloud-worker/approval-handoff-local-v5.mjs --mode Handoff --dispatch-directory F:/ChatGPT_workshop/techlong-w5r-dispatch-20261018-a --output F:/ChatGPT_workshop/techlong-w5r-handoff-20261018-a --runonce-output F:/ChatGPT_workshop/techlong-w5r-runonce-review-20261018-a
```

目录必须全新、直接位于F基目录且前缀`techlong-w5r-`，不得覆盖。Handoff成功时立即展示新RunOnce SHA及其生成的scope，分别批准dispatch和准确run环境；在该窗口内不提交代码或文档。Observe仍可用新目录只读回读，不重发。过期清单只读刷新不能延长旧云manifest或复用旧批准，任何新一轮都必须明确审阅。不新增请求，不扩F3c9、Sites或平台托管支线。
