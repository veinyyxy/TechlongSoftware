# F3b3：业务候选安装清单（未执行）

状态更新：用户确认后已实际完成四写/零调用，两次独立 Inspect 通过；槽位永久消费，**本页是历史审批清单，不得再次 Run**。见[实际安装结果与继续位置](./aws-auto-deployment-fast-track-f3b3-business-installed.md)。以下保留原清单。

2026-10-11 Winnipeg。独立 Review / 一次 Run / Inspect 入口已实现，12 新 + 14 相邻测试共 26/26、typecheck、定向 lint、两脚本语法检查通过。复用上一阶段两个候选 ZIP，不重建、不另派发镜像构建。旧 20 文件 binding `c120e4c6...`、所有旧失败证据/槽位和业务 SQL 保持。

## Fresh 清单

- SHA：`93bc4518c7003fcaa352355c66559b00b40d3b09d1d6ed4def4f9679177dad05`
- Review：2026-10-11 17:36:31.508 UTC / Winnipeg 12:36:31.508。
- 过期：2026-10-11 **18:36:31.508 UTC / Winnipeg 13:36:31.508**；过期只读刷新、新 SHA 另确认，不执行旧清单。
- 清单文件 SHA：`7f88c6b5cb05c930c64fa6f561139354ef3cddd735b2d26699922d65b538b109`。
- 新 45 文件 code binding：`adf38fb1307bbdfbe9ef2c28918fff6e3e17c9ef542bb124b88c6017851ce98f`。
- 稳定 anchor：`b08b5a4882ebe415df3d4f7f9fecea1d76142a0bc7ee996f205a59209e3b1a64`。
- 私有清单：`F:/ChatGPT_workshop/techlong-f3b3-business-install-20261011-r1/review-manifest.json`。

17:36:16.217 UTC 的真实只读集合在 15.291 秒内完成：准确 Source user、两个原 RoleId/trust/标签/唯一 boundary 使用、v1/v2 全文/inline、两原函数代码/完整配置/Revision、日志组 7 天/标签、固定 Secret 初始 UUID/AWSCURRENT/无 resource policy、AWS-managed Key/policy 均匹配。两项 authority 强读无 Item，准确 Cell Stack 明确不存在（不把 AccessDenied 当缺失）。四项准确 Source 写权限模拟均 allowed，仅预检，不是实际写权限证明。

inventory 文件 SHA `7085f355f3264376b89af4f309d7cd30ddd5410788afaaee304d57eb94260885`。TTL 原 Revision `80270648-9f62-488b-a99c-4d6a86558302`；drain 原 Revision `346ef792-10b6-4258-96b5-e1284f9a6db6`。当前安装写/调用/Secret 值读取/Neon 连接均 0，新永久槽位空。

## 准确变更范围

仅 Source 顺序进行最多四次写：

1. `arn:aws:iam::402010193138:policy/TechlongSandboxCellDrainCoordinatorBoundaryV1` 创建默认 v3，保留 v1/v2，不删除版本。
2. `arn:aws:iam::402010193138:role/TechlongSandboxCellDrainCoordinatorRole` 的 `RuntimeReadOnlyV1` inline 更新。
3. `arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-ttl-executor-v3` 一次代码更新，ZIP `621a8cd5f45cceedc6e1904e55afed445ca23900cef1b81e268e902e026a1bb5` / 362628 bytes。
4. `arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-drain-coordinator` 一次代码更新，ZIP `20554427b6eaf7cba6f8cf7bd3a78e4aefd8947f2499addd1dd9ecf5d16985c0` / 328034 bytes。

IAM 差异仅 drain 读取现有 reader Secret 及同一准确 KMS Key 经 Secrets Manager 转发的 ARN/UUID 关联解密；writer 原规则、来源函数/region/AWSCURRENT、非 Secret/KMS 规则保持。全文与风险见[业务候选](./aws-auto-deployment-fast-track-f3b3-business-runtime-v3.md)。TTL IAM 不改，DDB journal 写、DeleteStack、PassRole 仍拒绝。函数配置、标签、日志保留、版本/alias/concurrency 不改，不 publish，不建立触发器。

**调用 0；Source 不读 Secret 值、不连接 Neon，不写业务/admission/authority，不改 Secret/Key，不创建付费 Cell/ECS，不删除资源。** 安装不是业务调用/全链路启用批准；外部已授权调用无法由本地槽位排除。

## 必须明确接受的风险

- 业务 drain handler 安装后可借用现有受限 writer 凭据，向准确数据库暴露既有 admission/job 写能力；安装不是只读行为。没有真实 provision 或未到期会拒绝业务写，但本地脚本不能阻止其他获权者调用。
- 新 drain 跨 reader Secret 的正向实机路径尚未证明；旧在线对照 2 KMS 允许/9 拒绝符合、2 直接 Secret 允许未证明。既有来源围栏不取消；metadata 安装通过不称业务兼容通过。
- 两次 IAM 写非原子，没有 role/policy 服务端 CAS；并发检查只能缩小竞态，失败可能留下默认 v3 或部分权限。只允许原 v1/v2 与自身 v3，遇未知状态停止，不补齐、不自动撤权。
- Lambda 更新使用原 RevisionId 服务端条件，不 publish；更新异步完成，响应与完成 Revision 可能不同。**本独立新协议明确接受差异，绑定两个连续相同 ready 只读观察中的最终 Revision**，并校验完整稳定配置、准确代码和其他资源。不能证明不存在完成后的并发更新；不修改原协议或旧失败判断。[UpdateFunctionCode](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionCode.html)、[函数更新状态](https://docs.aws.amazon.com/lambda/latest/dg/functions-states.html)。
- AWS Login 可自动刷新 Source 凭据；刷新/网络/保存 marker 失败可能留下代码或权限，不自动补偿。一次 attempt marker 先落盘，失响应/失败/槽位消费后只读 Inspect，不重放 Run。
- 接受低成本但非绝对零费用、50 USD/月仅目标；不修改原 Budget，仍不构成付费 Cell 批准。

新槽位 `techlong-f3b3-sealed-business-install-v1-consumed` 永久消费，不自动删除、回滚、撤权、复位、补齐或写重试。元数据核验失败/并发漂移也可能留下已提交代码；保留所有原件和失败记录。

## 执行与独立核验

现在仅等待这份 fresh SHA 和上述四写/零调用/风险的明确确认。Git 提交/推送按默认授权，不再另问。

确认后仅一次 Run，随后新 Node 进程 Inspect；私有辅助脚本：`F:/ChatGPT_workshop/Run-ReviewedSealedBusinessInstall-93bc4518.ps1`。不要现在运行，不要重复执行。助手可以在确认后直接执行；用户自行执行时命令为：

```powershell
& 'F:/ChatGPT_workshop/Run-ReviewedSealedBusinessInstall-93bc4518.ps1' -ApprovedManifestSha '93bc4518c7003fcaa352355c66559b00b40d3b09d1d6ed4def4f9679177dad05'
```

Run 内先重查完整 inventory，逐步重查并记录每次写入意图；更新完成仅只读等待/回读。Inspect 不装权限、不更新或调用函数；不确定提交也不能以“补齐”恢复。仅完整 IAM/代码/最终 Revision 与 marker 都一致，才报告候选安装元数据通过，不报告真实业务、TTL 删除或自动部署验收通过。

安装结束下一阶段回到真实 Cell/部署门禁：baseline、专属 IAM、TaskDefinition/activation、DNS/ACM/mTLS、费用和具体资源清单；真实付费执行与精确 TTL 权限另审，不生成假 authority、不提前 draining、不继续同类微探针循环。
