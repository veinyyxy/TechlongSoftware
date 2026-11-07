# Cell 与租户监听器归属修复方案及执行记录

目的：恢复既有 CloudFormation 管理关系，不发布镜像、不启动业务服务。只涉及 ca-central-1 的共享 Cell 和准确租户；不是平台 ALB 修复。**本页不是新增执行授权；下方原“待审/未执行”只保留各阶段事实，最新结果如下。** [三栈基线](aws-deployment-baseline.md)继续保留作修复前对照。

## 最新结果：A2 已创建并独立核验，未执行

用户确认清单 `23ee54ae7fdcd573f4895baa425276d0d8779c47f1a2b2341a69d8056f1dd0ac` 后，准确执行源码 `21cb21805103f2f9b3f6945a281c9b6c2604177c` 仅提交一次CreateChangeSet，并由另一进程完成独立只读回读。A2完整ARN：

`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-cell-a2-reattach-20261107t041842/c51436f8-6086-413d-9b5e-a4897b8522c2`

AWS CreationTime原值为2026-11-07T04:30:39.203000+00:00；独立核验于04:32:19.826Z（温尼伯11月6日22:32:19.826 CST）完成，结果 `A2_CREATED_VERIFIED_NOT_EXECUTED`，Change Set为 `CREATE_COMPLETE / AVAILABLE`。

- 真实计划恰为原四逻辑ID的Add，零Modify/Remove/Import；没有嵌套栈或已分配的新物理ID。Change Set Original的规范SHA为原候选 `e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`；四原参数/六标签保持。
- 栈仍 `UPDATE_COMPLETE`，已应用Original仍为A1的SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`；十二项保留物理ID、参数、标签、五输出和执行角色未变，两个监听器输出仍不存在。准确ALB名称仍返回LoadBalancerNotFound；**尚未恢复ALB或完成Cell归属修复**。
- 本阶段实际STS2、元数据19、CreateChangeSet1；Execute/Delete/其他直接AWS写均0。writer为1/13/1，独立为1/6/0，不计CFN内部验证调用。没有IAM、DNS、数据库/ECS启动、镜像、清理器变更或dispatch；没有写重试、替代创建或自动清理。不以此推断数据库现状或全账号零费用。

[公开创建结果](../ops/deployment-baseline/cell-a2-created-20261107.json)与私有证据根 `.local-secrets/cell-a2-create-20261107t041842` 保持；独立journal规范SHA `b0e8b929d3ffc3316e7e4250388d06bff6578cee7a9c28d98a9e00aa75e72573`。创建尝试已消费，原创建审批材料和a/b/c失败/补核记录保留，不重建A2、不复位目录。新文档提交不是上述执行源码。

收尾逐项核对公开结果与两份私有journal/摘要一致，14项本地基线及结果边界检查、定向零警告lint通过。这些检查不代替云端独立回读，也不声称新提交已通过远程CI。

**当前唯一继续点：单独审核执行这一份既有A2**，明确会创建收费ALB及其监听器/规则、历史标签/清理风险和失败/回滚策略，再给准确执行SHA；本次创建批准不包含这些动作。执行前须核对它仍AVAILABLE及必要事实仍有效，不因新ARN生成而重计原04:18:42.258Z依赖采样。不得自动执行、直接UpdateStack、替代创建或进入租户三规则/DNS/镜像；下一阶段的实际新读/写仍按准确范围审批。

## 当前审批：A2 仅创建未执行清单已准备

以下是已获批且只执行过一次的创建阶段准备记录，现由顶部独立结果替代，不再等待创建批准或重放此清单。

用户刷新 Source 并允许新一轮同范围读取后，b/c 联合核验已完成；a 失败记录保留，不重放。新事实从2026-11-07T04:18:42.258Z（温尼伯11月6日22:18:42.258 CST）计时，04:21:52.369Z完成，五小时事实终点固定为09:18:42.258Z；c补读没有重新起算。完整去敏[只读结果](../ops/deployment-baseline/cell-a2-preflight-20261107.json)和私有原件摘要已保存。

- 准确 IAM Source 已核实；同一 Cell `UPDATE_COMPLETE`、Original 为 A1 的十二资源模板，十二项物理 ID与四参数/标签/五输出/角色保持；当前 Change Set 列表为空，同名 ALB缺失。
- 原两子网/SG归属、443/8443及任务3000入口、证书ISSUED、trust store ACTIVE匹配；执行角色RoleId、trust、原inline及boundary v1匹配，无附加managed policy。
- Cell扫描DISABLED、tenant扫描ENABLED，准确租户没有ExpiresAt标签，服务0/0/0、Cell运行及待启动任务0。未调用清理器，也未证明部署中的清理器代码与仓库完全一致。
- 本轮实用STS1、元数据尝试22（21次成功/预期缺失＋1次失败）、所有云写/秘密值/数据库/执行槽均0。b的第10次元数据IAM GetRole因本地固定端点仍使用ca-central-1签名而返回SignatureDoesNotMatch；本地AWS SDK端点规则确认全局IAM签名区为us-east-1，c在同一30次总预算内仅补12次未完成项，未再STS或重读前九项资源。成功补读也只访问全球IAM，不是在美东创建资源。b的失败原件保持，没有修改云权限或持久AWS配置。

准确[仅创建清单](../ops/deployment-baseline/cell-a2-creation-review.json)规范JSON SHA：

`23ee54ae7fdcd573f4895baa425276d0d8779c47f1a2b2341a69d8056f1dd0ac`

**待批准范围仅是一次 CreateChangeSet，不执行：** 准确同一Cell栈，名称 `techlong-cell-a2-reattach-20261107t041842`，固定ClientToken，原A2候选摘要、四参数UsePreviousValue、原角色及六标签原样保留；不附OnStackFailure，IncludeNestedStacks=false。写前保存唯一意图/尝试记录并核对身份、A1模板/十二物理ID、空变更集、ALB缺失及角色指纹。最多STS2/限定元数据30、只读等待300秒，独立回读准确新ARN、模板正文及四Add/零Modify、Remove、Import；栈本身仍须A1中间态，ALB仍不存在。次数不含CFN提供者内部动作；不模拟或声称已证明Source PassRole/SCP的有效创建权限。

**停止与风险：** 创建请求提交失败、结果不明或超时后不重发（包括同token）、不删除或替换失败记录，不执行A2，不主动回滚/清理；仅在获准读取上限内独立确认。接受非原子/并发、凭据内存与AWS Login自动刷新失败、未执行记录可能遗留、提供者验证/日志及低额非零费用。永久尝试不复位。没有ALB恢复、数据库/ECS启动、IAM/DNS/镜像/标签期限变更或dispatch授权；完整风险见机器清单。本阶段不创建收费ALB，但不能据此宣称全账号零费用。实际ALB执行及其失败策略仍必须按将来的准确Change Set另审，A1的DisableRollback批准不沿用。

**最晚启动：温尼伯2026年11月7日03:08:42.258 CST（09:08:42.258Z）**，在原五小时事实终点前预留10分钟，不因本地材料生成而延期；这是审批材料时限，不是资源到期。过期/事实变化就停止，不改日期重用。13项本地基线/清单一致性检查及定向零警告lint通过，尚未创建A2、没有实际四Add云计划或恢复证明。

**当前唯一继续点：等待用户确认上述SHA，仅创建并独立核对这份未执行A2。** 不再次刷新Source或重复整个预检，不开始B租户规则、DNS或镜像。a/b/c、A1原件及离线候选不改写为新批准。

## 当前停止点：A2 只读准备在身份核对处停止

以下是a的历史停止点，现已由顶部b/c核验和待审清单替代，不再等待重复刷新Source。

用户允许最多1次STS＋30次元数据后，新记录a于2026-11-07T02:14:08.550Z开始，02:14:12.366Z停止（温尼伯11月6日20:14:12.366 CST）。官方CLI首次 `sts:get-caller-identity` 报告去敏分类 `CREDENTIALS_UNAVAILABLE`；准确身份未确认，不断言具体失效原因或HTTP是否已经发出。实际STS尝试1、资源元数据读取0、AWS写/Secret值/数据库连接/执行槽/Change Set均0，没有新的资源现状证明或待审SHA；旧依赖采样不延期。

[公开停止摘要](../ops/deployment-baseline/cell-a2-readonly-20261107-a.json)；私有原件 `.local-secrets/cell-a2-readonly-20261107-a/journal.json`，原始字节SHA `05fd89e913d564dbcdf5461f8273ba95e385a558f74ae4b7147b6a65867cf55d`。a保留且不重跑，不自动沿用未使用的元数据次数。**下一只请用户完成 `aws login --profile techlong-sandbox-user`，并允许新一轮同范围只读核对**，再用新的记录继续；不额外诊断STS、不生成假新鲜清单、不创建或执行A2、不恢复ALB。下方离线候选保持可复用，但不是云执行许可。

## 当前准备：A2 四项 Add 离线候选已完成（2026-11-06）

本轮按用户明确要求**仅离线准备**。已从封存原件提取 A1 前实际 Cell Original，核对其规范 SHA 与修复前基线一致，再证明：从该模板移除下表四项及两个输出，全文恰等于已执行 A1 模板。不是重新渲染默认模板，也没有用旧物理 ARN 填入新资源。

- [完整 A2 候选模板](../ops/deployment-baseline/cell-reattach-draft.template.json)，规范 SHA `e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`，与 A1 前 Original 相同；这是**内容指纹，不是执行批准 SHA**。
- [机器方案与未授权边界](../ops/deployment-baseline/cell-a2-offline-plan.json)：`OFFLINE_DRAFT_NOT_EXECUTABLE`；尚无新现场快照、审批 SHA、A2 Change Set ID、执行请求或有效执行期限。

| A2 唯一允许的资源差异 | 复用原声明的行为 |
| --- | --- |
| `CellLoadBalancer`，Add | 原名称的 internet-facing / IPv4 ALB；引用现有两个子网与 ALB SG；原默认路由依赖、三个属性及标签保持 |
| `BusinessHttpsListener`，Add | HTTPS 443，原证书参数、TLS 策略，默认固定 404 |
| `ControlMtlsListener`，Add | HTTPS 8443，原证书/TLS；mTLS `verify`、原 trust store 参数、`IgnoreClientCertificateExpiry=false`；默认固定 404 |
| `BusinessControlDenyRule`，Add | 443 的优先级1，`/api/saas` 与 `/api/saas/*` 固定404，不接入任何租户目标组 |

同时恢复 `HttpsListenerArn → Ref BusinessHttpsListener`、`ControlListenerArn → Ref ControlMtlsListener` 两输出，由 CFN 返回新 ARN。其余十二资源的全部声明、五输出、Metadata、Rules 和四参数定义均不变；四参数全部 `UsePreviousValue`，现有执行角色和栈标签须原样保留。预期仅四 Add、零 Modify/Remove/Import/嵌套栈，实际 Change Set 必须逐项证明，不能仅凭模板的本地差异判定云计划合格。

### 后续集中顺序与停止条件（本轮不执行）

1. **另获限定只读许可后补必要现状。** 准确 Source/账号/区域和同一 Cell UUID；提交前核对栈仍为 A1 `UPDATE_COMPLETE`、Original 摘要及十二保留物理 ID 匹配、无并发栈操作或未审变更集、同名 ALB 缺失。原证书/trust store、两子网/SG及 VPC、现有角色/trust/inline/boundary、已知租户空闲及两个清理计划的依赖事实，仍在原五小时内且未变化的继续复用，只补过期或明确变化项，不重跑整套旧预检。限既有资源元数据，不读 Secret、PEM、配置或数据库；不调用启停工具。旧 A1/依赖观察只保留真实时间，不从本次离线生成时间重新计算新鲜度。
2. **据真实事实另审“只创建、不执行 A2”。** 准确清单绑定同一栈、候选 SHA、四个原参数、现有角色/标签及新的唯一变更集名称/请求 token；最多一次 CreateChangeSet，独立回读实际四 Add和候选正文。不能附带 Execute/UpdateStack/Delete/权限修改。无 Add 物理 ID 现在可填；若真实计划含保留资源变更、额外资源、参数漂移或 IAM 不足，立即停止报告，不绕角色、不导入/手工创建、不自动重试或删除失败变更集。
3. **只有真实 A2 创建及独立核对通过后，再单独审批执行。** 绑定其完整 ARN、最新事实、费用、失败策略及独立验收范围。建议继续显式 `DisableRollback=true`、保留部分现场、代理不重发/主动回滚或清理，但该建议**尚未批准**，A1 的批准不沿用；CFN 提供者内部恢复仍可能发生。创建/执行阶段的配置必须无冲突，不能因冲突去掉该参数重试。执行后即使 ECS 为0，ALB仍可能持续收费；失败/超时也可能留下收费资源，停费或清理另审。
4. **执行后独立验收是进入 B 的门槛。** 同一栈 `UPDATE_COMPLETE`、Original 与候选一致；十二保留物理 ID不变、四新 ID均由本栈管理；新 ALB active且 VPC/两子网/SG/属性匹配。准确回读443/8443端口、证书/TLS、两默认404、8443 mTLS各字段及共享拒绝规则；两输出分别等于新监听器物理 ID，并属于新 ALB。保存真实 ID/DNSName/CanonicalHostedZoneId，不从历史映射推导。未全部通过就不准备租户两参数/三规则或 API DNS 的实际更新。

**历史到期风险明确保留：** 候选含原 `2026-10-15T16:44:56.246Z` 标签和 CellExpiresAt 输出，未添加、删除或延长到期时间。最近历史观察是 Cell 扫描关闭、全局 tenant 扫描开启，不能当作当前保证；A2 前必须核对。如果现有清理会触及新 ALB/栈，或用户要改标签/清理策略，需先单列准确差异另审，不能塞入“四 Add”修复，也不能声称本候选保证常驻。

本轮 AWS/STS、数据库连接、Secret/PEM读取、槽消费、Change Set/资源创建和 dispatch 均为0；仅读取本地已存模板与公开摘要。12项本地基线检查（含4项 A2 差异、TLS/mTLS、引用及未授权边界回归）及定向零警告 lint 通过，不是 AWS ValidateTemplate、远程 CI 或真实云计划/恢复证明。未增加执行器、工作流或启停框架。

**下一唯一动作：另审必要的限定只读核对，生成仅创建未执行 A2 Change Set 的准确审批材料。** 本轮到此收尾；不直接创建/执行 A2，不恢复 ALB/数据库/ECS，不改租户、DNS、IAM、镜像或到期清理。

## 最新结果：A1 已执行并独立核验（2026-11-06）

用户确认清单 `87a80dc7abd91501820ac1d48333613dc283429f40bbba4e0e8a974b7e5b3ed9` 及失败策略后，仅一次执行原 A1 `2e95d3a1-8cdf-4948-a779-eff36394f627`，显式 `DisableRollback=true`。20:07:51.856Z 收到 ACK，20:08:04.483Z 观察到 Cell `UPDATE_COMPLETE`；另一进程于20:09:32.860Z（温尼伯14:09:32.860 CST）完成独立只读核验，结果 `A1_DETACHED_INDEPENDENTLY_VERIFIED`。执行源码为 `23aca56673631a75e5d242f85afc26391522f176`；此后的结果文档提交不冒充执行源码。

- 实际 Original 等于 A1 十二资源模板，规范 SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`；四项失效声明不再是活动归属，Change Set 为 `EXECUTE_COMPLETE`。
- 十二项保留资源的逻辑 ID、类型及物理 ID 与执行前一致；`HttpsListenerArn`、`ControlListenerArn` 两输出移除，其余五输出、标签及执行角色保持。该比较不等于完整资源属性漂移扫描。
- 准确名称 ALB 仍返回 `LoadBalancerNotFound`。没有重建 ALB、启动数据库/ECS、改 IAM/DNS/镜像或清理器；没有失败重发、主动回滚或清理。A1 只解除旧声明，**没有完成 Cell/租户归属恢复**，也不证明全账号停止计费。
- 代理直接调用合计 STS2、元数据19、ExecuteChangeSet1、其他 AWS 写0（writer 1/13/1，独立 1/6/0）；不把 CFN 提供者内部调用算进代理次数。执行槽已永久消费，不重放。

[公开结果摘要](../ops/deployment-baseline/cell-a1-executed-20261106.json)含准确栈/变更集、十二项物理 ID 和证据摘要。私有原件在 `.local-secrets/cell-a1-execute-87a80dc7`，独立 snapshot 规范 SHA `3e29d8e89d2d4ccad76a65c224e4e95b2aa685ff7e051f877fa63ce081ceba85`，不提交原始 API 响应。

收尾已在本地将公开摘要与已存独立原件逐项对齐（包括四参数/标签/角色），8项基线回归及定向零警告 lint 通过；这些测试只验证材料一致性，不替代上述真实云端独立核验，也不声称新文档提交已通过远程 CI。

**A1 收尾时的继续点为仅离线准备 A2 四项 Add 候选，现已按顶部完成。** A1 原件和审批记录保持；没有据 A1 批准创建/执行 A2、恢复收费 ALB 或更新租户参数/三规则、API DNS、镜像。

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
