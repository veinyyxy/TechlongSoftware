# F3b3：密封 v3 业务 drain / TTL 候选接线

2026-10-11 Winnipeg。本阶段完成生产 adapter 接线、固定版本凭据加载、两个可重复 Lambda ZIP 和最小权限候选的只读对照。**仅本地代码与 AWS 只读核验；未安装 IAM/函数、未调用 Lambda、未连接 Neon 或修改业务状态。** 50 USD/月目标保持，实际变更和付费 Cell 仍需 fresh SHA 单独批准。

## 已完成

新 `createPreparedSealedCellDrainCoordinatorV3` 不再组合旧 schema2 source。它只读准确 provision authority，绑定完整 item SHA、原 drain intent SHA 和密封证书 SHA，要求真实 Cell 已到期，才复用原 admission writer。没有新增 SQL、角色或授权。

在既有 cleanup job producer 前后，分别取得新的 WeakSet 认证 v3 Serializable ownership snapshot，检查完整密封证书/catalog/原件、原始 witness、admission lineage 和时效。JSON 副本、schema2、未来关联或受保护旧实例的 live resource 不能绕过。历史原始 1 活跃租户 / 1 非终态部署保留，只由已批准密封规则分类，不 blanket 减一。原 job producer 的 owned-resource join、dedupe、禁止重置逻辑不变；不会仅因旧计划存在创建 cleanup job。

协调器没有 authority issuer、CAS、删除 journal 或 DeleteStack 能力。返回 zero 也只是后续 authority 审阅材料，不是删除批准。admission 与 job 是独立事务；中途失败可能留下 draining 或已提交 job，不能承诺原子性，不自动回滚、补齐或应用重试。

固定 material loader 不依赖 Secret 环境变量：TTL 只读现有 reader；drain 分别读现有 reader/writer。请求明确固定 ARN、初始 UUID、AWSCURRENT；要求准确受限用户名、相同 Neon endpoint/database、TLS、完整证书 pin。Lambda 身份与函数上下文准确，SDK 使用当前函数凭据、准确 region、忽略 endpoint override、maxAttempts=1；密码 URL 只在内存，异常不输出秘密。

新 `cell-drain-coordinator-v3.ts` 组合新 root 与已有 Neon writer/job/source；新 `cell-ttl-executor-v3-fixed.ts` 组合已有 v3 durable CAS / 一次准确删除 / 恢复 core，并明确固定 Secret VersionId。两者**未上传或安装**，打包不赋予执行授权。旧 handler、所有旧批准文件/binding/失败证据/永久槽位和 SQL 均保留。

## 验证与候选

12 项新增 + 34 项相邻 drain/v3 evidence/TTL 回归，**46/46** 通过；typecheck、全部新文件定向 lint 通过。SQL/AWS 使用受控 fixture，不冒充在线业务写入验证。复用上一阶段真实 Neon 只读预检，不重复探针、重建 ECS 镜像或运行 GitHub Actions。

两个自包含 Node22 x86_64 ZIP 各双构建字节一致、解包回读一致、无凭据启动拒绝无效事件；drain bundle 未链接 CloudFormation SDK / TTL actuator。

- 私有 build：`F:/ChatGPT_workshop/techlong-f3b3-sealed-runtime-v3-20261011-p1`
- artifact report file SHA：`867781c7e42cff26c749fa0719d3ad360b83f72f0125a74cbffde1620fcb8315`
- drain ZIP：`20554427b6eaf7cba6f8cf7bd3a78e4aefd8947f2499addd1dd9ecf5d16985c0`，328034 bytes。
- TTL ZIP：`621a8cd5f45cceedc6e1904e55afed445ca23900cef1b81e268e902e026a1bb5`，362628 bytes。

build report 绑定 normalized source pins 和 package-lock；ZIP、密码与原始数据库结果不提交 Git。

## 最小权限候选与真实只读对照

仅为现有 drain role 准备额外 reader Secret 读取与同一 AWS-managed Key 的转发解密。每个 Secret ARN 与初始 UUID 分别关联，防止两个独立允许列表交叉配对。非 Secret/KMS 规则、DDB 只读、来源函数/region、AWSCURRENT、日志及其他动作拒绝保持。

后续另审 `TechlongSandboxCellDrainCoordinatorBoundaryV1` 默认新版本（保留 v1/v2）及 `TechlongSandboxCellDrainCoordinatorRole` 的 `RuntimeReadOnlyV1` inline；本次没有创建版本、PutRolePolicy 或自动撤权。候选 compact 文档 5592 chars，通过 6144 检查。

2026-10-11T17:18:20.696Z，AWS 只读确认准确 Source、RoleId `AROAV3GNMXTZPRETOTXTS`、boundary 默认 v2 / inline 都仍为原 KMS repair 文档。13 项 SimulateCustomPolicy：2 个准确 KMS 允许、9 个反例明确拒绝均符合；2 个准确直接 Secret 允许案例仍 explicitDeny，匹配原来源函数拒绝语句、missing context 为空。**allCasesVerified=false，不宣称新跨 Secret 路径全通过，不去掉围栏。** 原实机自身 Secret 读取成功不等于新 drain reader 路径已证明。

- 私有 review：`F:/ChatGPT_workshop/techlong-f3b3-sealed-drain-policy-20261011-r2`
- review file SHA：`18f3174d7fc43cc276403681ebb744ab1d86dee407b67b1f713e53a4792be989`
- candidate policy canonical SHA：`6c3639bbcca4a422867c25e702fcc9e89fedc2fef33829bb996b2cd45e0a3ab1`
- 初次 r1 脚本错误使用不存在的 target.index，UUID/名称输入错误，失败报告 `74d477c64b033506fea64cbdc7db853c77619721e71cc740a74e7fe668c33322` 保留、不作为正向证明；r2 修正为 entries 索引。

参考 AWS [来源函数 ARN 上下文](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html) 与 [模拟输入/结果](https://docs.aws.amazon.com/IAM/latest/APIReference/API_SimulateCustomPolicy.html)。未唯一确定两正向模拟拒绝原因；模拟不能替代批准范围内的实机门禁。

## 部署门禁与下一小阶段

最近独立核验的云端 TTL 仍是 Neon 只读预检探针，drain 仍是 p2 只读探针；环境 open、业务 runtime 未启用，真实 Cell/provision/cleanup authority 尚未安装。本阶段没有刷新或改写这些状态，历史读取不替代未来变更时的 fresh inventory。

先保持 open 完成真实 Cell/provision 与单租户部署；到期后才按准确 intent 改 admission，取得新的密封 ownership/raw witness；zero 与真实栈证据满足后再审 authority/一次 TTL 删除。没有 Cell 不能生成假 provision、提前 draining，或把只读预检 JSON 当 certified snapshot。

现有 TTL boundary 仍拒绝 DDB journal 写与 DeleteStack/PassRole。候选含 actuator core，但未获权限；真实 StackId 尚不存在，不能编造精确删除授权或扩大为全栈 wildcard。baseline、TaskDefinition/activation、租户专属权限、DNS/ACM/mTLS、预算与费用等原 F3 门禁未清零。

下一阶段准备独立业务安装 Review / 一次 Run / Inspect：绑定两个候选、当前准确 Lambda Revision/配置、IAM 文档/RoleId/Secret 元数据与旧证据，列明最小 drain reader 权限和准确代码更新范围。**当前没有 executable manifest / fresh 云批准 SHA。** 不重放任何 Invoke/已消费 slot；审批过期或只读失败只读处理，不自动补齐。

安装业务 drain handler 会向函数暴露现有受限 Neon 写能力，不能称只读安装。批准须说明外部并发调用、IAM 非原子/非 CAS、异步 Lambda 更新与 Revision 漂移、部分代码/权限遗留、数据库写能力暴露与非零费用。代码安装不授权业务 Invoke、authority 写、删除或付费 Cell；TTL 精确权限与真实 Cell/单租户验收后续另按具体资源 fresh SHA，50 USD 目标不替代授权。
