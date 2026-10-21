# W7f：只补齐独立锁定发布角色，不执行失败栈恢复

2026-10-21。本轮按用户“开始下一步”完成只读分析、候选编码与验证，**没有获得或使用新的云端写入授权**。建议改走一次新栈创建：复用已存在的ECR和boundary，仅创建新名称的锁定publisher。旧失败栈、未执行Change Set、原清单、门禁和所有永久槽保持原状；不是把旧恢复门禁改宽后直接执行。

## 只读分析结论与仍未证明的部分

19:40:46.982Z的新只读记录再次确认旧栈CREATE_FAILED、旧publisher直接GetRole为ABSENT、ECR零镜像、boundary未使用。19:41:41.062Z对同一个准确ChangeSetId连续读取两种视图：

| DescribeChangeSet输入 | 实际服务输出 |
| --- | --- |
| IncludePropertyValues=false | boundary和ECR的Tags-only Modify/Replacement=False；publisher Modify/Replacement=True、Scope=[]、Details=[]，共三项 |
| IncludePropertyValues=true | 仅publisher Modify/Replacement=True；只有AfterContext，无BeforeContext；其目标是受审V1角色名、准确boundary及同一ECR-only inline/no-Allow trust |

这里没有重建或修改Change Set，也没有分页遗漏。新只读事件列表共11条，仍止于原19:05的CREATE_FAILED，没有恢复执行事件。仓库实际标签为三条业务标签加三条准确aws:cloudformation标签；managed boundary实际Tags=[]，IsTruncated=false。栈与Change Set的三条stack-level标签相同。

上述证据支持“失败角色尚未建立，详细视图反映的是缺失资源的目标配置”这一判断；但**不能证明Replacement=True可以当作无替换Add执行，也不能证明普通视图的两项Tags计划可忽略**。官方将Replacement解释为资源替换；DescribeChangeSet支持属性级前后文，却未为这组普通/详细视图差异提供足以保证安全的特例。[ResourceChange定义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ResourceChange.html)、[属性级读取](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)。

官方允许CREATE_FAILED栈用Update/Change Set继续，但同时明确禁用回滚不支持不可变更新；AssumeRolePolicyDocument本身是No interruption属性，并不能推翻实际计划的Replacement=True。[失败保留与不可变更新限制](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)、[IAM Role属性](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-iam-role.html)。因此不推荐把当前计划作为“安全的仅trust无替换恢复”直接执行，也不再用新Change Set反复试探。

另发现DescribeChangeSet返回DeploymentConfig={Mode:STANDARD,DisableRollback:false}，不同于旧栈自身DisableRollback=true；之前请求未显式设置DeploymentConfig。该字段有独立默认值，不能据旧栈状态假设未来执行一定保留资源。[DeploymentConfig默认值](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeploymentConfig.html)。本轮没有通过执行探针验证其优先级，也不改写旧清单。

原始只读证据：

- `F:/ChatGPT_workshop/techlong-platform-image-recovery-w7f.readonly-20261021.json`，SHA=`df9cdeaec9b96b68abec811785c8aff44c4baf76cb4b5d23bde92430d1dede11`。
- `F:/ChatGPT_workshop/techlong-platform-image-recovery-w7f.change-set-views-20261021.json`，SHA=`f6e342a59ee05f6d6d70ee8374a0ed48518b5e2b6a7c9cfb8af16b053122bfc4`。

## 待审的新路线：新建一个角色，不接管旧栈

新纯模块 `ops/platform-image-recovery-v2/publisher-foundation.mjs` 不包含AWS客户端、环境/凭据发现或执行器。它从已验证候选复制角色配置，只改变角色名以及将boundary的Ref改为准确现存ARN：

- 新StackName：`techlong-sandbox-platform-image-publisher-v2`。
- 唯一逻辑资源：PlatformImagePublisher，AWS::IAM::Role；新RoleName：`TechlongSandboxPlatformImagePublisherV2`。不复用缺失的旧V1角色名。
- 复用boundary：`arn:aws:iam::402010193138:policy/TechlongSandboxPlatformImagePublishBoundaryV1`；PolicyId=ANPAV3GNMXTZP2F37SEFP、默认v1、正文保持。
- 复用仓库：`arn:aws:ecr:ca-central-1:402010193138:repository/techlong-sandbox-platform-web`；CreatedAt=2026-10-21T19:05:26.229Z。
- 不把ECR/boundary声明为新栈资源，不使用Import/Export，不更新或删除原栈/Change Set；新栈没有其他资源类型。

新角色仍只有明确账户AssumeRole的Deny，**trust中没有任何Allow**，OIDC/SAML/服务/其他账户路径仍默认拒绝；MaxSessionDuration=3600。仅一个ECR-only inline policy，准确现有boundary，不附加其他managed policy、不增加PassRole/IAM/CFN/ECS/Secret权限。已有Access Analyzer验证的trust及policy正文未改变；没有重新生成或读取PEM、Secret或会话。创建角色会在其上安装这些受限身份策略，并使现有boundary的PermissionsBoundaryUsageCount预期从0变为1；这是创建IAM资源，**不是“没有IAM变更”**，但不开放任何AssumeRole入口。

候选模板3557字节，SHA=`3d9433ffe7f87549163cd9af3716eab9b362382b9e3a6c42fc0b8d7d3d49dc42`。19:45:47.202Z完成新只读名称核验，两新名称均ABSENT、新槽不存在，CloudFormation ValidateTemplate通过（NAMED_IAM、0参数）。该检查只验证模板格式/能力，不保证实际CreateRole成功；没有把校验当安装证明。

证据 `F:/ChatGPT_workshop/techlong-platform-publisher-v2.readonly-prepare-20261021.json`，SHA=`e5b8bfb85616265f3d8a431bcbfb935e6e6f6eadc5b910395cde82c7702b0fec`。这些是准备事实，不是未来执行的五分钟预检。

## 未来唯一受审写入和前置门禁

仍须确认新的完整JSON清单SHA才能执行：最多一次CreateStack，准确新名字/ClientRequestToken、由绑定纯工厂生成的TemplateBody、CAPABILITY_NAMED_IAM、DisableRollback=true、Parameters=[]、固定三条业务标签；不指定RoleARN、OnFailure、TemplateURL、导入、DeploymentConfig或其他参数。该请求是新的创建，不是旧栈替换更新。SDK maxAttempts=1。

提交前必须重新验证准确Source、代码/风险/模板/manifest摘要、干净main或仅文档/审阅提交；在五分钟内核对旧三资源、缺失V1角色、原ECR/零镜像、未使用v1 boundary、唯一旧未执行Change Set、两个新名字仍不存在。新模块的前置门禁复用原快照检查，没有削弱原门禁；旧Change Set始终不执行。所有原证据和两个已消费槽摘要不变。

新的独立永久创建槽为 `F:/ChatGPT_workshop/techlong-platform-image-publisher-v2.create.intent.json`。批准及新鲜预检通过后wx排他写入并fsync，再作唯一提交。任何槽/新名字已存在、凭据失效、状态漂移或结果不明均停止；不换名、复位、补建、自动重试、删除或回滚。CreateStack响应后仅有界DescribeStacks轮询，随后新客户端独立核验；即使失败也只读inspect。

独立验收必须证明准确新StackId/模板、唯一逻辑资源CREATE_COMPLETE；直接GetRole取得新RoleId、准确ARN/path/session/no-Allow trust/boundary；GetRolePolicy正文与候选一致，ListRolePolicies仅指定inline、ListAttachedRolePolicies为空且无分页遗漏；原仓库仍同身份/配置/零镜像，原boundary仍同PolicyId/v1/正文（AttachmentCount仍0，BoundaryUsageCount仅预期变为1），旧栈/旧Change Set/V1角色/旧槽保持。创建成功也不授权AssumeRole或镜像发布；任何不一致停止，不靠补齐权限让结果通过。

## 完整风险与后续所有权边界

Source本身仍有高权限，本地脚本/批准清单不是对Source的IAM硬限制；跨服务读取和CreateStack没有CAS，存在名字抢占、凭据自动刷新失效、IAM传播及提交结果不明风险。模板正确、名称不存在、CI成功不保证服务安装成功。

顶层最多一次CreateStack不等于底层只有一次IAM写。CloudFormation会创建角色、设置boundary/inline/标签等；底层服务处理器可能多次请求或处理失败状态，无法承诺绝对一次网络请求。DisableRollback=true关闭栈级失败自动回滚，但不保证资源处理器内部完全没有失败补偿；可能遗留空栈、部分角色或部分权限。不会由本地脚本追加Delete*/撤权/补齐/回滚或重试；部分资源需另审处理。未完成安装不代表得到可用publisher。

新角色引用的是现存boundary的字面ARN，CloudFormation没有跨栈Export/ImportValue依赖保护；原栈仍CREATE_FAILED，后续任何原栈/策略维护都必须重新审查其对V2角色的影响。既有boundary被高权限操作者修改也会影响新角色。旧原栈的PublisherRoleArn输出不是V2来源；后续发布准备必须显式绑定新栈输出和直接RoleId，不可误读V1输出。历史失败资源/Change Set不是本轮清理对象，不安装清理支线。

本清单只创建锁定publisher，不创建ECR/新boundary/OIDC provider、付费Cell/ECS/ALB/DNS/Secret，不读取Secret/PEM/私密包或连接Neon/SQL，不触发GitHub部署、ECR登录/push、AssumeRole探针、业务写入或旧计划执行。不变更旧IAM policy/trust或原资源标签。已有资源与服务费用继续；接受低成本但非绝对零费用，50USD/月仍是目标不是硬上限，两小时hosting窗口未开始。原镜像artifact12371098858在2026-10-24T18:55:49Z到期不延长；本轮不重建或上传镜像。

新批准窗口48小时；只代表可进行这一次受审提交，不延长凭据或hosting窗口，也不使任何已消费槽重新可用。过期则只读刷新材料重新确认。后续开放发布权限、单次发布镜像、两小时托管及清理仍分别具体审核。

## 工程验证

新7项独立publisher测试与原7项恢复测试共14项本地通过，类型检查及两模块scoped lint通过。原W7d工厂、W7e恢复工厂、原清单/风险文档全部摘要保持；原旧Change Set的三项差异仍被旧检查器拒绝。仅扩展现有No-AWS代码CI覆盖新模块，不重建/上传约330MB镜像，不接入Web/worker运行图。准确源码与云CI结果将在新清单中绑定；未通过之前不提供执行许可。
