# W6k：最小本机启动器与待审运行范围

2026-10-20，America/Winnipeg。W6j公开binding已发布并独立核验；本阶段只新增独立启动器，不改普通launcher、冻结云源码、已安装工作流、IAM、Secret或Neon。**代码/测试通过不等于允许读取凭据或启动真实服务；必须另给最终清单SHA。**

## 下一份Start清单的准确范围

只拟一次读取既有固定Secret `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-controller/neon-v6-M4A08E` 的版本 `3574f24e-ecb3-476c-8f71-baa501fd129e`，一次读取既有 `E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem`，以及一次整体读取既有 `.env.local`（只转发其中的`DATABASE_URL`供原管理员登录/页面使用）。不生成或修改密码，不复制PEM、不落盘凭据、不设置新的环境文件、不调用App认证探针。

专用controller URL仍严格匹配既有角色、Neon目标和`sslmode=verify-full`，不回退owner。`.env.local`中的owner URL仅用于原应用鉴权/普通页面；其目标也匹配已安装数据库指纹，不交给controller ledger或可信publisher。读取整个文件时其它已有秘密也会短暂进入父进程内存，但不转发Stripe/AWS/GitHub等其它值。这不是owner凭据的新授权角色或隔离保证。

只启动一个受审Node子进程，地址固定`http://127.0.0.1:3100`、strictPort，不占用或停止其它服务。该进程经Vite API启动原应用；不使用Sites发布、Docker或Cloudflare远端绑定/隧道/inspector，不执行构建部署。运行许可从消费槽时起最多30分钟，固定release、准确caller源码和origin；启动前置检查/三次私密读取须在起算后两分钟内完成。

本次Start只允许管理员自行登录和查看状态。登录会正常写原认证session，页面读取原业务数据和窄控制账本；不代填密码。请求入口、普通worker和AWS apply保持OFF，不创建新job。启动器不发HTTP请求、SQL、JWT/token或dispatch；controller的批准/观察POST及任何新任务、owner计划/证明写入、GitHub环境审批、云Review/RunOnce/Inspect仍须各自新的具体范围批准。普通管理员UI原有其它写能力仍存在，不因启动清单得到授权，也不宣称本步增加了全站只读隔离。

## 代码和最小传递边界

- `ops/platform-local-v6/plan.mjs`：公开清单、48小时批准期、30分钟许可、只允许一次的顺序。永久槽先于任何私密读取；失败不重新读取或重新启动。
- `local.mjs`：Prepare仅Source/Secret版本/策略元数据、文件元数据/ACL、端口、准确成功CI和clean main；不会读取`.env.local`内容、PEM或Secret值，不连接Neon。Start严格重读前置元数据，消费槽后最多Secret/key/auth各一次、子进程一次；原始提供者错误不返回页面/回执。
- `child.mjs`和`worker.json`：独立静态配置仅包含secret名称，私密值经白名单子进程环境进入本机运行时，不进入argv、公开config.vars或仓库文件。根Vite配置和根目录dotenv自动加载关闭；Wrangler只看独立配置目录，该目录任何`.env*`/`.dev.vars*`均拒绝。子进程不继承AWS/Git token、Node注入选项、VITE前缀变量或其它宿主配置。
- 读取前/打开后/读取后核对文件身份、长度/时间及ACL；key必须保持原三主体受保护ACL。认证`.env.local`现有继承ACL被准确绑定、**不被本步收紧**，不伪称同样受三主体保护。元数据相同不证明密钥内容未变，也不能防高权限并发。
- 子进程stdout/stderr不转发或落盘；仅允许固定公开IPC就绪/停止消息。关闭Wrangler日志/metrics、持久化状态、HMR及私密文件的dev静态访问。正常应用代码/提供者仍可能产生日志或开发缓存，不保证所有工具都不会记录秘密。

实现依据为[当前Vite JavaScript API](https://vite.dev/guide/api-javascript.html)和[Cloudflare本机变量与secrets规则](https://developers.cloudflare.com/workers/local-development/environment-variables/)，并实际核对当前安装的Wrangler/Vinext源码。特别地，当前Wrangler若关闭dotenv总开关也不加载process secrets；所以不是简单设置false，而是固定无环境文件的独立配置目录、保留process secret加载、禁止根dotenv与未列明变量。单元测试直接调用真实Wrangler入口，使用纯合成值验证该行为。

本机worker兼容日期固定为lockfile中workerd `1.20260515.1` 对应的`2026-05-15`，不使用晚于内置runtime的日期，也不升级依赖。首轮CI39475772723在真实子进程就绪前失败，原失败保留，不能据此批准Start。新CI以全合成材料调用相同child入口并公开该合成进程的错误输出，便于定位；生产Start仍丢弃子进程输出。该CI验证不加载根环境文件、不读用户材料，不代表真实凭据/Windows进程树已经验收。

## 停止、回执和失败边界

Start是前台命令。到期、父进程IPC断开或Ctrl+C/SIGTERM，子进程调用一次Vite close；父进程也发一次停止请求并等待关闭。若十秒内未退，父进程只终止自己持有的准确Node子进程句柄，不按名称杀进程或杀其它listener。正常结束后核对原child退出及3100端口空闲，再独立Inspect。若状态不明保留槽及回执，停止写入，不“为了清理”重新启动、自动补齐、删除或重读凭据。

独立Inspect只读原manifest/永久槽并核对本机3100端口，不读Secret/key/auth文件内容，不查AWS/Neon、不杀进程。端口空闲仅证明该监听端口当时关闭，不证明全部孙进程、内存、已签发token/STS会话或云任务已消失。其它进程并发抢占端口会被报告为需人工核对，不自动停它。前台终止和Node父死处理都不是OS级进程树/密钥擦除保证。

## 完整风险与明确不执行的动作

1. 专用DSN、App私钥和原鉴权owner DSN进入可信父/子进程及本机工具内存/环境；高权限用户、调试器、转储或provider日志可能观察。不能保证字符串/CryptoKey擦除；认证文件的其它秘密也会被一次整体读取，继承ACL可能允许其它主体读取。程序不写新的凭据文件不等于物理存储或日志绝对无副本。
2. Source凭据可能在槽消费后失效，固定Secret读取可能失败且槽永久消费；不会因为刷新登录就自动再读。AWS API设置一次尝试，登录提供者自身可能刷新认证。文件/Secret元数据、源码、端口检查没有跨服务CAS；普通工作目录、依赖和本机管理员仍是可信面，不能阻止所有并发替换或未来HMR/代码修改。
3. 编译绑定/本机标志/运行许可是能力门禁，不是人的签名。持有机器/App key/数据库凭据的一方可能绕开该启动流程。浏览器session和既有控制账本/逐计划批准仍必要；启动进程不会替你授予后继调度许可。普通页面其它业务写接口并未在本步改造成只读沙箱。
4. 到期检查拒绝新controller动作，但不能取消已开始的认证/HTTP/SQL、已签发token或已接受的云任务。异常停止可能留下Node/工具子进程或活跃请求；不把close ACK、GitHub success或端口关闭当成完整部署证明。关停控制器不删除AWS资源、不撤销现有权限，也不会自动回滚已提交数据库状态。
5. 启动、登录/浏览、网络/提供者日志和既有AWS资源可能产生非零费用，50 USD/月只是目标，不是硬上限。没有本步创建收费Cell/ECS、扩权限或付费plan的许可。
6. 固定永久槽 `F:/ChatGPT_workshop/techlong-w6k-local-runtime.intent.json` 一旦占用不复位；成功、失败、未收到ACK都不自动重读/重启/重试或补偿。旧W6h/W6i/W6j、旧任务和旧槽保留，禁止借本次许可重放。

## 操作命令与唯一继续路径

最终平台main准确无AWS CI通过后，仅只读准备：

```powershell
node --experimental-strip-types ops/platform-local-v6/local.mjs --mode Prepare --ci-run <准确成功CI> --output F:/ChatGPT_workshop/techlong-w6k-local-runtime-20261020-a
```

清单48小时有效，UTC和温尼伯时间均由程序当场输出；为完整30分钟运行窗口，必须至少提前30分钟开始。清单期限不是Source凭据有效期。未准新SHA不得执行以下Start；批准后也只一次：

```powershell
node --experimental-strip-types ops/platform-local-v6/local.mjs --mode Start --manifest F:/ChatGPT_workshop/techlong-w6k-local-runtime-20261020-a/manifest.json --approved-sha <新SHA> --output F:/ChatGPT_workshop/techlong-w6k-local-runtime-20261020-a-run
```

看到`LOCAL_RUNTIME_READY`才是进程已经监听，不是部署通过。使用原管理员自行登录，只查看状态；Ctrl+C或原截止时间后结束，再新进程只读：

```powershell
node --experimental-strip-types ops/platform-local-v6/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6k-local-runtime-20261020-a/manifest.json --output F:/ChatGPT_workshop/techlong-w6k-local-runtime-20261020-a-inspect
```

随后集中准备一个新heldjob及其平台Review→RunOnce→Inspect执行，不扩F3c9或身份实验。新任务创建/私密读取/计划写入/云调度与实际部署仍另审；整套平台AWS上线在后续。
