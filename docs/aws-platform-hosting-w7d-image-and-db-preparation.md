# W7d：可追溯镜像、独立 ECR 身份及数据库权限准备

2026-10-21；沿用[W7c两小时受控验收](aws-platform-hosting-w7c-two-hour-https.md)。本阶段只准备工程和只读材料，不批准/执行 ECR 创建或发布、IAM/数据库授权、Secret 供给、平台部署或清理。`executionReady=false`，两小时运行窗口尚未开始。

## 1. 保留同一份经过自检的镜像

原 hosting candidate 工作流在两个真实容器自检都通过后，才导出**同一份** Linux/amd64 镜像，不在发布时盲目重新构建。仅 main 的首次 push run 导出；PR和重跑不导出。仍只有 `contents: read`，没有 OIDC、AWS身份、GitHub environment、Secret 或 registry push。

产物名称 `platform-web-image-<完整源码SHA>-<run ID>`，保留3天，禁止覆盖，上传准确三个文件：

- `image.tar.gz`：`docker save` 的实际镜像压缩包。
- `image-receipt.json`：源码、run/attempt、image config digest、Linux/amd64、archive字节数和SHA256。
- `SHA256SUMS`：压缩包及receipt字节摘要。

新的 `ops/platform-hosting-v1/image-artifact.mjs` 仅处理文件和公开镜像元数据；检查 non-root、准确命令、Node24.18.0、无私密环境变量/Volumes/OnBuild，拒绝重复生成已有receipt。它不是发布程序，不登录registry、不加载镜像、不解包、不读凭据。下载后可以独立核对字节：

```powershell
node ops/platform-hosting-v1/image-artifact.mjs verify '<准确产物目录>' '<完整源码SHA>' '<准确run ID>'
```

成功仅表示本地压缩包与绑定receipt字节相符；**receipt和SHA256SUMS不是自签可信证明**。发布前还必须独立核对 GitHub run/source/workflow/attempt/成功状态、准确artifact ID/官方artifact digest及未过期；load后重新检查实际image config ID，再push准确新tag、独立回读ECR manifest digest/扫描。不能将image config digest、archive hash或GitHub ZIP digest当作ECR manifest digest。产物过期不重跑旧发布或延长旧批准，应准备新候选和新具体批准。

三天保留是衔接审批的准备决定，不是永久存储；可能占用GitHub产物额度/产生存储费用，不升级plan或引入larger runner。这里只增加构建验证产物，未批准转传至AWS。

## 2. 新 ECR / 发布身份模板，初始严格锁定

纯编译器：`ops/platform-hosting-v1/image-foundation.mjs` 的 `lockedImageFoundation()`。固定账户 `402010193138`、区域 `ca-central-1`、新栈 `techlong-sandbox-platform-image-foundation-v1`。**不借用、不修改旧 ImagePublisher、worker/controller 角色、边界或栈。**

| 新逻辑资源 | 准确对象/约束 |
| --- | --- |
| PlatformWebRepository | `techlong-sandbox-platform-web`；IMMUTABLE、scanOnPush=true、AES256；无标签排除、无自动生命周期删除；DeletionPolicy/UpdateReplacePolicy均Retain、EmptyOnDelete=false |
| PlatformImageBoundary | `TechlongSandboxPlatformImagePublishBoundaryV1`；仅新仓库上传/读取/扫描元数据；GetAuthorizationToken因AWS接口要求Resource=*，另限ca-central-1 |
| PlatformImagePublisher | `TechlongSandboxPlatformImagePublisherV1`；使用上述boundary与相同inline上限；trust明确Deny三种AssumeRole入口，初始没有可登录principal；无附加managed policy，MaxSessionDuration3600 |

仓库范围权限为 `BatchCheckLayerAvailability / InitiateLayerUpload / UploadLayerPart / CompleteLayerUpload / PutImage / BatchGetImage / GetDownloadUrlForLayer / DescribeImages / DescribeRepositories / DescribeImageScanFindings`，另有 `GetAuthorizationToken`。没有 IAM、PassRole、CFN、ECS、Secret、S3、镜像删除、仓库创建/策略/扫描配置修改权限。Boundary是最大上限，不是凭据；trust未解锁前仍不能取得会话。IAM范围是**准确仓库**而非准确image tag，未来workflow必须另检准确tag/digest，不能声称IAM已限制单个tag。[AWS准确仓库push权限](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-push-iam.html)、[token权限范围](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html)、[标签不可变](https://docs.aws.amazon.com/AmazonECR/latest/userguide/image-tag-mutability.html)。

2026-10-21本轮只读核对：Source CLI和SDK均为准确IAM User `techlong-sandbox-dev`；现有GitHub OIDC provider URL正确且aud包含sts.amazonaws.com；新repository/role/boundary/stack准确名称分别返回相应NotFound，ECR registry扫描为BASIC、rules=[]。这只证明观测时不存在，不保证未来创建前仍空闲，也不允许自动接管同名对象。

CloudFormation `ValidateTemplate` 只读验证在 `2026-10-21T18:51:27.886Z` 成功，返回 `CAPABILITY_NAMED_IAM`、0参数。模板字节算法 `JSON.stringify(lockedImageFoundation(), null, 2) + '\n'`，SHA256=`c97085b1447d20c4815eb9064589948a0159c61b14c3baee7aed00bd855c82b9`。**这是模板摘要，不是执行批准清单SHA**；ValidateTemplate不等于IAM语义/权限安装成功或Change Set批准。

目前没有新的发布workflow或OIDC trust grant，GitHub连接器不支持本次所需OIDC customization/environment端点（请求返回unsupported endpoint），未为此读取App私钥或修改GitHub设置。历史记录使用immutable subject；不能据历史假定当前值，更不能以旧的name-only subject代替。未来受审发布需核对当前subject/environment、固定可复用workflow源码和操作者、受限时窗及收尾；仍需新具体批准，不将本页当成解锁许可。[GitHub AWS OIDC与immutable subject](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)。

创建模板以后仍会有非原子失败、部分IAM遗留、传播/并发和收费镜像留存风险；本轮尚未创建Change Set/Stack或消费任何新执行槽。镜像Retain意味着未来删hosting栈甚至删foundation栈也不自动清理ECR内容，实际删除需另审，不能自动`force`或安装生命周期来绕过。

## 3. 接受“登录会写数据库”，不使用owner凭据

`ops/platform-hosting-v1/database-profile.mjs` 是首轮**现有管理员登录＋概览/实例只读浏览**的权限提案，不是完整生产平台角色，也不是已安装/已证明的授权。

拟用角色 `techlong_platform_web_acceptance_v1`，拟用Secret `techlong/sandbox/platform-web/neon-v1`。不复用owner、worker/controller凭据，不把真实DATABASE_URL或密码放到镜像/产物/聊天；Secret JSON/版本和execution-role注入形式后续另审。

| 用途 | 拟允许的数据库能力 |
| --- | --- |
| 用户/企业及页面 | 精确13张表SELECT：users、workspaces、workspace_members、products、plans、subscriptions、app_instances、app_instance_templates、app_instance_template_versions、workspace_product_entitlements、app_instance_deployments、deployment_jobs、payment_records |
| 登录校验 | user_credentials的user_id、password_hash、password_salt、password_iterations、failed_attempts、locked_until列SELECT |
| 防爆破计数 | 仅user_credentials.failed_attempts / locked_until / updated_at列UPDATE；不授予密码列修改 |
| 会话 | auth_sessions SELECT/INSERT/DELETE；现有createSession会先删除到期session，logout会删除当前token session |

这不是完全只读角色，**正常登录会写会话和失败计数，也可能清理所有已过期session**；角色权限按表/列，不是用户/租户行过滤。SELECT包含凭据哈希和既有部署/job材料，暴露风险必须在凭据安装评审中说明；没有原始密码读取，但不能把hash称作无敏感性。页面上的其他编辑按钮/注册、付款、邀请、改密码不在验收范围，即使原UI显示也不能用此角色开通业务写入。

依据：现有 `lib/auth/{credentials,session,account}.ts`、`lib/instances/management.ts`、`lib/deployments/{management,initialized-platform-management}.ts` 的实际SQL。deployment/controller写入口继续关闭；准确实例页面仍读取既有deployment/jobs，因此不能因按钮关闭就遗漏这两张只读表。没有运行任何数据库查询验证此提案，更没有宣称所有页面已兼容。

后续先单独批准 catalog-only、READ ONLY事务核对当前角色/OID、角色成员、database/schema/PUBLIC ACL、表/列、security-definer函数和默认授权等有效权限，再生成准确安装清单。文件中的 `WEB_DATABASE_CATALOG_SQL` 是第一批元数据查询文本，**不包含业务行、密码、函数源码或可执行写入**，也没有可自动连接Neon的runner。它不是完整有效权限证明；PUBLIC隐式授权、继承、函数和默认权限可能突破直接GRANT上限，需要独立审查。若需要额外查询/权限，不自动扩大或静默撤销旧PUBLIC权限。

不会授予owner/superuser/bypassRLS/createdb/createrole、角色成员、建schema/DDL、默认权限、业务/部署/authority写入或controller schema访问。首次部署前仍须用准确身份独立回读和实际登录验收；不得仅用“角色已创建”替代证明。

## 验证、边界与下一步

本地42项hosting/release测试全部通过，包括真实临时loopback HTTP、实际CLI文件摘要、重封装拒绝、root/私密env/来源替换拒绝、三个准确foundation资源、无扩权/删除、schema内真实表存在及metadata-only SQL。TypeScript、scoped lint和原81pin部署闭包均通过。

**新CI及产物已独立核对成功：** [run39656845292](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39656845292)，源码 `e06498436dab7022f6fb6ab4f450689fd3c6722e`、push/attempt1、repository1323312747/workflow391864582；run与job119419263591均completed/success，15项报告步骤全部成功。两种真实smoke各核对18项浏览器资源，随后同一镜像导出上传成功。准确artifact ID=`12371098858`，size=`329772909` bytes，官方ZIP digest=`sha256:3b7764998422bfe07381a758d75e3463cf3ab91770a25dd75d8b98faac182855`，expires=`2026-10-24T18:55:49Z`，独立元数据回读expired=false。CI日志的image config digest=`sha256:98591bc59ab26105f6d60c1b2b3d70c853fd56846109b09f9561c3acd53610a3`，archive SHA=`164d39e898e76f90ce132ce7fcae6044443e03f85ba121e7526e9a60898f3b6c`。本轮没有下载该330MB ZIP，也没有因此声称本机重新验过压缩包/镜像或ECR；未来发布前按上述完整链路验证。

当前只发生必要只读AWS身份/准确名称/OIDC/扫描/模板验证，以及代码提交推送和No-AWS CI。没有Secret/PEM/.env值读取、Neon连接、SQL写入、AWS资源/权限安装、registry push、workflow dispatch、旧记录/槽修改或新清理。客户端和Backend仓库不动。

下一执行依赖：[新foundation创建范围与完整风险审核](aws-platform-hosting-w7d-foundation-creation-review.md)及[准确JSON清单](../ops/aws-sandbox/reviews/platform-image-foundation-w7d.create-review.json)确认 → 当前OIDC/准确一次镜像发布及独立ECR digest/扫描 → 数据库catalog核对及凭据另审 → 精确两小时hosting部署、真实登录/TLS验收和单独清理批准。准备可以并行，不再展开旧F3c9身份探针或重跑历史租户。后续只有文档/JSON更新，不改变本次已验证代码锚点。
