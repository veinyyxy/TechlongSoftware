# W8i：先登记准确待审任务，不消耗云控制窗口

## 目的与实际前置事实

W8h已经证明AWS托管控制器能够读取专用Neon状态。剩余主线是由它真实调度一次Review，再复用已有RunOnce/Inspect。不要重做Web壳、镜像发布、权限安装或F3c9。

2026-10-23，用户另行批准一次本机`.env.local`连接信息读取和限定TLS只读核对。实际一次连接、一个READ ONLY事务、四SELECT完成，数据库/AWS写入、Secret/PEM读取、App token、调度和新槽消费均0。原件：`F:/ChatGPT_workshop/techlong-platform-w8i-readiness-readonly-20261023.json`，SHA `a6a784064085443be8a0a507e86ba0ddaafe1d8905b31ba5cd9599b48872a310`。

结果：准确实例`app_e897a4377bce498b9c5ee9e64509dcad`受支持，最近成功任务`job_c6cb047ac3ff30ed51ba9f34`的承载证明窗口已到期，允许准备新请求；不存在pending/running任务。六旧任务中五项succeeded，一项`job_fc0309dabebc09367f64153f`为canceled；不能复活它。五项旧计划均过期/已占槽，且源码不是现有镜像的`f3cea2da7d26dfc09726c4cbc52cab40217340c6`，不能重放。

## 本次待批范围（准备不等于批准）

只复用已有本机请求入口、登记SQL、子进程、认证和只读投影；新增的是适应当前六项历史记录的operator适配，不改Web运行时、云闭包、IAM、镜像或旧记录。

- 固定管理员`veinyang@gmail.com`/`usr_4dcd0a09821fde2bb1801f58`自行登录、单次点击创建请求；不索取密码。
- 固定client ID `c78f3b80-4c6b-4af1-8b05-4feabb89e7de`，request `c99ca0cb30620d6f3ccc47dee1d6287ee3c9489531fd750db41d127182be7730`，新job `job_6e2e115c80301595512f11fb`。不会每次刷新换ID。
- 最多启动一次`127.0.0.1:3100`请求入口；实际启动时才派生30分钟窗口，收到单次结果后关闭。controller/worker/apply保持关闭，专用控制器URL和App私钥不供给。
- 最多两次读取现有`.env.local`（启动、独立回读各一次），显式只读事务最多四次；正常用户登录/会话及一次heldjob登记的数据库写不计为零。不读取AWS Secret或PEM。
- 任务必须pending、attempt0/max1、available_at=9007199254740991、无lease、reviewRequired=true/cloudExecutionAuthorized=false。不被普通队列领取。
- 九行旧快照及六旧job摘要必须与本次只读证据完全相符，唯一已取消job保持取消；漂移就停止，不自动修改、取消、复活或修正业务。
- 两个独立永久槽：`F:/ChatGPT_workshop/techlong-w8i-held-request.intent.json`及`.../techlong-w8i-held-request-inspect.intent.json`。保留所有历史槽，不自动复位、补齐或重试。

operator源码绑定届时已通过CI的main；后续**云Review计划**必须绑定现有镜像源码f3cea2d，不拿operator新HEAD冒充云源码。本次不发布该计划、不读取App私钥、不签名/取token、不调用GitHub、不部署或续租。

## 完整风险

读取的是整个本机配置文件，即使仅提取DATABASE_URL，其他本机配置也可能短暂进入进程内存；不得输出、写入回执或提交。owner连接拥有较宽权限，代码限制不是数据库沙箱；本次入口仅走既有受审路径，仍有内存、主机、TLS网络和提供者日志风险。正常登录、认证会话写入不是只读操作。

本机请求围栏为单进程内存，不是跨主机永久CAS；SQL去重也不等于HTTP提交次数上限。窗口内其他旧UI入口可能存在，应只操作固定请求。并发、独立时钟、业务变更、提交ACK不明都可能留下任务或认证会话；两次只读快照也不是一个分布式锁。失败/结果不明必须停止，先独立回读，不能刷新/重试提交，不自动回滚、删除、补齐或重置槽。

本次不新增AWS资源，但现有Fargate、ALB、公网IPv4、Secret等继续可能计费。原控制租约14:28:42 CDT已到期，原承载意图**2026-10-23 15:58:42 CDT仅标签，不自动停机或停费**。50 USD/月是目标，不是AWS硬上限。清理必须以当前完整栈ARN另批；本次不延长承载标签/控制租约，不删除资源。

## 工程入口与下一步

`node --experimental-strip-types ops/platform-request-v6/followup-local.mjs`提供`--mode Prepare|Start|Inspect`。Prepare仅核对本机元数据、不可变只读原件和准确CI，生成48小时operator清单，无私密内容读取/SQL/服务启动；Start必须新SHA确认，Inspect是独立进程且不重放Start。

Prepare参数：`--mode Prepare --output F:/ChatGPT_workshop/techlong-w8i-held-request-<标签> --ci-run <准确main CI ID>`。Start/Inspect必须使用该目录的`manifest.json`、`--approved-sha <manifestSha256>`及分别以`-run`/`-inspect`结尾的新输出目录。没有最终SHA时不能执行Start。

登记并独立回读后，先把该job的lineage和Review发布材料备齐。计划发布SQL/S3写、新托管控制窗口（会替换ECS任务并重注入三个固定Secret）、真实App调度及GitHub环境审批分别按具体范围确认；这些都不被本清单授权。全套准备就绪后才开启30分钟云控制窗口。
