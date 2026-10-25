# W8z：新 held 任务接回原 AWS 部署链

## 主线与固定边界

W8y 已于2026-10-25 09:05 CDT（温尼伯）完成两行原子衔接，另进程独立核验通过。新任务固定为 `job_9db8466fd95cef0c23ad6bfc`，pending/attempt0/max1/MAX_SAFE/无lease，reviewRequired=true、cloudExecutionAuthorized=false。旧6a任务 canceled，原行/payload及其余7条旧任务保留；两代旧账本4 plans / 2 approvals / 2 ACK保持。

本阶段只做这条新任务的接线，不新建执行器、身份、权限或业务任务，不扩F3c9/UI。既有 worker/publisher、真实固定安装/lineage、手动平台及GitHub环境批准链保持。W8x的错误脱敏和对象版本/摘要/长度围栏继续生效，不因一次旧失败增加IAM。

新 profile 仅由受审入口代码选择，CLI或清单不能覆盖任务/数据库/角色/槽。旧6a入口、W8w清单、所有旧槽原样保留，但不能对新任务调用或重放。事务旧任务后态是实际独立读取，不伪造重命名旧job或旧ledger来适配。

## 本轮只读准备与许可

用户已另行允许本阶段在代码及CI通过后进行一次限定只读核对：Source固定AWS元数据快照最多75次；现有`.env.local`内容1次、验证TLS的Neon只读连接1条、最多45条查询。核对新9db控制账本占用、旧6e+6a完整历史、业务/准入/角色/保护布局，以及准确hosting/ECS/DNS/IAM布局和固定Secret版本元数据。整配置进入进程内存，不输出凭据；有内存、网络及提供者日志风险。

Source元数据必须在配置内容读取前通过；任何错误/漂移立即保存并停止，连接/SDK关闭，不自动重试或补齐。旧已消费的读许可不能复用。只读入口不读取Secret值/PEM/S3对象、不写SQL/AWS、不消费执行槽、不发布计划/调度。原W8y独立读取没有查新9db ledger；本次必须真实读取，不能预设为空。成功后才生成新执行清单；SHA批准不被此次只读许可替代。

准备材料原件：W8y完成闭包 `e8bca8a7…47ce6`（15份原件）及W8w旧窗口闭包 `aba7a69b…da8394`（60份原件）。旧实际运行时仍320be62/revision7/root cf550b50…；operator源码可前进，但不能假称AWS运行时已经更新。后续当前元数据必须验证实际旧版本、健康和过期租约。

成功准备文件的日期/新鲜度从本次真实采样起48小时，重读本地文件不刷新时钟。准备步骤不启动30分钟控制租约或15分钟云领取窗口，也不要求用户现在连续在线。

## 后续拟执行范围——必须另批准确新SHA

只有新的具体执行清单获批后，才允许：

1. 一次既有hosting栈 `techlong-sandbox-platform-hosting-v1` UpdateStack，仅逻辑资源TaskDefinition/Service更新，镜像digest、其余资源及IAM保持。使用正常CloudFormation失败回滚；新版本自动注入既有私密绑定，父进程不读Secret值。旧task definition可能被正常清理。新30分钟租约从真实UpdateStack意图计算，不复用或延长旧期限。
2. 准确安装/lineage对象固定版本GET，最多4个S3版本对象读取；原trusted publisher为新9db创建一条新的2小时Review计划SQL并独立回读，不写S3或App签名。
3. 用户亲自在平台核对新计划/动作/风险并单次批准调度Review，随后亲自批准准确GitHub run的environment。Review worker本身的Secret读取、Neon只读和条件证据PUT/artifact等副作用须随该具体用户批准说明；父进程不替批、不dispatch。
4. 真实成功Review及完整可信根重建通过后，父进程最多一次准确观察、一次proof写入和一条绑定RunOnce计划SQL。旧40165734067或本地虚拟证明7060不得作为新job前置。用户仍须另行批准新RunOnce平台计划及GitHub环境；未得到这两项批准，不领取任务或建栈。
5. 父进程仅等待准确RunOnce终态；本阶段独立Inspect只读核对窗口/控制账本，不等于业务验收或调度云Inspect的许可。

原固定上限保持：父进程AWS元数据240、UpdateStack1、Source加载6、配置内容1/Neon连接2、SQL600、计划提交最多2/proof1/observation1；S3版本GET4、GitHub run GET80/jobs GET1/log GET1（日志最多2MB只进内存）、公开登录页GET1。独立Inspect另配置1/只读连接1/SQL60/AWS元数据75。父进程IAM写、Secret值/PEM读取、S3 PUT、workflow dispatch、业务任务领取、租户建栈均0。

## 完整执行风险

- 整个流程跨AWS/Neon/GitHub/本地文件，非原子、非CAS；存在并发竞态、权限传播和凭据自动刷新失败风险，可能中途留下新窗口/计划/观察/proof或未知提交。现有owner凭据不是行级权限沙箱，代码围栏不能消除其广泛权限风险。
- UpdateStack可能导致服务中断、旧版本清理、正常失败回滚和重复运行时Secret注入；提供者/认证/业务日志和内存风险存在。30分钟租约关闭控制能力，不会停止ECS或费用。每月50 USD是预算目标，不是硬上限；此次低成本也不保证零费用。
- 执行前仍需新鲜页面正常及可连续40分钟配合的真实用户确认（不超过90秒），不能拿准备时回复冒充开窗时回复；更新后公开GET不等于重新登录验收，回执明确“更新后认证页面未重验”。Review须在短窗口内完成，原15分钟云领取截止不延长；晚到批准不能恢复旧流程。
- 对象版本、摘要、源码、精确job/run、完整历史和新任务空控制账本均校验；任一不符或结果不明即停止。不自动重跑、补齐、复位、撤销已提交数据库记录、删除资源、续租或进行operator补偿；先按已批准范围独立Inspect，后续恢复另审。
- 四个新永久槽：`techlong-w8z-hosted-cycle.intent.json`、`techlong-w8z-hosted-cycle-inspect.intent.json`、`techlong-w8z-review-publish.intent.json`、`techlong-w8z-hosted-handoff.intent.json`（均在F:/ChatGPT_workshop）。消费即永久保留，不能改名/删除/复位。旧槽、失败原件及旧行保持。
- 不因工作流GitHub成功就宣称部署验收成功；最终仍需独立云端Inspect核对资源/服务/业务。清理/删除及更改预算、权限、业务记录另审。

## 入口

本阶段批准的限定只读核对（准确CI通过后仅一次）：

```powershell
node --experimental-strip-types ops/platform-review-v6/successor-collect-local.mjs --ci-run <准确CI> --allow-config-read yes --output F:/ChatGPT_workshop/techlong-w8z-readonly-20261025-a
```

成功原件及完整准备内容由本地immutable ready记录绑定，稍后嵌入执行清单；更改指针/准备内容将与已批准清单不符而停止。准备执行清单仍无私密读取/连接/云写：

```powershell
node --experimental-strip-types ops/platform-review-v6/successor-cycle-local.mjs --mode Prepare --ci-run <同一CI> --output F:/ChatGPT_workshop/techlong-w8z-hosted-cycle-20261025-a
```

RunReviewed/Inspect当前均未获授权。不要运行旧cycle-launch-local入口。实际执行需要准确SHA、上述具体范围和完整风险，以及开始时新的真实人工在线确认；代码提交/推送沿用默认许可，不重复索取Git授权。
