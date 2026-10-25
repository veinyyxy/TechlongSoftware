# W9d：新部署周期只读准备与恢复边界

状态：**只读核验完成；尚无可执行部署清单。** 下一步需要确认恢复兼容方向，不应批准、重放或刷新旧部署执行清单。

## 新鲜事实

用户于本阶段明确允许：现有 `.env.local` 进入内存一次、一条经验证 TLS 的 Neon 只读连接/最多45条查询、最多75次 AWS 元数据调用。没有允许业务或云写入、Secret值/PEM读取、Aurora连接、发布/调度、执行槽消费。

记录时间 **2026-10-25T18:48:37.827Z / 温尼伯13:48:37.827 CDT**，采集源码为 `3d3c8e00a709f850cee4377c19d8af104eddc8ae`：

| 项目 | 新核验结果 |
| --- | --- |
| 平台 hosting | 原 UUID `c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`，revision8、root event `9e879e90-d082-11f1-85a0-0213e2e89789`，完整既有窗口资源/镜像/健康核验通过 |
| 控制租约 | 原租约已过期，本轮未续租或更新服务 |
| 旧租户栈 | UUID `53f32460-d084-11f1-ad5b-0ee0206d8b5f` 为 `DELETE_COMPLETE`，七项CFN资源记录均 `DELETE_COMPLETE` |
| 历史任务 | 九条均终态：六条 succeeded、三条 canceled；无 pending/running任务可供旧转移算法取消 |
| 最新任务 | `job_9db8466fd95cef0c23ad6bfc` 保持 succeeded，成功回执未变，但没有期限内的规范独立 Inspect |
| 控制账本 | 旧两代4计划/2批准/2尝试，最新任务2计划/2批准/2尝试；完整内容与W8z独立读回一致 |
| Neon现状 | deployment仍 ready，资源生命周期仍 verified、destroyed_at为空；历史完整业务/任务/账本/保护状态与W8z快照一致，未自动对账 |

实际总计 **AWS元数据59、配置内容读取1、TLS只读连接1、SQL调用14**；Secret值/PEM/Aurora连接/云写/业务写/槽/调度/重试全部0。剩余上限不是继续读取的授权，本次只读范围已经用完。

准确旧UUID的删除记录不等于证明同名空间当前不存在新对象，也不证明所有孤儿资源或共享收费资源已清空。新部署前仍须执行原有命名空间与存活检查；平台、共享Cell/数据库等可能继续计费，50 USD/月不是硬停止机制。

## 为什么不能直接生成下一份 RunOnce 清单

1. [已发布云链路](../ops/cloud-worker/cloud-worker-root-v5.mjs) 的 `continueCloudContextV5` 第69–92行要求每个前代有完整的 `SUCCEEDED_INDEPENDENTLY_VERIFIED` Inspect、不同执行run、准确回执和provider摘要。最新9db只有执行成功，不能把W9a/W9b的过期后报告冒充该Inspect。
2. [现有准入](../ops/aws-sandbox/scripts/express-platform-worker-v4.mjs) 第69–85行又要求数据库最新成功回执与前代严格一致。因此不能跳过9db，假装更早已验收任务仍是“最新”来继续。
3. [旧 held 转移入口](../ops/platform-request-v6/transfer-next.mjs) 只处理固定 pending旧任务的取消与新任务插入。当前9db已成功，不符合它的前置条件；不能复用该入口取消成功任务、重置attempts或重开永久槽。

这是**恢复连续性策略缺口，不是凭据过期或权限不足**。不能通过重放旧Review、追加旧RunOnce计划、放宽TTL、伪造Inspect、改写成功任务/历史回执、删除唯一约束或先创建收费资源来绕过。

## 建议的最小恢复兼容方案（待用户确认方向，未实现）

只推进一个恢复分支，目标是继续同一已初始化 sandbox 的新受审承载周期，不扩展清理器：

1. **独立恢复基准，不伪造已验收前代。** 用准确旧job/run/manifest/原成功回执及原provider证据，绑定独立读到的准确UUID栈与七项删除记录、当前Neon任务/账本/保护摘要。明确标记 `executionSucceeded=true`、`independentAcceptance=false`、`retired=true`。它只描述“允许审查一次新恢复”，不能放进现有 accepted lineage，不能授予历史或当前验收成功。
2. **一条新 held 请求，保留旧成功。** 复用已有待审请求编译器和admission锁，只提出插入一条新的reconcile/pending/attempt0/max1/available_at=MAX_SAFE_INTEGER记录。旧九条任务、所有成功回执、旧账本和客户权益不更新、不取消、不复位。不重建数据库或Cell，不初始化商户数据。
3. **新的受审云恢复入口。** 在新代码契约中严格区分 accepted lineage 与 recovery baseline；默认旧成功路径不放宽，缺少准确恢复基准仍拒绝。执行前独立核对旧栈已退役、准确命名空间无冲突、现有外部epoch/资源所有权未漂移，之后仍限一次CreateStack/七项承载资源/固定材料读取/两次认证GET/原子完成及全新回执。不得重用旧的执行批准或槽。
4. **新周期立即接独立 Inspect。** 沿用W9c跟进器，在准确新RunOnce ACK后提前批准并启动；保留GitHub environment人工审批、原始TTL和至少10分钟剩余观察预算。新恢复只有新独立Inspect的完整证明才能算通过，不由恢复基准或GitHub success代替。

以上涉及新的云恢复契约，**不是当前已发布81项闭包已经支持的功能**。本阶段未修改它。应先完成本地最小代码/测试与文档，再逐项审查云代码发布及必要的精确trust/pin变更；不能把当前只读许可或代码提交授权扩展为云发布/IAM更新/调度/Secret读取/数据库写入批准。不预设需要新增IAM动作或资源，也不以“权限问题”为由自动扩权。

## 接下来的批准顺序

下一次只需先确认是否同意上述**恢复兼容实现方向，仅本地代码、测试与文档**。不要现在确认一个不存在的部署SHA。

实现及CI通过后，再准备准确的新请求登记清单、云恢复发布/绑定清单和新部署/跟进清单；实际数据库或AWS写入各按明确资源、上限与新SHA批准。运行窗口在相应批准真正开始时生成，不给旧窗口续命。新成本清理与Neon现状对账保持单独边界，不在本阶段悄悄加入。

## 证据与保存

- 本次唯一只读采集目录：`F:/ChatGPT_workshop/techlong-w9d-fresh-cycle-readonly-20261025-a`，六份原件保留，不覆盖。
- `result.json`：`FRESH_STATE_VERIFIED_LINEAGE_RECOVERY_REVIEW_REQUIRED`，`executionAuthorized=false`。
- W9c实现记录：`F:/ChatGPT_workshop/techlong-w9c-immediate-inspect-verification-20261025-a.json`，原始SHA256 `2c147ea5b35e25dfb9857880116b8b95925902d46485cf2f53c1ef9fdf88e9c7`，CI40222334054成功。
- 64份W8z原件在采集前全部重新核对摘要。当前云健康/删除和数据库事实来自本次新的读取，而非旧快照替代。

只有本摘要进入工程；原始数据库内容、账户资源详细清单和本机配置均未加入Git。源码提交/推送沿用既有授权，不要求再次确认；这不改变上述云与业务执行边界。
