# Sandbox 首开：同一平台的一次启用（离线草案）

**状态：单请求已确认运行密钥返回的账户编号不同，等待用户核对，启用不可执行。** 2026-11-18（温尼伯）。[集中草案](#sandbox-first-purchase-consolidated-preparation)已绑定替代产物和原栈模板；[两项离线前置](#sandbox-first-purchase-offline-prerequisites-observed)已有准确 CI。[账户编号对照文件只存本机](#sandbox-first-purchase-stripe-account-diagnostic)，未覆盖原文件、不自动重试。未发布镜像、安装权限、创建 Secret/回调端点或更新平台。[原离线范围与候选来源索引](evidence/sandbox-first-purchase-activation.prepared.json)保留不改。

## 固定范围

- 只更新 `ca-central-1` 的原 `techlong-sandbox-platform-hosting-v1` 和原服务 `techlong-sandbox-platform-web`，继续使用 `console.sandbox.techlong.cloud`。已存证据显示原 Web 为任务定义 revision 14 和 manifest `sha256:adaa4521…`，运行 1 个任务、控制器/普通 worker/apply 关闭。此为历史对照，不是现状证明。
- 唯一购买范围为用户已经注册的工作区（ID 仅在本机私有记录）、餐饮订餐产品、一个 `standard-v1` 套餐、`env_aws_sandbox_ca_central_1` / `cell-sandbox-1`、已登记首版 `release_00b9c5cfa6bceedc5fd05aa451dca811` 及其固定 A 镜像。**A 是将来租户首版，不是这次待发布的 Web 镜像。** 不改平台默认租户镜像，不改 D2 目录。
- 保留原域名、ALB、监听器、网络、证书、固定版本 `DATABASE_URL`、原 Web 登录、注册窄函数与 DesiredCount 1。不恢复或更改 Cell／Express，不启用普通队列、部署控制器或 apply，不领取任务。本轮以及今后的这次启用均**不提交 Checkout，不确认支付，不创建订阅、实例或任务**；由用户测试购买另审。

## 候选镜像：保留现有注册，只叠加本步所需代码

机器索引核实了 **19 个确切 Git blob**（含已上线的两份注册源码），每份有来源 commit、blob ID 与原始字节 SHA-256。以同一个实际基底 `5fcbc23c…` 重建；加入购买 Web/API/Node 接线、一个既有首开合同及其类型依赖，并取已通过的两处普通领取排除规则（仅使用 `a8b57b3…`，不顺带复制后来修改的 heartbeat）。不把整个 `main`、后续 Worker、D2 模块、SQL 安装草稿、测试数据或证书/密钥打进运行镜像；依赖锁不换。

合成来源摘要 `258c77666a802b08f3052f1082c279104ee45c9f643e174089f9e630110c1e9c` **不是执行批准或镜像摘要**。本轮重建并本机构建了具体 19 文件归档，Git 树为 `33c035176b7a2decc4e595ac61c6ce888872d57f`；5 项接线/原发布合同回归通过。仅在本机 loopback 用合成配置启动这个编译产物，禁用外部 fetch，实际回调路由通过四项合成检查后关闭。以上不等于 GitHub 容器镜像、扫描或 registry 证据。默认候选工作流归档整个 HEAD，不用于此候选；已为[同一个手动无 AWS 工作流](../.github/workflows/sandbox-registration-candidate-v1.yml)增加固定的 19 文件入口，旧两文件配方仍重建原树。旧发布入口继续只接受旧的已固定原产物，**本轮不改发布工作流、审批门禁、IAM 或旧槽**。

<a id="sandbox-first-purchase-build-dispatch-review"></a>

### 已执行的单次候选构建范围（不重放）

- `veinyyxy/TechlongSoftware` 的 `sandbox-registration-candidate-v1.yml`，只对 `main` 调度一次 `workflow_dispatch`，输入仅上述 `recipe_sha` 和审批时确认的完整 `orchestration_sha`。先核对远端 head、工作流字节与本机已审版本，任何差异则不调度；只接受原尝试 1、同仓库和同一 run。没有 GitHub environment 或 OIDC，不改变设置。
- 单 job 最多 25 分钟：构建一份 Linux/amd64 Web 镜像，非 root、只读且禁网自检。包含匿名注册表单和四个合成回调：正确签名但不属于本订单、真实模式、错误签名、带查询串的路径。合成凭据只在容器内使用，不接触实际 Stripe/Neon 或购买。通过新鲜 HIGH/CRITICAL OS 扫描后，仅在 GitHub 保留名为 `sandbox-first-purchase-overlay-258c7766-<runId>` 的一份候选产物，保留 3 天。只封存源码树、档案/配置和扫描摘要，不推 ECR。
- 批准范围可同时覆盖本次同一 run 的认证 GitHub GET 最多 40 次（调度前确认 2、定位 4、观察 29、job/去敏日志/产物元数据 5），候选档案不得下载。只使用既有 GitHub 身份、仅在内存处理认证；调度 ACK 不明只按准确输入定位原 run，不再次 POST、不 Re-run。GitHub 运行与存储有潜在费用。其他 GitHub 读取、AWS、Stripe、Neon 及实际启用不在此范围。

<a id="sandbox-first-purchase-candidate-observed"></a>

### 无 AWS 候选构建已完成

[run 44364821939](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44364821939) 原尝试 1 成功。远端 `main` 与工作流字节匹配后只提交 1 次调度；首次读回在本机运行字段门槛停止，之后用同一 ACK 下的剩余只读额度核对并续观，未再次提交或 Re-run。源码树 `33c035176b7a2decc4e595ac61c6ce888872d57f`、非 root 禁网、注册页、四项合成回调和新鲜 OS 扫描均与精确 job 的封印一致。

封存产物 **`14454594785`**，到期 **2026-11-21 12:01:48（温尼伯 CST）**。[去敏回执](evidence/sandbox-first-purchase-candidate.observed.json)核对准确 job 日志与原 artifact 元数据；没有读取候选包本体，未发布，不存在本候选的 ECR manifest digest。实际 GitHub GET **11** 次、调度 **1** 次，AWS／Neon／Stripe／购买均为 0。

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

1. **候选来源与产物已核验。** 只复用[替代构建回执](#sandbox-first-purchase-replacement-observed)，不重新调度或重复取日志。Registry manifest 只能在实际发布后独立派生，当前不预填。
2. **集中限定只读和替代构建已完成，不重复盘点或重跑。** 套餐编号合同保持准确工作区、套餐、A 及测试模式绑定；只使用[替代候选的封存结果](#sandbox-first-purchase-replacement-observed)，不能发布旧候选或改套餐编号来绕过。
3. **实际启用仍只出一份审批。** [单产物发布接线与非超级用户安装回归已完成](#sandbox-first-purchase-offline-prerequisites-observed)。[Stripe 第一次限定只读](#sandbox-first-purchase-stripe-readonly-stopped)在运行密钥和预填账户匹配处停止；实际再读取仍须新批准。快照按真实观测五小时有效，旧期限不续；按准确发布限时与撤权预留反推开窗，不先部署等材料。隔离回归不等于已在实际 Neon 安装，也不等于放开购买。

<a id="sandbox-first-purchase-readonly-observed"></a>

### 限定只读核对结果（2026-11-18，温尼伯）

- **AWS 通过：** 原平台 task definition revision 14，ECS 期望/运行/待启动为 `1/1/0`，ALB 目标健康；原发布角色仍 Locked，旧 Web Secret 固定版本元数据和 A 的 ECR manifest 匹配，拟用新 Secret 名未占用。实际 STS **1**、元数据 **41**。从 `18:06:18.005Z` 开始观测，五小时准备窗口最迟至当天 **17:06:18.005 CST**，不因修复、构建或写文档延期。
- **GitHub 通过：** `techlong-sandbox-deploy` 仅 `main`，本人审批门禁保留，不允许管理员绕过；既有发布工作流与固定复用版本匹配，无活动发布，`14454594785` 的元数据未变。旧发布入口仍不接受本候选。第一次在本地编码出错，未调用 API；随后使用原未用额度完成 **12 次 GET**，无调度、下载包或重读封印日志。
- **Neon：** 读配置 **1** 次、验证 TLS 的只读连接 **1** 条、SQL **15** 条（含事务控制），只读提交成功。准确工作区及唯一普通 Owner 存在，无该产品订单、订阅、实例或任务；A、准入打开且 apply 关闭、原 Web 无新增直接写表权限和安装者的所需授权选项检查通过。仅有 **1 个**符合套餐与模板条件的正价月付套餐。阻断是[创建套餐](../lib/admin/management.ts)使用 `randomId("pln")`，而[候选运行校验及 DDL 共用合同](../lib/purchases/sandbox-first-purchase-config.ts)只接受 `plan_`。用保存的投影离线调用真实校验器确认此套餐被拒，不是套餐缺失、重复或价格无效。未改业务记录。
- 私有回执保存在本机忽略目录，原始字节 SHA-256：AWS `25b1f420ce665f418260a99f8d4951c296d53b6a0a3032c0936f437fc4eaa1d8`，GitHub `9c716a93ef7478574f56d1cfc40c9cc28bf478b386d8c4fdbf1f9ff5b7a31633`，Neon `29547bda541a9acdfab0ef4a5c3b51725c0c9e7a3af856a2bd6c8a77d4d278e0`。不提交工作区/套餐实际投影或认证材料；未读 Secret 值，未访问 Stripe、发布、安装、更新平台、恢复资源或购买。

<a id="sandbox-first-purchase-plan-id-fix"></a>

### 套餐编号修复及 CI（2026-11-18）

源码 `cbaeaa741cd311e1840cfc053a4f064242b60435` 仅在首开共用校验中接受 `pln_` 加 32 位小写十六进制字符，保留旧 `plan_` 规则。新回归使用正式的 `randomId("pln")` 生成合成套餐号，先复现旧校验拒绝，再验证配置、DDL 及隔离库购买仍仅接受准确绑定的套餐；畸形编号和不同的合法套餐号仍被拒。定向本机测试 12 通过，1 个隔离数据库用例转由 CI 跑；lint、类型通过。[首开专项 CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44368236891)原尝试 1 的 `offline` 和 `postgres`（隔离 PostgreSQL 16）均成功。

[平台通用 CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44368236845)在 V6 已发布执行依赖摘要检查失败，镜像构建和上传步骤跳过。通过本机重算提交及父提交的 81 个固定文件，确认两者均为 `dbff1490cd41f114cfb654386b5a1dc62d643e7f67820761b46f41f7e141b4ac`，与历史期望 `828491ec…` 不同，非本次两文件改动所致。未修改旧基线或工作流，未调用 AWS、生产数据库或 Stripe，未 dispatch 替代候选，不把专项 CI 成功当作新镜像或启用证据。

<a id="sandbox-first-purchase-replacement-review"></a>

### 替代候选：原单次构建审批范围（已执行，不重放）

[固定构建输入](evidence/sandbox-first-purchase-replacement.prepared.json)：与原候选使用同一个基底，19 个覆盖路径不变，**只有 `lib/purchases/sandbox-first-purchase-config.ts` 换为 `cbaeaa741cd311e1840cfc053a4f064242b60435` 的已验证 Git blob**。新配方 SHA-256 为 `b344a2e3f1c36ceeebca47b8d184f9e20fce8fa0c8d66e44ddcfb62454e17315`，源码树为 `65f2840a23e9a0bca5a8c055ee6898ace8f926f7`。离线重建两棵树，实际差异只有上述文件；归档接线与原发布合同 5 项全部通过，购买/Stripe 本机回归 12 项通过、1 项隔离数据库仍由既有专项 CI 覆盖，改动脚本 lint 通过。原两文件注册配方和树未变；旧首开配方不再被当前构建入口接受，原 `14454594785` 保留为历史，不作发布输入。

- 若另获批准，只对 `veinyyxy/TechlongSoftware` 的既有 `sandbox-registration-candidate-v1.yml` 在 `main` 发起 **1 次** `workflow_dispatch`，填写上述 `recipe_sha` 和这份接线已推送的完整 `main` 提交 `orchestration_sha`。提交前核对远端 head 和工作流字节与待批版本相同；只接受同仓库、同 SHA、原尝试 1。任何漂移、提交结果不明或构建失败不补发、不 Re-run。
- 复用原构建流程，单 job 最多 25 分钟：一个 Linux/amd64 候选、非 root/禁网自检、匿名注册表单、用合成 `pln_` 编号运行四项签名回调自检，保持控制器/普通 worker/apply 关闭。通过新鲜 HIGH/CRITICAL OS 扫描后仅向 GitHub 封存一份 `sandbox-first-purchase-overlay-b344a2e3-<runId>`，保留 3 天，不下载镜像包。
- 待批范围可同时覆盖同一 run 的 GitHub 认证 GET 最多 40 次（头与工作流 2、定位 4、观察 29、job/去敏封存摘要/产物元数据 5），仅已有 GitHub 认证、只在内存使用。接受 GitHub 构建及存储可能产生费用和供应商日志风险。**不涉及 AWS/OIDC、ECR 认证或发布、实际 Stripe、数据库、平台更新、安装、购买或恢复。** 构建审批不等于启用审批，不延长之前的事实快照或原候选期限。

<a id="sandbox-first-purchase-replacement-observed"></a>

### 替代候选已核验（2026-11-18）

用户批准后核对远端 `main` 与工作流字节，只调度 [run 44370472025](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44370472025) 一次，原尝试 1 成功。首次读回未通过运行身份门槛，随后仅用原剩余额度核对同一 ACK，不重新调度。总量：调度 1、GET 12、Re-run 0。准确 job 的封印和独立产物元数据显示，新源码树、非 root、禁网、控制器及 worker 关闭、匿名注册、使用合成 `pln_` 编号的四项回调及新鲜 OS 扫描全部通过。

[封存回执](evidence/sandbox-first-purchase-replacement.observed.json)：产物 **`14457164929`**，到期 **2026-11-21 12:31:59（温尼伯 CST）**。原意图与累计日志保留在本机忽略目录。没有下载镜像包、读 Secret、访问 AWS/数据库/Stripe、发布或部署。封存的 config digest 不是 ECR manifest；正式发布入口尚未绑定此替代产物，启用仍单份另审，不重跑构建或先更新平台。

<a id="sandbox-first-purchase-consolidated-preparation"></a>

### 集中启用草案：固定对象、顺序和停止点

[机器索引](evidence/sandbox-first-purchase-activation-consolidated.prepared.json)仅供审阅，不是执行清单。本轮复用固定 SHA 的三份只读回执和替代产物 `14457164929`。在本机从已安装 W8d 模板及原平台恢复/注册交付材料重建出 **2 项 Access、11 项 Hosting** 的原模板，摘要同时与已存 AWS 回执匹配；Access 的 9 条既有策略以及 Hosting 原数据库固定版本引用保留。用修复后的合同校验本机已锁定的工作区与 `pln_` 套餐，并渲染五个 SQL 函数，仅记录摘要，不公开实际绑定或 SQL 正文。占位模板只证明差异范围，不能提交 CloudFormation。

| 顺序 | 同一份未来审批拟覆盖的动作 | 继续前必须取得的证据 |
| --- | --- | --- |
| 0. 在**第一笔写入前**核对 | 锁定替代 artifact/run/配方/树、原发布 Locked、原栈和策略、新 tag/Secret 名占用、已绑定业务准入，以及 Stripe 测试账户/端点元数据。只补缺项和短窗口易变门槛；已核验的原包日志不复读。 | 发布入口与新不可变 reusable commit 已离线验证；Source 准确写权限、时间、原状态和实际外层批准 SHA 均匹配。无法以只读证明测试键/账户或端点路径时，先停止，不能先发布。 |
| 1. 发布并立即撤权 | 复用原发布角色与已验证的 Grant → 一次受保护调度/push → `finally` Revoke：原 publisher 栈 Grant/Revoke 顶层提交各 **1**，GitHub dispatch **1**，ECR 顶层 push **1**（镜像分层实际为多次 API）。拟定新不可变 tag `sandbox-first-purchase-b344a2e3-r44370472025`，其空闲尚未核验。 | 用户本人批准准确的 `techlong-sandbox-deploy` run。发布者先认证下载唯一已批准 ZIP、校验 ZIP 和档案大小、字节 SHA、封印及镜像 config，并做当前扫描，才可取得发布会话。可信回执必须独立证明旧镜像集合未动、新 ECR manifest 原字节与封存 config 对应、发布者确已恢复 Locked；单有 GitHub 成功不够。 |
| 2. Neon 窄安装 | **1 次** PostgreSQL 18 事务：建 1 个 NOLOGIN definer、1 个受限 webhook LOGIN、1 个专用 schema、5 个函数。旧注册不变，Web 只得 `reserve/attach/read_order`，回调角色只得 `webhook_order/complete`。 | [新 PG18 非超级用户方案已在隔离库验证](#sandbox-first-purchase-offline-prerequisites-observed)，不直接跑旧超级用户 DDL。事务内临时切换 definer 创建 schema 内函数、撤掉 `SET` 再提交；事务中与独立只读回读比较 ACL、归属、函数摘要及表/触发器保护。若进一步证明 LOGIN，只做验证 TLS 身份/只读检查，不调用五个函数。创建者 ADMIN 可重新授予，须明确接受；不重放未知提交。 |
| 3. Stripe 与 Secret | 只用准确测试账户和测试键；端点固定为 `https://console.sandbox.techlong.cloud/api/stripe/webhook`，事件仅 `checkout.session.completed` / `checkout.session.async_payment_succeeded`。唯一完全匹配且签名密钥已可私密供给则重用；只有明确不存在时才拟建 **1** 个测试端点。Secrets Manager 拟 **3 写**：先建空的 `techlong/sandbox/platform-web/first-purchase-v1`、安装准确资源保护策略、再提交一次固定版本。 | 混合或仅凭前缀推断测试模式、账户无法一致核验、分页结果不完整、重复/冲突/失去签名供给均停止。不写旧端点、不轮转、发测试事件或购买。用既有 KMS，不改 key policy；只把测试运行 key、有效签名密钥及同一 Neon host/database 的受限 webhook TLS DSN 放入 Secret，不把管理测试端点的凭据装进运行时。先装资源策略才写值，避免未保护的 Secret 承载真实凭据。只保留准确 ARN、版本和策略摘要。旧 Web Secret 不读正文、不改。 |
| 4. 原 Access 栈 | 同一变更集创建 **1**、执行 **1**。只向 `ExecutionRole.ExecutionOnly` 和 `ExecutionBoundary` 分别追加同两条语句：对新 ARN 仅 `GetSecretValue`（固定 `secretsmanager:VersionId`），对既有 Key 仅 `kms:Decrypt`（Secrets Manager 转发及固定 ARN/VersionId 上下文）。 | 只允许 `ExecutionBoundary`、`ExecutionRole` 各一次 `Modify / Replacement=False`，原角色、trust、其他语句、边界和所有已有 Secret 不变；确认生效后才部署。无新 AWS IAM 身份、无通配 ARN、无 IAM 直接写。若缺 Key 或必须改 Key policy，停止。 |
| 5. 原 Hosting 栈与独立核验 | 同一变更集创建 **1**、执行 **1**。容器镜像用独立核验的 ECR manifest digest；追加五个首开绑定、三个 `ARN:json-key::VersionId` 引用，更新两条镜像来源 Metadata。 | 只允许 `TaskDefinition Modify/Replacement=True` 与 `Service Modify/Replacement=False`；Service 声明和旧 `DATABASE_URL` 保持，实际服务仅切换任务定义，其他 9 项资源不动。独立核对新物理 task、实际 digest、旧权限/网络/DNS/证书、目标健康、控制器/worker/apply 关闭及固定引用，并做匿名 `/api/health`、`/register` 各 **1** 次 GET。没有 Checkout 或回调业务写入验收。 |

除执行前的原状态核对外，尚缺 **Stripe 私密供给和限量元数据核对**；具体 [文件与最多 6 次认证 GET](#sandbox-first-purchase-stripe-test-supply) 已准备。其他服务的最终读写预算、独立读证据及截止须在真正的外层审批确定，目前不是可执行批准。

窗口与风险：原只读快照截至 **2026-11-18 17:06:18.005 CST**；替代产物截至 **2026-11-21 12:31:59 CST**。不延长，只有到期或必要事实改变才补该门槛，发布预留不足不开窗。新 Secret 的三次拟写采用先保护、后填值；各服务间无原子提交，失败可能遗留镜像、角色、测试端点、Secret 或已改权限，会持续产生相关费用，平台滚动可能有短暂中断。除发布临时 Grant 的立即 Revoke 外，不自动补齐、回滚、删除或重试；仅保留原 CloudFormation 托管回滚。**本轮云/API、私密值读取、连接、调度及业务写均为 0。**

<a id="sandbox-first-purchase-offline-prerequisites-observed"></a>

### 两项离线前置已验证（2026-11-18）

- **原发布入口：** `9de0536…` 上原手动 caller 只把 `14457164929` 送进新固定 reusable `e7b2ee7…`，原注册产物仍指向原固定版本。完整评审、原 run/ZIP/封印、保留四个旧 ECR 映射和原撤权条件均照常核对，不能任填产物或目标。`e7b2ee7…` 的[发布合约 CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44374702310)与 `9de0536…` 的[手动路由 CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44375035526)原尝试 1 均通过；本地 27 项发布回归通过，40 个来源文件钉定且 reusable 依赖匹配。没有调度发布或打开 AWS Grant。
- **PostgreSQL 18：** 隔离 [CI 44374702186](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44374702186) 的 `first-purchase-pg18` 两项实际执行均通过，无跳过。新纯安装事务体为 24 次 SQL 提交（部分提交包含多条语句，不含事务外层 `BEGIN`/核验/`COMMIT`），五个函数与旧草案逐字一致。`NOSUPERUSER CREATEROLE` 安装后在同一事务撤掉临时 `SET`，另开只读连接实测无 `SET/INHERIT`、创建者仅残留 `ADMIN`、精确 schema/函数 ACL 无 PUBLIC 或业务表直接写给运行角色；新回调用合成凭据登录并被拒绝调用 Web 读取函数。此为隔离证据，不证明实际 Neon 已安装或服务端日志安全。
- [去敏回执及固定源码](evidence/sandbox-first-purchase-activation-prerequisites.observed.json)记录精确 CI。实际 Stripe 身份与材料、最后必要只读和一份启用 SHA 仍另审；不重跑候选，不新开栈，不消费永久槽。本轮未读 Secret、不访问 AWS/实际 Neon/Stripe、不提交部署或购买。

<a id="sandbox-first-purchase-stripe-test-supply"></a>

### Stripe 测试凭据私密供给与限定只读范围

在 [Stripe Dashboard 的 API keys](https://dashboard.stripe.com/apikeys) 先明确选中这次首开用的**同一个 Sandbox**，取该测试账户的 `acct_…` ID 和两把不同的 `rk_test_…`[受限 API 密钥](https://docs.stripe.com/keys/restricted-api-keys)。先从零权限开始，仅给下面的用途；不使用 `pk_`、`sk_live_`、`rk_live_`、组织密钥或全权 `sk_test_`。不配置 Connect 代操作或 Webhook 写权限。本轮不需要创建端点。

| 本机字段 | 最小用途 |
| --- | --- |
| `accountId` | Dashboard 当前 Sandbox 的账户 ID，用于和两把密钥各自返回的本账户 ID 比较；不在聊天发。 |
| `runtimeKey` | 首开服务日后需要 Checkout Sessions **Write**；本轮核对只用本账户身份和 `Balance` **Read**，不调用 Checkout。不给此键 Webhook Endpoints 权限。 |
| `inspectionKey` | 只读核对用：本账户身份、`Balance` **Read**，加 `Webhook Endpoints` **Read**；不给 Checkout、Webhook 或其他写权限，不进入 ECS 或 AWS Secret。 |

若 Dashboard 无法仅开放所需的本账户只读范围，或限制键返回权限拒绝，停止并说明缺项，不放开 Connect、改用管理密钥或调用其他 API 来绕过。运行键写权限是后续使用所需，**只读 GET 不证明 Checkout 写权限可用**。初次供给时不需要生产密钥、签名密钥、数据库密码或 DSN。

把下列结构以 UTF-8 JSON **直接保存在 `E:\NodejsProject\TechlongSoftware\.local-secrets\sandbox-first-purchase-stripe-test.json`**，只在本机编辑器替换占位符：

```json
{
  "accountId": "acct_替换为当前Sandbox账户ID",
  "runtimeKey": "rk_test_替换为运行密钥",
  "inspectionKey": "rk_test_替换为只读核对密钥"
}
```

已用本机元数据确认目录无链接、Git 忽略，访问仅属当前 Windows 用户、Administrators 与 SYSTEM。请直接在该目录创建文件以继承权限，不从共享目录移入；确认扩展名是 `.json`，不要保存到 `.env`、Git、云同步目录，或出现在终端历史、截图、附件、聊天及日志。此文件是临时供给，不替代长期秘密存储。保存后只回复“文件已保存”，不会据此自动读取。

**获另行批准后才执行：** 只检查这一个文件的路径、ACL、大小与非链接状态，通过后读取 **1 次**（仅进内存，校验 JSON 和精确三字段、两把不同的测试键；拒绝空值/占位符）。固定 HTTPS `api.stripe.com`，不开重定向、不带 `Stripe-Account` 或 `Stripe-Context`、不重试。只执行下列认证请求，默认 **5** 次，最多 **6** 次：

| 顺序 | 请求上限 | 仅保留的结果 |
| --- | --- | --- |
| 1. 身份 | 两把键各一次 `GET /v1/account`。 [Stripe SDK 本账户查询](https://github.com/stripe/stripe-node/blob/master/src/resources/Accounts.ts) | 返回的账户 `id` 都等于预绑定 `accountId`；仅保留是否匹配，不保留账户正文。 |
| 2. 模式 | 两把键各一次 `GET /v1/balance`。 [Balance API](https://docs.stripe.com/api/balance/balance_retrieve) | 只看 `livemode === false`，不保存金额、币种或余额正文。 |
| 3. 端点 | 仅 `inspectionKey` 一次 `GET /v1/webhook_endpoints?limit=100`，不翻页；仅找到唯一准确候选时再对该 `we_…` 一次 `GET /v1/webhook_endpoints/{id}`。 [列表](https://docs.stripe.com/api/webhook_endpoints/list)、[单项](https://docs.stripe.com/api/webhook_endpoints/retrieve) | 只核对准确 URL `https://console.sandbox.techlong.cloud/api/stripe/webhook`、端点 `id`、`livemode=false`、`enabled`、API 版本、事件集合恰为 `checkout.session.completed` 与 `checkout.session.async_payment_succeeded`，不接受通配符或相近 URL。只在私有回执保存必要的匹配端点元数据，不保存其他端点、描述、metadata 或原始正文。 |

不使用真实交易、Checkout、客户、卡或事件正文来试权限；返回 401/403、超时、账户/模式冲突、分页、重复或端点配置不符即停，不扩大读取。除必要去敏投影，响应及凭据仅在内存，禁止记录请求头、原始错误正文或签名 URL。Stripe 官方认证与提供者日志仍有风险。**零匹配只表示这页 v1 结果未见同 URL，不等于可以创建**；同一 Sandbox 的 [Workbench](https://docs.stripe.com/workbench/event-destinations) 仍须排除同 URL 的其他投递配置，并确认现有准确端点是 **Your account / Snapshot**，不是 Connect 或 Thin。当前处理器依赖快照 `data.object`；版本无法证明兼容或有冲突就停，不改端点。

只有证实可复用的准确测试端点后，才请用户从 Stripe Dashboard 的该端点取 `whsec_…`，单独存 `E:\NodejsProject\TechlongSoftware\.local-secrets\sandbox-first-purchase-stripe-webhook-test.json`，字段仅 `endpointId`、`signingSecret`；**本次只读不打开该文件**。Stripe [端点 API](https://docs.stripe.com/api/webhook_endpoints/object) 的 GET 不返回签名密钥；不使用 `stripe listen` 的签名密钥，不轮转或新建来取值。若确无端点，任何创建及所需单独的测试管理权限并入后来一份正式启用审批，不提前提供管理密钥。两种分支都不发送测试事件、不创建 Checkout 或购买。

Stripe 的另批范围不包含 AWS、Neon 或 GitHub 运行读取，也不刷新旧事实；其他易变门槛仍按已存记录和必要增量另议。正式**发布、安装、更新平台、启用仍合在一份审批**；购买及首开在启用后另审。

<a id="sandbox-first-purchase-stripe-readonly-stopped"></a>

### 第一次 Stripe 限定只读停止（2026-11-18，13:47 温尼伯）

用户明确批准后，固定文件的独占范围、ACL、Git 排除及两把不相同的 `rk_test_` 格式通过。只读取文件 **1** 次，运行密钥只请求 **1** 次 `GET /v1/account`；返回 200 后未通过账户对象与预填 `accountId` 的匹配，记 `STRIPE_ACCOUNT_NOT_MATCHED`。未记录 Stripe 实际返回的账户信息、请求凭据或正文，因此不猜测是预填 ID 不正确还是密钥来自另一个 Sandbox。检查密钥调用、余额、端点列表/详情、签名密钥读取及云/数据库/支付写全为 **0**。尚未证明同一测试账户、测试模式或端点情况。

去敏本机回执 `sandbox-first-purchase-stripe-readonly-20261118.result.json` SHA-256 `c9310d87289b5531446a25847113ea06d8dc3959b0caf66474269efb5987e919`，单次意图 SHA-256 `bf39e371fb7431d51e1425d653050e7ebf3beaaf7b0f463e939181205d465ec1`。实际观测从 `19:47:55.045Z` 至 `19:47:56.773Z`，无重试或刷新原快照。下一步仅在 Dashboard 选中创建运行密钥的那个 Sandbox，核对本机 `accountId` 与两把键是否出自同一环境。若能确认，只在私有文件更正，绝不将 API 返回值自动覆盖用户锁定 ID；不能确认则停待用户决定诊断方式。更正不等于批准再次读取，不创建端点、不购买、不发布、不安装。

<a id="sandbox-first-purchase-stripe-account-diagnostic"></a>

### Stripe 单请求账户编号诊断（2026-11-18，13:58 温尼伯）

用户单独明确批准后，未重放前次只读；只读原文件 **1** 次，使用 `runtimeKey` 请求官方 `GET /v1/account` **1** 次。HTTP 200、返回对象和 `acct_` 格式均通过，**明确确认返回编号与原文件不同**。仅把返回编号与布尔比较结果写入本机 `.local-secrets/sandbox-first-purchase-stripe-account-comparison.json`；不打印、不提交 Git、不修改原凭据文件。未使用核对密钥、未查余额、测试模式或 webhook，也未执行其他 API、云写入、部署或购买。

去敏诊断回执 SHA-256 `848577590ea5120c06ced9b4b21764f43e773d0b24d64488105107e646510324`，单次意图 SHA-256 `09a438eddb566e8dfbb7caa23d03c1a68373dcb143924460c68e270a098de0cb`，观测 `19:58:34.625Z–19:58:36.109Z`。用户须先核对对照文件中的 `accountIdReturnedByStripe` 与 Dashboard 所选 Sandbox；只有确认是预期账户才自行更正原文件的 `accountId`。随后是否再次限定只读须另批，不能自动替用户确认 Sandbox 或把本诊断当作启用依据。
