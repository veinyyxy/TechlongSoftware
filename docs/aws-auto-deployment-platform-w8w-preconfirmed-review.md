# W8w：开窗前页面确认，保留逐次部署审批

## 这一轮收缩什么

W8u/W8v都已开窗成功，却停在开窗后的人工页面回复期限。本轮把“我已查看页面正常，且现在可连续配合40分钟”的确认移到开窗前；**不再要求更新后再发一条页面就绪回复，也不伪造更新后的认证页面检查**。更新完成后仍严格独立核验云资源、健康、权限和固定源码，再做一次无身份公开登录页GET；通过后发布待审Review并等待用户实际点击。平台Review/GitHub环境、RunOnce/GitHub环境四项人工批准不合并、不代批。主线目标及50USD/月预算目标不变。

新增风险是：开窗前页面正常并不能保证更新后的认证实例页正常；公开GET也不能证明这一点。若新页面故障，Review可能已登记而尚未批准，应停止、不重试，独立只读核对。新回执明确记录 `authenticatedPageRecheckedAfterUpdate=false`，不是旧 `hosted-human-page-ready` 的补记。原W8v晚到回复不用于本轮就绪；执行时仍须新的明确页面/在线确认。

## 真实基线与事实期限

基线来自W8v后续独立回读：准确平台栈UPDATE_COMPLETE、revision6、根事件 `268b7f80-d030-11f1-88a1-06ffe310ff0d`；任务 `job_6a1129afcebfc9fb580517c9` pending/attempt0/unleased，新账本0/0/0，完整旧业务和保护原文保留。父闭包 `c7d246c197c15b1d3552f3016f2f8bd25886f812a1024c76ae638e2fb1b6a26c`，43份原件逐一校验。

准备只复用已保存的真实回读，不读取配置内容或连接服务。回读时旧租约尚有效，如实保留此事实；新Run的notBeforeAt不早于旧租约截止（2026-10-25T05:20:48.073Z，温尼伯10月25日00:20:48），且新Run云前置核验仍要求旧租约已过期，不能重叠或恢复旧尝试。事实有效期取这次独立读最早时间+48小时，打包不能延长；最晚开始另预留35分钟。

## 准确资源与写入范围

账户402010193138、ca-central-1；唯一平台栈：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`

最多一次UpdateStack，仅替换TaskDefinition、更新但不替换Service，其他10项物理身份保持；镜像仍 `sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`。只改操作者源码绑定及实际意图生成的30分钟ControllerLease；历史HostingExpiresAt标签不改。临时StackPolicy仅允许这两项，无永久策略。**正常CloudFormation失败回滚开启**，可能清理替换资源或注销旧revision；父进程不另外回滚、删除、补齐。不改IAM、Secret、schema、网络、域名或镜像。

准确实例仍 `app_e897a4377bce498b9c5ee9e64509dcad`。父进程最多发布2条待审计划、写1条可信证明、保存1次准确run观察。父进程不持App私钥、不dispatch、不领取业务任务、不tenant CreateStack。Review发布后先独立回查，原始S3版本/摘要/run/source/闭包/lineage重建通过才能写证明。后续RunOnce须用户另审准确计划；本清单不代批。

| 副作用上限 | RunReviewed | 单独Inspect |
| --- | --- | --- |
| `.env.local`内容读取 / 经验证TLS Neon连接 | 1次 / 2条 | 1次 / 1条 |
| SQL尝试（含事务控制） | 600条 | 60条 |
| AWS固定元数据 / 现有平台UpdateStack | 240次 / 1次 | 75次 / 0 |
| S3固定版本GET | 4次，跨重建缓存 | 0 |
| GitHub准确run GET / job目录 / 日志 | 80次 / 1次 / 1次，2MB | 0 |
| 无身份公开HTTPS GET | 1次 | 0 |
| Source凭据装载核验 | 6次 | 6次 |
| IAM写、Secret值、PEM、S3PUT、父dispatch | 0 | 0 |

owner配置整文件仅进内存，账号不是数据库层面只读或行级隔离；父写端口仅发布/证明/观察，独立回查无写端口且用只读事务。GitHub既有credential helper读凭据仅发官方固定GET端点，日志跳转仅受限HTTPS Blob、不转发Authorization；原日志不落盘。日志仅定位，不是可信部署证明。

用户自行登录会写会话；平台批准会写控制账本并用既有App签名作单次dispatch。云Review读取固定worker DB Secret、只读Neon并保存审查证据。另批RunOnce才可能领取任务、创建7项tenant承载资源、读取一次私密包、两次认证GET及原子完成。这些真实副作用仍绑定页面准确计划和完整风险，须用户亲自审核；没有Run/Re-run授权。

## 时钟与永久槽

执行前先取得本清单SHA及完整风险批准，再取得“页面正常，现在可连续配合40分钟”的新确认。仅用实际接收时间作human-online-at-ms（<=90秒、不在未来），并显式传page-viewed-before-window=yes。领取主槽前剩余时间须>=31分钟，Update前须覆盖实际新租约全长。不能回填当前时间使用旧回复。Source在输出、私密读取和槽消费前预检，过期就停止、不重跑。

开窗最多等待5分钟；独立核验和公开GET后须在意图+8分钟内完成前置就绪衔接，不再等待人工第二次页面回复。Review仍须意图+14分钟内成功，父进程最多35分钟，控制租约30分钟不延长。原云领取15分钟不延长，RunOnce计划另保留8分钟。所有平台/GitHub实际批准仍人工；错误或结果不明不刷新重提。额度中断不暂停云时钟。

新四槽为 `F:/ChatGPT_workshop/techlong-w8w-hosted-cycle.intent.json`、`techlong-w8w-hosted-cycle-inspect.intent.json`、`techlong-w8w-review-publish.intent.json`、`techlong-w8w-hosted-handoff.intent.json`。只允许本清单的一次尝试，不覆盖W8u/W8v/W8s记录，占用后不复位、换名、删除、补齐或重试。

```powershell
node --experimental-strip-types ops/platform-review-v6/cycle-launch-local.mjs --mode Prepare --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w8w-hosted-cycle-<名称>
node --experimental-strip-types ops/platform-review-v6/cycle-launch-local.mjs --mode RunReviewed --manifest <目录>/manifest.json --approved-sha <新SHA> --output <目录>-run --human-online-at-ms <刚收到新确认的epoch毫秒> --page-viewed-before-window yes
node --experimental-strip-types ops/platform-review-v6/cycle-launch-local.mjs --mode Inspect --manifest <目录>/manifest.json --approved-sha <新SHA> --output <目录>-inspect
```

本入口不支持ConfirmPage。成功/失败后一次独立Inspect只核对平台窗口和账本，不dispatch云Inspect，不代替tenant资源/服务/业务独立验收。

## 必须接受的完整风险

多服务非原子、非跨服务CAS；读后并发修改不可完全排除，一次失败或回执未知仍可能已提交。AWS更新/正常回滚可在父进程退出后继续。接受owner写能力暴露、整文件/凭据进内存、提供者及服务端日志、日志含Account ID/ARN、自动刷新失效、短暂服务中断、旧revision清理、部分或未知遗留；不保证即时清除内存。尝试计数不是提交证明，未知结果保存证据停止，不自动补偿。

租约只是控制权限时间，**不会自动停止服务或账单**；现有平台和另批tenant资源可能持续计费，50USD/月仅目标、不是硬封顶，费用非零且可能超过目标。本次不授权资源清理、续租、费用变更、新权限、自动回滚、撤权或新尝试。程序结束或晚到回复不能恢复已关闭尝试。后续另审新范围，保留所有历史证据。
