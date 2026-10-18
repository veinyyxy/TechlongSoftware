# W5e-R1：Neon 兼容恢复清单与完整风险

2026-10-17 Winnipeg。用户本轮仅要求**准备兼容恢复清单**。独立入口 `ops/cloud-worker/install/run-recovery-v5.mjs` 已编码，不替换原 InstallLocked，不重放439ab7dc清单，不改变原槽或失败源码。Review 只读；只有用户以后明确批准新的 fresh SHA，才允许 RecoverLocked。当前未生成生产新密码、未读原私密文件、未写 Secret 或 Neon，也未激活工作流。

## 准确复用范围

已有五资源 foundation 栈 UUID `308174f0-ca9e-11f1-a04d-02569e9287b5`；role ID `AROAV3GNMXTZK5O45RG24`；journal table ID `ea69c69e-1c48-481a-83f0-36393c196d9f`。保持 deny-all trust、原 inline/boundary v1、表禁TTL/删除保护、桶全部安全设置和原 IAM 不变。

仅复用以下两完整 ARN，不按名字回退、不创建 Secret、不改隔离策略/标签/KMS：

- 数据库：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/neon-control-v1-pVKVEV`，唯一拟写版本 `ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e`。
- 控制：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/control-first-acceptance-v1-CatDWK`，唯一拟写版本 `2854e7b6-6c3c-41be-a5d8-b87dd9d98810`。

角色/schema 仍是 `techlong_cloud_worker_v5`；四函数仍是 read_state/claim/lease/complete，源码、owner16392、窄 EXECUTE、无基础表权限的合同不变。只在目标不存在时创建，没有 OR REPLACE/IF NOT EXISTS/ALTER PASSWORD 回退。

## 相比失败入口的两个必要变化

**Neon 原密码接口。** [Neon 官方角色文档](https://neon.com/docs/manage/roles#manage-roles-with-sql)要求 SQL 提供原密码，不支持预哈希。恢复使用48随机字节（96位hex）原密码，只在批准后的进程内存生成，通过固定 SQL 的 PASSWORD 字面量经认证 TLS/Neon HTTPS 发送。固定96位hex白名单不接受引号、URL、SCRAM verifier 或任意 SQL；不能用普通 `$1` 代替该 utility 语法。数据库必须已设置 `password_encryption=scram-sha-256`，并保持 `neon.forward_ddl=on`；入口仅检查，不改变这些设置、不关闭提供者 hook、不调用 Neon Console/API 创建带管理权角色。

**先持久化两份最小材料，再提交 Neon 事务。** 这是相对原安装顺序的明确变化，不是暗中续跑。两 Secret 都必须先核对隔离策略且确实没有版本，包括 deprecated/无标签版本；新版本一旦存在就不能再次写或恢复旧入口。[完整版本枚举](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_ListSecretVersionIds.html)用于弥补仅 DescribeSecret 可能漏掉无标签版本的边界。固定 VersionId 并不授权重试；AWS 不允许用不同值修改同一版本，[PutSecretValue 语义](https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_PutSecretValue.html)不能替代本入口的单次槽。

先存材料的好处是 SQL/认证失败时密码仍有受控保存位置，不会再次随着进程退出丢失；代价是失败可能留下已有值但数据库尚未就绪的 Secret，以及可独立使用的控制签名/mTLS 材料。只有 Source 与尚未激活的 worker role 可按新资源策略读取；旧 task role 的宽读取仍被显式拒绝。当前入口的 Source **不调用 GetSecretValue**；以后若需从这些版本恢复，仍需另给准确读取/写入批准。

## 一次未来受审执行的顺序与上限

1. 检查准确 Source IAM User/ID、全部既有资源和25份历史原件/旧槽 SHA。只读核对 Neon 目标仍不存在、PUBLIC/owner/ACL/触发器未漂移，及精确无敏感值的 provider flags。比对两个 Secret 的完整版本集为0、无轮换/复制、准确标签和资源策略；遇到未知/漂移停止，不修复。
2. 核对新清单 SHA、source/action/历史/材料公开摘要、clean main 和 Node22.19.0。清单有效两小时；fresh preflight 采集耗时不超过180秒，完成后30秒内才可占槽；每次写前重查批准时窗，执行最多20分钟。这不是跨服务 CAS。
3. 新固定独立永久槽为 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-neon-recovery-v1.permanent-slot.json`。本清单须明确授权**一次新的尝试**；保留旧槽 `techlong-cloud-worker-v5-install.permanent-slot.json`。新旧槽都不自动复位，换 manifest/目录不能绕过。
4. 原目录 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2` 的 JSON 最多一次新读取，保持原 ACL/文件不变。原八字段（包括未使用的 Stripe test 字段）会进入进程内存；只投影 schema/app ID/五 PEM，验证旧公开指纹及密钥/证书。Stripe不上传、不调用、不签JWT、不发控制HTTP。新48字节密码此后只在内存生成；不恢复或猜测上次未保存的密码。
5. 对两个既存 ARN 各一次 PutSecretValue，均使用上列固定 UUID。数据库只写新窄角色 DSN，控制只写最小 PEM 投影，不上传 owner DSN、Stripe 字段或原整包。写前再次确认空版本/隔离策略，写后只读核对完整版本集正好1个 AWSCURRENT；不读取值核验、不产生其它版本。
6. 再只读核对 Neon catalog 未漂移，执行**一个** Serializable 安装事务。新角色 LOGIN/NOINHERIT/NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS；专属 schema/四函数源码与原合同相同；末尾检查有效权限，失败则数据库事务不能正常提交。非超级用户 CREATEROLE 创建角色时，创建者会获得 ADMIN=true、SET=false、INHERIT=false 的自动成员资格，属于本次范围；不是给新 worker 继承 owner 权限。
7. 成功 ACK 单独保存后，用内存中的新窄凭据做一次只读 catalog 认证；再独立只读核对 AWS/Secret/Neon 元数据，保存实际安装绑定。另一个新进程 Inspect 不读私密包或 Secret 值，只验证元数据/OID/源码/ACL，不伪称再次认证或云端 OIDC/Secret 读取已通过。

上限：**2个 Secret 固定版本写、1个 Neon 安装事务、1次新的原私密 JSON 读取、48随机字节密码生成**。AWS 创建/删除/IAM/资源策略修改0，Source Secret值读取0，业务行DML0，GitHub写0，workload/Cell/ECS/ALB/RDS创建0。不发布/调用Lambda、不改authority、不创建job、不初始化租户/修改原store/ready_at/历史。

## 完整风险与停止规则

- 密码原值进入服务端 SQL 和 Neon 托管控制平面，可能出现在提供者、审计、调试、内存或转储中。本机日志/回执不保存明文，不保证所有外部日志都不记录；JS释放引用不能保证取证级擦除。verifier 方式已不符合接口，不能因普通PG通过而悄悄换回。
- 先两 Secret 后数据库，没有分布式原子性。失败可能留下一个或两个已有值且收费的 Secret、已LOGIN角色、schema/权限或托管控制面密码状态。数据库 COMMIT 失败/丢ACK不等于提供者副作用全部撤销；Neon hook 内部也可能重试，不属于本应用 SDK 的可控制范围。
- 应用/SDK写请求最多一次（maxAttempts=1），每步先intent后ACK。失败/未知立即停止；没有清理、撤权、NOLOGIN/down、改KMS/策略、补齐、换版本、自动回滚或重试。新槽一经占用即不自动复位；只能独立只读 Inspect 再决定新范围，不能把这份清单续成通用恢复权限。
- 传播、角色/策略/目录变更、本机文件/ACL与提供者状态都存在并发竞态；VersionId不可变不代表跨服务CAS。管理员可改变文件、IAM/桶策略或本地槽；本程序永久槽是可信代码约束，不是抗本机管理员篡改的硬件保证。
- 保留原[安装完整风险](aws-auto-deployment-cloud-worker-w5e-installer.md)：精确 inline 与 action-cap boundary 的差异、区域级 metadata Resource:*、S3 ListBucket能力、DDB条件写依赖可信代码、桶版本化非WORM、public/main未保护等。当前仍完全不激活OIDC/workflow，所以数据库认证成功也不是自动部署已上线。
- 不新增常驻计算或 Secret 对象，但现有 Secret、版本、请求、DDB/S3和原Cell/ALB/Aurora等仍可能收费。50 USD/月为目标，非硬上限或停费保证。不自动删除任何原资源以省费。

错误仅保存 allowlist类别、5字符SQLSTATE、有限HTTP状态、阶段和尝试/ACK计数；不保存message/detail/query/stack/cause/DSN/password。COMMIT ACK 与后续 catalog 失败分开记录，避免再把所有失败折成未知原因；这仍不能自动证明唯一根因。

## 验证与执行门禁

候选CI增加真实PG18、非超级用户 CREATEROLE 创建者、原密码认证/错密码拒绝、整个权限事务回滚/PUBLIC权限扩大拒绝、准确四函数/OID/ACL以及自动ADMIN成员属性验证。Neon forward_ddl 的 GUC 在自有PG容器中显式模拟，**没有真实托管密码转发证明**；真实 Neon 写验收只能在新的批准执行中完成，不为验证重放旧SQL。

```powershell
node --experimental-strip-types ops/cloud-worker/install/run-recovery-v5.mjs --mode Review --output F:/ChatGPT_workshop/techlong-w5e-recovery-review-<fresh-id>
node --experimental-strip-types ops/cloud-worker/install/run-recovery-v5.mjs --mode RecoverLocked --manifest F:/ChatGPT_workshop/techlong-w5e-recovery-review-<fresh-id>/manifest.json --approved-sha <NEW-EXPLICITLY-APPROVED-SHA> --output F:/ChatGPT_workshop/techlong-w5e-recovery-run-<fresh-id>
node --experimental-strip-types ops/cloud-worker/install/run-recovery-v5.mjs --mode Inspect --run-directory F:/ChatGPT_workshop/techlong-w5e-recovery-run-<fresh-id> --output F:/ChatGPT_workshop/techlong-w5e-recovery-inspect-<fresh-id>
```

`<...>`是接口占位，不是批准。唯一下一步是候选代码/云CI通过、最终clean main上只读 fresh Review，再集中请求本页精确范围的新SHA批准。原批准不能复用，当前“准备清单”不授权执行；不重开F3c9/F3b3支线或Sites，不提前部署或激活。
