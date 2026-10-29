# 买家域名：验证 DNS 与现有 CDN 更新待审范围

**状态更新：本清单已由用户准确确认并执行，独立静态验收通过。** [真实结果与恢复入口](aws-buyer-web-domain-install-observed.md)。下方原范围/时限保留追溯，不授权重跑或后继后端操作。

遵守[执行手册](aws-auto-deployment-execution-runbook.md)，只衔接[已完成的证书单次申请](aws-buyer-web-certificate-observed.md)。**本文件本身不授权 DNS/CDN/CloudFormation 写入。** 本轮仅获限定只读许可；准确 SHA、请求文件、源码与时限以 `F:/ChatGPT_workshop/techlong-buyer-domain-install-20261029-a/prepared-verified.json` 绑定的 manifest 为准。不存在或核验失败即未完成准备，不得执行。旧 05:05 CDT 截止已过，不复用旧准备授权。

## 唯一目标与准确材料

把已发布的同一套静态产物接到 `https://buyer.sandbox.techlong.cloud`，不改产物、API 目标或 HMAC，不新增 CDN、桶、IAM 或后端。

- 既有栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-buyer-web-v1/71751190-d32e-11f1-9a09-06ffda7a3477`。
- 既有分布：`EDJYJUKAZ12BO` / `d3a0kml1xanzgt.cloudfront.net`；既有公开 zone `Z01473621BTTHKXBGOOEJ`。
- 证书：`arn:aws:acm:us-east-1:402010193138:certificate/68a43688-08d5-47c6-96c6-f48740b61caf`；只观察本证书，不重新 RequestCertificate。00:28 的 PENDING_VALIDATION 只作历史事实，当前状态须新核对。
- [准确验证批次候选](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-validation.candidate.json)：仅 CREATE 一条实际回读的 CNAME，TTL 300；不是 UPSERT，不覆盖旧记录或删除旧记录。
- [完整栈模板候选](../ops/aws-sandbox/cloudformation/buyer-web-sandbox-v1.domain.candidate.template.json)：由[原已测试差异](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-template-proposal.json)逐字段展开。证书 ARN 为无默认值的必填参数，执行清单只允许上述准确 ARN。

原六资源中，仅 BuyerDistribution 的 Aliases、ViewerCertificate、Comment 改动；其余五项资源包括 IAM/trust/boundary、桶/OAC/桶策略完全相同。增加 BuyerAliasIpv4 / BuyerAliasIpv6 两项 RecordSet 和一个输出，不改变原输出。A/AAAA Alias 只指向原分布，固定 CloudFront zone `Z2FDTNDATAQYW2`、EvaluateTargetHealth=false；HTTPS-only、sni-only、TLSv1.2_2021，禁止 vip 或新分布。

## 拟集中批准的执行顺序（尚未批准）

1. 按准确源码/请求/模板/证书原件 SHA、未过期事实、原栈 UUID、当前 ETag、公开 zone 与名称空缺作写前核对。Source 不可用、同名 DNS 已占用、证书漂移、栈忙或存在冲突 Change Set 即停止，不自动刷新或重试写。
2. 领取本阶段独立永久尝试槽后，最多一次 ChangeResourceRecordSets，准确 CREATE 验证 CNAME。保存 ACK，只在限定时长/次数内观察该 ChangeId 的 INSYNC 及准确证书 ISSUED。pending、超时或结果不明就停止；不申请另一张证书、不重发写入、不删除已成功的 CNAME。[Route53 事务与状态说明](https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html)。
3. 证书的账号、us-east-1、唯一域名/SAN、RSA2048、不可导出、六标签及验证记录都匹配且 ISSUED 后，最多一次 CreateChangeSet，类型 UPDATE，准确旧栈 UUID 和完整固定模板。显式承认证书参数及模板中原有命名 IAM 能力，但不允许 IAM 变化、宏、嵌套栈、自动导入或漂移回收模式。[CloudFormation Change Set 语义](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)。
4. 严格回读该 ACK 的准确 Change Set ARN、栈 UUID、模板、参数、执行状态和完整资源差异：只能 BuyerDistribution Modify / Replacement=false，以及 BuyerAliasIpv4、BuyerAliasIpv6 Add。任何其他资源/权限变化、替换、不明或截断均不执行。匹配后最多一次 ExecuteChangeSet，不直接 UpdateDistribution、不新建栈、不 DeleteStack/ChangeSet。
5. 有限观察栈结束后，以独立身份/读取路径核对原 UUID、原资源物理 ID、准确完整模板/参数、证书、CDN Deployed/单一 alias、A/AAAA 和验证 CNAME；静态 HTTPS 验收必须另在准确清单中列出次数/路径，不执行 JS、登录或访问后端业务。成功也只证明静态域名接通，不等于完整产品验收。

## 准确执行上限与时序（仍待新 SHA 确认）

直接写入总上限 **3 次**：验证 CNAME CREATE 1、CreateChangeSet 1、ExecuteChangeSet 1。CFN 还会托管更新原分布、创建两条 Alias；不能把这些底层写入混称为总共只有三次 AWS 变更。原五项非分布资源及其物理 ID/权限必须保持，不授予 IAM 变更或新资源替换权。

执行总上限：固定 IAM Source **STS 3、AWS 元数据 115、公开 DNS 4、无身份 HTTPS GET 2**。元数据分配如下，未使用额度不变成额外读取许可：

| 阶段 | 元数据上限与等待 |
| --- | --- |
| 写前现状检查 | 12：原栈/模板/六资源/空Change Set、CDN、证书/标签、zone及四类DNS名；成功后才领取槽 |
| 验证 DNS 状态 | GetChange 最多6次，间隔10秒，最多50秒 |
| 证书签发观察 | DescribeCertificate 最多21次，间隔15秒，最多5分钟；只接受准确证书ISSUED |
| 创建Change Set前 | 6：原栈/模板/六资源、CDN、buyer名、证书标签再核对 |
| Change Set创建观察 | DescribeChangeSet最多13次、间隔5秒、最多1分钟；最终一次完整响应核对三项差异 |
| Change Set模板 | GetTemplate 1，必须为准确完整候选及参数 |
| 执行前检查 | 4：原栈、CDN、准确证书、buyer名，并新STS身份核对 |
| 栈完成观察 | DescribeStacks最多41次、间隔30秒、最多20分钟；失败/超时不写重试 |
| 独立回读 | 11：原栈/模板/八资源、CDN/标签、证书/标签、zone/验证CNAME/buyer A与AAAA/NS；另新STS |

原栈、CDN的写前事实窗口不是跨服务 CAS；每个阶段只能使用固定资源与已知 ACK。独立读取为新进程和新 STS，不把 writer 的输出当验收。公开 DNS 最多4次核对两处递归NS与buyer A/AAAA；HTTPS最多2次，仅 `https://buyer.sandbox.techlong.cloud/` 和 `/manifest.json`，验证TLS主机名，禁重定向、不发送认证/Cookie、不执行JS或读JS/HMAC，正文仅本机计算摘要/大小、不提交GitHub。证据不完整或读请求失败即保留未知停止，不为凑齐成功自动重试。

原生 AWS CLI 固定2.36.19、官方 endpoint、显式profile/region、`AWS_MAX_ATTEMPTS=1`，不关闭TLS校验。DNS批次和CreateChangeSet请求正文逐字固定；ExecuteChangeSet只可从该次CreateChangeSet ACK派生准确ARN，保留固定栈UUID、固定client token、DisableRollback=false/RetainExceptOnCreate=false，不接受名称覆盖或外部参数。幂等token不是重放许可。

固定永久槽 `F:/ChatGPT_workshop/techlong-buyer-domain-install-v1.intent.json`，在本阶段所有新清单之间独立，不按 SHA 换槽；当前尚不存在。仅写前核对全过才独占领取，之后各写前仍保存独占提交意图。占槽后即使凭据失效/尚未发出写，也不自动复位、重放或新SHA补齐。证书单写旧槽保持，不占用/重做它。

事实始于 **10月29日07:57:00.563 CDT**，准备/审批至 **12:57:00.563 CDT**，最晚启动 **12:12:00.563 CDT**（预留45分钟）；UTC及毫秒以manifest为准。不重计采样时间、延长旧窗口或新建后端TTL。生成清单后main冻结至结果与本地重建结束。超时/到期不取消正在运行的CFN或删除记录，只保留状态，后继只读处理另审。

## 必须接受的风险与停止点

- DNS/证书/CloudFront/CFN 跨服务非原子，预检不是 CAS；并发修改、DNS/边缘传播和凭据自动刷新仍可能失败。固定尝试槽一经占用不自动复位，失败/提交不明不自动重试、补齐、回滚或清理。
- 验证 CNAME/证书可能已留存，但 CDN 未更新；部分 CFN 更新或失败也可能遗留对象或持续费用。正常 CFN 服务端回滚可能恢复原配置、清理本次新增的 A/AAAA；这是须另批的托管副作用，不等于代理主动删除许可。若回滚失败，只记录状态，不修复或继续更新。
- 全局 CloudFront alias 冲突不存在尚未证明；申请证书并不拥有其他分布的 alias。发生冲突就停止，不迁移、抢占或删除其他 alias。公开 DNS 查询可受缓存影响，不冒称所有解析器或公网逐跳父级委派均已验证。
- DNS/CT/提供者日志可能长期公开域名与资源元数据。HTTPS 静态请求可能计费、记录 IP/路径；不读取或上传 Secret、PEM、.env、HMAC，不连接 Neon/Aurora 或写业务。
- 原静态 CloudFront 地址保留；切换域名不自动改后端 CORS、开启租约、创建任务或调度。需要的后端新合法请求/材料与 Review→RunOnce→Inspect 仍是后继主线，另按集中清单审批。
- 50 USD/月是整体费用目标，不是硬停费；原资源、存储/流量/日志/税等继续可能收费。本阶段不增加 ECS/ALB/数据库，不自动清理。

## 本轮准备状态

完整模板及准确 CNAME 已准备，25 项域名边界/原单 INSERT 请求定向检查全部通过（新增两项只检查真实模板和 CNAME，不新增执行器），类型/lint/diff、177 个相对链接与原 110 文件云闭包核对通过。YAML 使用既有 js-yaml 验证；本机未安装 yaml 包的首次解析命令未执行解析，不安装新依赖。

准确源码 `d869f47385ac691691a1afb8189c9374db6252a0` 的[CI 40875734305](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40875734305) completed/success、attempt1；job123453944812 的全部16个步骤成功，无 AWS 身份。恢复读 `F:/ChatGPT_workshop/techlong-buyer-domain-install-code-verified-20261029-a.json`，raw SHA `306390108b9ac4aa5c9f6604833ba5fb2c18aa7c84fd148badbf93637ab9efbd`，绑定两份真实 CI 返回及七份源码 pin。实际 GitHub GET4、AWS/公开 DNS/私密读取/SQL/云写/执行槽/dispatch 均0；该证明不是云端更新或验收。

**本轮限定只读已完成**：07:57:00–07:57:21 CDT主快照实用STS1/AWS元数据13/公开DNS2；08:07:17仅用原剩余1次元数据，从A类型开始补查准确验证名，证明所有类型均空。累计STS1/AWS元数据14/公开DNS2、零云写/私密读取/SQL/槽/dispatch。原UUID/六资源/模板保持，Change Set列表空，CDN Deployed、ETag E23ZP02F085DFQ、无alias；准确证书仍PENDING_VALIDATION、属性和六标签一致；验证名/buyer名/sandbox wildcard空，zone/自身NS与两处公共递归NS一致，完整候选ValidateTemplate成功。未逐跳查询权威父区或证明CloudFront全局alias空缺。[公开事实](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-install-preflight.json)。

恢复读 `F:/ChatGPT_workshop/techlong-buyer-domain-install-readonly-20261029-a/verified-with-validation-name.json`，raw SHA `02650c15d096cf5de702258852329ab00f5aed493077bf184154f994b01b760f`；38份原件、17条真实读取及原采样时间已本地重建。原主快照/35原件证明保留，不重发原调用或重计五小时。下一只生成新外层审批SHA并请求用户确认上述累计范围和风险；**不执行写入、不消费槽**。代码CI成功与真实事实准备均不等于域名已接通。
