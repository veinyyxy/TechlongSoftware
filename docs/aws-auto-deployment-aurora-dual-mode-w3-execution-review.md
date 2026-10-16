# W3：已初始化租户的一次真实 worker 承载验收

本文件是代码的固定风险/范围说明，不是授权。以 `Review` 实际生成、用户明确确认的完整 manifest SHA 为准；任何旧阶段批准、W1/W2 材料 SHA、Source 刷新或“开始下一步”都不执行这里的写入。

## 范围与入口

`ops/aws-sandbox/scripts/run-express-initialized-worker-v3.mjs` 只提供 `CheckRuntime`、`Review`、`RunOnce` 和 `Inspect`。没有 daemon、poll queue、全局 worker 或首次开通模式。CheckRuntime 不打开数据库、不构造 AWS 客户端；Review/Inspect 只读云/Neon，不读原私密包、不调用应用。

具体范围由集中 manifest 同时绑定 W1 材料、W2 全部九行快照/新 job、准确七资源模板/参数/请求、代码/公开历史闭包、连接端点摘要、私密来源公开指纹及本风险文件。RunOnce 必须给完整 manifest SHA，校验本地代码/来源及当前事实；过期先退出，槽位不复位、不自动刷新或重放审批。

受审 RunOnce 的最大状态变更：

- Neon：一个新的 reconcile job（attempt/max=1，领取即 running）；成功后一个原子事务仅追加准确 deployment.outputs/updated_at 并完成该新 job。旧 apply 成功任务、ready_at、instance、subscription、原配置/计划/receipt 与初始化数据库不改。最新承载 UUID 放在新 job 的 `expressInitializedWorkerRunsV2` 回执，不覆盖旧顶层 stackId；后续承载查询须使用新回执。
- AWS：Source **一次 CreateStack**，在既有 `cell-sandbox-1` 和固定同一租户名称下创建 **7 个资源**：ECS TaskDefinition、ECS Service、CloudWatch Logs LogGroup、ALB TargetGroup 与三个 ListenerRule。使用现有 CloudFormation/task 角色，不新增权限。镜像固定 C5i app manifest `0dc34eda…`，不重新构建/发布；一个 Fargate task，延续现有渲染器的规格/公开网络/固定 Secret 版本。DNS 指向现有 ALB，不改 DNS、父 Cell、Aurora、DDB authority、IAM、Secret 或 Janitor。
- 运行时回读：在承载创建/真实运行镜像及健康 target 证明后，允许**一次加载既有本地保护包**，使用 JWT/mTLS，向准确租户 `:8443/api/saas/readiness` 与 `/api/saas/control` 各一次 GET。无 POST、业务请求、付款操作、数据库 restore/migration 或直接 Aurora SQL 连接。

原包路径 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2`。沿用既有 ACL/指纹/密钥配对校验器；它会在内存读取整个 `private-material.json`，其中除 JWT/mTLS 材料外也含 Stripe 秘钥。W3 不暴露或使用 payment source，不向 Stripe 发送请求，不输出或保存私钥/密码/JWT/支付秘钥，不调用 AWS GetSecretValue；读取整包及本机/提供者日志仍有暴露风险，须明确接受后才调用。Neon 连接继续在内存使用平台现有 `.env.local` DATABASE_URL，不输出该值。

## 执行前/后检查与时间

Review 和 Run 以真实 AWS 读取核对 Source、既有角色/策略、Cell 模板/16资源/输出、固定 Secret 元数据、Aurora 元数据、ECR manifest/现有扫描、DNS、mTLS listener、既有 Janitor；强一致读取旧 DDB authority 精确记录并要求另一 namespace 缺席。缺失/未知不视为通过。无 IAM grant 或自动修复。

仅在准确旧栈 DELETE_COMPLETE/七资源删除、旧 task definition INACTIVE、同名 stack/service/task/log/target/listener 优先级无活动冲突时创建。inactive ECS 服务可作为退役痕迹保留；不删除它来消除冲突。不把过期但仍活动的资源当作可自动替换对象。

新任务领取窗口从 Review 的 preparedAt 起 **15 分钟**；新 workload 固定到期为该时刻加原环境 **7200 秒**，不因 Run/MFA/失败重置。领取 lease 由数据库时钟签发，最长 20 分钟、不超单任务 deadline。创建前事实窗口 30 秒；创建后的 provider、DDB 与认证控制观察都须在 W2 规定的新鲜窗口内才允许完成。

等待只针对本次准确新 UUID，最多60轮/每轮15秒，且受 lease/AbortSignal 截止；不轮询整个队列。每轮只读确认 lease，不自动 heartbeat。成功后读取准确 CFN 模板/参数/七资源，真实 ECS task definition 与已独立验过的修复规格一致，运行 digest、单 task、healthy target 与强一致 epoch 均需证明；bootstrap health 不等于 initialized ready。然后用 W1 两 GET 校验原 store、配置、镜像和 epoch，才走 W2 原子完成及另一只读事务回读。

## 必须接受的风险与失败边界

- AWS、Neon、磁盘 journal、HTTP 之间不是事务，不具备跨服务 CAS；检查后仍有并发漂移/网络在途竞态。角色 ID/模板/epoch 校验不能消除竞态。lease/epoch 在前后检查，并不使 CFN 自带数据库 fencing。
- 槽在尝试前永久消费，数据库 ID/dedupe 也不自动复位。认证失效、未知提交、创建/配置/回读失败可能留下 running/过期 job、部分栈或收费资源，乃至云已成功但平台尚未写回；不自动删除、补写、撤权、回滚或重试。只能 Inspect，并按新的具体范围决定后续处理。代码中无 DeleteStack/UpdateStack/权限写入口。
- 请求 **OnFailure=ROLLBACK**：这允许 CloudFormation 自身在建栈失败时回滚其刚创建的子资源，不代表本程序会补发清理或可恢复所有资源；失败/卡住仍可能收费。15分钟 CFN timeout 和有限轮询也不是保证完成时间。
- 旧 Janitor 保持启用，可按固定到期删除新 workload；代码不改其调度/权限，也不保证准时删除。父 Cell 原 tag 已过期但不续期，接受此已存在父资源下的新独立 child 窗口；父/库默认保留，不等于整体停费。
- 既有镜像扫描是最近保存的扫描结果，不是本轮重新扫描。Secret NoEcho 参数只可核对掩码，不能把掩码当值证明；实际 task definition 只读核对固定 Secret 版本引用，不取得其值。
- JWT/mTLS 私钥在本地内存使用，经 TLS 向准确应用发送凭据，应用/代理/数据库/云提供者可能记录元数据或敏感信息。认证错误不 fallback provision，不更换/创建账号或密码。
- 50 USD/月是目标，不是费用硬上限；新 Fargate、日志及共享 ALB、公网地址、Aurora/Secret 等可能计费。低成本但非零，不保证新 workload 到期即整个账号停止费用。

CheckRuntime/Review/Inspect 的结果都不是无人值守部署已验收；只有真实 Run 的新任务、承载、认证回读、原子收口及独立 Inspect 各自通过，才能报告该单租户已初始化承载路径验收。新客户首次建库/商户开通及 Full 自动化仍不在本次范围。
