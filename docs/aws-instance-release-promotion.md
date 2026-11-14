# D2-5：同审批自动晋升已检查的 app 候选

2026-11-13，America/Winnipeg。实现范围：**代码、独立 SQL 草案及无 AWS CI**。没有读取真实构建/凭据、安装权限、发布镜像、恢复环境或调度部署。部署仍由用户本人批准 GitHub environment。

## 用户可见流程

仍使用原 `Instance API release`，输入仍只有 `instance_id / release_id / environment`。`release_id` 可选择已有 ECR 版本，或提前受审登记的 checked app 候选；不接受任意镜像 URI、下载 URL、Docker 命令或策略 JSON。

```text
选择已登记候选和实例
  → prepare：检查来源、兼容性及运行中的原环境，输出候选＋更新约束摘要
  → 用户批准该 run 的唯一 techlong-sandbox-deploy environment
  → 同一 job：重读基线 → 原 ZIP/自检校验 → 至多一次推送 → ECR 原文核对
  → 窄目录确认 → 再读原基线 → 派生仅 ImageUri 的计划
  → 原更新器 → 原独立进程/身份核验 → 原 CAS 结果回写
```

不调用旧的 app＋lifecycle 双镜像发布工作流，不增加第二个发布/部署门禁，不安装本地 Docker Desktop。Docker 只在 GitHub runner 加载/检查/推送已构建归档，不 build、不 run 应用、不做业务验收。

## 审批前不伪造 digest

审批前已有：源码/run/attempt1、原 ZIP SHA及大小、归档/receipt/扫描摘要、Docker config digest、产品/版本/兼容声明、准确 ECR 仓库和正常不可变 tag。此时可能还没有 registry manifest digest，不能拿 config digest 或占位值冒充。

[promotion.ts](../lib/deployments/releases/promotion.ts)生成独立 `ReleasePromotionIntent`：绑定准确 job、候选 SHA、实例绑定与源物理布局摘要、原期限、准确目标及一次 app push/一次 CFN Create/Execute 上限。摘要明确允许“从这些已批准原件，经 ECR 原文验证后派生 ImageUri”，**不是批准一个未知任意镜像**。

批准后 ECR 结果仍按原 `verifyPublishedRelease` 校验 config / 单 manifest / OCI index 与 amd64 子 manifest。只允许这份候选得到的 SoftwareRelease；不选择另一个构建、不重新构建或改变兼容声明。派生计划绑定原实例 revision、当前版本、模板/配置和实际资源；除 ImageUri 外继续全部 UsePreviousValue。计划 SHA由实际 digest 产生，S3派生回执与数据库 `approval_intent_sha256` 保留它到原批准意图的关系，不把这个新 SHA 假称为审批前已知。

## 候选目录与权限

`sealReleaseCandidate`复用原构建验证器，`registerReleaseCandidate`提供另审管理员的单条 INSERT 端口；仍使用既有 releases 表的 candidate 状态。正常流程先认证读取真实 run/原 artifact、校验原ZIP/四文件、明确产品策略，再登记候选。该端口不负责凭据加载，也不是自动扫描/采集服务；本轮没有登记真实候选，也没有把现有“仅采集已发布 ECR”的命令误说成可采集未发布候选。

候选原件封装不含伪造 image manifest/platform digest。实际 workflow 在审批后用固定 Secret 版本中的只读后端 token，重读准确 run/artifact（不选最新/替代项）、下载一次准确 ZIP并重新验证全部原字节。token只进内存，不交给 Docker；签名 blob URL不带 GitHub Authorization、不保存进回执。

[promotion.draft.sql](../ops/releases/promotion.draft.sql)为独立、未安装的增量草案；**不能重放原 schema/grants 草案**：

- releases 增加 `promotion_origin`，保存被晋升的原候选，不覆盖或删除历史来源。
- requests 增加 `approval_intent_sha256`，追溯同轮派生计划的原批准摘要。
- 增加 `read_candidate`、`confirm_promotion`、`prepare_promoted_request` 三函数，固定 search_path、撤销 PUBLIC。
- 新增一个 NOLOGIN `deployment_release_publisher` 组，只允许确认匹配的候选目录；无业务/表 DML、CFN 或请求准备权限。候选只能同产品/版本/来源/仓库/兼容声明确认一次；撤销或不同字节拒绝。SQL不连接 ECR，真实性仍依赖受保护的 publisher 和实际读取，哈希本身不是认证。
- 原 executor 仍不能确认目录，也没有普通 `prepare_request` 权限；只可用新窄函数准备由原 intent/run/候选派生的计划。原身份仍不能登记自己的独立核验结果。

安装身份暂开 owner SET并在同一草案提交前关闭；没有密码、LOGIN或 Secret/IAM 操作。运行时不用 owner/.env。本轮未修改原已安装三表九函数正文、旧三LOGIN/Secret/IAM精确材料或启停工具。

## 具体运行适配与副作用

[promotion-runtime.ts](../ops/releases/promotion-runtime.ts)复用原四文件解包和原发布器的固定 load/inspect/tag/login/push 次序，但只处理一份 app：

- 校验严格 IMMUTABLE 现有仓库，先查准确 tag；若已存在，仍需真实 manifest/config匹配，匹配时不推送。缺失时才 load原归档、检查真实config ID/amd64/revision标签、tag和一次push。
- ECR只读/auth至多8次；一次 push是命令/镜像上限，底层层上传及 manifest 写可能多次，**不是只写一次AWS API**。Docker可能内部执行网络协议重试，不声称所有底层请求恰好一次；应用不重新调用push。
- AWS临时凭据只给固定 AWS CLI；Docker子进程剥离 AWS/GitHub/数据库凭据。ECR密码仅stdin给login，Docker正常会把短时认证存到本 job新私有DOCKER_CONFIG；finally尽力移除准确 auth config，中断/移除失败时不能保证已清除。不删云资源，不将私有目录上传artifact。
- S3最多4次版本化条件 PUT：本请求intent、必要时候选全局push槽、published、derived。任一 ACK不明即停；全局push槽占用后不自动复位或再推送。镜像已存在且核验通过可复用，不因占槽就声称镜像失败。
- publisher用独立受保护 OIDC角色及窄数据库身份确认版本，再接回原 executor。一个 GitHub job可取得这些分工身份；这是代码/凭据分工，不冒称对被攻陷 runner 的绝对隔离。

SQL/目录确认之后再核对实例基线，非原子不意味着可以跳过漂移。push后若实例停止、role/物理ID/参数/配置或revision变化，保留镜像/候选沿革，CFN更新为0。ECR发布失败/回读不明、目录提交不明、S3不明均不进入CFN，也不自动删除、补齐或重试。

原部署失败/回滚/提交不明仍走既有结果分类及独立核验；不自动降级旧镜像、还原数据库或启动停止环境。已发布镜像、未完成层上传、S3审计对象、目录确认或收费资源可能留存；CloudFormation正常托管回滚/旧revision清理、短时双任务、日志/提供者网络与费用风险保持。

## 开启前仍缺的实际依赖（不是本轮批准）

runtime全局仍 `enabled:false/environments:{}`；未配置 promotion。未来启用须集中审查真实资源/来源后一次备齐：

1. 真实候选登记与准确原件、实例绑定、图片持久化和运行资格；未初始开通/停止实例不能借晋升恢复。
2. 单独应用上述增量 SQL；publisher LOGIN、固定DB Secret及只读后端构建token的准确Secret版本。token只需准确后端仓库Actions read，不扩大现有App为全仓或赋予环境批准权。
3. 一个 publisher OIDC角色/边界，准确现有仓库的 DescribeRepositories/BatchGetImage/层上传/PutImage，必要的 GetAuthorizationToken、两准确 Secret版本读、既有证据桶固定promotions前缀条件PUT。不得授予CFN/IAM/RDS/ELB写；实际资源ARN/Key/OIDC trust仍须真实核对，尚无可执行安装SHA。
4. `ReleaseEnvironmentConfig.promotion`准确填写上述role/database/artifactToken/sourceRepositoryId/imageRepository。与原三操作身份区分，缺一就拒绝候选路径；已有ECR路径不强制增加publisher依赖。

上述是启用依赖清单，不是已经安装的资源。本轮不重新打开生产读取窗口，不修改runtime、更改GitHub environment或派发；之后真实安装/发布/恢复按具体范围另审。

## 回归范围

新增离线回归覆盖：审批意图无伪digest、运行/兼容/并发拒绝、S3/push/catalog未知不重试、发布后基线漂移及原期限、同job接回真实SDK内存CFN/独立核验/回写、具体Docker/AWS命令序列及凭据stdin/环境隔离、草案/单门禁结构。这里的Docker/GitHub/ECR响应是合成/注入，不是实际Docker推送或云发布证明。

原隔离PG16 CI增加真实publisher LOGIN：验证草案可由非超级用户安装、owner收尾、只有publisher可确认候选、只有executor可准备同intent派生请求、错误来源/期限/重放拒绝、原候选沿革和审批SHA保留。本地未有隔离PG时明确skip，不拿模型通过冒充数据库验证。后续准确CI回执另附。

## 已完成的准确 CI

源码 `2659d7a9c4f1d6ba589f8e596ffef463ca457d1f` 的 [CI43561305617](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43561305617) attempt1 completed/success，head/两job/各步骤和原生日志均核对。Linux171回归通过/0失败/0跳过，含原ZIP实测；PG16的9项通过/0失败/0跳过，含本轮publisher真实LOGIN及窄确认/准备权限。[机器摘要](aws-instance-release-promotion-ci-20261113.json)。原首个CI的数据库子测试因漏导入异常类而停止，仅补该导入后由新push验证，保留旧失败；不是生产SQL执行失败。

实际GitHub后端读取、ZIP下载、Docker load/push、Source/ECR、生产DB/配置/Secret/PEM、权限安装、部署或恢复均未执行。原三身份材料、已安装SQL和关闭runtime保持。本轮代码/CI至此收尾；下一只在用户要求时集中准备真实候选准入、缺失身份/增量SQL和准确启用范围，实际副作用仍另审，不自动补读/开环境。
