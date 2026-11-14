# 日常版本发布：剩余身份的一次性安装材料

2026-11-13，America/Winnipeg。`OFFLINE_MATERIALS_COMPLETE_BINDINGS_PENDING / executionAuthorized=false`。本轮只准备材料和离线回归，**没有安装、生成密码、读取生产配置/Secret/PEM、连接数据库或调用AWS资源API**。D2-4单审批工作流的编码交付已结项；本文件是原方案另列的一次性启用依赖，不扩D2-4功能、D2-5、UI或恢复框架，不新增安装器/工作流。

11月14日已将本文件的三材料纳入[统一启用清单](aws-instance-release-activation.md)，并补齐同审批晋升的publisher独立材料；同日另按用户批准仅修正IAM草案三处Secret ARN参数分隔符，SQL/Secret模板保持原字节。当前指纹及previousSha256见机器索引，旧指纹/安装回执仍属原版本，不是修正稿的实际安装或AWS验证。以总清单为当前继续入口，这里保留原交付和风险，不代表允许重放旧读取/安装。

## 1. 已完成与这次仅准备的增量

已有控制库schema237571、三表九函数及四NOLOGIN角色通过[真实独立核验](aws-instance-release-schema-install-completed-20261113.json)。不得重放schema/grants/旧attempt。剩余仅为以下对象；没有实例/版本种子、运行时启用、ECR/承载更新或业务验收。

| 职责 | 新数据库LOGIN，只继承对应现有组 | 新Secret名 | 新IAM角色名 |
| --- | --- | --- | --- |
| 准备 | deployment_release_planner_login → deployment_release_planner | techlong/sandbox/instance-release/planner-db-v1 | TechlongSandboxInstanceReleasePlannerRole |
| 执行 | deployment_release_executor_login → deployment_release_executor | techlong/sandbox/instance-release/executor-db-v1 | TechlongSandboxInstanceReleaseExecutorRole |
| 核验 | deployment_release_verifier_login → deployment_release_verifier | techlong/sandbox/instance-release/verifier-db-v1 | TechlongSandboxInstanceReleaseVerifierRole |

账号402010193138、区域ca-central-1，Neon原控制库neondb，安装者neondb_owner只用于受审安装；不成为工作流凭据。准备/执行/核验组的既有函数ACL不变，没有新表/函数或旧业务/保护对象变更。

交付文件：

- [LOGIN事务片段](../ops/releases/login-roles.draft.sql)：三个新角色/成员/密码设置；不带BEGIN/COMMIT，不会被自动迁移/启动或发布脚本调用。
- [Secret CloudFormation模板](../ops/releases/control-secrets.draft.template.json)：准确三个Secret；由候选栈techlong-sandbox-instance-release-secrets-v1管理。
- [IAM CloudFormation模板](../ops/releases/identities.draft.template.json)：准确三个角色和三个托管策略；由候选栈techlong-sandbox-instance-release-identities-v1管理。
- [机器材料与指纹/缺项](../ops/releases/identity-installation.prepared.json)：只是材料索引，**不是安装批准SHA或当前云事实**。

各角色的托管策略名为`TechlongSandboxInstanceRelease{Planner,Executor,Verifier}BoundaryV1`。同一份独立策略同时由该角色的ManagedPolicyArns附加为身份授权、由PermissionsBoundary引用为上限；不另复制三个inline policy，不附加其他托管策略。boundary自身不授予权限，交集语义见[AWS说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)。这是本次材料的明确布局，不修改任何旧角色、boundary、CFN执行角色或OIDC provider。

## 2. 凭据与LOGIN的准确合同

未来另获实际批准后才在受审进程内生成三个互不相同的64位小写十六进制随机密码。每个Secret正文仅`connectionString`一个键，URL使用对应LOGIN、既有核准Neon主机、neondb和`sslmode=verify-full`。本轮没有密码、主机连接串或Secret值样本进入文件；不能把示例URL/空密码变成真实凭据。

Secret模板有三个**必填、无默认值、NoEcho** JSON参数，直接形成各自SecretString，不先创建空Secret、不引入密码专用Secret或额外PutSecretValue轮次。未来值只经SDK请求体传递，不放argv、日志、GitHub outputs、仓库或明文参数文件。CFN NoEcho不是绝对保密：提供者/SDK、请求处理、进程内存及误打印风险仍须在实际批准中接受；不把NoEcho参数放进Outputs/Metadata或资源名。

省略KmsKeyId使用默认aws/secretsmanager；执行前必须确认该现有AWS-managed key及准确ARN，不创建客户管理Key、不改Key策略。Secret的Ref只输出完整ARN，不能自行拼随机六字符后缀；VersionId由实际创建后的独立元数据取得，不能填AWSCURRENT或用假UUID。[Secret属性/默认KMS及ARN规则](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)。

LOGIN事务顺序已经固定：

1. 调用方BEGIN，使用绑定参数将三个密码分别传给事务内`set_config('techlong_release.<purpose>_password',$1,true)`，再提交准确片段一次。三个值必须来自同一轮已批准的三个固定Secret版本；不读取别的Secret来补齐。
2. 先检查三值均为64 hex且不同；创建三个最初NOLOGIN、INHERIT、无SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS的新角色。同名占用即停，不IF NOT EXISTS或ALTER旧LOGIN。
3. 每个只取得自己的原操作组：INHERIT=true、SET=false、ADMIN=false。安装者对新LOGIN的SET/INHERIT也显式关闭；创建者ADMIN仍保留，不声称管理员已无管理能力。没有owner成员或表/列DML授权。
4. 只为三个新角色设search_path=pg_catalog，要求它们依既有数据库权限已可CONNECT；没有则拒绝，不扩大数据库ACL。用format `%L`在服务端设置对应密码并启用LOGIN；SCRAM设置仅事务内，调用方核对后COMMIT。
5. 独立新连接核对角色/成员/函数权限、原schema/OID/空表和旧保护不变；若批准包括实际认证，则三个新LOGIN各一次验证TLS登录，只执行身份/权限元数据查询，不读业务行。技术核验成功才进入IAM安装。

不能把密码作为普通SQL占位符直接塞进CREATE/ALTER ROLE utility语句。事务内绑定设置＋固定SQL的服务端format处理这一点，仍可能经服务器/提供者的语句或hook日志暴露，实际批准必须披露。片段只接受固定三个设置/角色名，不构成通用动态SQL工具。[PG16 GRANT成员选项](https://www.postgresql.org/docs/16/sql-grant.html)。

新LOGIN仍有数据库PUBLIC的固有权限，**这不是客户行级隔离，也不保证新角色不能执行任何旧PUBLIC函数**。执行前必须核对原PUBLIC/保护布局和继承后的能力；发现不合适便停，不在这轮撤销旧PUBLIC授权或改旧SECURITY DEFINER函数来强行通过。旧目录比较只允许三新角色、其默认search_path、三条准确操作组成员及明确创建者成员增量，不能整体忽略旧角色/ACL。

## 3. IAM实际许可，不把软件校验说成IAM隔离

三个角色都仅读取自己的准确控制Secret ARN＋VersionId。GetSecretValue的StringEquals条件使用受支持的`secretsmanager:VersionId`；KMS仅准确既有Key的Decrypt，限制CallerAccount、Secrets Manager ViaService、各自SecretARN和SecretVersionId上下文，不给直接任意解密、改Key/Secret权限。[版本条件](https://docs.aws.amazon.com/service-authorization/latest/reference/list_secretsmanager.html)、[加密上下文](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)。

| 能力 | 准备 | 执行 | 核验 |
| --- | --- | --- | --- |
| 本身份STS核对、自身固定控制Secret/KMS | 允许 | 允许 | 允许 |
| 既有绑定的CFN/ECS/ALB/RDS/DNS/ECR、应用Secret元数据及图片桶存在性读取 | 允许 | 允许 | 允许 |
| 原准确租户栈CreateChangeSet/ExecuteChangeSet | 无 | 允许，release-*名称范围 | 无 |
| 准确证据前缀PutObject/GetObjectVersion | 无 | 无 | 允许 |
| IAM/Secret写、直接ECS/ELB/RDS写、CreateStack/DeleteStack、PassRole、ECR发布 | 无 | 无 | 无 |

CFN读用准确ReadStackArns，写用其子集ReleaseStackArns；不拿旧UUID、同名前缀或整个账号代替当前允许列表。Create/Execute/DescribeChangeSet授权的资源是**stack**，不是change-set ARN。Execute的名称条件兼容准确名称和实际传入ARN，仍只release-*；现有代码另核对准确CS ID/两项Modify/仅ImageUri。[CFN服务授权表](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cloudformation.html)。IAM不能证明“只改ImageUri”，也不能使同栈其他已获名称的CS天然安全；这部分仍由已测代码和原持久意图/人类门禁承担。

更新沿用原栈已绑定的CFN service role，不改RoleARN，故不新增PassRole。拥有该栈操作权的主体仍能间接使用已绑定的service role，必须如实接受该能力并核对原角色没有异常扩大，不能以“没有直接ECS写”宣称没有资源更新能力。[CFN服务角色语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html)。

支持精确资源的读绑定现有service/task cluster前缀、数据库、ECR仓库、应用Secret、hosted zone和图片桶；ECS DescribeTaskDefinition及ALB若干Describe使用Resource=*并限制ca-central-1，ECS ListTasks使用Resource=*加准确ecs:cluster。这些有区域/集群级可见面，不是只看一台服务；DescribeTaskDefinition还可能返回环境正文。图片桶HeadBucket依赖s3:ListBucket，因此也能列该桶键，不能说权限仅HEAD或不会暴露文件名；无图片GetObject。核验角色的证据范围是既有桶`instance-releases/release_*/inspection-*.json`，PutObject的IfNoneMatch由原适配器发送；本模板不声称IAM本身强制条件写。[ECS读权限](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecs.html)。

三个角色共用既有OIDC provider。已存API记录显示immutable subject前缀`repo:veinyyxy@14145707/TechlongSoftware@1323312747`，不能使用旧不带ID的测试subject。模板准备身份用该前缀＋`:ref:refs/heads/main`，执行/核验用＋`:environment:techlong-sandbox-deploy`，aud固定sts.amazonaws.com。[GitHub immutable subject格式](https://docs.github.com/en/actions/reference/security/oidc)。完整JWT本轮未取得；不会为验证模板申请token或派发工作流。该trust不绑定IAM不支持的sha/run/workflow_ref条件；实际run/源码/actor和人类environment review仍由既有代码核对。相同runner/job并非对抗性沙箱，两类deploy身份也不是两个独立人类审批域，维持原设计而不增加角色跳转或工作流。

## 4. 未来安装顺序与一次集中审批

保留同一个总安装差异表；不为三个LOGIN或每个策略各建新阶段。未来可用一份外层清单绑定这三份准确artifact、资源允许列表、凭据来源、明确上限及下述新输出派生规则，集中批准后顺序执行：

**Secret CFN创建/核对/执行及独立回读 → 一次LOGIN事务及独立核验 → IAM CFN创建/核对/执行及独立回读 → 关闭状态结案。**

仅当前一步结果完整明确才进入下一步；Secret实际ARN必须等于该固定栈输出、名称/标签/Key匹配，VersionId必须来自同一已核对创建结果/独立元数据，才允许填入已批准IAM模板。这种派生不允许换Secret、Key、角色或资源范围；不是每出现一个正常创建ID就再等一次聊天，也不是当前已获执行许可。

预计两栈各一次CreateChangeSet和一次Execute，CFN只允许Secret栈3项Add、IAM栈6项Add，IAM需CAPABILITY_NAMED_IAM。这是编排层4次写，不是底层AWS API总数；CFN会自行调用CreateSecret/Tag、CreateRole/CreatePolicy/设置boundary/AttachRolePolicy等，可能重试和发生部分进度，实际读写上限/轮询与停止窗口要在最终执行清单中列明。当前不创建CS，不把标为PreparationOnly的Metadata当成能阻止有权限人员手动执行的安全开关。

## 5. 当前必须保留的真实缺项

- 三份Secret内容/完整ARN/VersionId尚不存在，准确AWS-managed Key ARN尚未绑定；不伪造或先行生成凭据。
- IAM模板的ReadStackArns、ReleaseStackArns、ECS service/cluster/task前缀、数据库/应用Secret/ECR/zone/图片桶ARN全部是必填参数、无默认历史值。当前没有本轮承载快照，不把旧物理ID写进去；也不为补参数自动恢复环境。
- 新栈名及新角色/策略/Secret名的占用、安装者云权限、桶策略兼容、原库三LOGIN空位/权限/保护和当前OIDC门禁，需要在**实际执行准备获准后集中核对一次**；旧缺失记录不是永久不存在证明。
- 本轮原生LOGIN回归已在下述准确PG16 CI通过；本地无该CI库时skip。该结果不证明Neon18认证或CFN ValidateTemplate通过，仍需未来已批准实际核验。

原读取事实仍截至2026-11-14T02:10:40.091Z；材料文件和既有完成回执可长期保存，不因用户额度中断报废。事实过期不延长、不自动补读、不催用户趁窗口安装；后续需要时才另审一次准确预检与安装清单。本文件没有可供直接执行的安装SHA，没有新永久尝试槽。

## 6. 实际安装须另批的风险与费用

- Secret→Neon→IAM跨服务非原子；即使LOGIN事务原子，连接断开也可能COMMIT已成功。成功前一步可能遗留收费Secret、可登录角色或已授权IAM；失败/ACK不明立即停，不重复写、不自动补齐、轮换密码、down、撤权、清理或复位旧槽。
- Secret有Retain/UpdateReplacePolicy=Retain，未来失败或删栈不自动删凭据；拟议两次CFN Execute使用DisableRollback=true保留现场，不混同日常版本更新必须保留的正常CFN回滚。实际执行批准必须明确接受这一策略。
- 凭据会进入生成/安装进程、CloudFormation参数和Secrets Manager/Neon服务端内存；NoEcho/SCRAM/TLS不能消除服务商日志/调试/并发/进程内存风险。原安装者ADMIN仍在；三窄身份不是租户数据行过滤或恶意同runner隔离。旧资源策略/组织SCP/提供者hook可能额外拒绝，不能通过改旧策略绕过。
- 本轮费用0新增云资源；未来三个Secret按官方价格示例约3×0.40＝1.20 USD/月，另计API、既有存储和适用区域价格；不创建付费计算、ALB、RDS、KMS客户管理Key或证据新桶，也不保证总月账单不超50 USD。[Secrets Manager价格](https://aws.amazon.com/secrets-manager/pricing/?c=sc&p=ft&z=4)。

本次仅材料/离线回归，runtime保持false/environments={}。实际安装之后，实例/版本导入、启用、环境恢复与D2-6真实更新仍单独审定；不附带D2-5新镜像生产或买卖家业务测试。

## 本轮验证记录

新增5项材料合同回归，连同原状态/适配/更新/工作流及正式基线共142项本地通过，定向lint与全项目类型通过。既有PG16临时CI新增子测试，以原非超级用户安装者执行LOGIN片段，再用三个真实LOGIN及独立密码建立连接，核对身份/默认search_path/精确继承、原函数分工和表/owner拒绝；本地没有CI专用库，原生测试明确skip，没有连接本地/Neon/Aurora或读取其配置。CI结果以准确源码run追加，不将本地skip或JSON解析当成原生SQL/云模板已验证。

最终收尾：[源码407ddab2f2a3c780acf21ac503204545d57b3d3f的CI43540624913](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43540624913) attempt1 completed/success，已核对head SHA、offline/postgres两job及步骤；原生job132280083732日志确认7测试pass、fail0/skip0，包含三个真实LOGIN认证子测试。[证据摘要](aws-instance-release-identity-materials-ci-20261113.json)。本轮生产读写/密码生成/安装均0，runtime关闭，既有NOLOGIN安装原件保持。材料阶段到此结束；只有用户后续要求实际执行时，才另审一次集中核对、绑定准确参数和外层安装SHA，不在本轮继续读生产或安装。
