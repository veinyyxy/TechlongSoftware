# D002 C5a：bootstrap 与初始化后 ready 接线

2026-10-14 America/Winnipeg。接续[C4h已提交权限及实际应用IAM登录](./aws-auto-deployment-aurora-dual-mode-c4h-application-activated.md)，直接推进应用交付主线，不再C4激活/SQL探针或F3c9。**本阶段是代码与GitHub云端构建验证；不读取AWS Secret值、不连接Aurora/Neon、不初始化业务或部署资源。** C4h持久权限、旧资源/Secret及所有历史槽保持，不重新核验或改写旧SHA来执行新代码。

**C5a已完成编码及云端构建验证**：准确服务端源码`760e632c72874a36b04e13554a5294ee8f224688`的CI38678047208和两候选镜像38678047220全部success，所有steps独立核对；候选未发布ECR、未部署ECS。云构建通过不等于实际数据库ready，唯一下一步为下述C5b接线。[源码/门禁/候选artifact及CA证据](../ops/aws-sandbox/reviews/aurora-dual-mode-c5a-cloud-validation.json)。

## 已实现的最小接线

- 新服务端 `services/saas/tenant-readiness-v1.cjs`，由真实 `app.js` 调用。构造不I/O，不创建AWS/Secret客户端；不授予权限、初始化、DDL或写业务。
- `/health`仍纯liveness。新增 `/bootstrap-ready`，严格模式检查准确SQL身份/数据库OID/role OID/版本、客户端和后端TLS、只读repeatable-read及13个实际业务/控制表的存在/四项DML权限、public USAGE/原singleton函数EXECUTE。Express还必须rds_iam MEMBER=true、INHERIT/SET=false。返回仅aggregate status，不暴露目标/用户名/OID/配置/提供者错误。
- `/ready`在严格模式复用上述检查，再检查已提交初始化：准确external instance、active/provisioned、受审desired configuration hash、正epoch/provision intent、marker/hash格式、metadata/结果receipt与持久epoch字段一致、八entitlement记录、唯一active默认店铺/非空店铺profile及active owner。缺少任何项均503；空的迁移seed不再被当作已ready。
- bootstrap/ready严格检查分别正常5/6查询、各一个owned READ ONLY事务；5秒总deadline，失败不重连/重试，提交前至多一次只读ROLLBACK、提交后不补偿。超时尚未返回的pool借用到达后丢弃，不派发迟到SQL；同kind并发共享in-flight检查但不缓存已完成结果。
- 商户初始化继续复用 `/api/saas/provision`，既有mTLS/JWT、实例身份、幂等键和external epoch/CAS代码不改，不新建旁路SQL初始化器。店铺/用户名仍采用此前确认的Techlong Sandbox / techlong_sandbox_admin；本阶段没有生成、读取或设置真实密码。

### Full / Express 兼容

Express默认且必须`APP_READINESS_MODE=tenant-v1`，显式legacy降级或未知mode拒绝。新增模式需五个明确运行时字段：

| 字段 | 来源/用途 |
| --- | --- |
| APP_READINESS_MODE | tenant-v1；不是执行授权 |
| PG_EXPECTED_DATABASE_OID | 独立实际SQL观察；本租户C4h为16459 |
| PG_EXPECTED_ROLE_OID | 独立实际SQL观察；本租户C4h为16456 |
| SAAS_INSTANCE_ID | 当前受审app instance身份，不是本地迁移随机singleton UUID |
| APP_EXPECTED_CONFIGURATION_HASH | 当前不可变配置快照SHA，不从租户可变metadata自选 |

Express仍使用原v2 binding/17.9/ATS roots与ECS动态IAM签名，不使用Source Login、静态AWS key、数据库密码回退或持久IAM token。仅验证已注入四键的结构，不调用Secret API，也不声称证明实际Secret ARN/version读取来源。

旧Full未设置新mode时保持`pool.query('SELECT 1')`的原连通性语义，不能把它报告成新严格初始化证明。新受审Full部署可以显式tenant-v1，使用其自己实际OID/用户/数据库和原16.14/RDS-CA/password路径；不复用Express OID、不改旧wire、连接/密码来源与会话规则。本轮公开RDS CA包的新pin维护单独列于下文。

平台新增纯 `buildTenantReadinessConfigurationV1`，为两种profile生成这五个数据字段和准确path，不注册/启动Task、不安装参数、不获取凭据，任意看似正确OID也不能成为真实证据。原Full配置默认值和旧模板保持。

## 必须避免的启动环

初始化前`/ready`应503，但需要先能调用受保护的provision路由。新Express部署的**ECS container与ALB target健康路径应采用 `/bootstrap-ready`**，初始化后由部署验收另查`/ready`及authenticated control reconciliation。bootstrap健康不等于deployment ready，不能据此markReady。

本阶段只生成上述健康路径候选；旧Docker/CFN默认`/ready`和现有worker/control-health前置规则尚未改成新Express路径。**不得直接用旧模板部署本新Express应用或依赖ALB unhealthy fail-open初始化。** 下一C5b必须在独立Express workload/控制握手适配中补齐这个路径，同时保留Full及原worker的最终配置/epoch/image验收。

## 验证与证据层次

服务端8新+54相邻，共62项定向测试通过；平台3新+6相邻共9项通过，双方typecheck、Node syntax和平台定向lint通过。初次本机loopback测试在sandbox出现fetch失败；允许loopback重跑后通过，并保持旧Full的pool.query stub语义。13个必需表名与已保存C4h实际73表清单本地核对一致（修正草稿中的operation表名），没有追加SQL读取。

既有双镜像workflow新增network-none最终镜像自检：app检查真实HTTP wiring，lifecycle只检查共用核心，不要求其打包app.js。原安全扫描、Full/dual/V4/V5/V6门禁、只读GitHub权限及无AWS/OIDC/ECR发布边界保持。准确修正源码的云端构建已通过，不能把unit/镜像加载当作实机ready证明。

### 首次云构建失败及公开CA pin维护

首个源码`87ec0c0d3f73f1856302262c3b1fb7e496ed97c9`已推送；CI38677690258的check通过，但docker与双镜像38677690029的app/lifecycle构建均在同一公开RDS global bundle校验处失败，未到readiness self-check。旧pin为`fe45bbeb...`，没有跳过SHA、TLS验证、扫描或冻结测试。

已通过严格HTTPS、无重定向读取AWS官方global包两次并第三次与原公开归档对比，同时读取官方ca-central-1 regional包：当前global为174560 bytes、114个有效自签CA，SHA `90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b`。原111个证书DER指纹全保留，只新增sa-west-1的RSA2048/RSA4096/ECC384 G1；加拿大三根未变且均为新global子集。regional SHA为`7e458e5489c48a92217efbe527da1203dc0fddebd802261fae9eed85fedb1e9f`。[AWS官方根CA及公开下载说明](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)。

只更新当前app/lifecycle Dockerfile、对应Full prepared CA loader的**准确新SHA**及其定向测试；仍仅接受一个编译时固定SHA，不自动学习或接受任意新包，不关闭hostname/CA验证。旧公开文件`F:/ChatGPT_workshop/techlong-rds-truststore-20261007-f2f.pem`、旧镜像/收据/槽和历史pins不改；Express ATS根不变。旧migration镜像及脚本不在本轮构建范围，其旧CA pin保留，未来若要重新构建/使用须另核对，不冒称本次已验证。

修正源码`760e632c72874a36b04e13554a5294ee8f224688`已推送，21项CA/container/readiness相邻检查通过；[新CI38678047208](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38678047208)于UTC03:47:32、[双镜像38678047220](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38678047220)于UTC03:48:03全部success（Winnipeg10月14日22:47/22:48 CDT）。app job116236032493、lifecycle job116236032929全部steps通过，包含新增readiness、原Dual/V4/V5/V6、实际容器自检及依赖/OS HIGH/CRITICAL门禁；CI check116236032154/docker116236032141也全部通过。新bundle比旧bundle多信任三根其它区域RDS CA，是候选镜像内容变更，不是已部署trust变更；实际发布/部署清单须绑定这一准确源码及镜像，不能沿用旧153efbc镜像证据。

两checked候选artifact仅保留一天：app11947206142 / lifecycle11947375839，截止UTC2026-10-16 03:47:54/57（Winnipeg10月15日22:47:54/57 CDT）。本轮只核对artifact元数据，不下载大镜像；ZIP SHA不是Docker config或ECR manifest digest，过期后必须按同一受审源码重新构建并重新核对，不能假称仍可promotion。保留原87ec失败、其CI check成功和这次新源码成功的区别，没有重跑旧失败槽或任何AWS写。

当前严格readiness是运行时必要条件，不是全部生产安全/配置证明：

- 13关键表/权限不是重算完整73表目录pin；C4h完整目录是前置实机历史，未来部署仍需当前结构准入。
- configuration hash检查的是受审expected与已提交metadata，**不是重新计算全部effective themes/entitlement值**。后续必须通过现有authenticated `/api/saas/control` 的实际配置快照、epoch和immutable image进行独立最终reconciliation。
- owner检查是存在/active，不读取password hash或验证真实管理员登录；不能证明第一位owner就是已确认用户名或密码可用。初始化受审payload与后继认证验收承担这个证明。
- 检查不执行STScaller/Secret版本独立回读；Source签名C4h登录不是ECS role/session/SCP/KMS访问证明。当前无实际ECS/ALB/Secret注入或ready通过记录。
- 新public endpoint只给200/503与status，但会暴露少量可用性信息并可消耗pool/数据库成本；in-flight限制不是rate-limit或费用cap。真实运行需合理健康频率，50 USD/月仍是目标而非硬cap。

## 唯一继续位置

云端CI及两候选镜像已通过。C5b集中完成Express bootstrap控制握手/新workload健康路径、四键Secret兼容的首位密码来源、既有provision payload和最终reconciliation接线，准备一次受审ECR→ECS与初始化验收范围；不再增加同类SQL探针/Grant/恢复支线。

实际Secret值读取、初始化业务写、ECR发布、Cell/ECS/ALB创建或更新都仍需具体fresh资源/变更清单确认。不得使用C4h f6e1...批准来执行C5a新代码，也不把代码提交/CI授权视为云部署授权。
