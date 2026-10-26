# 主线收敛：一轮 sandbox 自动部署验收

2026-10-26。目标仅为现有实例的一轮真实 Review → RunOnce → 独立 Inspect，不新增产品功能或通用控制框架。代码存在、镜像发布、CI 成功均不等于这一轮业务验收成功。

## 核对结论与本次最小修复

W9o 已完成新镜像 ECR 发布及独立撤权核验；W9p 已完成现有 ECS 更新代码/测试，但没有实际更新。新恢复协议的桥提供 Review/后继计划核心逻辑，平台控制器和单次 Inspect 入口也已有；缺的是该桥的受审生产发布组合。旧 `openProductionPublisherV6` 固定旧 release，不能换一个输入就冒充新协议授权。

本次只新增 `ops/platform-recovery-launch-v1/` 本地 operator：复用原桥、原 publisher 数据库/版本对象读取器、原 TLS/角色/OID/函数体核验与原账本。只支持 `PublishReview`、`AdvanceReview`，没有创建业务任务、dispatch、App 签名、IAM、Secret 或承载写能力。后续平台批准和 GitHub environment 批准仍由用户完成。

不修改镜像保护目录或 97 项云闭包，不重新构建/发布镜像；不改旧绑定风险原文。F3c9、UI 和非主线功能继续停止。本阶段不访问 AWS/Neon，不读取 `.env.local`/PEM/Secret 值，不消费永久槽。

## 唯一执行顺序

1. 新代码与关联 CI 通过。另获限定只读许可后，用新的 AWS 快照生成 W9p 准确更新 SHA；不能复用过期快照或旧批准。
2. 用户批准准确 W9p 更新清单并确认可连续配合约40分钟，才更新现有 ECS。另起进程执行原 W9p 独立 Inspect；必须核对实际新 revision、镜像、source 和 control lease。期间冻结 main，结果先存本地，不提交移动运行源码。
3. 从该真实 manifest、update-intent、独立 Inspect 原件及已发布 package 准备 `PublishReview` operator SHA。用户另批后，只登记同一 held 任务的一条 Review，回读准确计划；用户在 AWS 平台单次批准，再批准准确 GitHub environment。
4. Review 真成功后，用其准确 plan/run 和固定版本结果引用准备 `AdvanceReview` SHA。用户另批后，先完整重建新 envelope/inner manifest、原件与真实 run，再至多写一次观察、一条证明、一条 RunOnce 计划。保留原 claimBy，页面批准期至少提前8分钟截止；不自动调度。
5. 用户单次批准平台 RunOnce 和其 GitHub environment。成功后复用现有 `ops/platform-recovery-control-v1/cli.mjs` 的 `prepare-followup` / `follow-runonce`，另按准确 SHA 批准一次独立 Inspect。记录资源、服务和业务回执，不能用平台的 `completed/success` 观察替代可信独立内容证明。

所有材料齐全前不启动短租约，不重新登记 held 请求。原业务基础固定在 **2026-10-27T18:47:57.695Z（温尼伯10月27日13:47:57）** 截止，不自动续期或换代重试。若剩余时间不足，保留原件并停止，不以另造任务绕过固定槽。

## 工程内入口与材料

无副作用检查：

```powershell
node --experimental-strip-types ops/platform-recovery-launch-v1/local.mjs --check
node --experimental-strip-types ops/platform-recovery-control-v1/cli.mjs --check
```

未来 `PrepareSaved` 的 material 仅允许五项：`packageFile`、`hostingManifestFile`、`hostingIntentFile`、`hostingInspectionFile`、`action`。路径仅限 F:/ChatGPT_workshop 下指定目录，不能传数据库 URL、profile、endpoint、SQL 或私钥。

`action` 为 `{ "operation": "PublishReview" }`，或 `{ "operation": "AdvanceReview", "planSha256": "<准确Review SHA>", "runId": "<准确run>", "resultReference": { "key": "<准确结果键>", "versionId": "<准确版本>", "sha256": "<内容SHA>" } }`。引用必须来自真实原件，不推导版本号。package 必须与 PUBLISHED binding 的完整内容摘要一致。

```powershell
node --experimental-strip-types ops/platform-recovery-launch-v1/local.mjs --mode PrepareSaved --material F:/ChatGPT_workshop/techlong-recovery-launch-material-<新后缀>.json --ci-run <准确CI> --output F:/ChatGPT_workshop/techlong-recovery-launch-prepare-<新后缀>
node --experimental-strip-types ops/platform-recovery-launch-v1/local.mjs --mode RunReviewed --manifest F:/ChatGPT_workshop/techlong-recovery-launch-prepare-<新后缀>/manifest.json --approved-sha <operatorSha256> --ready-at <三分钟内新的用户在线确认UTC> --output F:/ChatGPT_workshop/techlong-recovery-launch-run-<新后缀>
```

批准的是同时包含内部 review、material 和所有 hosting 原件摘要的 **operatorSha256**，不是 inner manifest 或单个 plan SHA。PrepareSaved 最多3次认证 GitHub GET 和配置 ACL/大小元数据读取，无 AWS、配置内容、数据库或槽。有效期最多24小时且受原业务截止限制，执行时还须有效的实际 hosting lease；批准期限不是新的租约。

## 上述未来执行的完整风险与范围（本次未批准）

- 每动作最多一次读取现有 `.env.local` 全文件到内存，以其中既有 owner URL 建立两个经证书验证的 TLS 连接（写客户端及独立读客户端），总计最多100条 SQL。先核对旧任务、业务准入、历史账本和保护布局，再消费固定永久槽。没有 DDL、授权、业务表写或任务领取。owner 凭据原有权限宽于这些操作；代码限制不是数据库最小权限隔离。
- `PublishReview` 最多一次准确 `publish_plan`；`AdvanceReview` 最多三次提交：`observe_run`、`attest_evidence`、`publish_plan`。仅成功内容重建后写观察，虚拟 OBSERVED 只用于内存验证，不能当作真实记录。最后用另一连接回读准确计划/证明；这不等于业务部署验收。不同 SQL 非原子，可能留下仅观察、仅证明或未完整发布状态。
- 既有 Source 登录凭据只在内存使用，最多1次 STS核对、6次指定私有证据桶固定版本 S3 GET（每项最多1MB）、2次准确 GitHub run GET，另3次 CI/分支 GET；maxAttempts=1，不自动刷新、重发或派发工作流。S3 只能读取本轮结果、其 envelope、绑定的 recovery package 和 installation；不读控制私密包、AWS Secret 值或 PEM。package/本地原件含历史业务/审查元数据，不提交 Git。
- 无法保证提供者/本地日志、内存或凭据彻底清除；网络错误、提交响应不明、并发、角色传播和托管状态变化仍有风险。源码/pins/ACL/版本检查和独立回读不是跨服务 CAS。失败可能已写部分账本，不自动补齐、撤销、回滚、删除、复位或重试。
- 两个固定槽为 `techlong-recovery-launch-v1-PublishReview.intent.json`、`techlong-recovery-launch-v1-AdvanceReview.intent.json`，均在 F:/ChatGPT_workshop 下，消费后永久保留。旧所有槽/记录不动。SHA错误/过期/源码或租约不符在私密读取前停止；槽消费后即使实际写为0也不自行重放。
- 每动作最长两分钟。只接受有效的30分钟以内原 hosting lease、同一 source/release，以及三分钟内新的人工在线确认；开始Review发布时租约须剩余15分钟以上，Advance仍须保留原8分钟领取窗口。到期不取消已发请求，也不停止承载或费用；50 USD/月是预算目标，不是硬上限，S3/日志/网络可能产生低额费用，现有承载持续计费，清理另审。

本文件是风险与操作索引，不是执行清单。实际 ECS 更新、SQL 发布、RunOnce 和独立 Inspect 各以具体准确 SHA 与范围批准；不因“开始下一步”而自动扩大权限。
