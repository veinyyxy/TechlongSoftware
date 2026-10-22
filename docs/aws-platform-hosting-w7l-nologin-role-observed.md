# W7l：NOLOGIN Web 角色安装及独立验收完成

2026-10-22，用户明确确认准确清单 `38e987e12585c6494990ac7fc68b0222ee12828a05fd248703885a6f95ac8154` 及[原完整风险](aws-platform-hosting-w7l-nologin-role-review.md)后，唯一一次 `InstallReviewed` 返回 exit 0：

`NOLOGIN_ROLE_INSTALLED_AND_INDEPENDENTLY_VERIFIED`

执行源码 `f78ec0f999a9ee839d6b3d135d7280eb7e510aeb`，执行时 main 为 `40e0a499a041b69ab6854e5587ed6bae86cb423b`。此前[真实 PostgreSQL CI39845273491](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39845273491)的13项步骤全部通过，原批准材料、代码及 CI 原件保持不变。

## 实际结果

开始时间 `2026-10-22T20:15:18.465Z`，即温尼伯 15:15:18.465 CDT；COMMIT ACK 保存于 `20:15:22.367Z`。第一次 TLS 连接在单一事务中核对完整既有目录、消费已审固定范围，执行七条持久 SQL 并提交；第二个独立 TLS 连接完成只读回读。

- 新角色 `techlong_platform_web_acceptance_v1`，实际 OID **196608**；两个安装/独立快照的 OID 一致。
- NOLOGIN、NOINHERIT，非 owner/superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS；连接上限5，准确默认 search_path 为 pg_catalog/public/pg_temp。
- 13张表 SELECT、认证6列 SELECT/3列 UPDATE、auth_sessions SELECT/INSERT/DELETE、public schema USAGE，与清单一致；无 grant option 或未审目录差异。
- 有效表/列/schema 权限及角色配置在事务内和独立快照均通过。创建者自动 ADMIN 保留，INHERIT=false、SET=false；既有 PUBLIC CONNECT/TEMPORARY 保留。
- 提交得到明确 ACK，独立状态 `EXACT_NOLOGIN_ROLE_OBSERVED`，errors为空。没有回滚/失败记录、应用重试或额外诊断连接。

按受审代码成功路径，本次为2个连接、七条持久 SQL、23条元数据 SELECT、七条 SET LOCAL、一次 ACCESS SHARE 表锁；这些是代码路径范围，不是另行网络抓包的计数证明。TLS 依据明确 verify-full 配置及成功连接；没有增加 SSL 遥测 SQL。没有读取业务行、哈希值、函数正文或密码目录。

## 不可重放的证据

永久槽 `F:/ChatGPT_workshop/techlong-platform-web-db-nologin-v1.intent.json` **已消费**，SHA `eadb07978cd78296c4669874624e5b7f00a91aefee41140a97c55f85c940aa70`。清单原48小时到期时间不使它可重复执行；不删除、复位、新槽重试或再次运行 InstallReviewed。W7k旧只读槽也保持已消费。

本地原件目录：`F:/ChatGPT_workshop/techlong-platform-web-db-nologin-cdf793b6ecd15dd71c9d8e420928b27e/`。八份原执行证据全部保留，项目仅发布[脱敏机器摘要及逐文件 SHA](../ops/aws-sandbox/reviews/platform-web-database-w7l.nologin-observed.json)，不公开实际生产 host/actor/database 或完整目录。

主要证据：

- result.json：`0633a871f8cc067d1593a499e8345aa791e5048447863c367ef0b69e59c89715`
- independent-catalog.json：`28b83add3de469a950e7e4d02a57db4358875b2d7fa6c7156c089170dd08930f`
- independent-effective.json：`ca8fdfe15e08737f10e5cdc154395dacc7ad322c0aa3a9546757314b2d77e3b3`
- commit-ack.json：`df6dce01cc4db7f2c29f2faac559c6e8b8dc9f789c3bdada9b221cb9cf3e57d8`

随后于 `2026-10-22T20:15:55Z` 对已有原件再次离线求值：预检与原W7k基线一致，准确七写差异、角色OID/配置/ACL/有效权限、提交ACK、独立只读身份、原批准及15个源码哈希全部通过。`offline-semantic.json` SHA `4a3779d928ea69e51c4d9baacf97421fdd5277ccd4e7b9d33f321b608d40e65b`。这是原证据复核，**不是第三次数据库连接或新的实时快照**。

## 边界与唯一下一步

本流程未设置密码，仍 NOLOGIN；未读取 pg_authid 来证明不存在密码。没有创建/读取 AWS Secret、改 IAM、调用 AWS、连接 Aurora、更新业务数据或部署平台。平台实际登录、HTTPS和整套系统上线尚未验收，两小时 hosting 窗口尚未启动，50 USD/月仍是目标而非强制封顶。

NOLOGIN 与授权只是本次快照，不是不可变围栏。保留 PUBLIC TEMP、创建者 ADMIN、哈希读取/会话写入敏感性、整表未来列读取和非行隔离等[已审风险](aws-platform-hosting-w7l-nologin-role-review.md)。不因本次成功而宣称安全风险消除或云端平台已上线。

下一步仅准备此身份的密码/固定 Secret 版本及托管 task 接线方案，实际 LOGIN、Secret、IAM、两小时 HTTPS 部署和清理仍按准确资源范围分别审批。不重启旧租户/F3c9/失败 publisher 支线，不复用旧高权限 owner 作为 Web 凭据，也不重建已发布镜像。
