# W5l：已发布 DNS 版本的同任务云 Review 衔接

2026-10-18，America/Winnipeg。承接[W5k 已发布结果](aws-auto-deployment-cloud-worker-w5k-published.md)，本阶段只编码、无 AWS CI 和只读 Prepare；不 dispatch、不读取 Secret 值、不写 S3/Neon/DDB/IAM、不领取任务或部署。新入口为 `ops/cloud-worker/dns-job-dispatch-local-v5.mjs`（Prepare / Dispatch / Observe），三种云模式 Review / RunOnce / Inspect 已提前接好，不在云 Review 后再修改 main。

本机新增 9 项边界和原 30 项调度/DNS/发布回归共 39 项通过，类型检查和定向 lint 零警告；无 AWS portable CI 已加入这 39 项真实运行，不只依赖本机结论。最终 main 云 CI 结果与 fresh 清单留在新的 F 盘材料，不以本段本机验证代替它们。

## 固定事实与历史保留

原任务保持 `job_ecbf09030d3da7286ea3ef93`，原管理员来源、请求、九行业务快照及同任务领取合同不变。运行源码 C 固定 `e55367c370ca5aa883d8a7e1342514fc3f34c442`，reusable R 固定 `46312fff06d60e9e4ca96be6bb8d82ce1ce3d109`，已发布 caller S 为 `d25c97fb0ca88fbb4ea3c1ea72ad4517b6ab7a0a`。本机后续提交不会替换云端 C/R 或重新发布工作流/更新 trust。云 manifest 的 `code.commitSha` 是调度时 caller main，不是被检出的 C；本机分别绑定两者，不能混用。

旧 W5i controller/adapter 保留并继续拒绝新 R。新入口复用无状态的七输入 body、精确对象引用和公开 proof 解析合同，不复用旧批准或旧永久槽。Review 新槽为 `…-review-v3.permanent-slot.json`；RunOnce/Inspect 新槽各为 `…-runonce-v2.permanent-slot.json` / `…-inspect-v2.permanent-slot.json`，均带固定原 job 前缀且直接位于 `F:/ChatGPT_workshop`。不存在自动删除、复位、补齐或重试。

Prepare 从不可变提交 `f6d56a84fa14274f5de1c2ed7aa6b608c9397784` 比对 W5k executed 记录；核对 26 份原件、旧失败/永久槽、W5j 证据、原管理员请求及早期激活/VerifyInstall 证据链。134 个原源码 pins 先在 C 的 Git 对象核验，再核对当前源码；两工作流必须为准确已发布字节。只允许明确的本机兼容改动：旧调度测试使用历史 R 的确定性 caller fixture，新无 AWS CI 增加当前版本回归。旧 prepared/risk/执行原件不改写，76 文件云闭包必须保持 `e06c12e53732268ca1665ca6ec77805bd626c9f2bce1d44f66ef8efa430e5299`。

最终 clean main 的 portable/continuation 两项无 AWS CI 必须 attempt=1/completed/success。随后只读检查 repo/actor/main、准确双工作流字节、人工 environment/OIDC、现有 foundation 完整模板/trust/权限、DDB/bucket、固定 Secret 版本元数据和 Neon 目录；读取原 job/队列/管理员/九行并重新准入。任何业务、版本、权限、窗口或原件变化都停止。上述读使用现有 Source Login 和本地 owner 数据库连接，不读 AWS Secret 值、不连接 Aurora。

## 分开的批准与实际效果

Review 清单本机有效期两小时，只控制一次 dispatch 提交，不控制之后的人工 environment 审批时间。只有 fresh 准确 SHA 批准后才消费新永久槽、一次返回准确 run ID 的 POST；不批准 environment，不自动重跑。执行前再次核对 clean main、全部 source pins、分支和云窗口，未知 ACK 保留槽与已落盘 intent/ACK，只读 Observe。

获批后的 Review 云运行才允许：真实 OIDC/STS 取得既有 worker 权限，固定 DB Secret 版本读取一次，窄角色只读目录/同任务快照及 AWS 现有资源核对，向私有版本化证据 bucket 条件写入一份新 manifest。禁止任务领取、控制 Secret 读取、DDB 写、CreateStack 或应用 GET。controller 的 Prepare 不是该云 Review，本阶段不会做上述云写/私密读取。

Review 成功后 Observe 只读核对准确 run/attempt/caller 与唯一 job、内存解析公开 proof、准确 S3 VersionId/完整摘要及 manifest 重建。**云 Review 成功后冻结 caller main，RunOnce/Inspect 不再提交文档或代码**；原 `claimBy` 仅 15 分钟，不能用本机两小时 dispatch 清单延长它。两种后续模式均单独 fresh SHA 批准：RunOnce 保持五个永久 DDB 动作、同 job 领取、一次七资源 CreateStack、固定控制 Secret 一读、两认证 GET、原子完成；Inspect 才允许 Source 一份条件 execution-reference Put 及独立只读 worker 检查/报告。没有新的业务请求或权限安装。

## 完整风险

- GitHub/AWS/Neon/本机非原子，main 无保护，临提交重读/源码 pins 不是跨服务 CAS；从核对到操作仍可能并发漂移。CI 成功不保证真实云 Review 或后续部署成功；原失败没有保留原异常，DNS 修复不保证消除所有原因。
- Review 会接触固定 DB 凭据和业务快照；内存/提供者/管理员日志仍有泄露风险。完整 manifest/队列只存本机 F 盘及私有 S3，不上传公开 GitHub artifact/仓库；公开 proof 只含准确引用和摘要。运行日志仅内存解析，不保存原日志或签名下载 URL。
- POST/条件 Put/网络/落盘可能出现未知结果或部分状态；permanent 槽可能已消费但未取得可用运行。maxAttempts=1，不 fallback、不 rerun、不自动取消/撤销/清理或重试。后续 Inspect 条件 Put 与 dispatch 非原子，可能留下版本化对象但没有运行。
- Source Login 自动刷新可失效，人工 environment 审批可延迟，云 manifest 生成时的 15 分钟 claimBy 不会延长。过期只读核对并新审，不改写原时间、不自动重放。
- 每次云运行取得既有 worker 的完整窄权限，不等于本次允许行使全部权限；本次只批准 Review 时仍不得 RunOnce。50 USD/月为目标非硬 cap；既有资源、Secrets/S3/DDB/CI/读操作等可能产生非零费用，无自动停费或清理保证。
- 本机文件摘要和 Git hash 不是外部签名/防管理员篡改保证。保留所有旧记录和槽；若门禁失败，只读报告真实原因，不放宽检查以推进。

## 命令与继续点

先提交全部代码/文档并等待最终 main CI。只读生成新清单：

```powershell
node --experimental-strip-types ops/cloud-worker/dns-job-dispatch-local-v5.mjs --mode Prepare --cloud-mode Review --output F:/ChatGPT_workshop/techlong-w5l-review-20261018-a
# 准确 fresh SHA 单独批准后才允许（本阶段不运行）：
node --experimental-strip-types ops/cloud-worker/dns-job-dispatch-local-v5.mjs --mode Dispatch --manifest F:/ChatGPT_workshop/techlong-w5l-review-20261018-a/manifest.json --approved-sha <fresh-sha> --output F:/ChatGPT_workshop/techlong-w5l-dispatch-20261018-a
# 只观察准确本次 ACK，不重新 POST：
node --experimental-strip-types ops/cloud-worker/dns-job-dispatch-local-v5.mjs --mode Observe --dispatch-directory F:/ChatGPT_workshop/techlong-w5l-dispatch-20261018-a --output F:/ChatGPT_workshop/techlong-w5l-observe-20261018-a
```

RunOnce 的 Prepare/Dispatch 另需 `--cloud-review-directory` 指向本次成功 Observe 目录；Inspect 再需 `--execution-directory` 指向准确 RunOnce 的成功 Observe 目录。三种模式输出目录均必须全新、直接位于 F 基目录且前缀 `techlong-w5l-`。任何批准过期或 Source 失效都不自动运行失败命令；刷新只读材料后请新 SHA。下一唯一动作是准确 Review 的单次批准，不重做 W5k 发布、迁平台或开启全局队列。
