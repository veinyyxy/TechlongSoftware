# F3b3：只读 Lambda 安装与两次探针清单，已核验但未执行

2026-10-08 Winnipeg。Source 刷新后，新鲜 STS 确认准确账户402010193138/IAM user `techlong-sandbox-dev`；两既有执行角色的 RoleId、信任、boundary/inline完整文档、标签及策略集合准确匹配。两个目标函数和准确日志组均 ABSENT，14项 Source 创建/标签/保留/调用/PassRole 模拟均 allowed。**仅只读 Review；没有云写、Lambda调用或Secret值读取，新永久槽位未消费，业务runtime仍关闭。** 模拟不是实际创建、函数启动或运行时来源权限证明。

## Fresh 清单与准确范围

私有清单 `F:/ChatGPT_workshop/techlong-f3b3-readonly-lambda-20261008-r5/review-manifest.json`：

- manifest SHA：`e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e`。
- 文件 SHA：`25da1c096a1b380b205e378c818b6fb6e0f57f35d22b585d750c2e4f1409261c`。
- 10文件代码绑定：`064119b9576e1dd5beb73900ec1290f7bed28204905f989ea03be30bf83b7d7d`。
- IAM foundation SHA：`ab9bd91bbc70a5dbc684094d76df3672aa21b75aa1dac753c8ec21cba1fbabc9`。
- read-only-inventory文件 SHA：`bba36134e702c312fc6aef08eeca105bf506f7a541c066dbfb2401d90be6a8f6`，观察起点2026-10-09 04:19:40.409UTC（Winnipeg10月8日23:19:40.409）。
- 截止：**2026-10-09 05:19:58.561UTC / Winnipeg10月9日00:19:58.561CDT**；过期只能新只读Review，不执行旧清单。

两准确函数：`techlong-sandbox-cell-ttl-executor-v3`、`techlong-sandbox-cell-drain-coordinator`，日志组各为 `/aws/lambda/<准确函数名>`，区域ca-central-1。复用已批准保留的TTL/drain执行角色和boundary，不新增或改IAM。先各一次CreateLogGroup（审批标签）和PutRetentionPolicy（7天），再各一次CreateFunction；最多**6次安装写**。配置Node22/x86_64/index.handler/128MB/60秒/512MB，默认环境加密、无自定义KMS/环境变量/VPC/Layer/Extension/URL/事件源/调度/预置并发；实际配置、标签及代码SHA须完整回读后才可调用。

新清单绑定原p2两个只读ZIP（TTL ec0ef747...、drain b4f82193...），不是业务drain/delete处理器；源码、ZIP、载荷两个不同nonce及准确事件全部绑定本清单。最多各一次RequestResponse同步探针，无自动重试，随后独立只读回读函数/日志及完整响应SHA。各函数仅在内存Get自己的固定Secret ARN/初始UUID/AWSCURRENT并校验载荷；不连接Neon、不改Secret/数据库、authority或Cell，不启用默认Worker/业务runtime。完整配置、读取范围及费用说明沿用 [已准备候选](./aws-auto-deployment-fast-track-f3b3-readonly-lambda-probes.md)。

接受非原子、检查非服务端CAS/并发变更与额外外部调用无法排除、失败可能留下函数/日志并计费；新槽位永久占用后不自动删除、补齐、复位或写/调用重试。来源允许路径仍未实机证明；即使不存在Cell的读返回通过，也不证明真实生产CF资源读/密封v3 drain业务兼容或可授权mutation。50USD/月为目标，不是费用硬上限。

## 本轮限流定位与代码修正

r2只读失败，r3/r4通过脱敏API/HTTP诊断确认Source身份有效，`SimulatePrincipalPolicyCommand`返回IAM `Throttling`/HTTP400；不是用户需要重复刷新，也未证明缺少权限。r4诊断文件SHA `67000661884e2fc71f2033b856813f69a3c97bfecdf5b85bfb47641caa0ae9a0`。没有保存原始错误、凭据或CLI日志。

只为IAM读取/模拟增加共享队列，间隔至少600ms、每请求仍maxAttempts=1；不是写重试或放宽策略。写入口在耗时IAM核对后再次检查批准窗口、保留至少5秒，所有旧IAM/Neonbinding与p2候选不变。r5实际18.152秒完成新鲜集合，14项模拟通过；15项定向、typecheck/lint/语法门禁保持。旧r1–r4记录/候选/消费槽位保留。

## 待用户确认

> 我确认按清单 e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e 创建两准确只读探针Lambda及两日志组（7天保留），最多6次安装写，并各执行一次同步探针、随后独立只读核验；允许探针在内存读取自身固定Secret版本，不连接Neon、不改IAM/Secret/authority、不创建付费Cell或启用业务runtime；接受非原子及并发竞态、失败遗留资源与费用、永久槽位不自动删除/补齐/复位/写或调用重试，以及低成本但非绝对零费用。

确认且窗口有效后仅一次Run；新的输出目录不得复用。窗口已过期则先只读刷新，不据此批准重放。当前尚未获得这份Lambda/日志安装和调用批准。
