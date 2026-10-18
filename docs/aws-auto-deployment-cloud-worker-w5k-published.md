# W5k：DNS 修复固定版本已发布并独立核验

2026-10-18 12:10 CDT（America/Winnipeg）。用户确认新执行清单 `62bbe2c1a44c4088583a2da4a75e02cb287642867fab08993a20842384274b8b` 后，唯一 Publish 已完成；新进程 Inspect 返回 `DNS_VERSION_INDEPENDENTLY_VERIFIED_NO_DISPATCH`。这只是工作流/信任切换完成，不是云 Review 或租户部署验收。

## 实际完成范围

- 一次非 force push 发布两枚固定工作流提交；本地 main 随后一次 ff-only 同步到发布 caller。后续交接文档提交不改变这组运行版本。
- 一次 CreateChangeSet，严格核对准确 ACK ARN、完整模板和唯一 `WorkerRole / AWS::IAM::Role / Modify / Replacement=False / AssumeRolePolicyDocument` 后，一次 ExecuteChangeSet（DisableRollback=true）。既有 foundation 栈已为 `UPDATE_COMPLETE`，没有新建 IAM 资源或扩大权限。
- 独立 Inspect 核对 GitHub 两份准确工作流字节、main、完整 CFN template、角色 trust 和其余现有布局。role ID、boundary 默认 v1、inline、DDB、bucket、人工 environment 门禁、固定 Secret 版本及 Neon 目录均保持。
- 发布永久槽在 `2026-10-18T17:09:07.774Z` 消费并保留；独立回读完成于 `2026-10-18T17:10:20.278Z`。无自动重试、补齐或回滚。

固定版本：

| 用途 | 完整提交 |
| --- | --- |
| 云执行器检出的运行源码 C | `e55367c370ca5aa883d8a7e1342514fc3f34c442` |
| 新 reusable R / 角色 job_workflow_ref | `46312fff06d60e9e4ca96be6bb8d82ce1ce3d109` |
| 已发布 caller S | `d25c97fb0ca88fbb4ea3c1ea72ad4517b6ab7a0a` |

Change Set：`arn:aws:cloudformation:ca-central-1:402010193138:changeSet/dns-normalization-v5-d25c97fb0ca88fbb4ea3c1ea/41e84dc1-d040-4103-aae6-b9112b10ae58`。

现有栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5`。新完整模板规范摘要为 `80b4467fa3fb054e82b696e47a65db486f67ca48247c04904be1a219a3963341`。

本轮 Secret 值读取、S3 Put、Neon 写入、workflow dispatch、job 领取、ECS/Cell 创建均为 0。Neon 核验仅目录合同，不代表本轮重新取得业务任务快照；不声称 held job 已执行或旧资源已经停费。50 USD/月仍是目标而非硬费用上限。

## 审批与证据

旧 `5fe3957a…` 于当天 11:34 CDT 过期。12:07 只读刷新为上述新 SHA；代码、原始前置事实、effects、风险及固定槽保持一致，重新生成了时间绑定的 Git 对象/动作摘要。用户重新确认后才执行，没有沿用过期批准或修改旧原件。[原完整风险](aws-auto-deployment-cloud-worker-w5k-dns-publication.md)及 prepared 记录保留为历史。

26 份本机 JSON 原件的准确路径和原始 SHA-256 均登记在[机器回执](../ops/aws-sandbox/reviews/cloud-worker-w5k-dns-publication.executed.json)。包含新 review 五件、Publish 十七件、独立 Inspect 三件及一个永久槽；摘要不是云端签名或防管理员篡改证明。F 盘目录分别为：

- `F:/ChatGPT_workshop/techlong-w5k-review-20261018-b`
- `F:/ChatGPT_workshop/techlong-w5k-publish-20261018-a`
- `F:/ChatGPT_workshop/techlong-w5k-inspect-20261018-a`
- `F:/ChatGPT_workshop/techlong-cloud-worker-v5-dns-normalization-release-v1.permanent-slot.json`

交接时重新核对 26 份原件、获批清单摘要、134 源 pins 中除两项获批工作流以外的 132 项保持、两项发布字节及 76 文件云闭包；8 项发布边界回归通过，两仓 diff-check 通过。原 prepared/risk 记录不改写为执行结果，本页及 executed 记录单独追加。

## 唯一继续位置

下一阶段只接线并准备原准确任务 `job_ecbf09030d3da7286ea3ef93` 的新云 Review，不再登记业务请求、重做发布或扩展 F3c9。旧 W5i 本机 dispatcher 仍固定旧 C/R、旧源码 pins，会拒绝当前状态；必须在新的实现中显式绑定本页发布的 C/R、保留旧证据/槽并使用新的独立 Review 尝试槽，不能跳过旧检查或改写旧记录。

先完成 Review/RunOnce/Inspect 本机版本衔接、无 AWS 回归及最终 main CI，再只读核对任务/环境/Cell 窗口并准备 fresh Review 清单；Review 中的固定 DB Secret 读取和一份私有 S3 manifest 写仍须具体 SHA 单独批准及人工 environment 审批。实际 RunOnce 的领取/部署和后续 Inspect 继续各自审批，不因本次成功自动获批。云 Review 成功后必须冻结 caller main 跨其原执行窗口，避免重复出现窗口内改代码。

不要再次 Publish、删除/复位任何旧槽、重跑旧 Review、读取原私密包、扩权限或部署承载。DNS 小修复尚未经新的真实 Review 运行，不能保证原失败只有这一个原因；下一真实 Review 才能继续检验后续门禁。
