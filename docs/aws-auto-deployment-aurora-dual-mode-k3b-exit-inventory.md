# K3b 到期前依赖盘点完成：尚未退出，不等于停费

2026-10-16 **09:20:47–09:21:39 CDT / 14:20:47–14:21:39 UTC**，执行35次受限AWS只读调用、1个Neon READ ONLY事务/3语句；云写、SQL写、应用请求、Secret值/旧私密包读取、直连Aurora、自动重试均0。仍早于原workload固定到期 **今天10:37:01.033 CDT**，不提前宣称自动清理失败或成功。

## 实际资源与退出依赖

| 对象 | 本轮新观察 | 退出/保留边界 |
| --- | --- | --- |
| workload `…/ab4aa8c0-c966-11f1-b068-0ecbbd896a2b` | CREATE_COMPLETE，准确七资源仍在；task definition:3 ACTIVE，1 running/0 pending，目标healthy、三条tenant规则在、日志组保留1天 | TTL不移动。只有准确栈/七资源删除、service/任务归零、目标/规则/日志引用退出等均有新事实，才能证明workload退出；目前未满足 |
| 父Cell `…/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` | CREATE_COMPLETE，16资源仍在；ExpiresAt标签为昨天11:44:56.246 CDT，标签过期并未使其消失 | 当前仍有workload依赖，不能删除；不是旧Janitor的tenant栈命名空间。不把旧标签视为停费机制 |
| ALB `…/77888e84c19e8b86`及VPC | internet-facing/ipv4/active，2子网；3个ENI均有公网IP，其中2个关联ALB安全组、1个关联task安全组；该VPC NAT Gateway为0，分页完整 | workload退出后仍须核对ALB/网络引用，父Cell退出另审。IP归属根据安全组关联分类，不声称这是全账号公网IP清单 |
| 共享依赖 | cluster当前仅1个service/1个running task，均为本workload；ALB仅1个target group；两个listener规则集合与准确DNS alias已记录 | 当前集合分页完整，但不是并发锁、跨服务CAS或永久无其他租户保证。实际删除前仍要fresh核对；不能用当前快照直接执行删除 |
| Aurora `techlong-sandbox-express-d001` | available/PG17.9，1成员；Express网络元数据、MinCapacity0/MaxCapacity1/AutoPause300s | 默认保留已初始化租户数据，不DROP、停用、改角色或重建。这里只读控制面，未查询当前ACU/暂停事实或租户数据，不能据此推算费用为0 |
| 两项固定Secret | runtime `…g1-T9CqN5`、control-public-key `…PfBjiq`仍在，准确版本AWSCURRENT保持 | 只Describe，未读值、轮换、删除或改policy。两项不是全部历史sandbox Secret总数 |
| ECR与日志 | 当前app digest `0dc34eda…`镜像65,418,648字节仍在；workload日志组storedBytes报告0/retention1天 | 保留镜像；该大小不是全仓库或去重存储用量，storedBytes0不是完整日志计费为0；未读取日志正文 |
| Janitor | 原函数Active/CodeSha保持，原rate(15 minutes)调度ENABLED | 未Invoke、改调度或验证未来执行成功；调度开启不等于已删准确UUID，亦不覆盖全部残留 |
| Neon/DDB控制面 | Neon九行完整摘要与K3v相同，active/ready/succeeded/原receipt不变；旧namespace authority准确匹配。表为PAY_PER_REQUEST、读上限100/写上限2 | 新namespace一次读回在本地JSON解析时为UNKNOWN，见下；不能因此宣称全部authority刚刚重验。未把资源预先标记destroyed，任何终态协调另审 |

Aurora元数据另有 `StorageEncrypted=false`、成员 `DBClusterParameterGroupStatus=pending-reboot`，仅如实记录为后续生产化审查项；本轮不重启、改配置、升级plan或扩展安全修复支线。不能把API的`EngineMode=provisioned`字段直接当作当前实例计费模式或实际ACU证明。

## 费用边界：有计费对象，不等于本月现金支出

账号实际 `GetAccountPlanState` 返回 **FREE / ACTIVE**，计划到期为 **2027-01-20T19:58:36.110Z**。本轮未升级账号，未输出或保存剩余信用金额，未读取Cost Explorer/账单/优惠抵扣明细。因此**本月实际费用、剩余预算与这些资源的归因总额均未知**；50USD/月只是用户目标，不是硬cap或已验证的余额。

以下是计费维度，不是本次或月度金额估算，不能将美国东部示例单价套到ca-central-1：

- 运行task的计算计费持续到实际任务终止，而不是ExpiresAt到点；公网IPv4、CloudWatch日志/传输另有维度。[AWS Fargate计费说明](https://aws.amazon.com/fargate/pricing/)
- ALB运行小时/LCU、公网IPv4和数据传输独立于tenant task存在；仅退出workload不能证明ALB这一层也退出。[AWS ELB计费说明](https://aws.amazon.com/elasticloadbalancing/pricing/)
- 保留Secret有存储数量与API调用维度，ECR有存储/流量维度；本轮没有据两个Secret/一个digest算全项目金额。[Secrets Manager定价](https://aws.amazon.com/secrets-manager/pricing/)、[ECR定价](https://aws.amazon.com/ecr/pricing/)
- Aurora Express适用于Free Tier，但账号资格/限制与实际抵扣并未由集群状态或MinCapacity0证明；保留数据库也不是已停费证明。[Aurora Free Tier限制](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-free-tier.html)

上述官方说明于2026-10-16核对；计划类型来自本账号只读API，不是根据官网推测。[GetAccountPlanState字段说明](https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_freetier_GetAccountPlanState.html)

## 单个未知项与本地修正

`authority-1` 是新`tenant:aurora-v2:…`命名空间的准确强一致GetItem；原回执为 **UNKNOWN / SyntaxError**。错误发生在本地CLI JSON处理范围，不能写成云端权限不足、数据不存在或authority发生变更。stdout未保留，因此不能恢复原响应或把原UNKNOWN改成ABSENT。`authority-2`旧namespace一次独立读成功、匹配此前批准记录；不以它替代前者。

AWS CLI的成功空GetItem输出可能没有正文。入口现对**进程成功退出后的GetItem空输出**显式处理为无Item对象，其他空/坏JSON仍失败封闭；新增回归测试。**没有重跑本轮云读取或整组inventory**，原未知记录保留。执行时源码已另存原字节归档，hash `28184e112e680ca6d5b44d8b8cf3db5272122b5c9368dfcf8cf1fbaf6ace5f9e`；当前修正版本及测试另pin，不混淆为已实机执行。此问题也不用于追溯解释原K3r Inspect的未知根因。

[盘点摘要与39份原件hash](../ops/aws-sandbox/reviews/aurora-dual-mode-k3b-exit-inventory.observed.json)包括38份本地观察文件及执行源码归档；K3v六份/K3r二十三份旧原件、旧冻结代码和已消费槽复核保持。5项针对测试、语法及ESLint零警告通过，没有重跑完整构建或镜像工作流。

原件目录 `F:/ChatGPT_workshop/techlong-express-k3b-inventory-20261016-r1`；执行源码归档 `F:/ChatGPT_workshop/techlong-express-k3b-inventory-20261016-r1.executed-source.mjs`。部分历史基础（其它Secret、lifecycle镜像、共享Lambda日志、证书/TrustStore/S3/IAM等）未重新穷举，保留且列为未完整归因，不能称全账号资产账本完成。

## 停止拆分成本支线，回到自动部署主线

本轮“到期前退出依赖盘点”已完成，不新增K3b子阶段、Grant、generation、权限探针或管理入口；到期前重复读取不会得到退出事实。原TTL/调度保持，**没有启动监控、定时回查或预约删除**。

下一主要工作回到无人值守自动部署路径：审核现有worker与本次人工恢复暴露的边界，选出最小真实端到端验收缺口，再按实际代码与资源准备下一范围；不能把人工恢复+ready收口声称全自动验收。后续用户触发工作时，若已经到期，可附带一次准确UUID/物理引用的只读退出确认，不为等期限阻塞主线。

若需要释放资源，仍须fresh单独确认：先证明workload退出及无其他tenant依赖，再准确匹配DNS alias、父Cell UUID/物理引用；最后按外部事实审平台/authority终态协调，保留ready/人工receipt历史。不先标destroyed、不删运行任务依赖的Secret、不批量扫前缀，不使用本次快照直接删除。租户数据库、原初始化数据和历史默认保留；续期、新部署、真实删除或任何权限/数据库写均不在本轮授权内。
