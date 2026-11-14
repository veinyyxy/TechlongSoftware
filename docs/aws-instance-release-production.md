# D2-5：正常构建产物进入版本目录（已有ECR路线）

2026-11-13，America/Winnipeg。状态：离线接入代码/回归已实现，生产采集/目录写入未启用。沿原方案优先使用已有ECR版本；**没有实现或启用“同一次部署审批内自动晋升未发布候选”**。本轮不改旧固定发布器、不新增发布工作流/权限/实例分支，不恢复环境或安装数据库对象。

## 本轮交付

正常后端构建产物 → 原ZIP/四文件/自检/扫描绑定 → 独立产品候选 → 已发布镜像的原始ECR回读 → 不可变SoftwareRelease → 既有D2-4实例选择与ImageUri更新流程。

| 文件 | 职责 |
| --- | --- |
| [production.ts](../lib/deployments/releases/production.ts) | 原构建合同到候选；ECR原始manifest/config验证；现有元数据端口上至多两次按digest读取 |
| [catalog.ts](../lib/deployments/releases/catalog.ts) | 注入式管理员目录导入：一条参数化INSERT/ON CONFLICT，不覆盖旧版本，不让运行角色自行标记版本可信 |
| [build-artifact.ts](../ops/releases/build-artifact.ts) | 明确本地原ZIP及新输出目录，流式校验字节/大小；没有下载、凭据加载或Docker调用 |
| [extract-build-artifact.py](../ops/releases/extract-build-artifact.py) | 复用原后端四文件解包合同：固定文件名/数量/大小，拒绝路径和symlink，不覆盖已有目录 |
| [production回归](../tests/instance-release-production.test.ts) | 正常来源/字节/镜像/不可变登记与两个实例复用；Linux CI验证真实ZIP解包 |

没有修改runtime配置、原九函数/NOLOGIN权限、已安装SQL、部署job或CFN更新/验收算法。新目录写入口不会被现有CLI/工作流自动调用，也不读取本机owner连接信息；首次真实采集、版本导入和未来自动采集者的权限/接线均须另审。源码和内存合同模型不等于已接入生产。

## 复用的真实产物合同

本轮读取本地服务端工程已有文件，不调用其GitHub/AWS：

- `.github/workflows/backend-image-candidate.yml`：main上的push/workflow_dispatch，app和lifecycle分别构建/自检；记录本轮仅接受app，不把数据库初始化工具当租户API。
- `scripts/ci/record-image-candidate.js`：BUILT_SELF_CHECKED_NOT_PUBLISHED、sourceCommit/runId/runAttempt、imageConfigDigest、selfCheck和osSecurityScan。
- `scripts/publication/extract-checked-artifact.py`及`verifyCandidateFiles`：准确四文件ZIP，SHA256SUMS只列image.tar.gz、candidate-receipt.json、self-check.json三份。

候选必须来自准确仓库ID/主仓库main、指定成功workflow及原attempt1；artifact必须属于同run/源码/仓库，名称为正常的checked-app-{commit}-{run}-1，未过期，原ZIP digest和大小匹配。原ZIP最多500MiB，镜像归档最多471859200字节、小文件各64KiB。先验原ZIP，再解包/流式计算归档摘要，再核对原文receipt/self-check及准确三项校验和，不重序列化JSON冒充原始字节。

`buildReleaseCandidate`接收的GitHub run/artifact元数据必须由未来经认证的来源读取器取得；原ZIP digest不是签名，也不能靠自己填repo/SHA字段证明来源。本轮没有实现跨仓库token、扩大GitHub App范围或下载真实artifact。[GitHub artifact返回字段](https://docs.github.com/en/rest/actions/artifacts#get-an-artifact)。

APP smoke仍要求非root、linux/amd64、health200/离线ready503/无云变更；Trivy的HIGH/CRITICAL零发现、准确scanner/数据库/报告摘要、无忽略项和原48小时数据库年龄规则保持。Node/scanner版本来自经审产品策略，不把它们硬编码成新的发布代次。只投影固定来源/技术字段，环境/密码/额外canary字段不进入候选或版本输出；不因receipt自称baselineApproved/runtimeEnabled而授予能力。

Express/Full配置、schema/client API兼容、端口、无迁移/无启动写由**受审产品版本策略**明确声明，不从smoke或镜像能启动推定。策略不是任意工作流输入，更不是在线业务验收证明。

## 三种digest保持分开

候选只保存构建得到的Docker image config digest，没有虚构registry/platform digest，也不直接成为可执行ImageUri。已发布镜像须按准确digest调用原ECR BatchGetImage端口：验证账号/仓库、唯一返回、原始manifest字节SHA和imageId一致；单manifest的config必须等于已检候选config。

若根是OCI index，只接受一个linux/amd64子项，再按该子digest读取一次，验证子manifest原始SHA及config。最终SoftwareRelease分别保存根manifest digest和实际平台manifest digest；config digest不充当其中任何一个。版本源artifactSha256为原GitHub ZIP摘要，image verification摘要还绑定归档/receipt/scan及上述registry关系。[ECR BatchGetImage合同](https://docs.aws.amazon.com/AmazonECR/latest/APIReference/API_BatchGetImage.html)。

初次候选验证/登记前继续遵守artifact和安全数据库的原有效期，ECR元数据沿用五小时事实规则；不改写时间或加资源TTL。候选字节、安全扫描、原GitHub元数据和ECR原件须由获准采集者封存，不能只留SHA冒充原件。已登记的不可变版本不会因为原artifact后来过期而自动撤销或每次部署重建；后续资格/撤销与实际部署前ECR检查仍由原目录和准入流程负责。

## 不可变登记与正常更新的关系

releaseId由product/component/version确定，不绑定实例；相同版本不允许用新构建、不同digest、不同来源或不同兼容声明覆盖。先原子INSERT，唯一键冲突后只读比较完整原文；完全相同返回ALREADY_REGISTERED，任何差异/已撤销版本都拒绝，不UPDATE/DELETE或复活旧行。写ACK丢失返回RELEASE_PERSISTENCE_REQUIRES_READBACK，没有自动重试或“已回滚”推定。

此端口只供未来另审的管理员/目录采集身份使用，不授予planner/executor/verifier表DML；不新增SQL函数、表或第四套账本。并发由既有主键和product/component/version唯一约束决定，不先SELECT再无条件覆盖。首次实际导入仍需明确记录数/原件/权限/独立回读范围，不能将本轮代码批准当数据库写入许可。

现有安装者对owner的SET/INHERIT已关闭，尚未安装专用目录写入LOGIN；本模块不会自行重新GRANT或读取owner凭据。未来导入批准必须明确管理身份/必要授权及关闭收尾，不能直接把这个函数交给日常executor并假装已有权限。隔离PG的目录测试由CI管理员切换owner执行，不证明现有Neon安装者现在就能写目录。

登记后D2-4仍只接受已验证releaseId；候选或未发布镜像不能绕过原planner。相同SoftwareRelease可供两个不同初始化实例生成各自的仅ImageUri更新计划，不复制材料或改代码；停止环境仍拒绝发布，不隐式恢复。

## 本轮明确没做的晋升与启用

现有`backend-reviewed-ecr-publish.yml`/发布脚本仍要求app＋lifecycle两镜像、固定发布范围和独立审批；旧publisher当前权限布局也未获本轮核对。不能直接从D2-4单job调用它并宣称同审批已经合并。`backend-ecr-publish.yml`另行构建推送，不等于原checked归档字节晋升；`backend-release.yml`的通用归档也不自带本合同的完整自检/扫描证据。本轮没有放宽这些历史入口或重新搭发布器。

同轮晋升是原方案的可选能力，目前尚未接入；需要另审准确单候选发布合同、跨仓库读取/发布权限及与审批/持久请求的绑定，不能把新获digest塞进旧已批准计划。**不为了可选晋升阻塞已有ECR路径，也不将本轮称为整项D2-5生产启用完成。** 实际构建/发布/导入、身份安装、恢复以及D2-6两次技术更新仍分别依后续明确范围进行，不重复买卖家业务测试。

## 验证记录与本轮停止点

新增14项离线测试：来源/ZIP/receipt/扫描拒绝、config与单manifest/OCI index映射、严格ECR只读调用、相同版本冲突/撤销/丢ACK、同版本用于两个实例的原计划器及原ZIP解包。Windows本地解包测试明确skip，在既有Linux CI使用Python标准库实测；不是本地Docker构建或真实GitHub/ECR读取。

既有PG16临时CI增加一个子测试，使用真实唯一约束验证管理员导入、相同原文重复登记、不同ID/字节冲突和撤销拒绝，不连接现有库。常规CI扩展原测试列表，未新增部署工作流/依赖。本轮只完成这些代码/CI和文档收尾，runtime始终false/environments={}；后继实际读取/凭据/SQL写/发布/部署均未授权。

最终证据：[源码5f697ff3e7ee85a7033ecc198021c109105493b3的CI43547953988](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43547953988) attempt1 completed/success，head SHA、两job/步骤及原生日志已核对。Linux共156测试全过、skip0，实际Python ZIP解包通过；原生PG16共8测试pass/fail0/skip0，含不可变目录导入子测试。[证据摘要](aws-instance-release-production-ci-20261113.json)。Windows本地156中155pass/1解包skip，不能把本地skip当成原件验证；上述CI弥补的是合成原ZIP和隔离库验证，不是真实后端artifact或ECR发布验证。

package测试列表变更也触发仓库其他既有push候选CI，未修改它们的权限/门禁；不能把这些自动CI称为本轮主动调度后端镜像构建或AWS部署。本轮只验收上述准确D2-5 run，不扩修其他流程。当前已有ECR路线离线代码到此结项；后续回到必要身份/目录权限和真实版本来源的集中受审准备，实际安装/导入/恢复/更新另批，可选同轮晋升不作为该路线的前置阻塞。
