# W6c：V6 云接线、App 身份候选和可信导入代码

2026-10-19。继续主目标“平台受控自动部署AWS”，不恢复F3c9支线。**本阶段仅实现/测试候选，未发布身份/部署工作流、未执行App调度、未读真实私钥、未改AWS/Neon或启用控制器。** 新增的 `.github/workflows/platform-cloud-candidate.yml` 只是无AWS的普通测试CI，无OIDC/environment/平台Secrets；它不是部署或身份验收工作流。

## 已实现

`ops/platform-cloud-v6/`：

- `contract.mjs`：准确App actor、仓库/owner、main、attempt1、七项外部输入、原固定installation和单实例/新任务范围。拒绝已完成W5r任务、个人actor、继承AWS凭据/自定义endpoint/Node注入参数、外部执行引用。保留GitHub environment人工审批。
- `runtime.mjs` / `run.mjs`：Review / RunOnce / Inspect桥接现有 `createCloudApplicationV5`，不重写已经验收的部署核心。显式OIDC→STS、准确角色ID核对、固定版本S3读取；没有个人AWS Login或私钥读取路径。一个模式一次进入，不失败落入其它模式、不自动重试/补齐。
- `identity.mjs`：无AWS App实际actor候选，绑定nonce、caller main SHA、冻结执行代码SHA、event sender、bot actor及attempt1；拒绝OIDC/私钥/AWS凭据。证明必须另与准确GitHub run API元数据比对，不能只相信日志JSON或测试fixture。
- `workflows.mjs`：三个工作流的文本渲染器（身份caller、部署caller/reusable），**不写入 `.github/workflows`，不发布或调度**。身份候选仅Contents read，无OIDC/AWS；所有实际运行保留现有 `techlong-sandbox-deploy` 人工环境门禁。部署候选使用与旧V5相同的并发group，避免两入口并行部署同实例。
- `publisher.mjs`：可信发布者导入适配器，读取准确版本/摘要/SSE元数据，重建旧核心的完整manifest/material/lineage/SQL合同，核对实际run actor/head/workflow/reusable，再编译/调用两个固定参数化owner-only函数。无HTTP入口、数据库发现、owner DSN回退、自由SQL或自动轮询。
- `closure.mjs`：新81文件云执行闭包，包含完整传递依赖、旧76个公开根及显式材料/包锁；同时重新计算旧76文件闭包。新入口未加入旧闭包，不改变已安装V5源码。

默认 `node --experimental-strip-types ops/platform-cloud-v6/run.mjs --check` 只读公开源码、输出候选状态/闭包摘要；没有实际云调用、私密材料读取或SQL连接。无参数本机入口在缺少受审发布描述符/真实GitHub上下文时停止。

## 冻结代码与发布工作流分开绑定

冻结代码commit C不包含自己的Git SHA/未来工作流R SHA，避免不可生成的自指哈希。未来受审reusable R以字面值固定 C、闭包SHA和已实测App身份proof SHA；caller以字面值固定R，并将R作为**内部**复用输入传入（外部dispatch仍七字段）。reusable文本不嵌入自己的未来R。所有SHA目前只在合成fixture中有测试值，不能拿fixture值发布。

真实运行会将传入R与GitHub OIDC的 `job_workflow_ref/job_workflow_sha` 比对，同时核对immutable subject、repo/owner、App actor、main/sha、caller workflow、run/attempt、environment和github-hosted。解析JWT声明仅是预检，**不是验签**；必须再由STS验证JWT并按未来受审的精确trust授予角色。[官方OIDC声明合同](https://docs.github.com/en/actions/reference/security/oidc)。

云发布描述符将由单独受审的固定reusable提供；本阶段没有这样的已发布reusable/trust。平台 `PLATFORM_RELEASE` 仍硬编码 `UNPUBLISHED`，其余字段为空，新云环境描述符不能激活平台路由。旧trust仍绑定个人actor和旧reusable，不声称已允许App。

## 三阶段材料和可信导入

保留原manifest/run/inspect的V5 schema、证据前缀、部署业务协议及五个永久云槽，以复用已经验证的核心；V6另包一份精确绑定请求/执行版本/actor proof的结果。

| 模式 | 原核心动作 | 新增不可覆盖证据 |
| --- | --- | --- |
| Review | 只读准备准确held job和manifest，不领取/创建承载资源 | 一份 `platform-result-v6.json` |
| RunOnce | 原五槽、最多一次七资源CreateStack、一次私密控制包读取、两认证GET及原子完成 | 一份准确execution-reference，再一份platform-result |
| Inspect | 原独立云/数据库/运行回执验收，不领取或CreateStack | 一份platform-result |

新增S3写均固定bucket/owner、AES256、`IfNoneMatch:*`、checksum及VersionId ACK。结果/descriptor写失败不重新部署，不把已完成的业务事务回滚；可能留下成功部署但V6结果不全，需要后续单独只读恢复核对。

可信发布者接口分开调用，**不会串行自动批准或调度**：

1. `publishReview`：从可信port读取held job/快照，重建admission及固定installation/context后，只写待审plan。
2. `attestResult`：已有账本必须记录准确run已结束；回读版本化V6结果、原manifest和report，核对完整绑定/重建合同后，只调用owner-only `attest_evidence`。GitHub success本身不能产生证明。RunOnce证明不等于独立部署验收。
3. `publishSuccessor`：重新验证结果，要求账本已有相同proof SHA，才写下一份**待审**plan。RunOnce受原manifest的 `claimBy` 与剩余承载期限约束，不重盖时间；Inspect绑定准确执行descriptor和独立run。

这些方法要求显式的可信S3/GitHub/业务读取与owner-query ports；**生产I/O组合器、凭据保管与实际调用入口仍待另审接线，不是当前平台服务可调用的owner权限**。本阶段真实PostgreSQL CI使用这些同一方法和实际参数化SQL，普通平台服务角色仍不能publish/attest。没有把浏览器JSON当作可信材料，也未给现有控制器新增owner能力。原平台展示仍不会因proof/Actions success直接将 `deploymentVerified` 置true，最终UI验收接线仍需完成。

## 重要执行边界与风险（激活前重新审核）

- 新代码/测试不是生产部署授权。真实App私钥读取/调度、身份workflow发布、Neon账本/窄凭据安装、云workflow/trust切换、新job和实际部署仍各按准确fresh清单批准。原一次认证槽已消费，不重跑token检查。
- Actions write是仓库级能力；身份验证nonce防串轮次，不是人类签名或全局锁。身份workflow artifact和独立API回读仍依赖受信源码/提供者；没有实测证明时不可填“已验证actor”。
- GitHub/OIDC/AWS/Neon/S3之间没有跨服务事务/CAS。凭据/网络/传播、版本化证据ACK、数据库提交或后续写入可不明；不自动回滚、补写、重试、复位或删除资源。额外S3证据也可能产生费用；50 USD/月是目标而非硬cap。
- 发布者是高信任边界：能伪造可信端口/持有owner或证据写权限的主体可能伪造材料。摘要证明完整性/绑定，不是独立第三方签名；不把owner凭据交给平台。提供者日志、内存、依赖及系统保管仍有泄露风险。
- 原manifest的15分钟领取窗口没有延长；下一次live Review到Inspect期间需**冻结caller main**，先把全部代码/人工审批准备好，验收结束后再提交运行结果。不能在运行中推文档改变head而继续拿旧source授权。
- 当前候选账本Inspect仅接受终态job。若RunOnce部分失败仍是running、GitHub失败且无结果、或证据只写一部分，不自动发布恢复/Inspect计划；保留槽/原件，需另审只读恢复及必要业务处置。这不是已实现的任意失败自动恢复。
- 原七资源部署与实例初始化/客户状态、TTL清理、整套平台迁AWS不是同一验收，本阶段不扩大这些功能。

## 验证与继续位置

本机14新增 +91相关回归共105项通过，类型/定向lint/生产构建通过。新增CI对同一候选SQL和同一导入方法执行真实临时PostgreSQL18.6：原九组检查，再三组真实发布/服务角色拒绝/证明→原窗口RunOnce intent；业务表为最小形状fixture，云/业务观察为合成输入，不冒充Neon托管兼容或真实App/AWS验证。最终准确提交CI应独立回读后另记结果。

下一步仅准备**一次无AWS App身份工作流的具体发布及调度清单**，绑定最终源码、nonce和受审范围；获批后实测actor。之后才集中准备现有trust切换、账本/窄凭据和平台激活，最后做一条新任务的真实闭环验收。不要执行未发布候选、手工设置启用变量或复用旧任务/清单。

回到[主线](aws-auto-deployment-mainline.md) / [真实App认证完成记录](aws-auto-deployment-platform-w6b-app-auth-completed.md)。
