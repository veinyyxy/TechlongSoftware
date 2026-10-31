# RDS停止/启动与ELB删除/重建工具

2026-10-31。最初按用户要求仅交付代码、合成测试和文档，未运行入口；用户随后明确要求执行停止工具，并另行同意暂停prod实例。本轮实际运行记录见下节，不能再把最初“未调用”的事实当作当前状态。部署与验收主线未设置暂停，旧事实/批准/TTL不延期。

## 本轮实际停止（2026-10-31，结果核验中）

区域`ca-central-1`，账号402010193138，执行源码`0fe85e5a0949d7a5b5e4272e27c4f8c8eaff3315`。先只读核对发现样例的techlong-sandbox-cell-sandbox-1数据库集群已不存在，本轮没有向该目标写入。实际目标为Aurora集群`techlong-sandbox-express-d001`、独立实例`speedfeast-postgres-prod`（用户本轮准确同意）、ALB `techlong-sandbox-cell-sandbox-1`及`techlong-sandbox-platform`。两ALB标签/准确ARN已核对、删除保护均false，本轮没有改保护、IAM或CFN/DNS/ECS。

本地执行配置`F:/ChatGPT_workshop/techlong-aws-cost-stop-20261031-a.config.json`，明确记录本次删除ALB导致的CFN漂移及后续新ARN/DNS绑定影响。实际恢复备份目录 **`F:/ChatGPT_workshop/aws-cost-backup-20261031-a`**，snapshot保存3个监听器/1条非默认规则、证书和mTLS引用、全部属性/标签及两个数据库原运行状态；ACL仅当前用户/SYSTEM/Administrators。snapshot raw SHA `b64c8e29ff9aa8885180cbdc59988517815d12e20e6d1319b50956ae47c793df`，journal绑定的规范摘要`f2226a0262b9fc1900f3aba60fee1160b627ba46bdf265fc6020421918d760cc`已独立本地核对。

12:26:47 CDT备份落盘后，StopDBCluster1、StopDBInstance1、DeleteLoadBalancer2均获ACK；独立只读查询随后确认本区域ALB列表为空、两个数据库均stopping。**还不能把stopping当作stopped或声称全账号零费用**，工具正在等待最多900秒的只读确认，不重发写请求。没有数据库/快照删除、业务或部署操作、自动联动安装或恢复。

两个ALB已实际删除，旧ARN/DNS不能原样恢复；后续可使用这个备份重新创建并单独核对CFN/DNS引用。本次没有停止ECS等其他收费资源，RDS存储/备份也仍可能收费；自动到期停用/恢复联动尚未接好，不能宣称它已启用。

## 两个入口

| 工具 | 显式执行后做什么 |
| --- | --- |
| `scripts/aws-cost-stop.mjs` | 精确核对账号及配置目标；先保存可恢复的ALB配置，再停止指定RDS，删除指定ALB；只读轮询确认状态 |
| `scripts/aws-cost-resume.mjs` | 读取同一备份，启动之前由本轮停止的RDS，重建ALB/监听器/规则/属性/证书引用，回读核对并输出新旧ARN/DNS映射 |

默认是**离线预览**：只读本地配置/备份，不查询AWS；不是AWS服务端dry-run，也不是当前资源盘点。只有同时给出`--execute`及`--confirm-account`才允许访问AWS并写资源。程序不导入SDK，不读取`.env`、数据库密码或PEM，不连接数据库；实际运行时使用现有AWS CLI profile。

依赖：Node.js 22.13+、AWS CLI v2（需要支持listener attributes与rule transforms）；Windows实际执行时使用PowerShell 7限制备份目录ACL。无需安装Docker或新npm依赖。

## 配置：显式资源，不扫描整个账号

参考[配置样例](../ops/aws-resource-power/config.example.json)。样例中的账号、区域和资源名来自工程历史，**没有重新在线验证**，不是现在仍存在的证明。运行前复制为自己的本地JSON，核对/修改目标；不要把凭据放进配置：

- `rdsClusters`：Aurora集群标识符。集群成员不能再列入`rdsInstances`；停止/启动以整个集群为单位。
- `rdsInstances`：独立RDS实例标识符。加入清单的实例都会被处理，不依赖名称模糊匹配；不支持带读副本、集群成员、RDS Custom或SQL Server Multi-AZ等不可停止的拓扑。
- `loadBalancerArns`：准确Application Load Balancer ARN。本版支持本项目ALB；Classic/NLB/GWLB拒绝，不会猜测后继续。
- `acknowledgeCloudFormationDrift`：默认false。ALB带CloudFormation标签时，必须明确改为true，接受下文的管理状态漂移，才允许删除。
- `allowDisableDeletionProtection`：默认false。只有明确改为true才可在删除前关闭目标ALB的删除保护；重建最后恢复备份中的原值。删除失败可能遗留已关闭保护的原ALB。

仅配置中明确列出的RDS和ALB受影响；没有“全账号全部删除”开关。RDS只有stop/start操作，代码的AWS写入白名单**不包含任何数据库删除、快照删除、IAM、CloudFormation、DNS或ECS修改**。

## 使用方式（仅供以后自行执行，本次未运行）

在工程根目录操作。`F:/ChatGPT_workshop/my-aws-cost-config.json`为你核对后的配置，`F:/ChatGPT_workshop/aws-cost-backup-001`必须是一个尚不存在的新目录。

先预览；这两条命令不访问AWS：

```powershell
node scripts/aws-cost-stop.mjs --config F:/ChatGPT_workshop/my-aws-cost-config.json --state F:/ChatGPT_workshop/aws-cost-backup-001
node scripts/aws-cost-resume.mjs --state F:/ChatGPT_workshop/aws-cost-backup-001
```

第二条预览须在第一轮实际stop已产生备份后才能读取。stop预览不会创建备份。

将来确实决定停止/删除时，才显式执行：

```powershell
node scripts/aws-cost-stop.mjs --config F:/ChatGPT_workshop/my-aws-cost-config.json --state F:/ChatGPT_workshop/aws-cost-backup-001 --execute --confirm-account 402010193138
```

将来恢复使用**同一个备份目录**：

```powershell
node scripts/aws-cost-resume.mjs --state F:/ChatGPT_workshop/aws-cost-backup-001 --execute --confirm-account 402010193138
```

AWS CLI不在PATH时，可附加`--aws-cli "D:/Amazon/AWSCLIV2/aws.exe"`。默认只读等待最多1800秒；`--wait-seconds`范围0–7200，重建ALB必须大于0。stop设置为0仍会做一次只读检查；未完成时返回`STOP_SUBMITTED_NOT_VERIFIED`和退出码2，不声称已停止/停费。读取轮询不会重发写请求；实际请求可能因AWS延迟超出等待期。

## 备份、恢复和不可恢复的标识

stop在任何云写前完成全部预检并将`snapshot.json`、摘要和`journal.json`落盘。备份包含ALB子网/安全组/类型、IP地址类型、标签、属性、监听器、默认动作、mTLS trust store引用、完整规则/优先级/transforms、证书ARN及附加证书；不导出证书私钥。目标组及其注册目标不删除，恢复时必须仍存在。

恢复会重新创建ALB、监听器及规则，并独立回读配置核对。新旧ARN、DNS和HostedZoneId及监听器/规则映射保存在`journal.json`的`mapping`中。ALB名称尝试沿用，但**原ARN和DNS名称无法保证保留**，名称被其他资源占用时拒绝覆盖。原资源在停止前已处于stopped的RDS不会被恢复程序擅自启动；若AWS已自动启动，则跳过重复start。

**重建ALB不等于整个系统自动恢复：**

- 原ALB若由CloudFormation管理，直接删除会造成drift；创建同名新ALB不会更新原Stack的PhysicalResourceId或Outputs。该工具不删除/更新整个栈，尤其不触碰同栈RDS。
- 原Route53 alias、直接使用旧ALB/listener ARN的其他系统、外部WAF/Global Accelerator等关联，需按新映射单独核对/修复。工具不自动改这些绑定，不宣称应用已恢复；输出`applicationRecovered:false`。
- 原subnet/security group/目标组、证书、trust store、日志桶等依赖必须保留。OIDC客户端秘密无法由Describe API导出，遇到该配置会在任何RDS/ALB写入前拒绝删除；不会备份不全仍先删资源。
- 直接重建与其他AWS/部署操作不是跨服务原子事务，不要同时运行部署、修改profile或编辑这些资源。存在正常的并发和非原子风险。

## 费用与数据边界

RDS数据保留，不删除实例/集群/快照。RDS和Aurora停止最多7天，随后AWS可能自动启动；本工具不安装定时器或后台持续停库服务。停止状态仍有存储/备份费用，且ECS、其他ALB、IP、Secret、S3等资源可能继续计费，不能保证账号费用归零。参阅[AWS RDS停止限制](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html)、[Aurora停止/启动](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-cluster-stop-start.html)。

删除ALB也会删除其监听器及规则，但不会停止注册目标/ECS实例或删除目标组；这正是为什么工具先保存配置且保留目标组。参阅[AWS DeleteLoadBalancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/APIReference/API_DeleteLoadBalancer.html)。不新增为此服务的收费资源或自动清理其他资源。

## 失败处理与权限

- 所有目标预检、完整备份持久化必须先于第一次云写。账号/区域不匹配、不可停止的RDS拓扑、OIDC、删除保护未确认或CFN漂移未确认，均不进入写入。
- 每次写请求发出前，先在journal记录`SUBMITTING`；成功ACK后记录`ACKNOWLEDGED`。错误/网络未知记为`UNKNOWN_OR_REJECTED`，停止后继动作，不自动重试、回滚、补齐或再次Create。
- stop备份目录禁止复用；resume只允许一次尝试。有`.running.lock`时拒绝并行。进程被强制关闭可能留下锁和部分资源；先核对进程、journal与准确AWS资源，不直接删除锁后重跑。
- 即使某步失败，前面已接受的RDS停止/启动或ALB操作也不会自动补偿。完整恢复前不要删除备份；本机目录受限且带完整性摘要，但不是防管理员恶意改写的签名证书。
- 权限由使用的既有profile提供；工具不安装/扩展IAM。所需API精确白名单在[CLI适配器](../ops/aws-resource-power/cli.mjs)，仅STS身份、RDS describe/stop/start及ELBv2 describe/delete/create/modify/listener/certificate/rule操作；没有Secret读取或数据库数据访问。

## 本次验证

使用`node --test tests/aws-resource-power.test.mjs`运行合成AWS端口/本地临时文件测试；对两个入口只做语法检查，**不调用入口、不启动AWS CLI或访问账号**。测试覆盖备份先于写、完整分页、RDS保护、OIDC拒绝、mTLS/证书/规则恢复、新旧映射、回读差异、未知提交不重试、默认离线参数、API白名单与本地锁。合成通过不代表真实AWS权限或线上恢复已经验收。

本次结果：22/22测试、定向ESLint零警告、`npm run typecheck`及两个入口语法检查通过；既有部署111文件闭包仍为`9f6ceb7ccca8ee542bf8cab4ec120ab79571d20fd97356ddbaa831b58e4c745b`。未改package依赖、受保护workflow、IAM或部署运行模块；没有运行实际stop/resume、没有云端CI/真实AWS验收证明。
