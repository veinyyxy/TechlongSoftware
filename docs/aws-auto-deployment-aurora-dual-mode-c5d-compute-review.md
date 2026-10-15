# C5d：Express 计算层退役/创建执行包（待批准）

> **历史审批包，已于2026-10-15执行完成。** 用户确认7a0c636b…后，准确旧失败栈已DELETE_COMPLETE；新16资源栈`b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`独立核验通过，ECS ACTIVE且任务/服务0。三槽永久消费，不得重跑以下Run命令或复用此批准删除新栈；费用继续产生，ExpiresAt不是停费机制。以[已执行结果与唯一继续点](./aws-auto-deployment-aurora-dual-mode-c5d-compute-executed.md)为当前状态，以下待审文字仅保留原范围和风险，不再是待执行授权。

2026-10-15 America/Winnipeg。继续[默认店铺已完成后的部署主线](./aws-auto-deployment-aurora-dual-mode-c5c-store-seed-executed.md)，不再动SQL、重发镜像或扩展F3c9。真实Review通过，18项相关测试（新增7项）、types和定向lint通过；**本轮云写入、Aurora SQL连接、AWS Secret值/私密bundle读取及新执行槽消费均0，尚未部署。**

## 本次准确范围：最多两次直接 CloudFormation 写

1. 一次STANDARD `DeleteStack`，只退役准确旧失败栈：
   `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/ede4f290-c758-11f1-8050-06ffda7a3477`。
   fresh核对原25资源模板hash、原role/tags及20条出现physical ID的历史记录全部DELETE_COMPLETE；不ForceDelete、不RetainResources、不删除公钥Secret或外部Express数据库。
2. 旧UUID到DELETE_COMPLETE且名称/服务命名空间独立查空后，一次`CreateStack`，复用名称`techlong-sandbox-cell-sandbox-1`和现有Cell执行角色，只创建16资源：VPC、IGW/attachment、两公共subnet、路由表/默认路由/两关联、两SG、ECS cluster、ALB、两个HTTPS listener和业务控制路径deny rule。

新模板**没有RDS、IAM、Secret、Lambda/Scheduler、NAT/endpoint、TaskDefinition、Service/RunTask、DNS或自定义/nested stack**。现有Express库、应用角色、固定版本四键Secret、默认店铺及已发布镜像保持。此步不登记owner/epoch、不改Neon、不开job/TTL、不读取私密bundle或Secret值，不是完整ready。

独立Express入口不复用/放宽原Full25资源apply brand。实际Run重新渲染并逐项比较模板/参数/标签/完整代码binding；不接受任意模板或ResourceTypes/Capabilities覆盖。只有上述两个写命令，SDK maxAttempts=1，无写入重试或自动补齐。

## 最新只读事实

UTC2026-10-15 13:45左右的最终Review确认：

- Source仍是准确Account402010193138/IAM user；现有Cell RoleId `AROAV3GNMXTZESNMKM56K`、boundary PolicyId `ANPAV3GNMXTZL4VMJHXXZ`/默认v1、完整trust/inline/boundary/tags/session/无attached policy均保持原安装。
- 原ECS/ELB服务关联角色已存在，校验准确path/service trust并记录RoleId和trust hash，不需要创建新service-linked role。
- 旧栈仍ROLLBACK_COMPLETE、原template SHA `4d0061be99e0df1e51993f875596d00913aefe609c21a3432d4a7241431e8077`、20条物理记录DELETE_COMPLETE；目标CellId VPC与准确名称ALB为0；ECS保留INACTIVE、running/pending/services均0，不能把它叫作API不存在。
- 现有证书ISSUED/SAN匹配，有效至2027-04-26；现有Control TrustStore ACTIVE，ca-central-1a/b可用。
- Source准确旧UUID删除、创建namespace、PassRole、未来删除namespace四项模拟allowed且无missing context。模拟不是实际provider或未来清理成功证明，没有安装IAM。
- 当前Neon/DDB只读核对仍deployment/job/resource/operation均0、两套authority key缺失。历史已批准seed证据及15文件hash均匹配；本次不重新连接Aurora验证seed，不把历史证据当作当前SQL或ownership证明。
- AWS ValidateTemplate接受真实16资源模板及四参数，无IAM capabilities。它不保证容量、配额、实际provider权限或部署成功。另读本区域Listener provider schema，仅用于核对create/read/delete依赖，不据可选Cognito声明安装额外权限。

本轮两次成功Review（r1为中间实现、由最终r2取代），共57次AWS资源只读API调用，含预期not-found、2次ValidateTemplate和1次DescribeType；Neon只读SELECT2、官方公共价格GET5。底层凭据HTTP另计。没有任何云资源、数据库或权限写。

## 当前审批清单

- SHA：`7a0c636b741e1cc0af068046c052f1f09a6dd1bc8f0a62b539f3be609f245423`。
- 截止：UTC **2026-10-15 15:44:56.246** / Winnipeg **2026-10-15 10:44:56.246 CDT**；实际创建前还须距deadline标签至少1小时。过期仅刷新只读清单，不续用旧批准。
- Cell ExpiresAt标签：UTC16:44:56.246 / Winnipeg11:44:56.246。**只是标签，不会自动删除或停费。**
- 目录：`F:/ChatGPT_workshop/techlong-express-c5d-compute-review-20261015-r2/`；manifest、template、两请求、facts/control-plane、code-binding、validation、result均保存。
- template SHA：`e32eae43616dfcef7eb6825a55a86eebedb8e8d2e01ba4f775592b2f80fcb892`；53个本地源/依赖锁/已执行seed capsule的LF规范化pins，code SHA `d05691bf55051b8a358db842dc55892f3d1ab3b9f2bff0fce27a39e7e1167800`。
- 新永久槽：`techlong-express-c5d-compute-run-v1`、`techlong-express-c5d-old-stack-delete-v1`、`techlong-express-c5d-compute-create-v1`各`.permanent-slot.json`，目前均未消费。旧foundation、seed和所有历史槽保留，不复位或重放。

[版本化准备摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5d-compute.prepared.json)保存精确证据hash，但不替代完整manifest或用户批准。

## 区域费用与50 USD目标

UTC13:30从AWS官方ca-central-1公开目录实际读取并保存原始feeds/选定SKU，未假定任何免费credit：

| 新计算层计费项 | USD/小时 |
| --- | ---: |
| ALB | 0.02475 |
| 一份关联TrustStore | 0.00550 |
| 假设两个ALB公共IPv4 | 0.01000 |
| 基础合计 | 0.04025 |
| 额外1 LCU情景 | 0.00880 |

若确实仅运行3小时后完成实际清理，新增网络基础约 **0.12075 USD**，按1 LCU情景约 **0.14715 USD**；不是单次费用上限或实际账单，小时取整/部分遗留和其他用量可增加费用。持续730小时网络基础约29.38 USD，未含LCU。

后续**尚未授权**的0.25vCPU/0.5GB Linux任务加一个IPv4，约0.0185725 USD/小时；连同基础网络/1 LCU，730小时约49.36 USD，**还没计数据库和其他费用**。若再按持续1 ACU的标准Serverless v2区域价格情景计算，约151.56 USD/月。Express实际资格/credit、实际ACU和流量会影响账单；不能把这个情景称为当前账单或保证月费。

因此当前是短期首轮验收路径，不承诺常驻整体≤50 USD/月；到期标签和Budget告警都不是消费硬限额。不在本轮安装自动销毁；实际新栈清理仍需准确UUID/fresh单独审批，批准前会继续计费。

原始价格证据在`F:/ChatGPT_workshop/techlong-f3-prices-c5d-20261015-r1/`，selected文件SHA `95fa9ad53f823b6f0c46f9ff46a449cdc9f5bf12dc2add5cd939d9eb5726720f`。官方来源：[ALB/TrustStore/LCU区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/current/ca-central-1/index.json)、[IPv4区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/ca-central-1/index.json)、[Fargate区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/ca-central-1/index.json)、[Aurora区域目录](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/ca-central-1/index.json)。不含现有资源、Secrets/存储/I/O/备份、日志/DNS、额外IP/LCU/传输和税。

## 完整执行风险与清理预案

1. 旧Stack UUID被删除后不可恢复。20条DELETE_COMPLETE是CFN历史记录，不是所有底层服务对象或账单为0的独立证明；名称、标签库存/状态是有时限的读取，不是CAS。
2. 旧栈退役和新栈创建非原子。退役成功但创建前过期、权限变化或本地故障，可能只完成退役；创建响应丢失或持久化失败也可能已有收费对象。任何阶段失败均不重试写、不自动补齐、换名、复位或回滚已完成旧栈删除。
3. 新栈采用`OnFailure=ROLLBACK`、45分钟timeout、termination protection off；CFN可能自动删除刚创建的资源，回滚失败也可能遗留收费对象。这只授权[CreateStack标准失败回滚](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)，不授权操作者删除新栈或其他旧对象。
4. 现有Cell角色仍有原Full数据库能力且CloudFormation-only trust，不是被本16资源模板自动收窄。模板排除RDS/IAM/Secret，实际请求限定ResourceTypes，但IAM模拟/文档不是provider、SCP、传播或并发安全证明。特权其他操作者仍可能并发修改。
5. 两次写均先独立消费API-entry永久槽，API响应丢失不能证明未提交；token用于归因，不授权重传。root槽消费后不得再次运行Run，即便后一个API槽没消费。Source自动刷新可能失效，CFN仍可能继续运行；只读检查不授权续写。
6. 不读取私密bundle或Secret值，不连接Aurora；使用历史已批准store1证据和当前Neon/DDB读取不等于最新SQL、owner/epoch或业务ready。Provider日志可保留身份、参数和非秘密部署元数据。
7. ALB、mTLS关联、公共IPv4/LCU立即开始按量计费，3小时标签不会自动销毁；部分遗留可能持续收费。50 USD是目标而非硬cap，完整账户资源费用和将来常驻费用不在本次小额估算内。

**新栈监督清理程序已在创建前审阅，但未获删除批准**：唯一允许未来使用的对象是本次CreateStack返回并持久化的准确新UUID；再次核对Source/既有RoleId/边界、精确模板hash/16资源/ownership tags、CFN终态和无workload/任务/租户登记，制作fresh准确删除清单。只有用户另批后才可STANDARD DeleteStack；既有外部Express库和Secret不在新栈内，不随计算层清理删除。不调用旧F3c9/旧foundation删除器，不复用本创建SHA为删除新栈的授权。

## 执行入口（本页尚未获批准）

批准准确SHA后，从平台根目录运行，不给主进程加载.env.local：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-compute-v1.mjs `
  --mode Run --manifest F:/ChatGPT_workshop/techlong-express-c5d-compute-review-20261015-r2/manifest.json `
  --approved-sha 7a0c636b741e1cc0af068046c052f1f09a6dd1bc8f0a62b539f3be609f245423 `
  --output F:/ChatGPT_workshop/techlong-express-c5d-compute-run-20261015-r1

# 新进程独立回读，不续写；CFN异步未完成时可用新的输出目录再次只读核对。
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-compute-v1.mjs `
  --mode Inspect --manifest F:/ChatGPT_workshop/techlong-express-c5d-compute-review-20261015-r2/manifest.json `
  --approved-sha 7a0c636b741e1cc0af068046c052f1f09a6dd1bc8f0a62b539f3be609f245423 `
  --run-directory F:/ChatGPT_workshop/techlong-express-c5d-compute-run-20261015-r1 `
  --output F:/ChatGPT_workshop/techlong-express-c5d-compute-inspect-20261015-r1
```

Inspect没有云写路径，可在清单过期后继续只读观察已提交operation，不会延长Run授权。它只在新准确UUID的CREATE_COMPLETE事件/token归因、当前role/template/tags/16实际资源和输出映射、VPC/ALB来源、ECS ACTIVE且任务/服务0均通过后输出`EXPRESS_COMPUTE_INDEPENDENTLY_VERIFIED_NO_WORKLOAD`；否则仅记录pending/unproved，不使用输出推进部署。提交不等于完成，任何云写失败都不能自动重放。

现有Neon凭据仅由隔离只读子进程从.env.local加载，用于已有Neon HTTPS端点；不输出URL、不传入云写参数，也没有Aurora连接客户端。主进程不能加载该.env文件，不能把Source刷新当成写入批准。

随后唯一下一包是实际first owner/epoch、7资源workload/DNS、准确私密来源/provision及独立initialized核验/平台ready回写，仍具体fresh审批；数据库现为准确store1，不再做空库恢复/诊断。服务端应用源码8753546和现有两真实ECR digest保持，不再次发布镜像。
