# W8m：只恢复准确旧栈，不开启部署窗口

## 结论与主线

W8k 的 f7d7dfdc…784d4 已执行一次并失败：`DisableRollback=true` 与 TaskDefinition 替换不兼容。单次更新已获回执，栈为 UPDATE_FAILED；独立 Inspect 未通过。两个旧槽永久保留，不能重跑旧命令。原 11 项物理资源、旧 :3 任务定义和健康服务当时未变，但新控制租约没有生效。完整失败证据原件留在 F 盘，不提交私密材料。

本阶段只实现、测试和准备恢复清单，不执行云写。旧 Review 已过期，失败链已关闭；为本次新准备提交的源码，不继承旧计划的 source 绑定。保留同一个 held job、两个旧计划及所有批准/调度唯一性约束，不发布第三个计划，不复位槽，不扩展 F3c9/UI。

最快顺序为：**恢复现有栈稳定状态 → 准备正常回滚模式的兼容更新 → 新的源绑定审核及平台闭环**。本清单只批准第一步的有限云操作；后两步不搭车执行。

## 准确资源与当前只读证据

- Account `402010193138`；region `ca-central-1`；Source `arn:aws:iam::402010193138:user/techlong-sandbox-dev`。
- Stack `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`。
- 准确失败根事件 `85327af0-cf74-11f1-be5e-02452f6c634b`，准确历史 CREATE_COMPLETE 根事件 `56682f40-cf14-11f1-b123-06fff904f861`。
- 恢复目标仍是原 11 项资源、原模板和参数、TaskDefinition `techlong-sandbox-platform-web-v1:3`、镜像 `sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`，不升级镜像。
- 2026-10-24 08:41 CDT 的只读核对仍为 UPDATE_FAILED，旧服务 running1/pending0；该准确 ARN 的 RollbackStack 权限模拟为 allowed、无缺失上下文。实际 Prepare 和执行前仍重新核对；模拟不能保证实际授权、传播或执行成功。

历史稳定状态、失败回执和槽记录均以固定原件哈希验证。新的清单绑定最终干净 main、逐项源码 pin、无 AWS 的准确 CI、稳定事件及最新失败事件、当前健康旧任务和准确资源布局。事实窗口最多120秒，不能用准备时的旧快照替代执行前核对。

## 待批准操作：最多一次 RollbackStack + 独立只读核验

请求只含 `StackName`（上述完整 ARN）及新清单绑定的 `ClientRequestToken`。不传 RoleARN，不启用 RetainExceptOnCreate，不提交 TemplateBody，不调用 UpdateStack、ContinueUpdateRollback、DeleteStack、ECS 写或 IAM 写。

执行前要求该栈仍处于同一次 UPDATE_FAILED、完整事件历史里具有准确已知 CREATE_COMPLETE、11项资源身份未变、旧运行配置/Secret版本引用/镜像完全相同、服务与目标健康、没有待执行 Change Set 或永久 stack policy，且只有 :3 ACTIVE、:1/:2 INACTIVE。任何漂移或权限无法证明都在写入前停止。

只有明确批准准确 manifest SHA 后，入口才消费新的独立永久槽、落盘意图并提交一次 RollbackStack。SDK maxAttempts=1，最多60次间隔10秒的状态查询，总执行上限20分钟；这不是 AWS 内部动作次数上限。结果不明、超时、失败或本地记录失败均不再提交、不追加恢复、不补偿或删除。

成功须读到本次 token 的 UPDATE_ROLLBACK_COMPLETE，原模板/参数恢复、11个资源ID保持、仍运行健康 :3 和原镜像、旧租约保持过期。另进程独立只读 Inspect 再核验同一事实。仅栈状态、ACK 或 GitHub success 都不是业务验收成功。

新槽为 `F:/ChatGPT_workshop/techlong-platform-hosted-window-recovery-v6.intent.json` 与 `…-inspect.intent.json`。消费后不自动删除、复位、换槽或重试；旧 W8k/W8l 槽及原件也不改。

## 完整风险

1. **回滚会由 AWS 对整个准确栈进行托管协调，并非只改状态字段。** 可能修改、替换、停止、重启或删除资源，也可能失败并留下收费资源。操作员不直接调用 DeleteStack，不代表云端托管过程绝不删除。若没有上一次稳定状态，RollbackStack 可删除整个栈；本入口用准确历史稳定事件、原稳定快照及不变的资源集拒绝这种已知情形，但不能消除并发竞态或提供者行为风险。
2. 多个元数据读取、权限模拟、来源核对及写调用不是跨服务 CAS。事实窗口、客户端 token、已知事件和精确 ARN 不构成并发锁；其他主体可能在检查后改变状态，最终效果可能不明。无永久/临时 stack policy 修改或新增 IAM 来限制回滚内部动作。
3. AWS Login 可自动刷新；SDK/CLI 会话可能不同步、过期、刷新失败或受网络/权限传播影响。可能提交成功却拿不到 ACK，或者回滚仍在继续而本地等待已退出；**都不重放**。只保留证据，后续另审。
4. 服务可能中断。若托管过程替换或重启 task，ECS 可能再次读取三个既有固定 Secret 版本注入内存，次数不作保证；网络、日志、内存及提供者存在暴露风险。操作员不读 Secret 值、PEM、密码、Cookie 或本机数据库连接材料，不主动登录页面或连接 Neon。
5. 旧控制租约和 HostingExpiresAt 历史标签仍保持过期，恢复不续租、不授权控制器 dispatch，不自动停止资源。ALB/Fargate/公网IP、日志及流量等继续可能收费，50 USD/月仅为目标而非硬上限。清理、续租或新部署都需另审。
6. 新槽是永久的一次尝试记录，不因“写入未确认”自动回收。提交后不自动 down、补齐、额外回滚、重试、修改 IAM 或删除资源。恢复验证不等于自动部署主目标已验收。

## 后续兼容更新边界——本清单不授权执行

`compatibleUpdateDraft()` 只生成未提交的请求草稿：显式 `DisableRollback=false`，仍限制 TaskDefinition/Service 以及原镜像/固定版本引用，其余基础设施不变。恢复执行器没有 UpdateStack 能力。不能在 UPDATE_FAILED 直接移除参数重跑，也不能沿用旧 f7 SHA。

恢复独立验收后，才为稳定状态准备新的 UpdateStack 审核及正常失败自动回滚风险：可能重启旧服务、注销旧revision、重复注入Secret以及产生费用。任何 Review 重新发布仍需处理旧计划保留、最终main与镜像出处分离和唯一调度门禁，不能暗中放宽为第三条计划或任意重试。

## 工程入口和批准有效期

入口：`node --experimental-strip-types ops/platform-hosted-window-v6/recovery-local.mjs`。Prepare 使用 `--mode Prepare --ci-run <准确最终成功CI> --output F:/ChatGPT_workshop/techlong-w8m-stack-recovery-<标签>`，只读 AWS/权限模拟及 GitHub CI，不消费槽、不写云资源。清单有效48小时，最晚启动预留20分钟；**恢复不启动新的短控制租约**。

RunReviewed/Inspect 使用同一 `--manifest <manifest.json> --approved-sha <准确SHA>`，输出固定为 `<清单目录>-run` / `<清单目录>-inspect`。只有得到准确 SHA 及本风险范围的明确批准才执行。恢复这条链在最终提交后冻结 main 到独立核验完成；证据写 F 盘，不在链中提交新源码。

实现为 `ops/platform-hosted-window-v6/recovery*.mjs`，测试为 `tests/platform-hosted-recovery-v6.test.mjs`。没有本地 Docker、镜像发布、数据库写、IAM 安装、App token、业务任务领取或工作流 dispatch。

依据：[AWS RollbackStack API 及无稳定状态的删除风险](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_RollbackStack.html)、[失败栈更新和不可变类型限制](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)、[TaskDefinition 的替换语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)。
