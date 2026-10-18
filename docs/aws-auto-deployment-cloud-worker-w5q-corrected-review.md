# W5q：接线修正后布局，准备同任务云 Review（未调度）

2026-10-18，America/Winnipeg。按用户“开始下一步”继续 W5p 的唯一主线。仅本机代码、测试、文档和最终 main 只读 Prepare；本轮不 dispatch、不读取 AWS Secret 值、不领取任务或部署。

## 固定事实和最小改动

W5p 执行记录固定于 Git `591326c8a0b1cb2b8d5dd32626de70008637f21d`，规范 LF SHA `aaaa6c3aa7c3a420645f6e6e7eb5ba6e8bb6c5f41173bed480aff8363103ef13`。继续入口核验其 31 原件、已批 b212b017 完整计划、164 个当时 Git pins、独立 Inspect 和永久槽；先前 W5o 159 pins、失败 Review-v4 及 W5n 27 发布原件和更早记录继续逐项核验，全部保留。

唯一实际 IAM 修正已经完成且持续生效：`ecs:DescribeTaskDefinition` Resource=`*`、ca-central-1 条件保留；本阶段不再安装或调整权限。该权限可能读取其它租户任务定义及敏感环境配置，程序固定目标不是 IAM 租户过滤，[原完整风险](aws-auto-deployment-cloud-worker-w5p-task-definition-read.md)继续有效。

新增入口 `ops/cloud-worker/corrected-job-dispatch-local-v5.mjs`，新 schema `techlong/cloud-worker-corrected-job-dispatch-review/v5`。新元数据读取器严格接受 W5p 新模板/inline 摘要，并比较原独立证据里的 trust、boundary 默认 v1/身份、角色标签、五资源 physical ID 等完整布局，仅允许当前受审 caller main 更新。新读取器保留 Github/OIDC/environment、固定公开 S3 binding、证据桶、DDB/TTL、旧 IAM、两 Secret 固定版本元数据、Neon 窄角色目录和原 held job/九行/队列准入检查。

旧 activation/W5o 核验代码不改、不绕过，其旧 inline 断言仍会拒绝新布局。新入口只复用旧 IO 的准确 POST/ACK、条件 Put/版本 ACK、云 proof/S3 回读、源码检查等未变操作，不调用旧 preflight；从 W5p IO 只调用 `readLayout('new')`，不调用 Apply/旧 preflight/云写方法。metadata 自身 AWS 命令只读白名单，不读取 Secret 值。

云 C=`d8cb99693231770de6a5d73e02dda42b87035714`、R=`7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c`、76 文件闭包 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`、两部署工作流/七个外部输入、依赖和 job/effects 合同均不改，无需重新发布。只给现有无 AWS CI 增加新边界测试。

Review-v5、RunOnce-v4、Inspect-v4 是独立固定永久槽；旧 v4/v3 等全部保留。三模式本机入口现在一并实现，以便真实 Review 后不必改 caller main。RunOnce 必须绑定同 caller/closure 的成功云 manifest，并保留原 claimBy（约十五分钟）和业务/工作负载门禁；Inspect 必须先准确条件 Put ACK 及独立版本回读，再单次 POST。提前有代码不等于授权运行这些模式。

本机新增 11 项边界测试及相邻回归共 83 项通过；类型检查、定向 lint（零警告）及两仓 diff 检查通过。独立闭包检查仍为原 76 文件/70ee60eb。最终 main 云 CI 和实际只读 Prepare 另核验，不以这些测试代替云验收。

## 实际未来 Review 范围及完整风险

未来另批的一次 Review：一个 GitHub dispatch POST（要求含准确 run ID 的 ACK），用户人工 environment 批准，云 worker 一次固定 DB Secret 值读取/窄权限只读事务、现有目标资源读取、最多一个私有 versioned S3 manifest 条件写。它不领取 job、不读 control Secret、不建 Stack、不访问应用、不写 DDB 或业务状态，不部署 Cell；尚无成功 manifest 时不能进入 RunOnce。

- 本机/GitHub/AWS/Neon 非原子，没有跨服务 CAS；核验后资源、main、队列、权限或凭据仍可并发变化，main 未受保护。修正后配置回读不保证实际 worker API 授权、传播或后续全部门禁成功。
- 既有 regional 读取能力持续存在，不自动撤权。DB 凭据只在受控云内存交给固定 Neon；提供者/runner/管理员日志或内存仍有暴露风险，不能证明绝对无泄露。本机 Prepare 仅用已有 owner URL 做固定 Neon HTTPS 只读元数据/原任务核验，不连接 Aurora，不读取 AWS Secret 值或原私密包。
- 云 Review 会把原 job/九行和队列快照存到固定私有证据前缀；公开日志仅安全 proof。读取任务定义可能涉及敏感环境配置，不能将它或原始 provider 错误/签名 URL 打印或落公共日志。
- 新槽一经消费永久保留。POST ACK 未知、超时、落盘失败或部分 S3 状态均停止，不自动重发/补齐、重跑、取消、复位槽、删除、回滚或补偿；可能留下人工审批 run 或收费存储。只读 Observe 不补写。
- 两小时本机批准窗口只控制 dispatch，不约束之后用户人工环境审批的等待时间；云执行仍在开始时重新准入。真实 Review 后 caller main 必须冻结跨 RunOnce/Inspect；即使获批，过了 cloud claimBy 也不能部署，不能用本机延长批准替代新云 Review。
- 准确源码 hash、F 原件和 Git 引用是本机可审计约束，不是云端签名或防管理员篡改保证。Source Login 自动刷新会失效，任何未知状态都不转为“资源不存在”。
- 50 USD/月是目标而非硬 cap，现有资源/API/CI/存储可能继续收费，接受低成本但非绝对零费用。成功 Review 也不等于自动部署端到端完成，更不是整套平台已在 AWS 上线。

## 命令和继续位置

最终 clean main 的 portable/continuation 无 AWS CI 均 attempt=1/completed/success 后，仅运行：

```powershell
node --experimental-strip-types ops/cloud-worker/corrected-job-dispatch-local-v5.mjs --mode Prepare --cloud-mode Review --output F:/ChatGPT_workshop/techlong-w5q-review-20261018-a
# 准确 fresh SHA 单独批准后才允许，不在本阶段运行：
node --experimental-strip-types ops/cloud-worker/corrected-job-dispatch-local-v5.mjs --mode Dispatch --manifest F:/ChatGPT_workshop/techlong-w5q-review-20261018-a/manifest.json --approved-sha <fresh-sha> --output F:/ChatGPT_workshop/techlong-w5q-dispatch-20261018-a
# 只读 Observe 可以多次新目录回读，不重发或批准 run：
node --experimental-strip-types ops/cloud-worker/corrected-job-dispatch-local-v5.mjs --mode Observe --dispatch-directory F:/ChatGPT_workshop/techlong-w5q-dispatch-20261018-a --output F:/ChatGPT_workshop/techlong-w5q-observe-20261018-a
```

所有目录必须全新、直接位于 F 基目录且前缀 `techlong-w5q-`，旧输出不覆盖。过期/事实漂移只读刷新并另请新 SHA；无新权限、工作流发布、自动环境批准或实际部署授权。最终继续同 `job_ecbf09030d3da7286ea3ef93`，不登记新请求、不重做 IAM/W5n 发布、不扩 F3c9 或平台托管支线。
