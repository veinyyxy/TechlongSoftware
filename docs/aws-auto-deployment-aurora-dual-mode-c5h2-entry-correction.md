# C5h2：首轮入口拒绝、窄修复及新的待审清单

> 后续状态：本页r3清单已获批准并执行一次。新基础设施通过、provision返回HTTP500；根/17槽已消费，禁止重跑。本页保留当时待审材料；当前状态和唯一继续点见[真实部分交付记录](aws-auto-deployment-aurora-dual-mode-c5h2-partial-executed.md)。

2026-10-15 America/Winnipeg。用户确认 `6d58a5e2c1e6673c00c566d9355ae98314449d055a38774d831ee48aa8541a88` 后，唯一一次 Run 于约20:06:35 UTC开始，尚在原15分钟窗口内；没有再次 Run。

## 实际结果，不是已部署

Run 在 Source identity 只读核对之后、数据库 observer 的本地入口校验处以 `LIVE_DATABASE_OBSERVER_ENTRY_REJECTED` 停止。随后在未修改绑定源码前另起 Inspect；Neon 独立查询返回空数组，严格 ready validator 因而返回 `LIVE_READY_PLATFORM_NOT_PROVED`，没有冒称成功。

原冻结八条只读查询中，第四条是 `WITH user_ns AS (...) ... SELECT ... AS identity` 的目录查询。原入口要求全部以 SELECT 开头，错误拒绝该合法查询。正则转义本身正常；现场首个关于转义的推测已更正。拒绝发生在 observer 解析凭据、STS、连接或消费数据库槽之前。

实际：**Aurora连接0、AWS/Neon写0、私密包/Secret值读取0、永久槽消费0、job/部署0**。Run只有1次STS；Inspect只有1次STS+1次Neon readonly查询。原固定journal目录仍不存在，未删除/复位/换名绕过旧槽。旧Run/Inspect目录及旧批准材料保留。

## 只修这一处

observer 不泛化接受任意 WITH，也不靠关键字当SQL沙箱；在首次await前核对八条完整 query对象的canonical SHA：

`2c3033c1c2b92b3c2ba6717b00d6226004e26856ee7d6663a8f760c3c43dd114`

原SQL来源整个文件的raw SHA仍由loader固定为 `44815f7494479e583d8fb829532a11bd494e6e455e7eca94ed849d7ef189869d`，不更改SQL、目标、连接或权限。同步guard保留同phase并发入场的拒绝能力。

新增回归直接调用实际observer.observe，以预先abort的signal在guard之后、凭据/网络/槽之前停止：原WITH查询可入场，修改为普通SELECT、data-changing CTE或追加DELETE均拒绝，重复/并发phase、缺失查询及错误phase也拒绝。测试读取原非秘密本地SQL文件，不把SQL复制进Git；缺少该历史文件的其他环境会明确skip该项，本机本次不skip。71项相关测试通过，types/lint/Check通过；不把这些本地结果当成Aurora登录或真实部署成功证明。

## 修复后的独立只读核验

新Review r3实际完成31次显式SDK只读、13条CLI、1次Neon readonly snapshot、1次公开NS查询。原IAM/compute/ECR/Secret固定版本、DNS和命名空间检查通过：本租户deployment/job/resource/operation仍无记录，两DDB键仍缺失，workload相关名字和DNS无冲突。没有连接Aurora、读取秘密、安装权限或消费槽。

本轮总计33次显式SDK只读、13条CLI、2次Neon readonly、1次公开NS查询；不含登录刷新/CLI分页底层请求。原付费资源保持运行，标签不停止收费。

## 当前唯一待审材料

- 新manifest SHA：`1db32e27374d79128ae5f56b0c1c606678088e94dd7e329efe1ea4106eac16a2`。
- 文件：`F:/ChatGPT_workshop/techlong-express-c5h-review-20261015-r3/manifest.json`。
- 入场截止：**2026-10-15 20:25:27.139 UTC / 15:25:27.139 CDT**。
- 新独立child标签候选：**22:10:27 UTC / 17:10:27 CDT**；旧父11:44:56.246 CDT保持，不自动续期或清理。
- 新code binding：`9e47df3d6a4b0a88318ac808e322091d8d8aad78dcf622ab65e0656dc24a7a92`，70源码/依赖+34历史文件。history SHA保持 `609e6de1ea25f1ae68f4d8922f4c984f020dc3f33b0e7a8916611b65392fb0a3`。
- [原完整范围/风险文档](aws-auto-deployment-aurora-dual-mode-c5h2-live-entry.md)保持原hash `2e62ca494983d6a0773a718a49acfc31e53bd248a508f045be7f0f3a1a66b297`，没有回填或静默改风险。

拟范围仍为最多3 Source云写、10 Neon事务、2 Aurora只读连接、1原私密包重载、1 operator固定runtime Secret值读取、1 provision POST；准确七资源workload/DNS/初始epoch，无新IAM、无升级plan、restore/seed/ECR/清理。固定根槽仍是同一个未消费根，不因SHA变化创建新槽。

两小时标准参考基础约0.425 USD另加变量费用，非费用上限；50USD/月是目标，常驻Fargate+网络参考约52.85USD/月尚不含DB。新窗口、代码闭包及精确新SHA仍须人类确认，**原确认不授权修复后自动再Run**。失败/未知响应后的不自动补齐/重试/复位边界保持。

新批准后唯一下一步是按新SHA执行一次原范围Run，然后独立Inspect；过期只重新只读生成清单，不重放旧批准。不扩展F3c9、Grant、恢复或模拟支线。

[版本化非秘密证据摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5h2-entry-correction.prepared.json)保留旧失败及新待审材料hash；SQL、私密材料及完整本地云快照不入Git。
