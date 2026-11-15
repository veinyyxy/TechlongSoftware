# D2-6图片基础设施：仅五资源创建与独立技术核验

这是待批的准确云创建范围，不是已执行结果。依据[已完成的集中补核](aws-instance-release-persistence-install-preflight-observed-20261115.json)，复用原五资源模板、代码及CI，不新建安装框架或工作流。它只关闭持久化前置中的基础设施缺口，不宣称D2-6两次更新已完成。

## 本次唯一变更

在账号`402010193138`、区域`ca-central-1`创建新CloudFormation栈`techlong-sandbox-media-9c5ee9e64509dcad-v1`。S3在该区域；CloudFront是全局服务，不在其他region创建VPC或计算资源。

| 逻辑ID | 资源 |
| --- | --- |
| MediaBucket | 私有、AES256加密、版本化的准确图片桶；DeletionPolicy/UpdateReplacePolicy均Retain |
| MediaOriginAccessControl | 仅该S3来源、始终SigV4签名 |
| MediaResponseHeadersPolicy | 准确买家来源CORS，无凭据；Content-Type防嗅探 |
| MediaDistribution | 默认CloudFront HTTPS域名、PriceClass_100，只转发图片S3来源 |
| MediaBucketPolicy | 拒绝不安全传输；仅准确distribution可读取products/* |

桶名固定为`techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad`。模板路径为`ops/releases/persistence.draft.template.json`，LF SHA256固定`01eee63435ec5cd490a671ddcd1f4f817526724f2fe59020ab0235b437529743`，规范对象SHA为`339d8049dfaafc1087fe05d7c0df805bb098634a6f30448da62d9ff196261a1e`。6398-byte模板可内联，不需要本轮上传S3模板对象。保留候选Metadata原文；Metadata本身不提供执行授权或真实终止保护。

## 调用、时序与核验上限

1. 用户确认准确清单SHA后，固定Source profile `techlong-sandbox-user`、官方STS核对1次，必须是原IAM用户。准确新栈DescribeStacks1与新桶HeadBucket1，仅不存在才继续；403或其他异常不当作不存在，不自动接管资源。
2. 本机准确尝试文件使用独占创建，只能消费一次。最多一次CreateStack，固定ClientRequestToken `d2-media-install-20261115-a`，使用已准备请求文件及其中原模板正文；无RoleARN、无参数/Capabilities，ResourceTypes只列上述五类型。`EnableTerminationProtection=true`，`DisableRollback=true`，不设置OnFailure。
3. 返回的Stack ARN成为后续唯一查询对象；Create响应不明则只允许对准确栈名作已批准的只读确认，不能再Create，也不能在缺少可信ACK时进入后继输出派生。DescribeStacks轮询最多31次、两次间隔至少60秒，整体只读等待最多30分钟，且不越过本清单截止。CREATE_COMPLETE后才能称创建完成。
4. 使用独立只读进程：GetTemplate(Original)1、ListStackResources1，核对完整模板规范SHA、准确五逻辑资源及物理ID、终止保护、四真实输出；CloudFront GetDistribution/GetOriginAccessControl/GetResponseHeadersPolicy各1；S3 HeadBucket、GetBucketLocation/GetBucketVersioning/GetBucketEncryption/GetPublicAccessBlock/GetBucketOwnershipControls/GetBucketPolicy/GetBucketCors各1。核对私有/版本/加密、OAC/CORS、distribution来源/状态、准确桶策略和HTTPS输出绑定。不调用网页、Lambda、ECS或数据库，不上传测试图片。

合计至多STS1、元数据46（CFN34、S3共9、CloudFront3）、CreateStack1。这里的1是调用方建栈请求次数；CloudFormation为创建五资源及其属性执行的服务内部操作并非只有一次，也不受“5次原生写”限制。没有额外模板上传、IAM或租户更新、DNS/证书、ALB、ECS/Fargate、RDS、Secret操作、GitHub调度、SQL、数据/图片迁移、HTTP验收或清理。

事实/启动和只读截止均为`2026-11-15T19:44:49.040Z`（温尼伯11月15日13:44:49.040 CST），不续期；晚启动可能无法完成全部只读观察，届时只保存已知状态。清单过期不会自动删除或停止资源。这不是资源TTL，不改变JWT/MFA等安全期限。

## 必须接受的风险与停止规则

- **可能留存收费资源。** 创建非原子、异步且有传播/并发竞态；允许DisableRollback以保留失败现场，失败可能留下部分桶/CDN/策略。成功或失败均不自动删栈、回滚、补齐、重试或重置尝试槽，后续处置另批；账号持续费用仍存在，50USD/月目标不是硬预算上限。
- **持久化不跟计算一起删。** 桶保留和栈终止保护会阻止或保留部分删除结果；本栈不加入临时三栈节费删除集，可能持续产生存储/请求/传输等费用，不承诺绝对零费。未来清理需单独批准，不在本次写入任何业务对象。
- **公开分发与权限。** 该distribution按设计可公开读取products/*图片，不能用于私密业务文件；本轮不上传对象，未证明旧图片来源/分类或完成迁移。HTTPS、CORS和OAC不是用户登录鉴权。
- **凭据、模板及日志。** 既有Source凭据仅在CLI内存使用；API参数/模板/元数据可能进入AWS和提供者日志。必要原件与回执仅存本机私有目录，Git只保存去敏状态/引用/摘要。新栈实际创建权限尚未由真实写证明；权限不足就停止，不据本清单增加IAM权限。
- **提交不明及单次性。** 建栈调用成功、失败或超时的事实可能不一致；槽消费后不重复提交，ClientRequestToken不作为重试许可。不自动延长截止，不重放旧批准。独立回读不等于跨服务CAS或整个账户权限模拟。
- **核验不是业务测试。** 没有真实图片上传/内容读取就不称图片链路已验收；不把CREATE_COMPLETE当作IAM已接通、旧图已迁或PERSISTENCE_NOT_READY已解除。实例runtime继续关闭、两次真实版本更新仍0。

## 不包含的后继

真实输出及归属核验完成后，才据当前Original与权限投影形成原TaskRole/ServiceRoleBoundary两资源的准确变更和租户四环境值清单；本次不预先授权它们。特别是原IAM旧声明不完整，失败自动回滚可能回到旧权限，必须在其自己的清单明确策略，不能套用本次新栈创建策略或偷偷纠正。

原IAM大模板需要的私有TemplateURL对象另列准确存放键/写入及竞态风险；现有模板桶未版本化，历史B5不可变前缀保护不能冒称保护新D2路径，本次不改变桶策略或上传模板。后继身份/实例启用、可信版本登记和两次更新继续原D2主线；GitHub environment仍由用户本人批准，本次不运行任何GitHub工作流。
