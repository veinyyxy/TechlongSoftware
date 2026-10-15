# D002 C4h：应用权限提交、独立回读与实际TLS IAM登录通过

2026-10-14 America/Winnipeg。用户确认清单 `f6e1fc317da5607bd97aa3635cd8212fb1e6e7211b71b958ad15e2f0b857b3e5` 后，仅一次Run、立即唯一独立Inspect均完成。**应用SQL权限/LOGIN已持久安装，Source签发的准确应用用户TLS IAM只读登录已验证；不是ECS任务身份或完整ready验收。** 没有IAM/Secret/Neon/业务/authority写、私密值读取、ECR发布或ECS/Cell部署。

## 准确执行结果

- 安装槽消费：UTC2026-10-15 00:43:54.989 / Winnipeg2026-10-14 **19:43:54.989 CDT**。原八权限/LOGIN语句均收到响应，所有写后门禁通过。COMMIT_INTENT于00:44:22.900，COMMIT_OBSERVED于 **00:44:23.007 UTC / 19:44:23.007 CDT**；结果保存00:44:23.064 UTC。
- Run：26个metadata调用、1管理SQL连接、21查询、8权限写；结果 `APPLICATION_PERMISSIONS_COMMITTED_REQUIRES_INSPECT`，commitSubmitted/commitAcknowledged均true。没有ROLLBACK、重连、补写或重试。
- 独立Inspect槽消费：UTC00:44:42.103 / Winnipeg **19:44:42.103 CDT**。先唯一管理READ ONLY事务，COMMIT于00:44:44.758得到响应，准确active状态与Run全部观测相同；随后唯一应用用户READ ONLY TLS IAM登录通过，最终结果保存 **00:44:45.726 UTC / 19:44:45.726 CDT**。
- Inspect：26个metadata调用、2 SQL连接（管理1、应用1）、14查询（8+6）、权限写0；结果 `SOURCE_SIGNED_APPLICATION_TLS_IAM_LOGIN_VERIFIED_NOT_ECS_OR_READY`。
- 本阶段合计52个metadata、3 SQL连接、35查询、8权限写；AWS资源写、Secret值/私密材料读取、业务行写均0。

目标仍是账户402010193138/ca-central-1、集群`techlong-sandbox-express-d001`/`cluster-XBWGLIW2B3HPGX3ROHYJA7CNPM`/17.9，租户库`tenant_a0da1748bc4d5419_db`/OID16459、应用角色`tenant_a0da1748bc4d5419_role`/OID16456、管理postgres/OID16410。原八SQL/program字节及所有其它门禁不改。

## 已实际证明的门禁

- Run写后及独立Inspect均通过：应用LOGIN、NOINHERIT，无超级用户/建库/建角色/复制/RLS绕过/config/settings/ownership、额外成员或其它库CONNECT；唯一rds_iam/OID16389 parent，实际grantor=rdsadmin，ADMIN/INHERIT/SET全false。实际角色digest `941cfda905da13438878f0f5415a2d9bb56a7be217a8d813daef8fde401055d5`，记录真实metadata，不使用投影副本的digest。
- **完整post-catalog verifier这次实际到达并通过**：准确应用ACL投影后的完整非应用目录SHA仍为C3g `93d3c7eb62bbdd3e38f0a3943c9d44d607b419d562fcbd73ebd2fccf319e876b`；真实含应用ACL目录SHA为 `ad213560c608cc678d838e1789f9e90d33eff77062febe90a4f8881881299bc9`。两个事务独立一致，不以旧脱敏inventory或ACL向量代替完整pin。
- 四库完整active ACL SHA `9a6a5619d26ca00ec807c83e6dbf3c2f69504b06f93af26eb9b8ce6b86d61c22`，仅受审租户库app CONNECT增量；原template1/postgres PUBLIC隔离及其它ACL保持。73表/7序列应用ACL、九技术seed/业务count0均通过；没有商户初始化或业务行写。
- 实际应用登录用Source内存签发IAM token，经客户端/后端TLS校验通过。准确SQL用户/角色OID/数据库OID/版本、READ ONLY repeatable-read上下文、IAM成员true且INHERIT/SET false、库CONNECT true而CREATE/TEMP false、public USAGE true/CREATE false、73表四项DML权限元数据及无额外权限/7序列USAGE与无额外权限/count均通过；不是只跑SELECT 1，也没有实际业务DML。

角色classifier/catalog对象仍返回loginVerified=false，因为它们本身不做认证；独立 `application-login.json` 与Inspect result的applicationLoginVerified=true才是实际认证证据。两层不混同。

## 追溯、槽与保持的边界

263源码pins/2工具/17前置历史全部本地重新核对；Review、Run、Inspect的candidate/program/code-binding/IAM原字节完全相同，六份Review及十五份结果/证据文件、双槽原字节SHA见[结果证据胶囊](../ops/aws-sandbox/reviews/aurora-express-c4h-role-grantor.executed.json)。本地核验没有增加AWS或SQL调用，不是第三次实时SQL观察。原8新+14相邻tests/types/lint保持；本轮仅结果文档，不改受审执行源码。

准确双槽已永久消费：

- `F:/ChatGPT_workshop/techlong-d002-express-c4h-application-install-v1.permanent-slot.json`
- `F:/ChatGPT_workshop/techlong-d002-express-c4h-application-inspect-v1.permanent-slot.json`

即使f6e1...尚未到期也不能重放，retryAuthorized=false。C4g/C4f及全部旧槽/失败记录继续保留；不复位、删除或创建隐式重试槽。

[已接受完整风险](./aws-auto-deployment-aurora-dual-mode-c4h-role-grantor-review.md)继续有效：提交后的73表DML/LOGIN是持久能力、不是行过滤，原PUBLIC函数权限保留；非跨服务CAS、并发/提供者日志/非零费用风险保持，50 USD/月不是硬cap。C4e准确IAM默认v4/原v3、七消费者及C4d固定Secret元数据不变，不自动撤销或down。本次Source登录不是ECS task/session/SCP/KMS访问证明；没有Secret内容读取、租户完整ready/初始化、ECS滚动部署或公网验收。

Backend执行源码和已验双镜像仍为153efbc7566d2ed2d566437f002c8fa95a6b9c9f，本仓服务端只写交接文档；不重复构建、发布或修改旧Full。F3c9保持封存，不扩展Grant/恢复/同类探针。

## 唯一继续位置

**不再尝试C4激活或同类SQL探针。** 这一应用权限/受限IAM认证障碍已用实机证据闭合。下一沿首轮单租户主线准备PG17完整ready/商户初始化接线与准确执行清单，再ECR→ECS。

下一阶段必须把“Source账号已登录成功”与“ECS实际task identity/Secret读取/应用启动已通过”分开：在现有dual-mode结构内补齐实际ready/初始化入口、必要的部署接线和云端构建验证；真实Secret读取、初始化业务写、镜像发布和实际ECS部署各按具体fresh资源/变更范围批准，不因本次成功自动执行。保留express_iam/full_password快速切换、不升级账户和50 USD/月目标。
