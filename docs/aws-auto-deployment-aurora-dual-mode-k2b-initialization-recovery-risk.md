# K2b：单次人工初始化恢复——准确范围及完整风险 v1

这是**新的单次人工恢复许可**，不是复用K2a读授权、C5h旧部署批准或已过期的job lease。Review/Check只准备，不加载私密包、不读Secret值、不连接Aurora、不签JWT、不发应用HTTP、不改任何记录。必须对最终fresh SHA和本文件完整风险另行确认后才可Run。

## 为什么保留旧job与计划

K1只恢复了新workload，K2a证明当时数据库仍pristine。原deployment `dep_7c99bd249470184852f0dc74` 仍configuring，job `job_202c8dc12a8bf379f3a7c693` 仍running/attempt1/max1且lease过期，artifact_ref仍旧digest；原desired_plan不包含镜像，plan_hash不需要因镜像变化而改写。**K2b不制造新的worker claim、不续租/接管旧job、不伪造更新后的context，也不放宽旧Full/Express validator。**

本清单明确允许：由人工审批绑定的新栈/新镜像/准确旧业务坐标执行一次外部初始化，平台记录暂时保持旧状。因此会有“应用已初始化，平台仍pending”的非原子中间状态。后续K2c必须凭认证验收结果，另审带准确旧值/DB时钟/CAS的短事务协调artifact/失败证据/job和ready；本阶段不能写ready或声称整条自动部署闭环完成。这一人工恢复例外须明确接受，不能暗中借过期lease重试。

## 固定目标与不可改变部分

- AWS账户402010193138 / ca-central-1；Source `techlong-sandbox-user` / IAM user `techlong-sandbox-dev`。不新增IAM、不AssumeRole/Operator/MFA登录、不改Secret/Key/代码/调度。
- 准确新栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/f71252c0-c917-11f1-8148-02ff648cb917`，task definition `tenant-9c5ee9e64509dcad-task-definition:2`，实际digest `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`。
- 控制端点仅 `https://first-acceptance.sandbox.techlong.cloud:8443`，ALB mTLS/ACM server trust + RS256 JWT，准确app `app_e897a4377bce498b9c5ee9e64509dcad` / 原workspace、product、template、配置hash不变。
- DB `tenant_a0da1748bc4d5419_db` / OID16459，应用role/OID16456，PG17.9；原UUIDv8 store `add89a8c-f43e-81b9-8287-0cb6c5c54f87` 不改。店铺名 `Techlong Sandbox`、首位owner `techlong_sandbox_admin`、八项entitlements及buyer/merchant主题均为原受审配置。
- generation1、epoch1/provision/active、原marker/hash及幂等键 `tlctl-0145bf0ce7258eb38b136c783afd0629-e1-3545b14293b00e38` 保持。使用新镜像metadata的body与旧HTTP500请求不同，但仅在当前pristine完整验证后允许一次；若发现已初始化、旧operation或其它差异，停止，不重放或修复。
- 原Cell、网络、DNS、DDB、IAM、Secret版本及平台所有记录保持；不创建或删除任何云资源，不重建数据库、不restore/seed/migrate，不改plan/artifact/job/lease，不启用其它worker。

## 准许的精确动作上限

1. **一次新的Aurora只读预检连接**：以已有管理用户postgres/IAM auth/ATS TLS对准确租户库执行一个SERIALIZABLE READ ONLY事务。复用K2a固定10 SELECT，正常14 query，故障最多一次额外ROLLBACK，单连接/事务不重试。客户端30秒连接、15秒query、服务端statement/idle15秒、lock5秒，该段最长180秒。目录/身份/ACL/ownership/73表计数/默认entitlements/store及13flags必须再次完整pristine；不会重用旧读槽或只把历史SQL快照标为当前。
2. **Run和Inspect各最多一次本地原私密包加载**：准确目录 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2`，继续严格验证五文件/ACL/原summary、binding、RSA和mTLS指纹/证书有效期；不复制/修改原包或生成新凭据。原包包含RSA签名私钥、mTLS私钥/证书/CA及测试Stripe凭据，旧loader会将这些材料读入内存，即使新入口只暴露control/public参数接口；不能称为未读取付款材料。**不调用Stripe、不创建付款，不使用旧payment委托**。
3. **Run最多一次准确运行时Secret固定版本GetSecretValue**：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/tenant/a4377bce498b9c5ee9e64509dcad_a0da1748bc/runtime/g1-T9CqN5` / `0f45d29f-02d4-4117-99b1-c06645aa3c6e` / AWSCURRENT。只读检查前后metadata和真实Neon已verified generation绑定；四key HMAC/JWT/Stripe test/webhook会在内存校验，HMAC经既有HKDF独立域派生同scope/version的首位owner密码。密码不打印、保存或向聊天交付，不把HMAC本身当密码，不创建Secret或轮换。
4. **Run最多四次应用请求**：一次GET `/api/saas/bootstrap`；一次POST `/api/saas/provision`；各一次GET `/api/saas/readiness` 与 `/api/saas/control`。POST编译值仅来自独立重读的原published/archived模板及原配置，明确采用新实际image metadata，而不是伪造已更新的worker context。精确receipt/store/owner、13项初始化readiness、实际image/config hash、有效entitlements/name/themes及其摘要必须匹配。请求/响应正文及其password-bearing hash均不入文件/Git，只存经过验证的非秘密观察。
5. **独立Inspect最多两个GET**：重新加载原私密包并签发新JWT，经mTLS各读一次readiness/control，不再次连接Aurora、不再次读Secret值、不POST。支持POST响应不明后的只读验收，但不保证能判明所有失败；未证明就停，不能自动再次POST。
6. Run前、POST前、Run后、独立Inspect各复用一组35 SDK+11 CLI+1 Neon元数据只读；Run编译及密码绑定另最多五次Neon独立SELECT只读事务、准确Secret两次Describe/一次Get及Source STS确认；SQL入口另一次STS。没有云/IAM或Neon平台写。应用POST内部真实业务SQL写、bcrypt、audit/cache失效及提供者活动不计成“全系统零写”。

## 必须接受的完整风险

- **真实业务写**：一次POST会在租户库事务内绑定instance/epoch/receipt，upsert八项entitlements、写店铺profile及两套主题/配置历史、创建首位owner及password hash、provision操作及审计等；这不是只读探针。新约束/现有权限、函数、触发器或数据并发可能使事务失败；不新增schema、不手动补表。保留原店铺与业务记录，不清理旧残留来强行准入。
- **初始化与平台非原子**：AWS、Aurora、Neon、文件系统和HTTP不是跨服务CAS。成功初始化而平台仍pending是明确接受的中间状态；数据库成功提交但HTTP超时、TLS中断、响应不符/丢失、后验或本地保存失败，都可能成为UNKNOWN。不得将`retryable`错误标志、旧幂等键或job attempt剩余值当重试授权；后续只读核验仍可能无法判定，不能自动补齐/补偿/down/改密码/再POST。
- **并发与事实窗口**：POST前重新核对完整承载/旧平台/IAM/固定Secret元数据，结束后距提交最多30秒；本次pristine SQL回执距POST最多120秒。二者仍非原子锁。其它管理员或应用可能并发初始化/改owner/config/epoch；单个SQL事务的快照及服务端epoch/幂等约束不能消除所有竞态。任何漂移停止，不增权/忽略差异。
- **私密暴露**：本地管理进程、调试/崩溃dump/内存、AWS/数据库/网络提供者及日志可能观察凭据、metadata或用户名。只对固定AWS官方服务及固定mTLS控制域使用相应凭据；owner密码会随唯一POST发给该租户服务，由其bcrypt保存。复用旧包会短暂在内存载入未使用的测试付款材料。尽力dispose和清除可变引用，不保证所有JS字符串、TLS缓冲或提供者日志彻底擦除；不写密码/token/正文/其敏感派生hash或原始异常。
- **Source/认证与TLS**：既有AWS Login可能自动刷新，也可能在中途失败；IAM传播、证书期限、服务器证书与公网DNS变化可能失败。数据库postgres权限高于应用role，本入口仍只允许冻结只读SQL，严验ATS/SNI/backend TLS；应用用mTLS及JWT双认证，不禁用证书验证、不修改trust或降级。失败不自动修复凭据/权限/证书。
- **一次性永久槽**：Run在连接/加载私密材料前独占写入+fsync固定 `F:/ChatGPT_workshop/techlong-express-k2b-initialization-recovery-v1.permanent-slot.json`；POST前另占同prefix的`.post-slot.json`，只存非秘密intent。消费后即使未送出请求、网络失败、提交不明或文件保存失败，也不自动复位、补齐、重连、重发、恢复Run或换SHA绕过。局部写入/落盘失败可留下占槽文件；所有旧槽/证据保留。Inspect只读不复用写能力，新的尝试须明确另审。
- **时限和计费**：入场最多两小时且早于K1固定到期至少45分钟；应用执行/Inspect窗口至入场截止后15分钟或K1到期前10分钟中较早者。SQL/私密/应用段共用360秒中止信号，各元数据组另限180秒；超时不重试。**workload仍固定2026-10-16 07:04:28.726 CDT到期**，原Janitor保持可能清理，不保证具体清理时刻/账单归零。SQL连接及应用访问可能唤醒/使用Aurora并产生ACU/I/O、日志、网络、Secret API等非零费用，READ ONLY不等于底层零磁盘副作用。既有Cell/Aurora/Fargate/Secret/ECR持续收费，50USD/月为目标非硬cap；不延期/取消清理或创建替代资源。

本文件固定绑定，不回填结果。即使独立应用初始化/有效配置验收成功，仍必须报告`platformReady=false`，另做K2c协调及完整ready证明；不扩展F3c9/Grant或旧部署重放支线。
