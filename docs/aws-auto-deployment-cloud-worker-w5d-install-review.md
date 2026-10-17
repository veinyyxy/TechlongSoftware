# W5d：集中安装范围与只读盘点

2026-10-17。W5c 的统一云执行根保持不动，本次准备**安装材料**，没有安装或运行部署。下文及 design-review SHA 不是可执行批准清单：单次安装器、准确不可变 reusable workflow commit 和执行前 fresh prestate/action SHA 仍需绑定。不会要求用户批准一份尚不能安全执行的清单。

## 实际盘点结果

Source STS 身份核验通过；28次 SDK 只读确认：GitHub OIDC provider 已有；专属 worker role、boundary、journal、回执桶、两个新 Secret 均 ABSENT_AT_CHECK。现有 CFN/task role、两份关联策略的 ID/版本/原文与 W5c capsule 完全相同。OIDC role 引用扫描完整，原发布身份不改动。

准确 W4c 栈 `aa962890-c9e4-11f1-988b-06ffcd51c63d` 已 DELETE_COMPLETE，七个资源的 CFN 状态也均为 DELETE_COMPLETE；父 Cell 仍 CREATE_COMPLETE。按旧栈名的 namespace 查询返回 ValidationError，盘点脚本保守保留 UNKNOWN，没有据此断言所有 ECS/ALB namespace 空，也没有声称父 Cell/数据库已停费。真正部署仍需 W5c 全部 fresh 前置核验。

GitHub 是 public 仓库，ID `1323312747` / owner ID `14145707`，main 当前未保护、environment=0。实际 OIDC 已启用 immutable subject，前缀为 `repo:veinyyxy@14145707/TechlongSoftware@1323312747`，不能使用旧的仅名字 subject。候选不修改 repository OIDC subject，避免影响已有身份；信任同时限定这两个 ID、main、准确 environment 和 SHA-pinned reusable workflow。AWS 当前官方列出的 GitHub 条件键含 ref/environment/job_workflow_ref，实际 STS 正向兼容仍需后续批准后的身份验收，不能把策略语法验证当 token 交换成功。[AWS 条件键](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)、[GitHub subject 格式](https://docs.github.com/en/actions/reference/security/oidc)。

Neon PG18.6：installer 为原 `neondb_owner`/OID 16392，候选角色/schema 不存在，public schema 对 PUBLIC 只有 USAGE，数据库及所有非系统 schema 均无 PUBLIC CREATE；无业务表/列/序列的 PUBLIC grant，十个非系统 definer 均没有 PUBLIC EXECUTE。十张所需表的 owner 均 16392，现有触发器/旧权限/RLS 不改。首次只读 catalog 因 `char` 与 PostgreSQL 内部 `"char"` 类型不同失败；修正后只读成功，旧失败原件及中间版本保留。没有读取业务行、函数私密源码或执行任何业务函数。

## 一次集中安装的具体目标

| 部分 | 新增/设置 | 明确不做 |
| --- | --- | --- |
| AWS foundation | 五资源栈：一个 action-cap boundary、一个带精确 inline policy 的 worker role、一个永久 DDB 表、一个私有版本桶及桶策略 | 不创建 ECS/ALB/RDS/租户 Cell，不修改旧 IAM |
| Neon | `techlong_cloud_worker_v5` 专属角色/schema、四静态函数及执行权 | 不给基础表权限，不改旧 ACL/RLS/业务数据 |
| 凭据 | 两个准确新 Secret、各自资源策略和单个预定版本 | 不上传 owner DSN、旧整包 Stripe 材料，不轮换旧 Secret |
| GitHub | `techlong-sandbox-deploy` environment、owner 审批、仅 main 部署；准确 caller + SHA-pinned reusable workflow | 本轮不创建 environment/workflow，不修改其他仓或全局 OIDC |

Foundation 栈名 `techlong-sandbox-cloud-worker-foundation-v5`。新 role `TechlongSandboxGitHubDeploymentWorkerRole`；boundary `TechlongSandboxGitHubDeploymentWorkerBoundaryV5`。先保持 OIDC deny-all，最终核验后才允许受控 workflow。DDB 为 W5a 固定 `techlong-sandbox-deployment-worker-journal-v1`，pk/sk、PAY_PER_REQUEST、禁 TTL、删除保护、Retain。桶为 `techlong-sandbox-cloud-worker-evidence-402010193138`，全 BlockPublicAccess、BucketOwnerEnforced、Versioning、AES256，条件写且不自动删旧版本。

角色有效权限由**精确 inline policy**与**仅 action/region 上限的 boundary**共同约束；boundary 本身不是第二份资源级隔离，不单独授予权限。运行角色不获 IAM 安装、Secret 写入、DDB update/delete、CFN Update/Delete/Change Set Execute、Lambda invoke 或数据库连接 IAM 权限；只 PassRole 给既有准确 CFN role。CFN CreateStack/依赖 TagResource 限准确租户栈名、区域、固定标签及资源类型。IAM 无法限制“全生命周期只调用一次”，也不能逐字段证明任意 CFN 模板等于批准模板；次数/完整模板/时窗仍由受审根和 journal 检查，凭据被攻破的能力边界比正常代码路径宽。

部分 AWS metadata API 只能按区域 `Resource:*`，S3 HeadBucket 所需 ListBucket 也意味着 IAM 可列举这个专属桶；代码没有枚举入口不等于角色绝无列举能力。Lambda GetFunctionConfiguration 可能在内存经过环境信息；仍沿用 W5b 净化，不保存原响应。DDB PutItem 本身可以替换旧 item；IAM 不保证 ConditionExpression 必须存在，永久槽的 create-only 语义依赖可信代码的条件写，不能声称凭据泄漏后仍不可改。管理员可变更桶/角色/策略，版本化也不等于 WORM。

## 新 Secret 的额外隔离是必要项

现有 task execution role 的 identity policy 和 boundary 都允许 `techlong/sandbox/*`。如果直接在新路径写入可用凭据，会产生不必要的旧角色读取能力。候选因此要求顺序：**创建不带值的 Secret → 附加并核验专属资源策略 → 才写入准确版本值**。不通过修改旧 role 解决。

资源策略显式拒绝除新 worker role 与可信 Source IAM User 外的 GetSecretValue；新 Secret 的管理写只允许 Source。Source 是受信任的安装/应急主体，不代表本轮已授权读取新 Secret。AWS-managed 默认 Secrets Manager key，不新增 KMS key/授权。Secret 资源策略拒绝旧 ECS role，不妨碍 ECS 读取原 runtime Secret。[官方资源策略说明](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_resource-policies.html)。

官方 API 对 AWS-managed key 不要求另授 customer-key Decrypt；但本账号旧 F3b3 曾因显式拒绝规则阻断 KMS。这里没有做新身份的真实 Secret 读取证明，若安装后的实际路径被拒，只停止核验，不自动添加 KMS 权限或修改 Key policy。[GetSecretValue 权限](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html)。

数据库版本固定 `ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e`，控制版本固定 `2854e7b6-6c3c-41be-a5d8-b87dd9d98810`，均为公开标识、不是凭据。密码只在批准后的安装进程内存生成；两个 Secret 的随机 ARN 后缀、role/table/function ID 要等真实安装后只读绑定，不能填假值激活。复制控制材料仍需明确私密读取批准，本次只引用既有指纹。

GitHub reviewer 拟使用 owner `veinyyxy`，允许自己审批自己发起的 run，禁管理员绕过；这是单人的明确人工批准，不是双人复核。不擅自加必须 PR 的 main 规则，以保持此前两个 main 直接提交的约定；未保护 main、owner 可改源码/环境的风险明确保留。caller 入口仍是 W5c 固定路径，reusable workflow 的具体 commit 绑定后才可形成 live trust。没有将任何含 `id-token:write` 的部署 workflow 推到 `.github/workflows`。

## 验证、费用和剩余绑定

六项新增测试核对 immutable trust、五资源/locked trust、两版本窄读、旧宽权限的显式隔离、只读 catalog 和异常 prestate 拒绝。AWS Access Analyzer 对身份策略和 trust-shape 无 ERROR，Secrets Manager ValidateResourcePolicy=true，CloudFormation ValidateTemplate 接受五资源、提示 CAPABILITY_NAMED_IAM。`s3:if-none-match` 的 **StringEquals 字面值 `*`** 引发一个通用 wildcard WARNING，这是刻意的 header 值检查；不能改 Like `*` 将其变成“任意值”。trust 有 audience 类型 SUGGESTION，实际 aud 仍须后续 STS 验证。首次使用不支持的 Secrets Manager Access Analyzer resource-type 参数产生验证错误，保留记录后改用专属只读 API，不伪称首轮全部成功。

按 AWS 官方示例单价，两个 Secret 的存放基线约 **0.80 USD/月**，另有按量 API、DDB 与 S3 存储/请求/版本费用；这是新增组件的估算，不包括已有 Cell/ALB/Aurora/公网 IP/ECR/GitHub 费用，不计优惠，不是 50 USD 总额保证。[Secrets Manager 定价](https://aws.amazon.com/secrets-manager/pricing/)。本次不增加常驻计算，但安装部分失败也可能留下收费基础资源、可用 LOGIN 或权限；没有自动 down、补齐、撤销、清理、复位或重试。

实际元数据、候选材料摘要、准确 CI 及原件位置见 [W5d 准备记录](../ops/aws-sandbox/reviews/cloud-worker-w5d.prepared.json)。本次 design-review 明确标记 NOT_EXECUTABLE；它不授权任何写入。**下一步只把本清单封装到一次性安装入口，绑定准确源/动作、fresh 状态和审批时限，再集中请求一次安装确认**；安装后首次真实云部署仍需准确新 held job 的独立 fresh Review/批准。没有重放旧任务、部署新 Cell 或迁移整个平台。
