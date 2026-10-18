# W5k：DNS 修复版本的受审发布入口（尚未发布）

2026-10-18，America/Winnipeg。按用户“开始下一步”实现[W5j](aws-auto-deployment-cloud-worker-w5j-dns-fix.md)的受审发布入口、测试及最终执行清单准备。本阶段不执行Publish，不发布两工作流、不创建/执行Change Set、不更新trust、不调度VerifyInstall/Review/RunOnce、读取Secret值或部署承载。

原W5j清单 `823d84af…`只是不可执行材料，不能作为本入口的执行授权。新入口 `ops/cloud-worker/dns-publication-local-v5.mjs` 支持 **Prepare / Publish / Inspect**；只有准确新执行schema、fresh SHA和完整前置事实一致时，Publish才可能写入。旧DNS修复、76文件闭包摘要 `e06c12e53732268ca1665ca6ec77805bd626c9f2bce1d44f66ef8efa430e5299`及原129源码pins保持；不把旧准备JSON改成已授权执行。

本机新增8项发布边界/失败合同及原88项回归共96项通过，类型检查/定向lint零警告。测试不调用真实发布API；最终main还须真实无AWS候选CI成功，Prepare才会生成新执行清单。不以测试结果代替实际Change Set审核、云发布或独立Inspect。

## 唯一拟执行范围

1. 消费一次新独立本机发布永久槽，保存intent；向 `github/main` **一次非force fast-forward push** 两枚已验证的workflow commit。reusable只固定到本次准确runtime commit，caller只固定到该reusable commit；源码、父链、tree/blob、仅两工作流diff均必须一致。
2. 在既有foundation stack `techlong-sandbox-cloud-worker-foundation-v5` **创建一次UPDATE Change Set**。完整inline template只有WorkerRole trust的 `token.actions.githubusercontent.com:job_workflow_ref` 从旧 `7c02d9db…` 改为本次准确reusable SHA；role ID `AROAV3GNMXTZK5O45RG24`、boundary默认v1、inline及所有其它OIDC repo/owner/actor/main/environment条件、DDB/bucket、Secret版本/Neon合同均不变。不增加IAM资源、权限或通配符。
3. 保存本次Create API ACK后，只使用其准确ChangeSet ARN。独立核对完整template和ChangeSet只有 `WorkerRole / AWS::IAM::Role / Modify / Replacement=False / AssumeRolePolicyDocument`，细节必须DirectModification/Static/Never；任何其它变更、分页、不同stack/role/ARN/模板均停止。重新核对旧布局后，**Execute一次，DisableRollback=true**。观察栈完成、核对新trust及其它布局不变，最后仅将本地主main fast-forward到已发布caller。

顶层远端提交上限为Git push 1、CreateChangeSet 1、ExecuteChangeSet 1；另含本机永久槽及本地main FF。状态轮询/独立核验属于只读调用，不是写入重试。没有environment设置/S3 Put/Secret值读取/Neon写入/新job、IAM直写、ECS/Cell创建或自动workflow dispatch。新代码只有DNS规范化及对应摘要绑定修复，不升级plan、不改DNS记录或数据库。

## 保护和部分失败

Prepare先验证当前clean main及原W5j五份原件/129 pins、旧失败和永久槽历史，再创建新的本地无ref移动的R/S对象。新main的两项无AWS候选CI（portable及continuation）必须都成功；实际部署workflow不能有未完成run。Source只读核对已有GitHub/environment/OIDC、AWS完整旧布局、固定Secret**版本元数据**及Neon目录，不读Secret值或私密包、不连Aurora。

Publish先重建新schema/所有actions/effects/history/source/新SHA和原两小时窗口，再做fresh相同前置核验；全部相符才wx消费槽。每次写入前再核批准、原始执行窗口及当前源码，分支临写重读。使用已有AWS Login自动刷新、SDK maxAttempts=1；Git push无force和无重发。Create/Execute API ACK先落盘，后续核验失败不会补齐剩余步骤。

发布槽固定 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-dns-normalization-release-v1.permanent-slot.json`，之前只是提案且未消费；本次Prepare也不消费。成功、拒绝、未知ACK、过期、取消、超时、文件写入失败或部分完成均不自动删除/复位/重试。旧Review-v1/v2槽和两次Review原件均保留，不用它们继续实际发布。

Publish同进程回读仅返回 `DNS_VERSION_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT`，不是独立验收。随后必须新进程Inspect核对准确GitHub两工作流字节、当前main、CFN template/trust及旧布局；它可以在执行清单过期后只读运行，不续做写入。失败时Inspect可报告旧/新/未知template、当前stack状态和main漂移；旧trust或更新中不是“已发布成功”。若本地FF失败而远端已完成，会明确记录localHead，不用Git reset或自动恢复。

## 完整风险

- GitHub与AWS/Neon/本机非原子，main未保护；源码/ID/临写分支重读不是跨服务CAS，仍可能并发漂移。发布新caller到trust切换之间，OIDC可能临时被拒。替换trust不保证撤销已有STS会话；其它操作者/既有会话仍可能并行操作。
- 可能只完成push、留下未执行Change Set、Execute结果不明、UPDATE_FAILED或新trust已生效而本地main未同步。执行禁用自动失败回滚；不自动撤销Git、改回trust、删除Change Set、恢复stack、补齐或重试。常规CloudFormation更新/清理和后续人工恢复仍可能产生影响与费用。
- 凭据自动刷新、网络/提供者和本机落盘都可能失败；批准或观察窗口可能在过程中到期，留下部分状态。未知push ACK后不继续AWS写；未知Create/Execute ACK后只读检查，不按名字猜测或执行别的Change Set。不能承诺自动补偿/停费。
- 本机Git对象未签名，可被管理员更改环境或GC收集，最终执行前必须重新验证其存在、准确父链/tree/blob/双工作流diff。GitHub token仅内存使用，只发GitHub API；没有签名日志URL/原日志/DSN/私密值输出，但提供者或本机管理员日志风险仍存在。
- 复用既有五资源foundation和角色不等于无安全影响：允许的新固定代码版本会取得已有worker能力。这里不扩权限，不自动调用该能力；人工environment审批和准确下一Review仍须另批。50 USD/月为目标非硬cap，既有Cell/Secret/S3/DDB/CI等成本继续存在，接受低成本但非绝对零费用。
- Publish完成也不是任务部署验收。旧W5i dispatcher仍固定旧C/R和历史pins，会拒绝当前新状态；下一需另行接线并准备准确held job的新Review和新独立尝试槽，不绕过门禁、不增加业务任务、不在本次授权下重跑云worker。

## 命令与审批边界

所有代码/文档先提交推送，待最终main的无AWS候选CI成功后，在全新F盘目录准备：

```powershell
node --experimental-strip-types ops/cloud-worker/dns-publication-local-v5.mjs --mode Prepare --output F:/ChatGPT_workshop/techlong-w5k-review-20261018-a
# 用户准确新SHA批准后才可运行（本轮不会运行）：
node --experimental-strip-types ops/cloud-worker/dns-publication-local-v5.mjs --mode Publish --manifest F:/ChatGPT_workshop/techlong-w5k-review-20261018-a/manifest.json --approved-sha <fresh-execution-sha> --output F:/ChatGPT_workshop/techlong-w5k-publish-20261018-a
# 无论成功或失败，独立新进程只读Inspect，不再次Publish：
node --experimental-strip-types ops/cloud-worker/dns-publication-local-v5.mjs --mode Inspect --run-directory F:/ChatGPT_workshop/techlong-w5k-publish-20261018-a --output F:/ChatGPT_workshop/techlong-w5k-inspect-20261018-a
```

Prepare不是云Review，不消费槽、不创建ChangeSet。新清单完整绑定三项远端写、一个本地主main FF、动态ACK规则及上述风险；需用户显式确认才可Publish。任何代码/main/事实变化或清单过期都先只读准备新清单，不自动用旧批准继续。
