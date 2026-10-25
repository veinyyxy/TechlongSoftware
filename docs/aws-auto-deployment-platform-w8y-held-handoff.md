# W8y：准确旧任务退役与新 held 任务原子衔接

## 目的与现状

只推进自动部署主线。W8x 于 **2026-10-25 08:19 CDT（温尼伯）**完成一次已批准的真实只读核验：旧任务仍 pending/attempt0，Review 40165734067 的账本仍 ACKNOWLEDGED、proof NULL；平台 revision7 健康，但控制租约已经过期。原失败没有被证明是 IAM 缺口，不扩权限。

`UNIQUE(job_id, mode)` 是永久单次调度门禁。已调度的旧任务不能通过追加计划再次 Review；不重放旧工作流、不复位槽、不把本地虚拟 OBSERVED 当作数据库证明。复用既有原子转移算法，以一条新独立 held 任务继续；不是重建客户实例。

## 唯一允许的待审变更

- 旧任务 `job_6a1129afcebfc9fb580517c9`：仅 status 改为 canceled，updated_at/completed_at 改为本次数据库时钟；原行、payload、历史记录全部保留。
- 新任务 `job_9db8466fd95cef0c23ad6bfc`：仅插入一条 reconcile、pending、attempt0/max1、available_at=9007199254740991、无 lease 的任务。reviewRequired=true、cloudExecutionAuthorized=false，不会被普通队列领取。
- 新固定 clientRequestId `a7677ac6-c65c-498a-8e76-46c8dbd47067`，requestId `a30a73a3c2302b288e5583384ea5d4de3b3280ddb88b74552580a426c9add361`。不因刷新重新生成。
- 同一 SERIALIZABLE 事务内最多两项任务行变更、一次 COMMIT；随后另进程、另连接只读回读。

保持部署、实例、工作区、订阅、商户、环境预算、成功回执、所有其他任务及两代完整控制账本 **4 plans / 2 approvals / 2 attempts** 原样不变；不是只检查当前任务的投影。保护目录、Always trigger、唯一约束和角色权限保持原样。

AWS/IAM/Secret/PEM/S3/私密包/App token/dispatch/新云资源/控制计划/批准/观察/证明/租约更新均 **0**。本步骤不启动运行时，也不授权后续 Review、RunOnce 或部署。既有收费资源不自动停止，每月50 USD是目标而非硬限额。

## 实现与新鲜度

`transfer-next.mjs` 固定 profile，复用 `transfer.mjs` 原有 admission SQL、事务和回读实现；旧 W8r profile 的固定 ID、slot、清单结构及行为保持。生产 CLI 不接受 profile/目标任务/数据库/槽的覆盖参数。读取器准确覆盖旧6e和当前6a两代控制账本，任何变化都会停止。

PrepareSaved 仅读取已保存且 raw SHA 固定的 W8x 完成闭包及9份原件、GitHub准确 main CI、源码 pin 和本机配置文件 ACL/长度元数据；**不读配置内容、不连接生产、不重新调用 AWS**。历史运行时代码仍是320be62，不能冒充新 operator 源码。

执行材料到期固定为最早真实采样 **2026-10-25T13:19:12.436Z + 48小时 = 10月27日08:19:12.436 CDT**，最迟启动为08:17:12.436 CDT；再次 Prepare 不延长事实新鲜度。它不是部署或权限租约。执行前及事务内重新核对完整状态、数据库身份、权限/保护布局、有效订阅与管理员、所有任务和账本；任何漂移不自动修复。独立 Inspect 可在到期后核对已提交结果，不能写或重启执行。

## 完整风险与边界

1. RunReviewed 与独立 Inspect 各最多读取一次现有 `.env.local`（整文件进入进程内存），各一条经验证 TLS 的 Neon owner 连接；文件/提供者日志、内存及 owner 广泛现有权限仍有风险。不输出凭据，不改密码或权限。每连接最多80条SQL尝试，实际只允许固定查询及准确两行写入；无应用重试。
2. 控制三表 SHARE 锁先于第一事务快照；业务 admission 行及该部署所有任务行随后加锁。可能短暂阻塞写入，lock_timeout=1s、statement_timeout=15s；总体写事务窗口30秒。不是全系统维护锁，也不能消除跨服务或只读检查后的全部并发风险。
3. 取消旧任务和插入新任务原子提交，失败于提交前会尝试一次 ROLLBACK；网络中断、COMMIT确认丢失或本地记录失败可能导致结果不明。不得自动重跑、补齐、恢复旧 pending、down、回滚已提交事务或再次生成新任务；先用另进程的批准 Inspect 判断准确状态。
4. 两个新永久槽分别是 `F:/ChatGPT_workshop/techlong-w8y-held-handoff.intent.json` 与 `...-inspect.intent.json`。消费即永久保留，不能删除、改名、复位或隐式重试。旧槽和旧失败原件也全部保留。执行前若预检失败尚未消费槽，仍停止，不自动重跑失败命令。
5. 新 held 任务不是部署成功，也没有控制计划。后续准备新的 Review 与承载窗口仍需对应范围批准；旧 Review 及云领取截止不延长、不继承。迁移后未来继续点须使用新 ID，而非调用硬编码旧6a的历史入口。
6. 现有业务服务与 AWS 承载可能持续收费；Neon/网络/日志也不保证零费用。没有删除或清理资源的授权。

## 唯一入口与执行审批

准备（不授予执行权）：

```powershell
node --experimental-strip-types ops/platform-request-v6/transfer-next-local.mjs --mode PrepareSaved --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w8y-held-handoff-20261025-a
```

准确新 SHA 与上述范围获用户批准后，才可运行一次：

```powershell
node --experimental-strip-types ops/platform-request-v6/transfer-next-local.mjs --mode RunReviewed --manifest F:/ChatGPT_workshop/techlong-w8y-held-handoff-20261025-a/manifest.json --approved-sha <新SHA> --output F:/ChatGPT_workshop/techlong-w8y-held-handoff-20261025-a-run
node --experimental-strip-types ops/platform-request-v6/transfer-next-local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w8y-held-handoff-20261025-a/manifest.json --approved-sha <同一SHA> --output F:/ChatGPT_workshop/techlong-w8y-held-handoff-20261025-a-inspect
```

若无 writer claim，Inspect 也不得自行读取配置/连接数据库。主进程和独立进程都按同一冻结 main/CI/pins、固定目标和输出绑定运行；不需 AWS 登录、MFA 或用户连续40分钟在线。本阶段结束后停止，不能自动接云部署。
