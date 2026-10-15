# C5d 已执行：Express 计算层独立核验通过，尚无应用任务

2026-10-15 America/Winnipeg。用户确认[原执行清单及完整风险](./aws-auto-deployment-aurora-dual-mode-c5d-compute-review.md)的准确 SHA `7a0c636b741e1cc0af068046c052f1f09a6dd1bc8f0a62b539f3be609f245423` 后，仅一次退役旧失败栈、一次创建新16资源计算层；独立新进程返回 **`EXPRESS_COMPUTE_INDEPENDENTLY_VERIFIED_NO_WORKLOAD`**。不是应用部署完成或租户 ready。

## 实际结果

- 旧栈准确 UUID `ede4f290-c758-11f1-8050-06ffda7a3477` 于 UTC13:59:45.715 出现本次 `express-retire-<SHA>` 的 DELETE_COMPLETE 根事件；14:02:39.815 独立准确 UUID 读取再次确认 DELETE_COMPLETE。旧 UUID 不可恢复，保留历史模板、资源记录及本地证据。只删旧失败栈，没有删除外部 Express 数据库或 Secret。
- 新栈创建响应于 UTC14:00:00.038 保存，准确 ARN 为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`。实际服务端 CreationTime 为14:00:00.436；客户端保存时钟和服务端时钟并非同一时钟。
- 第一次 Inspect 为 CREATE_IN_PROGRESS，保留不覆盖；有限准确 UUID 只读轮询于14:02:53.537看到 CREATE_COMPLETE。第二次独立 Inspect 的 metadata 观察时间为 **UTC14:03:28.877 / Winnipeg09:03:28.877 CDT**，核对通过全部16条 CREATE_COMPLETE 物理记录、原模板/四参数/六标签/现有执行角色、准确新 UUID 的 CREATE_COMPLETE 根事件及本次创建 token，并校验输出映射和 VPC/ALB 来源。
- ECS `cell-sandbox-1` 是 ACTIVE，running=0、pending=0、services=0。仅有网络、空集群及 ALB/listeners/控制路径拒绝规则；没有 TaskDefinition、Service、RunTask 或 DNS 写入。
- 现有 Cell RoleId、boundary 默认 v1、完整 trust/inline/boundary、服务关联角色身份仍匹配。没有安装、收窄或撤销 IAM；原 Full 数据库能力仍存在，不能说16资源模板使角色最小化。

准确模板 SHA：`e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`。批准代码 binding `d05691bf55051b8a358db842dc55892f3d1ab3b9f2bff0fce27a39e7e1167800` 的53个 LF 规范化源码/依赖锁/seed capsule 在执行和两次独立回读中保持；本轮没有应用源码、镜像或执行逻辑修改。

## 后继接线只使用这些已验证输出

| 输出 | 实际值 |
| --- | --- |
| ClusterName | `cell-sandbox-1` |
| VpcId | `vpc-0136b6ba92a72cbf9` |
| SubnetIds，A/B顺序 | `subnet-05b781276cc988b93,subnet-05729abe921410a75` |
| TaskSecurityGroupId | `sg-0df75af0d0661492a` |
| HttpsListenerArn 后缀 | `listener/app/techlong-sandbox-cell-sandbox-1/77888e84c19e8b86/469c2b642a33bfc1` |
| ControlListenerArn 后缀 | `listener/app/techlong-sandbox-cell-sandbox-1/77888e84c19e8b86/bc69b195b69bc2d9` |

完整 listener ARN 的前缀是 `arn:aws:elasticloadbalancing:ca-central-1:402010193138:`，完整值及16条物理映射在 final Inspect facts/observation 中保存。ALB ARN 后缀为 `loadbalancer/app/techlong-sandbox-cell-sandbox-1/77888e84c19e8b86`，DNS 为 `techlong-sandbox-cell-sandbox-1-335750443.ca-central-1.elb.amazonaws.com`，canonical hosted zone 为 `ZQSVJUPU6J1EY`；没有创建 `first-acceptance.sandbox.techlong.cloud` 的 alias，ALB 存在不代表应用可访问。

## 调用、证据及不可重放状态

实际直接 AWS 写调用 **2次**：准确旧 UUID 的 STANDARD DeleteStack、固定名称的 CreateStack。SDK maxAttempts=1，写入重试0。新栈没有进入失败回滚。

Run 前/退役后各独立核对一次 Neon/DDB 控制面，仍满足无 deployment/job/resource/operation、两套 authority key 缺失的候选条件；这是有时限读取，不是跨服务 CAS 或 owner/epoch 声明。主进程未加载数据库环境；隔离子进程只连接既有 Neon 做只读 SELECT。没有连接 Aurora SQL、读 AWS Secret 值或 private bundle、写 Neon/authority、启动 job/TTL、部署 workload 或修改 DNS。C5c 的 store1 为历史已批准且 hash 绑定的 seed 证据，本轮不重新查询 Aurora，不把历史 seed 当当前 SQL 证明。

三个永久槽均已消费：

- `techlong-express-c5d-compute-run-v1.permanent-slot.json`
- `techlong-express-c5d-old-stack-delete-v1.permanent-slot.json`
- `techlong-express-c5d-compute-create-v1.permanent-slot.json`

**不得重新运行 Run、补齐写入、复位槽或以该 SHA 删除新栈**。旧 foundation、seed、所有历史槽/Review/Inspect 均保留。Inspect 没有云写路径，但后续代码变化会影响其原代码 binding；优先使用已保存证据，不重放写以“验证”。

证据位置：

- `F:/ChatGPT_workshop/techlong-express-c5d-compute-review-20261015-r2/`：冻结批准 manifest、template、两准确请求、53 pins 和只读准备事实。
- `F:/ChatGPT_workshop/techlong-express-c5d-compute-run-20261015-r1/`：写前/退役后事实、删除响应、新 UUID/token 回执、最终提交结果及独立旧栈删除事件投影。该投影明确是读取结果的非秘密字段记录，不是原始完整 provider response，也没有声称读取全部旧事件页。
- `F:/ChatGPT_workshop/techlong-express-c5d-compute-inspect-20261015-r1/`：初次 pending 记录。
- `F:/ChatGPT_workshop/techlong-express-c5d-compute-inspect-20261015-r2/`：最终独立 facts/observation/receipt/result。
- [版本化已执行摘要及20个文件 hash](../ops/aws-sandbox/reviews/aurora-dual-mode-c5d-compute.executed.json)，另绑定原 prepared capsule 及其14项历史证据。不提交凭据、私密 bundle 或 Secret 值到 GitHub。

本轮后置检查是证据 hash、53 pins、摘要与实际输出一致、diff whitespace 及两仓库 main 同步；不重跑完整离线构建或重新发布镜像。原18项相关 tests/types/lint 是批准前已有结果，不能冒称本轮重新运行。

## 费用和清理边界

ALB、TrustStore 关联、公共 IPv4/LCU 已开始产生按量费用。按原批准区域价和两个IPv4假设，新增网络基础约 **0.04025 USD/小时**，LCU等另计；不是当前实际账单或上限，尚未核对账单/实际IP计费数量。

`CellExpiresAt=2026-10-15T16:44:56.246Z`（Winnipeg **11:44:56.246 CDT**）**只是标签，不自动删除、停机或停费**。即使下轮对话在此时间之后才继续，也必须将新栈视为仍可能持续计费，先只读核对，不能复用旧批准做清理或继续写。50 USD/月仍是目标而非 cap；常驻整体可能超过目标。原3小时0.12–0.15 USD只是当时短期情景，不是这次费用封顶。

如需清理，另做 fresh 清单，只针对本页新 UUID，重新核对模板/16资源/标签/终态及没有任务、业务登记；单独确认后才能 STANDARD DeleteStack。既有 Express 库、Secret 不在这个栈内，不能随手清理。此前对旧失败栈的删除批准不涵盖这个新收费栈。

## 唯一继续位置

计算层已完成，不再恢复空库、不再 seed、不重建或重新发布现有两份 ECR 镜像，不扩展 F3c9/Grant/诊断支线。下一包集中实现 **first owner/epoch + 7资源 workload/DNS + 准确私密来源/provision + initialized ready 独立核验和平台回写**：

1. 以本页准确新 UUID/六项输出和已发布镜像 digest 生成实际部署候选，补齐 Express 的真实执行 root；旧 Full prepared-v2 factory 不可冒充 Express 执行回执。
2. 私密材料旧 binding 含旧镜像/owner，必须显式核对来源并重绑定，不能静默跳过原 guard；读取 private bundle、准确固定 Secret 值、实际 provision/SQL 和新增云/Neon/authority 写均按新具体范围确认。
3. 计算层和私密输入就绪后才 claim/enqueue，避免提前启动 TTL。真正部署、初始化和最终 `/ready` 通过前，不登记 ready；`/bootstrap-ready` 不能替代最终验收。

当前批准已经用完，只完成本 C5d 范围。尚未实际 claim owner/epoch、创建 workload/DNS、创建商户管理员、执行 provision 或回写 ready。
