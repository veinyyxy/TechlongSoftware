# 既有租户版本更新：三栈资源基线

2026-11-06，账号 402010193138 / ca-central-1。这里的“正式基线”指后续发布所遵守的**声明归属**，不是新生产环境或可执行部署包；初次整理为离线，后继实际云结果在下方明确标注。已验证的现有 sandbox 不等于任意租户。买家商品列表、登录、查看订单及卖家端所测功能由用户确认正常，不列为工程待测项。

## 哪个栈负责什么

**最新已验证Cell实况：** [A2已执行并独立核验](aws-cell-listener-ownership-repair.md#最新结果a2-已执行并独立核验cell-四项归属恢复)，2026-11-07T04:55:14.610Z时为UPDATE_COMPLETE/16项，Original SHA与机器基线Cell目标一致；原十二物理ID保持，新ALB/两监听器/共享拒绝规则由同一Cell管理，两个输出已恢复。A1十二项/ALB缺失是之前中间态，不再是本次最新结果。只证明约定四项及属性，不称全部保留属性/平台/租户都无漂移。新物理ID、输出、ALB DNS与zone见[实际结果](../ops/deployment-baseline/cell-a2-executed-20261107.json)，下一只离线准备租户B收敛，镜像更新仍不得开始。

| 栈（现有名称） | 声明归属 | 不归它管理 |
| --- | --- | --- |
| 平台 `techlong-sandbox-platform-hosting-v1`，11 项 | 平台 Cluster、TaskDefinition、Service、LogGroup；ALB、443 Listener、目标组、两个安全组、TaskIngress、console 域名 A Alias | 所用 VPC/子网、证书、Web 数据库与执行角色。平台执行角色/boundary 在独立 access 栈；不属于平台版本更新 |
| 共享 Cell `techlong-sandbox-cell-sandbox-1`，16 项 | VPC、IGW/attachment、两个公网子网、路由表/默认路由/两个子网关联；任务和 ALB 安全组；集群、ALB、443 业务与 8443 mTLS 监听器、共享业务拒绝规则 | Express 数据库是外部依赖；不能把 Full 配置的 DB 子网组、集群或 writer 加回。证书和 trust store 也是输入 |
| 租户 `techlong-sandbox-tenant-9c5ee9e64509dcad`，7 项 | 租户 Service、TaskDefinition、LogGroup、目标组、两条 443 规则（业务和拒绝控制路径）、一条 8443 控制规则 | 不拥有集群、监听器、租户 API DNS、数据库、镜像仓库或角色 |

平台 DNS 由平台模板从自身 ALB 的 DNSName/CanonicalHostedZoneID 派生；租户 API Alias 在这三个栈之外，指向 Cell ALB。买家 CDN/静态桶有独立前端栈，不随租户更新。独立 RDS 实例也不是此租户发布目标。禁止把“使用”理解为“可以随版本替换或删除”。

完整逻辑 ID、类型、参数/输出清单和三份模板的规范 JSON SHA 在 [机器基线](../ops/deployment-baseline/existing-tenant.template.json)。复用原 [平台模板](../ops/platform-ecs-v1/templates.mjs)、[Express Cell 渲染器](../lib/deployments/cloudformation/express-single-tenant-cell-v1.ts)和[租户渲染器](../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts)；机器基线指纹来自实际归档声明，**不把某个较早的渲染器默认输出当作已安装的模板**。

## 跨栈绑定与恢复差异

**B当前只读结果：** [准确事实](../ops/deployment-baseline/tenant-b-preflight-20261107.json)于05:22Z重新核对租户Original/七项CFN记录和两参数仍241081；三旧规则实体实际缺失，729e新监听器的所需优先级空闲。CFN任务定义物理ID和服务引用均:12，服务仍0/0/0、声明1的漂移未改，不能把“CFN记录CREATE_COMPLETE”说成全部实体存在。现行IAM v9的规则DescribeTags路径和API Alias均未对齐；下一只待[单次最小IAM修正](aws-cell-listener-ownership-repair.md#待批准仅现有-iam-policy-一次版本更新)准确批准。三规则计划、DNS和镜像均未写，旧离线阶段的“未读取/未知”保留追溯，不能替代这一新结果。

Cell 六个输出按同名参数传给租户，并非租户栈自己查找资源。`ClusterName` 供 Service 使用，`VpcId` 供目标组使用，`SubnetIds` 和 `TaskSecurityGroupId` 用于任务网络。归档对照中这四项一致。另两项决定三条租户规则挂在哪个监听器上，历史材料中已不一致：

| 引用（ARN尾段；前三数据列为历史） | 11月1日归档 Cell 输出 | 11月1日新租户建栈参数 | 11月6日手动恢复映射 | 本次A2独立核验的Cell输出 |
| --- | --- | --- | --- | --- |
| HttpsListenerArn / 443 | 77888e84c19e8b86 / 469c2b642a33bfc1 | 241081ab25c73320 / 8fce768af0ff42f7 | 706bcbbc89b8a673 / 9f91841ec135459f | 729e0854244ceff6 / 31e6577b666f0de1 |
| ControlListenerArn / 8443 | 77888e84c19e8b86 / bc69b195b69bc2d9 | 241081ab25c73320 / 576403dc1245139b | 706bcbbc89b8a673 / ae460cdac1f0e971 | 729e0854244ceff6 / 864f7b1cd42d3f8d |

本轮执行前04:51:53.585Z的租户DescribeStacks仍读到上述241081参数，来源及准确值已收入A2结果，未当作执行后重查；Cell新输出不能直接冒充租户已更新。三规则实体、其余跨栈参数和权限路径仍需B阶段准确核对，本轮未修改租户或API DNS。

平台也经历 ALB `92d54a44479fbc3a → a33cd1f8bed33cba`，443 监听器 `0234243da966933a → 253cde394d05f108`；两条 Alias 曾被直接切到重建后的 ALB。重建监听规则会产生新物理 ID，Cell 自有拒绝规则与租户三规则须分别对应到各自栈。**同名、同标签、DNS 曾经工作均不能证明 CFN 已接管。** 既有租户执行角色的规则 ARN 限制也需比对，本轮不调整 IAM。

平台归档模板仍声明 hosted-controller/ControllerLease 与 HostingExpiresAt；手工恢复采用关闭控制器的任务定义 :12，无新资源到期。不可拿旧平台模板整体覆盖实际服务或重新挂载控制器凭据。之前11月6日stop核对发现两台ALB均不存在，那是A2之前事实；本次只由CFN恢复并核验了Cell，平台ALB现状没有重新查询。表中的11月6日恢复映射是历史，**不能再当下次参数来源**；未来使用新输出仍须提交前匹配实际状态。本基线不判断数据库现在是否已停，也不改动stop锁、journal或工具配置。

证据来源：私有归档 `manual-environment-restore-20261101-a/inputs.json` 内两个父栈 Original 模板及 Cell Outputs；子栈用同期 `tenant-create-request.json` 的新建 TemplateBody/公开绑定，**不用已删除旧 UUID 的模板当新栈实况**；11月6日映射来自 `manual-environment-restore-20261106-b/journal.json`。原件位于 F 盘，不复制请求、完整参数、NoEcho 值或业务快照到 Git。[运行事实与已知漂移](aws-manual-test-environment-20261106.md)。

## 给下一次更新用的最小模板

当前先完成[租户B两监听器参数／三规则收敛](aws-cell-listener-ownership-repair.md#当前准备b-两参数三规则离线方案已完成)。新[监听器参数片段](../ops/deployment-baseline/tenant-listener-change.template.json)只使用A2已核验729e输出，其余18参数保留；[离线计划](../ops/deployment-baseline/tenant-b-offline-plan.json)记录Service声明1与已存实况0的差异、CFN任务定义物理ID未知及待核IAM路径，不把三规则形状匹配当执行证明。片段未应用，无新Change Set或生产读取；B及单列DNS收敛验证前，下列镜像片段仍不得执行。

[参数片段](../ops/deployment-baseline/tenant-image-change.template.json)按现有租户声明使用 `UsePreviousTemplate`，仅替换 `ImageUri`，其余 19 项均为 `UsePreviousValue`，不需要导出任何秘密值。镜像必须是同账号同区域指定仓库的新 SHA-256 digest，不能传 tag。此片段没有执行入口；不把监听器修复、DNS、平台任务、数据库迁移或角色改动夹带在版本更新里。

本地检查入口（Node 22.13+，JSON 模板正文；不是 CloudFormation API 的返回外壳）：

```powershell
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json bindings.json
node scripts/check-deployment-baseline.mjs platform.json cell.json tenant.json bindings.json <旧镜像摘要URI> <目标镜像摘要URI>
```

`bindings.json` 仅需 `cellOutputs` 与 `tenantParameters` 两个对象，各含上述六个公开键及其字符串值；SubnetIds 为逗号分隔串。三个原模板核对资源清单、参数/输出名及完整规范内容摘要（对象键顺序无关，数组顺序保留）。任何模板差异需审查；绑定不匹配时拒绝生成版本草案。即便全部一致，结果仍是 **liveOwnershipVerified=false / executionAuthorized=false**。

**本轮实测：** 本机三份归档模板与清单匹配；同一批已存输出/参数比对准确报出两项监听器差异，版本草案被拒绝。这是预期的保护结果，不是云端修复完成。

**继续条件：** 真正发布前，另审必要的只读核对：准确栈 UUID、Original、物理资源与运行引用（包括域名、规则、服务 revision 和镜像），确定恢复/收敛方式。若资源缺失、执行权限绑定陈旧或归属不明，单列修复范围；不直接重建、不以名称认领。只有重新证明归属与绑定一致并核实新镜像后，才可准备只针对租户的镜像 Change Set，审查预期任务定义新 revision 和服务更新、拒绝无关资源变化。GitHub environment 仍由用户本人批准；此阶段没有启动收费环境或创建 Change Set。
