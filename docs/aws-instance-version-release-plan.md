# 缺口2：日常版本发布与更新详细实施方案

日期：2026-11-13，America/Winnipeg。状态：`PARTIALLY_IMPLEMENTED — D2-1..D2-5 CODE/CI; SAME-APPROVAL PROMOTION WIRED / ACTIVATION DISABLED`。

除下方明确交付的D2-1至D2-4代码/离线部分及D2-5已有ECR路线离线接入外，本文其余部分仍是待审设计，不是完整功能已完成、生产数据库迁移、Secret/IAM安装、镜像发布、部署工作流调度或AWS部署授权。执行以[主线手册](aws-auto-deployment-execution-runbook.md)为准；启用配置仍关闭，不启动收费环境或自动派发。

最新D2-5接线：[具体来源采集与受审目录命令](aws-instance-release-import.md)已完成代码/准确无AWS CI（164回归＋8原生PG测试）；用户选择仅代码与CI，真实采集/登记未执行。同审批自动晋升现为明确后继需求，不再按“可选”跳过，但不扩大这轮已有ECR路径或提前发布。

当前按用户新要求补[同审批候选晋升](aws-instance-release-promotion.md)：同一environment批准候选原件与更新派生约束，job发布一份app、回读ECR并窄目录确认，再复用原CFN/独立核验/回写。原件、实例和范围固定；审批前不编造digest。只代码/增量SQL草案/CI，未安装、启用或实际发布。

该代码收尾已完成：[CI43561305617](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43561305617) 对应2659d7a，171回归＋9原生PG16全过/无skip。只证明合成来源/命令和隔离数据库，不是实际ECR晋升或部署已开启。后继仍需真实候选准入、必要身份/SQL安装及两次正常技术更新验收，不重复业务测试。

一次性启用材料已集中到[总清单](aws-instance-release-activation.md)，含原三身份及publisher独立材料；源码375b0e2的准确CI43596568223验证176回归＋9原生PG16全过。真实绑定/产物/凭据仍未采集或安装，当前只等待一次集中只读补核许可，不继续扩D2-5或提前恢复环境。

<a id="d2-1-delivered"></a>

## 阶段1交付状态：合同、纯计划器与离线回归已完成

用户随后明确批准D2-1，且要求不扩支线、不过度防守编程。实际变更仅两个业务模块与既有测试/文档：

- [`contract.ts`](../lib/deployments/releases/contract.ts)：版本、实例绑定、观察快照、请求/状态和计划结果的TypeScript合同；数据库模式复用既有express_iam/full_password类型。
- [`planning.ts`](../lib/deployments/releases/planning.ts)：`planInstanceRelease(input)`纯函数，复用现有SHA工具，不读环境变量/文件、数据库或AWS，不提供apply接口。输入时间显式传入，不从当前时钟生成隐藏状态。
- [`deployment-plan.test.ts`](../tests/deployment-plan.test.ts)：16项新增回归并入原有npm test所列文件，没有另加package脚本、工作流或通用测试框架。20项部署计划＋68项相邻基线=88项通过，定向lint和全项目类型检查通过。

成功结果`PLANNED`包含计划与确定性SHA；CFN片段只为ImageUri传新digest，其他键为UsePreviousValue，预期TaskDefinition替换、Service不替换。计划绑定源/目标版本、实例/环境/栈、模板/配置摘要、CAS revision、兼容状态及准确原观察五小时截止；不会因较晚生成计划而给旧事实续期。参数顺序改变不改变计划SHA，不同实例不共用固定ID。ECR索引与平台digest分别保留。

停止/部分停止/依赖缺失返回BLOCKED_RESTORE_REQUIRED；源状态变化、错误实例/产品/版本、兼容性、迁移/启动写、上传持久化等必要条件不符则阻断。相同已核验镜像返回NO_CHANGE，不输出CFN片段、不推进当前版本指针。所有结果都带executionAuthorized=false、requiresLivePreflight=true。

这是供内部计划器使用的最小类型化数据投影，不是任意JSON解析器，也没有在线证明catalog.status或观察快照的真实性。阶段1没有数据库对象、AWS SDK客户端、凭据读取、执行端口或生产调用；D2-2新增离线持久化/适配见下一节，真实权威来源和实时预检仍未接线。不实现通用恢复框架，不改临时启停工具或旧控制账本。

离线复验命令（仓库根目录）：

```text
node --experimental-strip-types --test --test-timeout=30000 tests/deployment-plan.test.ts tests/deployment-baseline.test.mjs
node node_modules/eslint/bin/eslint.js lib/deployments/releases/contract.ts lib/deployments/releases/planning.ts tests/deployment-plan.test.ts --max-warnings 0
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

<a id="d2-2-delivered"></a>

## 阶段2交付状态：状态、适配与安装草案离线完成

用户要求进入D2-2，沿用不扩支线的边界。本阶段只新增两个业务模块、两个SQL草案及离线测试：

- [`repository.ts`](../lib/deployments/releases/repository.ts)：注入式SQL端口，目录/绑定/请求读取、准备、原子领取、云操作意图/ACK/UNKNOWN、独立核验记录和完成CAS。计划原文按既有canonicalJson保存并核SHA；已知函数拒绝与提交不明区分，无自动重试/抢锁/复位。
- [`adapters.ts`](../lib/deployments/releases/adapters.ts)：注入CFN/S3客户端，不构造默认凭据客户端。仅ImageUri更新、真实TaskDefinition替换语义、CFN正常回滚、maxAttempts=1；证据条件写/固定版本读与SHA核对。只提供独立transport方法，尚无执行编排或实时预检，不构成自行授权部署的接口。
- [`ops/releases`](../ops/releases/README.md)：独立schema三表、七个窄函数、专用owner和planner/executor/verifier授权草案。草案不在自动迁移链，不改旧业务/保护表；目录/绑定导入、LOGIN/Secret、IAM及实际安装未实施。

领取和每种操作意图均一次性；未知保留活跃请求不再执行。只有单独verifier保存的准确关联技术证据，才能由executor以原源版本/revision/requestId原子推进当前版本并释放占用。这里只实现该最小状态子集；失败分类、NO_CHANGE持久化、reconcile与整轮executor/独立inspector留给D2-3，不另建worker、控制台或恢复框架。

新增17项测试：SQL端口/序列化内存合同模型10项、真实AWS SDK内存HTTP传输7项；连同D2-1/原基线共105项通过，定向lint与全项目类型检查通过。新测试已加入既有npm test列表，未新建工作流/测试框架/依赖。**内存合同模型不是原生PostgreSQL；SQL语法、真实双连接行锁、角色/函数ACL仍须安装前在隔离PG中验证。** 没有连接现有本地或Neon库，也没有应用SQL/创建角色；SDK真实序列化/解码使用固定合成凭据和内存requestHandler，不向AWS发请求。

复验命令：

```text
node --experimental-strip-types --test --test-timeout=30000 tests/instance-release-state.test.ts tests/instance-release-adapters.test.ts tests/deployment-plan.test.ts tests/deployment-baseline.test.mjs
node node_modules/eslint/bin/eslint.js lib/deployments/releases tests/instance-release-state.test.ts tests/instance-release-adapters.test.ts tests/instance-release-fixture.ts --max-warnings 0
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

本阶段没有生产读取、AWS调用、SQL/权限安装、工作流修改、云调度或恢复。后续下一阶段是D2-3已有ECR版本的离线执行闭环，不是立即启动真实发布；实际恢复/安装/部署仍按准确范围另审。

<a id="d2-3-delivered"></a>

## 阶段3交付状态：已有ECR版本的更新闭环离线完成

本阶段按用户要求只串联已有ECR版本，不构建/晋升新镜像、不改临时工具或冻结部署工作流：

- [`update.ts`](../lib/deployments/releases/update.ts)：计划/NO_CHANGE/阻断决定持久化；读取准确待审请求/SHA、原子领取、权威目录及源运行状态复核；一次Create/严格审查真实参数和Original候选模板、执行前源角色/更新时间/物理ID复核、一次Execute、有界状态读取，最后调用独立核验入口并消费已存证明完成CAS。
- [`inspection.ts`](../lib/deployments/releases/inspection.ts)：不接收执行成功布尔值/缓存，重新读取请求与资源；核对栈/CS、TaskDefinition和Service归属、OCI索引到linux/amd64平台digest、主部署/任务数、保留配置/路由及技术端点。先条件写证据并回读准确版本，再以verifier身份登记；executor无法自行写核验。
- 原repository/adapter和未安装草案只作本闭环必要增补：三表不增加，函数从7增至9；新增只读决定/终止登记及失败/回滚完成语义。NO_CHANGE的plan=null且无CFN写；核验失败保留旧版本/占用；受管回滚只有独立证明旧版健康后才释放占用，并revision+1废止旧事实。未知提交/进程重入/证据或回写不明均不重发云写、不自动清理或续期。

新增18项整轮回归（含每项内多种失败变体），连同前两阶段及基线共123项本地通过，lint/全项目类型检查通过。两个不同实例、两个不同ECR索引/平台digest由同一代码运行；CFN/ECS/S3 SDK均使用固定合成凭据与内存HTTP handler，没有真正连接AWS。新测试并入原npm test；增加一条长期复用的普通无AWS CI，只需contents:read，无environment/id-token/Secret或部署调度，不是D2-4工作流。CI结果以准确源码run为准，不能由本地测试推定。

**未跨过的边界**：SQL草案未应用，原生PG语法、真实双连接行锁和ACL仍须隔离库验证。资源采样是注入式固定目标端口，本轮只提供其合同/摘要与核验算法和SDK模拟来源，尚未接通生产采样器；真正的新进程/读凭据隔离也未在线验证。D2-4的受审运行接线必须落实这两项，不能把合成reader用于生产或仅凭SHA参数冒充GitHub批准。没有读取本地.env/Secret/PEM、连接Neon/Aurora、安装权限或启动环境，没有业务验收。

[接口、状态及安装边界](../ops/releases/README.md)。复验：

```text
node --experimental-strip-types --test --test-timeout=30000 tests/instance-release-state.test.ts tests/instance-release-adapters.test.ts tests/instance-release-cycle.test.ts tests/deployment-plan.test.ts tests/deployment-baseline.test.mjs
node node_modules/eslint/bin/eslint.js lib/deployments/releases tests/instance-release-*.ts --max-warnings 0
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

本轮到此收尾，下一阶段仅D2-4单审批工作流及必要正式接线；实际安装、真实元数据读取、恢复、更新仍按准确范围另批。

收尾证据：源码`0ec8acbd7d704c360aefe7db5bc5020e975a3f1e`已推送main，[无AWS CI 43489154147](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43489154147) attempt1 completed/success；已独立GET核对准确head SHA及回归、lint、类型各步骤成功。这证明本离线实现可回归，不证明真实PG权限、生产身份隔离或AWS实际更新已验收。

<a id="d2-4-delivered"></a>

## 阶段4交付状态：单审批工作流/运行接线已编码，尚未启用

**阶段边界更正（2026-11-13）：D2-4代码交付已结项。** 后续另批的控制库空结构/NOLOGIN已[安装并独立核验](aws-instance-release-schema-install-completed-20261113.json)；剩余[LOGIN/Secret/IAM精确安装材料](aws-instance-release-identity-installation.md)属于一次性启用依赖，不继续算作D2-4功能编码。实际安装/启用/恢复/发布仍另审，旧阶段交付时刻的“未安装”记录保留追溯。

[`instance-release.yml`](../.github/workflows/instance-release.yml)只接受已登记实例/已有ECR版本/sandbox选择。prepare生成准确摘要和只指向控制库原请求的run-bound handoff，唯一deploy job绑定既有environment；先确认本run由指定人类reviewer批准，才取得执行身份，内部串联D2-3及独立verifier子进程。main/原attempt1/源码/workflow_ref/actor/请求/原截止均校验，不复制旧job材料、不从Web批准、不改旧部署工作流。

新增[`handoff.ts`](../lib/deployments/releases/handoff.ts)、[`workflow.ts`](../lib/deployments/releases/workflow.ts)、[`sampling.ts`](../lib/deployments/releases/sampling.ts)、运行/进程适配及固定CLI入口。采样从真实固定目标读取CFN/ECS/Cell/ALB/三规则/DNS/RDS/Secret版本/ECR，不让布尔默认值代替来源；metadata传输只允许白名单读，应用Secret只读版本元数据。控制库使用各自固定Secret版本及窄LOGIN，子进程不继承执行凭据/OIDC/GitHub令牌，实际STS身份不符也拒绝。S3持久化证据与schema版本仍来自受审初始化权威记录，不能靠配置或SHA宣称历史数据已迁移。

默认[`runtime.json`](../ops/releases/runtime.json)为enabled=false/environments={}。实际默认入口已离线执行验证：无凭据、数据库、AWS使用，deploy job跳过。新增14项流程/采样/审批/真实子进程回归，相关137项本地通过；普通无AWS CI扩展这些回归并新增临时PG16测试（草案DDL/原生锁/函数权限/CAS），不连接现有Neon/Aurora，本地未设置专用CI地址时明确skip。CI成功须按准确run确认，不能由本地结果推断。

[D2-4运行接口、来源限制和安装前清单](aws-instance-release-workflow.md)。本阶段没有生产读取、IAM/Secret/SQL/GitHub配置安装或实际部署调度，也没有恢复环境。源代码接线不代表真实身份/资源已安装验证。当前后继应先另审最小只读核实并准备一次性精确安装范围；已有ECR路径不必先扩D2-5新镜像生产，实际发布仍单独授权。

收尾已确认源码fa2c97ed92515831cb51e5a7985ddcb36468bf5a的[准确无AWS CI43501418601](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43501418601) attempt1 completed/success，head SHA及offline/PG两job匹配；137相关回归/lint/类型通过，隔离PG16草案/真实ACL/双连接锁/CAS与回滚/失败围栏5测试通过、skip0。首次CI43498845469的草案IF/CASE语法问题已单行修正并保留失败证据。真实Neon安装者/LOGIN成员与AWS身份仍未安装或验证，默认关闭不变。

```text
node --experimental-strip-types --test --test-timeout=30000 tests/instance-release-state.test.ts tests/instance-release-adapters.test.ts tests/instance-release-cycle.test.ts tests/instance-release-workflow.test.ts tests/deployment-plan.test.ts tests/deployment-baseline.test.mjs
node node_modules/eslint/bin/eslint.js lib/deployments/releases ops/releases/*.ts scripts/instance-release.ts tests/instance-release-*.ts tests/instance-release-postgres.test.mjs tests/fixtures/instance-release-inspector.mjs --max-warnings 0
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

## 1. 要交付什么

把“已初始化租户的一次固定sandbox成功部署”整理成可重复的版本更新能力：管理员选择**实例＋已验证的软件版本**，系统自动核对准确目标和变更，管理员在GitHub批准一次明确范围，程序更新既有服务、独立进行部署技术核验，再把可信结果写回控制面。

不是重做首次开通，也不是重新设计部署引擎。普通新客户自动开通、平台常驻控制器、买家Web整站升级、商家APK分发、数据库升级和正式上线安全收口仍是不同范围。

### 1.1 第一版明确支持的对象

- 组件：`tenant_api`，即买家端和商家Android共用的后端API镜像。
- 目标：已经登记、初始化且**实际运行中**的租户实例；首个技术验收对象仍是现有sandbox，后续实例使用同一数据合同注册，不再复制固定任务脚本。
- 变更：同一租户CFN栈的`ImageUri`参数，从一个准确ECR digest更新为另一个准确digest。
- 首条可执行路径：选择**已经发布到ECR**且有构建/自检证明的版本。不把新建镜像、数据库迁移和服务更新硬塞进第一条执行路径。
- 兼容能力：Express/Full数据库模式作为版本兼容矩阵，不在发布中切换模式；架构/端口/现有Secret版本引用保持。
- `aws_production`只能作为合同中的受控环境类型，初期不开放执行；sandbox验证通过不等于生产环境已获安装或上线许可。

商家APK无需在本流程中重装，买家Web产物保持原样；若新API要求同步更新客户端或数据库，它不是第一版可接受的“仅后端镜像更新”，必须阻断并另立明确发布范围。

### 1.2 完成标准与不夸大边界

第一版完成必须具备：真实版本目录、可信实例绑定、不可变发布请求、一次部署批准、受限CFN更新、独立技术验收、持久结果和可追溯失败处理；同一代码至少完成两次正常版本切换，第二次不改代码、不复制工作流、不新建固定实例分支。

先完成已有ECR版本的服务更新，再接入第12节的“候选构建产物晋升为ECR版本”。前者完成只能宣称**后端服务日常更新闭环完成**；后者也完成，才宣称**后端版本从构建到更新的日常流程完成**。均不代表整个SaaS自动交付完成。

## 2. 已有能力、复用点与现状

| 已有内容 | 本方案怎样使用 | 不能直接当成什么 |
| --- | --- | --- |
| 后端`backend-ci.yml`、`backend-image-candidate.yml` | 复用检查、容器构建、自检和候选产物证据 | 不把构建success当成ECR已发布或实例已更新 |
| 后端`backend-reviewed-ecr-publish.yml` | 保留已有精确产物晋升逻辑，第12节再适配稳定版本生产 | 不默认已有临时Grant长期有效，不自动改publisher权限 |
| [三栈基线](aws-deployment-baseline.md) | 确定资源归属及ImageUri更新边界 | 不把历史物理ARN、原模板SHA当作当前事实 |
| [`review.mjs`](../ops/deployment-baseline/review.mjs)的`imageChange`/`draftImageUpdate` | 复用准确digest、UsePreviousValue及绑定检查思路 | 当前函数仍绑定历史repository/参数/模板，不能原样充当通用执行器 |
| `lib/deployments/cloudformation/tenant-stack.ts`及已验证租户模板 | 复用TaskDefinition、Service的原生CFN关系 | 通用旧生成器含不同capacity provider、伸缩/清理设置，不能为更新直接重新生成整栈 |
| `lib/deployments/management.ts` | 复用实例/环境/产品识别及现有数据库访问约定 | `ensurePlannedAppInstanceDeployment`是首次部署计划入口，不是日常更新执行入口 |
| `app_instance_template_versions`、实例配置快照 | 继续表示产品模板/配置版本 | 不把它们当镜像版本号，不为镜像更新修改客户配置或历史模板版本 |
| 已验证的Review/RunOnce/Inspect与证据格式 | 复用准备、执行、独立核验的职责划分和安全原则 | 不复制冻结workflow中的历史job数组、固定源码/旧材料/旧批准到新发布 |
| `controller-v6`、现有GitHub App/派发能力 | 必要时复用单次请求与run绑定 | 不启动短Web窗口，不新增App或把App变成人工审批者 |
| 临时启停工具 | 继续独立执行用户要求的停用/恢复 | 不导入正式发布代码，不在更新中调用start/stop |

源码范围：控制面为`E:/NodejsProject/TechlongSoftware`，后端为`E:/NodejsProject/SpeedFeast_Backend_main`；商家工程`E:/flutter_project/speedfest_merchant`本次不修改、不测试业务。

最新**已存证据**是[11月13日停用成功回执](../ops/temporary-idle/stop-continuation-execution-20261113.json)：两ALB已移除、两ECS服务INACTIVE/任务0、两库stopped，三栈保留。本文没有重新读取AWS；这些证据用于说明历史状态，不自动成为下一次执行的实时快照。

## 3. 四条不可混合的边界

1. **部署状态和版本状态分开。** `STOPPED`不是版本错误，不能靠一次版本发布重建ALB、启动RDS或创建Service。返回`BLOCKED_RESTORE_REQUIRED`，AWS写入为0。恢复须用户另行批准，并读取恢复后的真实Cell输出/物理ID。
2. **资源归属不变。** 云资源仍由原CFN栈管理；发布程序只编排，不直接`ecs update-service`、`register-task-definition`或创建/删除ALB。
3. **日常更新和首次开通分开。** 不启用`createDefaultDisabledWorkerRuntime`的全局apply，不让旧plan_only任务被普通队列领取，不修改旧封存任务/触发器/批准/永久槽。
4. **技术验收和业务验收分开。** 代理负责代码回归、镜像/部署状态和技术健康核验；用户负责商品、登录、订单、卖家业务等体验。本方案不重复这些业务操作。

## 4. 用户操作与单次批准

第一版不开发新的发布管理UI。入口为一个正常的GitHub `workflow_dispatch`，输入只含`instance_id`、`release_id`和已配置环境；不允许输入任意栈ARN、镜像URI、AWS角色或脚本。GitHub Summary显示解析后的准确目标，结果写回控制面，可由CLI或现有数据访问层读取。

流程为：**选择实例和版本 → 自动准备摘要 → 本人批准一次部署 → 创建并机器审查实际Change Set → 执行 → 独立技术核验 → 回写**。

### 4.1 一次批准覆盖什么

- 准确实例/环境、源版本和目标digest、原栈UUID/模板/配置摘要。
- 规定范围的当前事实读取、控制面请求领取和证据写入。
- 至多一个UPDATE Change Set的创建及首次执行，正常CFN失败回滚、同栈旧任务版本托管清理。
- 同一发布的有界等待、独立技术核验和控制面结果回写。

不再把同一发布拆成三次人工Review/RunOnce/Inspect批准。实现方式是**只有一个有写能力的job绑定受保护environment**，它内部依序编排执行进程与隔离验收进程；不是再建三个同environment job并假定GitHub只会问一次。

这是新普通发布流程的设计，不修改既有冻结工作流或现有审批设置；新workflow、OIDC和角色范围先单独安装审核。GitHub环境门禁仍由用户本人批准，代理/App不代批。

### 4.2 审批前不能偷做云写入

为避免“展示真实Change Set前还要先批一次Create”的循环，第一版审批摘要明确展示的是**预期变更及机器限制**，而不是冒充已创建的真实Change Set。

审批前允许的常规准备范围要在安装时明确授权：AWS资源元数据读取、版本证据核对、控制面有限请求登记及GitHub artifact/Summary。**不创建Change Set、不推ECR、不更新服务。** 请求登记是控制数据库元数据写，不是“完全无副作用只读”；其函数权限必须单独受限。

实际Change Set在批准后才创建。机器必须证明实际变化落在原批准边界内才能Execute，超出边界只保存`REJECTED_CHANGE_SET`并停止；不扩大批准、不修改后重建或删除该CS。若用户将来要求亲眼看实际CS后再批准，会自然变成两次云写审批，不在本版默认流程中混用。

### 4.3 避免再次卡在人工衔接

- 准备快照和请求默认最多5小时，不再使用几分钟本地Web租约。批准前不领取执行租约、不占本地等待进程。
- GitHub门禁就绪后给准确run链接；摘要列环境、实例、源/目标版本、预计停顿、无数据库迁移、费用边界和原截止时间。人不需要核对几十个SHA，完整摘要仍供审计。
- 批准后重新读准确事实；源版本、模板、配置、实例归属或绑定变化则使本请求失效，不静默换目标。构建产物可复用，但必须新请求/新计划，不延长或重放旧批准。
- 直接手动派发与“禁止自身审批”设置可能冲突。未来先读实际设置；若已禁止自身审批，复用现有App单次派发、本人批准，不默默关闭该规则或扩大App仓库范围。
- GitHub排队、job超时和操作锁是执行安全时限，不是自动关机/删除资源的TTL。不得借本方案重新加入资源到期删除逻辑。

## 5. 版本目录：构建版本不再绑定某个实例

发布对象`SoftwareRelease`与客户模板版本分离。每个版本至少保存：

| 字段 | 约束 |
| --- | --- |
| releaseId、productId、component、displayVersion | component首版仅tenant_api；同产品/组件/版本不可覆盖 |
| sourceRepository、sourceCommit | 来源在配置白名单，commit固定；不以可变分支/最新tag解析最终代码 |
| buildRunId、buildAttempt、candidateArtifactDigest | 绑定准确成功构建及自检产物，不能只检查run标题 |
| imageRepository、imageManifestDigest、platformImageDigest | 固定仓库与架构，部署最终使用`repository@sha256:...` |
| runtimePlatform、applicationPort | 与既有TaskDefinition兼容，不在版本更新中改CPU架构/容器端口 |
| databaseModes、schemaCompatibility | Express/Full及当前schema兼容性；首版必须无SQL迁移需求 |
| clientApiCompatibility、startupEffects | 声明旧客户端可用，普通启动不自动执行建库、迁移或重新导入业务数据 |
| persistenceCompatibility | 上传文件不依赖将被替换的容器本地文件系统，或明确为不可正式发布的候选 |
| proofRefs、manifestSha256、status | `candidate`/`ecr_verified`/`revoked`，发布后不可修改digest或来源 |

tag只能用于人读；即使配置ECR tag不可变，执行仍绑定digest。已入目录的版本不得因tag移动而变成另一份代码。[ECR不可变tag说明](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)

不能混淆OCI索引digest与平台镜像digest：已有构建可能含provenance/索引。目录应保留索引→linux/amd64 manifest映射，验收时比较实际任务使用的平台digest；不能只因两个不同层级的digest不相等而误拒，也不能跳过映射验证。首版只支持当前明确的一个运行架构，不扩多架构发布。

原版本可以从已核验的既有digest导入目录，标明`observed_baseline`来源，不重建旧镜像。当前环境停止时只能记录“最后已核验版本/历史证据”，不能伪称存在运行中的当前部署。

## 6. 实例、请求与控制面最小数据模型

### 6.1 可信实例绑定

`InstanceBinding`从现有实例、环境、已成功部署outputs及可信提供者回执解析，包含准确account/region、栈UUID、Cell关系、服务/任务逻辑ID、允许镜像仓库、数据库模式、现有配置/Secret**版本引用**和基线代次。

输入实例ID不是授权。必须核对工作区/产品/订阅及操作员权限，禁止拿另一个租户的digest/栈输出冒充目标。不能由用户输入拼栈名、从全账号扫描猜目标，或把历史ARN当实时值。绑定不全、实例尚未首次开通、存在旧未决云操作时阻断。

物理ID只在一次事实快照中有效。日常流程从当前同栈CFN输出/绑定取实际TaskDefinition ARN及服务，不预测revision、不导入被临时工具创建的另一资源。

### 6.2 新域与旧封存账本隔离

建议在现有控制面PostgreSQL中使用独立`deployment_release` schema，只有三张职责明确的表；不是新建数据库服务或部署框架：

| 表 | 作用与关键字段 |
| --- | --- |
| releases | 上节不可变版本目录、构建/ECR证明、撤销状态 |
| requests | 请求ID、实例/目标版本、源版本、基线/配置/计划摘要、状态、GitHub run/attempt、准确CS ID/token、错误分类、证据引用和时间 |
| instance_state | `(instance_id, component)`当前已核验版本、上次成功证据、递增revision、当前请求/操作持有者；通过CAS避免覆盖并发结果 |

事件细节沿用现有私有证据存储/审计能力，按请求追加不可变对象，不再造第四套事件框架。只增加必要的唯一约束、索引及限定函数；迁移编号在编码时检查后确定，不覆盖旧迁移。

不为镜像更新改`app_instance_template_versions`、客户configuration_snapshot、套餐/订阅或业务status；不向旧封存deployment_jobs伪装写入另一种deploy，不放宽旧Always触发器或修改保护摘要。首期成功回写在新域完成，由现有管理数据层查询，暂不新增Web界面。

数据库首次安装、schema/授权/窄LOGIN凭据及Secret需求是一次性的独立安装变更，未来明确清单后另批。本轮不生成或应用SQL，不连接Neon，不把本机owner `.env.local`变成日常发布凭据。事务使用明确schema限定名及`SET LOCAL search_path=pg_catalog`，避免重现历史search_path差异误判。

函数默认使用调用方的窄权限；若确需SECURITY DEFINER，必须固定owner与search_path、全限定对象名、撤销PUBLIC执行并只授予准确函数，禁止任意动态SQL/对象名输入。安装者owner权限不能进入日常workflow。具体DDL与保护布局冲突检查在D2-2完成后另审安装，不把表模型建议视为已经具备行级隔离。

### 6.3 结果推进原则

- 请求意图先落库，再提交云写，不能反过来。
- 只有受信独立验收通过，才能以`expectedRevision＋expectedCurrentRelease＋requestId`的CAS更新当前版本并结案。
- 不把“选中版本”“GitHub run成功”“Execute返回ACK”当成“已部署版本”。
- 云已更新但控制面提交不明，保持`RECONCILIATION_REQUIRED`，不重做AWS更新；按准确云操作和证据修复记录时另给受审范围。

## 7. 状态、并发和断点处理

主路径：`REQUESTED → PREPARED → AWAITING_APPROVAL → CLAIMED → CHANGE_SET_CREATED → EXECUTING → VERIFYING → SUCCEEDED`。

| 结果状态 | 含义与允许后续 |
| --- | --- |
| NO_CHANGE | 源/目标已是同一已核验digest且配置一致，无CFN写；不是强制重新部署 |
| BLOCKED_RESTORE_REQUIRED | 环境/服务/依赖已停用或缺失，无恢复/更新写 |
| BLOCKED / REJECTED_CHANGE_SET | 资格/兼容/漂移不符或实际变化超界，不执行 |
| EXPIRED / REJECTED | 未执行的请求过期或人工拒绝，旧批准不能重用 |
| FAILED_ROLLED_BACK_VERIFIED | 受管回滚后已独立证明旧版本恢复，当前版本指针仍为旧版 |
| FAILED_NEEDS_INSPECTION | 回滚失败或运行/归属不符，保留现场，不自动清理 |
| RECONCILIATION_REQUIRED | 写提交不明、进程中断或云/控制面结果不一致，仅允许准确只读确认 |

GitHub concurrency按实例＋组件分组、`cancel-in-progress:false`；控制面再用同实例CAS/唯一活动请求约束。GitHub组不是数据库锁，也不是云端全局CAS。

审批等待不持有执行锁。首版批准后原子领取持久占用并记录操作token，以原事实writeBefore截止约束新云写，不新增心跳服务或可抢占lease；到期不意味着AWS操作取消或可被另一个执行者重新提交。存在准确CS或未知提交时不自动抢占重发；只读确认后再按明确规则结案。写入截止不等于资源自动到期，不会自动停库或删除承载资源。

写前保存本次唯一意图与参数摘要，创建/执行分别只首次提交；SDK/CLI云写不进行自动网络重试。只读状态轮询在同一批准中预先包含次数和总等待预算，不再每轮聊天另批。预算耗尽停止，不扩大目标、不换endpoint、不自动重建CS或重派run；不使用GitHub Re-run恢复有副作用阶段。

## 8. CFN更新合同：只更镜像，不修基础设施

### 8.1 写前检查

从准确原栈读取Original模板、参数摘要、逻辑/物理绑定和角色；核对当前Cell输出、租户参数、DNS/ALB/目标组引用、ECS服务及任务、ECR版本、固定Secret版本元数据。只有原模板声明与实际服务均运行、归属一致、没有并发CFN操作/其他可执行CS，才允许进入更新。

若环境STOPPED、服务不存在、数据库不可用、模板声明与服务数不符，返回阻断状态；不调用临时start、不改DesiredCount、不借REVERT_DRIFT修漂移、不补监听器/权限。恢复或基线修正仍是单独操作。

### 8.2 创建和机器审查

对同一准确栈创建普通`UPDATE` Change Set：`UsePreviousTemplate:true`，只为`ImageUri`提交新digest，其余参数`UsePreviousValue:true`。不换RoleARN、不加IAM capabilities、导入、嵌套、DeploymentMode或DeploymentConfig。不能使用旧通用渲染器顺便更新Spot/日志/TTL等设置。[CreateChangeSet合同](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)

预计只允许：

- `TenantTaskDefinition`：镜像导致的容器定义更新及正常任务定义替换/新revision。
- `TenantService`：引用该新任务定义，Service不替换，其余服务属性不变。

**TaskDefinition替换是正常现象，不能错误要求Replacement=False。** `ContainerDefinitions`变更的CFN语义就是替换；实际revision只能从CFN绑定读取。[TaskDefinition属性](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)

同时检查原参数请求、真实CS、候选模板/参数解析及受影响路径，不能仅凭“两个Modify”判断安全。网络、ALB、规则、DNS、目标组、日志、Secret引用、配置、角色、端口、CPU/内存、desired count等改变一律阻断。AWS字段表示必须依真实SDK合同建fixture，不再虚构DescribeChangeSet.RoleARN或非法DeploymentMode=STANDARD。

### 8.3 执行与受管回滚

Execute前再核对准确栈UUID、原角色/标签/更新时间/源镜像/未变配置及CS ID，不把CS响应中的不存在字段当角色来源。首次Execute后保存ACK并在原预算内等待；不直接更新ECS Service或另行注册TaskDefinition。

保留当前模板已有的ECS部署配置和正常CFN失败回滚，不在这次镜像更新中改变MinimumHealthyPercent、MaximumPercent、capacity provider或熔断配置。因此**不承诺零停机**；单任务配置可能中断，临时并行任务也可能增加短时费用。若要改变可用性策略，属于后续明确变更。

ECS熔断器可回到最近已完成部署，但不是每次失败都保证有可用回退版本，CFN与ECS回滚结果也必须独立核验，不能只看其中之一。[ECS受管回滚](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)

## 9. 独立部署技术核验与可信回写

在同一已批准job内，用新进程和资源只读身份读取真实状态；不从执行进程的成功布尔值或缓存推断。清除继承的写凭据，只授予验收所需资源元数据读及证据窄写；这是资源只读＋证据写入，不伪称整步无副作用。独立性是进程/凭据/事实重读的隔离，不冒称独立审计组织或绝对防篡改。

最小通过条件：

1. 原栈完成、准确CS已执行；模板保持，唯一镜像参数正确，原角色/标签/不相关参数保持。
2. CFN实际TaskDefinition与Service指向一致；任务定义镜像和运行中任务`imageDigest`按架构映射匹配目标版本，无旧digest被误当新版本。
3. 服务desired数保持，running达到原目标、pending为0，主部署达到COMPLETED；无意外替换服务/网络/目标组。
4. 原ALB/目标组/监听器/API DNS物理绑定保持，目标健康；旧Cell/平台资源没有被本次发布更新。
5. 仅对既有技术端点执行有界健康/就绪检查，不登录买卖家、不查询订单、不发送支付/消息/推送/打印，不为测试放宽HMAC或认证。
6. 若技术端点需凭据，使用事先批准的准确窄凭据/路径；缺失则明确HTTP未验并阻断相应成功条件，不读取客户端HMAC来凑探针、不暗加公开旁路。

结果证据写到既有私有证据存储的本请求前缀，使用不可覆盖写入和准确版本/内容SHA引用；GitHub artifact/Summary是展示副本，不是唯一权威。证明绑定requestId、runId/attempt、源码、源/目标版本、栈UUID、CS/TaskDefinition实际ID和独立检查时间，防止借用另一次成功。

回写先保存准确结果证据，再用窄控制面函数按CAS标记SUCCEEDED并推进instance_state。若数据库回写失败，不重新部署；保留已发布digest及证据，进入reconciliation。只读观察可以多次授权执行，但旧apply槽不复位。

## 10. 图片、数据库与应用启动：实际更新前的硬门槛

旧租户渲染代码仍披露`sandboxEphemeralImageStorage:true`、`persistentImageStorageReady:false`，后端镜像中也有本地`/app/images`目录；这不是本轮现况扫描，但足以要求真实发布前确认上传文件持久化。不能把替换容器说成天然“不影响数据”。

- 数据库在独立RDS中保留，不代表容器本地上传文件也保留。
- 如果运行实例仍有唯一文件存在容器内，实际更新必须阻断；最小图片迁移/S3落地另列范围和批准，不在本方案偷偷迁移。
- 可先完成发布模块/无AWS回归；sandbox若使用无业务文件的专用技术样本，必须准确披露限制并获验收范围批准，不能借此宣称正式数据安全问题已解决。
- 首版版本必须兼容当前schema，启动不应自动建库、导数据、迁移或切换DB模式。镜像入口/命令以及候选自检需证明这一点；声明“无迁移”不是充分证据。
- 不运行migration镜像、不设置数据库密码、不转存业务数据、不改变支付/邮件/推送配置。涉及schema或共享HMAC安全整改的版本另立发布类别，不让本更新器扩大为迁移引擎。

## 11. 权限与一次性安装，不再每发布临时Grant/Revoke

正式重复发布不应每次都由Source刷新、手工Grant/派发/Revoke才能前进。建议一次性受审安装最小常规身份，之后由GitHub OIDC换取短期凭据；不在仓库保存长期AWS key。[OIDC与AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)

| 身份 | 可做 | 不可做 |
| --- | --- | --- |
| 准备身份 | 已登记目标的AWS元数据、固定窄控制凭据、受限SQL请求登记与版本查询、摘要产物 | CFN创建/执行、ECR推送、修改实例当前版本、读取owner凭据 |
| 发布身份，受本人environment批准保护 | 准确既有租户栈的Create/Execute及必要读取、执行请求领取/结果提交 | IAM/Secret写、RDS/ELB/EC2直接写、任意栈/仓库操作、任意命令输入 |
| 验收身份 | 准确资源读、固定前缀证据窄写、受限验收结果登记 | 更新服务、执行CS、推进另一请求或另一实例 |

优先评估现有角色/Secret能否在不扩大错误边界的情况下复用；过宽或不足则列准确新增/调整清单，包含数据库函数授权、Secret/KMS固定引用、角色trust/边界、GitHub可见仓库和费用。**这些安装均须另批，本方案不授权，也不承诺现有角色已经够用。** 普通用户工作流不得使用本机owner `.env.local`。

IAM条件使用AWS实际支持的OIDC aud/sub和准确repo/ref/environment；源码/可复用workflow固定版本由GitHub保护及代码/证据校验落实，不凭空发明AWS未支持的claim条件。许多Describe/List接口不能仅靠资源ARN做到细粒度限制，必须如实列出并用请求目标白名单/返回ID核对补充，不把软件校验冒充IAM隔离。

GitHub App当前可访问哪些仓库并未在本轮在线核对。跨仓库读取构建证据或触发后端构建若需要新权限，单独确认，不能把App改成“所有仓库”或给它environment批准权。

## 12. 构建与ECR发布怎样接入，而不再做固定发布材料

### 12.1 先打通已有ECR版本

把现有已发布镜像及其真实来源/CI证明导入版本目录。管理员选择releaseId即可更新，不再输入镜像URI、改固定JSON或复制当前sandbox的job/source数组。

### 12.2 再接入正常版本生产

后端现有云构建产生候选镜像、自检结果和不可变产物引用，输出通用SoftwareRelease候选，不包含目标实例/租户秘密。产品构建一次，可供多个已登记实例分别选择；实例配置留在运行时Secret/既有模板中。

如果选择的是未晋升到ECR的候选，同一部署批准必须额外明确准确候选字节、仓库和晋升范围；受保护job先复用已有发布器晋升这一份镜像，回读ECR原始manifest/digest并核对，才允许创建CFN CS。改变/多出的digest或自检不通过则停止，不选另一个镜像补齐。

镜像层上传可能涉及多次AWS API，不可把“发布一份镜像”记成“只写一次API”。范围上限以准确仓库/一个候选镜像/产物摘要、会话权限与job预算声明；CFN仍严格一Create/一Execute。镜像发布成功但部署失败时保留该不可变镜像和失败请求，不自动删ECR或重建实例。

已有跨仓库发布workflow若仍单独审批，不能声称当前已经合并门禁。优先让后端独立生成候选、部署仓库读取可信产物，不强求新增跨仓库写权限；完成受审发布器和身份适配后，才启用同一job的晋升＋更新。MVP的已有ECR路径不因此被阻塞。

## 13. 失败与回退的最小处置矩阵

| 失败点 | 必须记录 | 不做什么 |
| --- | --- | --- |
| 构建/版本证据或资格不符 | BLOCKED及准确原因 | 不申请更大权限凑通过、不写运行环境 |
| Create返回不明 | 准确name/token、提交意图和已知ACK | 不再次Create；只查准确对象 |
| 创建成功但实际变更超界 | 保存准确CS/差异并REJECTED_CHANGE_SET | 不Execute、不删除或重建CS |
| Execute返回不明/runner中断 | 既有CS、run/attempt、提交意图 | 不重发Execute或Re-run；准确Inspect后处理 |
| CFN/ECS受管回滚 | provider状态及旧digest独立核验 | 不把回滚完成标成新版本成功 |
| 镜像已运行但HTTP/归属不符 | FAILED_NEEDS_INSPECTION、实际digest/健康证据 | 不自动再次部署旧版或更改基础设施 |
| 证据已写、控制面提交不明 | RECONCILIATION_REQUIRED及证据固定引用 | 不重新部署，也不复位请求 |

主动回退是新的明确版本更新请求：从当前已核验版本选择上一兼容、未撤销digest，再走同一批准/CFN流程；不是复用旧批准或依赖旧TaskDefinition ARN。CFN可能注销/清理旧revision，应以旧镜像与配置证据生成新的受审更新，不承诺旧revision始终可用。数据库down migration和故意制造线上失败均不包含在首版。

## 14. 建议代码落点：薄业务层，复用执行组件

合同/计划在D2-1、状态/适配在D2-2、更新/核验在D2-3离线交付；D2-4工作流/接线已编码且默认关闭，不代表已接入生产：

| 落点 | 职责 |
| --- | --- |
| `lib/deployments/releases/contract.ts` | 版本、请求、实例绑定与结果状态；不内置真实固定job |
| `lib/deployments/releases/planning.ts` | 源/目标版本、运行资格、纯CFN ImageUri变更计划 |
| `lib/deployments/releases/repository.ts` | 三表/窄SQL函数访问、CAS与结果查询，复用现有数据库端口 |
| `lib/deployments/releases/update.ts` | 调用现有CFN/证据适配器，创建→严格审查→首次执行，不实现另一套部署引擎 |
| `lib/deployments/releases/inspection.ts` | 独立事实核验、证据与结果分类，不业务验收 |
| `.github/workflows/instance-release.yml`及必要的固定版本reusable job | 普通参数入口、一处人工environment门禁，不复制历史实例材料 |
| 对应`tests/instance-release-*.test.*` | 合同、计划、真实SDK、状态/并发及结果回写回归 |

若现有适配器只接受某固定job或“只删资源”的临时范围，不能直接放宽它的安全边界以兼容发布；从现有正式CFN端口复用序列化/客户端/证据逻辑，增加当前产品明确的ImageUri更新合同。临时节费工具不导入、不改造；冻结历史入口不重写成泛用入口。

## 15. 分步交付与停止点

| 阶段 | 交付物 | 通过标准 | 云/安装边界 |
| --- | --- | --- | --- |
| D2-1 合同与纯计划（离线已完成） | SoftwareRelease、InstanceBinding、请求/状态合同；digest/兼容/STOPPED/仅ImageUri planner | [交付记录](#d2-1-delivered)：88项相关回归、lint/类型通过；仅纯计划，不授权live | 无SQL/配置/凭据读取、AWS/工作流变更；线上能力仍未接线 |
| D2-2 状态与适配（离线已完成） | 三表/七函数与窄授权草案、请求CAS、CFN/证据注入适配 | [交付记录](#d2-2-delivered)：新增17项合同模型/真实SDK内存回归，总105通过；原生PG行锁/ACL未验证 | 草案未应用；安装前隔离PG验证，实际DDL/角色/Secret/IAM/GitHub另审 |
| D2-3 已有ECR版本执行闭环（离线已完成） | executor、单独inspector入口、可信回写、NO_CHANGE/失败分类 | [交付记录](#d2-3-delivered)：不同实例/不同ECR版本、真实SDK内存模拟；相关123项本地通过，常规无AWS CI独立记录 | 不在线更新/启通用worker/写旧账本；生产采样、新进程身份接线及原生PG安装验证仍另审 |
| D2-4 单审批工作流（代码完成/未启用） | 普通入口/摘要/准确run计划、一个受保护job、真实采样/隔离进程接线 | [交付记录](#d2-4-delivered)：14新增/137相关本地回归，真实子进程及默认关闭验证；无AWS CI/临时PG16结果独立记录 | runtime关闭；安装身份、生产读取及真实写分别批准，不自动调度 |
| D2-5 正常版本生产接入（已有ECR与同审批晋升代码/CI完成） | 构建产物→候选release→同门禁内单app晋升/ECR原文验证→窄目录确认→原更新器 | [具体边界](aws-instance-release-promotion.md)：171回归＋9原生PG16，准确原件/派生规则固定，不伪造digest；真实生产采集/登记/晋升未执行 | 原唯一environment，未改旧两镜像发布器；新增SQL/身份尚未安装，runtime关闭，实际发布仍另审 |
| D2-6 受控真实技术验收 | 一次明确恢复后两次独立正常版本切换，完成持久回写 | 第二次不改代码/复制workflow，单次发布一审批；实际镜像/归属/健康/记录一致 | 恢复/在线读/安装/每次发布及后续停费分别有明确授权；不执行买卖家业务测试 |

最快顺序：D2-1→D2-2→D2-3，离线把整轮材料与失败分支备齐；再D2-4，已有ECR版本可先安排真实验收；D2-5不要求重写既有构建器。具体阶段以可运行交付为单位，不把一项实现拆成许多聊天审批，也不承诺一段固定时间能完成尚未核对的外部权限。

### 15.1 必要测试清单

- 版本同名不同digest、撤销版本、错误产品/实例/工作区、未完成首次开通、旧客户端/DB模式不兼容均拒绝。
- STOPPED/缺少Service/缺少ALB/DB不可用/未决旧操作全部AWS写0；NO_CHANGE为0云写。
- 参数只改ImageUri，其余UsePreviousValue；误改Secret/desired/network/角色/DNS/规则拒绝。
- 真实SDK序列化/反序列化和内存HTTP handler贯穿完整执行路径，不只测试局部shape函数；覆盖缺失RoleARN、普通DeploymentMode缺失、TaskDefinition替换、OCI索引映射等真实表示。
- 创建ACK不明、执行ACK不明、控制面提交不明、artifact不匹配、验收失败、回滚失败均不会发起第二次云写。
- 同实例并发最多一写者、另一个实例不串版本；旧lease/token不能推进新请求，过期请求不复用批准。
- 镜像运行但验收失败不能提前推进currentRelease；云已成功但回写失败只reconcile，不再发布。
- 长审批/runner排队不依赖本地短租约；批准前无CFN/ECR写，只有一个部署environment门禁。
- 输出/日志不含凭据、HMAC、私钥、业务记录或完整环境正文，使用带敏感canary的合成数据做泄漏回归。

### 15.2 真实验收怎样控制时间和费用

环境现在保持停止。代码/无AWS CI/候选材料完成前不恢复。实际恢复继续使用已有工具，经用户明确批准；不改该工具，不把恢复藏进release。

真实验收先备好两个无迁移且持久化安全的版本、回退证据、单审批run入口及结果写回权限，再恢复。正常切换可采用A→B、B→A（第二次是新请求），或A→B→C；失败分支在线不故意注入，优先本地模拟。用户无须再登录买卖家或配合Web短窗口。

保留每次更新的明确执行/轮询预算、准确费用风险和失败处置，但不新增资源自动到期；完成后是否停用由用户决定并另批现有工具。CFN滚动更新可能短时并行任务，原ALB/RDS正常运行仍计费；50USD/月只是目标，不是硬限额。新增Secret、日志/产物存储和GitHub运行分钟如不可复用，安装审批前再给实际资源清单和公开价格估算，本轮不假装已算出实际账单。

## 16. 上线本功能前必须另审的事项

1. 控制数据库三表/函数/窄权限与Secret引用的实际安装范围；旧保护布局不能被绕过。
2. 准备/发布/验收身份是否复用，以及精确IAM/OIDC/GitHub环境和跨仓库权限变更。
3. 当前实例恢复后的真实CFN/ECS/ECR/参数/Secret版本元数据与上传文件持久化状态。
4. 若增加ECR晋升，准确候选产物、仓库、授权及同轮失败留存策略。
5. 每次真实发布的实例/版本/配置摘要、正常CFN回滚和技术核验/回写范围；不沿用旧SHA。

以上是后续实施的审批边界，不要求现在逐项回答。**D2-1至D2-4代码/离线交付已实施，启用关闭；下一只准备一次性精确安装范围，不自动应用生产SQL、改权限、启动环境或派发实际部署。**

## 17. 官方依据与证据边界

- [GitHub部署审批](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)：门禁释放job；使用能力受仓库/套餐/设置影响，实际配置安装前另查，本轮不修改。
- [GitHub OIDC对接AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)：短期身份与人工批准是两个不同控制点。
- [CFN CreateChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)、[DescribeChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)：真实请求与返回合同，不能由合成fixture臆造字段。
- [CFN ECS TaskDefinition](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)、[ECS Service](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-service.html)：任务版本与服务由原栈关联管理，不能把替换任务版本误认为重建Service。
- [ECS部署熔断](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)：受管回退有前置条件，不等于代理可以自动另发回退部署。

这些资料与本地源码支持设计，不证明完整正式交付已实现、角色已安装、环境已运行或目标版本已实际发布。顶部明确区分D2-1纯计划、D2-2端口/草案与D2-3离线闭环；没有AWS调用、生产数据库连接、私密配置/Secret/PEM读取、安装或业务验收。
