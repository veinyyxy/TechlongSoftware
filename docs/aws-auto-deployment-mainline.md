# 当前主线：先完成自动部署，再整套迁到 AWS

最新里程碑（2026-10-18）：**W5f激活成功且独立Inspect通过，尚未dispatch或验收云worker。** 按f8786e44批准六项提交各一次，GitHub环境准确main规则/人工reviewer/admin bypass=false，S3固定绑定版本，两工作流精确发布及foundation仅trust UPDATE_COMPLETE；不是仍Locked。旧IAM/边界/Secret版本/Neon目录保持，110源/28新回执与107旧源/23原件完整，本地main已准确ff-only同步。Secret值/原包读取和job/workload写0。下一只准备另审单次VerifyInstall：OIDC/STS、固定DB Secret一次、窄角色只读catalog；不调用控制函数/应用或部署。当前批准不含dispatch，环境仍需人工审批；之后才新held job的云Review/RunOnce/Inspect，不重用旧成功job/旧TTL、不扩F3c9/Sites支线。见 [完成事实与继续边界](aws-auto-deployment-cloud-worker-w5f-activation-executed.md) / [证据](../ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json)。以下为历史。

最新里程碑（2026-10-17）：**W5f集中激活接线已完成候选验证，尚未激活。** 新入口准备准确两枚未推送Git对象（不建分支、不动main）后一次ff发布，reusable和实际运行源码均固定；新VerifyInstall仅用于后续另审身份/固定绑定/DB只读连接验证，不自动运行。拟environment/main规则、S3公开绑定、两工作流发布及foundation只trust ChangeSet创建/执行共6顶层提交，全部需新fresh SHA。云14+原60/续接25及真实PG18通过，107旧源/23原件/76闭包保持；目前无实际环境/信任/绑定/部署工作流写或Secret值/原包读取。下一最终clean main上prepare对象、在线只读Review和独立摘要重构，集中请求激活批准；不再恢复/扩模拟支线，探针和真实部署仍另审。见 [完整风险和执行边界](aws-auto-deployment-cloud-worker-w5f-activation.md) / [准备证据](../ops/aws-sandbox/reviews/cloud-worker-w5f-activation.prepared.json)。以下为历史。

最新里程碑（2026-10-17）：**W5e-C1已按0f0e2c02完成唯一受审续接，独立元数据Inspect通过。** 固定DB值读取1/原包1/控制Put1/Neon事务1且COMMIT ACK/窄角色认证1，DB Secret写和新密码0；真实role/schema/四函数OID及两固定Secret版本绑定 `0edfa9d7…` 已保存，107源码和23新公开回执/槽及旧记录核对通过。基础栈仍Locked/deny-all，旧IAM和表/触发器权限保持，无GitHub配置/资源创建/业务或workload写，部署worker未激活。下一仅集中准备准确OIDC信任、SHA-pinned workflow/environment和公开实际绑定发布的激活审批，再受控云Review；不再恢复/重跑C1或扩观察器，实际RunOnce/部署另批。见 [完成事实、完整绑定及继续边界](aws-auto-deployment-cloud-worker-w5e-neon-continuation-executed.md) / [执行证据](../ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.executed.json)。以下为历史。

最新里程碑（2026-10-17）：**W5e-C1已准备准确已存版本续接，尚未执行。** 新入口Review/ContinueLocked/独立Inspect保留R1和原99源码/两旧槽；未来仅一次固定DB值读取、一次原包控制材料读取、一次缺失控制Put、一个Neon事务，不改数据库Secret或生成密码。API ACK先持久化，5轮只读可见性上限，不重发写/放宽安全条件；不把旧错误归因传播。云CI25（新增15）/真实PG18十组及原60/十五组通过、76闭包原件核对；首轮CI独立依赖遗漏已修正，失败保留。本轮生产私密读取/写/新槽消费0，下一最终clean main只读fresh Review、独立重构后请求新范围SHA，不激活/部署。见 [完整风险和接口](aws-auto-deployment-cloud-worker-w5e-neon-continuation.md) / [准备证据](../ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.prepared.json)。以下为历史。

最新里程碑（2026-10-17）：**W5e-R1获4f82199f批准后只执行一次，数据库Secret版本已保存，DatabaseVersion阶段随后停止。** 另进程Inspect确认精确数据库唯一AWSCURRENT/控制Secret空、Neon role/schema不存在/catalog未变、foundation完整Locked及原IAM保持。私密包读取1、Put尝试/ACK各1、Neon写0；具体写后断言/错误原因未保存，不断言权限或传播问题。新旧槽保留，失败源码/99 pins/25原件保持；未生成安装绑定、未激活或部署。下一须新授权准备“读取已存固定数据库版本并续接”的窄清单，不重放空Secret起点、不自动GetSecretValue/补齐或扩支线。见 [实际结果与唯一继续边界](aws-auto-deployment-cloud-worker-w5e-neon-recovery-partial.md) / [执行证据](../ops/aws-sandbox/reviews/cloud-worker-w5e-neon-recovery.executed.json)。以下为历史。

最新里程碑（2026-10-17）：**按用户要求，W5e-R1兼容恢复入口已准备并通过候选云CI，仍未执行。** 新独立slot，不重放旧InstallLocked；准确复用Locked栈/两个空Secret，拟先持久化两固定版本再一个Neon原密码事务，新增脱敏诊断。60项回归、真实PG18新10组/原15组通过，原ZIP及76闭包独立核验；Neon托管转发仍未证明。原90源码、25证据和旧槽不变。本轮生产写入/私密读取/密码生成/新槽消费均0；只待最终main上fresh只读Review和新SHA批准，不自动恢复、激活或部署。见 [完整范围及风险](aws-auto-deployment-cloud-worker-w5e-neon-recovery.md) / [准备证据](../ops/aws-sandbox/reviews/cloud-worker-w5e-neon-recovery.prepared.json)。以下为历史。

最新里程碑（2026-10-17）：**W5e获439ab7dc批准后仅执行一次，基础资源已Locked安装，Neon阶段停止。** 五资源准确栈CREATE_COMPLETE、两Secret隔离且空值，原私密包校验1次；两次独立只读核对Neon新role/schema/函数不存在，旧IAM不变。发现实现遗漏已知Neon不支持预哈希密码的限制，不能以普通PG18通过代替托管兼容。原异常未保存，保留唯一根因不确定性。旧槽不复位、不补齐/重试/激活，下一是新的兼容恢复设计，不重跑安装或重开支线。见 [完整部分结果](aws-auto-deployment-cloud-worker-w5e-partial.md) / [原件摘要](../ops/aws-sandbox/reviews/cloud-worker-w5e.executed.json)。以下为历史。

最新里程碑（2026-10-17）：**W5e一次性Locked安装器已完成候选验收，等待fresh安装批准。** Review/InstallLocked/独立Inspect接固定永久槽和准确源/动作绑定；五资源foundation、两Secret先隔离后写值、Neon专属角色/四函数单事务安装都有实际适配器。云CI 50项及真实PG18十五组通过，原ZIP/76闭包独立核验，旧99 pins保持。候选工作流不在活动目录，OIDC不开放。本次没有权限安装、私密值读取或部署；下一只集中批准Locked安装，真实ID核验后收口激活，不扩观察器/支线。见 [完整风险](aws-auto-deployment-cloud-worker-w5e-installer.md) / [准确证据](../ops/aws-sandbox/reviews/cloud-worker-w5e.prepared.json)。以下为历史。

最新里程碑（2026-10-17）：**W5d集中安装材料已准备，仍未安装。** 28次AWS SDK只读、GitHub配置和Neon catalog确认候选名为空/旧IAM不变，准确W4c栈七资源CFN已删、父Cell保留，不声明namespace全空/停费。真实immutable OIDC subject与旧task宽Secret权限已纳入候选；五资源foundation、Neon四函数、两个新Secret先资源策略隔离后写值，受审workflow尚未发布。AWS只读验证、42项云回归及PG18十二组通过，原始证据留存。当前design SHA不是执行批准；下一只做一次性安装入口和准确源/动作绑定，再给fresh集中安装确认，不再增加盘点切片。见 [W5d范围和风险](aws-auto-deployment-cloud-worker-w5d-install-review.md) / [原件摘要](../ops/aws-sandbox/reviews/cloud-worker-w5d.prepared.json)。以下里程碑保留追溯。

最新里程碑（2026-10-17）：**W5c单一云Review/RunOnce/独立Inspect候选已收口**，连接W5a永久journal、V5 SDK/最小Secret、四函数Neon窄权限、同任务原子完成及S3条件写回执；成功沿革可继续。run39073640808云端36项、真实PG18十二组、75文件闭包及原ZIP/五材料核验通过，旧99 raw pins保持。当前仍未安装身份/Secret/权限/付费资源，不代表实际云部署已启用。下一只做集中安装盘点与具体范围审批，不再加观察器切片。见 [W5c实现及完整风险](aws-auto-deployment-cloud-worker-w5c.md) / [原件和准确继续位置](../ops/aws-sandbox/reviews/cloud-worker-w5c.prepared.json)。下方W5b里程碑保留追溯。

最新里程碑（2026-10-17）：W4c真实闭环及W5a云永久journal候选已完成。W5b独立SDK云provider、准确W4c沿革公开capsule和最小JWT/mTLS Secret接口已完成，本地29项/Linux 20+8项及60文件闭包通过、原始回执独立核实，保留旧99 pins。云执行入口尚未启用；下一直接收拢一个Review/Run/Inspect执行根及最小Neon权限合同，不扩观察器切片。无新增权限/资源安装或真实部署，不重复W4c、不扩F3c9。见 [W5b实现、验证与唯一继续位置](aws-auto-deployment-cloud-worker-w5b.md) / [W5a已完成](aws-auto-deployment-cloud-worker-w5a.md)。首轮Actions单次worker，最终整套AWS托管仍在其后。

2026-10-16，按用户最新决定更新。**不在 Sites 上线，不修改 Sites 托管配置、不推送 sites remote。** 保留现有兼容代码和托管身份，避免把“现在不发布”扩大成未经批准的删除/重构。F3c9 等支线继续冻结，历史文档用于追溯，不再作为下一步任务来源。

## 顺序与完成标准

1. **先打通平台触发闭环（W4c已完成）。** 本地平台 → 现有 Neon 控制面的一条待审任务 → W4 单次 worker → AWS 实际承载 → 两个认证 GET → 同任务结果回显及独立 Inspect。准确同job已成功，历史入口与消费槽保留，不作为下一条请求的可重放根。
2. **再把部署执行自动化。** 上述验收通过后，将准确 job 的 Review/批准/执行/Inspect 收拢到同一条操作流程；再把 worker 从依赖本机 AWS Login/本地私密包迁到受限云执行身份及受控材料。新增 IAM、云运行环境与凭据迁移按实际资源范围另审，不复制长期 AWS key，不先开放全局队列。完成标准是批准后无需人工逐条跑部署命令，失败/未知有明确状态且不偷偷重试。这才是本轮目标的自动部署完成，不把“按钮已出现”或“本机 CLI 成功”当作最终完成。
3. **最后整套系统在 AWS 上线。** 平台前端/API、部署执行器、租户应用和最终数据库承载统一纳入 AWS 发布方案，配好 `techlong.cloud` 的子域、HTTPS、登录及 Stripe 回调、日志、备份和恢复验收。本地平台/Neon 是当前过渡，不把它们当最终 AWS 交付。平台目前有 Cloudflare runtime 依赖，届时需真实 Node/AWS 适配；本阶段不提前重写。Aurora Express/Full 快速切换方案保留。

不把第三步提前做成另一个发布项目。当前不新增 Sites 版本、不为平台再创建一套 ALB/ECS/数据库，也不重新启动旧 generation/IAM 探针。

## 沿用边界

- 50 USD/月是预算目标，不是硬停费保证；已有父 Cell/数据库可能持续收费，不因本地平台停止而停费。
- 代码提交和推送按既有授权直接到两个仓库 main，不新建分支。实际请求写入、新 AWS 权限、部署和私密包读取仍按明确范围批准。
- 保留已初始化库、默认 store、现有业务记录、旧 ready_at 和成功 job。先做已初始化租户恢复，不偷偷回到首次初始化/重设密码。
- W3 原承载固定于 **2026-10-16 18:42:30 UTC / 13:42:30 CDT** 到期，不续期；到期不等于已清理。W4 执行前仍须 AWS 证明准确前驱已退役及 namespace 空，无自动删除。

## 唯一继续位置

见 [W5e-R1兼容恢复清单](aws-auto-deployment-cloud-worker-w5e-neon-recovery.md)。候选入口/云CI已完成，只在最终clean main做fresh只读Review并请求新SHA批准。未来上限为两个既存Secret固定版本写、一个Neon事务、一次新的原私密JSON读取，允许一个新的固定独立槽；明确接受原密码进入服务端/提供者日志、托管同步非原子、先Secret后SQL的部分状态风险。没有新增资源/IAM或Source Secret值读取。原439ab7dc及旧槽不得重放/复位，当前“准备”不授权执行。完成真实安装ID和独立核验后才另审激活，不扩支线、不提前部署。
