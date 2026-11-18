# Sandbox 首开启用：新一轮集中审批

**待批准，未执行。** 只启用原 sandbox 平台的购买入口，不做测试购买或执行首开任务。[新机器清单](evidence/sandbox-first-purchase-activation-renewed.review.json)与本页一起审阅。原清单 `f90d4688…` 错过最晚启动时间，未读取凭据、未启动、未消费执行槽，保留原文件及时间，不续期、不重放。

## 同一轮内的范围

1. **新批准后一次核对现状。** AWS 只核对既有 Source、原 Access/Hosting 两栈及归属、服务、任务、健康、DNS、原 Secret 元数据、原 KMS 策略、新 Secret 名空位和固定租户首版 A 的 ECR manifest。Neon 只用验证 TLS 的只读事务核对已有角色、唯一绑定工作区／套餐／目录首版 A、准入和原表／触发器保护。GitHub 只核对原发布工作流及本人审批门禁、锁定候选 `14457164929`、原发布角色 Locked 和镜像映射。同一启用内，使用已保存的 Stripe 配置和签名文件，最多 **5 次固定认证 GET**，仅确认同一 Sandbox、测试模式及准确唯一回调。**不另跑 Stripe 测试、不发送事件、不创建或修改端点；文件已供给，无需重新保存。** 首次远程写入前必须完成以上核对，发现漂移、冲突、缺项或超时即停。
2. **原镜像发布并撤权。** 原 publisher 栈临时 Grant 一次、一次 GitHub dispatch、一次顶层 ECR push。用户本人批准准确 run 的 `techlong-sandbox-deploy`，不 Run/Re-run、不代批。Grant 可能已提交时，无论发布成败或超时都立即尝试唯一一次 Revoke；锁定状态、旧映射保留和新 ECR manifest 须独立回读通过才继续。
3. **原 Neon 窄安装及固定 Secret。** 一次 PG18 安装事务，只建一个 NOLOGIN definer、一个 webhook LOGIN、一个 schema 及五个受限函数。原 Web 和回调角色均不得直接写业务表；先撤临时 SET 再提交，再单独只读回核。新建一个指定 Secret：建空、安装资源策略、写一个固定版本，各一次；仍用原 KMS，不读 AWS Secret 正文。只注入测试运行键、已保存的签名值及同库回调专用 DSN，检查键不写入。
4. **原 Access/Hosting 与独立技术核验。** 各创建并执行一个准确 Change Set：Access 仅原角色和 boundary 修改，权限限固定新 Secret ARN／版本及原 KMS 转发解密；Hosting 仅新 TaskDefinition 和原 Service 任务定义引用。保留原 DB、域名、网络、ALB、DesiredCount 1 和控制器／普通 worker／apply 关闭。独立核对原栈、服务与健康、已发布 digest 和固定引用，再匿名 GET `/api/health`、`/register` 各一次。

写入和读取上限保持原启用范围，回调端点创建从 1 降为 **0**。合计 Source STS **11**、AWS 元数据／有界等待 **440**、GitHub 源端 GET **213**（主要用于同一个 run 的等待）／认证 helper **1**、云端固定产物 ZIP **1**，发布 job 内限定 GitHub API GET **3**、STS **1**、显式 ECR 读取 **3**，底层镜像分层请求另计。两个 Stripe 私有文件各读 **1** 次；`.env.local` **1** 次（全文件进内存，只使用原 Neon URL），验证 TLS 的 Neon 连接 **3**／SQL 提交最多 **76**（含前置、安装及只读回查）。回执只记录必要结果和摘要，不输出凭据、私密正文或业务行。

## 窗口与风险

新清单的最晚启动是签发后 **24 小时内**（若产物截止更早则提前）；启动后最多 **95 分钟**，首次远程写入必须在启动后 **10 分钟内**且前置核对全部通过。确切 UTC 时间见新机器清单。原产物截止 **2026-11-21 12:31:59 CST（温尼伯）**，不延长。旧快照只用于固定预期身份、归属与比对值，绝不是有效现状；新观测在实际获批执行时记时间，不用签发时间冒充采样。

跨 GitHub、Neon、AWS 不具备原子性，可能遗留镜像、窄数据库授权、Secret 或已改 IAM；Neon 创建者保留自动 ADMIN（不保留 SET/INHERIT），供应商日志和内存可能涉及凭据。平台滚动可能短暂中断并触发正常托管回滚。ECR、Secret、请求及现有承载可能计费。只允许安全所需的一次临时权限撤销及回读越过正常截止；不重试写入、不回滚重发、不删资源、不调整 Stripe、Cell、Express 或生产，不开启普通队列。未知提交保留原记录，不继续下游。更详细的原操作风险见[首轮范围](aws-sandbox-first-purchase-activation-review.md)，原轮授权与时限不适用于本轮。

技术核验通过后通知用户。测试购买和实际首开任务执行不在批准内。
