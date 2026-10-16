# W1：回到 worker 主线——修复镜像目录与已初始化实例接线

2026-10-16 Winnipeg。K3b退出依赖盘点后，本轮没有继续建设清理/诊断/Grant支线，而是检查常规worker和Express真实执行入口，并实现下一单任务执行器所需的两个核心部件。**W1是代码与接线里程碑，不是worker已启用或自动部署已验收。**

## 找到的三个阻点

| 路径 | 代码事实 | 本轮处理 |
| --- | --- | --- |
| `scripts/run-deployment-worker.ts` | 固定调用`createDefaultDisabledWorkerRuntime()`；`--check-runtime`真实输出disabled/offline_only，未打开Neon或构造AWS mutator。不是只差设置环境变量 | 保留安全门，不把apply/cleanup设为true，不启动全局队列 |
| Express旧V1材料/runner | 旧目录仍固定app `5e42b2de…`；首次runner要求pristine/initialized=false，随后编译首位owner密码并provision。旧任务已成功，不能重放来验证新worker | 旧代码/目录/计划/成功job及历史闭包全保留，新V2目录改用C5i已发布修复manifest |
| 当前已初始化租户 | K2b/K2c已初始化和ready，K3r恢复承载，K3v独立回读；“重试第一次开通”不是合适的后继动作 | 新接线只允许复用现有初始化结果、准确store及认证配置回读，不暴露provision/compiler/密码源 |

## 已实现的可复用代码

[express-delivery-images-v2.ts](../lib/deployments/execution/express-delivery-images-v2.ts)固定C5i实际发布：源码`10fe3c41b97941f5c7755bdcd9f43aee2d5a0ea2`、build38803364109、publication38807901068。app为`sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，lifecycle为`sha256:34ba02327b5e7ed311e6c706790c16c5d97c5d1419584cc47df98a4d7b09714e`。不使用`:latest`、config digest或重新打tag，不改旧V1常量和Full入口。

[express-initialized-worker-v2.ts](../lib/deployments/execution/express-initialized-worker-v2.ts)提供`prepareExpressInitializedWorkerV2`：

- 复用原scope/config/schema/数据库绑定校验，生成独立、不可变、带摘要的新材料；保留原source plan、物理名称修订及owner/generation，不根据镜像派生新owner或覆盖历史。
- `renderWorkload`直接调用真实Express渲染器，令ImageUri与APP_IMAGE_REVISION同时使用修复digest；七资源、固定Secret版本、网络allowlist、listener分离、原epoch/所有权和50USD目标约束保持。渲染仍是数据，不是CreateStack权限；活动租户数/云坐标须由执行时真实读回提供，不能假装当前命名空间空。
- `composeInitializedReadback`是惰性GET-only客户端：只允许固定租户`:8443/api/saas/readiness`和`/api/saas/control`，拒绝正文、其它目标或query，不暴露POST能力。真实TLS验证/不跟随redirect仍由既有transport承担并需后续准入，不能把任意注入transport当作可信证明；执行时须单独批准私密来源/实际认证请求。
- 校验initialized协议、准确app/数据库/OID/配置/实际镜像、active epoch、有效业务配置checksum及**准确原store UUIDv8**。即使另一个store有合法checksum也拒绝；fence先clone/freeze，调用方在JWT等待时修改对象不能改变已准入的epoch。
- 未初始化、404/超时、配置或镜像漂移只能返回not-ready或失败，不读取首位owner密码、Secret值，不fallback到provision。根对象不暴露compiler/provision；不恢复数据库/迁移、不发ApplyReady或平台ready能力。

以上是实际渲染器/控制客户端的可调用接线，不是另一个云模拟器；本轮单元transport只验证协议控制流，不冒充已发送新的mTLS/JWT请求。

## 已做验证及没有做的动作

7项新测试+14项相邻测试共 **21项通过**，TypeScript typecheck及三文件ESLint零警告通过。测试包含修复镜像双字段、无初始化能力、两GET/准确store、漂移拒绝、fence拒绝先于token/网络和异步调用方对象变更。

真实线上仅 **4次AWS只读**：Source STS身份、两个准确ECR registry manifest一次batch回读并本地重算摘要、两次读取扫描记录；均成功。记录为COMPLETE/HIGH0/CRITICAL0，扫描完成时点仍是2026-10-15的既有记录，**没有本轮重新扫描、构建或发布**。

实际租户的公开来源材料（34份公开history）已本地成功编译，新material SHA为`8fa2b5c1cfe441ca6c95771046209e03c8ced91b8cdf0e7948c1c44c55da0313`；owner仍`dep_7c99bd249470184852f0dc74`、app仍`app_e897a4377bce498b9c5ee9e64509dcad`、原plan SHA仍`8690c22f5b4dbf80d49bcee3cdff717dd8ae14957eedb7606b9829b533e49dc8`。该SHA是**候选材料完整性摘要，不是执行批准SHA**。未把当前运行namespace视为空，也没有渲染一份假称可立即创建的现场workload计划。

旧`--check-runtime`另进程实跑仍disabled。全轮云/数据库/job/业务写、新私密包/Secret值读取、应用HTTP及worker启动均0；未重跑旧Run/Inspect/成功job，没有改TTL、队列开关、IAM或账户plan。原workload仍固定今天 **10:37:01.033 CDT / 15:37:01.033 UTC** 到期，不保证删除/全停费，本轮未到期不重复退出盘点。

[实现/审计摘要及三个本地原件hash](../ops/aws-sandbox/reviews/aurora-dual-mode-w1-initialized-worker.implemented.json)记录新代码3pins、审查的旧代码5pins、公开候选/ECR/default-runtime三个原件。没有发布本地配置、私密材料或完整业务模板到Git。

## 下一步：只接一个真实任务，不开启全局队列

下一小阶段实现**已初始化租户的单次承载恢复/发布runner**：新、明确范围的reconcile任务及有效lease，fresh provider/epoch/命名空间检查，一次受审承载操作，认证GET-only配置回读，随后原子完成新job和准确deployment outputs，最后独立读回。原成功job、原ready归因、owner、已初始化数据库保留，不再次走旧first-claim或首次provision。

仍缺少具体新job的原子claim/lease与完成持久化、实际provider准入和CLI执行接线；本轮没有用DI测试或材料SHA代替这些能力。上述实现先做代码；创建job/改变平台字段、认证请求的私密来源读取、新权限或真实云部署，仍须按fresh具体资源与变更范围确认。失败后不自动删除数据库、补写、续期或切回首次开通路径，不扩展F3c9/Grant/generation。

这收缩的是首个自动运行的验收范围：同一已初始化租户的workload恢复/发布，不把它声称为“新客户订阅到新库/商户开通”的全自动链路。之后再以同一套真实任务执行根扩展完整开通，不先重启封存支线。
