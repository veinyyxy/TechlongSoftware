# 支付后待开通实例：现状与首次自动开通计划

<a id="first-onboarding-plan"></a>

## 缺口 3 实施计划：新客户首次自动开通

**状态：第 1–3 步已离线实现；第 4 步审批草案已备，尚未实际开通。** [D2 日常版本发布](aws-instance-version-release-plan.md#d2-closeout)已结案。本项补齐从普通购买产生的新实例到第一版可用服务的链路；首开完成后，该实例才能交给 D2 更新。执行与授权以[主线手册](aws-auto-deployment-execution-runbook.md)为准。

<a id="first-onboarding-fc41597f-execution-preparation"></a>

### `job_fc41597f9b5ba8e02b338ecf`：权限、原设施恢复与单次首开的集中审批材料

**2026-11-19（温尼伯）｜原候选与资源上限，未执行。** 当前顺序和待批范围以[最新集中审批清单](#first-onboarding-fc41597f-approval-checklist)为准；本节及[此前首开草案](aws-sandbox-first-onboarding-fc41597f-review.md)保留原证据和上限，不是重复读取、复制或执行的授权。原测试订单已付款；11 月 18 日 21:56:11 的已存回读为同一实例和订阅仅一条待审任务，`pending / 0/1 / 无租约`。只限 `402010193138 / ca-central-1 / cell-sandbox-1 / g1`，实例 `app_bbd626d7d3806af686073211`、部署 `dep_746535593025bf97a9efeccd`；复用原订阅，不购买、不重放回调。

**原两小时承载窗口已过，不重放。** [持久化登记](../lib/deployments/first-onboarding.ts#L56)在付款事务内以数据库时钟写入部署 `created_at`，因此其时间不晚于已观察到这条部署的 21:56:11；受审 sandbox 的 [TTL 是 7,200 秒](../lib/deployments/environment.ts#L170)，实际到期不晚于当晚 **23:56:11**（上述回读为秒级记录）。[worker](../lib/deployments/execution/worker.ts#L1460)和[清理就绪门禁](../lib/deployments/execution/single-tenant-workload-strategy.ts#L178)还要求保留 5 分钟余量。精确创建毫秒无需为得出这个结论而补读。重新登录、刷新观测或发新的 `writeBefore` 都不能续原 TTL。保持原行、尝试数和权限不动；不伪造清理回执、不另买或新建任务。后续[独立窗口](#first-onboarding-fc41597f-controlled-window)已离线接线，但尚未设定或批准实际日期。

#### 审批包 A：只安装缺少的、可核对的最小权限

| 边界 | 候选安装范围及必须取得的回执 |
| --- | --- |
| **领取、执行、完成分权** | [领取 SQL](../lib/deployments/execution/first-onboarding-claim-entry.ts)限准确任务；`techlong_first_onboarding_claim.review()`／`release()` 与 `claim()` 分给不同 LOGIN。[完成 SQL](../lib/deployments/execution/first-onboarding-completion-entry.ts)的 `complete()` 与 `inspect()` 再分写、读 LOGIN。每组仅受限 `NOLOGIN` definer 持必需列级权限；运行者无底表写、owner、普通队列或角色管理权。固定实际计划/配置 SHA、最终批准和截止后再生成准确 DDL；实际执行身份还须覆盖该任务的容量、租约、围栏、步骤和一次配置调用。仓库已有窄端口接口，不等于生产适配已绑定。核验 schema/函数所有者、锁定 `search_path`、函数摘要、撤销 PUBLIC 和角色继承/互斥，不调用领取或完成写入来测试。 |
| **AWS 投递及执行** | 复用[窄策略草案](../lib/deployments/execution/first-onboarding-run-permissions.ts)，源为准确 `TechlongSandboxProvisionerRole`，仅对 `techlong-sandbox-tenant-d3806af686073211` 读回与一次带准确标签的 `CreateStack`；只传给 `TechlongSandboxCloudFormationExecutionRole`。CFN 只准本次七项及另批托管回滚，ECS `PassRole` 只给 `TechlongSandboxTaskExecutionRole` 和 `TechlongSandboxFirstOpen-e9fdccd5d8c7685c`。监听规则授权须等 B 的两条真实监听器 ARN，不能先给通配权限或借旧 ARN。最终材料须核有效 trust、边界与安装差异，并有独立回读；不授予执行者 IAM 写、通用栈更新或删除。 |
| **生命周期、应用、凭据及核验** | `TechlongSandboxTenantLifecycleTaskRole` 只需原集群的 `postgres` 管理连接和[已核验两份副本](evidence/sandbox-first-open-baseline-copy-fc41597f-continuation.verified.json)逐键逐版本的两条 `s3:GetObjectVersion`，无列表或 latest 回退。应用身份只准 `tenant_e9fdccd5d8c7685c_role` IAM 登录和本桶 `products/*` 的必要动作。供给身份仅创建一次 `techlong/sandbox/tenant/appbbd626d7d3806af686073211_e9fdccd5d8/runtime/g1` 初始 Secret；执行身份只取固定控制公钥和该 g1 的准确固定版本，另加原镜像仓库拉取和本栈日志。实际 g1 ARN/版本由当次 ACK 和独立元数据证明；若不能在领取前证明后续固定注入有受审权限路径，就不领取。独立核验用 `TechlongSandboxFirstOpenInspector` 与分离的目标库只读登录，无旧 D2 角色、Secret 正文或云写。 |

#### 审批包 B：只恢复原 Express 与原共享 Cell，准备隔离存储和准确 DNS

- **Express：** 仅 `techlong-sandbox-express-d001`，物理 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，原 writer `techlong-sandbox-express-d001-instance-1`。准确匹配且实际 `stopped` 时最多一次 `StartDBCluster`，不单起 writer；已 `available` 且匹配则不写。独立验原集群和 writer 均 `available`、端点归属、PG17.9、IAM auth 和 TLS。历史停止证据不是当前状态；不启动 `speedfeast-postgres-prod` 或另建集群。
- **Cell：** 仅原栈 `techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`。复用[已存四 Add 差异](#first-onboarding-step4-install-restore-facts)和[原候选模板](../ops/deployment-baseline/cell-reattach-draft.template.json)，不复用旧变更集或监听器。若仍是准确 12 项且无未决操作，最多创建、执行各一次普通 UPDATE Change Set；只 Add `CellLoadBalancer`、`BusinessHttpsListener`、`ControlMtlsListener`、`BusinessControlDenyRule` 并恢复两个监听器输出。执行前核对准确差异和回滚选项；回读同栈 `UPDATE_COMPLETE`、原 12 个物理 ID 未变、共 16 项、同一 ALB 的 443/8443、原证书和 8443 `verify` mTLS/原 trust store、443 拒绝规则。已准确恢复则跳过写；不符即停，不直接建 ELB。
- **首开所用存储/DNS 是单列候选，不属于 Cell 恢复变更。** 若无合格的本租户存储，最多一个五资源存储栈：私有版本化桶 `techlong-sandbox-tenant-images-402010193138-e9fdccd5d8c7685c`、桶策略、OAC、分发和响应头策略。核准准确 `products/*`、Public Access Block、SSE-S3、TLS、准确 OAC 和分发 `Deployed`，不迁图片。公共 zone `Z01473621BTTHKXBGOOEJ` 只对 `pending-app-bbd626d7d3806af686073211.sandbox.techlong.cloud` 候选一次 A Alias `CREATE`，目标只能来自上述独立 ALB 回执；记录已精确匹配则跳过，冲突停、不 `UPSERT`。真实 443 的 100/101、8443 的 100 必须空闲，不挪旧规则。

#### 审批包 C：只领取和部署一次；独立技术核验通过才激活

1. **领取前**：独立确认任务仍 `pending/0/1`、无租约、前代/外部操作/初始绑定，订阅覆盖整段批准窗口；计划、配置、版本 A、账号、容量及目标空位匹配。同一新任务/库/角色的隔离空库能力、实际角色与端口、清理就绪及所有期限先就绪；不靠领取来探测能力。新期限未另审前绝不开放领取。
2. **单次部署**：同一 g1 下最多一次领取；按现有顺序一次 g1 Secret 初始供给、一次 V3 prepare（新库 `tenant_e9fdccd5d8c7685c_db`、目标 SQL 角色和临时 NOLOGIN guard）、一次 schema-only 恢复（固定版本 GET 各最多一次，在恢复端复算 SHA-256，不落客户数据）、一组 SaaS 迁移、一次精确应用登录激活。不能连旧租户库，不改其它库的 PUBLIC ACL。之后只一次 `CreateStack`，七项为 ECS 服务、任务定义、目标组、三条监听规则和日志组；固定 [A](aws-instance-release-initial-publication-observed-20261117.json)（`release_00b9c5cfa6bceedc5fd05aa451dca811` / `sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0` / `linux/amd64`），Fargate 期望 1，固定公钥/g1 Secret，`IMAGE_STORAGE_PROVIDER=s3` 且 `ALLOW_EPHEMERAL_IMAGE_STORAGE=false`。一次受限实例配置；不领养同名栈、不更新补救、不启动普通队列。
3. **独立核验**：分离角色最多 24 次有边界的 AWS 元数据调用（身份另计），只在目标库做一次验证 TLS 的只读身份/元数据核对，再对准确 hostname 各一次 `/health`、`/ready`。确认 `CREATE_COMPLETE` 与七项真实物理归属、Alias/两监听器路由与目标健康、ECS 1 运行 0 待启动、实际 A digest 与固定两 Secret、私有桶/CDN 配置；库与角色 OID、owner/g1 围栏、恢复摘要、迁移、隔离和兼容性均与独立证据相符。提交方 ACK、历史容量或仅 HTTP 200 均不足。不代做用户业务验收。
4. **原子激活**：只在独立 checkpoint、同任务审批与初始绑定摘要、有效订阅/租约/g1 围栏及无已存在 D2 状态全部匹配后，调用 `complete` 一次。单事务：实例 `active` 并填核验过的 HTTPS 入口、部署 `ready`、任务 `succeeded` 并释放租约，插入 D2 初始版本 **A / revision 0 / 无活动请求**。再用不同 Neon LOGIN 调 `inspect` 一次，读回同实例、revision 0 和同一次完成证据，才可报告已开通。拒绝/结果不明时停；若已收到提交 ACK 但独立回读失败，仅记「已提交，未验收」，不重发完成。

**前置次序及停点。** 先解决[同一待审任务的独立受控窗口](#first-onboarding-fc41597f-controlled-window)。解决后再复用原证据，只补会改变执行决策的缺项：实际选用的窄身份/适配、准确的 A 目录与镜像、该任务/名称/容量的准入、原 Express/Cell 实态和恢复后的物理引用。先离线备齐不依赖实际监听器的权限材料，再另批 B；只从 B 的独立回执派生 ARN。前置值齐全后冻结 C 的审批体 SHA、调用预算、实际端口和截止，用该 SHA/时限生成 A 的领取和完成 DDL；冻结摘要不是执行授权。A 另批安装并独立回读、剩余时间足够且 C 单独获批后，才可领取。已存历史窗口和批准不重放，旧基线复制不重复。GitHub environment 如使用由用户本人批准。CFN、Aurora、Neon 跨服务非原子，部分结果可能持续计费；异常保留回执及槽，不自动重试、清理或回滚（另批的 CFN 托管回滚除外）。**本轮仅本机编制及核对：AWS、数据库、Stripe、镜像发布、权限安装、恢复、领取、部署均为 0。**

<a id="first-onboarding-fc41597f-controlled-window"></a>

#### 时序审定：为原待审任务增加一次独立的首开窗口

**已实现最小时序接线；尚无实际执行日期或授权。** 不改变旧窗口的结论，也不改付款、订阅、实例、部署或任务的原始记录。单独在这一条任务的受审执行材料中固定一个新的执行起点和截止，保留原 `created_at`、`available_at`、payload、去重键和 `maxAttempts=1`。新窗口不重新派生 job 或 g1，不添加队列、数据库表、到期作业或通用续期入口。原任务今后只有经实际批准并成功领取时才按原规则发生状态转换。

1. **一个审批体，三个绝对时点。** 将 `startAt`（最早开始）、`claimBefore`（最晚领取，不含该时刻）、`writeBefore`（执行硬截止，不含该时刻）和 `workloadExpiresAt = startAt + 7,200 秒` 一起纳入同一受审 SHA。`startAt` 用整秒 UTC，三个关口须满足 `startAt < claimBefore < writeBefore`，领取截止与执行截止之间至少留 10 分钟，实际清单可按核验及完成所需时长再留更多；`writeBefore` 不晚于 `startAt + 1 小时`、承载到期前 5 分钟和所有适用事实的原截止。订阅须覆盖 `writeBefore`。固定实际任务、部署、实例、订阅／工作区摘要、环境／账号／区域、g1、原计划和配置摘要、版本 A、两份基线版本及清理准入证据。只接受可信批准入口交付的 SHA，不接受执行者自行提交一个新摘要；时间不能取进程启动时刻、刷新时刻或签核后的滚动 `now + TTL`。本轮不设置任何实际日期。
2. **窗口只进入现有单次入口，期限不合格时不占槽。** [入口](../lib/deployments/execution/first-onboarding-run-once.ts)在连接运行端口前拒绝错任务、错 SHA 或窗口不符。领取前读取原行并核对 `pending / 0/1 / 无租约`、无前代/外部操作/绑定及独立、准确的清理责任证据，不以领取成功来代替预检。复用[窄领取 SQL](../lib/deployments/execution/first-onboarding-claim-entry.ts)：生成时锁定审批 SHA 和时点，在[同一次行锁后的数据库时钟比较](../lib/deployments/first-onboarding.ts#L185)再拒绝 `now < startAt` 或 `now >= claimBefore`，不能只在进入 SQL 时检查。保留原子 `attempts=0→1`、精确行比较和 `leaseExpiresAt=writeBefore`。时间不足、权限或证据不齐，领取为 0；领取或外部写结果不明则停，不以另一窗口重试。
3. **同一份承载到期值贯穿建栈和清理。** 最小接线点为[建栈前检查](../lib/deployments/execution/worker.ts#L1460)、[清理就绪及渲染绑定](../lib/deployments/execution/single-tenant-workload-strategy.ts#L174)、[栈 `ExpiresAt` 标签的来源](../lib/deployments/cloudformation/tenant-stack.ts#L245)。这三个点必须只在准确首开分支使用同一个已校验 `workloadExpiresAt`，且有足够时间、清理证据新鲜、到期值与 CFN 标签一致；普通 worker、历史渲染和 D2 仍使用原逻辑。`requestedAt` 和持久化的创建时间保持原意，不用假时间或修改环境 TTL 绕过剩余检查。若影响清理证据，须绑定同一任务、审批和实际原设施归属；不得更改共享 Cell / Express 的原期限。`ExpiresAt` 只表示受控承载期限，**不保证自动停费**；当前七项受控模板没有清理调度，到期不授权删除或补偿。独立技术回读确认实际标签，原子 `complete` 及分离的 `inspect` 仍限同一审批、围栏与期限。

不选三条捷径：改 `created_at`／环境 TTL 会改写已有事实或影响其它任务；只改 `writeBefore` 仍会被旧建栈和清理门禁拒绝；新购买、重新登记或复位尝试会破坏原支付到唯一任务的绑定。获准编码后只做本任务的时钟接线和离线回归：旧 `created_at` 保持不变、合格新窗口只领一次；提前／到边界／过期、两端时钟偏差或行锁等到截止、跨任务或摘要篡改、清理证据/`ExpiresAt` 不符时停止；旧路径的标签、期限以及普通队列关闭状态保持不变。

**离线验证通过：** 106 项 Node 回归、TypeScript 和定向 lint 通过。独立创建的本机 PostgreSQL 15.3（仅回环）亦通过一次真实 DDL／领取回归，包括错环境 TTL 拒绝、模拟行锁后恰到截止拒领、成功后拒绝重领、旧 `created_at` 保留；临时实例已停止并清理。未生成可执行 SHA，未设真实窗口、未改任何真实记录，也未调用 AWS、Neon、Aurora 或 Stripe。真实适配、权限安装、原设施恢复、实际时序和首开仍分别审批。

<a id="first-onboarding-fc41597f-port-approval"></a>

#### 审批清单：真实执行接线、剩余权限和恢复前置

**第 1 项已按批准离线验证；第 2–4 项尚未实际执行。** 范围仍限 `job_fc41597f9b5ba8e02b338ecf` 对应的同一已付款实例和 g1。复用 [固定版本回执](evidence/sandbox-first-open-baseline-copy-fc41597f-continuation.verified.json)、[首版 A](aws-instance-release-initial-publication-observed-20261117.json)、[原 Cell 四项差异和角色证据](#first-onboarding-step4-install-restore-facts)和 `ad4118f` 的时序回归。历史回执不充当当前权限、归属或可用性证明；不重复制基线、不重查已完成的全量清单。手册既有 A/B/C 的资源上限仍适用。

**1. 可先批准：只接现有单次入口所需的真实适配，不运行。** 复用 [单任务入口](../lib/deployments/execution/first-onboarding-run-once.ts)，只为其装配下表能力。不建通用执行器、不调用旧任务固定 launcher、不打开 `claimNext`，也不改当前客户平台或 D2 工作流。实参以固定、可审核的接线输入接收，不读本机真实 `.env` 或凭据。此项验证只能用注入的测试实现和隔离数据库，不去 AWS/Neon/Express 试错。

| 注入端口 | 可复用的实现及待补判定 |
| --- | --- |
| `readHeldJob` / `readFixedRelease` / `claimHeldJob`；`complete` / `inspect` | 复用 [领取 RPC](../lib/deployments/execution/first-onboarding-claim-entry.ts)和[完成/回读 RPC](../lib/deployments/execution/first-onboarding-completion-entry.ts)，分别用读取、领取、完成、回读四条受限会话。接线接收已签核 SHA 和确切连接引用；只核对 RPC 调用、分权与拒绝行为。真实登录、函数归属、摘要及 ACL 未证明，不假定已装。 |
| `repository` / `provisionEpoch` | 列准原任务的 `loadContext`、容量预留、心跳、状态／步骤、g1 检查点和所有权围栏。复用 [Neon 查询逻辑](../lib/deployments/execution/neon-repository.ts)与[围栏协调器](../lib/deployments/execution/external-ownership-coordinator.ts)，但原始表查询和旧固定镜像适配不等于新任务拥有窄执行权限；实际未覆盖的操作才另列最小受限函数和相应证据。若选用外部 authority，必须先锁定实际表/准确租户键、拒绝跨租户和当次证据；不默认建表或开整表写。 |
| `cloud` / `cellPreflight` / `control` | 复用 [AWS SDK 适配](../lib/deployments/execution/aws-sdk-adapter.ts)的只读和 create-only 调用、[mTLS Control 客户端](../lib/deployments/execution/control-client.ts)和[固定模板 payload 编译器](../lib/deployments/execution/control-payload.ts)。窗口内只读目标栈（入口代码上限 120，执行清单给出实际预算）、一次准确 `CreateStack`、一次本实例配置写；不得把 SDK 默认身份、旧角色权限或旧 ALB 参照当已绑定。真实会话、模板及 Control TLS/身份材料按固定引用审批；不读取或替换已有凭据来探测。 |
| `verifyEmptyExpressCapability` / `express.database` / `express.secret` | [现有 Express 编排](../lib/deployments/execution/first-onboarding-express.ts)接[V3 初始化](../lib/deployments/execution/aurora-express-bootstrap-v3.ts)、两份固定版本恢复、迁移、IAM 登录激活和目标库读回。已有同集群历史验证只支持选择实现，不支持认定新库空闲或已隔离；旧通用 lifecycle 仅比对摘要，不替代本任务的两个 VersionId 约束。运行 Secret 材料只允许未来清单列准的供给来源和服务身份，不取旧租户 Secret，不把内容落盘。 |
| `cleanupReadiness` / 独立技术核验 | 在领取前只读生成 `verifyBeforeClaim` 回执，领取后及写入前继续走既有清理核对；固定同一 scope、清理权限证据、原 Cell 与 `workloadExpiresAt`。独立技术端使用 [只读适配](../lib/deployments/execution/first-onboarding-reader.ts)，只限 `TechlongSandboxFirstOpenInspector` 与独立 Aurora 只读会话。失败无领取、无假回执；真实采样和权限另审。 |

**离线放行标准：** 同一有效、已审输入在测试端口中能从原 held 任务走到一次领取和一次 create-only 调用，独立检查点后才调用完成；错任务、旧窗口、证据不符、g1 授权未就绪或未知 ACK 不调用后继写。所有正式连接仍未启用。最小入口、防护和定向回归若不能复用既有模块，停止并列出确切缺项，不改 liveness、全队列或业务功能来绕过。

**第 1 项回执：** [单次装配入口](../lib/deployments/execution/first-onboarding-run-composition.ts)接受现有适配的注入端口，不自行取凭据或建立连接。领取前由原 `pending/0/1` 投影推导 g1/e1，复用运行时身份、操作哈希和 Secret 版本算法；独立有效授权证据须与同一批准 SHA、ECS 执行角色和准确声明摘要相符，实际围栏和创建请求须匹配预计值。109 项 Node 回归、两项隔离 PostgreSQL 领取／原子完成回归、类型检查和定向 lint 通过。固定任务模拟完成一次领取和一次 create-only 调用；没有 A 原始清单字节时拒绝完成，未绕过 digest 校验。独立验证后的正向完成及 revision 0 回读另由现有合成 fixture 和隔离 PostgreSQL 证明；不是该固定任务的线上技术验收。临时数据库已清理；未访问真实资源或产生执行 SHA。仍待绑定真实中段 SQL／authority、Express 和独立核验端口、实际有效 IAM 与恢复输出。

**2. 剩余权限：仅从上述实际端口收口，不照抄旧角色。** 本轮离线生成并核对了[六块 IAM 草案](../lib/deployments/execution/first-onboarding-run-permissions.ts)：投递、CFN PassRole、Secret 供给、生命周期、应用、ECS 执行。生命周期正好两条固定对象版本读；不查基线最新版本。只列拟补的 trust、边界、ACL、适用时的最小 KMS；检查既有角色的有效权限后只安装缺少项，独立验准入与拒绝范围。Neon 安装清单须单列领取／完成各自的 definer 和 LOGIN、上述中段必要的窄 SQL、源码和生成 DDL 摘要。连接、凭据供给、权限写入和独立回读在实际清单中列准次数，当前不批准。

- **需要先解开的 g1 版本依赖：** `createInitial` 的版本 token 来自现有 `approvalSha256 + 真实名称 + 任务 + active epoch + 基线摘要` 规则；目前策略生成器没有回执时明确返回 `runtimeSecretReadPending`。首选在离线接线时证明空位下 g1 首个 `epoch=1` 可从原任务和不可变计划派生：先冻结首开审批体，再由它与完整预计围栏派生版本；IAM 安装的摘要独立于首开 SHA，避免反向引用。仅可审精确 g1 名和服务发放的物理后缀范围、该唯一 VersionId，实际围栏必须先逐字段匹配预计值才能创建 Secret，随后独立元数据回读实际 ARN/版本。此为候选，不能当作当前 IAM 已可用；若无法证明在领取前就具有有效的固定版本授权，则停，不在领取后临时扩大 IAM，不让 `AWSCURRENT` 或宽通配兜底。
- **真实类型／位置绑定缺项：** 只从 B 的独立回执填两条监听器 ARN 和 Alias 目标；实际角色信任、目标计划/配置、新目标名称空位、基线工具/版本兼容和隔离能力仍需准确证明。历史成功的复制、A 发布和 CFN 模板不重新做；后续若需新读，只查询影响执行的准确对象与必要字段，另审调用预算和事实截止。

**3. 恢复另审，且放到不依赖线上物理值的接线已通过之后。** 只用[审批包 B](#first-onboarding-fc41597f-execution-preparation)的原集群／writer 和原 Cell 栈：原 Express 匹配且 `stopped` 才最多 1 次启动；原 Cell 当前若仍准确为 12 项且无未决操作，才最多 1 次创建及 1 次执行四 Add 变更集。先取得准确只读前置、再核对唯一变更集，同一栈独立回读四项和 443/8443、证书/mTLS、原 12 项物理归属。已完全就绪则跳过写，差异不符不执行。新租户存储、DNS 及依赖新 ARN 的 IAM 是独立差异，不混进恢复，不启动其它栈／数据库。恢复费在资源停止前可能持续，不自动停费。

**4. 实际开窗最后批准。** 只有第 1 项接线合格、2/3 项有效权限与归属已独立回读、准确固定值齐备且真实任务仍 `pending/0/1`，才按[独立窗口规则](#first-onboarding-fc41597f-controlled-window)定实际日期、派生领取/完成 DDL、独立验安装并请本人批准首开 SHA。此次不生成日期或执行 SHA。沿用一次领取、一次七资源创建、独立核验后一次原子完成与一次分离只读回读的门槛；没有 `active`/`ready`/`succeeded` 和 A/revision 0 的独立证据，不报告已开通。

**本轮实际：** 只整理审批清单，并本机核对六块策略、两个版本读权限和原 Cell 资源数。未改运行代码、未读配置/Secret/PEM、未重新盘点或复制，也未访问云、连库、安装、恢复、领取或部署。

<a id="first-onboarding-fc41597f-approval-checklist"></a>

#### `fc41597f` 集中审批清单：真实执行接线 → 补权与恢复 → 单次首开

**状态：待审批，禁止执行；本轮没有新线上事实、实际窗口或执行 SHA。** 这是一份有明确执行顺序和停点的集中清单，不是已就绪的部署输入。原任务不换、不重建，原窗口和槽不延长、不复位。新读取、安装、恢复、首开在此同一清单内分段签核，前一段批准不授权后一段。只有下列待填字段有原件、独立回执和准确预算支撑时，才封存对应执行输入；不能把 `NO_GO` 或本文档摘要当成执行 SHA。

**已锁定，不重新盘点：** `job_fc41597f9b5ba8e02b338ecf` / `dep_746535593025bf97a9efeccd` / `app_bbd626d7d3806af686073211` / `sub_f0dea547d45bcd26ed823fd7`；`402010193138 / ca-central-1 / cell-sandbox-1 / g1`，工作区按[源码中的固定摘要](../lib/deployments/execution/first-onboarding-run-once.ts)匹配。[两份基线回执](evidence/sandbox-first-open-baseline-copy-fc41597f-continuation.verified.json)逐键固定原大小、SHA 和 VersionId（dump `F0IEF0BdsnrwTj6lhYHNeBSbzsz7Sx7K`，manifest `FYqR4mLX2pK3tcQjbyW1UtoJ1.LX3dFc`），不重复复制、HEAD 或下载来做准备。[可信 A](aws-instance-release-initial-publication-observed-20261117.json) 固定 `release_00b9c5cfa6bceedc5fd05aa451dca811`、`sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0` 和 `linux/amd64`；只引用目录证据，不构建、晋升或重写目录。[装配验证回执](#first-onboarding-fc41597f-port-approval)对应代码 `65b80a4`，109 项本机和 2 项隔离 PostgreSQL 回归通过；不把它当成线上权限、当前任务状态或 GitHub CI 回执。

##### 1．真实运行入口与最小余权：只绑定下列端口

候选入口是**本机受审操作者单次调用** `bindSandboxFirstOpenRunOnce(...)()`，不由平台 Web、支付回调或普通 worker 调度。装配函数已存在，但没有绑定该任务的真实操作入口、隔离身份或运行收据。本清单不新增 GitHub 工作流；若实际环境要求改由 GitHub 执行，须先绑定准确不可变入口及角色，且 environment 仍由用户本人批准。不得借旧恢复脚本、平台 owner 或默认 SDK 凭据直接运行。

| 需绑定的现有端口 | 候选真实权限与放行回执 |
| --- | --- |
| **Neon 领取与完成** | 四个相互隔离的 TLS LOGIN：`first_onboarding_fc41597f_review` 仅 `review()`/`release()`，`first_onboarding_fc41597f_claim` 仅 `claim(text,jsonb)`；完成/独立回读候选 `first_onboarding_fc41597f_complete` / `first_onboarding_fc41597f_inspect`，各仅 `complete` 或 `inspect`。用[领取](../lib/deployments/execution/first-onboarding-claim-entry.ts)和[完成](../lib/deployments/execution/first-onboarding-completion-entry.ts)生成器绑定同一 SHA、时间和任务。各自专用隔离 `NOLOGIN` definer，独立核 owner、成员、列 ACL、函数摘要、固定 `search_path` 和 PUBLIC 撤销。运行角色不直接写表，不用调用 claim／complete 试权限。 |
| **Neon 中段／g1 围栏** | `repository` 只接 `loadContext`、容量保留、心跳、指定状态／步骤、生命周期记账、同租户 g1 及外部 epoch 核对。复用[存储逻辑](../lib/deployments/execution/neon-repository.ts)和[协调器](../lib/deployments/execution/external-ownership-coordinator.ts)，不能把现有通用 SQL 直连角色当窄适配。提交前列出实际选择的窄 RPC/DML 向量、执行登录、准确 authority 后端和唯一租户键，以及 `prepare → installAndObserve → activate` 所需写入及比较；绑定同 lease/attempt、g1/e1、`writeBefore`，拒绝其它任务／代际和 cleanup，心跳不续截止。原件不足时不假定旧表／策略可用，不新建通用 authority 或给整表权限。 |
| **CloudFormation 与共享 Cell 门禁** | `TechlongSandboxProvisionerRole` 的已审会话使用 [SDK create-only](../lib/deployments/execution/aws-sdk-adapter.ts)，只读新栈名或其 ACK ARN，`CreateStack` 最多一次且精确标签，`PassRole` 只给 `TechlongSandboxCloudFormationExecutionRole`。后者允许精确七资源及获批的 CFN 托管回滚，ECS `PassRole` 只给 `TechlongSandboxTaskExecutionRole` 和 `TechlongSandboxFirstOpen-e9fdccd5d8c7685c`；监听规则权限只能在两条真实监听器上生效。须比较真实 trust／boundary／身份及会话限制、CFN 角色和模板管理归属，不借旧 ARN，不加执行者 Update/DeleteStack 或 IAM 写。`cellPreflight` 还须读取本次恢复独立回执及受审原 Cell/平台参数，不使用关闭的通用适配。 |
| **Express、两份基线及应用身份** | [Express 端口](../lib/deployments/execution/first-onboarding-express.ts)接 V3 生成器，实际 `TechlongSandboxTenantLifecycleTaskRole` 只对原物理集群的 `postgres` IAM 登录和两键固定版本 `GetObjectVersion`；需证明受审 TLS 路径、准确可用的恢复工具、PG17.9 兼容及未占用的目标库／角色。先验能力回执不试写新库、不改其它库 ACL；领取后只在 `tenant_e9fdccd5d8c7685c_db` 初始化、schema-only 恢复、现有 SaaS 迁移和激活 `tenant_e9fdccd5d8c7685c_role`。应用 TaskRole 仅该 `dbuser` 及本独立桶 `products/*` 的必要动作；图片删除不是本轮验收动作，不默认加权限。 |
| **g1 供给与固定注入** | 先证明 `TechlongSandboxTaskExecutionRole` 对准确仓库、日志流和两份固定 Secret 的有效路径。领取前用最终首开 SHA 派生唯一 g1 版本，并另封 IAM/授权回读摘要，不把派生版本或其 IAM 回执塞回首开摘要形成循环。[窄策略](../lib/deployments/execution/first-onboarding-run-permissions.ts)允许审核完整 g1 名＋六位物理后缀模式、唯一 `VersionId`；供给身份只对准确名称／标签／加密路径一次初始 `CreateSecret`。实际安装还须证明权限条件及 ECS 注入请求确实匹配，且其他版本、名称和正文读取无额外路径；仅有 IAM 片段或接受测试回执不够。取得实际 ARN/唯一版本的独立元数据后才渲染注入；控制公钥用源码中已有准确 ARN/版本，须与现行控制材料匹配。KMS 只在证明确需时限定准确 key／服务／上下文，不以 `AWSCURRENT`、宽通配、临时补权或试建 Secret 兜底。 |
| **控制配置、独立核验与清理责任** | 复用 [mTLS 客户端](../lib/deployments/execution/control-client.ts)和[不可变配置编译器](../lib/deployments/execution/control-payload.ts)；必须另锁准确控制 CA/客户端身份、签名来源、已批准模板与同实例首位商家管理员凭据供给，绑定该 hostname 的 8443 和一次配置 POST，不借旧租户材料或把私密输入落盘。[独立核验端](../lib/deployments/execution/first-onboarding-reader.ts)只用 `TechlongSandboxFirstOpenInspector`（历史 `NoSuchEntity`，须按实际存在状态补装或核验）、独立目标库 TLS 只读身份、准确 CFN/ECS/ELB/RDS/DNS、两份 Secret 元数据、桶和 A 的原 ECR manifest；不读 Secret 正文或业务表。时间门禁还要求[同一窗口的清理责任证据](../lib/deployments/execution/single-tenant-workload-strategy.ts)：核准确责任主体 `techlong-sandbox-dev` 的权限证据、原 Cell、同一 scope 和到期值，检查用不超过 **30 秒** 的独立观察；这不是已安装自动停费，也不授权清理。 |

##### 2．执行顺序与签核边界

| 段 | 只执行下列动作，前段回执是后段输入 |
| --- | --- |
| **定向只读（下一唯一动作，另批）** | 复用原品类、名称、模板、角色名单、原始 A 回执及固定基线；查会改变放行决策的缺项：① 控制库只投影该任务的 held 状态、计划/配置摘要、订阅有效期、g1/epoch 与 D2 绑定空位和实际窄身份布局；② 核原 Express 集群／writer（各 1 次状态读取）、原 Cell（同 ARN 的状态、Original、一页归属和活动变更集各 1 次），证书／mTLS 各仅准确原 ID，且只补恢复判断所缺字段；③ 只核准确 IAM 缺项和拟用的新栈／目标库／角色／g1／图片／DNS 名称，控制公钥只查固定版本元数据。镜像优先用已封存原始字节（本轮没有核得原件）；无原件时仅候选 ECR 同仓同 digest `BatchGetImage` 1 次，不下载镜像层。必须连线上验证 TLS SQL 才能判定的 Express 空位和隔离能力在集群就绪后另列只读许可；不得为查询先启动。正式批准前固定各角色／对象调用数、SQL／凭据读取数、期限及保存的去敏投影；不按历史读取预算自动重查，不读取新私密材料。 |
| **最小安装与原设施恢复（分别确认）** | 先收口并独立核验不依赖新监听器、实际窗口或固定 g1 版本的安装差异；持久化仅复用合格本租户设施，否则最多创建原草案的**一个五资源存储栈**，等私有桶/OAC/准确 CORS 和 `Deployed`，不迁图片。待无需恢复就能完成的准备已齐，再启动计费设施：仅原 Express `techlong-sandbox-express-d001`（`cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`）确为 `stopped` 时 `StartDBCluster` ≤1，不单起 writer；独立确认原 writer/集群均 `available`、版本/IAM auth/端点。仅原 Cell `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` 符合原 12 资源及无冲突时，创建、核对、执行同一 UPDATE Change Set 各 ≤1，只 Add `CellLoadBalancer`、`BusinessHttpsListener`、`ControlMtlsListener`、`BusinessControlDenyRule` 并恢复两监听器输出；是否允许 CFN 托管回滚写入实际签核。已合格则跳过对应写入；不直接建 ALB、不启动独立 RDS/旧租户或更新平台。 |
| **绑定恢复值和实际窗口，最后补依赖项（分别确认）** | 从独立回读取得原 12 项未变、16 项、真实 443／8443、证书和 `verify` trust store；从同一 ALB 的实际回读取得 DNS/canonical zone，不能从两个监听器输出猜 DNS。确认 443 的 100／101、8443 的 100 空闲，`Z01473621BTTHKXBGOOEJ` 仅对 `pending-app-bbd626d7d3806af686073211.sandbox.techlong.cloud` 做准确 `CREATE A Alias` ≤1；已匹配不写，同名冲突停。用真实新 ARN 封余下 CFN/IAM 策略及持久化绑定。冻结首开体：实际计划／配置／Review、Express 能力、独立清理证据、A、两份基线、存储和参数摘要；设新窗口 `startAt < claimBefore < writeBefore`、至少 10 分钟执行预留、`writeBefore ≤ min(startAt+1h, workloadExpiresAt−5min, factsExpireAt)`、`workloadExpiresAt = startAt+7200s`，原订阅须覆盖。**先封首开体，后派生 g1 版本和领取／完成 DDL，再按安装 SHA 审批并独立回读；最后才确认首开 SHA。** 窗口预留须含安装、回读、人工确认；来不及不开窗，不滚动重算日期、不重放。 |
| **一次首开，独立通过才激活（另批）** | 首开前重新核同一 held 投影仍 `pending/0/1`、无租约／前代／已用槽、证据与时间仍有效。调用现有入口一次：领取 ≤1、g1 初始 Secret ≤1、V3 prepare ≤1、两份固定版本 GET 各 ≤1、schema-only 恢复 ≤1、SaaS 迁移一组、应用 IAM 登录激活 ≤1、租户 `CreateStack` ≤1（原七项）、准确实例配置 POST ≤1。最终清单另封租约／步骤／控制读的次数，目标栈轮询不超过入口硬上限 120 次且只能本栈名或 ACK ARN。独立核验 AWS 元数据 ≤24 次（身份另计）、目标库 TLS 只读连接 ≤1、准确公开 `/health` 和 `/ready` 各 ≤1；要求 `CREATE_COMPLETE`、7 项真实物理归属、A 的原始 manifest 与实际运行 digest、`1 running / 0 pending`、目标健康、两固定 Secret、Alias、S3/CDN、库/角色 OID、g1、迁移与隔离证据。技术核验及租约仍有效才 `complete` ≤1，原子写实例 `active`、部署 `ready`、任务 `succeeded` 与 **A / revision 0 / 无活动请求**；另一登录 `inspect` ≤1 回读一致才报开通。 |

**第一段可单独确认的读取上限（尚未授权）：** 固定原 Source，STS ≤1；CFN ≤5（原 Cell 4 项、新租户栈精确 `DescribeStacks` 1）、RDS ≤2（原集群和 writer）、ACM/mTLS ≤2（原证书和 trust store，仅恢复判断所必需时）、ECR ≤1（只在本地找不到准确 A manifest 原件时）、Secrets Manager `DescribeSecret` ≤2（仅固定控制公钥和准确 g1 名）、Route 53 ≤1（准确域名的一页起始查询）、S3 `HeadBucket` ≤1（仅新租户准确桶名）。IAM ≤29：七个 `GetRole`（Cell、Provisioner、租户 CFN、ECS 执行、lifecycle、应用、Inspector）；对五个有历史关联的现有角色，仅在比对安装缺项所需时各取一页附加／inline 名单和本角色唯一已知边界的 `GetPolicy`＋`GetPolicyVersion`；仅原 Cell 和 ECS 执行角色各取一份此前已定位的 inline。候选角色若出现新绑定，记录差异并停止，不再展开策略。总计 **STS 1＋AWS 43**，不翻页、不重发。仅 AWS 前置匹配后，读取既有 `.env.local` 一次到内存，使用对应固定 Neon 库一条验证主机名和证书的 TLS `READ ONLY` 连接，最多 **12 条**目录/精确任务投影与事务控制 SQL，只核 held、计划/配置摘要、订阅期限、初始绑定/围栏空位、该任务涉及的角色和函数布局。不连 Express、不读 Secret 正文、PEM 或 S3 正文，不改 AWS/数据库、调度或占槽。本段只产去敏事实，不证明实际有效 IAM、实际 SQL 写端口或新监听器归属；不能据此开窗。

**封存前硬缺项：** 实际单次操作者与中段窄 SQL/authority 未绑定；目标空位及 Express/恢复工具、实际控制凭据与独立核验身份未证；原 Express/Cell 的当前状态、新物理值、图片和 DNS 未核；该 g1 的实际有效固定版本路径、清理责任、最终摘要和窗口未封。旧证据保留原采样时间；准备事实最多 5 小时且不延长任何执行期限。提供者回执不明、并发、权限/事实不符、分页超范围或时间不足均停在当前段；不试权写入、不重试、不自动补、回滚或清理（已批准的 CFN 托管回滚除外）。已提交但独立回读不明记「未验收」，不再提交一次。恢复或部分安装/部署可遗留收费资源，窗口和 `ExpiresAt` 都不是账单上限或已安排停费。私密输入按准确范围只进受限进程，不提交或记录内容；网络／服务日志仍有暴露风险。

**本轮实际：** 仅离线核对已存公开投影、模板及代码并编制本清单。未读配置、凭据、Secret 正文或私有业务原件；线上读取、安装、资源启动、领取、部署、Stripe、调度及槽消费全部为 0。下一步仅按上表第一个签核段确认必要的新读取，不批准任何写入，也不启用普通队列或重开 D2。

**第一段已批准并在身份核对处停止（2026-11-19 08:41:23 CST，温尼伯）。** 固定 `techlong-sandbox-user` 配置及 `ca-central-1` 官方端点，单次 STS 命令返回 `SOURCE_SESSION_EXPIRED`（去敏分类，退出码 255），未取得可验证身份。STS 尝试 1；其它 AWS 元数据、`.env.local` 读取、Neon 连接、SQL、写入、恢复、领取、调度和槽消费均为 0。保留停止记录，无新事实、执行 SHA 或窗口。Source 刷新后须明确允许新一轮同范围读取，不重放这次尝试；安装、恢复和首开仍未批准。

**刷新后的新一轮：身份通过，在 DNS 读取处停止（2026-11-19 08:56:56–08:58:44 CST，温尼伯）。** 固定 Source 只做 1 次 STS，命中准确账号和 IAM 用户。AWS 元数据共尝试 12 次：CFN 5、RDS 2、ACM 1、ELB trust store 1、Secret 元数据 2、Route 53 1。已确认原 Cell 为 `UPDATE_COMPLETE`，Original 仍匹配原 12 项模板及全部 12 个保留物理 ID，无活动变更集，新租户栈名未占用；原 Express 和原 writer 均为 `stopped`，PG 17.9、IAM auth 与归属匹配；原证书 `ISSUED`、mTLS trust store `ACTIVE`、控制公钥固定版本存在、准确 g1 名返回 `ResourceNotFoundException`。这些是本次元数据事实，不是有效 IAM、空库或恢复就绪证明。

该次 Route 53 读取停于 `AWS_CLI_UNCLASSIFIED`；本地 CLI skeleton 参数形状通过，但未证明原失败原因。该轮未重发、未进入 S3、ECR、IAM 和 Neon。以下接续已另批完成，不重放任一历史尝试。

**只读接续已完成（2026-11-19 09:04:38 CST，温尼伯）。** [去敏回执](evidence/sandbox-first-open-fc41597f-preflight.observed.json)保留原事实：只对同一域名发一次 Route 53 请求，确认未占用；准确图片桶 HEAD 返回 404，A 原 ECR manifest 字节复算与固定 digest 一致；未重查 Cell、Express、证书、trust store 或 Secret 元数据。两个新 IAM 角色均不存在，五个已知角色的信任主体和关联布局符合预期；已读策略未找到新应用 TaskRole 的显式 PassRole 引用或 g1 精确固定版本声明，不据此断言不存在其它有效路径。限定接续实际 **STS 0、AWS 元数据 30（DNS 1／S3 1／ECR 1／IAM 27）、配置 1／Neon 验证 TLS 只读连接 1／SQL 9**；未读 Secret 值或基线正文。

Neon 回读同一任务仍为 `pending / 0/1 / 无租约`，计划／配置摘要和可信 A 目录匹配，无前代、外部 epoch 或 D2 初始绑定；订阅有效至 `2026-12-19T03:54:22.780Z`，拟用的六个角色和两个专用 schema 都不存在。此回执不证明 Express 实际空库、窄写适配或 g1 已获授权。**下一唯一动作：复用回执准备不依赖新监听器或首开窗口的最小安装差异。** 先锁新应用／Inspector IAM、固定对象版本权限及单任务中段 SQL/authority 真实接线；能确定的差异集中出材料，不重复查本轮资源；最终依赖新监听器、g1 版本和首开 SHA 的部分保留至相应签核段。原准备期限为 `2026-11-19T19:56:56.789Z`（温尼伯 13:56:56.789），不延长；无写入、恢复、领取、调度、执行窗口或执行 SHA。实际安装、恢复和首开仍分别确认。

<a id="first-onboarding-fc41597f-static-install"></a>

#### `fc41597f` 无恢复依赖安装包：只安装锁定身份，待审批

[执行清单](../ops/aws-sandbox/first-open-fc41597f-static-install.review.json)的规范 SHA-256 为 **`b923012d70bc48b4d26705353cee7d73f2bd04a0bbf2c5d4690ba77cd8ab6471`**。直接复用[定向只读回执](evidence/sandbox-first-open-fc41597f-preflight.observed.json)：原任务 `pending / 0/1 / 无租约`、无 g1/epoch 或 D2 初始绑定；两个指定 IAM 角色、六个 Neon 角色及两个专用 schema 未存在。原事实截止 **2026-11-19 13:56:56.789 CST（温尼伯）**；安装最多 20 分钟，须在 **13:36:56.789 CST** 前启动，不续期、不打开首开窗口。材料编制和验证没有新增线上读取、不安装、不启动任何资源。

**准确执行顺序（须用户另批 SHA）：**

1. 按清单核对固定回执、模板、SQL 的文件摘要及原事实期限。用原 Source 做 1 次身份核对；只确认精确新栈、两个角色和专用 managed policy 名称未占用，不盘点其它资源。就绪后记唯一安装意图。对 `techlong-sandbox-first-open-fc41597f-identities` 从[固定模板](../ops/aws-sandbox/cloudformation/first-open-fc41597f-identities.template.json)创建一次 `CREATE` Change Set（`CAPABILITY_NAMED_IAM`，不传新的执行角色）。核对 AWS 返回的同一 ARN、未执行状态、Original 摘要和恰好 **3 Add**：两个 IAM 角色、一个应用 managed policy；不符不执行。精确执行该 Change Set 最多 1 次；允许仅该新 IAM 栈的 CloudFormation 托管回滚。等明确 `CREATE_COMPLETE` 后，用分离只读进程回读相同栈及三项归属、角色信任和应用的同一 attached/boundary policy，确认两个角色都拒绝 AssumeRole、无意外 inline 或附件。应用策略只有新租户精确 `rds-db:connect` 和专用桶 `products/*` 的 `s3:PutObject`；Inspector 不获读权限，也不授予 PassRole。AWS 仅清单列明的 **STS 1＋最多 23 次元数据**，不翻页。
2. AWS 独立回读通过后，读取现有 `.env.local`，只用固定 Neon 目标、核验服务器证书及主机名的 TLS。提交[固定 SQL](../ops/aws-sandbox/first-open-fc41597f-identities.sql)一次（12 条 SQL，含一笔事务）：原目标库／安装身份 OID、预期 held 行和两类围栏空位都匹配时，只建立六个 `NOLOGIN / NOINHERIT` 非特权角色。无密码、无 SQL 业务写、无 schema、函数、业务表授权或显式成员授权。仅在明确提交后，用分离连接做一次只读回读（≤4 条 SQL），验原任务不变、六个角色状态、双向成员及无新增表／schema／函数权限。配置和 TLS 连接各最多 2；托管 PostgreSQL 可能给创建者自动 ADMIN，回读只接受没有 SET/INHERIT 的安装者自动成员关系。安装者权限不足或目标/对象向量变化即停，不改角色权限绕过。
3. 保留各段回执。单一 SHA 覆盖本段两个安装操作，不授权运行时。AWS 与 Neon 非原子：先成功的一段可能保留锁定身份；同名冲突、超时、提交结果不明或独立回读失败时停，不重放、不认领同名对象、不自动回滚或删除（获批的 CFN 托管回滚除外）。不运行 AssumeRole、Task、请求或其他试权写入；不恢复 Express/Cell，不部署、创建存储、改 DNS 或启动队列。配置只进内存，接受宽权限安装身份、提供者日志和低额调用成本风险。

**明确没包含的真实接线：** 固定基线权限仍以 [现有生成器](../lib/deployments/execution/first-onboarding-run-permissions.ts)的同桶两键、各自 VersionId 为准。现有 lifecycle 角色和共享 boundary 的回执只保存指纹，不足以重建完整的原栈 IAM 文档并证明有效授权；不直接加旁路 policy，也不把候选版本当已授权。中段 `repository/provisionEpoch` 仍须接到该任务的窄接口和真实 authority，不能借 Neon owner 直接运行；本包没有装这块代码或授予写权限。Inspector 解锁、领取／完成函数、g1 注入、控制身份、监听器引用与 DNS 绑定需要各自的确切材料；真实新监听器和窗口相关权限未提前赋予。锁定身份安装通过不等于允许运行，更不等于已开通。

**离线验证：** 模板只含 3 个 IAM Add、两角色无 Allow trust、应用策略与现有源码的两条准确声明一致；批准体、原回执、候选文件和时间预算离线交叉核对。隔离 PostgreSQL 验证无 held 任务时不创建、精确 held 任务一次原子创建六个 `NOLOGIN`、重放拒绝且两 schema 保持未创建；本机临时库已关闭清理。未调用 AWS `ValidateTemplate` 或访问 Neon。

**已执行至 AWS `CREATE_COMPLETE`，独立回读未完成（2026-11-19 09:18:54 CST，温尼伯）。** 已按上述 SHA 确认前置、创建且核对同一 Change Set 的三项 Add 和 Original，只执行一次。[去敏回执](evidence/sandbox-first-open-fc41597f-static-install.partial.json)记录 AWS `CREATE_COMPLETE`、三项准确物理归属和应用角色锁定 trust、boundary／挂载布局通过。独立进程在准确 Inspector `GetRole` 返回未分类退出码 255 时停止；不据此断言会话过期或角色不存在。Inspector 的信任／附件与应用 policy 的默认正文尚未完成独立回读。STS 1、其余 AWS 元数据 13 次、Create/Execute 各 1，直接 IAM 调用写入、配置读取、Neon 连接/SQL、恢复、领取和调度均为 0。保留原槽，不重发 Create／Execute，不下结论为整包已验收。

**IAM 独立回读已补齐（2026-11-19 09:21:30 CST，温尼伯）。** 用户授权的 5 项精确 IAM 读取分别成功，[回执](evidence/sandbox-first-open-fc41597f-static-install.iam-readback.json)证明 Inspector 仍为拒绝 AssumeRole，附加／inline 均 0；应用 managed policy 默认 v1 的正文与批准模板一致，attachment 与 boundary 各 1。合并上次准确栈与应用信任回读，AWS 身份安装验收通过。该续段没有新 STS、重复建栈、改 IAM、读取配置或连接 Neon；上次未分类错误原因仍未证明。

**锁定身份安装已结案（2026-11-19 09:24:33 CST，温尼伯）。** 用户明确批准后，在原 09:36:16.905 截止前一次提交原 SQL，09:23:47.526 收到明确 COMMIT；新 TLS 只读连接[独立回读](evidence/sandbox-first-open-fc41597f-static-install.verified.json)匹配六个非特权 `NOLOGIN / NOINHERIT`。创建者有六项提供者自动 ADMIN、无 SET 或 INHERIT；新角色无直接 ACL/对象归属，两个候选 schema 仍不存在。原任务仍 `pending / 0/1 / 无租约`，未新增围栏、前代或 D2 绑定。实际配置读取 2、验证 TLS 连接 2、安装 SQL 12／只读核验 SQL 4，无 AWS 调用、业务写、恢复、调度或领取。原安装 SHA 与单次槽均保留，不重放。

<a id="first-onboarding-fc41597f-middle"></a>

#### 同一任务的窄中段 SQL／资源归属接线（已离线完成，未安装）

[受审单次入口](../lib/deployments/execution/first-onboarding-run-composition.ts)现可直接绑定[固定中段适配器](../lib/deployments/execution/first-onboarding-middle.ts)和[候选 DDL](../ops/aws-sandbox/first-onboarding-middle-ddl.ts)。领取前用同一审批 SHA 通过中段只读就绪回执，另查唯一 authority 键未占用；不通过即不领取。保持原 `NeonDeploymentExecutionRepository` 原字节及普通 worker 不变：只复用原十二条语句，逐条绑定源码指纹；运行者只能调用固定函数和传参，不发送任意 SQL。函数在 PostgreSQL 行锁后以数据库时钟校验原任务、第一次尝试、原订阅、计划/配置、租约、截止及 `g1/e1`；只允许执行中段，不能领取、完成、取消、重试、清理或写其它实例。没有新 D2 或普通队列接线。

资源归属使用原 DynamoDB 表、仅 `tenant:<该任务的固定稳定身份摘要>`：领取前读空位一次，领取后用既有条件写 `attribute_not_exists`，最多一次 `PutItem`；前后各读准确租户栈且不得已存在，条件写后独立一致性回读，再激活 Neon `g1/e1`。正常至多 3 次 `GetItem`（含领取前），不翻页、不换键、不重放写；授权草案仅 `GetItem`/`PutItem`，限定该表和单一 `LeadingKeys`。旧资源不会被领养。Neon 核验归属回执的准确结构，不能直接证明 DynamoDB 网络响应；最终仍须把实际授权、数据库 LOGIN 及已审适配固定到同一个操作者，并保留独立 Inspect。原逻辑 Secret 名不带 `/g1`，实际 ARN 则只能是本代固定名称和六字符后缀，二者不互换。

候选 DDL 需要**专用中段角色**（一个 `NOLOGIN` definer、一个隔离的运行 LOGIN），不复用已设的领取/完成身份，不把底表权限给运行者或 PUBLIC；只在装入前有独立角色和精确函数体核对时才允许启用。130 项本机回归、隔离 PostgreSQL 的真实 DDL／受限角色／合成 DynamoDB 回归、类型和 lint 均通过；覆盖无中段就绪回执不领任务、错范围/过期拒绝、无直接表读，及条件写结果不明不激活也不重发。未在 Neon 创建这两个角色或 schema，未发放凭据，未连接 Neon／AWS 或写 authority，未恢复、领取或部署。

<a id="first-onboarding-fc41597f-remaining-install"></a>

#### 剩余安装与单次执行入口：一份集中材料，暂不可签发执行 SHA

[机器材料](../ops/aws-sandbox/first-open-fc41597f-remaining-install.prepared.json)固定原任务、批准源码、14 份已存证据/源码摘要、实际计划/配置摘要、可信 A、两份基线的原键/实际 VersionId 与 `g1/e1` 操作摘要。原锁定身份安装不重做；原准备事实截止仍为 **2026-11-19T19:56:56.789Z（温尼伯 13:56:56.789）**，不会因本材料生成而延长。不把草案摘要伪作安装或首开 SHA，不给恢复、领取或执行授权。

| 范围 | 本轮已定的最小差异与安装门槛 |
| --- | --- |
| **真实运行入口** | 唯一候选为 [bindReviewedSandboxFirstOpenRunOnce](../lib/deployments/execution/first-onboarding-run-composition.ts)，同一进程注入彼此独立的 review／claim／middle／complete／inspect TLS 登录、一个精确 provisioner SDK 会话与独立 Inspector。已复用原 SQL、DynamoDB 条件写、create-only AWS 端及独立技术端边界；**入口还不是可运行的真实启动脚本。** 不借平台 owner、默认 SDK 凭据或普通 worker 兜底。旧 Express 运行脚本和只读观察器固定旧实例、旧库/OID及旧 Secret 来源，即使路径相似也不能只换 ID 后调用。 |
| **Neon 只安装所需入口** | 保留已安装六个角色。仅候选再建一个中段 `NOLOGIN` definer 和一个独立 middle 角色；应用态共 3 definer、5 个分离运行 LOGIN、3 个 schema 的 6 个固定函数（review、release、claim、middle、complete、inspect）。最终首开 SHA／窗口封定后，由现有三份生成器编译彼此一致的 DDL，绑定精确登录供给和独立 ACL 回读；不预开 `LOGIN`、schema 或授予底表 owner，不用业务写试权。 |
| **DynamoDB／基线固定版本** | 材料内附精确 `dynamodb:GetItem`／`PutItem`，只准原表和本任务 `tenant:<稳定身份>` 键，正常至多 3 次强一致 GET 和 1 次 `attribute_not_exists` PUT；未授权写。生命周期只候选原集群 `postgres` 的 IAM 通路和两个精确 `s3:GetObjectVersion`／匹配 `s3:VersionId`，不许 `GetObject`、latest、列桶或原桶降级。现有回执只有原共享策略摘要，不足以覆盖或合并完整当前原件；现有 IAM stack 只能沿 [原归属](aws-instance-release-step4-execution-review.md)作**确切差异**，不直接挂旁路策略。不用旧策略正文或更宽 boundary 让候选调用通过。 |
| **AWS 角色、控制和独立验收** | 应用、Inspector 保持安装后的 deny-all trust；新应用登录归属及真实核验会话未证明前不解锁。执行包只能给会话准确新栈 create-only／精确 `PassRole`、新代 Secret 初始供给，以及既定两固定 Secret 注入。CloudFormation 两监听器权限和 Alias 只等**原 Cell 四项 Add 的独立恢复回执**，不得从旧 ARN 填入。mTLS 控制和首位商家管理员凭据可复用现有编译器，但取得同任务凭据来源需审批，不读或上传私密输入；准确配置 POST 最多一次。Inspector 只做已限的 AWS 元数据（≤24，身份另计）、目标库只读及 `/health`、`/ready`，不能提交激活或读取 Secret 正文。 |

**本清单封存时的阻塞是执行端口。** 后继代码状态见[三处离线接入](#first-onboarding-fc41597f-express-binding)。本清单原件保持不变，不作为执行 SHA 或实时事实；不重复 CFN/ECS/RDS 等全量盘点。

**保持原顺序。** 真端口接好和预算可封定后，再审恢复原 Express/原共享 Cell（不重建整环境）；恢复实际值确定后固定安装差异、一次受控首开窗口和两层摘要。先固定首开体 SHA，再用它派生三个 SQL 包和 `g1` 固定版本，账本/权限结果摘要独立封存。安装、恢复及一次领取仍分别确认，无额外静态身份安装轮次。异常、时间不足、并发变动或回执不明即停，不试权、不重试或自动清理；恢复后资源可能持续计费。**本轮线上读取/写入、凭据读取、权限安装、恢复、调度和领取全部为 0。**

<a id="first-onboarding-fc41597f-express-binding"></a>

#### 三处离线接入：同一首开任务，不启用执行

[单次入口装配](../ops/aws-sandbox/first-open-express-runtime.ts)接到原 `bindReviewedSandboxFirstOpenRunOnce`，不改变普通 worker、Full、旧租户或 D2。显式复用 SpeedFeast 后端的 V3 编译／建库、拥有连接、归档编译、两份固定迁移与 PG17 目录校验；不调用固定旧租户运行脚本。

- **Express：** V3 空库准备仅接受同任务 g1/e1，动态取新库和角色 OID。两份固定 VersionId 经限长和 SHA-256 核对后才编译 schema-only 归档；用批准迁移、空表计数和历史迁移目录指纹校验后，才给新角色准确应用权限。建库、恢复、迁移与应用授权不是同一提交，结果不明时不续跑。其他库仍可连接即停止，不更改共享库权限。目标库保留绑定同任务、批准和这对 OID 的数据库标记。
- **Secret：** 只为准确名称提交一次 `CreateSecret`，用现有 g1 派生 SHA 作 `ClientRequestToken`，默认 AWS-managed KMS。复用 Express 四字段生成器，无数据库密码或 URL；测试 Stripe 材料只能由该租户经审批供给。已有 Secret 或提交不明不认领、不重试；只用元数据核对版本，供给端不读 Secret 正文。
- **独立核验：** 应用使用自己已验证的 IAM 身份证明实际登录。独立 Inspector 用不同会话访问目标库，只执行固定 TLS/READ ONLY 核验，回读实际数据库／角色 OID、归属标记、角色隔离及 SaaS schema 哨兵，与写端回执进行比较。核验失败不进入原子激活。

114 项本机回归、TypeScript 类型检查及定向 lint 通过，覆盖了阶段顺序、版本、Secret 一次提交和独立 OID 不符停止；另离线核对本机后端 V3 编译器、固定迁移文件与真实入口的无连接装配。**没有真正创建库、生成运行凭据、读取 S3、联机验收或开通实例。** 后续集中审批仍需封定实际后端／工具源码、有效域和权限、同任务 Stripe 材料、持久化与原 Express／Cell 恢复前置。尤其须有**可在租户栈创建前取得的准确应用角色会话**（及生命周期、Inspector 的分离会话）；入口拿不到原角色就停在领取前，不放宽 ECS trust 或借 owner 代测。复用已有回执，只补仍缺的精确项，实际读取、安装、恢复和首开分别按范围审批。

### 首版范围

只做餐饮订单系统、一个新 sandbox 工作区／租户、现有共享 Cell，首轮选择 Express 数据库档位；空库初始化能否直接复用现有路径须在步骤 2 证明，不能用既有库的可连接性代替。起点是现有购买／支付确认流程生成的 `pending` 实例和 `active` 订阅，终点是该租户的 API 可访问、客户入口可用、实例 `active`、部署 `ready`，且 D2 已看到同一租户的初始版本 `revision 0`。验收从 Stripe 测试模式的正常入口开始，不手工造部署记录或填 URL，不接真实付款。新租户的权限、数据库与配置不能借用已有租户的值；共享设施复用，不重建 Cell 或为每个租户新建独立数据库服务器。

首轮采用**受控自动开通**：客户的购买事件负责登记任务，独立执行入口完成开通步骤；实际云执行仍需按准确范围批准，GitHub environment 由用户本人审批。不在 Webhook 内调 AWS，不开启全队列，不让历史 `planned` 记录自动进入执行范围。不宣称已实现无人值守的生产开通。暂不做 Full 档位、其他产品或区域、全量迁移旧实例、自动删资源或新审批后台。

### 可直接复用的能力与真正缺口

| 环节 | 已有 | 本项要补 |
| --- | --- | --- |
| 购买后登记 | [付款确认](../lib/payments/management.ts#L752)调用[计划入口](../lib/deployments/management.ts#L249)，登记实例、计划和待执行任务。 | 确认普通新实例的计划可以安全交给当前首开执行入口；验证重复事件和中断后续接不会创建第二套资源。 |
| 实际开通 | [现有 worker](../lib/deployments/execution/worker.ts#L1270)已有数据库、版本基线、配置、服务发布与技术核验步骤；已有[限定任务工作流](../.github/workflows/cloud-worker-execute.yml)，但服务的是经过审查的限定任务。 | 建立从**这一条新首开任务**到现有能力的明确绑定。核对现有任务、镜像、权限和承载合同是否适用于空租户；不能套用旧恢复包或把[默认关闭](../lib/deployments/execution/runtime-composition.ts#L45)改成全局放开。 |
| 开放客户入口 | [现有 `markReady`](../lib/deployments/execution/neon-repository.ts#L1603)能在同一数据库语句内写部署 `ready`、实例 `active` 和入口。D2 已有[初始绑定验收](aws-instance-release-step4-finish-observed-20261117.json)。 | 把验证过的第一版与模型中的租户、实际栈和运行配置绑定，并与客户可见的完成状态协调。不能把固定实例的临时 owner 操作变成日常开通接口。 |

### 实施顺序与阶段交付

1. **打通购买到可审任务的交接（代码已实现，默认关闭）。** 现有付款路径共用首开登记入口，在一个数据库语句内写入部署计划和一条待审任务。固定实例和首次代际，绑定当前订阅、套餐、配置摘要、ECR digest 和目标 release；不改历史计划，不新增队列或调度平台。审阅只读回查当前状态和授权来源的 D2 可信目录，不执行领取。
2. **接通单租户执行和验收（先用本地／隔离环境回归）。** 优先复用现有受审执行入口与数据库生命周期、运行凭据、CloudFormation 和控制面步骤。按“核对订阅、归属和配额 → 初始化该租户数据库和版本基线 → 配置凭据引用 → 用固定镜像创建该租户 API 承载 → 核对路由、健康和配置”执行。用独立核验结果确认实际栈身份、同一租户的数据库与 schema、镜像 digest、域名以及 `/health`、`/ready`。缺失允许的权限、配置或资源身份就在写入前停止；先确定最小差异，再提出一次集中清单，不开通全量 worker。
3. **收口原子完成并交接 D2。** 核验通过后，用窄权限在 D2 中登记这一个实例的初始版本、准确栈身份、配置和镜像摘要，`revision 0`，无活动发布请求。若能在同一 Neon 事务内完成，优先把初始绑定与现有 `ready` / `active` / 入口回写一起提交；否则保持 `pending`，先独立确认绑定成功，最后才开放客户入口。重复完成不能改写现有版本，订阅失效或租约丢失不能激活实例，提交不明先独立回读而不是再执行。把成功、确定失败和结果不明记录到现有状态与证据，不做自动资源清理。
4. **做一次真实的 sandbox 首开验收。** 代码和离线回归通过后，另行准备一份准确执行范围：新租户、测试支付入口、资源与调用上限、固定镜像、最小权限与人工审批、费用和失败处置。获批后仅一轮，从正常测试付款开始，核对原实例不变、新租户配置与数据隔离、客户入口可见、`active` / `ready`、初始版本绑定可由 D2 读取，以及独立证据和账本一致。重复投递只验证幂等，不开第二套资源。对新实例做 D2 兼容核对即可，不为这个缺口再部署一次版本更新；停费或生产放量另审。

**完成标准：** 新餐厅不用管理员手工拼接部署材料、填写入口或点“标记为已开通”；在一次经批准的 sandbox 首开中，一条正常购买产生的任务完成初始化、部署、核验和状态回写，且新实例可交给现有 D2。代码/CI 通过只算实现进度，不算真实首开通过。方案本身不授权付款、生产读取、权限安装、调度、AWS 或数据库写入。

### 第 1 步交付与边界

- [购买登记入口](../lib/deployments/management.ts)仅在 `AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID` 匹配准确 sandbox 工作区，且产品、区域、Cell、档位符合首轮范围时走新路径。还必须有指定的 `AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID` 和固定 `AWS_SANDBOX_IMAGE_URI`；目标范围内配置无效时不回落到普通 `apply`。两个新配置均保持未设；其余购买行为不变。
- [首开任务及审阅合同](../lib/deployments/first-onboarding.ts)：同一实例的首开只有一个稳定去重键。登记前检查购买来源、当前有效订阅和匹配配置，拒绝已有开通记录、旧计划或租户资源代际。任务留在现有 outbox，远期可领取时间和两个普通领取入口的明确排除共同防止调度。审核须用受审读取来源重新确认范围、任务未领取、可信目录状态 `ecr_verified`、准确镜像和 Express 兼容；审阅摘要本身不授权执行。
- 不设置环境变量、不迁移旧任务、不导入或更新真实目录、不启用 worker、不创建 AWS 资源。回归有本机合成测试和既有无 AWS CI 的隔离 PostgreSQL 测试。

### 第 2 步交付与边界

- [单次领取](../lib/deployments/first-onboarding.ts)重新核对同一笔购买、有效订阅、准确任务、计划、配置、目录版本和有效期；锁定原行，仅把原任务的唯一尝试置为运行中。保留 payload、隔离去重命名空间和领取时间标记，不派生普通任务、不允许旧槽重跑；续租不延原批准的截止时间。
- [受审执行](../lib/deployments/execution/worker.ts)复用现有归属/配额、空库与基线初始化、运行凭据引用、首版配置、受审七资源模板和控制面读回。无可信 Express 空库能力证明即不领取；只能新建准确首开栈，拒绝接管或更新，原建栈响应不等于成功。等待建栈时只读准确 Stack ARN，不另提交写入。
- [独立技术核验](../lib/deployments/execution/first-onboarding-inspection.ts)比较同一实例、准确栈模板和资源、DNS 目标、数据库归属和 schema、ECS 实际运行 digest、健康目标及 TLS `/health`、`/ready`。只保存技术核验检查点；不设置客户入口、不提交任务的最终完成、不写 `active`／`ready` 或 D2 `revision 0`。失败或提交不明停下核验，不重试、不清理。
- 未接生产凭据或配置，也未验证真实 Express 空库写适配、只读核验身份或对该租户的路由、挂载及持久化。当前模板仍是 sandbox 临时图片存储，核验如实报告；D2 原有持久化要求不变。真实适配/材料在一次实际验收前集中确认，不能用已初始化租户的证据替代。本轮无 AWS 调用、无生产数据库连接、不启用 runtime 或全队列。
- 审计边界：继承的 V5／V6 历史候选检查仍固定更早发布日期的源码指纹。第 2 步最终变更与第 1 步结点 `a8b57b3` 对比，两套运行闭包的 76／81 个文件均未变动；本轮不重标历史预期、不改已安装的绑定。首开及隔离 PostgreSQL 由现有 no-AWS 专项 CI 验证。

### 第 3 步交付与边界

- [首开完成语句](../lib/deployments/execution/first-onboarding-completion.ts)在原租约内锁定同一实例、订阅、部署、任务、首代资源、核验证据和目录版本；从独立核验派生初始绑定。一次 PostgreSQL 语句同时登记 D2 `revision 0`（无活动请求）、将实例置为 `active` 并开放入口、将部署置为 `ready`、将原任务置为 `succeeded` 并释放租约。已存在的绑定不覆盖；任一写入未完成则整组回滚。
- 技术核验和客户激活仍是两件事。完成范围须显式包含 D2 采样摘要和兼容客户端 API 版本；持久化桶、固定密钥版本引用和可信 D2 采样不齐时不激活。旧的仅技术核验范围不触发完成。提交结果不明不重发，同一文件提供准确范围的独立只读回查。
- 未设置真实写入身份、权限或连接串，未修改线上 D2 角色，也未启动 AWS、启用调度或改真实数据。第 4 步若另获授权，先核对真实 Express 空库、独立读回、固定引用与持久化材料，并审核窄写入身份；当前 sandbox 临时图片配置不能通过激活门槛。

<a id="first-onboarding-step4-review"></a>

### 第 4 步审批草案：一次 sandbox 真实首开

**2026-11-18（温尼伯）｜待审、不可执行。** 源码基线 `caa5bd2`，[无 AWS CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44234058703)只证明离线流程及隔离 PostgreSQL 原子提交。当前没有新鲜线上事实、已批准对象/启动窗口或可执行 SHA。本次只编制材料，未访问 AWS、Stripe、Neon 或 Aurora，未读取私密配置，未恢复资源、登记/领取任务、发起支付、安装权限或调度。

#### 单次验收范围与审批顺序

1. **先核对，再开窗。** 仅在另行允许后，核对已知准确对象的状态、归属和下列缺项；只存必要投影、摘要和观测时刻。不整账号盘点、不读 Secret 值、业务行、图片正文或归档正文；需要数据库连接、固定基线正文或测试支付的，另外界定。共享 Cell、平台、Express 服务或存储未就绪时停止；如需恢复现有收费环境，另给恢复范围，不把启停列为首开默认副作用。
2. **只登记一个测试购买。** 待前置材料齐全、且实际测试购买另获批准后，由用户走既有 Stripe **测试模式**正常购买和签名回调。只允许一个新 sandbox 工作区／餐饮应用／当前有效订阅，在 `ca-central-1` 的 `cell-sandbox-1` 使用 `standard-v1`，预期产生一条 `pending` 实例、一份 `planned` 部署和一条 `attempts=0 / maxAttempts=1` 的首开待审任务。仅为准确工作区绑定固定 `AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID`、`AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID` 和目录镜像 URI；配置安装本身也须批准。确认准确 checkout、签名回调和测试模式证据，不仅凭配置变量存在；不是手工造付款事件或填入口。出现第二条任务、旧租户匹配或非测试事件即停，不发起第二次购买。
3. **锁定同一任务再执行。** 用真实购买/应用/任务 ID、订阅与模板版本、计划/配置摘要、`ecr_verified` 目录项、镜像及平台 digest、基线摘要、预期域名/ALB、审批版本和原截止生成准确整轮清单，再另批。只领取此任务一次、首代 `g1`，只给一个新数据库、一个租户登录、一份固定版本租户运行时 Secret、一个租户承载栈。由已审现状证明租户资源、目标域和路由槽不冲突；仅可用准确栈名作最多一次 `CreateStack`，创建 7 项承载资源（一个 task definition、一个 ECS Service、一个目标组、三个监听规则、一个日志组），目标常驻任务数 1。若必须新建存储/授权/精确 DNS，另列差异和副作用，不计入或隐藏在这 7 项里。旧栈、旧租户和普通队列不参与。
4. **独立核验后只完成一次。** 与执行者分离的读取身份核验下表的准确物理归属和运行状态；待技术证据落账后，专用写入身份才提交一次 `COMPLETE_FIRST_ONBOARDING`。独立新会话只读回查实例、部署、原任务和 D2 初始绑定，确认没有活动 D2 请求；不进行 A→B/D2 发布，不再建栈。若使用 GitHub Actions，真实续接入口、确切源码、run/attempt 和受保护 environment 须纳入清单，environment 由用户本人审核；旧发布审批不可重用。

#### 四项放行条件

| 条件 | 当前缺项与将来必须核对的证据 |
| --- | --- |
| **Express 空库** | [已提交的 lifecycle v2](../lib/deployments/execution/aurora-lifecycle-v2.ts)只编译 Express `inspect`，明确 `writeCommandsAvailable:false`；[现有首开策略](../lib/deployments/execution/single-tenant-workload-strategy.ts)复用通用七资源渲染，仍继承 `DATABASE_URL`/本地图片，不能直接用于 Express 真跑。[已有 Express 专用候选](../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts)可复用 IAM/TLS/固定 Secret 与 bootstrap 健康配置，但本身只渲染、不执行。需证明指定集群物理 ID/版本、TLS 主机校验、管理与运行登录隔离、目标库/角色空闲；同一租约和资源代际下证明 `prepare_empty_database → restore_approved_baseline → migrate_saas → verify`，其中空库状态必须先于恢复。固定不含旧客户数据的 archive/manifest 键、版本、SHA、恢复工具与目标引擎兼容性、DB/role OID 和迁移合同。旧租户可登录或已初始化不证明新库可建，也不能以 Full 密码方案替代。 |
| **持久化与固定引用** | 当前图片配置 `local` 不合格。复用[已验证的私有桶／CDN模式](aws-instance-release-persistence-plan.md)和[已有最小配置派生](../ops/releases/persistence.ts)，目标是新租户隔离的桶或后端已证明可隔离的精确前缀；旧租户桶、`products/*` 授权和媒体不能直接转给新租户。清单固定桶拥有者、商品对象范围、公开 HTTPS 地址/来源和 CORS，任务实际配置必须是 `s3` 并匹配桶；禁止临时磁盘回退。应用注入的所有 Secrets Manager 引用（含控制公钥引用）必须落到真实 ARN＋VersionId。D2 会读确切域名的 Route 53 A Alias 及其 ALB 目标，历史通配 DNS 或单次 HTTPS 成功不能代替；若缺失，最多提议创建这一条 Alias，不能覆盖现有记录或修改共享 zone。新桶/OAC/分发或 IAM 如不可免，需在开窗前列入独立待审差异，不能默认复用原租户材料。 |
| **独立核验** | 读取同一首次创建的真实 StackId、Original 模板、资源清单/归属及无竞争变更；实际 listener/路由、目标和证书/mTLS、ECS 服务与任务定义、1 个运行任务/0 个待启动/healthy 目标、实际平台 digest、数据库身份/schema/基线、准确 DNS、Secret 固定版本元数据、持久化桶及 TLS `/health`、`/ready` 均一致。独立采样须符合 [D2 既有读取合同](../lib/deployments/releases/sampling.ts)，不以 Create ACK、工作流成功、bootstrap-only `/bootstrap-ready` 或旧验收证据替代；控制面配置写入只由执行者进行一次，读回核对当前实例和配置摘要。技术验收不冒充真实商家上传或买家业务测试；不加业务探针或迁移旧图。 |
| **原子完成与新 Secret 标识绑定** | [现有批准](../lib/deployments/execution/worker.ts)在领取前绑定 `completion.samplingSha256`，[采样材料](../lib/deployments/releases/sampling.ts)含新租户 Secret 的真实 ARN＋VersionId。若这些 ID 要在运行时产生，不能预填、借旧 Secret，也不能领取后改摘要或拆一次无完成的尝试再重放。开窗前须另审并证明一条可行路径：已合法准备且与同一 g1/epoch 完全匹配的固定引用，或经过单独代码与权限审核的**受限派生**（外层固定准确租户 Secret 名、只允许一次创建及固定版本规则；仅从同次受信回执和独立核验派生，不能放松摘要核对）。本稿不选择/执行任一路径。完成写入入口也尚未绑定真实身份，不能用平台 owner、D2 执行/核验身份或普通应用账号顶替。 |

#### 拟议最小权限：对象和动作都要审

下表是能力上限，不是可安装 policy。只列真实适配用到的动作；后续若某 API 无法按资源 ARN 限制，清单须写清其仅有的列表/跨资源例外和本端限定参数、页数、次数，不能据此给运行时通配写。实际 trust、SCP、边界、会话、KMS、网络及 PostgreSQL 权限要单独验证；成功的策略模拟不等于真实可达。

| 身份 | 仅需的能力 | 明确不授予或不执行 |
| --- | --- | --- |
| sandbox 平台支付入口／受审任务执行器 | 支付入口继续用当前受限的签名校验和购买/订阅/实例/outbox 写入能力；执行器只读准确 checkout 派生任务、订阅/计划与目录，通过首开领取语句用唯一租约锁定原任务，只写本任务的容量、代际/epoch、步骤和受审状态。若用外部围栏，只允许当前资源键的条件读写、不能在旧纪元回退；mTLS/签名执行凭据只允许这一个实例的首次配置操作。 | 无通用 `claimNext`、不启用全量 apply、不新建兄弟任务、不扫支付业务数据、不处理生产事件；执行器不自行给独立证据签认可。 |
| Express 生命周期管理／应用 TaskRole | 管理身份仅 `rds-db:connect` 到指定 Express 物理集群及批准的管理登录，经 TLS 执行准确数据库和角色的准备、只在新库恢复/迁移及核验；固定基线只读两条对象版本（archive/manifest，考虑 `s3:GetObjectVersion` 和实际加密所需的准确解密）。应用 TaskRole 的 `rds-db:connect` 只给该集群的 tenant login，SQL 只给租户库所需 schema/对象；无静态数据库密码。若用现有单次 ECS 生命周期任务，只允许运行准确 task definition/cluster/角色和网络，列清每次命令、启动次数及日志范围。 | 不新建/重启 RDS 实例、不管理其他库或账户、不把管理身份给长期应用或独立读取者；不把 `rds-db:connect` 当 SQL 授权，也不向普通角色开放 `CREATEDB`/`CREATEROLE`。若现有管理身份只有宽权限而无窄受审执行路径或真空库适配，停下补方案。 |
| Secret 供给／ECS TaskExecutionRole | 仅在另批方式下创建一份准确 g1 运行时 Secret（无覆盖；只允许必要初始版本、归属标签与受审 KMS），或使用已证明属于本代际的固定引用。TaskExecutionRole 只需拉取固定 ECR repo 镜像、写本栈日志流、按固定 ARN＋版本取启动注入所需内容；必要的 `kms:Decrypt` 只给实际相关 key 和流转范围。 | 不轮换/删除现有 Secret、不读其它租户、无通用 Secret/KMS 管理，值不进模板、step 输出、审批文档或验收日志。独立核验只读版本元数据。 |
| 首次建栈提交者／CloudFormation 服务角色 | 提交者只对准确新栈做 `DescribeStacks`（查空和按 ACK 轮询）及一次 `cloudformation:CreateStack`；`iam:PassRole` 仅指定 CFN 角色并限 CFN 服务。CFN 角色只允许七资源所需的 ECS task definition/Service、准确共享监听器规则和本目标组、本日志组的创建、标签、状态读取和**已评审的该次建栈失败回滚**，PassRole 仅两个准确 ECS 任务角色并限相应服务。模板须固定当次参数和 ARN 来源。 | 无调用者 `UpdateStack`、接管、`DeleteStack`、IAM 改动或其它栈写入；默认不授予 DNS/媒体基础设施变更、集群创建或任务扩容。只要预计需 CFN 内建回滚权限和费用，须在实际清单明确列出；不经手工/自动重试或清理。 |
| 商品图片写入／读取 | 应用 TaskRole 仅 `s3:PutObject` 到批准的商品对象范围；仅当保留应用现有替换/删除行为且批准时，再加同范围 `s3:DeleteObject`。私有桶的读取只给指定 CloudFront OAC/分发及该商品前缀；独立者只验证准确桶拥有者、权限与分发引用。 | 无应用级桶枚举、跨租户读写、版本删除或 PublicAccessBlock 变更；公开 URL 只用于允许公开的商品图片，不放私密附件。没有批准的产品上传验收时不写示例图。 |
| 独立核验身份 | 按准确标识读 CFN 模板/归属、ECS service/task definition/task、listener/rule/target health、Route 53 Alias、ECR manifest、RDS 元数据、Secret 版本元数据、S3 HeadBucket（不列/读对象）以及必要的 Neon 投影；若独立确认 schema 需连库，只给该租户 TLS/只读元数据或去敏核验结果，不读客户数据。HTTPS 仅批准的准确 hostname/路径；控制面只读要与配置写限开。 | 不写 CFN、ECS、S3、DNS 或数据库；不 `GetSecretValue`、不接执行者写入凭据、不用应用登录做验收。 |
| Neon 首开完成执行／独立回读 | 专用窄入口仅执行[这一份语句](../lib/deployments/execution/first-onboarding-completion.ts)，对准确租约检查和锁定 job、deployment、instance、subscription、workspace、environment、resource、epoch、独立 step 与 release；只允许给 `deployment_release.instance_state` 插入本实例的初始行，以及对本实例、部署、任务更新该语句列出的状态/入口/时间/证据/租约字段。首开 writer 的真实实现与 GRANT 要验证锁、FK、行限制及反向拒绝，既有 D2 runtime [只给函数权限](../ops/releases/grants.draft.sql)，不能视为已有首开权。独立回读仅 `READ_FIRST_ONBOARDING_COMPLETION` 和该实例的 D2 `read_context`；不需要完成权限。 | 不给直接跨租户表 DML、owner 或任意 SQL；不更新已有 `instance_state`，不写目录、requests、订阅状态或支付记录，不增加 D2 既有 worker 权限。用 PostgreSQL 角色分离或专用入口实现，不能把一次 CTE 的 WHERE 当作数据库权限隔离。 |

#### 放行、停止与落账

- 待补足的准确材料：新工作区/支付模式、真实 checkout 到任务的派生与目标范围、镜像及运行版本、基线版本/SHA、模板与各资源物理引用/归属、存储与访问证明、独立核验和完成身份及负例、租户预约容量和无冲突路由、准备时效/执行截止和本人审批点。待新事实另获准后，按真实对象分别固定读取与写入上限；现在的硬上限是 **1 个验收租户／1 条任务／1 次领取／1 个租户栈／1 次完成提交**，不是可分配给其它对象的额度。
- 开窗前记录人工监督、预计时长及成本估算（尤其既有 ALB/Express、Fargate、日志及存储/流量）。沿用 50 USD/月目标，不把它或任务截止当硬停费上限；原始执行/资源到期不得为凑时延长。停止/删除不在这轮验收授权，临时费用及资源留存分别记账，按已审流程另批。
- 缺证据、权限多于批准范围、目录/配置变化、无法保障当前租约，或 ACK 不明就停。领取前不消费尝试；领取后不复位、不换任务、不自动补写、补偿或清理。只有独立回读证明同一实例 `active` 且 URL 准确、同一部署 `ready`、原 job `succeeded` 且无租约、D2 `revision 0` 且无活动请求、证据摘要一致，才算一次真实首开完成。否则保留已有记录；不能把没有回读的一次提交判为可重试。
- **当前继续点**：见[第 4 步首开离线接线](#first-onboarding-step4-offline)；不先重复盘点、启动 AWS、调度或做测试购买。

<a id="first-onboarding-step4-readonly"></a>

#### 限定只读补核记录与准确范围

**2026-11-18 06:33:28–06:33:30（温尼伯 CST；12:33:28–12:33:30 UTC）｜停在身份核对，未生成执行清单。** 用现有 Source profile `techlong-sandbox-user` 对官方区域 STS 尝试身份核对 1 次，去敏结果 `CREDENTIALS_UNAVAILABLE`；未收到已匹配的账号/调用者响应，不能断定会话过期或具体根因。后续资源和 IAM 元数据调用均为 0。无重试、无替代登录、无 Secret 值读取、无数据库连接、无 AWS 写、资源启动、队列启用、任务登记/领取或开通。本次记录保留；它不产生新鲜资源事实或新的执行窗口。

如另行允许新一轮，Source 身份须先匹配账号 `402010193138`、区域 `ca-central-1`、IAM 用户 `techlong-sandbox-dev`。之后只核对以下确切目标：**STS 最多 1 次、AWS 元数据最多 20 次，一页、不翻页、不自动重试。** 表中对象来自本地已存引用；即使读回完全匹配，也不自动变成新租户授权。

| 目的 | 仅允许的目标、调用及保留的事实 |
| --- | --- |
| Express 及共享 Cell 前置 | **最多 3 次**：`DescribeDBClusters` 指定 `techlong-sandbox-express-d001`；仅当物理 ID 匹配已存 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM` 且 writer 仍为 `techlong-sandbox-express-d001-instance-1`，再对该 writer 做 `DescribeDBInstances` 1 次；`DescribeStacks` 只读 [原 Cell 的准确 Stack ARN](../ops/releases/d2-6-step4-finish.review.json)，仅保留状态和所需输出键是否存在。集群/实例状态、引擎版本、IAM auth 和物理归属不能证明目标库名/角色空闲、SQL 权限、真实空库创建或基线恢复。未绑定准确新 archive/manifest 键及版本，不列桶寻址、不读对象。 |
| 持久化参照 | **最多 4 次**：仅对 [已存旧租户图片桶](aws-instance-release-persistence-media-installed-20261115.json) `techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad` 做 `HeadBucket`（必须带预期拥有者）、`GetPublicAccessBlock`、`GetBucketVersioning`；仅对已存分发 `E2H9SBE05EMLAN` 做 `GetDistribution` 核对状态、原桶/OAC 绑定。仅验证既有模式可作设计参考，不确认/转用新租户桶、前缀、对象或访问权限。 |
| 固定版本参照 | **最多 2 次**：对 [已存控制公钥引用](../ops/releases/d2-6.prepared.json)、[D2 核验登录引用](../ops/releases/runtime.json) 各 `DescribeSecret` 1 次，只比对此准确 ARN、原固定 VersionId 是否存在/当前、删除/轮换状态及 KMS 引用是否存在。不查旧租户运行时 Secret，不列 Secret、不读内容。新租户 g1 Secret 的 ARN/VersionId 仍未产生或绑定，不能从这些参照推定。 |
| 生命周期与应用权限参照 | **最多 6 次**：分别 `GetRole` 指定 `TechlongSandboxTenantLifecycleTaskRole`、`TechlongSandboxTaskRole`；分别 `GetRolePolicy` 读取两者已存准确 inline `ImmutableReceiptsAndGenerationSecretRead`、`ConnectExactExpressTenantC4e`；只在原关联匹配时 `GetPolicy`、`GetPolicyVersion` 各 1 次读取 `TechlongSandboxServiceRoleBoundary` 的当前默认版。只存边界匹配、固定版本约束及连接用户范围摘要；不做 AssumeRole、模拟、取 IAM 登录 token 或 SQL 授权验证，不把旧租户权限当首开权限。 |
| 独立核验与原子完成权限 | **最多 5 次**：仅指定 `TechlongSandboxInstanceReleaseVerifierRole` 的 `GetRole`、`ListAttachedRolePolicies`、`ListRolePolicies`；仅在匹配已存边界时，`GetPolicy`、`GetPolicyVersion` 各 1 次，检查 `TechlongSandboxInstanceReleaseVerifierBoundaryV1` 的默认版。只比对信任、边界和读取能力，并标记可能的固定 Secret 读取、证据写入等额外能力；不假设现有 D2 验证者是纯只读或已有新首开权限。**Neon 完成身份无已审安装/执行授权证据**；不查猜测的 AWS Secret 名，不连接 Neon 验证 GRANT。必须另审受限首开入口与真实权限的正/反例，不用旧 D2 角色或 owner。 |

上表是原停止后确定的准确只读上限，不是执行审批。下方新一轮结果保留原停止记录，不覆盖原事实或延长其期限。

<a id="first-onboarding-step4-readonly-result"></a>

#### Source 刷新后的单次补核结果与最小待审差异

**2026-11-18 06:40:50.837–06:41:19.350（温尼伯 CST；12:40:50.837Z–12:41:19.350Z）｜元数据补核完成，首开不放行。** 用户刷新 Source 并明确允许新一轮后，区域 STS 1 次匹配 `402010193138` 的准确 IAM 用户；上表元数据 **20/20** 成功，无翻页、重试或范围扩张。不读 Secret 值、图片、基线对象或私密配置，不连 Neon/Aurora，不调用 Stripe，不启动/写入 AWS，不启用全队列，不登记或领取任务，不实际开通。仅保留以下去敏事实摘要；原凭据失败记录仍保留。准备引用按原观测及手册 5 小时规则，不产生执行窗口。

| 范围 | 本轮确认 | 不可据此放行 |
| --- | --- | --- |
| Express / 共享 Cell（3 次） | 集群 `techlong-sandbox-express-d001` 及准确 writer 均为 **`stopped`**，物理 ID/成员匹配，Aurora PostgreSQL `17.9`、IAM DB auth 开启。原 Cell 栈为 `UPDATE_COMPLETE`，有 `ClusterName`，但无 `HttpsListenerArn`、`ControlListenerArn` 输出。 | **当前承载未就绪。** 输出缺失不是对监听器实际物理状态的核验，不用旧 ARN 补空。未核对目标库/登录空闲、SQL 能力、空库写适配或固定基线对该版本的兼容性。 |
| 持久化参照（4 次） | 旧租户桶拥有者符合预期，四项 Public Access Block 均开启，版本化为 `Enabled`；原分发启用且 `Deployed`，桶 origin 与 OAC 匹配。 | 只证明旧租户模式，不复用其桶、权限或媒体，不能证明新租户存储/任务写入链路。 |
| Secret 固定版本（2 次） | 控制公钥及既有 D2 核验登录的两个准确旧引用均存在且为 `AWSCURRENT`，无删除计划、未启用轮换。 | 版本元数据不证明读取权、内容或 SQL 登录，也不能替代新租户 g1 Secret。新 ARN＋VersionId 的绑定路径仍缺。 |
| 生命周期／应用 IAM（6 次） | 两角色匹配原 `TechlongSandboxServiceRoleBoundary`（默认 `v5`）。所核对生命周期 inline 的 `rds-db:connect` 指向该集群 `postgres`；应用 inline 指向已初始化的旧租户 SQL 登录，边界摘要包含这两个用户。 | 仅说明所读允许语句，不证明交叉条件下的有效权限，不证明新的租户登录、SQL 创建/隔离和基线执行；不能把管理账号权限交给应用。 |
| 独立核验／原子完成（5 次） | D2 核验角色命中既有 GitHub environment 信任，唯一附加策略与其专用权限边界一致（默认 `v1`），无 inline。策略有资源元数据读取，也有带版本条件的 `GetSecretValue` 和证据 `s3:PutObject` 允许语句。 | 安装态 D2 核验角色不等于首开纯只读身份；本轮没有使用这些权限。Neon 首开完成入口/实际 GRANT 未查、未证明，不能复用旧 D2 登录或 owner 完成。 |

**当前审批清单结论：`NO_GO`，不签发执行 SHA。** 不做第二次盘点，下一步若获同意仅离线细化这些待审差异：

1. 将**原 Express 恢复与共享 Cell 的受审恢复/输出核验**列为独立前置范围；只围绕本轮准确集群和原 Cell 栈，明确恢复后两条输出、实际监听器 mTLS、路由及费用。恢复仍另审，不把它并入首次领取、借用旧 ARN 或启动其它环境。
2. 将**一次新租户 Express 空库初始化与首版持久化**限定为已知缺项：同一资源代际的管理/应用登录区分、无客户数据的固定版本基线与兼容性、首版 Express＋S3 配置、准确 DNS/路由，以及新 g1 Secret 版本生成与审批绑定。复用现有专用渲染器和持久化模式，不复用旧租户授权；不预填未生成的 ARN/版本。
3. 将**独立只读核验与专用原子完成**明确分权。提出首开独立元数据/技术读回的窄身份或等效受限会话，以及只允许原任务完成语句的 Neon 入口；要测允许完成本任务，拒绝未核验、越租户或改写既有 D2 状态。真实权限核对、需要的连接或安装均另审。

在缺项解决、目标任务和资源值真实绑定且另有执行授权之前，保持未购买、未领取、未启动、未开通。

<a id="first-onboarding-step4-delta"></a>

#### 第 4 步最小就绪差异：离线候选，不可执行

**2026-11-18（温尼伯）｜`NO_GO`，无执行 SHA。** 只复用 [06:40 CST 的限定补核](#first-onboarding-step4-readonly-result)与已提交源码/历史去敏材料；事实时点不续期。本节确定候选差异和验收门槛，不是已实现的适配、已验证的权限或新一轮读取许可。实际改动只限文档。

##### A. 原 Express 和共享 Cell：单独审批恢复，不重开整套环境

| 对象 | 将来拟议的最小动作 | 放行与停止条件 |
| --- | --- | --- |
| 原 Express | 仅指 `techlong-sandbox-express-d001`（已观测物理集群 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`），如果后来获准窄核对仍为 `stopped`，对原集群最多一次 `StartDBCluster`；writer 由原集群管理，不另外启动、替换或新建实例。 | 准确集群及 writer 均 `available`，物理归属、已审 PG17.9/IAM/TLS 条件未变。若已启动不再写；身份、版本、writer 或端点归属不符即停。这里不连 SQL、不建库，不启动 `speedfeast-postgres-prod`。 |
| 原共享 Cell | 只用原栈 `techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`。在另行核对实际停用模板、完整 12 项保留资源和空缺后，按[已验证的四资源模式](../ops/deployment-baseline/cell-a2-executed-20261107.json)派生一次变更集；只允许 Add `CellLoadBalancer`、`BusinessHttpsListener`、`ControlMtlsListener`、`BusinessControlDenyRule`，并恢复对应输出。将来创建/执行上限各 1，执行须先看到准确差异。 | 独立核对同一栈 `UPDATE_COMPLETE`、原 12 项物理 ID 不变、四项确属该栈，新 ALB/443/8443、业务拒绝规则、证书和 `verify` mTLS 正确；只使用实际新 `HttpsListenerArn`、`ControlListenerArn`。若仅缺输出而资源或模板差异不是上述 4 Add，则停并重审；不动其它栈，不导入或直接建 ALB。 |

仓库的[通用环境启停入口](aws-environment-tool.md)会涉及三栈和两库，不用于这两项窄恢复。可复用的是原栈变更集和独立核验方式，不是旧清单、旧监听器或旧权限附件。新监听器若落在当前 CFN 角色允许范围之外，只列对两条实际新 ARN 的最小声明差异另审，不能夹带到恢复变更集。恢复会带来持续费用，应在其余候选齐备后另定窗口；不顺手恢复平台、旧租户或其它 RDS，不装自动停费。若实际验收所需测试支付入口另有停止状态，单列前置，不扩大本范围。

##### B. 新租户：复用空基线，首版就用 Express 和隔离图片存储

- **初始化窄路径。** 复用 [Express V3 管理会话/prepare 合同](aws-auto-deployment-aurora-dual-mode-c3-bootstrap.md)与[同集群 PG17.9 空基线恢复及迁移的历史验收](aws-auto-deployment-aurora-dual-mode-c3g-restore-executed.md)，只作材料和底层能力参考，不运行历史固定目标入口、不复用其 OID、数据和永久槽。新目标库名/应用 SQL role 取本任务的不可变计划，Secret 名依现有代际函数派生；疑似占名、不同 g1/epoch、跨租户访问或身份不匹配即停，不领养旧资源。拟接入 `GuardedTenantDatabasePort` 的仅首开适配：一次 prepare、一次固定 schema-only 基线恢复及已审迁移、一次独立读回；不把现有 v2 `inspect` 改成通用写入口。真实 archive/manifest 须另绑定对象版本与两份摘要，再核对引擎、restore 工具和迁移合同。历史 73 表/两迁移/九条技术 seed 可作核对基线，不是新库证明；除批准的技术 seed 外业务行须为空。
- **SQL 与角色隔离。** 只允许核准的管理身份在指定 Express 集群操作同一新库/角色；正常应用不持管理权限。若复用 V3 quarantine，清单必须明列一次 `CREATE DATABASE`、一个新应用角色及仅本次临时 NOLOGIN guard 的建/收动作和每个阶段的 ACK；建库本身不与后续恢复/迁移算一个原子事务，失响应只读核对、不续跑。应用 `LOGIN`、目标库/Schema 权限和 `rds_iam` 依实际审核权限开启；必须证明不能登录旧租户库。若需改其它数据库的 PUBLIC ACL 才能隔离，当前方案不含这一写入，停止另审。现应用 TaskRole 的新旧任务无法仅靠资源 ARN 策略区分，不向原共享应用角色直接追加新库或新桶；首选仅本新租户可用的 TaskRole，限精确 dbuser 和图片对象。角色/边界/必要 `PassRole` 或认证若没有精确复用范围，单列最小 IAM 差异，角色凭据不下发给其它任务。
- **一次首版渲染，不先部署本地盘版本。** [Express 渲染器](../lib/deployments/cloudformation/express-single-tenant-workload-v1.ts)可复用 IAM/TLS、实际 OID 与 bootstrap readiness；目前是 render-only、协议与普通首开 finalizer 不同，不能直接交给 AWS 适配器。另批代码时，只在首开分支组合 Express、固定注入和持久化，重新做准确角色/参数、7 项逻辑资源、标签和 `createOnly` 校验；普通 worker 和原 D2 保持。通用 [TaskRole 参数白名单](../lib/deployments/execution/parameters.ts)固定为原共享角色，须在首开分支绑定批准的准确新角色，而不是全局放宽。租户栈保持一次总计 7 项，镜像仅 D2 可信目录的固定 digest，禁止启动迁移或后装一次 `UpdateStack` 修图片。
- **存储和 DNS 最小边界。** 现有[持久化派生](../ops/releases/persistence.ts)硬绑旧桶和角色，复用其任务字段形状而非旧常量：`IMAGE_STORAGE_PROVIDER=s3`、`IMAGE_S3_BUCKET`、`IMAGE_PUBLIC_BASE_URL`、`ALLOW_EPHEMERAL_IMAGE_STORAGE=false`。首选为新租户使用隔离私有 bucket 的 `products/*`，应用任务仅对本对象范围写；仅在证明后端、旧任务和 CDN 都隔离时才接受复用的独立前缀。没有合格预置存储时，另列私有桶、桶策略、OAC、CloudFront 分发、响应头策略 **5 项参照候选**，不是默认获批；保持 PublicAccessBlock、版本化、准确 OAC 与应用角色权限，不迁旧图、不开放桶。D2 需要确切新 hostname 的 A Alias；若该名空闲且不在栈内，才另批一次 `CREATE` 指向实际新 ALB，冲突即停，不 `UPSERT`、改旧域或用通配证据。当前首开还固定 listener priority 100，必须证明两监听器的模板所占优先级无冲突；不移动旧规则或启用全局优先级分配。

##### C. 固定 Secret 与 D2 摘要：先审派生规则，后接受真实回执

保留已知固定版本的原路径。对需要新建 g1 Secret 的验收，**建议仅增加首开专用的受限派生路径**，不要求采购前预测 AWS ARN，也不以阶段后得到的 hash 冒充审批。

1. 外层一次性批准绑定准确任务/订阅和 g1、基线/镜像/租户配置摘要、真实 Cell/平台/zone/存储及 API 版本、静态引用完整摘要；动态字段只允许该 g1 Secret 的物理 ARN 和初始 VersionId。先固定派生的完整 Secret 名、归属、批准的加密/版本范围和截止；最多一次创建一份初始版本，不复用未知同名对象、不 rotate，不将已有旧 Secret、其它版本或 `AWSCURRENT` 占位作为替代。
2. 保存当次创建的去敏 ACK（请求指纹、确切 ARN、实际版本、归属、代际/epoch），由分离的核验入口用 `DescribeSecret` 元数据同任务回读并与实际任务定义逐项比对，所有注入包括控制公钥均必须是批准的 ARN＋版本；不读其值。只有 ACK、独立元数据和运行引用一致，且批准的其它采样字段完全不变，才派生 D2 完整 `samplingSha256` 和相同证据；原始审批 SHA 不变。
3. 当前 [worker](../lib/deployments/execution/worker.ts)和[完成绑定](../lib/deployments/execution/first-onboarding-completion.ts)只接受领取前已知的固定摘要，未实现上述分支。实际接线前离线验证拒绝错误名/账户/epoch、未知回执、第二版本、变更静态字段和过期；不可先领取一个无完成段的任务来获取版本，再重开原单次槽。已就绪的真实新 g1 固定引用若另行证明，则用既有固定摘要机制，不再建 Secret。

##### D. 独立读回与 Neon 原子完成：两条权限边界

- **技术核验者。** 提议用独立只读会话或等效首开专用身份，取准确资源的 D2 采样、实际栈/监听规则/运行 digest、持久化配置和 TLS `/health`、`/ready`；数据库归属与 schema 只用独立的只读元数据证据，不看客户行。后续若需要实际连接，另列目标/权限。复用同一 [D2 sampling](../lib/deployments/releases/sampling.ts) 的事实形状，不把运行者的成功回执当独立结果，也不复用已有附带 Secret 值读取和证据 PUT 的 D2 核验身份。核验者只返回验证结果，不改存储、数据库、路由、ECS 或 Secret，也不提交完成；执行侧只有原任务范围的安全证据检查点写入。
- **Neon 完成者。** 候选为一个只接受同一任务实际完成材料的固定入口（优先复用本库锁及 CTE，必要时在专用无登录的最小权限所有者之下做固定 `SECURITY DEFINER` 函数，固定 `search_path`、限定参数和授权，撤销 PUBLIC 执行）。运行登录只授予该入口的 `EXECUTE`，不授予通用表 DML、D2 owner、角色管理、任意 SQL 或其它函数写权；不能交给可调用 owner 上下文的身份。依[现有语句](../lib/deployments/execution/first-onboarding-completion.ts)核对实际锁定/外键所需权限，写集合仅 1 条 D2 初始行和 3 条状态记录，一次提交；不修改目录、支付、订阅或已有 D2 记录。独立只读回查不持完成权，确认同一任务完成、实例与部署及时间/证据一致、D2 `revision 0` 无活动请求。隔离 PG 必测低权限真实登录成功、越租户/未核验/失租约拒绝、原绑定不可覆盖、部分失败整组回滚和未知回复只读回查；已有超级用户隔离 CI 不能当成最小权限实证。

**实施边界与顺序。** 先等明确许可做 B–D 的最小离线候选及必要回归；不再整批盘点。能否原样复用的结论随代码与隔离测试落账，仍不足以批准安装。再按真实缺项编制准确的只读、权限/存储/DNS 写入与 A 恢复清单；不提前恢复收费资源。只有真实测试购买另批并登记了唯一任务，暨工作区、目标物理值、证据与剩余窗口已绑定，才生成并请审同任务真跑清单；另需的 GitHub environment 由用户本人批准。任何阶段出界、结果不明或剩余窗口不足即停，不启动、不补写、不重试、不清理。**本轮无 AWS/数据库/Stripe 调用，无读取私密值、资源启动、队列启用、测试购买或任务写入。**

<a id="first-onboarding-step4-offline"></a>

#### 第 4 步首开专用离线接线

**2026-11-18 ｜ `NO_GO`，尚无生产执行清单。** 专用入口只接受已审的同一条 held 首开任务、第一代资源和一次领取；不启用普通 worker、全队列或 D2 的任何新权限。

- [Express 编排](../lib/deployments/execution/first-onboarding-express.ts)：只对新登记的首开计划绑定 V3 的确定性库/角色名，不改旧任务。校验准确物理集群及代际，编译现有空库 V3 程序并交付窄适配接口；恢复只接受固定版本和摘要的 schema-only 基线，依序执行 SaaS 迁移、准确新 SQL 角色激活及登录/隔离核验。首版直接渲染为 7 项 create-only 资源，使用新租户 TaskRole、私有 S3 桶及固定 CDN 地址，无本地盘降级；桶、CDN 和 DNS 不在这次 tenant create 中新建。
- **固定引用**：仅允许同一代际一次初始 g1 Secret，版本由审查 SHA、任务、fence 与基线确定，ARN 只能来自记录匹配的 ACK。独立 `DescribeSecret` 前后核对同一唯一版本；渲染及 D2 初始采样绑定实际 ARN＋VersionId 与批准的控制公钥版本，不读取 Secret 内容。
- [独立验收](../lib/deployments/execution/first-onboarding-reader.ts)复用现有事实采样，约束独立身份与元数据 API；比对栈、监听器、DNS、运行镜像、媒体配置、数据库物理归属/OID 及 TLS `/health`、`/ready`，数据库探测为只读。`HeadBucket` 和任务配置只提供作用域/存在性事实，不替代准确应用角色与 CDN 访问权限的安装证明。
- [Neon 完成入口](../lib/deployments/execution/first-onboarding-completion-entry.ts)只生成候选 DDL，运行者和独立回读者各用不同窄函数，函数 owner 为专用 `NOLOGIN`；一次原子提交实例激活、部署 ready、任务成功和 D2 `revision 0`。提交已确认而回读不明时停止，不补写、不重试。隔离 PostgreSQL 回归覆盖真实受限角色、越界/过期拒绝和完成回读，不是 Neon 权限已安装的证明。

**实际就绪差异见下方两份清单。** 生产端口、准确 SQL/Secret/IAM/存储/DNS 权限仍需审定，不能把注入测试或候选 DDL 当成已安装。缺项补核、权限安装、原 Express/Cell 恢复、测试购买与单条首开执行分别审核。

<a id="first-onboarding-step4-installation"></a>

#### 第 4 步清单一：最小权限、存储和 DNS 安装（离线待审）

**2026-11-18（温尼伯）｜`NO_GO`，不是可执行清单，不签发 SHA。** 依据 [06:40 CST 已存去敏摘要](#first-onboarding-step4-readonly-result)、源码 `4985c68` 与[离线及隔离 PostgreSQL CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44309450151)。不重新采样或刷新证据期限：旧应用角色只覆盖旧数据库登录，旧桶/分发仅作隔离部署样板，D2 核验角色有 Secret 正文读取及证据写入，不复用。只针对同一 sandbox 首开任务和 g1，不改普通 worker、旧租户、D2 角色、版本目录或队列开关。

| 项目 | 拟安装的最小差异 | 锁定对象与独立验收 |
| --- | --- | --- |
| **首开执行身份及控制面** | 一次性执行器只调用准确任务的 `SELECT_FIRST_ONBOARDING` / `CLAIM_FIRST_ONBOARDING`，只操作该任务的租约、外部围栏、步骤和技术证据；一次配置写入只给该实例。AWS 建栈提交侧只读准确新栈及最多一次 `CreateStack`，`iam:PassRole` 限准确 CFN 服务角色及 `cloudformation.amazonaws.com`。CFN 角色只覆盖初始 7 项承载资源所需动作及另批的托管回滚；ECS 两个 PassRole 严格限定给 `ecs-tasks.amazonaws.com`。 | 源码、运行入口、调用者／trust／边界、准确栈名、任务角色、日志组、外部围栏键及实际监听器 ARN 固定后才出策略。不授予直接 `UpdateStack`/`DeleteStack`、任意日志内容读取或 IAM 写，不以通配监听器 ARN 等待恢复。若共享角色不能只收敛到首开范围，停止该项，不把宽权限挂到现有 worker。 |
| **Express 生命周期与应用角色** | 复用可证实的 `TechlongSandboxTenantLifecycleTaskRole` 管理连接；只访问 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/postgres`，并在受审入口限定 V3 程序、固定空基线恢复、迁移及激活，管理凭据不进应用。若缺固定基线权限，仅候选两条准确 `s3:GetObjectVersion`（archive/manifest，分别固定键、VersionId 和 SHA；如需 KMS，仅准确加密对象所需范围）。每租户应用 TaskRole `TechlongSandboxFirstOpen-<租户摘要前16位>` 只给 `rds-db:connect` 到该物理集群的准确新租户 SQL 登录及本桶商品动作。 | 由实际实例/工作区/产品/环境/Cell 派生新库与角色，审管理和应用的有效权限，锁定基线工具及 PG17.9 兼容证据。`CREATEDB`/`CREATEROLE` 或等效管理能力不下发给应用；V3 临时 NOLOGIN guard、库/角色创建和应用 `LOGIN` 是将来首开动作，不是本次安装副作用。不改别的库的 PUBLIC ACL 来换取隔离，不借旧登录或默认 Full。 |
| **g1 Secret 供给与 ECS 执行角色** | 供给权限仅覆盖该代际派生的完整 Secret 名、归属标签和批准的加密路径；将来只用确定性版本 token 调用一次初始 `CreateSecret`，不用 `PutSecretValue`、轮换或删除。ECS 执行侧仅现有 ECR repo 拉取需用的能力、本栈日志流，以及控制公钥和新 g1 各自所需的固定版本注入。 | 固定控制公钥的 ARN＋VersionId。g1 只接受本次创建 ACK 的准确 ARN/初始 VersionId，并由独立元数据确认唯一版本。如在安装时 ARN 尚未生成，实际政策须把批准的完整名称推导边界、AWS 随机后缀的限制及固定 VersionId 的有效性写明；不能用全 Secret 通配或 `AWSCURRENT` 代替。若不能证实 ECS 固定版本请求受此约束，或确需取得 ACK 后再绑定权限，不放行首开、不领取后停等。只有已审客户托管 KMS 路径才列准确 key/服务/上下文及所需操作，不默认安装新 key 或宽解密。 |
| **独立只读核验** | 单独的 `TechlongSandboxFirstOpenInspector`；上限沿用[首开读取适配](../lib/deployments/execution/first-onboarding-reader.ts)的 24 次 AWS 元数据，限定原 Cell/平台和新租户的 CFN/ECS/ELB、Express 集群、ECR 镜像、指定 zone/name、桶拥有者和两个 Secret 的版本元数据。允许另审的准确 TLS `/health`、`/ready` 和仅目标库的 SQL 只读身份/版本/schema 元数据，不读业务行。 | 核对独立会话、实际 allowed actions、目标资源和必须使用 `Resource: *` 的只读例外，写清受限查询参数及无分页规则；不授予 `GetSecretValue`、S3 对象读写、CFN/ECS 写或 Neon 完成权。只读 DB 登录路径须另证，不用执行者、应用或 D2 核验凭据。 |
| **Neon 完成／回读** | 先审核供给一个 `NOLOGIN` definer 和互相独立、无角色成员资格的写／读 LOGIN；生成器只校验这些角色，不负责创建或供给凭据。再以一份原子 DDL 安装专用 schema `techlong_first_onboarding`、`complete`/`inspect` 各 1 个；列级读/锁及精确 DML 仅给 definer，撤销 PUBLIC，LOGIN 只有对应函数调用权。密码、托管和供给须另批，不进仓库。 | 按[生成器](../lib/deployments/execution/first-onboarding-completion-entry.ts)固定真实 job/deployment/instance、最终首开审批 SHA 和 `writeBefore`；在测试购买另批登记 held 任务、其余材料确定后，才能派生这份 DDL，且在任何领取前另批安装。安装后独立核对 owner、权限和函数正文摘要；真实运行一次提交 3 条状态更新＋1 条 revision 0 绑定，不允许拿执行入口做试写。独立读回用另一登录，既有 D2 角色、数据库 owner 和普通 worker 均不代替。 |
| **新租户私有图片存储** | 若无已证实合格的本租户设施，候选仅一个独立 CFN 存储栈、5 个资源：`MediaBucket`、`MediaBucketPolicy`、`MediaOriginAccessControl`、`MediaDistribution`、`MediaResponseHeadersPolicy`。桶名 `techlong-sandbox-tenant-images-402010193138-<租户摘要前16位>`；版本化、四项 Public Access Block、BucketOwnerEnforced、SSE-S3、保留桶，不设自动到期。OAC 签名；桶策略仅给准确分发 `GetObject` 到 `products/*` 并拒绝非 TLS；应用仅同前缀 `PutObject`，现有图片替换和失败补偿需 `DeleteObject` 时明确审入，不给 `DeleteObjectVersion`、列桶或其它桶权限。 | 沿用[五资源布局](aws-instance-release-persistence-plan.md)，不借旧桶/OAC/分发；CORS 仅准确买家来源，不改 API CORS。验收精确桶拥有者和 CFN 归属、保留/阻隔/加密、OAC/SourceArn 和对象范围、分发 `Deployed` 与真实 HTTPS 域名，以及 `s3`／地址／无本地降级。CDN 商品图片公开读取，不放业务私件；不搬图、不上传探针。 |
| **准确 API DNS** | 仅在原 Cell 恢复且实际新 ALB 经回读后，对准确公共 sandbox zone 的 `<实例 slug>.sandbox.techlong.cloud.` 提交最多一条 `CREATE` A Alias；权限候选限定准确 hosted zone、normalized name、类型 `A`、动作 `CREATE`，目标锁定真实 ALB DNS 和其 canonical hosted zone。 | 精确记录已存在且等于真实目标时不写；同名冲突、非预期类型/归属/目标即停。不 `UPSERT`、不改通配或其它别名，不能从旧模板填目标。核对 change 状态和准确别名回读；443 优先级 100（拒绝）/101（业务）、8443 优先级 100（控制）必须实际空闲，不挪旧规则。 |

**编成执行材料前要补齐的只有三组事实（新读取全部另审）：**

1. 围绕唯一拟验收实例：工作区/受信首版镜像、购买后 held 任务与租约范围、派生名称是否占用、准确 public zone/域名和新桶/角色名称；若对象尚未产生，明确标为未绑定。记录固定 archive/manifest 元数据与已有兼容证据，不列桶搜对象，不读正文。只对实际采用的角色补有效 trust/边界/相关策略、准确 ECR 与 Secret/KMS 版本元数据；不重复旧应用角色、旧桶或 D2 身份检查。
2. 围绕本次身份安装：明确每个注入端口的真实调用者、部署入口、SQL 事务/证据与准确 API 集合；Neon 只读目录、Express SQL 兼容/隔离、实际固定正文或私密登录验证若确有必要，单列连接和对象上限另审，不包含在元数据核对内。未证明的真实适配不由 CI 替代，也不通过给 owner/管理员运行权限绕过。
3. 围绕恢复后的新物理值：只从[清单二](#first-onboarding-step4-restoration)的独立回执派生两条监听器、ALB/Alias；若需 IAM 补差异只列实际 ARN。实例标识、Secret 派生、DNS/权限或完成 DDL 迟迟无法绑定时，保持任务待审，不先开始短领取窗口。

安装批准不含恢复、付款、领取、正式 `CreateStack`、首开配置写入或原子完成。将来实际安装须按准确对象及模板／SQL 摘要、上限、独立回读和失败策略审批；跨 AWS 与 Neon 非原子，失败可遗留收费资源或角色，未知结果不自动重提、补齐或清理。

<a id="first-onboarding-step4-restoration"></a>

#### 第 4 步清单二：只恢复原 Express 和共享 Cell（离线待审）

**共享准备边界：** 仅 `402010193138 / ca-central-1`，使用已存对象标识，不把 06:40 的 `stopped`/缺输出当当前事实。新读取另审，只需原 Express 集群和 writer 定向元数据、原 Cell Stack 状态/Original/一页资源和活动变更集；只有用于判断严格四项差异时才补已知的证书、mTLS trust store、实际监听器或角色关联。不盘点其它栈、区域、数据库，不探测 API、查私密配置或连接 SQL。

| 恢复对象 | 允许提请审批的写入上限 | 执行前门槛／成功回执 |
| --- | --- | --- |
| **原 Express** `techlong-sandbox-express-d001`，物理 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`，writer `techlong-sandbox-express-d001-instance-1` | 最多一次对原集群 `StartDBCluster`；不对 writer 单独写，不新建、替换或修改参数。 | 新事实确认原集群、writer、PG17.9、IAM auth、端点归属一致且确实 `stopped` 才提交；已 `available` 且匹配则不写。随后只读核对集群与原 writer 均 `available`，身份和端点不变；这不是应用或 SQL 验收。不明确、出现过渡/失败且超预算或 ACK 不明即停，不重发。 |
| **原 Cell** `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` | 原栈上 `CreateChangeSet(UPDATE)` 最多 1 次、对该准确 ARN `ExecuteChangeSet` 最多 1 次。仅 Add `CellLoadBalancer`、`BusinessHttpsListener`、`ControlMtlsListener`、`BusinessControlDenyRule` 及恢复相应输出；无直接 ELB 创建。 | 当前 Original 与归属必须证明 12 项保留且四项确实缺失，无竞争操作；逐项核对精确四 Add、无余下资源/参数/标签或角色更改。以[历史 A2 形状](../ops/deployment-baseline/cell-a2-executed-20261107.json)为参照，绝不复制 ARN、Change Set 或回滚选择。成功须独立证明同一栈 `UPDATE_COMPLETE`、12 个保留物理 ID 不变、总计 16、ALB active，443/8443 属同一 ALB，证书和 8443 `verify` mTLS/准确 trust store、443 共享拒绝规则正确，输出匹配真实 ARN。若已完整恢复，仅接受同等独立证明并跳过写；若仅缺输出或差异不是四 Add，停下另审。 |

**开窗和失败策略：** 先备齐可离线的安装、首版和验收材料，再另批窄恢复；只有 Cell 恢复模板和实际权限就绪才开窗，避免 Express 或 ALB 无谓提前计费。Cell 执行前须明确批准回滚选择；候选优先采用 CFN 托管回滚，不继承历史 `DisableRollback=true`，不授权主动回滚、删除 Change Set/资源或重试。未知提交、部分恢复、并发变化或窗口不足时只保留原记录，另批独立回读；不继续另一条写入来凑齐结果。恢复有持续费用，窗口结束不自动停费。**不恢复平台、旧租户、独立 RDS `speedfeast-postgres-prod`、整环境或全队列；不并入新 IAM/DNS 变更。**

编制两份清单时只编辑本地文档，未访问云。随后用户另批的定向补核见[结果](#first-onboarding-step4-install-restore-facts)，不重放旧事实或审批。

<a id="first-onboarding-step4-install-restore-facts"></a>

#### 第 4 步安装与恢复清单：集中只读补核结果

**2026-11-18 07:15:32.900–07:16:02.125（温尼伯 CST；13:15:32.900–13:16:02.125Z）｜`NO_GO`，无执行 SHA。** 固定 Source 区域 STS **1 次**匹配准确 IAM 用户；元数据 **20 次**（CFN 4、证书/trust store 2、IAM 13、Route 53 1），19 次成功，1 次为拟建核验角色 `NoSuchEntity`。未翻页、未重试。只保留本节投影，不保存模板正文、策略正文、证书内容或原始响应。

| 清单项 | 证据及结论 |
| --- | --- |
| **共享 Cell 四项恢复** | 原栈尾 ID `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`，`UPDATE_COMPLETE`，一页内无活动 Change Set。实际 12/12 项匹配[已存物理归属](../ops/deployment-baseline/cell-a1-executed-20261106.json)且状态稳定。缺四项恢复资源及 `HttpsListenerArn`、`ControlListenerArn`；查询的 Original 规范 SHA `42fc857cbbce881c411ff03997805e2d38635bd498f5d2c6ba695fc884a1e355`，与从[已存 16 项候选](../ops/deployment-baseline/cell-reattach-draft.template.json)仅移除四项资源和两个输出的结果完全一致，无其它模板差异。候选规范 SHA 保持 `e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`。这是离线模板差异，不是 AWS 已创建的 Change Set。 |
| **Cell 原依赖** | 原角色仍为 `TechlongSandboxFirstAcceptanceCellExecutionRole`，有 CFN trust、`TechlongSandboxFirstAcceptanceCellExecutionBoundary` 和唯一 inline `FirstAcceptanceCellResourcesV1`，无附加策略。原证书 ID `6d1f2880-9f83-449c-930a-6b17516ef49d` 为 `ISSUED`、覆盖 `*.sandbox.techlong.cloud`；原 trust store `techlong-sandbox-control-v1/aa1771fd0469cc44` 为 `ACTIVE`、1 个 CA。尚无实际新 ALB/监听器或 mTLS 独立验收；关联与元数据不等于四 Add、所选回滚及 PassRole 的实际有效权限。 |
| **原 Express** | 未重读集群或 writer，复用 [06:40 CST 摘要](#first-onboarding-step4-readonly-result)的准确集群、writer 当时 `stopped`、PG17.9/IAM auth，不把旧事实写成新的状态核对。恢复仍拟只启动原集群一次；执行前实际状态与独立回读均属另批清单。 |
| **首开权限** | `TechlongSandboxProvisionerRole`、`TechlongSandboxCloudFormationExecutionRole` 均存在，各只附加自己的 Boundary、无 inline；后者有 CFN trust。`TechlongSandboxTaskExecutionRole` 存在，有 ECS Tasks trust、`TechlongSandboxServiceRoleBoundary` 和唯一 inline `PullSandboxImageAndRuntimeSecrets`，无附加策略。这些是关联/信任摘要，不证明新任务角色 PassRole、准确新 g1 固定版本可读或新监听器 ARN 已被覆盖。`TechlongSandboxFirstOpenInspector` 返回 `NoSuchEntity`：需另审新专用角色，不拿既有 D2 核验角色代替。Neon 未连库，实际 GRANT 仍未证明。 |
| **持久化和准确 DNS** | 已确认 `Z01473621BTTHKXBGOOEJ` 是 `sandbox.techlong.cloud.` 的公共 hosted zone，未枚举或读取任何记录。新租户实例/slug、桶、CDN、应用角色及 g1 Secret 未绑定；缺可靠精确原件的 archive/manifest VersionId 也未靠搜索补全。故未查名称占用、S3/CloudFront或 Secret，未预填名称、Alias 或旧 ALB 值。新域是否空闲及新存储有效权限仍未证明。 |

**时序与继续点。** 已确认四 Add 的候选形状，不必再重复这一轮盘点；合用 Express 旧事实不晚于其原观测起算 5 小时（最早端 2026-11-18 11:40:50.837 CST），新补核不延旧期限、不授权开窗。先绑定单一验收工作区和可信首版，收口真实执行入口、安装权限和精确对象缺项；未绑定对象不读不写。原 Express/Cell 等其它材料齐备后再另批恢复，安装、恢复、测试购买、首开执行各自批准，不能用本节作为执行清单。**本轮 AWS 写、Secret 值、Aurora/Neon 连接、Stripe、恢复、队列启用、部署/调度、任务和槽变更均为 0。** 不改普通 worker 和 D2。

<a id="first-onboarding-step4-candidate-binding"></a>

#### 第 4 步：锁定可信首版与唯一验收范围（离线）

**2026-11-18（温尼伯）｜`NO_GO`。** 固定一个专用 sandbox 验收工作区作为唯一范围（拟用显示名「Sandbox 首开验收」；**真实 `workspaceId` 未绑定**）。仓库已存验收材料中的工作区 `ws_ac46ffc6778f44f5a4b5332c41bb9f33` 已有 `app_e897a4377bce498b9c5ee9e64509dcad`，不能当首开工作区；也不借此复用其租户桶、域名或权限。不从显示名猜 ID，不把一个未创建的工作区当成现存记录。若用户提供一个确切专用工作区 ID，只准备核对该 ID；若没有，记为待另批建立一个新工作区，不搜索或自动选择其它工作区。

**唯一首版固定为 A**：`release_00b9c5cfa6bceedc5fd05aa451dca811`（`d2-6-a-b9ca2138-r44128576107`），`prd_restaurant_order_system / tenant_api`。用[已存 A 目录对象](../ops/releases/d2-6-step4-activation.prepared.json)重算规范 SHA `b7aa3406a88a30cc9d38d88809dde6bfd8ee231784c5188ad11c43da62662702`，与[真实登记和独立回读](aws-instance-release-initial-publication-observed-20261117.json)一致；D2 最后一次真实验收回到 A，见[结案](aws-instance-version-release-plan.md#d2-closeout)。

- 固定镜像：`402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0`。存档 manifest 与 `linux/amd64` 平台 digest 相同，不用 tag、不替换成 B、不重推、不重新登记。
- 兼容要求：`express_iam`、`speedfeast-saas-control-v1`、端口 `3000`、`speedfeast-client-api-sha256:90191edd28decd490e95ea35461f9e26200874783a1ffc5f8598406bbc583144`；应用启动不得迁移/写数据库。已有 `ecr_verified` 是独立回读的历史事实，不替代使用前的目录未撤销、镜像仍在和新空库/基线兼容证明。
- 同一对象范围：账号 `402010193138`、区域 `ca-central-1`、环境 `env_aws_sandbox_ca_central_1`（key `aws-sandbox-ca-central-1`）、`cell-sandbox-1`、`standard-v1`。最多 **1 工作区、1 实例、1 条首开待审任务**；拒绝已有该产品实例或订阅、非测试模式购买、旧任务或第二个任务。全队列不打开。

##### 将安装清单绑定到真实值的顺序

| 最小安装项 | 本轮已固定 | 缺项与放行条件 |
| --- | --- | --- |
| **待审登记入口** | `AWS_SANDBOX_FIRST_ONBOARDING_RELEASE_ID=release_00b9c5cfa6bceedc5fd05aa451dca811`；`AWS_SANDBOX_FIRST_ONBOARDING_WORKSPACE_ID` 只允许一个真实工作区 ID；镜像必须是上面的 A digest。只登记待审且不会被普通队列领取的任务。 | 先拿到/只读验证准确工作区及 A 的当前目录状态，再单独审该工作区的配置和一次测试购买。`AWS_SANDBOX_IMAGE_URI` 也是[普通计划使用的镜像输入](../lib/deployments/management.ts)，不得为首开改全局默认。若现有入口的镜像与 A 不符，或不能证明只作用于该工作区，停下来另审最小差异，不走普通 apply。 |
| **首开身份／Neon** | 从[补核结果](#first-onboarding-step4-install-restore-facts)复用准确已有角色布局；缺少的独立身份只按 `TechlongSandboxFirstOpenInspector` 准备，拒用 D2 核验身份。首开完成/独立回读只用现有 `complete` / `inspect` 生成器。 | `runReviewedFirstOnboarding` 的引用目前只有定义和测试，没有已接通的真实入口；可信首版或已存在的角色不能代替签名调用者/稳定运行入口、范围、固定 Secret 版本请求和有效策略的证明。新应用角色/PassRole 与 Secret 范围须用下行真实派生名，监听器限定须等实际恢复输出；DDL 在真实 `jobId`、`deploymentId`、`appInstanceId`、执行签核的 SHA/截止固定后派生，领取前另外安装审批。不安装宽 policy、旧 D2 角色或 owner 暂代。 |
| **隔离存储和 g1 名称** | 用[现有派生](../lib/deployments/first-onboarding.ts)：`H=sha256Hex({appInstanceId,workspaceId,productId,environmentId,cellKey})`；桶只用 `techlong-sandbox-tenant-images-402010193138-`＋`H` 前16位，角色只用 `TechlongSandboxFirstOpen-`＋同前16位；库/SQL 角色同一前缀 `tenant_<H前16位>`。只准[五资源私有存储形状](#first-onboarding-step4-installation)，对象范围 `products/*`；g1 名调用[现有代际派生](../lib/deployments/execution/tenant-database.ts)。 | [真实购买路径](../lib/instances/management.ts#L435)才随机生成 `appInstanceId`，不能现在算出准确新桶/角色/Secret 名、目标栈或 job。另批购买后仅从唯一实际 held 任务派生，确认占用/固定运行引用和基线 archive/manifest 版本；新 CDN 地址从本桶实际分发回执获取，所需 KMS、VersionId 或兼容证据缺失时不启动首开。 |
| **API DNS** | 用已证实公共 Zone `Z01473621BTTHKXBGOOEJ`；新实例 `slug` 取真实记录（当前购买路径为 `pending-` 加实例 ID 下划线转连字符），只候选一条 `<slug>.sandbox.techlong.cloud.` 的 `CREATE A Alias`。 | 只查准确名称占用，不接受显示名或猜测的 slug、不查其它 DNS；Alias 的目标及 canonical hosted zone 只取原 Cell 恢复独立回执的实际 ALB；恢复前不装 Alias。固定动作和精确名称，冲突即停、不 `UPSERT`。 |

**工作区接续：** 用户确认没有可用专用工作区，转入[单工作区建立申请](#first-onboarding-step4-workspace-create)，不扫描或借用旧工作区。可信首版 A 保持不变。

<a id="first-onboarding-step4-workspace-create"></a>

#### 第 4 步：单工作区建立申请（仅准备）

**历史方案，未执行。** 原方案依赖一个已有的普通测试账号；用户已确认没有此账号，改为[普通账号与唯一工作区一同建立](#first-onboarding-step4-test-account)。保留原分析作追溯，不走后台的新建客户按钮或先建空工作区。

| 项目 | 单次待审范围 |
| --- | --- |
| **入口与前置** | 复用现有[新建企业客户页面](../app/admin/customers/new/page.tsx)与[受平台管理员限制的 POST](../app/api/admin/customers/route.ts)，只在已确认连接到本次验收控制库的既有可用入口提交一次。另行批准后，按确切邮箱验既有活跃非平台管理员账号，账号 ID 必须匹配代码的 `stableId("usr", email.toLowerCase())`，且同一负责人没有这一个确切名称的工作区；只查这些条件，不列客户或用户。账号不符、无可用入口、环境不明或已有同名工作区即停，不绕过入口直写 SQL，不启动平台或 AWS。 |
| **真实写入上限** | [createCustomer](../lib/admin/management.ts#L825) 在一个 Neon 批事务中执行三条语句：既有负责人账号仅更新 `users.updated_at`；插入 1 条新 `workspaces`（`active / not_configured / not_provisioned`）；插入 1 条该负责人的 `workspace_members`（`owner`）。原代码在邮箱缺失时会插入用户，**不在本稿批准候选范围内**；若不能把已有账号条件落实到受控提交窗口，则不执行。登录会话若需建立另界定，不取密码或 Cookie、不改用户权限。 |
| **回执与未知结果** | 成功只接受同一次响应的真实 `wsp_…`，另行限定只读回查该 ID 的状态、归属、成员数为 1、无订阅、无实例/首开任务；新 ID 仅用于下一步与 A 绑定，不立即写部署配置。提交后成功回读不在批事务内，超时/报错不能判定未提交；现有入口生成随机 ID、无幂等键，未知结果不再提交，不自动删除，另批仅按确切负责人和名称查因。只记录必要 ID/布尔值，不把联系人邮箱或认证数据提交仓库。 |

**原范围不包含：** 新账号/邀请、套餐配置、订阅、Stripe/测试购买、实例/任务、部署配置或 A 的重新登记，以及 AWS 读取、安装、恢复、队列启用和实际首开。原方案没有创建任何数据，不是当前待批动作。

<a id="first-onboarding-step4-test-account"></a>

#### 第 4 步：一次普通注册建立专用账号及工作区（仅准备）

**`NO_GO`，无执行 SHA。** 用户确认没有测试账号，拟复用[普通注册](../app/register/page.tsx)，非邀请路径。只登记 1 个非平台管理员账号和 1 个新工作区「Sandbox 首开验收」，用户用自己控制且未在该验收入口注册过的邮箱和自设密码；不借旧租户或平台管理员。普通注册直接生成工作区，**不再走后台新建客户**。这是控制库中的普通工作区，不自动配置 sandbox、套餐、付款或部署。A 保持锁定。

| 项目 | 单次待审范围 |
| --- | --- |
| **入口** | 只在后续确认已可用且连接本次验收控制库的可信入口，由用户本人在无旧登录会话的浏览器窗口打开 `/register?returnTo=%2Fdashboard%2Fsettings`，一次提交 `POST /api/auth/register`，不带邀请 token。来源与实际部署版本必须匹配；无可信可用入口就停，不能借用旧租户、直写 SQL、开公共注册窗口或自动启动平台。已有[平台停用记录](aws-environment-tool.md)不是实时探测结果，也不授权恢复。 |
| **实际写入** | [注册实现](../lib/auth/credentials.ts#L159)先按规范化邮箱查重，账号、工作区、Owner 成员关系和密码散列各 1 行同一事务；账号 `active / 非管理员`，工作区 `active / not_configured / not_provisioned`。不发信、不邀请、不插入订阅/实例/任务。密码仅在本人可信页面输入，不在聊天、报表或仓库中收集。 |
| **已接受的注册副作用** | 注册成功后另建 1 条登录会话并设置 Cookie。[现有会话事务](../lib/auth/credentials.ts#L419)同时删除该控制库内截至当时**所有已过期会话**，不只测试账号；不影响有效会话。用户已接受本人后续标准注册的这项副作用，本轮只许查入口，不执行会话清理或注册。 |
| **回执与未知结果** | 页面返回成功后只进[工作区设置](../app/dashboard/settings/page.tsx)读取 `wsp_…`、名称和 Owner 状态，不购买、不配置；只回传工作区 ID 或简短错误。账号/工作区事务与会话事务分开，超时/500 可能已提交前者；不要重复提交或再走后台创建，另批仅对该邮箱派生的准确工作区进行只读查因。独立回查也另审，只核对该工作区、普通账号、唯一 Owner、无订阅/实例/首开任务，不查密码散列或会话正文。 |

<a id="first-onboarding-step4-register-readonly"></a>

**入口只读结果（2026-11-18 07:58:04.882–07:58:05.267 温尼伯 CST；13:58:04.882–13:58:05.267Z）：`DNS_UNRESOLVED`。** 对既有 `https://console.sandbox.techlong.cloud/register?returnTo=%2Fdashboard%2Fsettings` 尝试 1 次匿名 HTTPS GET，当前执行环境未解析出主机，curl 退出码 6；未建立 TLS、无 HTTP 状态、未见注册表单。未重试、未跳转或另查 DNS/平台资源。结果只说明本次入口不可达，不单凭此判断云端资源现在的状态。

**停止点：不注册。** 未登录、未提交表单、未取凭据或 Cookie，账号/工作区/会话、数据库访问、购买、AWS API、恢复及队列变更均为 0。用户随后要求只准备[既有注册入口最小恢复方案](#first-onboarding-step4-register-minimal-restore)，不能自动恢复。首版 A 不变。

<a id="first-onboarding-step4-register-minimal-restore"></a>

#### 第 4 步：原 sandbox 注册入口最小可用方案（离线）

**2026-11-18（温尼伯）｜`NO_GO`，无执行 SHA。** 为了使用原地址 `https://console.sandbox.techlong.cloud/register?returnTo=%2Fdashboard%2Fsettings`，只考虑让**原平台栈**重新提供网页和认证，不恢复整个环境。复用[已存停用回执](../ops/temporary-idle/stop-continuation-execution-20261113.json)、[原 11 项平台闭控模板](../ops/deployment-baseline/platform-idle-convergence.template.json)和[本次 DNS 未解析的记录](#first-onboarding-step4-register-readonly)。离线校验历史模板的四项恢复差异、七项保留及来源 `d098cfefd11c8839d5b00fee0701a71ed74aa73c` 确有普通注册和工作区设置页；不把旧回执或本次 DNS 失败当成当前云端归属，也不证明线上镜像此刻可拉取。

| 范围 | 候选最小变化 |
| --- | --- |
| **原平台栈** | 仅 `402010193138 / ca-central-1`、`techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`。若实际仍是已知七项停用形态，只候选同一栈一次 `UPDATE` Change Set，恰四个 Add：`LoadBalancer`、`HttpsListener`（443，原证书）、`Service`（仅 1 个原 Fargate 平台任务）及 `DnsRecord`（原公共 zone `Z01473621BTTHKXBGOOEJ`、准确 console A Alias）。Alias 由模板引用**本次同栈新 ALB**的 DNS 与 canonical hosted zone，不手写旧 ARN、不在 Route 53 另做 `UPSERT`。保留 `AlbSecurityGroup`、`Cluster`、`LogGroup`、`TargetGroup`、`TaskDefinition`、`TaskIngress`、`TaskSecurityGroup` 七项及其物理 ID、参数、角色、标签、输出；不能借机更新旧资源。 |
| **运行配置和数据** | 原平台镜像 `techlong-sandbox-platform-web@sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a`、原任务定义及固定 `DATABASE_URL` 注入引用不变；按已有证明绑定原验收 Neon 控制库，不另供给账号或读 Secret 值，不改数据库。控制器及 hosted/local、初始请求、worker、apply 均保持关闭；不挂载控制器私钥，不开启租约或部署入口。镜像、引用、启用态或数据库归属不能证明即停。不恢复共享 Cell、租户栈、Aurora 或独立 RDS，不调用整套环境 `start` 工具。 |

**将来实际顺序（各自另审）：**

1. **一次定向只读补核。** 只核对原平台栈状态、Original、保留资源和是否有未决变更集；再核准确保留任务定义的镜像与闭控/固定引用，以及该 zone 上 console 精确记录占用。复用尚有效的同证书证据；只在现有证明不足时另列准确证书、镜像或 Secret 版本元数据，不查正文、不重复盘点其它栈。若实际已恢复，只核现有入口不做写；若并非准确四 Add、出现外部同名 DNS/ALB 占用、模板/执行身份或保护变化，停止，不接管/覆盖。
2. **只创建并审这一份变更集，执行再确认。** 固定实际模板、执行身份和差异，`CreateChangeSet` 与 `ExecuteChangeSet` 拟各最多 1 次。历史原栈未关联显式 `RoleARN`；若实际仍使用提交者派生会话，须明确审核其权限，不擅自指定新角色。看到准确四 Add、七项无 Modify/Replace/Remove 后才审核执行；明确 CFN 托管回滚的权限与副作用，无权限或需改其它资源即停。不继承旧变更集/授权，不直接改 ELB、ECS、DNS、IAM；失败或提交不明不重试、不主动回滚/清理。
3. **独立证明页面可用，再由用户本人注册。** 回读同一平台栈 `UPDATE_COMPLETE`、四项归属/七项物理 ID、任务定义与关闭开关、ECS 1 运行/0 待启动及目标健康、443 验证的证书、准确 Alias 指向新 ALB；再做不带身份的 HTTPS GET，各最多一次 `/api/health` 和准确 `/register?returnTo=%2Fdashboard%2Fsettings`，要求正确平台响应和普通注册表单，无外部跳转。不把 `/api/health` 200 或页面表单当成数据库写入通过，不为验收追加测试 POST。通过后只把可信入口交给用户本人；注册/工作区回执和任何后续购买是独立步骤。

**费用和公开面的边界。** 原 HTTPS 监听器转发整个平台，不是只开放 `/register`；拟复用原访问边界，不新加公网旁路或开启部署控制。ALB、1 个任务、公网 IPv4 等可能持续计费；本方案不设置 TTL、不自动停费或删除，注册后如需关停只按原平台栈另审。不在本轮更改正式模板、代码、配置或启停状态。**本轮只读仓库内已有证据并做离线断言；AWS/公网探测、数据库、Secret 值、创建变更集、资源启动、注册和购买均为 0。**

<a id="first-onboarding-step4-register-platform-facts"></a>

#### 第 4 步：注册入口原平台定向核对结果

**2026-11-18 08:17:53.956–08:18:04.681（温尼伯 CST；14:17:53.956–14:18:04.681Z）｜只读核对通过，未恢复，`NO_GO`，无执行 SHA。** 已获准的固定 Source STS 1 次匹配准确 IAM 用户；元数据 6 次全部成功（原平台 CFN 4、准确 ECS 任务定义 1、准确 Route 53 名称 1），无翻页或重试。仅保存以下投影，原始模板、任务环境和 Secret 引用不另存或输出。

- **原栈**仍为 `c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`、`UPDATE_COMPLETE`、无显式 `RoleARN`。`Original` 规范 SHA `cd0a829365af8e1b2a6a993448866237d0ea3b0920eb43b783c6f5aa380437e1`；与历史 11 项模板仅去掉 `LoadBalancer`、`HttpsListener`、`Service`、`DnsRecord` 后的全文一致。实际 7/7 个保留资源的逻辑 ID、类型、物理 ID 和稳定状态匹配，单页未决 Change Set 为 0。
- **任务定义** `techlong-sandbox-platform-web-v1:13` 为 `ACTIVE`，匹配原 CFN 物理绑定、平台镜像 digest、单容器、Fargate 网络/规格、执行角色及无应用 TaskRole。完整环境匹配原闭控模板，控制器（含 hosted/local）、初始请求、worker 和 apply 均关闭；唯一 `DATABASE_URL` 固定 Secret 引用匹配。核对的是定义元数据，不是运行中任务、Secrets 内容、镜像仍可拉取或数据库可用性的证明。
- **DNS**：在已知公共 zone `Z01473621BTTHKXBGOOEJ` 从 `console.sandbox.techlong.cloud.` 精确名称起查一条；返回的第一条不是该名称，故**本轮未见准确名称占用**。未跟页，未保存邻接记录或修改 DNS；新 Alias 目标仍须取同栈实际新 ALB。未重新探测 `/register`，也未查询 CloudFormation 之外同名 ALB 是否存在。

**下一步只用本轮事实编制「仅创建、不执行」的四 Add Change Set 审批材料。** 不重复盘点，不换角色或候选；如实际创建所需的精确依赖有未证明项，另列最小核对，不用历史数据强行放行。本轮新事实按首个采样起算至温尼伯 **2026-11-18 13:17:53.956 CST**，不延期，不自动开执行窗口。AWS 写、Secret 值读取、数据库访问、创建/执行变更集、资源启动、注册、购买和调度均为 0。实际创建与执行分别另审，页面核验通过后才由用户本人注册。

<a id="first-onboarding-step4-register-create-review"></a>

#### 第 4 步：原平台四项恢复变更集——仅创建审批材料

**原清单已批准，提交前停止，不可重放。** [原清单](../ops/deployment-baseline/platform-register-restore-create.review.json)规范 SHA **`1b39fab237fa130f9b4abe7968105c71ea67ede2b92bdae851621e2b085f2d6f`**仅供追溯，见[更正清单](#first-onboarding-step4-register-create-standard)。候选为 `techlong-platform-register-restore-20261118t141753z`；仅普通 `UPDATE`，原平台栈，不导入或包含嵌套栈。

| 核心项 | 准确范围 |
| --- | --- |
| **模板差异** | 用原 11 项闭控模板只派生 `Service.DesiredCount=1`，候选模板规范 SHA `6b982ae4027bf583793f6be6e2a1631994f5c2aca0b548309e81a55b5dd5e036`。相对本轮只读核实的七项停用模板，恰四 Add：`LoadBalancer`、`HttpsListener`、`Service`、`DnsRecord`；0 Modify/Remove/Import/Replace。七保留资源和模板其它段逐值不变；根 Description 的历史停用文字只作归属记录，新服务的真实期望数以新增 `Service` 声明为准。 |
| **原参数、角色、标签** | `ControllerLease`、`HostingExpiresAt` 均 `UsePreviousValue`，原标签映射须匹配再原样传递，不续约。原栈无显式 `RoleARN`，不指定新角色或 IAM 能力；CFN 可能按原调用者的临时会话权限验证，不据此安装/扩大 IAM。任务仍用保留 `:13` 与固定 DB Secret 引用，控制器、初始请求、worker、apply 均关闭；不读 Secret 值。 |
| **待批准调用** | 最多 `CreateChangeSet` 1 次；前置、独立回读共 STS 最多 2、元数据最多 12。一组仅核对原栈状态/更新时间/原标签/无未决变更集，以及**单个准确 ALB 名**和 console DNS 名均无碰撞；ALB 名是上轮没有读取的新对象检查，须在本次批准中明示。只在 ACK 后由独立进程使用同一固定 Source 身份，对准确 ARN 最多 4 次单页 `DescribeChangeSet`（总等待不超过 180 秒），核对 `CREATE_COMPLETE / AVAILABLE` 和四 Add，再比较变更集模板摘要、原栈模板与七项物理 ID 保持不变。不对其它栈、镜像、数据库或平台 HTTP 检查。 |
| **失败与禁止** | 提交前写单次意图并占永久槽；超时、响应不明、变更集不符或事实变化即停，不自动重发、删除未执行记录、回滚、补齐或消费新槽。API/provider 验证与日志可能有低额非零费用；并发或 AWS 后台验证不是跨资源原子操作。`ExecuteChangeSet`、其它云写、ALB/ECS/DNS 实际恢复、注册、购买、队列、Cell 和数据库操作均为 0。 |

**原事实时限不延长。** 若未来获准，最晚 **2026-11-18 13:07:53.956 CST（温尼伯）**启动本轮创建核对，事实 **13:17:53.956 CST** 截止；超过任一门槛不提交、不重放。取得并独立核对准确 Change Set ARN 后，再另报执行与失败策略审批；注册页当前仍未恢复。本轮本地复算清单、物化请求和模板三份 SHA 并核对四 Add、保留配置与边界，仅提交审批材料；没有执行工具接线、AWS 读取或写入，没有创建记录或消费槽。

<a id="first-onboarding-step4-register-create-standard"></a>

#### 提交前停止：更正普通变更集 API 参数

用户批准原 `1b39fab2…` 后，提交前对照既有生命周期工具和 [AWS CreateChangeSet API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html#API_CreateChangeSet_RequestParameters) 发现：请求字段 `DeploymentMode` 只接受 `REVERT_DRIFT`，而 `STANDARD` 是普通变更集的验收语义。**不把 `STANDARD` 发给 AWS，也不擅自改成漂移修复。** 本轮 STS、AWS API、写入、变更集、槽消费和启动均为 0；原记录保留。

**[更正后的仅创建清单](../ops/deployment-baseline/platform-register-restore-create-standard.review.json)规范 SHA `665738dfae20643d7f0fc0dbf1660ccf26b776e7b792fcf1d59ec20e5a290932` 随后获批。** 物化请求规范 SHA `583fbccd10f2d13c851c90521f25b793af4cfe0dcef83d0597838bf90d6dadea`；实际请求唯一变化是省略 `DeploymentMode`，也不加 `DeploymentConfig`。模板、四 Add、七项保留、目标栈、候选名称、有限前置读取（含准确 ALB 名）与独立回读边界均未变。原时限不延期，见[实际创建回执](#first-onboarding-step4-register-created)。

<a id="first-onboarding-step4-register-created"></a>

#### 原平台四项恢复变更集已创建，未执行

**`READY_UNEXECUTED`｜2026-11-18 08:31:24.655–08:31:52.494 温尼伯 CST。** 按 `665738df…` 单次创建并经独立进程回读：[去敏回执](../ops/deployment-baseline/platform-register-restore-created-20261118.json)。准确 Change Set ID 尾段 `52eb096a-3ed2-48a8-80cf-1d34671495df`，`CREATE_COMPLETE / AVAILABLE`，普通 `UPDATE`。前置只按准确 ALB 名得到 `LoadBalancerNotFound`、准确 console DNS 名未占用。实际四项均为 Add：`LoadBalancer`、`HttpsListener`、`Service`、`DnsRecord`，无修改、删除、导入或替换；候选摘要匹配，原栈模板、角色、参数、标签、输出摘要和七项保留物理 ID 不变。

实际 STS 2、元数据 10、`CreateChangeSet` 1、`ExecuteChangeSet` 0，单次创建槽已消费，不重放或删除。未启动平台、ALB、ECS 或数据库，未更新 DNS、启用队列、注册或购买，也未取 Secret 值或连接数据库。**下一步仅准备同一 ARN 的执行审批及失败策略，需另批。** 原事实仍于温尼伯 **13:17:53.956 CST** 截止，不因回读延期；本轮没有执行清单 SHA，注册页未恢复。执行后的独立核验和本人注册仍是后续单独步骤。

<a id="first-onboarding-step4-register-execute-review"></a>

#### 原平台注册入口：同一变更集的执行审批与失败策略

**`PREPARED_NOT_APPROVED`。** [待审执行清单](../ops/deployment-baseline/platform-register-restore-execute.review.json)规范 SHA **`f6069d7f335692444ecd4b49321fbd3ad1b3131f2c31fef7666965e21a4c605e`**，绑定真实创建并独立回读的原 ARN（尾段 `52eb096a-3ed2-48a8-80cf-1d34671495df`）。最多一次 `ExecuteChangeSet`，精确请求摘要 `88d397f8a6d4ebc7a70dfe08d6bf3ae1007d361c0fc363cb0ae9ada45475a033`，`DisableRollback=false`，不再调用 `CreateChangeSet`、不直接做 ECS/ALB/DNS/IAM 写入。

| 阶段 | 拟批准的范围和门槛 |
| --- | --- |
| **前置** | 固定 Source；仍是同一 `CREATE_COMPLETE / AVAILABLE` 普通变更集，无竞争变更集；恰四 Add、模板与原栈的两个摘要/七项物理 ID/原角色和标签匹配；准确 ALB 名、console DNS 名仍空。最多 12 项元数据，只包含这一个栈和确切依赖，并检查原 `:13` 仍 `ACTIVE` 和闭控、原证书、镜像 digest、已固定数据库 Secret 版本元数据（不取正文、不连库）。存在差异、权限不足、来源不符或时间不足，在写前停止，不自动改参数、换角色或补读。 |
| **提交与托管等待** | 写单次意图后只执行原 ARN，一次提交。CloudFormation **托管回滚开启**，可能移除本次新增的资源，回到原停用状态；这不是另行手工回滚授权，也不保证失败后没有遗留资源。收到明确 ACK 后，只看原栈，最多 7 次 `DescribeStacks`、间隔至少 60 秒、最多 8 分钟。旧栈 `UPDATE_COMPLETE` 的残留读不当成这次成功；须看到本次更新已完成并进入独立读回。 |
| **独立核验和交付** | 仅在看到本次 `UPDATE_COMPLETE` 后独立核对已 `EXECUTE_COMPLETE`、候选模板、同一栈四项归属及七项物理 ID 等未改、`:13` 和 1/1/0 任务、ALB active、443 原证书/目标 healthy、准确新 ALB Alias（最多 9 项元数据）；然后仅对 `/api/health` 与准确 `/register?returnTo=%2Fdashboard%2Fsettings` 各一次匿名验证 TLS GET，无外部跳转，不提交表单。合计 STS 最多 3、AWS 元数据 28、GET 2；无注册/登录、购买、Agent 直连数据库或调度。独立验收过后才告知本人注册，不以 HTTP 200 代替注册提交或工作区验收。 |

**失败处理：** 无法确认提交时停止保留永久槽，仅另批对同一 ARN 的只读查证，不重发。失败、进入托管回滚、等候超时或审批时限用尽时记录实际状态；不强行取消仍可能在后台进行的 CloudFormation 操作，不清理或另建。若栈已更新但独立核验失败，明确记为「已更新、注册入口未验收」，不要注册；资源可能继续计费，任何补查、修复或停止另审。

**风险和时限：** 只恢复原平台，仍是原公开 HTTPS 入口，不是仅 `/register` 的访问限制。CloudFormation 可能用原调用者派生会话；平台启动可由 ECS 托管拉取固定镜像、注入既有数据库 Secret 和产生普通日志，并允许正常流量。ALB、单任务、公网 IPv4 等可能持续计费，不设置 TTL、不自动关停；不恢复 Cell、租户、Aurora 或独立 RDS，不开启 worker。最晚温尼伯 **2026-11-18 13:02:53.956 CST** 启动核对，**13:05:53.956 CST** 前提交，原 **13:17:53.956 CST** 事实/读取截止不延；超时不自动刷新。此轮只复用并核验本地清单/回执/模板，没有调用 AWS、执行、注册、重建或消费执行槽。实际执行及以上限定读取均须明确批准此 SHA。

<a id="first-onboarding-step4-register-executed"></a>

#### 原平台注册入口已恢复并独立核验

**`REGISTER_ENTRY_VERIFIED`｜2026-11-18 08:54:57.080–09:01:41.170 温尼伯 CST。** 用户批准 `f6069d7f…` 后，仅一次执行原 `52eb096a…`，`DisableRollback=false`，未创建新变更集。[实际去敏回执](../ops/deployment-baseline/platform-register-restore-executed-20261118.json)记录 `UPDATE_COMPLETE / EXECUTE_COMPLETE`，候选模板、同栈四项新归属及七项保留 ID 均匹配；仍用原任务定义 `:13`，控制器与 worker 关闭，任务 1/1/0、rollout 完成、目标 healthy。原证书在新 443 监听器上，console A Alias 指向这次的新平台 ALB。

独立匿名 GET `/api/health` 和[普通注册页](https://console.sandbox.techlong.cloud/register?returnTo=%2Fdashboard%2Fsettings)各一次，均通过 TLS、返回 HTTP 200；确认普通注册表单，未提交。实际 STS 2、元数据 28（前置 12、等待 7、独立 9）、`ExecuteChangeSet` 1、GET 2，执行槽已消费。其他直接写、Secret 值读取、Agent 连库、登录、注册、购买、Cell/租户资源或两库恢复均为 0；无自动停机，平台 ALB 和任务等可能持续计费。

**当时交付：由用户本人注册一次，不购买。** 用户随后提交后遇到服务端通用错误，不能按页面曾验收通过推定已注册。现转入[注册权限修复待审](#first-onboarding-step4-registration-permissions)，不重复提交、不重放平台恢复。首版 A 不变。

<a id="first-onboarding-step4-registration-permissions"></a>

#### 第 4 步：普通注册最小数据库权限修复（仅离线实现）

**`OFFLINE_PROPOSAL_NOT_EXECUTABLE`。** 11 月 18 日温尼伯 **09:20:27.828 CST** 的唯一注册失败日志：PostgreSQL `42501`，应用访问 `public.users` 被拒；阶段只能定位到账号查重或注册事务，未做数据库回读，账号/工作区是否存在仍不得假定。原任务的固定 `DATABASE_URL` 引用与[已验收 Web 凭据](aws-platform-hosting-web-credential-w7m-observed.md)完全匹配，项目的[原授权](../ops/platform-web-database-role-v1/no-login.sql)只设计已有账号登录/只读验收：`users` 等只给 SELECT，认证表只给原登录所需列，未给注册的四表 INSERT。若实际目录证明查重 SELECT 反而失效或角色不符，先停，不以新写权限掩盖读权限漂移。仅引用去敏日志证据，不保存原日志或邮箱。

**选定方案：一个受限注册函数，不给 Web 直接写表。** 保持 `techlong_platform_web_acceptance_v1` 的既有授权不变；候选只新增独立 schema 的 `USAGE` 以及该 schema 一条固定注册函数的 `EXECUTE`，没有对 `users`、`workspaces`、`workspace_members`、`user_credentials` 的新直接 DML 或角色成员资格。不借 owner、超级用户或部署控制器；也不直接给四表列权，避免 Web SQL 任意创建管理员或为旧工作区追加 Owner。

| 边界 | 拟议最小变化 |
| --- | --- |
| **数据库实现** | 专用 `NOLOGIN/NOINHERIT/NOBYPASSRLS` definer，仅拥有新 schema 和一条 `SECURITY DEFINER` 函数，不拥有业务表，不赋给 Web 角色或留成员关系；只给[清单](../ops/platform-web-database-role-v1/sandbox-registration-permissions.review.json)所列四表 INSERT 列与必要 schema USAGE，不给 UPDATE/DELETE/TRUNCATE、不改 RLS/约束/触发器。函数固定 `search_path=pg_catalog,pg_temp`、全限定表名、无动态 SQL，同一事务撤销 PUBLIC EXECUTE。 |
| **注册约束** | 只绑定用户本人准备的一个规范化测试邮箱（受审私有材料中绑定摘要，不在 Git/聊天公布）及「Sandbox 首开验收」，一次最多生成 1 个普通账号、1 个工作区、1 条 Owner 成员关系、1 条密码凭据。按既有算法派生 ID，不接受调用方指定 ID、成员角色、账号状态或管理员位；普通账号、工作区的状态及非管理员值由函数写死。仅接既有 PBKDF2 结果（散列 64 位十六进制、盐 32 位、迭代 600,000），不传明文。四条 INSERT 必须同一事务，无覆盖、认领旧记录或拆分提交；已存在即拒绝。邮箱约束本身不验证邮箱归属，不把实际目标邮箱公开；若不能接受公共入口可能被知晓该邮箱者抢注的风险，不启用。 |
| **应用接线** | 仅让 sandbox 的**普通注册**用一次带绑定参数的函数调用替换原四表 `db.batch`，保持输入校验、哈希和重复账号 409 行为。默认非本验收路径不获得该能力；不加邀请、重置密码、登录、worker 或新发布框架，不回退到用 Web 直接写四表。原会话创建在注册提交后独立进行，保留用户已知的过期会话清理；这意味着会话失败时仍可能已有账号，遇 500 或超时仍不反复注册。 |

**审批清单与验收顺序：**

1. **已批准离线实现与隔离 PostgreSQL 回归。** [离线 SQL 模板](../ops/platform-web-database-role-v1/sandbox-registration-ddl.ts)只生成一条 `sandbox_registration.register_account` 的安装事务，不连接数据库，不内置真实邮箱摘要或挂进自动迁移。[普通注册调用点](../lib/auth/credentials.ts)复用现有服务器端 `alb-https-v1` 和准确 sandbox origin；函数调用失败不回退到直接写四表，其他环境、登录、邀请和会话处理不变。[隔离回归](../tests/sandbox-registration-postgres.test.mjs)使用合成身份和专用的一次性 PostgreSQL 库，覆盖四行原子成功、最后一条 INSERT 失败回滚、错误邮箱、重复、无额外角色参数、Web 直接写/冒用 definer 和 PUBLIC 调用被拒。只触发无 AWS 身份的 CI。
2. **实际安装和发布另批。** 仅对准确 Neon 目标、Web 登录/OID、有效权限/成员关系、四表约束/RLS、新对象名、安装角色的创建与转移所有权能力、默认授权及同一测试身份做一次限定 `READ ONLY` 前置（范围与凭据使用须确认，不读密码散列或其他用户正文）。隔离库能执行 DDL 不代表托管安装者具备相同权限或无自动成员关系；若无法满足清单、不保留意外 ACL/成员关系的条件，停止，不额外授权。若先前提交状态不明，先查目标身份是否存在；已存在不采用重试或改旧记录。实际 SQL 固定摘要后另批，一次原子 DDL 安装及独立目录回读，不发起注册验证。后续确切平台镜像和原闭控服务最小更新还要单独批准，不改 `DATABASE_URL`、IAM、平台登录/会话权限或其它栈；SQL 与发布非原子，任何未知结果不自动重放或清理。
3. **只读验证完成后再另批本人一次注册。** 只有函数/权限与平台代码都在实际运行中绑定且目标仍空，才让用户在原入口试一次；不购买、不创建部署任务。未知结果只查唯一派生 ID，不复制、删除或延用旧批准。

**离线验收通过，线上仍为 `NO_GO`。** 实现提交 `04e876b` 的[无 AWS CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44337547242)通过离线及 PostgreSQL 16 隔离回归。本机认证回归、TypeScript 和 scoped lint 也通过。[原机器审批清单](../ops/platform-web-database-role-v1/sandbox-registration-permissions.review.json)原样保留，没有生产安装 SHA 或线上授权。未联系 AWS/Neon、未读 Secret 值、未改线上权限或重试。下一个继续点仅为另审限定只读前置核对；首版 A、普通 worker 和 D2 运行路径不变。

<a id="first-onboarding-step4-registration-preflight"></a>

#### 第 4 步：普通注册限定只读前置核对（已准备、待审）

[待审范围](evidence/sandbox-registration-preflight.review.json)复用原平台 `:13` 恢复回执、W7m 固定 Secret 版本及 Web 角色历史 OID `196608`、原授权与隔离回归；这些是目标绑定和对照基线，不冒充实时状态。只针对原 sandbox 平台 Neon，不重复查询 AWS、ECS、CloudWatch 或 GitHub。

| 只读核对 | 必须确认 |
| --- | --- |
| Web 角色 | 核对 Web 登录/OID、成员关系、有效库和 schema 权限、角色默认及库级 `search_path`。`users` 的 `id`、`email` 可读（现有查重所需）；四表无直接 `INSERT`，不允许改管理员位，不扩大已有授权。保留原 `user_credentials` 的 6 列读、仅 `failed_attempts`、`locked_until`、`updated_at` 可更新，以及 `auth_sessions` 的既有权限；会话表只查权限元数据。有效权限包括直接、继承和 PUBLIC，不仅比对历史 GRANT 文本，不登录或切换到 Web 角色。 |
| 四表约束 | 只查 `public.users`、`public.workspaces`、`public.workspace_members`、`public.user_credentials` 的结构和必要目录依赖：29 个指定写入列及未显式写入列的默认值/空值兼容、PK/FK、邮箱和 `(workspace_id, user_id)` 唯一索引的有效性、其余检查约束、RLS、重写规则和非内部触发器。对照现有模板；未知差异停止，不改表、不绕过 RLS、不执行或读取触发器函数正文。 |
| 安装角色 | 从同一已知 owner 连接只读核对身份、建角色/建 schema、PL/pgSQL、四表列及 schema 转授权限、默认 ACL、角色/名称占用和可证明的所有权路径。**有 `CREATEROLE` 不等于能直接安装。** 在标准 PostgreSQL 16，非超级用户创建角色时的自动 `ADMIN` 授予不默认给 `SET`，且创建者不能自行撤掉这条自动授予；为另一角色创建 schema 又需要能切换到该角色。若只有这一条路径且不满足原清单的无额外成员关系要求，就记安装阻塞，不试跑 DDL、不提权、不切身份。[角色规则](https://www.postgresql.org/docs/16/role-attributes.html) · [schema 所有权规则](https://www.postgresql.org/docs/16/sql-createschema.html) |
| 唯一测试邮箱 | 待用户私下绑定上次尝试的一个邮箱。只有目标及 `public.users` 的查询安全性已确认，才允许一次参数化 `EXISTS`，按应用标准化邮箱及其派生用户 ID 分别返回布尔值，不读用户行正文。任一命中即停：已有身份不等于注册与会话成功，不重试、不认领、不修改、删除或换邮箱。 |

**上限与失败处理：** 实际操作另审。届时只读取 `.env.local`、指定旧私有目录回执和批准的单邮箱输入各一次，均只进入内存；使用回执的 SHA 与目标字段比对准确 host/port/database/actor 后，最多建立一条验证服务器证书和主机名的 TLS 连接，无备用端点/角色。一次 `REPEATABLE READ READ ONLY`，最多 13 条 SQL（`BEGIN`、3 条事务局部设置、7 条目录 SELECT、1 条条件 `EXISTS`、一次 `COMMIT` 或 `ROLLBACK`）；`statement_timeout=15s`、`lock_timeout=3s`。身份不明、权限或结构漂移、输入缺失、超时即停止或不开始，不自动重试；安装能力不足但 `users` 查询已确认安全时，仅可记录原清单内的查重结果，整体仍阻塞。只留去敏标志、原因码、计数和观测时间。owner 权限较宽、文件整体进内存、提供者日志可能记录查询或绑定参数；不保存/输出连接串、邮箱、其摘要、派生 ID 或原始应答。只有全部匹配且两项查重均 `false`，才可用观测后不足 5 小时的新事实准备另一份安装审批。

**本轮无线上操作。** 未绑定邮箱、未开执行窗口、未读任何私有输入、未连库；未安装权限、未更新平台或重试注册。此清单只供另审读取，本身不授权执行，也不复用旧审批或复位槽位。

<a id="first-onboarding-step4-registration-preflight-followup"></a>

#### 只读核对接续：`search_path` 校验已离线修复，待审

原单次核对已停止，原脚本和回执保留，不重放。已在独立修正版中仅排除重复计入覆盖检查的 Web 角色默认设置；默认值仍必须匹配，数据库级以及角色/数据库组合的真实覆盖仍会阻断。两项最小离线回归通过；未读取邮箱或数据库配置，未连接 Neon。

接续清单已保存在本机私有目录，绑定原只读范围、修正版和独立结果文件。仍限各一次准确私有输入读取、一条验证 TLS 的 Neon 只读连接、最多 13 条 SQL；四表约束、安装角色能力和邮箱存在性仍待核对。实际连接另审，不安装权限、不更新平台、不重试注册。

<a id="first-onboarding-step4-registration-install-review"></a>

#### 普通注册安装审批：专用角色拥有对象，创建者仅保留系统自动授予的 ADMIN

[新版待审清单](evidence/sandbox-registration-install-pg18.review.json)复用已完成的 PostgreSQL 18 只读接续回执。原 Web 有效权限、四表结构与保护均匹配；安装者是原非超级用户 owner，具 `CREATEROLE`、建 schema 和 29 列转授能力；新名称空闲，单一测试身份未命中。原阻塞是没有证明可以按旧要求转移所有权且不留下成员关系，而不是需要放宽 Web 权限。快照于 **2026-11-18 09:51:53.991（温尼伯 CST）** 取得，原五小时有效期截至 **14:51:53.991 CST / 20:51:53.991 UTC**，不重计、不重复盘点。

| 对象或角色 | 待审的准确结果 |
| --- | --- |
| `sandbox_registration` schema 和唯一 `register_account(text,text,text,text)` | 都归专用 `techlong_sandbox_registration_definer`。schema 创建时直接指定 owner；函数以该角色创建，不再由安装者建完后转移。专用角色 `NOLOGIN / NOINHERIT / NOBYPASSRLS`，不拥有业务表；只拿 `public` 的 USAGE 和原定 29 列 INSERT。函数逻辑、固定 `search_path` 和四条原子写入不变。 |
| 安装者 | 仅在同一安装事务中显式自授 `SET=true, INHERIT=false, ADMIN=false` 的临时记录；建完对象并配置 ACL 后恢复 `SESSION_USER`，按 `GRANTED BY CURRENT_USER RESTRICT` 只撤这条自授记录。提交后只能留下 **bootstrap 超级用户自动授予创建者的一条 `ADMIN=true, SET=false, INHERIT=false`**。安装者不能直接切换到或继承 definer，但仍能用 `ADMIN` 再授成员权限，这是真实的长期管理权，需明确接受。参考 [PostgreSQL 18 创建者权限](https://www.postgresql.org/docs/18/role-attributes.html)及工程内[已验证的非超级用户建对象模式](../ops/releases/README.md)。该历史回归不是本候选在 Neon 上的执行证明。 |
| Web 和 PUBLIC | Web 仍只得到原拟议的**新 schema USAGE＋单函数 EXECUTE**，不扩至直接表写、CREATE、可转授权限或 definer 成员关系。PUBLIC 不得访问新 schema 或调用函数。不变更任何既有登录、会话或普通 worker 权限。 |

**未来实际安装限额（尚未批准）：** 复用同一配置、封存目标回执、已完成只读回执及同一测试邮箱文件，各最多读取一次。邮箱地址留在本机，获批后才用原算法在内存派生摘要以生成同一函数正文；上一轮回执故意不保留邮箱指纹，要求确认文件自核对后未改、修改时间不得更新，不把这当成回溯性的密码学证明。函数元数据或提供者日志可能暴露可猜测的邮箱摘要；它不用于验证邮箱归属，也不进 Git。使用至多两条验证 TLS 的连接：先一次安装事务（最多 24 条 SQL，含最多 14 条 DDL/授权），提交前核对目标、最终所有权和准确权限差异；只在收到明确提交确认后，再用独立只读连接/事务回读（最多 6 条 SQL）。核对只针对本次安装及原 Web 权限边界，不重跑现状盘点或邮箱查询，不调用注册函数。提交前不符即回滚，提交结果不明停止、不重试或清理。过期或时间不足不执行。

**本轮只编制方案和清单。** 未读取邮箱或配置、未重新核对或连库、未生成含真实身份的 SQL、未安装、未更新平台或重试注册。下一步仅另审这一份安装范围及剩余事实时限；平台更新与本人注册均不在本清单内。

<a id="first-onboarding-step4-registration-install-observed"></a>

#### 数据库安装已提交并独立回读；平台尚未更新

**`REGISTRATION_FUNCTION_INSTALLED_AND_INDEPENDENTLY_VERIFIED`｜2026-11-18 09:59:30.777 温尼伯 CST。** 按用户批准的 `e32b5b85…` 一次安装，收到明确提交确认；另一条验证 TLS 的只读连接回读与事务内核对一致。新 schema 和唯一函数均归专用 `NOLOGIN` definer；definer 只有原定 29 列 INSERT 和必要 schema USAGE；临时自授 SET 记录已撤掉，创建者只留系统自动的 ADMIN（SET/INHERIT 均关闭），Web 仅新增新 schema USAGE 和单函数 EXECUTE，无新增直接表写权限，PUBLIC 无新对象访问权。

本机私有去敏回执 `sandbox-registration-pg18-install-e32b5b85.result.json`，文件 SHA-256 `0aaaa43569204d55a8225598853d90c4c86a8176286f9bc2e31ad00b97eeeec2`；实际 2 条 TLS 连接，安装 SQL 24、独立只读 SQL 6、DDL/授权 14，业务读写、函数调用、AWS 更新、平台更新和注册均 0。已消费安装次数，不复用清单或重跑。**下一步只准备原平台闭控服务的最小版本更新审批材料，不执行更新；平台和函数均验证后才另审本人一次注册。**

<a id="first-onboarding-step4-registration-platform-update-review"></a>

#### 原闭控平台的最小版本更新：离线待审，尚无候选镜像

[离线审批材料](evidence/sandbox-registration-platform-update.prepared.json)仅针对原 `ca-central-1` 平台栈 UUID `c4bf36b0…` 和原 ECS `techlong-sandbox-platform-web`。复用已确认的数据库安装，不重新连库。用原模板与历史 `DesiredCount=1` 重建的模板摘要，与最近恢复回执一致；历史任务 `:13`、旧镜像、原 `DATABASE_URL` 固定 Secret 版本、原 ALB/443 和 console Alias 仅作比对，不当作当前在线状态。

**最小候选不是 `main` 全量镜像。** 旧镜像的真实构建来源是 `5fcbc23c…`，不同于已关闭控制器的 `ExecutionSource` 标记 `d098cfef…`。把整份注册修复提交 `04e876b…` 构建上线，会带入 D2 及首开任务路径等其他代码。只允许在旧镜像源码上叠加该提交的 `lib/auth/credentials.ts` 和 `lib/auth/sandbox-registration.ts` 两份固定字节文件；其余源码、Dockerfile、依赖锁和运行策略不变。隔离 PostgreSQL 回归证明的是注册函数和调用逻辑，不是这个候选镜像。现有候选工作流打包 `HEAD`，旧发布入口固定历史产物；若需最小接线才能携带合成来源的真实证明，应另审，不把复合来源冒填为单个提交，不改已有门禁或复用旧批准。

1. **先证明候选，再发布。** 另审一次固定两文件范围、无 AWS 身份的 GitHub 云构建；核对源码闭包、原启动方式、禁网匿名自检和安全扫描，封存原产物及 config digest。产物具备后才另审最少的精确 GitHub/AWS 读取和保护发布；由用户批准准确的 GitHub environment。只允许同一既有 ECR 仓库的单次发布；若需临时发布授权，成功或失败后立即按另批方案撤权、独立证明 Locked，不能夹带 ECS 更新。
2. **只在同栈换镜像。** 新不可变 registry manifest digest 完成独立核验后，才另审一轮 **STS 1＋最多 12 项准确元数据读取**（原栈/服务、任务定义和任务、目标健康、原/新镜像、固定 Secret 版本元数据、console Alias）。上线在原 CloudFormation 栈按原模板做 `UPDATE`；资源属性唯一改动是 `TaskDefinition` 中 `web.Image`。仅同步两个顶层镜像溯源元数据，不改控制器关联来源。先另批仅创建、不执行 Change Set；只接受 `TaskDefinition` 替换为新修订、同一 `Service` 不替换但引用新修订，其他九项资源物理 ID 不变，无新增、删除或导入。`DesiredCount=1`、角色、网络、DNS、Secret 引用和原启动命令不改，控制器、请求入口、worker、apply 继续关闭，租约为空。
3. **执行和独立核验仍另审。** 只执行上一步独立验真的同一 Change Set 一次，允许 CloudFormation 托管回滚，不直接更新 ECS 或自动补救。确认完成后只验同一栈、准确任务摘要和 1/1/0、目标健康、DNS 及闭控，可另批最多两次匿名 GET（`/api/health`、普通注册页），不提交表单或登录。原滚动配置可能短时中断；任务启动会由 ECS 注入原固定 Secret，可能产生存储、任务和流量费用。遇漂移、过期、未知提交或计划不符即停；不把这次更新变成恢复、续期或清理操作。

**当前 `NO_GO`。** 尚无两文件候选的构建证据、ECR 新摘要或实际 Change Set，不签出执行 SHA。本轮没有新 AWS/GitHub 事实读取、构建、镜像发布、连库、平台写入或注册。下一步只等另审两文件候选的无 AWS 构建范围；暂不刷新云端状态，不重复数据库核对。

<a id="first-onboarding-step4-registration-platform-candidate-observed"></a>

#### 两文件闭控候选已在 GitHub 构建并封存；未发布

获准的[单次 GitHub run 44343705697](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44343705697)（attempt 1）成功。原镜像实际源码 `5fcbc23c…` 加两文件形成 Git 树 `131fc5f0…`；非 root 禁网自检确认控制器、请求入口、worker 与 apply 均关闭，普通注册页仅 GET。新鲜 OS 扫描 HIGH/CRITICAL 零发现。准确 job 的封印回执、GitHub artifact 元数据均已核对：[去敏证据](evidence/sandbox-registration-platform-candidate.observed.json)。

原 GitHub 产物 `14444752398` 到期 **2026-11-21 16:09:51 UTC（温尼伯 10:09:51 CST）**；未下载整包。配置摘要不是 ECR manifest digest。AWS 身份、数据库连接、ECR 发布、平台更新和注册均为 0；不重跑构建。**下一步只准备单次受保护 ECR 发布审批**；必要的产物或云端新读取先另审，发布和实际平台更新仍分开审批。

<a id="first-onboarding-step4-registration-ecr-publication-review"></a>

#### 同一候选产物的单次受保护 ECR 发布：离线待审

[发布审批草案](evidence/sandbox-registration-ecr-publication.prepared.json)锁定 run `44343705697` 的原产物 `14444752398`、ZIP 和内层镜像档案摘要、两文件源码 Git 树及 image config digest。唯一目标为原 `ca-central-1` 仓库 `techlong-sandbox-platform-web`，拟用新不可变 tag `platform-reg-06d91b3eb875-r44343705697-a1`；保留当期平台旧镜像及已核对的其他镜像。不把本地 config digest 当成 registry manifest digest，不重建候选。

1. **发布门槛。** 现有保护发布路径只接受固定的旧 `push` 产物，不能假冒本次 `workflow_dispatch` 合成源码。后续仅复用既有的保护发布、限时 IAM 与撤权机制，另审绑定新产物来源所需的最小适配及 CI。准确代码锁定后，再单独批准一次 **最多 12 次 GitHub GET＋STS 1 次／最多 15 次准确 AWS 元数据读取**：只核对原 run/产物、固定工作流和本人 environment，原单角色发布栈、角色/boundary、OIDC 和这一仓库。要求发布角色仍为 Locked、拟用 tag 未占用、旧镜像保留且产物未过期。不要先盘点其他资源或下载整包；历史 Locked 记录不等于现况。
2. **临时授权与使用。** 最多一次通过原发布角色所属栈安装 trust＋inline，不改 boundary、角色身份、OIDC 或审批门禁。把角色限在准确不可变 reusable、仓库/actor/main/environment 和最长 60 分钟日期窗口，只准同仓库推送/核验所需 ECR 动作。只调度一个 run，由用户本人批准 `techlong-sandbox-deploy`。先复验同一个原 ZIP、封印、镜像配置、闭控禁网自检及新鲜扫描，才允许申请一次 900 秒 STS 会话并执行一次顶层 push。固定 tag/产物还靠受保护代码约束，不能声称 IAM 单独限制到了某一个镜像。原产物截至 **11 月 21 日 10:09:51（温尼伯 CST）**；实际窗口还受新事实截止和撤权预留约束，窗口不足不启动。
3. **成功或失败都收回权限。** Grant 一旦可能已提交，成功、拒绝、超时、推送失败或响应不明都立即进入撤权流程。原栈若在处理中，只在批准时间内等待可安全写入；最多一次原栈 Revoke 恢复 trust 无 Allow、inline 显式 Deny `ecr:*`。若独立证实本来仍是 Locked 则不多写。另起只读过程检查同一栈/角色/边界及 Locked；再按准确 tag 校验 ECR 原 manifest 字节摘要与 config 匹配，并核对既有镜像无差异。两份证据均通过才算发布成功；撤权不能独立证明就如实停住，不直接改 IAM、不重放、不自动删除遗留镜像。临时权限的期限不等于已签发 token 立即失效。

**仅编制审批草案，无执行 SHA。** 尚未适配/调度发布工作流、读取新状态、下载产物、授权、发布、连库、更新平台或注册。下一步只另审最小发布适配和验证，必要的限定读取随后集中另审；实际 Grant、单次发布和 Revoke 按新准确清单一并批准，平台更新与注册不在此范围。

**接续：发布适配已通过 CI，不重做。** 只为已封存 `14444752398` 接线，沿用现有单次 push、无论结果都撤权及独立核验的编排；旧入口不变。不可变 reusable `0b07603…` 的[无 AWS CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44346591038)通过，固定 caller `2e42274…` 的[无 AWS CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44346902837)亦通过。未读取发布角色或 ECR、未下载产物、授权或调度。下一步只做另审的限定读取，不再拆额外方案；发布、撤权核验和原服务换镜像可集中呈审，实际按门槛顺序执行，GitHub environment 仍由本人批准。在新镜像上线前，不重试注册。

**只读已通过，合并为一次执行审批。** 本轮实际 STS 1、AWS 元数据 15、GitHub GET 11，核对了原 Locked 发布角色、三份既有镜像、未占用目标 tag、准确产物及人工审批门禁。没有查平台栈、下载镜像、连库或写云。唯一待审清单保存在本机私有目录 `sandbox-registration-finish-bug.review.json`，LF SHA-256 `c77b44f9cf3389915f801b8ecec9473c211a74e860afedf807a3f7c78cecfd06`。按同一外层批准，先发布并独立核验撤权与镜像，再只在原平台和两项 Change Set 差异严格匹配时换镜像；不再另要 Change Set 批准。GitHub environment 必须本人批准。整轮最晚 **2026-11-18 13:51:40.980 CST（温尼伯）** 启动，原事实 **15:26:40.980 CST** 截止，不延长。未授权执行，不重试注册。

<a id="first-onboarding-step4-registration-image-observed"></a>

#### 注册修复已上线，待本人单次注册（2026-11-18，温尼伯）

按外层批准 `c77b44f9…` 执行 [run 44348635925](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44348635925)，由用户批准 GitHub environment。产物 `14444752398` 发布一次；独立回读证明原角色已恢复 Locked、三份旧镜像保留、新镜像 registry manifest 为 `sha256:adaa45218a5bfefcc376bf0349eb685f742efb381fc334540347745091bbe323`。

只在原平台 CloudFormation 栈创建并执行同一份变更集 `73c96d93…` 各一次，仅替换任务定义和更新 ECS 服务的任务定义引用。2026-11-18 10:44:25 CST 独立核验通过：原栈 `UPDATE_COMPLETE`，服务运行任务 **1**、待启动 **0**、目标健康，实际运行新镜像、任务定义 revision **14**；原网络、域名、角色及固定数据库 Secret 版本不变，控制器和 worker 关闭。匿名 GET `/api/health` 和 `/register` 均为 **200**。平台阶段共 STS 2、AWS 元数据 34、匿名 GET 2；不连库、不注册、不重试。回执保存在私有目录 `sandbox-registration-finish-bug-c77b44f9.platform-accepted.json`。

下一步只由用户用自备未注册邮箱，在[原注册入口](https://console.sandbox.techlong.cloud/register?returnTo=%2Fdashboard%2Fsettings)填写企业名「Sandbox 首开验收」并提交一次。注册页技术核验通过不代表注册已成功，更不代表购买或真实首开已完成。结果不明不重复提交，未授权恢复其他资源、购买或启动首开。

<a id="first-onboarding-step4-purchase-readiness"></a>

#### 注册已成功；只准备同一工作区的测试购买接线

2026-11-18（温尼伯），用户亲自注册成功并从工作区设置提供编号。唯一范围以本机私有记录 `sandbox-first-onboarding-workspace-20261118.json` 中的工作区 ID 为准，保留既定的餐饮产品、`standard-v1`、`cell-sandbox-1` 和[可信首版 A](#first-onboarding-step4-candidate-binding)。编号格式已验证；注册结果来自用户，尚未独立读取控制库，不推断 Owner、订阅/实例/任务或当前目录状态。

**此刻不要点购买。** [线上镜像的来源记录](evidence/sandbox-registration-platform-candidate.observed.json)证明它以 `5fcbc23c…` 为基底只叠加两份注册文件；旧 `ensurePlannedAppInstanceDeployment` 没有首开挂起分支。原任务定义唯一 Secret 为数据库连接，而且 [Node 托管启动合同](../ops/platform-hosting-v1/contract.mjs)拒绝 Stripe 两个变量，[运行时 bindings](../ops/platform-hosting-v1/bindings.mjs)也不暴露它们。此外，[原 Web 角色授权](../ops/platform-web-database-role-v1/no-login.sql)和[注册函数安装](#first-onboarding-step4-registration-install-observed)都未授权现有购买代码对订单、订阅、实例和队列的直接 DML。仅改工作区参数、填 Stripe 密钥或更新镜像都不能单独放行。

1. **当前唯一代码动作：接通一次购买到一条挂起任务。** 保留已通过的注册路径，复用现有购买、签名回调、首开登记 SQL 和普通队列排除条件。在原 Node 托管路径增加默认关闭、只针对准确验收工作区及餐饮标准档的测试模式；仅服务端允许测试 Stripe key 和该 HTTPS 回调签名 Secret。拒绝真实模式、其它工作区和不匹配回调；首版固定 A，不改其它工作区的默认镜像。按这条购买链的实际调用收口窄数据库调用，不给 Web 通用业务写权、不复用 owner 或普通 worker 凭据。只做相应离线/隔离回归：原闭控不变、合法测试购买只登记同一条 held job、非测试/其它工作区不进入首开、重复事件不新增任务。无须先启动 Cell、Express 或普通 worker。
2. **购买前集中审核一次必要启用。** 定向验证该 ID 为独立 active 工作区且有唯一普通 Owner、无同产品订阅/未决购买/实例/任务，目标套餐及 A 仍匹配。实际读取另审；从现有入口和证据复用，不盘点账号。待代码与无 AWS 构建验证后，集中列出测试 Stripe Secret/对应 webhook、原平台镜像与窄配置的实际变更及费用。禁止在聊天或 Git 中接收密钥，不借用买家/商家后端的支付密钥；不以注册成功当作购买授权。
3. **开通另行执行。** 上述条件通过后才让用户完成一次正常 Stripe 测试 Checkout；独立回读证明 `active` 订阅、`pending` 实例、`planned` 部署以及同一条未领取首开任务。再用实际 ID 审核恢复与首开，不在支付回调建资源。支付或写入结果不明时不重复提交。

本节只记用户反馈及本机源码/模板核对，无 AWS、Stripe、数据库、Secret 读取、镜像构建发布、平台更新、购买或资源恢复。

<a id="first-onboarding-step4-purchase-offline"></a>

#### 测试购买到首开挂起任务：已离线接通，未启用

复用现有 Stripe Checkout 请求、原始请求体签名校验、套餐表单参数验证、Express 计划生成器和 `INSERT_FIRST_ONBOARDING`。只有显式开启的闭控 Sandbox、准确工作区 Owner、一个餐饮标准档套餐及已锁首版 A 可以走候选入口。真实模式密钥、真实模式回调、不同订单/会话和错误金额不能进入首开；Stripe 返回页只查询原订单，不确认付款。托管入口只对准确 `POST /api/stripe/webhook` 留出无浏览器 Origin 的签名回调通道。

数据库候选以固定工作区派生唯一订单 ID。Web 只调用受限的预留、绑定测试会话和读取原订单函数；确认付款使用独立回调登录，只准调用该订单的两个回调函数。没有给 Web 增加业务表写权限或调用确认付款的权限。验签后在**同一事务**确认付款、生成有效订阅和待开通实例、登记首开计划及一条 `pending / attempts=0 / maxAttempts=1` 的挂起任务；同一付款并发/重复回调不产生第二笔订单、订阅或任务。无论会话或提交结果是否明确，应用都不自动开第二次 Checkout，不清除已有预留；Stripe 可能按自身策略重新投递未被确认的回调。

本机 PostgreSQL 15 隔离回归用完整工程 schema 与真实分离的数据库角色，模拟 Stripe 请求和签名回调；覆盖强制任务写入失败时全事务回滚、并发及重复回调、拒绝非目标购买与普通队列不能领取。定向 **18 项通过**，TypeScript、lint 和空环境平台构建通过。历史 V6 固定指纹断言仍有既存差异；与本轮前的 `main` 比对，81 个闭包文件字节全未改，不重标旧证据。没有运行生产 DDL、读取线上密钥或连接 Stripe/Neon/Aurora，也没有部署、启用普通 worker 或恢复 Cell/Express。

**当前继续点：同一平台的[一次启用草案](aws-sandbox-first-purchase-activation-preparation.md)已离线备齐。** 仅待另审必要候选取证/构建与限定只读，补齐后才出一份实际启用审批。不执行当前候选 DDL、恢复 Cell/Express 或进行测试购买。

## 当前操作说明（实施计划不改变现有流程）

### 目的

当 Stripe 发送通过签名验证的付款成功事件后，平台会把付款记录标记为已付款、把 Checkout 对应的产品订阅更新为有效，并自动创建或重新关联该产品的待开通实例记录。系统还会根据套餐固定的资源档位生成 AWS Sandbox 目标计划和幂等部署任务。当前 S3 Worker 的真实运行 Adapter 未配置且 `applyRuntimeReady=false`，因此不会调用 AWS，也不会生成云资源、ARN、Secret 值、真实域名或入口。

### 管理员操作

1. 在“应用实例管理”中将状态筛选为“等待开通”。
2. 打开来源为“付款成功自动创建”的实例，核对企业客户和关联订阅。
3. 核对实例详情中的部署资源档位、目标区域、Cell 和计划状态。`planned` 只表示计划已保存，不表示资源已部署。
4. 编辑实例，填写真实的买家端 `access_url`、卖家端 `seller_apk_url`、租户标识以及需要的域名或路径。
5. 返回详情页，确认有效订阅和有效访问地址都已具备后，选择“标记为已开通”。

也可以将记录标记为“开通失败”或“服务已暂停”。没有有效访问地址时，平台会阻止标记为已开通。

### 验收流程

1. 以普通企业账号从“订阅与账单”发起 Stripe 测试付款。
2. 用 Stripe CLI 转发测试 Webhook，或在 Stripe 测试事件中重新投递同一付款成功事件。
3. 确认付款记录为 `paid`、订阅为 `active`，并且该工作区只有一条餐饮订单系统实例，状态为 `pending`，来源为“付款成功自动创建”。
4. 确认实例存在一条 `aws_ecs_cell` / `plan_only` / `planned` 的目标计划，并且计划中没有 AWS 凭据、Secret 值、ARN 或正式 URL。
5. 重复投递同一事件，确认不会新增付款记录、应用实例或相同配置的部署计划。
6. 在管理员后台填写入口并标记为已开通；客户刷新后才会看到“进入餐饮订单系统”按钮。

### 边界

当前版本不部署应用、不创建云资源、不生成生产域名，也不支持同一个工作区购买多个餐饮订单系统实例。数据库以 `(workspace_id, product_id)` 唯一约束保证实例边界，并以部署计划幂等键避免重复排期。后续真实部署必须由独立执行器 / Worker 消费任务，不能在 Webhook 请求内直接调用 AWS。详细设计见 [AWS ECS Cell 部署计划 DEMO](./aws-ecs-cell-deployment-demo.md)。
