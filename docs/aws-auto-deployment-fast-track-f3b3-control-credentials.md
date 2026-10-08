# F3b3：Secret-first 控制凭据与 LOGIN 审批入口完成，未执行

2026-10-08 Winnipeg。接续已安装的两个NOLOGIN角色，完成独立凭据启动入口、只读审批/只读恢复、真实PG18 SCRAM认证证明。本阶段只准备代码和fresh清单；**没有生成生产密码、读取生产SecretString、设置Neon密码/LOGIN、创建AWS Secret或启用运行时。** 旧schema/登记/角色安装代码、SQL和永久slot保持不变。

## 具体新写范围

仅现有 `techlong_cell_cleanup_reader` / `techlong_cell_drain` 两角色，以及ca-central-1/账户402010193138的两个新Secret：

- `techlong/sandbox/cell-cleanup-readonly-v3`：严格五字段schema3/protocol/databaseUrl/certificateSha256/expectedRegisteredCertificate，完整原证书pin `dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f`。
- `techlong/sandbox/cell-drain-control`：严格databaseUrl-only，准确writer用户名；不是历史draft别名。
- 每角色独立32随机字节密码，256-bit随机性；URL固定原Neon host/database/5432、verify-full/channel_binding=require，管理者URL/密码不写入Secret。先存两Secret并验证本次UUID初始版本AWSCURRENT/标签/完整ARN/载荷，再用一个Serializable事务给两角色设置SCRAM verifier及LOGIN。
- 不重新创建角色、补GRANT、授owner/membership或扩大表/列权限。**LOGIN是真实数据库认证能力：drain已有的20项列写能力将可被使用，不等于“仅只读”或“还没有新增访问能力”。** Lambda/Worker/Scheduler仍不安装或启用。
- 最多两次 `CreateSecret`，附Project/Environment/Purpose/ApprovalSha256准确标签（因此也需TagResource权限），不调用PutSecretValue/UpdateSecret/Rotate/Replicate/PutResourcePolicy/DeleteSecret。省略KmsKeyId，使用AWS-managed `aws/secretsmanager`；首次使用可能由AWS创建该服务管理key，不创建客户管理key/IAM/Stack/付费Cell。[CreateSecret初始版本与默认key行为](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html)

源身份固定profile `techlong-sandbox-user`、准确IAM user ARN `arn:aws:iam::402010193138:user/techlong-sandbox-dev`；每个服务操作获取一份凭据对象，用同一对象先STS验证再签SM请求，无环境变量/其他profile回退，region固定/endpoint override忽略/maxAttempts1。没有新IAM权限安装；后续IAM/Lambda/authority另批。

## 安全和失败边界

固定新本地slot `F:/ChatGPT_workshop/techlong-f3b3-control-credentials-v1-consumed`，Review/Run只接受未占用slot。错误/过期SHA、代码/目标/原角色/Secret非ABSENT/价格变化先拒绝，密码在完整preflight/claim/批准marker保存后才生成。每次Create和数据库事务前均记录不含秘密的attempt；未知响应不重发、不生成替代密码/版本、不清空slot。

AWS与PostgreSQL之间**没有分布式事务**。第一/第二Secret创建失响应或失败时，可能留下一个或两个收费Secret，角色仍NOLOGIN；两Secret核验后数据库SQL失败会ROLLBACK，但Secret仍保留。COMMIT失响应或认证失败时，两角色可能已LOGIN；只能独立Inspect确认。**本清单接受部分状态保留，不自动删Secret、NOLOGIN/down、改密码、撤权、续跑或补齐。** 如果需要后续写恢复/清理，必须另给具体新SHA批准。CredentialReady=false不是凭据已撤销的证明。

DDL仅发送客户端生成的 `SCRAM-SHA-256$4096:...` verifier，不把明文密码放入ALTER ROLE SQL。明文URL/密码/SecretString仅在进程内和AWS加密Secret值中，verifier也不写入本地日志/marker/Git；JS字符串不能可靠立即清零，PG服务端审计日志可能记录verifier，不能承诺所有服务日志一概无敏感内容。[PG密码认证](https://www.postgresql.org/docs/18/auth-password.html)、[ALTER ROLE日志风险](https://www.postgresql.org/docs/18/sql-alterrole.html)

独立Inspect仅在消费slot绑定原manifest时运行：准确Source重新验身份、按两固定名称Describe，要求本次Approval标签/UUID/完整ARN/AWSCURRENT、无rotation/replica/resource policy/客户KMS。Describe只列带label版本，故另用 `ListSecretVersionIds(IncludeDeprecated=true)` 验证无第二/隐藏版本，再GetResourcePolicy及GetSecretValue准确ARN+UUID+AWSCURRENT。不读取不匹配对象的值；只用读取到的URL建立TLS只读身份认证，不做业务DML；前后两次管理快照核对完整角色/权限/原seal保持。失败只输出固定代码，文件只保存非敏感元数据。[DescribeSecret版本/KMS字段语义](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DescribeSecret.html)

## 只读库存、费用和权限可行性

实际Neon原安装manifest的只读Verify：`F:/ChatGPT_workshop/techlong-f3b3-control-roles-20261008-c1-verify`，readback SHA仍 `e995627f19eb029c88ec0b474cdaaed240264ff22d3507c89aed329f9830757f`，原角色NOLOGIN/权限与原件未变。

Source只读资源库存 `F:/ChatGPT_workshop/techlong-f3b3-v3-resource-read-20261008-c1/resource-inventory.json` SHA `bc6b5a2441a15e506719717d474a39a5c38a4ca5a9bebcfa77f819fad5ac13a7`：两目标Secret、新IAM两角色、新Lambda均ABSENT，现有authority表ACTIVE/PAY_PER_REQUEST。未GetSecretValue。

准确Source的IAM只读模拟对两个占位完整ARN及标签条件，CreateSecret/TagResource/DescribeSecret/ListSecretVersionIds/GetResourcePolicy/GetSecretValue六项结果均allowed、无MissingContextValues。占位后缀不是未来实际ARN，模拟不检查所有服务依赖/SCP/并发变化，**不等于实际AWS写已验证**，也不是新增权限批准。

ca-central-1官方公开价表GET SHA `9bea1ef20cb2951a28b8f8f7c6d77418070732e93b209f58dbe62352f863b507`：0.40USD/Secret/月、0.000005USD/SM API call（0.05/10000）。两Secret基础约 **0.80USD/月**，另加请求相关费用、适用KMS费用/税费；部分失败留下的Secret也可能继续收费，不假设free-tier抵扣。50USD/月仍是目标，不是实时硬截断或绝对零费用保证。[AWS公开价格](https://aws.amazon.com/secrets-manager/pricing/)

## 验证

67项定向（前57+本凭据入口10）、typecheck/lint/JS与PowerShell语法/production build通过。覆盖错误/过期批准、角色漂移、slot证据失败、两个Create失响应、错ARN/版本/stage/标签/载荷、第二ALTER回滚、失COMMIT只读恢复、认证失败/部分状态不补齐、密码不入SQL/marker/receipt及复制材料不能发DDL。没有改package.json/lock，避免破坏历史角色安装code绑定。

[首次GHA真实PG18 run37852674578](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37852674578)，head `76ca4b95741b6d87f4a5a28c0c1534ca9278a823`/attempt1 success，29组证明。新增三组：先两mock Secret后二角色原子SCRAM LOGIN，真正新密码认证/reader默认readonly，失COMMIT后独立认证恢复及旧批准不重放，错误密码拒绝/marker与receipt不含明文。PG角色/LOGIN/认证是真实CI自有PG18，**AWS Secret服务仍mock，不是AWS线上创建证明**；没有访问生产Neon/AWS值。

两自有DB drop/容器stop和固定image/head/29proof/平台artifact digest独立核验；私有 `F:/ChatGPT_workshop/techlong-f3b3-pg18-ci-20261008-c1`：archive SHA `85b4ab5c00735e3d8fd3866b2fbef6edc8ece0ad205b225727bb29e9e22cb0c1`；report `ad4103341ebd166ace1e0ae2518b462c7f9dcafe5502d0511948d9cb77983088`；receipt `273db28f080cbbc62015f3fd5ddf291ca789d99512164366f88070ec361d3a6c`；independent verification `5816288e0e5c2ea22959adffcf74298de1b53ff0f7a5f34a017c4ccbe11b5b72`。没有新本地Docker/PG安装，没有重建app/lifecycle镜像。

补强元数据的最终head `df9a135b69898ef48320ff3bce2c283eb27c09be`：[run37853428469](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37853428469)/attempt1 success，同29组。接受PrimaryRegion为本区域但仍要求零replica，其他区域拒绝；仍无scope扩大。独立reader最终私有c2：archive `31d4e13e5c9281037968879d716f43fb93abd69f70588340cdf12f0ed12a2192`，report同ad410334...，receipt `cfb066468e2402a37bfa6529573e29f8754851d8fef1284e6364747f8bcf9f6d`，verification `8a6873b703ad12be193f2d011b35943d584b4e71c37b5c6368d8e94d8e07d621`，两DB drop/容器stop再次独立核验。

## 唯一最终执行清单（尚未批准）

最终只读Review目录 `F:/ChatGPT_workshop/techlong-f3b3-control-credentials-20261008-c3`：

- manifest SHA **`85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54`**；文件SHA `f8cf6afa721e504715d1645019849be61a1066b43672f6eca8e69f18f077b481`。
- reviewedAt 2026-10-08 22:26:12.968UTC，expiresAt **23:26:12.968UTC / Winnipeg 18:26:12.968CDT**，有效一小时。
- code binding `3ec561f34c95cf2f80e6ba8a6cebf5572c26d5eeeac28f598d00593960b084c0`、target fingerprint06e118...、endpoint SHA `eba865e3d3908f96e71975bf76c300082becb517b69eb41a5593e8468eefeda2`、完整证书DC pin。
- 原角色审批4ef39a...永久消费不再Run；当前roleState `1528e1e2888bb191200d8bc2224318512cfa63f5aaa138eb324870674f3fe0ef` / preserved993506...，LOGIN=[false,false]；新credential slot不存在。
- 两个初始VersionId/ClientRequestToken分别 `3f8047d4-e357-4d32-ae87-861fda5f8253` / `72eb93b3-1da0-40a2-a5a1-176e6869ae98`，不是密码。read-only observation文件SHA `8bc1b6423683393afce02439c731cf83414dd6d909bf86f6e3716f91703c8c99`。

c1草案2b4fd9...及c2草案1c026c...均保留，但code已改，不执行。**“开始下一步”、原NOLOGIN批准或Git默认授权都不代表已批准此新云/LOGIN写入。** 当前Source有效；若过期只刷新身份并再次STS核验，若manifest过期则只读Review新SHA后再确认。

确认上述准确新scope后才可运行：

```powershell
node --experimental-strip-types --env-file=.env.local ops/aws-sandbox/scripts/review-f3b3-control-credentials.mjs `
  --mode Run --out F:/ChatGPT_workshop/techlong-f3b3-control-credentials-20261008-c3-run `
  --manifest F:/ChatGPT_workshop/techlong-f3b3-control-credentials-20261008-c3/review-manifest.json `
  --approved-sha 85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54
```

Run自动独立Inspect；任何非零/unknown只在新目录用 `--mode Inspect` 与原manifest回读，不再Run，不自动更换密码/补Secret/撤销LOGIN。接下来的IAM/boundary/Lambda/authority及单Cell/单租户自动部署验收仍另批，当前所有runtime off。两个main按默认Git授权提交推送，服务端仅同步记录。
