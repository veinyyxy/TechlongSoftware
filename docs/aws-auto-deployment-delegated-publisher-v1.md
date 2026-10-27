# 免 Web 后继计划准备核心与本轮真实时限

2026-10-27。本阶段完成的是**内容核验及后继 SQL 提案核心**，不是已安装的在线发布器，也没有发布或调度 RunOnce。新增 `ops/platform-delegated-publisher-v1/successor.mjs`；沿用已有 RecoveryPublisher 的完整内容重建，不新增证明协议、数据库 schema、IAM、镜像或云 worker。

## 先纠正当前执行状态

准确 Review run `40453693112` 成功不等于部署完成。本轮另批的只读核对读取了它的结果和绑定 manifest 的固定版本，确认：

| 时间（温尼伯 CDT，2026-10-27） | 意义 |
|---|---|
| 00:10:44 | worker 生成实际审核 manifest |
| 00:25:44 | 固定15分钟领取窗口截止 |
| 01:10:44 | job deadline |
| 02:10:44 | workload TTL |
| 07:37:18 | 本次只读核对，领取与TTL均已过期 |
| 13:47:57 | 原basis/grant截止，**不延长前面任何窗口** |

实际核对 STS1、任务前缀List1（≤20项、不翻页）、HEAD1、固定版本GET2、准确GitHub run GET1；没有读配置、Secret或PEM，没有SQL连接、资源/数据库写、槽消费或调度。原结果及manifest引用、SHA、版本与原件保存在本机私有证据目录，不把历史成功当成当前执行授权。

该旧执行周期不能继续RunOnce，Review永久槽不复位、不重跑、不修改manifest时间。旧57bf…grant、审批、6366…/45fd…记录及全部原件保留。本阶段结束旧源码冻结，仅作新的代码/文档提交；新源码不冒充旧grant绑定的ab5版本，也不自动获得部署权限。

## 新核心做什么

`proposeReviewSuccessor`只接收已存在的真实计划/attempt、准确GitHub run及固定版本证据读取能力：

- 拒绝错误源码、plan/action/risk、UNKNOWN、已有proof或不匹配的实际观察状态。
- 严格核对来源、reusable工作流、结果版本/hash、manifest、package、installation及原始业务内容。最多读取四个明确白名单对象，按版本缓存，不任意遍历前缀。
- 在完整核验前先阻断已过期领取、basis、90分钟承载预留及8分钟交接预留；完成重建后再次检查。没有Web租约、伪造续期或调用方传入的期限放宽开关。
- 通过现成 `createRecoveryPublisher`在内存中捕获一次proof及一次RunOnce计划，连同一次observe提案返回；**不接收实际SQL writer**。内存OBSERVED仅用于预验证，输出明确`actualObservationVerified:false`、`proofImported:false`、`successorPublished:false`和`physicalOwnerWrites:0`。它不是数据库事实或已发布授权。

模块导入不会发现凭据、打开连接或调用网络。没有生产CLI/HTTP路由，没有自动激活或dispatch。现有人工Web入口、旧发布器默认行为和GitHub本人environment门禁均不变。

本机223项相关测试通过（新增15项），类型检查和限定lint通过；覆盖真实过期时间、UNKNOWN/已有proof/假OBSERVED、错误run/源码、证据篡改、核验期间时钟跨过预留、缓存四对象及无真实写入。准确提交的无AWS身份CI结果另存完成回执；单元测试不是实际生产发布或部署证明。

## 下一阶段必须一次接齐，不能边开短窗口边补代码

当前dispatch-only委托不覆盖观察/proof/后继计划写入。实际在线入口仍需新受审范围：固定源码/CI、现有业务与保护基线、完整旧历史加本轮新seed，准确证据引用，最多一次observe、一次proof、一次publish及独立连接回读，永久尝试槽和提交不明停止规则。此模块不声称已经实现这些实际写能力或基线检查。

真实发布入口应在下一次Review前备齐“Review→内容重建→三项受限发布→RunOnce代批/单次dispatch”的连续链，不再等待聊天中的“下一步”才做必要衔接。用户仍亲自批准每个GitHub environment；任何等待跨过worker截止都停止，不自动重新Review。

旧 `platform-recovery-launch-v1`还依赖有效Web租约、hosting源码匹配及单Review历史，不能直接调用或删掉保护。未来免Web入口须保留旧6366…与新45fd…等完整记录，沿用原始业务/保护基准，不能把新旧历史合并成假单行。无需为Web按钮续租。

若继续部署，需要另审保留历史的请求衔接；不自动取消当前任务、生成新job/requestId或删除原记录。**现有冻结云入口还固定9b任务作用域**，不能只替换job ID并声称新请求已兼容；相应绑定/发布变更也必须先明确受审。没有授权扩大任务选择或修改冻结云闭包。代码提交授权不等于这些业务、发布、IAM或云部署授权。

本阶段的新核心与测试为后续最小衔接复用，不扩大F3c9、Web UI、IAM探针或镜像支线。50USD/月仍是预算目标，不是硬停费保证；历史承载是否继续计费未在此次范围中检查，清理仍另审。
