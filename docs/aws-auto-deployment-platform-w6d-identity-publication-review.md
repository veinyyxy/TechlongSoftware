# W6d：无 AWS App 身份工作流，仅发布待审

## 2026-10-19 最新结论与执行范围

准确源码 `ca2b38d8c756dd8fb800a88ded596c93687f278f` 的 [CI 39278613827](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39278613827) 已独立回读 **completed / success，attempt1、准确 job118148719175 的16步骤全成功**。此前“元数据 queued / 已完成日志”不一致已消除；12组真实临时PG检查沿用已读取日志，不重复测试、排队或猜测原因。[最终证据](../ops/aws-sandbox/reviews/platform-cloud-v6.verified.json)。下方保留当时草稿事实，旧“未通过”不再表示当前状态。

本步只准备：**以现有 Git 身份向 github/main 一次非强制推送，仅增加 `.github/workflows/platform-controller-identity-v6.yml`，随后独立读取内容/注册ID并本地 main 快进。** 冻结执行代码仍为 ca2b38d；候选仍为1682 LF字节、SHA256 `ffac70244e455a547b498fc233a9a17fa5b0c022ab598c5b9735c83436007dea`。没有App私钥/令牌、dispatch、环境代批、AWS/SQL调用、trust/IAM或Secrets变更。不是部署工作流，也不会激活平台 `UNPUBLISHED` 运行时。

入口为 `ops/platform-identity-review-v6/publication.mjs`。它采用已使用的隔离 index + 不挂 ref 的 Git 对象准备方式；不创建分支、不把候选复制进当前工作区、不移动 main、不向远端写入。实际执行必须获得 **最终 manifest SHA** 的独立批准；旧草稿 SHA、代码提交授权、CI成功都不是发布授权。

### 清单与继续命令

先完成本步代码/文档提交推送，保持两个 main干净（服务端用户 `.vscode/settings.json` 不动）。在平台最终 main 上：

```powershell
node --experimental-strip-types ops/platform-identity-review-v6/publication.mjs --mode Prepare --output F:/ChatGPT_workshop/techlong-w6d-identity-20261019-a
```

Prepare重新只读核对准确CI全部步骤、仓库ID、远端main及目标不存在，冻结唯一候选commit、准确父commit、8项源码/风险/证据摘要与48小时窗口。最终可批准文件保存在上面目录的 `manifest.json`，SHA由 canonical JSON（不含自身SHA字段）计算。**它放在仓库外，避免把包含自身父commit的清单再提交而使父commit失效。** 本阶段不再推进平台main，直到这份发布清单执行或被明确放弃。结构化旧草稿只作为历史保留。

批准后才能使用以下模板（不能以占位符或旧SHA执行）：

```powershell
node --experimental-strip-types ops/platform-identity-review-v6/publication.mjs --mode Publish --manifest F:/ChatGPT_workshop/techlong-w6d-identity-20261019-a/manifest.json --approved-sha <最终SHA> --output F:/ChatGPT_workshop/techlong-w6d-identity-20261019-a-run
```

执行前/临推送前复核准确本地/远端父commit、干净main、源码pin、单文件新增对象和CI；永久槽 `F:/ChatGPT_workshop/techlong-w6d-identity-publication.intent.json` 先于唯一push消费。push无force、无额外tags，不写Sites；推送后读取准确commit上的blob、工作流路径/active/真实ID，才进行一次本地ff-only。不会因发布而调度身份工作流。Prepare与读取使用现有Git凭据助手，不读取App PEM或mint App token。

成功或部分/不明后只可另行独立读取：

```powershell
node --experimental-strip-types ops/platform-identity-review-v6/publication.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6d-identity-20261019-a/manifest.json --output F:/ChatGPT_workshop/techlong-w6d-identity-20261019-a-inspect
```

Inspect不推送/修复/同步分支、不要求未过期，但必须匹配原永久槽与原对象；区分remote旧/准确新/漂移，不把本地main尚未快进说成云发布失败。注册传播慢、读API失败、提交后本地同步失败均停止，不自动重发push。真实workflow ID、caller发布SHA以及后续新nonce只能在发布ACK/独立核验之后绑定；**下一次App Actions-write token与单次dispatch仍另审**。

### 本次发布完整风险

- 将创建长期存在、可由授权仓库主体调度的手动工作流；不是一次性授权对象。工作流只有 `workflow_dispatch`、Contents read、无id-token，固定bot/main/attempt1且保留现有人工environment门禁。不修改已有旧工作流或权限。其他现有push CI若路径条件匹配，仍可能因main提交运行；不承诺仓库完全无其它自动检查。
- Git推送依赖现有本机Git凭据/助手与可信本机配置；其权限可能大于这一个文件的程序白名单，本程序不能约束凭据被盗后的行为。HTTPS与提供者仍有请求/身份/仓库日志风险，不打印凭据；不读取或替换App私钥。
- API事实检查与Git提交不是跨服务CAS。并发main变化、网络/ACK丢失、GitHub注册传播、保护规则拒绝或本地ff失败，可能留下“已发布但本地未同步/未核验”的部分状态；不强推覆盖、不自动撤销工作流、回滚或重试。非快进由Git拒绝，不删除并发提交。[Git推送规则](https://git-scm.com/docs/git-push)。
- 一个永久槽先于push占用；占用后即使调用未发送也不自动复位或重放。若过期/父commit漂移且尚未占槽，只能重新准备并请求新SHA；清单48小时不是允许忽略执行前事实核对。未挂ref的候选对象可能被Git GC清除，届时停止，不能用不同对象冒充已批准commit。
- 此发布本身不创建AWS资源、不调用数据库，不表示现有AWS资源停止计费。未来实际dispatch可能使用Actions分钟、artifact存储及environment deployment记录；无AWS不等于绝对零费用。不会自动升级GitHub或改付费/runner设置。
- 发布/CI成功不证明实际App actor、Neon生产兼容、App OIDC trust或平台端到端自动部署完成。后续至少仍需另审单次身份验收、窄SQL/凭据及App trust/部署工作流接线，之后使用新任务验收；不复用已完成W5r任务。

本步新增8项定向检查全部通过，包括真实临时Git仓库的单文件树/父commit/未移动main和原index验证；零警告lint通过。默认沙箱不能完成临时Git操作，宿主侧同一测试已通过，无真实仓库/网络/私钥操作；未重跑原105项或真实PG CI。最终执行清单仍需在干净同步main上Prepare后独立核对。

## 以下为此前草稿历史（已被上述成功终态及最终清单取代）

2026-10-19。本阶段未重做W6c实现、未重跑105项测试、未新建CI；先只读回读准确运行，再将已实现的身份renderer固化为待审文件。**这不是可批准执行的清单，没有有效action SHA或执行命令。**

## 当前门禁事实

准确源码 `ca2b38d8c756dd8fb800a88ded596c93687f278f` 的[CI39278613827](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39278613827)元数据仍queued；job118148719175的runner_id/runner_name均null、步骤0。独立check-run也queued，摘要为空、注释0。用户UI仅显示candidate和“Started 11m 17s ago”，没有提供用量/账单/审批提示；pending environment回读为0。没有足够证据判断原因，不猜测为额度、设置或MFA问题。

随后已独立读取**准确最终job日志**：15:31:48 UTC输出 `PASSED_REAL_POSTGRESQL_18`（9组），15:31:49输出 `PASSED_REAL_PUBLISHER_POSTGRESQL_18`（3组）；15:32:10已记录post-job cleanup。SQL权限拒绝、占槽/重复键ERROR是成功测试中的预期负断言，不是这些检查失败。日志还确认旧62599bb首轮失败为缺少ELB SDK依赖，85cf9b3已做对应依赖修正；没有重新跑旧轮次。

但列表、单独check-run、准确attempt1及其jobs接口（含no-cache头）仍显示queued/无conclusion，run updated_at仍15:31:10；独立GitHub连接器也返回同一job queued、conclusion/steps为null。**目前证据不一致：12组真实PG检查可确认通过，整轮CI终态及全部步骤成功尚不能确认。** 不从空runner/steps推导从未执行，也不从PG日志越过整轮success门禁。无需用户再点按钮、提供凭据、刷新AWS、Run/Re-run、升级或改付费设置；不再自动取消、重排或新增候选轮次。

## 已固化的候选文件

草稿文件：`ops/platform-identity-review-v6/platform-controller-identity-v6.candidate.yml`；不在 `.github/workflows`，不会注册为可运行workflow。拟发布的唯一目标为 `.github/workflows/platform-controller-identity-v6.yml`，本阶段只读核对目标不存在，不创建/覆盖它。

候选由原W6c已测试的 `identityWorkflowV6` 渲染，冻结checkout为上述源码；normalized-LF SHA256为 `ffac70244e455a547b498fc233a9a17fa5b0c022ab598c5b9735c83436007dea`，LF文本1682字节。校验只比对公开文本/结构及Git源码，未调用身份程序、读取私钥、生成nonce/token或访问AWS/数据库。

候选仅接受manual dispatch的 `nonce`、`sourceCommit` 两参数，固定repo/owner/App bot actor、main及attempt1，5分钟job上限；Contents read，无id-token、AWS权限或Secrets传入。沿用现有 `techlong-sandbox-deploy` 人工环境批准，不改变reviewer或环境设置。输出一份公开白名单身份proof，artifact保留7天且不覆盖。

## 后续批准边界（本草稿不授权）

1. 原准确CI通过并独立核对12组临时PG证明后，刷新github/main父commit、目标不存在/候选digest与源码绑定，生成**只发布这一份manual身份workflow**的可执行清单并请fresh SHA批准；不自动dispatch，不读key，不改trust/IAM/SQL或收费资源。
2. 发布ACK后，另审真实workflow ID、发布后的caller main SHA和新公开nonce，才准备一次App调度/指定PEM读取/最小必需令牌及撤销的范围。原只读认证批准和永久槽不复用；不能从“准许提交代码”推导读key或任意Actions write授权。
3. 保留人工environment批准。准确run/nonce/caller SHA/冻结代码SHA/actor/sender及artifact摘要独立比对后，才记录实测App身份；不因CI、API公开bot资料或合成fixture而填成功。

未来发布会新增长期可调度的仓库工作流，配置本身不是一次性权限。实际dispatch创建Actions运行、GitHub环境deployment记录、日志和artifact，可能消耗Actions分钟/存储额度；无AWS不等于绝对零费用。App私钥仍具长期高权限，程序的单workflow白名单不能阻止凭据泄露后的仓库级Actions write滥用；未来另审内存/提供者日志、网络不明、令牌撤销失败和永久槽不自动复位/重试风险。不得为解除当前排队自行升级GitHub或增加付费runner。

本草稿没有父commit执行绑定、发布ACK、真实workflow ID、nonce或调度授权；不得复制到 `.github` 后直接运行。用户即使回复“确认草稿”，也不能绕过尚未成功的原CI或代替未来具体执行SHA批准。

## 最小继续位置

[结构化草稿](../ops/aws-sandbox/reviews/platform-identity-v6.draft.json)保留唯一run和准确日志证明。后续**只读查准确CI/attempt的终态**，不重复读取已保存的PG日志、不重复实现/测试、不为排队改CI或生成可执行批准SHA。确认准确success后，直接使用已固化候选准备最终发布清单，不再重新设计身份方案；当前没有额外用户动作。

回到[W6c候选与风险](aws-auto-deployment-platform-w6c-cloud-candidate.md)。
