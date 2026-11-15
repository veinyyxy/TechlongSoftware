# 原IAM与idle租户的图片存储接线：离线变更及待审执行范围

本材料只覆盖已创建图片栈之后的必要接线，不是日常ImageUri-only发布，不改变正式发布代码或其回滚合同。原件来自[图片栈独立核验](aws-instance-release-persistence-media-installed-20261115.json)及[原栈集中只读结果](aws-instance-release-persistence-install-preflight-observed-20261115.json)。本轮只离线派生，没有AWS、数据库或凭据读取，没有云写/执行槽消费；实际操作须另准同名JSON清单的准确规范SHA。

## 1. 精确差异

| 原栈 | 仅允许的变化 | 保持 |
| --- | --- | --- |
| techlong-s3-bootstrap/8afbe1e0… | TaskRole记入当前C4e inline，再加WriteExactTenantProductImagesD2；ServiceRoleBoundary保留当前22语句，再加D2ProductImagesWrite | 24资源集合、其他22项、6参数、角色名/ID/trust/boundary ARN、数据库授权、其他共享消费者不变 |
| techlong-sandbox-tenant-9c5ee9e64509dcad/5867e9c0… | TenantTaskDefinition内4个存储环境值；预期资源替换并注册新revision | 3资源idle集合/no Service、其他2资源、20参数、ImageUri、角色/Secret引用、网络及数据库绑定不变 |

图片写权限只允许原`TechlongSandboxTaskRole`对`arn:aws:s3:::techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad/products/*`进行`s3:PutObject/DeleteObject`；boundary新增Allow另含准确`aws:PrincipalArn`条件，不给其他6个已观察共享消费者新增图片权，不授予GetObject、ACL、DeleteObjectVersion或其他桶访问。所有当前C4e语句/拒绝条款逐值保持；边界由22→23条，预测紧凑UTF-8为6044 bytes，不删旧语句腾空间。角色最终inline为原C4e＋新图片两份。

四个环境值固定为：`IMAGE_STORAGE_PROVIDER=s3`，`IMAGE_S3_BUCKET=techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad`，`IMAGE_PUBLIC_BASE_URL=https://d3t5c71ibx9h97.cloudfront.net`，`ALLOW_EPHEMERAL_IMAGE_STORAGE=false`。这些是已独立核验的真实输出，不是占位值。

原TaskDefinition没有UpdateReplacePolicy，因此不能称“只原地改值、旧revision保留”。[ContainerDefinitions变更需要替换](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ecs-taskdefinition.html)，[默认替换策略会清理旧物理资源](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatereplacepolicy.html)：允许CFN托管注册新revision及注销/清理旧`:12`；不运行、停止或删除任何业务任务，不启动ECS Service/Fargate/RDS，不删除数据库或业务数据，不为了保留旧revision临时扩模板差异。

## 2. 原件、存放和五次调用方写入

完整IAM候选YAML为52411 bytes，原完整模板只改上述两资源；规范SHA为`cb957826528166537a3e2ac21d1353d0f2939f67e88dc61486c079bf6cbeb96f`，原字节SHA为`6804ce7defa5e38e3b4bd17903971698a4c977bf47fd89afd688a507435f5aaf`。完整租户候选YAML10233 bytes，规范SHA为`dab17b240c8fe7e272b549c305b2990c7c949507e1f58d19f7fbd8aea90bc57b`。全文仅存本机私有目录，Git不保存策略/模板或业务正文。

实际获批后只允许顺序进行，最多**5次调用方写入**，不并行、不自动重试：

1. 向既有私有桶`techlong-sandbox-build-source-402010193138-ca-central-1`的准确键`d2-instance-releases/persistence/templates/sha256/6804ce7defa5e38e3b4bd17903971698a4c977bf47fd89afd688a507435f5aaf.yaml`做一次PutObject。ExpectedBucketOwner固定本账号、AES256、IfNoneMatch=`*`、SHA256 checksum和原字节均固定。键已存在、412或409都停，不覆盖/复用旧对象，不扩大桶权限。
2. 原IAM栈CreateChangeSet一次，UPDATE、TemplateURL取上述准确对象，6参数全部UsePreviousValue，CAPABILITY_NAMED_IAM；不同时传ResourceTypes，不传新RoleARN/OnStackFailure/标签或StackPolicy。只接受准确两项Modify且Replacement=False，无Add/Remove、无其他资源变化；新CS完整Original规范摘要须与候选一致。
3. 仅在原IAM变更集及执行前状态全部匹配时ExecuteChangeSet一次，使用该次Create ACK绑定的准确ARN，`DisableRollback=true`。达到UPDATE_COMPLETE且独立核验模板/物理ID/参数/角色与最新有效策略后，才继续租户。
4. 原租户栈CreateChangeSet一次，UPDATE、内联准确候选正文，20参数全部UsePreviousValue，ResourceTypes只列原3类型、无IAM capability。省略RoleARN以继承已关联的原CFN execution role，并在DescribeStacks独立核对该关联未变；不能要求DescribeChangeSet回填不存在的RoleARN字段。只接受TenantTaskDefinition一项Modify、Replacement=True、ContainerDefinitions差异，无Add/Remove或其他资源变更。
5. 租户严格核对后ExecuteChangeSet一次，使用刚返回且已核对的准确ARN，`DisableRollback=false`；只按原3资源更新，后续独立核验新task-definition ARN及4值，保持ImageUri及其他配置。两个执行ClientRequestToken固定，token不是重试许可；CLI输入模型校验使用准确已审CS名称验证形状，实际执行必须替换为可信ACK中同名同栈的完整ARN，不能猜造ARN。

预计CS名称分别为`techlong-s3-d2-media-iam-6804ce7defa5e38e`、`techlong-sandbox-d2-media-tenant-b386bec731fe3f9e`，请求原字节与模板/输出来源均由同名JSON指纹绑定。两栈原件根字段及参数完整保持，不使用仓库旧bootstrap全文或UsePreviousTemplate绕过本次配置差异；不导入资源或创建新所有者。

## 3. 必须接受的失败与并发风险

- **IAM保留成功资源，不是“不可能回退”。** 选择DisableRollback=true是为了避免整栈自动回滚成功资源，但[AWS明确说明失败资源仍可能回到最后稳定状态](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)。原IAM旧声明缺C4e，失败仍可能丢失部分既有授权、影响共享消费者；不能保证数据库授权在任何失败下都不变。可能停在UPDATE_FAILED，需后续另审恢复；不自动补IAM、重试、ContinueUpdateRollback或用直连IAM写制造第二归属。
- **租户允许正常CFN回滚。** TaskDefinition是不可变替换，采用DisableRollback=false，允许CloudFormation正常回滚及托管清理旧/失败revision；IAM成功后若租户失败，IAM新图片权和S3模板对象仍可能留下，没有跨栈原子性或自动补偿。正式D2发布器仍原样使用其正常回滚策略，本轮不改它。
- **共享策略与托管清理。** 原boundary有7个已观察消费者，更新即便无替换也会产生新默认policy version并可能由CFN清理旧版本。允许这类托管操作，不授权调用方直接DeletePolicyVersion、删角色或撤C4e；无法消除IAM传播时差和并发修改。
- **模板不是强不可变。** 原模板桶未版本化，新D2前缀不在旧B5不可变策略中。IfNoneMatch、checksum、内容寻址键和严格CSet模板回读能限定本次输入，但不能防止其他有权主体之后覆盖/删除，不能声称无TOCTOU或永久不可变。不改桶策略、启用版本化、扩旧B5 grant或新建模板存储框架。[S3条件PUT冲突](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)在本流程中一律停止，不采用文档中的自动重试建议。
- **变更集的原生副作用。** [ExecuteChangeSet会删除同栈其他Change Set](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ExecuteChangeSet.html)。创建前及执行前只读确认没有其他变更集；出现其他条目就停，不删除它们，但并发窗口仍无法消除。已创建但未执行的本次CS/模板对象会保留，不自动清理。
- **凭据/日志/费用与能力证明。** 固定Source IAM用户凭据只用于CLI内存认证，必要模板/策略可进入AWS日志/私有证据；不读`.env`、Secret值、PAT/PEM/HMAC、ZIP/图片/业务数据。实际上传/CFN/IAM/任务定义更新可能失败、遗留资源及费用，50USD是目标而不是硬帽；不据本次批准增加其他执行权限。API输入模型通过不是提供者实际接纳或有效权限证明。
- **没有图片迁移或业务验收。** 不把任务配置S3当作应用上传/旧图已迁。DeleteObject在版本化桶中可能只形成删除标记，旧版本仍占存储；不授予永久删除版本或自动生命周期清理。不更新控制账本、verificationSha256或PERSISTENCE_NOT_READY，不启动服务测试；runtime保持关闭、D2-6真实更新仍0。

## 4. 只读与单次性约束

固定Source STS最多1，必须是原准确IAM用户。总元数据最多84：CFN64、IAM17、S3 HeadObject2、准确新task-definition Describe1。仅下列对象，首批不完整或失败即停，不翻页/扩大搜索：

- CFN：两栈各创建前DescribeStacks/ListStackResources/ListChangeSets各1、执行前DescribeStacks/ListChangeSets各1、新CSet Original各1、更新后独立Original/ListStackResources各1；两CS DescribeChangeSet最多各8（最多7次准备轮询＋执行前严格回读1），两Stack更新观察最多各16。前者间隔至少5秒，后者至少60秒；全流程最多40分钟并受绝对截止约束。任何前态、关联角色、参数摘要、物理ID、模板/CS范围不符即停，不自动重编译基准。
- IAM：执行前GetRole/ListAttachedRolePolicies/ListRolePolicies/GetRolePolicy(C4e)/GetPolicy/GetPolicyVersion(default)/ListPolicyVersions/ListEntitiesForPolicy各1；IAM成功后独立同组9次（多读准确图片inline一次）。仅原TaskRole与原boundary，核对角色/策略ID、trust、全部当前授权/拒绝、共享消费者及版本，不读其他策略正文或模拟整个账号权限。
- S3：准确模板键上传前HeadObject1（仅404视为不存在），IAM执行前HeadObject1（ChecksumMode=ENABLED），配合Put ACK checksum核对；不GetObject、List桶或读取其他键。IAM执行前仍严格核对该CSet Original，承认不可完全消除并发。
- ECS：租户UPDATE_COMPLETE后只Describe由该栈ListStackResources返回的新TaskDefinition ARN1；不用预估`:13`代替实际值，不List/Run/Stop任务或操作服务。

上传、两次Create、两次Execute均各有独占单次尝试记录，消费后不复位/重放。写ACK不明、只读失败、权限不足、超时、分页或状态未完成即停止，不自动补齐或清理。CS及执行结果只绑定该次ACK的准确ARN；未获得可信ACK不继续后继操作。成功只在UPDATE_COMPLETE和独立证据完整时报告。

所有启动、写入及新读取仍截止`2026-11-15T19:44:49.040Z`（温尼伯11月15日13:44:49.040），不因本次离线派生续期；原事实/槽/批准不重放。已提交CFN操作可能在截止后继续完成或回滚，截止不是撤销、资源TTL或安全凭据续期。届时只记录已知状态，新的查询/处置另审，不自动续租或删除资源。

本轮没有新的网络/生产操作；本文件及同名JSON清单不是执行结果，须用户单独确认新SHA。后继原D2身份/实例启用、真实版本登记、恢复、图片迁移与两次版本更新仍不在本次范围，GitHub environment仍必须由用户本人批准。
