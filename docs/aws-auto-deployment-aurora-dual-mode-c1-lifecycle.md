# D002 C1 续段：生命周期 v2 任务、只读准入与目录接线

2026-10-13 America/Winnipeg；后继[C1连接核心](./aws-auto-deployment-aurora-dual-mode-c1.md)。**本批完成独立v2只读闭环代码，未完成Express SQL写provider或实机兼容。** 新IAM、数据写、资源创建/删除、激活和发布仍需准确范围fresh批准；本批未执行这些操作。

## 实现范围

| 组件 | 本批能力 | 保持关闭 |
| --- | --- | --- |
| 双仓 `aurora-lifecycle-wire-v2.cjs` | 严格scope/owner、DB binding/固定Secret版本、代次/epoch/cleanup predecessor、原baseline双pin、canonical task/receipt | 数据包不代表批准、权限、SQL结果或旧authority品牌 |
| 平台 `aurora-lifecycle-v2.ts` | 强类型任务及纯inspection invocation；新entrypoint/env/receipt/authority坐标 | 只输出disabled候选，不注册TaskDefinition、不安装DDB记录 |
| Backend `aurora_lifecycle_admission_v2.js` | 实现STS/强一致DDB/ECS/RDS/Secret metadata只读取证、进程私有token及SQL前后刷新 | 不PutItem、不GetSecretValue、不Grant、不允许写命令 |
| Backend `aurora_role_directory_v2.js` | 固定PG catalog SELECT及角色目录分类，检查提权/父子membership/其他DB CONNECT | 不改role/LOGIN/password/ACL；candidate不是ownership或ready证明 |
| Backend `aurora_lifecycle_inspection_v2.js` + 新CLI | 受准入的管理TLS固定只读事务→目录检查→脱敏非发布receipt→释放clients | 不恢复baseline、迁移、激活、发布receipt或删除；Full继续旧路径 |

新CLI `db/tenant_lifecycle_aurora_v2.js` 接受 `--check-bundle`；实际任务只有 `inspect`。五个写命令在加载SDK/解析凭据/网络调用前拒绝。Docker默认entrypoint仍为原prepared CLI，**未改成新入口或打开任何运行时flag**。未来独立诊断revision的entrypoint也是候选，未安装。

## v2 任务与记录的准确语义

任务必须重算五字段业务ownership preimage的stableIdentity，再核对准确runtime Secret命名/代次、bindingSha256与ownershipMarker。新protocol `aurora_v2` / schemaVersion2不能被旧raw input parser接受，不填假master Secret ARN。Full参数可作为v2审阅数据解析，但本批新执行入口拒绝Full；它保留原 `prepared_v2`、PG16.14和五键路径，未声称Full写生命周期已迁移到新协议。

同一provision epoch内prepare/restore/migrate/verify共用**resource operation hash**，避免每步改变准备journal的fence；**task hash**另绑定准确command，收据不能跨步重放。destroy需要同generation/同binding/同owner的准确更早provision predecessor。新generation必须有前序cleanup引用，数据包本身不签发任何创建或退役权。

新命名空间为 `tenant:aurora-v2:<stableIdentity>`、`runtime:d001:aurora-v2:<stableIdentity>:g<generation>`、`tenant-lifecycle/aurora-v2/.../<taskHash>.json`；旧数据/记录/槽不覆盖、不迁移、不复位。

本批的inspection activation要求独立schema2记录、准确owner/binding/generation、**allowedOperations仅inspect**、真实TaskDefinition revision/image/角色ID、固定baseline及至少3分钟剩余/最长6小时窗口。没有生成或安装实际active记录，也没有把环境变量或自报SHA当权限。

## 准入和连接检查

默认SDK只用ECS metadata临时凭据，关闭配置endpoint覆盖，单次调用不自动重试。实际准入实现顺序：STS caller→activation强一致读→ECS metadata/DescribeTasks→DescribeTaskDefinition→epoch强一致读→DescribeDBClusters→DescribeSecret。核对实际角色RoleId、FARGATE1.4.0、x86/256CPU/512MiB、准确image digest/entrypoint/非root只读filesystem/工作卷、仅两个任务JSON+SHA override，以及准确clusterResourceId/endpoint/engine/gateway/master username/writer和资源标签。

Secret仅检查metadata：准确ARN/name/唯一固定AWSCURRENT/四键schema与ownership标签，不取载荷。成功只产生**任务绑定的进程私有readonly token**；JSON克隆、旧品牌或其他task不能复用。SQL前后重读activation/epoch/RDS/Secret，revision、身份、窗口或版本漂移拒绝。7个初始SDK读+每次刷新4个读，是本批SDK计数；另有ECS metadata HTTP。不是跨服务CAS、IAM有效权限全证明或写授权。

SQL始终为 `BEGIN READ ONLY`、固定connection identity SELECT、参数绑定的角色目录SELECT、`COMMIT`。客户端TLS链/hostname/SNI及实际database/user/session_user/version/OID必须匹配。后端pg_stat_ssl的false/null独立记录，不被改成true来满足旧直连证明。

新角色候选要求NOINHERIT、无superuser/createdb/createrole/replication/bypassRLS/owner对象/自定义settings、其他可连接DB上的CONNECT=0。IAM LOGIN候选只允许准确系统rds_iam OID、指定管理grantor、无ADMIN/INHERIT/SET的直接父关系；额外父路径或外部子成员拒绝。**这套安全目录候选还需真实Express/PG验证，不是已证明的托管行为；不能自动改grant选项或撤销其他数据库PUBLIC权限。**

receipt仅包含绑定哈希、脱敏connection与目录分类/目录摘要，明确 `mutationPerformed=false / runtimeEnabled=false / lifecycleCompatible=false`；内存返回/可检查，但不PutObject、不回写ready。没有把role的candidate分类当成完整ownership、73表、迁移或应用登录证明。

## 验证与追溯

- 平台4新+13相邻共**17项**通过；Backend8新+27相邻共**35项**通过，含原Full admission/RDS连接路径。types/syntax/定向lint零warning与生产npm audit0通过。
- 新自检在本机通过；SDK签名只用明确合成凭据，新准入SDK和SQL session在单元测试中mock。所有write argv提前拒绝、克隆token/陈旧epoch/替换RoleId/image/DB/Secret拒绝，固定只读事务和client释放/脱敏通过。不宣称真实Fargate/IAM/Express验证。
- 开发初测发现连接观察变量遮蔽和测试依赖字段接线错误，已修正并完整重验，没有放宽TLS/epoch/目录条件。未连接AWS或数据库。
- 两仓wire LF归一化SHA `86e0261141eb3dd72c50dde9a020cd0121eaaaf5aa9a1d51e439e2af5745306a`相同；原172项历史pin entries全部保持。用户Backend `.vscode/settings.json`未提交。

Backend源码已提交推送 `0264fe4771ea39700c2e49b9be7673b1091b2107`。本次[双镜像候选38493039640](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38493039640)与[完整Backend CI38493039487](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38493039487)均attempt1，**两个镜像job和完整CI check/docker均独立回读success**，各构建、自检、安全门禁及导出通过。新镜像自检覆盖v2数据包/只读receipt/写入口拒绝和实际RDS SDK加载，断网且没有真实AWS凭据；不代表Express真实认证/SQL执行。旧C1候选不代表这些新增代码，后续发布必须绑定新的准确source/run/digest；本批未下载/复算整个镜像归档，不是ECR发布或生产image验证。

## 下一步：最小真实事实先行，避免离线扩展失焦

当前无Express cluster，无法证明默认引擎/网关TLS与服务端报告、rds_iam实际membership/管理权限、73表容量和实际恢复。**不继续凭假事实把旧PG16.14目录与PASSWORD SQL整体翻译后开启写入。** 顺序调整为C1/C2交叉：先准备C2最小Express资源/权限/有限SQL及准确清理清单，按新SHA批准取得真实事实，再完成剩余C1 SQL写/Secret生成与首位密码/ownership/activation接线，随后D001单任务到ready。仍沿用同一方案与边界，不添加通用工厂或新的Grant探针系列。

下一只读准备需核对Source身份、FREE account服务资格、quota、真实遗留和既有权限，再列明新资源、计费、云/SQL调用和失败接管范围；**尚无可执行云SHA，本文不授权上述资源创建**。旧失败Stack与公钥Secret/凭据包/所有永久槽保留，不因改Express而自动删除或重试。50USD/月目标非hard cap，账户未升级；本轮AWS/Neon实际读写、Secret值、Invoke、资源/任务/部署/删除/receipt发布均0，只有GitHub代码推送和候选验证。
