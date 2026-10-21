# W7d：已批准创建的部分失败与独立核验

2026-10-21。用户已在本聊天确认完整清单 `717984e928d0038c861fb175279d3b7c75f5af12842cf7641d2b323c98bcd052` 及[创建风险](aws-platform-hosting-w7d-foundation-creation-review.md)。本次**不是安装成功**：最多一次CreateStack已实际提交，栈进入CREATE_FAILED。没有自动补齐、重试、回滚、删除、授权发布或继续部署。

## 实际执行与原因

先验证原manifest、源码/模板/风险摘要、干净main及四个准确新名称。初始只读预检因显式global IAM endpoint与ca-central-1签名区域组合而返回SignatureDoesNotMatch；当时未调用CreateStack、未消费槽，独立确认Source仍有效及本地槽/提交收据都不存在。使用IAM默认全局端点/us-east-1签名的独立只读检查成功；随后新完整只读预检再次证明Source准确、四名称absent。未重跑失败的原命令，更没有重试云端写入。[IAM全局端点说明](https://docs.aws.amazon.com/IAM/latest/UserGuide/programming.html)。此配置修正没有改变任何云端资源、批准模板或ca-central-1 ECR/CFN范围。

在预检五分钟事实窗口内，排他写入原稳定永久槽并fsync，然后于 **2026-10-21T19:05:22.334Z / 14:05:22CDT** 返回唯一一次CreateStack响应。准确栈：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-image-foundation-v1/5db98d40-cd82-11f1-8f8c-06fff229a471`

API requestId=`1fe5acaa-f877-4595-986e-aa75ee2528ae`；ClientRequestToken仍为原清单固定值，DisableRollback=true、无RoleARN/参数、标签和模板均与批准范围一致。19:05:45.594Z的唯一DescribeStacks轮询即为终态CREATE_FAILED，因此没有继续无意义轮询。

**根因是本项目生成模板的IAM trust principal写法错误**，不是用户MFA/权限刷新问题。PlatformImagePublisher返回：`AssumeRolepolicy contained an invalid principal: "STAR":"*"`（IAM400 / InvalidRequest / SDK Attempt Count1）。原模板的 `Principal: "*"` 没被这个IAM建角接口接受。此前ValidateTemplate只通过CloudFormation模板格式/能力检查，未证明IAM信任策略语义可安装；原单元测试也遗漏了这项服务语义。不能把格式验证或候选镜像CI成功当作IAM安装成功。

## 独立新客户端核验

19:06:45.877Z重新验证准确Source身份并读取准确StackId、ListStackResources/GetTemplate、ECR、IAM；19:07:46.773Z再次直接GetRole并DescribeImages确认：

| 对象 | 当前观察 |
| --- | --- |
| Stack | CREATE_FAILED；DisableRollback=true；无执行RoleARN、无参数；GetTemplate与原批准模板语义一致 |
| PlatformWebRepository | CREATE_COMPLETE；`techlong-sandbox-platform-web`；IMMUTABLE、scanOnPush=true、AES256、无tag exclusion；准确仓库当前0镜像且无下一页 |
| PlatformImageBoundary | CREATE_COMPLETE；ARN `arn:aws:iam::402010193138:policy/TechlongSandboxPlatformImagePublishBoundaryV1`；PolicyId=ANPAV3GNMXTZP2F37SEFP；默认v1，正文与批准模板一致；AttachmentCount=0、PermissionsBoundaryUsageCount=0 |
| PlatformImagePublisher | CFN CREATE_FAILED；直接GetRole两次均NoSuchEntityException，实际角色**不存在**。CFN展示的物理名字不是RoleId或创建成功的证明 |

因此保留的是**仓库＋未附加managed boundary**，不是“已创建的锁定发布角色”。没有安装可AssumeRole的publisher、签发publisher会话或推送镜像。独立核验只是观测时的事实，不是长期不被其他高权限操作者改变的保证。旧IAM/worker/Cell/租户、预算、数据库、Secret和DNS没有修改。

## 证据与不可重放边界

项目摘要：[独立结果JSON](../ops/aws-sandbox/reviews/platform-image-foundation-w7d.partial-result.json)。原始数据继续留在外部证据目录，没有拷贝私密值进Git：

- 永久槽 `F:/ChatGPT_workshop/techlong-platform-image-foundation-v1.create.intent.json`，SHA=`67481e505428ea0efe92ee887d75357858d1ed91f85aaea3f28ad566d1f954cd`。
- 同目录前缀 `techlong-platform-image-foundation-v1.create-717984e9` 的 `.preflight.json` / `.receipt.json` / `.poll-01.json` / `.independent-inspect.json` / `.final-safety-read.json`；摘要见项目结果JSON。提交收据SHA=`c4d042e17ee494fde021b31a0dc531464ccf9c7b4f403dc16aa998509e770557`，独立核验SHA=`df002557d1bcf26f06abced9256c3bac619aadbc182d0272ee743865b4a45a77`。

原批准JSON、原风险文档、生成模板源码及其摘要不修改；approved=false仍是批准前快照，不因后续聊天确认而改写历史JSON。永久槽已经消费，**即使原清单到10月23日才过期，也不能再次用它提交CreateStack**。本轮真实写入只有一个顶层CreateStack提交；CloudFormation执行了多个底层资源操作。没有创建新的重试/恢复槽。

DisableRollback保留失败栈和已成功资源；ECR的Retain继续有效。当前空仓库未发布镜像，没有新增Cell/ALB/ECS计算承载，但仍不承诺本账户绝对零费用。GitHub候选artifact12371098858的原三天保留/2026-10-24T18:55:49Z到期不因本次失败延长；本轮没有下载/load或重跑候选。

## 下一步建议（尚未执行）

准备**保留既有ECR和boundary、仅修正锁定trust格式的恢复材料**：先用服务语义检查验证候选principal，核对CREATE_FAILED栈支持的恢复方式和准确变更，再提供新的fresh清单。不得静默修改原manifest、删除/重建栈、接管/替换已创建仓库或重新开放旧Publisher。实际Change Set/恢复、任何grant和镜像发布仍各需具体批准。

本轮停在部分失败的独立核验与记录，不将“任务完成”写成“基础设施安装成功”，也不擅自扩大到云端修复。两小时hosting窗口仍未开始；部署与清理保持分审。
