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

官方依据：[GitHub review history GET](https://docs.github.com/en/rest/actions/workflow-runs#get-the-review-history-for-a-workflow-run)、[environment审批](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)、[OIDC claims及aud/sub](https://docs.github.com/en/actions/reference/security/oidc)。这些支持接口设计，不是已安装/已部署的证明。
