# AWS 自动部署最快交付方案

决策日期：2026-10-05。用户明确要求执行最快实现方案，移除优先省钱策略，并给出新预算 `50 USD`；按此前月预算语境落实为 **50 USD/月目标**。

## 交付目标与主线

首轮只验收一个 Cell、一个租户，完整链路为：

```text
已发布模板和镜像 → 购买/管理员部署任务 → Worker
→ 租户独立 Secret → 独立 database/role → 空 baseline 与 SaaS 迁移
→ CloudFormation/ECS → 健康检查 → mTLS/JWT 配置下发
→ 可访问地址/ready 回写 → 失败回滚和到期清理
```

沿用已有 AWS ECS Fargate + ALB + Aurora PostgreSQL 架构、现有 region/account 和 `sandbox.techlong.cloud`。Neon 是平台控制数据库，不替代餐饮租户业务数据库；现有 `public.*` SQL 仍使用每租户独立 database/role，不改为共用 database。

交付速度优先：复用已完成状态机、SDK adapter、模板、镜像供应链和数据库迁移；测试只覆盖本次改动及相邻安全边界。权限诊断是主链路的门禁子任务，不再默认用新 generation 轮次推进项目。多租户扩容、退款/升级降级和新架构选型不在首轮关键路径。

## 四个验收批次

| 批次 | 实施范围 | 验收标准 | 当前状态 |
| --- | --- | --- | --- |
| F1 真实运行时组合 | 真实 Secret material generator、租户上下文绑定、数据库/ownership/清理/mTLS adapter 接线、50 USD 预算兼容 | 组合不调用云；独立凭据不串租；同一 Secret/lifecycle 实例用于部署和清理；不能靠环境变量打开 runtime | 代码及定向验证完成，未云启用 |
| F2 数据库可执行闭环 | PostgreSQL 16.14 空 baseline 候选；backend prepare/restore/migrate/verify production provider；镜像构建与严格 readback | 业务数据为空；只允许批准 seed；真实任务回执和崩溃恢复；旧 inspect/destroy 入口不被放宽 | F2g2显式prepared-v2接线及定向验证完成；F3a2新root双镜像已ECR发布/独立字节与扫描核验。baseline/TaskDefinition/activation/单租户权限仍未安装，真实AWS数据库闭环未完成 |
| F3 在线门禁集中验收 | 单次只读取证收敛 IAM；authority/root；ACM/DNS/mTLS；空 inventory；TTL/回滚；费用估算；bootstrap Change Set | 使用真实 provider 证据；审批/执行在同一本地流程及时完成；成功或失败均独立撤权；可证明清理 | F3a只读取证完成，F3a2实际双镜像发布成功并立即Revoke/独立Locked/v6，旧镜像保留；PG16.14可用、Cell缺失。TTL/mTLS/DNS/专属IAM/baseline/读cap/Budget仍阻止付费执行，F3整体未完成 |
| F4 单租户端到端 | 已批准 Cell 和镜像上运行真实 Worker；一个部署任务到 ready；失败/TTL 验收 | 真实健康端点、配置与地址回写；无孤儿租户资源；费用与资源 inventory 核对 | 尚未执行 |

F1/F2 的代码准备不等待 IAM 探针完成；付费执行仍必须满足 F3。任何批次不能把本地模拟通过当作云端验收通过。

## 费用与授权的新边界

- **10 USD 最低费用优先不再是当前交付方案的约束。** 新代码接受已批准的 50 USD/月 policy；旧 10 USD policy 仅为封存计划兼容，不自动重写历史清单、证据或数据库配置。
- 50 USD/月不是无限消费授权，也不是 AWS 实时扣费断路器。不能据此宣称整套 ECS/ALB/Aurora 可以全年常驻在该预算内。创建前需按 ca-central-1 实际资源、运行时间和已发生费用评估。
- 本批次不修改 AWS 上原有 Budget、Deny、IAM、Schedule 或 Neon policy。变更它们属于新的受审云/数据库操作，需列入新的准确清单。
- NAT Gateway、VPC Endpoint 或其他服务如确实能缩短主链路，可纳入后续成本与权限评审；不为“取消省钱优先”而强行替换现有网络模板。当前已批准模板/IAM 的拒绝边界不被静默删除。
- 单 Cell/租户限额、租户隔离、ownership CAS、凭据不落日志、立即撤权、失败回滚和禁止过期重放均保持。这些不是费用优化项。
- Git 提交/推送沿用用户默认授权，直接两个仓库的 main；仅提交实际变动的仓库，不生成新分支。
- 实际 IAM 安装、付费 Cell 执行、数据库写入和不可恢复删除仍按 fresh SHA 单独批准；本次泛化实现授权不重放 generation6 的过期计划。

## F1 实现说明

`NodeTenantRuntimeSecretMaterialGenerator` 使用 Node `randomBytes(32)` 分别生成数据库密码、HMAC、JWT 密钥；Stripe test key/webhook secret 从租户绑定的私有 credential source 借用，不随机伪造，不接收 live key。数据库 URL 固定为已配置的区域 RDS endpoint/5432、当前租户 database/role、`sslmode=verify-full`。

material 只能在 guarded Secret store 的 generation/epoch 上下文内生成。AsyncLocalStorage 隔离并发租户，校对完整 Secret 名称和 ownership 字段，Stripe lease 始终 dispose，provider 原始异常不外泄。生成器不保留生成的秘密；不可承诺 JavaScript 字符串能被即时可靠擦除。

`createPreparedDeploymentWorkerRuntime` 实际组合现有 Secret adapter、ECS one-shot lifecycle、GuardedTenantDatabasePort、CloudFormation workload cleanup、OrderedTenantResourceCleanup、DynamoDB authority-backed ownership coordinator 与 mTLS control client。部署与清理共享同一组实例。构建只加载能力，不调用 AWS/Neon，不领取任务。

这仍是 **prepared_not_activated**：原 standalone Worker 默认入口保持关闭，prepared root 的 apply/cleanup readiness 也固定为 false。原因是当前已部署 lifecycle 镜像只证明 inspect/destroy，不包含已经在线验证的 prepare/restore/migrate/verify provider；当前 Cell 仍缺失，authority 尚未安装。不能伪称自动部署已经可用。

## 继续位置

最新继续位置（2026-10-08 Winnipeg）：用户批准3610895c...恢复清单后，在原窗口内一次Run复用两既有Secret准确版本、经TLS各一次原密码+LOGIN，COMMIT确认；00:15:46.139/00:16:19.641UTC（Winnipeg19:15/19:16）两次独立只读Inspect均两角色LOGIN/准确版本/真实受限认证通过，credentialReady=true、runtimeEnabled=false。新roleState SHA6ec32bd...；LOGIN归一后仍原1528e1e...，preserved993506.../权限/原seal与业务不变；两Secret ARN/UUID/AWSCURRENT/标签不改、无AWS写、新GRANT/IAM/资源部署。新恢复slot永久占用，旧slot/失败记录保持，禁止再Run/reset/改密码/自动down/delete/重试。本次是实际Neon托管提交和认证证明，不是AWS自动部署已上线；旧原失败SQLSTATE仍未知，日志暴露风险按批准保留。下一阶段准备新IAM/boundary/Lambda/authority准确安装清单，实际云写另fresh SHA确认，默认Worker仍关闭/50USD目标不变。见 [控制凭据真实就绪与继续位置](./aws-auto-deployment-fast-track-f3b3-neon-credentials-ready.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：Neon官方文档确认不支持SQL预哈希密码，原SCRAM入口存在托管兼容性差异，但原错误缺SQLSTATE仍不能唯一证明失败根因。独立恢复module/CLI已实现，原9文件binding/消费slot保持；复用两准确现有Secret ARN+UUID+AWSCURRENT，不生成密码/写Secret/改IAM，只拟经认证TLS在一个本地事务各一次原密码+LOGIN，保持forward_ddl=on，明确服务端/提供者日志风险及跨系统非原子性，任何新写需fresh SHA批准。真实只读23:35UTC两角色仍NOLOGIN/原权限业务SHA不变，两既有Secret完整版本/载荷匹配，Source有效；新恢复slot空、runtime关闭。8新+10旧定向/type/lint/语法通过；GHA run37860578505/headdf18bee/attempt1 success，32组含3新真实原密码SQL/认证/失COMMIT只读恢复，两DB drop/固定容器stop/artifact独立核验通过（Neon hook/AWS仍mock，非托管提交证明）。待批SHA `3610895cfb3b42e14929302105c4beb127c26bf74f42deb32734bf9d86e4918a`，到2026-10-09 00:35:05.741UTC过期，未批准/执行。下一步确认恢复范围并独立核验，非直接runtime上线。见 [Neon兼容恢复与新清单](./aws-auto-deployment-fast-track-f3b3-neon-credential-recovery.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：用户批准85b500...后只执行一次credential bootstrap，AWS两准确Secret/AWSCURRENT UUID/标签/载荷创建读回已证明，但Neon两角色SCRAM/LOGIN的DATABASE_COMMIT抛错无确认；23:16:16/23:17:23UTC两次独立只读Inspect均原NOLOGIN、roleState1528e1e.../preserved993506...未变、credentialReady=false。固定credential slot永久消费，旧slot保留，禁止Run/reset/重造Secret/更换密码/自动down/delete/重试。仅增加只读provider诊断，实际pooler=true/forward_ddl=on；Neon官方有角色密码PRE_COMMIT控制面hook，是排查方向而非已证根因，原SQLSTATE未保存。不可声称普通PG证明涵盖Neon托管提交或密码/控制面绝对未变。两个Secret基础约0.80USD/月仍可能收费，runtime/IAM/Cell/ECS未动，50USD目标不变。下一阶段只读诊断和复用现有准确Secret版本的恢复方案，新写另按fresh SHA确认，不推进runtime。见 [部分状态与恢复边界](./aws-auto-deployment-fast-track-f3b3-control-credentials-partial.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3 Secret-first/SCRAM控制凭据入口及只读Inspect完成，67项定向/type/lint/语法/build通过；最终真实PG18 run37853428469/headdf9a135/29组证明，原权限不变、两角色原子LOGIN、真实密码认证/失COMMIT恢复/不重放证明与两DB drop/容器stop独立核验。AWS Secret仍mock；Source只读库存两Secret/新IAM/Lambda ABSENT，原Neon两NOLOGIN角色保持1528e1e...，原slot不动，新credential slot空，无生产密码生成/值读取/Neon或AWS写。六项Source权限模拟allowed不是实机创建证明。最终清单SHA `85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54`，过期2026-10-08 23:26:12.968UTC，等待新scope明确确认：两Secret初始版本/标签/default managed KMS先创建核验，再一个事务设置两角色密码及LOGIN；接受LOGIN真实列能力、跨服务不原子/失败可留收费Secret或LOGIN角色、无自动删除/down/reset/重试，约0.80USD/月基础+请求相关费用/税费，50USD目标非硬cap。没有新IAM/runtime/Cell批准；凭据成功后再IAM/Lambda/authority集中准备。见 [具体凭据清单与恢复边界](./aws-auto-deployment-fast-track-f3b3-control-credentials.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：用户明确批准4ef39a...后，F3b3两NOLOGIN控制角色/最小GRANT已按原代码单次COMMIT确认，21:27:03/21:27:38UTC两次独立Serializable READ ONLY回读一致；reader八表SELECT/列写0，drain四表SELECT/准确20列权限，创建者neondb_owner ADMIN=true/SET=false/INHERIT=false，原seal/业务/其余权限保持。poststate1528e1e...，preserved993506...与批准前一致，submission229e15...、readback e995627...；role安装slot永久消费，旧schema/register两slot保留，禁止Run/down/reset/GRANT重放。本轮未设置密码/LOGIN/Secret，未调用AWS或启用runtime，50USD目标不变。下一阶段准备角色LOGIN/随机凭据与两准确Secret的具体安装/失败恢复清单，新SHA确认后才写；IAM/Lambda/authority及实际Cell/单租户闭环仍另批。见 [Neon控制角色实际安装与继续位置](./aws-auto-deployment-fast-track-f3b3-neon-control-roles-installed.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3第一批独立NOLOGIN控制角色安装入口完成，原安装/登记代码与slot不改。57项定向/type/lint/语法/build及真实PG18 run37842882331/head8c5080e/26组证明通过，准确artifact/两DB drop/容器stop独立verification d47e14f4...；已验证非super CREATEROLE、有效表/列/隐式ADMIN membership权限、失COMMIT响应独立回读、不重放和额外列写拒绝。Neon最终只读两个角色/别名0、原seal完整、新slot空；AWS两新IAM角色/两Secret/Lambda仍ABSENT，runtime off，未写Neon/AWS。fresh清单SHA `4ef39a5995c8a0d394e1cbb72b2c3e51d8588bd86e8b75e3d6287ba138171cac` 仅两NOLOGIN角色及准确最小GRANT，接受writer列能力不是行过滤/纯读、创建者自动ADMIN（无SET/INHERIT）、短暂写锁、提交后不自动down及永久slot无重试；2026-10-08 21:55:47.776UTC过期，尚未批准/执行。确认后只此批安装+独立回读，接着LOGIN/凭据/Secrets，再IAM/Lambda/authority各fresh批准；本批无需AWS刷新/MFA。50USD/月目标不变。见 [NOLOGIN角色具体清单、验证与下一执行入口](./aws-auto-deployment-fast-track-f3b3-control-role-installation.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3独立v3 durable authority/原子前驱读+一次CAS安装器/永久journal/执行root/SDK/新Lambda及候选ZIP完成，完整证书/raw witness/准确身份保留，旧v2不桥接；源读取新增RLS/列级写/非trigger definer执行拒绝。45项定向、137项相邻回归（有重叠）/type/lint/语法/build，真实PG18 run37829262726/head3477818/23组证明及两DB drop/容器stop独立核验通过；AWS/DDB/删除明确mock，非云上线。最终ZIP921046b3...未上传。Neon只读确认两控制角色/别名仍0/owner可CREATEROLE/PUBLIC非trigger definer0；Source准确库存两新IAM角色/两Secret/新Lambda3均ABSENT、authority表ACTIVE按请求付费。两角色最小SQL候选7fc82e... NOLOGIN、reader八表SELECT、writer必要列权限含行锁timestamp UPDATE，未注册/批准/执行。下一阶段生成具体DB/凭据/Secrets/IAM/boundary/Lambda/authority可执行安装清单，fresh SHA各批确认，不用草案/zip SHA代授权；默认runtime off/50USD目标，旧Neon两消费槽位永久保留。见 [F3b3持久v3入口、权限候选与继续位置](./aws-auto-deployment-fast-track-f3b3-durable-executor-v3.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：用户明确批准1fba989登记清单后，准确旧计划单行证书INSERT/内部fence finalize已单次COMMIT成功；新连接独立回读与另一次VerifyRegistration通过，两份完整证书canonical SHA dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f一致。registry1/fence sealed=true revision2，原行/plan/实例pending/订阅active/旧trigger/角色不变，AWS/runtime未动。两个DB固定槽位均永久占用，禁止RunInstall/RunRegistration、down或复位；完整expected证书pin从私有独立receipt提取，不能用event/任意DB行替换。下一阶段v3持久authority/CAS/永久journal/独立executor root与新版包，以及最小DB角色/Secrets精确审批范围；当前未授予新权限、source v3/默认Worker仍未启用，各云安装仍单独确认。见 [F3b3准确密封登记与继续位置](./aws-auto-deployment-fast-track-f3b3-neon-plan-sealed.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：用户明确批准ce844安装清单后，Neon原C088保护SQL单次COMMIT成功，新连接独立回读及另一次VerifyInstall均通过；实际两表/八函数/十六Always trigger/一条未密封内部fence，registry0、fence revision0、原行/业务/旧trigger/角色未变，AWS/runtime未动。install固定槽位永久占用，不再RunInstall或down。已仅只读生成后继准确单行永久登记清单SHA 1fba989e681c6e7bb0c71178adfde6686f618359ad9e422db549b7b038aab333，过期2026-10-08 18:21:21UTC，尚未批准/执行，register槽位空。下一步必须新SHA具体批准登记；过期只读刷新后再确认；登记之后才推进最小角色/Secrets与v3持久执行接线，各云资源另批。见 [F3b3真实安装与登记边界](./aws-auto-deployment-fast-track-f3b3-neon-schema-installed.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3 Neon精确管理入口完成；实际TLS/Serializable只读确认PG18.6、13表owner neondb_owner、十个引用闭包、新对象与拟议角色0，原业务pending/active保留。32项定向/type/lint/语法/AST/build及真实PG18 run37813739467/head554b125/19组证明通过，两CI自有数据库drop/容器stop独立核对，覆盖安装、登记及提交响应丢失后的只读恢复。最终仅安装清单SHA ce844c9096de5c71cf3d3447916143260d336292180dbf2193f3b256d67fb36b，过期2026-10-08 18:07:22UTC，尚未批准/执行；固定install/register槽位均空。下一操作需具体确认仅安装（两表/八函数/十六Always触发器/未密封fence，不登记/授权/改业务或AWS）；过期仅刷新只读再批准。见 [F3b3 Neon管理与审批边界](./aws-auto-deployment-fast-track-f3b3-neon-management.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3 v3 freshness/admission/authority/deletion证据与完整候选/计划绑定完成；真实PG18 run37809750133/head e4a615b attempt1 success、16组证明，完整artifact/数据库drop/容器stop独立核对，25+173项定向及相邻回归/type/lint/AST/build通过。新证据保留完整证书/raw witness、严格时钟/fence/二次状态对照，不降级schema2、不开放caller override。仅prepared候选与plan，未持久authority/CAS/journal/root安装或可执行删除；旧1/1门禁/runtime关闭保持。下一小阶段生产密封安装/登记审批入口与Neon准确schema/owner/min-role只读preflight；v3持久authority/独立executor接线及各云安装仍待完成/具体批准。见 [F3b3 v3证据与继续位置](./aws-auto-deployment-fast-track-f3b3-evidence-v3.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3 PG18.6云端真实证明与独立只读source-v3完成，两GHA run attempt1 success、11/14组证明和精确artifact/cleanup独立核对；152项回归/type/lint/build通过。完整证书、原行/planbytes、永久fence及inline catalog校验，raw与分类集合都入新hash，不执行mutable helper、不降级schema2。未Neon安装/登记或新删除入口接线，旧规划门禁和runtime关闭保持。下一小阶段v3 freshness/admission/authority/deletion适配，再fresh审阅Neon schema/角色与各项安装/登记权限。见 [F3b3 PG18/source-v3](./aws-auto-deployment-fast-track-f3b3-pg18-ownership-v3.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3准确旧计划密封登记/永久引用guard的未注册SQL候选完成，覆盖九表十列、两内部表/八函数/十六Always触发器；完整表结构/catalog/fence版本校验、真实PG16并发与业务连续性11组证明通过，server已停。Neon只读schema匹配/新槽位0，但实际PG18.6尚未运行验证；9项定向检查/type/lint通过，没有Neon/AWS写或source/Worker改动。下一小阶段PG18隔离验证及独立版本化ownership proof接线，新schema/准确登记仍fresh单批批准。见 [F3b3密封候选与继续位置](./aws-auto-deployment-fast-track-f3b3-sealed-schema-candidate.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3独立Executor v2的core/root/SDK journal/Secret入口和未安装Lambda包完成，旧Janitor协议不放宽、删除计划SHA按准确新身份分域；143项相邻回归/type/lint/build/包自检通过，Source只读确认新role ABSENT。密封隔离契约已具体化但无DDL/新adapter，当前门禁仍1/1，未安装任何IAM/数据库/云runtime。下一小阶段准备未注册的密封schema/永久引用guard与版本化ownership证明，再整理具体安装范围供fresh批准。见 [F3b3 v2产物与继续位置](./aws-auto-deployment-fast-track-f3b3-dedicated-executor-v2.md)。以下保留历史。

最新继续位置（2026-10-08 Winnipeg）：F3b3旧计划/immutable trigger及Source刷新后的控制面只读审阅完成，保留实例/订阅/原件，密封隔离登记尚为设计，零租户门禁仍1/1。真实Janitor boundary v2同时附加为身份策略且显式Deny变更，仅换boundary不能启用executor；提出保留旧IAM/PLAN_ONLY的独立executor身份修订，须版本化精确入口、新artifact和新role只读核验。原F3b2复用role草案与产物保留而不安装；尚无可执行安装SHA，F3b3未整体完成。见 [F3b3审阅、证据和继续位置](./aws-auto-deployment-fast-track-f3b3-isolation-review.md)。以下保留历史。

最新继续位置（2026-10-07 Winnipeg）：F3b2真实Neon draining/owned cleanup与rollback入队/serializable source协调代码、两个独立Lambda候选和未授权资源草案完成；131项相邻测试/type/lint/build/本地包自检与Neon READ ONLY EXPLAIN通过，无云/数据库写。旧planned plan_only记录1条仍挡严格零租户，保留；专属角色/Secret未创建。下一F3b3准备保留原件的旧计划处置审阅及准确控制面安装清单；authority writer/调度/端到端proof仍未完成，不将hash当授权。见 [F3b2记录与继续位置](./aws-auto-deployment-fast-track-f3b2-drain-coordinator.md)。以下保留历史。

最新继续位置（2026-10-07 Winnipeg）：F3b1已实现prepared Cell TTL一次性持久化执行入口，实际SDK共用懒凭据/单次请求，102项清理与129项租户主链、type/lint/build通过；旧PLAN_ONLY/Scheduler/Worker未改变，没有新云/数据库执行。下一步F3b2补自动drain/租户清理→零租户→authority/plan的生产协调、可部署artifact与准确权限材料，实际安装/删除仍另批。见 [F3b1代码与未完成门禁](./aws-auto-deployment-fast-track-f3b1-cell-ttl-execution.md)。以下保留历史。

最新继续位置（2026-10-07 Winnipeg）：F3a2唯一发布成功、原云回执与独立ECR字节/扫描一致、立即Revoke后Locked/v6；六份旧镜像保留，实际policy v3/v4被CloudFormation清理且写前内容备份。slot已消费且窗口过期，不重跑。下一代码切片实现owned-resource可执行TTL/失败清理，再准备专属IAM/baseline/容量/Budget与DNS/mTLS范围，付费Cell最后另批；Worker仍disabled。见 [F3a2证据与继续位置](./aws-auto-deployment-fast-track-f3a2-ecr-published.md)。F3未完成，以下保留历史。

最新继续位置（2026-10-07 Winnipeg）：F3a集中只读、原始镜像候选保存和准确区域费用核验已完成，未做任何云部署/安装/数据库写。新的仅两份source19cc候选发布清单待人确认；随后优先实现可执行owned-resource TTL/失败清理，再准备准确IAM/baseline/容量/Budget与DNS/mTLS基础范围，Cell最后批准。见 [F3a结果与新的窄审批](./aws-auto-deployment-fast-track-f3a-readonly-preflight.md)。F3未完成，以下保留历史。

最新继续位置（2026-10-07 Winnipeg）：F2g2平台显式prepared-v2接线和未安装部署材料已完成。下一阶段F3集中只读preflight、实际Aurora PG版本/资源/费用核验与fresh云批准材料；默认Worker仍关闭，无安装或付费执行授权。见 [F2g2实现、验证与边界](./aws-auto-deployment-fast-track-f2g2-prepared-runner.md)。以下记录保留历史。

F2a 已在服务端加入 `build-empty-tenant-baseline.js` 和复用既有严格 TOC validator 的候选编译器。仅允许本地 PGHOST、read-only PGOPTIONS、schema-only dump；子进程离线 TOC/SQL 不继承 PG 环境，不输出凭据/provider 原始错误；输出目录新建且实际父路径必须在 artifact workspace 内。不会把数据 archive 标成空库。

实际首次导出留在 `F:/ChatGPT_workshop/techlong-empty-baseline-20261005-f2a`，只有 0 字节失败 archive，**不是有效 baseline**。用户启动原开发 PostgreSQL 后，`f2a2` 真实导出成功；旧策略拒绝订单系统所需 extension/functions/triggers。已逐项核对真实定义，新增显式、版本固定的 `speedfeast-empty-schema/2026-10-05/v1`：仅允许 `uuid-ossp`、5 个固定函数、4 个固定 trigger，比较完整 SQL 定义并拒绝 body/权限/绑定漂移。默认 legacy policy 不变，没有删除购物车计算或更新时间行为。这不是通用 SQL 沙箱，完整 archive/manifest SHA 与恢复批准仍必要。

最终候选 `F:/ChatGPT_workshop/techlong-empty-baseline-20261005-f2a4`：73 张表、203375 字节 schema-only archive、10 个程序对象定义匹配，无业务行/源库写入。archive SHA `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a`，candidate manifest SHA `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971`。失败/中间目录全部保留；私有 archive/SQL/manifest 不提交 Git。结果仅为 `CANDIDATE_REQUIRES_PG16_RESTORE_AND_APPROVAL`，不是 approved baseline。

2026-10-06 F2b 已完成：独立 EDB 便携 PostgreSQL 16.14 实例恢复此准确候选，另起只读进程/会话实测 73 张表零行与扩展/程序定义通过，临时实例已停止，源 archive/manifest 未变。结果 `PG16_RESTORE_EMPTY_PROFILE_VERIFIED`；`baselineApproved=false`，没有升级源 PG15、安装系统服务、构建/运行镜像或调用 AWS/Neon。见 [F2b 真实验收与证据](./aws-auto-deployment-fast-track-f2b-pg16.md)。

2026-10-07 F2c 第一批已完成 `migrate_saas/verify` SQL transaction provider，在全新 PG16.14 TLS、非 superuser cell_admin 上实际验证回滚、同任务重放、COMMIT 响应丢失恢复、管理会话丢失中止和旧 epoch 拒绝。独立只读进程核验 1 条 singleton、8 条默认 entitlement，其余业务表零行；空 Stores 使主题 seed 为 0 行，非此前简化的无条件两行。所有临时实例已停止，Source/AWS/Neon 未变。见 [真实事务 provider、证据与继续位置](./aws-auto-deployment-fast-track-f2c-saas-transactions.md)。

2026-10-07 F2c 第二批已完成真实 prepare/失败补偿 SQL capability：永久 journal、专属 NOLOGIN guard、禁止连接 quarantine、准确 role/database OID、原子 ownership promotion 和补偿 tombstone；真实 PG16.14 非 superuser TLS 验证三类创建/提交响应丢失恢复及清理响应丢失恢复，拒绝外来同名/重建 OID/旧 epoch，独立只读回读通过，临时实例全部停止。45 项相邻 Node 回归及 backend typecheck 通过。数据库模块只接收 URL，不接触其他 Secret 键。见 [prepare 真实证据与继续位置](./aws-auto-deployment-fast-track-f2c-prepare.md)。

2026-10-07 F2c 第三批已完成原子 restore SQL capability：准确 archive/manifest 离线编译、固定逻辑 catalog pin、准备阶段准确 OID 前驱、目标事务 DDL/零行/profile/双 marker、只读重放和提交响应丢失恢复；实测管理 backend 丢失整体 rollback、额外列漂移拒绝，真实 prepare→restore→migrate→verify SQL 链跑通。62 项 Node、28 项 Python 相邻校验和 backend typecheck 通过，四个实例停止；应用账户仍 NOLOGIN，无源库/云写入。见 [原子恢复证据与继续位置](./aws-auto-deployment-fast-track-f2c-atomic-restore.md)。

2026-10-07 F2d 已完成 prepared SQL service、准确部分恢复、独立 normal cleanup journal 和显式 prepare-v2 release gate；实际证实旧 cleanup registry 的 parsed prefix 约束不匹配，旧表/旧默认 CLI 保留不自动迁移。真实 service 四阶段→删除响应/COMMIT 响应丢失恢复→同命名空间新 generation→旧 cleanup replay 不触碰新 OID，独立只读回读通过。70 项 Node、28 项 Python 回归与 backend typecheck 通过，四个新实例停止，无源库/云写入。见 [prepared service 与正常清理证据](./aws-auto-deployment-fast-track-f2d-prepared-cleanup.md)。

2026-10-07 F2e 已完成：单独 prepared 应用最小授权和实际 TLS 数据库登录，准确 policy 原子提交/只读恢复，其他数据库 CONNECT prerequisite 拒绝；对应 cleanup 先永久 claim，再 NOLOGIN/撤销 CONNECT/关闭准确数据库新连接，活跃旧会话不强制终止，关闭后准确删除并释放下一代。75 项 Node、28 项 Python 和 backend typecheck 通过；最终应用闭环及原 NoLOGIN 清理/响应丢失真实回归通过，五实例停止。见 [应用授权、真实登录与安全退役证据](./aws-auto-deployment-fast-track-f2e-application-access.md)。

2026-10-07 F2f 第一批完成固定 RDS owned-session/AWSCURRENT source、prepared taskService 与 v2 immutable receipt、平台严格 proof decoder/Guarded 传播、独立 lifecycle 镜像候选。真实本地 PG16 全链和跨仓真实 receipt bytes 通过，production Client 配置被检查，但 AWS SDK/网络传输是明确本地替身，不等于真实 RDS endpoint/CA/S3/ECS 验收。97 项 backend Node、28 项 Python、64 项平台测试及类型/lint 通过；四实例停止。公开 RDS trust store 当前 SHA 变化已逐证书审阅并同步候选 pins；没有线上升级。见 [F2f 第一批证据与剩余项](./aws-auto-deployment-fast-track-f2f-rds-task.md)。

继续 F2f 下一批：先解决本机无 Docker/WSL 的镜像验证条件（本地 Docker 或单独审阅仅构建 workflow），然后容器内工具/compiler/image digest 读回；生产 admission/authority/环境/deadline/artifact source/固定 task commands 的 CLI 写 root 接线仍需完成。当前新 CLI main 仅 check-bundle，所有 Worker/runtime 门禁 false，baseline 未批准/发布。SQL verified、databaseLoginVerified 与 HTTP/tenant ready 区分；Cell 全部其他 connectable DB 的 PUBLIC CONNECT 硬化仍按 fresh SHA。F2 完成后准备 F3 在线资源/费用/权限清单，批准具体 SHA 后执行，不自动新 Grant generation。

本批次平台 129 项定向测试、typecheck、lint、production build 通过；服务端 39 项 Node 相邻回归、28 项 Python baseline/legacy/profile 测试及 typecheck 通过。独立进程复验候选并重新生成验证 SQL，逐字节一致。当前没有 AWS/Neon 写入或付费资源，所有 runtime 门禁仍 false。

运行时状态可使用 `npm run deployment:check-runtime` 查看；该命令不加载 `.env.local`、不连接 Neon、不调用 AWS，报告当前 standalone root blockers 和 50 USD 月预算目标。

参考：[ECS ALB](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html)、[ECS 部署熔断](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)、[ECS 出站网络](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/networking-outbound.html)、[AWS Budgets 延迟](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)。
