# F3c1：sandbox DNS/证书实际执行与子域委派核验

## 最新只读结果：子域委派、公开 CNAME 和 ACM 签发已验证

最后一次有限只读核验于 **2026-10-11 20:45:12.238 UTC / Winnipeg15:45:12.238** 返回准确证书 **ISSUED**、certificateIssued=true、foundationMetadataVerified=true、parentDelegationVerified=true。新进程证据 `F:/ChatGPT_workshop/techlong-f3c1-dns-20261011-delegation-r3/independent-inspect.json`，文件SHA `5ca3b2fc8ff970cd7f7fb8630d6e88c3d398fd805919e87d0e68d0ad352c4950`。此前两次pending结果保留，未因pending改DNS或重申请；本轮全部AWS操作只读。DNS/ACM前置阶段已完成，无需再添加NS/CNAME。

2026-10-11 用户报告“sandbox NS 已添加”后，助手没有改 Namecheap 或进行任何 AWS 写入。20:42:38.296 UTC 分别向1.1.1.1及8.8.8.8读取父 NS、sandbox NS、准确验证 CNAME，两处均返回准确4个 Route53 NS和准确 token；父 NS仍为原Namecheap两项。公开查询摘要保存于 `F:/ChatGPT_workshop/techlong-f3c1-dns-20261011-delegation-r1/public-dns-readback.json`，文件SHA `d9d82dc07587b0fcdbba180d40dd501dbf0737b24eb85095f304a6b753c655fb`。

两新进程 Inspect：20:42:39.052 UTC，`F:/ChatGPT_workshop/techlong-f3c1-dns-20261011-delegation-r1/independent-inspect.json`，SHA `85e388d7d0838cc30e93969f4ba5949b54067ed4fcc4a9a5b76a1bd4a498db6b`；20:43:20.359 UTC，r2同名文件，SHA `7de14471f61d88017eee030bcfadbbe1eb267aa38cd56f6aca4604afc229eeae`。均foundationMetadataVerified=true、parentDelegationVerified=true，准确证书仍 **PENDING_VALIDATION**、certificateIssued=false。原6文件binding/10marker/创建证据保持，Run禁止重放；本次仅只读，无IAM/Secret/Neon/authority/函数调用/付费Cell修改。机器摘要为 `ops/aws-sandbox/reviews/f3c1-sandbox-dns.delegation-verified.json`。

DNS委派及准确ACM签发门禁均已通过，但不等于真实Cell就绪。短暂pending与AWS记录建立后可能仍显示Pending至30分钟的说明相符，不保证未来所有证书都在同一时间完成；没有自动补写/重申请/删除/复位。[AWS DNS验证说明](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html)。下一阶段沿原顺序准备baseline/mTLS foundation、专属IAM/readcap/Budget及v3清理兼容模板；实际新资源/权限仍fresh SHA另批。50USD/月目标不变，不提前drain或假authority，不重复Lambda微探针/镜像重建。下方为创建及人工操作前历史，**不要再次添加NS或重放创建**。

2026-10-11。用户确认清单 `f9cec821f3195925d5d644644f5ba8ad752afa7471b5015986e1f20a77ad52d7` 后，原有效窗口内一次 Run 完成全部4次批准写入；同进程及新进程两次独立只读 Inspect 均通过。父域没有改动，证书尚未签发，付费 Cell 未批准或创建。

## 实际资源

- public Hosted Zone：`sandbox.techlong.cloud`，ID `Z01473621BTTHKXBGOOEJ`。
- CallerReference：`techlong-f3c1-f9cec821f3195925d5d644644f5ba8ad752afa7471b5015986e1f20a77ad52d7`；准确审批、Environment、Project、Purpose 四标签通过独立回读。
- ACM：`arn:aws:acm:ca-central-1:402010193138:certificate/6d1f2880-9f83-449c-930a-6b17516ef49d`，仅 `sandbox.techlong.cloud` / `*.sandbox.techlong.cloud`，RSA2048、公共 DNS 验证、Export=DISABLED；准确标签通过回读，状态 **PENDING_VALIDATION**。
- 验证 CNAME：`_dfa3d858414d5d117b4d54b67af84425.sandbox.techlong.cloud.` → `_8e0883463be77a4348bfb3618775181a.wzccmgtwzk.acm-validations.aws.`，TTL300。apex/wildcard 返回同一条记录，去重后仅 CREATE 一条，没有 UPSERT。
- 准确变更 `/change/C0756670SPATV5Q4C29D`，SubmittedAt `2026-10-11T20:21:17.924Z`；20:22:29 UTC 额外一次只读 GetChange 返回 **INSYNC**。这不证明父域已委派或证书已签发。

新 zone 内仅原 NS/SOA 与这条 CNAME，无业务 Alias/A/AAAA。两次 Inspect 的父域 NS 仍为 `dns1.registrar-servers.com` / `dns2.registrar-servers.com`，parentDelegationVerified=false、certificateIssued=false。

## 执行证据与禁止重放

Source 身份核验为 `arn:aws:iam::402010193138:user/techlong-sandbox-dev`。6文件 binding `f391e9b9494464675270205c578562f654d28ee7435741aff72c4de67acdbc2f` 与批准清单一致，没有修改绑定代码；清单文件 SHA `8c0f730e8c9f60ca1752ac8afc9c5cd1f58aa125dab95643789cd4d47f26238b`。

| 私有证据 | 文件 SHA256 | 观察时间（UTC） |
| --- | --- | --- |
| `F:/ChatGPT_workshop/techlong-f3c1-dns-20261011-r1-run/submission-receipt.json` | `c29fb1621161bce2663d3200e8d9c9bdbe0bf2c2418a6ac1df798a6d4c55ce85` | 四写回执 |
| `F:/ChatGPT_workshop/techlong-f3c1-dns-20261011-r1-run/independent-inspect.json` | `92041e386be240cf8a2c45cce5d64fe0e9af036e7dad165d934ad3bd075ceef7` | 20:21:20.357 |
| `F:/ChatGPT_workshop/techlong-f3c1-dns-20261011-r1-verify/independent-inspect.json` | `05e9a31212d1ec5a9307e4cda173ccf02c039d16f4023bbddc0bda1570094a48` | 20:21:23.262，新进程 |

outcome=`SANDBOX_DNS_SUBMITTED_REQUIRES_INSPECT_AND_PARENT_DELEGATION`，writeAttempts=4、failureStage/failureCode=null。永久槽位 `F:/ChatGPT_workshop/techlong-f3c1-sandbox-dns-foundation-v1-consumed` 已消费，10个 marker 保留，**不能再次运行 Run/辅助脚本、自动复位、补齐、回滚、删除或写重试**。之后只读 Inspect 使用新的私有输出目录；不能把已创建状态重新编译为空目标 Review。

本轮 IAM/Secret/Neon/authority/Budget/read cap/函数代码修改与调用均0；没有父域委派、Cell/ECS/mTLS trust store 或付费 Cell 创建。旧 API 证书、所有旧模板/记录/槽位与镜像保留。两个仓库仅追加执行记录，服务端 `.vscode/settings.json` 不纳入提交。

## 下一步：人工核对后仅委派 sandbox 子域

**本轮没有批准或执行 Namecheap 修改。** 先在父域 DNS provider 核对所有 `sandbox` / `*.sandbox` / 更深子域及相关 CAA/DS 等记录和用途；公开 DNS 查询不能枚举整个子树。若存在任何记录或用途，先停下评审迁移/冲突，不自动删除或覆盖。只有确认子树没有其它用途并同意委派后，才在 Namecheap 的 `techlong.cloud` → Advanced DNS → Host Records 添加以下四条 **NS Record**，Host 均为 **sandbox**，TTL 可用 Automatic：

| Type | Host | Nameserver |
| --- | --- | --- |
| NS Record | sandbox | ns-864.awsdns-44.net |
| NS Record | sandbox | ns-1693.awsdns-19.co.uk |
| NS Record | sandbox | ns-169.awsdns-21.com |
| NS Record | sandbox | ns-1215.awsdns-23.org |

不要改主域的 Nameservers / Custom DNS，不添加 `@` NS，不改根域或 `api` 记录，也不再复制这条验证 CNAME 到 Namecheap；它已经在新 Route53 zone 中。NS 是对子域的 DNS 管理权委派，影响整个 sandbox 子树，不是单个业务地址映射。[Namecheap NS 说明](https://www.namecheap.com/support/knowledgebase/article.aspx/579/2237/which-record-type-option-should-i-choose-for-the-information-im-about-to-enter/)、[Host 字段说明](https://www.namecheap.com/support/knowledgebase/article.aspx/434/2237/how-do-i-set-up-host-records-for-a-domain/)、[AWS 仅子域委派](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html)。

人工完成后回复“sandbox NS 已添加”。助手下一步仅只读核对公开 NS/CNAME 和准确 ACM 状态，不能因 pending 自动补记录或重申请证书。ACM 验证/传播可能延迟或超时，后续处理另审。[ACM DNS 验证](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html)。

50 USD/月目标不变，不是硬上限。新 zone 基础0.50 USD/月、查询另计，持续保留可能持续收费；非导出的 AWS 集成公共 ACM 证书无证书费用，实际完整部署其它服务另计。[Route53 价格](https://aws.amazon.com/route53/pricing/)、[ACM 价格](https://aws.amazon.com/certificate-manager/pricing/)。

DNS 通过后仍须 baseline/mTLS、专属任务 IAM/read cap/Budget、v3 清理兼容模板与准确 stack ARN/真实 authority 等门禁。旧 schema1/PLAN_ONLY schedule 不可直接 apply；安装业务候选不是 TTL/真实端到端验收，不提前 drain 或生成假 authority，后续实际权限/资源/数据库变更仍 fresh SHA 单独批准。
