# D001 M1：实际私有输入接线，运行时仍未启用

2026-10-13 America/Winnipeg。本段接续已提交的 [sandbox 业务](./aws-auto-deployment-single-tenant-m1-business-bootstrap-installed.md)，不回到 F3c9。完成签名/mTLS/payment 本机来源、独立配置回读和首位商户密码来源代码；**不是完成 M1、付费 Cell 或端到端自动部署**。

## 实际完成与边界

- 新 RSA-3072 签名对已在本机生成并通过 sign/verify；未来 control JWT 为 RS256、60 秒、固定 app/audience。独立检查没有颁发 bearer 或发送控制请求。
- 复用已批准 client CA 和 client certificate/key，CA PEM SHA `e60ee2d18d79c7e28c1e1dae192798ba7e18c5a106dcb5e280c1dd5643d27d5d` 不允许覆盖。客户端证书链、私钥匹配、clientAuth-only、有效期通过，证书到 2027-01-09 21:48:56 UTC。**不是已证明真实 ALB TLS 握手**。
- 固定 control hostname `first-acceptance.sandbox.techlong.cloud:8443`；ALB/ACM 服务端证书使用 Node 公共 roots 校验，不误用 client CA 作为服务端信任根。新 DNS Alias 仍未安装。
- 现有服务端 `.env` 的三个 Stripe 输入作为同一文件来源，不混用平台 billing webhook。用户另行批准的一次官方 `GET /v1/balance` 返回 HTTP 200、`livemode=false`、对象为 balance；没有输出/保存密钥或余额，没有付款/webhook 写。此认证发生在额度中断之前；稍后本机包的值仅做格式核对，**不将早先结果当作该包字节或当前凭据未变化的证明**。包中 `paymentProviderAuthenticated=false` 保持如实，webhook 归属/投递、public key 与 secret key 的同账号关系均未证明，付款触发后置。
- `createPreparedPrivateSingleTenantAcceptanceRuntime` 已接安全来源和 `ImmutableTemplateSaaSControlPayloadCompiler`，但仍不接受 enablement flag，`applyRuntimeReady=false`、`cleanupRuntimeReady=false`。缺少真实 Cell outputs/task revision/authority 时没有组装实际 live worker；不虚构 ARN 或把 prepared root 宣称为实机验收。

首位商户密码不进入配置/日志/本机密码文件。代码仅在真实 scoped deployment、verified generation 和 active provision epoch 存在时，经固定 Provisioner role/RoleId 读取自己准确 ARN/唯一 AWSCURRENT Secret 版本；检查四个 stable tags、五键 schema 和二次 metadata。使用既有随机 256-bit HMAC key 经 [HKDF-SHA256](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptohkdfsyncdigest-ikm-salt-info-keylen) 的独立域、app/template/generation/version 派生密码。同 generation/version 重试稳定，不把 mutable epoch 纳入密码，不新增第六 Secret 字段或 Secret 对象。密钥持有者可以派生该初始密码，未来交接/更改密码另行处理；尚未真实读取租户 Secret、派生实际密码或创建商户账号。Buffer dispose 清零，JS 字符串/KeyObject 不承诺取证级内存擦除。

`publicParameters` 里的 CORS 和 Stripe success/cancel URLs 只是部署输入提案，尚未核实前端回跳路由；本段不实施真实付款验收，不因此增加新支线。

## 本机文件与独立证据

准备成功时间 **22:12:22.521 UTC / Winnipeg 17:12:22.521 CDT**。目录 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2` 包含 private-material/binding/public PEM/summary/ACL proof；**全部在 Git 之外**。新目录去继承，只授当前 Windows 用户与 SYSTEM FullControl；独立进程检查目录及五文件实际 ACL、非 symlink/单 hardlink 和 pinned summary，再读取。权限限制不排除管理员/SYSTEM 或恶意本机软件。不要复制到仓库、聊天、Actions log、CI artifact 或不受限目录。

| 非秘密证据 | SHA-256 |
| --- | --- |
| 凭据包 summary 文件 | `9daf504a6d4cd3b281cb9632f41c45085d6f531f6af96680e44f05c8a805fd63` |
| 新 public PEM | `72f953b9f3dab5269a7a1c08fa7acf684d2d9c379ae446b50e3d8294404f02a2` |
| binding canonical hash（业务坐标私有） | `1a3540d7529e1b5839fbd85fcf47f76a05b95c8c5496148e636a75ada5e24834` |
| 独立 Inspect 文件 | `5406f81e36099f062acd8d272767642092aab38126bb7fbba949f063fdd24bb9` |

**22:15:59.651 UTC / Winnipeg 17:15:59.651 CDT** 独立进程 `PRIVATE_INPUTS_VERIFIED_RUNTIME_DISABLED`，8 项全 true：受限 ACL、真实 app configuration hash、published schema-v2、无 verified generation 拒绝、外 app token 拒绝、外 hostname transport 拒绝、序列化不含私密材料、准确 hostname。Neon 每次使用服务端 READ ONLY transaction，不导出配置；无 AWS API、token 或控制 HTTP。记录 `F:/ChatGPT_workshop/techlong-d001-private-inputs-inspect-20261013-r2.json`。

恢复不重生成 key、不重新执行已提交的业务安装。按上表可信 SHA 使用 `loadAcceptancePrivateSources` 加载既有 r2；loader 不从待验证目录自己取 expected SHA，也不自动修 ACL。只读 Inspect 脚本现有固定输出已存在，不能覆盖；后继采集须使用新输出。实际密码来源未运行，不用 Source 用户替代 MFA Provisioner。

本段8个源文件本机诊断绑定 `d18f6d5e2318b73c885afd815b06100fd972c382e0ace90a613563d55cabdcfe`，原件 `F:/ChatGPT_workshop/techlong-d001-private-inputs-code-20261013-r1.json`，UTF8/LF。仅供恢复核对，不是云执行批准 SHA，不新增永久云尝试槽。

保留失败历史：第一次调用未加载 `.env.local`，在连接/目录写前退出；随后 r1 目录创建后，PowerShell 7 的继承 PSModulePath 使 Windows PowerShell 5.1 无法载入 Security 模块，目录仍为空、ACL 未改。已在内存只读复现并验证子进程模块路径修正，r1 未修复/删除/覆盖。首次独立 runtime SELECT 误引用不存在的 `o.ownership_marker`，未写数据库；已按既有真实表结构改为 stable identity/epoch marker，最终独立回读通过。没有修改旧 schema 或源码 pins 来迎合新查询。

**重要保留风险**：原 `techlong-f3c2-materials-20261011-p3/client-key.pem` 继承本机较宽 ACL，新 r2 的限制不消除旧副本暴露面，不证明旧材料曾泄露。本轮未改旧 ACL、删除旧副本、读取 private CA 或轮换证书；这是下一付费审阅应知的风险，必要轮换须另定范围，不能静默替换已批准 CA/truststore。

## 实际 IAM 事实，不等同于已可部署

**19:49:17.039 UTC** Source 准确 Account/ARN/UserId 只读核对后读取现有 role/trust/inline/attached/boundary；**19:54:34.267 UTC** 补读两个 attached managed-policy default documents。后者已核对文档，而不是用 inline 数量猜权限。只是当时快照，未作最终组合权限模拟/实际运行证明。

| 角色 | 当时实际策略 | 下一主线必须补齐/核对 |
| --- | --- | --- |
| Provisioner | attached boundary 同名 managed policy v6，11 Allow；boundary v6，inline0；RoleId `AROAV3GNMXTZMEBX7MOF7` | 没有 Secret lifecycle/值读取、RunTask/epoch 写、Cell create/新角色 PassRole 等主线权限；有原 tenant CFN 生命周期权限，不能称角色无权限 |
| 原 CFN Execution | attached v7 13 Allow、boundary v7、inline0 | 核对实际 workload CFN handler/准确资源条件及非旧 Scheduler 路径；不据此声明收费 Cell 可创建 |
| TaskExecution | inline4 Allow、共享 boundary v3 | 两个固定 image 同属现有 ECR repository，不需新 ECR 仓库权限；新 lifecycle `/ecs/...` log 路径未覆盖，组合权限及 KMS 仍待准确审阅 |
| TaskRole | 无 inline/attached，boundary v3 | boundary 本身不授予权限；按实际 app 路径核对是否需要任何 AWS API，不因其他角色需求自动扩大应用权限；ECS Secret 注入使用 execution role |
| LifecycleTaskRole | inline4 Allow、共享 boundary v3 | 现有 receipts/Secret 读取不是 S3 baseline 读取、authority 读取或新 KMS/任务范围完整证明 |
| 新 FirstAcceptanceCellExecution | inline16 Allow，dedicated boundary v1 | 已安装事实保持，不能据此执行新 Cell；准确创建/UUID 清理 guard 和审阅仍缺 |

Inventory 文件 SHA `6f6a9a848eec577235d444dac5bbddbaaa7d9d21a5c76dff54ed365443f9efc5`，attached 文件 SHA `776c1ff0c940c137c8c2320cb62acda693562c6bbbcef5f074bc681643db383f`，目录 `F:/ChatGPT_workshop/techlong-d001-runtime-permissions-20261013-r1`。拟 `techlong/sandbox/control-public-key-first-acceptance` Secret 当次不存在；没有读取 Secret value/创建 Secret/修改 IAM，不能用“public key 已生成”代替 ECS 可读 Secret 已安装。

## 收口和唯一后继

本段新/相邻检查从10项扩展到30项全部通过，全项目 typecheck、定向 lint 通过。测试只证明身份/数据边界和密码稳定性（含相同tags不同返回顺序），不冒充数据库迁移、TLS 或收费部署。132 个 F3c9 +4 IAM +14 business 执行源码 pins 全部未变化，旧槽/记录保留。云/数据库写、Secret value read、job/deployment、TTL、Cell、永久云尝试槽消费均0，未重建镜像。

下一集中完成 **实际主线权限差异、live guard/journal 与独立 cleanup-readiness、控制 public-key Secret**，形成明确 Cell/DNS/费用/失败清理审批包。Cell 输出后准确回填 endpoint/master Secret ARN/lifecycle task revision，再批准后续权限/activation/一次 job；不制造 revision，也不将本段 readonly 日期作为新收费执行 deadline。50 USD/月仍是目标而非硬上限。F3c9 继续封存。
