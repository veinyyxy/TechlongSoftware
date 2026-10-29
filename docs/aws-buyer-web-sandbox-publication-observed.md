# Sandbox客户端：真实发布及独立静态核验完成

2026-10-28，America/Winnipeg。用户确认清单 `abf867cc61e01a9450763aec66fa7c5e27236b71967c5e39f966a0f73067ace7` 并本人完成GitHub环境审批后，**20:21:09–20:26:05 CDT**完成一次客户端配置/发布与独立静态核验，结果为 `SANDBOX_CLIENT_PUBLICATION_INDEPENDENTLY_VERIFIED_STATIC_ONLY`。[准确run40799958045](https://github.com/veinyyxy/speedfeast/actions/runs/40799958045) completed/success、attempt1、head602e543，与原准确CI及workflow一致；没有Re-run或第二次dispatch。

原[执行风险](aws-buyer-web-sandbox-publication-review.md)、[批准机器清单](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.publication-execution.json)及准备原件保持原样，PENDING标签描述的是批准前材料，不代表尚未执行。**本次只证明静态客户端发布，不证明后端或完整产品业务可用。**

## 已完成

- 实际Source IAM身份、repo管理权限、准确源码/CI、原门禁/唯一master、新目标空缺、原role/boundary/模板、固定runtime版本及公开加密key均预检通过。新桶当前对象为空后才继续，不靠旧安装记录推断。
- 仅创建sandbox五变量及SANDBOX_BUYER_HMAC_SECRET_KEY，配置与Secret名称元数据独立回读通过。固定VersionId 0f45d29f-02d4-4117-99b1-c06645aa3c6e仅读取一次；整个Secret JSON只在受审进程内存使用，只有hmac_secret_key经已固定标准LibSodium加密发往准确环境。回执未保存明文或密文请求体，未把Secret名称回读说成明文值独立证明。
- 一次dispatch真实ACK直接返回run40799958045，准确head核对后才提示用户；本人门禁于20:24:20被观察为通过。无agent审批，production认证/上传/invalidation步骤均skipped，sandbox构建、900秒账号限定认证、无delete上传和准确分布缓存失效步骤均success。
- 独立S3元数据共**326对象/51,149,344字节**，三份关键文件均AES256；准确分布EDJYJUKAZ12BO仅一个新增invalidation `IDM755L3P0IL4DKXAFAG7L2J79`，/*、Completed。

| 独立静态请求 | 结果 | 与S3核对的大小 |
| --- | --- | --- |
| GET /index.html | 200，ETag匹配 | 1,403字节；正文仅哈希、不保存 |
| HEAD /main.dart.js | 200，ETag匹配 | 3,694,340字节；未取JS正文 |
| HEAD /flutter_bootstrap.js | 200，ETag匹配 | 9,975字节；未取JS正文 |

准确静态来源为 https://d3a0kml1xanzgt.cloudfront.net。上述GET/HEAD没有执行JS、调用API、建立访问租约、登录、下单或支付；ETag/大小一致不是对全部bundle的密码学审计，也没有下载workflow日志或虚构不存在的artifact。HMAC已按明确接受的现有设计进入公开Web产物，可被读者提取，**不再将它描述成对客户端用户保密**。

## 实际副作用、原件与恢复

本机顶层实际GitHub GET35/写7（五变量＋一Secret＋一dispatch）、Source STS3/AWS元数据23/固定版本秘密GET1、无身份HTTPS3；run状态观察9次、invalidation观察1次，合计72条提供者调用记录已本地重新核对。以上不是云端S3对象上传/内部OIDC/构建下载的API次数上限；上传对象和缓存失效是真实云写，不能把“本机未创建基础设施”说成没有AWS写入。

没有新IAM/Stack/Cell/compute、后端/CORS/TTL/数据库变更、PEM/.env/控制私密包读取、其他字段转移、资源/对象删除或自动重试/回滚/撤权/清理。配置、GitHub环境Secret、持久窄IAM、326对象/版本和CDN会继续保留；费用仍可能累积，50 USD/月不是硬上限。本轮没有读取全部账单或声称停费，也不保证JS字符串安全擦除。

主原件 `F:/ChatGPT_workshop/techlong-buyer-web-publication-20261028-a/execution-result.json`，raw SHA `e1e7ac2799ca0497884a568622d17522a2bc85f13a55fcc5e50f789d8c3b3d37`。恢复先读同目录 `executed-verified.json`（raw SHA `379c64cbe93ff4fd7fd824476c4da791f1e001f8c7aa419c5ce826c950e4be80`），绑定准备/开始/永久标记/预检/秘密读取意图/无正文写意图/真实dispatch ACK/本人门禁/结果/一次性脚本共10原件；原始提供者记录和对象列表不提交Git，仅保留[公开资源/状态摘要](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.publication-executed.json)。

永久标记已消费，**不得重跑run-publication.mjs、重复读取秘密或再次dispatch**，不得删除/复位标记、覆盖旧PENDING材料或将其当未执行继续点。标准加密依赖仍留本地供追溯，不是应用运行时新依赖。

## 下一唯一动作

只准备**新的真实后端联调/CORS与有限业务验收窗口**：复用既有请求/Review→RunOnce→Inspect能力、镜像/数据库和本次已发布客户端；当前API编译目标仍为first-acceptance.sandbox.techlong.cloud，未来准确CORS须包含真实ClientOrigin并核对保留原来源。先确认新的合法请求/来源/期限和资源现状，再一次性准备准确审批材料，不重放已消费的a00或其他旧任务，不为新job复制固定任务代码分支。

旧准确后端最后19:46元数据仍DELETE_COMPLETE，本轮未查或改后端，没有新租约或恢复批准；不能把该旧UUID当现存栈UpdateStack。后继AWS/Neon/私密读取、业务写和实际恢复均按新的准确范围另审。本轮不继续改前端、补探针、扩UI/执行框架或为了展示标签导入更多回执；`wholeProductAccepted=false`。
