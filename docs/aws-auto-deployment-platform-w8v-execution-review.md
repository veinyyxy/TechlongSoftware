# W8v：先确认连续在线，再启动单次 HOSTED 周期

## 从哪里继续

W8u 已独立核验关闭：一次平台 UpdateStack 成功，根事件 `25e53060-d00f-11f1-8cb6-02ad2146c393`，TaskDefinition 为 `techlong-sandbox-platform-web-v1:5`；因人工页面就绪超时停止，任务仍 pending，新任务账本为0/0/0，未发布 Review、未调度或部署 tenant。旧第4版已由 CloudFormation 正常清理注销。晚到的页面回复不构成重放许可。

本次以这份真实的后续独立回读作为新基线，不把第5版伪装成第4版，不覆盖旧槽或旧证据。父闭包为 `a8e4dea0fe3737af541e876a28c59876c08fe34d0e1852bd50bf13505d5904cc`，42份原件逐一校验。准备阶段只读本地已保存的回读，不重读 `.env.local`、AWS、S3或Neon。事实有效期为该次实际只读核验的最早时间加48小时；新打包时间不能延长。执行前仍要重新只读核对真实资源、完整业务状态、权限和准入，漂移就停止。

## 准确变更及副作用

账户402010193138，ca-central-1；准确栈：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`

仅一次 UpdateStack，替换 TaskDefinition、更新但不替换 Service。其余10个物理身份保持，镜像保持 `sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`，历史 HostingExpiresAt 不改。只更新操作者源码绑定和实际意图时产生的30分钟 ControllerLease。临时StackPolicy只允许上述两项，永久策略仍无；不新增IAM、Secret、网络、域名、镜像或schema。**正常 CloudFormation 失败回滚开启**，成功清理可注销旧revision，失败可清理替换件；父进程不另外回滚、删除或补齐。

目标仍为实例 `app_e897a4377bce498b9c5ee9e64509dcad`、准确待审任务 `job_6a1129afcebfc9fb580517c9`。所有历史业务、旧任务、控制账本和保护必须原文保留。父进程最多发布2条计划、写1条可信证明及1次准确run观察；不伪造人工批准、不持App私钥、不dispatch、不领取业务任务、不调用tenant CreateStack。

| 范围 | RunReviewed上限 | 独立Inspect上限 |
| --- | --- | --- |
| `.env.local`内容读取 / 经验证TLS的Neon连接 | 1次 / 2条 | 1次 / 1条 |
| SQL提交尝试（含事务控制） | 600条 | 60条 |
| 固定AWS元数据 | 240次 | 75次 |
| 既有平台UpdateStack | 1次 | 0 |
| S3固定版本GetObject | 4次，缓存复用 | 0 |
| GitHub准确run GET / job目录 / 日志 | 80次 / 1次 / 1次，2MB | 0 |
| 无身份HTTPS登录页GET | 1次 | 0 |
| Source凭据装载核验 | 6次 | 6次 |
| IAM写、Secret值、PEM、S3PUT、父dispatch | 0 | 0 |

数据库owner配置整文件仅进入内存，账号不是数据库层面只读或行级隔离；受限写端口仅允许发布、证明和观察，独立回查无写端口且使用只读事务。GitHub既有credential helper凭据仅发官方固定GET；日志重定向仅受限HTTPS Blob且不转发Authorization，原日志不落盘。日志仅作定位，必须再核对准确S3版本摘要、run/source/闭包、原manifest及lineage才可写证明。尝试计数不等于已提交证明。

平台用户自行登录会写会话；自行批准会写控制账本并使用既有App签名作单次dispatch。云Review读取固定worker DB Secret、只读Neon并保存审查证据。后续RunOnce可能领取任务、创建7项承载资源、读取一次私密包、两次认证GET并原子完成。**这些实际副作用仍须用户亲自审核准确计划、风险并在平台与GitHub两处批准；本清单不代替后续RunOnce批准。**

## 先在线，后开窗

1. 代码、CI和本清单SHA先冻结；用户明确批准准确SHA。
2. 紧接实际命令前，另请用户确认“现在可连续配合约40分钟”。只有这条新回复的实际接收时间可作为 `--human-online-at-ms`；不能使用旧回复、回填当前时间或猜测持续在线。该时间不是计划批准。
3. 入口在任何服务/私密读取前要求此时间不在未来且距现在不超过90秒。领取永久槽前还须剩余至少31分钟；实际Update前须覆盖其完整30分钟租约。预检过慢即停止，不能重置在线时间继续旧运行。
4. AWS计时仅从真实Update意图开始。开窗等待最多5分钟；实际独立核验和公开页探测后，用户仍须在意图+8分钟内自行查看准确实例页并确认愿意操作至租约结束。操作者才可一次ConfirmPage。
5. 用户亲自批准新Review及其GitHub环境；Review须在意图+14分钟内成功。证据独立核对后才准备RunOnce，用户再亲自两处批准。原云领取15分钟不延长；RunOnce计划截止还预留8分钟。父进程最多35分钟，不续租。

程序同时输出UTC及温尼伯期限。晚到/未知回复不恢复已关闭的进程；额度中断不暂停云时钟。没有“开始”即自动批准或自动重试。

## 新独立永久槽及命令

四槽分别为 `F:/ChatGPT_workshop/techlong-w8v-hosted-cycle.intent.json`、`techlong-w8v-hosted-cycle-inspect.intent.json`、`techlong-w8v-review-publish.intent.json`、`techlong-w8v-hosted-handoff.intent.json`。都必须未占用，采用不可覆盖创建。旧W8u及W8s槽和记录保留；失败后不换名、删除、复位、补齐或重试。

```powershell
node --experimental-strip-types ops/platform-review-v6/cycle-next-local.mjs --mode Prepare --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w8v-hosted-cycle-<名称>
node --experimental-strip-types ops/platform-review-v6/cycle-next-local.mjs --mode RunReviewed --manifest <目录>/manifest.json --approved-sha <新SHA> --output <目录>-run --human-online-at-ms <刚收到明确在线回复的epoch毫秒>
node --experimental-strip-types ops/platform-review-v6/cycle-next-local.mjs --mode ConfirmPage --manifest <目录>/manifest.json --approved-sha <新SHA> --ready-through-lease yes
node --experimental-strip-types ops/platform-review-v6/cycle-next-local.mjs --mode Inspect --manifest <目录>/manifest.json --approved-sha <新SHA> --output <目录>-inspect
```

Source在输出创建/配置读取/槽消费前核验；过期就停止，刷新不代表新写批准。运行中只沿既有Login自动刷新，失效即停。Inspect另起一次只读核对窗口/账本，不dispatch云Inspect，**不是tenant资源、服务、业务独立验收**。后者需绑定实际执行run另审。

## 必须接受的完整风险

本机、Neon、AWS、S3、GitHub非原子且不是跨服务CAS。读后可发生并发修改；一次失败/回执未知仍可能已提交，AWS更新或正常回滚可在父进程停止后继续。owner写能力暴露、整配置及读凭据进入内存、提供者/服务端日志、日志含Account ID/ARN、凭据刷新失败、服务短暂中断、自动清理旧revision及部分遗留均需接受；不保证即时清除内存。

租约仅限制控制操作，**不会自动停止服务或账单**。既有资源与另批tenant承载可能持续计费；50 USD/月是预算目标而非硬封顶，费用非零且可能超过目标。本次不授权删除/续租/费用调整/新权限或自动补偿。所有永久槽占用不可自动复位；结果未知则保存证据并停止，不能凭错误退出码认定未写。后续重启必须重新核对、单独准备和批准，不重放旧清单。
