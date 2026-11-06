# 2026-11-06：手工测试环境恢复与本地测试数据导入

本轮按用户明确要求执行：恢复原AWS环境，将本地服务端测试数据导入AWS服务端租户库，产品测试交由用户本人。用户另选“基础数据＋历史买家、订单和支付记录”，不调用支付/消息服务，不导入设备令牌、验证码或待执行队列。无新到期/watch，不新增IAM/VPC/ECR镜像/CFN栈，不重放旧Review或业务任务。

## 实际结果与入口

2026-11-06T14:50:58.601Z最终独立只读核验通过，状态`ENVIRONMENT_AND_TEST_DATA_READY_FOR_USER`。这不是商家/买家产品验收，也不是正式自动部署CFN drift收敛。

| 对象 | 实际结果 |
| --- | --- |
| Aurora techlong-sandbox-express-d001 | available，原cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM保持，PostgreSQL17.9 |
| RDS speedfeast-postgres-prod | available，原db-MOOXGHRHTZM25V3I4NY25D4IEQ保持；没有导入数据到此实例 |
| Cell ALB | active，新ARN尾706bcbbc89b8a673，443/8443及原4条非默认规则恢复 |
| 平台ALB | active，新ARN尾a33cd1f8bed33cba，443恢复 |
| 租户与平台ECS | 原两TaskDefinition:12、镜像及角色保持；desired/running/pending均1/1/0、rollout COMPLETED、目标healthy |
| DNS | console/API两A Alias已指向新ALB，INSYNC；买家CDN不变 |
| 平台控制器 | 保持关闭；没有hosted-controller启动参数及控制器私钥/控制库Secret挂载；普通网页登录模式保留 |

入口：买家`https://buyer.sandbox.techlong.cloud`；平台`https://console.sandbox.techlong.cloud`；共享买家/商家API基址`https://first-acceptance.sandbox.techlong.cloud`，HTTPS443。商家/卖家是Android App，工程路径`E:/flutter_project/speedfest_merchant`，不是要新部署的商家Web。HMAC/JWT等既有Secret和固定版本未修改或由代理读取值，不需要重新生成密钥。

恢复写入各一次：StartDBCluster1、StartDBInstance1、CreateLoadBalancer2、ModifyLoadBalancerAttributes2、CreateListener3、CreateRule4、Route53 ChangeResourceRecordSets1、ECS UpdateService2，共16次。其余只是元数据读和轮询；没有CFN/IAM写或其他Region的业务创建。使用最新11月1日停用备份派生新恢复记录，旧snapshot/journal保持。

## 数据导入范围与映射

本地源是服务端`.env`指向的loopback PostgreSQL15.3/SpeedFeastMain；目标严格绑定同一Aurora的`tenant_a0da1748bc4d5419_db`，不是Neon或独立prod RDS。使用临时IAM数据库令牌和验证CA/SNI的TLS，连接身份/库名均核对。没有改数据库角色、密码或网络权限。

源只读事务导出、结构/外键核对后，目标单一SERIALIZABLE事务新增40张业务表共**1,331行**；3个业务序列以事务性的ALTER SEQUENCE RESTART对齐。提交ACK后由新TLS连接独立核对所有导入行内容/行数、保留行及33张保护表摘要，结果`IMPORT_INDEPENDENTLY_VERIFIED`。未调用Stripe/Twilio/消息/打印接口，无源SQL写、DROP/TRUNCATE、触发器禁用、replication-role变更或全库覆盖。

| 业务数据 | 导入/最终状态 |
| --- | --- |
| 店铺 | 保留云原默认店铺ID及整行，将本地默认店铺业务关联映射到该ID；另新增本地第二店铺，最终2家 |
| 商品/菜单 | 17商品、6分类、选项/门店商品关联及图片记录等已导入 |
| 买家 | 5名，原密码哈希保留，不读取/重设明文密码 |
| 商家 | 导入本地2名及业务权限关联，保留原云管理员，最终3名；账号仍使用本地原密码 |
| 订单/支付 | 117订单、196订单明细、113支付、9退款记录、552支付事件等历史记录；只迁记录，不执行支付/退款 |
| 桌台/其他 | 12桌台及积分/奖励/供应商等相关非空业务数据，按外键顺序导入 |

云业务权限字典原为空，为导入商家权限外键和可用性补入本地`merchant_permissions`20行及`merchant_role_permissions`43行；它们是租户应用内业务数据，不是AWS IAM或平台SaaS授权。原授权值未改，当前2店铺/3活跃商家/5买家不超过既有上限。若后续要增加账号/店铺，应正常处理额度，不绕过SaaS限制。

保留且独立回读一致：原云默认店铺、原云管理员整行；所有saas_*表、system_config/history、验证码、设备/推送令牌、通知/打印队列、保存的支付方式等33张未导入表。没有将本地SaaS实例ID/授权/运行配置复制到云端。默认店铺ID映射后，App若仍缓存本地店铺ID，需由用户退出后重新选择/登录；代理没有代登录。

**图片范围限制**：9条media_assets及商品图片数据库记录已复制，均为local存储引用；本轮没有上传对应本地图片文件，也未做图片访问/产品业务测试，不能保证图片已显示。不要为此静默新增S3桶、公开权限、重建镜像或扩部署支线。

## 私有原件与恢复索引（正文不提交Git）

- 最新恢复根：`F:/ChatGPT_workshop/manual-environment-restore-20261106-b`，inputs/journal及派生idle/power snapshot保存完整新旧ARN映射。
- 最终独立AWS结果：`independent/result.json`，raw SHA `399faf4b40c49fff26f926b21e5c664acb85449509e8603938c51ab2167d9c94`。
- 源只读导出根：`F:/ChatGPT_workshop/local-test-data-20261106-a`；实际使用`source-data-v2.json`，SHA `3089ec9e093118d9f3a791573d64fec7432880fb5b3f9902f75bb70f51b39b5b`，2,531,936字节。v1及两次事务导出时间保留，v2仅补齐静态业务权限参考行，未覆盖旧文件。
- 目标结构只读记录：`F:/ChatGPT_workshop/cloud-test-data-20261106-a/inventory.json`。
- 实际导入根：`F:/ChatGPT_workshop/test-data-import-20261106-b`，plan/journal保留准确表/列/映射/提交ACK。
- 写前目标表备份：`before-data.json`，raw SHA `54b80b9d1284dc209dfeb3f8691eef081b212bef848f82cb521dd44a08f5d6bf`。
- 独立SQL结果：`independent-result.json`，raw SHA `62671074927b2d71db8acd18e70a2a3281820a14198e8f8bfe7e07de58082ab5`。
- 新手工停用配置：恢复根`manual-stop.config.json`，enabled=false/expiresAt=null，已绑定本次新ALB ARN；只做过离线预览，未运行停用。

连接配置、导出业务行、密码哈希/支付响应、备份正文只在必要内存或受限ACL本地目录，不进入Git/聊天。数据导入不能被误认为可自动重放；下次启动只恢复基础设施，不重复导入这份快照。不要自动执行“down”、删除新增业务行或回滚历史数据。

## 失败沿革与未扩大范围

1. 恢复预检a在Route53全局endpoint使用错误签名Region而返回SignatureDoesNotMatch，云写0。原a失败文件保留；修正全局签名为us-east-1后用新b根核对通过。us-east-1仅是全局API签名区域，不是新建VPC/业务承载。
2. 本机pg_dump版本检查在沙箱遇DLL加载错误，无导出/数据写。实际采用只读事务的逐行JSON导出和参数化SQL导入，不执行来源DDL或SQL文本。
3. 导入a在连接准备阶段停止，inserted=[]/commitSubmitted=false，未开始数据事务或写入，原记录保持。原始异常只保存DETAILS_WITHHELD，不能断言唯一原因。新独立只读连接成功；新b记录改用已验证的连接启动参数，将lock/idle事务设置放到BEGIN后，事务及独立验收成功，不复位或重放a。

保留旧父/子CFN声明、物理ID/Outputs与手工新ALB/listener引用之间的已披露drift。为手工测试恢复原路由，不代表正式CFN控制面已收敛；后续自动部署前应按准确差异另审，不能绕过原执行角色边界。本轮正式部署代码、111文件闭包及CI工作流未改，未开F3c9、探针、UI或通用恢复框架支线。

## 当前唯一继续点

用户自行测试；不代做登录、下单、支付、退款或消息测试，不主动开新阶段。没有设置资源到期或自动清理，持续运行收费，50USD/月不是硬cap。用户通知停用时先读本页及最新独立原件，按新manual-stop配置核对当前目标并用全新停用备份；不要用旧ALB ARN或重放恢复动作。数据库数据保留，不因停用回滚测试数据。
