# D2-6持久化前置：上传桶与安装参数的最小离线方案

2026-11-14，America/Winnipeg。**离线候选与纯派生已编码，未部署、未批准新读取。** 本文只解决原D2第10节的图片持久化门槛及原IAM模板必填`UploadBucketArns`，不新增发布框架、图片业务功能或验收支线。[原方案摘要](aws-instance-release-persistence-prepared-20261114.json)保留设计时状态；[最新编码材料](../ops/releases/persistence.prepared.json)不含执行批准。真实更新仍0，runtime仍关闭。

## 1. 已确认的源码事实

本地后端HEAD是已验证候选的`b9ca2138738900afc23a6a2ddce141b37a1f0a31`，tracked diff为空。下述结论来自本地源码，不是本轮AWS、数据库或图片文件扫描：

| 位置 | 已有能力与限制 |
| --- | --- |
| 后端`services/image_storage.js` | 已有`s3` provider，消费`IMAGE_S3_BUCKET`、`AWS_REGION`、`IMAGE_PUBLIC_BASE_URL`；通过默认AWS凭据链PutObject/DeleteObject，不需静态Access Key。publicUrl只拼接URL，没有GetObject/签名URL或读取代理 |
| 后端`routes/merchant_assets.js` | S3时内存接收图片，生成`products/YYYY/MM/<uuid>.<ext>`，写media_assets的provider/bucket/key/public_url。数据库写失败已有尝试删除新对象的补偿；不是S3与SQL原子事务 |
| 后端`app.js`、`routes/products.js` | `/images`只读容器本地目录；商品列表使用media_assets.public_url。仅把provider改成s3，不会让旧本地URL自动改指S3，也不会使私有桶能被浏览器直接读取 |
| 后端`services/runtime_config.js` | 生产S3模式要求HTTPS public base URL；本地存储豁免只在local分支检查。可在S3切换时关闭ALLOW_EPHEMERAL_IMAGE_STORAGE，不必改APP_RUNTIME_MODE或数据库配置 |
| 平台Express workload渲染器 | TaskRoleArn被固定为database binding中的applicationRoleArn。为图片另换任务角色会牵动既有数据库身份绑定，不采用这条路线 |
| 平台release sampling/planning | 只有任务配置为准确S3 provider/bucket且HeadBucket通过，才把persistentUploadsReady置true；verificationSha256须绑定真实安装/核验材料，不能填合成通过值 |

**结论：保留现成后端镜像，补基础设施读写路径；不为本前置修改后端API、重构数据库绑定或重新构建镜像。**

## 2. 只采用这一条路线

```
商家App → 现有API/原TaskRole → 独立私有S3桶
买家Web/商家App → 图片CloudFront HTTPS地址 → OAC → 同一S3桶
日常更新/节费启停 → 仅替换或停止计算资源，保留图片栈/桶/URL
```

新建独立的图片资产CFN栈，S3桶在ca-central-1；只使用CloudFront默认HTTPS域名，不新增DNS、证书、ALB、VPC、ECS任务或数据库。不复用买家静态桶、审计证据桶，也不改买家现有CDN/构建或前端路由。

私有S3 REST origin配OAC always签名，桶仅允许准确distribution读取`products/*`；保留四项PublicAccessBlock及BucketOwnerEnforced。[AWS OAC规则](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html)。**OAC保护的是源站，不是图片的查看者认证：CDN中的商品图片仍公开可读。** 不放Cookie、HMAC、私钥、订单附件或客户私密文件；不能用不可猜的UUID代替隐私控制。

不选择公开S3桶，避免依赖关闭账号/桶PublicAccessBlock；不增加API读代理，以保留当前已验证候选、避免新的后端构建。首轮只支持本准确sandbox，不借此接通任意新租户。

## 3. 拟议资源归属（不是创建许可）

拟议名称仅是待核对名称，不代表名称空位、所有权或资源已存在：

- 栈：`techlong-sandbox-media-9c5ee9e64509dcad-v1`。
- 桶：`techlong-sandbox-tenant-images-402010193138-9c5ee9e64509dcad`（60字符）。

该独立栈**拟包含5项资源**：

| 逻辑ID / 类型 | 最小声明 |
| --- | --- |
| MediaBucket / AWS::S3::Bucket | SSE-S3/AES256、Versioning Enabled、四项PublicAccessBlock、BucketOwnerEnforced、无网站端点；DeletionPolicy与UpdateReplacePolicy均Retain；无自动对象/版本过期 |
| MediaOriginAccessControl / AWS::CloudFront::OriginAccessControl | S3 origin、sigv4、always签名 |
| MediaResponseHeadersPolicy / AWS::CloudFront::ResponseHeadersPolicy | 图片CORS允许准确买家origin；不携带凭据，不改API CORS |
| MediaDistribution / AWS::CloudFront::Distribution | 准确S3 RegionalDomainName、默认HTTPS证书、HTTPS-only；仅GET/HEAD/OPTIONS，无SPA错误页回退，无上传/删除方法，无Lambda@Edge |
| MediaBucketPolicy / AWS::S3::BucketPolicy | Deny非TLS；仅准确distribution的SourceArn允许GetObject到products/*；无匿名写/列举或全桶公开策略 |

CORS同时声明S3的GET/HEAD规则与CloudFront响应头；预检需要的Origin/Access-Control-Request-Method/Access-Control-Request-Headers须按行为转发并参与相应缓存区分，不能只加一个响应头就声称预检通过。现有SDK上传服务端调用不受浏览器CORS授权替代。[S3 CORS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html)、[CloudFront响应头与缓存区别](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/modifying-response-headers.html)。

图片键使用UUID，不覆盖旧键；沿用后端Cache-Control，CDN缓存上限在候选中固定，不新增失效队列。版本化保留旧版本会占存储；Retain不是免费、完整备份策略或永久可恢复保证。[CFN桶删除与保留](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-s3-bucket.html)。不自动创建清空桶、回收版本或删除栈的工具。

该栈生命周期独立于平台/Cell/租户运行栈；默认启用栈终止保护且不设资源到期标签。它不属于临时工具的三栈停用集合，也不能因租户API停费被删除。今后退租/图片清理另审，不把永久保留理解为无需治理。

## 4. 运行IAM：不换角色，不扩共享上限到所有角色

沿用原application TaskRoleArn及其数据库权限、trust、附件和边界归属，不新建任务角色，不改TaskExecutionRole、旧CFN PassRole或数据库binding。历史C4e材料显示TaskRole与其他角色共享ServiceRoleBoundary；这不是本轮现况证明，实际变更前只核对准确原角色/边界与归属。

最小候选是对**原IAM所属CFN声明**作两处修改，不由新图片栈成为第二个角色/策略管理者：

1. 在原应用角色增加一份准确图片写权限，仅`s3:PutObject`与`s3:DeleteObject`、准确新桶`products/*`。保留原Express数据库连接权限，不给ListBucket/GetObject/DeleteObjectVersion、IAM、Secret或桶管理权限。
2. 原共享boundary只增加相同S3动作/资源，且必须有`ArnEquals: aws:PrincipalArn = 准确原application角色ARN`。保留全部旧语句；其他共享boundary消费者不会因这条新Allow获得图片权限。不能仅加角色inline就忽略boundary，也不能追加不带主体限制的共享Allow。

这里只给差异规格，不声称历史模板等于当前安装态。原IAM栈/资源物理归属、当前权限正文/版本容量及必要有效权限尚待限定核对；若原声明存在差异，停止给出超范围执行稿，不顺便修整个IAM基线。候选必须保留现有角色/策略ID和全部数据库/Secret保护，不直接运行旧C4e安装器或PutRolePolicy脚本。

## 5. 租户配置：在idle态先准备，单独成为新基线

从未来获准取得的**准确Original模板**派生独立存储配置候选，不拿历史渲染器默认值覆盖现况，不改冻结渲染器/发布合同。保持原资源逻辑集合、原20项参数键、全部ImageUri/数据库/固定Secret引用/角色/网络/监听规则/域名不变，只改任务容器：

| Environment键 | 候选值 |
| --- | --- |
| IMAGE_STORAGE_PROVIDER | s3 |
| IMAGE_S3_BUCKET | MediaBucketName真实输出 |
| IMAGE_PUBLIC_BASE_URL | MediaPublicBaseUrl真实输出，即准确CloudFront HTTPS域名 |
| ALLOW_EPHEMERAL_IMAGE_STORAGE | false |

AWS_REGION保持ca-central-1、APP_RUNTIME_MODE保持原值，不新增或轮换Secret，不改变PG_DATABASE_BINDING_V2/SHA。桶名和公开URL是受审实际输出，可内联为非秘密环境值，不为此增加租户参数键。

若准确原栈仍idle，则只更新其已保留TaskDefinition，不启动Service/ALB/RDS；若实际已运行，必须把由此引发的正常ECS部署单列到执行审批，不默认为零计算副作用。CFN实际Change Set及回滚策略另审，不能把本方案推导成既定资源变更结果。

配置成功后取新实际模板/任务版本/非镜像配置摘要作为存储基线。临时启停现有逻辑从该基线派生，只删除/恢复原边缘资源而保留S3配置；不新增直接S3写入者或改回local。需要原工具重新接入新摘要时，只使用原入口另审，不在本轮重构启停工具。**此次存储配置更新不计入D2-6两次ImageUri更新。**

## 6. 旧图片：先证明来源，再决定是否需要迁移

目前没有读取云业务库、容器/本机图片或媒体快照，不能断言“无旧图”“都已迁移”或“已有文件丢失”。provider切换只影响后续上传，不会更新media_assets已有public_url。

实际迁移只在另准的准确清单内进行：

1. 限定读取本实例引用的媒体元数据及相应文件清单，形成每个asset/key/原URL/文件大小与SHA的私有清单；只接收用户确认可公开的商品图片，不遍历整个工程或复制所有images目录。
2. 本地对象缺失则停；不从UUID还原文件，不自动抓取任意历史URL，不偷偷删除或忽略媒体记录。若不需要迁移，必须有受审事实证明引用对象不依赖将被替换的容器文件，不能用口头“测试环境”绕过。
3. 对清单对象按准确key条件写S3、核对内容摘要和实际版本；不覆盖已有不同内容。非products前缀需单独映射/审批，不扩桶权限到所有键。
4. 若旧URL需变更，仅在**租户业务数据库**的单独原子事务中，按准确asset_id＋旧值条件更新provider/bucket/object_key/public_url及受影响variant，保留asset_id、商品关系及其他variant；不执行schema迁移或全表字符串替换。这不是原Neon控制面两SQL事务的隐藏扩充。
5. 对文件/URL/行数及摘要独立核对，保留原文件和旧值清单；跨S3/SQL非原子，提交不明即停，不自动重试/down或删除新对象。

数据读取、文件读取/迁移、SQL写及恢复数据库都需准确范围另批；本轮不做。这里不新建同步服务、常驻任务或图片迁移框架。

## 7. 绑定到原D2安装与发布，而不是另一套发布流程

仅当图片栈真实创建/归属和读写参数已核验：

- 原IAM模板`UploadBucketArns`取准确MediaBucketArn，**不是证据桶、拟议字符串或拼接后缀**；原release角色的ListBucket/HeadBucket权限边界保持，不新增图片对象读取/写入权。
- 实例sampling.persistence使用`providerVariable=IMAGE_STORAGE_PROVIDER`、`bucketVariable=IMAGE_S3_BUCKET`、准确桶名；verificationSha256绑定实际存储/必要迁移技术核验结果，不绑定这份离线方案假装通过。
- 保留`PERSISTENCE_NOT_READY`阻断；不修改planning.ts、sampling.ts、工作流或可信回写合同。
- 回到原四栈13资源/四LOGIN/两Neon事务的启用材料，并集中准备真实版本/实例绑定。后续仅一次必要恢复、两次同代码正常版本更新，GitHub environment仍由用户本人批准；不重做买家/商家业务测试。

技术核验仅检查CFN归属、准确角色/权限、任务provider/bucket/HTTPS URL、图片哈希及CORS；两次版本更新前后同一已批准图片仍一致。若使用一张合成非业务图片作CDN读取核验，准确key/一次写/读取/保留或删除均须列入实际审批，不建Lambda/ECS探针。Source上传或IAM模拟不冒称证明了真实TaskRole上传链路；客户端上传业务验收仍由用户负责。

## 8. 最短后继与边界

下一步只离线编码：**五资源CFN候选＋原IAM两处最小差异规格＋四个环境值的配置派生与必要回归**。复用现有CloudFront/OAC模板模式及CFN编排，不创建新的安装器、工作流、守护进程或多阶段编号。候选先验证纯结构/权限差异、无ImageUri/数据库绑定变化、idle不增运行资源；源码/CI通过不等于真实存储已启用。

在代码材料备齐后才另审一次集中限定事实补齐：仅拟议桶/栈名称、准确TaskRole/boundary与所属栈、原租户模板、必要媒体来源；旧角色补核/原ZIP/Neon基座不为此重读。此处是提议，**没有新增读取许可或可执行SHA**；不预先列出伪精确API次数、媒体条数或云变更结果。

实际安装、配置、必要迁移及原一次性启用可集中编制受审顺序和准确外层范围，但不得隐藏增加的五项存储/CDN资源、原IAM修改和业务数据副作用。当前未生成密码、读私钥/Secret/.env、调用AWS账号或数据库，未恢复环境/调度/上传对象；只本地源码/已存去敏资料和公开规范。原事实截至2026-11-15T00:18:33.301Z、原件到期11月15日19:07Z保持，不由本方案续期；没有更改50USD目标或承诺零费用。

本轮本地校验通过：机器JSON/五资源计数/7份源码LF指纹/必填桶参数与默认关闭保持；隔离执行现有image_storage模块，仅合成配置、URL编码和两次mock SDK命令（Put/Delete），未加载app/db/任何.env、真实SDK或网络。不把该合成核对冒充真实S3上传/CDN/业务验收，不为纯方案文档重跑应用CI。

## 9. 已批准的离线编码交付

本次用户已要求实施第8节的唯一动作，交付仅为：

- [五资源CFN候选](../ops/releases/persistence.draft.template.json)：固定sandbox名称、私有版本化Retain桶、OAC、准确CDN桶读策略、HTTPS默认域名及CORS。没有IAM/计算/网络/数据库资源，没有实际输出。终止保护是未来栈创建/设置操作的要求，Metadata不等于已替提供者启用保护。
- [纯派生函数](../ops/releases/persistence.ts)：后继第11节已将`draftPersistenceIam(original, {role, boundary}, actualMediaOutputs, approvedExistingRuntimeIam)`改为必须先保留已知运行授权，再追加两项图片差异；历史三参数调用不再可用。`draftPersistenceTenant(original, actualMediaOutputs)`仍只改四个环境值。输入不变、输出保持执行未授权/现场归属未验证，均无I/O、凭据或执行入口；不代表自动取得了当前Original、核实了模板与实际IAM一致或证明了输出来源。
- [材料指纹与待核对项](../ops/releases/persistence.prepared.json)：两份候选原件固定LF SHA；UploadBucketArns/真实迁移核验结果仍未产生，不签发安装SHA。
- [13项合成回归](../tests/instance-release-persistence.test.ts)：五资源/保留/私有读及CORS、原IAM两处精确追加/其他消费者不变、四环境值之外完整保持、错误目标和重复派生拒绝、现有full/idle变换保留S3配置。临时工具只在测试中使用，正式派生代码不依赖临时工具。

候选复用原sandbox CloudFront标准distribution的ForwardedValues配置形态，对三个CORS头逐值转发并分缓存，MaxTTL固定86400；该字段[已标弃用但标准distribution仍支持](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cloudfront-distribution-forwardedvalues.html)。本轮明确不加入额外CachePolicy/OriginRequestPolicy资源，保持五资源范围，不把它称作多租户distribution或云验证通过。

当前本地：新增13项全过，相关总193项为192通过/1个既有Windows原包解包skip；定向lint/全项目类型通过。原无AWS CI仅在已有测试命令中加入此文件，无新工作流或部署入口、无AWS/OIDC权限；准确远端Linux/PG16结果完成后单独记录。仅代码/文档main提交推送和该CI核验，不读取生产/.env/Secret/PEM、不AWS或数据库读写、不构建后端/晋升/安装/恢复。

下一唯一动作是核验该准确源码的既有无AWS CI并结项；之后才按第8节集中准备必要新事实与实际审批。不能用旧18:18:33准备期限或旧批准自动追加调用，也不能用这次代码测试冒充图片迁移或D2-6真实更新。

### 准确CI已通过，本次离线编码收尾

上次中断时只完成本地提交，push在自动审批用量检查前被拒绝且未执行；用户明确要求继续后，确认同一源码/干净工作区及旧上游，再推送`6d49bec58b520d6f092cd808b2febe093e3ddbdf`，未重做代码/回归或改权限。

[CI43676484668](https://github.com/veinyyxy/TechlongSoftware/actions/runs/43676484668)为准确main/push/原attempt1，completed/success，04:23:20Z（温尼伯11月14日22:23:20 CST）更新完成。Linux job132697644531的193项全过、fail0/skip0，包含新增13项；lint/类型成功。原生隔离PG16 job132697644280的9项全过、fail0/skip0。准确run源码/两job步骤及原日志中的测试统计已核对，[去敏证据与源码指纹](aws-instance-release-persistence-ci-20261114.json)。初次CI元数据入口被连接器本地拒绝后，只改用已支持的run集合GET定位准确源码，不是凭据过期或CI失败，没有重跑工作流。

**本次代码/CI阶段完成。** 五资源仍是候选，纯派生不证明当前IAM归属、桶空位或真实输出；未做AWS ValidateTemplate、生产读取/写入、图片迁移、身份安装、恢复或发布。原生产事实已过`2026-11-15T00:18:33.301Z`，不因为本次CI重新有效。下一只另审本存储前置所需的一次限定事实补齐以生成实际安装材料，不再重读旧ZIP/Neon基座或重新大盘点；当前不执行该读取。文档收尾HEAD不冒充新的运行源码CI。

后继只读范围已另获准（STS1/元数据30，原应用IAM/同一原Owner/租户配置及拟议名称、候选验证，不读媒体/数据库）；新a记录仅STS失败即停，其他读取及写入均0，[停止结果与原件指纹](aws-instance-release-persistence-preflight-stopped-20261114.json)。凭据当前不可用，尚无成功新快照；不重跑原命令，待用户刷新及新同范围许可。准备意图的5小时截止不是已取得的生产事实有效期，不据此生成安装SHA或启动环境。

## 10. 新只读事实：名称与模板已核对，原IAM声明需先保留现有运行授权

用户刷新并另准新b轮后，唯一STS身份通过。b提交21次元数据：20项结果封存（其中两项预期不存在），第21次GetTemplate提供者已返回，但旧本地JSON-only处理失败；没有重试。另准c仅补这一份Original，复用已有JSON/YAML解析器成功，确认返回体为YAML，未新增框架或修改运行代码。a/b停止原件保留，不能把b的通用CLI分类当作AWS拒绝或登录失效。[综合去敏事实/私有原件SHA](aws-instance-release-persistence-preflight-observed-20261114.json)。

合计新b＋另批c为**STS1、元数据22**，不是重做整批读取；没有再List资源或复用多余预算。配置/Secret/PAT/PEM/ZIP/图片/数据库、云写、安装/恢复/调度均0。事实终点仍2026-11-15T09:47:35.203Z（温尼伯11月15日03:47:35.203 CST），c不续期。

| 已核实项 | 结果与边界 |
| --- | --- |
| 新图片名称 | 拟议CFN栈/桶不存在；完整OAC及自定义响应头策略列表无同名对象。只证明采样时状态，不保留名称或消除并发竞态 |
| 五资源模板 | 官方ValidateTemplate已通过，无参数/额外capability；不等于实际创建、资源级属性验证或安装授权 |
| 租户 | 原UUID、UPDATE_COMPLETE、20参数、三项保留资源；模板无Service，当前任务定义:12、local图片配置、无volume/mount。未做账号级服务清点，未查图片文件或数据库状态，不声称所有收费已停止 |
| 应用IAM | 原TaskRole身份保持，唯一inline为ConnectExactExpressTenantC4e；共享边界默认v4，v3保留，共7个boundary消费者。声明19条、实际22条；实际已有Express授权不能被旧模板覆盖 |
| 归属 | TaskRole与ServiceRoleBoundary均由原techlong-s3-bootstrap/8afbe1e0…栈管理，逻辑ID不变。该栈24资源，实际Original规范SHA为ccf14717…；工程当前bootstrap全文及该路径11个本地历史版本均未匹配，不能拿仓库旧全文覆盖它 |

**具体必要差异只有先明确这一组：** 原TaskRole声明未登记已生效的ConnectExactExpressTenantC4e；原boundary声明缺C4eAppConnect、C4eMgmtConnect、C4eOtherSecretVersion。前两条承载数据库连接范围，后一条保留其他Secret版本的拒绝约束。原声明没有literal rds-db:connect Allow；直接对它调用图片追加函数，不能称为“只增图片、不影响现有授权”。此处不是以未解析的Fn::Sub/Ref造成的整个文档摘要差异来推断漂移；上述是明确缺失的inline名称和Sid，其他引用/语句尚未完整展开比对。

下一唯一建议是**仅离线编制原TaskRole/ServiceRoleBoundary两资源的声明对齐补丁与回归**：先保留现有实际Express授权，再叠加原图片差异；所有其他资源/参数/角色身份和权限不动，不重整整个IAM基线。对未核实的其余语句不自动推断或修改，也不以当前仓库bootstrap全文替换实际Original。当前只记录事实/下一最小范围，没有实施该补丁、签发执行SHA或改变云授权。实际创建/执行和任何额外读取仍另审，旧图来源/迁移亦未被本轮证明。

## 11. 原两资源声明对齐已编码，未执行云修改

用户明确要求继续后，仅修改原`ops/releases/persistence.ts`、原持久化测试和材料索引，不新增框架/工作流、云客户端或执行入口。五资源图片模板、租户配置派生、D2发布合同、数据库/Secret/角色身份和临时工具均保持。

`alignPersistenceRuntimeIam(original, {role, boundary}, approvedExistingRuntimeIam)`只在原两资源内补记：

| 声明 | 最小操作 |
| --- | --- |
| TaskRole.Policies | 仅补缺失的ConnectExactExpressTenantC4e，正文逐值取自已审当前inline投影；已经相同则保持，有冲突则停止 |
| ServiceRoleBoundary.PolicyDocument.Statement | 仅补C4eAppConnect、C4eMgmtConnect、C4eOtherSecretVersion，保留原语句顺序/表达式及Deny；重复、冲突或其他未知缺项不自动接纳 |

图片入口现在必须接收第四参数`approvedExistingRuntimeIam`，内部先完成上述对齐再加原图片权限；没有快照或角色/边界不符不能绕过。这个输入只能来自外层核准的准确角色/策略投影，函数不自行获取或认证它，不接收任意Web/workflow策略正文。原19条语句中的其他Fn::Sub/Ref**不自动展开或改写**，返回`otherIntrinsicPolicyEquivalenceVerified=false`，不能借此声称整个IAM有效权限已证明等价。

现有真实b/c投影已仅在本地通过新函数推导：19→22条边界声明、1份inline，其他目标属性完整保持；私有补丁仅含TaskRole/ServiceRoleBoundary两资源片段，没有整栈模板。文件`.local-secrets/persistence-iam-alignment-20261115-a/resource-patch.json`的SHA256为`9f6804516c475f326bf31cdd5833aa58597ee14e0e2be99b653accf0ceedc319`，派生结果摘要SHA为`2b95ab359e52662a2832b34d191acfbf0ed6d4929dc0f11f2cf982c54bbf8b8c`。正文不入Git，不伪造CDN输出、不调图片追加器生成假真实发布材料。

资源片段**不能直接作为CFN TemplateBody**；未来必须在另审流程中核对并取得准确完整Original，验证其规范摘要/两目标前态后才能合并，保持其他22资源和参数等内容不变。不得拿工程bootstrap旧全文补齐缺失部分。私有补丁不会自动生成Create/Execute或安装SHA，也不是权限安装已发生。

图片追加前，使用当前实测boundary正文计算紧凑UTF-8预测体积并作保守6144上限检查；保存样本中预测6044，不删除旧语句腾空间。[IAM官方限制](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)按6144字符且不计空白定义，代码的UTF-8字节计数是保守界限，不是对任意表达式展开或未来服务接纳的证明；原版本容量/有效权限仍在实际审批内核对。

新增7项回归覆盖：仅填已证实4缺项且24资源不变、对齐幂等/图片路径不能绕过、未知差异/冲突拒绝、错误或缺失快照、原intrinsic保持、预测体积超限。原13项保持，全持久化20项通过；相关本地总200项199pass/1既有Windows原包解包skip，定向lint与全项目类型检查通过，准确无AWS CI随后记录。测试只合成对象/已存本地投影，不新读生产配置/AWS/数据库或图片。

当前唯一继续点是本次准确源码的原无AWS CI及文档收尾，不追加事实采样或资源变更。原b/c事实仍到2026-11-15T09:47:35.203Z，不因编码/派生/CI续期；没有新生产读取、安装或恢复，runtime关闭、真实更新0。材料与完整Original/实际输出的执行绑定、额外读取和实际云变更仍具体另审。
