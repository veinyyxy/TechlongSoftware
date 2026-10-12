# F3c9a：完整父协议、实际 guarded provision 与 Lambda 自证组合

2026-10-12 Winnipeg。本切片完成 F3c9 的父协议／发布分支，不是 F3c9 整体或自动部署验收。没有安装 IAM、表策略、父登记或 Lambda，也没有创建／删除 Cell。50 USD/月仍是预算目标、不是硬上限。

## 本次完成

- 独立 schema4 full-parent review/record/cold decoder，准确 birth/RESERVED Stack/模板/委托、角色 ID、代码包与 bundle、Lambda Revision、boundary version、表策略 hash/revision 和审批时间全绑定。实际 live metadata 和 RESERVED 品牌是审阅前置；旧 drain-only、marker-only 或 JSON 复制不能扩成 parent scope。
- 新固定 key `cell-birth-v4:parent:cell:cell-sandbox-1`，不改旧登记、失败槽位或历史文件。完整父 scope 包含 provision、drain、TTL authority/child、failed fence/delete；明确不授权 activation、租户运行时、创建/更新 Cell、复位或写重试。
- Source/runtime 两种安装只读 reader：准确 STS/RoleId；原 TableId/key schema/no global replication；表策略；准确 Lambda-only trust；只有一条准确 inline、无附加 managed policy、完整分页；默认 boundary version/document；Function ZIP CodeSha/Revision、固定 handler、Node22/x86、120秒/256MB、无应用 env/layer/VPC。两次完整读取稳定且 ≤30秒。
- strong parent registry 前后两次六 key 事务快照，跨 metadata 再核对所有记录；真实 private brand、当前时间窗口和本地运行身份是 publication 的门禁。
- **实际 SDK guarded provision publisher**，不接受 raw item、activation 或 caller Lambda/role：当前完整 PAID Stack → 原 schema2 合法前驱 → 再读 full parent／exclusions → 同一事务 ConditionCheck 完整 parent JSON、activation/失败/compensation 缺失、absent provision Put。争槽 UUID 每次独立，响应丢失／并发漂移仅 Inspect，不重复写。
- 真实 Lambda handler/root 和依赖完整 ESM ZIP 构建：事件/context 校验先于凭据；只用 Lambda `fromEnv`、不加载本地 profile；运行 bundle 从自己的 `import.meta.url` 文件字节计算 hash，不能用 event/env 声明摘要。复用已锁定 Smithy SigV4 的固定 Lambda configuration GET，不安装新 SDK 或修改 package/lock。

当前 root 只组合 provision 分支：parent 缺失为 `LOCKED_NO_FULL_PARENT`；失败、非 PAID、到期分别阻断。不连接 Neon、不读 Secret、不 Invoke child、不调用 DeleteStack、不 activation。**全清理 root 尚未完成，故不提供 Source registrar，也不安装/登记这个候选包。** 编译 parent record 是数据，不是云写入许可。

## 旧发布路径隔离候选：全表写冻结，而非单 key 拒绝

单 key 的 deny 不能未经验证就当作 mixed batch/transaction 的完整隔离。AWS 文档对 LeadingKeys 指定 ForAllValues，并提醒 deny 型细粒度策略容易写错；本候选不使用 LeadingKeys deny。[AWS 条件策略说明](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/specifying-conditions.html)

候选表 resource policy 对 **所有旧主体** 拒绝原 authority 表的 PutItem/UpdateItem/DeleteItem/BatchWriteItem/PartiQL 写，只例外新协调器 role 和一个明确的短 Source 登记窗口。窗口截止后 Source 也被拒绝数据写；读取、IAM 或表策略管理权限不被这份 data-plane freeze 静默删除。

这是**全表所有 key** 的写入影响，不只 Cell key：旧 Provisioner、Source、旧清理器及未来 tenant authority writer 都会受到影响；旧 Item/Neon 业务原件保留，不删除记录。以后启用 tenant writer 需另批准确角色／key／策略，不能默认放行旧宽写路径。本次只准备候选，未修改现有权限。

短 Source 窗口解决安装次序：表策略安装后核对 metadata，Source 在 fresh 审批窗口内登记完整 parent；runtime 必须等待窗口截止。窗口最多十五分钟，绑定策略 hash 与具体截止时间。**Source 在窗口内技术上仍有原来的宽表写能力**，审批流程只能执行准确 parent 写；这不是列/行过滤或云端限定一次 Put。不能把窗口自动关闭称为 IAM 全面有效权限验收。

表策略 `PutResourcePolicy` 的条件 revision/NO_POLICY 可防止覆盖已观察到的版本，但 API 与 `GetResourcePolicy` 有最终一致性；读到匹配 JSON 不证明所有 data-plane deny 已传播。实际安装前须 fresh 清单，安装后还须受审的实际隔离/allow-path 验收，不以模拟或 metadata 标志替代。[AWS 表策略 API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutResourcePolicy.html)

## 权限候选及运行字节的边界

identity/boundary 候选 5425 字节（canonical UTF-8），只允许准确 Stack ARN、原 CFN role 的 PassRole、准确父/前驱/失败/清理 key 和固定 metadata/log 资源；没有表 UpdateItem/DeleteItem、parent/activation Put、IAM/code/policy 修改或其他 Stack。DDB Put 必须来自 TransactWriteItems；表 freeze 是 deny-only，不给新 role 额外 Allow。

boundary 显式拒绝其他/缺失 `lambda:SourceFunctionArn`，防止只靠 role ARN 例外给同 role 的其他函数放行。这个 key 属于 identity/SCP 条件，**不能放入 resource policy**，且必须是不带 alias/version 的函数 ARN。[AWS SourceFunctionArn](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)

复用原 v3 scheduler 的未限定函数 target，所以本候选使用 `$LATEST`，不伪称不可变发布版本。它以实际 local bundle hash + 当前 API ZIP hash/Revision + RoleId/policy 双读拒绝 stale warm code 或配置漂移；管理员并发修改代码/IAM、策略传播及各服务间竞态仍不是 CAS。成熟后若要改为 published version，必须另改模板和相应证据协议，不篡改已有 v3 模板。[AWS Lambda 版本语义](https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html)

当前权限候选**没有 downstream Secret/Invoke 授权**，handler 也没有完整 failure/TTL 组合，因此它不是可安装的最终 parent 权限清单。若复用已有 TTL child，它的 journal 写也会被本轮 coordinator-only freeze 拦住；必须在最终候选中把受核验的 child role 列为另一例外，并以准确 boundary 限制其只读 authority／写自身 journal、不写 provision/activation，另做实际 allow/deny 验收。不能直接安装本轮 freeze 后假定旧 child 仍可写。下一切片补齐这些能力后重新编译当前未安装候选、重建 bundle、生成 fresh binding；不能用本轮 ZIP/hash 登记完整 parent，再静默升级包。

## 验证与当前 AWS 事实

- 10 项新 + 11 项 F3c8 相邻，**21 项通过**；typecheck、定向 lint 0 warning、两 CLI syntax 通过。并发 loser 可在双快照间检测到 winner 提交而拒绝；已修正测试期待，不放宽生产漂移检测。初次测试 readonly 字段的 TypeScript 类型写法已修正，仅测试变更。
- 单元 SDK/metadata 夹具不是云写验收。此次未重复真实 PG16 集群、旧 generation 探针、镜像构建、DNS 或费用控制流程。
- 候选 ZIP 两次 bundle/ZIP 字节一致，无外部 npm 依赖的私有目录启动成功，invalid event 在凭据前拒绝；ZIP 解压回读一致，包约 384 KiB，没有上传或实际 Lambda invoke。
- 构建目录 `F:/ChatGPT_workshop/techlong-f3c9-parent-bundle-20261012-r1/`：bundle SHA `b066edecc3f90ed8908f4c51f7f66a012b18318026d65ba9cd36537e27ecd18c`；ZIP SHA `bd5489563d179fa6d9dc1ec264b5bb1858c7c344c502c857874e9d8b4a7bed6c`；report SHA `5224156958b86e74cf449f311604f1fff90182b9553b41ab4ce33b32988a2096`。
- Source 会话仍有效。**20:04:19.289 UTC / Winnipeg 15:04:19.289** 准确 TableId `58c851f4-5b8e-45ce-8933-05c33b17fb21` 为 ACTIVE/key schema 准确；父 key 两独立事务读 ABSENT；resource policy、协调器 role、协调器 function 的本轮读取均 ABSENT。没有生产 RoleId/Revision 可绑定，故不能生成 executable registration review。
- `F:/ChatGPT_workshop/techlong-f3c9-parent-prestate-20261012-r1/parent-prestate-review.json` SHA `5ce7fa5995f20f1075b156a034fe2be77cfe43b76062ddcac33949b82f538a23`；53 文件 code SHA `45deef975b317da87d54b35321bc23b6ad4ec05431925c4269222fb2c1b1d2c2`，原 46 文件 `49719dc5...` 与 package/lock 保持。
- 本轮 AWS resource/IAM/Item 写、Lambda invoke、Secret 值读取、Neon 连接／写均 **0**。表策略是一次读取的历史观察，不证明未来缺失或旧权限已隔离；旧 Cell/DNS/cost/Neon 状态本轮未刷新。

## 继续位置

F3c9b 直接补当前未安装 root 的完整失败/TTL 分支及需要的固定 Secret/child Revision/RoleId 权限，组合 certified DB source、永久 failed marker、不可复制的 once-only delete ownership、准确 STANDARD DeleteStack 与独立恢复；不把 F3c8 的 journal reservation 升级为删除 ownership。之后集中完成 Source registrar／短窗口政策安装计划、真实 allow/deny 验收和具体 fresh 云权限/DB/Cell 清单。完整 root、下游能力和独立验收就绪前，不安装窄 parent、创建 RESERVED 或付费 PAID Cell。
