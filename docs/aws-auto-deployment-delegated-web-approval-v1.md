# 平台审批受限委托；GitHub 审批仍由用户完成

2026-10-26。按用户新选择，平台Web逐步批准/调度不再要求本人打开页面；技术核对和批准动作可委托给固定本地operator。**GitHub environment `techlong-sandbox-deploy`仍由用户审批**。本次仅代码实现/测试，不读取生产、不读取PEM或配置内容、不dispatch、不改GitHub保护规则、IAM、数据库schema、镜像或云运行时。旧已批准清单不包含这种新授权，不能复用。

## 最小权限与职责

`ops/platform-delegated-approval-v1/`是本地入口，不新增HTTP路由，不需要登录Web/密码/Cookie，也不依赖已过期的Web控制租约。初次真实运行前，用户仍须批准一份新委托grant SHA，明确账号/仓库/同一sandbox任务、源码/CI、模式、资源和费用风险。之后同grant可对Review、RunOnce、Inspect各批准并调度一次，免去逐条Web点击；每个GitHub run仍等待用户的environment批准。

固定范围：账号402010193138、ca-central-1、仓库veinyyxy/TechlongSoftware、实例app_e897a4377bce498b9c5ee9e64509dcad、任务job_9b57b43a6b88f37202b29170。采用已有App5381160/installation173033406、已发布recovery协议和原版本package。Review种子计划由代码固定派生；可在不存在时仅登记一次，既有所有旧计划保持。RunOnce/Inspect必须已由可信publisher登记并具备同grant源码/Review锚点及已验证前驱证明；本入口不能伪造观察、证明或把GitHub success直接当作业务验收。

委托执行只替代“平台批准与单次dispatch”。原可信publisher的完整内容重建、证据证明、后继计划生成仍是独立环节，不被跳过。不会自动批准GitHub环境、重跑workflow或扩展到任意任务；不会因不依赖Web租约就延长原worker claimBy、workload TTL或业务basis。

## 机器核对与审计

grant绑定准确同源码CI、完整pin、固定安装版本、种子计划、配置/PEM ACL元数据及GitHub环境规则快照。每次dispatch重新核对CI/main、环境规则未变且包含仓库所有者本人作为required reviewer、Source IAM身份、Neon目标/角色/OID/九函数体、准确计划及前驱。GitHub保护配置只有GET，App传输层不提供或允许批准pending deployments的接口。

环境规则字段按[GitHub环境REST接口](https://docs.github.com/en/rest/deployments/environments)核对。审计存储采用[Amazon S3条件写入](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html)支持的If-None-Match，避免同key覆盖，不以此声称跨服务原子。

一轮授权最多3次模式dispatch，各模式固定永久槽；第一次dispatch前批准此整轮范围，不需要再次Web核对SHA。真实资源上限仍为原RunOnce最多一次CreateStack/7项承载资源/两次认证GET，不新增付费Cell、IAM、Secret、业务任务，不删除资源。50USD/月是预算目标而非硬停费承诺。

每个模式的技术决定先写本地，然后向既有私有证据桶本任务/委托grant前缀**条件创建一次不可覆盖审计对象**，成功后才登记种子或begin_dispatch。审计明确记录`local_delegated_operator`、管理员为授权人、`humanWebClick:false`、grant/plan/action/risk SHA；不假记成用户亲自点击。既有SQL approvals.admin_id记录授权管理员，S3委托记录补充实际执行者及依据，不修改旧表或伪造另一个管理员。审计对象写入失败则不写控制账本、不读App私钥、不dispatch；若Source没有该准确对象写权限，停止，不自动扩IAM。

begin_dispatch成功后才一次读取现有固定本地PEM并签App token；使用既有精确权限校验/单仓库令牌/单次dispatch/一次撤销。ACK先本地保存，再写账本并由另一连接回读。已知ACK不因撤销失败被覆盖为UNKNOWN。未知提交、ACK或审计响应不重试，槽不复位、不补齐；旧槽不重用。超时或源码漂移只停止，不取消已发请求。

## 必须另批的实际副作用及完整风险

- 每个模式最多读取配置全文件1次、建立2条验证TLS的Neon连接、100条查询/RPC；初始Review种子最多一次publish_plan，批准一次begin_dispatch、一次assert_live、一次ACK；错误路径最多一次mark_unknown。owner凭据权限宽于用途，不是数据库最小权限隔离，无DDL/授权/业务行写入。三模式最多3次配置读取/6连接/300查询，均须计入委托许可。
- 每模式最多1次Source STS、1次准确审计对象PutObject权限模拟、1次S3条件审计PUT（全轮各最多3次），无GetSecretValue或代理CFN/IAM变更。权限模拟在配置读取前，不通过就停止；模拟也不保证实际PUT成功，不能消除传播/策略/并发差异。S3、数据库和GitHub非原子，可能留下审计、种子、已批准意图或已调度但未记ACK的部分结果；响应不明必须另审只读回读，不能再调度。
- 每模式最多一次PEM内容读取、App令牌签发/dispatch/撤销尝试；令牌的actions-write本身能写，代码只允许准确工作流。Git只读凭据实际权限可能更宽，仅用于CI与environment GET，不用于审批环境。配置/密钥进入内存、提供者/本地日志和残留、网络/并发/传播/源码检查非CAS风险保留，不保证完全擦除。
- 云端各模式仍有原冻结协议副作用：**Recovery Review最多3次条件证据PUT**（inner manifest、recovery envelope、result），不是早先提示中的2次；会读取固定DB Secret并只读Neon。RunOnce与Inspect各按原完整风险执行，RunOnce可能领取任务/创建7项承载/读固定私密控制材料、原子写完成回执并产生费用；Inspect不等于完全没有证据存储写入。用户在GitHub批准的必须是相应准确模式，不要Run/Re-run。未批准GitHub门禁时不会开始该环境中的任务。
- 固定槽为F:/ChatGPT_workshop/techlong-delegated-approval-v1-Review.intent.json、RunOnce.intent.json、Inspect.intent.json。一经消费，不自动删除/复位/换grant重试，原DB(job,mode)永久唯一性也保留。每次operator最多2分钟；grant最多24小时且受原basis 2026-10-27T18:47:57.695Z截止限制。云作业/排队/人工GitHub审批可能错过worker窗口，授权不会延长它们或自动停费/清理。

## 上线顺序

先代码/测试/准确无AWS身份CI；下一另获限定只读核对：GitHub环境reviewer配置和实际任务/旧计划/attempt状态、Source审计写允许范围、原准入与保护。然后仅准备新grant，明确RunOnce实际资源及费用范围，用户一次批准整轮。之后由operator代替Web批准，并只向用户提供准确GitHub run链接等候其环境审批。现阶段无任何实际delegate授权或新执行grant，旧6366…/d646…和过期租约均不使用。

Snapshot仅在另获许可后进行1次GitHub environment GET、配置读取1次/验证TLS连接1条/最多25条只读查询，核对安装布局、授权管理员、held任务及旧未调度Review；不读PEM、Secret或调用AWS。PrepareSaved仅读取这两份两小时内本地快照、配置/PEM ACL元数据和准确CI3GET。种子Review自身两小时TTL、各worker期限仍有效，grant最长24小时并不延长它们。执行时每模式重读environment配置，dispatch POST前再重读一次；两次均保留本人required reviewer。
