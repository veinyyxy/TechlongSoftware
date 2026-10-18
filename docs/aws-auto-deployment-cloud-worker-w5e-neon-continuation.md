# W5e-C1：复用已存数据库固定版本的窄续接

2026-10-17 Winnipeg。用户“开始下一步”授权**准备续接清单与代码验证**，不代表批准读取 Secret 值/原私密包或安装。失败的 InstallLocked 和 RecoverLocked、旧源码99 pins、两个已消费槽、原件和完整风险均保持；本入口不是重跑或给旧槽复位。

## 起点与唯一目标

起点是 [R1实际部分结果](aws-auto-deployment-cloud-worker-w5e-neon-recovery-partial.md)：基础五资源栈准确Locked，数据库Secret已有唯一AWSCURRENT固定版本、控制Secret空、Neon目标role/schema/四函数未安装。R1只执行一次Put并获ACK，Neon尝试0；写后具体失败原因没保留下来，**不把传播延迟当成已证明根因**。

新入口 `ops/cloud-worker/install/run-continuation-v5.mjs` 只有 Review / ContinueLocked / Inspect。目标只补齐Locked安装并产出实际ID绑定；不激活OIDC/workflow、不发起job或租户部署，不扩F3c9/Sites/清理/监控支线。

## 准确范围、顺序与上限

1. fresh只读确认 Source为IAM User `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，Account `402010193138`；基础栈UUID `308174f0-ca9e-11f1-a04d-02569e9287b5`、role ID `AROAV3GNMXTZK5O45RG24`、journal table ID `ea69c69e-1c48-481a-83f0-36393c196d9f`，deny-all trust/inline/boundary v1及DDB/S3保护不变。旧IAM布局不变，Neon owner16392/PUBLIC/目标表/旧触发器等不漂移，provider保持 `neon.forward_ddl=on`、`password_encryption=scram-sha-256`。
2. 清单绑定新源码/action SHA、原材料公开摘要、旧安装25原件和R1的14回执/槽、R1原99源码不变。清单有效两小时，执行fresh preflight不超过180秒，完成后30秒内才可占新槽；每次私密读取/写入前验证批准和20分钟执行时限。不是跨服务CAS，也不防管理员改本地文件/时钟/槽。
3. 明确批准后只消费一个新的固定槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-neon-continuation-v1.permanent-slot.json`。原安装槽和R1槽保持，换manifest/输出目录不能绕过新槽。Review/Inspect不消费槽。
4. **仅一次 Source GetSecretValue**：准确完整 ARN `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/neon-control-v1-pVKVEV`，同时指定 VersionId `ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e`、VersionStage `AWSCURRENT`。先确认资源策略/完整版本集，回包再核对ARN/名称/版本/唯一stage/JSON形状，内存验证角色、endpoint指纹、TLS/96位hex密码；不输出值、不读取控制Secret值或按名字/最新版本回退。数据库Secret写入0、新密码生成0。
5. **原私密包一次新读取**：仍为 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2`，保持两主体原ACL、文件和公开指纹；原八字段（含未使用Stripe字段）进入进程内存，只提取schema/appID/五PEM。不签JWT、不调用控制HTTP/Stripe，不上传原整包、owner DSN或Stripe。
6. **一次 PutSecretValue**，仅控制Secret完整 ARN `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/control-first-acceptance-v1-CatDWK`，固定VersionId `2854e7b6-6c3c-41be-a5d8-b87dd9d98810`，只上传最小控制材料。写前准确版本集必须空、隔离策略/标签/默认KMS不变。回包核对成功即先计ACK并保存独立 `control-api-ack.json`，**之后**才核验发布元数据；磁盘失败不重发Put。
7. 仅对该次ACK后“准确版本尚未可见”的情况允许最多5轮只读 DescribeSecret/GetResourcePolicy/ListSecretVersionIds，每轮3个并行请求，退避依次0/1/2/4/8秒（合计15秒，不含网络耗时）；单请求30秒AbortSignal，SDK maxAttempts=1。IncludeDeprecated=true、拒绝分页；只接受空或准确固定版本的可见性过渡。未知/额外版本、策略/标签/KMS/轮换/复制漂移或API错误立即停止，不进入传播等待，不放宽安全条件。等待上限耗尽仍停，**没有第二次Put**，更不是保证最终一致。
8. 两份固定材料都已持久化且Neon目录仍准确未安装，才执行**一个** Serializable Neon兼容安装事务，复用原固定版本中的原密码，不生成/改密。角色 `techlong_cloud_worker_v5` 为LOGIN/NOINHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS；专属schema/四函数与原合同相同，owner16392、窄EXECUTE、无直接业务表权限。自动创建者ADMIN=true/SET=false/INHERIT=false属于受审范围。原密码通过TLS/Neon HTTPS进入固定SQL；不关闭提供者hook或改provider设置。COMMIT获ACK先单独记录，再做一次窄角色只读catalog认证。
9. 独立元数据核对后保存完整installation-binding；另一个新进程Inspect只读核对OID/函数源码/ACL、准确Secret版本和Locked布局，不读Secret值/原包、不重复密码认证，不冒充云端OIDC/Secret读取路径或自动部署已证明。任何失败均保留原件、单次槽及部分状态，不自动清理/回滚/补齐/重试。

## 完整风险

- 新的Source固定版本读取是真实凭据暴露面，必须另按fresh SHA批准。AWS记录该API调用的CloudTrail事件；不能在自己日志输出SecretString/DSN/密码，也不能保证所有提供者或本机内存/转储绝不留存。JS释放引用不等于取证级擦除。[GetSecretValue官方语义](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html)
- 复用已存版本避免覆盖密码，但当前Review只核对元数据，**尚未证明该值可解密、内容有效或可登录**。未来唯一读取若失败或内容不匹配即停止，不能新增IAM/KMS、换版本或生成新密码规避。
- Neon要求SQL使用原密码而非预哈希，密码可能进入服务端SQL、审计/托管控制平面日志。保持hook开启；普通PG模拟GUC的CI不是托管转发实证，事务回滚或丢ACK不能排除provider副作用。[Neon角色文档](https://neon.com/docs/manage/roles#manage-roles-with-sql)
- LOGIN角色和四函数包含claim/complete受限业务写能力，不是只读角色或行过滤。入口自身不调用业务函数/DML；安装成功也代表凭据已经持有这份窄能力，不等于零风险。创建者自动ADMIN也不是给worker继承owner。
- 先控制Secret后SQL不是分布式原子操作，失败可能留下两份可用/收费材料、LOGIN角色或部分托管状态；密码固定版本与R1回执保留，不自动删除/禁用/改密/撤权。收到API ACK后丢本地记录也不应重发请求。
- AWS元数据可能有可见性延迟；有界只读观察是明确新行为，**不是本次旧失败根因诊断**。不重试写入，不承诺5轮后必然可见；并发管理员仍可改变资源/版本/源码，VersionId不是跨服务CAS。[AWS一致性说明](https://docs.aws.amazon.com/secretsmanager/latest/userguide/troubleshoot.html#troubleshoot_general_eventual-consistency)
- 默认AWS-managed KMS在DescribeSecret中不返回KmsKeyId，本入口拒绝任意显式KMS字段，不偷偷补KMS权限。[DescribeSecret官方说明](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_DescribeSecret.html)
- Source固定AWS Login可自动刷新；失效会令读取/安装/核验停止，可能留下部分状态，不自动重跑。每个SDK写maxAttempts=1不约束AWS/Neon提供者内部行为。永久槽是可信本机代码约束，不是抗管理员篡改的硬件保证。
- 保留[原安装风险](aws-auto-deployment-cloud-worker-w5e-installer.md)和[R1恢复风险](aws-auto-deployment-cloud-worker-w5e-neon-recovery.md)：宽区域metadata读取、task旧宽Secret权限靠新Secret显式Deny隔离、boundary/inline差异、S3版本化非WORM、DDB围栏依赖可信代码、public/main未保护及竞态。权限/策略不在本次修改范围。
- 不新建AWS对象、改IAM/Secret策略、部署ECS/Cell/ALB/RDS、改业务数据/authority/GitHub设置或开启workflow。现有Secret、API请求与原Cell/ALB/Aurora等仍可能收费；50 USD/月是目标不是硬cap/自动停费。失败不自动删除收费资源。

## 审阅接口与继续门禁

```powershell
node --experimental-strip-types ops/cloud-worker/install/run-continuation-v5.mjs --mode Review --output F:/ChatGPT_workshop/techlong-w5e-continuation-review-<fresh-id>
node --experimental-strip-types ops/cloud-worker/install/run-continuation-v5.mjs --mode ContinueLocked --manifest F:/ChatGPT_workshop/techlong-w5e-continuation-review-<fresh-id>/manifest.json --approved-sha <NEW-EXPLICITLY-APPROVED-SHA> --output F:/ChatGPT_workshop/techlong-w5e-continuation-run-<fresh-id>
node --experimental-strip-types ops/cloud-worker/install/run-continuation-v5.mjs --mode Inspect --run-directory F:/ChatGPT_workshop/techlong-w5e-continuation-run-<fresh-id> --output F:/ChatGPT_workshop/techlong-w5e-continuation-inspect-<fresh-id>
```

占位符不是批准。只有独立新候选CI通过、clean main最终只读fresh Review与摘要重构后，才请求用户对上述**一次新槽/一次固定数据库值读取/一次原包新读/一次控制Put/一个Neon事务**的新SHA批准。准备阶段生产私密读取/随机密码/写入/新槽消费均为0；旧批准不能用于ContinueLocked。
