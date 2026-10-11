# F3b3：最小 KMS 读取修正已执行，实机读取与日志核验通过

2026-10-11 Winnipeg。用户明确确认清单 `5d1485cf6d9a36bee3da8546124c2d02cf99339c02dfe47aa0e9ceefc47baca6` 后，在有效期内一次 Run 完成 **4 次 IAM 写、2 次新同步只读探针**。Run 后 Inspect 与另一个新进程 Inspect 均返回 `KMS_REPAIR_SECRET_READS_AND_LOGS_VERIFIED`，`iamRepairVerified=true`、`liveReadProofVerified=true`。

**本阶段完成的是只读 Secret/KMS 路径，不是自动部署上线。** 业务 runtime 仍关闭；不连接 Neon、不写 authority、不安装删除权限、不创建付费 Cell/ECS、不改函数代码或配置、Key/Key policy、Secret/版本。50 USD/月仍是预算目标，不是硬上限。

## 实际更新与保留项

| 现有角色 | boundary 当前默认版本 | 原版本 | inline 当前状态 | 实机 Secret 读取 |
| --- | --- | --- | --- | --- |
| TechlongSandboxCellTtlExecutorRole / AROAV3GNMXTZLB4NZQLZY | TechlongSandboxCellTtlExecutorBoundaryV3 / v2 | v1 保留且文档不变 | RuntimeReadOnlyV3 / OWN_REPAIRED | 固定初始 UUID + AWSCURRENT 通过 |
| TechlongSandboxCellDrainCoordinatorRole / AROAV3GNMXTZPRETOTXTS | TechlongSandboxCellDrainCoordinatorBoundaryV1 / v2 | v1 保留且文档不变 | RuntimeReadOnlyV1 / OWN_REPAIRED | 固定初始 UUID + AWSCURRENT 通过 |

各一次 CreatePolicyVersion(SetAsDefault=true)、PutRolePolicy，共 4 次，无 DeletePolicyVersion/SetDefaultPolicyVersion/角色或标签变更。两次读回均为 `OWN_V2 / OWN_REPAIRED`，原 v1、信任、RoleId、标签、函数 ZIP/RevisionId/配置、日志 7 天保留、Secret 初始版本和 managed Key policy 全 anchor 保持。

修正仅允许准确 AWS-managed Key `arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570` 的 Secrets Manager ca-central-1 转发 Decrypt，强制 CallerAccount、各自 Secret ARN、各自固定初始 UUID，并保留 region 拒绝。wrong/missing 条件各自独立显式拒绝；直接 Secret 读取的准确来源函数/region/AWSCURRENT、DDB/CF/日志范围与其他动作拒绝仍保持。完整已批准策略范围见[准备时清单](./aws-auto-deployment-fast-track-f3b3-kms-read-repair.md)。没有追加通用 KMS/Secret 权限。

## 两次实机探针与独立日志证明

写入后按原清单等待 20 秒，然后每次调用前重读全 anchor；等待本身不保证 IAM 传播，但这两次实际调用证明已批准正向读取路径成功。

| 探针 | requestId | 实际读取结论 | 完整响应 canonical SHA |
| --- | --- | --- | --- |
| TTL-v3 | b9fca63c-1d0d-4576-a8f2-43414efa59b4 | 身份、自身固定 Secret、DDB、CF 读取均通过 | db92125951bd1c9e78d0263395be2a47fc127b7abdbd6b370535367b31ae1817 |
| drain | d9d6e128-7985-400c-9770-3ce048663913 | 身份、自身固定 Secret、provision authority 读取均通过 | 0ba3a321b4188ad3de614de9771a481bf38e5a6ecad0bfcb0fe1ec1f6e503036 |

两响应均为 `READONLY_PROBE_READS_VERIFIED`，`runtimeEnabled=false`、`databaseConnected=false`、`mutationPerformed=false`。Secret 只在各自 Lambda 内存校验，Source 不 GetSecretValue；没有 SecretString、密码、数据库 URL 或原始 Invoke/provider 日志持久化到本地/Git。

TTL 的两 authority key、intent/receipt journal 与 Cell 的 Describe/GetTemplate/ListResources 仍观察为 ABSENT；ListStacks 是 FIRST_PAGE_READ。drain provision authority 仍 ABSENT。这证明了现有只读路径，不证明真实 Cell 存在时完整 CF 读取、密封 v3 drain 业务兼容、到期清理或端到端部署。

两次独立 Inspect 起点：

- **2026-10-11 15:07:59.154 UTC / Winnipeg 10:07:59.154 CDT**：Run 后只读 Inspect。
- **2026-10-11 15:08:29.999 UTC / Winnipeg 10:08:29.999 CDT**：新进程只读 Inspect，不追加 Invoke。

两次均在各日志组第 3 页找到准确 functionArn/requestId/nonce/完整响应 SHA，`logMarkerVerified=true`，不是以无日志响应或另一轮调用代替。最终 anchor SHA 仍 `139ed0f461a676de2ff450f1bd2311a53997d960488b7ca97f0e0708a47a6dd5`；Key policy SHA 仍 `7c8b6b20a7a9a74535e08954eb2cf5435f71cd442a39596e1ea60e43dd631b51`。

Inspect 中 `sourcePermissionsAllowed=false` / `sourcePermissions=[]` 表示该模式不重跑写/调用权限模拟，不是观察到 Source 权限被拒绝；Run 的前置核验已执行相应检查。最终成功判定使用准确 IAM/anchor 和两份既有响应/日志，不依赖该字段。

## 留存证据与禁止重放

私有根目录 `F:/ChatGPT_workshop/`：

| 文件 | 文件 SHA256 |
| --- | --- |
| techlong-f3b3-readonly-kms-repair-20261011-r3-run/submission-receipt.json | 90987b5460a21dea2affba831078b856e9874d67fa286f77d2d17c329cf0325c |
| techlong-f3b3-readonly-kms-repair-20261011-r3-run/independent-inspect.json | 13d7b6ba59885f187c28c79d1c9084a78de1620d5ad1fef17dcc61fb18b521e2 |
| techlong-f3b3-readonly-kms-repair-20261011-r3-verify/independent-inspect.json | 7a7ac97a3f6fbd69dee36e24d8e2f9c6947fe4b1132b126284c9002f31e888dd |

新永久槽位 `techlong-f3b3-readonly-kms-read-repair-v1-consumed` 已消费；4 个写入 attempt/confirmed 和 2 个 Invoke attempt/response 全部保留。**不再 Run、不补调、不自动撤权/删除/回滚/补齐/reset 或写/调用重试。** 新 v2 和 inline 保持已批准读取范围，并非临时删除 grant，未自动撤销。旧 IAM/Secret/Neon/Lambda 安装槽位、旧拒绝记录与准备文件均保留。

新 8 文件 code binding `f382bda1dd4e7401f485e95941cbae64a0956220de1d2e5d30a5cdf1e3be2222`、原 10 文件 `064119b9576e1dd5beb73900ec1290f7bed28204905f989ea03be30bf83b7d7d` 未改。旧 Lambda 安装 Inspector 绑定原 IAM foundation，不能再用其旧基础状态判定当前 v2 修正；后续只读用本次 KMS Inspect，不能改旧 binding 后重放。

## 下一小阶段

准备**受限 Neon TLS 只读连通性与密封 v3 数据源验收**的准确探针代码/范围：复用已核验的自身固定 Secret，不改凭据/IAM/业务数据，不开启 drain 写入或 DeleteStack。先核对现有生产 source-v3 接线与单次只读响应，再把必要函数更新/新调用列入新的 fresh SHA 批准；本次批准不包含新函数代码、Neon 连接或额外 Invoke。

随后收敛业务 drain/TTL 安装、真实 Cell/provision authority 前提、baseline、DNS/mTLS 和付费 Cell 单租户验收清单。无 Cell/前驱/到期 draining/zero/raw witness 时不能生成假 authority；不能把这两份只读成功回执当 mutation/部署授权。保持业务 runtime off，新增权限、云部署、调用或数据库写均继续按具体范围单独批准。
