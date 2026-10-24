# W8t：生产准备入口与 HOSTED 连续驱动

## 本阶段的准确结果

W8s 的发布/证明组件已接入真实只读准备能力，并新增 HOSTED 人工就绪门禁和连续驱动器。没有更改应用镜像、IAM、云执行闭包、业务状态或旧记录；没有启动新的租约、发布 Review 或 dispatch。

2026-10-24 本轮获得了明确的一次配置读取/一次 TLS Neon 只读连接，以及固定 AWS 资源元数据核对许可。Source 首次 SDK 预检报 CredentialsProviderError，未读取配置或连接数据库；用户刷新后完成：

- AWS 元数据57次：准确 hosting 栈 UPDATE_COMPLETE，第4版 TaskDefinition、服务健康、旧控制租约已过期；安装角色/固定 Secret 版本元数据及 CFN/task 角色布局均与既有契约一致。没有 Secret 值、PEM、S3 内容读取或云写。
- Neon：配置读取1、连接1、查询14、自动重试0。旧任务 `job_6e2e115c80301595512f11fb` canceled；新任务 `job_6a1129afcebfc9fb580517c9` held pending。新任务 ledger 为0 plans /0 approvals /0 attempts；旧 ledger 仍3 /1 /1，原 ACKNOWLEDGED Review 不改为 OBSERVED，proof 仍空。八条任务、完整准入及保护摘要与交接后快照相同。

证据目录：`F:/ChatGPT_workshop/techlong-w8t-current-prepare-20261024-a`。这些是核对时的事实，不是跨服务 CAS 或持续状态保证。AWS hosting 健康不等于 tenant 部署验收；旧租约过期也不会自动停服或停止收费。

本次私密读取范围已消费，不能重跑 Collect。后续本地封装只能使用 PrepareSaved；如将来确需新读取，必须有新的准确范围授权。

## 工程代码

- `ops/platform-review-v6/current-cloud.mjs`：固定资源的 SDK/CLI 元数据读端口，不暴露云写、Secret 值、S3 或私钥端口。沿用原始资源/服务/角色/Secret 契约，只认可已保存独立回读证明的准确成功 root event、全部资源身份和过期旧租约，不使用旧 UPDATE_ROLLBACK_COMPLETE 基线。
- `current-database.mjs`：一次连接；同一 REPEATABLE READ READ ONLY 事务内核对 owner/session/库/OID、控制函数及业务保护、旧任务范围和**单独绑定新 job ID** 的 ledger。固定 TLS、证书验证、目标指纹，连接失败不重试。最多45条查询，不暴露 writer。
- `current-local.mjs`：严格 Windows/固定根目录/干净 main/全 CI/源码兼容检查；Collect 才能读配置或连接服务。PrepareSaved 只校验已有本地证据并绑定最终源码、依赖 pins 和 CI，不重新打开服务连接。没有 RunReviewed、Publish、Update 或 Retry 模式。
- `hosted-driver.mjs`：真实 HTTPS HOSTED 租约、准确栈和新任务定义、来源/任务/lease hash 绑定的人类页面就绪回执。不需要本机进程/PID，不把 hosted 伪装为 localhost。人员就绪之后才调用 Review 发布组件；连续等待人工平台批准、GitHub environment 批准、证明衔接及人工 RunOnce。父驱动没有 dispatch 能力。

驱动仍使用原固定30分钟租约和8分钟领取预留：页面就绪截止 issuedAt+8分钟；Review 完成截止 issuedAt+14分钟；RunOnce 等待不超过 lease−30秒。任何超时只停止本机衔接，不续租、不重签 manifest、不取消或重跑 GitHub。每个父驱动实例单次使用；错误/提交不明仍须独立回读。等待中的后台进程不等于自动授权。

## 使用方式与范围

只有重新获得准确服务读取许可时，才可 Collect 到一个新、未存在的目录：

```powershell
node --experimental-strip-types ops/platform-review-v6/current-local.mjs --mode Collect --ci-run <准确成功CI> --allow-config-read yes --output F:/ChatGPT_workshop/techlong-w8t-current-prepare-<新名称>
```

本轮不再执行 Collect。全 CI 通过后使用保存的成功快照：

```powershell
node --experimental-strip-types ops/platform-review-v6/current-local.mjs --mode PrepareSaved --ci-run <当前main的准确成功CI> --audit F:/ChatGPT_workshop/techlong-w8t-current-prepare-20261024-a --output F:/ChatGPT_workshop/techlong-w8t-pipeline-preparation-<新名称>
```

封装材料从最早的实际读取时刻起最多48小时，不能通过重新封装延长原事实期限。它明确为 `preparationIsNotWriteApproval=true`、`productionWriteEntryReady=false`，**不是可执行的写清单，不需要用户现在批准写入**。所有结果采用不可覆盖本地证据；不会创建或消费旧/新执行永久槽。

## 下一项主线工作与冻结点

剩余只接入两类真实执行端口，不增加新基础设施或另立权限方案：

1. 对当前准确成功栈的单次 UpdateStack：只替换 TaskDefinition、更新 Service，原镜像/Secret 版本/IAM/其他十项资源身份及 hosting 历史标签不变；明确保留正常失败回滚。必须绑定当前成功基线，而不是旧 revision3/回滚恢复槽。
2. 给既有 W8s 发布/证明和本阶段驱动提供受限 owner、固定版本 S3、准确 GitHub run 读取和结果发现端口，以及单独的独立回读入口。每个写入、版本读取、日志/结果发现和永久槽都要在具体新清单中计数和批准；不能凭本阶段只读许可执行。

这两个适配完成、全 CI 通过并固定 main 之后，才能提出实际开窗/发布/衔接的准确 SHA。随后源码冻结到该 RunOnce 和独立云端 Inspect 完成。必须先完成适配，再发布 Review，不能先发布再补代码浪费15分钟领取窗口。用户仍亲自批准平台 Review/RunOnce 与两次 GitHub environment；独立 Inspect 不能被 GitHub success 代替。

不重放 W8r 的两消费槽、不复位 W8s 保留槽、不延长旧 Review40106010722、不改 F3c9 支线或 UI。没有自动清理、停止计费或费用硬上限；50 USD/月仍只是预算目标。凭据内存、提供者日志、元数据/并发非CAS、部分提交及遗留收费资源等风险在后续实际写清单中继续明确。
