# 买家域名：验证 DNS 与现有 CDN 更新待审范围

遵守[执行手册](aws-auto-deployment-execution-runbook.md)，只衔接[已完成的证书单次申请](aws-buyer-web-certificate-observed.md)。**本文件当前是准备草案，没有执行 SHA，不授权 DNS/CDN/CloudFormation 写入。** 新一轮只读核对通过、准确 CI 与材料/期限绑定后，才生成独立审批清单；旧 05:05 CDT 截止已过，不复用旧准备授权。

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

未来准确清单须写明读写次数和等待上限、官方 endpoint、CLI 版本/禁重试、永久槽、实际有效期和最晚启动预留。只读准备快照按真实观测起 5 小时，不是新后端 TTL，也不延长任何旧窗口；生成清单后 main 冻结至结果与本地重建结束。不能把本段预计顺序当执行脚本或自行补齐缺失授权。

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

**当前只等本轮限定只读准备许可**：最多1次STS＋14次AWS元数据/模板验证及4次公开DNS查询；不读私密值、不连数据库、不写云，不复用凌晨快照。新事实尚未核验，没有执行SHA，不得先写验证DNS、创建/执行Change Set或恢复后端。
