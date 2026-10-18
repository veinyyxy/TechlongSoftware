# W5e：一次性 Locked 安装器

2026-10-17。这是 W5d 安装范围的实际代码，不是另一个盘点器。入口在 `ops/cloud-worker/install/run-install-v5.mjs`，只有 `Review`、`InstallLocked`、`Inspect`。**本轮实现、测试和生成待审材料，不代表允许执行安装。** 旧 W5d design-review SHA 不可用于这个入口。

## 收口方式

先一次安装下面的基础资源并独立核验，始终保持 OIDC deny-all；然后用真实 role/table/Secret/function ID 和准确不可变 reusable workflow commit 准备一次激活审批。拆开的是“Locked 安装”和“激活”，不是把每个资源再拆成审批支线：真实 ID 在创建前不存在，不填假值，也不提前开放运行身份。实际租户部署仍需新的 held job/fresh Review，不能重放 W4c。

候选 caller/reusable 文件已在 `ops/cloud-worker/workflow-candidates/` 接线，但没有复制到 `.github/workflows`。caller 的 `REVIEWED_REUSABLE_COMMIT_REQUIRED` 是刻意不可执行的标记，不能直接发布。激活阶段仍须创建 owner 审批/main-only environment、发布准确文件、把最小公开安装绑定写入固定私有版本桶并最后开放准确 trust；这些**不是本清单授权的写入**。本阶段不修改 GitHub 配置、不尝试 STS OIDC、不读取云 Secret 值。

## 待审安装的准确动作

1. Source 精确身份、既有 IAM/OIDC、全部候选名及 Neon catalog 只读复核。Source 必须是账号 `402010193138` 的 `techlong-sandbox-dev`，UserId 也必须匹配；登录自动刷新只解决凭据，不扩大授权。
2. 校验清单正文 SHA、完整 action recipe、源文件/LF SHA、main commit、Node22.19.0、公开 capsule 和私密材料的公开 summary/binding。Review 不读私密文件内容。批准有效期两小时，执行开始时必须仍有效；整个执行最多20分钟。fresh preflight 总耗时最多180秒、结束后30秒内才可占槽；这些是事实窗口，不是跨服务 CAS。
3. 创建固定本地永久槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-install.permanent-slot.json`。槽不按清单 SHA 分配，换一份清单也不能绕过旧槽。不覆盖、不复位、不自动补齐或重试。
4. 最多一次 CreateStack：`techlong-sandbox-cloud-worker-foundation-v5`，五资源为新 boundary、新 worker role、永久 DDB journal、私有版本桶和桶策略。`CAPABILITY_NAMED_IAM`，禁用失败回滚，开启栈删除保护。核对准确 UUID、原模板、五资源、deny trust、精确 inline/boundary、删除保护、禁 TTL、桶全部安全设置后才继续。
5. 两个固定新 Secret，各一次不带值的 CreateSecret、一次 PutResourcePolicy（BlockPublicPolicy=true）。**两个 Secret 均独立回读隔离策略、版本为空后，才允许私密读取/数据库安装。** 不修改旧 task role；新资源策略隔离旧 `techlong/sandbox/*` 宽读权限。使用 AWS-managed 默认 key，不添加 KMS 权限。
6. 读取原目录 `F:/ChatGPT_workshop/techlong-d001-credentials-20261013-r2` 的私密 JSON **最多一次**，保持原文件/ACL 不变。读取前只读检查原两主体 ACL、文件类型/硬链接/路径和公开历史。原 JSON 有八字段，**Stripe test 字段也会进入本机进程内存**；只投影五个 JWT/mTLS PEM，验证原公开指纹、密钥配对、CA/client 证书后保留最小控制材料。Stripe 字段不上传、不认证、不使用；不签 JWT、不发 HTTP 请求。JavaScript 释放引用不保证取证级擦除。
7. 生成48随机字节密码（96位十六进制），只在内存构造 SCRAM-SHA-256 verifier。经 TLS/Neon HTTPS **一个 Serializable 事务**创建专属 LOGIN/NOINHERIT/无管理权角色、专属 schema、四个固定 SECURITY DEFINER 函数和窄 EXECUTE；最后一条语句检查有效权限和函数 ACL，不满足则事务不提交。不向 SQL 发送明文新密码、不改 owner 密码、不上传 owner DSN。PostgreSQL 接受预编码 SCRAM verifier 原样保存。[官方 CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html)。verifier 本身仍是敏感认证材料，可能进入提供者日志，不在回执保存。
8. 用新凭据执行一次**只读 catalog**，证明能认证及固定 OID/源码/owner/ACL/角色有效权限。随后分别一次 PutSecretValue 写入两个预定版本，再只读核对版本/策略及 Neon/AWS 布局。数据库 Secret 只有新窄角色 DSN，控制 Secret 只有 schema/app ID/五 PEM。两个新 Secret 均无 Source GetSecretValue。
9. 保存实际安装绑定；**没有 trust 激活方法**。另一个全新进程运行 Inspect，核对实际 ID、版本、源码/ACL、Locked 布局。Inspect 不读取密码/私密包/Secret 值，所以它证明元数据，不伪称再次认证或已通过云端 OIDC/Secret 正向路径。

安装器主动 AWS 变更请求上限为 **7次**：1 CreateStack +2 CreateSecret +2 PutResourcePolicy +2 PutSecretValue；CloudFormation 内部创建/打标签/写 IAM 等操作另由服务执行，不是总 API 计费上限。Neon 写事务最多1个。角色/schema/函数创建属于新的权限安装，不是业务行变更；不创建 job、workload、ECS/ALB/RDS/Cell，不改旧 IAM、业务表 ACL/RLS/触发器、原业务行/default store/ready_at、authority 或旧永久槽。

## 失败与完整风险

- AWS/Neon/本地文件不是原子整体。部分失败可能留下收费栈/Secret、已 LOGIN 的角色、schema/函数或可用权限；禁用 CloudFormation 失败自动回滚也可能留下 CREATE_FAILED 栈。没有自动清理、撤权、改 KMS、down migration、换版本、补齐、重置或重试。只有仍明确未消费槽、未发写的前置失败才可准备新审批；写入或槽已消费后先 Inspect，再由人决定新处置范围。
- SDK `maxAttempts=1`，Neon 安装事务只提交一次。写前记 intent，拿到结果才记 ACK；网络超时、丢 ACK、进程中断不能被当成“肯定没写”。独立 Inspect 没有恢复写权限；缺完整绑定时只保存 partial/unknown 元数据，不推断安装成功。
- IAM/Secret/Neon ACL 存在传播延迟和并发修改竞态；Source/.env/公开历史/私密路径检查也不是不可绕过 CAS。Neon endpoint/owner 指纹必须与本次 fresh prestate 一致，避免中途把 SQL 发到另一个库。管理员/本机高权限主体仍可改文件、角色、策略或本地槽。
- 新增 role 的有效权限由精确 inline 与 action/region-cap boundary 共同约束。DDB 条件写、单次计数、CFN 模板完整性依赖受审代码；泄漏凭据的能力比正常入口宽。S3 版本化/禁止删除不是 WORM；管理员仍可改策略。保留 W5d 对区域级 Resource:*、桶 ListBucket 和未保护 main 的完整说明。
- 私密值经过受信本机/Neon/Secrets Manager 的 TLS/API；提供者、调试、内存转储、依赖及管理员可能接触敏感材料。不保存明文或在普通日志打印，不等于提供者绝对不记录。本阶段不迁移或轮换旧材料；证书到期后需另审更新。
- 本轮安装结束仍不可云执行。GitHub public 仓库/main 未保护，未来 owner 单人审批允许自己审批；这不是双人控制。没有发布 active workflow、创建 environment 或启用 OIDC。最终激活要绑定准确不可变 reusable commit 并做真实 STS/Secret 路径验收；失败不自动放宽权限。
- 两个 Secret 存储参考约0.80 USD/月，另加 API、DDB、S3 请求/存储/旧版本及已有 Cell/ALB/Aurora/ECR 等费用。50 USD/月是目标，不是硬封顶；已有承载过期不等于清理/停费。资源即使只安装一半也可能收费。

## 运行方式与唯一下一步

下列是接口说明，`<...>` 不是可执行批准：

```powershell
node --experimental-strip-types ops/cloud-worker/install/run-install-v5.mjs --mode Review --output F:/ChatGPT_workshop/techlong-w5e-review-<fresh-id>
node --experimental-strip-types ops/cloud-worker/install/run-install-v5.mjs --mode InstallLocked --manifest F:/ChatGPT_workshop/techlong-w5e-review-<fresh-id>/manifest.json --approved-sha <explicitly-approved-SHA> --output F:/ChatGPT_workshop/techlong-w5e-install-<fresh-id>
node --experimental-strip-types ops/cloud-worker/install/run-install-v5.mjs --mode Inspect --run-directory F:/ChatGPT_workshop/techlong-w5e-install-<fresh-id> --output F:/ChatGPT_workshop/techlong-w5e-inspect-<fresh-id>
```

Review 需要 clean main；代码/风险文档变化后必须重新生成，不能重算旧清单冒充批准。先验证候选云 CI（真实临时 PG18、无生产 AWS/OIDC/Neon），然后在最终 commit 上 fresh Review，集中请求一次 **Locked 安装 + 原私密文件一次读取 + 独立只读 Inspect** 的明确批准。通过后才执行。若 Source 失效，只刷新只读材料，不重跑失败安装。完成后的唯一后续为真实 ID 的激活审批，不扩 F3c9、观察器或新部署支线。
