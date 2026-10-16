# W4a：平台受控请求入口与准确任务领取适配（未启用）

2026-10-16。承接 [W3 真实单任务验收](aws-auto-deployment-aurora-dual-mode-w3-executed.md)，本阶段只做平台接线、测试和真实只读检查，不再执行第二次部署，不扩展 F3c9/Grant/generation 支线。

## 已实现的主线增量

管理员实例详情页增加“已初始化租户 · 受控承载”面板，当前只支持 `app_e897a4377bce498b9c5ee9e64509dcad` / `dep_7c99bd249470184852f0dc74`。它读取 `outputs.expressInitializedWorkerRunsV2` 中与成功 job 匹配的最新回执，显示实际新栈、镜像、认证检查时间及固定到期，而不是旧顶层 stackId。损坏的新回执不会静默回退为旧成功；原 ready_at/旧任务归因不改。保存的回执**不是实时 AWS 在线检查**，TTL 到期不等于资源已删除或全部停费。

新增 `GET/POST /api/admin/instances/:instanceId/initialized-deployment`。沿用平台管理员 session 校验，POST 严格要求同源 Origin、JSON、最多 2048 字节；客户端只能给固定意图、deploymentId 和 nonce，不能指定用户、镜像、配置或凭据。管理员 ID 取自服务端 session。写入口由服务端 `AWS_INITIALIZED_REQUESTS_ENABLED` 控制，仅精确字符串 `true` 开启，默认关闭；本阶段没有修改实际环境配置。

待未来批准开启后，POST 仅在现有承载窗口到期、有匹配成功回执且没有活动任务时，用一个 SERIALIZABLE 事务登记一条**待审** reconcile job。复用现有 `deployment_jobs`，不新增表、角色、权限或独立队列。`available_at=9007199254740991` 是审核挂起标识，不是普通调度时间；普通 worker 的 DB-clock available_at 门禁无法领取它。固定 nonce/管理员/范围决定 requestId 与 jobId，重复的同一请求只回读已有 ID。插入时锁定现有归属与管理员行，并再次检查完整 outputs、成功 proof job、原 epoch/环境及无活动兄弟任务；并发序列化/提交不明不自动重试。

`express-platform-claim-v4.ts` 提供具体 Neon 适配器与纯编译/回读函数：准确完整行 CAS，锁定仍 active 的原管理员，**原地领取同一条待审 job**，attempt/max=1、数据库时钟 lease，不再 INSERT 第二条任务。运行 payload 保留原请求、管理员和范围；lease 与原子完成也要求该来源完全一致。仍复用 W2 的九行保护、W1 初始化 GET 回读语义，完成只改 deployment outputs/updated_at 和该 job。失败不接管、补齐、复位、重试或偷偷回退首次初始化。

## 验证事实与限制

- 新增 10 项测试，加相邻 W1/W2/W3 共 **33 tests 通过**；typecheck、9 文件 ESLint 和完整 `vinext build` 通过，新路由已在构建路由表中。
- 真实 Neon 只读报告：`F:/ChatGPT_workshop/techlong-platform-w4a-readonly-20261016-r3.json`，**2026-10-16T17:18:23.774Z / 12:18:23.774 CDT**。成功检查包含5个 READ ONLY 事务：真实九行/成功 job、任务列表、11条 SQL 的 EXPLAIN（没有 ANALYZE）、独立旧行和任务列表回读。
- 实际投影为 `verified_window_open`，匹配 `job_e4147af2f10faf37b51ec9a3` / 新栈 UUID `74a79560-c981-11f1-bfcc-06ffde30f30d`；canRequest=false、写入口关闭。该检查没有调用 AWS 或业务应用，因此不重新宣告实时健康。
- EXPLAIN 的管理员、未来时间、待审行、完成 proof 是**语法规划输入**，不是实际审批清单、真实队列项、有效 lease 或新认证证据。前两轮检查器误把 EXPLAIN utility command 的 rowCount 当成 SELECT，非零退出；修正结果形状判断后通过，未执行写 SQL。
- 原九行、成功 job 和整个任务列表前后摘要一致，W3 的 **76 个代码摘要不变**。测试用 JSON 仅含公开固定 material 和合成最小行，不含原 workspace 联系方式、密码、JWT、私钥或 Secret 值，也不能作为生产清单。

本轮 DB DML、AWS 调用/写入、新任务、私密包读取、Secret 值读取、应用认证请求和永久执行槽消费均 **0**。没有启用入口、全局队列、自动轮询或 Cloudflare 部署；代码提交/推送不等于网站已发布。机器摘要见 [W4a 接线记录](../ops/aws-sandbox/reviews/aurora-dual-mode-w4a-platform-entry.prepared.json)。

## 下一主线 W4b（尚未完成）

平台运行于 Cloudflare，不能直接启动本机依赖 AWS Login 和原私密包的 CLI。**W4a 尚未把待审 job 接入可运行的 Review/RunOnce/Inspect 根，不能称平台按钮已自动部署。不要对待审 job 使用原 W3 RunOnce：W3 要求新 job 不存在，会与待审行冲突。**

下一步只接一个准确 queued job 的单次 CLI：读取并绑定其完整快照、原管理员来源及 V4 实际 claim/completion 程序摘要，沿用 W3 真实 provider 和 W1/W2 内核；独立执行清单必须同时绑定 queued row 与代码/资源/固定截止时间。Run 前重新核对实际 namespace/父 Cell/容量/epoch，待原准确承载退役后才准入，不把过期时间当作已清理证明。不扫描全局队列、不创建另一条 job、不重放已消费 W3 槽。

W4b 代码就绪后，**入口激活/实际登记一条请求**与**该请求的实际云执行及私密包读取**仍按准确范围另行批准；可以集中展示范围，但不能从本阶段“继续”推导写授权。不要先开启一个尚无领取根的入口。

原 workload 固定到期 **2026-10-16 13:42:30 CDT / 18:42:30 UTC** 不变；本阶段没有续期、清理或创建监控。50 USD/月仍是目标而非硬上限，父 Cell 和初始化库保留，Full 路径及旧保护不动。
