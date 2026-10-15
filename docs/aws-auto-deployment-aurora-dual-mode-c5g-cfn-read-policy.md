# C5g：既有 CFN 策略最小读取差异与单次安装入口

2026-10-15 America/Winnipeg。继续首轮真实交付的权限前置，不重开 Grant、日志模拟、SQL 恢复或 F3c9 支线。

**代码已实现，当前只有草案；没有 fresh 执行清单，也没有安装权限或部署。** 新的在线 Review 被工具安全审批拦截，进程未启动；本轮 AWS 调用、IAM/业务写入、私密包或 Secret 值读取、SQL、job/TTL、永久槽消费均0。完整交付执行根仍未完成。

## 最小差异

仅拟更新现有 `arn:aws:iam::402010193138:policy/TechlongSandboxCloudFormationExecutionBoundary`（PolicyId `ANPAV3GNMXTZOQPIXOKJ4`）。它同时是准确 `TechlongSandboxCloudFormationExecutionRole` 的 attached policy 与 boundary；必须先实时证明两类消费者都只有该角色（RoleId `AROAV3GNMXTZKHYBCRSOE`），不能凭历史假定。

保留原 v7 完整文档及全部历史 statement，追加六条 Allow、八个读取 action；每条都限定 `aws:RequestedRegion=ca-central-1`：

| action | 新增资源范围 |
| --- | --- |
| ecs:ListServiceDeployments | 准确 `cell-sandbox-1/tenant-9c5ee9e64509dcad-ecs-service` service ARN |
| ecs:DescribeServiceDeployments | 同一 service ARN 及该 service 的 deployment ARN 后缀 |
| elasticloadbalancing:DescribeTargetGroupAttributes / DescribeTargetHealth / DescribeTags | 准确 `tenant-9c5ee9e64509dcad-target-g/*` |
| elasticloadbalancing:DescribeTags | 现有业务及控制两个准确 listener 下的 rule ARN 后缀 |
| logs:GetDataProtectionPolicy | 准确 tenant log group 的 base / `:*` 两种 ARN 形式 |
| logs:DescribeIndexPolicies / DescribeResourcePolicies | `Resource:*`，只限上述区域；不能声称只限一个日志组 |

此处纠正 C5f 原始预检的两个资源范围假设：`DescribeServiceDeployments` 还需 service ARN；`DescribeIndexPolicies` 不支持按单个日志组授权。分别参照 [ECS 官方 service deployment 权限示例](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-deployment-permissions.html)和 [Logs 授权参考](https://docs.aws.amazon.com/service-authorization/latest/reference/list_logs.html)。没有复制 provider schema 内的全部可选权限；实际模板没有 TargetGroupAttributes、Cognito 或日志 index/data-protection/delivery 设置，不加这些可选写动作。

不新增角色、trust、attachment、inline、PassRole、日志流写、Secret 值读取、数据库或资源变更权限。不改七消费者的 `TechlongSandboxServiceRoleBoundary` 或 task execution inline。原有较宽历史权限保留，不代表本次重新认可或已经收窄。

## 实现与验证

- `express-workload-cfn-read-policy-v1.ts`：纯差异编译，完整前态/消费者/版本/Source/信任检查，90秒事实窗口、一小时 SHA 清单。请求只有 `CreatePolicyVersion(PolicyArn, PolicyDocument, SetAsDefault=true)`，不删除版本或另行 SetDefault。
- `review-express-cfn-read-policy-v1.mjs`：Draft / Review / Run / Inspect。Draft 只复用已保存历史证据，不能生成可执行清单；Review 只做身份与 IAM 元数据核对，不新增模拟。Run 必须绑定 fresh SHA、当前代码、全前态及唯一永久槽；Inspect 用另一个进程独立回读、确认新 default 和原 v7 完整内容仍在。丢失提交回执时只报告状态匹配但归因未证明，不冒称本次成功。
- 完整交付只读入口已同步修正上述资源类型；不再重复已证明无法定位原因的日志流模拟，明确输出 `LOG_ACCESS_STILL_UNPROVED`，不把省略模拟标为 allowed 或 ready。原 r3 证据不回填，本轮没有重新运行完整云预检。
- 25项相关 tests（9项新增）、类型检查、定向 ESLint 通过；实际保存历史文档编译成功，候选为6086字符，小于6144保守限制。旧 Full validator、已发布镜像、C5d/C5e 执行代码和已消费槽均未修改。

当前草案：`F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-draft-20261015-r3/`，candidate SHA `2d96d656f0921fc93fe0a36747a11ca5df38f81b69e1a5687affdd6cad0509d1`。**这不是批准 SHA，不能用来执行。** r1/r2 草案保留为历史，均从未可执行。版本化交接见 [draft capsule](../ops/aws-sandbox/reviews/aurora-dual-mode-c5g-cfn-read-policy.draft.json)。

## 需要的下一项许可：只读，不安装

安全审批要求单独确认新增这一组私有 IAM 元数据读取。准确范围为最多 **1次 STS 身份读取 + 8次 IAM 读取**：GetRole、ListRolePolicies、ListAttachedRolePolicies、GetPolicy、ListPolicyVersions、GetPolicyVersion、ListEntitiesForPolicy 各两种 usage。对象仅为上述既有 CFN role/policy；读取完整 default 文档、trust、版本和消费者名称/ID。可能暴露基础设施授权布局，结果仅保存到 `F:/ChatGPT_workshop/` 本地证据；不读凭据、Secret 值或业务数据，不查询其他角色内容。

该许可只用于生成新的可审批清单，**模拟、IAM写、CFN/ECS/DNS/DDB/SQL、私密重载均0**。已被拒绝的 Review 没有通过其他方式执行或绕过。新批准后用新目录首次执行 Review，不是写重试。若消费者、默认版本、历史文档或信任变化，则停下报告，不自动合并、补齐或安装。

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-cfn-read-policy-v1.mjs `
  --mode Review --output F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-review-20261015-r1
```

## 后续安装必须另批的完整风险

1. 单次 CreatePolicyVersion 会立即把新版本设为 default，对同一 policy 的 identity 与 boundary 两种用途同时生效。新读取权限是持久安装，不是自动撤销窗口；v7 保留但不自动回滚/撤权。
2. 两项 Logs 区域 inventory 权限可读取该区域全部 index/resource policy 元数据，不能按 tenant 隔离；现有历史权限不改。
3. IAM 不支持此流程的跨读取 CAS。即使检查准确 ID、全部版本、完整文档/信任与两类消费者，特权并发仍可能在检查后改变它们。权限传播不保证；文档/旧模拟不证明真实 provider 或日志流可用。
4. 固定永久槽 `techlong-express-c5g-workload-cfn-read-policy-v1.permanent-slot.json` 在唯一提交前占用。失败/丢失响应/部分状态只读核对；不自动重试、删除版本、补齐、撤销、回滚或复位。新版本可能已生效并遗留，响应里的 version ID 必须真实捕获，不预设一定是 v8。
5. 若现有策略由 CFN 管理，直接 IAM 更新可能产生 drift，后续栈更新可能覆盖差异。本步骤不修改原栈模板、不自动修复 drift。
6. 这是 IAM-only 前置，不延长 Cell 标签、不认领 owner/epoch、不创建 job/收费 Cell、不读私密或初始化，不是部署/ready。已有计算资源持续计费；50 USD/月是目标而非硬cap。

只有新的 Review 真正通过并向用户呈现 fresh manifest SHA 后，才可另批一次准确策略版本创建及独立 Inspect。此文档、草案或一句“开始下一步”都不是安装批准。批准后 Run 的成功或失败均应立即调用新进程 Inspect，不重发 CreatePolicyVersion。官方 API：[CreatePolicyVersion](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicyVersion.html)。

之后继续同一真实 first-claim/epoch → 七资源 workload/DNS → provision → initialized-ready/原子回写闭环。不要提前创建 running job 后再补代码。现有 Cell `ExpiresAt` 为 UTC16:44:56.246 / Winnipeg11:44:56.246 CDT，仅为标签、不自动停费；过期后不能复用旧批准进行新部署、延时或清理。
