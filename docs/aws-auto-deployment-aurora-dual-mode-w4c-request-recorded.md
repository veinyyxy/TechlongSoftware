# W4c 真实待审任务已登记：等待单次 AWS 执行批准

Winnipeg 2026-10-16 23:20 CDT。管理员已在本地页面自行登录并仅提交一次 POST，服务返回201；截图与独立 Neon READ ONLY 回读均证明准确 job 为 `job_fe5ced28b698d0bf128e7b42`。**本地入口已停止、3100不再监听；没有自动运行 worker 或创建云资源。** 不要再次点击、重设 nonce 或创建第二条任务。

## 已登记的事实

固定 deployment `dep_7c99bd249470184852f0dc74`、原管理员 `usr_4dcd0a09821fde2bb1801f58`（active/admin）、requestId `4f5eb21905f0d410241d7314df370afcf332bda01a724b4b4148bcbf6cddbdcc`。任务为 reconcile/pending，attempts=0、max=1、available_at=9007199254740991，无 lease，payload仍为 `cloudExecutionAuthorized=false`。队列共3条，另外两条原成功任务及原九行保持；界面中的“已完成”是旧W3任务，不是新部署。

独立回读 **2026-10-17T04:20:53.701Z / 23:20:53.701 CDT（10月16日）** 确认准确 queued row SHA `ccf6f1a5808223dc21cce8c604750a6324b4d35cb12ac7efeef7c86c957ed3b6`，原 snapshot SHA `6db433f3ddcf42735772879c5b36e3786d88a68e2716947a2bb62b893809d633`。原W3成功job完整摘要与原两任务同一SQL投影摘要均匹配历史，未改业务/ready/store/库。

## 只读 Review 与待批范围

实际 Review r2 为 `READY_FOR_EXACT_QUEUED_JOB_APPROVAL_NO_WRITES`，清单：

`F:/ChatGPT_workshop/techlong-platform-w4-review-20261016-r2/manifest.json`

**执行清单 SHA：`b286086082c7754ef5a0c4e331a92409e3a22824f0d912ffd332e42ce714cc20`**

准入截止 **今天10月16日23:34:55.088 CDT / 2026-10-17T04:34:55.088Z**；新承载固定到期 **10月17日01:19:55 CDT / 06:19:55Z**，不因批准或中断续期。过期只读重审**同一条 held job**，不自动执行或制造另一任务。

AWS只读核验通过：准确W3前驱 `74a79560-c981-11f1-bfcc-06ffde30f30d` 已退役、:4注销、七资源删除，namespace/容量/监听优先级为空；父Cell、IAM、authority、固定Secret版本元数据、DNS/数据库与两镜像满足准入。Review记录38次SDK读及13条CLI只读命令，无写、Secret值/API/应用认证请求或原私密包读取。数据库的待审状态独立再次核对通过；它不是持久的AWS资源锁，执行时仍会重新核对。

批准只针对：准确同job原地领取一次（不INSERT第二条job），最多一次Source CreateStack建立7个承载子资源（0.5vCPU/1GiB），一次原私密包内存读取，仅两个固定JWT/mTLS GET，最后原子追加该deployment回执并完成同job，以及独立只读Inspect。五项每request永久槽尚未创建/消费。无IAM/DNS/DDB authority/Secret写、无直接Aurora连接、无初始化POST/密码设置或全局队列。

接受的[完整执行风险](aws-auto-deployment-aurora-dual-mode-w4b-execution-review.md)仍适用：跨服务非原子、并发/传播/凭据刷新失效、ACK不明与收费残留；私密包包含本次不用的Stripe密钥且可能整体进入内存；CloudFormation自身OnFailure=ROLLBACK可能删除部分新子资源；不自动补齐、重试、接管、延租或补偿。Janitor不保证准时删除，父Cell/库保留，50 USD/月不是硬cap或绝对停费保证。未有此次新SHA批准前，不运行RunOnce。

## 读时间基准修正（不扩展资源或权限）

首次Review r1在AWS调用前被 `PLATFORM_W4_STALE_QUEUE_READ` 拒绝：数据库时间比本机快约0.4秒，旧W4将不同机器的wall clock直接相减。现在W4在**两个只读事务开始前**记录本机时间，结束及准入处仍严格检查30秒，不在读完后刷新起点；DB时间另留诊断。W2数据库时钟lease/CAS、W1/W3旧76项代码、实际SQL及窗口均未改，没有加入未来时间容忍或放宽写门禁。2项新增测试覆盖双向偏差、旧读不可续鲜、长读/本机倒退/损坏时间拒绝；共42项相邻测试、typecheck、定向零警告ESLint和脚本语法通过。CLI-only改变，不重复宣称新的网页构建或发布。

初次独立核验脚本还混用JSONB数字与原直接查询的bigint字符串，导致任务列表投影摘要不同；按原SQL精确重读后完整匹配历史，不是DB漂移。原r1失败记录保留。本阶段11个Neon READ ONLY事务；代理SQL/AWS写、私密读取、执行槽消费均0。实际新任务INSERT由用户已批准的页面操作产生；正常登录写不计入“仅一条请求记录”。没有Sites发布或新generation/IAM支线。

机器状态及原件摘要见 [记录](../ops/aws-sandbox/reviews/aurora-dual-mode-w4c-platform-request.recorded.json)。唯一下一步是此SHA的准确执行批准；不要重开密码恢复或本地请求入口。
