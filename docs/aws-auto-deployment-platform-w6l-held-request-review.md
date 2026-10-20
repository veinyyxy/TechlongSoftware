# W6l：新待审任务的固定请求窗口与完整风险

2026-10-20，America/Winnipeg。W6k只登录查看的窗口已关闭、原槽保留。本阶段集中解决真实新job入口，不重装IAM/Secret、不重做身份实验，也不重跑W6k。**当前仅代码/测试准备，尚未读取真实登录配置、连接生产Neon、开启请求入口或创建任务。**

Review计划必须绑定真实新job。最短路线是先由既有管理员登记一条准确的新heldjob，再复用已安装publisher/controller发布和批准该job的Review计划。不能把旧成功W5r任务复位，或由Source伪造管理员session/INSERT。本步不调度Review，也不扩云端代码。

## 一份新SHA拟批准的准确范围

1. 新独立Start永久槽：`F:/ChatGPT_workshop/techlong-w6l-held-request.intent.json`，不改W6k槽。只整体读取现有 `E:/NodejsProject/TechlongSoftware/.env.local` **一次**，只转发其中的`DATABASE_URL`。其余原秘密可能短暂进入父进程内存，但不转发、不输出、不复制。**不读App私钥、任何AWS Secret值或私密包，不调用AWS。**
2. 用原owner URL作两次只读Neon事务，核对既有九行业务快照、旧任务安全投影、准确管理员和最新成功W5r前驱。基线只保存摘要/安全字段，不读取用户密码hash、salt或session值。若有活动旧任务、前驱/归属不符或新目标已存在，停止，不开服务或自动换nonce。
3. 启动一个最长30分钟的独立本机子进程，仅`127.0.0.1:3100`，strictPort。原应用鉴权仍使用原owner credential；controller开关关闭，其专用DSN和App key绑定均为空。普通worker/apply关闭，只有本次请求入口开启；不改.env文件、不写新凭据文件、不使用Sites/隧道/Docker/远端绑定。
4. 固定管理员 `veinyang@gmail.com` / `usr_4dcd0a09821fde2bb1801f58` 自行登录，**仅点击一次“创建待审恢复请求”**。公开清单预先固定clientRequestId、requestId和jobId，页面显示准确job；刷新不换nonce。服务端核对管理员/同源/字段/摘要/截止时间，SQL前再次复核。旧SERIALIZABLE登记SQL原字节不变，最多新增这一个pending/reconcile、attempt0/max1、`available_at=9007199254740991`审核挂起job；不领取、运行或改旧记录。
5. 用户反馈结果或提交不明后，关闭准确本次进程；到期/IPC断开也关闭。随后一个**独立进程**消费单独Inspect槽 `F:/ChatGPT_workshop/techlong-w6l-held-request-inspect.intent.json`，整体读取同一`.env.local` **再一次**，执行另外两次只读Neon事务，核对准确新job/来源/无lease，以及九行和全部旧任务摘要未变。只读回读不等于允许修复，失败不再读或复位该槽。

因此本次拟最多两次既有认证文件读取、四次显式只读Neon事务、一个子进程、一个由真实管理员登记的新逻辑job。正常登录和页面访问还有原应用session写入/查询，**不能声称总SQL只有一写或四读**。所有实际步骤须等最终准确新SHA确认。

## 固定围栏，不新增业务执行器

`lib/deployments/reviewed-request-window-v6.ts`只处理公开请求能力：固定origin、源码/release、管理员、UUID与确定性job、最多30分钟。实际SQL仍是原`initialized-platform-request-v1.ts`；云81/76文件闭包和安装工作流/trust不改。管理层/HTTP/UI只加本次围栏，普通旧入口默认OFF及既有行为保持。

正确请求在本进程内只允许尝试一次；登记前失败也不自动放行第二次。该内存围栏不是跨worker/重载的持久CAS；现有数据库确定性dedupe/锁/无活动兄弟任务检查用于阻止第二条逻辑job，**不保证恶意客户端或并发重载时HTTP/SQL提交次数严格为1**。固定nonce避免未知提交后通过刷新换ID；任何错误仍不得人工或自动重试、改nonce或删除旧请求。

复用W6k已验收的文件读取/child生命周期低层函数，不重跑其Start入口；新模式将controller私密绑定置空并在child入口复核。模块导入不读取配置内容或连接数据库；Prepare不需要Source刷新。独立Inspect有真实私密读取，必须仍在这份48小时批准期内，不沿用W6k“可过期只看端口”的语义。

## 完整风险和不包含的授权

- `.env.local`包含的其它秘密会被两次整体读取；只选择DB URL不等于没读取其它字节。原继承ACL保留，owner凭据进入可信父/子进程、网络提供者和本机工具内存；不能保证字符串擦除、没有转储/日志/缓存副本或本机管理员隔离，不改变原DB角色权限。
- 原管理员UI其它业务写能力仍存在，本步不把全站改成只读。只有本清单的准确新请求及正常登录获拟授权；其它按钮/账号/旧任务/付款/调度不因窗口开启得到批准。程序不代登录或接收密码/cookie。
- 读基线及回读各有两个READ ONLY事务，彼此和文件/端口/源码并非同一个快照或跨服务CAS；并发变化可能导致核验失败。客户业务原件只在内存比较/散列，公开证据仅摘要和安全字段；本机回执存放本身仍依赖可信文件系统，不是签名防篡改审计。
- 网络、序列化、ACK不明可能已有持久pending行或进程。不得因清单仍有效或刷新Source就重试、换nonce、补齐、删除、down、复位或回滚。两个新永久槽各只消费一次，旧槽/原件全部保留；基线失败可能消耗Start槽而没有新任务。
- 到期复核停止新提交，不保证取消已经开始的SQL/登录/请求；父子关闭和原PID/端口检查不证明所有孙进程、内存或外部凭据都已消失。停止不按名称杀进程，不动其它listener；原有AWS费用继续。
- 本步不读取App key、AWS Secret值或原私密包，不签JWT/installation token、不发布控制计划/证明、不dispatch或批准GitHub环境、不领取任务、不创建/删除/续期AWS资源、不连接Aurora或改变客户配置。50 USD/月是目标，不是硬cap；已有资源、登录/数据库/CI/网络可能非零费用。

## 命令与继续点

准确最终main CI全通过后，只读元数据准备（没有认证文件内容、SQL或AWS调用）：

```powershell
node --experimental-strip-types ops/platform-request-v6/local.mjs --mode Prepare --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w6l-held-request-20261020-a
```

48小时清单由程序输出UTC/温尼伯时间；Start须至少预留30分钟。**最终新SHA明确确认后**，一次执行：

```powershell
node --experimental-strip-types ops/platform-request-v6/local.mjs --mode Start --manifest F:/ChatGPT_workshop/techlong-w6l-held-request-20261020-a/manifest.json --approved-sha <新SHA> --output F:/ChatGPT_workshop/techlong-w6l-held-request-20261020-a-run
```

Ready后由管理员自行登录固定实例页，仅点一次准确请求。随后关闭本次前台进程，再独立只读回读（同一SHA同时覆盖本次一次性私密回读，不是部署批准）：

```powershell
node --experimental-strip-types ops/platform-request-v6/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6l-held-request-20261020-a/manifest.json --approved-sha <同一SHA> --output F:/ChatGPT_workshop/techlong-w6l-held-request-20261020-a-inspect
```

只有`NEW_EXACT_HELD_REQUEST_INDEPENDENTLY_VERIFIED`才进入准确job的Review计划发布/调度准备；`ABSENT`/不明不自动再登记。后续复用既有可信publisher和App controller，不另造执行器；计划SQL写、固定S3/Secret读取、App token/dispatch/观察、人工environment审批和实际云部署按新准确范围批准。保持caller源码冻结跨Review→RunOnce→Inspect，不扩F3c9或身份支线。
