# W9p — 既有承载的新恢复镜像与短租约更新

当前仅实现与验证入口。代码/CI通过不是云写批准；本轮用户选择“先只完成代码与测试”，所以不再次读取AWS、不更新服务、不续租、不生成可执行SHA。旧快照仅作为历史证据保留。

## 最小改动与固定依据

目标是既有栈 `techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`（账号402010193138，ca-central-1），原11项资源，不创建新栈或身份。新镜像为已完成发布/独立撤权核验的准确registry digest `sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a`，config为 `sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90`，不重新build或发布镜像。

只拟替换TaskDefinition中的镜像、公开执行源码绑定及公开模板Metadata；Service将引用新revision。原execution role、三个完整ARN/JSON键/固定Secret版本、空TaskRole、512CPU/1024MiB、单task、原网络/证书/DNS/日志、普通Web入口均保持。临时StackPolicy只允许TaskDefinition Modify/Replace与Service Modify，不含IAM Capabilities、RoleARN、标签修改或其他资源更新；最长只提交一次准确UpdateStack。

模板、实际task definition、运行task digest、lease/source先按真实预期比较，之后才在副本上作经过核对的有限替换，复用原严格健康/网络/Secret/权限验证器；不修改原始回执或把失败/过渡状态归一化为成功。源码兼容证明要求从原镜像源码开始，应用、构建入口、公共绑定及97项云执行闭包字节不变；新增运维入口不能冒充镜像内的新代码。

## 后续生成清单的前置条件

需要另一次明确允许的新限定只读快照。准备阶段只接受2小时内的快照、准确已发布镜像父封口记录、全部当前源码pin、准确No-AWS CI及clean main。CI允许仅四个指定结果/准备文档文件前进，并同时记录实际被测commit，不能借此放行应用、测试、风险文档、运维代码或工作流漂移。

清单最长24小时且不超过原业务基础截止 `2026-10-27T18:47:57.695Z`；至少留出35分钟。批准期限不是运行租约。执行时必须重新读取当前完整基线，与清单逐项一致，快照在120秒内才可占用永久槽；不把旧准备快照冒充新执行事实。

30分钟lease只在实际UpdateStack intent时生成，绑定恢复release与当前准确main，不提前起算、不自动续期。提交前还要求操作者记录3分钟内的新在线配合确认；时间戳只是操作者就绪声明，不是认证或替代准确SHA批准。应由用户先明确可连续配合约40分钟，才启动受审操作。

**短租约业务流程进行期间冻结main。** 新的远端main会使准确源码绑定失效；部署结果先写本地证据，等窗口结束/流程明确关闭后再提交执行文档。不得为了提交文档而移动正在使用的源码，或放松远端HEAD核对。

## 完整风险与执行边界（尚未批准）

一次UpdateStack启用正常CloudFormation失败回滚（DisableRollback=false），不是代理额外调用RollbackStack或重试。服务采用现有maximum100/minimum0滚动策略，可能先停旧task再启动新task，出现中断；失败可能自动恢复旧revision，并清理替代资源/旧revision。正常回滚与底层托管写可能多于一次，不能将“一次顶层UpdateStack”表述为底层只写一次。没有额外创建、删除或补偿API。

ECS启动/替换task前会托管读取三个既有固定Secret版本；代理不GetSecretValue也不代表整个部署不读取私密值。IAM JSON字段选择不是字段级隔离，环境变量/已返回字符串、提供者/容器日志、在途请求或token有暴露和残留风险；不承诺到期彻底清除。不会读取本地PEM/.env或连接数据库，不改Secret值/策略、密码、LOGIN、IAM角色或boundary。

Source Login可能过期/刷新失败，快照不是跨服务CAS，服务与网络/IAM传播、并发更改、异步CFN或未知ACK可能留下新task、部分状态和持续收费资源。更新等待最长20分钟；不会为了补足操作时间而延长原30分钟lease或业务基础截止。元数据核验不等于管理员登录、控制器真实签名、业务部署或整套系统上线验收。

lease到期只关闭控制能力，不自动停止Web、撤销已签发token、停费、撤权、删除栈或Secret。原HostingExpiresAt标签是历史记录，保持不变，不是定时销毁。50USD/月是目标，不是硬上限；本轮无新资源写入，实际更新/替换/日志仍可能增加费用，遗留承载继续计费，清理须另审。

新永久执行槽 `F:/ChatGPT_workshop/techlong-recovery-hosting-v1.intent.json` 与独立Inspect槽均不自动复位、删除、补齐或重试。执行前失败不消费槽但可能保留输出目录；消费后即使未收到ACK也不得重放。成功或失败后另起独立只读Inspect，核对准确更新token/事件、新revision、十项不变资源、health及固定权限布局；不改业务状态，不调度Review/RunOnce或GitHub App token。

W9o发布/撤权已经完成，旧槽和原件全部保留。F3c9、UI和非主线功能继续停止。下一步仅在用户另行允许新快照后生成具体SHA，再按实际资源及上述完整风险批准更新；本文件及其hash本身不是执行清单。
