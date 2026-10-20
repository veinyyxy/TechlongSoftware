# W6i：App云工作流发布与现有角色trust-only受审入口

2026-10-20。W6h专用数据库凭据已完成并独立核验，不再安装、读取或验证该值。本阶段集中下一项主线：准备两份App云工作流的发布及现有worker角色trust-only变更。**代码和Prepare不是执行授权；当前未发布、改trust、读App私钥或调度。**

## 唯一拟执行范围

1. 在最新同步clean main准备未挂ref的R、S两个Git提交：仅新增 `.github/workflows/cloud-worker-platform-job-v6.yml` reusable与 `.github/workflows/cloud-worker-platform-v6.yml` caller。固定已通过CI的源码 `ca2b38d8c756dd8fb800a88ded596c93687f278f`、81文件闭包828491ec…及真实App proof1465a605…；不重做云代码/身份实验。旧W6h R/S保留历史，不重放。
2. 经新的完整SHA批准后，单次非强制推送S到已有github/main。只新增两个手动工作流，不改现有工作流、GitHub App权限、环境审批或OIDC主体配置，不创建分支。既有push CI可能正常启动，不等于自动触发新增部署工作流。
3. 单次在准确foundation stack ARN创建UPDATE Change Set，模板沿用当前Original完整内容，仅改 `WorkerRole.AssumeRolePolicyDocument` 的两项StringEquals：actor_id从14145707到App bot344813947；job_workflow_ref从旧个人V5固定引用到新V6 reusable路径和R。其余claims、identity policy、boundary、资源与配置不变。
4. 仅核对这次Create ACK返回的完整Change Set ARN，不按名称猜找。必须CREATE_COMPLETE/AVAILABLE，只有现有WorkerRole一项Modify、无replacement、Scope仅Properties、Details仅AssumeRolePolicyDocument/DirectModification/Static/Never；保存完整模板与批准模板逐字段相同后才能执行。临执行前再读准确Change Set及旧布局。
5. 最多一次Execute，`DisableRollback:true`，不删除Change Set或其它资源。等待栈UPDATE_COMPLETE后，只读核对新trust与全部绑定的其它布局，解析真正已发布workflow ID及Git blob/内容；本地main仅ff到S。随后独立新进程Inspect核验，不dispatch。

准确栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5`。

准确角色：`TechlongSandboxGitHubDeploymentWorkerRole`，RoleId `AROAV3GNMXTZK5O45RG24`。既有boundary/default版本/完整文档、inline策略/文档、attached策略、角色Path/Tags/时长、五个栈资源物理身份、环境人工审批和旧工作流终态run清单均绑定prestate。Source仍须准确IAM User与UserId，不代登录或刷新MFA。

最多一次push、一次CreateChangeSet、一次ExecuteChangeSet及一次本地ff；不新增IAM资源/权限，不改S3/DDB/Secret/Neon，不连接数据库，不读Secret值/App私钥、不mint token、不dispatch，不领取任务、不创建Cell/ECS，不开启平台/publisher运行绑定。部署核心的原有权限没有扩大，但允许取得该权限的actor及工作流改变，这是实际权限边界变更而非单纯文档发布。

## 执行门禁与命令

`ops/platform-publication-v6/local.mjs` 只有Prepare、Publish、Inspect。Prepare仅远端GET/Describe/List及本地不可达Git对象，要求新代码准确无AWS CI attempt1全success、旧81/76闭包保持、W6h完成记录存在、目标工作流缺席、旧worker无未完成run、旧trust和环境门禁准确；不重新读取凭据或业务数据。该范围不是一次全面资源/账单/Secret实时审计。

```powershell
node --experimental-strip-types ops/platform-publication-v6/local.mjs --mode Prepare --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w6i-app-publication-20261020-a
```

新清单48小时有效，展示完整年月日/温尼伯时区及UTC；只授权清单内R/S和模板。独立永久槽 `F:/ChatGPT_workshop/techlong-w6i-app-publication.intent.json` 在首写前原子占用，旧槽全保留。首轮fresh整组核验限3分钟，活动执行总限20分钟；每次写入前再核对批准期、本机源码/main/对象及Source。推送后、Create和Execute前再核对完整旧布局。SDK maxAttempts=1；循环只用于读状态，不重发写请求。

仅获得新的准确SHA批准后才可执行：

```powershell
node --experimental-strip-types ops/platform-publication-v6/local.mjs --mode Publish --manifest F:/ChatGPT_workshop/techlong-w6i-app-publication-20261020-a/manifest.json --approved-sha <新SHA> --output F:/ChatGPT_workshop/techlong-w6i-app-publication-20261020-a-run
```

独立只读检查（只在本次执行占槽后）：

```powershell
node --experimental-strip-types ops/platform-publication-v6/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6i-app-publication-20261020-a/manifest.json --output F:/ChatGPT_workshop/techlong-w6i-app-publication-20261020-a-inspect
```

任何write ACK不明、部分发布、传播未就绪、权限漂移或超时只检查并报告，不自动Publish重试、修复、撤权、回滚、删除、重新创建槽或推进本地main。Inspect不自动ff或补齐，旧/新/未知状态分开报告；过期仅可只读检查。若执行前没有消费槽就停止，也不自行重跑失败命令；先核对原因和新审批边界。

## 完整风险

- **旧个人worker失去该角色访问权**。新trust只接受App actor及准确新reusable；旧V5个人工作流文件/记录保留，但不再符合trust。发布到GitHub和修改AWS不是原子操作，中间或失败时可能只存在一半状态，造成不可用；没有自动回退至个人actor。
- 新workflow是持久云能力入口。虽然本阶段不dispatch，持有App私钥的一方以后仍可能签发token并调度它；环境仍由既有人类审核，不代批或保证所有其它操作者永不批准。平台/publisher的UNPUBLISHED不是对所有外部GitHub调用者的全局禁用开关。
- 完整模板/策略/物理ID核对不是跨服务CAS，不能阻止有权限的不配合并发操作者；角色ID检查也不能消除竞态。Git push非强制，但push和AWS执行/本地ff之间仍可能发生分支或资源漂移。branch protection强度未由本步骤提升。
- GitHub工作流注册、OIDC/IAM及CFN传播可能延迟，首次读回失败不会自动重试写入。成功push不保证角色已更新，成功Execute ACK也不保证终态成功。未知Create ACK时不按名称追认并执行；槽永久占用，不因换输出目录而复用。
- 显式禁用失败自动回滚可能遗留部分更新/UPDATE_FAILED状态、收费资源或尚未执行Change Set；没有删除/自动补偿授权。即使批准期未结束，也不能重复消费清单。旧批准不授权任何新的角色、policy version清理或资源replacement；严格差异不符立即停止。
- Source AWS Login可能自动刷新，也可能中途失效；更长清单有效期不是更长凭据寿命。远端元数据/API日志、操作者本机文件及Git对象可见，包含Account ID/ARN/部署状态；没有Secret值/App key，本步骤仍依赖现有人类Git访问凭据。
- 预计不新增持续收费承载资源，但仍有现有AWS资源费用、API/CI用量和非零费用风险；50 USD/月是预算目标，不是硬费用上限或退款保证，不升级plan。

## 后续而非本步授权

发布并独立核验后，才用真实workflow ID与R准备平台/publisher固定发布绑定和最小运行接线；原有窄凭据与App key的实际读取、登记新待审任务、Review/RunOnce/Inspect调度及AWS部署均须明确新范围。不重放已完成的旧W5r任务，不恢复F3c9支线，不使用Sites。
