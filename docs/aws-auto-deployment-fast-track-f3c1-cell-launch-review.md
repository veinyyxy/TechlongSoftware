# F3c1：真实 Cell 资源门禁与 DNS/证书前置清单

2026-10-11 Winnipeg。本阶段回到真实部署主线，复用已发布的两个镜像、私有 baseline 与业务函数安装证据；集中读取和官方价格刷新完成。**没有 AWS 写入、IAM 增权、Lambda 调用、数据库连接、镜像构建/发布或付费 Cell。** 50 USD/月目标保持，实际创建仍须确认 fresh SHA。

## 集中实际回读

一次 56 项 Source 只读集合，原件 `F:/ChatGPT_workshop/techlong-f3-readonly-20261011-c1/aws-readback.json`，文件 SHA `06e60020f63da789dd16337c394d5585496702fe2795d34962027dd262a2f93c`。Aurora PG16.14 / db.serverless / 0 ACU 区域可用、现有镜像两准确 digest/tag 均保持；两个已有 BASIC scan COMPLETE / HIGH0 / CRITICAL0，scan 时间仍为原发布时，不称新扫描或实机运行验证。

现实前置缺口：sandbox public hosted zone、sandbox wildcard 证书、mTLS trust store 缺失；线上 tagged Budget 仍 **10 USD**、ActualSpend 0.004 USD（延迟账单数据，不是实时余额）；authority max read 5 / write 2，未提高到计划的 read100；ELB service-linked role 为 NoSuchEntity；baseline HeadBucket404，未发布 baseline；原 lifecycle TaskRole / 共用 boundary 还未取得新 baseline/admission 最小权限。现有 `api.techlong.cloud` 证书保持、不替换。

新的数据型 launch compiler 正确把“已发布镜像/已安装业务候选”记为进度，不继续使用旧硬编码未发布报告作为当前事实。新的门禁报告 `F:/ChatGPT_workshop/techlong-f3c1-cell-launch-20261011-r2/cell-launch-review.json`，SHA `e07f31754b18964049e1f6a6b0abf0cf21536c90bea5558be7c2b84ab9276df5`；deploymentAuthorized=false。

额外发现：旧 `shared-cell-stack.ts` renderer 的 schedule 为 ENABLED、schema1 `delete_shared_cell_stack`，指向旧 PLAN_ONLY Janitor、10 retries；**不是当前 v3 协调/执行协议，不能直接申请付费执行**。旧模板/批准/记录不改，也不把候选安装成功误称自动 TTL。后续须准确 v3 调度、真实 provision/zero/authority、journal/DeleteStack 精确权限、失败创建补偿和在线验收。

## 费用与资源顺序

官方 ca-central-1 五服务 feed 已重新 GET 保存，selected-prices 文件 SHA `51af76280a9bb1b3213cc8ed1e2fbf5d342fe3be4e00d0e621e1bd1355c0f9a6`。沿用 1 应用 task / 0.25vCPU / 0.5GB、1 ALB、1 used LCU、1 mTLS trust store、3 public IPv4、Aurora 峰值1 ACU；核心约 **0.20762 USD/h**，4 计费小时 + 8 个各2分钟 one-shot task 约 **0.83544 USD**。不含存储、数据库 I/O、备份、传输、Secret、S3/ECR、DDB、日志、Lambda/Scheduler、税、清理超时；不是总价或保证上限。相同组 730h 核心约100.46–151.56 USD/月，不能宣称50USD内常驻。[官方价格表方法](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html)、[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/)、[Aurora](https://aws.amazon.com/rds/aurora/pricing/)。

最快前置顺序：独立 sandbox DNS/非导出 ACM → 人工仅子域 NS 委派、只读等待证书 → baseline/mTLS material → 专属 IAM/read cap/Budget → v3 清理兼容模板/准确 stack ARN 围栏 → 单独批准短 TTL Cell/单租户真实验收。不重复同类 Lambda 微探针，不提前 draining，不生成假 authority。

## 本轮 fresh 执行清单：仅 DNS/证书基础

- Manifest SHA：`f9cec821f3195925d5d644644f5ba8ad752afa7471b5015986e1f20a77ad52d7`
- 文件 SHA：`8c0f730e8c9f60ca1752ac8afc9c5cd1f58aa125dab95643789cd4d47f26238b`
- 6 文件 binding：`f391e9b9494464675270205c578562f654d28ee7435741aff72c4de67acdbc2f`
- Review：2026-10-11 19:59:53.910 UTC / Winnipeg14:59:53.910。
- 过期：**2026-10-11 20:59:53.910 UTC / Winnipeg15:59:53.910**。
- 私有目录：`F:/ChatGPT_workshop/techlong-f3c1-dns-20261011-r1`。
- 库存 SHA：`f22e7b88ca2f5e525b7fe1c20b80328a7b4e95646264c36e45692f7b518f606d`；anchor `6710ae80e5723c969dc311d349f182c3889b84d86ee314558a0fd250c0358d19`。

Review 实际确认无目标 zone/证书和可见的子域根记录冲突，父域 NS 为 `dns1.registrar-servers.com` / `dns2.registrar-servers.com`，父域 CAA 未返回记录。现有 API 证书元数据保持。五项 Source create/tag/record/certificate 权限模拟 allowed，只是预检，不增 IAM、不保证真实写入成功。

仅最多 **4 写**，由已核对 Source user 执行：

1. 在账户402010193138创建独立 public zone `sandbox.techlong.cloud`，CallerReference 固定审批 SHA；不创建或修改 `techlong.cloud` parent zone。
2. 给该唯一新 zone 添加准确审批/Environment/Project/Purpose 标签。
3. ca-central-1 请求1张 `sandbox.techlong.cloud` + `*.sandbox.techlong.cloud` 公共 RSA2048、DNS验证、**Export=DISABLED** 的 ACM 证书及标签；不请求 Private CA、不导出私钥、不替换 API 证书。
4. 仅在新 zone 中一批 **CREATE** 这张准确证书返回的1–2条验证 CNAME，TTL300；wildcard/apex相同 token 去重，不 UPSERT、不改 NS/SOA、不建立业务 Alias/A/AAAA。

zone ID / 新证书 ARN / 验证 token 是服务生成值；严格回读 CallerReference/标签/域名、初始 NS、非导出/算法和准确 CNAME suffix，再使用其本批 ID。失响应不能改成重请求；动态值受闭合范围约束，不得借此写其它 zone/证书。**不新增 IAM，不调用函数，不写 Secret/Neon/authority，不改 Budget/read cap，不创建 Cell/ECS 或删资源。**

## 费用和必须接受的风险

Route53 前25个 zone 的基础价格为 **0.50 USD/zone/月**，不按部分月份比例计算；DNS查询另计。这张 AWS 集成用非导出公共 ACM 证书无证书费用，不采用收费 exportable/ACME/Private CA 产品。[Route53价格](https://aws.amazon.com/route53/pricing/)、[ACM价格](https://aws.amazon.com/certificate-manager/pricing/)。不能以“没有 Cell”承诺本轮绝对零费用，创建 zone 后即可能持续计费。

接受四写非原子/非CAS、外部并发、自动刷新/网络/保存失败可能遗留收费 zone、未完成标签/证书/记录；不自动补齐、删除、回滚、复位或写重试。固定新槽位 `techlong-f3c1-sandbox-dns-foundation-v1-consumed` 一经消费永久保留，失败只读 Inspect；有限只读轮询不是写重试，过期只读刷新、新 SHA 另确认。

接受证书域名在签发时进入公开 CT 日志、验证/传播可能长时间 pending、失败或72小时验证超时，后续需单独处理，不能自动请求替代证书。[ACM请求](https://docs.aws.amazon.com/acm/latest/APIReference/API_RequestCertificate.html)、[DNS验证](https://docs.aws.amazon.com/acm/latest/userguide/dns-validation.html)。公开查询不能枚举 Namecheap 所有记录，不能证明更深层 sandbox 无其它用途；本轮不做 parent 委派，故不修改这些现网记录。

创建后独立只读核验，得到真实4个 Route53 NS 后，再请用户核对父域 provider 的现有 sandbox 子树并**单独确认/人工添加 sandbox NS 记录**；不要改主域 registrar nameservers、现有 API 或根记录。新 zone 未委派前证书通常 pending，不能冒充 ISSUED 或付费 Cell ready。[仅子域委派](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingNewSubdomain.html)。

## 当前状态与继续

15 新 + 3 相邻，共18测试、typecheck、定向 lint通过。RoleId/旧业务安装 binding/所有历史slot/镜像不改，当前写入0、新slot空，没有部署批准。Git 两 main 仍按默认授权提交推送。

确认本页 SHA/四写范围与风险后，助手可以一次 Run + 新进程 Inspect。可执行入口 `ops/aws-sandbox/scripts/review-sandbox-dns-foundation-v1.mjs`；私有辅助脚本 `F:/ChatGPT_workshop/Run-ReviewedSandboxDns-f9cec821.ps1` **尚不得运行或重放**。过期仅新的 Review，不自动沿用旧 SHA。NS 委派之后仅核对解析/证书，继续其它基础准备，付费 Cell 尚不批准。
