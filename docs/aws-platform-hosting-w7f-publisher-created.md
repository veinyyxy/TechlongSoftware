# W7f：独立锁定发布角色已创建并核验

2026-10-21。用户确认清单 `74f83c136f9a5b79ebab189cb70218b43488e130e2cc6e16bf8e6ffa733afde9` 及其中绑定的[完整风险](aws-platform-hosting-w7f-independent-publisher-review.md)。本次唯一一次CreateStack已完成，独立核验确认新V2角色按受审配置安装。**仅完成锁定身份基础设施，不表示已开放发布权限、发布镜像或部署平台。**

## 实际执行

执行main=`605998a6953e4f8af3542e6ec92d4bca6ca61317`，代码锚点 `f15c8174361b761cc8c64f43dcaa3bd540526dff`。清单、三模块、风险和候选模板摘要均匹配，工作树干净，代码后仅README和审阅JSON更新。

19:55:57.710Z至19:55:59.225Z完成新只读前置核验：准确Source、旧CREATE_FAILED栈/原模板/三资源、缺失V1角色、ECR零镜像且属性/标签不变、未使用v1 boundary、唯一旧AVAILABLE Change Set，以及新栈/新角色/新槽不存在。两个已消费旧槽摘要一致。排他写入新永久槽并fsync后提交一次固定工厂请求，应用SDK maxAttempts=1；没有重试创建。

- 新StackId：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-image-publisher-v2/701257e0-cd89-11f1-be5e-02452f6c634b`。
- 唯一提交响应记录：2026-10-21T19:55:59.569Z（温尼伯14:55:59CDT），requestId=`1f82ad5a-9fcf-48bb-b5ca-dc645652dd6a`；AWS栈CreationTime=19:55:59.990Z。
- 19:56:24.586Z的唯一DescribeStacks轮询已为CREATE_COMPLETE、DisableRollback=true。没有执行旧Change Set、修改旧栈或直接调用IAM写接口。

## 独立验收与真实身份

19:57:58.089Z至19:57:59.191Z使用新客户端独立读取准确新旧资源、GetTemplate及IAM策略；19:59:39.192Z完成对该不可变服务收据的本地语义复核。观测不是跨服务原子快照，也不是长期状态保证。

| 对象 | 已核验事实 |
| --- | --- |
| 新身份栈 | CREATE_COMPLETE；DisableRollback=true；无RoleARN/参数；仅一个PlatformImagePublisher/AWS::IAM::Role逻辑资源CREATE_COMPLETE |
| 新角色 | `arn:aws:iam::402010193138:role/TechlongSandboxPlatformImagePublisherV2`；RoleId=`AROAV3GNMXTZID6CJJBA2`；Path=/；MaxSessionDuration=3600；CreateDate=19:56:04Z |
| Trust | 唯一LockedNoSessions语句，Effect=Deny，Principal为准确账户root ARN，Action仅sts:AssumeRole；没有任何Allow，未配置OIDC/SAML/服务Allow |
| 身份权限 | ListRolePolicies仅OnlyPlatformWebRepository；GetRolePolicy正文与受审ECR-only文档一致；ListAttachedRolePolicies为空，均无分页遗漏 |
| Boundary | 角色绑定准确现有ARN；PolicyId=ANPAV3GNMXTZP2F37SEFP、默认v1、正文不变；AttachmentCount仍0；PermissionsBoundaryUsageCount按批准范围从0变为1 |
| ECR | 原ARN/CreatedAt/IMMUTABLE/AES256/scanOnPush及完整标签保持，零镜像且无下一页 |
| 旧栈与计划 | 旧栈仍CREATE_FAILED、原模板/原三资源不变；V1角色直接GetRole仍ABSENT；完整列表仍仅原Change Set，CREATE_COMPLETE/AVAILABLE且Changes不变，没有执行 |

新栈GetTemplate语义及工厂编码SHA仍为 `3d9433ffe7f87549163cd9af3716eab9b362382b9e3a6c42fc0b8d7d3d49dc42`（3557字节）。新角色三条业务标签与清单一致，没有额外标签；原仓库、boundary与旧栈标签均与执行前一致。旧对象比较只允许boundary使用计数这一项受审变化，不把实际usage=1伪装成旧预检要求的0。

### 检查器格式诊断，没有云端修复

首次独立收据保留为INSTALLATION_INSPECT_REQUIRES_REVIEW：IAM将trust的单项 `Action:["sts:AssumeRole"]` 返回为字符串 `Action:"sts:AssumeRole"`，本地deep-equal过于严格。IAM正式语法明确单项数组可以省略方括号；后续仅对这一字段做标量到单项数组的语义规范化，其他trust字段逐项精确比较。没有接受新的Action、Principal、Allow或其他策略变化，也没有更新IAM。[IAM策略语法](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_grammar.html)。

另一次只读诊断因本地预期PermissionsBoundaryType=`PermissionsBoundaryPolicy`而停止，未保存新收据；真实服务值为`Policy`。AWS参考页的说明文字写Policy、Valid Values却列PermissionsBoundaryPolicy，存在文档表示矛盾。本轮保留真实返回值，核验准确boundary ARN、实际PolicyId、默认版本和正文，不以该显示枚举误判为缺少boundary或追加修复。[AttachedPermissionsBoundary参考](https://docs.aws.amazon.com/IAM/latest/APIReference/API_AttachedPermissionsBoundary.html)。

最终语义结果是在原始独立收据上本地验证得出，不冒充另一次完整云端快照；原失败比较记录没有覆盖。三份受审模块、候选模板、批准清单和风险文档保持原摘要，没有为了验收通过修改受审代码或云策略。

## 证据与永久槽

项目机器摘要：[已创建结果JSON](../ops/aws-sandbox/reviews/platform-image-publisher-w7f.created.json)。外部证据前缀 `F:/ChatGPT_workshop/techlong-platform-image-publisher-v2.create-74f83c13`：

- `.preflight.json`：`09e8326474e3c3c39ac7e2eec093cc71e7c085b896fae9e2a6610904172a8584`
- `.submission.json`：`eb6f32dde465831837114444f7cc9fb8b48c891f5be382bf467ca27a9aad449d`
- `.polls.json`：`38e3dea4aec39f9ab37ba08ff885420cccde8fca0d957e8042c2c531cb1be810`
- `.independent-inspect.json`：`2af47afe3022af1a6f421d8bfb1c8a1a03e3363042f4acbb3a8755033a50934c`
- `.semantic-inspect.json`：`bf3681ffe991a017b9c71629d643966621dc6a80801955ae9b52648d1617b576`

新永久槽 `F:/ChatGPT_workshop/techlong-platform-image-publisher-v2.create.intent.json` 已消费，SHA=`b0d197cd341e44f67f32cdef11fb73250b6fc64f617977d751ce4e363d8edb53`。原CreateStack槽SHA=`67481e505428ea0efe92ee887d75357858d1ed91f85aaea3f28ad566d1f954cd`、旧Change Set槽SHA=`b10faac7199ef75b68acea4ce84111c9d498c355286fe1eae0c22fc2cf30c605` 均保持。全部槽不复位、删除或重放；批准未到期也不使槽重新可用。

顶层写提交只有一个CreateStack，CloudFormation完成多个底层IAM创建/配置操作；本地没有直接IAM写、AssumeRole探针、grant、ECR登录/push、镜像下载、GitHub dispatch、Secret/PEM/私密包读取、Neon/SQL连接、部署或删除。没有新计算承载，已有费用继续；不承诺绝对零费用或50USD硬上限。两小时hosting窗口未开始。

## 后续主线

下一阶段准备**一次受控平台镜像发布**：显式绑定上述新StackId及RoleId，复用既有候选artifact12371098858，独立核对CI来源、官方artifact摘要/期限、镜像配置，再准备准确OIDC发布授权、一次发布及立即撤权清单；该阶段实际IAM改变、凭据交付/AssumeRole、ECR推送仍须具体批准。本次创建批准不授权它，不自动恢复旧Publisher或执行旧Change Set。

原artifact到期仍为2026-10-24T18:55:49Z，不因建角成功而延长，也不为本次结果文档重新构建/上传约330MB镜像。若届时已过期，再单独处理候选产物，不自动扩大存储或升级付费计划。原栈/Change Set清理、后续两小时托管和清理继续分别审核，不延伸F3c9支线。
