# Sandbox 首开：修正版的单次启用审批

**只准备，尚未执行。** [机器清单](evidence/sandbox-first-purchase-dahlia-activation.review.json)绑定原 sandbox 平台、唯一工作区和[已核验产物 `14480476839`](evidence/sandbox-first-purchase-dahlia.observed.json)（run `44418072086`、attempt 1）。复用同一个 Stripe 测试回调、现有 `2026-05-27.dahlia`、五个事件及已保存的签名。仅启用这一笔银行卡测试购买的入口；不替用户购买，不执行首开任务。

旧清单 `8b35a358…` 和已用尝试槽原样保留。本轮只在已存去敏回执证明旧轮在首次写入前停止、旧发布槽仍未形成时使用修正版独立单次槽；它不是旧清单的重试、续期或复位。发布工作流仅接受修正版，保持 `techlong-sandbox-deploy` 由用户本人批准；[两个固定提交的无 AWS CI](evidence/sandbox-first-purchase-dahlia-publisher.observed.json)均已验证。

## 同一份批准内的操作

1. **获批后仅核对必要现状。** 确认现有 Source 身份、原 Access / Hosting 栈和服务、任务与 DNS、固定 Secret 元数据、原 KMS 策略、固定租户首版 A 的 ECR manifest、新 Secret 名未使用；验证 TLS 到 Neon 的只读身份和原业务/权限约束。GitHub 核对固定产物、现有工作流和人工门禁；发布栈应 Locked，四个既有 ECR 镜像不变，新 tag 未占用。使用既有 Stripe 本机文件，在同一启用流程内最多 **5 次固定认证 GET**，只核对 Sandbox 账户、测试模式及指定回调的唯一匹配、签名文件 ID、版本和下列事件。不跑单独 Stripe 测试、不创建或修改端点、不发送事件或做测试购买。任何漂移或超时发生在首次写入前即停。
2. **同一轮单次发布并撤权。** 只用原 publisher：一次临时 Grant、一次 GitHub dispatch、一次顶层 push 到原 ECR 的 `sandbox-first-purchase-cdfa2e16-r44418072086`。GitHub job 本人批准后只下载该封存包、核验摘要及镜像配置、复用原禁网自检及新鲜扫描，不重构建。若 Grant 可能已提交，无论成功、失败或结果不明，立即尝试唯一一次 Revoke；独立回读证明 Locked、旧镜像保留、新 ECR manifest 和精确 config digest 相符才继续。
3. **只装原窄权限与固定 Secret。** Neon PG18 一次安装事务，建立一个 NOLOGIN definer、一个 webhook LOGIN、一个 schema 和五个受限函数；不向 Web 或回调角色授予直接写业务表权限，提交前撤临时 SET，提交后另开只读连接回核。新 Secret 按建空、资源策略、固定一个版本各一次；使用原 KMS，仅写测试运行键、同一端点签名和同库受限 webhook DSN，不读 AWS Secret 正文，不注入检查键或通用 Stripe 凭据。
4. **仅更新两座原栈并独立核验。** Access 和 Hosting 各创建一个并仅执行该准确 Change Set：原角色及 boundary 只加对新固定 Secret 和原 KMS 的窄权限；只替换 TaskDefinition 并更新原 Service 的任务定义引用，保持原 DB、ALB、域名、网络、任务数 1、控制器/worker/apply 关闭。独立回读栈、服务、实际 digest、健康和固定引用，并匿名 GET `/api/health`、`/register` 各一次。

既有测试回调是 `https://console.sandbox.techlong.cloud/api/stripe/webhook`，事件仍为 `charge.refunded`、`checkout.session.completed`、`checkout.session.expired`、`payment_intent.payment_failed`、`payment_intent.succeeded`。该笔首开只用银行卡，不需要新增异步事件；若实际回调配置不符，停止，不替换版本、签名或事件。

调用上限与上一轮一致：Source STS **11**、AWS 元数据及有界等待 **440**、GitHub 源端 GET **213**（含观察准确的一个 run）和认证 helper **1**。发布 job 内另有 GitHub API GET **3**、签名 ZIP GET **1**，最多一个 AWS 会话（AssumeRoleWithWebIdentity 一次、GetCallerIdentity 一次）及显式 ECR 读取 **3**，镜像分层请求不按一次计。两个 Stripe 私有文件各读 **1**，`.env.local` **1** 次（全文件进内存、只使用原 Neon URL），验证 TLS 的 Neon 连接 **3**／SQL 最多 **76**（含前置、安装及回核）。只保存必要去敏回执，不输出凭据、账户清单或业务正文。

## 窗口和失败处置

最晚启动为新清单签发后不超过 **24 小时**，并受固定产物到期限制。实际启动起最多 **95 分钟**，首次远程写入必须在启动后 **10 分钟内**且前置核对通过。确切时间见机器清单；原产物在 **2026-11-21 17:09:39（温尼伯 CST）** 到期，不延长。旧观察值只用于比对，新现状仅在获批执行时记录。

多个服务非原子，失效、并发或失败可能留下镜像、DB 窄角色、Secret 或已改 IAM；Neon 创建者保留自动 ADMIN（不保留 SET/INHERIT）。处理私用配置存在内存、网络、供应商日志和托管注入风险；ECR/Secret/承载可能持续计费，平台滚动可短时中断并保留 CloudFormation 托管回滚。仅临时 Grant 的一次必要撤权与回读可越过正常截止；不重试或另行补齐，不删资源，不改 Stripe、不恢复 Cell/Express、不启用全队列。未知提交保留原记录，不继续下游。独立技术核验通过后才通知用户测试购买。
