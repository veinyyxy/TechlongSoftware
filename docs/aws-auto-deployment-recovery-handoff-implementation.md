# 连续入口实现记录：代码阶段

2026-10-26（温尼伯）。已实现此前[连续方案](aws-auto-deployment-recovery-continuous-handoff-plan.md)，历史方案及机器提案不修改。当前无生产读取或写入、配置内容读取、SQL连接、续租、dispatch或新槽消费；尚无执行清单SHA。实际副作用须另批[完整范围与风险](aws-auto-deployment-recovery-handoff-review.md)。

`ops/platform-recovery-handoff-v1/`新增固定revision10的plan/session/operation/local四个文件，复用原严格AWS读取器与SQL/publisher。只有Snapshot、PrepareSaved、RunReviewed及同次独立InspectReviewed；无目标/profile/endpoint/slot/派生函数/运行输出覆盖参数。默认只读，检查入口无私密或网络能力。

外层SHA绑定完整预算、两组源码pin、准确同源码CI、原件及固定内部派生规则。Run先核对旧租约已到期、实时AWS/Neon完整基线、源码及初始真实回复，才消费新槽并单次UpdateStack。另进程独立Inspect成功后，使用真实intent/lease/Inspect派生内部Review并单次登记/独立回读。不会在30分钟倒计时内等待第二次聊天批准，不会签发App token或dispatch。

新会话是进程内不可JSON伪造的绑定，始终引用原始ready-at；只允许外层已批准的12分钟链及40分钟在线承诺。内部SHA不冒充新用户批准。旧手动CLI未提供会话时仍严格执行三分钟守卫，伪造会话被拒绝。更新等待10分钟、登记开始余量17分钟、登记全过程余量大于15分钟、登记操作小于2分钟不变。槽消费延迟导致事实过期也不写入。

未来后继Advance可核验本入口的准确实际hosting原件；旧W9p/continuation原件仍只按各自原schema/outcome核验，不能混用。97项云闭包、Web/镜像/IAM/schema不改。新运行/Inspect槽独立；既有PublishReview槽目前仍未消费，消费后永久保留。

本机174项新旧相关测试通过、类型与限定lint通过。测试含四分钟更新后的同次会话接力、伪造新时间/JSON票据/内部字段拒绝、旧入口守卫、错误SHA无端口调用、真实新旧revision匹配、失败不补偿/不重试、独立Inspect与登记顺序、过期事实和超时停止。封存真实revision10与原始Neon状态回放通过；默认内部Review派生使用离线模拟CI/未来revision，仅验证结构，不是新生产事实或执行授权。准确No-AWS CI与最终源码另记本地完成回执，不提前宣称其成功。

下一仅在准确CI通过后，另获新限定只读准备许可：核对当前revision10/权限/版本和准确任务空Review槽，再生成新的外层SHA。历史只读允许、旧d646批准、已消费槽和过期租约均不可复用。实际执行仍需新SHA/full-risk及一次新的在线40分钟确认。原basis于2026-10-27T18:47:57.695Z（温尼伯13:47:57）截止，不续期或自动新建任务。
