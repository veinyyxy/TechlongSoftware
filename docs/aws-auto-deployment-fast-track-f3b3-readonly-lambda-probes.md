# F3b3：Lambda 只读实机验收入口已准备，等待 Source 刷新

2026-10-08 Winnipeg。本阶段已完成两个专用只读处理器、可重复 ZIP 构建及一次性安装/同步调用/独立只读核验入口。**未创建日志组或 Lambda、未调用函数、未读 Secret 值或连接 Neon、未改 IAM/authority/Cell；没有新可执行审批清单。** Source 凭据提供器返回 CredentialsProviderError，脱敏诊断确认错误含过期信息；预检停在身份读取，永久槽位未消费。

## 下一份审批将包含的准确资源与调用

| 函数名称（与已装 IAM 来源围栏一致） | 使用既有执行角色 | 新日志组 |
| --- | --- | --- |
| techlong-sandbox-cell-ttl-executor-v3 | TechlongSandboxCellTtlExecutorRole / AROAV3GNMXTZLB4NZQLZY | /aws/lambda/techlong-sandbox-cell-ttl-executor-v3 |
| techlong-sandbox-cell-drain-coordinator | TechlongSandboxCellDrainCoordinatorRole / AROAV3GNMXTZPRETOTXTS | /aws/lambda/techlong-sandbox-cell-drain-coordinator |

账户 402010193138、ca-central-1。拟从两函数/两日志组全 ABSENT 开始：各一次 CreateLogGroup（审批标签）+ PutRetentionPolicy（7天），再各一次 CreateFunction，**最多6次安装写 API**。函数为 Node.js22/x86_64/ZIP/index.handler/128MB/60秒/512MB临时空间，未发布版本、无别名、VPC、Layer、Extension、环境变量、自定义 KMS、DLQ、X-Ray、预置并发、URL、资源策略或事件源；日志 JSON/INFO、系统 WARN。不创建 Schedule/Cell/ECS，不修改旧对象。

创建后以独立只读 inventory 核对准确代码 ZIP SHA 的 Lambda 元数据、全部配置、角色/标签/日志保留，以及无资源策略/URL/别名/事件源/保留并发；每次调用前重读。随后最多两次 **RequestResponse 同步调用，各函数一次、无自动重试**，准确 event/独立 nonce 绑定同一小时清单。Source 新鲜 STS 身份检查使用与请求相同的自动刷新凭据，任何失响应只读 Inspect。Source 必须实际拥有准确资源的创建/标签/保留/调用/PassRole 权限；14项只读模拟还未运行通过，不能据当前代码宣称允许。若拒绝，另审权限范围，不自动追加 IAM。

函数安装的是新 `readonly-ttl-probe-v1.ts` / `readonly-drain-probe-v1.ts`，**不是原可执行 TTL/drain artifact**。以后替换为生产处理器必须另审，不能凭这次审批运行业务处理。

## 探针能证明什么，不能证明什么

- 仅接收准确 action/schema/64位 nonce，校对准确非版本/别名函数 ARN 和 STS 执行角色；凭据仅从 Lambda 环境读取，没有 profile/其他身份回退。
- 仅 GetSecretValue 自己的准确 ARN + 固定初始 UUID + 显式 AWSCURRENT，在内存验证载荷及 TLS Neon URL；TTL验证准确已登记证书摘要，drain验证自己的角色 URL。**不返回或记录密码、URL、SecretString、证书原件或密码摘要，不连接 Neon。** drain 的现有密码仍代表20项列写能力，本处理器不使用它写数据库；不把角色称为纯读/行过滤。
- TTL：原子读取两固定 authority key、直接读取两准确64位后缀 journal key；CF读取第一页 ListStacks 及准确 Cell 的 Describe/GetTemplate/ListStackResources。drain：只读固定 provision key。无 Put/Update/Delete、删除Stack、事务写、IAM或Secret写；没有链接业务 drain/delete/Neon执行入口。
- 错误只输出白名单名称/固定代码，各独立读最多一次，没有修复或身份回退。日志仅单条 nonce/requestId/函数 ARN/脱敏响应摘要；独立 Source 日志回读须匹配完整响应 SHA，不用本地返回值自己宣称日志已送达。签名同步 Invoke 的原始响应只在内存，闭合字段/长度校验后才保存脱敏回执，不使用 CLI raw outfile。
- 两个已装角色和 boundary 的来源围栏不变。AWS说明 Lambda 日志代理支持来源函数条件；默认环境加密无需新增用户/执行角色 KMS 权限，不添加宽泛 KMS 例外。[来源条件适用范围](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)、[默认环境加密](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars-encryption.html)。默认行为是否在本账户实机成功仍须实际创建/启动证明。
- 当前 Cell/两 authority key 的最后观察仍为上一阶段 ABSENT，并非本阶段新鲜观察。即使探针成功读取不存在的 key/Stack，也**不证明真实 Cell 的完整 CF 资源读取、有效前驱、零租户证据、drain密封v3业务兼容、删除安全或自动部署端到端**。独立回执保留这些 false 门禁，不据此安装 mutation grant 或假 authority。

新永久槽位 `F:/ChatGPT_workshop/techlong-f3b3-readonly-lambda-install-v1-consumed` 不自动复位。写前保存 attempt，六次安装或任一调用失败/不确定后停止，禁止继续补齐、删除、重试、重放或替换代码；只做独立读取。可能遗留函数/日志组且发生费用。每次写前检查已批准 RoleId/全部 IAM 文档；保留策略前检查刚建日志标签及未设保留，创建函数前检查日志和函数缺失状态。**这些读取不是服务端 CAS，无法消除管理员并发变更/额外调用，不能提供费用硬上限或全局恰好一次保证。** 本地槽位只限制本入口。

## 候选、自检与费用

最终私有候选：`F:/ChatGPT_workshop/techlong-f3b3-readonly-probe-artifacts-20261008-p2/`，报告文件 SHA `6cb4c1166a963b92d42b874884e6b91d5e236538a97d7128a22903fbe4599059`。

- ttl.zip：287033字节，SHA `ec0ef7479e7b15d4f27f9c5520736ca31d44faeb54a27cabb0813f825ed6f368`。
- drain.zip：287035字节，SHA `b4f8219360e89012b0cecbd2315bf55962e5308f9397cf028a9598bc8072f1d2`。

两次构建字节一致、ZIP单文件解包一致、依赖自包含启动和无凭据非法事件拒绝通过；15项定向测试、typecheck、lint及JS语法通过。不增加Docker Desktop、PG演练或重复镜像/GHA构建。p1候选及失败r1记录保留，p2仅增加脱敏响应与云日志摘要绑定；原IAM/Neon代码、审批binding及所有旧slot保持。

AWS公共 ca-central-1 价目表本轮只读核对：x86首档 `0.0000166667 USD/GB秒`、`0.0000002 USD/请求`，不假设剩余免费额度。两次128MB处理器各60秒的计算分量=15GB秒，连两请求约 **0.0002504005 USD**；这不是整单或实际费用上限，初始化/附加计费、Secret/DDB请求、CloudWatch日志/读取/存储、税费与账户既有费用另计。无预置并发/调度降低常驻计算需求，但外部额外调用和遗留日志仍可能收费，50USD/月仅目标。[区域公共价目表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSLambda/current/ca-central-1/index.json)、[Lambda计费](https://aws.amazon.com/lambda/pricing/)、[CloudWatch计费](https://aws.amazon.com/cloudwatch/pricing/)。

## 继续命令（只读，不安装或调用）

先运行 `aws login --profile techlong-sandbox-user`，回复“Source 已刷新”。随后从下列新目录生成 fresh review；它只读取资源/权限，目录不得覆盖：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-readonly-lambda-install-v1.mjs --mode Review --out F:/ChatGPT_workshop/techlong-f3b3-readonly-lambda-20261008-r2 --artifacts F:/ChatGPT_workshop/techlong-f3b3-readonly-probe-artifacts-20261008-p2
```

若当前日期/目录已有变化，另选新的 `techlong-f3b3-readonly-lambda-*` 输出；不复位或重用已消费执行槽位。Review通过后才有准确 fresh SHA、截止时间和批准措辞。当前不能要求用户批准不存在的SHA或直接Run；原748999...只批准已完成IAM基础，不授权本次Lambda/日志创建或调用。
