# W9g：恢复协议云端最小入口候选

状态：仅本地实现、No-AWS 测试及发布材料准备。新 held 请求已在 W9f 独立核验；本阶段不再登记或读取生产数据库，不读取私钥/Secret 值，不查询 AWS，不上传 package，不修改工作流、controller binding、trust 或 IAM，不 dispatch。预算目标仍为 50 USD/月，不是费用硬上限。

## 最小实现与原协议隔离

新增 `ops/platform-recovery-cloud-v1/`：显式 GitHub OIDC/STS 入口、三模式编排、SDK/RPC 组合、闭包计算和只渲染的工作流材料。原 81 文件发布闭包必须逐字保持不变；已上线工作流和 V6 安装 binding 不受本阶段提交影响。新入口默认没有 PUBLISHED 发布记录，普通本地运行会在获取凭据前拒绝。

公共恢复基准、wire package 和纯状态准入断言与本地单次槽分离。云端图不能包含本机盘符、登录凭据发现、shell 或本地配置入口。原固定版本证据仍完整重建、同一 WeakMap brand 校验；这不是仅信任序列化 JSON。拆分不改变原审批清单或历史证据；已经消费的登记槽绝不重放。

保留现有七个 workflow 输入、App actor、environment 人工批准、并发组、固定角色 ID、一次 STS 会话、无 SDK 重试和 V5 内核。工作流 renderer 只返回文本，后续实际两份工作流发布和精确 reusable trust 变化需独立清单批准；本阶段不写运行工作流。

## 三模式与证据路径

- Review：读取版本固定的恢复 package 和 installation，完整重建恢复基准；在读取数据库 Secret 前核对准确旧栈 UUID 的退役事实。原 V5 内核继续检查当前业务准入、容量、命名空间和 authority。先保存原 inner manifest，再保存恢复 envelope 和结果；不领取或创建承载。
- RunOnce：外层恢复 SHA、基准 SHA、inner code/source/closure 和未过期窗口全部绑定后，调用原 V5 单次领取、最多一次 CreateStack/七项资源、一次私密控制读取、两次认证 GET 与原子完成。新增 descriptor 路径绑定外层 SHA，内含原 run/报告以及 recovery SHA，不能与旧 descriptor 混用。
- Inspect：必须是另一 run，严格核对 descriptor 的四字段、源码、旧执行 run 和 inner 报告路径。只调用原独立只读 Inspect，不回退 RunOnce、不补偿或重放。

每种模式都重新做最多两次准确 ARN 的 CFN 元数据读取。SDK Date 与原 CLI ISO 格式只做时间语义标准化，仍逐项比较全部七条原资源记录、物理 ID、状态和时间；任意差异、分页、缺失或身份异常均停止。退役不是命名空间空闲或 authority 的替代证明，原 V5 检查保留。

## 具体副作用与后续审批风险

以下是未来发布后可能产生的副作用，不是本阶段授权：

1. GitHub OIDC 经 STS 签名验证后承担现有部署角色；JWT payload 的本地预检不是签名验证。必须绑定 App actor、准确 repo ID、workflow/source/reusable SHA、environment、run attempt1、原角色 ID 及 endpoint。工作流文本中的 PUBLISHED 字面量也不能替代独立源码/CI/identity/trust/activation 审查。
2. Review 新增一个 envelope 对象，所以在原 inner manifest 之外还需 envelope 和结果，总计最多三次条件 S3 PUT。每次使用固定私有桶、AES256、准确 key 和版本回读，`IfNoneMatch=*`；失败不覆盖或重试。恢复 package 本身是另一次单独批准的上传，可能含历史业务及账号元数据。
3. 固定数据库 Secret 每模式最多读取一次；仅 RunOnce 可再读取原固定私密控制材料。旧内核的 RPC、DDB 单次槽、证据 PUT 和云资源预算不放宽。提供者/工作流日志、内存、网络和非零费用风险仍然存在，不能保证凭据内存彻底清除。
4. 非原子及非跨服务 CAS、IAM 传播、调用超时、完成回执或 PUT 确认丢失都可能留下资源或不可复用槽。失败只保留原始记录并独立核验，不自动删除、撤权、重跑或延期。TTL 及 Janitor 不关闭；期限到不代表即时停止收费。
5. 不能通过旧过期 Inspect 补记旧部署验收，不能把旧未验收任务加入 accepted lineage。只有新周期的真正独立 Inspect 成功后才能称为云端验收通过。请求登记和本候选测试均不是部署验收。

## 检查和最短后续

```powershell
node --experimental-strip-types ops/platform-recovery-cloud-v1/run.mjs --check
```

该检查只计算源码闭包，不获取身份或连接服务。No-AWS CI 验证默认关闭、三模式路由、真实 V5 Review、错误 package/envelope/descriptor、失败不重放、日期格式兼容和旧发布闭包不变。公共纯断言继续覆盖原登记事务的临时 PostgreSQL 场景。

后续仍须准备：准确新闭包及源码 CI、两份工作流发布和 reusable pin、controller release/risk/activation、最小 followup 生产组合、当前权限布局的限定只读核对。需要新增 IAM 或实际云部署时按具体资源及 fresh SHA 另行确认。不得用本候选检查结果直接开启 PUBLISHED、上传 package 或调度。
