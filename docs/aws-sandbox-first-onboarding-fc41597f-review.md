# Sandbox 一次首开审批材料：`job_fc41597f9b5ba8e02b338ecf`

**状态：待审草案，尚不能执行。** 本稿只固定这一条已付款、尚未领取的任务和整轮最小边界。既不发执行 SHA，也不预设可用窗口；用户确认前不做新线上读取、安装、恢复、领取或调度。旧审批、旧物理 ARN 和旧执行槽一律不复用。

## 已有证据和固定对象

- 用户已用原 Stripe 测试会话完成付款；上一轮 Neon 只读回读（**11 月 18 日 21:56:11 温尼伯 CST**）证明原订单已付款、同一工作区/产品恰好一条首开任务，`pending`、`0/1`、无租约、未授权云执行。它匹配同一付款产生的待开通实例、`active` 订阅及 `planned` 部署。不再调用 Stripe、重放 webhook 或再购买。
- 仅账号 `402010193138`、区域 `ca-central-1`、`env_aws_sandbox_ca_central_1`、`cell-sandbox-1`、`standard-v1`、一套租户资源 `g1`。由原工作区与原订单摘要，从现有代码离线重算并与已回读任务匹配：实例 `app_bbd626d7d3806af686073211`、部署 `dep_746535593025bf97a9efeccd`、订阅 `sub_f0dea547d45bcd26ed823fd7`。工作区沿用[原账单清单](evidence/sandbox-first-purchase-billing-rollout.review.json)的摘要，不另公开原付款或会话。
- 首版只用[可信版本 A 的登记证据](aws-instance-release-initial-publication-observed-20261117.json)：`release_00b9c5cfa6bceedc5fd05aa451dca811`，`techlong-sandbox-speedfeast@sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0`（本账户、`linux/amd64`）。固定 `express_iam` / `speedfeast-saas-control-v1` / 端口 `3000` 和该版本受审客户端 API 合同；不构建、不推镜像、不重新登记，不以旧租户运行过替代当前镜像/目录核验。

| 离线派生的唯一候选 | 准确名称（实际计划、占用和归属仍须核对） |
| --- | --- |
| 租户 CloudFormation 栈、API 地址 | `techlong-sandbox-tenant-d3806af686073211`；`pending-app-bbd626d7d3806af686073211.sandbox.techlong.cloud` |
| Aurora 租户库、应用 SQL 登录 | `tenant_e9fdccd5d8c7685c_db`；`tenant_e9fdccd5d8c7685c_role` |
| 独立应用 TaskRole、私有图片桶 | `TechlongSandboxFirstOpen-e9fdccd5d8c7685c`；`techlong-sandbox-tenant-images-402010193138-e9fdccd5d8c7685c` |
| g1 运行时 Secret | `techlong/sandbox/tenant/appbbd626d7d3806af686073211_e9fdccd5d8/runtime/g1`；不预填物理 ARN 或 VersionId |

控制公钥只把[原固定公开材料元数据](../ops/releases/d2-6-step4-execution.review.json)作为候选：`techlong/sandbox/control-public-key-first-acceptance-PfBjiq`，版本 `75d8da0af103e1e10e6d3341cbd50226fea7ce5e5aac8d150ab9e447b6340680`。须证明它与现行 Cell 控制合同一致，不能复用那份旧租户 g1 Secret。

## 合并审查的范围和顺序

### 1. 领取前先证明执行入口和权限，不启用队列

本机已新增可调用的[单任务运行入口](../lib/deployments/execution/first-onboarding-run-once.ts)，直接调用既有 worker，复用 [Express 编排](../lib/deployments/execution/first-onboarding-express.ts)、[独立只读适配](../lib/deployments/execution/first-onboarding-reader.ts)和[完成函数](../lib/deployments/execution/first-onboarding-completion-entry.ts)。入口不读配置或自动创建连接，不接旧恢复 workflow、`claimNext`、普通重试或删除；`workerEnabled` / `applyEnabled` 都固定关闭。只有环境审批和实际角色分离另审的操作者，才能提供真实 adapter；不把本机接线或回归当作已安装、已获得有效权限。

- [领取与读取 SQL 候选](../lib/deployments/execution/first-onboarding-claim-entry.ts)：固定本任务/部署/实例/订阅/环境和工作区摘要，领取前核对计划、配置、版本 A、审批 SHA 及截止时间；只接三条参数化 RPC，读登录无 claim，claim 登录无 read，二者都不获底表权限。领取 ACK 后才能调实例工作端口；同一程序无法重复调用，跨进程靠数据库 `pending / 0→1` 门禁。任何结果不明停，不走原普通队列。
- [IAM 窄候选](../lib/deployments/execution/first-onboarding-run-permissions.ts)：把固定栈 CreateStack、确切 PassRole、Express 管理/应用登录、两对象版本 GET、ECR/日志、g1 创建与固定 Secret 注入分开，不包含 Update/DeleteStack、整桶或任意版本读。真实 trust、CFN 按新监听器的动作、独立核验身份、g1 实际 ARN/版本和有效权限仍须从准确事实推导；候选不是一份可直接安装的全角色策略。
- 完整运行仍须另批绑定真实的状态/围栏/控制 adapter、隔离登录、调用计数、独立核验及完成 DDL，不能用明文 owner 或全局 AWS 权限替代。原 worker 还要求清理就绪证据和 `deployment.createdAt + 环境 TTL` 在窗口内，预检过期则保留请求，不自行改日期、复位任务或绕过门禁。若采用 GitHub，另固定受保护工作流和实际 run 的绑定，environment 由用户本人批准。

| 身份边界 | 只需以下权限；不是已安装的结论 |
| --- | --- |
| 恢复操作者与原 Cell CFN 角色 | 恢复身份只读原集群/writer、原 Cell/模板/资源；写入仅原集群一次 `StartDBCluster`、原 Cell 一次变更集创建和一次执行。保留原 Cell 执行角色 `TechlongSandboxFirstAcceptanceCellExecutionRole`、证书及 trust store，实际权限和回滚路径先核对；不直接创建 ELB，不设新信任或额外权限。 |
| 单任务执行者与租户 CFN 角色 | 仅真实 `SELECT_FIRST_ONBOARDING`、一次 `CLAIM_FIRST_ONBOARDING`、该任务租约/g1 围栏/步骤证据及实例范围的配置写入；不能 `claimNext` 或任意 SQL。仅给准确新栈 `CreateStack` 和必要读回；`iam:PassRole` 限精确 CFN 角色及 `cloudformation.amazonaws.com`。CFN 只获七资源及经同意的托管回滚所需权限，ECS 两个 PassRole 仅限任务角色和执行角色及 `ecs-tasks.amazonaws.com`；监听器权限等真实新 ARN，不能用历史 ARN 或临时扩大到全部监听器。不允许执行者直调 `UpdateStack`、`DeleteStack` 或 IAM 写。 |
| Express 生命周期与应用 | `TechlongSandboxTenantLifecycleTaskRole` 仅原集群管理连接 `postgres` 和核准的 V3 初始化、迁移与激活动作；如基线在 S3，只允许两份精确对象的固定版本 GET，不列桶或读其它原件。每租户应用 TaskRole 仅该集群准确 `dbuser` 的 IAM 登录、本桶 `products/*` 所需商品动作，不持管理连接或 SQL 提权。正常图片写入只给必要 `PutObject`；现有替换/补偿确需 `DeleteObject` 才在最终清单列出，不开版本删除、列桶或其它桶。 |
| g1 Secret 与 ECS 执行 | 权限只准该派生全名创建一份初始版本、准确标签和批准加密路径；无第二版本、轮换或删除。AWS 随机后缀与版本约束须在有效策略中证明。ECS 执行身份只获同仓镜像拉取、本栈日志、固定控制公钥与新 g1 的必要注入；以当次 ACK 和独立元数据绑定实际 `ARN:::VersionId`，禁止运行时浮动 `AWSCURRENT`。不向操作者或核验者开放 Secret 正文；如需 KMS 仅在最终清单写准 key、服务、上下文，不授权泛解密。 |
| 独立技术核验与 Neon 完成 | 独立 AWS 身份 `TechlongSandboxFirstOpenInspector`，不借已有 D2 核验角色，不给云写、Secret 正文或 S3 对象读写；Aurora 独立探测只用身份明确的目标库 TLS 只读登录。Neon 用专用 `NOLOGIN` definer 和互相独立的写、读 LOGIN，分别只有 `complete` 或 `inspect` EXECUTE；不发 owner、通用表 DML、D2 writer 或角色管理权限给运行者。列级锁/写权限封在 definer 函数内，撤销 PUBLIC，函数只接受本任务/部署/实例及最终 SHA/截止。实际角色供给、DDL/信任/边界、权限上限和独立回读均须在安装前列准。 |

### 2. 只恢复原 Express 和共享 Cell；在领取前备好持久化及 DNS

- **原 Express：** 仅 `techlong-sandbox-express-d001`，物理 `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`、原 writer `techlong-sandbox-express-d001-instance-1`。旧核对显示 `stopped`、Aurora PostgreSQL **17.9**、IAM DB auth 开启，现时未读。如果当前匹配且仍停机，原集群最多启动一次；已可用则跳过，不单起 writer。独立回读两者 `available`、实际端点、版本、IAM auth 和 TLS；不新建集群、不启动 `speedfeast-postgres-prod`。
- **共享 Cell：** 仅 `techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`。复用[离线四 Add 模板](../ops/deployment-baseline/cell-reattach-draft.template.json)及[旧 12 项证据](auto-pending-provisioning.md#first-onboarding-step4-install-restore-facts)，前置只核原归属、实际缺项与未决操作。预期恰 Add `CellLoadBalancer`、`BusinessHttpsListener`、`ControlMtlsListener`、`BusinessControlDenyRule`，并恢复两监听器输出；不改其它资源、参数或角色。一次创建变更集、一次执行，执行前严格审差异，建议 CFN 托管回滚，不授权主动删除。须独立证明原 12 个物理 ID 不变、总计 16、同一实际 ALB 的 443 / 8443、原证书、8443 `verify` mTLS 和 443 拒绝规则；若已准确恢复则只读验，不再创建。后续只绑定这次真实监听器及 ALB 输出；缺输出、不同差异或并发操作即停。
- **图片与 DNS：** 若无合格且独立的本租户资源，最多一个独立 CFN 存储栈、5 项（私有版本化桶、桶策略、OAC、CloudFront 分发、响应头策略）。核验准确分发/桶归属、`products/*`、公共访问阻隔、SSE-S3、TLS-only、OAC 和 `Deployed`；只允许受审买家来源的 CORS。任务配置为 `s3` 与实际 CDN 地址、`ALLOW_EPHEMERAL_IMAGE_STORAGE=false`，不搬图或拿旧桶充数。只对公共 zone `Z01473621BTTHKXBGOOEJ` 的上表精确名称候选一次 `CREATE A Alias`，目标为恢复证据给出的真实 ALB DNS/canonical zone；精确已匹配不写，其他占用停，不 `UPSERT`。同时证明 443 的 100/101 与 8443 的 100 可用；不移动旧租户规则。存储和 DNS 不计进租户七资源，也不调用整套环境启动工具。

### 3. 同一任务只领取一次，先空库初始化，再以 A 创建七项承载

- 现有基线[对象证据](../ops/aws-sandbox/reviews/f3c2-material-foundation.executed.json)给出私有桶 `techlong-sandbox-402010193138-ca-central-1-tenant-baselines` 的两份准确原键：`approved/1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a/baseline.dump`（203375 字节）；`approved/62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971/baseline.manifest.json`（26502 字节）。路径中的内容 SHA 与 V3 编译器一致。**历史桶无版本化、原证据没有 VersionId**；当前适配强制两份非空固定版本。须先证明有同字节的确切固定版本，或为仅这两份材料的受控供给另列明确变更供审。不能把内容寻址键、旧 SHA 或 `null` 当 VersionId，不改旧桶或发起上传。
- 领取前核对同一订单/订阅仍有效，待审 `0/1`、无租约/前代/外部操作/D2 初始记录，计划与配置摘要、镜像、名称和批准窗口一致。空库初始化能力和隔离先要有可信证明；缺证明不先占用尝试。批准后仅以同一 g1 和围栏：1 次 V3 prepare（1 个应用角色先 `NOLOGIN`、1 个临时 `NOLOGIN` guard、1 次隔离建库、按合同收回 guard），确认空库后 1 次固定 schema-only 恢复、1 组 SaaS 迁移、1 次确切应用 IAM 登录激活及独立读回。空库与迁移后检查用真实本次库/角色 OID、owner/fence、schema/迁移和批准技术 seed；历史 73 表/两迁移/九条 seed 是参照，不是新库证明。证明应用不能连接旧租户数据库，禁止导入历史客户数据、启用启动迁移，或修改其它库的 PUBLIC ACL 来绕过隔离。
- 仅创建一次 g1 初始 Secret，以同任务/围栏/审批 SHA 派生初始版本；用真实 ARN/版本回执完成采样绑定。之后只对准确新栈提交一次 `CreateStack`（ECS 服务 ×1、任务定义 ×1、目标组 ×1、监听规则 ×3、日志组 ×1），一项 Fargate 服务期望 **1 个**任务。固定 A digest 与新租户 TaskRole、持久化配置、g1/控制公钥固定版本。拒绝领养同名旧栈；不后装 `UpdateStack` 修配置，不重发写入。

### 固定版本供给清单：两次条件复制及独立回读合并待批

**已核实的历史结果：** 11 月 18 日 **22:39:01（温尼伯 CST）**，准确 Source 已通过 1 次 STS；对原 `baseline.dump` 的 1 次 HEAD 返回 **203375 字节**和匹配的 `FULL_OBJECT` SHA-256，但未返回 VersionId。按当时停止条件，manifest 未查；列表、GET 正文、复制和写入均为 0。不能据此推断 manifest 状态，也不重放这次读取。现在的方案是保留源原件、在一个已版本化的私有桶里固定两份内容完全一致的副本；**只允许副本的真实非空版本用于恢复**。

**最新只读已完成，以下不再盘点。** 同日晚 22:47:20 核对原 manifest：26502 字节、完整 SHA-256 相符，ETag `"a98af6a8f047c1176590cc4065251b8f"`，无源 VersionId。22:50:41 核对原 archive：203375 字节、完整 SHA-256 相符，ETag `"0b75b7ec52218e6de5b3b34414481766"`，无源 VersionId。22:50:42 核对准确目标桶的七项元数据：账号/区域、版本化、公访阻隔、AES256、拥有者匹配；两个目标键未见公开授权，TLS 强制，无生命周期配置。只读没有证实执行者有效复制权限，也没有读取目标的复制或通知配置。

| 原件（仍留原桶及原 `approved/` 键） | 已封存字节数与 SHA-256 | 目标键：`first-open-baselines/job_fc41597f9b5ba8e02b338ecf/g1/` 下的两个独立键 |
| --- | --- | --- |
| `baseline.dump` | 203375 / `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a` | `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a/baseline.dump` |
| `baseline.manifest.json` | 26502 / `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971` | `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971/baseline.manifest.json` |

**目标仅一个候选：`techlong-sandbox-cloud-worker-evidence-402010193138`。** [历史独立桶布局](aws-instance-release-workflow.md)记录账号 `402010193138`、`ca-central-1`、Versioning `Enabled`、SSE-S3 `AES256`、`BucketOwnerEnforced` 和四项公访阻隔；[现有证据适配](../ops/cloud-worker/cloud-evidence-v5.mjs)也采用同一桶、明确的对象版本和只建不覆盖。历史保护只证明原用途，**没有证明新前缀当前可写、可读或防删除**。不借用图片、CDN origin 或旧租户前缀，不新建桶。

按[同一份机器清单](evidence/sandbox-first-open-baseline-copy-fc41597f.review.json)只审这一次：

1. **只检查会不会引发额外动作。** 原两 HEAD 和七项目标桶元数据直接复用。固定 Source 重核身份一次；对同一目标桶最多 `GetBucketReplication`、`GetBucketNotificationConfiguration` 各 1 次，只判断这两个键是否会触发复制或通知。匹配规则、无法排除 EventBridge/通知副作用、读不到配置或超时即停，不追查下游、不改桶。既有角色的有效复制权限在两次准确条件调用时由 AWS 判定，不另行 IAM 盘点、模拟或加权。
2. **服务端最多 2 次 `CopyObject`，每键一次且不覆盖。** 从已核实的原件到上表新键；两侧固定本账号，原件用预检 ETag 约束 `CopySourceIfMatch`，目标用 `IfNoneMatch='*'`，要求 SHA256、AES256，不设置 ACL，不继承原标签/用户元数据。archive 的完整复制回执含有效目标 VersionId 后才提交 manifest。每次保留实际目标版本，不把 HTTP 200、ETag 或源 VersionId 当完整验收。条件失效、权限不足、未知响应或并发冲突都不重试，不退回普通 PUT/Copy；第二次失败可能只留下一个版本，保留不补齐、不删不回滚。
3. **独立固定版本核验。** 两个完整 ACK 都已保存后启用一个新的只读进程，复用同一 Source IAM 主体（是进程分离，不是权限主体分离）。第二次 STS 后，对两个目标按 ACK 版本各一次 `HeadObject`（启用 checksum）；确认回传同一有效 VersionId、非删除标记、大小、AES256 与 `FULL_OBJECT` SHA-256。只读进程的传输不允许写入；不查 `latest`、不读正文。不符或校验不明即停，不能把单一副本或未核验版本用于恢复。

两进程合计最多 **STS 2、目标配置 GET 2、条件复制 2、固定版本 HEAD 2**。最晚 **11 月 19 日 03:37:20（温尼伯 CST）**启动，单次至多 4 分钟，且绝不越过原 manifest 观测起算的 **03:47:20**；过期不补读、不重放。原桶、其它对象、旧版本、IAM、桶策略均不写不删；不列桶、不下载正文、不调用 Express/Cell、不恢复或领取。两份副本合计 229877 字节，存储和请求可能收费。版本化不等于 Object Lock；预检与复制之间无桶配置 CAS，仍有并发与部分成功风险，这些都属于本清单的批准边界。

**接续不降级。** 双副本证据须同时成立才可进入首开审批。当前[首开原键白名单](../lib/deployments/execution/first-onboarding-baseline-versions.ts)只认原桶两个键；取得真实版本后，才把**这个任务**的两个新引用以最小差异接入首开，并仍由恢复阶段对固定版本字节复算 SHA、验证 schema-only 合同。不增加任意桶、动态前缀或无版本回退。这份清单只覆盖供给与回读，不覆盖恢复、领取或首开执行。

### 4. 独立技术通过，才允许一次 Neon 原子完成

- 由独立会话对准确资源做一次技术核验；现有读取门禁为最多 **24 次 AWS 元数据调用**（身份核对另计）、不读取 Secret 值，另只对本目标允许一次验证 TLS 的只读数据库身份/schema 核对和 `/health`、`/ready` 各 1 次。验证当前 g1 库和角色 OID、迁移/隔离、CFN `CREATE_COMPLETE` 与七项真实物理资源、路由和 Alias、ECS 1 运行/0 待启动、目标健康、A 实际运行 digest、两固定 Secret 版本、S3/CDN 配置及兼容性。不能拿执行者成功 ACK 代替独立证据；不做登录、店铺/菜单或付款测试。
- 只有同一任务的可信独立检查点、有效订阅/租约、围栏、固定版本和完成合同全部通过，才允许一次 Neon `complete`。同一事务写 **3 条状态更新＋1 条初始绑定**：实例 `active` 和客户入口、部署 `ready`、任务 `succeeded` 并释放租约、D2 初始绑定为 **A / revision 0 / 无活动发布请求**。保留原支付、订阅、目录及旧租户状态，不允许覆盖已有绑定。随后用另一只读登录调用 `inspect` 回读相同证据和 revision；不再跑一次 D2 更新。

## 为什么现在不能批准执行

确认了付款和唯一任务，单次入口与窄权限候选已离线接通；仍未绑定真实端口或安装有效策略/完成 DDL，两个固定基线版本也尚未供给。**当前只等一次条件复制及独立回读的合并批准。** 派生对象占用、实时 A、原 Express／Cell 归属及恢复后的监听器、媒体和 Secret 绑定不在本清单。安装、恢复和首开仍须按准确材料审批；所有依赖就绪前不开领取窗口。

跨 AWS、Aurora 和 Neon 非原子；开始恢复后可能持续产生 ALB、Aurora、ECS、存储/CDN 等费用，预算不是硬停费。结果不明、过期、并发或越界即停，保留真实回执与永久槽；只按另批范围对未知结果只读回查，不重试、补建、主动回滚或自动清理。数据库激活事务原子，不代表其它阶段能一起回滚。

**本轮实际：** 只编制清单并本地校验准备入口，不执行复制或回读；新的 AWS 调用、权限变更、恢复、领取、调度及部署均为 0。不改应用或工作流，不重复购买或开启全队列。
