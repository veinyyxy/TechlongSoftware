# W7e：Change Set 已创建，实际差异被门禁阻止

2026-10-21。用户在本聊天确认清单 `fe75c0f9c7445f300791c55b8cb3660875b1b57aa9686e25f31430a89ca41fef` 及其中绑定的[完整风险](aws-platform-hosting-w7e-recovery-review.md)。本次完成唯一一次 CreateChangeSet 和独立只读核验，**没有执行 Change Set，基础设施恢复没有完成**。实际计划不符合受审窄范围，已停止；没有自动改代码、放宽门禁、换名重建、删除或重试。

## 唯一提交与准确对象

执行前 main=`f2c95a7d708d36348d8b8bca1a9c80ec0ed9ddf8`，工作树干净。核对清单、两份源码、风险文档及候选模板摘要；相对受验证代码 `fe9ff105f0c2c25b87dff9c007ee47837efb826a` 只有文档/审阅JSON变化。Source准确为账户402010193138的IAM User techlong-sandbox-dev。未遇到凭据过期，不需要因这次范围阻断而刷新身份。

19:32:14.595Z至19:32:16.443Z的新只读前置核验通过：准确CREATE_FAILED栈、原模板/三资源、缺失角色、原ECR/零镜像、未使用v1 boundary，以及完整空Change Set列表。核对原已消费CreateStack槽未变后，排他写入新审阅槽并fsync，再提交一次固定工厂生成的UPDATE请求；SDK maxAttempts=1。

- StackId：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-image-foundation-v1/5db98d40-cd82-11f1-8f8c-06fff229a471`
- ChangeSetId：`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/platform-image-locked-trust-recovery-v1/ec0f7450-b25e-47e8-bd2b-7a9dcfe080a3`
- 提交响应记录：2026-10-21T19:32:16.809Z（温尼伯14:32:16CDT）；requestId=`478da93f-8868-4b6f-b3ca-9fa670ed8bc0`。AWS报告CreationTime=19:32:17.281Z。
- ChangeSetType=UPDATE，CAPABILITY_NAMED_IAM，空参数，无RoleARN；IncludeNestedStacks=false、ImportExistingResources=false，没有额外恢复/执行参数。

19:32:38.267Z的唯一DescribeChangeSet轮询即为CREATE_COMPLETE/AVAILABLE。这里只表示计划可供执行，**不是批准执行或资源已恢复**。

## 独立回读与拒绝原因

19:33:40.645Z至19:33:41.660Z使用新客户端独立核验。准确Change Set的GetTemplate与受审候选语义及SHA `01c4ab5a4cfd0d40f33592f388ab77003162dee22a00d2b9c221bcc79a76914d` 均一致，但CloudFormation返回以下完整三项变化：

| 逻辑资源 | AWS报告Action / Replacement | Scope / Details | 受审门禁结论 |
| --- | --- | --- | --- |
| PlatformImageBoundary | Modify / False | Tags；Target.Attribute=Tags，RequiresRecreation=Never | 禁止变更boundary；拒绝 |
| PlatformImagePublisher | Modify / True | Scope=[]，Details=[] | 禁止角色替换；并非仅trust属性的无替换Modify；拒绝 |
| PlatformWebRepository | Modify / False | Tags；Target.Attribute=Tags，RequiresRecreation=Never | 禁止变更ECR；拒绝 |

原检查器首先因三项而不是唯一角色变化抛出 `PLATFORM_IMAGE_RECOVERY_CHANGE_COUNT`，没有修改检查器使它通过。即使忽略数量，实际内容也不符合原替换/属性门禁。AWS未返回Parameters字段；仅在检查器输入中将缺失空参数规范化为[]，原始服务响应完整保留。这种规范化没有删除任何Changes或弱化实质检查。

原栈与Change Set报告的三条stack-level标签相同（Project=Techlong、Environment=aws-sandbox、Purpose=platform-web-image-v1），但服务仍报告上述Tags计划。相同模板属性/标签并不能证明这些计划可忽略；本轮没有证明服务计算三项差异的完整原因，也不把缺失角色的Replacement=True解释为实际存在另一个角色。保留实际结果供下一次审查，不能凭推测直接执行。

## 实际资源没有被恢复或修改

独立快照通过原 `assertRecoverySnapshot`：

- 栈仍CREATE_FAILED，DisableRollback=true，无RoleARN/参数；当前栈GetTemplate仍是原失败模板，而不是将未执行的候选误认为已安装。
- ECR仍是原ARN及CreatedAt=2026-10-21T19:05:26.229Z；IMMUTABLE/AES256/scanOnPush，零镜像且无下一页。
- boundary仍PolicyId=ANPAV3GNMXTZP2F37SEFP、默认v1、正文与原批准模板一致；AttachmentCount=0、PermissionsBoundaryUsageCount=0。
- publisher直接GetRole返回NoSuchEntityException，实际ABSENT；没有新角色、会话或可用发布授权。
- 完整ListChangeSets仅有上述一个未执行计划，无分页遗漏。新旧永久槽摘要均保持。

本轮只有一个顶层CreateChangeSet写提交及一个新永久审阅槽；ExecuteChangeSet、UpdateStack、CreateStack、直接IAM/ECR写入、grant、镜像发布、部署、删除、Secret/PEM/私密包读取、数据库连接均为0。不承诺以后不会被其他高权限操作者改变，此处是非原子的独立观测事实。

## 不可重放证据

项目机器摘要：[结果JSON](../ops/aws-sandbox/reviews/platform-image-recovery-w7e.create-result.json)。外部原始证据前缀：`F:/ChatGPT_workshop/techlong-platform-image-recovery-v1.create-fe75c0f9`。

- `.preflight.json`：`b762ee3cd2713df0c06a1280a37669f7f468adbaf60fc35f8faece7f9fd6531e`
- `.submission.json`：`3f2e5040fa45c9070f734a31d12a05d159e2e097d2b95fcf7e219ad149269efd`
- `.polls.json`：`0fca5403a198011b9153e5c3766bfed6089982aee4d648fcffff280cdcc93ba8`
- `.independent-inspect.json`：`f50bfa3a07c169f66293bdde1bd35a39e7c5f9c71fae08ac969c7738d85617a4`
- 新审阅槽 `F:/ChatGPT_workshop/techlong-platform-image-foundation-v1.recovery-changeset.intent.json`：`b10faac7199ef75b68acea4ce84111c9d498c355286fe1eae0c22fc2cf30c605`，已永久消费。
- 原CreateStack槽SHA仍为 `67481e505428ea0efe92ee887d75357858d1ed91f85aaea3f28ad566d1f954cd`，保持消费，不复位/重用。

原批准JSON的approved=false是批准前历史快照，未改写。原风险文档、原失败创建工厂、新恢复工厂和所有受审摘要保持不变。清单到10月23日14:24CDT才过期，不代表已消费槽可以再次提交。记录为文档/结果JSON，不改变执行代码，不重跑已通过的代码CI或重新上传约330MB镜像。

## 唯一后续方向

当前计划**不能依据原批准直接执行**，也不应仅凭另一条“继续”静默放宽门禁。下一步先只读研究失败栈恢复语义与实际三项差异，确定能否保留原ECR/boundary身份和配置，再准备新的具体变更范围、执行门禁及风险供单独审批；若必须改走其他恢复路径，同样重新审查。当前不删除/替换旧对象、不创建另一个Change Set、不消费新槽、不自动补偿。

恢复基础设施、开放发布权限、发布镜像、两小时平台托管及清理仍分别审查；两小时hosting窗口尚未开始，50USD/月仍是目标而非全账户硬上限。当前没有运行中的本地窗口、CI或等待批准的云执行任务。
