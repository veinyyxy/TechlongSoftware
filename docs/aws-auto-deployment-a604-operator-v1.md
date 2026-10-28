# a604 免Web本机operator：已发布，待单次委托与真实验收

本次新增的连续衔接入口与历史 Review 超时事实见[最小连续衔接](aws-auto-deployment-a604-continuous-review.md)。它要求额外外层SHA批准，不升级原Review-only grant，不重放已消费槽，不自动调度RunOnce；本次仅代码/测试，没有生产运行。

2026-10-27 状态更新：新包上传及固定版本独立核验、双工作流、本机 SOURCE 绑定和现有角色 trust-only 发布均已完成；reusable 固定 `e658f7b88ab50b4ff3c5653d46866b859fbadfe1`。旧测试修复源码 `c06c0a6feaf9f7e0806dd396cc7346708bcdf2fa` 的准确 CI 40602836192 已通过。本机 `--check` 返回 `A604_OPERATOR_SOURCE_PUBLISHED_REQUIRES_REVIEWED_GRANT`，但 `executionAuthorized=false`：尚无 a604 新委托/计划/调度或实际部署验收，不能重放已消费的包/发布槽。当前继续点与历史证据见[主线](aws-auto-deployment-mainline.md)。

本次收尾仅统一准备快照期限及更新文档/测试，不读生产配置/私钥/Secret、不连数据库、不调用AWS、不消费执行槽或dispatch。真实私密读取、数据库/云副作用和部署仍各按准确范围审批；GitHub environment只能由用户本人批准。默认云模块模板仍关闭，实际受审工作流携带的 SOURCE publication 已发布，两者不可混淆。

## 已接线与实际启用边界

新增固定a604本机CLI，复用原审计→计划登记→账本begin→单次App调度→API ACK保存/数据库确认及token撤销流程。适配由源码工厂显式提供，旧9b CLI、默认scope/历史/slot不变，没有JSON、CLI参数或环境变量选择profile的入口。a604三个模式分别使用新的永久槽和新审计前缀，不重用任何9b grant或槽。

Review和RunOnce调度前由独立reader重读完整受审业务/任务/保护快照，移除本轮新任务的控制记录后必须匹配真实衔接基准；所有模式还比较受审八条旧计划的稳定元数据、状态和proof，不仅检查旧任务ID。Inspect跟随已完成RunOnce，不能再要求任务保持held；它核对受信账本前驱和原执行描述符，由既有云worker独立读取业务/资源，不把本机旧快照冒充当前健康。

可信三写发布入口现已覆盖 **Review→RunOnce** 和 **RunOnce→Inspect**：准确ACK/run和固定版本内容重建通过后，依次observe、proof、publish，独立回读并验证仅本轮变化。a604初始没有旧的自身计划，第一跳允许空“本任务历史”；第二跳只允许原Review和RunOnce两计划、两批准/两attempt，Review必须已真实OBSERVED并有匹配proof。全部旧任务及受审旧账本完整保留。

第一跳比较真实held原事务时间和完整事后状态，不用basis创建时间重写payload。第二跳要求新任务已succeeded/attempt1/无lease，只新增一条准确完成回执，其余业务/旧任务/旧账本/保护不变。原claim/complete编译器以原Review、原请求来源和真实完成时间重建预期payload/回执；回执SHA必须匹配成功RunOnce报告，四字段execution descriptor绑定相同basis/review/run/report。仅有“success”字样或重算摘要不能替代这些核验。

**本机衔接入口代码已齐且 SOURCE 已发布，不等于生产就绪或端到端验收完成。** 两个三写入口都有独立永久槽、准确SHA、六/四版本对象边界和独立回读；包/新事实/工作流/trust 已按独立清单完成，委托执行仍未批准。下一先取得当轮限定只读许可核对真实现状，再准备准确委托与计划；不能提前开Review、人工拼Inspect计划或把RunOnce成功当成独立验收。

## 历史草稿能力（实际包上传已完成，不重放）

PreparePackageSaved仅核对固定封存seal、十四份原件及旧package原件摘要，重建实际衔接候选，排除新held行得到明确标记的终态投影，再用原证据编译器生成序列化候选包。原执行、provider、回执、退役和版本对象必须完整重建，不能仅替换jobID。草稿使用实际准备时间作为createdAt，事实时间仍固定为真实衔接/独立采样，不因多次准备滚动有效期。

输出为 `CANDIDATE_NOT_APPROVED`，upload/runtime/newFactsWindow均未批准。包内basis是本地草稿内容，不是已激活的生产basis或当前数据库健康证明；新事实48小时窗口仅为固定规则提案。原basis截止仍保留2026-10-27T18:47:57.695Z／温尼伯13:47:57.695CDT，是否已过不影响保存草稿，但绝不延长旧授权。上传、新事实窗口、工作流/trust发布与实际运行必须另审。

完整候选含历史业务元数据，仅写本地私有工作目录，**不提交GitHub**。上述草稿本身不授权上传；实际上传已由独立包入口按准确清单完成，此处没有S3写端口，也不应再次准备/上传同一包来重置期限。

新grant准备只使用当轮明确允许的只读阶段生成、真实 `checkedAt` 后 **不足5小时** 的环境与账本快照，与工作流发布准备共用 `SNAPSHOT_MAX_AGE_MS`。2小时后的原件可在5小时内准备；恰满5小时、未来时间、非法时钟/采样时间均拒绝，不能把 `checkedAt` 改成现在。源码、完整基准、空新账本等检查保持；准备快照变长不延长实际grant、seed/plan、任务领取、workload或事实期限，也不替代运行前独立实时核对。

## CLI与上限

入口 `ops/platform-a604-operator-v1/local.mjs`：

- `--check`：私密读取、SQL、AWS、dispatch均0；
- `PreparePackageSaved`：准确CI三GET、封存本地原件和源码pin，输出未批准草稿，不读配置内容、不连数据库或消费执行槽；
- `PrepareGrantSaved`：要求源publication已另批发布，核对fresh环境/账本材料、源码/CI及配置/私钥元数据；不读私钥或配置内容；
- `DispatchReviewed`：准确新grant SHA及模式/plan SHA，最多每模式一次调度，不调用GitHub批准API；
- `PrepareAdvanceSaved` / `AdvanceReviewed`：准确新外层SHA，最多一次Review后继三写和独立回读，不dispatch。
- `PrepareInspectSaved` / `AdvanceInspectReviewed`：独立准确外层SHA，最多一次RunOnce后继三写，发布Inspect但不调度；保留原执行描述符和原截止，不领取业务任务或写资源。

实际本机 SOURCE publication 描述符独立于冻结104文件云源码，已按准确发布清单固定审核模板及reusable pin，再按既定规则绑定当前受审main；不产生提交SHA自引用。默认云模块模板仍UNPUBLISHED，计划/授权不能自行填PUBLISHED绕过受审源码组合。即使 SOURCE 已发布，真实操作仍要求新的准确grant/manifest、对应CI、现状及单次槽核验。

调度每模式上限沿用原流程：配置全文件1读、验证TLS连接2条、SQL/RPC100、Source STS1、IAM审计权限模拟1、条件审计PUT1、私钥1读、token1签发/一次dispatch/一次revoke尝试；CI3GET、环境最多2GET。Review可在审计持久化后新增准确seed1条。新审计前缀必须单独证明Put允许，原9b前缀允许不能替代。Inspect本机预检不做held基准比较，其后由云端独立验收实际状态。

每个三写发布入口上限：配置1读、验证TLS连接2条、SQL/RPC100、STS1、准确run GET2、CI3GET、observe/proof/publish各1。第一跳固定版本S3 GET最多4，第二跳最多6（result、原Review envelope、RunOnce report、execution descriptor、package、installation）；每份1MB且精确版本/hash，不开放任意前缀扫描。无私钥、App token或dispatch。Inspect启动须预留12分钟（含本机最多2分钟操作及至少10分钟后继窗口），每次写前再次核对剩余10分钟；不刷新原workload/basis截止或RunOnce claim窗口。

永久槽为 `techlong-a604-delegation-v1-Review/RunOnce/Inspect.intent.json`、`techlong-a604-publisher-advance-v1.intent.json`、`techlong-a604-inspect-publisher-v1.intent.json`；实际路径固定在本地工作目录。槽不删除/改名/复位。未知ACK、部分SQL提交或撤销失败保留已知API ACK，停止不自动重跑、补齐、清理或伪记“本人点击”。

## 完整风险与继续边界

owner凭据权限比用途宽，整份配置进入内存；私钥仅在账本begin成功后读取用于App签名，token与数据库操作可能涉及提供者日志。TLS和不输出凭据不能保证内存/日志绝无暴露。权限模拟不是实际成功保证，固定版本或source检查也不是跨服务CAS。

审计、GitHub dispatch、token撤销、各条SQL和本地回执不构成单一事务，可能出现审计已存而未调度、API已ACK但账本确认失败、三写只完成部分、永久槽已消费但资源未变化。严格无重试不保证自动恢复；失败需另审准确只读回读。状态/保护漂移必须停止，不能修改基准求通过。

50USD/月是预算目标不是硬停费；现有资源可能继续计费，本阶段无续租或删除。下一获取另批的新鲜现状：最多一次固定Source STS和65次现有AWS元数据核对，随后一次既有配置全文件读取、一条验证TLS的Neon只读连接/最多45查询，核对新held任务、空新账本及旧业务/保护；不读Secret值或私钥，不连接Aurora，不写或调度。整份本机配置进入内存、网络与提供者日志风险必须明确接受。只有准确现状吻合，才能准备下一份委托与准确计划；不重复已完成的包/事实窗口/双工作流/trust发布，不重置原期限。全部材料与授权就绪后才连续完成Review→RunOnce→独立Inspect，不扩大F3c9、UI、身份探针或镜像支线。
