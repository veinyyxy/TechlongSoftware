# W6b：平台控制器定案与单仓 GitHub App 待审清单

## 当前状态：用户报告已注册/安装，尚未独立验收

2026-10-19：原清单 `827c5a54…` 已获用户确认。因 Edge 会话未接入浏览器控制，用户自行完成并提供 App ID **5381160**、slug `techlong-sandbox-controller`、installation ID **173033406**；这是用户报告，不是完整安装验收。新增[独立报告记录](../ops/aws-sandbox/reviews/platform-controller-registration-w6b.reported.json)，原 prepared 清单及九源码绑定保持。

两次无认证官方 API GET：App 查询返回 404，不能据此断言不存在或已验证私有配置；候选 bot 查询返回 200，公开 ID 为 **344813947**。没有读取私钥或生成 JWT/token。候选 bot ID **不是实测 dispatch actor**，不得据此放宽旧 V5 门禁。安装权限、单仓范围、私有可见性/OAuth/webhook 设置仍未核验，运行能力保持关闭。

用户另报告误生成一把尚未使用的私钥，因最后一把限制不能删除。该生成超出原“无 key”范围；记录异常不追认读取/使用授权。官方明确最后一把删除前需先生成另一把，私钥不会自动过期；**不自动生成第二把、删除 App 重建或读取下载目录**。[GitHub 私钥管理规则](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)。

先确认 PEM 是否只保存在本机、未分享/提交 Git/上传；不要发送文件、内容或截图中的密钥。若未暴露，可在后续明确批准安全接入时评估复用；若已暴露或无法确认，单独审查隔离及轮换。删除本机文件不等于 GitHub 撤销；“尚未使用”也不等于密钥失效。接下来只核对非敏感设置/安装截图并记录密钥保管状态，密钥读取/储存、mint token、身份 workflow、SQL/发布/部署仍另批。

以下保留注册前的方案、风险和准备验证，不作为重复注册授权。

2026-10-19，America/Winnipeg。接续 W6a；本阶段只交付具体方案、公开身份核对代码和注册待审材料。**没有创建 App、安装权限、生成/读取私钥、读取 Secret、安装 SQL、dispatch 或云部署。** W5r 成功记录、两份部署 workflow、云代码与 IAM 保持。

## 定案：最快接回主线

| 部分 | 首轮采用 | 不做的扩展 |
| --- | --- | --- |
| 操作入口 | 当前本地平台 `127.0.0.1:3100`，既有管理员登录、同源 POST；最终整套 AWS 托管另阶段 | 不发布 Sites，不新增常驻 AWS 控制服务 |
| 服务端实现 | WebCrypto、fetch、Neon HTTPS；本机开发运行也走相同接口 | 不在 HTTP 中 spawn F 盘脚本，不转交个人 AWS Login/Git 凭据 |
| 调度身份 | veinyyxy 所有的私有 GitHub App，仅安装 TechlongSoftware，Actions write / Contents read / Metadata read | 不使用个人 PAT，不授予 Deployments、Administration、Secrets、Contents write 或 Workflows write |
| 私钥 | 后续单独批准后才生成；首轮仅存既有 ignored `.env.local` 的服务端专用 binding，限制 Windows 文件 ACL | 不进 Git/聊天/浏览器/构建变量/日志；本阶段不增加 binding 或读取密钥。迁 AWS 时另审托管 Secret |
| 审批账本 | 复用 Neon，独立 `deployment_control_v6` schema、窄服务端 LOGIN；业务 job payload 不改 | 不将 owner URL 复制给新控制器/云 worker，不用浏览器存储或 F 盘文件作权威状态 |
| 云执行 | 保留 Review → RunOnce → 独立 Inspect、永久槽和每次 GitHub environment 人工批准 | 不开放普通队列，不自动批准、重跑、回滚、清理或扩至任意租户 |
| 首次验收范围 | 一个显式批准的新 sandbox job，先明确旧承载资源的保留/复用/清理方案 | 不重放已成功 job，不将到期标签当成已删除或停费 |

表中是实现选择，不是安装授权；私钥保存和 SQL/角色/授权必须以最终代码、准确动作清单另审。现有平台数据库凭据并非“窄控制角色”，目前没有偷偷替换它。

### 必须修正的真实接线限制

当前 `.github/workflows/cloud-worker-execute.yml` 和 `ops/cloud-worker/activation/runtime-v5.mjs` 都将 actor ID 固定为个人 `14145707`。现有 trust 另绑定 reusable workflow 的准确提交 SHA。因此仅换一个 token **不构成可用接线**；App 的真实触发 actor 尚未实测，不能猜一个 bot ID 或放行任意 bot。

后续实现独立 V6 候选 caller/runtime/reusable，在无 AWS 的身份验证 workflow 中观察实际 App actor，再绑定准确公开身份；旧 V5 不放宽。新发布及现有角色准确 trust 引用替换须集中另审。现有 worker 的元数据读权限只覆盖既有清单指定角色/策略，不能假设足够验证新布局；若差权限，列准确 action/ARN 再审批，不默默跳过核验。

### 审批和调度的最小持久化合同

候选 schema 只需三类表，不扩旧业务 schema；尚无 DDL 安装：

- `plans`：不可变计划 SHA、job/app/deployment、准确源码与物料摘要、资源动作、前驱、失效时间；控制器不能从浏览器自由选择仓库、workflow 或 S3 URL。
- `approvals`：管理员、模式、计划及 action SHA、明确风险版本、批准时间/截止；新批准不能修改原计划。角色/函数的最终权限与事务 SQL 另审。
- `dispatch_attempts`：持久化 intent、唯一幂等键、准确 run ID/ACK、UNKNOWN/终态、独立验收摘要。调用前在一个窄事务中检查审批、截止、互斥并落 `SUBMISSION_STARTED`；每个 job 的 RunOnce 唯一约束跨计划生效，不能换 SHA 绕开。

GitHub POST 只发一次；ACK 明确才写 run ID。超时/断网/ACK 落库失败进入 UNKNOWN/待核对，不重新 POST，不凭“列表里暂时没 run”当未提交。轮询只回读准确 run，有界退避；人工 environment 仍由用户在 GitHub 处理。Inspect 成功且当前数据库回执匹配才成为新绿色状态，旧证据不能顶替。

为消除平台对 AWS Login/私有 S3 的依赖，候选新 worker 在 Review 输出白名单公开审批 capsule（准确资源/actions/source/job/SHA/期限，不含私密行、payload 或凭据）；平台以 App 回读并绑定审批。worker 仍校验私有原件及窄授权。**公开 capsule 是待实现的新合同，不是已存在功能；Source 预检迁移/权限差异须逐项审核，不能删门禁。**

注册身份 → 控制器/账本与云候选实现 → 集中审查 key/窄 SQL/发布及 trust → 一条新任务真实闭环。注册后直接做接线，不再建立旧 generation 探针或离线模拟链。

## 本次唯一待批准范围：注册与单仓安装

准确计划由 `platformControllerRegistrationPlan()` 产生；机器清单在 [W6b 注册清单](../ops/aws-sandbox/reviews/platform-controller-registration-w6b.prepared.json)。规范化 subject SHA 由下列命令回读，不含任何私钥或 token：

```powershell
node --experimental-strip-types scripts/prepare-platform-controller-registration.mjs --check
node --experimental-strip-types scripts/prepare-platform-controller-registration.mjs --prepare
```

两命令只读固定公开源码；不访问 `.env`、网络或凭据、不打开 URL、不创建文件。清单绑定九个公开文件的 normalized-LF SHA，包括现有部署 workflow/runtime、原 W5r 记录、launcher 及注册代码/测试。它不是完整云闭包或部署清单；原 76 文件闭包另核验。

当前 manifest SHA：`827c5a5418d959def18bcca5afd73d34f27bdcf9ed649ec2dedcdf5d6667fcc1`。确认语句：

> 我确认按清单 `827c5a5418d959def18bcca5afd73d34f27bdcf9ed649ec2dedcdf5d6667fcc1` 仅注册一个私有 Techlong Sandbox Controller GitHub App，并仅安装到 veinyyxy/TechlongSoftware，授予 Actions write、Contents read 和自动 Metadata read；接受本文件完整风险。不生成或读取私钥/令牌，不 dispatch、代批、改 AWS/SQL 或部署；遇重名或结果未知先停止核对，不自动重试或删除。

拟执行仅两项人工操作：

1. 在 **veinyyxy / 14145707** 下注册一个 **Techlong Sandbox Controller**；仅所有者可安装，禁用 webhook，事件为空，不启用 OAuth、不设 callback/setup URL。
2. 安装时选择 **Only select repositories → TechlongSoftware / 1323312747**，不是 All repositories。仓库权限仅 Actions **Read and write**、Contents **Read-only**、自动 Metadata **Read-only**；其余全为 No access。

工具生成 GitHub 官方注册表单的预填 URL；**不是提交接口，也不是受强制的配置**，提交前必须逐项核对。GitHub 允许在表单编辑预填值，未列权限不得手动追加。[官方 URL 参数说明](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters)。不用会返回凭据的自动 manifest 转换流程。

本次不主动生成/导出/读取 private key 或 client secret，不 mint token，不 dispatch、rerun、代批 environment，不改 workflow/trust/IAM/SQL/业务/资源。GitHub 内部生成的标识或凭据不可由本工具保证为零；不可在聊天传送任何凭据。若已有同名 App、名称不可用、安装结果未知或设置不同，停止并核对，不自动换名、补齐、重试或删除。

完成后仅记录公开 App ID、slug、installation ID；API 公开元数据匹配代码另校验 owner、仓库唯一选择、权限、空事件、非 suspended 和候选 bot 身份。**这些检查不能验证私有可见性/OAuth 配置/密钥保管，也不能证明实际 dispatch actor**；必须补人工设置核对及后续获批的无 AWS 身份验证。代码输出固定 `canDispatch/canApproveEnvironment/canDeploy=false`，不是激活凭证。

### 完整风险与费用边界

- Actions write 是仓库级能力，不是外部的单 workflow ACL；包括取消、重跑等超出控制器业务范围的能力。控制器白名单只能约束本程序，不能消除 App 凭据泄露后的仓库权限风险。此接口支持 installation token，但不是“天然仅能执行一次”。[调度接口](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。
- Actions 权限也允许读取运行日志、产物。已有或他人创建的 App 私钥/令牌可能行使权限；即使本阶段不生成私钥，**安装也会立即授予权限**，不能说 App 绝对无能力。
- 不授予 Deployments write，不把 App 加入 required reviewers，不更改环境保护；人工批准仍独立进行。[环境批准接口的权限要求](https://docs.github.com/en/rest/actions/workflow-runs#review-pending-deployments-for-a-workflow-run)。Actions write 不等于本流程获准代批或任意运行。
- 后续安装令牌需每次明确限制 repository ID 和权限；官方当前令牌约一小时过期，但 App 私钥不是一小时短凭据。本阶段不生成令牌，也不将 token 格式/长度写死。[官方令牌范围与期限](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)。
- 注册和安装非原子；可能只留下注册或已授予部分权限的安装。不能保证 provider 内部日志/凭据生命周期；无自动卸载、删除、回滚或重试。接受安装权限实际生效，但不是接受部署/资源写。
- 本次不创建 AWS 付费资源，不运行 Actions；已有 AWS 资源仍可能持续计费。后续 Actions、Neon、AWS 成本以实际使用为准，50 USD/月是目标，不是硬限额。
- 注册审批是**配置绑定**，不是十五分钟的云部署窗口；配置/权限/源码绑定变化必须重审，提交前核对当前账号和设置。它不延长任何旧云清单或旧 job 的有效期。

## 本阶段验证与唯一继续位置

注册预填/纯元数据合同测试不冒充 GitHub 注册成功或 token/actor 集成验收。W6a 真实只读数据库匹配证据保持；本阶段不额外连 Neon/AWS，也不要求刷新 Source。

本机验证：4 项新增合同测试 + W6a/既有请求 24 项 + 授权隔离 14 项 + 原审批衔接 13 项，共 **55 项通过**；类型检查、定向 lint、生产构建通过。九文件清单回读通过；76 文件云闭包仍为 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`。延用原无 AWS CI 并增加本合同及清单校验，无 OIDC/环境批准/Secrets 或部署步骤；最终提交的云 CI 结果须独立回读，不用本机通过代替。

原注册/单仓安装清单已获确认，用户已报告公开标识；不再次注册或复用该清单授权密钥接入。当前以文首的待核验/密钥异常状态为准，再集中实现接线。**尚未授权 key、令牌、SQL、身份 probe、工作流发布或实际部署。**

回到 [W6 总览](aws-auto-deployment-platform-w6.md) / [主线](aws-auto-deployment-mainline.md)。
