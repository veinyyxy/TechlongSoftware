# 买家域名：仅申请证书的执行待审范围

**状态更新：本清单已由用户准确确认并执行完成，独立回读通过；证书 PENDING_VALIDATION，DNS 尚未写入。** [真实结果及恢复入口](aws-buyer-web-certificate-observed.md)。下方原待审文字保留追溯，不再作为重新执行或后继写入批准。

承接[自定义域名方案](aws-buyer-web-custom-domain-plan.md)，遵守[执行手册](aws-auto-deployment-execution-runbook.md)。当前只有只读预检批准，**尚未获准任何AWS写入**。准确SHA、源码、请求JSON和期限以F:/ChatGPT_workshop/techlong-buyer-domain-certificate-20261029-a/prepared-verified.json绑定的manifest为准；该文件不存在或核验失败时，不得声称准备完成或执行。

## 已取得的真实状态

2026-10-29 00:05:04–00:06:33 CDT，实际1次STS＋11次AWS元数据，准确IAM用户身份通过；原六资源模板一致，前端栈CREATE_COMPLETE，CDN EDJYJUKAZ12BO为Deployed、无alias，buyer DNS名称空缺，无sandbox wildcard记录。us-east-1完整证书摘要列表有1份，但不覆盖准确buyer域名，没有截断/额外SAN不明。[公开预检摘要](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.domain-preflight.json)不含凭据或业务快照。

最初本地检查混用了CloudFormation的IPV6Enabled与API的IsIPV6Enabled字段；原API实际为true。停止原件保留，只复用该返回及尚未用完的额度继续，没有重发STS或前四项元数据调用，不改原观察时间。完整本地原件在F:/ChatGPT_workshop/techlong-buyer-domain-preflight-20261029-a-continuation/，result raw SHA 674cae8af98ef09cc54e510275d63b27651600a505e37fce9199480bf77ea7a4。

这些事实不是公网父级NS委派或CloudFront全局alias冲突不存在的证明；没有执行公网HTTPS/JS探针，也没更新任何对象。证书及DNS验证值仍未知，不能伪造填入清单。

## 本清单拟批准的唯一写入

仅在us-east-1调用一次ACM RequestCertificate，为buyer.sandbox.techlong.cloud申请一份公开、不可导出的RSA2048证书，DNS验证，不增加其他SAN、Private CA或ManagedBy选项。请求明确设置Options.Export=DISABLED、CT preference=ENABLED；Tags只含本项目/环境/组件、受审来源和预检摘要。准确字段与IdempotencyToken固定在manifest及请求JSON中，不接受运行时域名/参数覆盖。

ACM请求后元数据可能延迟数秒；证书可处于PENDING_VALIDATION。API的idempotency token只有有限有效期，**不是写入重试许可**。[AWS RequestCertificate](https://docs.aws.amazon.com/acm/latest/APIReference/API_RequestCertificate.html)。Export创建后不能修改，公开证书会留下CT记录。[AWS CertificateOptions](https://docs.aws.amazon.com/acm/latest/APIReference/API_CertificateOptions.html)。

本轮**不写任何DNS记录、不改CDN/CloudFormation、不新增IAM、不读Secret值/PEM/.env、不连数据库、不上传客户端、不dispatch或创建后端**。这是从原候选“证书+验证DNS”中收缩出的单写阶段：先拿真实ARN和CNAME，再把准确DNS验证及现有分布更新集中准备供后继审批，避免现在批准未知记录值。

## 执行前门禁与独立回读

- 固定Source profile techlong-sandbox-user，IAM用户arn:aws:iam::402010193138:user/techlong-sandbox-dev。源码/请求/预检原件/清单SHA必须匹配，main干净、时间未过期。
- 新执行范围内，写前最多1次STS和3次元数据：现有CDN、公开zone、完整us-east-1证书摘要；准确CDN仍匹配、zone公开且未变、没有新出现的匹配buyer证书才继续。Source失败或漂移停止，不领取写槽、不自动重试。
- 写前独占领取固定永久尝试标记F:/ChatGPT_workshop/techlong-buyer-domain-certificate-v1.intent.json，再保存准确提交意图。标记一经领取，即使随后认证失败/中断，也不自动复位或重放；新SHA不能绕过旧标记。当前没有领取。
- 仅一次RequestCertificate提交；使用AWS官方endpoint和显式us-east-1、关闭SDK/CLI重试。正常AWS Login自动刷新仍可能失败，STS前检不能消除之后身份/网络/并发竞态。
- 保存ACK并只把这一次返回的准确ARN用于后继读取，不猜测或替换ARN。独立只读回读最多1次新STS、4次DescribeCertificate和1次ListTagsForCertificate；合计上限2次STS＋8次AWS元数据、1次AWS写。描述可能有限观察pending，不再次申请。
- 核对同账号/us-east-1、准确DomainName/SAN、DNS验证、RSA2048、AMAZON_ISSUED、不可导出及准确标签，保存状态与真实CNAME（若已返回）。新证书尚pending并非域名已验证，更不是CDN可用；元数据未齐或ACK不明就保留未知停止状态，不自动补齐/删除或进入下一阶段。

## 期限、风险与停止点

原准备快照始于2026-10-29 00:05:04.864 CDT，5小时到05:05:04.864 CDT，不重计；本阶段最晚启动预留2分钟，准确UTC毫秒以manifest为准。审批前不创建永久尝试标记，不打开后端短窗口。到期只准备新受审材料，不重放旧写。

接受下列完整风险后才可批准：新证书及域名的公开CT/日志留痕；提供者异步、验证pending、配额或权限拒绝；预检非CAS、并发创建、网络/认证失效或提交结果不明；固定槽可能已消费但实际未写，或已创建证书却尚未完成回读；没有自动重试、删除、回滚、补齐或清理。后继DNS验证、分布更新及后端仍独立按准确范围审批，不默认扩权。

不可导出公开证书用于集成AWS服务的官方证书费用为0，但这不是整体零费用保证；既有资源、日志、流量和税等仍可能计费，50 USD/月只是目标。[ACM价格](https://aws.amazon.com/certificate-manager/pricing/)。本次不创建付费Cell/ECS、不续租旧意图，wholeProductAccepted=false。
