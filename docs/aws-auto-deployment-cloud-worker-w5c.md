# W5c：统一云端单次执行根（候选，尚未安装）

2026-10-17。主线仍是先完成自动 AWS 部署，再整套系统迁 AWS；不发布 Sites，不扩 F3c9。50 USD/月是目标，不是硬停费保证。本轮只编码、无生产凭据的 CI 验证及文档；未访问真实 AWS/Neon、未读取原私密包/Secret 值、未安装权限或部署资源。

## 已接通的同一条代码路径

`ops/cloud-worker/run-worker-v5.mjs` 提供 CheckCandidate / Review / RunOnce / Inspect。`cloud-application-v5.mjs` 是具体组合器：显式短期云身份 → 固定数据库 Secret → 窄 RPC → V5 SDK provider / DynamoDB journal / S3 回执 / 最小控制材料。不是另一套 mock-only 部署器；测试替身与真实 SDK/Neon factory 明确分离。实际云运行仍被**未知安装 ID、无部署 workflow、未安装身份与权限**阻断，不能把代码入口存在写成无人值守已上线。

Review 仅准确 held job，核对原管理员/九行快照/最新已到期成功沿革，渲染七资源、实际前置核验后再次读行，保存待审清单，不消费执行槽、不读取控制密钥。数据库连接 Secret 本身每个模式最多读取一次，属于未来安装/运行批准范围，不是“只读”一词自动授权的私密读取。

RunOnce 在打开数据库/读取 Secret 前检查准确批准 SHA、已提交源码与 normalized-LF 闭包、安装绑定、完整计划/模板重建及原时间窗；不重新盖时间戳。随后使用原 held job，顺序消费永久槽：

`run → claim_job → create_workload → private_control_load → atomic_complete`

同任务原地领取、一次 CreateStack、一次最小控制 Secret 读取、最多两次认证 GET、两行原子完成。请求、实际随机租约效果和完成程序各自哈希绑定；随机 lease token 不写公开回执。DynamoDB 以准确 job 为永久键，不能通过换清单、Actions attempt 或重跑进程获得第二次资格。未知/失败只能 Inspect，不回滚、补齐、复位或重试。CloudFormation 自身 OnFailure=ROLLBACK 仍属于现有建栈语义，不等于该 worker 会补偿数据库/journal/Secret。

Inspect 要求另一 Actions run ID，重新核对身份、数据库函数/角色和实际资源，核对 S3 指定版本的历史 provider 与当前健康观察，完整重建成功 receipt、检查旧 ready/九行/历史，再次回读数据库拒绝并发漂移。五槽消费完不代表成功；缺少回执、哈希不符、过期/不健康或状态不明不会补写 succeeded。没有控制 Secret、租户 HTTP 或数据库写。当前严格健康核验需要尚在承载期限内；到期后不能用历史成功冒充当前健康。

W4c 的 :5/aa96 成功是沿革链根。`continueCloudContextV5` 接续含 manifest、receipt、provider 和另一 run 独立 Inspect 的成功链，推导最新准确 Stack UUID/task definition；拒绝重复/篡改链接。无需每次修改源码或重打公开 capsule。链材料应从受控不可变回执位置取回并在新 Review 中绑定；**SHA 只能证明材料一致，不能单独证明提供者观察真实**，仍信任受审执行代码、独立身份核验、存储访问控制及新一次 AWS 前置核验。

## 最小 Neon 权限合同

候选专属 LOGIN 角色及 schema 均为 `techlong_cloud_worker_v5`。四个固定 SECURITY DEFINER 函数：read_state(text)、claim(jsonb)、lease(jsonb)、complete(jsonb)。默认 PUBLIC EXECUTE 撤销，专属角色只有 schema USAGE 与四函数 EXECUTE；不授予基础表/列通用读写、schema CREATE、角色成员或管理权限。不启用或改变现有业务表 RLS，不自动撤销现有 PUBLIC 权限；若当前继承/PUBLIC 权限使隔离不成立，预检失败，须单独审阅处置。

SQL 源模板来自既有同任务编译器，客户端验证模板后只发参数矩阵；服务端为静态 SQL，无 caller SQL / dynamic EXECUTE。函数独立核对准确 deployment/app/workspace/env/原 apply job、原请求、固定 material、工作器/租约/时间关系、只追加本任务 receipt、旧 outputs 不变。保留原完整行 CAS/锁、DB 时钟、Serializable、一次领取及两行原子完成。函数以可信安装者为 owner、固定 search_path=pg_catalog、公共关系名全限定。owner 及四函数 OID、原文、配置、ACL、角色标志/成员、无表/列权限和无其他可执行 definer 都需现场核验并绑定，未知 OID 不填假值。

该凭据的持有人仍能在**准确固定 sandbox 范围**调用这些业务能力；数据库不能自行密码学验证 AWS/TLS 探针真实性。不能把“没有 UPDATE grant”说成“没有写能力”，也不能把参数 SHA 当管理员批准凭证。可信执行根、GitHub environment 审批/源码约束及独立 Inspect 仍必要。函数 owner 被攻破或恶意替换、检查与调用间的竞态并未被跨服务 CAS 消除。

新数据库 Secret 仅含 schema/databaseUrl，要求准确专属用户、绑定 Neon HTTPS endpoint 摘要、verify-full、无附加连接选项。禁止 owner/admin DSN、`.env` 读取/上传、默认凭据链或长期 AWS key。新的最小控制 Secret 仍只含 W5b 七字段，不复制旧整包 Stripe/数据库/密码。

数据库安装 SQL 只是可审核 renderer，没有生产 installer 或自动 CREATE OR REPLACE；本轮没有创建角色、密码、LOGIN、Secret 或授权。语义依据：[PostgreSQL CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)、[GRANT](https://www.postgresql.org/docs/current/sql-grant.html)。

## 回执及源绑定

候选专属桶 `techlong-sandbox-cloud-worker-evidence-402010193138`，固定账户/区域，全四项 PublicAccessBlock、BucketOwnerEnforced、Versioning、SSE-S3 AES256。限定 app/job/manifest/run 前缀，PutObject If-None-Match=*，按准确 VersionId/SHA 读取，无列举/删除/覆盖入口。没有私有 DSN/PEM/JWT/非空 lease token 的审计材料也仍放**私有**桶；业务元数据不默认提交公开 GitHub。

条件写和运行时不授 Delete 并不等于 WORM/管理员不可变；桶管理员、版本删除或策略改动的风险仍存在，安装审查必须包含 bucket policy 条件与权限边界。[S3 条件写官方说明](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)。存储/请求/版本留存会收费，无自动生命周期删除 journal 或旧记录。

`closure-v5.mjs` 真实递归绑定执行入口、所有本地 imports、公开 capsule、SQL 模板、本文和两套依赖锁；CRLF→LF 明示，不更改旧 99 raw pins。候选 CI 无 OIDC、AWS/仓库 Secret。CheckCandidate 完全本地导入，不能隐式调用 Review。live 模式仅接受将来准确 `.github/workflows/cloud-worker-execute.yml@refs/heads/main`；此 workflow **尚未创建/授权**。环境字符串检查不是 AWS trust policy 的替代，后续还须审核 OIDC subject、branch/environment 审批、workflow/commit 约束，不能挪用镜像发布身份。

## 已有验证与尚未完成

本地统一入口八组回归覆盖三模式入口、完整模板重建、错误批准/变更源码/过期/行漂移、五槽顺序、两 GET、同任务原子完成、另一 run Inspect/链延伸、丢 ACK 不重放、S3 条件写及 DSN 约束。网络/provider 端口为明确 fixture，不是实际 AWS/TLS 兼容证据。W5b 已有真实 RSA/mTLS fixture 和 SDK 规则测试继续保留。

云 CI 使用固定 PostgreSQL 18.6 镜像，在创建前证明为空的自有临时数据库和角色安装候选函数，验证真实目录/ACL、表权限拒绝、安全 requester 投影、跨范围/SQL 形状参数拒绝、并发一次胜者、lease READ ONLY、旧历史保护、最后一步失败回滚、完成不可重放；随后只删除本进程准确创建的临时数据库/角色。并非连接生产 Neon。准确 run、测试计数、原件 SHA 和失败修复保留在 [W5c 准备记录](../ops/aws-sandbox/reviews/cloud-worker-w5c.prepared.json)，不把失败首轮改成成功。

## 下一阶段：集中安装审查，不再增加观察器切片

只读盘点新候选名是否已存在、GitHub OIDC/environment 及当前 DB owner/PUBLIC ACL 后，一次生成具体安装计划：

- 一个专属 OIDC worker role 及准确资源策略/boundary（既有 CFN/task 角色原样复用，不授 IAM 安装能力）；
- 一张 W5a 永久 journal 表（禁 TTL、保护删除、无 reset）；
- 一个私有版本化回执桶及限定条件写策略；
- 一个最小 DB 角色/schema/四函数权限（不把管理员 DSN 给 Actions），两个固定新 Secret；
- 一个受保护、手动准确 job 的云 workflow 与安装 ID/版本/OID 绑定。

这些是候选资源，不是已批准创建清单。安装跨 AWS/Neon/GitHub 非原子，可能部分成功并遗留收费 Secret/表/桶或可用权限；密钥/DSN 在运行内存及提供者链路可见，不能保证提供者日志永不记录。永久槽及记录不自动删除/复位，权限可能需人工处置。50 USD/月目标、父 Cell/数据库费用及到期不保证清理的原边界不变。

拿到新的具体范围和 fresh SHA 批准后才安装；再以准确新 held job 形成 fresh 部署 Review、独立确认与首次实际云 Run/Inspect。不会重放 W4c 任务、重设租户密码、创建全局队列、发布 Sites 或提前迁整个平台。本阶段无需你提供密码/验证码或刷新 Source；只读安装盘点需要身份时再提出明确用途。
