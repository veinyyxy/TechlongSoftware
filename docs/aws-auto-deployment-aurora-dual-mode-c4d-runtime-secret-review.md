# D002 C4d：四键运行时 Secret 单次创建待审

2026-10-14 America/Winnipeg。[C4c隔离已提交并独立核验](./aws-auto-deployment-aurora-dual-mode-c4c-isolation-executed.md)后，继续首轮真实部署主线。本阶段已完成代码、针对性验证和只读清单，**尚未创建Secret、读取私密材料、修改IAM/SQL或启用runtime**。不扩展F3c9、Grant或恢复探针。

## 最终清单及准确范围

SHA：`77edc1a656068998d5719e0716fea2df4f8c54fa56c4f1fcaa42cf81a0ddfa97`。

准备2026-10-14 22:34:32.263 UTC / Winnipeg17:34:32.263 CDT；有效至2026-10-15 04:34:32.263 UTC / **Winnipeg2026-10-14 23:34:32.263 CDT**。错误/过期SHA在凭据、AWS和私密材料读取前拒绝。r4的ab4f0932...已被增加准确读取暴露风险的r5取代，不得执行。

仅在账户402010193138、ca-central-1创建一个指定Secret：

`techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1`

Name与不变的生命周期v2 wire兼容，绑定准确app/workspace/产品/environment/cell、稳定identity `a0da1748bc4d5419a6306b89c090957bc432332f6cc33820abc7f02ad63a808d` 和generation1。五个标签：ManagedBy=techlong-sandbox、SecretSchema=techlong-runtime-four-key-v2、DatabaseProfile=express_iam、ResourceGeneration=1、StableIdentity=上述完整hash。

唯一一次CreateSecret随同创建初始版本，固定ClientRequestToken/预期VersionId为 `0f45d29f-02d4-4117-99b1-c06645aa3c6e`。不指定KmsKeyId，使用默认AWS-managed `aws/secretsmanager`；不创建客户管理Key、配置rotation/replication、更新旧Secret或添加第二版本。[CreateSecret参数与版本规则](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_CreateSecret.html)。

SecretString只包含四项：hmac_secret_key、jwt_secret_key、stripe_secret_key、stripe_webhook_secret。HMAC/JWT在获批且消费槽后生成两份独立32字节随机密钥；Stripe两项复用同一独立sandbox租户的既有test输入，不伪造、不再次调用Stripe。**无database_url、数据库密码、IAM token、access key、控制私钥或证书字段。**

唯一私密来源是 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2/private-material.json`，仅Run在明确批准后最多读一次；不读`.env`或AWS Secret值。非秘密binding/summary固定字节与binding digest `1a3540d7...`先核对租户一致；消费槽前检查原目录/文件ACL只允许当前Windows用户及SYSTEM且目录禁止继承，不更改ACL。当前只读ACL元数据检查通过，未读私密文件内容。该JSON原件还含其它控制私钥：仅选择Stripe字段用于Secret，但原始缓冲区/解析对象仍可能短暂包含其它私密值，见风险。

| 动作 | 最大写范围 | 回读与保持 |
| --- | --- | --- |
| Run | 1次CreateSecret（含初始版本与标签） | 精确Source/物理Express/账户plan、两Name缺席、现有execution读取暴露再次核对；新永久create槽 |
| 独立Inspect | 0写、1次DescribeSecret | 新永久inspect槽；准确Name/完整ARN/固定版本AWSCURRENT/五标签/默认KMS/无replica，产生四条版本固定ECS refs，仅元数据候选 |
| 不在范围 | IAM/SQL/Neon/Lambda/ECR/ECS/Cell写均0 | 不授予应用权限/rds_iam、不启用LOGIN、不写epoch/authority、不创建或修改业务记录 |

Run正常14个AWS/CLI元数据调用，Inspect正常6个，各模式硬上限16；SQL连接、AWS GetSecretValue与私密材料读取（Inspect）均0。SDK maxAttempts=1；不重试创建。Source临时凭据快照由独立STS核对，要求至少剩120秒；调用前检查固定代码/批准SHA和30秒事实窗口。

新固定槽为 `techlong-d002-express-c4d-secret-create-v1.permanent-slot.json`、`techlong-d002-express-c4d-secret-inspect-v1.permanent-slot.json`（F:/ChatGPT_workshop），当前均未消费。Run消费槽/可能提交后，无论成功、失败或响应未知，先做本范围唯一独立Inspect，不重跑Run。提交前预检查失败且未消费槽时不自动重试。Inspect缺席只报告需审阅；外来版本/标签/身份变化即停止，不补齐或删除。

## 已有读取暴露：零IAM写不代表不可读取

本次fresh只读核对准确execution role ID `AROAV3GNMXTZJHJWAN4IR`、仅一项inline/无attached，以及共享boundary ID `ANPAV3GNMXTZHXSTCQBZC`默认v3。`PullSandboxImageAndRuntimeSecrets`与`TechlongSandboxServiceRoleBoundary`都包含GetSecretValue Allow，Resource为 `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/*`；新Secret匹配这个既有范围。

因此，**创建本Secret会将其置入既有读取Allow规则覆盖范围，即使本阶段IAM写入为0**。这不是对完整SCP/session/KMS/任务实际读取成功的证明，也未盘点所有管理员/其它principal访问。未执行AssumeRole/GetSecretValue。Source仍是现有管理员。用户必须一并接受这项新Secret暴露风险，不能把“未新增IAM”解释成无人可以读它。

## 完整风险

- 一个Secret按当前官方示例估算约0.40 USD/月，API调用另计（0.05 USD/一万次）；不含已有Aurora、日志及其它资源费用/税费/信用抵扣。50 USD/月是目标，不是硬cap。[官方费用](https://aws.amazon.com/secrets-manager/pricing/)。
- 复用既有Stripe test输入，新HMAC/JWT生成于内存并仅交给区域AWS Secrets Manager。原私密JSON缓冲区含其它私钥，SDK/JS/临时字符串可能保留值；释放引用与buffer擦除不保证清除所有内存副本。不打印/持久化SecretString、密钥或其hash。
- 既有execution Allow覆盖新Secret，其它已有高权限访问未完整盘点；批准本阶段接受这项暴露，但不授权任何实际Secret值读取或新权限安装。
- AWS Login刷新仍可能失效；服务/提供者可记录请求与连接元数据。Source是高权限管理员，并非新最小权限执行边界。
- ACL检查、IAM/RDS元数据、名称缺席、创建与独立回读不是CAS；并发操作者可修改对象、标签、版本或访问权限。公开标签/token不能消除冒充/同名竞态，元数据回读不证明四项实际内容或消费者行为。
- 两新槽永久消费。超时、响应丢失、进程/本地回执保存失败可能遗留收费Secret及未知状态；无自动删除、补偿、rotation、版本补写、down、复位或重试。唯一独立Inspect也不循环轮询或重试。
- C4c是历史实机隔离事实，本阶段不重连SQL或重查schema；应用仍NOLOGIN，无实际IAM登录、完整ready/初始化或ECS部署证明。审批本SHA不延伸至后续IAM/SQL/发布/部署。

## 实现、证据和唯一继续位置

纯review/material/metadata适配器及严格CLI已实现：7新+3相邻共10tests、typecheck、syntax、定向lint通过。真实错误SHA在LOCAL_BINDING拒绝，AWS/私密读取/SQL/槽消费全0。251当前源码pins+2原工具，原248源码与C4c所有结果/槽不变；Backend153efbc执行源码与已验镜像保持，无需为本次平台代码重新构建镜像。

Source初期不可用/过期的r1–r3保留，均未写/读私密/消费槽；CLI与SDK最终身份恢复。r4只读7metadata成功，但因遗漏既有读取覆盖风险被r5替代。本轮含失败前置和独立CLI身份核对，共25个计数的AWS/CLI元数据尝试（并非全部到达服务端）；最终r5为13个成功只读metadata，两Name均ABSENT。没有AWS/SQL写、Secret值或私密材料读取、新槽消费。[准确文件SHA、暴露摘要和继续位置](../ops/aws-sandbox/reviews/aurora-express-c4d-runtime-secret.prepared.json)。

获批后只运行本r5的一次Run及独立Inspect。得到真实ARN/version后，再fresh核对三个现有角色/共享boundary，准备准确IAM connect和Secret版本读取变更；当前IAM next-step只是数据，Secret ARN/version仍null，不使用通配或占位ARN来提前安装。随后C4a最小应用授权、真实TLS/IAM登录、完整ready/初始化与ECR→ECS，实际写分别批准。F3c9仍封存。
