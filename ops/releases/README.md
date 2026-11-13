# D2-2：版本发布状态与安装草案

状态：`DRAFT_NOT_APPLIED`。本目录不在自动迁移目录中，不被启动脚本或工作流调用。没有执行安装、目录导入或云操作。

- `schema.draft.sql`：独立 `deployment_release` schema、三表、专用 NOLOGIN owner 与七个窄函数。
- `grants.draft.sql`：三个 NOLOGIN 操作角色，仅授予准确函数；无登录、密码、Secret、IAM、表DML或角色成员关系。
- [`repository.ts`](../../lib/deployments/releases/repository.ts)：注入SQL连接，参数化调用；不加载生产连接信息，不自动重试。
- [`adapters.ts`](../../lib/deployments/releases/adapters.ts)：注入既有CFN/S3客户端；不是执行器，不创建默认客户端，不读取凭据。

## 数据和权限边界

`releases`保存已核验的不可变版本资料及撤销状态；`instance_state`保存已登记实例绑定、当前核验版本、revision和活跃请求；`requests`保存准确计划原文及SHA、run/attempt、领取token、操作意图/ACK和独立核验引用。首版component只有tenant_api；instance_id是控制面全局ID，不支持同实例其他component。

版本目录和实例绑定必须由未来另审的管理员导入：不能给普通执行者自行把任意镜像标为已核验的能力。目录原文和绑定的修改只限安装/管理身份；未来每次有效绑定变化须同步递增revision。没有访问或修改旧deployment_jobs、旧plan_only、fence或业务表。

| 角色 | 允许函数 | 不允许 |
| --- | --- | --- |
| planner | read_context/read_request、prepare_request | 领取、云操作记账、写核验、完成 |
| executor | 读取、claim_request、record_operation、complete_request | 目录/实例自注册、准备计划、写核验 |
| verifier | 读取、record_inspection | 领取、记云操作、完成或改当前版本 |

七个函数均由专用owner拥有，固定search_path=pg_catalog，表名全限定，撤销PUBLIC执行，没有动态SQL。运行角色不是客户行级隔离：它们是同环境受信操作身份，具有该环境release元数据读取范围。未来实际登录身份/Secret映射必须保持三类职责分开，不能把owner或三种角色合并给日常执行者。SQL本身不证明GitHub人工批准，也不代替应用授权/准确实例校验。

## 操作顺序

1. `prepare_request`核对计划原文SHA、已登记目录/绑定、源版本/revision及原截止，登记AWAITING_APPROVAL；相同ID只允许相同原文，等待批准时不占执行锁。
2. `claim_request`在数据库事务内锁定实例、再锁请求，核对原revision/版本、目录未撤销、run/attempt和原期限；同实例最多一个活跃请求。没有定时抢占、lease过期复位或后台worker。
3. 每个create/execute操作先持久化一次INTENT，才由后续D2-3调用适配器；ACK须匹配原动作SHA。UNKNOWN保留实例占用并标记RECONCILIATION_REQUIRED，不能再领取或执行。INTENT/ACK也保存在只读请求结果中，不能只根据CLAIMED状态判断尚未提交。
4. verifier用独立身份写入准确请求/计划/run/attempt/栈/目标digest/配置及固定版本证据。只有受信验收器能断言真实技术结果；一个result=SUCCEEDED字段或S3上传成功本身不是验收证明。
5. executor只能消费已存验收记录，原子CAS源版本、revision和requestId；成功才切换当前版本、revision+1并释放占用。执行ACK不代表发布成功，过了写入截止也不阻止已执行结果的只读核验/最终结案。

SQL函数明确拒绝返回`ReleaseRequestRejected`；响应丢失等其他写错误返回`ReleasePersistenceUnknown`，不重发SQL或云操作。不明回写即便实际上已提交，也只能先独立回读；不能以错误重置实例或重跑更新。失败分类、对账和编排留在D2-3，不在本阶段另建恢复工具。

CFN适配只发准确UPDATE/UsePreviousTemplate与ImageUri参数更新，其余参数沿用；Create、Describe与Execute是分开的调用，没有自动轮询/执行。审查只允许TaskDefinition Modify/Replacement=True及Service Modify/Replacement=False；不要求DescribeChangeSet中不存在的RoleARN。Execute明确DisableRollback=false，保留正常CFN回滚。写客户端必须maxAttempts=1；任何写ACK不明都不自动重发。**这些端口不是审批边界**：D2-3还必须绑定持久意图、实时栈角色/模板/配置和期限后才能使用，当前没有生产调用入口。

证据适配复用未来配置的既有私有versioned桶/owner/前缀，以If-None-Match=*条件写，要求真实VersionId；GET固定版本、限制1MB并核对SHA。只序列化固定技术字段，额外对象不进入证据。没有新桶、IAM或GitHub artifact框架。

## 安装前仍须单独完成

- 在隔离原生PostgreSQL测试库执行草案，核对语法、两连接真实行锁与提交可见性、角色/SET ROLE/函数ACL正反用例。本轮只有序列化内存合同模型及静态SQL检查，**没有证明原生PG锁/权限已生效**。
- 结合真实控制库检查schema/角色名冲突、旧保护布局和installer权限；草案故意不使用IF NOT EXISTS/CREATE OR REPLACE，冲突应停止而非覆盖。
- 明确安装者可创建并SET ROLE到专用owner；schema和grants分别事务安装，后者失败时前者仍是无运行授权的闭锁结构，不自动补齐/清理。实际安装/业务目录导入/LOGIN、Secret及IAM都需准确范围另审。
- D2-3再实现失败/NO_CHANGE分类、实时预检、真实独立技术核验和持续对账；D2-4再接单一GitHub人工门禁。当前不改旧工作流，也不恢复收费环境。

依据：[PG SECURITY DEFINER与search_path](https://www.postgresql.org/docs/16/sql-createfunction.html)、[PG行锁](https://www.postgresql.org/docs/16/explicit-locking.html)、[PG原生SHA256](https://www.postgresql.org/docs/16/functions-binarystring.html)、[CFN DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)、[CFN ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)、[S3条件PUT](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)。这些是接口依据，不是线上成功证据。
