# W6：平台部署操作串联

当前继续状态（2026-10-19）：**W6b 控制器候选代码已接线、保持硬关闭，W6 尚未全部完成。** 实例页/管理员 API、WebCrypto App 客户端、独立三表审批账本及非自动安装 SQL 已实现；实际 PEM 未读、Neon 未安装、新云 workflow/可信 capsule 及证据导入器尚未实现或发布。App 和单仓权限截图已提供，PEM ACL 已另获批准并收紧；这些不等于真实 App 认证或部署启用。[候选实现、完整风险及剩余接线](aws-auto-deployment-platform-w6b-controller-implementation.md)。以下保留 W6a 和早期 W6b 记录。

2026-10-19，America/Winnipeg。用户批准开始实施 W6。首先交付 W6a 的真实只读接线；W6b 的身份、任务参数化与执行权限集中审查，不把“实施代码”扩大为创建业务任务、安装身份或部署授权。

## W6a 已实现

管理员实例页 `/admin/instances/app_e897a4377bce498b9c5ee9e64509dcad` 增加“部署进度与验收”面板。它复用现有管理员授权和受保护 GET，不增加写路由：

- 展示当前任务及 Review／RunOnce／Inspect 阶段。数据库 pending/running 不推断为已调度、Review 成功或独立验收完成；失败/未知没有重试操作。
- 将 W5r 仓库归档与实时读取的数据库任务、准确 stack、完成回执及 provider 摘要匹配，匹配后才显示独立验收历史成功。固定归档 canonical SHA 为 `441957641641ebfd712ff087e5ed1329345b3c71195915452ec7741234346099`。原 W5r 记录保持不变。
- 提供三个准确 GitHub run 链接、执行源码/批准/云计划/回执/验收 SHA。只构造固定仓库及数字 run ID URL，不公开 S3 私有对象、原始业务行、payload、lease 或凭据。
- 区分“当前新任务”和“上次验收归档”。新任务不能借用旧成功或旧 SHA。校验失败不回退旧绿色状态。
- 承载标签倒计时使用服务端时间快照加浏览器单调时间，不依赖浏览器系统时钟。它不是新的审批领取窗口，也不证明在线、清理或停费。刷新按钮仅刷新平台记录，没有自动 GitHub/AWS 轮询。

面板始终 `canDispatch/canApprove/canRetry=false`、`liveCloudChecked/githubLiveChecked=false`。原请求写入口仍默认关闭，POST 的 origin/管理员/幂等/过期回执门禁保持；全局队列未开启。其他实例不显示这条单租户证据，不把固定 sandbox 归档泛化为其它租户部署能力。

### 实际验证与代码位置

新投影/归档校验在 `lib/deployments/deployment-progress-v1.ts`、`deployment-progress-evidence.ts`；实际服务端接线在 `initialized-platform-management.ts`，页面在 `components/admin/DeploymentProgressPanel.tsx`。没有修改已验收的初始化合同、云执行源码、两部署 workflow、IAM 或旧永久槽。

本机14项新增投影/真实组件 SSR 测试、10项既有请求/领取合同、14项授权/客户隔离/页面回归及13项既有审批衔接回归，共51项通过，生产构建、类型检查与定向 lint 通过。原76文件云闭包仍为 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`。SSR 测试编译真实 TSX、使用真实 React/Next context，不是复制静态 HTML；未声称完成真实浏览器登录/视觉验收。新增 `Deployment progress panel - No AWS` CI 只做校验/构建，没有 OIDC、AWS/Neon 凭据或部署步骤。

另对真实 Neon 原任务进行一次只读核对：两次只读事务，当前完成回执与固定归档匹配，三个 run ID 与面板一致。见[本地只读证据](F:/ChatGPT_workshop/techlong-w6a-readonly-progress-20261019-a.json)，SHA `33f7268138de6a65f13f8147f08f7d13c29c7ca5aa9dece3f7d51e0ec531f020`。该核对没有业务写、AWS 调用、Secret 值读取、GitHub dispatch 或新槽消费。

## W6b 接线审查：尚未实现实际调度

2026-10-19 后续：**W6b 具体方案和注册待审代码已准备**，见 [控制器定案、完整风险及单仓 App 清单](aws-auto-deployment-platform-w6b-controller-plan.md)。选定本地平台 + Neon 独立审批账本 + 单仓 GitHub App，后续云候选精确绑定实测 App actor；发现现有 caller/runtime 固定个人 actor，不能只换 token。注册 URL/元数据白名单核对与纯公开材料校验已编码，不是已安装身份或实际调度器；注册/安装本身先待批准。以下保留原问题及边界。

目前不能把本机调度脚本直接放进平台 HTTP route。代码审查发现：

1. `job-dispatch-v5.mjs`、ROOT 材料与已安装证据绑定固定 job/app/前驱及永久槽；不能只替换浏览器 job ID、重用原 SHA 或清空 journal。下一新任务必须重新构造受审计划，并核对现有 IAM 是否覆盖准确证据前缀，不自动扩大权限。
2. `approval-handoff-local-v5.mjs` 使用本机 AWS Login、Git credential helper 和 F 盘文件槽；平台有 `cloudflare:workers` 依赖。不能将个人凭据、owner SQL URL 或 F 盘假扮平台云调度身份，不能在 Web 请求中 spawn 原脚本。
3. 需要持久化的审批 SHA/截止时间、dispatch intent/准确 ACK、未知状态和独立验收关联；不可把这些状态塞回已批准 job payload 破坏合同。持久化位置/窄事务及部署运行环境先集中定案，SQL 安装另审。
4. 当前租户栈仍保留。新请求/承载重建的前驱、namespace 和资源处置必须明确批准；不因标签到期而推断栈已删除，也不重复创建同名收费资源。

最短候选路径是复用已验证的 Review/RunOnce/Inspect 协议，在平台服务端接受管理员精确批准，以受限 GitHub App 安装令牌调度准确 workflow，并保持 environment 人工审批。GitHub 官方说明此接口支持 installation token，要求仓库 Actions write；该权限是仓库级能力，**不是仅允许这一个 workflow 的外部 ACL**，仍须单仓安装、控制器白名单和安全储存私钥。[官方接口及权限](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。这是待审方向，不是已经创建 App/Secret 或获得权限。

W6b 下一小阶段先集中确定：新任务参数化边界、平台服务端运行位置、GitHub App 单仓权限与私钥保存、审批元数据持久化、准确资源处置范围；随后一次性实现实际编排并进行一条新任务真实验收。代码/文档可继续提交，创建 App/Secret、SQL schema/业务写、IAM/云发布或实际 dispatch 仍按具体清单另批。不增加旧 generation 探针或离线模拟支线。

## 当前边界

W6a 不是无审批自动部署，不代批 GitHub environment，不开放普通队列，也没有平台整体 AWS 托管上线。没有重新开启请求入口、创建任务、调用收费 Cell、续期、删除或触碰 F3c9/Sites。50 USD/月是预算目标，既有 W5r 资源及父 Cell/数据库仍可能持续收费；到期标签不保证停费，实际资源处置另批。

回到[W5r 完成事实](aws-auto-deployment-cloud-worker-w5r-completed.md)或[主线](aws-auto-deployment-mainline.md)可追溯此前执行，但不重放已终态任务。
