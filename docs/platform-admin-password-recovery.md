# W4c 管理员密码恢复：仅既有账号，非 bootstrap

后续完成状态（Winnipeg 2026-10-16 23:13 CDT）：用户已报告修改密码成功且能登录。新进程在2026-10-17T04:13:47.810Z仅做两个 Neon READ ONLY 事务，观察到准确账号密码更新时间为2026-10-16T18:56:13.985Z、active/admin不变、失败0/无锁及有效会话1；原九行、W3成功任务和完整任务列表摘要仍与恢复前一致，held/active=0。没有读取密码hash/salt/token，也未重放重设或试登录。该核验是元数据与用户登录反馈，不冒充知道用户新密码或重算过其摘要。密码支线就此结束，回到原批准的一条W4c待审请求；下方保留准备时点说明。

2026-10-16，用户已明确批准仅重设 `veinyang@gmail.com` 的平台密码、清除失败计数并注销其已有会话；不改管理员权限、业务记录或 AWS。固定 userId 为 `usr_4dcd0a09821fde2bb1801f58`，工具只接受原 Neon 控制库端点指纹，不接受其他邮箱/用户/数据库或命令行密码。

## 由用户在自己的交互终端执行一次

```powershell
Set-Location E:/NodejsProject/TechlongSoftware
node --experimental-strip-types scripts/reset-platform-admin-password.mjs
```

在两次 hidden 提示中输入相同的新密码（12–128字符）。输入不回显；不要把密码发到聊天、放进参数/环境变量/文件，也不要用管道输入。Ctrl+C 在提交前取消。脚本不创建登录 session，完成后仍须自行登录。

成功输出 `PASSWORD_RESET_AND_SESSION_REVOKE_VERIFIED` 后回复“已重置”，可附不含密码的 JSON 结果。若出现 `RESET_SUBMISSION_REQUIRES_INSPECT_NO_RETRY`、其他报错或终端被中断，不要再运行或猜测提交是否发生，保留提示供独立只读核验。

## 严格范围与行为

- 复用现有 PBKDF2/SHA-256、600000次、随机16字节 salt 和现有密码长度规则。不读取旧 hash/salt、会话 token，不恢复旧密码，不用范围较大的 `bootstrap-local-admin.mjs`。
- 密码仅在本机进程内存用于生成摘要，不传明文到 Neon；终端历史只有命令。JavaScript 字符串不保证安全擦除；本机进程/调试器及提供者日志仍有风险，数据库可能记录新摘要参数，不能承诺所有层绝无敏感日志。
- 提交前重新只读确认准确 existing/active/admin 及 credential 元数据。一个 SERIALIZABLE 事务中的单条 CTE，按准确账号/旧凭据时间戳加锁、最多 UPDATE 一行 `user_credentials`，清零失败次数/锁定，并仅 DELETE 同一账号的 `auth_sessions`；不 INSERT、不改 `users`/workspace/权限/业务/deployment，不访问 AWS 或原私密包。
- 提交后的新 READ ONLY 事务只返回摘要匹配布尔、时间戳、计数与原用户资料；比对用户资料未变、准确新摘要、失败0/无锁及会话0。不返回旧/新摘要或 salt。注销会使该账号其他浏览器的既有登录失效。
- 不自动重试写入/补齐/回滚。提交 ACK 不明、并发登录/用户资料变化、独立回读失败均停止报告；原登录实现可能在并发中生成新会话，若观察到残余会话不会反复删除，不能保证跨进程绝对静止。

`--check` 只报告固定范围，不读配置/数据库/密码；`--preflight` 仅使用忽略的 `.env.local` 做只读账号/会话元数据核验。默认交互模式实际有密码重设能力，只用于本次批准，不作为公网恢复 API 或绕过管理员登录的入口。

## 已完成的准备验证，尚未实际重设

5项新增测试 + 4项既有本地认证测试通过，定向 ESLint/语法/typecheck 通过。真实 `--preflight` 返回准确管理员已有密码、失败0/未锁定、现有session行1；真实 Neon 两个 READ ONLY 事务对唯一 mutation CTE 做一次 `EXPLAIN`（不 ANALYZE），在合成摘要参数下规划通过：**2026-10-16T18:53:19.428Z / 13:53:19.428 CDT**。

代理本轮共3个真实只读事务、密码/会话写入0、旧摘要/salt/token读取0、AWS调用0；没有运行交互重设、未采集用户新密码。平台3100入口继续关闭，无新待审任务；重设完成后回到 [W4c 本地主线](aws-auto-deployment-aurora-dual-mode-w4c-local-entry.md)，不增加邮箱服务、恢复网页、schema或IAM支线。
