# D002 C4d：四键 Secret 已创建，独立元数据核验通过

2026-10-14 America/Winnipeg。用户确认 [C4d准确范围、既有读取暴露及完整风险](./aws-auto-deployment-aurora-dual-mode-c4d-runtime-secret-review.md)后，按SHA `77edc1a656068998d5719e0716fea2df4f8c54fa56c4f1fcaa42cf81a0ddfa97` 执行一次Run，紧随唯一一次独立Inspect。结果为 `SECRET_METADATA_INDEPENDENTLY_OBSERVED_NOT_RUNTIME_VERIFIED`。**没有读取Secret值，不是应用登录、完整ready或部署验收。**

## 实际资源与回读

准确Name：`techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1`。

实际完整ARN：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1-T9CqN5`。

实际VersionId：`0f45d29f-02d4-4117-99b1-c06645aa3c6e`，与受审ClientRequestToken一致。CreateSecret于22:43:34.957 UTC / Winnipeg17:43:34.957 CDT获得准确ARN/version成功响应（入口本地journal时间，不是AWS服务端创建时间）。随后另一个模式/进程的DescribeSecret确认准确Name/ARN、唯一受审版本标记AWSCURRENT、五标签、默认AWS-managed KMS及无replica；没有GetSecretValue。

受审程序在内存中生成两份新HMAC/JWT密钥，复用准确租户的Stripe test secret/webhook输入，仅提交四个JSON键。只读取一次固定私密源，目录/文件ACL和非秘密租户binding通过；未读`.env`，未向Stripe发请求，没有数据库密码、IAM token、控制私钥或证书进入Secret。独立回读只验证元数据，**没有回读或核验四项实际值/消费者/Stripe有效性**。

| 执行 | AWS/CLI元数据 | CreateSecret写 | 私密源读取 | GetSecretValue / SQL连接 |
| --- | --- | --- | --- | --- |
| Run | 14 | 1 | 1 | 0 / 0 |
| 独立Inspect | 6 | 0 | 0 | 0 / 0 |

Run预检查再次通过准确Source/临时凭据快照、物理Express17.9/FREE ACTIVE、管理connect simulation、两个名称缺席与execution读取暴露匹配。Inspect亦核对准确Source/RDS/plan，随后只回读一个Secret元数据。本轮20个元数据调用、1个AWS写；无重试、补齐、删除、rotation或第二版本。没有IAM/SQL/Neon/业务/authority写、Lambda调用、ECR发布或ECS/Cell部署，没有启用LOGIN或安装应用权限。C4c的NOLOGIN及隔离是历史SQL事实，本阶段没有重连SQL来重证当前角色/schema状态。

真实元数据已接入不变v2契约，生成四条固定到上述版本的ECS Secret refs（HMAC_SECRET_KEY、JWT_SECRET_KEY、STRIPE_SECRET_KEY、STRIPE_WEBHOOK_SECRET），没有向TaskDefinition写入私密值或注册任务。实际database binding digest为 `41c1d3eac63d9277a6f6910cd4db3df29b85086f47ed07bf7c4a2e8a23820231`；binding/ECS refs仍是候选数据，不是IAM、epoch/activation、任务运行或ready证明。

## 已接受的暴露与持续费用

Run独立重读的execution role ID `AROAV3GNMXTZJHJWAN4IR`与共享boundary ID `ANPAV3GNMXTZHXSTCQBZC`默认v3/两个文档SHA保持受审状态。二者的GetSecretValue Allow Resource `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/*`覆盖这个真实新Secret。**0 IAM写不代表它不可读取；创建已将其置入既有Allow范围。** 没有测试实际SCP/session/KMS/任务角色读取，也未完整盘点其它管理员或principal，`effectiveSecretReadVerified=false`。

一个新的持久化Secret已存在并可能持续计费；费用目标和完整风险沿用已批准清单，50 USD/月不是cap。没有自动删除或费用归零承诺。私密输入/生成值/SDK临时字符串的内存擦除仍是尽力而为，未保存或输出SecretString/值hash；并发及提供者日志风险保持。

## 完整性与不可重放

- Run目录：`F:/ChatGPT_workshop/techlong-d002-express-c4d-run-20261014-r1`
- Inspect目录：`F:/ChatGPT_workshop/techlong-d002-express-c4d-inspect-20261014-r1`
- create槽于22:43:34.572 UTC消费，inspect槽于22:43:46.621 UTC消费，均绑定本SHA/version且`retryAuthorized=false`。

独立本地文件核验确认创建响应ARN/version、Inspect实际binding、四条refs、批准SHA、回执计数和双槽一致。251源码按受审LF规则及2工具均不变，code binding `7bcb167477a91756f2a136af524199072913a9b875570cb495381b0f57437703`；9份安全结果文件和2槽用原始字节SHA记录。[紧凑结果与全部文件SHA](../ops/aws-sandbox/reviews/aurora-express-c4d-runtime-secret.executed.json)。这不是额外AWS/SQL回读。

两槽永久消费。即使原清单未到期，也不得再次Run/Inspect、刷新以重放、创建第二版本、删除/重建或复位槽。所有C4c/C4b/C3/Full失败及F3c9记录保留。本轮后处理仅结果文档/非秘密证据；执行源码/251pins及Backend153efbc已验镜像不改，不重测历史大套件或重建/发布镜像。用户`.vscode/settings.json`不动。

## 唯一下一主线

真实Secret ARN/version现已取得。下一fresh核对三个既有角色、共享boundary与inline/attached策略，准备仅准确app SQL username和postgres管理username的rds-db:connect、准确Secret版本读取，以及共享boundary变更影响；现有execution读取Allow是宽前缀，不能把它说成已完成“准确版本最小权限”。保留旧Full路径，拟议IAM next-step只含真实资源坐标，不是安装权限或可执行策略。

随后准备C4a最小SQL授权/受限rds_iam/LOGIN、真实TLS IAM登录、完整ready/首轮初始化，再沿已验两镜像推进ECR→ECS。实际IAM/SQL/初始化/发布/部署写各需新具体范围和fresh SHA批准。当前C4d授权已经完成，不延伸至这些动作；不增加Secret值/隔离/恢复探针或重启F3c9。
