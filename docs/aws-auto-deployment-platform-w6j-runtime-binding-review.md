# W6j：真实发布绑定、限时本机运行门禁与完整风险

2026-10-20。W6i工作流/trust已发布并独立核验；本阶段准备接入真实caller workflow `390829326` 和reusable `4588febb7b33378ccf2aa1a2b552a18660be8292`。**当前binding仍UNPUBLISHED，未启动运行时、读取私密值或创建新任务。** 本文也是后续逐计划批准界面引用的风险版本，全文LF归一SHA绑定在release与计划中。

## 本次待审发布只改一个公开文件

候选只将 `lib/deployments/controller-v6/installed-binding.ts` 中platform/publisher绑定改为PUBLISHED，固定真实workflow、App actor344813947、R、冻结云源码 `ca2b38d8c756dd8fb800a88ded596c93687f278f`、81文件闭包828491ec…、真实App proof1465a605…、既有installation摘要和本文SHA。publisher固定同一release摘要；每份计划/运行许可另绑caller main，不将未来自身Git SHA编入自己。

该文件独立于云运行81文件闭包；原contract.ts及冻结云工作流/源码不改。默认文件仍UNPUBLISHED，只生成一个未挂ref候选commit；**候选不因测试通过或Source刷新而自动发布**。新准确SHA批准后最多一次非强制push至既有github/main、一次本地ff及独立Inspect；只改这一个文件，不改IAM/trust、GitHub环境、Secret、Neon、旧业务记录或工作流，不新建分支。

发布是持久能力门禁变化：解除平台/publisher编译层“未发布”阻断，但不是已授权启动、读取凭据或部署。可信publisher仍需显式owner URL、准确临时AWS凭据、GitHub只读token和操作种类；浏览器不能调用owner发布/证明函数。平台仍需下一节中的本机运行许可和专用凭据，不会在模块import时发现owner密码或读取App key。

## 最小本机运行配置（实现门禁，不在本次供给）

原普通本机launcher与其secrets allowlist保持不变，不转发控制器私钥/DSN。未来专用受审启动器才可在内存供给 `TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL`、`TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY`；本次不写环境文件、不读取其内容、不启动服务。

运行要求同时满足已发布的准确绑定、两项显式本机开关和准确JSON运行许可：schema `techlong/platform-local-runtime-lease/v6`、同一release SHA、origin `http://127.0.0.1:3100`、受审caller源码SHA、issuedAt/expiresAt；有效期最多30分钟。缺失/过期/格式或摘要不符，状态/操作在读取窄DSN/App key前关闭。批准调度时计划source必须匹配许可，认证耗时后POST前再次核对许可/源码/计划/账本；不能因先前检查通过就跨过截止时间。

HTTP入口保留管理员鉴权、同源和JSON体上限；启用本机门禁时，非准确127.0.0.1:3100的GET/POST在鉴权前拒绝。专用DSN只接受既有角色 `techlong_deployment_controller_v6`、既有Neon host/database指纹、端口5432、唯一 `sslmode=verify-full` 参数，不回退owner或任意Neon host。不读owner密码作为平台凭据，不设置本地Docker或Sites。

运行许可是可信本机启动器提供的能力约束，**不是人的签名或对本机管理员的隔离**。控制本机进程/环境的人可以构造参数并另行使用其持有的密钥；浏览器会话、专用角色权限、App范围和受审启动流程仍是必要边界。页面/进程中存在owner连接的正常认证和其它应用权限，不等于控制器角色具备owner ACL。

已有旧探针模块会设置共享Neon fetch guard；控制器不继承或重置它。每次窄查询前拒绝全局自定义fetch或非准确Neon API端点，并禁止重定向；若其它模块曾修改全局配置则停止，不为了连通而放宽旧探针。JS进程/SDK全局状态仍属于可信本机执行面，不是跨线程或对任意代码的隔离保证。

## 本次发布审查与恢复

`ops/platform-binding-v6/local.mjs`：Prepare只做现有AWS/GitHub元数据GET/Describe/List、闭包/源码验证和本地未挂ref Git对象。要求准确新CI成功、真实工作流ID/路径/内容、既有新trust/模板/策略/审批状态与W6i原件匹配、两类工作流无进行中run；不读取Secret/App key、不连Neon，不重做身份实验。它不是全面账单、所有资源配置、数据库或私密材料的实时审计。

```powershell
node --experimental-strip-types ops/platform-binding-v6/local.mjs --mode Prepare --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w6j-binding-20261020-a
```

新清单48小时有效，明确完整年月日、America/Winnipeg及UTC。永久槽 `F:/ChatGPT_workshop/techlong-w6j-binding-publication.intent.json` 首写前原子占用，旧槽/原件全部保留。fresh整组检查限3分钟，活动执行20分钟，每次写入前复核清单期、源码/clean main及对象，非强制push；不自动补齐、重试、回滚、删除或复位。

仅经新准确SHA批准：

```powershell
node --experimental-strip-types ops/platform-binding-v6/local.mjs --mode Publish --manifest F:/ChatGPT_workshop/techlong-w6j-binding-20261020-a/manifest.json --approved-sha <新SHA> --output F:/ChatGPT_workshop/techlong-w6j-binding-20261020-a-run
```

然后独立新进程Inspect，绑定同一manifest/槽，允许过期后只读检查。Inspect不启动服务、不修复本地main或重发push：

```powershell
node --experimental-strip-types ops/platform-binding-v6/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6j-binding-20261020-a/manifest.json --output F:/ChatGPT_workshop/techlong-w6j-binding-20261020-a-inspect
```

## 完整风险：本次发布与后续阶段必须区分

- 本次是持久公开代码门禁发布，不是私密读取/部署授权。即使没有运行本机服务，已发布App工作流仍是持久云能力入口；持有App key的一方可能外部调度，环境审批仍需既有人类，不代批。旧个人worker不能满足W6i新trust，不自动恢复旧trust。
- Git远端、本机main和资源观察不原子，没有跨服务CAS。分支未被本步增强保护；元数据/ID校验不能阻止并发操作者。未知push/回读/ff可能留下远端已发布、本机仍旧；只Inspect，不因换目录或清单未过期而重跑。既有STS会话未由此撤销或证明失效。
- 本次不供给凭据。未来若批准启动，App私钥/专用DSN将进入本机进程内存/环境、开发工具或provider传输；不能保证内存擦除、日志不可见或本机管理员隔离。启动器必须另审读取次数、准确文件ACL、Secret固定版本、端口/截止时间、子进程转发和停止方式，不能把本次SHA当成读取许可。
- 后续平台批准调度会先在Neon原子写入人类批准和永久intent，再读取App key、签JWT、创建单仓最小权限token，发一次准确workflow dispatch并立即一次revoke；ACK先持久化。未知token/POST/ACK或revoke失败可能留token/已运行任务/UNKNOWN记录，不自动重试。状态查询也可能读取key、创建只读token并写观察记录，不能当成无副作用匿名GET。
- 计划/动作/风险SHA三者必须匹配且未过期；GitHub success只是运行观察，不是部署证明。只有可信publisher核对固定版本对象、摘要、准确run/actor/R及业务回执，单独写证明后才允许准备后继计划；不自动批准后继或延长原领取/TTL窗口，不自动poll/dispatch/重跑。owner发布能力非浏览器角色可用。
- Review只准备受审云材料，不领取任务或创建承载资源；实际云Review仍可能读取其固定控制Secret、连接Neon只读并向版本化S3/DDB写审查/围栏记录，应按其新调度清单另审，不等于绝对无云写。RunOnce另需批准单任务领取、最多一次CreateStack/七项承载资源、一次私密包读取、两次认证GET和原子完成。Inspect独立新run只读验收，不能由原执行自证。相应准确资源、窗口和费用以那份新任务清单为准，本次均不执行。
- 异步传播、网络/提供者日志、并发/提交不明和非原子失败可能留下任务intent、已发布材料、收费资源或运行实例，不自动清理、删除、down、撤权、回滚、补齐或重试；永久槽不复位。失效的Source登录需用户刷新，刷新不是新授权。
- 50 USD/月仍是总预算目标，不是硬费用上限或退款保证。既有AWS费用持续，Git/API/CI及将来部署可能非零费用，不升级plan。没有新增付费Cell/ECS或任何AWS资源的本次授权。

## 唯一继续路线

本次绑定发布并独立核验后，集中完成一次受审本机启动/最小私密供给，登记一个全新待审任务，再按Review→RunOnce→Inspect验收。每项实际私密读取/新业务写/调度/部署仍明确新范围。不重放已完成W5r、W6h/W6i安装发布或身份实验，不扩F3c9；整套系统AWS上线仍在最后。
