# C5g 在线只读核对通过：仅一次既有 CFN 策略版本更新待批

最新状态：用户确认后已完成唯一安装，v8默认/v7保留且独立Inspect通过；原SHA与永久槽已消费，**不得再执行下文Run命令**。[已执行结果与唯一继续点](aws-auto-deployment-aurora-dual-mode-c5g-cfn-read-policy-executed.md)。下文保留原待批材料，不代表当前执行授权。

2026-10-15 America/Winnipeg。用户明确允许后，仅执行 **1次 STS 身份读取与8次 IAM 元数据读取**。没有模拟、IAM/资源写、私密包或 Secret 值读取、SQL、job/TTL、部署或执行槽消费。

UTC **16:04:44.589** / Winnipeg **11:04:44.589 CDT** 生成新清单：

```text
dee0a0003308e809cb1d767d07756243507a99cb683b5181452e54168e77d9da
```

有效至 **2026-10-15 12:04:44.589 CDT**（UTC17:04:44.589）。这不是安装已批准；之前的 candidate SHA 或笼统继续许可不能替代此 SHA 的写入确认。

## 实际核对结果

- Source 仍为账户402010193138的准确 `techlong-sandbox-dev` IAM user；RoleId `AROAV3GNMXTZKHYBCRSOE`、PolicyId `ANPAV3GNMXTZOQPIXOKJ4` 均一致。
- CFN role 的 trust、boundary、唯一 attachment、空 inline 列表与原完整文档未漂移。默认版本仍 **v7**，版本库存只有v7。
- PermissionsBoundary 与 PermissionsPolicy 两类消费者均只有准确 `TechlongSandboxCloudFormationExecutionRole`，无其他role/user/group；无截断。
- 原文档 digest `7b1d73a2defce79a34dc6e18ffa6f349302e2b1046b99256d86708ee5bb950d5`；拟更新文档 digest `bd2bd7d52bfdcc1f9c97230f510867d7be10a15f1a1269aa9e0f068add7f70ad`，6086字符。
- 7项源码/依赖/历史capsule pins及3项原证据 hashes当前匹配；code binding `c732cf515ad191bfa230a8b5273be87714963034ea8c1a3c176a6a6146fec29f`。另一条本地校验确认准确 SHA 可通过、错误 SHA 拒绝；没有再次调用AWS或读取新IAM状态。
- 永久槽当前不存在。执行源码未修改，本轮不重复运行上一阶段25项tests；这次验证是实际在线元数据与本地清单/代码完整性，不是新增模拟或真实应用验收。

原始本地目录：`F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-review-20261015-r1/`。保存 code-binding、candidate、before、manifest、result；完整 IAM 文档仅保留本地，Git只记录范围、摘要及hash。[版本化 prepared capsule](../ops/aws-sandbox/reviews/aurora-dual-mode-c5g-cfn-read-policy.prepared.json)。

## 需要单独批准的唯一写入

仅对 `arn:aws:iam::402010193138:policy/TechlongSandboxCloudFormationExecutionBoundary` 调用一次 **CreatePolicyVersion，SetAsDefault=true**，追加原方案的六statement/八读取action，保留完整旧v7。新版本ID以实际响应为准，不假定v8。该policy同时是准确CFN role的identity policy与boundary，因此默认版本同时影响两种用途。

新增读取范围、八action与全部风险见[实施文档的“最小差异”与“后续安装必须另批的完整风险”](aws-auto-deployment-aurora-dual-mode-c5g-cfn-read-policy.md)。特别接受：

- 权限持久生效而非临时窗口；两项 Logs inventory 使用 ca-central-1 区域内 Resource:*，会暴露该区域其他index/resource policy元数据。旧较宽权限保留，不作自动收窄。
- 非CAS并发竞态、传播不保证；直接改CFN可能管理的policy会产生drift，未来栈更新可覆盖。真实provider和日志流能力仍未证明，不据此声称ready。
- 唯一永久槽提交前占用；失败/丢失响应可能已有新default，只读核验、不自动重试、删除版本、补齐、回滚、撤权或复位。Source登录/自动刷新也可能失效，届时可能需重新登录才能完成独立核对，不能重发写入。

批准后的执行前重复同样 **9次只读前态核对**；一次IAM写提交后，不论成功或失败立即另起进程 **Inspect（至多10次只读调用）**。它确认准确新default及完整旧v7仍在；缺少提交回执只标记状态匹配但归因未证明。写前失效/漂移或槽已占用则停止，不更新清单来自动安装。

不创建角色、不改trust/attachment/其他inline或共享service boundary，不执行CFN/ECS/DNS/DDB/SQL、不读Secret值/私密包、不认领owner或创建job/TTL/付费Cell。**目前没有执行上述写入。**

## 批准后才可使用的入口

从平台仓库根目录执行；这两条只是留档，不是当前自动执行授权。Inspect仅在真正尝试过Run后使用新的独立目录。

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-cfn-read-policy-v1.mjs `
  --mode Run `
  --manifest F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-review-20261015-r1/manifest.json `
  --approved-sha dee0a0003308e809cb1d767d07756243507a99cb683b5181452e54168e77d9da `
  --output F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-run-20261015-r1

node --experimental-strip-types ops/aws-sandbox/scripts/review-express-cfn-read-policy-v1.mjs `
  --mode Inspect `
  --manifest F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-review-20261015-r1/manifest.json `
  --approved-sha dee0a0003308e809cb1d767d07756243507a99cb683b5181452e54168e77d9da `
  --output F:/ChatGPT_workshop/techlong-express-c5g-cfn-read-inspect-20261015-r1
```

之后仍回到同一 first-claim/epoch→workload/DNS→provision/initialized-ready原子回写闭环，完整执行根尚未完成。本次IAM清单有效期不代表延长Cell标签或批准部署；现有Cell标签仍为11:44:56.246 CDT，不自动删除或停费。50 USD/月是目标而非硬cap，现有资源继续计费；标签过后新部署、延时或清理均不能复用旧批准。
