# 前端承载与GitHub门禁：实际安装待审范围

2026-10-28，America/Winnipeg。**尚未批准、未执行。** 本清单仅准备先安装独立前端承载和人工发布门禁，不是客户端发布或后端恢复审批。[机器执行范围](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.bootstrap-execution.json)的准确SHA须由用户另行确认；本文件不授予权限。

## 为什么收缩这一批次

新一轮已批准只读核对发现：原租户栈UUID `2b604c90-d303-11f1-9e27-0eac036e5781` 已DELETE_COMPLETE，ECS INACTIVE/任务0，health和ready在18:54均404。根事件显示16:08:39.496开始删除，16:16:37.415完成；“User Initiated”不能证明具体用户或自动化身份。本轮没有执行删除，也没有读CloudTrail或数据库推导原因。

因此**不再对已删除UUID安排UpdateStack/CORS更新**，不重放a00任务、原批准或已消费槽，也不为此新开固定任务代码分支。先把可独立准备的前端承载和门禁安装好，后继HMAC、发布及新的后端验收窗口仍另审；不能拿14:41健康记录或原16:06意图继续操作。

本轮准备使用GitHub GET9、Source STS1、AWS元数据16（含一次ValidateTemplate）、无身份GET2；配置/云写、私密值、DB连接、网页JS、续租及dispatch均0。六资源模板已被AWS ValidateTemplate接受并报告CAPABILITY_NAMED_IAM；这不是权限模拟、Change Set或实际创建成功证明。新role/policy和stack尚不存在，OAC候选名称无冲突；桶HEAD404不保证名称全球可用。准确客户端源码602e543及CI40789471388仍匹配，sandbox environment返回404（未设置或不可见）。

## 这次允许申请的写入

必须按以下顺序执行，任何前置不满足都停止，不自动修改方案：

1. **先设置保护环境，两次GitHub写入上限**：在veinyyxy/speedfeast创建 `techlong-sandbox-buyer-deploy`，required reviewer仅用户veinyyxy（14145707），can_admins_bypass=false、prevent_self_review=false；随后仅添加master分支规则。必须用独立GET证明reviewer及唯一master规则正确，才可创建AWS角色。prevent_self_review=false是为了允许用户本人审批自己手动发起的run，不允许agent代批任何run。
2. **最多一次直接CreateStack**：Source必须是账号402010193138的IAM用户techlong-sandbox-dev，region固定ca-central-1；准确新栈 `techlong-sandbox-buyer-web-v1`，使用已验证模板原字节的LF规范内容，CAPABILITY_NAMED_IAM，DisableRollback=true。请求体已保存并绑定SHA，不设置CloudFormation service RoleARN，不借机切换Manager/Provisioner或增补Source权限。
3. **声明资源仅6项**：独立私有/版本化S3桶 `techlong-sandbox-buyer-web-402010193138-ca-central-1-v1`、OAC、CloudFront分布、仅该分布可读的桶策略、`TechlongSandboxBuyerWebPublishBoundary`、`TechlongSandboxBuyerWebPublisherRole`。后两项是新IAM权限；同一窄managed policy同时授予角色权限并作为其boundary。只允许新桶List/Get/Put/AbortMultipartUpload及准确新分布Create/GetInvalidation，不授予对象删除、Secret、IAM、ECS、CFN或数据库权限。AbortMultipartUpload可终止未完成分片，不是删除已提交对象。
4. **等待和独立核验**：在本轮执行范围内只读观察CloudFormation至成功/失败/时限，最多60次状态轮询、间隔30秒；与所有前后核验合计不超过90次AWS元数据及2次STS。核对新UUID、原模板/参数、六个物理资源、请求token、标签、桶私有/加密/版本化、准确CF/OAC/桶策略、role trust/identity policy/boundary与GitHub门禁；不以CREATE_COMPLETE单独替代内容核验。所有完整结果留本地非秘密审计材料，不改写输入或原记录。

GitHub只读总上限12次；GitHub配置写入总上限2次；直接CloudFormation写入仅CreateStack1次。六项是模板声明资源数，**不是底层AWS写API次数上限**：CloudFormation会进行托管创建/附加策略/设置boundary/标记等操作。没有创建/执行Change Set、更新其他栈、删除、额外上传模板、调用Lambda或创建付费Cell。

## 明确不在本次批准内

- 不设置任何GitHub变量或Secret，不读取HMAC/AWS Secret值、PEM或.env，不获取私密控制包，不生成或传输新密码。
- 不dispatch客户端或后端工作流，不批准GitHub environment运行，不上传客户端产物或对象，不创建cache invalidation，不进行浏览器或商户登录，不执行网页JS或下单/支付。
- 不更新已删除租户栈，不改CORS/镜像、DNS、数据库、业务任务或TTL，不恢复后端，不改旧production环境、旧publisher及其policy/OIDC provider，不复位任何旧记录或槽。
- 角色是持久窄发布角色，**不是临时Grant**；安装后不自动撤权。IAM最大会话配置为3600秒，未来已实现的workflow请求900秒；本次不进行AssumeRole探针，不证明新role已可实际发布。
- 此阶段CloudFront后是空桶，出现403/404不代表已发布应用；独立安装核验通过也不等于客户端或整套产品验收通过。

## 时序、失败与费用风险

- 准备事实起点为18:54:17.108，五小时准备到期为**10月28日23:54:17.108**；本次最晚启动为**23:14:17.108**，保留40分钟完整操作/核验余量。逾期不写、不重放，不靠延长旧工作负载意图继续；只有收到准确新SHA确认才开始。此批前端安装不创建新的后端验收租约。
- 开始前用实际写入凭据核对身份、repo管理权限、准确head/CI、目标空缺、原OIDC及未使用审计标记。GitHub连接元数据曾显示admin，不证明未来实际写入凭据一定具有同样权限。任何漂移、已有同名对象或权限不足都停止，不自动接管、覆盖、补权限或改名。
- GitHub PUT不是跨服务CAS；先读404不能完全消除并发覆盖风险。两次配置写入、AWS资源创建和独立核验非原子，失败可能留下部分GitHub规则、新IAM权限或计费资源。CloudFormation会异步创建资源；DisableRollback=true表示失败不自动清掉已建资源，不能因此认为没有资源或没有费用。
- Provider写入报错或结果不明时不自动重试，不重跑脚本、不自动补齐、回滚、撤权或清理；只做本次允许的独立只读记录后停止。会先保留一次尝试的本地审计标记，不能删除/复位它来绕过未知结果。凭据自动刷新可能失败；实际创建完成而核验失败时也可能遗留资源/权限。
- CloudFront传播可能超过观察时限；达到时限只记录当前状态，不宣告创建失败或自动重复。平台/存储状态和IAM权限有传播延迟、并发竞态；内容匹配不是跨服务强CAS保证。
- 这六项会持续存在，S3及其版本使用Retain且没有自动过期删除，CloudFront默认HTTPS域名公开。空桶也不能保证绝对零费用；后续流量、对象版本、请求和GitHub用量可能收费，恶意流量可突破模型。原[费用模型](aws-buyer-web-sandbox-plan.md)约0.99 USD/月只对应示例小流量，不是报价或上限；50 USD/月仍是整套预算目标，不是硬停费。本轮没核对共享Cell/平台/数据库全部账单，旧租户栈删除不证明整体费用归零。

执行沿用现有GitHub REST/AWS CLI和已封存输入，不新增云运行器或调度平台。审批后也必须先通过上述前置再写；本次准备阶段未做任何配置/云写入。后续HMAC与真实发布、后端重新验收及清理均须各自准确范围批准。
