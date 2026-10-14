# D002 C4a：最小应用权限与四键运行时候选已完成

2026-10-14 America/Winnipeg。状态：`APPLICATION_AND_SECRET_CANDIDATE_PREPARED_NOT_ACTIVATED`。本轮完成代码、可信原归档编译及云端两镜像检查；没有执行候选 SQL、启用应用登录、创建 Secret、安装 IAM 权限、发布 ECR 或部署 ECS。候选 SHA 仅用于追溯，**不是可执行清单或授权**。

前置事实沿用 [C3g 独立实机验收](./aws-auto-deployment-aurora-dual-mode-c3g-restore-executed.md)：准确库 OID16459、应用角色 OID16456、73表、7序列、两原迁移、9条技术 seed、其他业务 count0；应用 NOLOGIN/NOINHERIT/零成员。真实迁移后目录 SHA 为 `93d3c7eb62bbdd3e38f0a3943c9d44d607b419d562fcbd73ebd2fccf319e876b`。C4a没有重新连接数据库，不将历史事实冒充新的当前核验。

## 已完成的接线

服务端 `services/saas/aurora-express-application-v6.cjs` 是纯 compiler/目录 ACL projection/角色 classifier，没有 Run、activate、数据库 client、凭据、Secret writer 或旧 ready-receipt issuer。原归档仍由原 private-brand compiler 验证；JSON 复制品不能取得可执行程序品牌。表与序列名单来自真实受信归档，不使用泛化的 ALL TABLES/ALL SEQUENCES。

候选包含以下8个固定 SQL 数据项，尚未派发：

1. 准确租户库 `tenant_a0da1748bc4d5419_db` 的 CONNECT。
2. public schema 的 USAGE。
3. 准确73表的 SELECT/INSERT/UPDATE/DELETE。
4. 准确7序列的 USAGE，不含 UPDATE。
5. 向准确应用角色授予 rds_iam，SET FALSE。
6. 同一 membership 的 INHERIT FALSE。
7. 同一 membership 的 ADMIN FALSE。
8. 准确应用角色 LOGIN。

不含 DDL、新函数权限、default privileges、其它库 REVOKE、角色创建或旧对象删除。active 分类要求其它可连接库数为0、角色无提升/配置/所有权、零 creator/admin 成员及准确受限 IAM parent；closed 分类仅报告隔离缺口。当前跨库隔离未核验，候选不自动修改 PUBLIC CONNECT 或其他数据库。受限 NOINHERIT/SET FALSE membership 在此准确 Aurora 目标上的 IAM 登录兼容性尚未实机证明，必须在后续获批激活内用真实 TLS IAM 登录验证；不能把分类通过当登录成功。

目录核验只在私有副本中移除准确应用角色、准确 grantor/权限/非 grant-option 的 ACL，保留所有非应用 ACL 与结构，再匹配原迁移后 digest；返回实际目录 hash 与非应用目录 hash，不改写原目录，不发行旧 v2 ready token，不把新候选写成已安装 authority。

平台 `lib/deployments/execution/express-runtime-candidate-v6.ts` 准备四键 Secret-v2 契约，以及真实元数据到 immutable runtime binding 的纯适配器：

- 固定名称：`techlong/sandbox/tenant/a0da1748bc4d5419/runtime/g1`。
- 固定四键：hmac_secret_key、jwt_secret_key、stripe_secret_key、stripe_webhook_secret；不含 database_url、密码或 IAM token。
- 固定标签：ManagedBy=techlong-sandbox、SecretSchema=techlong-runtime-four-key-v2、DatabaseProfile=express_iam、ResourceGeneration=1、准确 StableIdentity。
- 拟使用默认 AWS-managed KMS；尚未生成/读取私密材料，实际 ARN/version 均为 null，CreateSecret request 不含 SecretString。
- 后续必须供给真实准确 ARN/标签/单一 AWSCURRENT version/cluster/endpoint/role 元数据，才输出四条版本固定的 ECS Secret refs；拒绝私密值、旧五键标签、外部目标、额外版本及自定义 KMS。

适配器是 metadata-only，不是 AWS-authenticated observation，也不证明任务角色权限、数据库登录或 ready。单元测试里的 ARN/version 是明确合成数据，未作为真实资源保存。原 Full/PG16/password 入口与 Express/Full 共用 v2 contract 不改，没有失败后密码回退。当前 `/ready` 仍是旧 SELECT1 检查，PG17 完整运行时 ready 接线、实际 Secret 创建、应用管理员初始化及部署验收仍待后续实现，不能声称已完成自动部署。

## 本轮验证与中断恢复

服务端5项V6新测试+3项相邻V5测试共8项通过、typecheck通过；平台3项新测试+6项相邻双模式测试共9项通过、typecheck及定向 ESLint通过，prepare脚本 syntax/lint通过。只运行相关测试，没有重跑历史支线大套件。

初始服务端源码 `4858bccbe360768d5dee3adae7e6754374ce3994` 的 CI38599242308通过，但镜像38599242287中 app job115973871057的V6自检失败：顶层导入归档 compiler，应用镜像缺少原生归档脚本。lifecycle job115973871601通过。修正仅将 compiler 私有品牌 API 惰性加载到本地编译入口；没有扩大镜像工具链、权限或放松检查，并新增“原生 compiler 不存在仍能加载纯检查”的回归测试。额度中断前修正已保存、未提交；本轮恢复后验证并推送。

准确修正源码 `153efbc7566d2ed2d566437f002c8fa95a6b9c9f` 的 [完整 CI38633329098](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38633329098) 与 [双镜像38633329018](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38633329018) 均 success。app job116090169547、lifecycle job116090169874所有 steps 通过，包括最终镜像 `--network none` V6、双模式/V4/V5原检查、依赖及OS HIGH/CRITICAL门禁。GitHub artifact已保留但未下载、未发布；artifact digest不等于ECR/image manifest digest。后续文档提交不是新的镜像执行源码证明。[紧凑云证据](../ops/aws-sandbox/reviews/aurora-express-c4a-cloud-validation.json)。

本地准备记录按原样保留：

- r1：旧源码候选 `ea952e0479c957cf29027f2c8a8b4cde730cc2257205c514b08fff52899c2d8e`，被修正后的候选取代；不是执行授权。
- r2：当前 bundled Python 字节指纹与C3g旧指纹不同，编译前拒绝，仅留下 stopped.json；SQL/AWS/私密值读取/新执行槽均0，不覆盖或删记录。
- r3：独立只读确认官方本地 bundle26.1013.11914 / Python3.12.14 后，仅在C4a准备入口绑定新工具 hash。C3g历史 pins/receipt及旧Python指纹原样保留；pg_restore pin不变。原SQL/权限候选 digest保持，没有扩大数据库执行范围。

r3目录：`F:/ChatGPT_workshop/techlong-d002-express-c4a-prepared-20261014-r3`，准备时间20:36:50.669 UTC / Winnipeg15:36:50.669 CDT。240当前源码 pins+2工具；候选追溯 SHA `6a61880217d944c18c797ae1910e63fd8bbd6acbb6e4af27c915b585fa16486d`，code binding `b4362f2191f6b5f81c49fd1a8636dd67e98b09d38c688d9774bc8fc0cb578694`，7项历史文件 binding `fd633db97a83f8810c3427938d588db71c1719b04df10f80995b82e2c63d0a6d`。应用候选 `bcd5e8ca2baf28063027a982a83c3385ab07b6533a5a70d0a630f4f7c3b878e2` 与Secret候选 `3bf82a68144eb1327e7f482a598f3a4587e36edf824d5d0039a0387c8483073f` 与r1一致。新Python字节 hash `b847bb9f4e48c19f585c8bf7d8b355f3f8c6d2125717ece9c9d7e16fb9f09de8`；历史 `d41bad46673f64e0d02f23797f53f90ccf60f27d6eda8d86dd2d4bbeae5a858c` 不替换为“原执行工具”。

本轮 SQL连接/SQL调用/AWS调用/AWS写/Secret值读取/新执行槽均0。GitHub构建不代表AWS发布；现存Aurora/其它资源可能持续计费，50 USD/月仍是目标而非绝对账单cap。[唯一继续位置与文件字节SHA](../ops/aws-sandbox/reviews/aurora-express-c4a-application.prepared.json)。

## 下一步：直接推进激活所需事实与具体范围

先准备一次有界的准确角色/数据库隔离只读清单，并核对既有应用task role、execution role、lifecycle role及准确Secret名称是否占用的元数据；不读Secret值，不修改其他库。Source仅在实际只读需要时刷新，刷新不是写批准。SQL诊断仍按明确范围另行确认，不复用已经消费的C3 Run/Inspect槽或过期批准。

据真实事实收敛准确 IAM connect/Secret-read 范围、隔离处置和最小激活清单，再让用户单独确认数据库 grants/LOGIN、Secret/IAM写及ECR/ECS部署；不能对本文件候选SHA直接执行。若共享库PUBLIC CONNECT构成隔离缺口，先说明影响并提供具体处置，不静默全局REVOKE。权限、登录、四键配置到位后补齐真正 `/ready`/初始化接线，再以新镜像完成ECR→ECS→HTTPS/DB/login验收；不再增加同类探针/Grant generation支线。

所有旧C3g/C3f/V4/V5槽保持消费状态，不重放恢复、prepare、guard或down，不重试已拒绝写，不删除旧Full失败Stack；F3c9继续封存。没有新执行root、期限、fresh执行SHA或写入授权。代码/非秘密证据按用户既有授权直接提交推送两个main，用户 `.vscode/settings.json`不动。
