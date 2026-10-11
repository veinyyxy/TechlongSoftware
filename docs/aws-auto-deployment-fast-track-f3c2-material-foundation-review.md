# F3c2：空 baseline / mTLS 基础受控在线安装清单（未执行）

2026-10-11 Winnipeg。复用已验收的空 PG16.14 baseline、已发布两镜像与已签发 sandbox ACM；没有重新导出、连接数据库、构建镜像或执行云安装。新本地 sandbox CA/客户端材料及一次 Review/Run/独立 Inspect 入口完成，14新+14相邻共28测试、typecheck、定向lint通过。50 USD/月仍为目标，不是硬上限。

## 当前实际结果与权限不确定性

23:33:05.897 UTC只读回读：准确Source UserId `AIDAV3GNMXTZEO7SHLC2X`、ARN `arn:aws:iam::402010193138:user/techlong-sandbox-dev`；DNS准确4NS、证书 `6d1f2880-9f83-449c-930a-6b17516ef49d` 为ISSUED；baseline桶、目标Trust Store、ELB服务关联角色和新临时inline policy均缺失。17项当前Source权限模拟中16项管理/上传/读取allowed，**`elasticloadbalancing:AddTags`为implicitDeny**。补齐实际标签/CreateAction上下文仍未证明允许；附加最小策略、独立策略及CLI交叉模拟也没有证明允许，不能宣称原因已被充分解释或新策略已生效。

**本清单是需要单独接受风险的受控实际尝试，不是“全部权限模拟通过”的安装。** r1/r2阻止安装的原记录保留，没有把结果改报allowed。新协议明确绑定上述缺口：一次安装准确、限时的最小Source策略并精确回读；这不证明有效权限或传播完成。随后只尝试一次准确带标签CreateTrustStore，由AWS实际鉴权，拒绝/失响应即停止，不创建替代名称/无标签对象、不扩大权限、不重试。失败可能已创建服务角色、桶、配置和三对象；这些前置资源不自动回滚。标签依赖与创建限定语义参考[AWS创建时标签权限](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/tagging-resources-during-creation.html)、[ELB V2授权表](https://docs.aws.amazon.com/service-authorization/latest/reference/list_elbv2.html)；[IAM模拟不等于实际操作](https://docs.aws.amazon.com/IAM/latest/APIReference/API_SimulatePrincipalPolicy.html)。

## 需要确认的 fresh SHA

旧r4清单 `de586cd95bddba22fb6125008923cd2c96cf7c8a04fd97beb41976772657af74` 已于2026-10-11 Winnipeg18:13:55.383过期；用户在过期后表示确认，本次没有沿用该确认执行。r5仅重新只读Review，原材料、7文件代码、资源范围及风险、anchor均保持，旧目录与辅助入口保留，新槽位仍空；下列新SHA须重新明确确认，旧确认不自动转移。

- Manifest：`6b47167066caf637608833497dcd30aa85855f265129c5a15e756b14c517afab`。
- 文件SHA：`a7fd3b640ebba8ca03ec80961c31c9fde4e43e55858855fb184423de044bac97`。
- 7文件代码绑定：`b6c884c9b5e4e4cc6ddff9556a04ad40876cbaeae9a439bcdbaca32f2b8220d7`。
- Review `2026-10-11T23:33:21.359Z`；截止 **2026-10-12 00:33:21.359 UTC / Winnipeg 2026-10-11 19:33:21.359**。
- 私有目录：`F:/ChatGPT_workshop/techlong-f3c2-foundation-20261011-r5`。
- 库存文件SHA `fa407cb32cd9d7747560dcce3a8fd59743c1fdaca7b74f232ad38a56303be044`，anchor `3817ce517efe1b40a71720971d23c5c656af30106a3ea97d1f8b59b5cd00ddcf`。
- 精确临时策略文件SHA `f43274c8de35c8288b68fbb64908ef1abea6d79bd5833c2638905a343d6da08f`；canonical SHA `b89c13e43017a6854f12e21d14f51aa62a1b9acc9e5389de6d9251f9fb60acc7`。其模拟证据文件SHA `25ad5f41a8759df0cc2b1c8d23f3ccd2441ecebf5d185c48f11d123016d264ec`，decision仍implicitDeny、effectiveAllowProved=false。

## 最多12次直接写调用，成功或失败立即撤回临时策略

1. 在准确Source user新增临时inline `TechlongSandboxControlTrustStoreCreateTagsV1`，不替换现有策略、不改boundary。仅Allow `elasticloadbalancing:AddTags` 对 `arn:aws:elasticloadbalancing:ca-central-1:402010193138:truststore/techlong-sandbox-control-v1/*`，要求CreateAction=CreateTrustStore、准确region、五个准确标签值及键集合（含本manifest和CA SHA），并受本清单review/expiry时间限制；不允许事后给已有资源任意打标签。
2. 一次 `CreateServiceLinkedRole`，仅服务 `elasticloadbalancing.amazonaws.com`，生成准确 `arn:aws:iam::402010193138:role/aws-service-role/elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing`。这是账户级AWS管理的服务关联角色，自动使用 `AWSElasticLoadBalancingServiceRolePolicy`，**没有自定义boundary**；不是仅本桶的最小任务角色，也不自动撤回。未来AWS可能更新其托管策略。[官方角色说明](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/elb-service-linked-roles.html)。
3. 新建ca-central-1桶 `techlong-sandbox-402010193138-ca-central-1-tenant-baselines`，BucketOwnerEnforced，不设置ACL。
4. 设置全部四项Public Access Block=true。
5. 设置SSE-S3 AES256默认加密，不创建KMS Key。
6. 设置准确Project/Environment/Purpose/ApprovalSha256/CaSha256五标签。
7. 安装该新桶的Deny-only策略：拒绝非TLS、无 `If-None-Match:*` 的Put、DeleteObject/DeleteObjectVersion，以及Lifecycle/Replication/Versioning修改；无跨账户Allow或公开读写。管理员仍可能修改桶策略，不能称不可篡改或Object Lock。
8–10. 各一次条件PutObject，仅下表三对象，指定AES256、准确长度、SHA256 checksum和metadata；不覆盖，不上传client证书/私钥、CA私钥/口令或其它材料。
11. 仅新建Trust Store `techlong-sandbox-control-v1`，从准确CA对象读取，五标签一致；无objectVersion参数，使用被本桶策略保护的准确SHA键当前对象，不宣称S3版本ID锁定。服务返回准确ARN后绑定，不修改已有Store、不添加CRL、关联Listener或创建ALB。
12. 无论上述成功或失败，立即对准确Source/准确policy名尝试一次DeleteUserPolicy，先回读文档等于本manifest生成的完整policy，异物/漂移不删除；随后独立确认缺失。该精确撤回在原授权deadline之后仍允许，资源安装则不允许过期。撤回失败不自动再试；策略的时间条件会失效，但未删除的policy不是“已撤权/Locked”证明，必须处理和独立核验。

服务内部操作可能多于这12次直接调用（例如服务角色附加托管权限、Trust Store内部导入），不能把此数称所有AWS内部写入上限。撤回仅临时标签策略；服务关联角色、S3桶/对象和Trust Store均保留。新永久槽位 `techlong-f3c2-sandbox-material-foundation-v1-consumed` 一经消费，不自动复位、补齐、回滚、删除或写重试；不借失败转换无标签创建或绕过其它部署门禁。

| 公开/空材料 | 准确桶内键 | SHA256 / 字节 |
| --- | --- | --- |
| 空baseline archive | `approved/1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a/baseline.dump` | `1a65288b4628018932a8d9af4658db5702b6cf49966a2032bc2d919bc591d70a` / 203375 |
| baseline manifest | `approved/62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971/baseline.manifest.json` | `62b5dc8cadcf276df140be86e002a08b64d9b713bd0257e14ac515c12a996971` / 26502 |
| 公共客户端CA | `mtls/sha256/e60ee2d18d79c7e28c1e1dae192798ba7e18c5a106dcb5e280c1dd5643d27d5d/ca-bundle.pem` | `e60ee2d18d79c7e28c1e1dae192798ba7e18c5a106dcb5e280c1dd5643d27d5d` / 1497 |

确认包含上述准确baseline仅用于sandbox bootstrap的发布批准；不是production恢复、数据库写入或runtime activation批准。独立Inspect会GetObject复算三对象字节、校验全桶配置/准确对象清单、RoleId和AWS管理角色trust；Trust Store必须ACTIVE/1CA/0CRL/无关联/准确标签，还读取服务返回的十分钟有效S3 URL下载公共导入bundle并核对完整字节SHA。URL仅在内存，不写日志或Git。[导入bundle读取](https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_GetTrustStoreCaCertificatesBundle.html)、[CreateTrustStore](https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_CreateTrustStore.html)、[S3条件写](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html)。

## 私有材料与必须接受的风险

本地目录 `F:/ChatGPT_workshop/techlong-f3c2-materials-20261011-p3` 在写key前限制为当前用户FullControl的受保护Windows ACL；独立读取再次确认。RSA3072/SHA256自签sandbox root（到2027-10-11）与仅clientAuth leaf（到2027-01-09），签名、CA/非CA、客户端私钥匹配均实际验证。client公开证书SHA `195690a24ed53f23ea891158cbe5c6472cdff098b8c5e250dc2171c5c31c9182`；本地receipt文件SHA `771f813dac5f9dbf21734530490e122207c322f2004e91345dba0c6cb8cb1bef`。未做TLS端到端验收，ALB服务器的公共ACM信任方向与客户端CA严格分开；不把客户端CA拿去信任服务器。[ALB CA格式/认证说明](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/mutual-authentication.html)。

接受本地未加密client key、加密CA key与口令同一ACL目录（不是独立第二因素防护）、管理员可取得所有权、机器/备份泄漏可能导致凭据泄漏；现阶段不部署Secret分发、CRL或自动轮换，90天客户端/一年CA到期需独立轮换，失窃需另行撤销处理。此前p1/p2因ACL模块加载失败，仅留下空目录；已固定系统模块路径，未放宽权限，所有失败记录保留。

接受标签有效路径未证明、精确策略回读不保证有效权限/传播、IAM和S3/ELB跨服务非原子、预检不是服务端CAS、并发替换/失响应/保存失败、默认配置短暂窗口、S3缺少不可复用对象级资源ID、配置或临时权限可能部分遗留。IAM DeleteUserPolicy没有条件CAS，回读与删除之间仍有竞态；异常漂移拒绝删除但会遗留policy，需要人工处理。凭据自动刷新可能失效，无法保证立即撤回总能成功；不自动再试或扩大范围。

接受不可自动补齐的永久槽位与资源可能持续计费；没有自动资源删除或失败补偿。bucket Policy并不防御有权限修改策略/删除policy的管理员，本批也不设置Object Lock。保留原IAM策略、旧绑定/slot/失败证据和镜像；不改ACM/DNS/Secret/Key/Neon/authority/Budget/readcap，不调用/更新Lambda，不创建Cell/ECS/RDS/ALB/Listener，不启用Worker；旧schema1/PLAN_ONLY模板不能直接apply。

## 本轮费用模型

官方ca-central-1 S3价格已实际GET（2026-10-11T22:07:54.011Z）：前50TB Standard **0.025 USD/GB月**、Tier1 **0.0000055 USD/请求**、Tier2 **0.00000044 USD/请求**；私有selected-prices文件SHA `850e077694f09400038479287fe33b870816fbd2edc355e4791084441acc4b01`，完整feed SHA `334d19d3014f221e9ed43276b03c09db5dfa6333f18d444c2c0d10131f858aaf`。[官方区域表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ca-central-1/index.json)、[S3计费项](https://aws.amazon.com/s3/pricing/)。

三对象合计231374bytes；假设各200次Tier1/Tier2及保留一月这三文件，模型约 **0.001194 USD**（小于0.01USD）。这是演示请求数量/存储模型，不是调用次数、账单总额或费用硬上限，未包含传输、CloudTrail/日志、税、其它已有资源和后续运行。保留的DNS zone原0.50USD/月另计。Trust Store区域关联使用价 **0.0055 USD/ALB关联小时**；本清单不创建/关联ALB，未来关联另计，不能因此保证账单绝对零。[Trust Store关联计费](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/trust-store-sharing.html)、[ELB区域表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ca-central-1/index.json)。

## 执行入口与继续

目前cloudWrites=0，新执行slot空，runtime=false；Git按默认授权两main提交推送，私有key/archive/原始材料不入Git。确认本页SHA、12调用范围及上述风险后，助手可运行一次 `F:/ChatGPT_workshop/Run-ReviewedMaterialFoundation-6b471670.ps1` 加准确 `-ApprovedManifestSha`，它会一次Run及新的独立Inspect；**尚未确认，不能现在运行**。过期只能新只读Review并确认新SHA，不沿用旧批准或重放r1/r2。

完成后仍未证明TLS实机、Aurora恢复/迁移、租户ready或清理闭环；下一阶段准备专属任务IAM/readcap/Budget与v3准确清理兼容模板/短TTL Cell评审，实际部署另批，不提前drain或假authority。
