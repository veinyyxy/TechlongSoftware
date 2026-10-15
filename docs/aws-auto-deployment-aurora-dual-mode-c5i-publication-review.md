# C5i：UUIDv8修复镜像单次发布待审，不更新ECS或重试初始化

2026-10-15 America/Winnipeg。承接[C5h2真实部分交付](aws-auto-deployment-aurora-dual-mode-c5h2-partial-executed.md)，不扩展F3c9/Grant探针/恢复/SQL模拟支线。用户要求开始下一步，仅据此做代码、候选及现有资源只读审阅；**本清单尚未获批，云写/发布/SQL/私密读取/槽消费均0**。

## 当前唯一待审清单

- UTF8/LF manifest SHA：`1d6b5415c3498e0a1e16add63b0b914215343bde51c2db05a75b47788de68ef1`。
- 服务端文件：`deployment/reviewed-ecr-publication.json`，schema5。
- 允许安装到 **2026-10-15 22:30:00 UTC / 17:30 CDT**；Grant权限最迟 **23:30:00 UTC / 18:30 CDT** 截止。无论成功或失败均立即Source Revoke，不等截止。
- 新永久发布目录候选：`F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-1d6b5415c349`，只读核对时缺席，尚未消费。旧b7d4发布目录和C5h2的17个槽全部保留，不能复位或重跑。

清单只负责先取得修复镜像的真实registry digest。**不批准更新原服务或再次POST**；这两个后继范围分别绑定实际digest和初始化真实状态后再审。此分界是避免把config/ZIP hash当作registry digest，不是重建基础设施。

## 复用既有流程的准确范围

1. Source只更新已有准确栈 `techlong-sandbox-github-image-publication/62c806e0-c27e-11f1-88a8-0e6ce3fed11f` 的两项IAM资源：`TechlongSandboxGitHubImagePublisherRole`（RoleId `AROAV3GNMXTZGGMKJ24YR`）和 `TechlongSandboxGitHubImagePublisherBoundary`（PolicyId `ANPAV3GNMXTZPARAIKHN5`）。不创建、替换IAM对象、OIDC provider或仓库。
2. 当前必须仍为原deny-all Locked/v8、准确v7/v8版本清单、空attached/唯一inline、原trust/boundary完整文档及准确两资源inventory。新schema5额外校验原物理ID；schema3仍只认v4+v3/v4，schema4仍只认v6+v5/v6，不改成版本通配。旧b7d4清单逐字节归档，LF SHA保持原值。
3. 只以新固定regrant模板打开同一main-repo/区域/仓库的原有ECR动作；与C5c模板相比只有描述及到期时间改变，动作、资源、trust条件布局没有扩大。手动dispatch一次已有 `backend-reviewed-ecr-publish.yml`。
4. 提升已检提交 `10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2` / candidate run `38803364109` / attempt1 的两份准确字节，不再build。沿用已验证的双镜像发布器，避免新建app-only流程；后继服务只需替换app镜像，lifecycle不因此获准运行。
5. 只推两个新immutable tag：`app-sha10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2-r38803364109-a1` 和相同后缀的 `lifecycle-...`；不覆盖或删除旧tag。发布前独立核对ZIP/receipt/scan/image bytes、加载后config digest和source label；然后独立读回registry/config digest和BASIC扫描，HIGH/CRITICAL均0才可用于后续部署。
6. 成功或失败后立即按原deny-all模板Source Revoke，再另起Inspect确认Locked。直接控制器最多两次UpdateStack提交（Grant/Revoke）和一次GitHub dispatch；Docker最多两次push命令，其内部分层上传涉及多次服务API，不把它说成“总共两次AWS写”。

本清单明确排除：ECS/CFN workload/ALB/DNS创建更新、Cell/数据库重建、Secret值或原bundle读取、Aurora/Neon SQL、商户provision、deployment/job/lease/epoch/ready写、baseline上传、删除资源或任何自动补齐/重试。现有服务和旧镜像保持。

## 真实候选和只读证据

[修复提交的Backend CI 38803364335](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38803364335)及[双候选38803364109](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38803364109)均success。准确app/lifecycle job分别116657830679/116657831073；从完成job的结构化JSON日志得到receipt SHA、image config和完整OS扫描摘要，并核对authenticated artifact元数据，没有本地安装Docker或下载大镜像。

- app：artifact `12005571375`，ZIP digest `sha256:d6de76c8501e3eee67254cccc075f7bbed8f3eb515dc33e342721b4bba65f248`；config digest `sha256:74d083066dd15c62e006cf9ad7154f1a2727e693fae4a47bffc0af0b109c63dd`；receipt `b56c6c93ab7344940622fd068f0d4a7e2017c198d2ab234c522286c883955a6c`。
- lifecycle：artifact `12004808747`，ZIP digest `sha256:793e4906618cffe5d1827c2bc0772f665e33cf15fbaba2a3257927f008b6ab24`；config digest `sha256:56acf24122f879e27825a17d177e1a82011e8635aff62efdf351c590d806dcf2`；receipt `a7a9c5e21ce218d8100a79dafbd931f845ac5b259ed9937a40c335c18b0680cb`。
- artifact分别到UTC10月16日20:37:51/43；OS扫描库2026-10-15 19:09:25.631494278 UTC，HIGH/CRITICAL0，原Trivy0.75.0及48小时新鲜度门禁保持。这些不是registry manifest digest，也不替代获得批准后promotion prepare对下载字节的独立校验。

20:48:48.465 UTC只读Review r2完成：新manifest/executor/template本地验证、原IAM完整Locked及v8/v7v8/物理IDs核对、Source CLI Login当前>=120秒可自动刷新证明、补充7条只读CLI核对IMMUTABLE/scanOnPush/BASIC、两个tag缺席、原workload栈CREATE_COMPLETE及service desired1/running1/pending0/原task definition:1和旧app5e42b2de…保持。没有SQL、应用调用、秘密值读取、执行槽或写入。

Source证明只说明观察时可用，不能保证未来撤权时仍有效。包装器r1曾因原控制器输出“verify一行JSON+review一份JSON”被单JSON parser拒绝；其写和槽均0，记录保留。r2仅修只读包装器解析，不改变发布执行器或为此新增写许可。

14项发布/候选定向回归、完整311项服务端测试、types/build、Node/PowerShell语法检查通过。覆盖准确ID漂移/错误版本/旧schema边界、历史字节、固定模板、到期/候选hash及立即撤权路径；单测不是实际Grant或ECR发布成功证明。当前发布控制提交与镜像source提交分开，CI构造的新镜像不自动替换已批准候选。

发布控制提交为 `a9cd71fafea024dc2214637bc414caab9318bfc4`，已推送服务端origin/main；其[Backend CI 38805489073](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38805489073)的check `116665124899`、docker `116665125141`均success。没有触发新候选构建或手动发布；仍提升原10fe3c4…候选，不把控制HEAD冒充镜像源码。

## 完整风险（确认本SHA时一并接受）

- IAM、GitHub、ECR、撤权不是一个事务。Grant/dispatch/push响应丢失或部分失败可能遗留镜像或临时权限；不自动重发脚本/dispatch/push、不回滚、补齐、清槽或延长窗口。底层服务/工具调用不是跨服务exactly-once保证。撤权失败必须立即处理，不能再Grant。
- CloudFormation更新/撤权可能清理旧nondefault policy versions，包括v7/v8；本地保存文档不能恢复已删除的云version ID。仅接受这个既有栈的正常副作用，不授权删除其它资源。
- AWS OIDC trust限制repo main，而不是单workflow；窗口内其他main工作流可能尝试承担角色。IAM能力限制仓库和region，但不是两个tag的服务端白名单；两个tag/一次运行由受审执行器约束，不能消除并发/管理员变更或传播风险。新RoleId/PolicyId检查也不是CAS。
- Source AWS CLI Login保留自动刷新，Grant/Revoke前核对当前凭据>=120秒与准确身份，不导出密钥到环境；不保证外层Login session期限或未来刷新/撤权成功。Inspect不能因旧安装期过期而禁止必要的只读Locked核验。
- GitHub候选是短期保存，scan结果有时点局限；后继下载/加载后发现不符即停止，不以日志代替真实字节，不关闭TLS、扫描、receipt或来源门禁。
- 费用低但不是绝对零。新镜像占已有ECR存储，可能有适用传输费用；撤权不删除镜像。沿用1GB约0.10USD/月的**规划留额**，不是加拿大区域/本账户精确账单或上限，不依赖credits/free tier；[AWS官方ECR计费与示例](https://aws.amazon.com/ecr/pricing/)。50USD/月是目标非cap。本次不新增计算资源，但原ALB/数据库/运行中的Fargate仍计费，旧父/child标签不会自动停费；本清单不授权暂停或删除它们。

## 批准后及下一步

准确批准后才执行一次：

```powershell
pwsh -NoProfile -File scripts/publication/run-reviewed-ecr-republish.ps1 `
  -Mode RunReviewed `
  -ApprovedManifestSha 1d6b5415c3498e0a1e16add63b0b914215343bde51c2db05a75b47788de68ef1
```

必须先确认服务端main/remote一致和全部executor/template hashes未变；已有目录占用、前态漂移或过期则停止，不重放。结束后独立Inspect核对Locked，并独立ECR回读真实manifest digest/扫描。

随后直接准备“原workload更新到该app registry digest”的窄清单，不重新claim/epoch/创建Cell/数据库。恢复provision之前仍须另获批准的只读证据确认第一次500后的实际状态与lease/幂等坐标；不能从ROLLBACK代码或剩余槽推导可再POST，也不能提前补写ready。

[版本化非秘密待审摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5i-publication.prepared.json)保存准确文件hash；旧批准、Grant/Revoke模板及C5h2部分执行证据不改写。
