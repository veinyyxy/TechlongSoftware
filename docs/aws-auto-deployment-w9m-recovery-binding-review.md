# W9m — 恢复控制器源码绑定发布（不是运行时启用）

## 范围与已知材料

复用既有 V6 单文件绑定发布器，通过代码限定 profile 适配恢复协议；旧入口默认行为不变。本轮普通代码/测试提交不改变实际 binding。PrepareSaved 只复用已封口 W9k/W9l 元数据、已验收包引用及准确 No-AWS CI，生成一个本地未发布 Git 对象，不建立分支或移动 main。无需再次下载包，也不读取 `.env`、Secret、私钥或数据库。

唯一拟改文件为 `ops/platform-recovery-control-v1/binding.mjs`，只将描述字面量从 CANDIDATE 改为 PUBLISHED；函数、门禁和原 V6 binding 均不改。固定：

- workflow ID `390829326`、App actor ID `344813947`、reusable `4c09548ab9852a4f3e948f0686f8c81251cda73b`。
- 云端源码 `0494b2be7b0f559ac991533137dfb1b0388ac7a9`，97文件 closure `30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374`。
- 已核验历史包 VersionId `Zz5fH5Javs900ZrmMrgi3QhBzFbCNkPm`，包 SHA `07d9d9475033b35cc6a38597946c40a8389ccd4409c177122878590e94975ce7`，准确键及基础摘要固定在清单。
- 已有安装摘要 `0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1`，运行风险仍为 `aws-auto-deployment-w9h-recovery-control-followup.md` 的固定 SHA `09eab6e5c56119faed3c3f7eb3f952ad99a7a9d6b08f535b6e5e9280f4dc115b`。这不批准该文档所列未来 dispatch/业务执行。

避免提交自引用：`controllerCodeCommit` 指向已过 CI 的准备代码 parent；描述与 activation 的执行 `sourceCommit` 保持 null，不写未来自身 commit。仅有效的、单独受审的运行时租约可以将本轮执行源码绑定到不可变计划。

## 将来单独批准的操作

最多一次 non-force push 发布准确的一文件 Git commit、一次本地 main 快进，并另起进程一次只读 Inspect。固定新发布槽 `F:/ChatGPT_workshop/techlong-w9m-recovery-binding.intent.json` 与独立 Inspect 槽，所有旧槽保留。源码发布是持久能力门禁，不属于此前普通提交的默认授权，因此必须另行确认准确清单 SHA。

执行时须重新读取既有 Source、foundation/角色策略/边界/资源、GitHub main/工作流/审批/OIDC/已结束运行列表，要求与 W9k 已验收布局一致（只允许 main 合法前进），且当前 binding 为准确 CANDIDATE。当前状态**本准备阶段未新观察**，不能用旧证据冒充实时核验。完整新前置快照须在180秒内完成，保存其 SHA 后才消费永久槽。

发布后和独立 Inspect 再核对准确文件/blob/commit、完整剩余授权布局及工作流；不符合则不宣称成功。每次调用的上限为 AWS元数据40次、GitHub GET合计100次；固定 Source 身份和官方 endpoint，SDK无自动重试。仅元数据，不读取 S3 对象内容、Secret 值或当前数据库。DescribeStacks 可能在响应中携带参数，要求为空，否则停止且不向聊天输出其值。

## 与运行时激活的区别

发布 PUBLISHED 描述会切换**使用该新源码的进程**到恢复协议选择器，可能被其他环境消费；这是真实的持久能力变化。未提供匹配的新 release/source 短租约及私密运行绑定时，控制器仍不得访问账本/私钥或调度。旧租约不会被更新为新 release；异步验证不匹配时拒绝私密操作。prepare/check 命令不配置租约，不启动服务器或部署新镜像。

真正开启 AWS 平台运行入口还须单独审核：准确源码镜像/服务变更、固定 Secret 版本的私密供给、最长30分钟且不超过原基础事实截止的运行时租约，以及后续计划登记/人类逐次批准。此清单没有授权其中任何操作。不能把“源码绑定发布成功”写成“自动部署已上线”。

## 完整风险及停止规则

- GitHub、AWS读验和本地主分支非原子；读取不是跨服务 CAS，并发变化或 API 传播仍可能造成部分发布/本地未快进。存在已发布持久门禁但验收失败的可能，不自动回滚、删除、重推、补齐或复位槽。
- Source 登录可能失效、API超时或 Git push ACK不明；占槽后永久保留现场，不因新 SHA 重放。最多一次推送，无 force/amend；独立读验不修复状态。
- 元数据可能含 Account ID、ARN、策略、参数或审查状态；凭据仅在内存使用，但提供者/网络/本地审计日志存在暴露风险。低成本并非绝对零费用，50 USD/月仍不是硬上限。
- 本阶段不创建/更新 AWS 资源或 IAM，不上传/删除包，不读私钥/Secret/配置值，不连接数据库、不写租约、不启动进程、不改 hosting，不签 App token、不 dispatch 或创建 Cell/ECS。旧 W9k/W9l 已完成操作不再执行。
- 基础证据截止仍为 `2026-10-27T18:47:57.695Z`（温尼伯10月27日13:47:57）。审批最长24小时并受该截止约束，至少提前5分钟开始；不因本发布延长基础、领取或 workload TTL。元数据匹配不是当前业务状态或服务健康证明。

代码与测试同时覆盖默认 CANDIDATE 关闭，以及未来已发布但无租约时关闭；后者不是放宽门禁。此风险文档与旧 W9h 运行风险分别固定，不替换历史批准记录。
