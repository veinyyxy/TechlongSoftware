# W4c：真实平台请求到 AWS 的受控单次闭环已完成

Winnipeg 2026-10-16。用户明确批准 SHA `aad135499b74f8b93fe3f0204dc70a81bfe5ec7aec4e38b0afe5c5148a0add34` 及完整风险后，在有效窗口内对既有 held job **`job_fe5ced28b698d0bf128e7b42`** 单次执行。不是新任务、不是首次初始化、不是重放旧失败命令。

## 实际结果

- **23:41:39.598 CDT / 2026-10-17T04:41:39.598Z**：RunOnce返回 `NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED`。原地领取同job（attempts=1），最终succeeded/lease清除；保留原ready_at、业务九行中不允许变化的字段、原两条成功任务、初始化库/default store及管理员请求来源。
- **23:41:59.308 CDT**：新进程Inspect返回 `SAME_PLATFORM_JOB_SUCCEEDED_OLD_ROWS_PRESERVED` + `EXACT_WORKLOAD_PROVED`。不是只凭CreateStack ACK或旧ready判断成功；准确UUID/七资源、task definition:5、实际镜像、RUNNING/HEALTHY和健康目标均核实。
- 另于 **23:42:53.466 CDT** 只读核对管理页投影，latest是本次新job/新栈，不是旧W3；总job=3、活动job=0、lease清除、请求gate/全局队列均OFF。原W3完整job摘要仍为 `fb3c83e5f17537f3aab7d014ab15d42ef09b9224f74fc6c0ff4de1ecb3d0b3ba`。该投影是保存的认证回执，不是持续实时AWS监控。

准确新承载：

- Stack：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/aa962890-c9e4-11f1-988b-06ffcd51c63d`
- Task definition：`tenant-9c5ee9e64509dcad-task-definition:5`；task末段 `12433b1649c04f0e98506da52561b4d3`。
- App镜像：`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`。
- 原子程序SHA `5a305b42d0da2bf4edb0cd473d21ad793876b825f7546a59cebb72b62e3fc19b`；完成receipt SHA `d350a38748a2d1fe70c2e2dfc2768534c53aedc07a44994b571963a500da6bdb`。

## 实际副作用与未做事项

Source CreateStack **1次**，CloudFormation创建7项承载子资源（日志组、task definition、ECS service、target group和3条listener rule），没有新Cell。Neon写事务2个：准确同job领取、原子更新deployment outputs/updated_at及同job完成，**新job INSERT=0**。W4 reader计数4个只读事务，另有复用W2的lease/原子完成内部只读检查，不能把reader计数误报成全部数据库事务。

原私密包只加载1次，含本次不用的Stripe私密材料仍可能整体进入内存；未提交包/密码/JWT/私钥。仅 readiness/control 两次固定JWT/mTLS GET，核实初始化/default store/配置/镜像；无初始化POST/商户密码设置/直接Aurora连接/Source GetSecretValue。应用GET可能在租户服务内部读取数据库，不声称底层绝无DB活动。IAM/DNS/DDB authority/Secret直接写入0，不安装新权限、不重建baseline、不发送Stripe交易。

Run读计数86 SDK/27 CLI，独立Inspect7 SDK/1 CLI；等待期间另有一次准确新栈ListStackResources只读进度查询。独立Inspect及管理页投影各2个只读事务，不读原私密包/调用租户应用或写资源。运行代码沿用上一阶段通过的42项相邻测试/typecheck/lint，未为文档更新重跑离线云模拟或宣称新的网页发布。

五项W4永久槽 `run / claim_job / create_workload / private_control_load / atomic_complete` 全部已消费，目录：

`F:/ChatGPT_workshop/techlong-platform-w4-permanent-slots-v1/4f5eb21905f0d410241d7314df370afcf332bda01a724b4b4148bcbf6cddbdcc/`

不得清空、复位、换目录/nonce、重新领取或重放本次RunOnce。此前Source过期的run-r1/inspect-r1及原W3槽/历史仍保留。本次实际原件在run-r2/inspect-r2；[执行记录](../ops/aws-sandbox/reviews/aurora-dual-mode-w4c-platform-request.executed.json)保存13份原件/槽文件raw SHA及准确状态。

## 窗口与当前展示

新承载固定到期 **10月17日01:35:34 CDT / 06:35:34Z**，不会因为成功、重启或本地页面续期。已有Janitor不保证准时清理；父Cell和初始化库保留，50 USD/月是目标、不是硬cap或绝对停费保证。本轮没有安排新的监控、续期或删除授权。

本机结果展示服务仅 `http://127.0.0.1:3100`，默认启动，**request/worker/apply均OFF**；可刷新原实例页查看本次回执，不再次登记请求。本地展示不等于平台已迁AWS，也不发布Sites。

## 唯一下一主线

本阶段证明了“本地管理员真实请求 → 精确同job单次worker → AWS新承载 → 两认证GET → 同job原子完成 → 独立Inspect → 管理页保存结果”的**受控闭环**，还不是云端无人值守系统。

下一仅准备单次执行器云化及受控材料迁移：去掉本机AWS Login、F盘私密包和本机CLI依赖，保留明确批准、单次执行、可追溯失败状态，再按具体IAM/Secret/运行环境资源范围另审安装。暂不迁整套平台，不重启F3c9/Grant/generation支线、不重做密码恢复或重复验收。

当前W4根仍固定只支持原W3前驱:4/74a的首次受控恢复；本次成功后**不能**把下一条请求再套进这个固定前驱的根，也不能把新:5/aa96擅自改成配置来绕过审阅。后续沿革支持须作为主线受审代码增量，与云化一起准备，而不是换nonce/重置槽。整套平台/API/执行器/最终数据库的AWS上线按[主线计划](aws-auto-deployment-mainline.md)排在部署执行自动化之后。
