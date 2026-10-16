# W3：真实 AWS 承载执行器与单次 worker 根已接通，待批准实跑

> **本待审资料已执行，不可重放**：用户确认r2完整SHA后，一次新job/建栈、两认证GET、原子收口和独立Inspect已于2026-10-16 11:51:24 CDT全部通过。新栈UUID `74a79560-c981-11f1-bfcc-06ffde30f30d`、task definition:4，固定13:42:30 CDT到期；五个永久槽均已消费。[实际结果与继续边界](aws-auto-deployment-aurora-dual-mode-w3-executed.md)。以下为历史准备说明，不再是可执行批准请求。

2026-10-16 Winnipeg。承接 [W2](aws-auto-deployment-aurora-dual-mode-w2-single-job.md)，不扩展 Grant/generation/F3c9 支线。**本轮完成代码和真实只读 Review，没有创建 job/stack、读取原私密包或向应用发送请求。**

## 已接通

- `express-initialized-workload-v3.mjs` 使用 W1 实际七资源渲染器，生成固定模板/参数/请求。新镜像仍为 `0dc34eda…`，单 Fargate task **0.5 vCPU / 1 GiB**；不重新发布镜像或改父 Cell。job/owner/epoch、原库和固定 Secret 版本沿用。
- `aws-express-initialized-workload-v3.mjs` 是真实 AWS SDK + 只读 CLI 实现，不是模拟器。唯一云写命令是一次 CreateStack；SDK/CLI 不自动重试。创建前检查真实 IAM/Cell/命名空间/配置、强一致 DDB；后续只等待本次 UUID、证明模板/参数/七资源、实际 task definition/digest/健康 target，再重新强读 authority。
- `run-express-initialized-worker-v3.mjs` 已提供真实 `CheckRuntime / Review / RunOnce / Inspect` 根：集中 SHA 准入 → W2 新 job/DB-clock lease → 一次受审承载创建 → 惰性加载既有控制材料 → W1 两次 GET-only initialized/config 证明 → W2 原子完成和另一只读事务回读。Run 前在磁盘永久消费槽，job ID/dedupe 另由 PostgreSQL 约束；没有全局队列、首次初始化或自动补偿。
- Review/Run 绑定 **76 个本地代码/依赖锁/风险文件**与35份公开来源摘要，固定 Neon endpoint 摘要、W1/W2 材料及全部九行快照。Inspect 不重放 Run/写入，不读私密包，只确认新任务、旧行与准确承载；无法证明则明确 NOT_PROVED。

生产路径代码已可调用，但并未把“代码可运行/端口注入成功”当作实跑证明。AWS CreateStack/Neon 真实写事务、mTLS/JWT 请求和原子完成尚未执行，首轮创建权限与端到端成功仍未实证；全局默认 worker 保持 disabled，Full/旧 V1/W1/W2 文件及历史全部不改。

## 真实状态及验证

Source 初始登录过期，在任何资源查询前停止；用户刷新后3次 CLI 读取确认准确旧栈 `ab4aa8c0-c966-11f1-b068-0ecbbd896a2b` 已 DELETE_COMPLETE、ECS INACTIVE 且 desired/running/pending=0。没有请求删除。后续完整 Review 又确认旧七资源全部 DELETE_COMPLETE、旧 task definition:3 INACTIVE，命名空间、日志/target/活动 task/listener 优先级无冲突。只证明该旧承载退出，**父 Cell、库及整体费用未停止**。

最终 r2 Review 于 **2026-10-16 11:42:43.987 CDT / 16:42:43.987 UTC** 完成：38次SDK+13次CLI资源只读和1次Neon只读快照；现有角色/策略、Cell原16资源/输出、固定 Secret 元数据、Aurora元数据、两manifest及既有扫描、DNS/mTLS、既有Janitor和两个强一致authority读取均通过。先前 K3b 中新 authority namespace 的 UNKNOWN 不能当缺席；本次新强一致读取已实际要求其缺席并通过。

本阶段另保留r1完整只读 Review。随后仅修正顶层失败提示，避免磁盘收尾错误被误称为“无动作”，导致代码绑定变化，故r1 SHA `5fdfc3d5…` 已作废，r2重新读取生成，未重试任何写。两轮Review各38SDK/13CLI/1Neon；另有前述3次成功CLI与1次过期身份尝试。最后26项测试（5新+21相邻）、typecheck、四文件ESLint零警告及语法检查通过。测试不冒充实际 cloud/HTTP 执行。

## 当前唯一待审清单

完整 SHA：`bf4bd8b45acc0a01d1e24451e219891ee9d30521ac41a17e0d460fb584909937`

- 本地原件：`F:/ChatGPT_workshop/techlong-worker-w3-review-20261016-r2/manifest.json`，三份r2原件及三份作废r1原件摘要保留在[机器记录](../ops/aws-sandbox/reviews/aurora-dual-mode-w3-worker-root.prepared.json)。完整配置/快照/临时凭据不发布到Git。
- 新 job：`job_e4147af2f10faf37b51ec9a3`；旧 `job_202c8dc12a8bf379f3a7c693` 必须保持 succeeded。不借旧 lease，不再 POST/迁移或重建数据库。
- 领取准入截止：今天 **11:57:30.084 CDT / 16:57:30.084 UTC**。新 workload 固定到期 **13:42:30 CDT / 18:42:30 UTC**，不会因 Run/MFA/失败续期。若清单过期，先退出，槽不消费；只能只读刷新后再确认新 SHA，不按旧授权重放。
- 实跑最大变更：1个新job、一次CreateStack/7资源、一次既有私密包读取/最多两次认证GET、2行原子完成；不改IAM/DNS/DDB/Secret/父Cell/数据库初始化，不直接连接Aurora，不升级账户plan。

[完整范围、私密材料与费用/失败风险](aws-auto-deployment-aurora-dual-mode-w3-execution-review.md)是清单的一部分，特别注意整包内含未暴露/未使用的Stripe秘钥、跨服务非原子/并发、CFN OnFailure=ROLLBACK、收费遗留、固定到期/永久槽不重置和不自动重试。50 USD/月是目标，不是硬cap。必须另得明确同意后才 RunOnce；Source刷新不是部署授权。

下一步只执行上述集中受审闭环，完成后再独立 Inspect。若失败只检查准确新 job/UUID，不新开权限/诊断代际或重跑首次开通。
