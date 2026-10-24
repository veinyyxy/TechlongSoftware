# W8s：新待审任务与云端连续审批衔接

## 目的与当前状态

W8r 已完成一次原子交接和独立回读：旧任务 `job_6e2e115c80301595512f11fb` canceled；新任务 `job_6a1129afcebfc9fb580517c9` pending、attempts=0、available_at=9007199254740991、未授权云执行。其余六条任务、业务准入快照、保护布局和旧控制历史不变。这是 W8r 回读时的事实，不是后续全局状态保证。

本阶段只提交操作者代码、测试及本文档。没有读取 `.env.local` / AWS Secret / PEM，没有连接 Neon、修改 AWS、发布计划、dispatch、创建承载资源或启动租约。已有承载可能继续计费，租约过期不等于停止收费。

不重放旧 Review 40106010722，不延长其 claimBy，不复用旧执行批准或永久槽。W8r Source 冻结期已结束；新周期必须绑定最终新 main，并在 Review 发布前完成操作者适配、CI 和连续衔接准备。

## 工程入口

- `ops/platform-review-v6/transferred-cycle.mjs`：新任务固定范围；从已完成交接的前后快照重建 anchor，保留旧记录，并提取原 Review 的两个准确版本引用。注入端口的单次发布器复用既有 trusted publisher，只允许一条准确 `publish_plan`，不授予执行权限。
- `ops/platform-review-v6/hosted-handoff.mjs`：真正的 HOSTED 租约门禁；不把 HTTPS 租约改造成 localhost 租约。复用原根契约、证据重建、8 分钟预留和计划缩短规则。
- `tests/platform-transferred-cycle-v6.test.mjs`：目标绑定、历史/布局变化、占用槽、真实 publisher 的 HOSTED 衔接、版本化 lineage、时钟耗尽和提交不明等测试。CI 无 AWS 身份或部署门禁。

旧 `ops/platform-operations-v6/handoff.mjs` 的本机协议保持不动。新云端桥接保留相同证据算法，并额外在持久化拟议证明之后、真正提交之前重查批准、源码及剩余时间。两条路径都由同一 trusted publisher 和 reserveRunOncePlan 校验；后续修改需一起跑其回归测试。

这些是显式依赖注入组件，**尚不是可运行的生产写入 CLI**。没有默认凭据发现、默认数据库连接、后台轮询或自动部署。必须先完成新窗口的真实端口组合及独立 Inspect，才能发布新 Review；不得先发布再补操作者代码。

## 时钟与连续执行

1. 先完成云端窗口适配、源码兼容见证及全 CI；核验准确新任务仍 held、新任务控制账本为空，旧历史保持原文。旧任务的 ledger 不能用来推断新任务 ledger 为空。
2. 准备新的待审窗口/发布/衔接材料，绑定真实现状、固定版本引用和独立永久槽；具体 AWS 更新及数据库写入分别按 fresh SHA 批准。只读准备不启动任何时钟。
3. 人员、准确实例页、GitHub environment、独立验收和 publisher 端口均就绪后，才允许单次发布新的两小时 Review。实际 HOSTED 租约必须尚有超过 15 分钟；批准/source/readiness/快照在写入前复查。该操作最多两分钟，不能续租。
4. 用户亲自批准该 Review 和 GitHub environment。Review 的云端 manifest 使用原来的 15 分钟领取窗口，不得重签或 restamp。
5. 完整验证准确 run 和固定版本 S3 对象，先只在内存重建证明；随后准确观察一次、真实 attest 一次、发布缩短期限的 RunOnce 一次，并回读两条实际账本记录。内存重建不会假装持久化 observation/proof 已存在。
6. RunOnce 计划期限只取原期限、claimBy−8 分钟、租约到期−8 分钟的最小值。剩余不够就停止。用户仍需分别批准准确 RunOnce 及 GitHub environment；本桥接不 dispatch，不创建资源，不宣称部署已通过。
7. 实际 RunOnce 完成后仍需独立云端 Inspect。成功的 Review 或 GitHub success 不能代替业务/资源验收。

## 证据与范围

本阶段使用已批准、已保存的 W8r 本地快照做离线契约核对，不是新增数据库读取。W8r 完成证据：`F:/ChatGPT_workshop/techlong-w8r-task-transfer-executed-verified-20261024-a.json`，原始 SHA `ea3cd27c1ff9cfa1c9977efa19eb6350682209fcc8b76572a5c8637021e8f6cb`。后续生产组合的 `assertTransferEvidence` 必须核验这些实际字节和关联证据，不能把调用者自报的 JSON 当成独立证明。

复用的是原安装/实际成功部署 lineage 的不可变对象，不是原待审任务的执行授权。lineage key 中历史任务名只是对象名称；内容仍由 trusted publisher 重建。无须再写一份重复 lineage 对象。安装对象完整内容的 SHA 是 `695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae`；key 里 `0edfa9d7…` 是对象内嵌的 body SHA，二者不能混用。S3 版本、加密、长度、完整内容摘要及 lineage 根契约仍逐项验证。

固定新槽预留名称见 `TRANSFERRED_CYCLE`；本阶段未创建或消费。真实入口必须以不可覆盖、持久化方式消费槽，处理领取/写入回执不明；不允许由普通临时文件或内存标志冒充永久槽。

## 尚未批准的副作用和风险

未来真实发布需要受审 owner 数据库能力；未来衔接涉及最多一次 observation 和两次 owner 提交（proof/plan），并读取有限固定版本证据。它们不是跨服务原子操作；前置元数据和反复核对不是 CAS，仍有并发竞态和不明提交。必须限制读写端口、次数和凭据生命周期，并生成新的准确清单。

凭据可能过期，日志/网络可能暴露审查元数据；部分写入可能保留。任意失败均保存阶段和已提交计数，不自动重试、撤权、删除、补齐、复位或延长窗口；必须独立回读后另审。永久槽消费后不回收。收费、租约关闭和资源清理仍需单独管理；50 USD/月是目标而不是硬费用上限。

## 下一步

先只读核对现有 hosting 栈、准确角色和固定 Secret **元数据**、新旧任务及新任务控制账本，准备新的短时 HOSTED 窗口和真实操作者组合。新的私密配置读取/Neon 连接、AWS 元数据读取各按限定范围取得许可；不读取 Secret 值/PEM、不写入或开窗。全部组合及 CI 完成后才请求具体写入 SHA 批准，保持源码冻结直至本次 RunOnce/独立 Inspect 完成。
