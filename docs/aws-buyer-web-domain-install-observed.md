# 买家自定义域名：真实安装与独立静态验收

2026-10-29 08:28:58–08:37:06 CDT，用户确认清单 `42f208d6ead9c1cae492e0b61072c18318d199fb643b10aca90e7abad41579c9` 后，完成验证 DNS、受限 Change Set 与独立静态验收。最终结果为 `BUYER_CUSTOM_DOMAIN_INDEPENDENTLY_VERIFIED_STATIC_ONLY`。[原范围与完整风险](aws-buyer-web-domain-install-review.md)保留，准备原件不改成执行记录。

## 已完成与未完成

| 项目 | 本轮真实结果 |
| --- | --- |
| 买家入口 | https://buyer.sandbox.techlong.cloud；原 CloudFront 地址保留，不重定向 |
| 原栈 | techlong-sandbox-buyer-web-v1 / UUID71751190-d32e-11f1-9a09-06ffda7a3477，UPDATE_COMPLETE |
| 原分布 | EDJYJUKAZ12BO，Deployed；唯一 alias 为准确 buyer 域名，SNI / TLSv1.2_2021，原 origin/cache 等其他配置一致 |
| 证书 | us-east-1 / ARN68a43688-08d5-47c6-96c6-f48740b61caf，ISSUED、AMAZON_ISSUED、RSA-2048、Export=DISABLED；唯一 SAN、六标签与实际验证记录匹配 |
| DNS | 实际验证 CNAME（TTL300）及 buyer A/AAAA 均准确回读；Alias 只指向原 d3a0kml1xanzgt.cloudfront.net / Z2FDTNDATAQYW2，健康评估 false |
| 资源/权限范围 | Change Set 仅原分布 Modify/Replacement=false 和两条 Alias Add；原六项资源物理 ID 保持，最终八资源，原 IAM/trust/boundary 模板不变 |
| 首页 HTTPS GET | 200、text/html、1403字节、TLSv1.3、证书与主机名验证通过 |
| manifest.json HTTPS GET | 200、application/json、916字节、TLSv1.3、证书与主机名验证通过 |
| 产品业务 | 未执行JS、登录、API、下单或业务验收；未创建/恢复后端、未改CORS、数据库、材料/来源或工作负载TTL，wholeProductAccepted=false |

首页 SHA256 为 `cd2f682e06ca134ed757ae32be65b933a91bbda76cdbb0f2912d9344483836f4`；manifest 为 `35aef5ce49478ee60ba119a07e531d4341b8af75409d4e6ebf2239336cccfd76`。只计算摘要/大小与记录公开 TLS 属性，没有保存正文、读取 JS/HMAC、发送认证/Cookie或跟随重定向。静态200不代表客户端业务已可用。

## 执行链与实际次数

写前重新核对固定 IAM 用户、原栈/模板/六资源/空Change Set、CDN原ETag、准确证书/标签、公开zone和四类DNS查询，并再次核对两处公共递归NS，全部匹配后才独占永久槽。

1. 一次准确验证 CNAME CREATE；保存 ChangeId `/change/C080740625F5RLFW8GJO8`。GetChange观察4次达到INSYNC，证书观察4次达到ISSUED，均在批准时间内。
2. 一次CreateChangeSet；准确ARN为 `arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-buyer-domain-02650c15d096cf5de702/458d9dde-04cf-4bc4-a641-1b80dae865b6`。两次Describe后，完整三项资源差异/不替换、模板、证书参数、原标签与能力均匹配。UPDATE类型由固定请求及原栈UUID约束，不伪造DescribeChangeSet中不存在的类型字段。
3. 新STS及四项执行前复核后，仅从该ACK派生执行请求，一次ExecuteChangeSet；9次栈观察后UPDATE_COMPLETE。没有直接UpdateDistribution、新建栈、删除或重试。
4. 新独立进程、新STS，11次固定资源元数据读取核对原UUID/八资源/原六物理ID、准确模板/参数/标签、证书/分布、zone/CNAME/A/AAAA/NS；再独立公开解析A/AAAA和两条HTTPS GET，全部通过。

实际累计 **STS3、AWS元数据53、公开DNS4、无身份HTTPS GET2、直接写3**；其中writer元数据42，独立11。CFN托管更新分布和创建两条Alias，不混称所有底层API只有三次。IAM写、Secret/PEM/.env/HMAC读取、SQL、上传、GitHub调度、后端创建、续租、代理删除/回滚/重试/清理均0。没有独立审计外部操作者的IAM漂移，不把模板/物理ID保持冒称全账户无漂移。

## 恢复与费用边界

- 冻结执行源码 `65e7c716c12c9ff7235736ea5d5471b78e5327bf`；候选代码为d869f47，准确CI40875734305成功。后续文档提交不是新代码CI或新部署。
- 恢复入口：`F:/ChatGPT_workshop/techlong-buyer-domain-install-20261029-a/executed-verified.json`，raw SHA `bf5a03fc9687e67084acff917c8eb8b980eb6844bde20d00e3ae9b977dff52f7`。149份真实原件/提交意图/ACK/独立读取已本地重建，包含实际运行脚本与按固定规则派生的准确Execute请求。
- 永久槽 `F:/ChatGPT_workshop/techlong-buyer-domain-install-v1.intent.json` 已消费。不要重新执行本轮脚本、复位槽、改原准备时刻或重放旧清单。原证书申请槽也保持消费；不再申请证书或重复验证写。
- 独立验收及本地重建完成后main结束冻结，仅正常提交本结果。原5小时准备期限不重计；它到期不会删除域名/证书、停止资源或让既有证明失效，但证明不能冒充未来现状。
- 新A/AAAA归原CFN栈管理；证书与验证CNAME在栈外保留。没有自动清理，原S3/CDN/zone等资源仍可能计费，50 USD/月只是整体目标。

收尾本地25项域名边界/既有请求测试通过，公开摘要与私有证明逐项匹配、201个相对链接可解析、diff空白检查通过，原110文件云闭包保持。没有为这些检查新增提供者调用，也没有把后续文档提交冒称新代码CI成功。

## 下一唯一继续点

回到[后端联调/CORS主线](aws-backend-integration-preparation.md)：只准备新的合法held请求、准确buyer域内CORS材料/必要来源绑定及一次Review→RunOnce→独立Inspect的集中范围。复用既有单INSERT请求能力和镜像/数据库，不重放旧成功任务或已删栈UUID，不扩UI、探针、通用恢复框架或固定任务分支。

后端/Neon旧快照已过期，新生产读取、请求/材料写、必要来源/trust变化、部署/业务验收仍按准确范围另审；本轮域名批准不覆盖这些行为。不再改前端或重新发布客户端/HMAC，也不先开后端短窗口。
