# F3c9g：现有锁定函数代码及异步配置更新清单

2026-10-12 Winnipeg。执行器、Review/一次Run/独立Inspect已实现，实际只读双回读和另一个进程的独立前态Inspect通过。**尚未执行任何AWS写入或Lambda调用；未安装权限、登记parent、连接Neon或创建Cell。** 代码提交/推送按既有授权直接进行，以下云变更必须用户确认新SHA。

## Fresh清单及实际前态

- 清单 SHA：`0cea566b526ad14d39e426c9479aec947b4afabc694407495d25c9d0b28d6538`。
- 审查时间：2026-10-13 **03:12:38.945 UTC** / Winnipeg10月12日 **22:12:38.945**。
- 有效至：2026-10-13 **04:12:38.945 UTC** / Winnipeg10月12日 **23:12:38.945**；过期仅只读刷新另批，不执行旧清单。
- 95个绑定文件 SHA `3d6b3e7770d6074be0f3594fdd73b485a959ee2540732dbd29169c0bb27f32be`。原70与最终包48个pins逐一保持，package-lock/最终ZIP/旧永久槽均校验，不重建镜像或运行隔离数据库模拟。
- 清单文件 SHA `f021606bde939fda8f5659bb1393fe7082667ec6ba4325e383ca88f0def0e9e3`；Review报告 `31e6afa0698f6e64305cbae93375e79edfa55882fad6ab54a20ffe3b6b04172d`。
- 03:15:36.026 UTC独立进程再次双回读，完整snapshot SHA与Review相同：`75e142ecc3921ebf2ab8b9ca4fc192f3197073c5d2302f9b3f34898d2668ffc8`；完整不变量 `7da9d1e9b5e35a908e6433496918192722fd4acf4c4a5e6cf3d4f47897731d6e`。独立报告 `968068c5d0d9f51ad210e7cd8d15efaa7f9b86de3e7c1274b4cede185f031f1e`。

Source身份准确为账号402010193138的`techlong-sandbox-dev` IAM user，当前登录可用，不需要现在刷新。两项action×准确未限定/`$LATEST`两资源的四项模拟均allowed、无缺失context；这是模拟，不是实际允许路径或服务执行证明。

15项锁定门禁均通过：原RoleId `AROAV3GNMXTZBYYFRN63O`/Lambda-only trust/准确boundary；仅v1显式Deny全部动作和资源；无inline/attached policy；bootstrap标签保持；reserved concurrency0；准确日志组七天；原表ID58c851f4... ACTIVE/准确主键，资源policy未读到；parent、所有workflow/failed/旧登记/新登记attempt键缺失；Cell名称缺失；无function resource policy/URL/alias/已发布版本/event-source mapping；无async配置，默认EventBridge bus中无准确target。**不推广为所有自定义bus/所有调用者都不可调用的证明，也不把双回读当作跨服务CAS或有效data-plane deny证明。**

函数准确ARN：`arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3`，读取准确`$LATEST`可返回同一ARN的`:$LATEST`形式。当前仍是原ZIP `QF5mVLnIygyAU29fz4yqkQ4AJGzkl8Le3IHJ9j87418=`、Revision `7817b5a5-c53c-4df5-a2a7-e1385fc1d89c`、Active/Successful、Node22/256MB/120s/x86_64，handler仍v4，无应用环境变量/layer/VPC。RuntimeManagement为Auto，运行时版本ARN当前`fcbc5912...`。

## 拟执行范围：最多两次写入

| 顺序 | 准确操作 | 保持/禁止 |
| --- | --- | --- |
| 1 | 对上述现有函数一次`UpdateFunctionCode`：准确原Revision条件、本地r3 ZIP、`Publish=false`、`DryRun=false`、x86_64 | 不创建函数/版本/alias，不改Role/handler/应用配置/标签/concurrency；代码SHA必须为候选 |
| 2 | 同一函数`$LATEST`一次`PutFunctionEventInvokeConfig`：age60、函数错误retry0、空destination | 不创建destination/触发器，不启用运行；代码readiness和原async前态复核通过后才提交 |

候选ZIP SHA `b53ba821ce2619b90c4d941e5bc4969b131d4e9e777f3498a75320deca136e47`，AWS CodeSha256 `tTuoIc4mGbkMTZQeW8SWmxMdTp53fzSYp1Mg3soTbkc=`，432218 bytes；bundle `71f31e586f2eeb737c158b917cf799595f76803f8fe725476e0b6ed47a86f25c`。仅使用F3c9f已验证r3包，不再重建或用r1/r2替代；原包/记录保留。新代码支持固定gate和inline清理，但保持原deny-all boundary/空策略/concurrency0，**本次安装不是Invoke或运行时授权**。不改IAM、表policy/Item、Secret、Neon、预算、DNS、ECR、ECS、CFN或其它资源；不ARMED/PAID。

代码API的Revision条件仅覆盖该次代码提交；[AWS UpdateFunctionCode](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionCode.html)。async API没有Revision条件、`Put`可能替换原设置，不是全流程CAS；[AWS PutFunctionEventInvokeConfig](https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionEventInvokeConfig.html)。本次已绑定的async前态为缺失；发现外部新增/改变就停止，不把新配置覆盖掉。

## 完整风险和停止规则

- 两写非原子。第一次成功、响应丢失/readiness不确定/凭据失效/到期，或第二次失败，可能只留下新代码或部分配置；**不自动回滚旧代码、撤销配置、补齐、删除、换槽或重试任何写调用**。原代码副本留存不代表获准恢复。
- 新固定永久槽 `F:/ChatGPT_workshop/techlong-f3c9g-locked-function-update.permanent-slot.json` 当前不存在。有效批准、Source/文件/实际前态核验后wx+flush消费；即使后续因读回/凭据失败、尚未真正送出写请求，该槽也不自动复位。记录的`writesAttempted`是提交入口尝试计数，不保证服务实际完成。旧bootstrap/数据库槽永不复位。
- 每次写前再检查完整不变量、当前Source身份、95文件/ZIP/旧槽与窗口；第二写还检查新代码和原async前态。SDK/CLI `maxAttempts=1`，进程内每个write index只能使用一次；超时/异常停止为inspect-only。readiness只做有界只读查询；不通过“改目录/新进程”重放写。
- 成功响应Revision可能与稳定完成回读不同；不把响应Revision当作完成Revision。候选ZIP、完整应用配置和锁定不变量必须保持，两次稳定读后记录真实完成Revision。新进程独立Inspect仍必需，提交后不重复任何写以修复验收。
- Lambda Auto模式可能随代码更新改变AWS托管Node22 patch/runtime-version ARN；允许此provider输出变化并记录，**不允许Runtime/nodejs22.x、architecture、RuntimeManagement模式或其它应用配置改变**。源码中所有未知应用配置字段也纳入不变量。运行时Error只能不存在或明确null，实际错误对象一律拒绝。
- IAM/表policy及函数metadata读取可能有传播/并发；双回读不是有效权限证明、跨服务CAS或排除外部写者。并发0不撤销已运行调用；异步retry0/age60不证明exactly-once、精确销毁时刻或第三方scheduler不重试。[已有异步语义说明](./aws-auto-deployment-fast-track-f3c9f-runtime-package.md)。
- AWS Login自动刷新可能失败；每次native请求使用当前内存凭据并要求至少60秒期限，不要求单份凭据剩余一小时。失败可遗留已更新代码/配置，留待只读Inspect和另受审处置；不把刷新身份当作新写授权。
- 云提供者/第三方日志可能记录标识符。脚本不保存原始stderr、临时凭据、Secret值或URL；元数据仅保存私有报告。请求失败前后均可能产生低额费用/收费已有资源；**50 USD/月是目标而非硬上限，不能保证绝对零费用或本轮两写控制总账单**。

## 入口、测试及继续条件

Review/Run/Inspect统一入口：`ops/aws-sandbox/scripts/review-cell-parent-locked-update-v5.mjs`；独立AWS适配器`cell-parent-locked-update-aws-v5.mjs`；实际两写顺序与13个定向测试共享TS核心。13新＋12相邻共25测试、typecheck、定向lint零警告/CLI语法通过；没有Docker/镜像重建/旧generation或隔离数据库探针。测试是假传输，不是AWS写入或实际gate证明。

私有评审：`F:/ChatGPT_workshop/techlong-f3c9g-locked-update-20261012-r5/locked-update-manifest.json`。独立前态Inspect目录为同前缀`-independent-before-inspect`，其outcome中的before/未安装是预期结果，不是代码安装失败。r1–r4停止记录原样保留、均0写/槽未消费：r1模拟聚合格式、r2准确表policy缺失异常类型、r3list page上限、r4raw runtime Error:null格式；实际允许的四个模拟结果/准确表存在/原代码均不被改写为权限失败或安装成功。[IAM模拟响应](https://docs.aws.amazon.com/IAM/latest/APIReference/API_SimulatePrincipalPolicy.html)、[DynamoDB缺失policy/最终一致性](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetResourcePolicy.html)、[Lambda async列表最大50](https://docs.aws.amazon.com/lambda/latest/api/API_ListFunctionEventInvokeConfigs.html)。

仅用户确认上述新SHA及完整风险后，才在有效窗口内一次Run；成功或失败后另开独立新进程Inspect。到期或Source失效只读刷新，不自动复用旧批准；槽消费后只读Inspect，不请求泛化重试。完成安装后，才另批RESERVED身份、准确IAM/table窗口、Source登记、短暂concurrency固定gate及ARMED/付费Cell；不得登记后静默换包。
