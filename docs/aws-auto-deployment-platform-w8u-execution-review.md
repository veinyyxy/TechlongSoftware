# W8u：单次 HOSTED 开窗、发布和证据衔接执行审查

## 这一次究竟做什么

把 W8s/W8t 的组件接成生产命令，不重建镜像、不新增 IAM 或基础设施。准确目标仍为账户402010193138、ca-central-1、实例 `app_e897a4377bce498b9c5ee9e64509dcad`、待审任务 `job_6a1129afcebfc9fb580517c9`。旧任务、旧三条 Review 和全部历史槽保留，不复位或重放。

父进程只做：受审开窗 → 用户就绪 → 发布 Review → 等待用户在平台及 GitHub 批准 → 核对真实运行证据 → 记录准确观察/证明/RunOnce待审计划 → 再等待用户两处批准。**父进程不持有 GitHub App 私钥、不 dispatch、不领取业务任务、不调用 tenant CreateStack。** 若用户另行批准页面上的准确 RunOnce，既有云 worker 才按页面绑定范围执行。父进程等待完成仍不等于部署验收通过。

## 云变更的准确资源

仅一次 `UpdateStack` 到现有准确栈：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`

仅逻辑 `TaskDefinition` 替换和 `Service` 更新。当前基线必须仍是成功根事件、健康service及第4版任务定义；前置核对必须与W8t原文一致。其他资源物理身份保持，Service本身不替换；不更改 IAM、角色、权限边界、Secret、数据库 schema、域名、ALB、网络、镜像或历史 HostingExpiresAt 标签。原镜像摘要仍 `sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`。

模板只绑定最终操作者source；ControllerLease在实际提交意图时产生固定30分钟。临时StackPolicy只允许这两项逻辑更新；不安装永久策略。**DisableRollback=false**：CloudFormation正常失败回滚可以恢复旧状态、删除替换件；成功清理可能注销旧TaskDefinition。父进程不额外调用回滚、删除或补齐。

## 显式副作用上限

| 范围 | RunReviewed | 单独 Inspect |
| --- | --- | --- |
| 本机现有 `.env.local` 内容读取 | 1次，仅内存 | 1次，仅内存 |
| Neon经验证TLS连接 | 2条：owner、独立只读回查 | 1条只读回查 |
| 计划发布/证明/准确run观察 | 2条计划、1条证明、1次观察 | 0 |
| SQL提交尝试（包括只读事务控制） | 600条以内 | 60条以内 |
| 固定资源AWS元数据请求 | 240次以内 | 75次以内 |
| UpdateStack | 最多1次 | 0 |
| 私有证据S3固定版本GetObject | 最多4次，跨根重建缓存复用 | 0 |
| GitHub准确run GET | 最多80次，两个人工批准的准确run | 0 |
| Review准确job目录/日志 | 各最多1次，日志最多2MB进内存 | 0 |
| 无身份HTTPS登录页GET | 1次，不带Cookie、不提交登录 | 0 |
| Secret值/PEM/AppToken/S3PUT/IAM写 | 全部0 | 全部0 |

GitHub使用既有本机credential helper提供的凭据，只发送到官方API的固定GET端点。日志下载仅允许HTTPS受限Azure Blob跳转，**不转发Authorization**；原日志不落盘。日志JSON仅用于定位：后续必须读取准确S3版本、验证内容摘要、准确run/源码/闭包/原始manifest与实际lineage，才能生成证明。

两条数据库连接复用同一次读取的owner配置。它不是数据库层面只读或行级受限账号；父写端口只允许准确 `publish_plan` / `attest_evidence` / `observe_run`，独立回查端口无写方法且使用只读事务。配置值、TLS密码及GitHub读凭据不写入回执或聊天；内存无法保证完全即时清除。用于副作用计数的尝试可以在发送前失败，计数不是数据库提交证明。

用户在平台/GitHub上的动作不由父进程伪造。正常登录会写会话；平台批准会使用已安装的窄控制凭据、App签名和单次dispatch；云Review会读取固定worker数据库Secret、只读Neon并保存审查证据。这些页面/云端副作用仍按准确计划及完整风险人工批准。RunOnce可能领取任务、创建7项tenant承载资源、读一次私密包、发两次认证GET并原子完成；**本清单不代替后续准确RunOnce批准**。

## 时钟、Source和永久槽

清单到期沿用W8t最早实际事实的48小时截止，不因生成新source或重新封装延长。最晚开始还预留35分钟。写前再次读取准确云/数据库状态，旧业务/控制历史必须原文一致，新任务账本必须0/0/0；超过两分钟的前置核对拒绝提交。

Source在创建运行输出、读取配置或消费槽之前先验证；若凭据过期，只报预检失败、关闭客户端，不自动重试。刷新后是否继续由用户明确决定。开始后仅沿既有AWS Login自动刷新，最多6次装载/核验；刷新失败会中止，不能保证AWS异步操作已停止。没有MFA验证码采集、IAM Grant或撤权步骤。

开窗最多等待5分钟；源租约仍从实际UpdateStack意图计时，不从成功回执重置。独立元数据核对后，用户必须在 issuedAt+8分钟内确认准确实例页就绪，且明确愿意持续到本租约结束；确认不是执行批准。Review须在 issuedAt+14分钟内完成；RunOnce计划期限只缩短到manifest领取截止−8分钟/租约−8分钟，不能延长15分钟原领取窗口。父进程最多运行35分钟，不自动续租。

固定主槽 `F:/ChatGPT_workshop/techlong-w8u-hosted-cycle.intent.json`；独立Inspect槽 `...-inspect.intent.json`。W8s的发布/衔接槽继续单独绑定本清单，必须事先为空。所有槽采用不可覆盖写入；占用、回执不明或失败后不自动复位、换名、删除、补齐、重试或重跑工作流。并发的元数据核对不是跨服务CAS；不保证消除外部修改竞态。

## 命令与人工衔接

代码/CI冻结后，只生成新清单（不连接服务、不读配置内容）：

```powershell
node --experimental-strip-types ops/platform-review-v6/cycle-local.mjs --mode Prepare --ci-run <当前准确成功CI> --output F:/ChatGPT_workshop/techlong-w8u-hosted-cycle-<名称>
```

获得准确新SHA和完整范围批准后，才执行一次 RunReviewed：

```powershell
node --experimental-strip-types ops/platform-review-v6/cycle-local.mjs --mode RunReviewed --manifest <目录>/manifest.json --approved-sha <新SHA> --output <目录>-run
```

程序发出 `awaiting-hosted-page` 后，用户自行登录准确实例页，只查看、不创建请求/批准/观察。用户明确回复页面就绪且愿意持续操作至本租约结束后，操作者仅一次记录就绪（此命令不连接服务，不代批任何计划）：

```powershell
node --experimental-strip-types ops/platform-review-v6/cycle-local.mjs --mode ConfirmPage --manifest <目录>/manifest.json --approved-sha <新SHA> --ready-through-lease yes
```

之后用户分别亲自点击准确Review、其GitHub environment，再点击新RunOnce和其environment；不创建新请求，不操作旧计划，不Run/Re-run。程序通知同时输出UTC和温尼伯截止。失败/不明时停止，不刷新重提；租约和领取窗口都不会因额度中断而暂停。

成功或失败后，按本清单已批准范围另起一次只读窗口/账本核验：

```powershell
node --experimental-strip-types ops/platform-review-v6/cycle-local.mjs --mode Inspect --manifest <目录>/manifest.json --approved-sha <新SHA> --output <目录>-inspect
```

该Inspect核对安装窗口和账本、旧记录/保护是否保留，**不 dispatch云端Inspect、不代替tenant资源/服务/业务独立验收**。后者继续使用既有独立云端验收入口，按准确执行run和新范围另审。

## 必须接受的风险与费用边界

这是本机/Neon/AWS/GitHub/S3多服务非原子操作：某一步失败或回执丢失，前面写入仍可能已提交；AWS更新/正常回滚可能在父进程停止后继续。计划可能已经发布、证明可能写入，或资源仍在收费；不能仅凭错误退出码推断未变更。始终保存阶段、意图、准确请求与独立回读，未知就停止，不能自动应用补偿。

用户必须接受owner能力在受限代码中的暴露、全配置进入内存、连接复用、服务端/提供者日志、只读日志包含审查元数据、并发非CAS、凭据刷新失效、短暂服务中断、旧revision清理和部分遗留。租约只是控制权限时间，不是资源自动关机或清理。原承载和将来另批RunOnce承载均可能持续收费；50 USD/月只是预算目标，不是硬封顶，低成本不是绝对零费用。费用核对、资源清理和任何新IAM都不在本次范围。
