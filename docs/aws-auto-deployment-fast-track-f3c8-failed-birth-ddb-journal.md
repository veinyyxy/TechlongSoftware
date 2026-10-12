# F3c8：失败 Cell 的 DDB 原子排除、补偿日志及准确 ARN 只读恢复

2026-10-12 Winnipeg。本阶段完成代码准备及一次集中在线只读核验，没有安装新围栏、权限或运行时，也没有删除或创建 Cell。50 USD/月仍是预算目标，不是费用硬上限。

## 已实现的范围

`failed-cell-birth-ddb-v1.ts` 独立于旧 drain-only 登记：以真实品牌的失败 Stack 与 F3c7 受限数据库 certified zero 编译 marker，绑定完整 fence tuple、Stack ARN、模板和失败 inventory、数据库证书/保护目录/state hash。marker 的 fresh SHA 审批只允许创建排除项，明确不授权 DeleteStack、runtime 或旧发布器权限隔离。审阅窗口十五分钟；实际 writer 必须重新采集 DB/CFN，而不是复用归档证据。

`aws-sdk-failed-cell-birth-ddb-v1.ts` 提供 Source-only 的 dormant SDK 能力：

- 五个准确 key 的一次 `TransactGetItems` 快照，两侧校对准确 Source ARN/UserId；永久记录有严格 decoder，旧 activation/provision 只作为存在性阻断项和 hash，不解释为 zero。
- marker 安装前独立回读槽位、重新采集受限数据库证明与准确失败 Stack。提交时同时检查两个旧 authority key 和两个 journal key 均不存在，marker 自身 absent-only Put；无 update/delete/reset/自动重试。
- journal intent/receipt 使用固定 per-Cell key，不以 birth、payload SHA、时间或调用令牌另开槽位。reserve 事务校对完整 marker JSON、两个旧 key 缺失与 receipt 缺失，只 Put 固定 intent。
- journal 预留**不是删除所有权**。Source 身份、准确 SHA、fresh 快照不能升级为 parent 的云删除许可。没有 DeleteStack client、claim capability 或自动执行入口。
- terminal receipt 只能接收独立 recovery 私有品牌的准确 token 终态观察，事务同时检查 marker、intent 和两个旧 authority 缺失；receipt 永久 absent-only。返回不确定只 Inspect，不补写、不删除、不复位。

所有争槽写请求使用独立 UUID，不复用 payload 派生的 DDB transaction token。DDB 同 token 可回放原成功响应，不能用它给多个争槽者发 ownership；本实现没有 actuator ownership。[AWS 事务语义](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)

## 固定准确 key

复用现有 `techlong-sandbox-tenant-external-epoch-authority` 表，不创建表：

| 用途 | authority_key |
| --- | --- |
| 成功 provision 前驱 | `cell:cell-sandbox-1` |
| lifecycle activation | `runtime:cell-sandbox-1:lifecycle-v2` |
| 失败排除 marker | `cell-birth-v3:failed-unadmitted:cell:cell-sandbox-1` |
| 永久补偿 intent | `cell-birth-v3:failed-compensation-intent:cell:cell-sandbox-1` |
| 永久补偿 receipt | `cell-birth-v3:failed-compensation-receipt:cell:cell-sandbox-1` |

marker 与新发布事务两方向都检查同一固定槽位：若新发布先成功，marker 的 authority 缺失条件失败；若 marker 先成功，新发布的 marker 缺失条件失败。每个事务不对同一 item 重复操作。[AWS 原子条件事务](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)

`prepareFailedBirthGuardedPublicationV1` 目前仅编译 provision/activation 的**保护事务数据**，不是实际 publisher。它只校验存储形状和 canonical JSON；不批准 activation 的业务语义、角色权限或运行时启用。没有把旧 publisher 改成新写入路径，没有对现有 TaskRole/Provisioner 权限作任何改动。

## 准确 ARN 请求与独立恢复

journal 的请求数据只允许固定完整 Stack UUID ARN、原 CFN execution role、派生准确 client token 和 `STANDARD`。name-only、其他 role、Force/Retain/Skip 参数及重算 hash 后的扩权数据均拒绝。这只是数据，不是调用批准。[AWS DeleteStack 参数](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeleteStack.html)

`aws-sdk-failed-cell-birth-recovery-v1.ts` 是独立 Source-only CFN/STS 只读能力，最多两次完整 DescribeStackEvents 分页和两次准确 ARN DescribeStacks；两側身份、状态和最新 Stack 事件必须稳定，最新事件必须是准确 Stack/物理 ARN、准备时间之后、同一 request token，并与当前状态吻合。只有 `DELETE_COMPLETE_TOKEN_MATCHED` 或 `DELETE_FAILED_TOKEN_MATCHED` 可记录 terminal receipt。新动作/别人的 token、事件漂移、分页循环、未匹配状态或 in-progress 不记终态。

CFN 异常、准确 ARN 不可读、名下没有 Stack 均**不是删除成功证明**。不回退栈名，不自动调用 DeleteStack，不把旧匹配事件冒充最新操作。receipt 是一次观察历史：DELETE_FAILED 不批准重试；后续另批的外部处理不覆盖旧 receipt。

## 明确仍未完成的安全边界

旧 `AwsSdkSharedCellProvisionAuthority` 的 PutItem 仅检查旧 provision key 不存在，不检查 marker。因此“DDB 有 marker”不等于旧写入权限已被技术隔离。测试专门证明：一个未受保护的旧发布事务仍能绕过数据围栏；新的强读/journal 随即拒绝其 authority，但不能消除它与未来删除的跨服务竞态。

必须先形成并安装可核验的旧发布路径权限隔离、新 guarded publisher/activation 安装协议和完整父登记 scope，再接 DeleteStack actuator。IAM/resource policy 不是跨 Neon/CFN 的 CAS；审批、传播与并发风险必须明确，不以 IAM simulation/代码 flags 宣称完整有效权限证明。不借用 F3c6 `deleteFailedBirth:false` 的 drain-only 登记，也不借本阶段 marker-only 审批。

本阶段没有创建可执行云批准清单。marker writer、journal 和 recovery 均为未接到生产 handler 的准备代码；没有权限安装、业务 SQL 安装、activation 写入、Lambda invoke、Secret 值读取或付费 Cell。

## 验证结果与真实只读证据

- 11 项新定向测试 + 4 项 F3c7 + 8 项 F3c6，共 **23 项通过**。覆盖真实 reader 私有品牌的复制拒绝、DB/CFN/Source 漂移、双向/提交时 authority 竞争、固定槽位并发、成功响应丢失、时间/payload 变化、旧发布器绕过、准确 ARN/request allowlist、事件归属/分页/状态漂移、immutable receipt。最初一项测试夹具将准备时间放到测试时钟未来，正确被拒绝；已修正测试时钟，没有放宽生产 freshness 判断。
- typecheck、定向 ESLint（0 warning）、CLI syntax 通过。
- 测试里的 atomic SDK transport/SQL transport 是定向单元夹具，**不是 AWS 写入或 Neon 实际安装验收**。本阶段不重复 F3c7 的真实 PG16 集群，不新增大量离线模拟。
- 最终只读 r2：**2026-10-12 19:41:08.625 UTC / Winnipeg 14:41:08.625**。Source 会话仍有效；原表 ID `58c851f4-5b8e-45ce-8933-05c33b17fb21` 为 ACTIVE/key schema 准确，两次独立事务快照中五个 key 全部 ABSENT；旧 drain registration 也 ABSENT。
- AWS resource/IAM/Item 写入、Lambda invoke、Secret 值读取、Neon 连接与写入均 **0**。没有真实失败 Stack/journal，所以没有调用 CFN recovery，亦未刷新 F3c5 Cell/协调器缺失证据；该旧证据只是历史。
- `F:/ChatGPT_workshop/techlong-f3c8-failed-birth-ddb-20261012-r2/failed-birth-ddb-review.json` SHA：`3fdf9dbe39f65b3b302f94d3f476e811cb6c270c5eb749cce30df8c9f70e4c0b`。
- 最终 46 文件 code SHA：`49719dc5f6300bdc8b2042568bd093f246919ef1c53d29bb4a343d623e24fdc1`；原 42 文件 `361360c24888c562a0c64e98c436545438bb79ba83c3e204770321a896c71b7a` 全部保持。r1 只读证据保留，最终加固前绑定不作为 final code binding。

## 下一步主线

F3c9 集中完成完整父登记授权、旧发布路径权限隔离方案与 guarded publisher 的实际接线，绑定真实 Lambda package/Revision/RoleId，然后把 certified failed zero、DDB marker、once-only delete ownership 与本阶段准确 ARN recovery 组合。成功到期分支补齐 authority issuance/TTL executor 的同一父 scope。完整代码与明确资源/变更清单就绪后，再请求 fresh 云安装审批；不先创建会在实现期间到期的 RESERVED/付费 Cell，也不反复进行旧 generation 探针。

现有 F3c7 Neon 保护候选尚未安装，PG18 的实际 DDL 兼容验收仍未完成。数据库/schema/role、IAM/handler、登记、三阶段 Cell 和实际删除均按具体 fresh scope/SHA 分别确认，不把本阶段代码完成称为自动部署完成。
