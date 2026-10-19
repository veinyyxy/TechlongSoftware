# W6b：一次 GitHub App 只读认证检查（待批准）

2026-10-19。目的：将用户已注册的 App 与现有控制器客户端做一次真实认证接入；不是继续建设新的模拟支线，不是发布/调度或 W6 完成。仅本地受审 CLI，不提供平台 HTTP 密钥入口，不改硬关闭的 UNPUBLISHED 绑定。

## 准确范围

- 仓库 `veinyyxy/TechlongSoftware` / `1323312747`，owner `14145707`，App `5381160`，installation `173033406`，候选 bot `344813947`。
- 唯一 PEM：`E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem`。目前已按用户批准收紧 ACL；本阶段准备只读路径/大小/时间/ACL 元数据，**不读内容、不计算私钥 hash、不复制/移动/轮换/新增 key**。
- 入口 `scripts/review-platform-controller-auth-v6.mjs`。清单绑定九项公开源码 normalized-LF SHA、完整风险文档、文件元数据与 ACL digest；清单在 `ops/aws-sandbox/reviews/platform-controller-auth-v6.prepared.json`。批准为其中 subject 的 canonical SHA，而非文件字节 SHA。
- 48小时确认窗口，不是旧部署计划续期。执行前重新核对所有绑定、ignored/untracked 状态、非 reparse 普通文件与三主体显式 FullControl ACL（用户、SYSTEM、Administrators），不修补不匹配项。

成功路径最多一次私钥读取、一次 RS256 App JWT 签名，严格六个 HTTPS 请求：

| 方法 | GitHub 官方路径 | 用途 |
| --- | --- | --- |
| GET | `/app` | App 身份/权限 |
| GET | `/app/installations/173033406` | 安装身份/权限/owner |
| POST | `/app/installations/173033406/access_tokens` | **创建真实短期凭据**，仅仓库1323312747，Actions/Contents/Metadata均read |
| GET | `/installation/repositories` | 核对本次 token 的唯一仓库 |
| GET | `/users/techlong-sandbox-controller%5Bbot%5D` | 核对候选 bot 元数据 |
| DELETE | `/installation/token` | finally一次撤销本次 token，要求204 |

只有 GitHub 官方 API；无重定向、无自动重试，单请求20秒、响应256KB上限。客户端未发布时仅允许此只读检查，不允许 dispatch。额外 endpoint 或 write token 请求会在网络前拒绝。[限制令牌范围/一小时期限](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)；[撤销接口](https://docs.github.com/en/rest/apps/installations#revoke-an-installation-access-token)。

## 永久本地槽和结果

先以 exclusive-create 建立固定 `F:/ChatGPT_workshop/techlong-controller-auth-v6.intent.json` 并 sync，再读 key；槽已存在即停止，不自动复位、更名或再次 mint。回执也 exclusive-create：`F:/ChatGPT_workshop/techlong-controller-auth-v6.receipt.json`，仅保存白名单身份、请求路径/方法/HTTP状态、失败代码、撤销是否204及未启用状态；无密钥/JWT/token/请求头/响应正文/原始异常。失败、崩溃或回执写入失败仍保留 intent，不自动补写/重跑/删除。

`--inspect` 独立读取本地 intent/回执并算公开回执 SHA，不再使用 token 或读取 key。它**不是第二个 GitHub 客户端的实时撤销证明**；成功仅记录已观察到 DELETE204，不声称外部状态被独立证明。丢失回执时停止，由人决定后续只读核对，不重放。

## 完整风险（确认即接受本节）

1. 本次目标是只读验证，但 POST 实际创建凭据；私钥及有效 App JWT 的潜在能力仍包含已安装的仓库级 Actions write，不受本程序最小 token 约束。私钥长期有效，不因 finally 删除 token 而失效。持有者/进程/管理员/依赖可滥用，无法证明从未被复制或泄露。
2. 字符串、CryptoKey/JWT/token 不能保证从进程内存清零。字节缓冲擦除不是完整清零；系统、代理、提供者日志、崩溃转储、依赖存在暴露风险。禁止把 key 或 token 发到聊天、Git、Actions/平台日志或其它存储。
3. 网络、签名、提供者状态、解析或撤销可失败；POST响应丢失/过大/畸形可能已创建 token 但程序拿不到可用值，因此无法撤销。收到token后正常路径finally仅尝试一次DELETE；204未确认时token可能持续有效至自然过期（通常约一小时）。不保证即时撤销；不自动生成替代key、补齐、撤权、回滚或重试。
4. 文件元数据/ACL digest不是私钥内容完整性证明；没有事先读取key hash。打开前后校验及文件handle身份/大小/mtime降低但不消除同用户/管理员并发替换、相同元数据改写和跨进程竞态。ACL继承关闭也不能阻止允许主体或已有副本读取。
5. `/installation/repositories` 使用已收窄token，只证明该token仓库范围，不能证明安装没有选择其它仓库。private/OAuth/webhook UI设置与用户截图仍需人工核对，bot元数据不是实际工作流actor证明。返回成功不启用控制器或授权后续调度。
6. 本地槽不是全局锁，无法阻止程序之外的操作、文件删除或其它机器；仅本入口遵守一次语义。槽消费后失败不自动复位或重试。GitHub、文件与内存之间不是原子事务。
7. 不调用AWS/SQL/Secrets，不改权限、workflow、environment、业务状态或现有资源，不启动Actions，也不创建付费AWS资源；现有资源仍可能收费，50 USD/月不是硬cap。

## 命令与下一步

准备/检查（仅元数据和公开源码，不读取 PEM 内容、不调用网络）：

```powershell
node --experimental-strip-types scripts/review-platform-controller-auth-v6.mjs --prepare
node --experimental-strip-types scripts/review-platform-controller-auth-v6.mjs --check
```

**只有在用户明确批准最终 manifest SHA 后**，以能读取受保护key的用户进程执行一次（不能在无权进程失败后盲目重跑）：

```powershell
node --experimental-strip-types scripts/review-platform-controller-auth-v6.mjs --approved-manifest-sha <最终SHA>
node --experimental-strip-types scripts/review-platform-controller-auth-v6.mjs --inspect
```

本阶段测试使用内存临时RSA和注入HTTP；不读真实key。批准前测试、提交/推送和无AWS CI可以继续，实际读取key/mint需最终SHA批准。成功后集中实现/审核 V6 云候选和身份验证，不再注册App；身份workflow调度、SQL安装/凭据、发布/trust与真实部署各另审。回到[候选实现](aws-auto-deployment-platform-w6b-controller-implementation.md)。
