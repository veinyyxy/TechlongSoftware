# M1：首轮 Cell 专属权限待审包

2026-10-13 America/Winnipeg，继续 [D001 主线](./aws-auto-deployment-single-tenant-acceptance.md)。本轮集中完成真实 Cell 权限和管理员输入，不重启 F3c9，不新增探针系列。**只完成审阅准备，没有安装权限或部署 Cell；M1 尚未完成。**

## 待批准的准确三写

账号 `402010193138`，Cell 区域 `ca-central-1`，执行者准确 Source IAM User `techlong-sandbox-dev`。三个 API 均为新对象，不修改现有角色/策略，也不创建 service-linked role：

| 顺序 | 写调用 | 对象及约束 |
| --- | --- | --- |
| 1 | IAM CreatePolicy | 新 `TechlongSandboxFirstAcceptanceCellExecutionBoundary`，初始 v1，2724 字节的明确 action 上限 |
| 2 | IAM CreateRole | 新 `TechlongSandboxFirstAcceptanceCellExecutionRole`，绑定上述 boundary，CloudFormation-only trust、3600 秒 session、五项 ownership 标签，初始无身份权限 |
| 3 | IAM PutRolePolicy | 新角色的 `FirstAcceptanceCellResourcesV1`，9135 字节资源/条件限定的 inline identity policy |

Boundary 的 `Resource:*` 是能力上限，**自身不授予角色权限**；实际允许来自限定 identity policy。保留较长资源条件，而非为了 managed policy 6144 字节限制扩大 identity ARN。身份 inline policy 在 role 总配额 10240 字节内；本新角色不得有其他 inline 或 attached policy。

允许新 Cell 的网络、ECS Cluster、准确名称 ALB/listener/rule、准确 Aurora cluster/writer/subnet group 和准确 postgres log group 的必要创建、配置、正常删除；保留只读 provider metadata。网络尚无生成 UUID，以五项 ownership 标签和账号/区域命名空间限定；listener/rule 在复用模板中未打标签，以 named-parent ARN 限定，不声称不存在的 tag 门禁。默认 AWS-managed RDS/Secrets Manager Key 只引用实际读回 ARN；托管 master Secret 仅允许 `rds!cluster-*` 命名空间的创建/打标签，不允许读值或删除。

不包含 IAM 写/PassRole、ECS RunTask/CreateService、Secret 值读取/删除、snapshot/restore/replica/global、VPN/NAT/Cognito/log delivery、F3c9 或 Scheduler 权限。**这些 Cell 创建/删除能力安装后为 active，不是临时 grant，也不会自动撤权。** 这份批准只准安装，不准使用它创建或删除 Cell。

## 当前清单和有效期

- Manifest SHA：`fe97071fa8ff7562f7e7174bce4c41da86e135dc2ad50bff371a437914bae6a2`
- 生成：2026-10-13 **18:28:33.838 UTC / 13:28:33.838 CDT**。
- 截止：2026-10-13 **19:28:33.838 UTC / 14:28:33.838 CDT**。过期只刷新只读清单，不据旧批准执行。
- Material SHA：`4d7d1712e914a7b4d7cc4e227a97761318585396893f5fab0d31b11f091e9faf`。
- 四源码 LF-normalized binding：`e7f9f20e1fbfc922a340bba749d5bf3a85f0b14516bcb0ba7546cff2ce8830cf`。
- 私有原件：`F:/ChatGPT_workshop/techlong-d001-cell-iam-20261013-r2/manifest.json`，文件 SHA `5fe467cb4ac349f37c1f20a4e2a28192a98f265b24bcccf876ea1d23ce50ccb7`。完整策略、库存和官方验证保留同目录，不覆盖 r1。

`review-single-tenant-cell-iam.ts` 提供 Review / Run / Inspect。Review 无云写；Run 需要 exact SHA、当前 code binding、有效期和重新取得的 30 秒内完整库存，确认对象仍不存在。通过后才消费固定永久槽 `F:/ChatGPT_workshop/techlong-d001-cell-iam-install.permanent-slot.json`；本轮槽未创建/消费。每次实际 API 写前再次检查准确 Source、时限；SDK maxAttempts=1、禁用自定义配置端点。槽消费后即使未写或只写了一部分也不自动复位/补齐/重试。

Run 保存 PolicyId/RoleId 和分步回执、实际 API 调用数。成功提交后用**另一进程** Inspect，绑定原 run report/manifest/slot、实际 ID、准确 trust/boundary/v1/inline、role session/tags 和无额外 policy。Inspect 不执行写，也不把响应成功当部署完成。部分/不确定 Run 不能进入“完整已安装”的 Inspect 结论，需要先独立只读人工核对新 boundary/role/inline；不自动补偿、删除或重放。Run 内 `writeStagesEntered` 是进入阶段数，不冒充 AWS 调用数。

## 必须接受的完整风险

1. 安装后暴露 active 付费 Cell 能力；不代表批准付费部署。IAM 不强制全部模板参数、ACU 上限或 50 USD 月预算，50 USD 仍是目标而非硬 cap。
2. Boundary 星号是明确动作上限，identity 的部分 metadata 读取必须 Resource 星号。新网络未知 ID 的标签围栏不是 immutable UUID 权限围栏，不能杜绝并发或同标签资源。
3. RDS-managed master Secret 创建/打标签的命名空间比未来准确 UUID 宽；没有值读取/删除权限，也没有证明未来 provider 调用成功。
4. Trust 允许 CloudFormation 服务，不证明只有某条 Source-forwarded 路径可以使用；拥有相应 PassRole/CFN 权限的其他主体仍可能使用该角色。这里不新增任何主体 PassRole。
5. 三写非原子、非跨服务 CAS；传播、并发、响应丢失或登录自动刷新失效可能留部分 IAM。RoleId 检查不消除按 RoleName 写 inline 的竞态。失败后不自动删、撤权、rollback、补齐、复位或写重试。
6. IAM policy validation / simulation 只是形状和指定 Source 安装动作的只读证据，不证明实际 Cell 创建、正常删除、provider 行为、服务就绪或预算达成。接受低成本但非绝对零费用；本安装不创建收费 Cell。

上述与 manifest 八项风险一致。未来 Cell/DB/Secret/DNS/activation/清理范围各须 fresh 具体批准，不包含在本 SHA。

## 真实只读核验与业务输入

**18:28:31.812 UTC** 新库存：准确 Source 身份通过，新 role/boundary 不存在，RDS/ECS/ELB 三个 service-linked role 已存在，两个默认 AWS-managed Key 均 Enabled。指定 Source 的实际三个安装 action/resource 配对模拟均 allowed；这不是完整有效权限证明，仍可能受 SCP/服务规则影响。两份 AWS Access Analyzer ValidatePolicy 返回 findings 空数组（error/warning 均零）。

r1 保存了原模拟结果解析错误：AWS 按 action 聚合成三行，而非按全部 action×resource 返回六行；无效资源类型交叉配对 implicitDeny 不是实际安装 deny。修正为严格核对三个真正安装配对，新增拒绝缺项/合法配对 deny 的检查；不扩大策略、删除旧记录或消费执行槽。

Neon **18:10:14.617 UTC** 只读确认两位 active 管理员、产品 active、一个 active plan；**18:15:56.081 UTC** 该 plan 关联已发布 schema-v2 模板（23 字段）。现有 planner 按真实 environment.kind 选择 AWS driver，不需要为 template metadata 的 manual 字样复制或改写已发布版本。未读客户 configuration/password。

用户指定管理员邮箱后，**18:27:46.185 UTC** 独立 Serializable READ ONLY、`transaction_read_only=on`，精确匹配到唯一 active platform admin。不会因与预算邮箱拼写不同替换；归属人仅用于待审业务材料，邮箱/用户 ID 留本地私有回执，不写入公开 capsule。未创建 workspace/subscription/app/deployment/job，旧隔离计划/实例/订阅保留。

后继业务包采用新独立 sandbox workspace、复用实际 active plan/schema-v2，拟业务地址 `first-acceptance.sandbox.techlong.cloud`（候选，未核对/写 DNS）；configuration 仍需安全验证，Neon policy 的 1000→5000 cents、执行绑定和新业务行需另批，apply 保持关闭。无需支付/客户订单写入。先完成本三写和独立回读，再集中收尾 live guard/journal/readiness、控制签名与输入、准确 Cell/DNS/收费及清理审阅后推进 M2，不返回 F3c9。

## 验证与交接

8 项新 IAM 检查 + 5 项相邻 Cell 检查共 13 项通过；typecheck、定向 lint 零警告通过。F3c9 全部 132 源码 pins 按原 UTF8/LF 规则复核一致。后端镜像/SQL/admission 不改，不启动 Docker，不重建镜像。摘要见 [本轮 capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.cell-iam.json)。本轮云/DB写、Secret值读取、Invoke、收费资源创建、永久槽消费均 **0**。

权限依据：[EC2](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ec2.html)、[RDS](https://docs.aws.amazon.com/service-authorization/latest/reference/list_rds.html)、[ECS](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecs.html)、[ELBv2](https://docs.aws.amazon.com/service-authorization/latest/reference/list_elbv2.html)、[Logs](https://docs.aws.amazon.com/service-authorization/latest/reference/list_logs.html)、[Secrets Manager](https://docs.aws.amazon.com/service-authorization/latest/reference/list_secretsmanager.html)、[RDS 托管 master Secret](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-secrets-manager.html)、[RDS storage key](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.Keys.html)。官方声明按实际模板属性筛选，不全盘授予 provider 通用动作。
