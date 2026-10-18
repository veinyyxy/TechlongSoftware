# W5n：ECS 缺失兼容修复的受审发布（尚未执行）

2026-10-18，America/Winnipeg。承接[W5m 代码修复](aws-auto-deployment-cloud-worker-w5m-ecs-absence-fix.md)，按用户“那就开始做接下的工作”实现本次版本切换入口、测试及只读最终清单准备。本阶段不 Publish、不创建/执行 Change Set、不调度 Review/RunOnce、不读取 Secret 值或部署。

新入口 `ops/cloud-worker/ecs-absence-publication-local-v5.mjs` 支持 Prepare / Publish / Inspect。它只面向当前已发布 C=`e55367c370ca5aa883d8a7e1342514fc3f34c442`、R=`46312fff06d60e9e4ca96be6bb8d82ce1ce3d109` 的一次新版本替换，不是复用旧 W5k 槽或批准。代码改变仅为 W5m 已审的准确服务缺失兼容；候选云闭包仍 76 文件、摘要 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`，没有继续改变 provider、数据库合同或权限设计。

## 唯一待审批范围

1. 消费一次独立发布永久槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-ecs-absence-release-v1.permanent-slot.json`。一次非 force Git fast-forward push 两枚已验证 workflow commit：reusable 固定本次准确运行源码，caller 固定该准确 reusable；父链/tree/blob/完整字节以及只改两工作流必须一致。Prepare 仅生成本机无 ref 移动的对象，不消费槽或发布。
2. 现有 foundation stack 一次 UPDATE CreateChangeSet。完整 template 只将 WorkerRole trust 的 `token.actions.githubusercontent.com:job_workflow_ref` 从上述已安装 R 改为本次新 R；role ID `AROAV3GNMXTZK5O45RG24`、boundary 默认 v1、inline 权限、其它 OIDC 条件及全部五资源保持，不新增 IAM 或扩大能力。
3. 保存本次 Create ACK，严格核对其准确 ARN、完整 template 和唯一 `WorkerRole / AWS::IAM::Role / Modify / Replacement=False / AssumeRolePolicyDocument`，细节只允许 DirectModification/Static/Never。再回读旧布局，一次 ExecuteChangeSet（DisableRollback=true），等待 UPDATE_COMPLETE 并核对新 trust/其它布局。最后本地主 main 一次 ff-only 同步至已发布 caller；不能 Git reset 或补偿。

远端提交上限为 push 1、CreateChangeSet 1、ExecuteChangeSet 1；另有本机永久槽和 main FF。轮询/新进程 Inspect 仅只读，不是写重试。没有环境配置、S3 Put、Secret 值读取、Neon 写、job 领取、CreateStack、ECS/Cell 创建或自动 dispatch。本次只发布执行器修复，不是租户部署验收。

## 前置事实、证据与失败边界

Prepare 先验证 W5m 固定证明及其八项已测试源码在不可变 Git 提交中的字节，W5l 失败检查点/11 原件、dispatch/准备原件、原请求/激活/VerifyInstall 历史及 W5k 26 份发布原件；旧 v1/v2/v3 槽和 W5k 发布槽全部保留。原 W5l 的 142 源 pins 在当时 Git 提交核验后再比较当前文件，只允许已审 provider/ROOT 和无 AWS CI 的明确变化。新阶段文档和 CI 变化单独进入新 source pins，不能把旧观察改写成当前成功。

新 main 的 portable / continuation 两项无 AWS CI 必须 attempt=1/completed/success。Source 只读检查 GitHub main/无活动部署 run、environment/OIDC、完整已安装 foundation template/trust/角色/策略、DDB/bucket、固定 Secret **版本元数据**和 Neon 目录；不读 Secret 值或原私密包、不连接 Aurora、不读取业务数据。业务/Cell/任务窗口留到下一次新云 Review，不据此声称部署已完成。

新清单 schema=`techlong/cloud-worker-ecs-absence-publication-review/v5`，有效期两小时。Publish 在消费槽前重建准确 SHA、source/history/prestate/全部动作，再 fresh 回读并要求三分钟内一致；每写前再次核对批准、20 分钟原始执行窗口、clean main/源码及准确 Git 对象，临写重读远端 main。SDK maxAttempts=1，Source AWS Login 使用已有自动刷新。

只执行本次 Create ACK 返回的准确 ChangeSet ARN，不按名字猜测、不执行其他 Change Set。push/Create/Execute ACK 先落盘再继续后续网络；任何失败/超期/未知 ACK/异步未完成均停止，保留永久槽和已完成部分，不删除/复位/重试/回滚/补齐。旧 W5k Publish 与 W5l Review-v3 不重放。

本机新增 9 项发布边界检查，与原 61 项相邻回归共 70 项通过；新无 AWS CI 会实际执行新增检查。类型/定向 lint 及最终 main CI 独立核验；最终准备原件/CI 记录在 F 盘，不以本机测试替代真实发布及独立验收。

Publish 同进程成功仅为 `ECS_ABSENCE_VERSION_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT`。随后必须新进程 Inspect 回读准确 GitHub 工作流字节、main、CFN template/trust及其余布局，成功才为 `ECS_ABSENCE_VERSION_INDEPENDENTLY_VERIFIED_NO_DISPATCH`。Inspect 可在清单过期后只读运行，并报告旧/新/未知/更新中或 main 漂移，不续做任何写入。

## 完整风险

- GitHub、AWS、Neon和本机非原子，main 未保护；源码/ID/临写分支重读不是跨服务 CAS，仍可能并发漂移。工作流 push 与 trust 切换之间可能短暂 OIDC 拒绝；更换 trust 不保证撤销已有 STS 会话。
- 可能只发布了工作流、留下未执行 Change Set、Execute ACK 不明、UPDATE_FAILED 或新 trust 已生效但本地 main 未同步。DisableRollback=true，不自动改回 trust、撤回 Git、删除 Change Set、恢复 stack、补齐或重试；CloudFormation 常规更新/清理和人工恢复仍可能产生影响及费用。
- 自动刷新凭据、提供者/网络/本机落盘可能失败；批准/执行窗口可能在过程内到期，造成部分状态。未知响应只读检查，不重新提交；不能保证补偿、清理或停费。
- 本机对象未签名，可能被管理员改动或 GC 收集；必须临执行核对父链/tree/blob/工作流字节。GitHub token 仅内存使用、只发 GitHub API；日志/管理员/提供者暴露风险仍存在，不保存 token、Secret、原日志或签名日志 URL。
- 复用角色并非没有安全影响：新的固定代码取得已有 worker 权限。本次不扩大权限、不自动调用该能力；人工 environment 审批仍保留。Review 失败读取过固定 DB Secret 的历史事实不抹去，但本次发布不读取其值。
- 50 USD/月为目标而非硬 cap，既有 Cell/数据库/Secrets/S3/DDB/CI 等可能继续收费，接受低成本但非绝对零费用。发布成功不等于租户健康、资源退役或全平台上线。
- W5m 只修复已证明的 ServiceNotFound 阻断点，不能保证不存在其他后续门禁问题。新云 Review、RunOnce 和独立验收仍须分别 fresh 审批；不得用本次授权新建业务请求、扩 F3c9、自动重跑或绕过检查。

## 命令与下一步

先提交推送代码/文档并等待最终 main 的两项无 AWS CI，通过后只读 Prepare：

```powershell
node --experimental-strip-types ops/cloud-worker/ecs-absence-publication-local-v5.mjs --mode Prepare --output F:/ChatGPT_workshop/techlong-w5n-review-20261018-a
# 用户批准该准确 fresh SHA 后才允许（本阶段不运行）：
node --experimental-strip-types ops/cloud-worker/ecs-absence-publication-local-v5.mjs --mode Publish --manifest F:/ChatGPT_workshop/techlong-w5n-review-20261018-a/manifest.json --approved-sha <fresh-sha> --output F:/ChatGPT_workshop/techlong-w5n-publish-20261018-a
# 成功或失败均用新进程只读核验，不重新 Publish：
node --experimental-strip-types ops/cloud-worker/ecs-absence-publication-local-v5.mjs --mode Inspect --run-directory F:/ChatGPT_workshop/techlong-w5n-publish-20261018-a --output F:/ChatGPT_workshop/techlong-w5n-inspect-20261018-a
```

所有目录必须全新、直接位于 F 基目录且前缀 techlong-w5n-。任何代码/main/事实变化或过期都只读刷新材料并请新 SHA，不自动转移旧授权。发布验收后，下一才将本机调度器绑定准确新 C/R、准备原准确 job 的新独立 Review；旧 W5l 调度器仍固定旧 C/R/闭包，会拒绝新状态，不在此授权下重跑。云 Review 成功后冻结 caller 跨后续审批/执行/Inspect窗口，不临时改代码。
