# 现有承载继续入口：代码范围及未来执行完整风险

此入口只针对已独立核验的同一栈、revision9、source806及已到期的原控制租约。不是重放W9p，不改旧回执或复位旧槽。当前仅代码实现/验证；未取得准确新SHA批准时不执行任何生产读取或写入。

## 固定范围

目标仍为账号402010193138、ca-central-1、栈`techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`。镜像71e268…/config23fb…保持，使用既有11项逻辑资源；只修改TaskDefinition公开执行source/对应Metadata和ControllerLease，Service引用新revision。角色、三个Secret完整ARN/JSON键/固定版本、空TaskRole、512CPU/1024MiB、单task、网络/证书/DNS/日志、原HostingExpiresAt历史标签均不变。

未来最多一次顶层UpdateStack、正常CloudFormation失败回滚、托管替换/旧revision清理。不传RoleARN、IAM Capabilities或新Tags，不创建新栈、IAM、Secret、schema、业务任务或Cell，不build/push镜像，不由代理额外删除、补齐或补偿。临时StackPolicy只允许TaskDefinition Modify/Replace及Service Modify。

## 执行前置与证据

原请求事务时间只能从已封存原登记seal/intent及12份原件摘要核验后获得。operator清单绑定原批准、source、core/basis、任务及事务时间，不以行created_at推导，不扩大30秒或payload校验，不重算保护基准。已保存的真实状态可用于编码回放，不等于未来执行时状态仍未变化。

PrepareSaved只读本地既有封存材料、配置ACL/大小元数据及3次GitHub CI/分支GET，不读配置内容、不连接数据库/AWS、不消费槽。AWS准备快照须在2小时内；原业务基础仍在2026-10-27T18:47:57.695Z截止，不因重新准备重计。批准最长24小时且受该原截止限制，最晚启动预留35分钟。准确CI同时记录真正被测source；仅允许已有四项指定metadata文件前进，不放行代码/测试/风险漂移。

实际RunReviewed需新的准确SHA与三分钟内人工在线确认（建议可连续配合40分钟）。先以3次GitHub认证GET重核准确CI与远端main，再以固定Source IAM身份（非Root）核对AWS完整实时基线，最多STS1/元数据240；再一次读取现有`.env.local`全文件、建立一条验证TLS的Neon只读连接，最多45条查询，以原事务证据核对完整业务/任务/账本/保护及空Review槽。查询在READ ONLY事务内设置`search_path=pg_catalog`，不写业务/控制表。全部通过、事实120秒内且源码未变才可消费新固定槽，租约仅在实际更新意图时生成，最长30分钟、不自动续期。

之后另起独立Inspect，最多STS1/元数据65、云写0，核对准确token/事件、实际新revision/source/lease/镜像、其他10物理身份、健康和权限。元数据通过不等于平台登录、Review/RunOnce或业务部署验收；所有后继登记与调度仍各按准确范围/SHA及人工环境批准。

## 完整风险

- owner URL权限宽于本次只读用途，配置整文件进入内存，数据库/提供者及本地日志、环境变量、网络和残留风险仍在，不保证内存彻底清除。代码检查不替代最小权限隔离。代理不GetSecretValue/读PEM；但ECS替换task会托管读取并注入三个既有固定Secret版本，并可能留下在途/日志数据。
- snapshot、源码/ACL/hash/角色ID核对与SQL只读事务不是跨服务CAS。并发修改、凭据过期/刷新失败、IAM/服务传播、元数据和提交响应不明可造成停止或部分结果。更新可能先停旧task而短暂中断；托管rollback/清理也可能产生额外底层写。一次顶层UpdateStack不等于底层仅一次写。
- 新槽固定为`F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-v1.intent.json`及独立`.inspect.intent.json`。一经消费，不自动删除、复位、重放、补齐或换SHA重试；旧W9p槽和全部旧材料保留。写前失败也可能留下本地输出，失败命令不自动重跑。
- 等待更新最长20分钟，并不延长原30分钟lease。排队、服务替换或人工审批慢会导致剩余时间不足；到期不取消已发请求、撤销已签发token、停止普通Web、清理资源或停费。50USD/月不是硬上限，更新/日志/流量和遗留资源可持续收费，清理另批。
- 本轮短租约业务流程须冻结main，所有中途结果先留本地，流程关闭后再提交。Source变化不能以换profile/Root绕过；原事务证据和scope变化必须新审，不能修改历史事实或自动新建held任务。

只有未来明确确认准确执行SHA及这些风险才允许RunReviewed。Snapshot模式也须另获限定只读许可；存在入口不表示批准调用。当前代码任务不授权读取生产、开窗、登记、workflow dispatch或部署。
