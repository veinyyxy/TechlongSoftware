# D2-4代码交付（已结项）与后继一次性安装记录

2026-11-13，America/Winnipeg。状态：代码/离线回归/隔离PG16 CI已通过；现有Neon的空结构及NOLOGIN授权已提交并通过独立核验。[实际完成记录及剩余边界](#schema-install-completed)。`runtime.json.enabled=false`，未配置LOGIN/Secret/IAM或调度，不代表AWS已可实际发布。

当前仅按用户要求离线准备[剩余LOGIN/Secret/IAM精确材料](aws-instance-release-identity-installation.md)，不是继续开发D2-4或实际安装许可。以下历史阶段的“待安装”以其记录时刻理解，当前状态以顶部和完成回执为准。

准确证据：源码`fa2c97ed92515831cb51e5a7985ddcb36468bf5a`的[无AWS CI43501418601](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43501418601) attempt1 completed/success；137项本地相关回归及CI offline/lint/类型通过，隔离PG16原生5项通过、skip0。首个CI43498845469暴露草案IF/CASE括号语法，已单行修正，原失败保留。本轮没有读取或安装生产数据库/角色、没有AWS资源API调用或部署派发。

## 日常入口与一次批准

[`instance-release.yml`](../.github/workflows/instance-release.yml)只有workflow_dispatch，输入为instance_id、release_id和sandbox环境。没有任意ARN/镜像/角色/脚本输入，也没有push/PR自动部署。只接受本仓库main、原始attempt1；checkout固定该run的github.sha。默认关闭时准备job显示DISABLED，不请求OIDC、不读Secret/数据库/AWS，部署job跳过。

启用后的流程为：

1. prepare job使用独立准备身份，读取控制目录及固定目标元数据，验证已有ECR版本，登记一次计划/只读决定，生成GitHub Summary。批准前无CFN/ECR写；请求登记是受限SQL写，并非“完全无副作用只读”。
2. 摘要列准确实例、原栈UUID、源/目标digest、模板/配置SHA、预计两项Modify、至多Create1/Execute1、正常受管回滚/停顿/费用和原五小时截止。展示的是预期变更，不冒充真实CS。原生job outputs只传绑定指针，不传凭据、环境正文或业务数据。
3. 唯一deploy job引用既有`techlong-sandbox-deploy` environment，由用户本人批准。job内先GET本run的review history，核对准确environment ID/name及配置的人类reviewer ID；未批准、Bot、额外/含糊记录或权限不可读时停止，不调用批准API，也不静默降低门禁。
4. 同一个job内用执行身份更新原栈，另起verifier进程重读事实、写证据并登记核验，再由执行进程消费该证明CAS回写。没有再建Review/RunOnce/Inspect三个environment job。

原有prevent-self-review若开启，用户本人派发后可能不能自批；应按既定方向由现有App经另审的一次派发启动，或由其他有权操作者派发。本轮不增App权限、不替用户批准、不改现有审批设置。实际设置/套餐/角色trust尚未在线核对，不能仅因YAML写了environment就认为人工保护已安装；代码也会在没有对应人类review记录时拒绝取得执行凭据。

## 准确绑定和失效

[`handoff.ts`](../lib/deployments/releases/handoff.ts)绑定repository ID、workflow_ref、run/attempt、源码、actor、实例/版本/环境和计划SHA/原截止；请求ID由该run确定性派生。部署时从窄控制仓库重读原请求，不信任传递副本作为状态权威。旧run、其他源码/实例、改动指针、过期材料或Re-run不重放，不重新计时。排队/任务超时与读取预算不是资源TTL，不会自动停止数据库或删除服务。

普通[`instance-release-checks.yml`](../.github/workflows/instance-release-checks.yml)仍只有contents:read，不取得AWS身份、不绑定environment、不调度部署。它运行合成/SDK/子进程回归，并在GitHub隔离临时PostgreSQL 16服务中验证SQL草案；不需要本地Docker。测试账号口令`synthetic-ci-only`仅用于该新建临时服务，不是任何现有系统凭据。原生测试只接受专用loopback CI数据库，拒绝DATABASE_URL回退和现有业务库；不DROP/复位记录，服务随CI结束回收。实际CI结果以准确源码run为准，不将本地skip说成通过。

## 运行身份和隔离边界

[`aws-runtime.ts`](../ops/releases/aws-runtime.ts)从GitHub官方OIDC端点换取新STS身份，不要求本机Source登录或读取AWS profile。核对token的repo/run/attempt/workflow_ref/sha/actor/aud/sub；JWT解码本身不是验签，真实签名和已安装trust由STS验证。只使用AWS真实支持的aud/sub条件，不虚构AWS可以按任意GitHub claim做IAM条件。代码run/workflow校验也不等同于IAM隔离；main源码与environment保护仍是信任前提。

- planner：准备元数据、固定planner控制Secret和窄请求登记；无CFN/ECR写。
- executor：原栈的Create/Execute与D2-3必要读取、固定executor控制Secret和领取/回写函数；不读应用HMAC/JWT值，不直接写ECS/ELB/RDS/IAM。
- verifier：准确资源元数据、固定verifier控制Secret、固定证据前缀条件写及record_inspection函数；无CFN执行和版本指针推进权。

三个AWS角色及三个数据库登录/Secret引用必须不同。控制Secret只按安装配置的准确ARN+VersionId读取，连接用户名必须为对应deployment_release_*_login，HTTPS Neon目标受限，不使用owner或本机.env。NOLOGIN组的实际LOGIN成员、PUBLIC继承权限及Secret/KMS访问需安装时单独核验。

父进程在需要核验时才新取verifier临时凭据，经stdin传给固定脚本的新Node进程；不在argv、磁盘或GitHub outputs中保存凭据。子进程环境白名单不含AWS写凭据/profile、GitHub/OIDC token、DATABASE_URL或NODE_OPTIONS；再以STS实际角色核对，错传执行身份也会拒绝。它只拥有自身固定控制Secret读取及证据窄写，不继承能继续换取执行身份的OIDC API令牌。真实子进程测试覆盖该传递/清除机制，但不是同一runner用户下的敌对沙箱或绝对防篡改保证；真实IAM/SQL身份隔离仍需安装与在线技术核验。

## 元数据采样与不做的事

[`sampling.ts`](../lib/deployments/releases/sampling.ts)使用控制库`instance_state.binding.sampling`的受审关联信息，不复制旧固定job/历史ARN文件。新字段在初次登记时导入，不写旧业务表或保护fence：

- cellStackId/platformStackId、public hosted zone/API hostname、租户参数到Cell输出的对应关系；
- database kind/identifier/profile/schemaVersion（来自既有初始化/迁移权威记录，不声称RDS Describe能查询SQL schema）；
- 应用Secret的准确ARN/固定版本；只Describe元数据，所有task secret引用必须固定版本；
- persistence bucket/实际环境变量名及先前已核验的持久化证据SHA。

采样器读取原栈/Original模板/当前资源/未执行CS，核对Cell输出、ECS服务/任务定义/运行任务、443/8443及mTLS、三条规则/准确目标组、API alias、数据库可用、Secret版本和ECR原始manifest。截断页不当完整证据，旧FAILED/不可执行CS不误当活跃发布。共享栈摘要保留稳定输出/角色，避免仅因其他组件更新时间改变就制造伪配置漂移；执行前仍重读准确源状态。

非现有SDK读操作通过固定AWS CLI白名单、明确临时凭据、禁用profile/endpoint覆盖和自动重试的子命令执行，无shell拼接。每次snapshot最多50次元数据（实际值按安装配置），每次技术核验最多两次既有/health、/ready HTTPS GET，无重定向、无业务请求、无HMAC/凭据回退；HTTP 401/缺少可验证检查不能算成功。不存在隐式恢复、镜像发布、数据库迁移、文件迁移或清理。

S3环境配置及HeadBucket仅是当前配置/桶存在性核对，不能证明历史本地文件已迁移或应用一定正确使用S3。persistence.verificationSha256必须来自先前真实持久化验收，由受审导入记录承担来源保证；SHA本身不构成证明。没有这项证据不能填写假值启用，也不在本阶段另建迁移/证书框架。

当前模板/配置摘要须按这套真实采样算法重新建立正式绑定，不能把任意历史摘要当作当前值。CLI依赖GitHub runner上的AWS CLI；没有安装或私密材料时明确停止，不生成模拟生产状态。默认程序读取配置后即关闭；本轮未运行任何真实采样。

## 启用前唯一后继：先准备一次性安装清单

本次不将enabled改为true。下一步应另批最小只读范围，核对真实环境、已有角色/Secret可复用性、控制数据库保护布局及GitHub人工门禁，然后给出一次性准确安装清单，而不是立即启动环境或进入镜像构建支线。

清单至少包括：三表/九函数实际安装者权限和窄LOGIN成员；三个控制Secret固定版本与KMS范围；准备/执行/核验OIDC角色和aud/sub；GitHub environment/reviewer ID及分支保护；准确初始化实例/版本/persistence证据导入；采样所需元数据白名单、GitHub Actions read与证据存储范围/预算。Describe/List有些只能较宽授权，须如实披露，应用固定目标校验不是IAM等价物。所有Secret/LOGIN/IAM/GitHub配置写、生产读取、恢复与实际更新继续分别按具体范围批准。

<a id="installation-preflight"></a>

## 一次性安装准备：对象已列明，集中只读核对待批准

2026-11-13，用户要求下一步。初始提案为`LOCAL_SCOPE_ONLY / READ_APPROVAL_PENDING`，之后已获明确许可并完成下方一轮读取；当前以[真实结果](#installation-readonly-result)为准，不再等待或重放本次读取。本节只整理已有实现的安装依赖，不添加执行器或另一套部署框架，不运行草案、不修改关闭配置。目标是集中核对一次后给准确安装清单，不逐个资源来回盘点；范围不足、冲突或读取失败则保存停止原因，不隐式补读/重试或要求先恢复承载。

### 安装对象与明确不安装的对象

| 对象 | 本地已确定的合同 | 尚需真实核对 |
| --- | --- | --- |
| 控制数据库结构 | `deployment_release` schema；`releases`、`instance_state`、`requests`三表；九函数，见下方两份原草案 | 名称占用、安装者CREATE/SET ROLE能力、PUBLIC/默认ACL和旧保护目录；不覆盖现有同名对象 |
| 数据库角色 | NOLOGIN：`deployment_release_owner`、`deployment_release_planner`、`deployment_release_executor`、`deployment_release_verifier`；LOGIN：`deployment_release_planner_login`、`deployment_release_executor_login`、`deployment_release_verifier_login` | LOGIN各仅继承对应操作组，不属于owner/另两操作组，不具CREATE/CREATEROLE；管理员安装权不进入工作流。受托管角色规则影响的实际成员/ADMIN/SET/INHERIT选项必须列入最终清单 |
| 控制Secret | 三个不同ARN、各自固定VersionId，正文仅对应窄LOGIN的Neon连接串；不复用owner或旧worker的宽数据库凭据 | 拟用名为`techlong/sandbox/instance-release/{planner,executor,verifier}-db-v1`，目前只是候选名；核对占用及KMS引用，不能用不存在/历史版本冒充新版本 |
| AWS运行身份 | planner、executor、verifier三个不同角色，各自只读自身固定控制Secret；执行者不直接写ECS/ELB/RDS/IAM，核验者不能执行CFN | 候选角色名`TechlongSandboxInstanceReleasePlannerRole`、`TechlongSandboxInstanceReleaseExecutorRole`、`TechlongSandboxInstanceReleaseVerifierRole`；对应候选boundary名为相同名称去掉`Role`后加`BoundaryV1`。是否新增及完整policy/trust仍待真实核对，不修改旧worker或CFN执行角色来凑通过 |
| GitHub/OIDC | 复用本仓库main、单一`techlong-sandbox-deploy`环境和本人review；工作流仍关闭 | repository/environment/reviewer ID、实际subject模板、分支/审批/bypass设置及现有provider。prepare无environment，executor/verifier均在唯一受保护job，不能假造三个互不相通的OIDC安全域 |
| 证据存储 | 优先复用`techlong-sandbox-cloud-worker-evidence-402010193138`，候选独立前缀`instance-releases/` | 原桶账号/区域、版本化/加密/公共访问/所有权和桶策略；只有准确前缀条件写及固定版本回读。复用不代表已有权限覆盖新前缀 |
| 实例/版本目录 | 未来只受审导入已有初始化实例、可信镜像证明和真实持久化证据 | 本轮不读业务行、不导入种子；停用态不能生成运行态摘要。缺少真实图片持久化证据必须保留阻断，不填合成SHA |

安装对象计数不等于本轮写入授权。schema/grants原草案以独立事务安装，LOGIN/Secret/AWS安装属于后续准确范围；凭据不能提交Git，跨Neon/AWS不是原子事务，失败不自动补偿、回滚或补齐。若采用新基础栈，只管理这三类身份/Secret及其policy，不创建ALB/ECS/RDS/VPC或另一套业务承载；最终栈对象数和费用须在真实布局核对后列明，不能提前承诺复用或零费用。

原草案本地文件SHA256（记录时HEAD `0e677fbda37a32196441d46228a5f615e4116608`）：

- `ops/releases/schema.draft.sql`：`dec84fbb1ddca13f3167a1d287647a945b660840334a0f999f7351e5177159b0`。
- `ops/releases/grants.draft.sql`：`28dd5eca563c017f265499b5e2d6b0fb938e6af8cc4b1f761985d4fafe90ef8c`。

这些是文件完整性索引，不是用户批准SHA，也不是已应用证明；实际安装时须绑定最终代码和准确动作重新审批。

### 本轮集中只读范围（已获准并完成；不重放）

| 来源/上限 | 准确目标与允许内容 | 不包含 |
| --- | --- | --- |
| Source STS最多1次 | 既有`techlong-sandbox-user`，官方endpoint，账号`402010193138`且准确IAM user `techlong-sandbox-dev` | 不切更大角色/其他profile；凭据失败即停，不在本许可内重试或诊断 |
| AWS元数据总计最多40次 | 默认`ca-central-1`，IAM全局：原`TechlongSandboxGitHubDeploymentWorkerRole`与`TechlongSandboxCloudFormationExecutionRole`及实际关联policy/boundary；上述三个候选角色/boundary名称；既有`token.actions.githubusercontent.com` provider；原`techlong-sandbox-cloud-worker-foundation-v5`的DescribeStacks/GetTemplate；三个候选Secret的DescribeSecret元数据；准确证据桶的location/versioning/encryption/public-access/ownership/policy | 不全账号扫描角色/Secret或列桶正文；不读Secret值/固定历史对象正文、ECR镜像、承载栈/ECS/ALB/RDS/EC2/DNS/费用账单，不Validate/Create/Execute/Update/Delete |
| GitHub认证GET最多12次 | `veinyyxy/TechlongSoftware`的main/已有准确CI、`instance-release.yml`、既有environment及其人工reviewer、main保护、OIDC subject设置、Actions token权限和未完成运行 | 不读Secret值/PEM，不创建/修改门禁、App或配置，不dispatch/approve/Re-run |
| 本机配置读取最多1次；Neon连接最多1条；查询最多30条 | 现有`.env.local`全文件仅入内存，使用既有控制库URL经验证TLS；一个READ ONLY事务（含BEGIN/SET LOCAL search_path=pg_catalog/超时设置/COMMIT或ROLLBACK计入上限），仅系统目录核对当前安装者、角色名/成员/权限、schema/表/函数/触发器/RLS/默认ACL及现有保护定义的服务器端摘要 | 不输出连接串，不调用业务/安装函数，不读取账号、店铺、订单、任务/批准账本或fence业务行，不读pg_authid/密码hash，不连接Aurora，不CREATE/GRANT/INSERT/UPDATE/DELETE |

AWS所有读取（含NotFound）都计入40次：预算分配为原两角色及实际关联策略最多18、候选角色/boundary最多6、provider最多1、原foundation最多2、三个候选Secret最多3、准确桶最多6，共36，余4只供同表已列目标的必要策略元数据读取，不能扩目标。身份与元数据完整页分别核对；不翻页/自动重试/轮询，分页或权限不足如实标为未核验，不用剩余额度另开诊断。AWS先成功后才读取配置并连接Neon；GitHub在同一集中准备中核对，任一必要条件不满足便不生成可执行安装SHA。

使用现有凭据/owner连接只用于这一轮目录核对，权限本身较宽；配置整文件、模板/策略响应会进入必要进程内存。仅保存允许的名称/ARN/版本元数据、权限布尔值、计数与摘要到本地私有证据目录，不输出/提交配置、模板环境正文、凭据、业务数据或原始错误。接受网络、内存、提供者日志及低额非零费用风险。成功快照按真实开始时间起最多5小时，不更改旧事实/期限，不启动资源租约。

### 核对通过后的唯一交付

据本轮真实状态列出：准确复用/新增对象、现有安装者权限、SQL/角色成员差异、三份Secret/KMS范围、IAM trust/inline/boundary、证据前缀和GitHub门禁绑定；给每个实际写入的次数上限、顺序、独立回读、跨服务部分失败处理及完整风险，再生成新的安装审批SHA。不得用候选名称、文件指纹或本节方向批准代替实际写入批准。

安装后仍保持`enabled=false`，先独立核验空结构/权限及固定引用。目录导入和采样基线只能在另批恢复后基于真实资源/合法版本与持久化原件建立；不因安装完成自动恢复环境、派发工作流或开始D2-5。已有ECR路径可继续D2-6技术验收，不要求先扩镜像生产功能；买卖家业务验收仍由用户负责。

<a id="installation-readonly-result"></a>

## 集中只读核对结果：空位/门禁已确认，安装草案尚需一处权限顺序修正

用户明确回复“允许”后，本轮使用源码`2c3e52fea8993926c66066e10935a26a868ace0f`的已批准范围，于2026-11-13T21:10:40.091Z开始，21:14:08.892Z结束。状态`READONLY_PREPARATION_COMPLETE`只表示读取完成，不表示可安装、已授权安装或功能已启用。

实际调用：**STS1 / AWS元数据29 / GitHub GET10 / 配置读取1 / TLS连接1 / SQL16**（含事务控制）；没有自动重试、翻页或额外诊断。AWS/数据库/GitHub写、业务行/Secret值/PEM读取、Aurora连接、工作流dispatch及执行槽消费全部0。只访问已列基础身份/桶/目录，未查询ALB/ECS/RDS状态或技术HTTP，也未启动收费环境。

| 事实 | 实测结果与限制 |
| --- | --- |
| Source与基础栈 | 准确IAM user `arn:aws:iam::402010193138:user/techlong-sandbox-dev`。原worker foundation栈UUID308174f0…为UPDATE_COMPLETE；模板SHA `3f6d354f163cb558dba33353d91b4c5a32b29b8534c6703197e5847722cabd3f`。这是身份基础栈，不是业务承载可用证明 |
| 新名称 | 三个候选AWS角色、三个boundary、三个控制Secret均准确NotFound；Neon无deployment_release schema及上述7个角色。未创建占位或生成密码 |
| 原角色可复用性 | 原worker角色包含CreateStack/DDB/旧前缀证据写等能力并绑定旧流程，不把它当本日常更新的三类分离身份；原CFN执行角色ID `AROAV3GNMXTZKHYBCRSOE`、boundary默认v10。本轮保持原角色和边界，不为新流程扩大它们 |
| 证据桶 | 准确账号/ca-central-1、Versioning=Enabled、AES256、四项BlockPublicAccess=true、BucketOwnerEnforced。既有条件写/不删除约束只覆盖旧worker前缀；新`instance-releases/`不能宣称已受同样桶策略保护，后续新角色policy/boundary须明确条件PUT及无删除。未读取任何对象正文 |
| GitHub人工门禁 | repository ID1323312747，environment ID24613410405；required reviewer为人类veinyyxy/ID14145707；can_admins_bypass=false、prevent_self_review=false，environment只允许main分支。既有设置无需为本轮更改，批准仍由用户本人完成 |
| main/OIDC/工作流 | main保护端点404，记录为未取得保护配置，不声称main已有分支保护或必为权限错误。默认token只读/不可批PR；OIDC使用immutable前缀`repo:veinyyxy@14145707/TechlongSoftware@1323312747`、provider含aud sts.amazonaws.com。新角色trust须使用真实前缀而非旧普通仓库名；没有取得真实新job token或验证新角色trust。Instance API release运行总数0；源码fa2c97e的准确CI43501418601仍success |
| Neon身份与只读 | PostgreSQL18.7，current/session user均neondb_owner，非superuser、CREATEROLE=true、CREATE schema=true；连接TLSv1.3且证书验证通过，READ ONLY事务。目录包含3个非系统schema、43个表/视图/序列等关系、51函数、23个definer、402触发器（其中58非内部），没有读取这些对象的业务行 |

### 唯一需先处理的安装前提

现有同类自建角色对neondb_owner的成员记录均为`ADMIN=true / INHERIT=false / SET=false`。两份原草案的适配缺口是：

1. `schema.draft.sql`创建NOLOGIN owner后立即`CREATE SCHEMA ... AUTHORIZATION deployment_release_owner`，随后`SET LOCAL ROLE`，却未显式赋予安装者切换新owner的能力。
2. `grants.draft.sql`另一个事务由安装者创建操作角色后，直接授予owner所属schema/函数权限；没有切换到有权授予这些对象权限的owner。

官方PG18说明，非超级用户CREATEROLE创建角色时会取得ADMIN，但自动取得SET/INHERIT另受`createrole_self_grant`影响；CREATE SCHEMA指定另一owner也要求能SET ROLE到该owner。[角色创建设置](https://www.postgresql.org/docs/18/runtime-config-client.html#GUC-CREATEROLE-SELF-GRANT)、[角色授权/SET与对象所有权](https://www.postgresql.org/docs/18/sql-grant.html)。因此，现有PG16超级用户CI通过不能证明原安装顺序适用于这位非超级用户；这是从实测成员布局、草案及官方规则得到的安装前提判断，不是本轮实际尝试CREATE/SET后失败。没有查询当前createrole_self_grant，也不假称已证明新角色创建后的具体选项。

**本轮读取后的最小建议（现已另获代码范围同意）：** 在原两份SQL草案内显式处理安装者对新owner的必要授权/切换和收尾，既有隔离PG CI改用具CREATEROLE但无SUPERUSER/owner SET/INHERIT的安装者执行相同草案，验证owner归属和原运行角色ACL不放宽。保持九函数/三表及运行角色能力不变，不改全局PG设置、Neon hook、旧保护、其他角色/旧工作流，不新增探针/框架。读取轮没有修改SQL或运行代码；后继最小修正见下段，不封存未经验证的可执行安装SHA。

### 最小修正已完成：准确非超级用户原生CI通过

仅修改原两份草案及既有测试。安装使用获批的真实SESSION_USER：临时授予owner SET、明确INHERIT=false，schema事务在CREATE SCHEMA AUTHORIZATION之前取得必要能力；grants事务创建三个NOLOGIN角色后切换owner再授予原准确函数权限。两事务最后SET LOCAL ROLE NONE、把安装者owner SET关闭后才COMMIT，失败随事务回滚。创建者原ADMIN不撤销，也不声称这种管理身份从此不能重新授权自己；可能保留显式无SET/INHERIT的成员记录，日常运行三角色没有owner成员关系或表DML。

九函数正文、三表定义及三类运行角色的原授权保持，runtime仍false。137项本地回归、lint和全项目类型检查通过；新增原生子测试先以独立非超级用户LOGIN证明仅ADMIN时CREATE SCHEMA/SET ROLE被拒，再由该LOGIN执行两份原草案，检查安装后归属/临时权限关闭，并继续原ACL/行锁/CAS/失败围栏测试。只复用既有PG16临时服务，无新workflow/权限；本地没有专用CI数据库，原生测试明确skip。本轮生产配置/数据库/AWS读取写入均0，未应用草案或启动承载。

最终证据：修正源码`727affe9b5736e3c52f744cde92d14c29a14af52`的[CI43513493163](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43513493163) attempt1 completed/success，head SHA与offline/postgres两job均核对；postgres job132189394526日志确认原生6测试全过、fail0/skip0，其中明确包含非超级用户真实登录执行两份草案及关闭临时owner权限。此结果不沿用旧fa2c97e的超级用户测试，也不证明现有Neon18托管安装已执行。后续纯文档HEAD不是新的已测运行源码。

本阶段结束。唯一后继是复用本节原真实事实（原截止保持）与本次源码/CI，在本地准备精确一次性安装清单；安装、凭据生成/Secret使用、IAM/数据库写、恢复及实际发布仍按准确对象/风险另批。当前无新的可执行安装SHA，不重跑已消费读取配方，不开新短窗口或扩镜像生产功能。

### 原件与恢复点

私有目录：`E:/NodejsProject/TechlongSoftware/.local-secrets/d2-4-install-readonly-20261113-a/`，ACL仅用户、SYSTEM及Administrators，Git已忽略；内容只有固定配方及去敏权限/目录元数据，没有配置正文、连接串、密码或业务快照。读取配方一次性标记已保存，不能重跑；不把剩余预算用于重新连接或补读。

- `aws.result.json` raw SHA256：`096d626fe0a9a70695679d15c5f25eef6b6aaed0d0f75433c5433d7d8a2b4fe6`。
- `combined.result.json` raw SHA256：`1d799101f54650d1c2386973493183b016907dcd5afd5657bc25ee7fa07b71ad`。
- Neon目录投影SHA256：`346c20991972b9b2ba7805e1f5a748b1605028b17fd3fff97e6039037ea4d679`。它只描述本次目录，不是业务行/历史账本保持或新运行身份已验证的证明。

准备事实五小时上限仍从真实开始计，到2026-11-14T02:10:40.091Z（温尼伯11月13日20:10:40.091 CST）；后续本地检查/文档提交不重计。它不是资源租约、写入授权或自动费用守护。过期时只在确有必要且新范围另允后补读，不重放本次脚本；runtime继续`enabled=false/environments={}`，无新安装/调度或收费环境恢复。

<a id="schema-install-review"></a>

## 精确安装审批材料：本次只安装空结构及NOLOGIN权限

**最新实际状态：原9dfad976…握手停止、2a0cd179…schema部分提交后，另获批a79ea11b…已完成剩余grants与独立核验。** 三个槽均已消费，见[完成记录](#schema-install-completed)。本节下方原清单说明保留为范围/风险依据，不将文件中的“AWAITING_APPROVAL”视为旧槽仍可用。

2026-11-13，本轮只离线准备，未新增生产/私密读取或远端写入。完整安装差异收拢在本节，不复制工作流或新建安装/恢复框架。**本次可批准对象是[机器清单](aws-instance-release-schema-install-review.json)，不是对下表全部后续工作的笼统批准。** 两份准确SQL已由727affe的非超级用户CI43513493163验证；这不自动覆盖尚未编制验证的LOGIN/Secret/IAM安装。

准确批准SHA：`9dfad9765217b835d95708ef5358b48d3c3d0008bf0bff2b687f0b589479b9cb`，计算为机器清单对象的SHA256/规范JSON（递归按属性名字典序排序，数组顺序保持），不含另行推导/替换。当前AWAITING_APPROVAL，未执行；本地已核对两份artifact与727affe逐字一致（仅CRLF规范为LF）、九签名/四角色及两事务范围、原回执/目录摘要、原五小时终点/10分钟预留、runtime关闭和attempt不存在，361条本地链接有效。这是材料校验，不是新的数据库或CI运行，也不是将源码CI扩大成实际Neon安装证明。

### 总安装差异及本次边界

| 对象 | 当前已知/准备的差异 | 本次执行清单 |
| --- | --- | --- |
| 控制结构 | 新deployment_release；三张空表releases/instance_state/requests；九个原准确签名函数 | 包含，两份固定SQL，两个事务，不导入记录 |
| NOLOGIN | 新deployment_release_owner/planner/executor/verifier；只授予原函数；临时owner SET在各事务结尾关闭 | 包含；不改变旧角色/保护或全局PG设置，创建者ADMIN仍可能保留 |
| LOGIN | 后续新deployment_release_{planner,executor,verifier}_login，只继承对应操作组，无ADMIN/owner或跨组能力 | 不包含；本次不设置密码/LOGIN、不建立新认证入口 |
| 控制Secret | 后续三个已核对未占用的techlong/sandbox/instance-release/{planner,executor,verifier}-db-v1，只存对应窄LOGIN连接串；各自固定版本 | 不包含；不生成/读取密码，不提前创建收费占位 |
| IAM角色与boundary | 后续三个TechlongSandboxInstanceRelease{Planner,Executor,Verifier}Role及对应BoundaryV1，由CFN管理；不扩大或复用旧worker宽身份 | 不包含；目前只有对象/能力合同，未形成完整可执行模板，不把草案当已审权限 |
| OIDC与GitHub | 后续trust用已观测immutable仓库前缀及aud；planner按main、executor/verifier按唯一environment；保留本人审批 | 不包含设置写入，不复制旧角色的其他claim；本次不代批/派发或启用配置 |
| 证据桶 | 后续复用已核对的既有桶，新instance-releases/前缀需独立条件写/固定版本读且不允许删除 | 不包含桶/policy/对象写；不把旧前缀约束说成新前缀已有保护 |
| 实例/版本种子 | 后续从合法初始化/镜像/持久化原件导入，停用态不伪造运行摘要 | 不包含；本次三表必须保持空，不创建发布请求或业务任务 |

未来常规IAM职责保持：planner只采样/自身固定控制Secret/SQL准备；executor只准确既有租户栈Create/Execute及回写，不能直接写ECS/ELB/RDS/IAM；verifier只采样/自身固定控制Secret、证据窄写和验收登记，不能执行CFN或推进版本。Describe/List有些只能较宽授权、KMS/Secret固定版本条件及确切资源ARN须在后继完整policy中明确，不能用软件白名单宣称IAM已隔离。本次不会申请这些云权限。

将已验证的空结构单独作为本次批准对象，是为了不把缺少实际权限模板/凭据处理材料的写入混进同一SHA；不是已经完成整个一次性安装，也不是新功能支线。后继LOGIN/Secret/IAM仍在这份总表内集中准备，不开启新的generation探针或要求用户配合Web短窗口。

### 本次准确动作与技术核验

机器清单ID `261fcc66-95a7-4d34-a061-525293471016`。目标仍是现有`.env.local`的DATABASE_URL所指Neon控制库`neondb`，真实SESSION_USER必须为neondb_owner、验证TLS；不使用AWS Secret/本地PG/Aurora或其他配置回退。审批只允许一次读取该整文件，URL/密码只在必要进程内存使用，不打印或保存。

执行前验证本清单SHA、原始真实回执SHA及两份SQL的UTF-8/LF规范化SHA；SQL必须等于727affe版本，不接受临时替换对象名/函数/语句。再以READ ONLY事务核对安装者、七个候选角色均缺失、目标schema缺失，以及完整旧目录/保护投影与已存基准一致。若事实或能力不匹配，在任何DDL前停止；不自动修正基准或补权限。

“旧目录保持”按原始身份逐项核对，不是把新增对象直接混入旧全量摘要再误拒，也不忽略整个名称前缀：仅允许准确新schema/四角色/安装者成员、三表/九函数、SQL自动生成的约束/索引/内部外键触发器及本次明确的ACL/default ACL增量。旧对象缺失或原权限/定义变化均拒绝；新函数还须将服务器端prosrc摘要与批准SQL原函数体逐项匹配，并核对owner/签名/SECURITY DEFINER/search_path，不打印函数正文或变更旧基线。

1. 固定提交schema.draft.sql一次。它有自身BEGIN/COMMIT，不能外包另一个事务或拆开/改写批次。新owner/schema/三表九函数及PUBLIC撤销在本事务内完成。
2. 独立新只读连接验证准确归属、三张表均空、九函数/固定search_path/PUBLIC权限、安装者owner SET/INHERIT关闭；完整旧目录保持。只有COMMIT ACK明确且独立核验通过才允许下一步。
3. 固定提交grants.draft.sql一次。新建三操作NOLOGIN组并在临时owner身份下授予原准确函数，结尾关闭安装者SET。
4. 另一独立只读连接核对四角色属性、准确函数ACL、运行角色无owner成员/表DML、三表仍空及旧目录保持；只保存允许状态/OID/ACL摘要/哈希，不保存密码、连接串或业务行。

上限：**配置读取1次、验证TLS连接3条、客户端SQL提交90次，其中含DDL批次2次/事务2次**。两份批次各包含多条DDL及权限语句，不能把“两个批次”说成只改两个对象或只执行两条SQL。独立只读核验查询在90次内；不读取旧表/任务/账本业务行，不调用旧保护或业务函数。AWS/STS/GitHub/API调度/Secret值/私钥读取均0，无需为本次先刷新Source；本次批准也不包含未来IAM/Secret写入。

第一次DDL前须在唯一私有attempt路径以create-only创建标记，不覆盖已有标记；无自动重跑、换根或复位。允许在已批剩余连接/查询/时间预算内独立记录不明状态，但任一未知后不得继续提交grants或重发SQL。脚本/进程失败若仍有未提交事务，可按连接关闭/数据库原生事务语义回滚；COMMIT响应丢失不能直接当作回滚成功。

### 时间、部分失败及完整风险

原事实仍仅有效至**2026-11-14T02:10:40.091Z＝温尼伯11月13日20:10:40.091 CST**。本次最晚开始为02:00:40.091Z＝20:00:40.091 CST，预留10分钟；单次总时长最多10分钟且不得越原终点。不因新清单、代码/文档提交、额度恢复而重计，不新增资源TTL。过期只保留材料，必要新事实读取另审，不重放本轮只读配方。

- 安装者有宽管理能力、配置整文件进入内存，TLS验证不消除网络、内存或服务商日志风险；本次不创建新密码，但现有认证凭据仍会用于准确Neon连接。
- CREATE ROLE/schema/函数会产生系统目录锁及保护约束，Neon提供者的角色管理hook可能拒绝；PG16隔离回归不是Neon18安装已成功的证明，不关闭hook或改全局设置来绕过。
- 两事务及跨连接核验不是整体原子。第一事务提交后第二步失败，可能留下一套无LOGIN/无数据的结构或部分NOLOGIN授权；失败保留现场，不自动删除、down、补齐或补偿式回滚。
- 原创建者ADMIN能力可能保留；关闭SET/INHERIT不是移除管理员重新授权自己的能力。运行三组不因此获得owner、表DML或新登录权限。
- 并发旧目录变化、权限变化、提交ACK不明或预算耗尽都停止后续写入；永久尝试标记不自动复位，不以原SHA尚未到期重跑。
- 本清单不创建AWS收费资源，但不能据此声称原账号已经零费；Neon使用及已有存储/日志等仍可能计费。后续若创建三个Secret，按[AWS官方价格示例](https://aws.amazon.com/secrets-manager/pricing/)每项0.40 USD/月估算约1.20 USD/月另加API/地区税费，此处不是ca-central-1实际账单报价，更不在本次许可内。

后继AWS材料必须继续遵循CFN归属原则。官方支持模板创建不含值的Secret，但本次明确不创建空Secret；[空Secret及默认AWS-managed KMS语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)、[Secret固定版本授权条件](https://docs.aws.amazon.com/service-authorization/latest/reference/list_secretsmanager.html)、[KMS转发与加密上下文](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)只是后继模板依据，不是额外安装授权。

原准备只封存清单，后经用户批准才首次调用；当前已在握手停止，不因其期限未到而再次执行该清单。不启用runtime、不派发工作流、不恢复ALB/ECS/RDS。未来另批成功也只称“发布控制空结构/NOLOGIN授权安装完成”，不称日常发布或SaaS自动交付已完成。

<a id="schema-install-continuation"></a>

### 原握手失败与连接续接清单（已消费，保留执行前记录）

下述2a0cd179…已经获批并唯一执行，schema已提交、grants未提交；不是当前待批清单。真实结果与新边界见[仅剩余授权](#grants-install-continuation)，不重放本节命令。

准确[停止摘要](aws-instance-release-schema-install-stopped-20261113.json)：2026-11-13T22:23:32.751Z开始、22:23:33.842Z结束，CONFIG阶段POSTGRES_08P01；配置读取1/连接尝试1、SQL提交0/DDL提交0/COMMIT ACK0及所有云/私钥/Secret/GitHub/dispatch0。没有提交CREATE/GRANT等安装语句，不需要本轮down；不是已安装或已独立验证新目录状态。原始错误正文未保存，不声称唯一根因是凭据/网络/代理配置，也不因此要求刷新AWS Source。

实际本地差异是本次调用在startup options里加入了default_transaction_read_only、statement_timeout和lock_timeout，而旧成功reader使用URL和验证TLS、只在事务里SET LOCAL超时。本轮没有追加诊断连接或读取配置，只新建另一份私有调用：复用URL＋严格TLS，删除连接URL的TLS/启动option覆盖，不发送startup options；原11条SELECT、明确BEGIN READ ONLY及SET LOCAL、准确两份SQL和检查保持。写前只读检查现有会话默认default_transaction_read_only必须off，不用修改角色/全局设置来补齐。

新的[续接机器清单](aws-instance-release-schema-install-continuation-review.json)批准SHA为 **`2a0cd1794b6437de66fb44ad2549b70d72a3c8546aaad483cc56bdf8f2ab9217`**，仍按规范JSON/SHA256计算。ID5162f4e3-000f-4ff5-bd4a-1e846ca14bed，绑定原准确manifest、attempt/result原字节SHA，以及新私有调用`execute.mjs` raw SHA `c84fe4ae3b7c7d3f099f2c8d8ca42c1821dd7136d7d15f1d4ebe09c933010538`。它只在用户新批准后消费自己的create-only attempt；原261fcc66…目录三个文件原字节保持，不复位/删除/覆盖，不使用旧命令。

两份SQL artifact、NOLOGIN四角色/三表九函数、运行权限、步骤/独立核验和本节完整风险保持；仍无LOGIN/密码/Secret/IAM/业务行/云写/恢复/派发。新一次上限配置1/TLS3/SQL90（两DDL批次），与已用失败合计保守配置2/TLS4/SQL90/DDL2。0写证据仅用于允许另审新尝试，不能变成自动重跑许可。

**新增须接受的实际限制：** 连接更正尚未在线证明；先前08P01的唯一提供者原因未知。去除startup选项后，准确DDL批次不插入额外SET语句，客户端只等待最多20秒；超时或断线不证明服务器已经取消/回滚，必须停止更多写并在已批剩余预算内独立记未知，不重发。只读事务仍有SET LOCAL的查询/锁时限；新捕获仅保存SQLSTATE及白名单错误分类，不保存URL、密码或原始错误。任何再次失败均停止，不开连续诊断/试错连接。

本地已核对：旧attempt/result/调用的原字节、新脚本指纹/语法、两个清单的artifact/对象/权限/预算/原窗口相同；合成pg客户端构造不带startup options、证书验证仍true，固定配方check-local通过（11条目录SELECT/9函数体），新attempt不存在。全部是离线检查，配置/连接/SQL新增0，不能说Neon连接已恢复。

原事实仍到2026-11-14T02:10:40.091Z，最晚开始02:00:40.091Z＝温尼伯11月13日20:00:40.091 CST；新准备时刻和本地代码更改不延长它们。当前只请求用户按新SHA允许一次独立尝试并接受本节完整风险，未再次连接或执行SQL。后继实际结果必须保留原失败与新回执；成功才继续LOGIN/Secret/IAM材料，不能把本次批准扩大到启用整个功能。

<a id="grants-install-continuation"></a>

## 剩余授权审批与原风险（已消费，以下为执行前材料）

本节a79ea11b…已获用户明确确认并唯一成功执行，不能再运行。最新状态见[完成记录](#schema-install-completed)；下文的“待批/未消费”均是原准备时刻，不是当前许可。

### 已发生的提交与停止

用户批准2a0cd179…后，2026-11-13T22:39:02.337Z开始唯一调用；22:39:04.967Z收到原schema批次COMMIT ACK，22:39:06.818Z在SCHEMA_INDEPENDENT_INSPECTION以UNEXPECTED_ROLE_MEMBERSHIP停止。实际配置1/TLS2/SQL38/DDL1/ACK1，AWS/GitHub/Secret值/私钥/dispatch0；没有grants提交记录，没有创建三操作角色。[部分提交摘要](aws-instance-release-schema-partial-20261113.json)保存全部原件指纹；原9df…握手attempt和本次2a0…attempt均不可重放、改写或复位。

已存目录中deployment_release schema OID237571；releases237572、instance_state237590、requests237611，九函数OID和owner绑定见新清单。owner为NOLOGIN，无SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS；两条安装者成员记录的显式SET/INHERIT均false。**这不是完整独立核验通过：** 原有效权限查询结果没有持久化，空heap证明也未运行到，不能断言没有其他差异或已安装成功。

### 唯一局部修正及离线回归

私有一次性配方在ARRAY里选择pg_roles.rolname，实际得到name[]（OID1003）。当前已安装pg驱动把空值解析为字符串`"{}"`（length2），导致原`parents.length===0`确定误拒。只改为`ARRAY(SELECT pr.rolname::text ...)`，得到text[]（OID1009）；零父角色、有效SET/INHERIT关闭、原ACL与旧目录要求全部保留，不忽略角色或修改数据库授权来绕过检查。新配方在断言前保存去敏角色观察，避免再次丢失这一元数据结果。

本地回归直接使用已安装pg解析器，证明原空name[]误拒、空text[]通过、非空父角色或有效SET/INHERIT为true仍拒绝，并核对唯一DDL入口只能submit(1,'grants')、不能submit schema。回归和固定check-local均通过；本轮配置/连接/SQL新增0。重现文件在新清单ID对应的私有目录type-regression.mjs，未形成新运行框架或工作流。原两份727affe SQL/权限和CI证据不变，未为文档重跑CI，也不把离线转换测试当线上校验结果。

### 新批准对象与执行顺序

[仅剩余授权机器清单](aws-instance-release-grants-install-review.json)，规范JSON/SHA256批准值 **`a79ea11bac284f2d949ca15ac22dca214b228aa528787a5f1928db6b9ecb2e0b`**。独立ID9ce8f77a-fed4-4d3f-a8c0-4f7893d38925；私有调用raw SHA `6302f0f4a9bf605d0a5446bc130a553baf79cc45d3e142e4074976e88204d328`，绑定原事实、schema ACK/目录/attempt/result原件SHA及准确已有OID。新attempt未创建，当前只是材料准备，不获准自动重连。

1. 本地核对新SHA、原两SQL、runtime关闭及两旧attempt原件；只消费这个新的create-only槽。读取固定.env.local整文件一次，只使用既有Neon URL/验证TLS，无替代凭据或端点。
2. 一条新的独立连接先在READ ONLY事务验证准确已有OID、九函数体SHA/owner/ACL、显式与有效角色权限、三张普通heap零字节且无继承，以及原旧目录逐项不变。只允许原已批准schema增量，不替换基准或将整个前缀忽略；任一差异即停，不提交授权。
3. 只有已有schema核验全过、会话默认只读原本off，才COMMIT只读事务并在同一连接提交原grants.draft.sql一次（其自带BEGIN/COMMIT）。仅创建planner/executor/verifier三NOLOGIN组及原schema/函数权限，结束关闭临时owner SET；schema.draft.sql仅作函数体指纹依据，绝不再次提交。
4. 另一条独立READ ONLY连接核验四角色总集、原运行ACL、运行角色无owner成员/表DML、原schema/table/function OID不变、空heap及旧目录不变。只有ACK与最终核验都通过，才能称空结构/NOLOGIN安装完成；仍不启用runtime或派发。

本次上限配置1/TLS2/客户端SQL50（含一个完整DDL批次）/DDL提交1/DDL COMMIT1，新schema/表/函数0、三NOLOGIN；AWS/STS/GitHub/Secret值/PEM/dispatch均0。包括原握手和schema提交两次尝试的保守总上限配置3/TLS5/SQL88/DDL2；不是把旧剩余额度自动转入本次。无LOGIN/密码/Secret/IAM、实例版本种子、业务行读取或ALB/ECS/RDS恢复。

### 本次须接受的完整风险与停止规则

- 安装者是宽管理身份，现有配置整文件进入内存；验证TLS不消除进程内存、网络或提供者日志风险。新方案不读取Secret值/私钥，也不保存密码正文。
- 原schema已经提交，后续授权与独立观察并非一个跨连接原子操作。系统目录锁、Neon角色hook或并发变化都可能停止；text[]修正不能保证所有线上权限检查通过，PG16 CI也不是Neon18成功证明。
- 三NOLOGIN角色创建后，提供者可能保留创建者ADMIN成员；安装者管理能力不被本次撤销。只在事务内临时owner SET，结束要求SET/INHERIT关闭，不向运行角色开放owner或表DML。
- DDL客户端20秒超时不证明服务器取消/回滚；丢失提交ACK须保留UNKNOWN，只可在本次剩余预算内用已批准独立读取记事实，绝不重发。失败可能保留已提交schema及部分/全部授权，不自动down、补齐、改权限、清理或新开连接。
- 所有旧槽/原件保留，新槽也永久一次，不复位或自动恢复。现有AWS存储等仍可能收费；本次不新建AWS计费资源，但不能承诺所有费用为零。

最晚开始仍2026-11-14T02:00:40.091Z＝温尼伯11月13日20:00:40.091 CST；结束不晚于开始后10分钟且不晚于原02:10:40.091Z。准备/中断续接不重计事实时间；过期不执行，必要补读另审。不需要AWS Source刷新。后续LOGIN/Secret/IAM属于原总安装差异表，仍另审，不借本次新SHA自动启用日常发布功能。

<a id="schema-install-completed"></a>

## 空结构及NOLOGIN权限安装完成：不等于功能已启用

用户对上一条准确a79ea11b…清单/风险明确回复“确认”，本轮于2026-11-14T00:52:42.954Z开始，00:52:45.643Z完成已有schema核验；00:52:45.761Z收到原grants.draft.sql的COMMIT ACK；00:52:47.672Z完成另一READ ONLY连接核验，00:52:47.734Z关闭结束。完整结果为SCHEMA_NOLOGIN_INSTALLATION_INDEPENDENTLY_VERIFIED。[完成摘要](aws-instance-release-schema-install-completed-20261113.json)记录实际计数、原件SHA及已消费attempt；原握手和schema部分提交记录均保留。此前一次本机安全审批拒绝未启动命令、未读取配置或连接/消费槽；明确确认后才进行了这一次实际执行。

实际配置读取1、验证TLS连接2、客户端SQL44（含原完整grants一批）、DDL提交1/COMMIT ACK1，AWS/STS/GitHub/Secret值/私钥/派发0；schema提交0。三次实际尝试总计配置3/连接5/SQL82/DDL2/ACK2。仅创建三个操作NOLOGIN角色，没有重复运行schema或改九函数正文。

独立核验确认：schema237571、三表237590/237572/237611及九函数原OID保持；九函数体SHA/owner/SECURITY DEFINER/search_path与727affe准确原文相符。四NOLOGIN均无SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS，schema和逐函数ACL符合原分工，无PUBLIC函数执行；三操作角色无owner成员或表/列DML。有效安装者SET/INHERIT均false、四角色的父角色均空；创建者ADMIN仍可管理授权，不声称宽管理身份已收窄。三普通heap主fork均0字节且无继承，以元数据证明空表，没有业务行SELECT。原旧目录投影逐项保持，未将新对象替换为新基准掩盖旧差异。

本轮只在获批两条连接内完成这些验证，后续仅读取已封存本地回执并记录文档，未追加生产检查。原SQL/运行代码及工作流未改，不重跑CI；实际Neon验证由本次原件证明，而非沿用隔离PG16结果推断。新attempt及原件永久保留，禁止重放a79…和check-local/复位槽；runtime仍enabled=false/environments={}。

当前尚无三窄LOGIN/密码、固定控制Secret、三类IAM/boundary/OIDC的本阶段安装，也没有实例/版本种子、真实日常更新或ALB/ECS/RDS恢复。唯一后继沿原总安装差异表准备这些剩余精确材料，不另起框架/探针或D2-5支线；当前只本地复用已存事实，新生产读取/Secret值/私钥使用或安装仍按准确范围另审。原事实2026-11-14T02:10:40.091Z不延长；本次已完成回执永久可追溯，不等于未来仍可拿过期快照执行。当前阶段到此收尾，不自动进行后继写入。

官方依据：[GitHub review history GET](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run)、[environment审批](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)、[OIDC claims及aud/sub](https://docs.github.com/en/actions/reference/security/oidc)。这些支持接口设计，不是已安装/已部署的证明。
