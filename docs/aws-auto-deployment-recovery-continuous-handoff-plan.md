# 连续执行方案：先整体审批，再开窗并立即登记 Review

2026-10-26（温尼伯）。这是待实现方案，不是执行清单或云/数据库写入授权。仅收敛现有 sandbox 自动部署主线，不新增产品功能、IAM、镜像、schema、业务任务或通用编排框架。

## 实际状态与本次关闭点

现有承载已单次更新到revision10/source `d07516395ff7abbd15bff6bcb869ffd8916f2082`，另进程独立核验健康、DNS、镜像及权限通过，其他10项资源物理身份不变。原事务时间绑定也已通过真实Neon只读核对：配置1/TLS1/查询12/写0，完整状态摘要与封存原件相同。

后续Review清单d646…的确认到达执行检查时，已是19:10:48，超过“租约剩余须大于15分钟”的19:09:06门限。因此没有调用登记入口，没有读配置、连接数据库、消费登记槽或写计划。不是凭据或清单SHA失效。该轮业务流程在未登记状态关闭；不再使用旧批准，不修改云端租约。原租约19:24:06自然到期并不停止Web或费用。

原件：`F:/ChatGPT_workshop/techlong-recovery-continuation-executed-verified-20261026-a.json`，SHA `0ec69f56b0e940e1e4917f251c46ce037e6811a0fef7d26cfd06f8b82e37fbe8`，16份引用已逐一核验。原W9p和后继continuation的运行/Inspect槽均已消费，永不复用；PublishReview槽未消费。历史提案、清单、失败记录和回执保持原样。

## 唯一最小改动

新增一个固定revision10的本地连续入口，不做第三个可单独“开窗后等审批”的入口。执行前将更新、独立Inspect、Review登记三阶段的源码、原件、准确目标、派生规则、预算及风险绑定到**同一份外层manifest SHA**，由用户一次明确批准并确认现在可连续配合40分钟。随后同一进程连续完成：

1. 准确CI/main/pins、Source身份、现有承载完整基线及Neon只读基线预检；旧租约必须已到期。全部通过后才消费新固定尝试槽。
2. 最多一次UpdateStack，仅替换source/30分钟ControllerLease及依赖Service；租约在真实更新意图时生成。镜像71e268…/config23fb…、11项逻辑资源、角色、三个固定Secret版本、网络/DNS/证书/日志及历史HostingExpiresAt标签不变。
3. 另进程独立只读Inspect，核对真实新revision、token/事件、source/lease、镜像、其他10物理身份、健康和权限。失败则停止，不登记Review。
4. 用该次真实manifest/intent/独立Inspect，按外层已批准的固定规则派生内部PublishReview清单；重新核对Neon/原事务证据/空Review账本，仅提交一次准确publish_plan，再用另一连接回读。登记完成即退出连续入口，不dispatch。
5. 此后仍由用户在平台单次批准准确Review计划，并批准对应GitHub environment。AdvanceReview、RunOnce、业务资源部署和最终独立云Inspect不在本次连续写入许可内，仍按准确结果及SHA分别批准。

## 提前审批与未知SHA如何绑定

未来外层manifest必须固定当前revision10、既有栈UUID、原source/lease/token、原请求/业务basis、原件摘要、完整源码pin、准确CI、配置ACL元数据、单次槽、总副作用及所有可派生字段的规则。不能接受任意child manifest或外部回调来扩大目标。

内部Review的真实时间、实际hosting intent及独立Inspect摘要只有更新完成后才存在，因此其SHA不可能在开窗前伪造。允许的唯一运行时派生字段及其来源必须写入外层批准：本次实际lease/intent/Inspect、当前受审源码、受审CI、真实生成时间及原封存package。派生内部SHA仅是已批准运算的输出，**不能冒充另一次用户批准**。写前保存外层批准引用、全部派生输入、内部manifest及拟写准确计划，独立回读核对真实提交结果。任何来源、scope、风险或代码变化均停止，需新审。

## 时间门禁：不削弱原15分钟余量

保留30分钟lease、登记全过程大于15分钟余量、两分钟登记操作上限和原业务basis截止。进入登记时另要求至少17分钟余量，为完整两分钟操作留足原门禁；更新、独立核验、登记整段从实际更新意图起最多12分钟，更新等待最多10分钟。超时即停止，不能等待新的聊天批准后继续旧尝试。

旧登记入口每次要求三分钟内在线确认，不能在更新后传入Date.now()伪造新回复。新连续profile必须显式实现“同一次已批准有界会话”：首次写前核对真实用户回复距今小于三分钟；后续只在该已批准连续链、原始回复的40分钟承诺和12分钟总门限内接力。旧CLI三分钟守卫保持不变。进程/额度/网络中断、提交不明或超过总门限不自动恢复、换时间或重放。

## 拟议总副作用上限（尚未批准）

- 最多一次顶层UpdateStack；普通CloudFormation回滚、旧revision托管清理和ECS固定Secret托管注入仍可能发生。没有新栈、IAM、Secret、付费Cell或代理Delete操作。
- AWS最多3次STS（运行/独立Inspect/登记各1）、元数据305次（运行240＋Inspect65）、准确固定版本S3 GET最多6次；另准确CI/main最多6次GitHub GET及准确run最多2次GET。不GetSecretValue、不读PEM或控制私密包。
- `.env.local`内容最多读取2次，验证TLS连接最多3条，SQL最多145条：更新前只读预检45＋登记/独立回读100。owner凭据权限较宽，两个阶段均重新校验ACL及原事务证据。最多一次逻辑publish_plan提交；不改业务行、旧任务/计划、schema、授权或authority，不领取任务。
- 新外层运行槽与独立Inspect槽暂定`techlong-recovery-handoff-v1.intent.json`、`techlong-recovery-handoff-v1.inspect.intent.json`（均在F盘既有证据目录）。登记仍使用原来未消费的PublishReview固定槽，第一次消费后永久保留。旧已消费槽不删除、不复位、不别名绕过；失败不自动回滚、补齐、清理或重试。

跨服务非原子/非CAS、并发、日志及整文件入内存、凭据失效、托管同步/回滚、响应不明、部分安装或收费资源遗留风险仍在。50USD/月不是硬上限，lease到期不取消在途请求或停费。未来外层完整风险必须明确这些总副作用，不能拼接两个旧批准来冒充新许可。

## 编码与验收清单

复用原严格AWS读取器、原始请求证明/保护校验、SQL/publisher及独立读取器，不改97项云闭包、镜像或Web/UI。只增加固定目标组合与最小显式会话策略。测试至少覆盖：错误/过期外层SHA在任何私密读取前拒绝；只能以真实revision10父链启动；不得伪造ready-at；内部派生字段/scope/source/风险篡改拒绝；更新/独立Inspect失败不进入登记；余量不足或中断不登记；最多1次更新/1次publish且不重试；独立读回与历史不变；旧入口默认守卫不变。

先完成代码和准确No-AWS CI。之后另获一次新的限定只读核对许可，检查现有AWS/Neon状态及空Review槽，再生成外层待审SHA。准备期不启动lease。用户批准新SHA及完整总风险、给出一次新的在线确认后才可执行；本方案不授予该许可。

原业务basis于2026-10-27T18:47:57.695Z（温尼伯10月27日13:47:57）截止，不重新计时或自动新建held任务。若不能在原窗口内完成，则保留状态并另行审核，不通过续租或修改保护基准强行推进。
