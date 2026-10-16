# W2：已初始化租户的单任务、有效 lease 与原子收口

2026-10-16 Winnipeg。承接 [W1](aws-auto-deployment-aurora-dual-mode-w1-worker-path.md)，本阶段完成单任务编排与**真实 Neon 持久化适配器**，不重启首次初始化、Grant/generation 或成本支线。**这是代码里程碑；没有创建任务、取得真实新 lease、部署资源或启用无人值守 worker。**

## 实现结果

- `lib/deployments/execution/express-initialized-job-v2.ts`：从 W1 修复镜像材料、准确 active epoch 和九行只读快照编译新任务计划及 SQL。限现有已初始化/ready 租户、当前修复 digest 的承载恢复/核验，不是任意版本发布或新客户开通入口。旧成功 apply job 必须保留，新的 reconcile job 按 request ID 确定独立 ID/dedupe；现有历史输出与 ready 归因不替换。
- `express-initialized-job-neon-v2.ts`：直接使用已安装 Neon HTTP SDK。惰性构造，TLS、固定 SQL 和参数；没有 env/Secret/私密包加载器。提供只读快照、一次 claim、只读 live-lease 检查、原子完成及**另一个 READ ONLY 事务**回读；不是借用写事务返回值证明成功，也不声称换了数据库身份。
- `express-initialized-job-runner-v2.ts`：单次 `claim → lease → 承载接口 → lease → W1 GET-only initialized/config 回读 → 原子完成及独立回读`。仅注入 W1 只读接口，不提供 provision、密码、数据库 restore/migration、heartbeat、retry、cleanup 或全局队列能力。进程内并发调用也只能进入一次 claim；跨进程由数据库固定 ID/dedupe、活动兄弟任务检查及既有唯一索引约束。

领取事务先比较并锁定 deployment、instance、workspace、subscription、environment、template version、旧 job、resource、operation **九个完整原行**。全行比较保留未预先枚举的历史字段。新任务直接 running，attempt/max 均 1，不扫描/认领旧队列，不 upsert、不接管过期 lease。领取窗口 15 分钟，lease 最多 20 分钟且不超过单任务 deadline；准入和到期均使用数据库时钟，不靠调用方提交一个“未来 lease”。没有自动续期。

完成事务重新锁定原九行与准确新 lease，要求 provider/外部 authority/认证 control 三类观察各不超过 30 秒、配置/修复镜像/原 store/epoch 一致、准确派生栈名及完整 UUID、workload 尚未到期；数据库再次检验时间。只做两行更新：

1. deployment 的 `outputs` 与 `updated_at`：在 `expressInitializedWorkerRunsV2[jobId]` 追加引用型回执，原 outputs 全部保留。不修改 ready/status/ready_at、artifact、plan 或初始化归因。
2. **新 job** running → succeeded 并清空 lease。不改旧 job、instance、订阅、资源或 epoch。

回执采用字段白名单，不复制 provider 的额外字段，不保存 lease token。输出超过既有 32 KiB 限制即拒绝。丢 lease、漂移、未初始化、HTTP/DB/provider 错误、超时、事务/回读结果不确定都停止并要求只读 inspect，不 fallback 初始化，不自动补写、回滚、重试或删资源；可能留下 running job 直至过期，不能把这种情况称为已成功。

## 验证：用了真实控制面，但没有执行写 SQL

11 项新增测试 + 7 项 W1 + 3 项默认 runtime，共 **21 项通过**；typecheck、五文件 ESLint 零警告通过。测试覆盖新旧任务隔离、DB-clock SQL、漂移/旧 lease 拒绝、原子两行范围、历史回执保留、额外字段拒绝、顺序/并发以及 provider/commit 不确定时不重试。单元端口只验证控制流，**不是线上承载或认证证据**。

`ops/aws-sandbox/scripts/check-express-initialized-job-v2.mjs --check-readonly` 没有 Run/write 模式。最后一轮于 **15:05:29.954 UTC / 10:05:29.954 CDT** 完成两个真实 Neon READ ONLY 事务：

- 查询现有九行并本地成功编译新候选；确认 deployment=ready、旧 job=succeeded、instance=active、resource=verified、epoch=1。材料 SHA 仍为 W1 的 `8fa2b5c1cfe441ca6c95771046209e03c8ced91b8cdf0e7948c1c44c55da0313`。
- 对三项 claim SQL 与两项 lease-check SQL执行五次 `EXPLAIN (FORMAT JSON)`，**不带 ANALYZE**，仅规划，不执行被规划的 INSERT。完成更新的 SQL 只做了编译/范围测试，本次未在线执行或证明写事务/触发器运行成功。

检查使用平台现有 `.env.local` 的控制面 `DATABASE_URL` 在内存连接 Neon，不输出该值；“Secret 值读取 0”指未调用 AWS GetSecretValue，不表示没有使用既有控制面连接凭据。未读取原私密包、首位 owner 密码或 mTLS 私钥。

开发中另有两次 sandbox 网络失败；获准网络后，一次快照因本地 identity 缺 schemaVersion 被编译器拒绝，两次 EXPLAIN 请求因本地错误使用 affected-row count 校验而未被接受。字段及结果校验已修正，最后一次完整通过。共发送四次实际快照读取与三次 READ ONLY EXPLAIN 事务请求，**全程没有写模式**；最终原件的“2 transactions”仅指最后成功一轮，不代表整阶段总量。没有重试任何 AWS/数据库写入。

[机器可读摘要与代码/原件 hash](../ops/aws-sandbox/reviews/aurora-dual-mode-w2-single-job.implemented.json)保存脱敏证据；完整业务行、连接串、候选中的临时 lease token、私密材料均未输出或发布。候选编译不是部署批准，不能用本阶段材料 SHA 或检查脚本开启执行。

## 下一步 W3：接真实 provider 与可运行的单次入口

剩余关键工作只沿主线推进：把 W1 真实渲染器、现有 AWS SDK/所有权与 DDB epoch 检查、W2 新 lease/结果持久化及既有真实 mTLS/JWT transport 接到一个**非轮询、非全局队列**的 CLI 根；核对现有命名空间，绑定准确模板/资源/动作与私密来源，再生成集中待审部署范围。接口不能替代真实 provider 准入，任意注入成功端口不是上线证明；本阶段 `runtimeEnabled` 仍 false。

创建新 job/平台写、认证请求的私密来源读取、实际 AWS 写及新权限仍按 fresh 具体范围确认。本阶段没有可供直接批准部署的执行 SHA，不要求现在刷新 AWS 身份。默认保留已初始化 Aurora 库和全部旧记录，不能走旧 first-claim/POST 或重放 K2/K3 历史命令。Full 路径、旧常量/代码和全局 disabled 安全门不改。

当前承载的原固定 **2026-10-16 10:37:01.033 CDT / 15:37:01.033 UTC** 到期不变；本轮未到期，不重复盘点 AWS、不新增监控或删除。后续用户触发且已过期时只读确认准确承载事实，不假定 Janitor 已清理，也不把数据库/父 Cell 保留说成全停费。50 USD/月仍为目标而非硬 cap。
