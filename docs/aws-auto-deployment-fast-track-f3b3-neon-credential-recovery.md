# F3b3：复用现有 Secret 的 Neon 兼容恢复入口（尚未批准/执行）

本页为批准前准备记录，原内容保留。用户随后批准3610895c...，已一次COMMIT确认并两次独立只读认证核验；当前继续位置见 [实际控制凭据就绪](./aws-auto-deployment-fast-track-f3b3-neon-credentials-ready.md)。不能再Run本页清单。

2026-10-08 Winnipeg。当前仍为两个收费 Secret 已创建、两控制角色 NOLOGIN、runtime 关闭。原85b500...批准和永久槽位已消费，不能重放；[原失败及独立观察](./aws-auto-deployment-fast-track-f3b3-control-credentials-partial.md)保留。

## 兼容性结论与修正

Neon 官方角色管理文档要求 SQL 密码参数使用原密码、不支持预哈希形式；原入口传入 SCRAM verifier，在普通 PG18 可用，却不符合 Neon 托管密码接口。官方 hook 在 PRE_COMMIT 转发密码到控制平面。这是已证实的接口兼容性差异，但原异常没有 SQLSTATE/提供者日志，不能声称已唯一证明本次失败根因。[Neon 角色管理](https://neon.com/docs/manage/roles#manage-roles-with-sql)、[官方 hook](https://github.com/neondatabase/neon/blob/main/pgxn/neon/neon_ddl_handler.c)。

独立新 module/CLI 不改原9文件 binding `3ec561f34c95cf2f80e6ba8a6cebf5572c26d5eeeac28f598d00593960b084c0`、原 SQL 或旧槽位。只从两个既有准确 ARN、初始 UUID 和 AWSCURRENT 获取已存密码，不生成新密码，不 Create/Put/Update/Delete Secret，不改标签/IAM/授权；新鲜 NOLOGIN/完整权限/证书/业务 SHA 与提供者设置都必须匹配。新永久槽位 `techlong-f3b3-control-credentials-neon-recovery-v1-consumed` 与旧槽位独立，不能自动复位或重试。

实际恢复仅拟在**一个本地 Serializable 事务**中对两个既有角色各一次 `ALTER ROLE ... WITH LOGIN PASSWORD`，密码原值经认证 TLS 连接提交，Postgres 要求 `password_encryption=scram-sha-256`；保持 `neon.forward_ddl=on`，不关闭 hook、不绕过提供者、不调用 Neon API。保留原15表短暂锁和完整前后状态校验。LOGIN 将开启既有受限数据库访问，drain 原20项列权限不是行过滤/纯读权限，不等于激活部署 Worker。

**新增须确认的风险：** 原密码进入服务端 SQL/托管控制平面，可能被服务端或提供者日志记录。脚本不在本地文件、终端、异常、receipt 保存密码、连接 URL、SQL 或 verifier；JS 字符串不能可靠清零，这也不能保证外部日志不记录。SQL参数不能使用普通 `$1` 代替语法中的 PASSWORD 字面量；仅43字符 base64url 密码策略可进入该固定 SQL。[PostgreSQL ALTER ROLE 风险说明](https://www.postgresql.org/docs/18/sql-alterrole.html)。

本地事务与 Neon 控制平面同步不能保证跨系统原子性，失败可能留外部密码状态/LOGIN 角色；不自动 down、NOLOGIN、撤权、删除或再次写入。COMMIT 未确认时不以 ROLLBACK 作为“撤销外部结果”的证明；独立新连接回读完整权限与准确 Secret 版本，只有两角色真实只读认证均通过才 credentialReady。异常只保留 SQLSTATE、有限 HTTP 状态和安全分类，不存服务端错误文本/detail/stack/query；原失败错误无法事后补回。

“不重试”约束的是本入口应用/SDK，不保证提供者内部不重试：官方 hook 的传输失败路径可在内部重复 HTTP 调用。不会关闭该 hook 来规避这一托管边界，也不能凭本地事务失败保证外部无副作用。

## 本轮真实只读观察与待批清单

Source 使用同一份凭据 STS 核对准确 IAM User，再对准确 Secret ARN 读取 Describe/无resource policy/包括deprecated的完整版本枚举/Get准确UUID+AWSCURRENT，禁止名字回退和SDK重试。两 Secret 元数据/版本/严格载荷/256bit随机密码形态与原证书全部匹配，未尝试 NOLOGIN 角色认证，未变更AWS/Neon。

私有目录 `F:/ChatGPT_workshop/techlong-f3b3-neon-credential-recovery-20261008-r1`：

- 清单 SHA `3610895cfb3b42e14929302105c4beb127c26bf74f42deb32734bf9d86e4918a`，文件 SHA `44abaedf0dc06b8dd5bfc97e97b5d2eea281b550f1a56d0498e5bc3db3001d00`。
- 新11文件 code binding `a32860e83ce9cda1595497d90f9be6e022136c1f7388e9b5f3bd843b143bc630`；原失败 submission 文件 SHA `3096211ad3a9edc0621c0ef8f6abab677e2ebf5685f034ec8205cebdfe6fe0fb` 固定。
- 清单到 **2026-10-09 00:35:05.741UTC / 2026-10-08 19:35:05.741CDT** 过期；过期只允许新的只读 Review，不可沿用旧授权。
- 只读 observation 文件 SHA `83a2a3133c6e4a33c70d522cfb6d5124a21caabeb7c0544627404f3b1037c47f`，DB时间23:35:02.488UTC，provider时间23:35:04.340UTC。
- LOGIN=[false,false]，完整 roleState `1528e1e2888bb191200d8bc2224318512cfa63f5aaa138eb324870674f3fe0ef`；preserved `993506a66f586d9ad447b77769769cbf372dee9be9a30cc556af9d9de00426fa`；PG18.6/forward_ddl=on/SCRAM。原seal/业务/其余授权保持。
- 两准确 ARN 与 UUID 仍为 readonly-v3-AWZoLG /3f8047d4-e357-4d32-ae87-861fda5f8253 和 drain-control-QDFwQ9 /72eb93b3-1da0-40a2-a5a1-176e6869ae98；没有新版本或新 Secret。

两 Secret 基础约0.80USD/月加请求等费用继续存在，50USD/月是目标不是费用硬上限。本批只有 Secret 读取请求，不部署 Cell/ECS/Lambda、不上传包或baseline、不改业务/旧记录/触发器；后继 IAM/Lambda/authority/runtime 各需另批。

## 验证与执行门禁

8项新 recovery 定向 +10项原 bootstrap 相邻测试通过；typecheck/lint/JS与PS语法通过。[GHA run37860578505](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37860578505)，准确head `df18beeb120b3b1d265ce896322876463aba31ed`/attempt1 success，PG18.6新增3组真实原密码 ALTER/认证/错误密码/失COMMIT只读恢复证明，共32组；AWS Secret 和 Neon forward_ddl hook 明确 mock，不能宣称真实托管提交已通过。两自有DB drop、固定digest容器stop、artifact digest/32组唯一证明和exact head由独立读回脚本验证，不安装本地Docker或触碰生产。

私有artifact `F:/ChatGPT_workshop/techlong-f3b3-pg18-ci-20261008-r1`：ZIP SHA `6f39d85abab3b4d237e4a27e1b55eef7d6dff5cc2da7db5a3f9572efe42e0de2`，report SHA `7106446bb0e251083f9612e53b5ee9a3faae8573070972e9472a0cf7b0cbec4f`，receipt SHA `cf13e2a35e70831ce6428f988519e7c3667d2affd4f9a52249e2702d9862bde9`，独立verification文件 SHA `43bc365bddca6821b41103976abeee34341792ddda8d4a7d0f75d5ea0aa70511`。提供者hook配置明确mock，失COMMIT响应为注入，不是模拟成功即云端成功。

只读 Review：

```powershell
node --experimental-strip-types --env-file=.env.local ops/aws-sandbox/scripts/review-f3b3-neon-credential-recovery.mjs --mode Review --out F:/ChatGPT_workshop/techlong-f3b3-neon-credential-recovery-fresh-name
```

执行入口已实现但本轮**不运行 Run**。必须用户另按当前清单明确接受上面的密码原值传输/日志风险、两次准确角色密码+LOGIN写及不可自动恢复边界。批准前新slot为空，旧slot/Secret/数据库状态保留。继续位置是确认恢复写入，然后立即独立只读检查，不是部署已完成。
