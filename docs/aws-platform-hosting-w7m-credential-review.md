# W7m：固定 Web Secret、Neon 密码与 LOGIN 待审

本阶段接续 W7l 已安装角色 OID **196608**，只为平台 Web 准备专用凭据。代码/CI/准备清单不授权执行。实际写入需另行确认原始清单完整 SHA；不沿用已消费的 W7l 安装批准。

## 准确资源和顺序

账号 `402010193138`，区域 `ca-central-1`，Source 固定为既有 `techlong-sandbox-dev` IAM User（UserId绑定）。角色只允许 `techlong_platform_web_acceptance_v1` / OID196608，不改授权、所有权、成员关系、连接上限5或 search_path。

AWS最多三次写：

1. CreateSecret：准确名称 `techlong/sandbox/platform-web/neon-v1`，先创建**无值**对象，使用只读清单绑定的现有 AWS-managed `aws/secretsmanager` KMS Key ARN，Environment=aws-sandbox / Purpose=platform-web-neon-v1 / ReviewSha256 标签。
2. PutResourcePolicy：在该准确新 ARN 安装 Source-only 显式 Deny 保护，BlockPublicPolicy=true。除准确 Source 之外拒绝 GetSecretValue 与清单中的管理动作；不是给任何人新增 IAM Allow。独立检查空版本、准确策略、Key、标签、无复制/轮换/删除标记后才前进。
3. PutSecretValue：此时才生成48随机字节（384bit）的64字符 base64url 密码，写入准确 UUID 初始版本，要求唯一版本/AWSCURRENT。载荷仅 `schema` 与 `databaseUrl`，后者仅含该 Web 角色、固定 Neon 目标、verify-full/channel_binding=require，不含 owner、App 私钥或 Stripe 凭据。

随后一次既有角色的 `ALTER ROLE ... WITH LOGIN PASSWORD`，在一个 REPEATABLE READ READ WRITE 事务里发送。15表 ACCESS SHARE 短锁、九条元数据预检（七目录/有效权限/提供者配置）必须匹配 W7l 完整已审目录，角色仍 NOLOGIN；首次 ALTER前预检须不足30秒。托管设置要求 `password_encryption=scram-sha-256`、`neon.forward_ddl=on`，不关闭 hook、不走 Neon API。持久 SQL 只有此一条，不新增 grant。

事务内九条元数据再次要求只有 LOGIN=false→true；持久记录提交意图，COMMIT一次并保存ACK。异常尝试本地 ROLLBACK，但不据此推断 Neon 外部同步已撤销。

成功或失败后，都独立尝试第二个 owner TLS 连接/只读事务/九条元数据。仅当看到准确角色 LOGIN=true、Secret创建和版本写入收到ACK且三项 Secret 元数据再次完全一致时，才至多一次 GetSecretValue（准确 ARN+UUID+AWSCURRENT），严格校验载荷，并用固定版本密码发起一次专用 Web 角色 TLS 认证。该连接只运行一个身份/roleOID/只读状态/search_path 元数据 SELECT；不读取业务行、密码哈希或尝试管理员登录。

成功必须同时满足：明确COMMIT ACK、独立角色/权限无漂移、固定版本正确、准确角色真实认证成功、errors为空。任何异常均 `CREDENTIAL_REQUIRES_REVIEW_NO_RETRY`，不是自动恢复成功。

## 边界与额度

- 最多3次Secret写、1条角色密码/LOGIN SQL、1次固定Secret值读取、2个owner连接+1个专用角色连接。正常成功路径为37条元数据SELECT（owner初检9/事务前9/事务后9/独立9/专用1），没有业务行SELECT。AWS最多20次服务读取（包括失败的名称不存在查询和CLI KMS metadata）+3次写；凭据刷新自身网络交互不计服务资源调用，不承诺提供者内部不重试。
- 运行前先只读核对 Source、名称仍空闲、Key及策略验证；失败不会消费新执行槽或连接数据库。之后 wx+fsync 消费 `F:/ChatGPT_workshop/techlong-platform-web-credential-v1.intent.json`，才连接数据库。占用永久保留、不自动删除/复位/换槽/重放。发生写入不明、登录或回读失败，需另审恢复/只读范围。
- 清单48小时，最晚启动为到期前10分钟；执行写入受20分钟活动窗口和外层到期双重限制，SQL/COMMIT前复核。Source按既有 AWS Login 自动刷新，不要求单份凭据覆盖全窗口；刷新可能失效。CLI/SDK均禁应用重试，Secret元数据和SQL不是跨服务CAS。
- AWS公开标准单价约 **0.40 USD/Secret/月 + 0.05 USD/10,000 API调用**，按实际保留及区域账单为准；失败空对象/有值Secret可能持续收费，无自动删除。一个Secret的2小时存储示意约0.0011 USD，不是总费用承诺；新身份可能在hosting结束后仍存在。50USD/月仅目标，不是硬限额；两小时hosting尚未开始。[AWS价格](https://aws.amazon.com/secrets-manager/pricing/)

## 必须接受的风险

**Neon 明文接口兼容性。** Neon 不支持预哈希密码，必须把原密码通过认证TLS放入固定 ALTER ROLE 字面量；密码在PostgreSQL存储时加密，但服务端/提供者/同步日志可能记录SQL或明文。不能用普通 `$1` 替代 PASSWORD 语法，也不能重演旧 SCRAM verifier 路径。输入限本程序随机64字符，拒绝引号和任意SQL，不保存 SQL/URL/密码/verifier 到本地、Git或回执。JS字符串不能可靠立即清零，也不能保证外部日志无敏感内容。[Neon官方接口](https://neon.com/docs/manage/roles#manage-roles-with-sql)、[PostgreSQL日志风险](https://www.postgresql.org/docs/18/sql-alterrole.html)

**跨服务非原子。** 可能遗留收费空Secret、受保护Secret、已写凭据、已LOGIN角色，或丢失COMMIT ACK/托管同步状态不明。即使本地回滚，外部结果可能已改变；提供者hook可能自行重试。没有自动补齐、改密码、NOLOGIN、撤权、down、删除或换新槽。不可用当前旧批准重放；人工作新事实审阅。

**并发与权限敏感性。** 表锁不锁住集群角色/ACL或AWS对象；元数据核验不能消除并发竞态。创建空对象到保护安装有间隙；如果外部写入导致非空或策略变化则停止。Source本身或有能力改变该Source权限的管理员仍可影响状态，Source-only并非不可变隔离。新Role LOGIN激活后，W7l已审哈希SELECT、会话INSERT冒充、整表未来列、PUBLIC TEMP、创建者ADMIN（无SET/INHERIT）、非行/非跨数据库隔离风险实际可通过其凭据使用。此凭据不限定只能在AWS使用，也不自动两小时失效；清理/禁用另审。

**Secret与运行时暴露。** 初始策略拒绝未来 ECS execution role 读取，尚不可直接部署；后续需独立准确IAM/资源策略handoff。版本固定不代表自动轮换；将来ECS环境变量注入会对容器进程、调试及日志暴露敏感值，更新Secret不自动更新已有任务。[ECS说明](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)

Source只调用准确AWS官方端点，现有owner凭据只发到原Neon TLS目标，不交给Web/Secret/GitHub。固定UUID值只发给AWS及原Neon；正常角色认证必然把密码交给该数据库认证机制。禁错误文本/detail/stack/query输出，仅保留阶段/SQLSTATE/安全分类。Secret值读取本身仍有网络/提供者日志和内存风险。

## 本阶段不包括

不新增IAM、不改Key、不改其他Secret/角色/ACL/业务数据、不启用controller/worker/apply、不读私钥、不登录管理员、不调用Stripe、不构建镜像、不注册task、不部署ECS/Cell、不删资源。普通PostgreSQL CI只证明语法、真实密码认证、事务与收尾顺序，AWS仍为内存double；`neon.forward_ddl=on`在CI是自定义GUC，不模拟Neon hook，不能证明真实托管提交成功。

执行后仅在成功真实证据基础上推进[固定版本task接线](aws-platform-hosting-w7m-task-handoff.md)的独立待审材料；Secret/IAM/两小时HTTPS部署及后续清理仍分审。
