# W4c：本地平台入口（不发布 Sites、尚未启用写入）

最新状态（2026-10-16 13:47 CDT）：用户报告忘记密码；已停止本地进程并确认3100不再监听，请求写入口关闭。服务日志只有登录401，未进入部署提交；18:47:48.813Z 的独立 Neon READ ONLY 事务确认仍仅原两条 succeeded job、held/active=0。所选管理员仍 active、有密码、未锁定、失败计数0，存在一个有效会话；未读取 hash/salt/token。401本身不能证明所输入邮箱就是所选账号，不自动把密码/邮箱不匹配解释为部署故障。尚未批准或执行密码重设，不使用会改写管理员资料/权限的 bootstrap 脚本；下一需明确确认准确账号的窄重设与会话注销范围。原本地请求登记批准不扩展成密码重设、造session或AWS执行批准。

后续状态（2026-10-16 13:45 CDT）：用户已确认本页的本地登录与单条待审请求范围，入口现仅在本机进程开启，worker/apply 仍 OFF；等待管理员手动登录和单次提交。开启前两笔 Neon 只读事务确认 active 管理员、held/active=0、两条旧成功任务及原快照摘要不变，最近保存回执已到期；没有核验或推定 AWS 已清理。健康/登录页200、监听仅127.0.0.1。见 [开启记录及继续位置](../ops/aws-sandbox/reviews/aurora-dual-mode-w4c-local-entry.activated.json)。本地入口暂留待用户操作，提交后关闭并独立只读核验；代理未代填密码/提交表单，尚无新任务 ID 或执行清单。下方保留原准备记录，“本轮未执行”指准备时点，不撤销后续这次用户确认。

2026-10-16。遵循 [当前主线](aws-auto-deployment-mainline.md)：先完成自动部署闭环，最后整套 AWS 上线。本轮只增加本地启动路径，不新增平台云承载、IAM、表或队列。

## 已有代码与本轮变化

W3 已真实证明一次 AWS 承载；[W4a](aws-auto-deployment-aurora-dual-mode-w4a-platform-entry.md) 是默认关闭的管理员待审请求入口；[W4b](aws-auto-deployment-aurora-dual-mode-w4b-platform-worker.md) 能对准确同 job Review/RunOnce/Inspect。本轮新增 `scripts/local-deployment-platform.mjs`，直接用 Node 启动，不改被既有部署证明绑定的 package.json/lock：

```powershell
Set-Location E:/NodejsProject/TechlongSoftware
node scripts/local-deployment-platform.mjs --check
node scripts/local-deployment-platform.mjs
```

Check 不读环境文件/凭据或连接数据库；Serve 仅启动本地 Vite，固定 `http://127.0.0.1:3100`、strictPort，端口占用直接退出，不切换端口。默认请求入口 OFF，worker/apply 永远 OFF；继承的同名开关不会改变这些默认值。既有 `.env.local` 由现有开发运行时读取，不修改该文件，也不新建 `.dev.vars`。存在任意 `.dev.vars*` 时直接拒绝启动，避免它覆盖开关。

本地 Worker 仅按名称声明 DB/Stripe/auth/品牌设置及三项 gate 的 Secret 绑定，不将 Secret 值放进 Vite `config.vars`、控制台或构建配置。Wrangler 按显式清单从本进程/既有 env 文件加载，进程开关优先；未声明的 AWS host credentials 不作为 Worker 绑定传入。非本地启动时不改变原托管配置。没有 Sites 发布、source upload、Secrets 更新或 sites remote push。

登录页：`http://127.0.0.1:3100/login?returnTo=%2Fadmin%2Finstances%2Fapp_e897a4377bce498b9c5ee9e64509dcad`。

## 下一次具体批准范围（本轮未执行）

批准后才允许用下列显式命令启用**本进程**请求入口，并由先前选定的现有平台管理员在本机浏览器自行登录、登记一条固定范围的待审恢复请求：

```powershell
node scripts/local-deployment-platform.mjs --enable-request-entry
```

该参数是显式操作选择，**不是授权系统，也不验证任何 SHA**；执行权限来自用户对此范围的另行确认。不要仅凭文档中的命令自行开启。它开启的是固定实例的请求入口，不是 worker，更不授权 AWS 执行。关闭/重启时不带该参数即恢复 OFF，不写永久环境设置。

范围为 `app_e897a4377bce498b9c5ee9e64509dcad` / `dep_7c99bd249470184852f0dc74`，workspace/store/epoch/镜像/配置沿用 W4 固定材料，不由浏览器指定。管理员必须自己输入现有密码，不在聊天传密码，不由脚本造 session、重设密码或读取密码 hash。正常登录可能写 `auth_sessions` 及 `user_credentials` 的登录计数/锁定状态，不应宣称整个阶段只有一条 SQL 写。

在原 W3 窗口到期且页面准入通过后，**只点击一次**“创建待审恢复请求”。服务端最多新增该请求的一行 `deployment_jobs`（pending/reconcile、attempts=0/max=1、available_at=9007199254740991）。不改旧任务、业务行、ready_at 或 initialized store，不创建 AWS 资源，不读原私密包，不连接 Aurora，不调用 Stripe。请求按钮仍有同源、管理员 session、固定 nonce 与事务 CAS；提交不明只读核对，不换 nonce/重试。完成登记后关闭该进程。

限制/风险：此开关不是账号单人隔离或永久一次性门；同机能取得 active 管理员 session 的其他进程也可能访问，不能开放 LAN/代理。API 保证有活动任务时不再创建，但操作员仍须遵守只登记一条并关闭进程。浏览器登录/业务 API 可产生 DB 活动及提供者日志，HTTP loopback 不是公网 HTTPS，不用于真实公网服务。网络/并发/提交 ACK 不明可能留下已登记行；没有自动删除、补齐、回滚或重试。Neon 免费方案也不改变既有 AWS 资源的费用，50 USD/月不是硬上限。

## 登记之后的唯一后续

保存返回的准确 job ID，停止本地写入口。对它运行 W4 Review，生成新的绑定队列行/真实 AWS 状态/代码的执行 SHA：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/run-express-platform-worker-v4.mjs --mode Review --job-id <准确jobId> --output F:/ChatGPT_workshop/techlong-platform-w4-review-<新唯一后缀>
```

Review 不批准执行；其后用户按新 SHA 批准最多一次 CreateStack、私密材料内存读取、两个认证 GET、同 job 原子完成及独立 Inspect，详见 [W4b 完整执行风险](aws-auto-deployment-aurora-dual-mode-w4b-execution-review.md)。CLI 不扫描全局队列，不创建第二条任务。准确 W3 前驱未真实退役时停止，不删除它来强行准入，不等同 TTL 自动清理，不复用 W3 已消费槽。最终回显新 job/准确栈/检查时间，不用旧 ready 宣称新部署成功。

## 本轮实际验证

- 44 项定向测试通过（新增本地入口4项 + 既有W1/W2/W3/W4相邻40项）；最终 typecheck、三文件零警告 ESLint、脚本语法检查通过，完整 `vinext build` 通过。
- 真实回环 HTTP：健康接口200/ok、登录页200且存在密码输入框、无 Cookie 的管理部署接口401/UNAUTHORIZED；未登录、未提交密码或 POST。系统监听回读仅为 `127.0.0.1:3100`，验证后已停止进程并确认该端口不再监听。
- 实际调用已安装 Wrangler 的 dev-vars 解析器，仅读取既有本地配置并脱敏断言：三项 gate 均为字符串 `false`，DATABASE_URL 是 `secret_text`，未绑定 AWS secret/session key；没有 SQL 连接/AWS调用。一次直接诊断的默认日志路径被沙箱拒绝，随后固定项目内日志路径并关闭写日志，最终诊断通过，无凭据输出。
- W4 `CheckSources` r4 通过：99项代码绑定及准确 W3 前驱/公开历史一致。开始时尝试增加 npm 快捷命令被历史代码完整性门禁拒绝（`INITIALIZATION_RECOVERY_AUDIT_CODE_CHANGED`）；已撤掉**本轮新增的两行**，保留 package.json/lock 原内容，不放宽门禁。r3 失败记录保留，r4 是新的只读核验目录，无写重试或槽复位。

本轮新增业务/任务记录、SQL写、AWS调用/写、原部署私密包/AWS Secret值API读取、应用认证GET、Sites发布及永久执行槽消费均0；本地开发运行时按现有配置在内存加载应用环境值，不等同于读取原部署私密包。没有重新查询 Neon 任务列表或 AWS 实时健康；最近 held=0 的事实仍来自 W4b 17:37:27Z 的历史只读证据，不冒充本轮新证据。

本轮验证结果和未执行项见 [准备记录](../ops/aws-sandbox/reviews/aurora-dual-mode-w4c-local-entry.prepared.json)。历史 W4a/b 的“下一步平台发布”措辞已被本地路径替代。
