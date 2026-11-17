# D2-6 步骤3：初始A发布及A/B目录登记集中审批

2026-11-17，America/Winnipeg。**本文件只是待审材料，不批准读取凭据、调度、ECR推送、SQL登记或恢复环境。**准确范围以 [`d2-6-publication-catalog.review.json`](../ops/releases/d2-6-publication-catalog.review.json) 的规范JSON SHA为准；原prepared草案保留追溯，不能执行。

## 已具备的材料

用户刷新Source并批准新c轮后，[集中只读结果](aws-instance-release-publication-preflight-verified-20261117.json)实际通过：2026-11-17T18:46:21.274Z–18:46:40.789Z，STS1、AWS元数据11、GitHub GET10、现有Git helper1；Secret值/配置/PAT/PEM/ZIP/SQL/云写/执行槽/dispatch均0。准确IAM用户、原publisher角色/唯一v1策略、不可变ECR仓库、固定token Secret版本、S3版本控制及本人environment/main/OIDC匹配，A标签及候选全局push槽均不存在。a/b失败记录保留，不再重读整批对象。

复用已通过的源码 `b1e1ebd773e2b110129a2307bfcb55aae52bbaa5` 和 [CI44139556595](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44139556595)：239项Linux＋10项临时PG16全过，15项实际源码指纹匹配。本轮不编码、不重跑回归或重构建；两份原验证回执SHA及candidate纯校验通过，没有重读镜像ZIP。

## 唯一目标和准确来源

| 版本 | 已有原件 | 本次实际操作 |
| --- | --- | --- |
| A `d2-6-a-b9ca2138-r44128576107` | 后端run44128576107 / artifact14347858874，config `sha256:ad65fdf4dd998f960274adf308a9f7b8baeba6d845309ad21529062b50b4d2eb` | 只发布此app到现有 `techlong-sandbox-speedfeast` 的原清单不可变tag；以真实原始ECR manifest核验并登记 `release_00b9c5cfa6bceedc5fd05aa451dca811` / ecr_verified |
| B `d2-6-b-b9ca2138-r44129167654` | 后端run44129167654 / artifact14349965129，config `sha256:fee49b1473042adb987cf0acaef4fd443b6166b65aab1cc389c53403a2afed6b` | 仅登记原 `release_afcc95f9eaa20785265300c801fd7618` / candidate；不下载或推送B，保留未来A→B同审批晋升 |

源均为后端main `b9ca2138738900afc23a6a2ddce141b37a1f0a31` / attempt1。原ZIP、archive、candidate、产品/兼容策略和15项代码摘要全部绑定在JSON，不把config digest冒充registry digest。当前registry/platform digest仍null，**只允许既有校验器从本次真实A发布结果确定性派生**。

## 执行顺序：一次聊天确认、一次本人GitHub门禁

1. 只在批准后校验外层SHA、准确代码/来源、原件和期限。将本机已备的准确BootstrapReview数据复制到 `ops/releases/bootstrap.review.json`，仅此数据文件提交/推送main；不改代码、daily runtime或工作流。新数据含Account ID/ARN、固定版本引用及非秘密GitHub元数据，不含token、receipt/self-check原文或业务快照。
2. 单次调度现有 `.github/workflows/instance-release-bootstrap.yml`，输入准确内部review SHA。绑定真实run/attempt/source/actor；提交不明或无法唯一识别run即停，不第二次POST。API确认门禁就绪后通知用户，**由用户本人批准** `techlong-sandbox-deploy`，无需Web实例页审批。
3. 现有job核对本人审批，OIDC只取得原publisher角色；只读一次准确build-read Secret固定版本，仅向GitHub官方鉴权。一次下载并再次验证A原ZIP，自检/扫描/源码任一不符即停；验证tag未占用后，只做一次Docker push，不构建/运行应用容器或推lifecycle/B。
4. 既有代码写最多3个条件审计对象（intent/push/published），读取原始ECR manifest并保存小型proof artifact。由本机新Source核对后，读取准确proof及最多两个已ACK的固定S3版本，核对SHA/run/source/原候选；独立重算A release。这是认证证据重读和纯校验，不冒称又查了一轮当前ECR。
5. 仅从真实A结果＋原B派生私有 `BootstrapCatalogInput`；复用 `prepare-bootstrap` 生成内部登记SHA，随后按外层批准运行 `register-bootstrap` 一次。**外层批准仅委托这条固定派生规则，不允许自由填写版本、digest、目标库或扩大SQL；完全匹配时无需再等第二次聊天批准。**
6. 读取现有 `.env.local` 一次，验证TLS后由一条writer连接分别提交A/B不可变INSERT；关闭writer，以第二条独立连接核对尝试过的行。A失败/提交不明不继续B；匹配的读回不能抹去未知COMMIT。原端口仅允许完整相同的既有A返回已登记，任何不同文档/状态/撤销冲突停止。
7. 准确run终止或确定从未调度后，将**仅bootstrap review**恢复原disabled值，最多一次main提交/推送；不覆盖并发改动、不强推或清理云资源。保存实际阶段结果，停止在步骤3；初始实例绑定、环境恢复、持久化和runtime启用另审。

## 本次待批上限

- 本机：Source STS最多2；GitHub API GET最多36（含准确run轮询最多24、间隔至少90秒，门禁读取最多3）；helper1；workflow POST1；小proof ZIP1/≤4MiB；固定S3版本GET2/各≤4MiB。不重复c轮11项云盘点，不读本机PAT/PEM或Secret值。
- 云job：25分钟；GitHub API GET4（本人审批1、准确A run/artifact/下载跳转3），官方blob下载1/≤500MiB；OIDC请求1、AssumeRole1、STS1、固定Secret值读取1；ECR CLI最多8；Docker load/inspect/login/tag/push各最多1；条件S3 PUT最多3，小proof artifact1/保留7天。
- 登记：配置全文件读取1、验证TLS连接2、SQL提交最多64、INSERT最多2/目录行最多2；writer两个独立事务、inspection最多两个独立事务，10分钟内且不越总截止。**独立inspection包含临时角色membership写，不是纯只读事务。** 不改schema/LOGIN/Secret、已有业务/实例绑定或目录旧行，不增加权限资源。
- Git：准确数据激活提交/推送1次、准确关闭提交/推送最多1次；可能正常触发无AWS CI，不修改已过CI源码。daily runtime始终disabled；不使用旧两镜像临时Grant/Revoke路径。

## 时序

新c事实自 **2026-11-17T18:46:21.276Z** 起最多5小时，截止 **23:46:21.276Z＝温尼伯11月17日17:46:21**。整轮最多60分钟，因此最晚启动 **22:46:21.276Z＝16:46:21**；发布job25分钟、登记10分钟仍受共同截止约束。截止是新操作时限，不是资源自动停费时间。

A/B原artifact分别于11月18日16:42:02Z / 16:45:19Z到期，原扫描48小时规则独立，日期不变。新c只更新真实重读的元数据事实，不给旧构建/扫描/身份安装或数据库证明续期。排队、审批或故障超出时限即停；不自动延长、重构建、重派或重放旧批准。

## 完整风险及失败处置

- ECR层/manifest、GitHub运行分钟/产物、S3审计与传输会产生潜在费用。没有恢复ALB、ECS任务或RDS，但不承诺零费用或50USD硬限额。
- 一次Docker push对应多次层和manifest API写入；Docker传输层可能内部重试。operator不会重新发push；失败/未知时可能留下已收费层、完整镜像或审计对象，固定槽不复位，不自动删除/补齐/回滚。
- Git凭据、云OIDC/临时AWS凭据、固定build-read token进入相应进程内存；原包进入runner私有磁盘。只向官方API发送token，不转给签名blob站点、不保存签名URL。提供者、网络和runner日志风险不能消除，不输出凭据或原始私密错误。
- 目录登记使用权限较宽的现有owner配置；整份配置进内存，提供者日志可能保留语句或凭据材料。临时owner角色的SET/INHERIT须正常闭合，但跨事务/连接失败可能遗留未完成状态；创建者ADMIN保留。inspection同样有临时membership写，不能冒称所有核验均无副作用。
- A发布、A登记、B登记、独立核验及Git关闭不是分布式原子操作。可能只有A镜像、只有A目录或部分核验完成。提交不明保留原意图和ACK，不自动INSERT重试，不因读到相同数据就将未知写标成功，也不自动恢复/补偿。
- 任何已有tag/永久push槽、来源/代码不符、权限/配置变化、非准确目录冲突均停止，不扩权或改旧记录凑通过。关闭bootstrap数据若碰到并发修改也停止，不覆盖它；已批准run/旧source及永久槽保留。
- 本次目录兼容字段只是已审核的产品要求，不证明当前数据库/schema/API或媒体迁移已验收。持久化、初始绑定和恢复后准入仍是后续实际两次更新的门槛；不得靠登记候选绕过。真实更新仍0/2，不能说D2-6完成。

本轮只完成已批准的限定读取和待审材料。未复制激活配置、未派发发布、未读取Secret值/私密配置、未连接数据库、未推送镜像或登记目录，收费环境未恢复。
