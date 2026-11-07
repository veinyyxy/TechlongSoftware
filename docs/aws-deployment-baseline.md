# 既有租户版本更新：三栈资源基线

初版 2026-11-06；状态整理 2026-11-07。账号 402010193138 / ca-central-1。这里的“正式基线”指后续发布所遵守的**声明归属**，不是新生产环境、可执行部署包或云操作授权。初版仅离线整理；后来的 A1/A2、IAM 修正和租户 B 均是用户另行批准的独立修复范围，不能由追加的文档反向授权。

本页分开记录当前状态、长期归属和历史阶段；只有下一节定义当前继续点。历史段落、旧审批 SHA、旧期限及机器清单中的准备状态均不构成新许可。已验证的现有 sandbox 不等于任意租户。买家商品列表、登录、查看订单及卖家端所测功能由用户确认正常，不列为工程待测项。

<a id="current-state"></a>

## 当前状态与唯一继续点

**前阶段 B 失败事件已按用户限定许可读取，直接原因确认；当前离线恢复提案已完成，没有修复授权或实际修复。** 前阶段仅 STS1＋DescribeEvents1、无翻页/重试/云写，见[只读查因回执](../ops/deployment-baseline/tenant-b-failed-events-observed-20261107.json)；本阶段没有新增账号AWS调用。下列资源状态仍来自此前独立回读，事件查询或离线准备都没有刷新资源现状或延长任何期限。

| 对象 | 最新已存事实与边界 |
| --- | --- |
| Cell | [A2 结果](../ops/deployment-baseline/cell-a2-executed-20261107.json)于 2026-11-07T04:55:14.610Z 独立确认 UPDATE_COMPLETE/16 项，原十二物理 ID 保持，新 ALB、443/8443 监听器及共享拒绝规则由同一 Cell 管理；不等于平台和租户全部无漂移 |
| 租户 B | [执行后独立检查](../ops/deployment-baseline/tenant-b-execution-inspected-20261107.json)于 2026-11-07T14:09:45.640Z 确认为 UPDATE_FAILED / EXECUTE_FAILED；两监听器参数已变为 729e 代，但三规则 CFN 物理引用仍为旧代，状态为 UPDATE_ROLLBACK_COMPLETE；尚未验收到新租户规则，目标组未关联 ALB。该次检查没有包含初始原因，后续事件查询才取得，原回执不改写 |
| 保留资源与权限 | B 独立检查时 Service/TaskDefinition/TargetGroup/LogGroup 四物理 ID 保持，服务 desired/running/pending 为 0/0/0、任务定义 :12，IAM 默认 v10 匹配；未查询瞬时任务历史，不能承诺整个操作期间从未启动任务 |
| 已消费批准 | B 执行 SHA `109627ceccdbe813ebbbf2b80c176c9a1e60ed16dfc75cb1f740a04af2dd69c9` 已单次执行，STS2/元数据36/Execute1、其他直接写0；即使原时限未到也不能重放。观察到了提供者资源级恢复，没有代理主动回滚、重试或清理 |

**已确认的直接原因：** 2026-11-07T14:53:08.255Z 完成的一页事件查询绑定 OperationId `05dc971d-c8f7-46b9-ae85-d44ec357b009`、`FailedEvents=true`，返回根栈及三条规则共4条失败事件，无下一页。三规则均报 `Replacement type updates not supported on stack with disable-rollback.`。原执行清单把三项替换与 `DisableRollback=true` 组合，这是本次执行策略的不兼容，不是新的 IAM 缺口证明；也不能据此保证未来恢复必然成功。ResourceProperties 只可能进入 CLI 内存，未保存/输出；原[读取草案](../ops/deployment-baseline/tenant-b-failed-event-read-scope.json)保持准备时原文，不用于重复读取。

**当前唯一继续点：离线恢复提案已备齐，只等待最小只读准备许可。** [方案与完整风险](aws-cell-listener-ownership-repair.md#当前离线恢复提案先回到稳定状态再准备正常回滚的-b)建议先另批同一租户RollbackStack并独立核对，再另批新的三规则Change Set/显式DisableRollback=false执行；不能直接在失败状态重放旧计划。回滚涉及整个租户栈、可能受旧规则缺失和服务声明1/实况0影响，不能保证只改两参数或不启动任务；无上次稳定状态会删栈，必须先绑定真实同UUID成功证据。新[机器提案](../ops/deployment-baseline/tenant-b-recovery-offline-plan.json)不可执行、执行SHA=null，本轮零账号AWS/秘密值/数据库/云写/新槽。

下一仅待另允STS1＋准确租户/服务/现有角色policy元数据9，为单独回滚清单核实事实；范围和风险见方案。尚未获准或执行该读取，也未批准回滚、新Change Set或其他写入。现有事实时间和原执行槽不改；不改IAM/模板/DNS/镜像，不直接启停ECS/RDS、不运行临时工具，不扩UI、探针、F3c9或恢复框架。ALB可能仍收费，没有新增自动停止，本次未核对现时健康或费用。

## 哪个栈负责什么

| 栈（现有名称） | 声明归属 | 不归它管理 |
| --- | --- | --- |
| 平台 `techlong-sandbox-platform-hosting-v1`，11 项 | 平台 Cluster、TaskDefinition、Service、LogGroup；ALB、443 Listener、目标组、两个安全组、TaskIngress、console 域名 A Alias | 所用 VPC/子网、证书、Web 数据库与执行角色。平台执行角色/boundary 在独立 access 栈；不属于平台版本更新 |
| 共享 Cell `techlong-sandbox-cell-sandbox-1`，16 项 | VPC、IGW/attachment、两个公网子网、路由表/默认路由/两个子网关联；任务和 ALB 安全组；集群、ALB、443 业务与 8443 mTLS 监听器、共享业务拒绝规则 | Express 数据库是外部依赖；不能把 Full 配置的 DB 子网组、集群或 writer 加回。证书和 trust store 也是输入 |
| 租户 `techlong-sandbox-tenant-9c5ee9e64509dcad`，7 项 | 租户 Service、TaskDefinition、LogGroup、目标组、两条 443 规则（业务和拒绝控制路径）、一条 8443 控制规则 | 不拥有集群、监听器、租户 API DNS、数据库、镜像仓库或角色 |

平台 DNS 由平台模板从自身 ALB 的 DNSName/CanonicalHostedZoneID 派生；租户 API Alias 在这三个栈之外，指向 Cell ALB。买家 CDN/静态桶有独立前端栈，不随租户更新。独立 RDS 实例也不是此租户发布目标。禁止把“使用”理解为“可以随版本替换或删除”。

完整逻辑 ID、类型、参数/输出清单和三份模板的规范 JSON SHA 在 [机器基线](../ops/deployment-baseline/existing-tenant.template.json)。复用原 [平台模板](../ops/platform-ecs-v1/templates.mjs)、[Express Cell 渲染器](../lib/deployments/cloudformation/express-single-tenant-cell-v1.ts)和[租户渲染器](../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts)；机器基线指纹来自实际归档声明，**不把某个较早的渲染器默认输出当作已安装的模板**。

## 跨栈绑定与恢复差异

Cell 六个输出按同名参数传给租户，并非租户栈自己查找资源。`ClusterName` 供 Service 使用，`VpcId` 供目标组使用，`SubnetIds` 和 `TaskSecurityGroupId` 用于任务网络。归档对照中这四项一致。另两项决定三条租户规则挂在哪个监听器上，历史材料中已不一致：

| 引用（ARN尾段；前三数据列为历史） | 11月1日归档 Cell 输出 | 11月1日新租户建栈参数 | 11月6日手动恢复映射 | 本次A2独立核验的Cell输出 |
| --- | --- | --- | --- | --- |
| HttpsListenerArn / 443 | 77888e84c19e8b86 / 469c2b642a33bfc1 | 241081ab25c73320 / 8fce768af0ff42f7 | 706bcbbc89b8a673 / 9f91841ec135459f | 729e0854244ceff6 / 31e6577b666f0de1 |
| ControlListenerArn / 8443 | 77888e84c19e8b86 / bc69b195b69bc2d9 | 241081ab25c73320 / 576403dc1245139b | 706bcbbc89b8a673 / ae460cdac1f0e971 | 729e0854244ceff6 / 864f7b1cd42d3f8d |

上表的 A2 输出不是租户已接通的证明。A2 执行前 04:51:53.585Z 的租户参数仍为 241081 代；后来 B 执行虽已把两参数保存为 729e 代，三规则 CFN 物理引用仍旧代。**参数、CFN 记录和实际规则实体必须分开核验**，不得把创建时的 AVAILABLE 或参数对齐当修复成功。API Alias 在已存 B 预检中仍指向旧 ALB，本次修复没有写 DNS，现时解析未重查。

平台也经历 ALB `92d54a44479fbc3a → a33cd1f8bed33cba`，443 监听器 `0234243da966933a → 253cde394d05f108`；两条 Alias 曾被直接切到重建后的 ALB。重建监听规则会产生新物理 ID，Cell 自有拒绝规则与租户三规则须分别对应到各自栈。**同名、同标签、DNS 曾经工作均不能证明 CFN 已接管。**

初版离线阶段明确不调整 IAM。之后用户单独批准了[最小 IAM 修正](../ops/deployment-baseline/tenant-b-iam-review.json)，[安装结果](../ops/deployment-baseline/tenant-b-iam-installed-20261107.json)确认既有 policy 默认 v9→v10，保留 v7/v8/v9，仅新增两个准确新监听器规则前缀的 DescribeTags 读取覆盖；因长度上限去掉五个可选 Sid 标签，其余授权元素保持。它同时作为角色 identity policy 和 boundary，新读取覆盖持久保留，不是临时 grant。这是另批的范围扩展，不属于三栈资源归属或镜像更新，也不授权继续改 IAM。

平台归档模板仍声明 hosted-controller/ControllerLease 与 HostingExpiresAt；手工恢复采用关闭控制器的任务定义 :12，无新资源到期。不可拿旧平台模板整体覆盖实际服务或重新挂载控制器凭据。之前11月6日stop核对发现两台ALB均不存在，那是A2之前事实；本次只由CFN恢复并核验了Cell，平台ALB现状没有重新查询。表中的11月6日恢复映射是历史，**不能再当下次参数来源**；未来使用新输出仍须提交前匹配实际状态。本基线不判断数据库现在是否已停，也不改动stop锁、journal或工具配置。

证据来源：私有归档 `manual-environment-restore-20261101-a/inputs.json` 内两个父栈 Original 模板及 Cell Outputs；子栈用同期 `tenant-create-request.json` 的新建 TemplateBody/公开绑定，**不用已删除旧 UUID 的模板当新栈实况**；11月6日映射来自 `manual-environment-restore-20261106-b/journal.json`。原件位于 F 盘，不复制请求、完整参数、NoEcho 值或业务快照到 Git。[运行事实与已知漂移](aws-manual-test-environment-20261106.md)。

## 给下一次更新用的最小模板

镜像更新仍被阻断：先查明 B 失败并另审最小恢复，完成租户规则归属/绑定及单列 DNS 收敛核验，才可准备镜像更新。[监听器参数片段](../ops/deployment-baseline/tenant-listener-change.template.json)是既有 B 计划的输入，不是新的可执行命令；其创建和单次执行已发生，不得按旧[离线计划](../ops/deployment-baseline/tenant-b-offline-plan.json)再创建或重放。离线阶段的“未读取/任务定义物理 ID 未知”只适用于当时；后续已核对 CFN/服务引用均为 :12，不能重新当作当前缺口。Service 声明1、执行后实况0的差异仍保留，不自行改 Service 或 DependsOn。

[参数片段](../ops/deployment-baseline/tenant-image-change.template.json)按现有租户声明使用 `UsePreviousTemplate`，仅替换 `ImageUri`，其余 19 项均为 `UsePreviousValue`，不需要导出任何秘密值。镜像必须是同账号同区域指定仓库的新 SHA-256 digest，不能传 tag。此片段没有执行入口；不把监听器修复、DNS、平台任务、数据库迁移或角色改动夹带在版本更新里。

本地检查入口（Node 22.13+，JSON 模板正文；不是 CloudFormation API 的返回外壳）：

```powershell
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json bindings.json
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json bindings.json <旧镜像摘要URI> <目标镜像摘要URI>
```

`bindings.json` 仅需 `cellOutputs` 与 `tenantParameters` 两个对象，各含上述六个公开键及其字符串值；SubnetIds 为逗号分隔串。三个原模板核对资源清单、参数/输出名及完整规范内容摘要（对象键顺序无关，数组顺序保留）。任何模板差异需审查；绑定不匹配时拒绝生成版本草案。即便全部一致，结果仍是 **liveOwnershipVerified=false / executionAuthorized=false**。

**初版离线检查（历史事实）：** 本机三份归档模板与清单匹配；同一批已存输出/参数比对准确报出两项监听器差异，版本草案被拒绝。这是当时的保护结果，不是当前实况或云端修复完成证明。

**未来镜像发布条件（不是当前执行许可）：** 真正发布前，另审必要的只读核对：准确栈 UUID、Original、物理资源与运行引用（包括域名、规则、服务 revision 和镜像），确定恢复/收敛方式。若资源缺失、执行权限绑定陈旧或归属不明，单列修复范围；不直接重建、不以名称认领。只有重新证明归属与绑定一致并核实新镜像后，才可准备只针对租户的镜像 Change Set，审查预期任务定义新 revision 和服务更新、拒绝无关资源变化。GitHub environment 仍由用户本人批准。初版“未启动收费环境/未创建 Change Set”只描述初版离线阶段；后继另批的 ALB 恢复与 Change Set 创建/执行已发生，不能继续写作当前事实。

## 历史阶段索引（只追溯，不重放）

| 阶段 | 当时结果与证据 |
| --- | --- |
| 初版离线基线 | `e2fb780`，仅声明/历史绑定对照，无云调用；不是后续云操作授权 |
| A1 创建 → 执行 | [仅创建结果](../ops/deployment-baseline/cell-a1-created-20261106.json)、[单次执行及独立核验](../ops/deployment-baseline/cell-a1-executed-20261106.json)；四项失效声明移除，十二项保留，属于已完成中间态 |
| A2 创建 → 执行 | [仅创建结果](../ops/deployment-baseline/cell-a2-created-20261107.json)、[单次执行及独立核验](../ops/deployment-baseline/cell-a2-executed-20261107.json)；Cell 恢复四项声明/两输出，不等于租户/API 恢复 |
| B 预检 → IAM 修正 | [05:22Z 预检](../ops/deployment-baseline/tenant-b-preflight-20261107.json)、[v10 安装](../ops/deployment-baseline/tenant-b-iam-installed-20261107.json)；当时三旧规则缺失、参数仍旧代；IAM 修正已另批完成，不再待批 |
| B 仅创建 | [95855d02… 创建结果](../ops/deployment-baseline/tenant-b-created-20261107.json)，当时为 AVAILABLE/三规则替换，无 Service 等变化；不是现在仍可执行的证明 |
| 旧 B 执行清单过期 → 新只读刷新 | [过期停止](../ops/deployment-baseline/tenant-b-execution-expired-20261107.json)、[另批刷新](../ops/deployment-baseline/tenant-b-execution-refresh-20261107.json)；旧清单未执行，原事实/期限未改写，随后另批新 SHA |
| B 单次执行 → 独立检查 | [失败/部分状态结果](../ops/deployment-baseline/tenant-b-execution-inspected-20261107.json)；执行槽已消费、未验收，不重放 |
| B 单次失败事件读取 | [用户另允的查因结果](../ops/deployment-baseline/tenant-b-failed-events-observed-20261107.json)，STS1＋DescribeEvents1，确认禁用回滚与替换型更新不兼容；无写入/实际修复，唯一后继方向见顶部 |

完整分阶段审批、原 SHA/期限与失败记录继续保留在[修复沿革](aws-cell-listener-ownership-repair.md)、执行手册/主线的折叠历史及 Git 历史中；本次未修改任何机器清单、模板、执行回执、私有原件或永久槽。历史中的“下一步/待批准/尚未执行”只适用于当时，不覆盖顶部状态，也不能作为重放入口。
