# C5h2：统一 Review / Run / Inspect 入口与执行风险

承接 C5h1；F3c9 保持封存。不 rebuild/ECR/restore/seed/grant，不升级 Aurora plan，不更换现有数据库或父 compute，不先创建 job 再补代码。代码提交/推送沿用常驻授权。**本页不是批准；实际 Run 必须使用完整 fresh manifest SHA 单独确认。**

## 三种现场模式和一个本地检查

`ops/aws-sandbox/scripts/review-express-live-delivery-v2.mjs`：

- `Check --output F:/ChatGPT_workshop/techlong-express-c5h-check-NEW` 只解析非秘密来源和完整本地 import/require 闭包；没有凭据解析、网络、SQL、原私密文件或槽消费。
- `Review --output F:/ChatGPT_workshop/techlong-express-c5h-review-NEW`：仅 Source 只读元数据（最多55 SDK、20 CLI、一个 Neon readonly snapshot、一次公开 NS 查询）。准确比较 CFN v8、task roles/shared v4、trust/inline/attachments/consumer 布局、两固定 Secret 版本、原 compute UUID/16资源/模板/outputs、网络/ECR/DNS和两 DDB namespace。无模拟、Aurora连接、Secret值、私密包、槽消费或任何写。任一不符停止，不增权补齐。
- `Run --manifest .../manifest.json --approved-sha <fresh SHA> --output F:/ChatGPT_workshop/techlong-express-c5h-run-NEW`：严格校验全清单、风险文档、完整源码/依赖/历史闭包及15分钟入场有效期。旧 SHA、代码变化、已消费根槽或前置 SQL 槽均在 SQL/私密读取前拒绝。之后才启动 C5h1 的受限单次闭环。
- `Inspect` 同参数，仅独立 Neon 只读事务、DDB/CFN/ECS/ALB/DNS metadata；无 Aurora/私密读取/写或槽消费，不要求旧入场窗口仍有效。它证明当前平台 ready/active/succeeded、原部署UUID、实际 ECS task image/固定Secret refs、target健康及准确A alias（允许AWS尾点/dualstack名称规范化），**不重新调用 initialized API**，因此单独运行不冒称刚完成数据库业务初始化。

所有输出目录必须是 F:/ChatGPT_workshop 下的新目录，不覆盖旧记录。原 C5c/C5d/C5e/C5g 的批准/槽和执行脚本不重放。冻结 C5c Inspect 中八条 SELECT 的 SQL 内容只作为本次新批准的只读程序来源，不执行其旧 Run/INSERT。上述55/20预算及回执计数是本脚本显式SDK调用/CLI命令数，不是CLI分页、登录自动刷新等全部底层网络请求的精确计数。

## 准确写入与私密范围

拟最多：Source 云写3次（DDB条件事务、一个七资源CFN CreateStack、准确域名A alias CREATE）；Neon写事务10次（首次六行追加、epoch激活、六次状态迁移、schema接纳、最终ready原子提交）；provision POST1次；原JWT/mTLS本地loader1次；operator读取固定四键runtime Secret值1次。CFN再以既有role创建七项资源，ECS分别注入固定Secret refs。**0 IAM写、0 SQL业务写、0 restore/migration/seed、0镜像发布、0父栈续期、0脚本清理。**

另有最多两次 Source-postgres IAM/TLS只读连接：认领前、bootstrap后各一次，每连接正常12条（READ ONLY BEGIN、search_path、lock_timeout、八SELECT、COMMIT），失败最多一次ROLLBACK，无重连/重试。验证完整既有catalog/role/ACL/73表count digest、原guard comments、准确默认店铺及 pristine singleton/八默认entitlements；返回非秘密digest/布尔值。使用 Source postgres 不证明 task-role 登录；后者仍由真实应用 bootstrap 检验。

所有连接使用固定原 endpoint、准确物理OID、ATS根证书/hostname验证；IAM token仅内存、对实际postgres服务端发送。Neon URL从.env.local解析后只交给Neon HTTPS adapter，不写入环境变量、子进程参数、Aurora配置或输出。原私密包的八字段会进入旧loader内存，只暴露JWT/mTLS来源；payment来源不外传。秘密字符串的内存清理是尽力而为，不能保证GC/提供者日志/进程转储中无残留。

## 时间、失败与费用风险（完整接受后才可 Run）

1. 原父 `CellExpiresAt=2026-10-15T16:44:56.246Z` 已过期，不改日期或续期。新的child两小时是**独立范围**，必须在本次清单具体确认。标签不是费用停止器，没有自动cleanup；旧资源和失败遗留继续计费。
2. 50 USD/月是目标而非硬cap。CloudFormation OnFailure=ROLLBACK 可以删除本次新建的资源；脚本没有任意DELETE权限，也不自动修复/重新部署。服务传播、provider更新、并发、跨服务非CAS和部分失败都可能产生遗留费用。
3. 准确源码闭包、固定原始SQL、当前元数据和条件事务不能消除管理员并发变化；独立只读回读也不是云/Neon/Aurora的统一事务。首次 running job 只有一次attempt/max1和最多1小时租约，执行内核最多55分钟，不自动续租/排队。
4. 每项副作用和两次SQL连接在尝试前消费固定永久槽，失败也保留；不自动删除、复位、补齐、回滚业务或重试。根路径不因新SHA或时间窗而变化。本地journal不能抵御管理员删除/篡改、文件系统故障或跨服务竞态。
5. 任一响应丢失都可能已经提交；仅返回 inspect-required，不重发DDB/CFN/DNS/POST/SQL提交。最终实例active、部署ready、任务succeeded同一 SERIALIZABLE 事务提交；后续独立核验失败仍不是成功回执，不重复ready写。
6. 私密JWT/mTLS、固定Secret、首owner派生密码会进入内存；第三方/服务端日志与TLS/IAM连接仍有暴露风险。只允许准确 HTTPS8443控制端点和固定 AWS/DB/Neon服务；不输出密码、JWT、Secret值、PG URL或完整业务payload。
7. 两次只读 Aurora 连接也可能唤醒实例并收费。没有升级 plan、免费资格保证或账单自动拦截；核对现有Express metadata不等于保证免费。

## 费用估算基线（2026-10-15，只作计划，不是账单/上限）

公开AWS Canada Central Price List已读到：Fargate Linux/x86 vCPU 0.04456 USD/h、GiB内存0.004865 USD/h；ALB 0.02475 USD/h、关联trust store0.0055 USD/h、LCU0.0088 USD/LCU-h。公网IPv4每地址0.005 USD/h。

本次新任务0.5vCPU/1GiB/一个公网IPv4：**0.032145 USD/h，运行两小时约0.06429 USD**。既有ALB/truststore/两个公网IPv4底座约0.04025 USD/h；合计两个小时约**0.14479 USD**，不含LCU、Aurora、logs、流量、存储、DNS、Secret、税费或临时滚动多任务。730小时常驻这两项即约**52.85 USD/月**，不能承诺50USD内。独立两小时时间标签不会使上述运行在两小时后自动停止。

标准Aurora PostgreSQL Serverless v2加拿大参考价为**0.14 USD/ACU-h**（当前配置Max1，Min0/300秒autopause，Review严格核对且不修改）；若按1ACU持续两小时作参考，再加0.28 USD，上述参考基础合计约**0.42479 USD/两小时**，仍不含其他按量项。此标准价格不是本账户Express/free-plan实际适用费率或账单查询，不升级plan、不假定免费。价格源：[加拿大RDS价表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ca-central-1/index.json)，publication 2026-10-06T22:40:50Z。

价格来源：[加拿大Fargate公开价表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ca-central-1/index.json)（publication 2026-09-11T12:44:25Z）、[加拿大ALB价表](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ca-central-1/index.json)（publication 2026-09-11T12:45:44Z）、[公网IPv4](https://aws.amazon.com/vpc/pricing/)。额外收费维度见[AWS Fargate](https://aws.amazon.com/fargate/pricing/)、[Aurora收费说明](https://aws.amazon.com/rds/aurora/pricing/)。公开价表不是当前账户免费资格或账单查询，不把美国区示例费率冒充加拿大报价。

## 结果记录

本轮70项相关测试（8项新增）通过；类型检查、所改代码ESLint及本地完整构造检查通过。首轮真实只读Review为30次显式SDK/13次CLI/1次Neon snapshot/1次公开NS查询，Aurora/Secret值/私密包/写/槽消费均0；其后完善了完整plan重派生、template validation、RDS伸缩检查及最终provider回读，因此首轮SHA仅历史、不可执行。最终新SHA与实际证据另见后继审阅记录，不在本风险文档回填，以免修改已绑定风险。没有实际部署批准前，本页和所有Check结果均不是部署证明。新增SQL观察器尚未实际连接，Neon首次认领/ready也未真实提交，不能用单测声称已证明这些在线提交。
