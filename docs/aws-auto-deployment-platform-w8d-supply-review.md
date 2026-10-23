# W8d：固定凭据供给入口及发布协议适配

## 当前状态

这是W8c最小接入范围的实现，不是部署许可。代码复用原CloudFormation access模板、原PEM元数据/单读函数及原镜像publisher协议；不新增角色、数据库、TaskRole或云执行器。默认应用启动、原81/76云执行闭包、已发布controller binding、业务状态及UI不改。

主入口为 `ops/platform-hosted-access-v6/local.mjs`：Prepare只读，RunReviewed需要准确新SHA，Inspect为独立只读核验。它不接受任意Secret名、角色、区域、文件路径、endpoint或输出目录。新固定槽 `F:/ChatGPT_workshop/techlong-platform-hosted-supply-v6.intent.json` 只用于这一新安装范围；旧槽和原件保留，不能复位/替换/重放。

本机42项供给/原access/原publisher及Source流程检查已通过，0跳过，类型和定向lint通过；新No-AWS CI会在main准确源码上验证同一组测试。**准确云CI成功和fresh Prepare之后才有可执行SHA；本文不是SHA，也不授权实际读取私钥或安装。** 纯协议测试使用合成材料，不是已读取真实产物、私钥或证明生产成功。

Source刷新后，新SDK入口已完成一次真实22项只读元数据核对：原Source、两Secret版本/策略、access模板/IAM身份、KMS、空的目标名称及无待执行Change Set均匹配；两份资源策略通过AWS只读验证，PEM属性/三主体ACL匹配。原件 `F:/ChatGPT_workshop/techlong-hosted-supply-w8d-readonly-check-20261023.json`，SHA256 `45776540606a67fa5513f30e4ab4314492e35d9e73ec130479bb2c600ec159a0`。未打开PEM、读取Secret值或消费槽；这不是写权限、签名或生产部署证明。

## 一次供给批准的精确范围

固定账号402010193138、ca-central-1、Source `techlong-sandbox-dev`；原execution RoleId `AROAV3GNMXTZJ45S2ANZ7`、boundary PolicyId `ANPAV3GNMXTZP7KMHXNYF`；准确access栈UUID `01b4bb80-ce60-11f1-9435-0e85c8c75895`。

最多七次顶层AWS写调用，顺序固定：

1. 空建准确新Secret `techlong/sandbox/platform-controller/github-app-v6`，使用默认AWS-managed `aws/secretsmanager` Key及三项准确标签。
2. 为该准确新ARN设置Source-only读取/管理Deny保护，并只读核验空版本、策略、名称及标签。
3. 重新核对既有PEM属性/受保护三主体ACL，最多读取一次 `E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem`，验证RSA格式和至少2048位；写入一个清单绑定的版本UUID，内容为schema和privateKey两字段JSON。内容不落本地文件、模板、Git、日志、聊天或验收artifact；不申请App token，不向GitHub验证签名。
4. 仅在原access栈创建UPDATE Change Set。模板复用原两项资源，只向boundary及inline追加原控制器Secret固定版本和新App Secret固定版本的读取及转发解密；原五项Web/ECR/日志权限、trust、角色、边界物理身份、标签及资源集合保持。
5. 严格核对实际两项Modify、Replacement=False、只有PolicyDocument/Policies属性变化、完整模板、准确物理ID、无import/nested/额外Change Set后，仅执行这一准确Change Set，DisableRollback=true。随后等CFN完成并有限只读等待IAM传播，不重试写入。
6. 仅修改原控制器Secret `techlong/sandbox/platform-controller/neon-v6-M4A08E` 的读取例外为Source＋原execution role；版本 `3574f24e-ecb3-476c-8f71-baa501fd129e`、内容及管理Deny不改。
7. 对新App Secret设置同样的最终读取例外，管理仍Source-only。最后使用独立读取客户端回读并保存结果；另一个进程的Inspect也不读取Secret值。

新Secret真实ARN后缀由AWS生成。批准的是固定名称/account/region的新建返回ARN这一受限派生，不是任意现存或替代ARN。返回名称/ARN不符就停止；后续IAM用完整准确ARN，不用通配符。新版本UUID、PEM属性/ACL、fresh元数据快照、全部源码pin、风险摘要及CI都在最终清单内。不存在“提前填一个假ARN”的执行路径。

旧Web Secret `neon-v1-UfFKVF` 及版本 `6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f` 保持；不设置数据库密码/LOGIN、不连Neon、不改GitHub key、不发布镜像、不部署/调用Lambda/ECS或创建业务请求。IAM新增的每个GetSecretValue分别限制准确ARN与VersionId；每个Decrypt分别限制准确Key、ViaService、SecretARN及SecretVersionId，不构造两组ARN/版本的交叉组合。[AWS服务授权参考](https://docs.aws.amazon.com/service-authorization/latest/reference/list_secretsmanager.html)列明VersionId条件。

## 审批、执行窗口和失败语义

人工批准清单为48小时，最晚启动预留20分钟；20分钟实际写窗口从新槽消费后开始，和今后的30分钟控制租约、两小时承载意图无关。执行前fresh整组核对、PEM元数据比对、源码/CI及2分钟事实窗口；每次写前再核对源码、Source身份及角色ID/trust，实际API也检查写窗口。凭据使用原AWS Login自动刷新能力，maxAttempts=1，不要求单份凭据剩余一小时；刷新失败不会扩大授权或自动重试。

创建Change Set的UPDATE类型由受审创建请求固定。DescribeChangeSet API并不回显ChangeSetType，代码不会要求一个不存在的响应字段；核对实际existing physical Modify及模板。[AWS API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)。[ExecuteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)可能清除该栈的其它Change Set，代码在执行前检查仅剩本清单准确一项；这不是CAS，仍接受随后并发新增记录被AWS隐式清理的风险。CloudFormation可能进行多次底层IAM写、维护/删除旧policy version；七写不是底层IAM请求总量上限。

失败、超时、ACK不明或提交后本机断连时不自动重试、补齐、删除、撤权、回滚、换槽或down。安装不是临时publisher Grant，**不会在安装失败后自动把权限撤掉**；只能保存已有ACK和独立只读状态，任何后续修复另审。即使在执行前写槽失败且提交不明，也不会启动云写；需要只读检查槽，不推断可以再写。

这不是跨服务事务，也不是跨服务CAS。可能遗留空/含私钥且收费的Secret、未执行Change Set、UPDATE_FAILED栈或部分扩展权限。Secret/IAM传播不保证；source/roleID检查不能消除并发修改/删除重建竞态。独立元数据成功不证明私钥与GitHub登记的key匹配，也不能证明Secret值完整、运行时签名或业务可用。代码及新Secret会把真实私钥交给AWS官方Secrets Manager/KMS；服务端/提供者日志、环境变量、调试/进程内字符串和CryptoKey残留仍有暴露风险，不能保证安全擦除。

新增Secret及已有资源可能持续收费，50USD/月是目标而非硬上限。安装不创建承载，也不会自动停止其它资源。以后ECS注入会在应用验证前读取值，替换task可再次读取；不能沿用本轮“安装程序不GetSecretValue”作为未来零读取承诺。实际两小时承载及清理另按具体资源、真实新栈UUID审批。

## 镜像发布适配及仍未发生的事

`publication.mjs`锁定W8b源码 `f3cea2da7d26dfc09726c4cbc52cab40217340c6`、CI39960583333和artifact12503974340。只有经字节验证的archive/producer receipt才能绑定image-config/archive摘要；不能用ZIP digest代替registry manifest digest。仍复用原publisher的单次push、精确OIDC、短授权窗口和Source立即Revoke协议；旧W7j默认P与入口语义保持，不重放旧空仓库计划。

新适配明确接受且只接受已有旧镜像digest `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612` 及其准确tag，不假装仓库为空、不删除或覆盖旧镜像。新镜像使用不同的不可变tag。

**本轮未下载/封验W8b大产物、未得到真实新image-config/archive或registry摘要，也未发布新的受保护caller/reusable工作流或调度发布。** 新适配是协议层，不是可直接运行的Source发布控制器；后续仍需绑定真实产物、受保护工作流及独立Grant→发布→Revoke控制，生成另一份具体SHA。旧手动publisher入口依然只接受旧候选，不会因这次代码提交自动指向新镜像。W8b artifact到期为2026-10-26 08:24:09CDT（13:24:09Z），过期不自动重建或重跑。

## 唯一继续点与命令边界

准确新CI成功后，只运行Prepare生成fresh供给清单（不会安装）：

```powershell
node ops/platform-hosted-access-v6/local.mjs Prepare F:/ChatGPT_workshop/techlong-hosted-supply-review-w8d-20261023.json <准确CI运行ID>
```

清单获准确SHA及本完整风险批准后，才使用 `RunReviewed <同一原件> <同一SHA>`；随后另进程 `Inspect <同一原件> <同一SHA>`。这里不提供可复制的已批准写命令，也不把“开始下一步”或Source刷新当作Secret/IAM安装许可。人工门禁、固定槽及原始证据保留；不扩F3c9、不做UI修复或新身份实验。
