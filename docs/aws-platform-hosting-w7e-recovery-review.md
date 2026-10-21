# W7e：保留现有资源的锁定身份恢复审阅

2026-10-21。用户同意**准备**恢复方案；本轮没有执行云端恢复或创建Change Set。原栈仍CREATE_FAILED，ECR存在且零镜像，boundary存在且未使用，publisher角色不存在。原创建清单、失败模板、风险文档、已消费永久槽和原始证据不改写。

## 修正内容与服务级校验

新纯模块 `ops/platform-image-recovery-v1/recovery.mjs` 从原模板生成恢复候选，仅改变 `PlatformImagePublisher.Properties.AssumeRolePolicyDocument.Statement[0]` 的两处：

```json
{
  "Sid": "LockedNoSessions",
  "Effect": "Deny",
  "Principal": {"AWS": "arn:aws:iam::402010193138:root"},
  "Action": ["sts:AssumeRole"]
}
```

这不是把root账户列入Allow；**整个trust没有任何Allow**。本账户AssumeRole显式Deny，其他账户、OIDC、SAML及服务路径因没有对应Allow继续默认拒绝。锁定机制由原来无类型通配符三动作Deny，调整为明确账户/匹配动作Deny＋所有路径无Allow；不是增加任何可登录身份。既有ECR属性、boundary与inline权限、role名称/会话上限、其他模板字段全部保持原值。没有解锁旧Publisher，也没有添加新的OIDC provider或trust grant。

实际调用IAM Access Analyzer `ValidatePolicy`，类型RESOURCE_POLICY、资源类型AWS::IAM::AssumeRolePolicyDocument：19:14:38.709Z原策略返回ERROR `ROLE_TRUST_POLICY_UNSUPPORTED_WILDCARD_IN_PRINCIPAL`；19:14:39.939Z上述新策略返回findings=[]、无下一页。新模板随后通过CloudFormation ValidateTemplate（NAMED_IAM、0参数）。候选模板UTF8/LF字节为5298，SHA256=`01c4ab5a4cfd0d40f33592f388ab77003162dee22a00d2b9c221bcc79a76914d`。

Access Analyzer是服务级静态语义检查，不创建Analyzer或IAM角色；零发现仍不保证实际CreateRole一定成功、IAM传播或未来不发生并发改动。没有通过临时建角来“试错”。[ValidatePolicy官方说明](https://docs.aws.amazon.com/access-analyzer/latest/APIReference/API_ValidatePolicy.html)、[该通配Principal错误](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-reference-policy-checks.html#access-analyzer-reference-policy-checks-error-role-trust-policy-unsupported-wildcard-in-principal)。

## 准确保留对象与只读事实

账户402010193138，ca-central-1；Source为IAM User techlong-sandbox-dev / AIDAV3GNMXTZEO7SHLC2X。恢复始终绑定准确旧StackId，不以名字解析并接管另一个栈：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-image-foundation-v1/5db98d40-cd82-11f1-8f8c-06fff229a471`

19:19:53.510Z完成新只读快照，验证原GetTemplate仍一致、3个原逻辑资源/类型/物理名，状态CREATE_FAILED、DisableRollback=true，无RoleARN/参数；publisher实际ABSENT。ECR准确ARN和CreatedAt=2026-10-21T19:05:26.229Z、IMMUTABLE/AES256/scanOnPush/零镜像；boundary PolicyId=ANPAV3GNMXTZP2F37SEFP、v1、正文与原模板一致、AttachmentCount/BoundaryUsageCount均0；当前Change Sets为空。

外部聚合收据 `F:/ChatGPT_workshop/techlong-platform-image-recovery-v1.readonly-preparation-20261021.json`，SHA256=`352084bd961f49aa1b7016b1aacb0640085892e68af8f2c155329d494933fec0`。其中策略检查部分明确转录本聊天CLI输出，不冒充包含请求ID的原始服务响应；资源快照和新模板验证来自本轮直接读取。不是原子快照，执行前需重验，不能拿旧Absent前置条件重放原CreateStack。

## 拟议第一步：只创建 UPDATE Change Set，不执行

AWS明确支持为CREATE_FAILED栈发起Change Set，模板错误修正应使用Update路径；无需删除/重建已成功资源。[失败资源保留与恢复](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)、[CreateChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateChangeSet.html)。当前仅准备以下受审动作，仍待新清单确认：

- 最多一次CreateChangeSet，StackName为上述完整ARN；ChangeSetType=UPDATE；准确名称 `platform-image-locked-trust-recovery-v1`、ClientToken=`techlong-platform-image-locked-trust-recovery-v1`。
- TemplateBody必须由已绑定的新模块生成并核对上述SHA；CAPABILITY_NAMED_IAM、空参数，IncludeNestedStacks=false、ImportExistingResources=false；不指定RoleARN/TemplateURL/宏/导入/OnStackFailure、DeploymentMode或其他配置。
- 在Source/准确旧栈/ECR/boundary/缺失角色/空Change Set列表等新鲜事实通过后，排他消费**新的独立审阅槽** `F:/ChatGPT_workshop/techlong-platform-image-foundation-v1.recovery-changeset.intent.json`；原CreateStack槽不动。应用SDK maxAttempts=1，不自动复位或补建另一槽。失败/状态不明仅只读inspect，不重提或删除Change Set。
- 创建后仅DescribeChangeSet轮询，随后新客户端独立回读准确ARN/StackId、候选GetTemplate和完整Changes。只接受唯一PlatformImagePublisher的Add，或无替换、仅AssumeRolePolicyDocument的Modify；不接受ECR/boundary变更、Remove、Replacement=True/Conditional、额外资源、分页遗漏、角色权限/边界/名称变化。
- 检查后仍然**不执行**。若实际CloudFormation计划与这条窄门禁不一致，保留原始结果并停止，不能为“让它通过”自动放宽门禁、换恢复方式或删栈重建。

本步骤的CloudFormation请求仅创建审阅元数据，不创建/重试publisher角色或改变ECR/boundary。未来真正恢复将重新绑定实际ChangeSet ARN和差异，单独审批ExecuteChangeSet，并明确DisableRollback=true/RetainExceptOnCreate=false；本清单不授权它。ExecuteChangeSet会使其他Change Set失效并删除它们，届时必须再核对实际列表，不能隐含接受额外删除。[ExecuteChangeSet说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。

## 完整风险与禁止事项

Source仍有高权限；此清单不是对Source本身的IAM硬限制。元数据读取、计划计算、后续执行与独立回读都不是跨服务CAS，存在名字/ARN/角色/策略并发变化、凭据自动刷新失效、IAM传播及服务端非确定性风险。API参数/静态检查通过不保证Change Set可创建或未来角色能安装。服务底层读取可能多次，不把应用最多一次提交说成AWS只发一次网络请求。

永久槽在提交前消费，提交失败也可能留下槽或未执行Change Set；不自动恢复、删除、换名或重试。失败栈和已有仓库/boundary继续保留，不承诺自动停费或全项目50USD硬上限。接受低成本但非绝对零费用；本次不新增计算承载，不为清理安装定时权限支线。

不允许CreateStack、UpdateStack、ExecuteChangeSet、DeleteChangeSet、DeleteStack、RollbackStack、直接CreateRole/UpdateAssumeRolePolicy或任何其他IAM/ECR写入。不允许AssumeRole探针、OIDC grant、ECR登录/push、镜像下载/load、GitHub dispatch/环境设置、Secret/PEM/私密包读取、Neon/SQL连接、业务/authority/预算/DNS/Cell/ECS变更或删除。原永久槽与历史记录保留；未来实际部署和清理仍分审。

新批准有效期48小时，仅供本次审阅Change Set的创建。过期刷新只读材料并重新确认，不延长未来两小时hosting窗口；本次尚未开始hosting计时。消耗过的创建或审阅槽不会因清单未到期、重新刷新或更换SHA而重新可用。

## 工程验证

新7项边界/回归测试＋原42项hosting/release测试，共49项本地通过；原81pin云闭包、原创建源码/manifest/风险摘要未变。恢复纯模块不接入Web或已发布云执行图。新独立No-AWS代码CI只跑测试、类型检查和scoped lint，不安装AWS身份、不创建/执行Change Set，也不重建或重新上传约330MB镜像，避免无关产物占用。原镜像artifact12371098858及2026-10-24T18:55:49Z到期保持不变。

真实CI结果将在独立完成核验后记录；不能用旧镜像CI代替本次恢复代码验证。本页连同准确JSON清单只是待审材料，不是执行许可。
