# W8n：恢复后的兼容更新与准确审核衔接

## 目标及已完成的恢复

本阶段只实现、测试和准备，不执行 SQL 发布或 AWS 更新。主线是使现有平台控制入口具备一次有效窗口，再继续既有 held job 的 Review → RunOnce → 独立 Inspect；不新增产品功能，不扩展 F3c9，不修 UI。

W8m 清单168d已单次恢复并独立验收：准确旧栈为 UPDATE_ROLLBACK_COMPLETE，11项物理资源身份、旧 :3 task、原镜像和健康服务保持；旧模板及参数恢复，旧控制租约过期。恢复执行槽与Inspect槽均已消费，旧W8k/W8l槽也不可重放。DisableRollback属性仍报告true，不能据此再次提交旧f7请求。

准确承载栈为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`。Source为 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，不用新增IAM。

用户允许的一次Neon TLS只读核对已完成：两条准确旧Review都过期、正文未变，plans2/approvals0/attempts0；held任务 `job_6e2e115c80301595512f11fb` 仍pending/attempt0/未领取，九项快照及六条旧任务摘要未变。本轮仅一个连接、一个只读事务、三个SELECT；不读AWS Secret/PEM，无数据库写。原件在F盘，连接信息不输出或持久化。

## 两份清单、两个独立批准，不能合并授权

1. **Review衔接清单**：准确保留两条旧计划，仅追加一条绑定最终干净main的新Review；随后独立只读回读。不是发布RunOnce、不批准/调度任何工作流、不更改承载或新租约。
2. **兼容窗口更新清单**：在第一步独立回读成功、同源码的新Review剩余至少40分钟且回读小于80分钟前后，仅一次UpdateStack及独立云元数据验收。不是Review/RunOnce调度批准，也不是业务部署验收。

旧计划不续期、不覆盖、不删除，新计划时钟只在实际发布时开始。新窗口30分钟租约只在实际UpdateStack意图时派生，不因提前Prepare或等待用户而消耗。两份操作审批均有效48小时；窗口执行最晚启动预留20分钟，仍受实际Review剩余时间限制。

## A. Review衔接的待审资源、范围与风险

准确保留旧计划SHA：

- `efeff7c2bbd24c9869cd6daccb43bdb106940ba12720fee6853c085cbdeed4e6`（源码02bc…）。
- `bc4bede6b3b61a4556efb2b3ed11f6fb3fae601f50df3770a3d0279efee1fdf6`（源码ea786…）。

新代码不是把计数门禁改为任意数量：执行前必须准确这两条完整原文/哈希、批准0/attempt0，独立回读后必须准确两旧+一新三条，仍为0/0。第四条、未知条目、任何批准或调度、旧正文改动、held状态变化都拒绝。`UNIQUE(job_id,mode)`永久调度约束保留，无DDL或权限安装。

仅使用既有owner连接和现有 `deployment_control_v6.publish_plan` 函数提交一次准确SQL。发布与独立回读合计最多2次owner配置文件读取、2次Source STS、3次固定版本S3 GET、8次显式只读事务、1次计划SQL。复用原installation和lineage版本，不PUT/DELETE S3，不写旧计划或业务任务，不读Secret值或PEM，不取得App token、不调用GitHub dispatch。

owner配置文件整体会进入进程内存；只取其中既有连接URL并校验固定数据库/角色指纹，TLS校验证书，密码不输出。该步骤仍存在文件、进程内存、连接和提供者日志泄露风险；权限函数和来源检查不能消除其他主体并发更改。S3读取、数据库提交及本地回执非原子；SQL提交可能成功但响应/记录失败，第三条计划可能已经存在。**结果不明不重放、不再追加第四条、不自动回滚或删除。**

新独立永久槽为 `F:/ChatGPT_workshop/techlong-w8n-review-resume.intent.json` 及 `…-inspect.intent.json`。一经消费不自动删除、复位、补齐或换槽。旧记录及槽保持不变。Source自动刷新可能失败，实际授权与传播不作保证；原收费资源仍继续运行。

## B. 兼容UpdateStack的待审资源、范围与完整风险

仅修改现有TaskDefinition中的公开 `TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT` 和ControllerLease参数，保持原镜像 `sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`、镜像出处f3、执行角色ID及三个固定Secret版本。HostingExpiresAt使用前值，不改历史费用标签。

请求显式 `DisableRollback=false`，允许CloudFormation在失败时执行正常自动回滚。TaskDefinition容器定义变更需要替换；旧f7的禁用回滚模式与之不兼容。兼容入口只接受已知恢复成功的 UPDATE_ROLLBACK_COMPLETE 基线，将克隆数据交给共享验证器前先验证实际成功状态、准确恢复根事件和不变资源身份；不把失败态或原始证据重写成成功。

准确临时更新策略仍仅允许TaskDefinition Modify/Replace与Service Modify，其他隐式拒绝，不允许Update:Delete；这是同一次UpdateStack中的override，不是独立SetStackPolicy、IAM安装或永久stack policy。Source对准确ARN的UpdateStack及SetStackPolicy先做只读模拟；模拟通过不保证实际调用成功。10项非TaskDefinition物理ID必须保持，新的TD必须是同family递增revision。

SDK maxAttempts=1，最多一次UpdateStack；无operator RollbackStack/ContinueUpdateRollback/DeleteStack、直接ECS写或补偿调用。每进程总元数据上限300，最多60次间隔10秒的状态查询，操作上限20分钟；AWS内部动作不受这些客户端次数限制。只有自己的token UPDATE_COMPLETE、正确新source/lease/镜像/固定引用、一个健康task和健康target才算元数据成功，另进程再独立核验。AWS进入自动回滚时不判成功，不重试更新；保留原始状态后只读核对。

必须接受以下风险：

- 正常失败自动回滚会撤销本次已完成的变更，可能删除替换资源、注销新旧revision、停止/重启task、重新注入Secret或留下不完整状态；CloudFormation回滚可能失败。**没有operator直接删除API不等于托管过程中绝不删除。** stack policy不是IAM边界，也不保证限制所有托管清理或回滚后果。
- 当前服务maximumPercent100/minimumHealthyPercent0，可能先停旧task，存在中断。现有ECS circuit breaker仍启用、rollback=false；它与CloudFormation的失败自动回滚不是同一机制，不在本次修改该配置。
- ECS可能再次读取三项固定Secret版本注入内存；替换、重启、回滚可能重复，不保证次数。内存、网络、日志及提供者均有暴露风险。operator不读Secret值、私钥、密码或Cookie，不连接Neon或登录应用来验收。
- 元数据/权限/Source/source/ref检查、120秒事实窗口和30秒意图窗口不是跨服务CAS。其他主体可并发改变状态。Source登录可刷新，但CLI与SDK不同步、刷新失败、权限传播或网络故障均可能使操作不明；一次提交可能已经成功却没有ACK。
- 新30分钟控制租约会被更新和健康检查消耗，可能就绪时已经过期；不自动续租或重新部署。本地另记意图后60分钟承载验收意图，但历史HostingExpiresAt不变，资源不会因此自动停止。
- 新revision、Fargate、ALB、公网IP、日志及流量可能产生费用；50USD/月只是目标，不是硬上限。现有资源继续收费，清理仍另审。
- 新窗口槽 `F:/ChatGPT_workshop/techlong-platform-hosted-compatible-window-v6.intent.json` 与 `…-inspect.intent.json` 永久一次，不自动复位、补齐、换槽、重试、额外回滚、撤权或删除。失败只保存证据并请求下一次明确决策。

## 工程入口、测试和顺序

实现保存在工程，F盘只放不可覆盖的数据。Review入口为 `ops/platform-review-v6/resume-local.mjs`，模式Prepare/Publish/Inspect；窗口入口为 `ops/platform-hosted-window-v6/compatible-local.mjs`，模式Prepare/RunReviewed/Inspect。所有执行模式需要准确manifest SHA，检查干净main/source pins/固定历史哈希与新永久槽。输出目录分别使用 `techlong-w8n-review-resume-*` / `techlong-w8n-compatible-window-*` 前缀，执行和独立验收输出固定为清单目录加 `-run` / `-inspect`。

先最终提交并通过无AWS CI，再准备两份同源码清单；此后main冻结到本job Review→RunOnce→Inspect闭环结束，中间证据只写F盘，不能提交一个新的main使刚发布的source绑定失效。第一份实际发布并独立回读后，才另行批准第二份更新；应用登录、用户平台批准及GitHub environment批准、RunOnce和独立Inspect仍按具体范围另审，不自动执行。

单元/回归测试覆盖准确2→3 ledger、旧正文不可改、批准/attempt拒绝、黄金旧计划SHA、正常回滚参数、成功态兼容不伪装失败、一次写/永久槽/不重试。GitHub临时PG18.6验证实际load_plan/publish_plan、三个计划原文和业务行不变及永久UNIQUE约束；其中测试数据删除仅发生在脚本自己创建的loopback临时数据库，无Neon/AWS凭据或生产fallback。

依据：[UpdateStack API（DisableRollback默认false及token）](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_UpdateStack.html)、[stack policy与替换/删除语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html)、[TaskDefinition替换要求](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)。
