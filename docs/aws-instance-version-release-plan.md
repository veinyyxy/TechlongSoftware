# 缺口2：日常版本发布与更新详细实施方案

日期：2026-11-17，America/Winnipeg。状态：`D2-6 CODE/CI COMPLETE / FOCUSED READ STOPPED AT SOURCE — NO REAL PUBLICATION OR REGISTRATION`。

已交付代码、一次性身份安装及本轮两次真实app构建，以各自最新准确回执为准，不把原设计或离线验证当实际部署完成。本文其他待审范围不是新增生产读取、SQL/Secret/IAM修改、ECR发布、部署调度或AWS操作授权。执行以[主线手册](aws-auto-deployment-execution-runbook.md)为准；启用配置仍关闭，不启动收费环境或自动派发。

最新D2-5接线：[具体来源采集与受审目录命令](aws-instance-release-import.md)已完成代码/准确无AWS CI（164回归＋8原生PG测试）；用户选择仅代码与CI，真实采集/登记未执行。同审批自动晋升现为明确后继需求，不再按“可选”跳过，但不扩大这轮已有ECR路径或提前发布。

当前按用户新要求补[同审批候选晋升](aws-instance-release-promotion.md)：同一environment批准候选原件与更新派生约束，job发布一份app、回读ECR并窄目录确认，再复用原CFN/独立核验/回写。原件、实例和范围固定；审批前不编造digest。只代码/增量SQL草案/CI，未安装、启用或实际发布。

该代码收尾已完成：[CI43561305617](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43561305617) 对应2659d7a，171回归＋9原生PG16全过/无skip。只证明合成来源/命令和隔离数据库，不是实际ECR晋升或部署已开启。后继仍需真实候选准入、必要身份/SQL安装及两次正常技术更新验收，不重复业务测试。

一次性启用按[总清单第30节](aws-instance-release-activation.md#30-新一轮七项只读全部通过一次性身份安装正式收口)及[最终回执](aws-instance-release-identity-installation-accepted-20261116.json)正式验收通过：四CFN栈13身份资源、两已知SQL提交、四LOGIN独立认证、原目录/权限、新IAM和原三栈保护证据全部闭合。五Secret/两SQL不重做，不重装IAM或重复身份核验。runtime仍关闭，下一只按原D2-6准备真实版本/准确初始实例绑定及运行配置，实际读取/构建/登记/恢复/发布仍另审；不将身份收口当两次真实更新或全部D2完成。以下执行卡保留阶段沿革，不重做D2-1至D2-5。

<a id="d2-6-readiness"></a>

## D2-6当前执行卡：先备齐，再一次恢复、两次正常更新

**最新结果覆盖历史待批：** [第16节](#d2-6-publication-catalog-observed)/[实际回执](aws-instance-release-initial-publication-observed-20261117.json)已按准确外层批准完成A单app发布、真实manifest核验及A verified/B candidate两行登记/独立回读，约7分11秒、dispatch1、配置1/TLS2/SQL52。引导review已关闭，daily runtime仍关，未恢复环境或写绑定；真实更新仍0/2。下一只准备原步骤4的必要恢复/持久化兼容证明/初始A绑定/runtime集中范围，实际新读取和写入另审，不再发布A或登记A/B、重装身份/扩工具。B产物原到期11月18日16:45:19Z，扫描/事实期限不延期。

**2026-11-17当前唯一动作覆盖下方历史“下一步”：** [第13节](#d2-6-bootstrap-implementation)的最小入口及准确CI已完成，源码b1e1ebd/[CI44139556595](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44139556595)成功：Linux239＋隔离PG16十项全过/无skip，lint/类型通过；[结果](aws-instance-release-bootstrap-code-ci-20261117.json)。两处代码接线不再是缺项，不重复实现/回归或重装身份。初始发布review与daily runtime仍关闭，生产读取/私密原件/发布/登记/恢复0；本轮到此收尾。下一仅回到同一集中草案更新新代码指纹并另审必要当前事实与真实操作SHA，不提前启动环境、重构建A/B或扩支线，真实更新仍0/2。

**当前实际结果（取代下方早期轮次状态）：** [新g/h/i核对](aws-instance-release-activation.md#11-d2-6真实app原件与neon核对完成aws部分事实保留)已完成真实app原件校验、STS1/AWS元数据55和另批剩余Neon READ ONLY22条查询；保留两次停止和新续段，未重复成功读取或产生远端写入。下一只收口第二个原CFN角色详细策略缺项及一次性启用准确清单，不扩框架；图片持久化缺项另列准确范围，不混入版本更新。runtime仍关、两次真实更新仍0。机器事实见[回执](aws-instance-release-d2-6-readiness-observed-20261114.json)，以下旧轮次“仅离线/未读”不覆盖本次批准结果。

**后续j补核已完成：** 另准STS1＋IAM5取得准确原租户CFN角色/唯一boundary，角色ID/信任/策略ID/v10及规范摘要均与正式基线匹配，[回执与安装参数状态](aws-instance-release-d2-6-role-supplement-20261114.json)。该角色不再是待读缺项。现只离线收口必填UploadBucketArns与现有持久化门槛：模板仍local、没有已验证S3绑定，不伪填、不改发布门槛或模板，不重复整批生产读取；一次性安装SHA仍为空，runtime仍关，事实原截止不变。

**持久化前置方案已备：** [最小方案与执行边界](aws-instance-release-persistence-plan.md)，只拟独立五资源S3/CloudFront/OAC图片栈、原IAM窄差异及四个环境值。无需改当前后端镜像、Express绑定或发布合同；旧图迁移必须另有准确来源/行清单。下一只离线候选与必要回归，未建桶/修改配置或新增真实读取许可，UploadBucketArns和verificationSha256仍未绑定实际输出。

最新代码前置（2026-11-14）：用户已另准仅修三处运行ARN校验及现有fixture/回归，修正源码7c80b9817bb95d2607b9adbe96a7641a8cee7b01的[准确CI43602498436](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43602498436) attempt1 completed/success，180 Linux回归＋9原生PG16全过/无skip，lint/类型通过，[回执](aws-instance-release-runtime-arn-fix-ci-20261114.json)。handoff两处与sampling一处均已改为标准冒号，旧斜杠拒绝，其他条件及默认关闭不变。本次未做此前被选择“只离线准备”的在线补核，未安装/启用或恢复；本轮到此收尾。下面“未改运行代码”的表述属于原离线准备轮，不覆盖这次明确批准且已完成的最小修复。

本节是原第15节D2-6的执行细化，不另建阶段体系、运行工具或工作流。首个对象仍为`app_e897a4377bce498b9c5ee9e64509dcad`的tenant_api，账号402010193138/ca-central-1；用户负责业务验收，代理只做部署技术核验。本轮只有离线材料和合成重现，无新的AWS/GitHub生产读取、私密读取、SQL、凭据生成、安装、恢复或dispatch。用户对STS1/元数据16最小补核选择了“本轮只离线准备”，因此该提案未执行，也不延用旧许可。

### 1. 开跑条件与当前缺项（只收口主线）

| 必要项 | 当前已知事实 | 最小完成方式 |
| --- | --- | --- |
| 真实Secret ARN可被现有运行入口接受 | 两模板五参数及三处运行校验/现有fixture均已修；准确CI成功 | 新3项回归和原整轮/隔离PG回归通过；仅格式/代码验证，不等于真实Secret已创建或权限已生效 |
| 一次性运行身份 | 四LOGIN、五Secret、四IAM角色/四策略及已提交promotion增量已按原合同安装并独立验收通过，见最终回执 | 不再重装或重复读取身份；runtime继续关闭，后续启用按真实版本/绑定和准确范围另审 |
| 真实版本及可信实例绑定 | 已存app原件/验证代码保留，尚未登记两个合格不同digest版本和准确初始绑定；04:08Z已准只读曾确认三release表为空 | 先复用仍合格的已存证据，过期产物/扫描列缺项；按原目录端口准备真实版本A/B及绑定，不用旧ECR标签、过期扫描或合成SHA代替证据，新采集/构建/登记另审 |
| 可运行的准确目标 | 本轮三栈UPDATE_COMPLETE、资源7/12/3，但未读实际ECS/ALB/RDS运行或DNS；历史两库available不充当前值 | 材料与身份齐备后，另批原启停工具的必要恢复；CFN所属资源只经CFN，使用新实际输出/物理ID核对引用，不在release中恢复 |
| 图片持久化 | 五资源图片栈与原IAM/idle租户S3四值接线已有[独立记录](aws-instance-release-persistence-wiring-installed-20261115.json)，不再称模板仍local；本轮未新查运行任务或迁图，完整持久化门槛仍须按证据判断 | 复用已装接线，不重建图片设施或放宽PERSISTENCE_NOT_READY；只列真实缺项，必要新操作另审，不夹入只改镜像的release |
| 单审批入口及回写 | instance-release.yml和独立verifier已有准确无AWS CI，runtime.json仍false/environments={} | 按真实版本/Secret固定版本/资源清单准备受审运行配置及种子；不把旧业务ready记录改成当前release成功 |

本轮新事实只到2026-11-15T00:18:33.301Z（温尼伯11月14日18:18:33.301 CST），不延长旧快照；三个旧Secret固定版本与Source组策略已核对，第二个原CFN角色已由j单独补齐；DNS/ECS/RDS本轮未读。原包到期2026-11-15T19:07Z不能续元数据时效。未来只另审明确缺项，不再整批无差别盘点或借旧available推断当前数据库状态/启动原因。

### 2. 三处运行校验的离线证据及最小范围

仅合成内存输入已重现：标准冒号ARN分别被现有控制库配置、publisher配置和采样绑定拒绝，错误为`RELEASE_DATABASE_IDENTITY_REJECTED`、`RELEASE_PROMOTION_ACTIVATION_INCOMPLETE`、`RELEASE_SAMPLING_BINDING_REQUIRED`。采样API mock调用数0，没有生产访问。源码位置：

- `lib/deployments/releases/handoff.ts`两条Secret前缀检查。
- `lib/deployments/releases/sampling.ts`一条应用Secret前缀检查。
- 现有`tests/instance-release-workflow-fixture.ts`仍构造斜杠ARN，解释了为何原合成回归没有覆盖真实格式；对应workflow/production现有测试需切标准fixture并覆盖旧格式拒绝。

原离线准备轮未改这些运行代码或fixture。后继已另获用户同意并仅修三处、同步两处fixture字符串及新增3项现有测试：不兼容接纳错误旧斜杠，不放宽账号/区域/版本/用户名/角色分离/默认关闭；未用原五处模板修复授权代替新批准。通过现有无AWS CI后收尾，不顺便改Route53运输、安装器、策略或启停工具。

### 3. 实际执行顺序（均未获本轮执行许可）

1. **不开运行环境，先闭合入口/身份/证据。** 完成上述最小代码修复；既有四栈/两SQL事务和准确Secret版本按总清单受审安装，独立核验后再准备目录/实例种子与运行配置。需要的backend token供给/仓库范围/有效期由用户明确，不复制本机Git凭据上云，不新增刷新服务。原schema/grants不重放。
2. **准备两个真版本A、B和回退证据。** 优先A→B→A，第二次是新请求、新run和新GitHub批准；只有A、B均合法登记、digest不同且兼容/持久化证明齐备才采用。A来源未闭合时不伪造基准，也不自动扩大为三个版本或改应用代码。最新构建无artifact，不能生成虚假可执行晋升SHA；新build/下载/发布分别按具体范围确认。
3. **再仅恢复验收必需依赖。** 复用现有工具，不重写；只恢复该tenant API需要的Cell ALB/监听器/租户服务等及确有必要的数据库运行状态，具体数量/新物理ID/权限差异按当时清单确认。不为GitHub审批启动平台Web或独立prod库，不默认全环境恢复；不新增自动到期/清理。恢复后用实际事实建立ImageUri之外的配置基线，确认/health、/ready技术核验可用。
4. **第一正常更新A→B。** 复用原工作流三输入：instance_id=上述实例、release_id=已登记B或其候选ID、environment=sandbox。新run先准备，用户本人只批准该run一次environment；原受保护job内按批准路线晋升准确单app（若目标为候选）、ECR原文核对、仅ImageUri变更集、执行、独立进程核验、CAS回写。源码/版本/配置/兼容和原期限均固定，无Web页面批准步骤。
5. **第二正常更新B→A。** 第一条必须真实SUCCEEDED/回写/释放占用后，使用相同代码/工作流/运行配置发起新请求；重新取实际源版本与revision，不复用第一条计划/SHA/领取token或旧事实。第二次只换选择的已登记release_id，再由本人批准一次environment。不得以NO_CHANGE、Re-run、仅更新账本或重放首个请求充数。
6. **结案及独立停费选择。** 两次均核对镜像平台digest、CFN归属/参数、原服务数量/健康、配置/路由/Secret固定引用保持，S3固定版本证据与请求/run/plan一致；当前版本回到A、revision比初始增加2、无活跃请求，才记D2-6通过。若失败/未知，保留真实状态，不二次apply或为了完成验收自动回滚。两次结束后先回报结果，停费由用户另批既有工具；不启动守护或自动删除。

恢复与身份/版本登记不是日常更新中的隐藏动作。材料、权限或图片持久化不满足时，不以“专用测试”口头绕过既有持久化硬门槛；如需最小S3/证据准备，先列准确范围另审。正式数据安全、客户端业务和全SaaS上线不计入本阶段成功。

### 4. 交付与停止规则

原离线准备轮交付为本节与启用总清单的对应关系，没有安装SHA、版本ID、请求ID或真实验收结果。三处运行修复现已另获明确批准，完成准确CI后只收尾；仍没有新的生产读取许可，不继续补核或要求刷新Source。后续两次真实run都必须用修复后同一份准确源码及对应CI，不能把501b7f1的模板修复CI冒充运行修复已验证；模板/SQL/工作流和runtime.json本次保持不变。

<a id="d2-6-offline-inputs"></a>

### 5. 2026-11-17离线集中输入：真实A/B、初始绑定和关闭态配置

本小节是原D2-6的材料收口，不新增阶段、工具或工作流。机器材料为[`d2-6.prepared.json`](../ops/releases/d2-6.prepared.json)；它是含明确缺项的准备信封，不是可导入的`SoftwareRelease`、`InstanceBinding`、SQL种子或执行清单。`executionAuthorized=false`、`readyForInsert=false`，未知字段保留`null`。本轮只读源码及已封存的必要元数据/原件，重新计算本机ZIP、image archive和receipt摘要；未读取任何新凭据或生产状态。

#### 5.1 可复用与不可充作当前值的证据

| 对象 | 已存真实值/证据 | 本轮结论与缺项 |
| --- | --- | --- |
| 一次性身份 | [四栈13资源、两SQL、四LOGIN及独立核验结项](aws-instance-release-identity-installation-accepted-20261116.json) | 已完成部分不重做；历史验收不是未来调用或当前健康授权 |
| 旧声明镜像A0 | ECR root `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`；后端源码`10fe3c41…`、run38803364109/attempt1 | 只有历史manifest/tag，原构建ZIP未证明，不能直接登记为受信A/currentRelease |
| 已存app候选 | 后端源码`b9ca2138…`、run43630231572、artifact14128140862；ZIP与archive现重算均匹配原SHA | 原包2026-11-15T19:07Z到期，扫描DB2026-11-14T13:05:54Z＋48小时也已过期；只能追溯，不以旧`now`重新验证或改日期 |
| 候选镜像digest | config为`sha256:c894fe72…`，原receipt明确尚未发布ECR | config digest不是registry root/platform digest；A/B的releaseId、root/platform digest仍为空，不伪造版本 |
| 图片接线 | [已装S3/IAM/idle task四环境值](aws-instance-release-persistence-wiring-installed-20261115.json)，桶`techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad` | 不重建图片设施；旧图来源/迁移和完整持久内容路径仍未证明，`verificationSha256=null`，不得拿接线回执SHA冒充全门槛 |
| 实例/原栈定位 | instance`app_e897…`、workspace`ws_ac46…`、product`prd_restaurant_order_system`；原三栈精确UUID保留在JSON | 历史active/业务deployment ready不等于release绑定；历史idle模板SHA`dab17b24…`不能用作恢复后运行模板/配置摘要 |

已存候选继续遵守原校验器的产物到期与扫描48小时规则，不与用户选定的“准备快照5小时”混用：5小时是新事实准备上限，不延长artifact、扫描、运行请求或旧事实的期限。后继优先寻找确实合格的已有版本证据；没有才单独审批正常构建/发布，不为凑A/B增加应用功能。重复构建同一源码不保证不同digest，不能只改版本标签冒充两次更新。

#### 5.2 初始绑定的真实输入与缺项

目标不变：`tenant_api`、account402010193138/ca-central-1、`env_aws_sandbox_ca_central_1`。历史task端口3000、数据库`techlong-sandbox-express-d001`/`express_iam`；准确原tenant/Cell/platform Stack ARN、zone/API域名及两应用Secret固定版本引用均直接复用保存到准备JSON。**没有读取Secret正文或复制HMAC。**

当前不能执行种子，尚缺：

- 合格的A目录原文与ECR root/amd64平台证明；实际运行镜像必须等于A。B可为已核验ECR版本或合格候选，不能用过期候选。
- 来自初始化/兼容记录及受审产品策略的真实`schemaVersions`、`clientApiVersions`，以及A/B不迁移/不启动写入的明确声明；fixture的`schema-v1`/`v1`不能默认套用。当前Express环境不自动证明Full兼容。
- 完整持久化证据；已安装桶和接线不等于迁图/内容可持续可用。不新做买卖家业务测试、不借此扩媒体工具。
- 另批恢复后的真实Cell输出→tenant参数映射、物理ID/路由/Secret固定引用、稳定服务/健康和ImageUri之外的配置。用原`releaseRuntimeDigests`派生运行模板/配置SHA，不手算替换、也不引用旧ALB ARN。
- 另批新鲜控制库状态核对后才确定首次种子revision（新行确实不存在才为0）、当前版本和active_request；不把旧空表证明当作现在仍空。由受审管理员进行一次准确目录/绑定登记，运行角色不新增自注册或表DML权限，不重放schema/grants/promotion/password SQL。

**初始A的依赖不能隐藏：** 如果A0原件无法合格，需先获得合格A，并另批一次原CFN栈的初始ImageUri对齐，使真实承载运行A，之后才可绑定。它不是A→B或B→A任一次验收。现有启停工具明确`noImageChange`，本轮不改该约束、不把镜像变化夹入恢复；日常更新也不能在未绑定/idle实例上代替初始化。此处只标明准确依赖，未新增初始对齐执行器、清单或云调用；未来可先准备停用栈仅TaskDefinition镜像差异，再单独审核执行及正常恢复，不预判Change Set实际内容。

#### 5.3 可检查但不会生效的关闭态运行配置

[`d2-6-runtime.disabled.json`](../ops/releases/d2-6-runtime.disabled.json)按原`ReleaseRuntimeConfig`字段填入实际已安装四角色、五Secret ARN/固定VersionId、四窄用户名、GitHub仓库/环境/人工reviewer ID、immutable OIDC subjects和ECR来源。S3 prefix固定`instance-releases`，与既有IAM的`instance-releases/release_*`和`instance-releases/promotions/…`一致，不使用测试fixture的prefix。每快照40项元数据是候选运行配置预算，不是本轮读取授权。

该文件`enabled=false`且**没有被任何入口加载**；真正入口仍只读[`runtime.json`](../ops/releases/runtime.json)，原文件仍`false/environments={}`，LF SHA`765b7a016781f220a6880b9b94b66ecf09ef6a387661266e7bb047290844a9f6`。部署workflow LF SHA仍`b31f33aed8a000876385e1cf8a0001d3e1157bc8ea7863002262600b509fadff`。本轮仅离线验证候选字段及关闭态早退，不更改真实配置、工作流、权限或Secret，不证明未来真实OIDC/SM/数据库访问可用。后继启用仍须绑定完整、准确范围另审及用户本人GitHub environment批准。

#### 5.4 集中推进顺序与本轮停止点

1. 下一只围绕**合格A/B及兼容/持久化原件的缺项**准备一次准确读取范围；先复用可用本地原件，不再盘点已验收身份或索要新安装。当前无新读取许可，不自行刷新Source或下载/构建。
2. 有合格输入后复用既有`collect/prepare/register`及候选登记接口；实际构建、ECR发布、目录/初始绑定写入、必要初始镜像对齐、最小依赖恢复和runtime启用均按具体资源/副作用另审，不开窗等材料。若需新A，先解决初始对齐，再确定运行绑定；B候选可由第一次受审job晋升，无需另造发布框架。
3. 首次正常更新A→B在一次GitHub人工批准内完成准确晋升（如需）、仅ImageUri更新、独立技术核验和CAS。成功回写/释放占用后，第二次B→A使用相同部署源码/工作流/配置、新请求/run/批准；两次成功且revision＋2才通过D2-6。恢复/初始对齐、NO_CHANGE或单纯账本更新不计数。

本轮只改上述材料和状态文档；本机原ZIP/archive/receipt摘要匹配，原运行文件/工作流摘要保持，候选关闭态与字段合同离线检查通过。无运行源码/模板/SQL改变，不主动调度或重跑CI；正常main推送仍可触发既有无AWS检查，不据此声称实际发布通过。不产生执行槽或发布SHA；AWS/GitHub新读取、生产配置/Secret/PAT/PEM读取、数据库连接/写入、构建/ECR/恢复/dispatch均0。到此收尾，不自动进入读取或实际执行。

<a id="d2-6-evidence-read-review"></a>

### 6. 2026-11-17准确只读核对清单：仅待另审，不读取

用户本轮只要求编制范围。清单为[`d2-6-evidence-read.review.json`](../ops/releases/d2-6-evidence-read.review.json)，`readAuthorized=false`，不是安装、目录登记或部署批准，也不是可直接交给`collect`的输入。本轮不编新读取器/框架或修改原校验器；实际获准后只能逐项复用现有只读运输、四文件/扫描/registry验证。不得两次调用`collect`而重复STS/整批元数据，或借清单自动生成发布/恢复执行。

原编制清单规范JSON SHA256：`9e0db5b519509022613279e0ff0adda620655bd85b001d87252515191b6d6de8`。编制时只通过离线检查、尚未批准或执行；以下第8小节记录后来的明确批准和真实结果，不改原JSON或倒写其状态。此SHA仅绑定读取范围，不是发布/安装SHA，不能重放已完成轮次。

#### 6.1 一轮限定范围与累计上限

| 范围 | 准确对象与规则 | 上限 |
| --- | --- | --- |
| Source身份 | 固定profile `techlong-sandbox-user`、官方ca-central-1 STS；必须为原IAM用户，不AssumeRole、不改profile | STS 1 |
| A/B构建发现 | `veinyyxy/SpeedFeast_Backend_main`原`backend-image-candidate.yml`的成功main构建第一页10条；仅原attempt1、正确repo ID及事件，确定性选择至多两个不同源码提交；每run只查其artifact第一页 | GitHub GET 1＋2 |
| 兼容来源 | 每个所选commit只读六个固定路径：workflow、package.json、app.js、runtime_config、image_storage、merchant_assets；不跟随import扩查、不执行源码 | GitHub GET最多12，每解码文件≤1MiB |
| 已发布镜像 | 准确`techlong-sandbox-speedfeast`仓库须严格IMMUTABLE；只查由所选run/commit派生的两准确tag原manifest，以及必要时各一个linux/amd64子manifest | ECR最多5：仓库1＋root2＋child2 |
| 构建原ZIP | 仅所选run内未过期、准确认证API元数据/大小/digest的app artifact；不取lifecycle。原官方API302后一个官方blob GET，不向blob传认证或保存签名URL；沿用四文件校验 | API GET最多2＋blob GET最多2；ZIP最多2份/各500MiB，合计1000MiB |
| 持久化历史缺项 | 只拟读固定旧导入回执`F:/ChatGPT_workshop/test-data-import-20261106-b/independent-result.json`一次，先匹配原raw SHA `62671074…`，只投影目标/媒体数量、URL分类和文件迁移证据。引用文件/URL不跟读 | 私有JSON1份≤1MiB；无S3/业务SQL |

**合计：STS1＋ECR5＋GitHub API GET17＋官方blob GET2＋固定私有回执读取1。** Git凭据helper最多1次、仅内存认证，必须在Source身份通过后使用；不读取token/PAT文件、PEM、`.env.local`或AWS Secret值，不连接Neon/Aurora/本地库，不生成密码。失败无SDK/应用重试或诊断额外调用；原始响应/产物只进新的本机私有目录，不提交GitHub。普通代码/文档提交推送仍沿用既有授权，不算读取清单获准。

“至多两个”是固定第一页抽样，不声称查遍所有版本。缺少合格run/原包、产物过期或tag未发布只记缺项；不翻页换找旧构建、不调度新构建/扫描、不推镜像。若一个版本仅有合格未发布候选，标为`candidate-only`，不能当ECR已核验A；相同digest不能组成A/B。Node/scanner只与旧明确profile比较，差异记待审，不自动升级策略或把新源码认作产品已批准兼容。

#### 6.2 兼容与持久化的结论边界

兼容只核对明确schema/API/Express与Full声明、启动/迁移行为及存储语义。原初始化摘要可复用，但不是当前schema查询；未见的启动import、缺少的schema/API版本或Full声明仍是不足，不默认填fixture值，不从smoke健康推导兼容。本轮不读取原私密初始化包、不调用provision/readiness/control接口，原初始化不能重放。

持久化有更具体的历史缺项：[11月6日导入记录](aws-manual-test-environment-20261106.md)明确只复制9条本地媒体记录，未同步文件。图片栈/IAM/idle四环境值的安装已证明，**不再查桶、角色、CloudFront或承载来重复证明安装**。只对原导入回执核对其归因和已有证据引用；整份受限JSON可能在投影前进入内存，客户/订单/支付行不输出或落新正文。原回执不存在或SHA不符就停止，不找替代路径。

这不能证明当前全部媒体引用、文件字节映射或端到端持久化，仍保留`persistentUploadsReady=false`、`verificationSha256=null`。若原件没有文件清单，不扩目录遍历、S3 listing/对象下载或租户业务SQL；后续只有拿到准确来源/键/查询范围并另批才补证，不为本次读取启动数据库。用户负责业务验收，本阶段不代做图片上传/菜单等业务测试。

#### 6.3 期限、风险与停止交付

现在不开读取窗口、没有新的观测时间或deadline。未来只有用户明确批准本清单后，才可在批准后最多5小时内启动一次最多30分钟读取，且不得越过批准后5小时；实际新快照从首次远程读取计最多5小时。artifact、扫描DB48小时及其他原证据期限各自独立，不因这5小时规则延长；旧事实/旧执行槽保持，无资源租约或自动到期变更。用户不需现在刷新Source，只有获准真实调用失败才报告，不预先试凭据。

实际风险：现有凭据权限可能较宽；认证仅内存/官方服务使用仍有网络和提供者日志；原ZIP/源码进入私有内存/磁盘，历史回执可能含业务字段；API/传输/存储有低额非零费用；跨服务并非原子快照，第一页可能漏掉可用版本。鉴权/完整性/分页/越界/意外网络错误停止，不加诊断或重试、不换凭据；预期的缺项可继续剩余相互独立的白名单项，但不能用未用额度扩对象。所有旧原件/记录保留，不覆盖、复位或清理。

未来本轮读取的交付只允许“只读证据及明确缺项”或“停止”，不直接判发布/持久化就绪。登记版本/绑定、启用runtime、构建/ECR/镜像对齐、恢复、调度或任何云/SQL写仍另审。**本次只交付待审JSON与本节，不执行上述读取；没有新reader、执行入口、生产凭据/数据读取或运行源码修改。**

<a id="d2-6-execution-route"></a>

### 7. 集中执行路线：一次首次启用，随后两次真实更新

本节落实用户“写详细步骤，然后按步骤执行”的要求，取代继续添加准备方案的节奏；仍是原D2-6，不新增阶段编号、部署框架、工作流或日常运行入口。下面步骤按顺序推进并保留真实产出；用户明确另审的读取和未知云副作用，不能通过编写本节自动取得授权。只在真正缺项时提出一次集中操作范围，不反复重做已通过部分。

#### 步骤0：复用已完成项，不再重装或盘点（本轮已完成）

- 输入：身份最终验收回执、`d2-6.prepared.json`、关闭态候选配置、实际runtime和原`instance-release.yml`。
- 动作：仅本地确认原四栈13身份资源和已提交SQL结项、原准备摘要及runtime/workflow未变；旧产物到期/缺项照实保留，不读取凭据、业务正文或远端。
- 产出：复用原身份/三角色加publisher分工、已安装S3接线和原单审批入口，不新增安装工作；真实运行配置保持false/environments={}。
- 完成条件：本地摘要一致且没有重装/复位/生产副作用。已执行，不再次要求一次身份安装或全环境盘点。

#### 步骤1：一次取得A/B与阻塞项的真实证据（已按原范围完成，见第8节）

- 原批准对象唯一为第6节SHA `9e0db5b519509022613279e0ff0adda620655bd85b001d87252515191b6d6de8`；不再生成同范围新清单。上限及隐私风险沿用原JSON，Source/Git认证、下载和固定私有回执读取必须获明确批准后才开始。
- 动作：固定第一页最多两构建、其原app证据与对应ECR manifest，固定源码文件和一份旧媒体导入回执；先使用已存公有元数据，不重复已完成身份/承载读取。未获准前只做本地材料工作，不预试Source。
- 产出：一份结果同时列出可用A/B（或合格候选）、真实digest/原件期限、兼容声明的来源、媒体证明的准确余项；不把未来选型或缺项写成通过。
- 分流：已有合格版本就直接复用；没有或已过期，记录“需要正常构建”进入步骤3，不继续搜索旧产物/制作新的只读轮次来回避构建。只有出现明确未覆盖的必要对象才集中申请差额范围，不能重跑整批。
- 停止条件：鉴权/完整性/意外网络错误按原清单停止、保留原件，不自动诊断/重试；预期缺项只整理一次，不借未用预算扩查。

#### 步骤2：先闭合不应反复过期的兼容/持久化输入

- 本次对象仍为原sandbox Express实例，不是Full环境验收。版本合同允许仅声明有证据的`express_iam`；未证明Full就不列入该版本兼容范围，不新增数据库模式/迁移任务来完成D2。
- 兼容动作：基于步骤1源码和已存初始化记录形成明确schema/API版本、不迁移/不启动写入的产品策略。没有权威版本证据就集中列出准确必需补读；不伪填fixture，不创建新的版本表或为验收修改业务逻辑。
- 持久化动作：复用已安装桶/IAM/S3配置；原9条媒体记录未同步文件如仍缺准确引用/文件证明，集中列明必要来源/键/只读查询及最小处理范围供用户确认。只处理阻断既定持久化门槛的对象，不扩为全量图片治理/迁移框架，不代做商品业务测试。
- 边界：步骤1不含租户SQL或图片读取/迁移；这些不能偷加进原只读批准。确需恢复数据库才能取得事实时，说明这一真实依赖并与步骤4必要运行范围集中审批，而不是宣称可完全离线证明。
- 产出/完成条件：兼容策略来源可追溯，持久化必要范围和剩余运行核验明确；没有已知未解决的材料依赖时，才启动新的短寿命构建。源码、扫描或历史接线不能代替完整证明。

#### 步骤3：备齐合格A/B并登记可信目录

- 优先复用步骤1合格现有版本。若缺A或B，集中准备现有后端`backend-image-candidate.yml`的准确源码/次数及app原件范围；构建、必要ECR发布与目录写入分别包含在用户明确确认的操作包内，不新增构建框架或云权限。
- 新构建尽量安排在步骤2材料阻塞解决后，避免产物/扫描在等待期间再次过期。旧A0不能直接升级成可信A；A/B必须真实不同digest，不能只换标签、捏造hash或改业务功能来凑次数。
- A必须成为原目录中的`ecr_verified`版本，并具真实原件/扫描/兼容证据；B可为`ecr_verified`或原合同的合格`candidate`。B为candidate时，第一次发布的同一审批覆盖其准确app晋升及后继更新，不另搭发布流程。
- 目录登记复用既有受审入口/不可变INSERT；所需真实凭据/SQL范围集中批准，不重放schema/grants/promotion/password安装，不给日常角色补自注册或DML权限。
- 产出/完成条件：A、B准确release ID、源代码/原件/期限和完整兼容信息可用；A实际registry已核验，B路线明确、证据在执行时仍有效。缺项停止，不把目录“已写入”当实际部署成功。

#### 步骤4：一次完成必要首次启用，不把它算成日常更新

- 开始前集中给出准确资源/写入/失败策略和必要凭据使用范围，取得用户批准；不先恢复收费环境等材料，不默认启动平台Web、独立prod库或无关Cell。不新增IAM，发现必要权限差异先停下报告。
- 如A0不合格，先单独列原CFN栈初始ImageUri对齐到合格A的差异；按实际状态决定受审执行顺序。已有启停工具继续`noImageChange`，不能暗改恢复参数或把初始镜像切换冒充A→B。
- 使用原CFN归属启停流程恢复必要API/Cell/数据库，核对实际新输出、监听器/DNS/路由、固定Secret引用和稳定服务/技术健康；CFN所属资源只经CFN，不直接创建第二套ALB/ECS。
- 基于实际运行A和必要兼容/持久化证据，复用原`releaseRuntimeDigests`建立运行模板/非镜像配置摘要，再由另审管理员登记准确初始binding/currentRelease/revision。不是把历史idle SHA或业务ready值直接写进release状态。
- 最后以准确已安装四角色/五Secret版本及GitHub人工门禁配置启用既有runtime；不增加特权租约或Web审批窗口，不设置新资源到期。启用、采样及种子写入非跨服务原子，部分完成/未知不自动补齐或重放。
- 产出/完成条件：真实服务稳定运行A、完整绑定持久化且无活跃release请求，原工作流能准备准确更新计划。到此只是首次启用，真实日常更新仍计0。

#### 步骤5：同一套代码执行A→B，再B→A

1. 原`Instance API release`工作流输入仅为准确instance_id、B的release_id、environment=sandbox；prepare自动读取目录/绑定并生成计划。用户本人批准该run一次`techlong-sandbox-deploy`。
2. 原job按批准路线晋升B（仅候选时需要）、核对真实ECR原文、仅修改ImageUri、严格核对Change Set并执行；由独立verifier进程做技术验收，最后CAS回写版本/revision/结果并释放占用。这些都在该次工作流内完成，不再手动拆成旧Review/RunOnce/Inspect三次工作流。
3. 只有第一次确为SUCCEEDED、账本/B/实际镜像一致且占用已释放，才使用**相同部署源码、workflow及运行配置**发起第二个新run，目标为A；用户再批准该run一次environment。不改代码修补中间状态，不重放计划、旧token或Re-run来充第二次。
4. 第二次复用相同核验/回写路径。两次都保持镜像之外的配置/权限/数据库及来源引用不变，不执行买卖家业务测试或SQL迁移；失败/UNKNOWN保留真实状态和占用，按必要准确范围另审查因，不自动再apply、回滚部署或清理。

工作流现有prepare最长15分钟、deploy最长60分钟；这是上限，不是耗时承诺。两次各有一次GitHub本人环境批准，不要求Web页面操作；不承诺40分钟必然做完全部首次启用和两次ECS更新。进入此步前确认用户能配合两次审批及有足够实际有效证据，不再在短窗口内等构建/材料。

#### 步骤6：以可重复流程结案，不以清单或CI结案

- 必须同时取得两次真实run/request、CloudFormation ACK/完成结果、独立核验和固定版本证据，以及控制库最终A、revision=初始＋2、无活跃请求；核对实际镜像/配置/原归属一致，才标D2-6成功。
- 交付固定日常操作方法：选择已登记实例和版本→提交原workflow→本人一次GitHub批准→查看结果。日常不再由代理临时写脚本、重新安装身份、改Web审批窗口或制作新固定任务分支。
- 本次证明范围是原sandbox已初始化实例的tenant_api日常发布；不混称新客户首次开通、前端发布、Full环境或全SaaS正式上线完成。
- 收尾明确列出仍运行/可能计费的资源；用户另批既有节费工具停用或明确保留，不增加自动到期/守护/清理代码，也不把验收结束当自动停费。

#### 当前执行记录与下一唯一动作

| 步骤 | 当前状态 | 已有产出/下一动作 |
| --- | --- | --- |
| 0 复用已完成项 | 已完成 | 身份结项及原准备/runtime/workflow摘要保持，本轮无生产调用 |
| 1 一次集中取证 | 已获准并完成 | STS1/GitHub15/固定回执1，两个匹配app原件均缺失；不再查询旧构建 |
| 2 兼容/持久化 | 离线输入已收口；云端证明未完成 | 五应用源码树不变，原9图全部找到并哈希（根5/products4）；兼容契约提案和私有迁移输入准备完毕，尚未上传/改库/写绑定 |
| 3 合格A/B目录 | 真实完成：A已发布/ecr_verified、B已登记未晋升candidate，独立回读通过 | [第16节](#d2-6-publication-catalog-observed)原run44154605425 success，dispatch1/配置1/TLS2/SQL52；复用准确原件及代码，入口已关闭，不重复发布/登记 |
| 4 首次启用 | 未执行 | 收费环境不恢复，runtime仍关闭，种子/实际操作另审 |
| 5 两次正常更新 | 0／2 | 不以初始恢复/对齐、NO_CHANGE或模拟结果充数 |
| 6 结案 | 未完成 | 必须有两次真实成功及最终一致回写 |

原路线编制轮只新增本节及同步手册，没有执行读取。步骤1后来已获明确批准并真实完成，记录如下；正常main提交推送沿用既有授权，后续步骤仍不绕过门槛或从本次读取扩权。

<a id="d2-6-step1-observed"></a>

### 8. 步骤1实际完成：旧原件查找收尾，不再开启相同读取轮次

用户明确批准原9e0db5…，私有一次性编排复用原Source/Git运输与校验；语法/原清单SHA、父准备/runtime/workflow核验先在本机完成。Windows的python3别名不可用已在远端读取前发现，私有编排定位了内置Python并保持原四文件extractor；实际没有下载，因此没有解包调用。未修改正式代码/模板/SQL/工作流或安装软件。

真实窗口2026-11-17T15:19:29.756Z–15:19:38.874Z，结果`READ_ONLY_EVIDENCE_COLLECTED_WITH_EXPLICIT_GAPS`，[回执及8份私有原件指纹](aws-instance-release-d2-6-evidence-observed-20261117.json)。实际STS1且IAM身份通过，GitHub API GET15（构建列表1、两artifact列表2、准确源码12）、helper1、固定历史导入回执1；ECR/ZIP/blob、配置/Secret/PAT/PEM读取、数据库连接、云SQL写、构建/发布/恢复/dispatch均0。提交/返回日志与计数本地一致，未自动重试、扩读或复用未用额度；真实runtime仍false/environments={}。

| 本轮取得的事实 | 结论与下一动作 |
| --- | --- |
| 最新所选run43630231572 / b9ca2138…返回1项artifact，但无匹配app；run38803364109 / 10fe3c41…返回0项 | 两者都不能直接提供当前合格app原件；不重复查询或下载历史ZIP，不因未用5次ECR额度查其他tag。后续采用准确另批的正常新构建路径，不声称已查遍仓库所有版本 |
| 两个源码提交的固定六文件均通过blob/raw hash，共12份 | app.js/runtime_config/image_storage/merchant_assets四指定文件两版字节相同，package/workflow不同；不是整个仓库所有业务/启动依赖等同证明 |
| 六文件投影未取得可直接绑定的schema/API数字字符串声明；runtime_config包含两DB profile名称，image_storage包含S3写相关代码 | 不从关键词推出兼容通过或无迁移/启动写；Express为本次对象，Full不新增为验收前置，schema/API产品策略仍须权威输入 |
| 固定旧导入回执原SHA完整匹配 | 本轮投影未建立媒体引用→文件映射；历史9条本地媒体记录未同步文件的已知缺项保留，不将此回执/已装桶标为完整持久化证明 |

本轮已经结束，读取窗口不继续消费。准备事实截止2026-11-17T20:19:29.756Z，artifact/扫描及原08:24:36.704Z旧事实不续期；可长期保留原字节作追溯，不把5小时之后的元数据当新鲜现状。

下一唯一动作是步骤2：利用这些已取源码摘要及旧初始化/导入记录，集中明确schema/API策略和媒体来源/最小映射。已向用户询问准确图片文件夹，只收路径，不据此读取/迁移；任何必要新源文件、SQL或媒体读取仍按具体范围另审。不新增媒体功能、Full环境或再次查旧构建的方案；在这些非短寿命输入解决后，再集中批准新构建/登记及首次启用，避免新产物在等材料时再过期。当前没有合格A/B登记、恢复或版本发布批准，不将步骤1通过混称D2完成。

**步骤2来源补充（用户提供，尚未读取）：**

| 来源 | 用户说明 | 处理边界 |
| --- | --- | --- |
| `E:/NodejsProject/SpeedFeast_Backend_main/images`根目录直接图片 | 早期测试用图片 | 仅作为历史测试图候选来源；未枚举/读取，不证明9条历史媒体记录全部对应这里 |
| `E:/NodejsProject/SpeedFeast_Backend_main/images/products` | 卖家端实现商品图片上传后新增的图片 | 与早期测试图分开；不整目录迁移/删除/覆盖，只有准确媒体引用确实指向的必要文件才进入未来待审范围 |

本次回复只供给路径和来源分类，不授予目录枚举、文件哈希/内容读取、数据库读取或迁移。后续先按准确引用建立必要文件映射，不能凭目录名/时间推定引用关系或复制全部图片；原文件/上传图片保持，不扩全量媒体治理。schema/API兼容策略和完整持久化证明仍未收口，runtime仍关闭。此补充只改文档，未对该目录进行存在性/元数据/内容核验，无生产或云调用。

<a id="d2-6-step2-observed"></a>

### 9. 步骤2离线实施：源码兼容证明、九图精确映射与待审契约输入

本次按用户要求实施步骤2，并由用户分别批准原固定导出一次及本地投影修正后一次补读；[真实去敏回执](aws-instance-release-d2-6-step2-observed-20261117.json)记录两轮和7份私有原件。没有新增正式运行模块、SQL、版本表、API或媒体工具；没有连接数据库/AWS/GitHub，未改服务端工作树、图片、记录或runtime，也没有恢复收费环境。

#### 9.1 已完成的源码兼容证据

本地服务端HEAD为`b9ca2138738900afc23a6a2ddce141b37a1f0a31`/main且tracked工作树未改。与旧部署源码`10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2`比较，`routes`、`services`、`db`、`bin`、`public`五个Git tree逐一相同；app.js两版内容不变。Windows工作树的CRLF摘要与Git/GitHub原始LF字节摘要分开记录，不混称同一raw SHA；步骤3远端工作流固定使用Git对象原字节。变化在依赖/基础镜像、构建发布及测试/记录文件，不是新的业务路由或数据库SQL需求。

- `package.json`的正常入口仍`node ./bin/www`；`node db/apply_saas_control.js`是独立迁移入口，不在Web启动时调用。D2不重跑初始化、restore或migration来更新镜像。
- 图片上传实现确实写入`storage_provider/bucket/object_key/public_url`；切换provider只影响新上传，不能自动迁移旧记录。
- 已跑原`test/tenant_readiness_v1.test.js`：8pass/0fail/0skip，全部注入mock pool；local/S3 URL及注入PutObject断言7项通过，无实际网络/SQL/图片读取。媒体投影严格检查14项、既有候选构建纯合同接纳提案标识也通过；未拿合成结果给过期真实产物续期。
- 基础镜像/依赖变化仍需步骤3新构建/扫描和步骤4/5真实技术核验。源码相同证明没有引入新的应用/SQL源码变更，不是二进制兼容或当前健康的绝对保证；Full不纳入本次实际验收。

#### 9.2 不伪填版本：已有schema契约与显式API来源标识提案

[`d2-6-compatibility.prepared.json`](../ops/releases/d2-6-compatibility.prepared.json)把原字段所需声明集中准备：仅`express_iam`、端口3000、`requiresMigration=false`、`startupWrites=false`；不是已登记版本或初始绑定，也不是可执行BuildPolicy输入。正式采纳仍须包含在后续准确版本/绑定批准内。

- schema要求引用服务端已有`MIGRATION_CONTRACT='speedfeast-saas-control-v1'`，并保留完全未变的db源码树`aa7d38d97992d5b68dcee2f8247fd4a1a5b5239b`作来源。它是应用要求的schema契约，不是这次测得的云数据库fingerprint、PG主版本或已写入的lifecycle marker。
- 服务端没有在本轮核对范围提供独立买家/商家API semver；因此提议沿用现有control-plane字符串兼容字段，用routes/services完整tree ID及app原SHA256派生明确的`speedfeast-client-api-sha256:90191edd28decd490e95ea35461f9e26200874783a1ffc5f8598406bbc583144`来源契约标识。它是待审元数据标签，不是冒称已有对外版本号；不增加客户端header、后端版本接口或版本表。
- SaaS控制API的源码常量`1.2`单独记录，**不把它混填为买家/商家业务API版本**。候选提案可被原纯合同接受，不代表当前客户端或数据库版本已经核验。
- 只有另批首次启用时证实准确原Express库、初始化及严格tenant-v1 readiness/配置保持，并明确采纳该策略后，才可用于初始绑定。存在的其他真实绑定/标签不能被覆盖来凑一致；不写数据库标记或重放迁移来制造证明。

#### 9.3 九条历史媒体→九个真实文件，未遍历、复制或迁移

固定源导出raw SHA仍`3089ec9e…`，其中media_assets按**每行JSON字符串**保存；a误按对象投影的全空字段结果已标无效并保留。用户另准后b只补读同源一次，正确解码并验证9个不同asset_id，原a不复位或改标成功。累计源读2，图片内容只读9个，合计**1,233,239字节**（小于原45MiB上限），全部找到/哈希，未枚举目录、预览或联网取图。

实际是根目录早期图5张、`products/年/月`上传图4张。新上传记录的key相对images；五条旧记录的key有`images/`前缀，和`public_url`的`/images/…`一致，原`db/product_image_assets_migration.sql`的ltrim规则给出了来源，未通过猜文件名或扩目录搜索修补。

**9条历史记录的store_id均为NULL，且原列允许NULL。** 保留这个事实，不伪造默认店铺、不把NULL误判为未被商品引用或允许删除。当前云端关联仍须未来按准确实例/媒体ID及商品引用核对；历史源不等于现在全部媒体清单。

私有`mapping.json`保存准确asset_id、旧六字段、本地相对路径、字节/SHA；`migration-inputs.prepared.json`只派生9项待审目标：四上传图保持products下的原key，五旧图拟映射到`products/legacy/<asset_id>/<原文件名>`，都在已授权桶策略的products/*内，不扩权限。桶和公开base URL仅复用已安装回执的历史输出，不冒称本轮核对了当前对象/空位。

这些数据**没有执行任何PUT、修改URL/variants/store_id或其他SQL**。未来必须另外批准目标准确键的条件上传、当时原值/NULL/variants保护的短事务CAS及独立核验；发现额外被引用local图或历史行变化须如实报告，不认为只处理9条就自动证明全量持久化。原文件保留，不自动覆盖/删除。

#### 9.4 本步骤完成边界与下一动作

步骤2的**源码与本地输入准备已经完成**，不是完整云持久化或版本更新验收通过。`persistentUploadsReady=false`、运行配置关闭和原PERSISTENCE_NOT_READY门槛不变；尚缺实际新镜像、当时云端媒体引用/对象/CAS与初始运行绑定证明。

下一按步骤3准备正常app-only构建、真实目录登记和必要首次启用的集中操作范围，使用上述源码证明和已封存9文件输入，不再重找旧artifact、重建图片设施或追加通用框架。实际构建/ECR/目录/媒体写/恢复仍另审；所有当前兼容及持久化门槛必须在A→B/B→A之前通过。实际媒体处理若需先启动原数据库，明确作为首次启用中单独受审的数据动作，不能夹进日常只ImageUri更新。没有给旧事实或过期扫描续期，也没有开启资源/授权短窗口等材料。

<a id="d2-6-build-prepared"></a>

### 10. 步骤3构建准备：复用现有工作流，实际构建另审

本次交付为[`d2-6-build.review.json`](../ops/releases/d2-6-build.review.json)，按原`sha256Hex(JSON对象)`计算的审批摘要为：

```text
7a4350731179972bcd7695203a8f763aee09033abde2df68f0b4cd5f1cfce773
```

这是**范围清单，不是已获准的构建、可交给release命令的运行配置或新执行器**。全部授权标志为false，A/B的run、artifact、镜像/registry摘要与release ID均为null。本轮只做本地源码/契约校验及文档/JSON提交，不取凭据、不调用GitHub API/AWS、不构建/下载、不连数据库、不读取图片或旧导出，不修改后端代码、工作流、SQL、镜像或runtime。以后真正执行前仍须用户明确批准本SHA及范围。

#### 10.1 已有构建能力与固定输入

| 项目 | 本次固定值/边界 |
| --- | --- |
| 服务端 | `E:/NodejsProject/SpeedFeast_Backend_main`，main，源码`b9ca2138738900afc23a6a2ddce141b37a1f0a31`；tracked工作树干净 |
| 原工作流 | `veinyyxy/SpeedFeast_Backend_main/.github/workflows/backend-image-candidate.yml`；历史workflow ID `377674976`，未来先核对准确仓库/main/工作流原字节，不把本地HEAD当当前远端值 |
| 工作流原字节SHA256 | `ec2d5aa094bf92a1bd7edfaba29d2a77386f8d3df65df35cb75b423578f31910`，取Git对象原LF字节；另固定Dockerfile、锁文件及原自检/扫描脚本等共9个Git文件 |
| 既有job | 只有app；`ubuntu-24.04`，单job最长25分钟，`contents:read`；无environment、OIDC、AWS身份、docker push或数据库迁移 |
| 原自检 | linux/amd64、非root65532、无网络容器、health200/offline ready503，既有Aurora/readiness自检；生产依赖audit及OS HIGH/CRITICAL为0，不放宽unfixed/忽略规则 |
| 原产物 | `checked-app-{commit}-{runId}-1`；四文件image.tar.gz、candidate-receipt.json、self-check.json、SHA256SUMS，保留1天；镜像archive≤450MiB |
| 复用输入 | 步骤2兼容提案/真实回执、原解包/候选验证模块、部署workflow及关闭态runtime共8项LF摘要，不重读9图或历史导出 |

**本构建工作流没有GitHub environment门禁**，所以另批构建后不需要用户再找“Review deployments”。这不改变后继ECR发布或日常更新的本人environment批准要求；本轮也不修改仓库保护或权限设置。

#### 10.2 获准后连续执行的唯一序列（当前未执行）

1. 一次使用既有Git凭据helper，仅在内存向`api.github.com`认证；不读取另存PAT、PEM、.env或AWS Secret。先核对仓库ID/main仍为上述固定提交、工作流Git原字节一致；不符即停，不临时换版本或修代码。
2. 为A保存一次有限的调度前run ID样本和新私有INTENT，仅POST一次原workflow_dispatch，`ref=main`、无额外inputs。只绑定符合准确仓库/workflow/SHA/main/事件/actor/attempt1与时间区间的唯一新run；不靠“最新run”猜测归属。提交不明保留UNKNOWN，不补POST或自动启动B。
3. 只跟进该run；成功后取唯一准确app原ZIP，复用原四文件解包、校验和、receipt/自检/扫描验证器，按真实当前时间核验。原`python3`在本机是不可用别名，使用已安装的内置Python调用**同一解包脚本**，不安装Docker/Python或改正式模块。
4. A原件验证成功后，再核对main未改变；B按相同源码/工作流独立记录、单次调度和验证。任何一份失败就停止，不自动修复、Re-run、cancel或第三次构建。
5. 两份run必须不同且原件有效，**实际验证出的imageConfigDigest也必须不同**。重复同一源码并不保证不同digest；相同就记`DISTINCT_IMAGE_REQUIRED`，不改标签/摘要或业务代码凑数。

通过只表示取得两份不同的真实app构建原件。config digest不是ECR root/platform digest；后者仍须后继实际发布/回读证明，目录与初始绑定不由这次构建自动写入。兼容标签仍是待采纳提案，云持久化也不能由扫描成功替代。

#### 10.3 集中的实际构建范围、费用与停止边界

后继若批准本SHA，拟合计**GitHub API GET最多67、workflow_dispatch POST最多2、原ZIP/blob GET最多2**；另仅首个失败准确app job允许1次日志API GET（已计入67）及1次官方文本blob GET、≤4MiB。GET上限主要是两准确run的正常状态跟进（每份最多24次、间隔≥90秒、各≤35分钟），不是新增资源盘点。其他GET仅核对准确仓库/ref/工作流、两次有限run定位及成功原件/失败步骤；不翻页或搜索历史构建。

每ZIP≤500MiB、两份合计≤1000MiB，原件和必要去敏日志仅存本机新建私有目录、不提交GitHub；下载只跟随允许的官方HTTPS blob，凭据不转发给blob、不保存签名URL。错误请求不自动重试；正常queued/in_progress跟进与错误重试分开。没有Source/AWS/ECR、SQL、配置/PAT/PEM/Secret读取、目录/绑定写入、环境恢复或ECS部署。

本轮**没有开启时间窗口**。未来明确批准后5小时内启动；整轮最长80分钟且不超过批准后5小时，预留不足不启动。新准备事实从首次真实预检计时最多5小时，不在B结束时重置；旧步骤1快照、产物1天和扫描DB48小时均不续期，不开启资源/控制租约。两个原job合计上限50 runner分钟，排队会额外耗时；原工作流的依赖/基础镜像/扫描数据库下载及artifact/log存储可能消耗GitHub额度或收费，不升级plan/改账单设置。代理中断后已调度job可能继续，保存准确ID，不重新调度“恢复”。

本地JSON/9项Git来源、8项复用摘要、YAML的app-only/原权限/原超时/原保留期、调用上限求和、空版本字段及实际runtime关闭共**85项断言通过**；未改运行代码，所以未触发构建来验证本准备文档，也不把本地断言称作真实构建CI通过。正式runtime仍false/environments={}，部署workflow保持原SHA；D2-6真实更新0/2。

**该准备轮停止点（后已另准并完成实际构建，见第11节）：** 当时只待实际构建另审，未提前调度或要求刷新Source/追加环境盘点；原JSON保留编制字节，不改授权标志或重放。必要ECR/可信目录及首次启用仍准确另审，不恢复环境等产物、不新增工作流或扩支线。

<a id="d2-6-build-observed"></a>

### 11. 两次真实app构建与原件核验完成：未发布ECR、未写目录或恢复环境

用户明确批准第10节SHA `7a4350731179972bcd7695203a8f763aee09033abde2df68f0b4cd5f1cfce773`及原风险后，本轮只执行该范围。复用既有Git认证helper、原app-only工作流、原四文件解包脚本及`verifyBackendBuildEvidence`，在新私有目录保存调度INTENT/204 ACK/准确run绑定和原包，不新增正式执行模块、工作流、依赖或云权限。

真实窗口**2026-11-17T16:41:09.402Z–16:47:26.228Z**，约6分17秒，结果`TWO_DISTINCT_APP_BUILD_ORIGINALS_VERIFIED_NOT_PUBLISHED`；[去敏回执](aws-instance-release-d2-6-build-observed-20261117.json)保存准确来源、计数及68份私有JSON/操作脚本指纹。认证、原ZIP、解包目录和回执正文不提交GitHub；原范围、旧记录和已消费的两个新INTENT保持，不Re-run/重放。

| 构建 | 真实run / app artifact | 实际imageConfigDigest |
| --- | --- | --- |
| A | [44128576107](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/44128576107) / `14347858874` | `sha256:ad65fdf4dd998f960274adf308a9f7b8baeba6d845309ad21529062b50b4d2eb` |
| B | [44129167654](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/44129167654) / `14349965129` | `sha256:fee49b1473042adb987cf0acaef4fd443b6166b65aab1cc389c53403a2afed6b` |

两run均准确仓库/main/workflow_dispatch/本人actor/attempt1/success，源码同`b9ca2138738900afc23a6a2ddce141b37a1f0a31`。远端工作流原字节与批准Git对象一致；每次调度前核对main不变，以有限调度前样本/时间区间绑定唯一新run，不取另一历史run。A原件核验成功后才启动B；没有第三次构建或提交不明/失败重试。

实际使用：**GitHub API GET18、POST dispatch2、官方ZIP blob GET2、helper读取1、原ZIP下载2，共145,323,945字节**；没有失败日志下载。每份ZIP大小/原SHA均与认证GitHub artifact元数据一致，原解包器确认四文件清单/限额，校验和、Node24.18.0/非root/隔离health及offline ready、Trivy0.75.0/OS HIGH与CRITICAL均0和48小时DB新鲜度全部通过。随后仅本地再次运行原证据验证器及A/B不同摘要检查，通过；未新增provider调用。构建CI是真实成功，不是只通过本机合成测试。

**真实通过范围仅为两份app构建原件。** 这些config digest不是ECR root/platform manifest digest；尚无本轮ECR推送/回读、可信目录ID或初始实例绑定。兼容元数据提案未被本轮采纳成当前云事实，九图尚未上传/改库，完整持久化门槛不变。实际runtime仍false/environments={}，部署workflow保持原SHA；AWS/ECR、配置/PAT/PEM/Secret、数据库连接/SQL、目录/绑定写入、恢复环境和真实版本更新全部0。

新元数据从首次真实读取16:41:09.565Z计5小时，截止**2026-11-17T21:41:09.565Z（温尼伯15:41:09.565）**；A原件到期2026-11-18T16:42:02Z、B到期16:45:19Z，即次日温尼伯10:42:02/10:45:19。扫描DB48小时与这两个期限分别保持原值；本机留存不能刷新artifact/扫描或旧事实时间，后继不足时只处理真实必要缺项，不默认重建全部材料或重跑构建。

本轮到此收尾，仅提交结果。**下一唯一动作仍在步骤3：复用这些原件准备必要ECR发布与可信目录的集中范围，实际新读取/发布/登记另审。** 不提前恢复环境，不重复身份安装/云盘点或再查旧构建，不增加Web审批/运行框架；初始绑定/runtime启用仍属后继步骤4，两次A→B→A真实更新仍0/2。

<a id="d2-6-publication-catalog-prepared"></a>

### 12. 复用A/B原件的集中发布与目录草案：不恢复环境

本轮按用户要求只编制[`d2-6-publication-catalog.prepared.json`](../ops/releases/d2-6-publication-catalog.prepared.json)，不执行新增生产/凭据读取、构建、发布或数据库登记。复用第11节原件和步骤2兼容提案，只读取两份已存验证回执并匹配原raw SHA、检查两个已存ZIP大小，未重读ZIP/图片/旧业务导出。原`sealReleaseCandidate`在真实当前时间对两份原件与拟议产品策略均验证通过；另有61项本地来源摘要/策略ID/上限求和/未授权标志/实际runtime关闭和文档关联检查通过。这不是目录已写入或当前云兼容/持久化通过。正式代码、SQL、模板、workflow与runtime均未改，不重跑CI来验证一份文档。

#### 12.1 固定最少发布量，保留同审批晋升路径

| 对象 | 拟议版本标签与派生ID（未登记） | 本次后继批准拟覆盖 |
| --- | --- | --- |
| A / run44128576107 | `d2-6-a-b9ca2138-r44128576107` → `release_00b9c5cfa6bceedc5fd05aa451dca811` | 仅这份app archive发布一次准确不可变tag、核验真实ECR root/amd64 manifest，再INSERT为ecr_verified |
| B / run44129167654 | `d2-6-b-b9ca2138-r44129167654` → `release_afcc95f9eaa20785265300c801fd7618` | 只INSERT为原StoredReleaseCandidate，不推送B、不填registry digest；以后A→B的那次本人environment批准才覆盖B晋升和更新 |

这些标签是本次待审验收元数据，不冒称应用原有semver；ID由既有product/component/version规则计算。两个candidate SHA、原ZIP/archive/receipt SHA、原run/artifact和期限均已固定到JSON；实际目录行存在性本轮未查询，不能凭派生ID声称空位或已经登记。schema/API标签仅沿用步骤2有源码支持的Express策略，采纳须包含在后继明确批准中，不写数据库标记、不修改现有绑定来凑兼容。这里不把两次不同构建误称两次真实更新。

#### 12.2 已确认的入口边界：只缺最小引导接线，不扩部署引擎

**目前还不能诚实地生成可直接执行的发布＋登记SHA。** 原件、单app推送/registry校验和不可变INSERT端口已有，但当前端到端入口不覆盖本轮全部动作：

1. `scripts/instance-release.ts`只支持prepare/deploy/inspect，先检查实际runtime；同审批promotion又要求active/initialized/currentRelease和真实运行基线。它不能在关闭环境/未绑定时发布初始A。不能伪造binding/事实、打开runtime或提前恢复收费资源绕过此依赖。
2. `registerReleaseCandidate`端口已有，但`catalog-transaction.ts`当前writer只调`registerVerifiedRelease`，`instance-release-import.ts`的prepare/register也只接受已核验ECR来源。它不能直接完成B候选登记或拟议的一配置/两连接A/B批次，不能把candidate冒充ecr_verified或临时使用无事务直接SQL。

**后继最小代码范围，只在用户同意后实施：** 薄的、受GitHub本人environment保护的初始A发布入口，复用原单app验证/推送/ECR原文核验及已安装publisher role；同一既有目录事务增加candidate分支和有界A/B编排。保留日常workflow三输入/资格门槛和默认关闭，不增加schema、LOGIN、Secret、IAM、通用importer/恢复框架或另一套部署引擎。连接兼容复用已有经验证的纯参数规范化，不再次调查或修改数据库配置。本轮未写这些代码，未来准确文件/hash/CI/run值仍为null；当前JSON是**集中审批草案，不是操作批准SHA**。

不使用旧`backend-reviewed-ecr-publish`：其代码强制app＋lifecycle及旧Grant/Revoke，和本轮单app范围不同；也不使用production rebuild工作流或无关平台publisher。不上本地Docker，不重构建A/B、不跑collect选择“最新包”，不拼假SourceEvidence/manifest/observation来满足已有CLI。

#### 12.3 拟议集中序列与真实副作用（当前全部未执行）

1. **先闭合上述最小代码与现有回归/无AWS CI**，仍不读生产；用户没有在本轮批准实现这些入口。准确代码通过后，才另审一次限定当前事实核对，不重复三栈/Cell/ALB/ECS/RDS/DNS/Neon盘点。
2. **一次必要补核提案已并入同一JSON，而非另建清单：** Source STS1＋元数据11，限publisher role/唯一attached boundary/inline为空、准确ECR仓库与A tag、固定backend token Secret版本元数据、证据桶versioning及准确A push槽HEAD；GitHub GET10，限main/新准确入口与CI、现有environment/reviewer/branch/OIDC元数据、准确A/B run/artifact。不取Secret正文/.env/PAT/PEM或ZIP、不连库/写资源；本轮未申请执行，也不要求现在刷新Source。
3. **生成一份真实外层执行SHA后另审**，绑定当时准确代码/CI、A/B和兼容策略、当前权限、完整预算与writeBefore。它可明确批准A实际ECR证明的固定派生，不必等manifest出现后再来回批准一次；不存在的代码/当前事实不能用本草案替代。GitHub environment始终用户本人批准。
4. **仅一个受保护发布job、一次A push：** 只加载/inspect/tag已构建A，不build/run应用；云端只读一次已安装backend-read-token固定版本，经官方GitHub API重取准确A原件并核对原SHA，B不重新下载/推送。用既有publisher OIDC身份，最多8次ECR CLI调用、3次条件审计PUT（intent/push/published），不写CFN/derived计划或读publisher DB Secret。Docker一次push仍包含多次层/manifest请求及可能的内部传输重试，不谎称只有一次AWS写。
5. **独立证明后才写目录：** Source最多再核对STS1和两个准确VersionId审计对象GET（各≤4MiB），复用`verifyPublishedRelease`检查A的registry root/amd64/config关系；只有其实际manifest/platform/verification字段能派生，批准的产品/版本/来源/兼容字段不得改变。B必须等于本轮封存候选，不造registry digest。
6. **目录总上限提案：** 一次读取既有`.env.local`，一条验证TLS writer连接中分别提交A/B最多两次INSERT事务，关闭writer后由一条新的验证TLS连接分别核验完整原文；合计SQL64/最多两行、writer事务2/核验事务2。每事务临时owner SET、关闭SET/INHERIT及收尾检查沿用原管控，实际最小适配/测试须证明预算可达后才固定执行SHA。独立核验事务也有角色成员写，**不是纯READ ONLY**；创建者ADMIN仍保留。
7. A推送/登记、B登记和独立核验并非跨服务原子。提交不明停止后继INSERT，只允许预先批准的独立回读，不把回读匹配当COMMIT ACK成功；存在不同目录/status/revocation冲突就停，不UPDATE/DELETE/复位槽、补推、重放SQL或自动清理。允许形成“A已发布/登记而B未完成”的真实部分结果，不把两行强说成全有或全无。

GitHub操作提案总GET43上限包含限定预检、一次run定位/最多24次准确run监测（间隔90秒）、终态job/首失败日志及云端A原件3次API GET；仅dispatch1/云端A ZIP1（≤500MiB），失败日志最多一份≤4MiB。都是**待代码/CI和新事实闭合后固定的上限，不是本轮授权**；不额外调度Review/RunOnce/Inspect或已有日常发布workflow。

#### 12.4 不开窗口、风险与本轮停止点

历史publisher RoleId/PolicyId/v1及摘要复用11月16日安装回执，仅用于以后准确比较，不冒充本轮现状。准备时间17:00:46.011Z不是新生产采样；第11节事实仍在21:41:09.565Z到期，A/B原件与扫描时限不改。不生成“从现在起再5小时”的旧事实；未来新准备快照最多5小时，整轮拟最多60分钟/目录10分钟，只有准确代码/当前事实与最早期限预留充分才生成writeBefore/执行SHA，当前二者均null。额度或等待导致过期不自动刷新、构建、重新登记或恢复。

后继风险已集中列入JSON：ECR/GitHub/审计存储费用与部分遗留；固定PAT/OIDC凭据及archive进入云端内存/私有磁盘；owner配置全文件进内存/提供者日志与较宽ADMIN权限；两行及跨服务非原子/并发/提交不明；固定槽不自动复位/重试/回滚/删除。不修改Key/Secret/IAM、业务/图片/实例绑定、运行状态或超时；当前云持久化与实例初始化仍由步骤4另审，不能让目录采纳替代这些真实证明。

**本轮交付到此：集中草案、准确A/B策略/ID/原件绑定和最小缺口已齐；实际新读取/发布/登记均0。下一只待用户确认上述最小引导入口的编码/测试方向。** 不先调用新读取、不恢复环境，不重装一次性身份或扩支线；通过后仍按同一草案收口一份真实操作SHA，不再并行增加手册/框架。

<a id="d2-6-bootstrap-implementation"></a>

### 13. 初始A发布与B候选目录最小入口：仅代码、离线回归与无AWS CI

用户另准本轮仅完成最小接线、回归和CI，不新增生产读取或实际操作。第12节的两个入口缺口现已编码；不是恢复环境、初始实例绑定、runtime启用或真实ECR/SQL结果。既有身份、SQL schema、Secret、日常workflow三输入及其active/initialized/持久化资格门槛保持。没有读取本机`.env`/PAT/PEM、AWS Secret、既有数据库/资源或两份真实ZIP/回执，也未重新构建A/B。

#### 13.1 初始A：仅单app发布，不伪造实例或打开daily runtime

- [`bootstrap.ts`](../ops/releases/bootstrap.ts)只提供有界合同/派生/编排；发布意图只有review/job、准确A源/摘要/tag/截止时间，没有虚构的instanceId、currentRelease或CFN计划。
- [`instance-release-bootstrap.ts`](../scripts/instance-release-bootstrap.ts)与[单job工作流](../.github/workflows/instance-release-bootstrap.yml)复用原单app publisher、原ZIP/自检/扫描/ECR字节校验、现有OIDC/本人environment核验和已安装publisher身份。只加载/inspect/tag/push原A，拒绝已占tag，不build/run应用或发布B，不访问控制数据库、CFN/ECS/RDS。
- 新入口仅读[`bootstrap.review.json`](../ops/releases/bootstrap.review.json)，提交值为`enabled=false`。默认/check/关闭态publish在获取认证前返回；实际daily [`runtime.json`](../ops/releases/runtime.json)仍false/environments={}，原`instance-release.yml`的LF SHA继续`b31f33aed8a000876385e1cf8a0001d3e1157bc8ea7863002262600b509fadff`。
- 后继启用必须另有准确review SHA、原A/B候选摘要、代码文件指纹、真实事实/原件截止、本人批准的准确GitHub run及OIDC绑定。review只含候选摘要/来源元数据，不把ZIP或原receipt正文写进仓库；publisher在受保护job中取回准确A原件后复用原验证器，正常同审批晋升仍保留更严格的完整files比较。
- intent/push/published最多3次条件审计PUT，S3 ACK中的准确key/VersionId/body SHA被保存；成功与部分失败都留小回执，未知不重推。无需旧app+lifecycle Grant、生产build workflow、本地Docker、新IAM或资源到期逻辑。此工作流仅manual dispatch，代码push不会调度它。

#### 13.2 目录：A ecr_verified＋B candidate，原事务与新鲜独立连接

`catalog-transaction.ts`保留原已验证版本路径，只添加`writeCatalogCandidate/inspectCatalogCandidate`，复用原`registerReleaseCandidate`及相同owner临时SET/INHERIT关闭、目标OID/身份、提交不明和不可变INSERT管控。不新增数据库对象或DML授权，不把B伪装为ECR版本。

原[`instance-release-import.ts`](../scripts/instance-release-import.ts)只加两个模式：

```text
node --experimental-strip-types scripts/instance-release-import.ts prepare-bootstrap <私有input.json> <新私有review.json>
node --experimental-strip-types scripts/instance-release-import.ts register-bootstrap <私有review.json> <准确批准SHA>
```

input包含原BootstrapReview及其SHA、来自认证固定S3版本的A真实publication结果、已核验完整B StoredReleaseCandidate。prepare只本地重建manifest/config关系及原候选，不自行采集/发布、读取配置或连接数据库；结果未自动获准。外层实际操作批准未来只有明确覆盖固定派生和登记范围时，才允许使用运行时派生登记SHA，不以调用prepare当成写授权。

register先核对批准SHA、当前代码、私有输入raw SHA及完整派生，再创建一次性私有attempt；之后最多读取配置1次、验证TLS连接2条/SQL64/INSERT2行。writer分别提交A/B后关闭，再新建inspection连接核验两条完整原文；连接参数复用已修正的纯`installationConnectionOptions`。A失败/未知就不尝试B，只有已批准的独立回读；已知写与核验结果即时保存，不能用回读匹配把未知COMMIT改成成功。角色临时成员写和宽owner ADMIN风险照旧，非原子/并发及部分A/B结果如实保留；不UPDATE/DELETE、复位/重试/自动清理或写实例绑定。

#### 13.3 本轮代码验收与明确停止点

新增8组现有测试体系回归覆盖：关闭态早退/环境canary；review/源码/角色/不同A/B/期限；无实例A发布及真实manifest派生；未知审计/推送不重试；原publisher摘要路径/占tag拒绝；两连接/SQL64及未知A/B提交/冲突；仅manual本人environment工作流；目录prepare本地完成和错误SHA在配置/attempt前拒绝。相邻本地全组239项中238通过、0失败、1项原Linux ZIP实测本机skip；lint及完整类型检查通过。

原无AWS CI仅扩现有测试/路径/lint列表；同一CI的全新PostgreSQL16增加非超级用户两连接A/B实测，核对owner权限关闭、B候选冲突不变及独立完整回读。不连接本地/Neon/Aurora或把CI数据库测试算生产安装。

**准确CI已真实完成：** main/push/attempt1源码`b1e1ebd773e2b110129a2307bfcb55aae52bbaa5`的[run44139556595](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44139556595) completed/success；offline job134238283132：239pass/0fail/0skip、Linux原ZIP测试/lint/类型通过；postgres job134238283664：10pass/0fail/0skip，含新非超级用户A/B独立连接/owner闭合测试。两job全部报告步骤成功，已认证核对准确run/步骤/原始日志和摘要；最终CI核对GitHub GET8＋日志blob2/helper1，两轮代码CI合计GET16/blob4/helper2，无生产读取或云调用。[去敏CI回执](aws-instance-release-bootstrap-code-ci-20261117.json)保存原日志SHA/计数，不提交原日志、凭据或业务内容。本机唯一skip已由准确Linux CI闭合，不再要求一轮同类测试。

首个实现提交6ca3c1e/CI44138581747也已全部成功；之后仅调整新增CLI测试，使未来另审启用review时只验证无效批准被拒绝、不会实际发布或误拒合法数据配置，最终b1e1ebd/CI44139556595再次全过。两轮原日志摘要/准确来源均保留在同一去敏回执，不把旧观察改写为新观察，没有改实际关闭态配置。

本轮已完成准确CI，到此收尾；下一回到同一集中草案更新实际代码指纹并另审必要最小生产补核/发布/登记，不扩框架、重复盘点或启动收费环境。`d2-6-publication-catalog.prepared.json`保留其编制时旧代码/缺口沿革，不能直接执行或用它的旧指纹启用新代码；没有给任何原事实、产物/扫描或旧执行期限续期。新BootstrapReview与真正daily runtime仍均关闭，旧两份构建原件/九图输入/安装证据未读写，未实际调度初始发布、登记目录、写绑定或恢复环境。

<a id="d2-6-publication-read-stopped"></a>

### 14. 获准的最小只读核对停在Source首次请求：不归因登录过期、不自动重试

用户另准既定STS1/AWS元数据11/GitHub GET10。本轮仅本机核对新代码15项指纹、沿用原安装的JSON键排序摘要算法后，在新a记录执行；18:32:10.083–18:32:11.495Z，首次官方ca-central-1 STS CLI调用返回通用`AWS_CLI_UNAVAILABLE`，尚无IAM身份响应。按范围立即停下，[去敏回执及5份私有记录指纹](aws-instance-release-publication-preflight-stopped-20261117.json)已保存。元数据、GitHub/helper、Secret值/配置/PAT/PEM/ZIP/数据库/写入/云执行槽/dispatch/恢复均0，不能自动消费未用额度。

随后只本地`Get-Command`与`aws --version`证明命令存在于D:/Amazon/AWSCLIV2/aws.exe、版本2.36.19；这两项没有STS/网络/认证读取，也没有证明原失败就是会话过期。没有修代码、换身份、重放a、追加AWS调用或改变原期限；新BootstrapReview和daily runtime仍关闭，原件/CI结果保持，不生成虚假的可执行发布SHA。

原提案后已获准并完成单次诊断：新b于2026-11-17T18:39:35.477–18:39:36.808Z执行固定Source/官方STS，CLI安全分类为`LOGIN_REFRESH_REQUIRED`、退出255；没有HTTP/身份响应，原始错误和凭据未保存，[回执](aws-instance-release-publication-source-diagnostic-20261117.json)。未继续任何11/10对象，两轮计Source尝试2/成功0，其余读取、写入和执行槽仍0，a/b全部保留。没有把未知HTTP状态/网络次数编造成已取得AWS响应。

下一只待用户自行运行`aws login --profile techlong-sandbox-user`并允许新一轮STS1＋原未用11/10，只读身份正确才继续，失败即停；不要发送验证码/凭据。当前不再追加诊断或修代码，不重做已通过CI/构建，不授权发布/登记/恢复，不延旧事实或原件期限；成功后直接收口原集中审批。

<a id="d2-6-publication-read-verified"></a>

### 15. 新c最小只读全部通过：直接收口真实A发布/A-B登记集中审批

用户明确刷新Source并准新一轮STS1＋元数据11/GitHub GET10。[c真实回执](aws-instance-release-publication-preflight-verified-20261117.json)18:46:21.274–18:46:40.789Z通过，helper1；准确IAM身份、原publisher角色/trust/唯一v1策略、IMMUTABLE仓库、固定token版本、S3版本控制及本人environment/main/OIDC均匹配，A目标tag与候选全局push槽不存在。未扩大对象、重试错误或追加诊断；a/b保留。Secret值/配置/PAT/PEM/ZIP/SQL/云写/执行槽/dispatch/恢复均0。

复用原两份验证回执（原raw SHA一致）及产品策略重新seal，A/B ID/candidate/完整StoredCandidate SHA保持；15项代码与准确CI一致，既有BootstrapReview验证通过。没有新实现/回归或重读ZIP。已备[唯一可审批外层JSON](../ops/releases/d2-6-publication-catalog.review.json)、本机准确内部review以及[完整步骤/调用上限/风险](aws-instance-release-initial-publication-review.md)；旧prepared草案继续保留，不当新执行合同。

外层只覆盖本次单A镜像、A ecr_verified与原B candidate两行，准确review数据main激活/关闭，单次本人GitHub environment门禁，已验证函数按真实A proof确定性派生内部登记SHA并一次运行。只有外层另批后才可读固定Secret/配置、dispatch/push或SQL登记；不先执行，不给B预推、不重装权限/身份，不恢复、绑定或启用daily runtime。真实registry/platform digest尚未知，只能由实际manifest派生；兼容/持久化准入保持后续门槛。

新事实五小时自18:46:21.276Z至23:46:21.276Z；集中执行最多60分钟，最晚22:46:21.276Z（温尼伯16:46:21）启动，内部登记最多10分钟且不越共同截止。它不是资源自动到期，也不延期旧扫描/产物或数据库事实。本轮仅准备，到此停在请求准确外层审批；无实际发布/登记/恢复，真实更新仍0/2。

<a id="d2-6-publication-catalog-observed"></a>

### 16. 原步骤3真实收口：A发布、A/B登记及独立核验全部通过

用户批准外层SHA126422f9…及完整风险，19:03:34.191–19:10:45.068Z约7分11秒完成。[去敏实际回执](aws-instance-release-initial-publication-observed-20261117.json)保留准确原件、状态、S3引用及计数；[run44154605425](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44154605425) main/manual/attempt1、源码8a04a48…、用户本人environment批准后success。代码仍原b1e1ebd对应15指纹，未重构建、改正式实现/工作流/权限或恢复环境。

- A `release_00b9c5cfa6bceedc5fd05aa451dca811`已发布到原准确tag；真实root/platform digest同为 `sha256:a6213e0f567538bb658c13c63edb1439b80c5f9a55a2add7301d61fced5377c0`，不是原config digest。原始manifest通过既有校验器，精确S3 published/intent两版本及SHA、run/source/候选绑定独立回读通过，未额外查询当前ECR。
- 固定规则派生内部登记SHA `46964e21239addb0287de17e173dd67150d158f2883dcede7770ea640f3f7e4b`，外层已委托且未另扩范围。A实际REGISTERED/ecr_verified；B `release_afcc95f9eaa20785265300c801fd7618`实际CANDIDATE_REGISTERED，完整候选SHA仍910246ac…、未下载/推送B。单writer两事务及新TLS inspection两事务全过，均证明临时owner SET/INHERIT关闭；创建者ADMIN保留。实际配置读1/TLS2/SQL52，目录INSERT2，业务/实例绑定写0。
- 首次私有wrapper在模块加载阶段引用不存在的umbrella包，尚无请求/attempt，改用项目已安装同名provider导出并保留安全记录，不新增依赖/正式代码。原单次POST返回HTTP200后，被本地204-only条件误拒；停止/意图不覆盖。用户明确另准helper1＋原剩余33 GET后只继续这一run，不发第二POST/不Re-run，原deadline不延。
- 最终Source STS2、GitHub GET11/helper2（其中1另批）、run状态轮询3、门禁读1、proof ZIP1、固定S3 GET2。发布审计3项条件写均有VersionId/SHA，真实A单镜像发布，旧push槽不复位；云底层层/manifest请求数不冒充一次API写，也未额外查询提供者调用计量。
- 引导review恢复原disabled；daily runtime仍关。不改IAM/Secret/schema，不连Aurora/迁图/做业务验收、不恢复收费环境；原件/a/b/包装器停止/永久槽保留，无自动回滚/清理。外层原JSON不改为已执行，实际结果单独记录；真实D2更新仍0/2。

下一只准备原步骤4：复用A真实digest及A/B目录、原九图输入和兼容提案，集中明确必要恢复、持久化/兼容证明、初始实例A绑定和runtime启用。实际新读取/恢复/媒体或SQL/配置操作另审，不先恢复等待材料、不重做第3步或身份安装，不扩Full/媒体工具/新部署框架。A已发布镜像不因构建ZIP到期自动消失；B仍须原artifact在11月18日16:45:19Z前有效且扫描符合原规则，旧日期不延。

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
