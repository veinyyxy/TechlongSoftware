# W9c：RunOnce 成功后立即跟进独立 Inspect

状态：本地实现与针对性回归已通过，**尚未启用、未调度、未部署**。不关闭 Janitor，不延长 TTL，不改 IAM、部署工作流或数据库；仅扩展既有 No-AWS CI 的测试覆盖。原 W8z/9db 栈已删除，不能用本入口补做其历史验收。

## 为什么做这一个改动

W8z 的 RunOnce 成功后，独立 Inspect 留到后续人工对话才启动；到那时原运行期限已过，旧 Janitor 已清理承载。W9b 审计记录了 Janitor 角色的同名、同秒 DeleteStack 事件，符合过期清理逻辑；具体 invocation 触发未证明。历史成功不能证明当前服务仍在，也不能通过改时间补出独立验收。

本改动复用 `ops/platform-operator-v6` 和已经发布的独立 Inspect 工作流。新增一个**提前受审并保持运行的跟进入口**，绑定一条已经 ACK 的 RunOnce run ID，不创建或重跑 RunOnce：

`人工批准并调度 RunOnce → 启动已批准跟进器 → 等待准确 run 成功 → 验证完整证据 → 单次调度另一条 Inspect run → 人工批准 GitHub environment → 独立验证结果`

因此无需等待下一轮聊天再安排 Inspect；但仍需要用户及时批准 Inspect 的 GitHub environment。它不是无人值守自动部署，也不保证 GitHub 排队或审批能在窗口内完成。

## 两个新增命令

统一入口仍为 `ops/platform-operator-v6/cli.mjs`：

```powershell
# 只读取公开输入、源码和私钥文件元数据，不读私钥内容，不访问网络。
node --experimental-strip-types ops/platform-operator-v6/cli.mjs prepare-followup --input <public-input.json>

# 仅在新清单 SHA 获得明确批准、用户在线后运行一次。当前没有此项执行批准。
node --experimental-strip-types ops/platform-operator-v6/cli.mjs follow-runonce --manifest <manifest.json> --approved-sha <fresh-sha> --human-ready yes
```

公开输入的严格字段为：

```text
schema = techlong/platform-operator-followup-input/v1
plan = 已批准并 ACK 的准确 RunOnce plan 原文
runId = 该 RunOnce 的准确 GitHub run ID
workloadExpiresAt = 原云 manifest 中的 workload.workloadExpiresAt（毫秒整数）
keyPath = 既有受保护 GitHub App 私钥的绝对路径
evidenceRoot = 工程外既有证据目录的绝对路径
```

此时结果对象尚未生成，所以不能提前绑定其 VersionId。新批准明确限定**准确 job/manifest/run 对应的唯一结果键**，RunOnce 成功后仅 HEAD 一次选择版本，再固定版本 GET、校验摘要/加密/长度、完整来源、job/run/源码与执行描述符。不能把任意后来提供的键或版本当成原批准。原 manifest 的 TTL 必须与批准的整数严格相同。

## 安全边界

- 准备与批准分离；SHA 绑定所有输入、源码 pins、私钥元数据、期限、风险和副作用上限。
- 仅当前 clean main 与 RunOnce 的 sourceCommit 相同才可执行；不能把旧源码上的运行改成新源码运行。
- 总观察上限35分钟；清单最迟有效时间取48小时和原 workload TTL 中更早者。开始时须仍有完整观察窗口。
- 在等 RunOnce、读取结果及调度 Inspect 之前，必须至少剩余10分钟观察预算，且不得超过原 TTL。这是最低安全余量，不是完成保证。
- 只有准确 GitHub run 的 authenticated `completed/success`，加上完整内容证明 `NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED`，才会跟进；`INSPECT_REQUIRED_NO_RETRY` 不触发自动跟进。
- Inspect 是不同 run ID，沿用完整独立资源/服务/业务核验、原有 TTL 门禁、GitHub environment 人工审批和原 App token 立即撤销逻辑。GitHub success 本身不算验收。
- 与原 `inspect-once` **共用** `intent-<job>-<executionRun>.json` 永久槽；刷新清单、换入口或换输出目录都不能重开同一 Inspect 动作。
- 任一步失败、身份/内容漂移、结果不明、剩余时间不足、无结果对象或撤销不明均停止，不重新 HEAD、不重新 dispatch、不重新 RunOnce、不补齐、不自动回滚或清理。
- 成功只保存 `FOLLOWUP_INDEPENDENT_INSPECT_VERIFIED_NOT_IMPORTED`：不导入控制账本、不写平台 acceptance、不更新 ready/verified/destroyed、不停用客户或订阅。

## 需要在具体新清单中批准的实际副作用及风险

执行入口会读取一次本地 App 私钥内容、加载一次现有 GitHub 读取凭据，使用 Source 读取证据；私密材料进入内存，不能保证擦除，存在本地/服务商日志与网络暴露风险。App installation token 具有 Actions 写权限，仅允许准确 Inspect dispatch，随后尝试撤销一次；撤销失败不能自动重试或宣称已撤销。

上限：Source credentials/STS各6次、固定版本 S3 GET 8次、准确结果 HEAD 2次（RunOnce及Inspect各1次）、GitHub run GET 共80次、Inspect dispatch 1次、App私钥读取/token签发/撤销各1次。等待两条 run 共用这些上限，不翻倍。无本地 SQL/Secret值读取、无 RunOnce dispatch、无 job claim、无承载写、无平台账本写。

独立云端 Inspect 仍可读取一次固定 Neon DB Secret、最多三条只读事务，并在准确任务前缀最多两次条件 PUT 保存证据及 GitHub artifact。这些不是“绝对无副作用”：可能含 AWS Account ID/ARN 等元数据，产生低额非零费用。不能将本地代码授权视为这些读取、签名和调度的执行授权。

跨服务检查不是 CAS；主分支、资源或证据可能并发变化。期限不取消已经在途的请求，GitHub排队/人工审批可能耗尽剩余时间，进程中断或提交结果不明需要独立只读核对。永久槽可能已消费但没有可确认的 Inspect。不得重置或假设自动清理；共享资源可能持续收费，50 USD/月是目标而非硬上限。

## 本阶段不做的事与下一次实操顺序

不修改发布中的云闭包、OIDC trust、工作流权限或 GitHub environment，不调度旧9db的 Inspect，不创建新任务、不延长平台租约，不处理 Neon 现状对账或 F3c9。代码提交和 No-AWS CI 不代表 AWS 执行批准。

后续需要先准备新的、有效的受审部署周期。RunOnce ACK 后立刻准备并批准准确跟进清单，在 RunOnce 尚未结束时启动跟进器；用户保持在线，收到唯一 Inspect URL 后仅批准该 run 的 environment。若启动时窗口已经不足，则停止并记录，不用旧清单补做，不自动重新部署。

旧 `prepare` / `inspect-once` / `verify-bundle` 仍保留，旧清单的内容结构不改写。新测试进入现有 `Platform cloud bridge candidate - No AWS`，不引入新的云端 executor。

## 本地验证记录

新增跟进模式测试覆盖：提前批准绑定、过期/错SHA/历史源码前置拒绝、RunOnce等待及身份漂移、非成功内容阻断、准确TTL对比、剩余窗口不足、单次槽/不明ACK/不重试、实际 App 客户端签名与撤销、两次准确HEAD和固定版本内容证明，以及App核对消耗时间后的最终POST拦截。

原 Inspect、证据核验、successor cycle、hosted driver及错误脱敏相关回归一并运行：118项中117项通过、0失败、1项跳过；TypeScript检查与修改范围的ESLint通过。Windows无法创建测试junction的既有用例仍跳过，Linux CI负责该真实符号链接用例。发布云闭包仍为81项，摘要 `828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a`，未修改Janitor、独立验收TTL门禁或生产运行时源码。
