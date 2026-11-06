# Cell 与租户监听器归属修复方案（离线草案，不可执行）

目的：恢复既有 CloudFormation 管理关系，不发布镜像、不启动业务服务。只涉及 ca-central-1 的共享 Cell 和准确租户；不是平台 ALB 修复。**本页不是执行授权，也没有创建 Change Set。** [三栈基线](aws-deployment-baseline.md)继续保留作修复前对照。

## 起点与取舍

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
