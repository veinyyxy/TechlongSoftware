# 连续开窗到Review：固定范围、审批与完整风险

仅针对账号402010193138、ca-central-1、既有平台栈c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7的revision10/source d075163…及其封存父链。入口实现不等于执行授权；本轮代码/测试不读取生产。实际执行须新的准确外层SHA、完整风险确认和三分钟内真实在线40分钟回复，不能拼接旧批准。

## 固定连续范围

同一外层manifest绑定source/pins/准确CI、实际父revision10/原source/lease/token、原业务basis/任务/请求时间证明、配置ACL元数据、输出目录、永久槽、内部Review派生规则及总副作用。先等待旧租约自然到期，实时AWS及Neon前检全通过后才消费新槽。一次UpdateStack仅source/30分钟ControllerLease及依赖Service；11资源、镜像71e268…/config23fb…、角色、三个Secret固定版本、网络/DNS/日志/证书及旧HostingExpiresAt标签保持。不开新栈/Cell，不改IAM/schema/业务行，不读PEM、控制私密包或直接GetSecretValue。

更新最多等待10分钟；另进程独立只读Inspect后，按本次实际intent/lease/Inspect、固定source/CI/auth/pins/原请求证据与真实生成时间派生内部PublishReview清单，仅提交一次同任务job_9b57b43a6b88f37202b29170的publish_plan，另一TLS连接独立回读准确计划/历史。动态内部SHA只是外层已批准确定规则的输出，不冒充第二次用户批准。写前保存派生manifest和拟写计划；不接受任意child/scope/来源替换。

实际intent到登记完成最多12分钟，登记入口需至少17分钟余量，登记全过程仍大于15分钟且操作小于2分钟。初始用户确认只在首次写前三分钟内接受；新有界会话只承接该同一次真实回复、同一外层批准、同一intent/Inspect/内部清单，受12分钟链和40分钟原在线承诺共同限制。旧手动CLI三分钟守卫不变，不能用Date.now()伪造新回复。没有中途聊天批准等待、自动续租或超时恢复。

## 一次实际执行的总上限

- 顶层UpdateStack最多1次；普通CloudFormation失败回滚、托管替换/旧revision清理及ECS读取注入三个固定Secret版本仍可能产生多项底层写，不等于只有一次底层操作。独立Inspect另起进程，写0。
- STS最多3次、AWS元数据最多305次（运行240＋独立Inspect65）、准确固定版本S3 GET最多6次（每项最多1MB）；准确CI/main认证GET最多6次、准确run GET最多2次。Git凭据及Source登录凭据仅在内存使用，不输出；自动刷新/传播/过期失败可能停止流程。
- 配置全文件最多读取2次；验证TLS连接最多3条；SQL总计最多145条（前检45＋登记/独立读100）。owner凭据原有权限宽于用途，应用守卫不构成数据库最小权限隔离。只允许一次逻辑publish_plan提交，无DDL/授权/旧业务或旧计划写入，无任务领取。
- 新运行/独立Inspect槽：`F:/ChatGPT_workshop/techlong-recovery-handoff-v1.intent.json`和`techlong-recovery-handoff-v1.inspect.intent.json`；登记用既有未消费的`techlong-recovery-launch-v1-PublishReview.intent.json`。每个一经消费永久保留，旧所有槽及回执保持，不能删除、复位、补齐、重试或换SHA绕过。独立Inspect超时也不自动重跑。

## 接受的失败与数据风险

跨AWS/数据库非原子、非跨服务CAS，并发或提供者状态变化可能导致部分完成：只有更新、只有Inspect或登记响应不明。代码、ACL/摘要/角色和固定版本核对不能消除竞态；没有自动回滚业务、补偿、重连、清理或重试。提交不明时保存记录并另审独立回读，不能再发publish_plan。

配置整文件/凭据进入进程内存、子进程读取审查元数据、托管日志/网络/本地证据残留风险仍在，不保证彻底擦除。原始错误不输出，只有白名单码。替换task可能短暂中断，正常CFN回滚/旧revision清理和托管Secret注入可能继续执行；外层超时并不撤销在途请求或停止计费。50USD/月只是预算目标，日志/流量/遗留资源仍可收费，清理另批。

登记完成后立即结束自动串联，用户仍须在平台亲自批准准确Review及其GitHub environment。AdvanceReview、RunOnce、业务部署和最终云Inspect均不包含在本外层权限中，不由本入口dispatch或批准。运行开始到业务轮关闭前冻结main，证据只写本地，避免源码漂移。原basis在2026-10-27T18:47:57.695Z截止，不延长或自动新建held任务。

## 准备与命令边界

`--check`不使用任何私密/网络能力。Snapshot须另获一次限定许可：STS1＋元数据65，不读私密值/配置、不连数据库或消费槽。PrepareSaved只用两小时内快照、封存原件、配置ACL/大小元数据、准确CI3GET生成待审SHA，不开窗。RunReviewed无profile/endpoint/slot/输出覆盖参数，使用已批准manifest内的固定输出。InspectReviewed仅作为同次实际运行的独立读阶段，必须已有匹配运行槽及真实intent，不能单独开窗或登记。

当前代码任务不批准任何这些实际生产副作用。须先准确No-AWS CI通过，再另审新只读准备和最终执行SHA。
