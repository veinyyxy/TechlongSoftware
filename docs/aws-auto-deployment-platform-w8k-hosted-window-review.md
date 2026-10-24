# W8k：现有托管控制窗口的单次受审更新

## 状态与主线

本阶段只准备最小更新入口，不执行AWS写入、计划发布、调度或登录验收。不新增job、镜像、IAM或云控制器，不扩展F3c9。目标是为既有held任务`job_6e2e115c80301595512f11fb`完成一次真正的平台操作闭环；实际任务仍待审，未被领取。

W8j已发现并纠正产物源码与执行源码混用：旧`e0043a11…413f98`清单未执行、保留历史但不可再用。镜像产物源码f3与最终受审main分开记录；应用/控制器/托管运行时及全部81项闭包必须逐一未变。**新计划、租约及一个公开容器变量绑定同一受审main**，现有`CONTROL_MAIN_DRIFT`和`ref:main`门禁完全保留。具体兼容证据随两份新清单保存，不能把兼容源码说成新镜像出处。

## 已做的限定只读核对

本轮共42次AWS元数据读取（独立原检查器36次，补充6次）。准确栈为：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`

当时CREATE_COMPLETE，11项资源，Service一个RUNNING/HEALTHY task，TaskDefinition为`techlong-sandbox-platform-web-v1:3`；ALB target健康。无待执行Change Set，无永久stack policy，仅`:3` ACTIVE、`:1/:2` INACTIVE、无DELETE_IN_PROGRESS。原模板、标签、网络、角色及三项固定Secret版本元数据通过已有验证。**这是点时证据，不保证之后仍健康。**

Source对准确栈的`UpdateStack`及`SetStackPolicy`模拟为allowed，无缺失上下文；这不是实际执行授权保证，不修改IAM。没有读取Secret值、PEM、本机连接内容，未连Neon，未消费任何新槽。

原件只存F盘：`techlong-hosted-deploy-defaults-inspect-1e710b176bd5e31bcddae438ace7d772-1792799780116.json`，SHA `32bb754487bdad0b033fa63caf7ce0790023ba9c3c9536eed425f06f53605e70`；补充`techlong-platform-w8k-window-inventory-extra-20261023.json`，SHA `b8fc2d8670b8e8861b960f097812d9b48f4d0f9e6137e7da277dfc8536b30a2d`。

## 拟议执行范围——需要新SHA单独批准

- 原Source身份最多一次准确ARN的`UpdateStack`，无新建栈、IAM、Secret、数据库或DNS变更。
- 原模板只改一个公开环境变量`TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT`为受审main；仅ControllerLease参数更新，HostingExpiresAt使用前值。原Metadata/ImageSource、镜像摘要`sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`、固定角色/三个Secret引用及其版本不改。
- 单次请求内设置临时更新策略：仅允许TaskDefinition的Modify/Replace及Service的Modify，其余隐式拒绝，不允许Update:Delete；不安装永久stack policy、不新增IAM权限。这种临时策略和禁用失败自动回滚均由[UpdateStack API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_UpdateStack.html)提供；临时override需要既有SetStackPolicy权限，[stack policy不是IAM授权](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/protect-stack-resources.html)。
- TaskDefinition的容器定义变更需要替换revision，[AWS资源规范](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)标注为Replacement。CloudFormation/ECS会更新Service、停止/替换task，可能注销或删除旧revision；这属于受审托管后果，不是operator直接删除API。
- SDK `maxAttempts=1`，单次提交；无Change Set执行、DeleteStack、SetStackPolicy独立调用或ECS写API。每进程至多300项元数据，最多60次有间隔状态查询；执行进程最多20分钟，另进程独立核验。不是AWS内部调用/重启次数上限。
- 新永久槽`F:/ChatGPT_workshop/techlong-platform-hosted-window-v6.intent.json`及`...-inspect.intent.json`，与全部旧槽独立。消费后不自动复位、补齐或重试。旧W8g CreateStack槽永不重放。

前置必须是同源码、同job的**独立回读成功且未调度**的W8j Review计划（plans1/approvals0/attempts0、heldjob未变），剩余至少40分钟；回读证据不得早于80分钟前。原W8i业务哈希仍需发布时重新核对。本更新本身不读取数据库或Secret值、不取得App token、不发布/批准/调度工作流，不等于控制面或业务验收成功。

## 时间、费用与完整风险

清单有效48小时，最晚启动预留20分钟。新控制租约在实际UpdateStack意图时才派生，**30分钟、不可自动续期**。替换/健康检查会消耗该时间；可能新task启动时租约已过，届时不重试、不续租。公开配置变更不是新的镜像构建，自动运行时仍必须验证租约/release/source。

本地回执另记录“实际意图后60分钟”的本轮承载验收意图；**不改云HostingExpiresAt参数/标签、不自动停止资源**。旧标签`2026-10-23T20:58:42.592Z`（10月23日15:58:42 CDT）已过期，仅作历史。原ALB/Fargate/公网IP等仍可能持续计费，50USD/月是目标而非上限；本清单不授权无限验收或清理，结束后需另审准确栈清理。新revision、启动/日志及流量会有非零费用。

现有Service为maximumPercent100/minimumHealthyPercent0，可能先停旧task再启新task，**存在服务中断**；circuit breaker启用、rollback=false。本请求DisableRollback=true，失败不自动恢复旧配置。CloudFormation/ECS可能在operator退出后继续更新、重启或留下收费资源；禁用失败自动回滚不等于禁止所有托管清理行为。

ECS仍会读取三个固定Secret版本并注入新task内存；传播、替换、重启可能重复，**不能保证只读三次**。Secret/提供者日志、内存、网络与托管系统都有暴露风险，版本固定并不保证权限或可用性；operator不输出/保存私钥、密码、Cookie或Secret值。控制代码可在有效租约期间依既有能力读数据库/签名；本阶段不主动调用它，不等于移除了该潜在能力。

Source SDK使用执行前获取的一组凭据；CLI元数据读取可能使用AWS Login刷新，但SDK等待中可能过期。实际授权、传播与刷新均不保证，可能提交成功但ACK/本地回执/独立核验失败。一次提交结果不明不重放，不自动回滚、补偿、撤权、删除、换槽或重试；保留全部旧记录及部分结果后另行处理。

模板、10项稳定资源ID、唯一活动revision、固定Secret版本和角色ID在执行前重读；120秒事实窗口、30秒意图窗口及客户端token不是跨服务CAS，不能消除并发漂移。第三方可能同时改main/资源，实际结果可能失败或不明。只对成功状态作显式兼容验证，原始状态证据保留，不把UPDATE_FAILED或仅GitHub success当成验收通过。

## 执行顺序与工程入口

1. 最终代码/CI成功后，在同一干净main上准备新W8j发布清单及W8k窗口清单；两者均尚未批准。**此后main冻结到本job Review→RunOnce→Inspect结束**，中间证据只记录F盘和本地检查点，结束后集中提交。
2. 先批准准确新W8j SHA，单次条件lineage Put及准确Review计划SQL，随后独立回读；新计划两小时从发布时起算。不是窗口更新批准。
3. 再批准准确W8k SHA，执行上述一次UpdateStack并另进程独立核验。不是Review/RunOnce/Inspect调度批准。
4. 后续在AWS平台由用户登录并核对具体计划/action/risk，单次调度Review；GitHub environment审批由用户完成。通过后再按各自具体范围推进RunOnce及独立Inspect，不自动跳过批准或拿Review结果冒充部署成功。

入口`node --experimental-strip-types ops/platform-hosted-window-v6/local.mjs`，实现全部保存在工程，F盘只存不可覆盖的数据。

Prepare：`--mode Prepare --output F:/ChatGPT_workshop/techlong-w8k-window-<标签> --publication-manifest F:/ChatGPT_workshop/techlong-w8j-review-plan-<标签>/manifest.json --ci-run <准确最终CI>`。只读已固定本地元数据和GitHub CI，不读私密内容或调用AWS。

RunReviewed/Inspect均需`--manifest <原manifest.json> --approved-sha <准确manifestSha256> --output <新的-run或-inspect目录>`。不同入口都检查源码/pins及不可覆盖输出；Inspect仅独立元数据，不批准新写入。过期、漂移或失败时先只读查明，不换槽重放。
