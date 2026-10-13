# M1：Cell 专属 IAM 已安装并独立核验

2026-10-13 America/Winnipeg，继续 [D001 主线](./aws-auto-deployment-single-tenant-acceptance.md)。用户明确批准 [三写清单和完整风险](./aws-auto-deployment-single-tenant-m1-cell-iam.md) `fe97071fa8ff7562f7e7174bce4c41da86e135dc2ad50bff371a437914bae6a2` 后，执行成功，另一进程只读验收通过。**只安装 IAM；没有部署 Cell、写数据库、读取 Secret 值或启用运行时。M1 尚未完成。**

## 实际执行与独立事实

永久槽于 **18:36:51.206 UTC / 13:36:51.206 CDT** 消费。原清单有效期、四源码 binding、准确 Source Account/ARN/UserId、最新完整查空库存和三个实际安装 action/resource 配对通过，随后仅执行以下三次 IAM API，无 SDK 写重试：

1. `CreatePolicy`：`TechlongSandboxFirstAcceptanceCellExecutionBoundary`，准确 PolicyId `ANPAV3GNMXTZL4VMJHXXZ`，初始默认 v1。
2. `CreateRole`：`TechlongSandboxFirstAcceptanceCellExecutionRole`，准确 RoleId `AROAV3GNMXTZESNMKM56K`，绑定上述 boundary，CloudFormation-only trust、3600 秒 session、五项 ownership tags。
3. `PutRolePolicy`：新角色的 `FirstAcceptanceCellResourcesV1`，准确受审资源/条件限定 inline policy。

Run 返回 `IAM_SUBMITTED_REQUIRES_INDEPENDENT_INSPECT`，`awsWriteApiInvocations=3`，没有进入 Cell 创建或其他变更。执行过程中保存 RoleId/PolicyId 和分步回执；没有把名字当作唯一身份，也没有在 slot 消费后再次 Review/Run。

**18:37:01.667 UTC / 13:37:01.667 CDT**，独立新进程 Inspect 返回 `IAM_INDEPENDENTLY_VERIFIED_NO_CELL`，12 项检查全部 true：原 slot/binding、RoleId 和 PolicyId 对应原 Run、准确 role/boundary ARN、session/tags、trust、默认 v1 boundary document、inline document、仅一条准确 inline、无 attached policy。Inspect 云写为 0。这是该时刻的安装回读证据，不是后续权限永久不变、provider 创建成功或租户 ready 的证明。

**角色权限已为 active，非临时 grant，没有自动撤权。** 安装批准没有扩展到实际 Cell 创建/删除；IAM 不强制所有模板参数、ACU 或 50 USD 目标。网络未知生成 ID 的标签围栏、master Secret 命名空间和 CloudFormation 服务信任等原限制/风险保持，不能冒称 UUID 或单一 Source-forwarded 路径权限证明。

## 回执和不可重放约束

| 本地私有记录 | 文件 SHA256 |
| --- | --- |
| `F:/ChatGPT_workshop/techlong-d001-cell-iam-run-20261013-fe97071f/run.json` | `b5a1a656d40375b8c9ee4cc759b4e48e2d9e862f611648f62cb3b6584656a696` |
| `F:/ChatGPT_workshop/techlong-d001-cell-iam-inspect-20261013-fe97071f/inspect.json` | `5ed1768d796711ab8e2de5d125df1ebc1309de9ed21087f3fe1532bfcdc1c591` |
| `F:/ChatGPT_workshop/techlong-d001-cell-iam-install.permanent-slot.json` | `c6f26d4bda7e5d7f1ed16fecb9c87e24d238e043e65a9e6c4f0a19a3642afc8f` |

Code binding 保持 `e7f9f20e1fbfc922a340bba749d5bf3a85f0b14516bcb0ba7546cff2ce8830cf`，material `4d7d1712e914a7b4d7cc4e227a97761318585396893f5fab0d31b11f091e9faf`。原 r1/r2、批准、分步记录和永久槽保留；不复位、不换槽重放本安装，不自动回滚/补齐/删除。未来需要修改这两个新对象也须按新的具体范围审阅，不把它们当未创建对象再次执行三写。

源码未变，本次依赖上一阶段 13 项定向/相邻检查、typecheck、lint 及本次真实 AWS 独立回读，不重跑数据库模拟、镜像构建或完整历史测试。冻结 F3c9 132 pins 仍保持；后端仅交接文档，用户 `.vscode/settings.json` 未纳入提交。非秘密摘要见 [installed capsule](../ops/aws-sandbox/reviews/single-tenant-acceptance-m1.cell-iam-installed.json)。

本次实际 IAM/云写 **3**、数据库写 **0**、Secret value read **0**、Lambda invoke **0**、付费 Cell 创建/删除 **0**、新永久槽消费 **1**；不修改已有其他 IAM。新 boundary/role 两个对象和该角色 inline 已安装。

## 下一主线：集中收尾 M1，再进入 M2

不再扩展 F3c9，也不制作新的 IAM 探针代际。下一包收尾一个新独立 sandbox 租户的实际 configuration/业务行及 50 USD Neon policy 审阅、control 安全来源、live approval guard/journal/cleanup-readiness。管理员归属已精确核实；复用已有镜像、baseline 和 active plan 的 published schema-v2，保留旧隔离实例/订阅/计划，不修改已发布模板。

真实 Cell 必须另有 fresh 清单：准确模板/参数、这次实际角色身份、Source PassRole/CFN 范围、成本估算、CFN rollback 与原 UUID 有序清理/人工接管、ALB 对应业务 DNS Alias。Cell 输出后再核对实际 endpoint/managed Secret/key/task revision，并合法登记执行/activation 材料，不编造 ARN、不提前修改 apply_enabled 或 prepared root 的 false。50 USD/月目标不保证常驻总费用不超过 50 USD。此安装结论不授权任何上述云/DB/Secret/DNS/删除操作。
