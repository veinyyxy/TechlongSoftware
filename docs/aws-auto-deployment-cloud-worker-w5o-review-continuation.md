# W5o：ECS 修复固定版本的同任务云 Review 衔接

2026-10-18，America/Winnipeg。承接[W5n 已发布并独立核验](aws-auto-deployment-cloud-worker-w5n-published.md)，本阶段只实现本机三模式衔接、验证及只读 Prepare，不 dispatch、不读 Secret 值、不写云资源/业务数据、不领取任务或部署。新入口 `ops/cloud-worker/ecs-job-dispatch-local-v5.mjs` 提前接好 Review / RunOnce / Inspect，避免云 Review 成功后再改代码消耗原执行窗口。

## 本次仅改变本机接线

原任务仍为 `job_ecbf09030d3da7286ea3ef93`；原请求、管理员来源、九行业务快照和同任务领取合同保持。新入口固定运行 C=`d8cb99693231770de6a5d73e02dda42b87035714`、reusable R=`7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c`，W5n 发布 caller S=`68a476b5edc514456b6aca3a9cbb0aa26232be24`。本次不改变两份已发布 workflow、云 provider、ROOT、权限或依赖，也不重新发布。云 manifest 的 `code.commitSha` 是 dispatch 时的 caller main，不是检出的固定运行 C，必须分别绑定。

新 schema 为 `techlong/cloud-worker-ecs-job-dispatch-review/v5`。固定原 job 的新独立槽：Review-v4、RunOnce-v3、Inspect-v3，均直接位于 `F:/ChatGPT_workshop`。W5i/W5l 入口、Review-v1/v2/v3 及其它旧槽/原件保留；旧 dispatcher 继续拒绝当前 R，不复用其批准，不删除或复位槽。

无状态七外部输入 body、准确对象引用和公开 proof 解析继续复用已有合同。旧 DNS 调度测试改读其确定性历史 caller，不假装旧入口适用于新 R；新测试直接核对当前 caller/reusable 的真实字节和 C/R。新 9 项与相邻回归共 65 项本机通过；类型/定向 lint 及最终 main 的 portable/continuation 两项无 AWS CI 是独立门禁，不以本机结论代替真实云 Review。

Prepare 从不可变提交 `840ac3df900b04b62b7e01097bc9473962ad1e8f` 比对 W5n executed 记录及固定摘要，核对 27 份原件/发布检查点、W5m 修复证据、失败 W5l Review-v3/11 原件、W5k 26 原件、旧 DNS/管理员请求/激活/VerifyInstall 沿革。152 个发布源码 pins 先在固定 C 的 Git 对象核验，再比较当前源码；两工作流只能为准确发布字节。仅允许四项明确的本机改动：README/主线的交接记录、旧 DNS 调度测试历史 fixture、无 AWS CI 新增本次测试；新的五项入口/测试/文档/准备记录及 W5n 两项结果文件单独纳入本次 pins。76 文件云闭包必须保持 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`。

最终 clean main 的两项无 AWS CI 必须 attempt=1/completed/success。随后 Source 只读核对 repo/actor/main、准确工作流、无未完成部署 run、人工 environment/OIDC、现有 foundation 完整模板/trust/权限、DDB/bucket、固定 Secret **版本元数据**和 Neon 目录；经本地现有 owner 连接只读核对原 job、队列、管理员及九行业务并重新准入。不读 AWS Secret 值、不连接 Aurora；完整 Cell/namespace/Aurora/固定材料现状仍由新的云 Review 终审，不能将此前失败读数当作当前健康证明。

## 必须分开的批准

本机 Review 清单有效期两小时，只控制一次 dispatch 提交，不延长后续人工审批或云执行窗口。获得准确 fresh SHA 批准后才可消费 v4 槽、提交一次返回准确 run ID 的 POST；不代批 environment、不自动 rerun。临提交重新核对源码 pins、clean main、远端 main、批准及云窗口；未知结果保留 intent/ACK/槽，只读 Observe，不再 POST。

该单次 Review 云运行的准确范围为：真实 OIDC/STS 使用既有 worker 权限，读取固定 DB Secret 版本一次，窄角色只读目录/同任务业务快照及 AWS 既有资源核对，向私有版本化证据 bucket 条件写一份新 manifest（含私有快照/队列）。job 领取、控制 Secret 值读取、DDB 写、CreateStack、应用 GET 均为 0。**本轮 Prepare 不执行上述云读取凭据或写 manifest 行为，须下次具体 SHA 批准及人工 environment 审批。**

Observe 只认本次 ACK 的准确 run/attempt/caller 和唯一成功 job，在内存解析公开 proof，核对准确 S3 VersionId/完整摘要并重建 manifest；原日志或签名 URL 不落盘。Review 失败或没有 manifest 不代表准许运行 RunOnce，也不能把失败原件覆盖为新成功。

云 Review 成功后冻结 caller main，RunOnce/Inspect 期间不再提交文档或代码。原 `claimBy` 仅 15 分钟，本机两小时清单不能延长。两者继续各自 fresh 批准：RunOnce 保持五个永久 DDB 动作、同 job 领取、一次七资源 CreateStack、固定控制 Secret 一读、两次认证 GET及原子完成；Inspect 才允许 Source 一次条件 execution-reference Put 和独立 worker 检查/报告。这里仅提前接线，不授权这些动作，不新建业务请求或安装权限。

## 完整风险

- GitHub、AWS、Neon和本机非原子，main 未保护；准确源码/ID/临提交重读不是跨服务 CAS，核对后仍可并发漂移。CI 成功不保证真实云 Review 或部署成功；已审 ECS 修复不保证没有其它门禁阻断。
- Review 会接触固定 DB 凭据、业务快照和队列，内存/提供者/管理员日志有暴露风险。完整材料只存本机 F 盘和私有 S3，不上传公开仓库或 artifact；公开 proof 仅准确引用和摘要，原日志/签名下载 URL 只在内存处理。
- POST、条件 Put、网络或落盘可出现未知 ACK/部分状态；永久槽可能已消费但无可用运行。SDK maxAttempts=1，不 fallback、rerun、自动取消/撤销/回滚/清理、补齐或写重试。后续 Inspect 条件 Put 和 dispatch 非原子，可能遗留版本对象但未运行。
- Source Login 自动刷新可能失效，人工审批可能延迟。两小时窗口只管 dispatch；实际云 manifest 生成的 15 分钟 claimBy 不延期。过期只读核对、准备新清单并另批，不改写原时间、不自动重放旧执行。
- 每次云运行取得既有 worker 的完整窄权限，不代表批准行使所有能力；Review 不能运行 RunOnce。50 USD/月为目标而非硬 cap；既有资源、Secrets/S3/DDB/CI/读操作可能继续产生非零费用，不保证自动停费或清理。
- 本机摘要/Git hash 不是外部签名或防管理员篡改保证。完整保留旧失败、发布及槽位；门禁失败只报告证据，不放宽检查推进。之前 Review 读过 DB Secret 的事实不抹去，但不代表本轮已读或获准再读。

## 命令与唯一继续点

全部代码/文档提交推送后，等待最终 main 两项无 AWS CI 成功，仅只读 Prepare：

```powershell
node --experimental-strip-types ops/cloud-worker/ecs-job-dispatch-local-v5.mjs --mode Prepare --cloud-mode Review --output F:/ChatGPT_workshop/techlong-w5o-review-20261018-a
# 准确 fresh SHA 另批后才允许；本阶段不运行：
node --experimental-strip-types ops/cloud-worker/ecs-job-dispatch-local-v5.mjs --mode Dispatch --manifest F:/ChatGPT_workshop/techlong-w5o-review-20261018-a/manifest.json --approved-sha <fresh-sha> --output F:/ChatGPT_workshop/techlong-w5o-dispatch-20261018-a
# 只回读本次 ACK，不重新 POST；等待人工环境审批亦用新目录观察：
node --experimental-strip-types ops/cloud-worker/ecs-job-dispatch-local-v5.mjs --mode Observe --dispatch-directory F:/ChatGPT_workshop/techlong-w5o-dispatch-20261018-a --output F:/ChatGPT_workshop/techlong-w5o-observe-20261018-a
```

所有目录必须全新、直接位于 F 基目录且前缀 `techlong-w5o-`。RunOnce 的 Prepare/Dispatch 另需 `--cloud-review-directory` 指本次成功 Observe；Inspect 再需 `--execution-directory` 指准确 RunOnce 的成功 Observe。任何过期、身份失效或业务/权限漂移均停止，先只读核对并请新 SHA，不重试失败写调用。

下一唯一云动作仍是准确 Review 的单次审批，不重做 W5n 发布、重跑旧 Review、读取原私密包、创建新请求、扩 F3c9/Sites 或开启全局队列。
