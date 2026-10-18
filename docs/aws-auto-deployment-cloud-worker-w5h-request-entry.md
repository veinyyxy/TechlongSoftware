# W5h：真实云部署前置核对与新待审请求

**当前已完成（2026-10-18 07:46 CDT）：用户单次登记新job `job_ecbf09030d3da7286ea3ef93`，入口已关闭。** 独立只读回读确认pending/attempt0/max1/审核挂起、准确管理员/原scope，原九行/三旧任务摘要不变，无云执行。不要再次开启或点击；下一只准备准确新job的云Review另审。见[实际登记、诊断更正与唯一继续点](aws-auto-deployment-cloud-worker-w5h-request-recorded.md)。以下开启/准备内容仅为历史。

**后续状态（2026-10-18 07:42 CDT）：用户已明确批准本地入口和一条管理员请求，现已开启，等待用户单次操作。** 仅127.0.0.1:3100，request ON/worker/apply OFF，健康/登录200，无cookie管理员API401；准确listener32800/launcher34096、exec session10626。新登记尚未独立观察，不能称已生成新job。见[开启记录和恢复位置](../ops/aws-sandbox/reviews/cloud-worker-w5h-request-entry.activated.json)。

更正准备时的端口判断：默认隔离诊断未显示主机监听，不足以证明主机3100空闲；首次启动因此报端口占用并退出。主机侧随后确认是旧W4c default-OFF展示进程27660/launcher28472及其workerd子进程31196，已只停止这组准确旧项目进程、确认端口关闭，再按当前批准正常启动替换。没有停止其它服务、删除文件或重试登录/任务POST。今后端口核对必须在主机侧完成，不能把隔离视图当作主机事实；原失败工具结果和Git准备记录保留。

用户自行打开[本机登录及固定实例页](http://127.0.0.1:3100/login?returnTo=%2Fadmin%2Finstances%2Fapp_e897a4377bce498b9c5ee9e64509dcad)，用原管理员登录，只点一次“创建待审恢复请求”。报错/提交不明也不重试，先关闭准确本次进程再只读核对。原九行业务快照与三旧成功job已独立存摘要基线 `F:/ChatGPT_workshop/techlong-w5h-request-baseline-20261018-a.json`（raw SHA `91aa13bcc6117fa793751b88fc906f57dbe0ef61ab52a84a3f8f098ef198f164`），不保存原业务行/密码/会话令牌。

以下为准备时点及仍适用的完整风险，不撤销上述用户批准，也不授权云部署。

2026-10-18，America/Winnipeg。承接 [W5g 真实云身份/固定数据库验收成功](aws-auto-deployment-cloud-worker-w5g-verified.md)。本阶段复用既有页面、请求 API 和云 worker，不新增队列、角色、权限、模拟器或恢复分支；“开始下一步”只用于只读盘点和准备，**尚未开启请求入口、登记新任务或部署**。

## 实际只读结果

2026-10-18 **07:31:14.078 CDT**，12次 AWS SDK读取和1个 Neon READ ONLY事务：

- 独立实例/部署仍 active/ready，保存的最新成功任务仍是 `job_fe5ced28b698d0bf128e7b42`，回执 SHA `d350a38748a2d1fe70c2e2dfc2768534c53aedc07a44994b571963a500da6bdb` 与云冻结沿革根相同；回执窗口已到期。原3条任务均 succeeded、无lease、无活动/待审任务。
- 原租户栈 `aa962890-c9e4-11f1-988b-06ffcd51c63d` 为 DELETE_COMPLETE，7项资源均 DELETE_COMPLETE；ECS `cell-sandbox-1` ACTIVE，service/running/pending计数均0。这不是完整 namespace终审证明，后续云Review仍须精确核对同名栈/task定义/log/target/listener/authority等门禁。
- 父 Cell `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` 仍 CREATE_COMPLETE，16资源及模板与冻结值一致，旧 ExpiresAt/CellExpiresAt 均 `2026-10-15T16:44:56.246Z`。旧标签已过期但不等于自动停费；沿用[W3已明确接受的独立child窗口](aws-auto-deployment-aurora-dual-mode-w3-execution-review.md)，未来新子承载使用原7200秒策略，不续期/改写父Cell。不能在执行时把过期标签说成新的有效父窗口。
- Aurora仅元数据读取：准确集群available、PG17.9、IAM认证/Internet Gateway、无VPC networking、0–1 ACU/300秒auto-pause符合冻结配置；没有连接Aurora或读取其数据。
- 两准确镜像scan为COMPLETE，保存的severityCounts为空，未报告HIGH/CRITICAL；不是重新扫描或绝对安全保证。Janitor代码与冻结值一致，调度ENABLED/rate(15 minutes)，不承诺准时删除或停费。
- 所选既有管理员 `veinyang@gmail.com` / `usr_4dcd0a09821fde2bb1801f58` 仍active/platform admin。未读密码hash、salt、session token或创建会话。准备阶段隔离诊断未显示3100监听；其主机侧结论已按上方更正。

原件在 `F:/ChatGPT_workshop/techlong-w5h-prerequisites-20261018-a/`，包含 `platform.json`、`aws.json`、`summary.json`；[机器摘要](../ops/aws-sandbox/reviews/cloud-worker-w5h-request-entry.prepared.json)固定其哈希。读脚本首次在联网前因辅助SDK不在根依赖路径停止，随后改用既有 `ops/cloud-worker` 依赖（未安装依赖），只读盘点成功；没有写重试或执行槽消费。平台查询仅安全字段，未取lease能力/密码。

## 现在只缺什么

**缺一条新的真实管理员待审请求。** 不应为此重新运行VerifyInstall、重建Cell/镜像或直接由Source伪造管理员session/INSERT任务。后续由原管理员在现有页面单次点击；job ID/请求来源由现有session与nonce协议生成，不复用成功旧job或清理旧槽。

## 待用户另行确认的准确范围及完整风险

只在确认本节后才执行既有命令 `node scripts/local-deployment-platform.mjs --enable-request-entry`：临时开启 **127.0.0.1:3100** 本进程请求入口，worker/apply仍强制OFF，不改.env/.dev.vars、不发布Sites或平台云承载。启动参数不是SHA验证或权限系统，授权来自用户对此准确范围的确认；不会把文档中的命令当成已批准。

用户用上述现有管理员自行登录（不在聊天提供密码），在固定实例 `app_e897a4377bce498b9c5ee9e64509dcad` 页面只点一次“创建待审恢复请求”。POST为同源/管理员session，固定deployment `dep_7c99bd249470184852f0dc74`、原scope/epoch/镜像/配置、单个SERIALIZABLE事务，最多新增一条 pending/reconcile、attempts=0/max=1、available_at=9007199254740991 的**审核挂起**任务，不会被普通队列领取。不是将旧任务复位；不改旧任务、ready_at、原receipt、业务记录或初始化数据库。

登录可能正常写auth_sessions及登录计数/锁定状态，不能宣称整个过程只有一条SQL写；数据库/浏览器/开发运行时可能记录元数据。HTTP仅loopback，不开放LAN/代理；现有启动绑定会把既有DB/Stripe/auth配置交给本地开发运行时，不打印/复制值，不调用Stripe。现有开关不是单人隔离或软件强制永久一次性门，同机具有有效管理员session者可能访问；必须只登记一条并及时关闭。

请求有nonce/dedupe、完整outputs/成功前驱/归属锁及无活动兄弟任务检查，但没有跨服务CAS。序列化冲突、网络失败或提交ACK不明时可能已有持久行，**不得换nonce或重试**；只读回读确定结果，不自动删除、撤销、补齐、回滚或复位。若登录失败，不擅自重设密码、bootstrap、造session或扩展认证支线。

登记成功或提交不明后，停止**本次启动的准确本地进程**，确认3100关闭，再独立只读核对新job/管理员来源和旧行。此批准不含新权限、Secret值/原包读取、应用认证GET、Aurora连接、GitHub调度、AWS建栈/删除/续期或worker实际领取。50 USD/月目标非硬cap，已有AWS资源不因只登记请求而停费。

## 登记后的最短继续路径

保存准确新job ID，直接准备现有冻结云工作流的 **Review** 调度审批：固定DB Secret一次、窄角色read_state/元数据读取、S3仅创建不可变待审manifest；它不是“绝对无写”的纯只读探针。用户按准确job/dispatch/S3范围再批准并人工审批环境后运行；不读control Secret或部署。Review只给15分钟领取窗口/两小时child到期，**此后不要推进caller main**，RunOnce/独立Inspect必须绑定同一caller SHA，不因等待重新盖时间戳。

再按云Review产出的新manifest SHA单独批准RunOnce和独立Inspect：五个DDB永久槽、同job领取/原子完成、最多一次七资源CreateStack、固定控制Secret及两认证GET、不可变证据等按原W5c合同明确核对。两阶段批准不混为一谈，不直接沿用已消费的W5g调度器或旧W4本机根；不再读F盘私密包，不扩旁支。

本轮仅复用代码验证：本地launcher/既有请求协议14项检查通过，Check返回默认request/worker/apply均OFF。没有新增业务代码或离线云模拟，旧116源码pins保持；实际新请求和真实云部署均未执行。
