# 买家域名证书：单次申请及独立回读结果

2026-10-29 00:28 CDT，用户确认准确清单 `8b2a6ab9e82d73e844dc0584b6dd85a741392544ebe7545374208e7f0b01cf42` 后，完成一次 ACM RequestCertificate 和独立只读核验。结果为 `CERTIFICATE_REQUEST_INDEPENDENTLY_VERIFIED_DNS_NOT_WRITTEN`。[原完整范围与风险](aws-buyer-web-certificate-review.md)保留，不改写准备原件为执行结果。

## 真实结果

| 字段 | 独立回读事实 |
| --- | --- |
| 域名 | buyer.sandbox.techlong.cloud，唯一 SAN 同名 |
| 区域 / 账号 | us-east-1 / 402010193138 |
| ARN | arn:aws:acm:us-east-1:402010193138:certificate/68a43688-08d5-47c6-96c6-f48740b61caf |
| 类型 / 密钥 / 导出 | AMAZON_ISSUED / RSA-2048 / DISABLED |
| 状态 | PENDING_VALIDATION；尚未证明签发、域名或 CDN 可用 |
| 验证方式 | DNS，实际 CNAME 如下；本轮没有写入 |
| 标签 | 请求中的六项标签全部准确匹配 |

```text
Name:  _c58f6bf59cf3d7ebdc05257e15da6134.buyer.sandbox.techlong.cloud.
Type:  CNAME
Value: _7efd69b26b5dacac8abde494f027ab68.wzccmgtwzk.acm-validations.aws.
```

写前核对固定 IAM 用户、CDN 原 ETag/无 alias、公开 zone/四个 NS，以及完整证书列表无覆盖 buyer 的证书，全部通过后才独占领取永久槽并提交。原 `*.techlong.cloud` 证书不覆盖两层 buyer.sandbox 域名，本轮未修改它。独立进程重新取得 Source 身份，仅读取此次 ACK 的准确 ARN；属性、唯一 SAN、不可导出、DNS 和六标签均通过，第一次 Describe 即取得实际 CNAME。

累计实际 **STS 2、AWS 元数据 5、RequestCertificate 1**，全部成功；其中写前元数据 3，独立 Describe/标签读取各 1。DNS/CDN/CloudFormation/IAM 写、私密配置/Secret/PEM 读取、SQL、上传、调度、后端创建、续租、自动重试与清理均为 0。原 CDN/S3 对象与后端旧意图未改变，wholeProductAccepted=false。

## 恢复与不可重放边界

- 冻结执行源码 `732edb11499eac79bde31e5bee68c4c906378c16`；代码 CI 仍是候选 aad23fa 的准确 run 40820296477，不冒称文档提交运行过代码 CI。
- 本地恢复入口：`F:/ChatGPT_workshop/techlong-buyer-domain-certificate-20261029-a/executed-verified.json`，raw SHA `66f44538329211818525cb446f401d0fe160e0395d7a1b7dbf1eaa7ecd7f996f`。26 份原件及逐次意图、提供者返回、ACK、独立回读和标签已本地重建核对；原准备/批准材料保持。
- 永久槽 `F:/ChatGPT_workshop/techlong-buyer-domain-certificate-v1.intent.json` 已消费。不得重新 RequestCertificate、重跑执行/回读脚本、复位槽或覆盖原件；并非每次继续都需要重取本轮证书。
- 完成独立回读及本地重建后，main 冻结结束，仅正常提交观察文档。当前 pending 不是失败重试许可，不自动删证书或补写 DNS。

收尾本机复验 23 项域名边界/既有请求测试全部通过，公开摘要与私有执行证明匹配，183 个相对链接可解析，diff 空白检查通过；这些本地检查没有新增网络调用或云写，也不代替后继云验收。

## 下一唯一动作

按[既有最小域名方案](aws-buyer-web-custom-domain-plan.md)准备准确 **验证 CNAME CREATE → 等待并核对 ISSUED → 现有栈 Change Set/执行及独立静态验收** 的集中清单。只改原分布别名/证书及 A/AAAA，禁止新增 CDN/桶/IAM、重发客户端或读取 HMAC；新鲜读取与实际写仍按准确范围另审。本轮确认不覆盖 DNS/CDN 更新，也不授权后端恢复。

原准备期限 2026-10-29 05:05:04.864 CDT 不重计；已执行证据永久保存不因快照过期失效，但不能以它冒充后继执行时的当前 DNS/CDN 状态。公网父级委派及全局 alias 冲突不存在仍未证明。费用目标仍为 50 USD/月，不等于整体停费或零费用。
