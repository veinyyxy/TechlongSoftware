# a604 免Web本机operator与新包草稿

2026-10-27。仅代码、测试、文档和封存本地材料准备。生产publication仍关闭；本阶段不读生产配置/私钥/Secret、不连数据库、不调用AWS、不上传或发布、不续期、创建任务或dispatch。实际权限、云部署和新期限仍各按准确范围审批，GitHub environment只能由用户本人批准。

## 已接线与未完成部分

新增固定a604本机CLI，复用原审计→计划登记→账本begin→单次App调度→API ACK保存/数据库确认及token撤销流程。适配由源码工厂显式提供，旧9b CLI、默认scope/历史/slot不变，没有JSON、CLI参数或环境变量选择profile的入口。a604三个模式分别使用新的永久槽和新审计前缀，不重用任何9b grant或槽。

Review和RunOnce调度前由独立reader重读完整受审业务/任务/保护快照，移除本轮新任务的控制记录后必须匹配真实衔接基准；所有模式还比较受审八条旧计划的稳定元数据、状态和proof，不仅检查旧任务ID。Inspect跟随已完成RunOnce，不能再要求任务保持held；它核对受信账本前驱和原执行描述符，由既有云worker独立读取业务/资源，不把本机旧快照冒充当前健康。

可信三写发布入口仅处理 **Review→RunOnce**：准确ACK/run和固定版本内容重建通过后，依次observe、proof、publish，独立回读并验证仅本轮变化。a604初始没有旧的自身计划，允许空“本任务历史”，但完整保留其他任务的旧账本。真实held行在新basis之前已存在，必须比较原事务时间和完整事后状态，不用basis创建时间重写payload或伪造requestedAt。

**连续部署链仍未就绪：RunOnce→Inspect的受信内容核验/证明/计划发布CLI还需收口。** 现有云协议和publisher组合已支持该内容路径，但本机三写CLI尚未扩展到这一跳；不能据此提前启动Review、直接人工拼Inspect计划或宣称端到端已完成。

## 新包草稿不等于新事实批准

PreparePackageSaved仅核对固定封存seal、十四份原件及旧package原件摘要，重建实际衔接候选，排除新held行得到明确标记的终态投影，再用原证据编译器生成序列化候选包。原执行、provider、回执、退役和版本对象必须完整重建，不能仅替换jobID。草稿使用实际准备时间作为createdAt，事实时间仍固定为真实衔接/独立采样，不因多次准备滚动有效期。

输出为 `CANDIDATE_NOT_APPROVED`，upload/runtime/newFactsWindow均未批准。包内basis是本地草稿内容，不是已激活的生产basis或当前数据库健康证明；新事实48小时窗口仅为固定规则提案。原basis截止仍保留2026-10-27T18:47:57.695Z／温尼伯13:47:57.695CDT，是否已过不影响保存草稿，但绝不延长旧授权。上传、新事实窗口、工作流/trust发布与实际运行必须另审。

完整候选含历史业务元数据，仅写本地私有工作目录，**不提交GitHub**。新上传key/内容SHA与准确新包将绑定后续审批；此处没有S3写端口。新grant准备也只能使用后续另批只读阶段生成、两小时内的真实readiness，不能拿早上封存快照冒充fresh。

## CLI与上限

入口 `ops/platform-a604-operator-v1/local.mjs`：

- `--check`：私密读取、SQL、AWS、dispatch均0；
- `PreparePackageSaved`：准确CI三GET、封存本地原件和源码pin，输出未批准草稿，不读配置内容、不连数据库或消费执行槽；
- `PrepareGrantSaved`：要求源publication已另批发布，核对fresh环境/账本材料、源码/CI及配置/私钥元数据；不读私钥或配置内容；
- `DispatchReviewed`：准确新grant SHA及模式/plan SHA，最多每模式一次调度，不调用GitHub批准API；
- `PrepareAdvanceSaved` / `AdvanceReviewed`：准确新外层SHA，最多一次Review后继三写和独立回读，不dispatch。

除包草稿和check外，默认UNPUBLISHED source gate在任何生产I/O前拒绝。计划/授权不能自行填PUBLISHED打开入口。后续source publication描述符独立于冻结104文件云源码，固定审核的模板及reusable pin，再按既定规则绑定当前受审main；不产生提交SHA自引用。

调度每模式上限沿用原流程：配置全文件1读、验证TLS连接2条、SQL/RPC100、Source STS1、IAM审计权限模拟1、条件审计PUT1、私钥1读、token1签发/一次dispatch/一次revoke尝试；CI3GET、环境最多2GET。Review可在审计持久化后新增准确seed1条。新审计前缀必须单独证明Put允许，原9b前缀允许不能替代。Inspect本机预检不做held基准比较，其后由云端独立验收实际状态。

三写发布上限：配置1读、验证TLS连接2条、SQL/RPC100、STS1、固定版本S3 GET最多4、准确run GET2、CI3GET、observe/proof/publish各1。无私钥、App token或dispatch。原子业务衔接已完成，不会在本入口重复取消/新建任务。

永久槽为 `techlong-a604-delegation-v1-Review/RunOnce/Inspect.intent.json` 和 `techlong-a604-publisher-advance-v1.intent.json`；实际路径固定在本地工作目录。槽不删除/改名/复位。未知ACK、部分SQL提交或撤销失败保留已知API ACK，停止不自动重跑、补齐、清理或伪记“本人点击”。

## 完整风险与继续边界

owner凭据权限比用途宽，整份配置进入内存；私钥仅在账本begin成功后读取用于App签名，token与数据库操作可能涉及提供者日志。TLS和不输出凭据不能保证内存/日志绝无暴露。权限模拟不是实际成功保证，固定版本或source检查也不是跨服务CAS。

审计、GitHub dispatch、token撤销、各条SQL和本地回执不构成单一事务，可能出现审计已存而未调度、API已ACK但账本确认失败、三写只完成部分、永久槽已消费但资源未变化。严格无重试不保证自动恢复；失败需另审准确只读回读。状态/保护漂移必须停止，不能修改基准求通过。

50USD/月是预算目标不是硬停费；现有资源可能继续计费，本阶段无续租或删除。下一先补齐RunOnce→Inspect受信发布，再获取准确新鲜元数据和新包/事实窗口/工作流/trust最小审批；全部衔接材料就绪后才启动Review。不要扩大F3c9、UI、身份探针或镜像支线。
