# D2-6：app / lifecycle 候选构建最小隔离方案

2026-11-14，America/Winnipeg。状态：**最小编码与三条准确CI均已通过，构建隔离完成；未启用发布或部署**。以下方案正文保留编制时的范围，文末记录后继实施结果；平台运行合同仍未修改。这是原D2“已有实例API版本更新”的构建前置收口，不新增部署工具、数据库对象或阶段分支。

## 目标与当前事实

app（买家/商家共用API）和lifecycle（数据库初始化/恢复工具）是不同镜像，应分别取得自己的构建成功和安全证据。日常API更新不使用lifecycle，不应要求它同时通过；但lifecycle仍须通过自己的完整检查，才能成为合格工具镜像。

方案编制时后端源码为`fe8273899d4251267666807cf965ce52970a13e9`。准确候选run43627155229中app job已成功、OS HIGH0/CRITICAL0并保存checked-app；lifecycle失败使整个run为failure，平台因此正确拒绝这个app来源。61条lifecycle结果已经归并为Kerberos56、SQLite3、旧zlib2；本方案不裁剪这些功能、不删除库存或增加漏洞例外。[上一轮原证据](aws-instance-release-app-zlib-fix-ci-20261114.json)保持。

当前源码确认两处固定来源：

- `ops/releases/import-source.ts`按`backend-image-candidate.yml`查询成功main构建，选择原attempt1。
- `lib/deployments/releases/production.ts`要求准确仓库/主仓库main、同一路径、原attempt1、整个run completed/success，再核对app原ZIP/回执/扫描；没有只看某job成功就放行的分支。

因此最小做法是**保留app原工作流路径，移出lifecycle构建**，而不是放宽平台对失败run的拒绝。

## 确定采用的编排

| 工作流 | 触发方式 | 唯一构建内容 | 成功的含义 |
| --- | --- | --- | --- |
| 原`.github/workflows/backend-image-candidate.yml` | 保留现有main push和workflow_dispatch | 仅app / Dockerfile | app自身所有构建、自检、安全、回执及上传步骤成功，整个app run成功 |
| 新`.github/workflows/backend-lifecycle-image-candidate.yml` | 首版仅workflow_dispatch | 仅lifecycle / Dockerfile.lifecycle | lifecycle自身所有检查成功，才能保存合格lifecycle候选；失败继续保留扫描诊断 |

两个独立run，没有needs、workflow_run接力、跨工作流成功聚合、continue-on-error或容错发布。原app可保留单项matrix，以复用既有`${{ matrix.kind }}`编排，避免大幅改步骤；lifecycle也是固定单项，不提供任意kind、Dockerfile或下载URL输入。

app保留原文件名和现有工作流名称，来源路径/产物名不迁移。新lifecycle使用独立concurrency group，双方`cancel-in-progress:false`保持，不取消彼此运行。首版不优化app的既有路径过滤器，不新增缓存或可复用工作流框架；lifecycle仅手动是为避免每次API提交都重复运行已知失败的工具构建。

## 严格保持的合同

1. 两条工作流继续仅`contents:read`，不增加OIDC、secrets、environment、ECR/包写权限，不运行迁移或部署。
2. 都保留原固定action SHA、ubuntu-24.04、25分钟job上限及`persist-credentials:false`。
3. 保留原npm high/critical门槛、真实容器隔离自检、各自原运行检查、Trivy版本/摘要/新鲜数据库、OS HIGH/CRITICAL零发现、可见库存和无例外规则。不因lifecycle失败就把它标为neutral/skipped/success。
4. 原构建/自检/扫描/记录/导出脚本不改，仍对准确kind/config digest/源码/run/attempt生成回执。app仍为`checked-app-{commit}-{run}-1`，lifecycle为对应checked-lifecycle。
5. 原四文件ZIP、SHA256SUMS、500MiB原ZIP上限、471859200字节镜像归档上限、候选1天/扫描诊断7天保留及48小时扫描数据库准入规则保持。准备快照5小时不等于给artifact或扫描续期。
6. 平台仍要求**整个app工作流run成功**，并继续拒绝失败/取消/未完成、fork/非main/重跑、错路径/错kind/过期或错摘要产物。平台不接受新lifecycle工作流作为tenant_api来源。

`production.ts`、`import-source.ts`、同审批晋升器、日常版本更新workflow、SQL/IAM/Secret/runtime配置都**不需要运行修改**。不新增来源路径白名单，不把历史失败run43627155229改成合格，也不把新工作流语义追溯套在旧run上。

## 精确拟改文件

此表是后继编码范围，不是本轮已修改内容。

| 仓库/文件 | 拟改范围 |
| --- | --- |
| 后端`.github/workflows/backend-image-candidate.yml` | matrix只保留app，其他步骤/门槛保持 |
| 后端`.github/workflows/backend-lifecycle-image-candidate.yml`（新增） | 复制原lifecycle编排为独立手动工作流，固定lifecycle与独立concurrency；复用原脚本，不添加执行框架 |
| 后端`test/image_candidate_workflow.test.js` | 把“同一workflow含两kind”改为“每条workflow恰为自己的kind”，核对生命周期仅手动、双方无云身份/发布及固定actions |
| 后端`test/image_security_gate.test.js` | 对两条工作流共同验证原OS门槛先于导出、无忽略/失败放行，原漏洞回归保持 |
| 平台`tests/instance-release-production.test.ts` | 仅在原错误来源测试表增加lifecycle新路径拒绝例；不改验证器或新建测试框架 |
| 平台文档/手册 | 记录新源码、准确CI/候选run及旧双镜像入口的限制 |

不会改app/lifecycle Dockerfile、依赖锁文件或工具链；不会为本方案修复61项、重做业务测试、改UI或启停工具。两个仓库均沿用main，不新建分支，后端用户`.vscode/settings.json`保持不提交。

## 旧双镜像发布器的明确影响

后端`scripts/publication/reviewed-ecr-publication.js`和`inspect-checked-candidates.js`仍要求**同一原工作流run内的app＋lifecycle两份证据**。拆分后的新app run只有app，不能直接供这些旧入口使用。它们应继续因缺少双产物而拒绝，不伪造组合索引、混用不同run或放宽原manifest；历史原件、固定清单和验证器不改。

这是明确的兼容性取舍：本轮只恢复D2已有的单app发布路径，不再为旧固定双镜像发布入口生产新的双产物run。若未来仍要使用该旧入口，需要另行设计双来源绑定；不把它加入本次必做项，也不假定旧AWS权限仍可用。旧历史合格版本不因本次文件变化自动撤销；新取证只能按各自产物原始来源及有效期处理。

D2已有同审批晋升代码明确不调用旧双镜像发布工作流，使用单app归档，所以无需为这一取舍扩大IAM或再造发布器。未来新租户开通若需要lifecycle，必须先取得合格lifecycle镜像；本方案不宣称该能力已修好或允许使用未通过的镜像。

## 后继一次编码、一次核验的顺序

1. 用户确认编码范围后，一次提交上述后端编排/原测试和平台必要回归/文档；不分拆成新的固定任务支线，不手动dispatch或Re-run旧失败。
2. 本地只运行相关静态/合成回归及类型检查；平台仍默认关闭。工作流有改动，所以正常后端main push会产生**新的app-only候选run**；新lifecycle手动工作流不在本轮触发。
3. 核对准确源码/原attempt1的Backend CI及app候选：全部步骤成功、原扫描HIGH0/CRITICAL0、原app归档正确保留、整个run success。平台原CI须证明新lifecycle路径及原失败run仍被拒绝。不得仅用“YAML看起来正确”或局部job成功结项。
4. 若app或合同回归失败，保留新失败，不自动重跑、降低门槛或再扩修其他模块。若都成功，仅据新run准备后续真实来源材料；本轮不读取PAT/Secret或下载镜像ZIP、不写目录/SQL、不发布ECR，不安装身份/恢复/部署。实际取证与安装/版本更新继续按准确范围另审。

技术成功的判据是：lifecycle不运行或失败都不再影响**另一个app run**的结论；与此同时，lifecycle自己的失败仍不能生成/发布合格工具镜像，任何失败app run也仍不能导入。

## 方案编制轮的交付及停止点（历史）

该轮仅只读本地源码/原证据并完成本文与手册；没有修改后端或平台运行代码/测试/工作流，没有GitHub API或AWS调用、私密配置/值读取、数据库连接、构建调度、安装/恢复或云发布。文档提交/推送沿用既有授权，文档不重复跑CI。当时的下一唯一动作是确认上述最小编码范围后实施，不重新盘点过期AWS快照或打开收费环境等待。

## 后继已批准的编码实施

用户随后明确要求按清单编码并验证CI。后端源码b9ca2138738900afc23a6a2ddce141b37a1f0a31已推main：原工作流仅删除lifecycle matrix两行，新独立手动lifecycle工作流保留原执行步骤，仅改名称/触发/并发组和自己的单kind；原两测试按方案改动。一次本地逐字节核对证明两工作流steps段与拆分前原稿一致；原Dockerfile/依赖/脚本/门槛和旧发布器未动，用户.vscode未提交。

旧编排在更新后的相关测试上先得到7通过/4失败，确认测试能检出旧双kind与缺失新文件；拆分后相关23项全过/skip0，后端类型检查通过。平台只在原错误来源表加入独立lifecycle路径；定向29项本地28通过/1 Windows ZIP skip、lint和全项目类型通过，Linux CI验证该ZIP路径。production.ts/import-source.ts、runtime/SQL/IAM/Secret及部署workflow原字节保持。

当前只按正常main push核验准确后端Backend CI、app候选及平台原无AWS CI；未手动dispatch新lifecycle工作流，也不Re-run旧失败。准确run/结论完成后另记，不把本地静态通过当成实际构建成功；无生产读取、AWS、私密值、目录写或发布/恢复/部署，D2-6真实更新仍0。

## 准确CI最终结果：隔离完成

[去敏源码/run/job/扫描和产物引用](aws-instance-release-candidate-isolation-ci-20261114.json)。以下全部是对应源码的原push/attempt1，不是文档HEAD的CI，也不是重跑：

| 仓库/源码 | 准确run | 实际结果 |
| --- | --- | --- |
| 后端b9ca2138738900afc23a6a2ddce141b37a1f0a31 | [Backend CI43630231573](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/43630231573) | completed/success；322测试/0失败/0跳过，14项Python，容器构建/启动smoke成功 |
| 同一后端源码 | [app候选43630231572](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/43630231572) | 整个run completed/success，只有app job；全部自检/扫描/保存成功，OS HIGH0/CRITICAL0 |
| 平台4dfb7cee3695be92e22f8a51f3702fdf0dd61dc8 | [无AWS CI43630305302](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43630305302) | completed/success；Linux180及原生PG16共9项全过/skip0，lint/类型成功，含新增lifecycle路径拒绝例 |

新app候选artifact14128140862：`checked-app-b9ca2138738900afc23a6a2ddce141b37a1f0a31-43630231572-1`，72,663,114字节，GitHub ZIP digest为6d1214fad4c035175b389b5f2920397bea99ec33bb6dd932e74f000a38b1e152，到期2026-11-15T19:07:00Z；仅回读准确元数据，未下载ZIP/核对原包内容。config digest为c894fe72…，与原始扫描/构建日志绑定；不能当作ECR manifest digest。另有准确os-scan-app诊断，没有lifecycle产物或该源码lifecycle运行。新手动工作流未调度，旧61项没有因此被修好或发布。

平台验证器/采集器/runtime/发布workflow与原方案基线逐字节一致。旧失败run仍不合格，旧双镜像发布器的同run双产物要求未放宽；只是新的app工作流能够独立形成整体成功。至此构建隔离任务完成，不再扩工作流、框架或工具链。

下一回到原D2-6：根据这份新成功候选准备准确的原件读取/验证和既有一次性启用材料；实际ZIP读取、目录登记、LOGIN/Secret/IAM/SQL安装、恢复或ECR/版本更新均按范围另审。本轮没有这些副作用，runtime仍关闭、真实更新0，旧AWS/Neon事实不续期；不要再重复构建或启动收费环境等材料。
