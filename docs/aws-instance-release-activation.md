# 日常版本更新：一次性启用材料总清单

2026-11-14，America/Winnipeg。**仅材料与隔离回归，未安装、未恢复、未启用。** 复用 D2-4/D2-5，不另建安装器/工作流，不重做业务验收。机器索引：[activation.prepared.json](../ops/releases/activation.prepared.json)，`executionAuthorized=false`、`installationManifestSha256=null`；材料指纹不是执行批准。

## 1. 已完成与本轮增量

已安装的基座只沿用[真实完成回执](aws-instance-release-schema-install-completed-20261113.json)：`deployment_release` schema OID237571、三表九函数、owner及三操作 NOLOGIN。不得重放 `schema.draft.sql` / `grants.draft.sql` 或旧 attempt。原三身份材料及其指纹保持，见[既有材料](aws-instance-release-identity-installation.md)。同审批晋升的代码/CI见[上一轮交付](aws-instance-release-promotion.md)。这些记录不是新的存活/空位证明。

本轮只补 publisher LOGIN / Secret / IAM 缺项，汇总顺序及精确真实缺口：

| 受管对象 | 准确草案 | 数量与边界 |
| --- | --- | --- |
| 原控制Secret栈 `techlong-sandbox-instance-release-secrets-v1` | [control-secrets](../ops/releases/control-secrets.draft.template.json)，原字节 | planner/executor/verifier 三Secret |
| 晋升Secret栈 `techlong-sandbox-instance-release-promotion-secrets-v1` | [promotion-secrets](../ops/releases/promotion-secrets.draft.template.json) | publisher-db、backend-build-read-token 两Secret |
| 原IAM栈 `techlong-sandbox-instance-release-identities-v1` | [identities](../ops/releases/identities.draft.template.json)，原字节 | 三角色＋三策略；每份策略同时附加为身份授权和boundary |
| 晋升IAM栈 `techlong-sandbox-instance-release-promotion-identity-v1` | [promotion-identity](../ops/releases/promotion-identity.draft.template.json) | 一publisher角色＋一策略/边界，无inline |
| Neon事务1 | [promotion.draft.sql](../ops/releases/promotion.draft.sql)，上一轮已测字节 | 一个NOLOGIN组、两列、三函数；无新表/业务行 |
| Neon事务2 | [原三LOGIN片段](../ops/releases/login-roles.draft.sql)＋[publisher片段](../ops/releases/publisher-login.draft.sql) | 四个独立窄LOGIN，在同一外层事务执行；四密码分别绑定，不写在文件内 |

合计四个新CFN栈、13项受管资源（Secret5、角色4、托管策略4）；拟议安装最多四次 CreateChangeSet＋四次 ExecuteChangeSet。这个数是编排层次数，**不是底层AWS API总数**，CFN可能重试或留下部分资源。IAM栈均需 CAPABILITY_NAMED_IAM；不创建OIDC provider、KMS客户Key、桶、计算、网络或数据库。

### publisher具体权限

角色 `TechlongSandboxInstanceReleasePublisherRole`，唯一独立托管策略 `TechlongSandboxInstanceReleasePublisherBoundaryV1`。复用保存的 immutable GitHub subject前缀＋原 `techlong-sandbox-deploy` environment；这只是待核对模板值，不是本轮新 JWT/门禁实测。

- ECR写仅 `ca-central-1/402010193138/techlong-sandbox-speedfeast`：必要层上传、PutImage及原文/仓库读。GetAuthorizationToken按AWS接口需 Resource=*，另限定区域；它不是任意仓库写权限。IAM仍有向该仓库写其他tag的能力，准确候选/单push由受保护代码落实，不能声称IAM已逐候选隔离。[官方ECR推送权限](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html)
- 只读自己的publisher DB Secret和准确backend token两个固定版本；KMS只准准确已有Key、各自Secret/version上下文、Secrets Manager转发解密。四身份不共享DB密码，不给executor目录确认权，也不把owner交给runner。
- S3仅既有私有桶的 `instance-releases/promotions/` 四种准确审计键形状，只有PutObject，无Get/List/Delete。策略/边界要求存在 `s3:if-none-match`，代码仍发送 `*`；不修改旧桶策略，不声称此角色能防止其他管理员修改/删除对象。[AWS条件写规则](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html)
- 无CFN/IAM/Secret写、直接ECS/ELB/RDS/EC2写，不新增PassRole，不调用旧双镜像发布器。原三身份仍使用原模板，不附加新publisher策略。

## 2. 凭据来源与准确版本仍待绑定

新增Secret名：

- `techlong/sandbox/instance-release/publisher-db-v1`：正文仅 `connectionString`，用户 `deployment_release_publisher_login`、现有核准Neon主机/neondb、验证TLS。
- `techlong/sandbox/instance-release/backend-build-read-token-v1`：正文仅 `token`。当前代码消费固定Secret版本的现成只读token，不会用PEM自动签App token，不会把本机git凭据自动复制上云。

backend token来源、可访问准确仓库 `veinyyxy/SpeedFeast_Backend_main` 的权限和到期/撤销方式仍须用户确认。若选择fine-grained PAT，应只给该仓库Actions read及固有Metadata read；这是候选供给方向，不代表已获授权创建PAT/扩大App安装范围，不能改为全仓访问/Actions write/environment批准权。短时installation token若会在后续运行前过期不能作为常驻Secret假装可长期使用；本轮不扩token刷新服务。

未来实际批准后才在受审进程生成四个互不相同的64位小写hex DB密码，五份Secret正文经SDK内存/NoEcho参数传递，不放argv、日志、GitHub outputs或明文参数文件。本轮没有生成密码/token。两个新增参数都限制4KiB；NoEcho不是提供者/调试日志的绝对保密保证。

只允许从创建成功的栈Outputs取得完整Secret ARN，再独立读VersionId/KMS元数据；不能拼六字符后缀、填AWSCURRENT或假UUID。此后SQL只使用这四个准确DB版本的密码。若外层已批准此固定输出派生规则，可在同一安装编排中继续，不为新ARN再开一次聊天批准；当前没有这样的可执行外层SHA。

## 3. 安装顺序与失败边界

所有步骤仍待准确范围另批：

1. 集中核对当前身份/权限、原schema/OID/ACL/保护、所有新名称、门禁/OIDC、证据桶/Key和正式资源归属。旧记录不能当最新事实，无需提前启动收费环境。
2. 两个Secret栈：各一次创建Change Set→核对只为3项/2项Add→首次Execute→独立捕获真实ARN/Version/Key。不安装IAM时Secret也可能收费，失败无自动删除。
3. DB事务1只应用 `promotion.draft.sql` 一次，不重建原结构；新增三函数及两列/组并在提交前关闭临时owner SET。原owner ADMIN保留，不冒称管理员能力被消除。
4. DB事务2：BEGIN，分别绑定四个准确DB Secret版本密码，执行原三LOGIN片段再publisher片段，核对后COMMIT。publisher片段拒绝与该事务内三密码相同的值；四角色各只继承自己组，SET=false/ADMIN=false，无owner或表DML。
5. 独立连接核验结构/ACL、旧保护未变；四LOGIN各一次验证TLS的身份/权限认证，不读取业务数据。不把本地PG16通过等同于Neon18托管认证已成功。
6. 真实Secret版本及允许列表完整后，两IAM栈各一次创建/审查/执行和独立验证，确认trust、正确角色/策略附加及boundary。原三角色六项Add，publisher两项Add；不改旧CFN执行角色/边界或桶/Key策略来凑通过。
7. 安装结案时runtime仍false。真实基准版本/候选/实例绑定登记、运行配置启用、环境恢复和D2-6两次更新不夹带在该安装里，后续按明确范围集中批准。

Secret→Neon→IAM跨服务非原子，两段DB事务之间也非原子。拟议CFN安装 Execute使用DisableRollback=true保留现场，与日常版本更新的正常CFN回滚不同；实际批准须明确接受。失败/ACK不明停后续写，不重试、补齐、撤权、自动down、清理或复位旧槽；可能留下收费Retain Secret、可LOGIN角色或部分已授IAM。服务端动态ALTER密码、NoEcho/SDK/TLS仍有内存/网络/提供者日志风险，不能当作没有暴露风险。

## 4. 停止环境与真实缺项

已存11月13日[停用回执](../ops/temporary-idle/stop-continuation-execution-20261113.json)显示：三栈保留、ALB和运行服务已由所属栈移除、两库当时stopped；当前没有本轮实读。不把“栈保留”误说成物理服务/监听器还存在，也不把历史删除状态当永久停费保证。

新读取若证实仍停止：只保存真实归属/保留的UUID及缺失字段，**不为补IAM参数自动恢复、启动任务/数据库或建ALB**。ReadStackArns/ReleaseStackArns可绑定经核对仍保留的准确栈UUID；ECS服务/监听器等需未来受审恢复后的实际物理ID，或另行明确批准的稳定命名范围。不得擅自拿旧服务ARN当当前值，也不扩大为整个账号/任意栈。

当前真实缺项一次列齐：

- 当前Source身份及安装能力、新栈/角色/策略/Secret名空位、已有default Secrets Manager Key、桶条件/版本化/策略兼容。
- Neon原OID/函数体/权限与保护布局、五个新角色名（publisher NOLOGIN＋四LOGIN）空位；现有三表目录/实例绑定和准确sandbox实例状态。
- GitHub本人人工门禁、main/OIDC元数据、后端repository ID及可用原构建/产物元数据；不因CI而认定真实产物尚未过期。
- backend只读token供给选择/范围/到期；用户不需在聊天提供token或密码。
- 真实产品/version/兼容声明、原当前基准与初始化实例绑定证据。控制库空结构不等于已具备实例/版本种子，也不能凭历史成功job自动编一条新可信版本。
- 五个Secret实际ARN/VersionId与最终runtime映射尚不存在；本轮不生成启用配置值或执行SHA。

## 5. 下一轮集中只读范围提案（尚未授权）

材料和准确CI通过后仅请求一次：Source STS最多1＋AWS元数据最多75、GitHub GET最多12；随后 `.env.local` 全文件读取1，经验证TLS的Neon READ ONLY连接1，最多45条查询（含事务/SET LOCAL）。准备快照仍5小时，从真实读取开始计；材料文件可长期保留，不重计旧事实。

范围只为上述缺项：原三栈/资源及现有服务/数据库/路由元数据，拟建四栈/角色/策略/五Secret名称，OIDC/安装身份布局、default Key、证据桶策略/版本化、准确ECR仓库/既有digest和两份新CFN模板ValidateTemplate；GitHub准确CI、main/人工门禁/OIDC与后端仓库/成功构建/artifact元数据。SQL只查角色/目录/保护以及准确实例 `app_e897a4377bce498b9c5ee9e64509dcad` 的产品/环境/初始化和release绑定元数据，不读订单、支付、账号密码或业务正文。

不读Secret值、PEM/HMAC，不下载ZIP/历史S3正文，不连接Aurora，不新生成凭据、不写云或数据库、不消费执行槽、不dispatch或恢复。元数据原文可能临时进内存（如task definition环境/策略）；只保存必要投影/摘要，配置整文件仅进内存，接受宽权限owner凭据、网络/提供者日志和低额非零费用风险。失败/分页不完整/预算不够即停止，不扩大读取或重试旧命令。CloudFormation/Lambda/ECR发布仍未授权。

## 6. 本轮验证与停止点

新增五项材料回归，检查七份指纹/原三材料不变、两Secret NoEcho/Retain、publisher最小动作及四种条件写路径、唯一environment trust、固定LOGIN片段/四密码隔离。既有PG16子测试改为实际执行新publisher LOGIN草案（非超级用户安装者），先验证同密码被拒且无新角色，再验证真实登录/继承/SET/owner权限与原窄函数分工。本地PG测试缺专用CI库时skip，准确CI结果另附，不连接本地或线上数据库。

本轮不修改D2-4/D2-5运行代码、原schema/grants/三身份材料或启停工具；没有生产读取、密码生成或安装。没有新的短窗口或可执行安装SHA。下一动作仅是用户允许后进行上述集中只读准备；不是恢复收费环境。
