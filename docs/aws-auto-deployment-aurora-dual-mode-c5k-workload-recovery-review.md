# C5k K1：workload-only 恢复最终待审清单

状态：**只读Review通过，尚未授权或执行创建**。Source刷新仅用于核验，不是部署批准。K1只恢复承载；K2初始化状态及平台协调仍另审。

## 准确SHA和时限

Manifest SHA：`4b194dc34fa44bc23c1999d21363351b14177fd0e57e62bce5726f75c8e95e10`。

| 项目 | America/Winnipeg（CDT） | UTC |
| --- | --- | --- |
| 清单生成 | 2026-10-15 23:04:28.726 | 2026-10-16 04:04:28.726 |
| 最晚提交（严格早于） | **2026-10-16 01:04:28.726** | 2026-10-16 06:04:28.726 |
| 新workload固定ExpiresAt | **2026-10-16 07:04:28.726** | 2026-10-16 12:04:28.726 |

新workload期限为生成后八小时；提交时至少剩六小时。现有环境TTL policy仍7200秒，**这是需要新SHA明确接受的单次人工承载恢复例外**，不修改policy、父Cell标签或旧job租约。旧Janitor保持ENABLED、15分钟扫描，可在到期后删除新workload/日志；不保证准时、必然清理或停费，不自动续期。

## 本次只申请一次写

- Source仅一次CreateStack：`techlong-sandbox-tenant-9c5ee9e64509dcad`，由AWS返回**新的UUID**；准确旧 `863828e0-c8d6-11f1-bd9d-06fff5ad0437` 已删除并保留历史，不能Update或伪作恢复旧UUID。
- 七资源：LogGroup、TaskDefinition、TargetGroup、三条ListenerRule、ECS Service。原Cell/网络/ALB、Aurora、角色/权限、固定Secret版本和既有DNS保持；不新增IAM、不建Cell/库、不改Secret/DNS/DDB/调度。
- 新应用固定 `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，只用C5i已发布UUIDv8修复镜像，不再构建或发布；512 CPU/1024 MiB、一副本、public IPv4。20项参数原值复用，仅镜像/revision、workload期限、恢复Metadata改变。
- 保留旧deployment/configuring、instance/pending、running但lease已过期的原job/attempt1/max1、原desired_plan/plan_hash/artifact_ref、generation1、epoch1；不新建/续租/结束job、不rebind、不写ready，不读Secret值/原私密包、不连Aurora、不POST。新服务健康仍不等于初始化或平台ready。
- CFN `OnFailure=ROLLBACK` / timeout25分钟；一次显式API内部有多项云创建，失败可由提供者回滚或遗留收费资源。新永久槽固定，消费后不自动重试、复位、补齐、删除或回滚；然后必须独立只读Inspect。

完整非原子/并发、回滚/遗留、凭据与提供者日志、旧Janitor、人工窗口例外及费用风险见[固定风险文件](aws-auto-deployment-aurora-dual-mode-c5k-workload-recovery-risk.md)，它已纳入9文件代码/风险闭包，不能审批后修改。约$0.26只是八小时单task计算+task IPv4增量估算，不含既有基础设施和其它用量；50USD/月目标非cap。

## 真实只读结果与完整性

2026-10-15 23:04:16.822–23:04:28.674 CDT：30项显式SDK只读、14条CLI只读、一次Neon单SELECT只读事务通过。当前Source身份、完整CFN/task IAM布局、准确旧七资源删除、原Cell16资源、空闲workload名称/日志/target/active task-definition/listener优先级、新ECR manifest/config/扫描、固定Secret版本、旧Janitor代码及启用调度、Aurora元数据、强一致DDB双namespace和准确旧平台坐标都吻合。模板ValidateTemplate通过，随后仅重渲染期限字段；Run仍验证准确最终模板。未读Secret值或连接Aurora。

新进程本地回读重新计算manifest/observation及baseline，验证9文件/4历史pin、固定写槽不存在；没有更改源码/风险、更新清单时间或伪造新的provider快照。16项定向/相邻测试、types、lint及语法沿用上一提交通过的同一代码，本轮仅补齐真实核验，不重复大量离线测试。

实际云写/平台写/业务写/私密读取/应用调用/永久执行槽消费均0，未调用CreateStack。r1凭据失败和本地Check及全部旧记录保留。有效清单在 `F:/ChatGPT_workshop/techlong-express-c5k-review-20261016-r2/manifest.json`；Git仅保存非秘密摘要/哈希，不包含20项实际参数（其中有publishable key和NoEcho引用）。

- code/history binding SHA：`69a71eafda9ccd49aa2b19104bebeff63a70d00761a500fee3fd8bc17733e8c8`。
- request SHA：`ab4bf26608171e7e2aaca425ae8a76c047868baa398133d5c3dbbf1d42847efb`。
- template canonical SHA：`da254f7c6b5e576024aa1dd882791ff7b5d33ba96290bf09cace584448abaa6b`。
- [完整非秘密准备摘要与四份raw证据哈希](../ops/aws-sandbox/reviews/aurora-dual-mode-c5k-workload-recovery.prepared.json)。

## 如决定执行，需明确确认

> 我确认按清单 `4b194dc34fa44bc23c1999d21363351b14177fd0e57e62bce5726f75c8e95e10` 执行C5k K1：仅一次新CreateStack恢复七项workload资源，接受独立八小时人工窗口例外、旧Janitor保持启用及完整风险；不改IAM/数据库/Secret/DNS/DDB/平台任务，不重发初始化，随后独立只读核验。

上述只是待用户发送的确认文本，文档/代码提交不构成执行授权。超过截止只读核对并另审，不刷新或重放旧批准。获准后仅Run一次再Inspect，不执行任何旧C5h/C5i/C5j流程；成功后才另准备K2。
