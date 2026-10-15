# C5h2 已接通：最终只读审阅通过，真实交付待批准

> 后续：该页r2清单已获批准并尝试一次，在任何SQL连接/私密读取/写入/槽消费前因本地WITH目录查询guard拒绝。原材料保留；修复代码不沿用旧批准，当前只使用[入口修正及r3新待审材料](aws-auto-deployment-aurora-dual-mode-c5h2-entry-correction.md)。下文为当时历史。

2026-10-15 America/Winnipeg。用户明确允许本阶段现有 AWS 授权/计算/ECR/DDB/DNS/Secret固定版本元数据与 Neon 控制面只读核对；没有批准 Aurora 连接、私密重读或任何写入。本轮据此完成现场接线，未运行 Run。

## 当前唯一待审清单

- manifest SHA：`6d58a5e2c1e6673c00c566d9355ae98314449d055a38774d831ee48aa8541a88`。
- 本地：`F:/ChatGPT_workshop/techlong-express-c5h-review-20261015-r2/manifest.json`。
- 入场有效至 **2026-10-15 20:11:45.718 UTC / 15:11:45.718 CDT**。过期只重新只读生成，不重放。
- 独立 child 截止标签候选 **21:56:45 UTC / 16:56:45 CDT**。父标签 `16:44:56.246 UTC / 11:44:56.246 CDT` 已过期且保持；使用独立窗口必须本次新批准，不自动续期/清理/停费。
- 完整闭包 **70源码/依赖文件+34项非秘密历史输入**；binding `27e33cb6b39f941cd5beeafae0719734647a045082ede57d9fbea7e107a0cb3e`。
- [已绑定的完整范围/风险/费用说明](aws-auto-deployment-aurora-dual-mode-c5h2-live-entry.md)，digest `2e62ca494983d6a0773a718a49acfc31e53bd248a508f045be7f0f3a1a66b297`。该风险文件不回填结果，避免改变批准材料。

这不是已执行证明。原C5h1三个local draft及首轮Review r1保留为历史，其旧SHA/闭包不得执行。

## 实际只读证据

最终 r2 完成 **31显式SDK调用+13 CLI命令+1 Neon readonly snapshot+1公开NS查询**：

- Source 准确 IAM user/Account/UserId 匹配；现 CFN RoleId/trust/attachments/空inline/default v8完整文档及消费者匹配；task/task-execution完整inline/trust/tags和共享boundary v4/两类消费者匹配，不模拟或增权。
- 原 compute UUID/16个CREATE_COMPLETE资源/完整模板hash/outputs保持；现有ALB/cluster/听众优先级可用，两published image digest/单架构manifest仍存在，公开sandbox NS匹配当前hosted zone。
- 精确tenant stack/service/TG/log group/active task family/DNS记录均无冲突；Neon目标app仍pending、订阅active且未过期、环境apply0/未admission、配置保持；该tenant的deployment/job/resource/operation及两DDB authority key均为0/absent。
- 准确两Secret均为固定版本/AWSCURRENT、无rotation/deletion/replica；不读值。数据库只DescribeDBClusters：原Express/public-gateway形态、17.9/IAM开启、原endpoint/resourceId及Min0/Max1/300秒保持，不连接或升级。
- AWS接受七资源模板且无IAM capability；不把权限文档匹配、旧模拟结果或模板验证当成实际ECS/日志/数据库登录/initialized-ready证明。

首轮 r1 为30 SDK+13 CLI+1 Neon+1 NS；随后代码增加严格plan重派生、template validation/RDS边界及最终provider回读，故只保留旧记录。两轮合计61 SDK/26 CLI/2 Neon/2 NS；这些是显式操作数，不含登录刷新/CLI分页等底层请求。另读AWS公开价表，不使用账户凭据查询账单。

本轮 **Aurora连接0、SQL业务写0、AWS/Neon写0、Secret值/原私密包读取0、槽消费0、job/TTL/部署0**。固定根槽未创建；没有重放C5c/C5d/C5e/C5g、seed/ECR/F3c9。原既有资源没有被停止，费用仍可能继续。

## 这次补齐的入口

非秘密来源与原始只读SQL固定hash校验；实际本地import/require闭包及两仓lock；精确readonly metadata adapter；两个Source IAM/TLS readonly snapshot observer；实际private loader→Express scoped runtime→一次fixed Secret的懒装配；独立Neon/CFN/DDB/ECS task/image/Secret refs/ALB健康/DNS回读；统一Check/Review/Run/Inspect CLI。

70项相关测试（8项新增）、typecheck、changed-code ESLint通过；本地Check真实构造完整lazy runtime并dispose，没有触发网络/SQL/私密方法。单测不证明尚未连接的SQL observer、真实Neon触发器提交或私密ECS路径一定成功；实际Run遇到差异立即停止、不补齐或重试。

## 批准时必须包含的资源和风险

复用 `cell-sandbox-1`；仅创建 `techlong-sandbox-tenant-9c5ee9e64509dcad` 的七项（log group、task definition、target group、三listener rule、一Fargate service），准确 `first-acceptance.sandbox.techlong.cloud` A alias，准确tenant初始epoch1及本次首次平台记录/状态。没有新增IAM/数据库实例/Cell，没有升级Aurora plan。

拟上限为3次Source云写、10次Neon事务、两次每次12语句的Aurora只读连接、一次原私密包重载、一次operator固定Secret值读取及一次provision POST；CFN会创建七项资源且可能自行ROLLBACK删除新资源，ECS也独立读取固定refs。全部固定永久槽、成功/失败后的独立核验、非原子/并发/部分收费遗留/响应丢失及不自动回滚/复位/重试等完整风险见上方已绑定文档。

按单任务/现网络/1ACU标准参考价持续两小时，基础约 **0.425 USD**，另加LCU/存储/I/O/logs/流量/Secret/DNS/税费；不是费用上限或账户实际Express报价。仅Fargate+现网络常驻730小时即约 **52.85 USD/月**，不含数据库等，**50 USD目标不能靠常驻此规格保证**。本次范围是短时验收；两小时标签不自动停止，清理仍另行明确审批。

批准后运行（不要使用旧SHA或过期清单）：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-live-delivery-v2.mjs `
  --mode Run `
  --manifest F:/ChatGPT_workshop/techlong-express-c5h-review-20261015-r2/manifest.json `
  --approved-sha 6d58a5e2c1e6673c00c566d9355ae98314449d055a38774d831ee48aa8541a88 `
  --output F:/ChatGPT_workshop/techlong-express-c5h-run-NEW
```

仅在用户准确确认后才由agent调用，不要求用户手动复制秘密。Source刷新不等于批准；若批准过期/closure变化/槽已消费则拒绝，不把下一步请求当新写许可。失败/不确定回执后只读检查，不能直接再次Run。

[版本化非秘密摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5h2-live-delivery.prepared.json)只保存hash/状态；完整权限文档、公开参数及SQL仅本地。
