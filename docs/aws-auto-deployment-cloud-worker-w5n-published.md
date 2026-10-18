# W5n：ECS 缺失兼容修复已发布并独立核验

2026-10-18 13:57 CDT（America/Winnipeg）。用户确认准确执行清单 `f51a4de2778b557eb696554931900c8977b92024688d803025f6ade0b07a8dc4` 后，唯一 Publish 已完成，新进程 Inspect 返回 `ECS_ABSENCE_VERSION_INDEPENDENTLY_VERIFIED_NO_DISPATCH`。这表示修复版工作流及角色信任已切换，**不表示云 Review 或租户部署已通过**。

## 实际完成范围

- 一次非 force Git push 发布两枚固定版本 workflow commit，本地 main 一次 ff-only 同步到准确 caller。后续交接文档不改变固定运行版本。
- 一次 CreateChangeSet，严格核对本次 ACK 的准确 ARN、完整模板及唯一 `WorkerRole / AWS::IAM::Role / Modify / Replacement=False / AssumeRolePolicyDocument` 后，一次 ExecuteChangeSet（DisableRollback=true）。foundation 栈已为 `UPDATE_COMPLETE`。
- 新进程 Inspect 独立核对 GitHub 两份工作流字节、远端/本地 main、完整 CFN template、角色 trust 和其余布局。角色 ID、boundary 默认 v1、inline 权限、DDB/bucket、人工 environment 门禁、固定 Secret 版本及 Neon 目录保持。
- 独立发布永久槽于 `2026-10-18T18:55:40.885Z` 消费并保留；独立核验完成于 `2026-10-18T18:56:53.699Z`。无自动重试、补齐、回滚或清理。

固定版本：

| 用途 | 完整提交 |
| --- | --- |
| 云执行器检出的运行源码 C | `d8cb99693231770de6a5d73e02dda42b87035714` |
| reusable R / 角色 job_workflow_ref | `7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c` |
| 已发布 caller S | `68a476b5edc514456b6aca3a9cbb0aa26232be24` |

Change Set：`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/ecs-absence-v5-68a476b5edc514456b6aca3a/aac210d9-b70e-489d-84f9-4aa39e992716`。

现有栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5`。新完整模板规范摘要为 `b9dc0f524b2aeafb8e7986b2a6f0fb985392ce0b9f956c2ba10e4d9206342a41`。

云闭包仍为 76 文件 / `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`，本次发布不再改变 W5m 的 provider 修复。新版本只兼容已审的准确服务 MISSING 与同服务 ListTasks HTTP400/ServiceNotFoundException 组合，不吞其它异常、不放松其余门禁。

本轮 Secret 值读取、S3 Put、Neon 写、workflow dispatch、job 领取和 ECS/Cell 创建均为 0。目录核验不是新的业务任务快照，不声称原 job 已执行、旧资源已停费或整个平台已上线。50 USD/月仍是目标而非硬费用上限。

## 审批与证据

[原完整风险及命令](aws-auto-deployment-cloud-worker-w5n-ecs-publication.md)、prepared 记录和全部旧失败/发布记录保留，不改写为新成功。批准仍在原两小时窗口内，执行前重新验证了准确清单、原件、当前源码/历史、最终 main 的两项无 AWS CI 和实际旧布局；没有刷新 SHA、复用旧 W5k 发布槽或重跑 W5l Review-v3。

新 27 份 JSON 原件的准确路径及原始 SHA-256 见[机器回执](../ops/aws-sandbox/reviews/cloud-worker-w5n-ecs-publication.executed.json)：review 五份、Publish 十七份、独立 Inspect 三份、永久槽一份和准备独立验证证明一份。摘要不是云端签名或防管理员篡改保证。

- `F:/ChatGPT_workshop/techlong-w5n-review-20261018-a`
- `F:/ChatGPT_workshop/techlong-w5n-publish-20261018-a`
- `F:/ChatGPT_workshop/techlong-w5n-inspect-20261018-a`
- `F:/ChatGPT_workshop/techlong-cloud-worker-v5-ecs-absence-release-v1.permanent-slot.json`
- `F:/ChatGPT_workshop/techlong-w5n-review-verified-20261018-a.json`

在准确发布 caller、交接文档修改前，独立本机检查确认：152 源 pins 中只有获批的两项 workflow 改变，其余 150 项保持；两项发布字节/父链/tree/blob、原 76 文件闭包及 W5k 26 份原件保持。发布前 9 项新边界测试与 61 项相邻回归、类型及定向 lint 通过；最终源码 d8cb 的 portable `39154670152` / continuation `39154670166` 两项无 AWS CI 均 attempt=1/success，不以此代替真实云 Review。

## 唯一继续位置

下一阶段只把本机 Review/RunOnce/Inspect 调度接线显式绑定本页新 C/R 和当前源码 pins，并准备原准确任务 `job_ecbf09030d3da7286ea3ef93` 的新独立云 Review；不得重新登记请求、重做本次发布或扩 F3c9。旧 W5l dispatcher 仍固定旧 C/R 和闭包，会拒绝当前状态；保留其源码、失败 Review-v3 和全部旧槽/原件，不绕过检查或复位重试。

新接线完成并通过最终 main 无 AWS CI 后，先只读核对任务/Cell/环境当前事实，再准备 fresh Review SHA。一次云 dispatch、固定 DB Secret 值读取和一份私有 S3 manifest 写须具体新批准及人工 environment 审批。后续 RunOnce 的领取/实际部署和独立 Inspect 仍各自审批，不能把本次发布批准扩展为部署授权。

ECS 修复尚未由新的真实云 Review 验证，不能保证没有下一处门禁阻断。新的 Review 成功后冻结 caller main 跨其后续审批/执行/Inspect 窗口，不再在窗口内改代码；旧 Review 不重放，不提前读取原私密包或启动队列。
