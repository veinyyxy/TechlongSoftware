# D2-4：单审批发布工作流与运行接线

2026-11-13，America/Winnipeg。状态：代码/离线回归/隔离PG16 CI已通过，`runtime.json.enabled=false`；未在既有系统安装、未调度，不代表AWS已可实际发布。

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

### 已获准的最小修正：本地完成，准确原生CI待核对

仅修改原两份草案及既有测试。安装使用获批的真实SESSION_USER：临时授予owner SET、明确INHERIT=false，schema事务在CREATE SCHEMA AUTHORIZATION之前取得必要能力；grants事务创建三个NOLOGIN角色后切换owner再授予原准确函数权限。两事务最后SET LOCAL ROLE NONE、把安装者owner SET关闭后才COMMIT，失败随事务回滚。创建者原ADMIN不撤销，也不声称这种管理身份从此不能重新授权自己；可能保留显式无SET/INHERIT的成员记录，日常运行三角色没有owner成员关系或表DML。

九函数正文、三表定义及三类运行角色的原授权保持，runtime仍false。137项本地回归、lint和全项目类型检查通过；新增原生子测试先以独立非超级用户LOGIN证明仅ADMIN时CREATE SCHEMA/SET ROLE被拒，再由该LOGIN执行两份原草案，检查安装后归属/临时权限关闭，并继续原ACL/行锁/CAS/失败围栏测试。只复用既有PG16临时服务，无新workflow/权限；本地没有专用CI数据库，原生测试明确skip。是否真实通过只按新源码准确CI记录，不能沿用fa2c97e的超级用户安装结果。本轮生产配置/数据库/AWS读取写入均0，未应用草案或启动承载。

### 原件与恢复点

私有目录：`E:/NodejsProject/TechlongSoftware/.local-secrets/d2-4-install-readonly-20261113-a/`，ACL仅用户、SYSTEM及Administrators，Git已忽略；内容只有固定配方及去敏权限/目录元数据，没有配置正文、连接串、密码或业务快照。读取配方一次性标记已保存，不能重跑；不把剩余预算用于重新连接或补读。

- `aws.result.json` raw SHA256：`096d626fe0a9a70695679d15c5f25eef6b6aaed0d0f75433c5433d7d8a2b4fe6`。
- `combined.result.json` raw SHA256：`1d799101f54650d1c2386973493183b016907dcd5afd5657bc25ee7fa07b71ad`。
- Neon目录投影SHA256：`346c20991972b9b2ba7805e1f5a748b1605028b17fd3fff97e6039037ea4d679`。它只描述本次目录，不是业务行/历史账本保持或新运行身份已验证的证明。

准备事实五小时上限仍从真实开始计，到2026-11-14T02:10:40.091Z（温尼伯11月13日20:10:40.091 CST）；后续本地检查/文档提交不重计。它不是资源租约、写入授权或自动费用守护。过期时只在确有必要且新范围另允后补读，不重放本次脚本；runtime继续`enabled=false/environments={}`，无新安装/调度或收费环境恢复。

官方依据：[GitHub review history GET](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run)、[environment审批](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)、[OIDC claims及aud/sub](https://docs.github.com/en/actions/reference/security/oidc)。这些支持接口设计，不是已安装/已部署的证明。
