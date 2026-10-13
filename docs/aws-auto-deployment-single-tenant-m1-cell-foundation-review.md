# D001：基础 Cell + control 公钥 Secret 集中待审

2026-10-13 America/Winnipeg。[上一段私有输入](./aws-auto-deployment-single-tenant-m1-private-inputs.md)已完成；本段把依赖真实 Cell 输出的权限后置，不再用虚构 endpoint/Secret ARN/task revision 阻塞基础创建。**当前只准备，尚未获批或创建，M1整体和自动部署闭环仍未完成。** F3c9继续封存。

## 当前可批准范围：最多两次直接创建

1. 一次 `CreateSecret`：`techlong/sandbox/control-public-key-first-acceptance`，仅保存已生成的 RSA-3072 **公钥 PEM**，四个固定标签，默认 AWS-managed Secrets Manager KMS；不上传 private signing key、mTLS key、Stripe或商户密码。公钥SHA `72f953b9f3dab5269a7a1c08fa7acf684d2d9c379ae446b50e3d8294404f02a2`。固定ClientRequestToken绑定本次批准 SHA。
2. 一次 `CreateStack`：`techlong-sandbox-cell-sandbox-1`，沿用25项模板，仅新网络、安全组、ECS Cluster、ALB/443/8443 mTLS listeners、Aurora PG16.14 0–1ACU/一个私有writer及DB log。使用已安装 `TechlongSandboxFirstAcceptanceCellExecutionRole`，`OnFailure=ROLLBACK`、`TimeoutInMinutes=45`、termination protection=false。AWS服务内部创建/标记/回滚及RDS托管master Secret不计入“两次直接调用”，仍会收费。

没有CreateChangeSet/ExecuteChangeSet、IAM安装或撤权、DNS、TaskDefinition/RunTask/Service、Neon写、authority/activation、deployment/job、tenant、运行时启用或F3c9操作。没有临时grant待撤，新Cell role保持既有active状态。公钥Secret允许后续独立**仅该准确ARN+版本**的Describe/GetSecretValue核对；读到的只是公钥，不读取RDS master/tenant/旧Secret或任何私钥。并不证明其他角色已能使用这个公钥Secret。

独立 Inspect 判断CreateComplete+25实际资源、template/tags/role/UUID，并核对公钥版本/字节；`CREATE_SUBMITTED`不是完成，不领取部署任务或继续下一个写阶段。

## 待审 SHA / 有效期

- 批准 SHA：`ebeef325800e110799a4b2239b1dffafcbbc821320ea6a618740d7864a94bb74`
- 批准截止：**2026-10-13 18:40:34.092 CDT / 23:40:34.092 UTC**；到期不执行，未消费槽时只读重建fresh清单并重新确认，不沿用旧SHA。
- Cell提案deadline：**2026-10-13 20:40:26.908 CDT / 2026-10-14 01:40:26.908 UTC**（requestedAt+3h）。此tag不自动删除/停止费用；以后不能以刷新身份或业务任务开始晚为理由自动延长。
- 模板SHA `4d0061be99e0df1e51993f875596d00913aefe609c21a3432d4a7241431e8077`；14源码/lock pins绑定 `2fabc34e158d6c3f78d145151481f639dfb7ee4f052e17d7de3f880e3881685d`；manifest文件SHA `448f6d528b73ea08fdd1efae0c68d4505309691473c67af5aa831cd44da8c385`。
- 私有清单：`F:/ChatGPT_workshop/techlong-d001-cell-foundation-review-20261013-r1/manifest.json`，template与ValidateTemplate原件同目录，不覆盖历史。

## 已做真实核对

**22:40:26.688 UTC / Winnipeg17:40:26.688**，Neon Serializable READ ONLY：此前批准的5业务行/22项配置/5000 policy、旧隔离/schema不变，13项全部通过；另读确认Cell范围无未销毁tenant generation。没有deployment/job/TTL，apply=0，不改表/函数/用户状态。

**22:40:33.710 UTC**，Source准确Account/ARN/UserId；10项新Cell role/trust/RoleId/PolicyId/唯一inline/无attached/boundary-v1文档一致，7项准确名称查空，5项证书ISSUED/truststore ACTIVE/engine16.14且支持Min0/两AZ/default KMS核对通过。Source对CreateStack、DeleteStack命名空间、PassRole、公钥CreateSecret及其create-time TagResource五项模拟allowed、missingContext为空。基础创建前无需再安装新IAM；但模拟只证明指定上下文，不证明实际CFN handler/完整组合权限或将来UUID删除。

AWS ValidateTemplate通过，4参数、无IAM capabilities，requestId `a9dc6f51-e842-4765-9afa-2b3e30ae642c`。使用真实环境policy和已批准cert/truststore，不把template验证当实际创建/数据库/TLS证据。早一轮22:30:19.404UTC集中事实保留在 `techlong-d001-cell-foundation-facts-20261013-r1.json`（SHA `5431f295a49d04bb8d6d2614e70c60a92263e06fdaac90ca58bb6af48acb4a13`），没有重放或覆盖。

## 最新区域价格与完整风险

AWS官方ca-central-1 price-list当次选取：ALB 0.02475 USD/h、关联mTLS truststore 0.0055/h、ALB LCU 0.0088/h、public IPv4 0.005/地址/h、Aurora标准serverless v2 0.14/ACU-h、storage 0.11/GB-month、I/O 0.22/百万次、Secret 0.40/个/月。原件目录 `F:/ChatGPT_workshop/techlong-f3-prices-d001-20261013-readonly`，selected SHA `eec63a000fe071243a9c2750f76184c7b82661d651c637514dbaf5b892744ba8`。只是复用原只读采集程序，不推进F3。

按1ACU、1LCU、2个ALB IPv4计算：**0.18905 USD/h；3小时基础用量约0.56715 USD**，不是上限，另加storage/I/O/backup/log/API/传输/更多IP及税，也不含账户现有资源和未来Fargate/tenant。按730h同一持续活跃假设+2Secret约**138.81 USD/月**；Aurora完全暂停、LCU0假设约30.18/月同样排除变量。因此50 USD/月不是常驻滿负载承诺；需要真实清理/使用时长控制，不把自动pause当必然发生。

价格和机制参照 [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)、[AWS官方ca-central-1 ALB feed](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ca-central-1/index.json)、[Aurora feed](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ca-central-1/index.json)、[IPv4 pricing](https://aws.amazon.com/vpc/pricing/)、[Secret feed](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSSecretsManager/current/ca-central-1/index.json)。

批准必须接受以下完整风险（同manifest）：

- 公钥Secret与收费Cell非原子，可能只留下收费Secret、部分资源或失败/回滚Cell。不能以两次API上限承诺内部写数、费用或完成时间。
- [CreateStack的ROLLBACK/timeout](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)可以自动**删除本次新资源**。这项创建失败回滚纳入批准，但不授权agent主动DeleteStack或删除旧资源；不自动IAM补齐或重试。
- 新DB deletion protection=false、DeletionPolicy=Delete、backup1天；未来准确清理可无final snapshot永久丢失新Cell数据。不要把任何客户业务数据写入本次Cell。
- 三小时tag无scheduler，不会到点停止账单；50 USD目标非hard cap，常驻可超标。额度/身份失效后资源可能继续收费，需要人工接管。
- 命名空间模拟/已安装策略/模板验证不是provider、key-policy/service-linked-role、传播或真实执行证明。并发非跨服务CAS；检查与写之间仍有竞态。
- 旧mTLS private-key副本宽继承ACL风险仍在；新受限目录不消除旧暴露，也不证明已泄露。不静默改历史ACL、轮换CA或更换truststore，实际TLS未验收。
- 固定foundation尝试槽和Cell API-entry槽永久不复位、不覆盖；消费后失败/响应不确定，只有独立只读核对，不自动继续剩余写、replay、补偿或down。丢失UUID时不要用名称推断后直接删；先独立核对root creation event/token/身份，再另审。
- 公钥Secret不随Cell回滚/删除自动删除；Source登录自动刷新可能失败。状态不确定保留各步回执，不把未收到响应解释为未创建。
- 无tenant/TaskDefinition/IAM/DNS/Neon/authority/job/runtime/F3c9授权。后续每项写仍按真实坐标和fresh具体范围批准。

## 可执行清理与恢复位置

同一入口已有 `CleanupReview` / `CleanupRun`，使用本次**捕获的真实Stack UUID**、同template/tags/role及实际logical/type/physical inventory；独立确认Neon无deployment/job/tenant generation、ECS无service/running/pending task，重新核对Cell role文档与Source对准确UUID的DeleteStack模拟。**只适用于尚未部署tenant的基础Cell**；没有假称整个workload→database/role→generation Secret→Cell cleanup已经live通过。

创建SHA不能delete。CleanupReview仅生成新的准确snapshot SHA；须用户另行批准，CleanupRun一次STANDARD DeleteStack，无ForceDelete/RetainResources，不删公钥Secret，不安装清理调度，不改数据库记录。删除异步，最后仍需独立absence核验。基础Cell运行tenant之后此入口会拒绝，必须使用主线完整有序cleanup和独立readiness，不绕过它。

新永久槽路径 `F:/ChatGPT_workshop/techlong-d001-cell-foundation-create.permanent-slot.json`、`...cell-api.permanent-slot.json`、`...delete.permanent-slot.json`。本轮均未消费/创建。Run早先全组只读核对；每次写前确认准确Source/fresh SHA；写后保留准确公钥ARN/version和Cell UUID。凭据失效/漂移/槽已占用会停止，不自动新开槽。

后继执行命令（**仅取得上述fresh批准后**）：

```powershell
node --experimental-strip-types --env-file-if-exists=.env.local ops/aws-sandbox/scripts/review-single-tenant-cell-foundation.ts --mode Run --out F:/ChatGPT_workshop/techlong-d001-cell-foundation-run-20261013-ebeef325 --manifest F:/ChatGPT_workshop/techlong-d001-cell-foundation-review-20261013-r1/manifest.json --approved-sha ebeef325800e110799a4b2239b1dffafcbbc821320ea6a618740d7864a94bb74
```

随后新输出 `--mode Inspect --manifest <同manifest> --run-dir <上述run目录> --out <新foundation输出>`。每次Inspect是只读，不重跑Run；异步pending时使用新输出保留原回执。若到期且创建槽未消费，下一只重新Review/重新确认；若消费或响应不确定，先独立核对，不能刷新为新的自动重试。不要重生成本机key或业务记录。

40项新/相邻检查、全typecheck、定向lint通过；132F3c9+4IAM+14business+8私有输入共158pins未变。本轮云/DB写、Secret值读取、执行槽消费均0，两个main按既有授权提交推送，backend只更新交接文档。唯一下一步是用户批准这两次基础创建；完成后回读真实Cell endpoint/master Secret ARN/ALB/DNS坐标，准备准确lifecycle注册、窄权限、activation/job和完整cleanup门禁，不重建镜像或重启F3c9。
