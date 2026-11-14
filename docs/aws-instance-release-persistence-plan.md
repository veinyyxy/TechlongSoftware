# D2-6持久化前置：上传桶与安装参数的最小离线方案

2026-11-14，America/Winnipeg。**仅离线方案，未编码、未部署、未批准新读取。** 本文只解决原D2第10节的图片持久化门槛及原IAM模板必填`UploadBucketArns`，不新增发布框架、图片业务功能或验收支线。[机器摘要](aws-instance-release-persistence-prepared-20261114.json)。真实更新仍0，runtime仍关闭。

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
