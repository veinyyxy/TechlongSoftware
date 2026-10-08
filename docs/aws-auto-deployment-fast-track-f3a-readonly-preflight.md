# F3a：集中在线只读核验完成，付费部署仍被门禁阻止

最新2026-10-07 Winnipeg：新1ab清单已实际唯一执行成功，双镜像发布/独立字节与扫描核验完成，Source立即Revoke并独立Locked/v6；旧六镜像保留、Cell仍MISSING。CloudFormation实际清理旧policy v3/v4，写前内容已备份，云version ID不可恢复。slot已消费、窗口过期，不重跑。见 [F3a2实际发布和独立证据](./aws-auto-deployment-fast-track-f3a2-ecr-published.md)。F3整体及付费部署仍未完成；以下保留原F3a只读历史，v4/未发布/待批准不是当前状态。

2026-10-07 Winnipeg / 2026-10-08 UTC。完成53项集中AWS读取及补充只读回读、两份候选原始ZIP/收据验证、官方区域价格快照和新的仅镜像发布清单。**没有AWS资源写入、角色登录/AssumeRole、Lambda调用、Neon/源PG连接、baseline上传、ECS/Cell或Worker启动。** 读取API和现有存储不保证绝对零费用。

## 真实在线结果

| 门禁 | 观察结果 | 继续要求 |
| --- | --- | --- |
| Source / publisher | Source CLI login仍可自动刷新；publisher两资源精确回读Locked/v4，现有policy versions为v3/v4 | 新Grant必须从此准确prestate开始，旧批准不重放 |
| Aurora | ca-central-1普通Aurora PostgreSQL16.14 available，非Limitless；db.serverless的aurora storage、a/b/d AZ可用，支持0 ACU | 版本代码不改；真实创建后仍核对session version/TLS/角色 |
| 当前Cell | ECS cluster MISSING、Sandbox RDS列表为空、准确Cell stack does not exist、无ALB | 没有付费Cell，不等于批准创建 |
| authority | table ACTIVE/PAY_PER_REQUEST，max读5 RRU/s、写2 WRU/s；cell/runtime两个准确key强一致读取均无item | 保留旧行；新准入每SQL query前后读activation+epoch，拟议提高读限额到100 RRU/s需单独批准和真实延迟验收 |
| 清理 | Janitor Active但PLAN_ONLY；全局schedule DISABLED，事件仍为inspect_cell_cleanup_plan | 必须实现并在线证明owned-resource可执行TTL/失败清理；不能只开flag或手动babysit替代 |
| 证书/mTLS/DNS | 只有api.techlong.cloud证书，无Sandbox wildcard；trust store为空；AWS hosted zone为空；NS为Namecheap registrar-servers.com | 不改现有api证书/主域；新wildcard、CA/client、trust store和DNS按准确范围另批 |
| lifecycle IAM | 当前inline只有generation Secret读与immutable receipt；shared ServiceRoleBoundary v3被7个role用作boundary | 新baseline/admission作用域缺失；建议新专属boundary，避免静默扩大7个共享role权限 |
| 服务关联role | ECS/RDS role已有；ELB的AWSServiceRoleForElasticLoadBalancing为NoSuchEntity | 任何自动或显式创建都需列入新范围 |
| Budget | Sandbox tagged预算仍10USD；Environment cost allocation tag ACTIVE；当时tagged ActualSpend约0.002USD | 50USD只是当前方案目标；线上预算调整另批，计费数据有延迟、非硬断路器 |
| baseline/root | baseline bucket尚未存在；私有73表baseline未批准；新root候选尚未ECR发布/注册 | 逐项新批准；不能复用旧40b1ce6 root作为已准入新入口 |

纯数据 `compileFastTrackF3Readiness` 的结果是 `F3_PREFLIGHT_BLOCKED_REVIEW_ONLY`。报告、mode字段、价格估算和候选通过均**不是部署批准或运行capability**。默认Worker仍disabled。没有声称IAM simulator或本地PG验证等同真实跨系统lease/TTL/cleanup。

## 原始候选已保存，未运行本地Docker

实际GET下载并核验[候选run37702693753](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37702693753)，source `19cc3e096df4d37be0a6570ce3116d47c472ace2`。元数据绑定main/source/run/attempt；精确ZIP文件清单与无symlink/大小边界、ZIP SHA、receipt bytes SHA、三个SHA256SUMS、selfCheck与OS scan均通过。GitHub认证仅进程内读取，不写token/临时签名URL到文件或日志；不把认证头转发blob host。

- app artifact11518805418：ZIP `8e2a9499479f7a906a5fa93f2278fcedddba07cf0cda5fe9dbca6db52aceeca5`；receipt `3045edb91d97f3941d7f21a9527661fddc0ae19f913ca42f4ed9493bbd5ff186`。
- lifecycle artifact11518715844：ZIP `4788ac20ab98edf2185296ed0ee1ba0be0b41be551d35394eb8844a208316574`；receipt `55461648da1d7a265a36343a0651f9a832c164bc6aab7a1d3cc174c12eb0fb8a`。
- 两份原ZIP、image.tar.gz和小收据在私有 `F:/ChatGPT_workshop/techlong-f3-artifacts-20261008-a1`；不提交Git。验证报告SHA `a04520ddfe02c4f56d4192e422849aa7038cf0adf088cd4552a3d29ec7e88f5b`。

本地没有Docker load/容器重跑，也没有新registry digest证明。GHA真正发布前仍会重新下载原ZIP、校验并Docker load准确config；到期不能从本地副本自动延长GitHub promotion批准。原artifact截止约2026-10-08 18:31CDT，原image config不是registry digest。

## 50USD目标与准确区域估算

官方ca-central-1 price list原文件和选中SKU已保存：`techlong-f3-prices-20261008-a2`，selected-prices SHA `0fd13088c414b48f5a309b9f494921e58cdf0b76f7e18991c200b62495840db8`。此前URL缺少aws路径导致的空a1目录保留，不作为价格证据。[AWS price-list读取方法](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html)

使用Linux/X86 Fargate0.25vCPU/0.5GB一个应用task、ALB一个used LCU、一个关联mTLS trust store、三个public IPv4和Aurora峰值1 ACU：CPU0.04456USD/vCPU-h、memory0.004865USD/GB-h、ALB0.02475USD/h、LCU0.0088USD/h、trust0.0055USD/h、IPv40.005USD/address-h、Aurora0.14USD/ACU-h。

推算核心小时费用约 **0.2076USD**。名义Cell TTL3h，按4个计费小时留部分小时/缓冲余量，再加8个各2分钟的一次性task，核心费用约 **0.84USD**。这**不是完整验收总价、承诺上限或执行授权**：不含存储、I/O、备份、传输、Secret、S3/ECR、DDB、日志、Lambda/Scheduler、税和清理超时。实际创建前仍需要准确资源清单和单次验收范围。

若730h常驻、数据库持续活跃0.5–1ACU，同组核心费用估算 **100.46–151.56USD/月**，同样未含额外费用；所以沿用50USD目标时只应执行短TTL验收，而不能宣称此架构全年常驻在预算内。auto-pause不保证应用连接存在时一定归零。[Fargate](https://aws.amazon.com/fargate/pricing/)、[ALB](https://aws.amazon.com/elasticloadbalancing/pricing/)、[Aurora](https://aws.amazon.com/rds/aurora/pricing/)、[IPv4](https://aws.amazon.com/vpc/pricing/)

DNS最快的自动化方向建议：只将 `sandbox.techlong.cloud` 委派到一个新Route53公开zone，主域和api.techlong.cloud保留Namecheap。需要一次人工NS设置和新zone/特定记录权限批准；不是本阶段创建授权。前25个zone每个0.50USD/月，按月非按天比例，额外查询另计。[Route53价格](https://aws.amazon.com/route53/pricing/)

## 第一项fresh审批：仅新root镜像发布

清单 `8081815c08436a219d1701867bcaf9f16d19bfb0437c66270bee52822163a8c2` 已本地验证并Source-only ReviewOnly回读，**尚未执行、没有安装Grant、没有dispatch**。

- 仅UPDATE准确stack `techlong-sandbox-github-image-publication` 的既有 `TechlongSandboxGitHubImagePublisherBoundary` 与 `TechlongSandboxGitHubImagePublisherRole`；不创建/替换role、boundary、stack或OIDC provider。前置default v4、版本库存v3/v4、sole inline、attached0、Deny-all boundary/inline/trust和两资源inventory全部绑定。
- GHA main手动workflow只调度一次，发布app/lifecycle两个source19cc3e0固定tag，读取registry/config digests与BASIC scan；不能重建镜像。保留旧tag/image，HIGH/CRITICAL拒绝后续ECS。
- 成功/失败后Source立即Revoke并独立Locked核验；无自动write retry、slot reset或过期重放。Source CLI login自动刷新但outer session未独立证明，撤权失败需立即处理，不能承诺永远可刷新。
- 接受CloudFormation在UPDATE/Revoke中可能清理旧非默认managed-policy版本，包括变成非默认的v3/v4；新控制器在任何写前保存每个pregrant版本原件。备份保留内容，**不能恢复被删云version ID**；IAM资源、旧模板/批准/执行证据和镜像保留。
- 不部署ECS/Cell、不上传baseline、不安装TaskRole/authority/DNS/证书/Janitor/Budget、不主动删除其他资源；低成本但非绝对零费用。

安装截止 **2026-10-08T02:00:00Z = Winnipeg 10月7日21:00CDT**；权限/发布截止03:00Z = 22:00CDT。UTC字段明确保留String，实测PowerShell7.6.6解析不会被本地时区延长；备份结束后再次检查安装cutoff。过期需人发起新只读刷新和新SHA确认，不自动续窗。

当前清单升级schema3；已消费 `15d30e5...` 完整原件移入Git history并验证原SHA不变，ce32/c9及旧grant/revoke、私有slots都保留。旧schema2/v2前置不再作为可执行当前计划。

## 验证与继续位置

9项publisher边界/历史保留/时钟测试、3项F3诊断/价格测试、65项prepared-v2相邻回归、两仓typecheck、定向lint和PowerShell AST/实际UTC解析通过；真实在线核验不以这些测试代替。新publisher源码 `9b949585f4ad1c76c5472c3d2c505f5d3dca4155` 的[完整Backend CI37711547220](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37711547220)已实际success；本阶段未运行会写ECR的manual workflow。

AWS原始53-read证据SHA `4c86ce0f1ddb53092c17f399a981b80226f1420b7e21948dff09d7013f26710c` 保留：首版输出有字面换行trailer、空数组被PowerShell枚举为null的格式问题，collector已修正。独立normalized副本和RDS空列表重读/SLR补充都保留；不覆盖原件。最终只读reconciled评估SHA `0cf5b2ccf55c41bfb7c6438b183a8f1b4eeba32578ecf69f41ee3114c653a167`，`deploymentAuthorized=false`。缺失Cell/baseline bucket不是读取成功门禁；角色不存在和资源缺失已补充精确只读检查。

等fresh镜像确认后才能执行该窄范围。并行下一代码切片应优先补可执行、精确owned-resource TTL/失败清理，随后是专属IAM/baseline/read-capacity/Budget、wildcard与mTLS/DNS基础的准确审批材料；付费Cell仍最后批准。安装runtime record/Neon ownership行、PUBLIC CONNECT硬化、真实metadata/卷/CA/lease/cleanup和mTLS/control/HTTP ready均未在线完成，**F3整体尚未完成**。
