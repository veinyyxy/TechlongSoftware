# K2c：已初始化应用的平台收口——固定范围与完整风险 v1

本文件申请的是**新的人工协调许可**，不是旧worker lease，也不复用已经消费的K2b权限。Check/Review只读取公共本地证据、既有AWS元数据及Neon控制面；不加载私密包、不读Secret值、不连Aurora、不签JWT、不发应用HTTP、不写平台。最终清单SHA须另行明确批准；提交代码不构成执行批准。

## 固定目标与手工归因

- 账户402010193138 / ca-central-1，Source `techlong-sandbox-user` / `arn:aws:iam::402010193138:user/techlong-sandbox-dev`。
- 原deployment `dep_7c99bd249470184852f0dc74`、instance `app_e897a4377bce498b9c5ee9e64509dcad`、job `job_202c8dc12a8bf379f3a7c693`。旧job为running/attempt1/max1，lease已经过期；本入口不claim、续租、增加attempt或创建替代job。
- 新承载栈UUID `f71252c0-c917-11f1-8148-02ff648cb917`，task definition `tenant-9c5ee9e64509dcad-task-definition:2`；实际镜像 `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`。
- 准确域名 `first-acceptance.sandbox.techlong.cloud`，原store `add89a8c-f43e-81b9-8287-0cb6c5c54f87`，原配置hash `06d3cb50dd46b5f32771c356b7e7cd7d524a0707799ae24b9ace0672ef7281c9`。K2b已真实初始化并独立认证验证；**不得再次provision、restore/seed/migrate或重建租户**。
- 显式允许把旧job置succeeded，含义是“人工恢复后的终态协调”，不是声称原worker持有有效lease成功完成。保存旧artifact、完整旧行摘要、旧lease owner/expiry及job摘要，写入`manualRecoveryNotWorkerLease=true`；不导出原lease token。保留原错误字段、desired_plan、plan_hash、幂等键、generation/epoch、ownership/authority及所有旧文件。

## 唯一写事务：三条已有记录

一次Neon **SERIALIZABLE读写事务、七条固定语句**：设置会话；锁定并核验九条关联记录；核对现场catalog摘要；更新instance、deployment、job各一行；复验不可变字段和结果。0 INSERT/DELETE/DDL，0新行，不创建schema/角色或授权。

1. instance：pending→active，保留/设置准确已规划access URL，记录provisioned_at/updated_at，suspended_at=NULL。
2. deployment：configuring→ready，artifact_ref由旧镜像改为实际新镜像，current_step=ready，ready_at/updated_at为DB时钟。outputs新增准确stack/observation及初始化验证标记、人工协调receipt；旧outputs的完整JSON值嵌套保留，同时保存旧原始text摘要。JSON格式/空白不保证字节保持，旧原件及整行摘要保留。
3. job：running→succeeded，清lease owner/token/expiry，记录completed_at/updated_at。attempts/max_attempts保持1；旧错误、payload、创建时间等不在允许列内，不清除失败证据。

九条原行（上述三行、resource、operation、environment、workspace、subscription、template version）由PostgreSQL计算完整SHA256并锁定，修改前要求与清单逐行一致；修改后扣除准确允许列，其余字段摘要必须完全一致。锁定目标/SQL、DB endpoint摘要、database/role名称及OID、服务器版本/时区、相关表列/约束/触发器/RLS/规则/ACL及公共非extension函数定义均受审绑定。token只参与服务端整行摘要，不返回token或整行。函数定义属于元数据，可能含内部业务结构，原件保存在本地F盘；hash不是匿名化或绝对保密保证。

事务要求环境active/open/apply_enabled=0、订阅active且未过期、原lease已过期；DB时钟核验截止时间，并要求新应用证明与承载观察分别不早于当前30秒。计数、摘要或门禁不符即失败；不放宽旧worker validator或以伪造context绕过lease。

## 新只读权限及数量

- Run和独立新进程Inspect各最多加载一次原本地私密目录 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2`。原五文件/ACL/summary/binding/RSA与mTLS证书指纹继续验证。旧loader会把未使用的**测试Stripe材料也读入内存**；不调用Stripe、不使用payment委托、不派生或读取owner密码。
- 每进程经固定HTTPS :8443、mTLS+RS256 JWT，各一次GET `/api/saas/readiness`、GET `/api/saas/control`，共最多**四个GET、两次私密加载**；仅验证实际image、13项初始化readiness、准确单一store及原店名/entitlements/主题/重算配置hash。没有bootstrap或POST能力，不读取商户密码/业务明细；不另行声称准确owner用户名获得行级独立回读。
- **0 GetSecretValue、0 Aurora连接、0应用POST、0 AWS/IAM/Secret/DNS/DDB写**；不更新代码、权限、调度、镜像或云栈。函数/SDK仅使用现有Source授权。
- 正常Run前、Run后、Inspect各一组35 SDK/11 CLI/1 Neon只读承载与平台投影；每组另一个Neon SERIALIZABLE READ ONLY事务、三条固定语句读取完整行摘要及catalog。正常Run+Inspect合计105 SDK/33 CLI、6次Neon只读事务，另一次七语句写事务。Review另同样一组只读准备，不计入执行预算；前期曾额外一次三语句Neon只读探索，未作写入。提供者内部自动凭据刷新及底层活动不冒充已逐项遥测。

## 必须接受的完整风险

- **实际平台状态改变与受限能力**：三行会变为active/ready/succeeded，平台可能据此向用户显示可用。它是对现有人工恢复的收口，不证明从零申请→构建→部署→初始化的无人值守全链路已经全部验收。DB连接用户现有权限高于本入口SQL范围；本实现不新增授权，但本地进程/依赖受损可能扩大风险。
- **非跨服务原子及竞态**：Neon三行在同一事务提交，但AWS、应用、私密文件、网络和DB之间无共同CAS。30秒事实窗口仍可能过时；行锁/Serializable及函数catalog摘要不消除并发DDL、函数替换、管理员改权限/服务或Janitor清理竞态。锁九行可能短暂阻塞业务；lock_timeout5秒、statement_timeout15秒，HTTP/SQL段信号30秒，元数据组180秒。死锁/序列化失败均不自动重试。[PostgreSQL事务文档](https://www.postgresql.org/docs/18/transaction-iso.html)说明Serializable可能要求调用方处理失败，本入口有意停止而非自动重放。
- **提交结果不明**：数据库可能已提交而响应、后置检查或本地落盘失败。不能因无ack就重发，不能自动down、回滚、补齐或补偿。独立Inspect只读且一次性，可能因状态漂移/窗口过期无法证明结果；不能假定失败即未写。只读元数据也不能保证审计绝对完整。
- **私密与日志**：私钥、JWT和未使用测试付款材料会进入本地内存，控制请求只发给固定租户域；Neon连接凭据仅交给其提供者。提供者/服务端日志、dump、TLS缓冲及不可擦除JS字符串可能暴露信息。只保存脱敏证明/摘要，不保存凭据、HTTP正文、lease token或原始异常；dispose不保证物理擦除所有副本。
- **三个永久槽**：Run在私密读取前独占写入并fsync `techlong-express-k2c-ready-v1.permanent-slot.json`；事务前另写`.write-slot.json`；Inspect在其私密读取前写`.inspect-slot.json`，均位于F盘固定目录。槽落盘后再核验时限/事实窗口。即使实际SQL/HTTP尚未发出、部分落盘或凭据失败，均不自动删除、复位、换清单绕过、重跑Run/Inspect或重试写入；保留旧槽与全部证据。Inspect不依赖成功ack，但需要已落盘准确写intent和program；无法恢复完整证据就停止另审。
- **时限/费用**：入场最多两小时且早于workload到期至少45分钟；执行/Inspect严格在入场截止后15分钟或workload到期前10分钟中较早者结束。**固定workload到期仍是2026-10-16 07:04:28.726 CDT（UTC12:04:28.726）**，旧Janitor不关闭、不续期。清理不保证准时、覆盖所有资源或账单归零。Cell/Aurora/Fargate/Secret/ECR仍收费，数据库/API/日志/网络使用非零费用；50 USD/月只是目标，不是cap。

不扩展F3c9、Grant、镜像重发或其它支线。成功后必须分别报告平台终态、独立应用配置与承载当时证明，以及固定到期/仍存费用；不把本次协调描述为永久可用或全面自动部署验收完成。
