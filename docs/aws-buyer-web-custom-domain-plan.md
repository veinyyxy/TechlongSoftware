# 买家自定义域名：最小准备方案

沿用[执行手册](aws-auto-deployment-execution-runbook.md)。用户明确选择“先准备自定义域名方案”，不是申请证书、修改DNS/CDN、扩大权限或恢复后端的批准。[机器摘要](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-plan.json)和[模板差异候选](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-template-proposal.json)均无执行SHA；差异候选不是可直接应用的CloudFormation模板。

## 为什么改用域名

真实V5 Review本地测试发现，现有parameters.ts仅允许techlong.cloud域内HTTPS来源，直接追加d3a0kml1xanzgt.cloudfront.net会报域边界错误。因此之前c124b21a…候选哈希只证明材料差异，不能证明能渲染或部署。未接通原型已撤回，诊断保存在F:/ChatGPT_workshop/techlong-buyer-origin-adapter-stopped-20261028-a.json，不把失败测试改称接线成功。

选定买家入口为https://buyer.sandbox.techlong.cloud，继续指向同一个CDN和原S3对象；API仍为https://first-acceptance.sandbox.techlong.cloud。域内CORS可通过现有校验，不必放行任意cloudfront.net来源、修改冻结110文件内核或增加API代理。原单INSERT请求编译器也已存在，不重复实现取消/恢复框架。

## 准确候选范围

| 项目 | 仅准备的变化 |
| --- | --- |
| 现有CDN | EDJYJUKAZ12BO / d3a0kml1xanzgt.cloudfront.net；追加一个准确alias，改用SNI证书 |
| 现有承载栈 | ca-central-1 / techlong-sandbox-buyer-web-v1 / UUID71751190-d32e-11f1-9a09-06ffda7a3477；不新建分布、桶或IAM |
| ACM | us-east-1中一份准确buyer域名的不可导出公开RSA2048证书，DNS验证；实际ARN尚为null |
| 证书验证DNS | 仅ACM实际返回且独立核验的一个CNAME；名称和值尚未知，不猜测、不盲目UPSERT或删除旧记录 |
| 业务DNS | 既有公开zone Z01473621BTTHKXBGOOEJ内buyer域名的A、AAAA Alias，目标为现有分布 |
| 后端后继 | 新受审材料仅追加https://buyer.sandbox.techlong.cloud；原两个来源保留，旧后端不重放 |

CloudFront要求alias由所挂证书覆盖，ACM证书需在us-east-1；S3和现有承载栈仍留在ca-central-1。[AWS域名/HTTPS说明](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-procedures.html)。使用sni-only，不采用有额外月费的vip模式；[ViewerCertificate属性](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cloudfront-distribution-viewercertificate.html)。Alias使用CloudFront固定目标zone Z2FDTNDATAQYW2，目标健康评估false；[AWS AliasTarget说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-route53-recordset-aliastarget.html)。

原六资源及IAM/trust/boundary、私有桶/OAC/桶策略、对象版本、API编译目标、Secret和原CloudFront输出全部保持。模板仅修改BuyerDistribution的Aliases/ViewerCertificate及说明Comment，增加两条DNS RecordSet及一个独立输出，不重发客户端或读取HMAC。原默认CloudFront地址仍能访问静态内容，但业务验收改从buyer域名进入；本方案不添加重定向函数。

## 实施前必须分开的审核点

1. **先只读准备**：新许可后核对准确栈/原模板、CDN当前配置/ETag/alias及域名冲突、公开zone/委派、准确DNS名称占用和可用证书元数据。不得用旧快照声称alias空缺；不能证明或出现漂移就停止。无需Secret值、PEM、.env、数据库、GitHub配置或调度。
2. **证书/验证DNS清单**：另给准确SHA，最多一次RequestCertificate和一次准确验证CNAME CREATE；公开CT、验证pending和部分遗留风险须接受。不建立新IAM或导出证书私钥；传播不足只观察，不自动重试写或清理。
3. **现有栈更新清单**：证书ISSUED并独立核验覆盖/区域/账号后，以实际ARN准备新模板。准确Change Set只能有BuyerDistribution Modify（不得替换）和BuyerAliasIpv4/Ipv6 Add；其他资源/权限变化一律停止。预计CreateChangeSet和ExecuteChangeSet各一次，CFN会有其托管底层写入，不混称总API仅两写。证书与验证CNAME不在该ca-central-1模板中。
4. **独立静态验收**：核对分布Deployed、证书、A/AAAA、HTTPS证书和既有静态对象；不执行网页JS，不登录或创建访问租约，不因静态200宣称后端已恢复。正常CFN回滚、传播和并发风险不能靠本地测试排除。
5. **再衔接后端主线**：仅新合法held请求、准确材料/来源及必要trust-only发布，再Review→RunOnce→独立Inspect和有限业务验收。集中备齐整轮材料后才开2小时候选窗口，GitHub环境由用户本人批准；旧成功任务、旧永久槽及原到期不改。

后继CORS字符串为原两个来源加buyer域名，本地克隆公开body得到候选SHA 649c3077a5c1316e663f9765c10b4d79a9cc1bc673086de8e50d4ed1ddc92a62；未改原capsule/源码常量，也不是执行批准。证书/域名成功后仍要绑定受审新材料，不能直接让旧冻结workflow接受新参数。

## 费用与边界

选用集成AWS服务的不可导出公开ACM证书，官方列价为无证书费用；不使用收费的exportable、ACME或Private CA类型。[ACM价格](https://aws.amazon.com/certificate-manager/pricing/)。指向CloudFront的A/AAAA Alias查询不收费；复用现有zone，不新建HostedZone，但证书验证等普通DNS查询仍可能收费。[Route53价格](https://aws.amazon.com/route53/pricing/)。

不新增ECS、ALB、RDS、CDN或桶；原CDN/S3流量、存储版本、zone和其他现有系统费用继续，50 USD/月仅是整体目标，不能保证绝对零费用或自动停费。DNS记录超量、异常流量、配额及提供者价格变化需在执行清单再次核对。证书CT/公开DNS可能长期留痕；跨区域/服务非原子，失败可能留证书或记录，不自动删、补齐、回滚、续租或重试。

本轮仅本地准备与无AWS测试/CI；没有AWS元数据或写入、私密读取、SQL、GitHub环境配置/dispatch、证书请求、DNS/CDN更新或后端部署。准备快照仍按原真实时间，不因本方案重新计时。下一只在准确CI通过后申请一次域名范围的限定元数据核对，生成证书阶段待审SHA。
