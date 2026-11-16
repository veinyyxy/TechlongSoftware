# 日常版本更新：一次性启用材料总清单

2026-11-14建立，2026-11-15离线收口，America/Winnipeg。**原D2身份启用仍未安装、未恢复、未启用；图片栈及原IAM/idle租户接线已另批完成。** 复用 D2-4/D2-5，不另建安装器/工作流，不重做业务验收。原七份安装草案的指纹索引仍为[activation.prepared.json](../ops/releases/activation.prepared.json)，`executionAuthorized=false`、`installationManifestSha256=null`；最新输入/缺项见第13节，材料指纹不是执行批准。

**当前结论：** 用户已同意比较器单点修正，已完成第24节代码/离线回归及原快照离线复核；只忽略membership行序，完整字段与重复次数仍严格比较，保护基准不变。此轮无新生产/凭据读取、连接或写入，未重放事务、补装IAM或恢复环境，runtime关。源码CI与后继独立核验/剩余IAM安装分开记录，不以修复通过冒称安装完成。

图片前置的[真实完成记录](aws-instance-release-persistence-plan.md#19-原iam与idle租户接线已完成独立核验通过)已取代此前“仅方案/未安装”的状态；不再重建图片栈或重放接线。旧图来源/必要迁移和运行采样尚未证明，不以组件完成回执生成持久化就绪摘要或绕过`PERSISTENCE_NOT_READY`。

## 1. 已完成与本轮增量

已安装的基座只沿用[真实完成回执](aws-instance-release-schema-install-completed-20261113.json)：`deployment_release` schema OID237571、三表九函数、owner及三操作 NOLOGIN。不得重放 `schema.draft.sql` / `grants.draft.sql` 或旧 attempt。原三身份材料中SQL/Secret模板保持；IAM草案同日另准仅修三处ARN分隔符，旧/新指纹分别记录，见[既有材料](aws-instance-release-identity-installation.md)。同审批晋升的代码/CI见[上一轮交付](aws-instance-release-promotion.md)。这些记录不是新的存活/空位证明。

本轮只补 publisher LOGIN / Secret / IAM 缺项，汇总顺序及精确真实缺口：

| 受管对象 | 准确草案 | 数量与边界 |
| --- | --- | --- |
| 原控制Secret栈 `techlong-sandbox-instance-release-secrets-v1` | [control-secrets](../ops/releases/control-secrets.draft.template.json)，原字节 | planner/executor/verifier 三Secret |
| 晋升Secret栈 `techlong-sandbox-instance-release-promotion-secrets-v1` | [promotion-secrets](../ops/releases/promotion-secrets.draft.template.json) | publisher-db、backend-build-read-token 两Secret |
| 原IAM栈 `techlong-sandbox-instance-release-identities-v1` | [identities](../ops/releases/identities.draft.template.json)，仅三处ARN校验修正 | 三角色＋三策略；每份策略同时附加为身份授权和boundary |
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
4. DB事务2：BEGIN，分别绑定四个准确DB Secret版本密码，执行原三LOGIN片段再publisher片段，核对后COMMIT。publisher片段拒绝与该事务内三密码相同的值；四角色各只继承自己组，SET=false/ADMIN=false，本次不授owner或表DML。数据库PUBLIC固有权限仍存在，不承诺全库旧函数均不可访问或客户行级隔离；须先核对有效能力，发现冲突停，不擅自改旧ACL。
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

## 5. 集中只读范围（已获准，结果见第7节；不得重放）

材料和准确CI通过后仅请求一次：Source STS最多1＋AWS元数据最多75、GitHub GET最多12；随后 `.env.local` 全文件读取1，经验证TLS的Neon READ ONLY连接1，最多45条查询（含事务/SET LOCAL）。准备快照仍5小时，从真实读取开始计；材料文件可长期保留，不重计旧事实。

范围只为上述缺项：原三栈/资源及现有服务/数据库/路由元数据，拟建四栈/角色/策略/五Secret名称，OIDC/安装身份布局、default Key、证据桶策略/版本化、准确ECR仓库/既有digest和两份新CFN模板ValidateTemplate；GitHub准确CI、main/人工门禁/OIDC与后端仓库/成功构建/artifact元数据。SQL只查角色/目录/保护以及准确实例 `app_e897a4377bce498b9c5ee9e64509dcad` 的产品/环境/初始化和release绑定元数据，不读订单、支付、账号密码或业务正文。

不读Secret值、PEM/HMAC，不下载ZIP/历史S3正文，不连接Aurora，不新生成凭据、不写云或数据库、不消费执行槽、不dispatch或恢复。元数据原文可能临时进内存（如task definition环境/策略）；只保存必要投影/摘要，配置整文件仅进内存，接受宽权限owner凭据、网络/提供者日志和低额非零费用风险。失败/分页不完整/预算不够即停止，不扩大读取或重试旧命令。CloudFormation/Lambda/ECR发布仍未授权。

## 6. 本轮验证与停止点

新增五项材料回归，检查七份指纹/原三材料不变、两Secret NoEcho/Retain、publisher最小动作及四种条件写路径、唯一environment trust、固定LOGIN片段/四密码隔离。既有PG16子测试改为实际执行新publisher LOGIN草案（非超级用户安装者），先验证同密码被拒且无新角色，再验证真实登录/继承/SET/owner权限与原窄函数分工。本地PG测试缺专用CI库时skip，准确CI结果另附，不连接本地或线上数据库。

本轮不修改D2-4/D2-5运行代码、原schema/grants/三身份材料或启停工具；没有生产读取、密码生成或安装。没有新的短窗口或可执行安装SHA。下一动作仅是用户允许后进行上述集中只读准备；不是恢复收费环境。

准确源码 `375b0e20db3297b842d36ce5e61044f43814cf9c` 的 [CI43596568223](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43596568223) attempt1 completed/success，head/两job/各步骤及日志均已核对。Linux176回归通过/0失败/0跳过，原生PG16共9通过/0失败/0跳过，含本轮实际publisher LOGIN草案、同密码拒绝/无角色和真实认证/权限核验。[机器证据](aws-instance-release-activation-ci-20261114.json)。这是隔离库/模板静态验证，不是线上Neon安装或AWS ValidateTemplate/IAM请求成功。材料已推送，当前只等待下一轮集中只读范围确认，不启动收费环境或请求安装批准。

### 已批准补核的实际停止记录

用户随后允许第5节范围。本次于2026-11-14T12:54:17.908Z开始，仅提交一次固定Source profile/官方ca-central-1 STS查询；12:54:21.108Z以CLI255/SOURCE_READ_FAILED停止，没有身份返回。没有保存原始提供者错误，不据此判断必为过期或网络；本地CLI路径可解析、环境无显式AWS配置文件/代理覆盖，但这不是联网或认证成功证据。

其余AWS元数据、GitHub GET、配置读取、Neon连接/SQL、写入与执行槽均0。未取得可用新快照、未生成安装批准SHA，旧a记录不改不重跑。[去敏回执/原件SHA](aws-instance-release-activation-preflight-stopped-20261114.json)。下一仅建议另准一次带去敏错误类别的新STS诊断；身份准确后才续原未用范围，不要求先盲目重复登录，不自动恢复环境。

## 7. 新诊断及集中核对的实际结果（2026-11-14，停止后只整理材料）

用户另允新记录官方STS诊断及准确身份后的剩余原范围。b于13:00:57.231Z开始，13:00:58.768Z返回原准确IAM用户；无需重复登录，不能反推a失败的唯一原因。AWS前段62次读取完成，GitHub12次和配置1次/验证TLS Neon READ ONLY连接1条/SQL22条于13:20:53.124Z完成。随后原预算内的补核在第63次AWS元数据、第一条准确GetHostedZone于13:22:48.258Z返回SignatureDoesNotMatch即停，未重试。没有Secret值/PEM/HMAC/ZIP、Aurora连接、凭据生成、远端写或执行槽消费。

[去敏事实及原件SHA](aws-instance-release-activation-preflight-observed-20261114.json)。成功部分的事实最多到18:00:57.231Z（温尼伯11月14日12:00:57.231 CST），不因后续记录或失败延期；这是**部分事实，不是完整安装预检通过**。私有完整投影只在.local-secrets中保留，未提交Git。a、b所有原件保持，不重跑任何已执行脚本。

### 已证实的事实

- 新四栈/四角色/四策略/五Secret名称全部缺失；默认AWS-managed Secrets Manager Key为3af8de5c…且Enabled，证据桶版本化/AES256/公共访问阻断保持。两新增模板ValidateTemplate成功，仅证明模板可解析，不证明实际参数、权限或安装可行。
- 原三栈UPDATE_COMPLETE，各保留平台7/Cell12/租户3项；两个准确旧ALB均LoadBalancerNotFound，两个准确旧服务查询返回MISSING。不据此证明全账号ECS/ALB全空、无旁路资源或零费用。
- **两数据库均为available**：techlong-sandbox-express-d001和speedfeast-postgres-prod，resource ID未变。与11月13日停止回执不同，本轮Start/Stop为0、未查询启动操作者或原因；不能把原stopped当现状，也不能据此猜自动启动。可能持续计费，停库必须另获具体授权，当前不自动调用节费工具。
- 本人人工environment、main部署规则、immutable OIDC前缀及工作流字节匹配；精确CI43596568223仍success，日常更新workflow尚无运行。main分支保护API返回404，只记“未取得保护配置”，不将它当作已启用；environment门禁与分支保护分别记录。
- Neon18.7/TLS1.3/证书验证/只读事务通过；11类catalog与已安装原件完全一致，原schema/三表/九函数/四NOLOGIN及保护不变。五个待建DB角色名均缺失，三表均为零字节普通heap且无继承，证明版本目录/请求/实例绑定尚空；没有临时GRANT/SET ROLE或尝试写库。运行角色无表/列DML、安装者对四组有效SET/INHERIT仍关闭，但安装者仍是宽权限owner（含CREATEROLE/BYPASSRLS和管理能力），不宣称已最小化。
- 准确实例及订阅active、已有ready部署元数据，但原客户模板driver=manual、环境apply=0，无新的release绑定。历史ready不等于当前服务正在运行，不自动改客户模板或填造版本种子。
- 后端仓库ID1064124445；最近10条成功main构建中最新合格attempt1为38803364109/10fe3c41…，该run完整artifact列表为0。既有ECR的不可变tag和manifest字节匹配，但这不能代替已删除的原ZIP/扫描回执；未下载ZIP、未挑更旧构建或自动触发新build。

### 本地材料缺陷与尚未补齐项

补核配方对全球Route53 endpoint传了ca-central-1。官方要求此Route53 API使用us-east-1签名，[AWS端点/签名区域说明](https://docs.aws.amazon.com/general/latest/gr/r53.html)。已由本地请求证明契约错误；没有保留原始提供者错误正文，不能把它当作唯一历史原因，尤其不能说Source必然过期。原失败脚本不改字节、不在线重试。

此外，本地材料核对发现两份IAM草案的**五个Secret ARN AllowedPattern误写为`:secret/`，真实ARN为`:secret:`**（原三身份3处、publisher2处）。真实task definition元数据已包含标准冒号格式；新模板的ValidateTemplate成功不会校验尚未传入的实际参数值。这会阻挡后续安装，当前未修改模板、原指纹或测试，也未创建任何Secret/IAM。

DNS/当前API Alias、三个既有Secret固定版本独立元数据、Source组策略和余下原CFN inline正文没有取得，不用历史引用补成“已验证”。backend只读token供给及有效期、可用新checked app产物、图片持久化/无迁移兼容声明和恢复后的物理ID仍需落实；不因此恢复收费环境或把新Secret ARN/VersionId填成假值。

### 当前唯一建议

先征得**仅修两份IAM草案五处ARN分隔符、相应必要回归、指纹/文档及无AWS CI**的代码范围；不改授权Action/Resource范围、不扩框架、不读取生产或安装。批准后才修改，不能继续使用旧材料指纹冒充修正稿。其后最多只另审本次未完成的小范围元数据，不重复75次全量盘点或重读Neon；已成功事实未过期且未变化时复用，过期只补主线必需项。实际身份安装、token供给、新构建、目录/实例登记、恢复和D2-6部署仍各按准确范围另审，runtime继续关闭。

## 8. 已批准的五处ARN校验修复（仅代码与CI）

用户随后明确批准仅修这五处及测试/准确CI，不增加生产读取或云部署。本轮只将两IAM草案的5个参数AllowedPattern由`:secret/`改为`:secret:`；Resources、Action、权限范围、trust、所有SQL、运行代码/配置和部署工作流不变。不是新增授权或安装。

新增一项既有测试文件内的回归，先在旧稿上真实复现标准ARN被拒绝，再验证五参数接受标准格式、继续拒绝旧斜杠/错账号区域/错名称/错后缀/附加前缀。将五处分隔符还原后，整份模板LF-normalized SHA须恰好等于旧指纹，证明除此之外未改模板字节。同步两份材料索引的当前SHA并保留previousSha256：identities由ce403675…改为1b41f5a3…，promotion-identity由2c943c00…改为d13bcee6…；旧预检/失败回执不改、事实时间不延长，旧ValidateTemplate不能冒称验证修正稿。

只提交main、运行既有无AWS CI并核对准确run/job/log；不调用AWS、Neon、后端产物或读取.env/Secret/PEM。实际部署/安装、尚缺的DNS/权限元数据、token供给及新构建均不在本轮内。准确CI完成后仅记录结果，runtime保持false，不自动进入下一步。

本地相关177项中176pass/1 Windows真实ZIP处理skip，新增ARN回归通过；定向lint/全项目类型检查通过。远端Linux177项及原生PG16只在准确提交CI实际完成后记录，不把本地skip当已验证。

**本轮已收尾：** 修正源码501b7f128fddd7f529c19e5af003c95fb32b0900的[准确CI43600705621](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43600705621) attempt1 completed/success，head/两job/步骤及日志匹配；Linux177项及原生PG16的9项全通过、fail0/skip0，lint/类型通过。[去敏验证回执](aws-instance-release-arn-pattern-fix-ci-20261114.json)。不改旧预检回执、原事实时间或旧失败脚本；本轮AWS/生产读取与安装/恢复/dispatch0，修正稿没有在线模板验证或IAM安装。当前结束，不自动开始新的读取/安装，后继真实缺项仍按明确范围另审。

## 9. D2-6最小补核已完成；等待PAT安全供给，不先恢复环境

用户另准最小补核、选定后端单仓Actions只读fine-grained PAT，并在c停止后另准仅两次模板验证。c于15:39:34.641Z—15:39:50.215Z完成准确IAM、DNS、3固定Secret版本及Source组/原CFN inline元数据；随后第一份ValidateTemplate在本机CLI调用处失败，未重跑c。传入完整模板的JSON参数达34,445字符，本地无网络同长度调用复现ENAMETOOLONG；原具体异常code/HTTP尝试数未保存，不冒称原提供者错误已恢复。

d仅按新批准用[官方file://传参方式](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/validate-template.html)提交两次ValidateTemplate，均成功；未重复STS或资源读取，未上传S3。两份修正IAM模板当前SHA分别1b41f5a3…/d13bcee6…，能力均为CAPABILITY_NAMED_IAM；这仍不验证实际参数/权限或创建资源。c原件不改，d记录独立保留。[去敏事实、调用数和原件SHA](aws-instance-release-d2-6-minimal-preflight-20261114.json)。

两段合计STS1、元数据操作提交14（13成功＋1本机失败），其中另批Validate2；GitHub/.env/Neon/SQL/Secret值/PAT/PEM读取、云写、执行槽、恢复和dispatch均0。复用的成功事实仍只到18:00:57.231Z（今天温尼伯12:00:57.231 CST），不因c/d延期。

已补齐的真实值：准确zone Z01473621BTTHKXBGOOEJ及API A Alias仍指旧1581133878；3个现有引用VersionId均存在且AWSCURRENT；Source属于Administrators组、附加AdministratorAccess v1且无组inline；原Cell执行角色inline摘要已取得。组策略布局不等于SCP/会话条件下安装权限已模拟通过；固定版本存在不等于已经读取/解密Secret；DNS记录存在也不是后端恢复或健康证明。其余成功元数据和名称空位只复用原b，不重新盘点。

### PAT由用户自行准备；本轮不代建、不读取

用户已选择此方式，以下是供给说明，不是代理获得创建/读取/写入Secret的批准：

1. 打开[GitHub fine-grained PAT创建页](https://github.com/settings/personal-access-tokens/new)，名称可为`techlong-backend-build-reader`，资源owner选veinyyxy。
2. Repository access选择Only select repositories，仅勾选`SpeedFeast_Backend_main`；Repository permissions只增加Actions: Read-only，保留固有Metadata read；不选写权限、全仓授权、Administration或environment批准权限。设置有限到期日，并记下该日。[GitHub创建与到期说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)、[artifact读取权限](https://docs.github.com/en/rest/actions/artifacts)。GitHub固有公共仓只读访问仍可能存在，不宣称该PAT绝对看不到其他公共资源。
3. 用户在本地编辑器中将token单独一行保存到`E:/NodejsProject/TechlongSoftware/.local-secrets/d2-6-backend-actions-read-token.txt`，不要粘贴聊天、提交Git或作为shell参数传入；该建议路径在本次准备时不存在，不覆盖其他文件。
4. 完成后仅回复文件路径和到期日。届时再明确一次私密读取/验证及准确AWS Secret供给范围；当前文件内容未读、AWS中也没有新token Secret。不把本机现有Git凭据复制上云。

本轮不生成可执行安装SHA、不创建Secret/LOGIN/IAM、不登记候选/基准或实例、不启用runtime。后继仍按第3节固定对象和顺序集中准备准确安装范围；真实版本/持久化兼容、恢复后的物理ID及两次更新仍按D2-6执行卡落实，不能因为模板验证成功就跳过。若原事实到期，停止使用，不自动全量重读或开收费环境等待。

## 10. PAT已验证；另批单次后端构建，不恢复收费环境

用户自行供给文件后，另批的一次读取/两次GitHub官方GET于2026-11-14T16:14:53.365Z—16:14:54.223Z完成。两端点成功，提供者返回到期时间2027-02-12T16:04:56Z，与用户声明日期一致；endpoint permission header是actions=read，不是完整token权限/单仓范围证明。私密原件和文件指纹仅保留本机，Git只保存[去敏验证回执](aws-instance-release-d2-6-pat-verified-20261114.json)，不再读取或复制该PAT，也未写AWS Secret。最新成功main构建38803364109的完整artifact列表为空，不能拿旧ECR tag冒充可用原包。

用户因此另准一次现有backend-image-candidate.yml main构建与自检：既有Git凭据仅内存，最多30次GitHub GET核对main/工作流字节及准确run/步骤/artifact元数据，最多一次POST和35分钟跟进；不改源码/权限、不读新PAT/.env/Secret、不下载ZIP、不调用AWS/ECR/迁移/部署、不Re-run或失败重试。原app＋lifecycle矩阵不改，只使用app。已审工作流LF-normalized SHA256为1d7fd99db80d03d8261e268d656045d5a89d0f28efa5a1f8e2e4471b92670aa8。

本地没有旧调度记录；新f记录先核对远端main a79ed89cdb5dc788ec880d8dcbeeb875f1f19159及工作流字节一致，再仅POST一次，收到[run43624344472](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/43624344472)准确ACK（2026-11-14T18:02:21Z创建）。该run原attempt1于18:02:33Z completed/failure；f于18:03:36.728Z完成准确run/两job步骤/空artifact回读，8次GitHub API GET、POST1。随后在本轮30次GET预算内仅另取一次准确app job日志（既有connector认证，另跟随一次日志签名重定向），合计API GET9/含日志重定向GET10；未重跑runner或修改其原结果。

两job均在`Gate high and critical production dependency advisories`失败。准确app日志报告9项（3 high/2 moderate/4 low），三项high分别为body-parser、follow-redirects、multer；deepmerge/SendGrid链及ip-address/qs也出现在诊断，但未据此扩全量依赖升级。镜像build、隔离容器/安全自检及候选保存均skipped；artifact0，不是镜像运行自检失败，更不是AWS部署失败。日志提出`npm audit fix --force`的破坏性SendGrid变更，不执行或作为默认方案。[去敏停止回执及私有原件SHA](aws-instance-release-d2-6-backend-build-20261114.json)。

本轮按“失败不重试”结束，既有意图/ACK/失败和日志摘要保持；下一仅建议另准这三项high及必要直接关联依赖/回归的最小后端修复，不降低门槛、不新建工作流或框架。当前没有后端代码修改/推送或新构建批准，不自动修复、Re-run、下载ZIP、晋升/登记或创建资源。云构建不是D2-6实际更新，不启用runtime或恢复环境。原资源快照18:00:57.231Z已到期，不因新PAT/构建记录续期，后续安装只按必要新事实与准确审批处理。

## 11. D2-6真实app原件与Neon核对完成，AWS部分事实保留

2026-11-14新g/h/i三段均按分别批准的范围执行并保留原件。[去敏事实、计数及私有原件SHA](aws-instance-release-d2-6-readiness-observed-20261114.json)。本节取代旧执行卡中“最新成功构建无artifact”的当前结论；不改旧失败、旧快照时间或既有安装索引。

### 已完成，不重复读取

- **真实app原件：** 后端main b9ca213…的成功run43630231572/attempt1、准确artifact14128140862原ZIP已下载一次，72,663,114字节，SHA256 `6d1214fad4c035175b389b5f2920397bea99ec33bb6dd932e74f000a38b1e152`。复用原四文件解包器与`verifyBackendBuildEvidence`核对原包/回执/自检/扫描及来源通过，没有运行镜像、改门槛或放行lifecycle。config digest不是ECR manifest digest；尚未绑定产品、登记目录或发布ECR。
- **AWS：** 精确Source IAM用户核对成功；55次元数据均成功或得到预期不存在结果，未提交第56次。新四栈/五Secret/四角色四策略名称均空；三保留栈UPDATE_COMPLETE（资源7/12/3）、OIDC/默认AWS-managed Key/私有证据桶及三个固定Secret版本元数据已核对。Source组AdministratorAccess和原Cell CFN角色完整策略投影取得，不等于实际安装权限已模拟通过。本轮没有查询ECS/ALB/RDS运行状态、DNS或ECR，不把栈完成状态解释成服务在线或零费用。
- **Neon：** 后继单独获准且只执行剩余配置读取1/验证TLS READ ONLY连接1，实际22条SQL。TLSv1.3授权验证、事务内`search_path=pg_catalog`；原catalog/ACL/保护11类摘要全部不变，原3表/9函数/4 NOLOGIN保持。五个拟新增角色仍不存在；release三空堆无继承，目录/请求/实例基准绑定仍为空。准确实例与订阅active，但旧template driver仍manual、环境apply_enabled=0；未据此自动改绑定或启用。

g使用单artifact通用URL被连接器本地拒绝，尚未发生提供者响应；另批h才替换为受支持的run/artifacts入口，不重复run GET。h在第二个原CFN角色策略采集前触及55次预算而停，**不是AWS失败或登录过期**；另批i只做剩余Neon，无追加STS/AWS。合计成功GitHub元数据GET2、原包下载操作1（含返回文件GET1）、STS1/AWS元数据55、配置1/TLS只读1/SQL22。PAT/PEM/Secret值/Aurora/远端写/执行槽/dispatch均0。

### 尚未闭合，不能据此生成执行批准

| 缺项 | 事实与边界 | 下一步最小处理 |
| --- | --- | --- |
| 第二个原CFN执行角色详细授权 | `TechlongSandboxCloudFormationExecutionRole`的GetRole/ListAttached已成功，但本地中间赋值在后续预算检查前未完成，结果投影未封存；只留下调用成功日志和输入摘要。不能用旧策略或推导值顶替 | 仅对这个角色另列必要补核范围，不重复三栈/55次整批、ZIP或Neon。当前Neon续段不含此许可 |
| 一次性身份/增量安装 | 新四栈13资源（五Secret、四角色四策略）、四LOGIN和promotion增量仍未装；原schema/grants不重放 | 复用原模板/两SQL事务，补齐准确输入后再出安装SHA；不借只读许可生成密码/写Secret或安装 |
| 真实版本/实例基准 | 已有一份验证通过且未发布的app原件，不是两个登记版本；版本目录和实例基准为空 | 复用既有单app晋升/目录入口，产品绑定、两个不同digest合格版本及基准按准确范围另审；旧ECR tag不是新构建原件，NO_CHANGE不计验收 |
| 上传图片持久化 | 本次租户CFN模板`IMAGE_STORAGE_PROVIDER=local`；未读当前task volumes，不能仅凭该值断言所有文件已丢失。但现有采样器只在准确S3 provider/bucket匹配且HeadBucket通过时标记ready，当前无通过证据 | 保留`PERSISTENCE_NOT_READY`门槛；最小存储对齐须独立列具体范围，不扩大更新器、静默切存储或混入ImageUri-only变更 |
| 运行/恢复与两次更新 | runtime仍false/environments={}，没有新目录/请求/run；此次未核对收费运行状态 | 只在前置备齐并另准后复用原工具恢复必要依赖，再按原执行卡两次技术更新；不重做业务测试，不默认为资源已停或自动清理 |

下一唯一动作是**依据已存原件整理上述缺项中的最小授权补核及一次性启用清单**；不再补工具或改框架。云/数据库/存储变更仍各按准确范围确认，不在本轮实施。新事实终点固定为`2026-11-15T00:18:33.301Z`＝温尼伯11月14日18:18:33.301 CST；artifact原期限为`2026-11-15T19:07:00Z`，两者不能互相续期。过期停止使用，不自动大盘点或重复构建。

本轮最后仅提交去敏文档/回执并校验本地原件指纹、JSON与差异；不为文档重复运行应用CI，不追加生产读取。真实更新仍0次，未签发可执行安装SHA。

## 12. 单角色补核完成，安装输入按来源收口

用户另准j段仅STS1＋IAM5；2026-11-14T20:03:31.552Z完成，无额外AWS/Neon/配置/Secret值/PEM读取、写入或执行槽。[去敏回执与参数状态](aws-instance-release-d2-6-role-supplement-20261114.json)。五次IAM分别为准确原角色的GetRole、ListAttachedRolePolicies、ListRolePolicies及准确唯一boundary的GetPolicy/GetPolicyVersion，各一次，不翻页/重试。成功响应逐份立即封存，g/h/i原件保持。

角色ID `AROAV3GNMXTZKHYBCRSOE`、CFN信任和SourceAccount条件、唯一附加/边界策略、空inline名单均与既有基线一致。策略ID `ANPAV3GNMXTZOQPIXOKJ4`、默认v10，递归排序对象键后的文档SHA为`965641d5116d7cbf843e7de070d84c17fc010d1cb2606f459edf463d172180f6`，与11月7日保存的正式基线一致；数组顺序保持。不能拿未排序JSON的不同摘要推断云端策略变化。此项缺口关闭，不再补读该角色，也没有新增或修改权限。

本轮同时只在本地核对原四份模板参数及指纹，将一次性启用输入分清：

| 参数来源 | 当前处理 |
| --- | --- |
| 已存新快照可证实 | 三栈UUID可填ReadStackArns，准确租户UUID可填ReleaseStackArns；已有默认Key可填SecretsManagerKeyArn。复用h，不重读 |
| 安装后才出现 | 五Secret完整ARN/固定VersionId必须按另批准的真实输出派生；现在不生成后缀、版本UUID或凭据。原四栈13资源/两SQL事务的范围不变 |
| 其余资源读白名单 | ECS service/cluster/task、数据库、应用Secret、ECR和zone参数仍需形成准确输入；本轮不把历史资源ARN冒充当前运行事实，也不为填参数启动环境 |
| 明确仍阻塞的必填项 | `identities.draft.template.json`要求UploadBucketArns为**现有持久化上传桶**，无默认；当前模板仍local、没有已验证S3绑定。因此角色补核成功不等于完整安装材料可执行 |

下一只收口**上传图片持久化/桶归属的最小离线对齐方案及该安装参数**，复用既有后端S3能力，不扩图片产品功能、通用部署器或恢复框架。既有桶先证明归属；若需要新桶/权限/迁移/配置变更，先列具体范围另审，不把任意证据桶顶作上传桶，不绕过原PERSISTENCE_NOT_READY门槛，不混进ImageUri-only更新。该项是原D2方案第10节和已存在的安装参数，不是新增验收支线。

本轮只完善参数状态与去敏结果，没有生成可执行安装SHA、密码或版本种子，没有安装、恢复或实际更新。原事实终点仍`2026-11-15T00:18:33.301Z`（今天温尼伯18:18:33.301 CST）；不因j成功延长h/i或artifact期限。runtime继续关闭，不为文档重跑应用CI。

## 13. 接线完成后的原D2-6启用输入与缺项

本节只读取工程内已提交的去敏材料，离线将原启用参数收口；没有AWS/GitHub API、配置/凭据/媒体读取、数据库连接、执行槽消费或安装。没有修改七份安装草案、运行配置、工作流或发布合同，也没有重跑应用CI。原机器索引的历史`savedFacts`不改成新快照；以下是输入来源表，不是可执行安装清单，不签发安装SHA。

### 13.1 已有真实值，直接复用，不再搭图片工具

来源为[五资源独立核验回执](aws-instance-release-persistence-media-installed-20261115.json)及[原IAM/idle租户独立核验回执](aws-instance-release-persistence-wiring-installed-20261115.json)。前者核验于`2026-11-15T16:15:20.763Z`，后者最终核验于`2026-11-15T17:41:48.654Z`；原事实终点仍`2026-11-15T19:44:49.040Z`，本节整理不续期、不证明此后未变。

| 原启用输入 | 真实值或处理 | 归属及限制 |
| --- | --- | --- |
| `UploadBucketArns` | `arn:aws:s3:::techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad` | 来自媒体栈`MediaBucketArn`；类型`CommaDelimitedList`，本实例仅一个值，CFN的`ParameterValue`即左侧单个ARN，不加`/products/*`，不替换成证据桶 |
| 媒体资源所有者 | `techlong-sandbox-media-9c5ee9e64509dcad-v1/333757a0-e10f-11f1-b693-06fff1b686eb` | 原五资源栈；桶、桶策略、CDN/OAC/CORS由此栈管理，不归新D2身份栈或临时计算删除集 |
| `ReleaseStackArns`的准确租户候选 | `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/5867e9c0-d60d-11f1-b2c0-02ffdbfa6b13` | 原UUID未变；也是`ReadStackArns`的租户项。其他两个读栈项仍须沿各自原事实来源，不能用本次租户回执替它们续期 |
| 当前任务定义 | `arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:13` | 原租户栈实际物理ID，不再以`:12`作当前值；仍为idle三资源、没有Service。定义ACTIVE仅表示已注册，不是任务运行或健康通过 |
| `IMAGE_STORAGE_PROVIDER` / `IMAGE_S3_BUCKET` | `s3` / `techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad` | 已在`:13`实际容器环境核对；与采样绑定中的`providerVariable`、`bucketVariable`名称对应，不写入尚未启用的runtime |
| `IMAGE_PUBLIC_BASE_URL` / `ALLOW_EPHEMERAL_IMAGE_STORAGE` | `https://d3t5c71ibx9h97.cloudfront.net` / `false` | 这是图片CDN基址，不是买家应用/API地址；没有因此查询或验收图片内容 |
| 原应用TaskRole | `arn:aws:iam::402010193138:role/TechlongSandboxTaskRole` | 仍属`techlong-s3-bootstrap/8afbe1e0-9425-11f1-b06a-02ff648cb917`；原C4e数据库授权保留，只加准确`products/*`的Put/Delete |
| 原应用boundary | `arn:aws:iam::402010193138:policy/TechlongSandboxServiceRoleBoundary`，默认`v5`，`v4`保留，23语句 | 7个共享消费者绑定未变；图片Allow限定原应用角色，不把它当新D2 planner/executor/verifier/publisher授权，也不重放旧19条模板 |
| 原租户CFN执行角色关联 | `arn:aws:iam::402010193138:role/TechlongSandboxCloudFormationExecutionRole` | 关联保持；它不是上面的应用TaskRole，也不是拟安装的D2四身份。其完整策略的历史核验期限不因本次关联确认而延期 |

当前原IAM模板规范SHA为`cb957826528166537a3e2ac21d1353d0f2939f67e88dc61486c079bf6cbeb96f`，租户模板规范SHA为`dab17b240c8fe7e272b549c305b2990c7c949507e1f58d19f7fbd8aea90bc57b`；原件在上述回执绑定的私有目录中。后继恢复必须保留四项存储配置及原角色/数据库绑定，仍经所属CFN栈，不覆盖回旧模板；日常版本更新仍只改镜像，不夹带存储/网络/权限变更。

### 13.2 原安装参数的剩余来源，不以历史值补齐

| 参数组 | 已有来源与剩余缺口 | 后继处理，不在本轮执行 |
| --- | --- | --- |
| `ReadStackArns`其余项 | 原平台/Cell UUID有历史投影；本次只证明租户/IAM/媒体归属 | 仅核对安装必需的准确平台/Cell状态与UUID，不重做整个账号盘点或把空栈当运行中 |
| `EcsServiceArns`、`EcsClusterArn`、`EcsTaskArnPattern` | 本次租户无Service，不能拿已删除服务ARN当当前物理资源；cluster/task范围仍需原Cell来源 | 列为未绑定。未来按准确恢复输出绑定，或由用户明确批准稳定命名授权范围；不能自行放宽成账号通配，也不为填IAM参数自动启动计算 |
| `DatabaseArns`、`ApplicationSecretArns`、`EcrRepositoryArns`、`HostedZoneArns` | 原引用/允许列表有历史材料，接线仅证实数据库、镜像及Secret引用未改 | 复用准确候选，仅对实际安装必需且过期的元数据集中补核；不读取Secret值、数据库业务或旧图片，不据此声称运行健康 |
| `SecretsManagerKeyArn`、证据桶及OIDC/人工门禁 | 原默认Key、桶策略/版本化、subject和本人审批曾核对；不属于本次完整新预检 | 原事实已到期的项须新范围确认，不新建Key/OIDC/桶或更改人工门禁 |
| `PlannerSecretArn` / `PlannerSecretVersionId`、`ExecutorSecretArn` / `ExecutorSecretVersionId`、`VerifierSecretArn` / `VerifierSecretVersionId` | 原三控制Secret仍未安装，没有真实输出 | 未来准确批准后只从原控制Secret栈真实Outputs及独立版本元数据派生；现在不填假后缀/UUID或AWSCURRENT，也不生成密码 |
| `PublisherSecretArn` / `PublisherSecretVersionId`、`BackendBuildTokenSecretArn` / `BackendBuildTokenVersionId` | publisher/token两Secret仍未安装，没有真实输出 | 同样只在另准安装后按真实输出派生，不用本地PAT验证结果冒充已存在的AWS版本 |
| 后端token供给 | 已选单仓Actions只读fine-grained PAT，11月14日两次GET接受，提供者到期`2027-02-12T16:04:56Z`，见[原验证](aws-instance-release-d2-6-pat-verified-20261114.json) | 不再要求用户重新选择供给方式；不是已证明今天仍有效/完整单仓权限或已写AWS。文件读取、必要验证和指定Secret供给仍须新准确批准，不读PEM替代、不扩token刷新服务 |

原一次性安装范围不变：**四栈13资源（五Secret、四角色、四托管策略）和两段Neon事务**，继续第3节顺序及非原子/失败停止策略，不重放原schema/grants。Neon的原结构/角色空位/保护核对只到`2026-11-15T00:18:33.301Z`，不是当前新证明；新名称空位也不是永久预留。必要的Source/名称/Neon/元数据补核须集中另准，不能用本节离线许可读取生产或生成密码。

### 13.3 安装、登记、恢复及两次更新分开收口

| 主线项 | 当前状态 | 完成前仍缺什么 |
| --- | --- | --- |
| 原D2身份安装 | 七份草案及原回归已有；`UploadBucketArns`现有真实值，仍无可执行安装SHA | 上表准确允许列表/必要新事实；五Secret真实输出、四LOGIN认证及四IAM身份独立核验。图片旧文件迁移不是安装这些控制身份的前置条件，不再先扩图片分支 |
| 版本目录/实例基准 | 原三表目录与绑定最后核对为空；本次没有SQL或种子写入 | 准确产品/兼容声明、已观察基准与实例绑定，使用原入口另批登记；历史ready或一次成功job不能冒充可信种子 |
| 构建产物与晋升 | 原app run`43630231572`/artifact`14128140862`已下载验证、未发布ECR或登记，原到期`2026-11-15T19:07:00Z` | 保留本地原包与证据，不重下/重建。后继须按原合同检查有效期及绑定；不因本地有ZIP就绕过过期规则。第二个合格不同digest版本仍未证明，config digest不当ECR manifest digest |
| 持久化与实例运行绑定 | 图片基础设施/权限/四值接线已通过；旧图来源/必要迁移及恢复后采样未证明 | `persistentUploadsReady=false`、采样绑定的持久化`verificationSha256`仍未填写；组件回执SHA不能代填。必要范围另审，不把尚缺的证明当已通过，也不新增图片产品测试 |
| 恢复及两次真实更新 | runtime仍`enabled=false`、`environments={}`，租户没有Service，真实更新0 | 仅在安装/登记及必要事实备齐并另准后复用原CFN启停流程恢复；停止环境拒绝发布，不在更新中自动恢复。两次使用同一发布代码及本人GitHub审批，不重复买家/卖家业务验收，NO_CHANGE不计更新 |

**本次输入表到此结项。下一唯一动作回到原D2一次性启用清单：集中提出上述安装必需且已过期/未绑定项的最小补核范围，获准后才读取并生成准确安装SHA。** 不再修改持久化模块/安装工具、重建图片栈、重跑CI或延长旧事实；没有该新读取或安装许可时停在材料，不自行开启短窗口。资源恢复、目录/实例写入、晋升及实际更新不偷并入身份安装。

本轮仅本地文档更新/差异与已存去敏值校对，无云/数据库/私密读取或写入。已建持久图片资源和模板对象可能继续计费，不因本节结束自动停止或删除；不据历史stopped回执声称全账号停费。

## 14. 原身份安装的集中最小补核范围（待批准）

本节把第13节剩余安装输入合并成**一次只读准备**，不再按缺项逐条开新阶段。不增加执行器、工作流、测试或安装草案；只从已有去敏回执及已保存`:13`任务定义中提取非秘密资源引用，没有读取任何凭据值或调用生产。下列范围等待用户明确批准；“开始下一步”仅用于编制本节，不视为生产读取许可。

### 14.1 总上限与顺序

固定`techlong-sandbox-user`、准确IAM用户`arn:aws:iam::402010193138:user/techlong-sandbox-dev`。**官方STS 1次＋AWS元数据最多51次＋GitHub GET最多8次；之后才读取现有`.env.local`全文件1次，建立1条经验证TLS的Neon READ ONLY连接，最多45条查询（含事务控制和事务内`SET LOCAL search_path=pg_catalog`）。** 不生成密码或安装SHA前的执行槽，不要求用户连续在线40分钟；准备材料齐备后再单独审批实际安装。

| AWS白名单（每个具体请求至多一次） | 准确目标或受限派生 | 最多次数 |
| --- | --- | ---: |
| DescribeStacks＋ListStackResources | 原platform `c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`、Cell `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`、tenant `5867e9c0-d60d-11f1-b2c0-02ffdbfa6b13`，均使用原完整ARN，不扫栈名 | 6 |
| GetTemplate(Original)＋ListChangeSets | 仅准确原tenant栈；核对仍为`:13`接线后的idle声明及未决变更 | 2 |
| DescribeStacks | 第1节四个拟安装栈的准确名称，仅核对不存在，不ListStacks | 4 |
| GetRole＋GetPolicy | 原identities/promotion-identity草案内准确四角色、四托管策略名称，仅核对空位；不枚举IAM | 8 |
| DescribeSecret | 原control-secrets/promotion-secrets草案内准确五名称，仅核对空位；不ListSecrets或GetSecretValue | 5 |
| GetRole、ListAttachedRolePolicies、ListRolePolicies、GetPolicy、GetPolicyVersion | 仅`TechlongSandboxCloudFormationExecutionRole`与`TechlongSandboxCloudFormationExecutionBoundary`；期望原角色布局/已存策略v10，不转查Cell执行角色或应用boundary | 5 |
| ListGroupsForUser、ListAttachedGroupPolicies、ListGroupPolicies、GetPolicy、GetPolicyVersion | 仅准确Source用户、已存`Administrators`组及其`arn:aws:iam::aws:policy/AdministratorAccess`；核对已知组布局，不声称已模拟SCP/全部有效安装能力 | 5 |
| DescribeKey | `arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570`，原AWS-managed Secrets Manager Key | 1 |
| GetBucketVersioning、GetBucketEncryption、GetPublicAccessBlock、GetBucketOwnershipControls、GetBucketPolicy | 仅`techlong-sandbox-cloud-worker-evidence-402010193138`，保存必要兼容结论/摘要，不列键或取对象正文 | 5 |
| GetOpenIDConnectProvider | `arn:aws:iam::402010193138:oidc-provider/token.actions.githubusercontent.com` | 1 |
| DescribeRepositories | `ca-central-1/402010193138/techlong-sandbox-speedfeast`；仅绑定仓库，不重新读镜像manifest或发布 | 1 |
| GetHostedZone | 仅`Z01473621BTTHKXBGOOEJ`，Route53使用既定us-east-1签名；不查Alias/公网解析或改DNS | 1 |
| DescribeDBClusters | 仅`techlong-sandbox-express-d001`及已存resource ID，取ARN/引擎/状态等必要元数据，不连接数据库或另查prod实例 | 1 |
| DescribeClusters | 仅本次准确Cell输出/资源返回的唯一既有cluster；无唯一项即停，不ListClusters/ListTasks或查任务日志 | 1 |
| DescribeTaskDefinition | 仅本次tenant物理绑定，必须仍等于已保存`:13`；投影镜像、角色、四环境值和Secret版本引用，不保存环境正文 | 1 |
| DescribeSecret | 仅下述`:13`两个既有Secret ARN/固定版本元数据，不读取平台Web DB Secret | 2 |
| DescribeStacks＋HeadBucket | 仅已建媒体栈`333757a0-e10f-11f1-b693-06fff1b686eb`和第13节真实图片桶；只核对归属/输出/桶可达，不重读CDN/OAC/CORS或原应用IAM | 2 |
| **合计（不含STS）** | 无备用次数可移作其他查询 | **51** |

原三栈完整ARN采用[停用回执的固定stackIds](../ops/temporary-idle/stop-continuation-execution-20261113.json)与[本次租户回执](aws-instance-release-persistence-wiring-installed-20261115.json)交叉约束；回执用于准确寻址，不冒充当前状态。新资源名称及七份草案必须先在本地与原[指纹索引](../ops/releases/activation.prepared.json)匹配，不能边核对边换草案。GetTemplate返回若与`dab17b24…`不符，或预期布局/分页/名称结果不匹配即停，不接纳新基准；明确的目标不存在是预期空位结果，其他ValidationError/认证错误不归类为空位。

既有两个准确Secret为：

- `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1-T9CqN5`，固定版本`0f45d29f-02d4-4117-99b1-c06645aa3c6e`。
- `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/control-public-key-first-acceptance-PfBjiq`，固定版本`75d8da0af103e1e10e6d3341cbd50226fea7ce5e5aac8d150ab9e447b6340680`。

### 14.2 GitHub与Neon，仅补安装所需事实

GitHub使用既有认证连接，仅在内存认证，最多8次GET：准确平台repo元数据、main、`.github/workflows/instance-release.yml`字节、`techlong-sandbox-deploy` environment、其deployment branch policies、OIDC subject配置、该准确工作流的单页run列表（最多100项，核对未完成运行）及准确后端repo元数据，各一次。核对平台repo ID `1323312747`、本人reviewer `14145707`、原main门禁/不可绕过设置、immutable subject和后端repo ID `1064124445`；未完成结果不完整或需要翻页则停，不追加页、读取日志/artifact/ZIP、JWT、PAT、PEM或dispatch。仍由用户本人批准未来GitHub environment，本次不替用户审批或修改门禁。

AWS与GitHub通过后才执行尚未使用的配置1次/TLS只读连接1条/SQL45上限：复用原catalog/权限/保护摘要核对方式，核对已安装`deployment_release`原OID237571、三表/九函数/四NOLOGIN、拟建publisher组及四LOGIN的五名称空位；确认有效函数/表列权限与保护未变、版本目录/实例绑定的真实状态。仅准确实例`app_e897a4377bce498b9c5ee9e64509dcad`的产品/环境/订阅/初始化与release绑定元数据，不读取账号密码、店铺、图片、订单、支付、历史业务正文或全租户任务账本。不临时GRANT/SET ROLE、改保护基准或执行草案；只读事务及search_path均计入45次，不把失败查询自动重试。

### 14.3 不再让缺失服务或产物期限诱发支线

- 若tenant仍无Service，就保存明确ABSENT；cluster及原声明只用于列出未来允许列表候选，不能填成当前活跃service。需要稳定命名授权时，将**准确未来ARN及其声明来源**放进之后的IAM安装清单，由用户连同该安装范围明确批准；本次读许可既不批准该IAM权限，也不授权恢复计算。
- 五Secret真实ARN/VersionId仍只在另批安装后按固定输出规则取得，不为预检读取PAT、生成密码或先创建Secret。历史PAT选择/到期来源保留，实际凭据验证/供给另列安装范围。
- 原app artifact于`2026-11-15T19:07:00Z`（温尼伯13:07）到期，但**此次身份补核不使用或要求该artifact**。不催用户在它到期前安装、不重复下载/构建，也不延长原件期限；之后版本晋升单独按原合同处理。
- 本轮新事实从真实采样起最多5小时，混用事实取各自较早截止。旧接线事实`19:44:49.040Z`、旧Neon及其他历史终点不因本提案续期；只核了媒体栈/桶存在，不等于刷新整套CDN/应用IAM或持久化验收事实。没有40分钟资源租约、恢复或自动清理。

仅新建本地只读结果/去敏摘要，旧记录和永久槽保留。每个请求一次、禁自动重试；Source失败即停，不追加STS诊断或要求盲目刷新。任何失败/预算不足/不完整结果停止后续，保留已完成读取，不扩大范围、安装或自行补齐。模板/策略/任务配置可能含敏感字段，只进内存，若发现明文凭据停止且不保存正文；配置全文件进入内存、宽权限owner使用、网络/提供者日志及低额非零费用风险须接受。只保存必要非秘密投影/摘要，原业务/策略/模板正文不提交GitHub。

**待确认措辞：允许第14节这一次集中只读补核，并接受上述内存、宽权限owner、网络/日志和低额费用风险。** 不含AWS/SQL写、密码生成、PAT/PEM/Secret值/媒体/私密包读取、ECR推送、候选或实例登记、安装/恢复/续租、任何任务创建领取、GitHub调度或执行槽消费。成功只准备原身份安装准确SHA及仍缺的输入，不宣称实际安装或D2-6两次更新已完成。

## 15. 集中补核已批准，但Source不可用，未取得新事实

用户11月16日明确允许第14节后，新a于`2026-11-16T16:23:07.668Z`（温尼伯10:23:07.668 CST）提交唯一官方STS命令，`16:23:11.336Z`以CLI255/`CREDENTIALS_UNAVAILABLE`停止。[去敏停止回执及私有原件指纹](aws-instance-release-activation-preflight-stopped-20261116.json)。没有STS身份响应；此安全分类不证明唯一底层原因或必然是过期，不保存原始stderr/凭据，不追加诊断或自动重试。

其余AWS元数据/GitHub/配置/Neon/SQL/Secret值/PAT/PEM读取、远端写入和执行槽均0；没有可用新快照或安装SHA。私有记录中的5小时名义终点`21:23:07.668Z`只属于这次失败尝试，不能当作成功事实有效期，也不延旧事实/产物终点。旧a原字节、七份草案、runtime/工作流均保持，不重复测试或重做材料，真实版本更新仍0。

下一仅请用户完成`aws login --profile techlong-sandbox-user`，不要发送凭据或验证码；回复“Source已刷新，允许新一轮同范围只读补核”后才另建记录，补STS最多1次并继续原未用AWS51/GitHub8/配置1/TLS READ ONLY1/SQL45。目标/限制/失败策略不变，不重跑a，不扩大权限或恢复；再次失败仍停，不擅自增加诊断。原已建持久资源未被本轮停/删，仍可能计费。

## 16. 新b集中补核完成，下一仅编制原身份安装审批清单

用户刷新并另准新轮后，b曾在进程创建前因宿主审批额度限制未执行；本次恢复先证实b没有started/result、a指纹不变，才运行该未执行命令。`2026-11-16T19:51:38.241Z`启动，19:51:40.800Z准确Source成功，AWS 51项于19:56:23.106Z完成，GitHub 8项于19:57:49.149Z完成，最后Neon于19:59:03.732Z完成。[去敏事实、准确输入及私有原件指纹](aws-instance-release-activation-preflight-observed-20261116.json)。没有重放a，没有第二次STS或单个请求重试。

| 核对项 | 本次真实结果 |
| --- | --- |
| 原资源/名称 | 三栈均UPDATE_COMPLETE，保留资源7/12/3；原tenant模板摘要与`:13`接线结果一致，无Service/未决CS。新四栈、四IAM角色/四策略、五Secret均空位，不是永久名称预留 |
| 安装允许列表 | 三栈UUID、cluster `arn:aws:ecs:ca-central-1:402010193138:cluster/cell-sandbox-1`、准确数据库/两应用Secret/ECR/zone/图片桶/原Key均已绑定，见回执`installationInputBindings`；没有虚填当前service |
| 原执行角色与Source | 原租户CFN角色/信任/唯一boundary、空inline及v10文档匹配；Source已知Administrators组布局匹配。未模拟SCP/所有有效安装权限，不称必然可写成功 |
| 存储与费用 | 证据桶版本/加密/公共访问阻断/ownership及策略投影、媒体栈输出/桶存在通过；未刷新完整CDN/应用IAM或图片内容。Aurora `techlong-sandbox-express-d001`当前available，可能持续计费；本轮没有启停它，未读取prod实例现状 |
| GitHub | main、工作流字节、repo ID、本人reviewer/main environment、禁admin绕过和immutable OIDC均匹配；日常发布workflow运行数0。未读PAT/PEM/JWT、产物或dispatch |
| Neon | TLS1.3且证书验证、READ ONLY/search_path正确；11类原catalog/ACL/保护摘要全部一致，原3表/9函数/4 NOLOGIN保持，五新角色名均不存在。三操作角色无表列DML，owner仍有管理/表访问能力；原四组对安装者SET/INHERIT关闭 |
| 实例与目录 | 准确实例及订阅active，原模板driver=manual、environment apply=0；三release表仍为空堆且无继承，没有版本/实例种子。未读店铺/订单/支付/图片或其他业务正文 |

实际总量：本成功轮STS1＋AWS元数据51＋GitHub GET8、配置全文件读取1/验证TLS Neon READ ONLY连接1/SQL22；其余Secret值/PAT/PEM/ZIP/媒体读取、Aurora连接、远端写/槽消费/安装/恢复/ECR推送/调度均0。schema/grants和七份安装草案、runtime/工作流不改，不为文档重跑CI；旧a仅另有一次已封存的凭据失败命令，不合并成自动重试。

### 安装清单中必须明示的未来资源范围

当前`EcsServiceArns=null`、service明确ABSENT。只拟把以下准确范围放入**后续安装清单**，与IAM安装一并请求用户新批准：

- service候选：`arn:aws:ecs:ca-central-1:402010193138:service/cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service`。
- task前缀候选：`arn:aws:ecs:ca-central-1:402010193138:task/cell-sandbox-1/*`，限定已核对cluster，不扩为全账号task。

service名称来源是[原TenantService历史绑定](../ops/deployment-baseline/tenant-b-post-rollback-offline-plan.json)，cluster来源是本次真实输出；文件指纹及“未授权未来范围”在回执中分开记录。这不是声称旧service尚存，也不是本次已获IAM授权/恢复许可。不为填参数提前启动环境，不修改草案来绕过缺项。

**下一唯一动作：只离线形成原四栈13资源/两SQL事务的一份集中安装审批材料**，复用本次输入及七份原草案；明确接受上述稳定未来service/task范围、四独立DB密码/PAT供给与五Secret真实固定输出派生、各栈预期Add/禁回滚风险、SQL提交/独立认证顺序和部分失败停止边界。不能把本轮只读批准转成安装，实际凭据读取/生成、云/SQL写与后继目录/恢复各另列准确范围；不新建安装框架或重读整批事实。当前没有安装SHA，既有实例/版本目录仍未登记，runtime关、真实版本更新0。

本轮新事实最晚`2026-11-17T00:51:38.241Z`＝温尼伯**11月16日18:51:38.241 CST**，取真实Source开始后的5小时，不因文档/提交延长。原artifact的11月15日19:07Z已过，只记原期限且不用于身份安装；旧CDN/应用IAM完整核验等历史事实也没有被这次局部补核续期。窗口不足时保留材料，不为赶期限恢复资源、重复构建或自动补读。

## 17. 原身份安装集中审批包（仅编制，未获准、未执行）

本轮只编制这一份[机器清单](aws-instance-release-activation-installation-review-20261116.json)，不再建立阶段分支或安装框架。它钉住第16节回执LF摘要、原七份文件、完整允许列表、五Secret派生规则和以下总限额；`executionAuthorized=false`。**本次“只编制”指示不是下面任何读取/生成/写入的批准。** 原SQL/CFN/runtime/工作流和旧永久槽均不变，未重跑CI。

规范SHA：**`08ceb8edcc0166bc1680d7af84b60626960b95b67e6dd7eb1c6019b3b281edc2`**。算法为递归排序对象键、保持数组顺序、UTF-8紧凑JSON；不能把文件排版SHA当规范SHA。清单JSON是准确范围及完整风险正文，以下为人读摘要。

### 17.1 只新增原四栈13资源

| 栈名 | 固定原模板 | 唯一允许的变更 |
| --- | --- | --- |
| `techlong-sandbox-instance-release-secrets-v1` | `control-secrets.draft.template.json` | PlannerSecret、ExecutorSecret、VerifierSecret，恰3项Add |
| `techlong-sandbox-instance-release-promotion-secrets-v1` | `promotion-secrets.draft.template.json` | PublisherSecret、BackendBuildTokenSecret，恰2项Add |
| `techlong-sandbox-instance-release-identities-v1` | `identities.draft.template.json` | planner/executor/verifier各一Role＋一ManagedPolicy，恰6项Add |
| `techlong-sandbox-instance-release-promotion-identity-v1` | `promotion-identity.draft.template.json` | publisher一Role＋一ManagedPolicy，恰2项Add |

合计五Secret、四Role、四ManagedPolicy（各同时作为身份授权与boundary），无额外inline。两IAM栈需CAPABILITY_NAMED_IAM；不创建Key/OIDC/桶/计算/网络/数据库，不修改原三栈、原应用角色/边界或原CFN角色。原模板均小于51,200 UTF-8 bytes，经内存SDK TemplateBody发送，不上传S3模板，不把NoEcho值放CLI参数/文件。

未来service/task权限也纳入这一次**新审批**，不是现有服务证明：

- `EcsServiceArns`：`arn:aws:ecs:ca-central-1:402010193138:service/cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service`。
- `EcsTaskArnPattern`：`arn:aws:ecs:ca-central-1:402010193138:task/cell-sandbox-1/*`；cluster严格为本次核对的`cell-sandbox-1`。

其他ReadStackArns/ReleaseStackArns、Aurora、两应用Secret元数据、ECR、zone、图片桶和Key全部取JSON中的准确字面值。当前service仍ABSENT；批准上述未来IAM范围也不允许恢复或新建服务。原应用Secret值不读，prod数据库不操作。

### 17.2 凭据、五Secret和固定输出派生

以下只在未来批准后进行，本轮没有读取或生成：

1. `.env.local`全文件读取1次，仅取原Neon owner连接并在内存验证TLS/目标/原OID与保护；owner密码不复制到新Secret。选定PAT文件`.local-secrets/d2-6-backend-actions-read-token.txt`只读1次，仅向GitHub官方做准确后端repo和`backend-image-candidate.yml`元数据GET各1次，不读ZIP/旧构建、不dispatch。过期/撤销/身份不符即停，不扩权限。
2. 在内存一次生成四个互异的32-byte随机hex DB密码，分别只用于四个新LOGIN；四个Secret正文各仅`connectionString`，token Secret各仅`token`，每份≤4096 UTF-8 bytes。内存SDK＋NoEcho供给，不放argv/参数文件/日志/Git；不读PEM、HMAC或旧Secret值。
3. 两Secret栈成功后只取实际Outputs完整ARN，核对准确名称/标签/原AWS-managed Key。对五个新ARN各DescribeSecret1次，必须只有一个初始版本；读取该键值形式的真实VersionId，不能用AWSCURRENT作为请求版本、拼后缀或UUID。
4. 对这**五个新ARN＋固定VersionId**各GetSecretValue1次，要求返回标识及完整正文与刚供给的内存值一致；SQL四密码只取这批经核对的固定版本。任何多版本/不明/不一致即停。随后IAM参数只能按本清单规则绑定这五组真实ARN/VersionId，不再为正常生成的ID另开聊天批准，也不允许换Secret或Key。

### 17.3 固定顺序与两次数据库修改提交

**新批准/时限/文件与Source核验 → 有界写前必要检查/PAT验证及Neon只读前置 → 两Secret栈各创建/严格核验/首次执行/独立回读 → 五新固定版本正文核对 → promotion事务 → 四LOGIN事务 → 独立owner及四LOGIN认证 → 两IAM栈各创建/严格核验/首次执行/独立核验 → 保持runtime关闭结案。**

- 写前只有清单列明的20项必要元数据（17名称空位、原Key、tenant栈/未决CS）及原catalog/准入核对，不回放51项整批盘点。Source必须仍是原准确IAM用户，失败不盲目刷新或自动重试。
- `promotion.draft.sql`原字节只提交1次，**它自行BEGIN/COMMIT，不再外包事务**：新增publisher NOLOGIN、两列和三函数及原窄授权，临时owner SET由原脚本在提交前关闭。原schema/grants不重放，旧表/函数不重建。
- 第二个外层事务只BEGIN1次、绑定四个密码设置，再依次原字节提交`login-roles.draft.sql`和`publisher-login.draft.sql`各1次；核对新角色/成员/权限后COMMIT1次。只新增四LOGIN，不改旧LOGIN/密码、PUBLIC/数据库ACL、业务/目录/实例行。
- 使用固定短锁/语句超时（1秒/15秒）、验证TLS并拒绝不安全启动覆盖。独立owner只读核验后，四个新LOGIN各一次独立TLS READ ONLY身份/权限认证；不调用promotion/request函数，不读业务数据。最多6条连接，2次**修改事务**之外的只读核验事务明确计入总查询上限。
- 创建者ADMIN和原owner宽管理能力保留；四运行LOGIN只继承各自原组，SET/ADMIN关闭、无owner成员/表列DML。不能把这种分工说成全库PUBLIC能力已消除或行级租户隔离已证明。

### 17.4 CFN严格门槛、总上限及失败边界

四次CREATE Change Set只使用原模板，名称按本清单SHA派生，真实StackId/ChangeSetId只取可信ACK。必须逐一证明逻辑ID/类型及Add集合完全匹配、模板规范内容一致、所有非秘密参数准确且无其他待执行CS，才Execute该完整ARN一次；不能用NoEcho回读的`****`证明秘密正文。两IAM栈绑定实际五版本后才允许创建。

Execute明确`DisableRollback=true`、`RetainExceptOnCreate=false`，Create不同时设置OnStackFailure；不设置RoleARN/ResourceTypes，不擅自调用删除或回滚API。保留成功资源不保证失败资源不受CFN原生清理。只读轮询为每栈DescribeChangeSet最多10次/间隔15秒、执行后DescribeStacks最多10次/间隔30秒，不是写入重试；异步失败/超时/ACK不明立即停止后继写。

| 全轮限额 | 上限与单位 |
| --- | --- |
| 调用方云写 | CreateChangeSet4＋ExecuteChangeSet4＝8；不代表CFN底层仅8个API |
| AWS读取 | STS2、白名单元数据160（含有界等待及独立核验，JSON分项合计）、新固定版本GetSecretValue5；无可转用的备用读取 |
| 私密/GitHub | 配置全文件1、PAT文件1、GitHub官方认证GET2、密码生成4；PEM/应用或旧Secret值/ZIP/媒体读取0 |
| Neon | 6条验证TLS连接、2个修改事务、最多120次client.query提交（含只读/事务控制、三份完整SQL脚本提交）；脚本及DO内有多条服务端语句，不冒称全库仅120条SQL |
| 其他写 | 无S3审计/镜像推送/版本与实例种子/业务写；无controller/全局apply、恢复/启停、GitHub调度或人工门禁修改 |

每次新栈Create/Execute和两个修改事务在未来执行时各有独占尝试记录，首次变更前才消费本清单SHA命名的安装槽；**本轮不创建这些槽**。单次记录不是分布式CAS，名称并非预留。网络/凭据刷新/传播失败、并发变化或提交不明均停，不自动补齐、撤权、删除、down、重放或复位；只允许同连接上明确仍打开且未提交的事务ROLLBACK释放，不对已提交/不明结果自动补偿。

完整风险在JSON的`risks`：跨服务/双提交非原子；NoEcho/SDK/SCRAM不保证提供者日志绝不暴露；五Retain Secret及部分身份可能长期遗留收费/授权；新IAM安装即有能力，runtime关闭不是权限锁，CFN/固定ECR权限不由IAM强制成“只能一份镜像”；OIDC不绑定具体run/源码、部分Describe/桶List能力有较宽可见面；SCP/有效能力未模拟且传播不保证；创建者ADMIN/PUBLIC旧能力保留；没有自动回滚/撤权/清理。原Aurora上次观测available，本次既不复查也不启停，50USD目标不是硬费用上限。

### 17.5 时间、交付标准与待确认方式

原新快照仍截至**温尼伯11月16日18:51:38.241 CST**（`2026-11-17T00:51:38.241Z`）。为整轮预留最多60分钟，**最晚17:51:38.241 CST启动**；收到独立批准才启动，不需要用户连续配合40分钟或使用Web窗口。截止约束调用方请求，不会取消已提交CFN或自动删除收费资源。过期保留材料并停止，不延旧事实/旧artifact或自行补读；过期artifact与本次身份安装无关。

成功标准仅为四新栈13资源和两事务独立核验、四新LOGIN认证及原对象/保护保持；保存非秘密ARN/VersionId/角色ID与结果。runtime/apply仍关闭，目录/实例绑定不写、service不恢复、持久化全门槛不解除，两次真实版本更新仍0；不把本次安装当作D2-6或整套上线完成。

如将来决定执行，应由用户另行明确确认：**“我确认按安装清单 `08ceb8edcc0166bc1680d7af84b60626960b95b67e6dd7eb1c6019b3b281edc2` 执行原四栈13资源及两SQL修改事务，接受未来准确service/task范围、清单内凭据读取/生成与五新固定版本使用、DisableRollback及完整风险；保持runtime关闭，不恢复环境或发布版本。”** 本节编制时未获批准；其后已获准但停止于第18节，不能沿用本节“待批准”描述重放失败命令。

## 18. 安装获准后停在本地ACL读取，未发生任何安装

用户已明确批准第17节原SHA、准确未来service/task授权、凭据使用和完整风险。21:03:41.314Z启动已批准原流程，Source及20项写前元数据全部通过；21:03:48.314Z在读取PAT前的本地ACL检查停止，原错误标签`PAT_ACL_TOO_BROAD`。[真实停止记录/原件指纹](aws-instance-release-activation-installation-stopped-20261116.json)。实际PAT/配置/Secret值读取、GitHub/Neon连接/SQL、密码生成、CS创建/执行和安装槽消费均0，没有任何新资源或身份安装，不称成功。

这是本地调用适配问题，不是已经证明文件权限变宽：当前ACL只有本人/Administrators/SYSTEM；相同Node→旧`powershell`链路复现`Microsoft.PowerShell.Security`无法加载，未终止错误令返回SID集合为空，原代码错误地将空集分类为权限过宽。初次stderr未保存，不伪称已还原其完整原始异常。只新增本地元数据helper，改用当前`pwsh`并令模块/空结果显式失败；三主体白名单不放宽，验证通过，**没有读取token或修改ACL、安装依赖**。原五程序、开始/结果/calls及未消费槽原字节保持，未自动重跑安装。

若继续，仅审[接续差异JSON](aws-instance-release-activation-installation-continuation-review-20261116.json)，规范SHA **`b15b45561c94b8801085bb85ef6bb928f574763714298dbc2d4bfcd8c07b721f`**：

- 保留首轮记录及20项成功结果，不重复盘点；新建接续journal，只修本地ACL读取，不改文件ACL/原七草案、资源、凭据来源或父清单风险。
- 原进程结束后内存凭据已释放，写入前必须重新确认准确Source。为此**仅额外批准Source STS1**：加上首轮1和原计划独立核验1，累计STS上限由2变3；接续最多2次（新Source1＋原独立核验1）。不假定旧profile身份永远不变。
- AWS元数据只剩140、累计仍160；原GitHub2、配置1/PAT1/四密码/五新固定Secret值、TLS6/SQL提交120/两修改事务、4创建＋4执行和13资源均未用且不增加。runtime仍关闭，不恢复/发布/登记目录。
- 保留原失败轮次的21:03:41.314Z开始与22:03:41.314Z终点，不改写其记录。提议仅在新明确批准后开启一次至多60分钟的接续轮次：仍须在父清单原最晚开始**23:51:38.241Z＝温尼伯11月16日17:51:38.241 CST**前启动，终点取新实际开始＋60分钟与父事实**2026-11-17T00:51:38.241Z＝温尼伯11月16日18:51:38.241 CST**的较早者。不是自动延长旧轮次或事实；不重放已执行请求，不复位槽或自动补偿。

当前只完成停止记录、本地最小修正验证及接续提案，没有接续执行批准。需要用户明确接受接续SHA、额外Source1、新一次至多60分钟轮次及原剩余范围后才开始；否则保持停止。超过父清单原最晚开始或事实期限，不能用本提案启动，不自动延窗或补读。

## 19. 接续获准后Neon连接停止，仍未安装

用户已明确确认b15b455…接续及完整风险。21:29:29.395Z在原有效期内启动新记录，22:29:29.395Z轮次终点与父事实期限保持；没有重复原20项元数据。本次Source1准确、修正后的ACL检查通过、PAT读取1及GitHub2认证GET均通过；配置读取1后首次Neon连接于21:29:33.724Z以`POSTGRES_08P01`停止。[实际回执及原件指纹](aws-instance-release-activation-continuation-stopped-20261116.json)。SQL提交/密码生成/Secret值读取/四栈创建执行/修改事务/安装槽均0；累计两轮只有Source2/原元数据20，未安装、恢复或发布，runtime仍关闭。原五程序、原停止记录及b接续程序/记录原字节保留，不重跑旧命令或复位槽。

停止后仅本地比对发现：安装`catalog.open`把`lock_timeout`/`statement_timeout`放入连接启动options；同日成功预检不传这些启动项，而是在BEGIN后SET LOCAL。无网络的真实pg序列化检查确认这两个值会进入StartupMessage。[Neon官方说明](https://github.com/neondatabase/website/blob/main/content/docs/connect/connection-errors.md#unsupported-startup-parameter)指出池化连接会拒绝不支持的启动参数；这是与08P01相符的候选原因，**原始提供者错误消息未保留，不能宣称已唯一确诊**。未再次读取配置/PAT或连接数据库，未修改线上参数、切换endpoint或实施连接修复，不要求刷新已成功的Source/PAT。

下一唯一建议仅先修安装连接启动参数，复用成功预检形式并在原事务内保持锁/语句超时、验证TLS及原SQL/连接限额，补离线回归；本轮没有这项额外修正或新连接的批准，故仅记录建议。不扩运行框架或降低超时保护，不改四模板/权限/数据库业务；修正后实际新读取和安装仍需准确新接续范围，不能借b15批准重复已用配置/PAT/GitHub或连接额度。旧相对/绝对期限均不自动延长，D2-6真实更新仍0。

## 20. 连接启动参数最小修正与离线回归完成，未重连

用户明确只批准这处连接修正与离线回归，不重连/安装或扩支线。本次仅新增一个安装专用的[纯连接/SQL派生模块](../ops/releases/installation-connection.mjs)及[14项定向测试](../tests/instance-release-installation-connection.test.mjs)，复用原无AWS回归工作流纳入测试/lint，没有新工作流、执行命令、权限或依赖。它不读取配置/凭据、不创建连接或自动运行安装。原运行时/部署工作流、四模板/三SQL原件及17份已封存失败证据全部指纹保持。

准确修正：

- 不把锁/语句超时放进StartupMessage；URL里的同名启动参数也被移除，客户端配置显式关闭其启动包形式。相同endpoint、数据库和账号不被替换；验证TLS与10秒连接/20秒客户端query超时保留，原私有适配器的目标/PGOPTIONS/TLS环境拒绝仍在。
- 仅在既有三种BEGIN形式及promotion文件的顶层BEGIN后插入`SET LOCAL lock_timeout = '1s'`与`SET LOCAL statement_timeout = '15s'`。不增加事务或client.query提交，不改SELECT/占位符、LOGIN片段、函数/DO内BEGIN、COMMIT/ROLLBACK。事务外单句仍只有原20秒客户端query超时，**不声称SET LOCAL跨COMMIT保留或客户端超时等价于服务端取消**；未来接续必须明确这一区别，不能声称所有会话语句仍有全局服务端15秒设置。
- 原SQL文件字节不改，但BEGIN提交正文和promotion提交正文会增加两条SET LOCAL，**不再等于父清单的逐字原文件提交合同**。未来新接续必须绑定这项精确差异及派生正文SHA，不得直接借旧08/b15批准执行。SQL预算单位仍是client.query提交，不伪称服务端语句数量未增加。
- 新私有`catalog-connection-fixed.mjs`仅接入这两个纯函数，query审计同时记录源SQL及实际提交SQL摘要；只通过语法/差异检查，没有加载其历史catalog或运行open/query。旧`catalog.mjs`及两个已停止入口/记录不改；未生成新的可执行接续入口或审批SHA。

本地验证：新增14/14通过；原无AWS相邻套件214项、213pass/1原Windows ZIP解包skip，类型检查、定向lint、YAML及diff检查通过。用真实pg客户端构造/StartupMessage序列化和Query协议选择验证，不调用connect、不读取.env/PAT/Secret/PEM、不用生产快照正文，不运行PostgreSQL测试连接。对应push会触发既有无AWS CI；本地通过不是云端CI或实际安装成功。

离线指纹（公开源码及promotion按LF规范文本；私有适配器按原始字节SHA）：

- `ops/releases/installation-connection.mjs`：`8ce210d535644581ea9db9f164e2d42dda4b3450408bc9b33be8da952530bc40`
- `tests/instance-release-installation-connection.test.mjs`：`f268718f1eca456ce7f00146724b407631bd3e0506b15d2328ea2ee707290ca9`
- 私有新适配器：`4087027ca607e81a0a1f4f0a58f48d4d229330d2f6c8b3d36b3b3c3cecf923aa`
- promotion派生提交正文：`59ca631d3c4a99cfb2239ef71ef32ce9beb310fcea3a98cd9ce9b2b0c2c2e17a`；原文件SHA仍`1c588056413f30e5ec0b8f0243a6af0fbbc5635ac7682f397156b5034f75aa3c`。

本轮在代码/文档收尾，不编制新安装清单、不补读取或重复凭据使用、不消费槽。后继只有用户要求继续后再集中列明必要新读取/凭据及派生SQL合同、原已用计数/剩余范围和期限，准确另审；旧事实终点与失败周期不变。runtime关、安装0、真实版本更新0，不恢复环境或发布版本。

## 21. 准确CI通过，新的安装接续清单仅待另审

用户本轮只要求先核对修复CI、准备新的安装接续，实际安装另审。已用4次GitHub GET核对[run43962796707](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43962796707)：准确源码`4cd621f2cc0c4f8f0c92bf51af34cc921a6d33bd`、main/push/attempt1、completed/success；offline214和隔离PostgreSQL16九项全部pass/skip0，新增14项连接回归、lint/类型步骤均成功。[去敏CI回执](aws-instance-release-connection-ci-20261116.json)及四份私有API/日志原件已封存。没有重跑CI或下载产物；隔离CI数据库不等于本轮重新连接Neon/Aurora，也不证明线上08P01已唯一确诊或修复已真实验证。

唯一待审[接续C准确JSON](aws-instance-release-activation-installation-continuation-c-review-20261116.json)，规范SHA：

**`26246abec9dc219d6276c4cbb1985ab8487049a254512f73a958729aebf53a5d`**

它完整继承08ceb8…父清单的四准确栈/13资源、五Secret/四IAM角色/四managed policy、两SQL修改事务、准确未来service/task允许范围、实际固定版本派生、DisableRollback/RetainExceptOnCreate=false及原全部风险。四模板/三SQL原件、原20项写前检查及17份停止证据指纹全部保持，不重盘点、不重放旧入口或复位槽。新一次性接续仅按已审代码差异接入连接修正、累计预算和新journal；原独立数据库检查器只替换适配器import，原AWS检查器不改，不另建通用安装框架。

以下仅计原安装及两个失败轮次，不含原预检或本轮CI核对；后两列均为待批上限，不是已发生调用：

| 对象 | 已用 | 接续C上限 | 累计上限 |
| --- | ---: | ---: | ---: |
| Source STS | 2 | 2（新Source1＋原独立核验1） | 4 |
| AWS元数据 | 20 | 140 | 160 |
| 配置全文读取 | 1 | 1 | 2 |
| PAT读取 | 1 | 1 | 2 |
| PAT官方认证GET | 2 | 2 | 4 |
| Neon连接尝试 | 1次失败 | 6 | 7 |
| client.query提交 | 0 | 120 | 120 |
| Create/ExecuteChangeSet | 0/0 | 4/4 | 4/4 |
| SQL修改事务 | 0 | 2 | 2 |

内存中的旧配置/PAT已随进程退出释放，不能假装仍可复用。需要明确新批配置1/PAT1/两认证GET、新Source1；失败连接保留计数后仍需原六个安装/独立核验连接名额。相对b清单累计STS上限额外加1，其余新增已用读取与连接差异如表；140元数据/四密码/五新固定Secret正文/8云写/两事务不增加，不读旧应用Secret或PEM，不连接Aurora。

**SQL合同修正必须随本SHA一起批准：** 使用第20节已审模块，在原八个至多的顶层事务BEGIN后各追加两条SET LOCAL（最多16条新增服务端语句），client.query提交和事务数不增加。原promotion文件SHA不改，但派生提交正文绑定`59ca631d…`，不是原文件逐字提交；LOGIN片段/SELECT参数/函数与DDL正文、COMMIT/ROLLBACK保持。事务内1秒锁/15秒语句、验证TLS和原10秒连接/20秒客户端query超时保留；事务外无全局服务端15秒保证，客户端超时也不保证服务端取消。这些差异已写入完整JSON风险，不以旧父清单“逐字原SQL”合同偷渡。

**时序不续期：** 仅在新明确批准后开启一次至多60分钟C轮次，最晚仍为`2026-11-16T23:51:38.241Z`＝温尼伯11月16日**17:51:38.241 CST**开始；结束取新实际开始＋60分钟与原事实`2026-11-17T00:51:38.241Z`＝当日**18:51:38.241 CST**的较早者。两个失败轮次的旧终点保留，不改为新时刻，不重计5小时事实。过期即不能用此SHA执行，也不自动补读或续窗。原20项不是资源预约，并发变动、凭据失败或任何未知写入仍停止，不重试/补齐/回滚/down/撤权或清理，可能遗留收费资源与有效授权。

新私有C入口及数据库检查器仅完成语法、与原件精确差异及本地绑定/预算核验；公开CI只证明源码模块与原回归，不冒称执行过这份私有入口。新入口会在获准后先核对本清单SHA、两停止回执/17原件、准确CI回执及九份执行文件，再以新Source身份推进从未写入的原步骤；原global `attempt.json`尚不存在，C started/result也未生成，旧文件不覆写。

当前准备中只有GitHub4次只读及本地原件核对，AWS/配置PAT正文/Neon或Aurora连接/密码生成/云SQL写/槽全0，没有准备新版本、恢复环境或运行时授权。成功标准仍只为身份组件独立核验，runtime=false/目录不写/真实更新0；本轮在待批材料结项，不执行该入口。下一只有用户明确批准本SHA、表中额外读取与连接、派生SQL合同及全部风险后，且仍未过期，才允许安装。

## 22. 获准接续已部分安装，独立catalog比较失败后停止

用户已明确批准26246…接续及新增读取/连接、派生SQL与完整风险。21:59:59.141Z在原有效期内启动，仅执行这一轮；22:01:44.450Z在独立数据库核验中停止，没有重跑C或旧入口。[准确部分执行回执](aws-instance-release-activation-installation-partial-20261116.json)绑定38份私有执行/代码证据索引、原始结果、两次COMMIT ACK、实际ARN/VersionId和七个已消费永久mutation fences；不保存凭据正文。

| 部分 | 实际结果 |
| --- | --- |
| 控制Secret栈（3资源） | `CREATE_COMPLETE`，准确模板/归属/输出独立核验通过 |
| 晋升Secret栈（2资源） | `CREATE_COMPLETE`，准确模板/归属/输出独立核验通过 |
| 五个新Secret | 实际固定VersionId已独立取得，各一次GetSecretValue与原内存输入匹配 |
| promotion事务 | 22:01:42.096Z已知提交成功；实际提交为获准派生SHA59ca631d… |
| 四LOGIN/密码事务 | 22:01:42.602Z已知提交成功，提交前四角色能力检查通过 |
| 独立数据库核验 | owner验证TLS只读连接/13次SQL后，报`OLD_PROTECTED_CATALOG_CHANGED` |
| 四窄LOGIN独立认证 | 尚未尝试，不能称四密码登录/最终权限已验证 |
| 两IAM栈（余8资源） | 未发起Create/Execute，未新增这四IAM角色/四policy |

错误发生在`verifyAfter`去除已批准新增角色/函数和publisher schema ACL之后，与原受保护catalog整体比较的最后一步。只保留了安全错误类别，没有保存该次catalog行或差异字段；**这既不能证明旧对象未变，也不能仅凭错误标签断言发生了哪一项非预期变更**。不直接放宽比较、重写旧保护基准或当作误报跳过。后续列/函数ACL细核与四窄角色认证均未完成，故身份安装仍未通过。

本轮实用Source2/元数据27/新固定Secret正文5/配置1/PAT1/官方认证GET2/四密码/Neon连接2/SQL提交36、Create2＋Execute2、SQL修改事务2且COMMIT ACK2。包含两次旧失败的累计为Source4/元数据47/配置2/PAT2/认证GET4/连接尝试3/SQL36，写仍4次CFN调用＋两事务。原20项没有重读；新连接修正已在本次实际会话通过，不再出现08P01，但这不替代整个安装验收。

两个Secret栈ID分别为`153f5090…`、`31373240…`，五个实际Secret ARN/固定版本见回执；五Secret可能持续计费，四LOGIN密码及LOGIN状态已提交。runtime=false不是凭据撤销。没有启动计算/数据库或恢复环境，没有版本/实例目录seed、业务行DML或版本发布；原七草案、原失败证据、runtime与部署工作流指纹保持，真实版本更新0。不自动删除Secret、重置密码、down/撤权、重放SQL或补装IAM；源程序、C started/result及global/六动作fence保持原字节。

停止后只核对本地已存结果、源码和摘要，新增AWS/生产数据库连接/配置PAT或Secret正文读取/写入均0。C轮次原终点22:59:59.141Z、父事实00:51:38.241Z均保留，**未用额度或尚余时间不构成失败后继续的授权**。

下一唯一提案（尚未获准）：读取现有`.env.local`全文一次，仅进入内存；一条验证TLS的Neon READ ONLY连接，最多20次client.query（含事务控制），只采集同11类catalog及准确新增对象元数据，保存私有catalog和具体字段路径/摘要差异，与旧基准逐字段比较。接受现有owner凭据较宽、整文件进内存及网络/提供者日志风险。无业务行、AWS/Secret/PAT/PEM读取，不连接Aurora，不写数据库/云、不消费新槽、不安装IAM或重试两事务，不修改保护基准；失败即停。先取得这一次限定只读许可，再准备最小核对，不另搭框架或提前修比较器。

## 23. 限定只读核对完成，当前差异仅为授权记录行序

用户明确批准一次配置读取、一次验证TLS Neon READ ONLY连接、最多20查询，其他动作禁止。本次22:22:40.435Z启动，22:22:42.817Z取得快照，22:22:43.023Z完成并关闭连接；实际配置1/连接1/client.query14（含事务控制），未用的6次不再调用。AWS、Secret/PAT/PEM、业务行、持久SQL/云写、新mutation槽、安装或恢复均0。[去敏诊断及精确证据](aws-instance-release-protected-catalog-diagnosis-20261116.json)。原始catalog、原校验器投影、具体差异和完整记录集合等价证明仅私有保存，不提交GitHub；旧38份安装原件/七永久fences全部保持，旧事实与C轮次期限不改。

这次重现了`OLD_PROTECTED_CATALOG_CHANGED`，四处按数组下标定位的表面差异是`memberships[1/2].admin_option/grantor`。原因已在本次快照确定：原查询只`ORDER BY role,member`，以下两行的这两个排序字段相同，未以grantor区分；返回先后变化后，逐项数组比较把另一行的ADMIN/授权来源当作字段被改。

| role / member（两行均相同） | grantor | ADMIN | INHERIT / SET | 行位置 |
| --- | --- | --- | --- | --- |
| deployment_release_owner / neondb_owner | cloud_admin | true | false / false | 旧下标1 → 当前2 |
| deployment_release_owner / neondb_owner | neondb_owner | false | false / false | 旧下标2 → 当前1 |

本地保留每行所有字段及重复次数作完整多重集合比较后，排除获批新增项的原12条membership精确相同；其余10类catalog也逐字段完全相同。没有删grantor、忽略ADMIN/SET/INHERIT、去重或写入新保护基准。原基准`grants-catalog.json`原字节SHA仍`ade5997330…`，与11月13日完成回执相符。授权多重集合摘要两侧均`aef15d8350196c7905695f7765dfb31d899468feccaa3b7b6954300ae219d657`，整个预期/实际保护投影的语义摘要两侧均`e8fce0ea3c0d61737a56cf5cab2e06d4ae6fb51db6b7a1fdb875b7a76b083ac5`。原校验器仍保留且会误报，诊断没有修改它。

结论只覆盖本次真实快照：之前22:01失败时的catalog行没有保存，不能倒造其逐行证据或断言不存在任何瞬时变化。本次复现和集合等价证明足以定位当前比较器的顺序缺陷，不代表新增角色认证、列/函数ACL最终核验或IAM安装已完成，更不代表业务验收或D2-6通过。

下一唯一建议仅离线修这一处membership比较，使其按完整记录稳定比较并保留所有字段/重复次数；新增回归必须证明重排行通过，而修改role/member/grantor或ADMIN/INHERIT/SET、缺/多/重复行仍失败，其他catalog比较保持原样。当前未获代码修正许可、未实施；须用户同意后只做该修正、离线回归与正常main提交，不新增生产读取、凭据读取、SQL/云写或安装入口。实际后继独立核验及剩余IAM仍须单独新范围，禁止重放已提交的两事务、两Secret栈或复位槽。

## 24. membership顺序比较单点修正，离线回归通过

用户已明确同意只修比较器与离线回归。本次新增一个[安装目录纯比较函数](../ops/releases/installation-catalog-comparison.mjs)，只对membership完整记录作稳定排序后继续原`isDeepStrictEqual`比较；role/member/grantor、ADMIN/INHERIT/SET、未知字段、类型及重复次数全部保留。其他10类catalog及其数组顺序仍按原规则精确比较，输入不变，不写新基准，不修改查询SQL或新增查询、重试/回滚/恢复框架。

原`catalog-connection-fixed.mjs`及所有失败/执行文件保持原字节。新私有`catalog-membership-order-fixed.mjs`只添加该函数import、替换同一组件中安装前/安装后两次catalog相等判断，既有新增角色/函数/成员资格检查不改。没有生成或运行新安装入口，不让旧26246…或七永久fences重新可用。

[13项新增回归](../tests/instance-release-installation-catalog.test.mjs)全部通过：重排行通过；单独改变role/member/grantor或ADMIN/INHERIT/SET仍失败；缺/多/重复行、同长度但重复计数变化、缺字段/错误类型/未知字段变化均失败；其他catalog内容/数组顺序变化仍失败；两侧输入均不改。原无AWS回归仅追加此测试和定向lint，不新建工作流/权限/依赖。相邻227项本地226pass/1原Windows ZIP解包skip，类型检查、定向lint、YAML和diff检查通过。

仅使用第23节已封存的本地快照作离线复核：旧校验器仍能复现`OLD_PROTECTED_CATALOG_CHANGED`，新适配器的原目录比较通过；在内存副本中故意把owner一条原grant的SET改为true，仍以同类保护错误拒绝。安装前基准副本仅重排行也通过，不改真实基准。原38安装证据、八份诊断/证明文件及`grants-catalog.json`的`ade599…`指纹保持，未连接数据库、读取.env/PAT/Secret/PEM或调用AWS；没有运行open/capture/query或独立LOGIN认证。

公开模块LF SHA `1937b40a4f9f7cd91e17018080d5c9c14b9b1dcbabec90eb7ae08ef9ac705191`，新增测试LF SHA `173fc68dc78e6c3aa27598091fc0bc12e035efb2fb3bbef61b73abdfad84bfbb`，私有新适配器原始SHA `68f2408e16fb7e93351e6e86174b7fab29d509a299c58d511e0160b3177c20b1`。原安装SQL/四模板、runtime与实际部署工作流不改，只有原无AWS检查工作流纳入新测试；对应push CI只核对此准确源码，不重跑或调度发布。

本轮只代码/CI收尾。四窄LOGIN独立认证、列/函数ACL最终核验和IAM余8资源仍待单独受审继续，不重放两Secret栈或两已提交事务；runtime关，未恢复/发布、真实版本更新0。原事实/旧周期期限与已用预算均不续期/复位，不能借本次修复自动生产读取或安装。
