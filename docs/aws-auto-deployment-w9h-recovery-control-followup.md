# W9h：恢复控制面绑定与有限独立 Inspect 跟进

状态：仅实现、测试和发布准备。W9f 已登记的 held 请求不重建、不领取；已消费的两个槽不复位。原 81 项云发布闭包和 W9g 的 97 项候选运行时闭包均保持不变。HTTP 源码增加候选选择器及协议风险链接，但默认行为不变，未切换已上线入口；没有发布工作流或修改安装 binding、IAM、租约，没有读取私钥、Secret、私密配置或生产数据库，没有 AWS 调用、上传、dispatch 或部署。

## 最小组合

`ops/platform-recovery-control-v1/` 提供：

- `binding.mjs`：默认 CANDIDATE 的源码绑定。发布描述固定经 CI 的 controller 代码、冻结 runtime 源码、release SHA、recovery activation、版本固定的 package、基准 SHA 和本风险文件。为避免提交自引用，发布描述的执行 sourceCommit 保持空；只有有效受审租约或 clean main 可绑定本轮执行源码，再写入不可变计划/跟进清单。新协议只接受 W9g 的准确 runtime 闭包，旧 PUBLISHED release 不能冒充。环境变量或 manifest 不可切换协议，后续主分支漂移仍禁止调度。
- `controller.mjs`：复用既有 V6 控制器、专用控制账本、App 客户端、30 分钟以内的验证租约和“先持久批准/永久 intent、后读取私钥”的顺序。仅允许固定新任务、源码、risk 和 package。status 不把旧计划混进本轮；HTTP 选择器只由受审源码的 PUBLISHED 绑定启用，候选默认仍走原入口。批准页风险链接随协议绑定，不改变布局或操作流程。
- `content.mjs`：按新协议完整验证版本固定的 package、envelope、result、descriptor 和报告；可在内存捕获 owner SQL 形状来推导 Inspect，但没有 SQL 连接或写入能力。内容验证不等于持久账本核验，不自动导入证明或更改平台 accepted 状态。
- `followup.mjs`：等待已调度的准确 RunOnce，仅成功时准备一次 Inspect；预留至少 10 分钟，保留原 workload/basis 到期时间。展示 GitHub environment 待批通知，由用户亲自批准。失败、期限不足或 ACK 不明都停止，不调度第二次。
- `live.mjs` / `cli.mjs`：显式受审入口，复用原 Source 身份、GitHub 只读凭据、App 单次签名/最小 token、精确 S3 allowlist、固定 endpoint 和永久槽。旧 V6 transport 默认行为不变；新协议能力只由代码适配器注入，不由输入选择。当前编译绑定未发布，所有 live 模式在材料/私钥读取前拒绝。

```powershell
node --experimental-strip-types ops/platform-recovery-control-v1/cli.mjs --check
```

该命令只显示关闭状态，不获取凭据或访问网络。未来 prepare-followup 也不是执行：它只在已发布的准确绑定下核对本地公开 package、源码和私钥文件元数据，再生成独立待审 SHA。follow-runonce 还要求准确 SHA、未过期窗口和人已在线；不允许 endpoint、profile 或任意 SQL 覆盖。

## 未来执行范围与完整风险（本阶段未批准）

1. 一次跟进最多读取一把现有 App 私钥到内存、加载一次既有 GitHub 只读凭据、签发一个仅该仓库 actions-write/contents-read token，并尝试撤销一次。Source 自动刷新身份最多六次及对应六次 STS 核对；只读 S3 最多 16 次固定版本 GET、两次准确结果 HEAD，GitHub run GET 总计最多 80 次。正常轮询是等待同一 run，不是重跑工作流。
2. 本地不读 Secret 值、不连接 Neon、不写平台账本、不 RunOnce、不领取任务或创建承载。唯一新调度是一次 Inspect；云端 Inspect 会读取一次既有固定数据库 Secret，经窄 RPC 只读核对业务/资源，最多两次条件证据 PUT。现有 DDB/CFN/服务读取由原 Inspect 执行，不能将“本地只读”说成整个过程没有提供者副作用或费用。
3. 复用 `intent-<job>-<RunOnce run>.json` 的永久槽，与旧普通 Inspect 入口共享，刷新审批 SHA 不得重新打开同一次执行。slot 已占、部分写入、网络错误、提交或 dispatch ACK 不明时，保留原材料；不删除、不补齐、不重置、不重跑。已知 ACK 必须先保存，撤销 token 失败也不能再调度。
4. 精确 metadata、源码、TLS 和版本校验不是跨服务 CAS。并发修改、IAM 传播、凭据过期、令牌撤销失败、内存/提供者日志和网络风险仍然存在；不能保证内存彻底清除。token 的 actions-write 是实际写权限，不只 Inspect；代码和仓库范围约束仍需独立审查。
5. 跟进过程最长 35 分钟，原领取、workload TTL、recovery facts 期限均不延长。人未及时批准 environment、GitHub 排队或慢读可导致窗口不足；到期不会取消已经发出的请求或立即停止资源计费。50 USD/月是预算目标，不是硬上限，低成本不等于零费用。
6. 平台批准仍可能写批准/intent/ACK/观察记录；必须由另一次具体清单与准确新风险 SHA 绑定。本候选工厂不自动切换现有 runtime，不改管理员或业务状态。跟进的成功结果是“云端独立内容验收已验证、尚未导入账本”，不能直接显示为平台部署验收通过。

## 发布前仍须绑定的真实材料

新 runtime 源码与 CI 已在 W9g 核验，但新的 reusable commit、caller commit、必要 trust pin、当前角色/权限元数据、固定 package VersionId 和 controller activation 尚不存在或未经本轮回读。当前源码 binding 保持 CANDIDATE，不能用草案 SHA 替代执行批准。

下一步应一次限定只读核对这些现有授权布局，随后提供准确的工作流/必要 trust/package 上传/控制面发布清单，再按具体资源与 fresh SHA 批准；不再次创建 held 请求、不重放旧过期 Inspect、不扩展 F3c9。
