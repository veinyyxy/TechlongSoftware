# D002 C2b：现有 Express 的一次分阶段只读诊断，待批准

2026-10-13 America/Winnipeg。用户选择保留现有cluster，继续准备新只读诊断；[C2a创建成功/检查失败的原件](./aws-auto-deployment-aurora-dual-mode-c2-executed.md)全部保留。**本批只准备与只读云核对，未重新连接数据库；不重跑旧Run、消费旧槽、重建资源或打开C1写入口。**

后续用户明确确认本新SHA：一次真实诊断成功、客户端正常关闭，独立云回读通过；新槽已消费。本文为原待审材料，不是可重放授权；以[实机结果与当前主线继续位置](./aws-auto-deployment-aurora-dual-mode-c2-diagnostic-executed.md)为准。

## 目标与实现

新增Backend `aurora_express_admin_diagnostic.js`，作为原C2a固定检查器的独立观测adapter；原8项执行代码/pins不改。新增平台纯review契约与独立CLI，只有Review/Run/Inspect：SDK发送仅允许STS identity、RDS DescribeCluster/Instance、IAM SimulatePrincipalPolicy；另有固定Free Tier账户状态GET。没有Create/Modify/Delete/Grant/Invoke、Secret值、Neon、ECS或SQL写入口。

同一实际资源：cluster `cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`、writer `db-NVAQZTKV2FPTHGITOQE563CPAY`、原准确ARN/创建时间/四tag与nonce、PG17.9/endpoint/5432。Review实际回读仍available、Min0/Max1/pause300、IAM/gateway=true/VPC=false、FREE/ACTIVE，Source精确UserId一致。Source对准确 `arn:aws:rds-db:ca-central-1:402010193138:dbuser:cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM/postgres` 模拟allowed、无missing context；不把模拟当真实认证或权限全证明。

新adapter仅观测原检查器的Client/Signer：DNS lookup、TCP connect、PG SSL negotiation、TLS secure-connect、认证挑战/ready、凭据/签名、sql_1至sql_4、dispose/finished；每帧只存sequence、elapsedMs、stage/event、白名单error category/code。TLS事件的“observed”只表示事件发生，**真正TLS/SQL身份成功仍必须通过原检查器**；`failureStage`表示最后观测/出错位置，不自动断言根因。

不输出原始error message/stack/cause、令牌、temporary keys、DNS地址、证书载荷或PG取消secret。错误分类只允许固定网络/TLS/PG SQLSTATE及精确已知超时字符串；未知错误统一OTHER_DRIVER_ERROR。独立成功观察仍为 `ADMIN_READONLY_OBSERVED_NOT_TENANT_VERIFIED / lifecycleCompatible=false / runtimeEnabled=false`，不是租户管理写能力、应用登录、隔离或ready证明。

## 本次拟批准的准确边界

| 项目 | 上限与约束 |
| --- | --- |
| 新逻辑SQL会话 | **1**个Client/1次connect，不回退、不重连；固定现有cluster endpoint、postgres database/user |
| SQL | 原BEGIN READ ONLY、身份SELECT、管理员catalog SELECT、COMMIT，仅4条；保留启动read-only/SQL与idle超时 |
| 超时 | 原10秒connect改为本adapter内30秒；本次90秒abort窗口，client处置另限1秒；不改生产app pool或旧probe |
| AWS | 最多9次有限metadata读/模拟（auth cache刷新不计resource API）；resource/IAM/Secret/业务写0 |
| 身份 | 现有Source AWS Login；只在内存取一份至少120秒剩余的临时snapshot，用**同一份**凭据做STS验证并签名；无static-key/profile fallback |
| 日志 | 最多64安全事件，wx新progress.jsonl并逐帧sync；原始错误不落日志 |
| 前置/后置 | 校验原审批material与8旧pins、创建/binding/失败回执及两个已消费槽的文件SHA；新11pins；30秒内Source/plan/资源/准确connect权限事实；SQL前后核对实际身份 |
| 新永久槽 | `F:/ChatGPT_workshop/techlong-d002-express-c2b-diagnostic-v1.permanent-slot.json`，本批仍空；获批实际连接前永久消费 |

一个pg Client的原生DNS/address选择可能尝试多个解析地址；这不表示只有一个TCP SYN，也不授权第二次SQL会话或重新运行脚本。不改连IP/CNAME、不关闭ATS五root/hostname/SNI，不提高ACU、不重启pending-reboot参数组、不补权限。

## 完整风险

- 保留cluster/writer可能持续计费或消耗credits，新的连接还可能唤醒idle实例；自动暂停、review有效期、tag和50USD/月目标均不是费用硬上限，也没有自动删除调度。用户选择保留不等于已证明暂停。
- 管理Source仍有现存AdministratorAccess；工具范围保护不是IAM降权。此会话只读，但凭据本身的权限范围更大，不给应用分发它；临时snapshot只用于本次管理员诊断。
- 身份/云元数据/策略模拟/文件检查与连接之间非跨服务CAS；凭据/网络/资源状态仍可并发变化。前置拒绝不能证明长期条件稳定；后置失败时不能冒称全部验收通过。
- 认证、catalog查询及网络行为可能进入AWS/PG/提供者日志。安全分类有意丢弃敏感原文，未知/缺失阶段可能仍不能确定原因，不会因此自动重试或扩大读取范围。
- 源程序或磁盘异常、fsync/日志保存失败、异步事件、超时和client释放可能留下部分证据；abort不能保证服务器同步结束会话。客户端结束不等于已实读服务端会话数0或停止计费。
- 新槽在连接前永久消费；过期/原件或代码/身份漂移就停。消费后失败不得自动复位、补齐、重连、改代码后重放旧槽、下迁移、清理或创建补偿资源。必要时新的独立尝试仍需新的准确SHA批准。
- 不改变原Full/C1/F3c9门禁与资料，四SQL读取不会证明CREATE DATABASE/ROLE、租户IAM用户、73表恢复、migration、ECS健康或ready。任何后续SQL写、Secret、权限、部署、重启/修改/删除都另按具体范围审批。

## 新SHA与入口

新私有Review目录：`F:/ChatGPT_workshop/techlong-d002-express-c2b-review-20261014-r1`。

- SHA：`f95a0c3c6c88a07757fa08dd4a604749b3e3cfc483aee9f925776f7a96a0c7f8`
- 有效至 **2026-10-14 09:47:37.715 UTC / Winnipeg 10月14日04:47:37.715 CDT**。
- 本批AWS resource写、SQL连接、新槽消费为0；之前C2a create/sql两槽仍消费、删除槽仍空。新SHA不授权重新创建、旧Run或清理。

明确批准之后才执行，由本任务接手，无需现在运行：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-aurora-express-c2-diagnostic.mjs --mode Run --manifest F:/ChatGPT_workshop/techlong-d002-express-c2b-review-20261014-r1/manifest.json --approved-sha f95a0c3c6c88a07757fa08dd4a604749b3e3cfc483aee9f925776f7a96a0c7f8 --output F:/ChatGPT_workshop/techlong-d002-express-c2b-run-20261014-r1
```

之后另起 `--mode Inspect --manifest <本manifest> --output <新的C2b目录>` 做AWS独立只读回读，**不重连SQL**。过期且新槽未消费时可重新只读Review；新槽已消费只能Inspect/审阅新的独立方案，不自动换代或重试。

## 验证与唯一下一步

平台10、Backend16项必要新/相邻检查及两仓types、syntax、定向lint通过；新增测试只模拟阶段/redaction/凭据签名，不跑真实PG，未构建新的大型离线生命周期模型。独立CLI无效SHA检查返回EXPRESS_C2B_FRESH_APPROVAL_REQUIRED，metadata calls/SQL/resource writes均0。源码与文档直接提交推送两个main，用户.vscode不提交；无新依赖或旧production flag修改。

Backend准确提交 `4ff29b7140d3a18412626361e34de2c26a1b85fa`、平台代码提交 `e89cb074c3da023aba8488de47aa5c1495c74646` 已推送并独立回读远端main一致。04:00 UTC独立回读：[完整Backend CI38508830122](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38508830122)的check/docker、[双镜像候选38508830171](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38508830171)的app/lifecycle，attempt1四job全部success，自检/安全门禁/导出通过。未ECR发布、未下载复算归档；云端镜像验证不代表真实Source诊断或PG登录。原172历史+8执行共180pins全部匹配，新11pins的binding SHA `71d0f310688b47fe81e5a9b00f36b0dffa846abe81acae2432b46eb86ad0b010`。本次[非秘密继续摘要](../ops/aws-sandbox/reviews/aurora-express-c2-diagnostic.prepared.json)只用于恢复位置，不是批准。

下一步仅等本新SHA的**一次连接**批准；实际诊断结果再决定最小修正/有限角色与baseline验收，不继续扩大F3c9或重建可用cluster。原C2a准确清理代码及提案保留，但未执行、且它的旧时限仍独立，不作为本新批准的一部分。
