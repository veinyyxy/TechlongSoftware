# W6b：平台控制器候选代码与安装合同

2026-10-19，America/Winnipeg。用户批准继续“控制器代码、迁移脚本与测试”。**这是候选实现，不是 W6 全部完成或控制器已上线。** 不读取真实 PEM、不设置运行时密钥、不安装 Neon SQL、不 mint 真实 App token、不调用调度或 AWS。

## 本阶段实际实现

实例页新增独立 `DeploymentControlPanel`，既有 W6a 只读归档面板保持原合同。新增管理员 API：

`/api/admin/instances/[instanceId]/deployment-control`

- GET：返回白名单审批/运行状态。当前硬关闭，返回 `enabled=false`、空计划，不查询新账本、不访问密钥。
- POST：同源、既有平台管理员会话、2 KiB 流式 JSON 上限、严格操作字段；只支持 `approve_and_dispatch` 和 `observe`，不接受浏览器提供仓库、workflow、job、S3 引用、密钥或源码。
- 精确批准绑定计划 SHA、动作 SHA、风险 SHA 和会话管理员；状态提交前写入持久 intent。页面没有重试、代批 environment 或清理按钮；UNKNOWN、EXPIRED、SLOT_OCCUPIED 不提供再次调度。
- 查询准确 run 会保存观察记录，因此不是零数据库写；它不批准环境、不重新运行工作流。无自动轮询或调度。窗口确认取消不会提交请求。

候选 GitHub 客户端在 `lib/deployments/controller-v6/github.ts`：

- WebCrypto 支持 GitHub PKCS#1 / PKCS#8 RSA PEM，在内存签 RS256 JWT，固定 App 5381160；iat 回拨60秒、exp 当前时间加480秒。没有文件读取器、个人 PAT、AWS Login 或子进程。
- 核对准确 App/安装/owner/权限、非 suspended、selected 仓库选择；每次令牌指定仓库 ID 1323312747，按用途申请 Actions read 或 write、Contents read、Metadata read。只请求 GitHub 官方 API，不跟随重定向，不打印 token/JWT/PEM/提供者诊断。[JWT 合同](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app) / [令牌范围](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app)。
- 存在仅用于未来单独受审验证的 `inspectInstallation()`：只申请 read token，不要求已发布云绑定，不提供 HTTP 调用入口、不执行 workflow。**本轮未真实调用。**
- 调度前核对 main 精确 commit、固定新 workflow 文件/ID 和 active 状态，再检查期限及账本。一个 POST，要求准确 run ID/API URL/HTML URL ACK；在令牌清理前持久化 ACK，不扫描 run 列表猜测。[调度接口](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。
- finally 最多一次撤销本次 installation token。撤销失败、POST/落库结果不明都不自动重试；若 ACK 已保存，条件 UNKNOWN 写不会覆盖它。
- 回读严格核对 repo/owner、实际 actor、触发 actor、main/head SHA、workflow ID、attempt=1 与 reusable SHA。状态 success **不是云部署验收证明**，不会直接显示绿色部署成功。

`inspectInstallation()` 中 `/installation/repositories` 使用已限至一个仓库的 token，因此只能证明**该 token 的仓库范围**，不能证明安装实际上没有选择其它仓库。单仓安装仍需用户设置截图/受审人工核对，客户端明确返回 `installationRepositoryCountVerified=false`；也不能验证 private/OAuth/webhook UI 设置。候选 bot ID 344813947 不冒充实测 dispatch actor。

## 硬关闭与真实接线位置

`contract.ts` 内的 `PLATFORM_RELEASE` 固定 **UNPUBLISHED**，身份运行证明、workflow ID/reusable SHA/闭包/安装/风险摘要均为空。环境变量设为 true 也不能启用；实际 runtime 测试用抛异常的 getter 证明不会读取新 DB/私钥 binding。

未来只接受准确角色 `techlong_deployment_controller_v6` 的 Neon TLS URL，使用独立 binding `TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL`，不回退现有 owner `DATABASE_URL`。密钥 binding 为 `TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY`；当前 launcher allowlist 未加入它，本轮不填 `.env`、不读文件或把 PEM 复制进 binding。

新目标 `cloud-worker-platform-v6.yml` / `cloud-worker-platform-job-v6.yml` **尚未发布，也没有在本阶段实现 AWS 执行候选**。原 V5 caller/runtime 仍只接受个人 actor，两份现有部署 workflow、trust、76文件云闭包和原永久槽不变。

计划仅限准确 sandbox 实例/部署，拒绝已完成 W5r job。引用格式复用现有版本化证据前缀；不是浏览器可选云操作。每阶段计划分别绑定 source、发布摘要、risk、原期限和前驱证明；RunOnce/Inspect 不自动继承一次笼统批准。

## 独立审批账本：仅候选 SQL

安装文件为 `ops/platform-controller-v6/install.sql`，**故意不放进自动 postgres-migrations**，普通迁移命令不会安装。单事务、新对象存在即停止，无补齐/重试/down。

候选创建一个 NOLOGIN/NOINHERIT/非管理服务角色，一个隔离 schema、三表、九函数：

| 表 | 作用 |
| --- | --- |
| plans | 受信发布者导入的不可变计划/动作/风险摘要，固定业务范围；服务角色无直接表权限 |
| approvals | 准确管理员和批准时间；只由受限函数写入 |
| dispatch_attempts | 永久 `(job,mode)` 唯一槽、intent、ACK、观察及证据摘要；刷新计划不能绕过 |

控制器仅获七个窄函数 EXECUTE：读取计划/状态、原子批准与 intent、最后时刻检查、ACK、条件 UNKNOWN、保存观察。无直接表权限、无业务表读取/写入、无通用 SQL；检查现存 PUBLIC 访问或角色成员关系造成越权时整体拒绝安装。definer 由受审安装者持有，`search_path` 固定，业务对象全限定；无新增 owner 凭据交给平台。

另外两函数 `publish_plan`、`attest_evidence` **不授权控制器角色**。必须由未来另审的可信材料/证据发布者调用。发布者对公开 capsule 的来源、源码、原件和 canonical SHA 的验证/导入适配器 **本阶段尚未实现**，不能手工塞一段浏览器 JSON 冒充真实 Review。SQL JSONB 文本不是 JS canonical JSON，哈希仍由受信程序计算并在控制器加载时重算。

批准函数锁计划/管理员/准确业务任务；Review/RunOnce 只接受 pending、attempt0、max1、永久审核挂起的准确 reconcile 请求，Inspect 要求前驱 RunOnce 已结束且业务任务终态。批准与 intent 同事务；并发仅一方成功。GitHub POST 前再次检查期限、管理员和业务状态，但不声称跨 GitHub/数据库 CAS。

前驱必须同 job、同 source/release、准确 run ID、已结束观察及可信发布者 attested proof；Review success 本身不能批准 RunOnce。终态运行观察不可回退；证据槽不可覆盖。发布/验收导入器未接入时，流程会停住，不造成功记录。

## 风险与剩余工作（激活前必须再审核）

- App 私钥是长期高价值凭据；即使本程序只 mint read token，持有私钥或有效 App JWT 者仍可能另行申请已安装权限内的 write token。Actions write 是仓库级权限，不是单 workflow 外部 ACL。
- PEM/JS 字符串、CryptoKey、token 在进程内的清除不能保证；提供者/系统日志、进程崩溃或依赖可能泄漏。字节缓冲擦除不等于完整内存清零。令牌响应丢失/异常时可能无法撤销；私钥本身不会被 finally 撤销。
- POST 与数据库非原子，main 预检与提交非 CAS，网络/撤销/ACK落库可能部分成功。永久槽在读取密钥前已占用；失败可能需要独立核对，不自动回滚、补齐、撤权、复位或重新 POST。
- 数据库窄服务凭据仍能以已知有效管理员 ID 调用批准函数；函数核对 active 管理员身份记录，但**不是独立的人类签名证明**。平台服务端会话/密钥保管属于信任边界；GitHub environment 人工批准保留，不授予 App Deployments write。
- 账本 FK 会限制被引用用户/任务删除；安装角色初始 NOLOGIN，无密码。启用 LOGIN/凭据保存及实际 SQL 安装另外审批，CI 证明不能代替 Neon 托管兼容验证。
- 无 runtime 计划导入、可信云证据导入或已发布 V6 云 worker。`evidenceAttested` 也不直接作为真实部署已验证；必须另接数据库回执匹配，沿用 W6a 的历史与当前任务隔离。
- 50 USD/月是目标而非硬限额；本轮不创建 AWS 资源，既有资源仍可能计费。GitHub CI 使用临时 PostgreSQL 服务和仓库常规执行额度。

## 验证与继续方式

本机测试覆盖纯控制器、严格 HTTP、临时生成的 RSA 私钥/伪 HTTP、真实组件 SSR、真实 runtime 关闭门禁及旧接口回归；**不读取用户 PEM，也不伪称真实 GitHub 集成已通过**。新增无 AWS CI 对精确候选 SQL 使用临时 PostgreSQL18.6、非超级用户安装者和两个真实并发连接；该服务不是 Neon，不接触生产数据，不使用 AWS/OIDC/environment/平台 Secrets。

首轮候选 CI `39271106116`（源码 `a3ba8f1`）在 SQL 解析阶段发现 PLpgSQL IF 内 CASE 表达式缺括号；已修正并保留失败运行，使用新提交重新校验。该失败未安装生产 SQL 或消费云槽；同提交原平台 CI `39271106084` 已通过。最终 CI 结果以准确提交的独立回读为准。

最终验证已独立回读：准确源码 `9653c47e10043a1ecc9b4167b60da69362d3b822` 的 [CI 39271439304](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39271439304) attempt1 全步骤成功，真实 PostgreSQL 九组检查通过；本机18新增+55回归共73项、类型/lint/生产构建通过。最终 SQL 与真实并发、权限拒绝、永久槽、ACK/终态保护和原业务行保留均由精确候选脚本实际执行，不只是文本断言。依赖业务表为 CI 最小形状 fixture，不冒充全量生产 schema 或 Neon 托管验证。[公开结果记录](../ops/aws-sandbox/reviews/platform-controller-v6.verified.json)。后续只补结果文档，不改变已验证候选代码。

下一阶段集中完成：一次受审 App 只读认证接入（读取准确受保护 PEM、最小 token、立即撤销）、无 AWS 实测身份及 V6 云候选/可信 capsule 与证据导入代码，再准备 SQL/发布/trust 的明确变更清单。实际 key/token、身份 workflow 调度、SQL/Secret/IAM/云部署仍单独具体批准。本阶段没有执行清单，不要运行安装文件或设置启用变量。

回到 [W6](aws-auto-deployment-platform-w6.md) / [注册与权限边界](aws-auto-deployment-platform-w6b-controller-plan.md)。
