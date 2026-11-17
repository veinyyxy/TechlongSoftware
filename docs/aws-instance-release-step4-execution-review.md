# D2-6 步骤4集中执行审批：最小恢复、九图、初始A与runtime

2026-11-17，America/Winnipeg。本文件及[机器清单](../ops/releases/d2-6-step4-execution.review.json)只是等待批准的操作范围，**本轮未恢复、写数据库、修改IAM或启用runtime**。不新建部署工具/框架；使用既有CFN/数据库/采样端口做这一轮有界编排，不能声称已有通用“一键启用”命令。

## 材料已齐，不重复盘点

[只读结果](aws-instance-release-step4-read-observed-20261117.json)已真实完成；[唯一旧测试修复及CI](aws-instance-release-step4-test-ci-20261117.json)对应源码`6f84f14f7ee38dd8b9bf650f5b39a43bebcba9d0`，[CI44173152522](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44173152522)的离线与隔离PG两个job均success。本机238通过/1平台相关跳过，lint/类型通过。只改测试文件，不改生产CLI、工作流、权限、运行配置或旧事实。不是一次实际部署验收。

同一实例`app_e897a4377bce498b9c5ee9e64509dcad`、ca-central-1，A已发布/可信登记，B已登记未晋升候选，不重做。原Cell/tenant保留12/3资源，两份恢复候选已验证。当前初始release绑定不存在，九个准确媒体目标为空。Aurora/writer原本已available；本轮没启动它，也没有取得停库授权，可能持续计费。平台Web/ALB和独立prod RDS不在本次恢复内。

## 一份批准覆盖的顺序

1. 批准后才核对准确Source、原快照未变与当前Git代码/配置，保留新单次私有INTENT；不复位旧槽。只对同一资源做执行前置和独立核验，不重新全账号盘点。
2. **先数据库与文件，后收费ALB。** 复用原Source IAM/固定Express endpoint/ATS根/SNI/证书验证建立受限连接；最多3个临时IAM token、3条TLS连接、60条SQL。库必须仍available、身份准确，失败停止，不自动启动、改网络或创建代理/task。读取兼容/初始化及九行媒体必要投影和引用；不执行旧空库观察器、初始化或DDL。
3. 仅历史九行仍准确匹配且没有其他被引用本地依赖时，读取已固定的九个本地文件（每个≤5MiB、总≤45MiB，原合计1,233,239字节），核对大小/SHA，向原图片桶准确products/*键最多9次条件PUT，不覆盖/删除。最多9次固定版本GET及9次公开CDN GET核对内容，不执行页面JS。单事务准确CAS≤9行，只改存储提供者/桶/key/public_url及必要variants；variants只改完全等于该行旧public_url的字符串值。store_id NULL、ID、product_images关联、时间/其他字段保持；异常触发器或额外本地变体依赖停止。提交不明不重放；新独立连接核验。
4. 原tenant停用态一个CFN Change Set，仅ImageUri对齐已验证A，其他参数UsePreviousValue、UsePreviousTemplate；严格只准TaskDefinition Modify/Replacement=True，仍3项/无Service。用既有底层CFN运输，不放宽`applyStack`的原合同。这不是两次正常更新中的一次。
5. 原Cell一个Change Set恢复ALB、443监听器、8443 mTLS监听器及共享拒绝规则4项Add；保持其余12项、网络、证书和verify-mode trust store。新物理ID必须来自真实输出并独立核对。
6. **原IAM栈唯一ManagedPolicy修正**：`techlong-s3-bootstrap/8afbe1e0…`的`ExecutionRoleBoundary`。保留其余23项及所有根字段/参数/标签；以本轮真实有效v10为权限基准，只把对应当前tenant两监听器的旧规则前缀替换成真实Cell新前缀，另外两历史前缀和所有有效Action/Condition/Principal保持。原模板声明与实际v10不同，明确包括这一资源声明向真实v10的收敛，不冒称仅两行文本替换。只能经原CFN栈，严格一个ManagedPolicy Modify/无替换；不直接写IAM、新增角色或扩有效动作。完整模板超过51,200字节时，允许原构建桶最多1次准确内容hash键条件PUT、一次TemplateURL ValidateTemplate，再核对Change Set实际模板SHA；不承诺Object Lock。新ARN与模板SHA依固定规则由本轮真实输出派生，完全匹配后不再等第二次聊天批准。
7. 原tenant另一个Change Set恢复Service与三规则4项Add，desired1；保留A和已装S3四环境值，六参数仅绑定真实Cell输出。必要时准确API域名A Alias一次UPSERT，不改其他DNS。至此最多四Create/四Execute，不直接创建ELB/ECS/监听器/任务定义。
8. 独立进程核对实际CFN归属/参数、ECS稳定digest A、路由/目标健康、443/8443 mTLS/DNS与严格Express readiness，使用原采样/`releaseRuntimeDigests`生成真实兼容、持久化和配置证据。只对准确API的`/health`、`/ready`各最多3次HTTPS GET，无身份、不跟重定向，不登录或做买卖家业务测试。
9. 现有`.env.local`全文件读取1次、验证TLS的Neon连接最多2条/SQL40；新鲜不存在证明和全部技术证据通过后，一个owner事务INSERT唯一初始`instance_state`行：A/revision0/无active request/真实sampling基线和证据。临时owner SET成员权限在同事务关闭；独立READ ONLY连接以已证明SELECT权回读整行，无额外membership grant。不重插A/B，不改业务记录/结构或原初始化状态。
10. 最后只将已安装关闭态候选配置的数据启用提交/推送main一次，预期规范SHA固定在JSON；bootstrap仍关闭、日常workflow不变，本轮不dispatch。之后A→B、B→A才各走一次正常工作流和本人GitHub environment审批，仍是0/2未完成，不能把本步骤冒充D2-6全部验收。

## 总预算、真实期限与停止条件

- Source STS≤3；准确白名单AWS元数据≤320，含四个CS的创建/执行轮询各阶段≤24次（相邻轮询至少15秒，单个请求不重试）、执行前置及独立采样。只允许JSON列出的服务/操作/准确对象，不翻页或任意日志/CloudTrail查询。GitHub只读GET≤6/显式Git认证helper≤1，仅main/准确CI/原本人门禁和B artifact元数据，无下载/POST。
- 图片PUT≤9、模板PUT≤1、图片固定版本GET≤9、公开图片GET≤9、API技术GET≤6、CFN Create≤4/Execute≤4、准确DNS UPSERT≤1、媒体CAS≤9、初始绑定INSERT≤1、runtime数据提交/推送≤1。除原CFN资源恢复/替换，没有新角色/Secret/schema；RDS启动/停止写0，Secret值/PEM/PAT/HMAC读取0。
- Source现有凭据/自动刷新仅限同一profile/IAM用户，失败停止，无别的身份fallback。ECS正常托管注入准确两固定应用Secret版本可能发生多次提供者读取/任务重启，并非代理直接GetSecretValue；明确包含此副作用，不虚报AWS全过程Secret读取绝对0。
- 本次新事实仍截止**2026-11-18T00:53:21.305Z＝今天11月17日18:53:21温尼伯**，总执行最多90分钟，因此**最晚17:23:21温尼伯启动**，实际各阶段还须留足该共同截止时间。B原产物11月18日10:45:19到期、扫描独立有效期不延。准备完成/CI/push/额度恢复不重新计时。截止不是资源自动停费时间；不设自动删除或新租约。
- 任一未承诺读/资源变化、权限不足、媒体依赖新增、实际CS超界、证据不符、写入/提交不明、超预算或时间不足均停止。没有新Start/Grant、第二次Create/Execute/PUT/INSERT、Re-run、补齐、自动跨服务回滚/清理。后继必要查因或停费仍准确另审。

## 完整风险

- 现有Aurora可能已计费；恢复Cell ALB/mTLS、Fargate任务/公网IPv4、日志、S3/CDN/传输和GitHub运行会继续产生费用。50USD/月是目标而非硬限额；本次不设自动到期，完成/失败后资源可能继续收费，停费另批。
- CFN为唯一资源管理者，但正常CFN受管回滚、ECS部署熔断、旧TaskDefinition revision或policy version清理可由提供者发生。它们不是代理另发回滚许可，也不保证所有资源都恢复原状。执行ACK不明时CFN仍可能继续创建资源。
- 媒体上传、数据库CAS、CFN/IAM、DNS、Neon绑定、Git配置跨服务非原子；失败可能留下公开对象、已改变行、收费资源、权限版本或已插入绑定。不会自动删、down、回滚、重试或把独立读回结果冒充明确提交ACK。
- 既有Source IAM/owner权限较宽；配置全文件、临时IAM token、媒体原图、模板/策略和必要数据投影进入进程内存/私有磁盘。TLS不能消除主机/提供者日志风险；只保存必要摘要，不把凭据、私钥、原始业务快照、签名URL或模板环境正文提交GitHub。
- 图片将公开经CDN访问，可能被缓存/下载；本次只处理已批准九张，不证明整个产品隐私策略或全量媒体迁移安全。NULL店铺归属与旧关联保留，不推断、更改归属。
- IAM声明与实际v10收敛有并发/非CAS风险；上传内容hash键不代表不可变存储。执行前仍严格复核真实有效policy与原栈/CS模板，变化即停。动态物理ID/哈希委托只限机器清单中的确定性规则，不允许自由扩大资源。
- owner临时SET与行提交不当可能遗留权限或不明事务；必须按原事务规则关闭并独立核验，创建者ADMIN不删除。初始绑定不是正常release结果，不伪造SUCCEEDED请求。
- 这是最小部分恢复，原全环境启停工具/journal保持原字节，不把它标成全环境RUNNING或重置旧周期；后续停费需按真实新CFN状态另审。平台Web/ALB、prod库、业务测试、Full、身份/Secret重装、镜像构建/发布、后续两次release均排除。

只有对机器清单规范JSON SHA的明确批准才可执行以上范围。**本轮到此仅完成旧测试/CI及准确审批材料，未执行这些操作。**
