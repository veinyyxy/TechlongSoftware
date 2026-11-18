# Sandbox 首开：同一平台的一次启用（离线草案）

**状态：不可执行。** 2026-11-18（温尼伯）。本轮只用本机源码、Git 对象和已存回执：[范围与候选来源索引](evidence/sandbox-first-purchase-activation.prepared.json)。没有联网取证、读取私密文件或值、构建/发布镜像、创建 Secret/回调端点、安装权限或更新平台。未开启执行窗口，执行 SHA 为 `null`。

## 固定范围

- 只更新 `ca-central-1` 的原 `techlong-sandbox-platform-hosting-v1` 和原服务 `techlong-sandbox-platform-web`，继续使用 `console.sandbox.techlong.cloud`。已存证据显示原 Web 为任务定义 revision 14 和 manifest `sha256:adaa4521…`，运行 1 个任务、控制器/普通 worker/apply 关闭。此为历史对照，不是现状证明。
- 唯一购买范围为用户已经注册的工作区（ID 仅在本机私有记录）、餐饮订餐产品、一个 `standard-v1` 套餐、`env_aws_sandbox_ca_central_1` / `cell-sandbox-1`、已登记首版 `release_00b9c5cfa6bceedc5fd05aa451dca811` 及其固定 A 镜像。**A 是将来租户首版，不是这次待发布的 Web 镜像。** 不改平台默认租户镜像，不改 D2 目录。
- 保留原域名、ALB、监听器、网络、证书、固定版本 `DATABASE_URL`、原 Web 登录、注册窄函数与 DesiredCount 1。不恢复或更改 Cell／Express，不启用普通队列、部署控制器或 apply，不领取任务。本轮以及今后的这次启用均**不提交 Checkout，不确认支付，不创建订阅、实例或任务**；由用户测试购买另审。

## 候选镜像：保留现有注册，只叠加本步所需代码

机器索引核实了 **19 个确切 Git blob**（含已上线的两份注册源码），每份有来源 commit、blob ID 与原始字节 SHA-256。以同一个实际基底 `5fcbc23c…` 重建；加入购买 Web/API/Node 接线、一个既有首开合同及其类型依赖，并取已通过的两处普通领取排除规则（仅使用 `a8b57b3…`，不顺带复制后来修改的 heartbeat）。不把整个 `main`、后续 Worker、D2 模块、SQL 安装草稿、测试数据或证书/密钥打进运行镜像；依赖锁不换。

合成来源摘要 `258c77666a802b08f3052f1082c279104ee45c9f643e174089f9e630110c1e9c` **不是执行批准或镜像摘要**。本轮重建并本机构建了具体 19 文件归档，Git 树为 `33c035176b7a2decc4e595ac61c6ce888872d57f`；5 项接线/原发布合同回归通过。仅在本机 loopback 用合成配置启动这个编译产物，禁用外部 fetch，实际回调路由通过四项合成检查后关闭。以上不等于 GitHub 容器镜像、扫描或 registry 证据。默认候选工作流归档整个 HEAD，不用于此候选；已为[同一个手动无 AWS 工作流](../.github/workflows/sandbox-registration-candidate-v1.yml)增加固定的 19 文件入口，旧两文件配方仍重建原树。旧发布入口继续只接受旧的已固定原产物，**本轮不改发布工作流、审批门禁、IAM 或旧槽**。

<a id="sandbox-first-purchase-build-dispatch-review"></a>

### 下一步仅审批单次候选构建

- `veinyyxy/TechlongSoftware` 的 `sandbox-registration-candidate-v1.yml`，只对 `main` 调度一次 `workflow_dispatch`，输入仅上述 `recipe_sha` 和审批时确认的完整 `orchestration_sha`。先核对远端 head、工作流字节与本机已审版本，任何差异则不调度；只接受原尝试 1、同仓库和同一 run。没有 GitHub environment 或 OIDC，不改变设置。
- 单 job 最多 25 分钟：构建一份 Linux/amd64 Web 镜像，非 root、只读且禁网自检。包含匿名注册表单和四个合成回调：正确签名但不属于本订单、真实模式、错误签名、带查询串的路径。合成凭据只在容器内使用，不接触实际 Stripe/Neon 或购买。通过新鲜 HIGH/CRITICAL OS 扫描后，仅在 GitHub 保留名为 `sandbox-first-purchase-overlay-258c7766-<runId>` 的一份候选产物，保留 3 天。只封存源码树、档案/配置和扫描摘要，不推 ECR。
- 批准范围可同时覆盖本次同一 run 的认证 GitHub GET 最多 40 次（调度前确认 2、定位 4、观察 29、job/去敏日志/产物元数据 5），候选档案不得下载。只使用既有 GitHub 身份、仅在内存处理认证；调度 ACK 不明只按准确输入定位原 run，不再次 POST、不 Re-run。GitHub 运行与存储有潜在费用。其他 GitHub 读取、AWS、Stripe、Neon 及实际启用不在此范围。

## 集中启用顺序与拟议上限

以下是在候选镜像与必要现况证据齐全后，可集中审批的**同一次启用**。相互依赖的 ARN/版本由本轮唯一成功回执派生，不填猜测值。次数均指顶层提交，不包括托管服务的内部调用。

| 顺序 | 拟议动作与目标 | 放行或停止条件 |
| --- | --- | --- |
| 1. 发布 Web 镜像 | 原 ECR `techlong-sandbox-platform-web`，一个新不可变 tag 和一个候选。沿用原发布角色、原发布栈的临时 Grant → 一次 GitHub 调度/顶层 push → 立即 Revoke；Grant 与 Revoke 各至多一次。 | 用户本人批准准确 `techlong-sandbox-deploy` run；成败均进入原撤权流程。须经独立读取证明原角色 Locked、原镜像保留、新 manifest 字节与封存 config 相符才继续。不复用注册发布的 artifact、SHA 或审批。 |
| 2. 安装数据库窄入口 | 原 sandbox Neon，候选为一次 DDL 修改事务：一独立 webhook LOGIN、一 NOLOGIN definer、一专用 schema、五个函数。Web 仅可 `reserve/attach/read_order`；回调身份仅可 `webhook_order/complete`。 | 先确认非超级用户创建/转授权/归属可行，核对 SQL 实际差异及 `search_path` 依赖（受保护的 `public` 和已批准既有触发器）。独立只读回读函数/角色及授权，验证两身份均无新增业务表直接写权，Web 不能确认付款。若任何临时 SET、残留 ADMIN、继承或角色转授范围无法明确约束，停止，不直接应用本地 DDL。安装与回读不调用这些函数。 |
| 3. 准备 Stripe 测试入口及固定 Secret | 原控制台准确回调 `https://console.sandbox.techlong.cloud/api/stripe/webhook`。仅已确认测试账户和测试密钥；拟复用唯一匹配的测试端点，若无则最多新建 1 个，仅两种 Checkout 成功事件。另拟创建 1 个 Secret `techlong/sandbox/platform-web/first-purchase-v1`，三字段：测试 API key、该端点签名 secret、同 Web Neon host/database 的专用 webhook DSN（`sslmode=verify-full`）。若准确范围要求资源保护策略，拟仅对这一新 Secret 应用 1 次。 | 原 Web 数据库 secret 不更新、不读正文；不使用生产 Stripe 或其他项目密钥。只通过受审私密渠道供值；不在 Git、日志、命令行或明文 CFN 参数里保存。只有成功回执及元数据证明同一新 ARN/固定 VersionId 才继续。已有同名资源、冲突端点、需新 KMS key 或扩大 key policy 时停止待审，不擅自替换。 |
| 4. 原 Access 栈窄接线 | 原 `techlong-sandbox-platform-access-v1`：最多创建及执行同一个 Change Set 各一次。只对原角色的 inline `ExecutionOnly` 和原 boundary 追加准确新 Secret 的读取；如确需现有 KMS 转发解密，限准确 key/Secrets Manager 服务与新 Secret 加密上下文。 | 不新增 IAM 角色或 TaskRole、不改 trust/附件，不改其他资源的行为。先检查 Change Set 恰为原 Role / ManagedPolicy 两处 Modify、无替换，且原 Web 正常权限保留。Secret 的版本钉在 ECS 引用中，不把 IAM 对 ARN 的约束当成版本约束。 |
| 5. 原 Hosting 栈更新一次 | 最多创建及执行同一个 Change Set 各一次。用新 Web registry digest；只给原容器增加五项专用运行绑定（开关、唯一 workspace、套餐、首版 release、首版 A 镜像）及新 Secret 的三个固定版本字段引用。 | 只允许 `TaskDefinition Modify/Replacement=True` 与 `Service Modify/Replacement=False`，后者只变任务定义引用。其余物理归属、网络、运行资源、原 DB 引用和关闭开关不变。变更前后证据不匹配即停，不直接 UpdateService，不另开栈。 |

启用后的独立验收只核对原栈成功、原服务任务 (1/1/0) 且实际 digest、健康目标、HTTPS 域名、三个固定引用与关闭状态匹配，再用限定匿名 GET 核对健康页和注册表单；另核对 Stripe 测试端点和数据库 ACL 元数据，不读取值。此验收证明技术配置已接线，**不证明付款、回调业务写入或首开已经成功**。

风险：这是跨 GitHub、Stripe、Neon 和 AWS 的分段操作，不存在跨服务原子性；失败可能遗留发布镜像、数据库角色/函数、测试端点、新 Secret 或已装的窄读取权限。服务滚动可能短暂不可用；原 Fargate/ALB 等费用保持，新 Secret、ECR 存储和请求可能另有费用，50 USD/月不是硬限制。保留托管回滚，不发第二次部署、不自动重试、删除、撤销数据库权限或清理；**唯一例外为发布临时 Grant 的立即 Revoke**。未知提交须保留原意图/ACK，另批限定回读，不以回执缺失结论为“没发生”。

## 需要另批的最小补齐

1. **候选来源与产物。** [单次无 AWS 构建范围](#sandbox-first-purchase-build-dispatch-review)已备。未经批准不调度、不下载完整产物；真实候选的源码、扫描和 artifact 未核验前不进入实际启用。Registry manifest 只能在实际发布后独立派生，当前不预填。
2. **一次集中限定只读。** 拟限 Source STS 1 次、AWS 元数据 41 次（原 Hosting/Access/发布栈 12，原 ECS 4，ALB 3，两原角色及 boundary 12，固定旧 DB Secret/新 Secret 名占用及 KMS 5，Web ECR 及 A digest 4，原 OIDC 1），确切 GitHub run/artifact/本人门禁 GET 最多 12 次。Neon 拟限一条验证 TLS 的只读连接、最多 16 条 SQL（含事务控制），仅核对准确 workspace/Owner、餐饮套餐和模板/正价及币种、空订单/订阅/实例/任务、A 未撤销、环境 `admission_state=open / apply_enabled=0`、窄函数角色和实际约束/触发器依赖。不查其他区域/资源或业务正文，不读邮箱、口令、Secret 值或完整镜像产物；确切认证路径、调用上限和去敏输出随读取许可一次确认。Stripe 仅需测试账户、精准端点及事件类型的证明，不从旧密钥推定账户。
3. **只出一份实际启用审批。** 上述真实值、未使用的新槽和独立验收上限齐全后才定执行 SHA。快照按真实观测五小时有效，旧期限不续；按原发布截止与撤权预留反推开窗，不先部署等材料。当前套餐 ID、端点/Secret 实际身份、安装者有效权限及执行窗口均未绑定。

**当前无需用户操作注册或购买。** 任何线上读取、构建调度、秘密供给和实际启用都不因本草案获得授权。购买及首开仍排在启用验收之后另审。
