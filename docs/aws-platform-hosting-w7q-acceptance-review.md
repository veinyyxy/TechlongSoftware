# W7q：第二轮承载与管理员验收准备（实际部署待批准）

目标只补主线缺口：把已构建的同一镜像重新承载到AWS，随后由既有管理员自行登录，核对概览、实例详情和登出。不是新建部署控制器，不扩展F3c9，也不把本轮当作整套产品或手机客户端验收。

## 本轮已经允许与尚未允许的动作

用户“开始下一步”仅允许实现、测试、提交代码、只读核对既有资源及生成新清单。**尚未允许CreateStack、Secret值读取、SQL或管理员登录。** 代码提交/推送沿用默认授权；实际部署须确认新清单SHA及本页完整风险。人工认证验收另待准确新栈上线后确认，不在部署程序内发送密码、Cookie、表单或HTTP请求。清理亦按准确新UUID另行审批。

复用现有镜像digest `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612`、execution角色及boundary、固定Web Secret版本、证书、hosted zone、网络和Neon。没有新增IAM或镜像重建。公网origin仍为`https://console.sandbox.techlong.cloud`；controller/worker/apply全部关闭，无应用task role。

## 唯一新部署范围

新清单仅允许一次CreateStack，用原名`techlong-sandbox-platform-hosting-v1`创建**新UUID**，11项逻辑资源仍与W7o一致：两安全组、独立入站规则、日志组（7天保留）、ECS cluster、ALB、target group、443 listener、任务定义、单task期望数的Service、准确DNS A alias。不UpdateStack、不执行旧命令、不删除历史资源。

资源布局、0.5vCPU/1GiB、Fargate1.4.0、ALB/安全组规则、固定镜像/Secret、公开HTTPS等均不改变；模板仅增加W7q/generation2/父删除绑定元数据。复用原`ops/platform-hosting-deploy-v1`实现，不另造执行框架。新模式`InventoryTrial2`/`PrepareTrial2`/`DeployTrial2Reviewed`显式选择第二轮；旧模式仍受旧槽限制，不自动切换。

先绑定[W7p独立清理证据](../ops/aws-sandbox/reviews/platform-hosting-w7p.cleanup-observed.json)、原始清理回执及已消费的旧创建/删除intent。fresh核对旧准确UUID确为DELETE_COMPLETE；再查既有access真实RoleId/PolicyId/默认版本/完整策略与Secret版本元数据、镜像、网络/证书/DNS及50USD月预算。仅允许旧准确ECS cluster/service以INACTIVE且任务/服务计数0保留或缺失；旧准确任务定义`:1`可INACTIVE或元数据不可描述。ACTIVE/DELETE_IN_PROGRESS任务定义必须为空，INACTIVE列表只可含旧`:1`或为空；未知对象、分页、非零计数或矛盾均拒绝。准备与执行前两次退休摘要必须一致，不因传播变化自动放行。

AWS明确说明[删除cluster后INACTIVE元数据可能暂存且未来会消失](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DeleteCluster.html)，[ListTaskDefinitions的INACTIVE列表也受引用状态影响](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_ListTaskDefinitions.html)。因此兼容的是这次已证明退休的对象，不是允许接管任意同名资源。只读检查不能保证随后AWS创建一定成功，也不能消除检查与写入之间的竞态。

## 时间、永久槽与失败行为

清单外层有效48小时、最晚启动为到期前30分钟；显示UTC及America/Winnipeg当地时间。执行前重读状态/凭据，过期不执行。CI必须是准确源码main/push/attempt1成功；源码/风险/父证据/四产物hash均绑定。后续只允许README及该新待审索引的元数据快进。

第二轮独立永久槽`F:/ChatGPT_workshop/techlong-platform-hosting-deploy-v2.intent.json`仅在新批准后wx/fsync消费；这是一轮清理成功后的新验收，不是失败重试、旧槽复位或自动补建。旧创建/删除槽和旧记录一律保留。新槽一经消费也不复位、换槽或自动重试。原清单与旧源码的历史绑定可在原Git提交追溯；本轮源pin重新生成，不拿旧29项pin冒充新代码。

CreateStack采用固定TemplateBody、DisableRollback=true、20分钟超时、无RoleARN/Capabilities/URL；顶层SDK maxAttempts=1。收到ACK或结果不明后仅只读观察，最长约25分钟并独立核验新UUID/11项物理资源/健康任务/固定digest/网络/DNS。元数据成功不等于认证成功。失败保留部分资源与证据，不补建、不修复、不回滚、不自动清理。

T0在实际写前确定，T0+2小时仅标签/输出，**不会自动停机或停止计费**。请安排可及时操作的验收时间；用户未就绪时不提前部署。建议剩余30分钟即转入准确清理清单准备，删除仍需单独确认。

## 完整风险

- 真实公开应用和托管任务会读取、注入固定生产Secret。期望数1不是累计启动次数上限；ECS/CloudFormation可能内部重试、替换任务、多次读取Secret。程序不直接GetSecretValue/连SQL，不等于无人读取凭据或应用不会写数据库。
- 公网请求（包括恶意请求）可访问登录入口，并触发既有数据库认证逻辑。托管注入环境/提供者日志、应用错误日志、容器可写临时根目录及已有数据库角色权限均有暴露风险。本轮不扩权、不轮换、不新增网络防护，沿用[W7o完整部署风险](aws-platform-hosting-w7o-deployment-review.md)。
- 非原子、非跨服务CAS、服务传播及并发改变可能导致部分创建、失败遗留、错误状态或收费资源。DisableRollback=true；不承诺自动回滚或后台补偿。凭据自动刷新失效、额度/离线/人工审批延迟可能妨碍观察与后续清理。
- 50USD/月是预算目标/告警，不是硬上限。ALB/task/IPv4/LCU、Secret、既有数据库、镜像、日志与流量、创建/删除耗时及税费可能另计；新清单记录准备时官方区域价目表示例，不保证实际账单。两小时不是收费封顶。
- 新栈UUID和新任务定义revision由AWS分配，不能恢复旧UUID；不得复用旧`:1`冒充新任务。旧INACTIVE/删除历史可能仍显示；既有权限、Secret、Neon LOGIN及其他收费资源不会自动撤销或删除。
- 一次写提交和永久intent不能限制服务内部动作。提交超时或ACK不明仍不重发；失败后也不自行补齐、删单资源或换槽。后续清理会中断应用、删除该日志组及容器临时内容，需要新准确范围确认。

## 上线后的最小人工认证验收（本页不批准执行）

待新栈独立元数据核验通过、用户明确准备就绪并确认认证范围后：用户在自己浏览器输入既有管理员`veinyang@gmail.com`的密码（不发给助手、不记录HAR或Cookie值），只尝试一次登录；随后只读查看`/admin`、`/admin/instances`及准确实例`/admin/instances/app_e897a4377bce498b9c5ee9e64509dcad`，最后一次登出，再验证受保护页跳登录。

验收只保存时间、新栈/run来源、页面路径、成功/错误代码及布尔结论；不导出用户名单、业务数据、会话、密码或浏览器存储。可由用户自行核对session cookie存在且Secure/HttpOnly/SameSite=Lax；不要抄录值。登录会读密码验证材料并更新失败计数/锁定时间、写session；登出会删session。只读页面也可能产生应用日志、浏览器预取与正常网络子请求，不承诺请求总数精确等于按钮点击次数。

不得注册/重置密码、重复登录、创建请求、改变状态、批准/调度/观察任务、调用GitHub App、运行worker或触发AWS部署。报错或结果不明时停止，不刷新提交/自动重试；保留脱敏错误和新准确栈状态，另审修复。没有这轮真实认证证据前，结论仍是“基础承载验证通过，管理员端到端验收待完成”，而不是整套系统已上线。
