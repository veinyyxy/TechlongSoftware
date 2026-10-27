# a604 独立云协议兼容核心：尚未发布

2026-10-27。本阶段仅代码、无AWS身份测试、文档与本地材料核验；不连接生产、不读私密配置或Secret/私钥、不写AWS或数据库、不发布工作流/绑定、不延长期限或调度。本文件描述候选能力及后续批准要求，不是云运行授权。旧97文件云闭包及9b入口保持原样。

## 主线与当前边界

旧9b已单次取消并保留，新 `job_a60423b885fef3e4326213f7` 已真实创建且独立核验为held。成功并已退役的前驱仍是 `job_9db8466fd95cef0c23ad6bfc`，原run40204548444、回执、七资源退役事实不变；9b不是成功前驱，不能重用它的Review窗口或永久槽。

新增独立协议目录提供：代码固定profile/关闭的publication、完整原证据重建、固定任务的Review/RunOnce/Inspect云适配、原OIDC/STS身份保护及懒加载应用、独立新云闭包、未发布工作流文本，以及显式端口的本地可信publisher。它们不修改旧入口，不依赖Web租约，不要求重建平台镜像或为Web按钮续租。

生产默认publication为 **UNPUBLISHED**，source/release/package/activation/新事实批准均为空。任何真实模式在OIDC、AWS、Secret或数据库端口之前拒绝；环境变量和传入JSON不能选择profile、换任务或打开此source门禁。工厂参数仅供受审源码组合与自包含fixture，不是CLI或外部JSON覆盖入口。工作流渲染只返回文本，本阶段不改已发布的部署工作流或角色trust。

后续受审reusable的bootstrap将发布描述符作为**工作流源码常量**携带，不从input、环境JSON或业务包激活。为避免源码和reusable自身SHA循环，描述符只留caller source、release reusable pin、activation source及release hash四个派生槽；固定规则绑定当前caller main及reusable输入，随后由原GitHub身份/OIDC和STS的准确trust pin核验。任务/profile/包/事实批准/截止及PUBLISHED状态不从环境派生。默认模板仍UNPUBLISHED，直接CLI和仅伪造环境字符串都拒绝。实际携带PUBLISHED常量的工作流发布和trust更新必须另审，不属于本阶段普通代码推送。

## 真实事实和有效期不能混用

源profile从真实衔接材料固定：事务数据库时间 `2026-10-27T14:06:24.483Z`，独立数据库采样 `14:06:35.619Z`，事后状态摘要 `fc63f78250538658d0d193fe7eaaf69691c26a8e9aa79a6140270b7277563b88`。原件封存摘要 `864c2e510309320e8129f9372628bb473426e62119bc22227a92ae682f541f42`；候选摘要 `a649aadff64904b213bde74ed5e743773805ba2ee36c505d82d06386da6852b8`。

profile的终态投影摘要 `d049eeb3f589f78d90c33f09fa30ab5174a97915f34b87f897b06cfd0f9829c2` 明确不是数据库实读snapshot：仅排除真实新held行，完整保留canceled9b和旧历史，供重建原成功/退役证据。实际新held行仍在数据库，不能把投影用于声称它不存在、再次创建任务或修改保护基准。

原basis仍于 **2026-10-27T18:47:57.695Z／温尼伯13:47:57.695CDT** 截止。本阶段没有重建或激活新的生产basis。新profile含真实事后事实及既有48小时编译规则，但那只是待审窗口提案；必须在单独发布的源码中绑定准确新profile SHA、真实fact时间、明确的批准清单SHA和新截止，才能通过新窗口门禁。不能仅设置true、替换Date.now、复用旧批准或声称原basis已经续期。发布前仍需获准的新鲜元数据/数据库核对，防止把历史采样当成当前健康。

## 协议继承和新增限制

复用现有recovery basis编译器、原版本对象内容核验和进程内验证品牌；序列化的basis或成功摘要不能代替原执行/回执/provider/退役/capsule与版本对象重建。新包必须匹配独立新publication的basis SHA和准确S3版本引用，拒绝9b旧包或仅改job ID的包。

三种模式保持既有wire format。运行前固定仓库/owner/App actor、main、attempt1、源码/冻结源码/新闭包、准确包和任务；OIDC签名由STS验证，预检不冒充验签。仍使用原准确worker role ID、安装版本、窄数据库适配、authority/namespace检查、一次CreateStack/七承载资源/一次私密包读取/两次认证GET、原子完成回执及独立Inspect，不增加这些上限或IAM权限。

每次云进程最多4个外层版本对象读取、2次外层条件PUT、每份1MB，客户端不重试。Review写独立outer envelope/result，RunOnce写四字段execution descriptor/result，Inspect必须使用不同run ID、相同源码/basis/review及准确报告引用。应用无论模式成功失败均dispose；未知PUT或执行ACK不自动重跑、补写或跌落下一模式。底层worker内层证据/数据库/AWS预算仍按原安装契约，不包含在外层PUT数字中。

本地publisher仅组合显式端口：重建包、准确未调度held准入、Review发布、真实结果内容核验/证明及后继计划；不会自行创建连接、发现凭据或dispatch。模式和前驱proof沿用原规则，RunOnce保留8分钟衔接与90分钟workload预留，Inspect保留独立run与准确已执行报告要求。工厂测试中的内存写捕获不是生产计划、审批或部署证据。

## 尚未完成的上线前置（不可跳过）

1. 用已封存事后原件严格生成新包候选，并对新事实窗口、包上传的准确范围单独批准；不再创建held任务。
2. 准确CI及新云闭包冻结后，准备两份工作流候选、精确reusable commit、现有角色trust-only变更和固定新publication。真实GitHub发布、S3写、trust或权限修改均另审；本阶段不假定现有IAM一定允许新前缀或新pin。
3. 将免Web委托调度及可信三写发布operator接到新profile和空a604账本，保留完整旧历史；旧9b授权/slot/CLI不能调用新任务。当前本地publisher是能力组合，不是已接好生产I/O的连续driver。
4. 连续链材料/凭据与回执都就绪后才一次开启Review。GitHub environment仍由用户本人批准，agent不代批、不修改required reviewers、不扩大为后台自动部署。

## 后续真实发布/运行的风险（本阶段未授权）

新源码能力、工作流及trust发布不是原子事务，可能部分完成；版本对象、GitHub、IAM和数据库之间没有跨服务CAS，读后竞态与IAM传播仍存在。固定版本Secret可被托管注入进程，签名/token/查询可能经过提供者日志，TLS不能保证日志或内存绝无残留。单次槽可能先消费但动作未发生，结果不明必须保留原件停止，不自动回滚、补齐、重置或重试。

真实RunOnce可能留下收费资源或业务运行状态，TTL/标签不自动停费。50USD/月仍是预算目标，不是硬上限，未来部署和清理需各自批准。现有资源仍可能计费；本阶段没有验收当前健康、改变租约或批准清理。
