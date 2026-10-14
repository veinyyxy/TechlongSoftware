# D002 C4e：准确连接与 Secret 版本 IAM 三写待审

**已执行/仅历史（2026-10-14 Winnipeg）**：用户确认本最终SHA后，唯一Run三写成功，紧随独立Inspect确认实际默认v4/原v3保留及准确IAM文档一致。双槽永久消费，不得再次执行或刷新重放；下文0写/槽不存在和待批准均为审阅时历史事实。[实际结果与唯一下一主线](./aws-auto-deployment-aurora-dual-mode-c4e-runtime-iam-executed.md)。

2026-10-14 America/Winnipeg。[C4d真实Secret及独立回读](./aws-auto-deployment-aurora-dual-mode-c4d-runtime-secret-executed.md)后，继续首轮部署主线。三写入口、独立Inspect、代码及实机只读策略验证已完成；**本轮IAM/AWS写、SQL连接、Secret值/私密读取和新槽消费均0。** F3c9继续封存。

## 最终 SHA 与准确三写

`785b18c85d29e32c2c54a4d1c20fbffe4b0d7928adad86fafc2817222f2188ce`

准备2026-10-14 23:08:50.064 UTC / Winnipeg18:08:50.064 CDT；有效至2026-10-15 05:08:50.064 UTC / **Winnipeg2026-10-15 00:08:50.064 CDT**。r1没有产生执行SHA；r2的1c9be0d9...已被最终解析/状态检查修正后的r3取代，不执行。错误/过期SHA在凭据/AWS/槽之前拒绝。

所有资源仅属于账户402010193138，数据库/Secret均ca-central-1。仅三项持久IAM写，不是临时grant窗口，也不会自动撤权：

| 顺序/API | 准确现有资源 | 变更 |
| --- | --- | --- |
| 1 CreatePolicyVersion / SetAsDefault=true | policy/TechlongSandboxServiceRoleBoundary，ID ANPAV3GNMXTZHXSTCQBZC | 克隆当前v3全部旧语句；追加两项principal-ARN限定连接Allow及一个准确新Secret的错误/缺失VersionId Deny，新版本设为默认 |
| 2 PutRolePolicy | role/TechlongSandboxTenantLifecycleTaskRole，ID AROAV3GNMXTZDIWVT3BKN；inline ImmutableReceiptsAndGenerationSecretRead | 旧四项语句原样保留；追加准确postgres IAM连接和准确Secret/version读取 |
| 3 PutRolePolicy | role/TechlongSandboxTaskRole，ID AROAV3GNMXTZLH2AU5I5G；新inline ConnectExactExpressTenantC4e | 仅一个准确应用SQL用户的IAM连接Allow，无Secret读取或postgres连接 |

完整policy ARN为 `arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary`，role ARN均为 `arn:aws:iam::402010193138:role/<上表准确名称>`。不创建/替换role或managed policy对象，不改trust、boundary关联、标签或attached policy，不改execution inline，不调用SetDefaultPolicyVersion/删除旧版本等额外API。

准确连接资源：

- 应用：`arn:aws:rds-db:ca-central-1:402010193138:dbuser:cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/tenant_a0da1748bc4d5419_role`
- 生命周期管理：`arn:aws:rds-db:ca-central-1:402010193138:dbuser:cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/postgres`

每条连接Allow同时用`ArnEquals aws:PrincipalArn`限定对应原IAM role ARN，不能交叉使用；这是角色ARN，不是assumed-role session ARN。[AWS principal条件规则](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-principalarn)。授予该角色现有/未来合格ECS会话的持久能力，不限定单一task/deployment/epoch/调用次数。postgres连接会继承准确集群中该现有管理SQL用户的权限，不是应用DML或租户行过滤；本轮没有授予/修改SQL权限。

Secret完整ARN为 `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1-T9CqN5`，固定版本 `0f45d29f-02d4-4117-99b1-c06645aa3c6e`。生命周期新增GetSecretValue Allow带`StringEquals secretsmanager:VersionId`；boundary新增同一完整ARN的`StringNotEquals VersionId`显式Deny，错误版本或不传VersionId都被拒绝。execution既有宽前缀Allow不删除，但不能覆盖这项Deny。其它Secret/旧Full语句不变，不配置新的Key或Secret资源策略。[AWS VersionId条件键](https://docs.aws.amazon.com/service-authorization/latest/reference/list_secretsmanager.html)。

Secret使用默认AWS-managed key，本次不追加KMS授权；官方GetSecretValue规则要求在使用客户管理Key时额外授予该Key的kms:Decrypt。这里未实际测试解密，也不把通用规则当作当前SCP/session/KMS有效访问证明。[官方读取权限规则](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html)。

## 共享 boundary 的全部影响范围

fresh ListEntitiesForPolicy核对完整无截断：只有下列7个role作为boundary使用，无user/group，也没有作为普通permissions policy的使用者。

| 角色 | RoleId |
| --- | --- |
| TechlongSandboxTaskRole | AROAV3GNMXTZLH2AU5I5G |
| TechlongSandboxTenantLifecycleTaskRole | AROAV3GNMXTZDIWVT3BKN |
| TechlongSandboxTaskExecutionRole | AROAV3GNMXTZJHJWAN4IR |
| TechlongSandboxCodeBuildRole | AROAV3GNMXTZOK74TOJ7W |
| TechlongSandboxDeploymentWorkerRole | AROAV3GNMXTZMR72QS7FW |
| TechlongSandboxJanitorExecutionRole | AROAV3GNMXTZBRVMWJVKS |
| TechlongSandboxSchedulerInvokeRole | AROAV3GNMXTZA6QTHNW3I |

两项新数据库Allow只匹配app/lifecycle的准确principal ARN，不授予其他五角色这两项新连接能力。**新Secret的版本Deny会同时影响全部7个boundary使用者**：它们对这个Secret省略VersionId/读其它版本的请求都会被限制，即使其既有identity策略有宽Allow。不改变其它Secret或旧Full目标，亦不证明账户上所有其它管理员/role/resource/session政策无法访问该Secret。

当前仅有v3，默认文档SHA f2d25335...；不把已不存在的历史v1/v2说成保留。新增默认文档5750 UTF-8字节，低于保守6144检查；新版本号采用AWS实际响应，不伪造v4。原v3必须保留；已有版本数超过4、缺失v3、外来trust/ID/consumer/inline/default文档变化即停止，不自动删除版本以腾位置。[版本配额与API](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicyVersion.html)。

## 实机验证与执行机制

最终Review-r3只读32个AWS/CLI元数据调用，准确Source、物理Express17.9/FREE ACTIVE、真实Secret/固定AWSCURRENT元数据保持；三项Source写许可模拟均allowed/无缺失上下文。六组SimulateCustomPolicy使用完整候选identity+boundary：应用连接应用用户allowed/postgres implicitDeny；管理连接postgres allowed/应用用户implicitDeny；execution/lifecycle正确Secret版本allowed；execution错误和缺失版本explicitDeny。只做策略模拟，没有AssumeRole、签发数据库token、GetSecretValue或SQL连接，不能当作实际IAM/KMS/SCP/session/PG登录验收。

初始r1在首个多资源模拟返回处拒绝，0写/0槽；实机响应将准确结论放在ResourceSpecificResults，而汇总层使用服务模板占位ARN、混合其它条件缺失。已修正为严格读取请求中准确资源的子结果，不使用占位ARN/汇总结论冒充成功，并增加回归测试。r2通过后仅收紧截断/版本目录/时钟检查和“旧状态只表示安装未证明”的分类，r3为唯一最终清单。r1/r2和10次前置只读诊断均保留，本阶段共96个计数的元数据调用，无写入/私密读取/槽消费。

6项针对性测试、typecheck、syntax和定向lint通过；真实CLI错误SHA在LOCAL_BINDING拒绝，所有AWS/写/SQL/值读取/槽均0。254当前代码pins+2原工具；原251代码、C4d实际ARN/回执及双槽不变，Backend153efbc执行源码与已验镜像保持，不重建或发布。

Run正常33个metadata、最多3个IAM写；成功独立Inspect正常30个metadata、0写，各模式上限48。新固定install/inspect槽分别为 `techlong-d002-express-c4e-iam-install-v1.permanent-slot.json`、`techlong-d002-express-c4e-iam-inspect-v1.permanent-slot.json`（F:/ChatGPT_workshop），当前均不存在。写前重新核对完整IAM快照、实际Secret、Source写模拟、六组策略模拟和物理事实，临时凭据快照独立STS且至少剩120秒，再消费槽。严格固定三API/三input及journal，SDK maxAttempts=1；不派发其它IAM API。

Run消费槽/可能提交后无论成功、失败或响应未知，都先做本范围唯一独立Inspect，不重跑写。Inspect核对当前文档、原trust/ID/tags/attachments/consumer、原版本保留及唯一新增默认版本；仅完全匹配才报告IAM_DOCUMENTS_INDEPENDENTLY_OBSERVED_NOT_RUNTIME_VERIFIED。原样旧状态只报告安装未证明，部分/外来状态要求审阅，不补齐或回滚。IAM传播可能使一次回读不确定，不自动循环回读。

## 完整风险与后继边界

- 三写非原子/非CAS，可遗留新默认boundary或部分持久inline能力；没有自动撤权、回滚、补齐、重试或删除版本。即使后续回读失败，这些能力也可能已生效。
- boundary更新同时作用于7个role。版本Deny会阻断它们对新Secret缺/错版本的读取；正向连接条件只匹配两个准确role，但其现有/未来ECS会话可能立即利用新能力，不是单个受审task或短时grant。
- 生命周期获得postgres管理连接及四项运行时私密key读取能力；既有SQL管理权限不是租户DML/行过滤。此轮不实际访问，模拟不证明有效SCP/session/KMS、传播或真实数据库认证。
- 仍保留旧宽前缀读取能力和旧Full语句；新Secret版本限制不是账户范围整体隔离。所有其他principal/resource policy访问未完整盘点。
- Source仍高权限管理员，AWS Login刷新/临时凭据可失败；ARN/RoleId检查不能消除并发删除重建或权限变化，提供者可以记录元数据。新角色重建必须停下新审阅。
- direct IAM更新可能使既有基础设施管理资源发生drift；后续CloudFormation或手动更新可能覆盖default/inline。原`s3-bootstrap.template.json`、Stack或旧执行槽不修改/重放，不承诺CFN永久维持本次权限。
- 两新槽永久消费，超时/响应丢失/本地文件失败可遗留未知权限状态。唯一Independent Inspect不是自动补偿或实际访问证明；无自动复位或重试。
- 不新建计算资源或Cell，不调用Lambda/ECS、不发布ECR、不读Secret值或私密源、不连Neon/SQL、不改业务/authority/SQL LOGIN/GRANT。既有Secret/Aurora等仍可能计费，50 USD/月不是硬cap。没有证明其它既有runtime已停止。

[准确文件SHA、实机策略结论与唯一继续位置](../ops/aws-sandbox/reviews/aurora-express-c4e-runtime-iam.prepared.json)。用户确认本最终SHA及上述范围/完整风险后，才执行一次三写Run并立即独立Inspect。后继最小SQL授权、实际TLS IAM登录/完整ready初始化及ECR→ECS分别fresh具体批准；不重启F3c9或新增Grant/恢复支线。
