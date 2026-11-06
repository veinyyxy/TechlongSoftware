# Cell 与租户监听器归属修复方案及执行记录

目的：恢复既有 CloudFormation 管理关系，不发布镜像、不启动业务服务。只涉及 ca-central-1 的共享 Cell 和准确租户；不是平台 ALB 修复。**本页不是新增执行授权；下方原“待审/未执行”只保留各阶段事实，最新结果如下。** [三栈基线](aws-deployment-baseline.md)继续保留作修复前对照。

## 最新结果：A1 已执行并独立核验（2026-11-06）

用户确认清单 `87a80dc7abd91501820ac1d48333613dc283429f40bbba4e0e8a974b7e5b3ed9` 及失败策略后，仅一次执行原 A1 `2e95d3a1-8cdf-4948-a779-eff36394f627`，显式 `DisableRollback=true`。20:07:51.856Z 收到 ACK，20:08:04.483Z 观察到 Cell `UPDATE_COMPLETE`；另一进程于20:09:32.860Z（温尼伯14:09:32.860 CST）完成独立只读核验，结果 `A1_DETACHED_INDEPENDENTLY_VERIFIED`。执行源码为 `23aca56673631a75e5d242f85afc26391522f176`；此后的结果文档提交不冒充执行源码。

- 实际 Original 等于 A1 十二资源模板，规范 SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`；四项失效声明不再是活动归属，Change Set 为 `EXECUTE_COMPLETE`。
- 十二项保留资源的逻辑 ID、类型及物理 ID 与执行前一致；`HttpsListenerArn`、`ControlListenerArn` 两输出移除，其余五输出、标签及执行角色保持。该比较不等于完整资源属性漂移扫描。
- 准确名称 ALB 仍返回 `LoadBalancerNotFound`。没有重建 ALB、启动数据库/ECS、改 IAM/DNS/镜像或清理器；没有失败重发、主动回滚或清理。A1 只解除旧声明，**没有完成 Cell/租户归属恢复**，也不证明全账号停止计费。
- 代理直接调用合计 STS2、元数据19、ExecuteChangeSet1、其他 AWS 写0（writer 1/13/1，独立 1/6/0）；不把 CFN 提供者内部调用算进代理次数。执行槽已永久消费，不重放。

[公开结果摘要](../ops/deployment-baseline/cell-a1-executed-20261106.json)含准确栈/变更集、十二项物理 ID 和证据摘要。私有原件在 `.local-secrets/cell-a1-execute-87a80dc7`，独立 snapshot 规范 SHA `3e29d8e89d2d4ccad76a65c224e4e95b2aa685ff7e051f877fa63ce081ceba85`，不提交原始 API 响应。

收尾已在本地将公开摘要与已存独立原件逐项对齐（包括四参数/标签/角色），8项基线回归及定向零警告 lint 通过；这些测试只验证材料一致性，不替代上述真实云端独立核验，也不声称新文档提交已通过远程 CI。

**下一唯一继续点：仅离线准备 A2 四项 Add 候选和审批材料。** 复用 A1 前的原四项属性/依赖/输出，不填历史物理 ARN；实际新鲜读取、创建/执行 A2 及恢复收费 ALB 仍另审。本轮在 A1 收尾，不进入 A2，不更新租户参数/三规则、API DNS 或镜像。

## 2026-11-06：A 阶段只读前置核对与 A1 候选已完成

用户要求“继续下一步”后，仅完成此范围的只读核验（Source STS 1、资源/权限元数据24次，包括预期 NotFound 回执），AWS 写、Lambda调用、Secret值/数据库读取、Change Set和镜像更新均为0。Cell Original 于19:23:02.749Z（温尼伯13:23:02.749 CST）保存到本轮内存，完整规范JSON摘要与工程基线相同；13:27:57 CST汇总[机器摘要](../ops/deployment-baseline/cell-preflight-20261106.json)，不是新的现场查询时刻，也不是批准SHA或完整原件执行包。

| 核对项 | 本轮观测及边界 |
| --- | --- |
| 准确 Cell 栈 | 原UUID/status保持；16项CFN记录；无现存Change Set |
| 实际旧资源 | 准确名称和旧ALB ARN分别 LoadBalancerNotFound；两个旧监听器均 ListenerNotFound；旧共享拒绝规则 RuleNotFound |
| 保留的网络依赖 | 两SG、两子网仍归属原Cell VPC，子网available、AZ分别a/b；CFN所有权标签匹配。未遍历其余路由/IGW属性，不称12项全部无漂移 |
| TLS依赖 | 原证书ISSUED、覆盖sandbox及其子域、2027-04-26到期；原trust store ACTIVE、1张CA证书；未读CA正文或私钥 |
| 执行角色 | 原RoleId/CFN信任保持；inline为FirstAcceptanceCellResourcesV1，boundary默认v1，未附加其他managed policy；静态Create/Delete/Tag的相应ALB路径存在。不等于证明Source PassRole、SCP或实际CFN调用一定允许 |
| 现有消费方 | 已知租户准确UUID/两旧参数保持，服务desired/running/pending=0/0/0，Cell集群running task列表为空。Cell Outputs没有Export，模板无ImportValue；不把此有限范围称为全账号消费者穷举 |
| 清理风险 | Cell的ExpiresAt仍为10月15日历史值；Cell扫描计划DISABLED。全局tenant扫描仍ENABLED，但准确租户当前Tags没有ExpiresAt。未验证部署中Lambda代码与仓库完全同源，未调用/关闭任何清理器 |

[A1候选模板](../ops/deployment-baseline/cell-detach-draft.template.json)由本次Original精确删去四项和两个Outputs派生。规范JSON SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`，不是执行批准SHA。保留十二资源属性、四参数、其他输出/规则/历史标签，不删除网络、不重计旧到期。生成时逐项比较保留资源与原件一致、无悬空旧引用；六项离线回归通过。它是给未来A1审查的完整CFN模板正文，不是声称已从栈移除资源。

**下一唯一动作：另审仅创建、不执行 A1 Change Set。** 执行前仍需核对源/身份、准确栈和并发状态；创建结果必须恰为四个Remove，其余资源无变化，才可另请执行批准。不得直接UpdateStack或同时创建A2。真实CFN删除缺失物理对象、回滚的提供者行为尚未证明；旧到期标签和现有清理状态在后继审查中明确保留或单列差异，不自动续期/关计划。有关创建/删除动作和标签授权的静态映射仅参考[AWS ELB V2授权表](https://docs.aws.amazon.com/service-authorization/latest/reference/list_elbv2.html)，没有做权限模拟或真实写入试探。

## 起点与取舍

### 批准前执行审批记录：失败保留现场，不进入A2（现已执行，见顶部）

本次只准备审批，实际ExecuteChangeSet仍为0。19:55:02.640Z新一轮STS1/元数据5确认同一A1仍CREATE_COMPLETE/AVAILABLE，原栈/角色未变、它是唯一变更集、四项Remove及模板SHA保持，同名ALB仍不存在。未追加完整25项预检或查询业务数据。

准确[执行清单](../ops/deployment-baseline/cell-a1-execution-review.json)规范JSON SHA：

`87a80dc7abd91501820ac1d48333613dc283429f40bbba4e0e8a974b7e5b3ed9`

- 仅一次ExecuteChangeSet，绑定完整栈ARN、现有A1 ARN和固定ClientRequestToken；显式 `DisableRollback=true`。不创建/删除Change Set、不UpdateStack、不RollbackStack/ContinueUpdateRollback、不调用A2、恢复工具、数据库、IAM、DNS、镜像或Lambda。
- 请求前复核准确身份、唯一A1仍AVAILABLE、四项Remove/旧物理ID和模板摘要未变、原12项物理ID及ALB仍缺失；若存在OnStackFailure或RollbackTriggers等冲突设置，停止，不能偷偷去掉DisableRollback重试。
- 提交意图先持久化。失败或回执不明均消费唯一尝试，不自动重发，包括使用同token的重试；只有获准的只读查询可以继续确认真实状态。最多2次STS、80次限定元数据读取，等待最多600秒；等待超时不代表AWS停止操作，不发送取消或回滚。
- 禁用的是整体失败回滚请求，不是“保证AWS绝无任何内部恢复”。[AWS说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)更新/变更集保留成功资源时，失败资源仍可能恢复到其最后稳定状态。若发生此类处理，只读记录和报告，不由代理追加写入。该API支持显式DisableRollback，且不能与创建阶段OnStackFailure并用：[ExecuteChangeSet参数](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。
- 接受可能停在UPDATE_FAILED、只完成部分声明移除、输出不完整，以及之后需要另审恢复。成功须准确栈UPDATE_COMPLETE、Original等于A1、两个监听器输出消失、12个保留资源物理ID保持、四项不再是活动归属（不将DELETE_COMPLETE历史行算作活动资源），并确认无ALB重建。A1成功只解除旧声明，不意味着ALB/归属恢复或产品已上线。

清单最晚启动为2026-11-07T00:23:02.749Z，即**温尼伯11月6日18:23:02.749 CST**，受原13:23依赖快照五小时限制，不从新一次窄核对重计全部依赖时间。这只是本次执行材料的事实新鲜度，不新增资源到期、不改旧ExpiresAt或JWT/MFA期限。过期不得执行本清单或只改日期，应另核必要差异。

上述次数上限只约束代理直接调用的API，不约束CloudFormation资源提供者内部的并行或重试次数。七项离线数据/边界回归通过；没有新执行框架或runner。用户须明确批准上述SHA及失败策略后才实际执行。另更正前两段温尼伯显示：11月6日为UTC-6（CST），原14:23/14:47已改为13:23/13:47；所有原UTC观察、创建时间及回执不改。

### A1 Change Set 已创建并核对，未执行（2026-11-06）

用户明确确认“仅创建、不执行A1 Change Set，核对四项Remove”后，本轮只提交一次 CreateChangeSet。变更集：

`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-cell-a1-detach-20261106t194714/2e95d3a1-8cdf-4948-a779-eff36394f627`

AWS 创建时刻19:47:24.347Z（温尼伯13:47:24.347 CST），独立只读回读19:48:07.940Z确认 CREATE_COMPLETE / AVAILABLE，准确Cell栈仍CREATE_COMPLETE、旧两个输出保持，尚未执行A1。GetTemplate对该Change Set的Original回读与A1候选SHA完全一致；四个原参数和既有执行角色/标签保持。

变更明细恰为 BusinessControlDenyRule、BusinessHttpsListener、CellLoadBalancer、ControlMtlsListener 四项Remove，PolicyAction均Delete；Add=0、Modify=0，没有网络、ECS、数据库或镜像变更项。十二项保留资源未进入变更明细，两个输出的移除反映在候选模板而不另计资源变更行。完整准确ID/类型/物理引用见[已创建结果](../ops/deployment-baseline/cell-a1-created-20261106.json)。

实际次数：STS1、writer元数据读取7、独立读取2、CreateChangeSet1、ExecuteChangeSet0、DeleteChangeSet0。提交前核对了准确栈/角色、Original摘要、空变更集列表和同名ALB仍缺失；没有重跑前轮24项预检。私有请求/ACK/变更明细保存在工程内Git忽略目录 `.local-secrets/techlong-cell-a1-detach-20261106t194714`，不提交原请求或凭据。

**创建阶段当时仅等待对此准确Change Set执行的单独批准，已由顶部执行结果替代。** 此创建记录不是额外执行许可；不再创建另一份A1，不创建A2、不恢复ALB/数据库/ECS、不改IAM、DNS、标签或镜像。当时要求执行前核验它仍AVAILABLE、准确栈和现状未变，并在新执行范围中明确失败/回滚策略；创建批准本身不授权失败回滚重建收费资源、自动重试或清理。原“尚未执行”只描述创建阶段，不描述当前结果。

上轮只读回读：Cell 栈 UUID 尾段 `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` 为 CREATE_COMPLETE，CFN 的 ALB 和两个监听器物理 ID 属于代 `77888e84c19e8b86`；租户栈 UUID 尾段 `5867e9c0-d60d-11f1-b2c0-02ffdbfa6b13` 的两个监听器参数及三个规则 ID 属于代 `241081ab25c73320`。ELB 按准确名称查询返回 LoadBalancerNotFound。11月6日手工恢复映射也是历史，不拿其中任何 ARN 填新参数。

相同模板再提交不能当作重建缺失资源的方法；不存在的资源也没有可供导入的物理对象。建议**由原栈创建新物理资源，而不是先手工创建再认领**。首选下面的分段移除失效声明、恢复原逻辑 ID 方案。能否实施取决于新鲜证据、栈依赖和实际 Change Set；不保证 CFN 对失效物理 ID 的删除或回滚一定成功。

## A. Cell：仅四项，先恢复所有者

1. **获准后先只读核对。** 绑定准确账号、区域、栈 UUID、Original、角色/boundary、四项 CFN 物理 ID、同名 ALB 与旧 ID 的缺失；核对 SG、两个子网、证书和 trust store 可用。确认两个输出未被其他栈通过 Export/ImportValue 消费，亦无未纳入的监听器消费者、栈更新或并发启停任务。检查旧到期标签/清理计划是否会在修复窗口删栈；不能静默续期或关闭清理器。若同名 ALB 已出现、权限不符或无法排除冲突，停止，不导入、不覆盖。
2. **A1，解除失效声明。** 从获准时的 Cell Original 派生中间模板：仅移除 `BusinessControlDenyRule`、`BusinessHttpsListener`、`ControlMtlsListener`、`CellLoadBalancer` 及指向两个监听器的 Outputs；确认没有悬空引用。仅接受这四个 Remove，其余 12 项不变。A1 会暂时没有监听器输出，只允许在确认已停用且无外部消费的窗口执行。单独审批、等 UPDATE_COMPLETE、独立回读后才允许准备 A2；若 CFN 删除旧记录失败或回滚，保留事件，不跳过资源、不自动重试。
3. **A2，同一栈重新声明。** 使用 A1 前核准的原四项属性、依赖和两个输出名，不用旧物理 ID。只接受四个 Add；不替换 VPC、子网、集群、安全组，不创建数据库。ALB 创建即可能收费，即使 ECS 仍为 0。若需改标签、信任库、IAM 或其他属性，另审，不把它们混入修复。
4. **A 阶段独立核验。** 同一栈的 ListStackResources 必须给出四个新物理 ID；ELB 回读准确 ALB 为 active、所用 VPC/子网/SG 与声明相符。两个输出须分别等于两个 CFN 监听器物理 ARN，并能在该 ALB 上读到。443 为 HTTPS 业务监听器；8443 为 HTTPS、mTLS `verify`、准确 TrustStoreArn、`IgnoreClientCertificateExpiry=false`；证书和 TLS 策略与模板相同，两者默认均为 404。共享拒绝规则须在 443、优先级 1、对 `/api/saas` 与 `/api/saas/*` 返回 404。任一不符，禁止进入 B。保存栈 UUID、模板摘要、新 ARN、两个输出及核验时间。

## B. 租户：仅两参数、三条规则

只使用 A 阶段刚核实且在提交前再次匹配的两个 Cell 输出。其余四个跨栈输入（集群、VPC、子网、任务 SG）与保留的目标组必须一致。检查新监听器优先级空位、旧三规则确实不存在、执行角色能访问新规则路径。旧 IAM 策略曾绑定具体监听器；权限不足则另报，不扩权或换身份绕过。

优先基于租户 Original 保留同一模板、其余 18 项参数 UsePreviousValue（**包括 ImageUri**），只改 HttpsListenerArn 与 ControlListenerArn，要求 Change Set 明确体现三条规则换到新监听器；须接受三规则的明确替换，不接受含糊的条件替换、无变更或对旧规则的普通原地修改。若实际计划无法安全替换已缺失的规则，停止另审，不在本轮自行移除规则：TenantService 对三条规则均有 DependsOn。任何 Service/TaskDefinition/TargetGroup/LogGroup 的更新或替换、启动任务、规则优先级冲突均为 No-Go。

| 租户逻辑 ID | 应归属的监听器 | 必须回读的行为 |
| --- | --- | --- |
| TenantBusinessControlDenyRule | 443，优先级 100 | 准确租户 Host + 两个控制路径 → 404 |
| TenantListenerRule | 443，优先级 101 | 准确租户 Host → 原 TenantTargetGroup |
| TenantControlListenerRule | 8443，优先级 100 | 准确租户 Host + 两个控制路径 → 同一目标组 |

独立回读：租户两个参数分别等于 A 输出；三条规则的 CFN 物理 ARN、ELB 实体、监听器、条件及动作逐项一致；原目标组物理 ID、服务、任务定义/镜像及副本数未被本次修复改变。不能仅凭 UPDATE_COMPLETE 或人工改对路由判为通过。

## DNS、停止点与移交

- 租户 API 的 A Alias 不属于这两个栈。只读核对准确 sandbox zone 中的 `first-acceptance.sandbox.techlong.cloud.`，比对新 Cell ALB 的 DNSName（规范处理尾点/dualstack 前缀）、CanonicalHostedZoneId 及既有 EvaluateTargetHealth；拒绝歧义记录。若不符，记录“规则归属已核对，DNS 未对齐”，**另批单条 DNS 差异**；不碰平台 console 或买家 CDN。DNS 匹配不代表 ECS 已启动或业务测试通过。
- A1、A2、B 均须分别核对真实 Change Set 的 ID、输入、范围及回滚影响；创建、执行和任何资源费用不由本草案授权。执行失败或结果不明时只读核对，绝不自动补建、删除、回滚或复位。A2 成功而 B 失败时，ALB 仍可能持续计费，应报告而非自动清理。
- 费用工具再次直接删除 Cell ALB 会使本次归属失效；未来执行前必须协调该工具与发布窗口，不在停用期间提前重建。本轮不改工具、锁、数据库、ECS 数量或任何 IAM。
- 只有两栈物理归属、六项跨栈绑定、DNS 全部通过，才保存修复后新基线并**另行**准备同一租户的镜像更新。平台自身的 ALB/控制器差异继续单列，不能把本次结果当作三栈全部无漂移。
