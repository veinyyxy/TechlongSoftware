# D2-2至D2-4：版本发布闭环、运行接线与安装草案

状态：D2-4编码已结项，运行接线默认关闭。`schema.draft.sql`与`grants.draft.sql`已在另批的一次性安装中提交并独立核验，见[完成回执](../../docs/aws-instance-release-schema-install-completed-20261113.json)，不得重放；文件名/原注释为追溯保留，不代表仍待应用。三窄LOGIN/Secret/IAM尚未安装，当前仅[离线准备材料](../../docs/aws-instance-release-identity-installation.md)。本目录SQL不在自动迁移目录中，不被启动脚本或发布工作流执行。

D2-4已新增默认关闭的runtime配置、真实元数据/凭据适配及验收子进程；完整范围见[单审批工作流说明](../../docs/aws-instance-release-workflow.md)。工作流不执行本目录SQL草案；新增CI仅在全新临时PostgreSQL16中验证，不安装到现有控制库。本地137项相关回归通过，原生PG结果以准确CI为准。

- `schema.draft.sql`：独立 `deployment_release` schema、三表、专用 NOLOGIN owner 与九个窄函数；D2-3增加只读决定/终止结果登记，扩展核验与完成结果。
- `grants.draft.sql`：三个 NOLOGIN 操作角色，仅授予准确函数；无登录、密码、Secret、IAM、表DML或运行角色的owner成员关系。安装者临时owner SET处理见下段。
- `login-roles.draft.sql`：三个新LOGIN/对应操作组成员的未应用事务片段，无密码正文；未来另批后由调用方BEGIN、参数绑定三个事务内设置、执行一次及COMMIT，不是独立安装器。
- `control-secrets.draft.template.json` / `identities.draft.template.json`：仅安装材料，分别管理三个Secret及三个角色/三个托管策略；策略同时作为身份授权和boundary，不复制另一套inline权限。真实Secret ARN/VersionId与资源allowlist必须另行绑定，不自动部署或启用。
- `identity-installation.prepared.json`：固定文件指纹、对象数/顺序和真实缺项；`executionAuthorized=false`，不是实际安装批准SHA。
- [`repository.ts`](../../lib/deployments/releases/repository.ts)：注入SQL连接，参数化调用；不加载生产连接信息，不自动重试。
- [`adapters.ts`](../../lib/deployments/releases/adapters.ts)：注入既有CFN/S3客户端；不是执行器，不创建默认客户端，不读取凭据。
- D2-5已有ECR路线：[production.ts](../../lib/deployments/releases/production.ts)接原构建候选/registry回读，[catalog.ts](../../lib/deployments/releases/catalog.ts)为另审管理员提供不可变版本INSERT；[原ZIP文件读取](build-artifact.ts)不下载/加载凭据/调用Docker。本轮不启用同job晋升，完整边界见[说明](../../docs/aws-instance-release-production.md)，不为运行角色补表DML或改已安装SQL。

## 数据和权限边界

`releases`保存已核验的不可变版本资料及撤销状态；`instance_state`保存已登记实例绑定、当前核验版本、revision和活跃请求；`requests`保存准确计划原文及SHA、run/attempt、领取token、操作意图/ACK和独立核验引用。首版component只有tenant_api；instance_id是控制面全局ID，不支持同实例其他component。

版本目录和实例绑定必须由未来另审的管理员导入：不能给普通执行者自行把任意镜像标为已核验的能力。目录原文和绑定的修改只限安装/管理身份；未来每次有效绑定变化须同步递增revision。没有访问或修改旧deployment_jobs、旧plan_only、fence或业务表。

| 角色 | 允许函数 | 不允许 |
| --- | --- | --- |
| planner | read_context/read_request、prepare_request | 领取、云操作记账、写核验、完成 |
| executor | 读取、claim_request、record_operation、complete_request | 目录/实例自注册、准备计划、写核验 |
| verifier | 读取、record_inspection | 领取、记云操作、完成或改当前版本 |

九个函数均由专用owner拥有，固定search_path=pg_catalog，表名全限定，撤销PUBLIC执行，没有动态SQL。planner另可record_decision登记非可执行结果，executor另可stop_request登记拒绝/未决，不授予自行写验收证明的能力。运行角色不是客户行级隔离：它们是同环境受信操作身份，具有该环境release元数据读取范围。未来实际登录身份/Secret映射必须保持三类职责分开，不能把owner或三种角色合并给日常执行者。SQL本身不证明GitHub人工批准，也不代替应用授权/准确实例校验。

安装必须使用经另审的真实登录身份（SESSION_USER），具CREATEROLE及数据库CREATE；不是由运行角色调用草案。两事务都显式授予该安装者对新owner的SET、禁止INHERIT，在owner身份下建对象/授予原窄ACL，最后SET LOCAL ROLE NONE并关闭该安装者的owner SET，整个顺序随事务提交或回滚。不改变全局createrole_self_grant；创建者原有ADMIN管理能力保留，不把ADMIN误称为SET/继承权。运行三角色始终不是owner成员，日常工作流仍不持有安装者凭据。隔离PG16回归现使用独立非超级用户LOGIN、CREATEROLE及数据库CREATE实际执行两份草案，先证明无SET时CREATE SCHEMA/SET ROLE被拒，再验证安装后归属、SET/INHERIT关闭及原ACL；结果以准确新CI为准，不用旧超级用户CI替代Neon实装证明。

## 操作顺序

1. `prepare_request`核对计划原文SHA、已登记目录/绑定、源版本/revision及原截止，登记AWAITING_APPROVAL；相同ID只允许相同原文，等待批准时不占执行锁。
2. `claim_request`在数据库事务内锁定实例、再锁请求，核对原revision/版本、目录未撤销、run/attempt和原期限；同实例最多一个活跃请求。没有定时抢占、lease过期复位或后台worker。
3. 每个create/execute操作先持久化一次INTENT，才由后续D2-3调用适配器；ACK须匹配原动作SHA。UNKNOWN保留实例占用并标记RECONCILIATION_REQUIRED，不能再领取或执行。INTENT/ACK也保存在只读请求结果中，不能只根据CLAIMED状态判断尚未提交。
4. verifier用独立身份写入准确请求/计划/run/attempt/栈/目标digest/配置及固定版本证据。只有受信验收器能断言真实技术结果；一个result=SUCCEEDED字段或S3上传成功本身不是验收证明。
5. executor只能消费已存验收记录，原子CAS源版本、revision和requestId；成功才切换当前版本、revision+1并释放占用。执行ACK不代表发布成功，过了写入截止也不阻止已执行结果的只读核验/最终结案。

D2-3中，已独立证明的受管回滚保留旧版本，revision+1以废止旧批准/快照并释放占用；验收失败保留旧版本和占用，不自动回退。NO_CHANGE另存不可执行decision（plan=null），不推进版本/revision、不调用CFN。未知调用、持久化响应丢失、证据失败或读取预算耗尽均不重发；返回RECONCILIATION_REQUIRED不代表已强行覆写数据库状态，可能仍存INTENT/VERIFYING或实际已SUCCEEDED，须准确回读。

SQL函数明确拒绝返回`ReleaseRequestRejected`；响应丢失等其他写错误返回`ReleasePersistenceUnknown`，不重发SQL或云操作。不明回写即便实际上已提交，也只能先独立回读；不能以错误重置实例或重跑更新。失败分类、对账和编排留在D2-3，不在本阶段另建恢复工具。

CFN适配只发准确UPDATE/UsePreviousTemplate与ImageUri参数更新，其余参数沿用；Create、Describe与Execute是分开的调用，不自行串联。审查只允许TaskDefinition Modify/Replacement=True及Service Modify/Replacement=False；不要求DescribeChangeSet中不存在的RoleARN。Execute明确DisableRollback=false，保留正常CFN回滚。写客户端必须maxAttempts=1；任何写ACK不明都不自动重发。D2-3的update.ts在持久意图后串联并有界轮询，核对真实CS参数、Original候选模板、执行前源角色/参数/物理绑定/更新时间；参数或模板越界拒绝，读取失败保留未决，不假造拒绝。**这些端口不是审批边界**，当前没有生产调用入口。

证据适配复用未来配置的既有私有versioned桶/owner/前缀，以If-None-Match=*条件写，要求真实VersionId；GET固定版本、限制1MB并核对SHA。只序列化固定技术字段，额外对象不进入证据。没有新桶、IAM或GitHub artifact框架。

## D2-3运行接口及事实边界

`prepareInstanceRelease`包装原纯计划器，登记计划或只读决定。`executeInstanceRelease`只接受数据库已登记且SHA匹配的待审计划；批准后的调用必须由未来受保护job发起，提供run/attempt、不可重用token、原写截止及读取次数/时间预算。再次调用已开始的请求只返回原状态/未决，不恢复或重放。

`inspectInstanceRelease`是单独可组合的入口，使用verifier窄仓库和独立reader重读，不接收执行器的事实缓存或成功布尔值。检查真实栈/CS关联、CFN所属Service/TaskDefinition、主部署/任务数、运行平台digest（不混同OCI索引digest）、保留资源、路由目标健康及既有/health和/ready的TLS/状态；缺少有权访问的技术检查时判失败，不读取HMAC凑探针。先条件写证据并固定版本回读，再登记验收，最后executor消费已存证明CAS完成。

`releaseRuntimeDigests`定义绑定摘要算法：Original模板canonical SHA；另对非镜像参数、栈角色/标签、保留资源物理ID、稳定服务/任务配置及Cell/platform/DNS/Secret等关联绑定计算配置SHA。只排除API容器image和任务revision/注册时间等运行字段；环境正文仅参与内存摘要，不进入输出或证据。新目录导入必须按此算法从真实状态建立绑定，不能把历史任意SHA当作新算法事实。

`ReleaseRuntimeReader`必须从真实白名单来源取得完整单页资源/任务/Change Set及关联元数据，不能用用户输入、手工布尔值或缓存替代。D2-3交付时只有端口；D2-4现已实现采样与独立进程接线、真实子进程凭据清除测试，但配置关闭，未用真实身份/资源运行，不能宣称已证明生产隔离。CFN/ECS/S3 SDK内存编解码与合成流程是离线证据，实际身份安装/读取和D2-6验收另审。

常规[`instance-release-checks.yml`](../../.github/workflows/instance-release-checks.yml)只运行无AWS身份的回归/lint/类型检查，无environment、id-token、Secrets或部署调度，不是D2-4发布工作流。没有新增自动对账/恢复守护进程；未决只提供持久查询供后续准确审查。

## 后继身份安装前仍须单独完成

- D2-4无AWS CI已增加隔离原生PG16草案/两连接锁/角色ACL/CAS测试，结果以准确run为准；本地未提供CI专用URL时skip。即使CI成功，也不证明目标Neon安装者权限、LOGIN成员或生产布局已验证。
- schema/grants已安装并独立核验，不重放；后继按新批准核对三个LOGIN名、旧保护布局、PUBLIC固有权限和installer能力，冲突应停止而非覆盖。
- 新LOGIN片段及两份身份模板尚未应用；必须取得准确CI中的真实LOGIN认证证据及缺失资源/Secret版本绑定。实际LOGIN、Secret/IAM安装与业务目录导入都需准确范围另审，不自动补齐/清理。
- D2-3离线闭环及D2-4默认关闭的采样/进程/单审批工作流已编码；后继只准备真实一次性安装清单，D2-6才做受审实际技术验收。当前不改旧部署工作流，也不恢复收费环境。

依据：[PG SECURITY DEFINER与search_path](https://www.postgresql.org/docs/16/sql-createfunction.html)、[PG行锁](https://www.postgresql.org/docs/16/explicit-locking.html)、[PG原生SHA256](https://www.postgresql.org/docs/16/functions-binarystring.html)、[CFN DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)、[CFN ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)、[S3条件PUT](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)。这些是接口依据，不是线上成功证据。
