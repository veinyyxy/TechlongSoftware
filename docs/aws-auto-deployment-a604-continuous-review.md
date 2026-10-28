# 最小连续衔接：Review → 核验 → 后继计划发布

后续执行统一遵守[主线执行手册](aws-auto-deployment-execution-runbook.md)。本修复已在提交 `b4fc2dfdef9b3a2de010dfeb7b01cdfd4c53f5f2` 收尾，[准确CI40610066977](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40610066977)全部通过；下一只准备完整新周期总清单，不再扩展本模块或运行旧周期。

2026-10-27。本次仅实现代码、无生产身份测试和文档；没有运行新周期、读生产配置/Secret/PEM、连接 Neon/Aurora、调用 AWS、写账本、安装权限或调度。工作流、97/104 冻结云闭包、原 deadline 和旧永久槽均不修改。

## 解决的实际问题及当前限制

历史 Review run `40607422851` 已由本人批准 GitHub 环境并 completed/success；本地核对了结果和 manifest 两个准确版本的 SHA。Review 于温尼伯 2026-10-27 19:16:17 生成，claimBy=19:31:17；保留 8 分钟执行和 2 分钟发布启动预留，最晚衔接为19:21:17。本轮只读准备开始时已晚于该点，未读取配置或连接数据库、未生成/发布 RunOnce。不能把这次证据标记成已导入 proof 或实际部署验收通过。

原始停止证明保留在 `F:/ChatGPT_workshop/techlong-a604-review-timing-stopped-verified-20261027-a.json`，原始字节 SHA `64609e78be6c76bd5f70e98380692263c6b6fa793c08c925955adc34f721a5ff`。Review 槽已经占用，**新入口不支持接管/恢复/重跑这个 run，也不延长它的 claimBy**。未来可执行的新周期及任何任务衔接仍须单独准备和批准，本次不创建替代任务、不变更当前固定 profile。

## 新流程与授权

一次新的准确外层 SHA 批准 → 单次 Review 调度 → 等待本人 GitHub environment 批准 → 同一进程读取真实结果/账本 → 原内容核验器重建证据 → 原发布器 observe/proof/publish 三写 → 独立连接回读 → 停止。

这只移除 Review 成功与后继发布之间的聊天等待，**不自动调度 RunOnce，也不等于整套自动部署已验收**。GitHub 环境仍由本人批准；没有调用批准 API。普通 Review grant 不能自动升级：新的外层清单明确绑定原 grant、任务、seed/动作、当前源码/CI/pins、角色/环境、私密文件元数据和额外读取/三写范围，必须按新的外层 SHA 单独批准。内部 manifest SHA 仅按固定源码规则、实际 run 和固定版本内容生成，不能从 CLI/JSON 注入内部审查件或任意 SQL。

现有 `createA604PublisherOperations`、`proposeReviewSuccessor`、`createA604PublisherIo` 和独立读回保持原实现。新代码只组合这些能力，不改验收基准、保护布局或现有 SQL。验证真实 held 原件、完整业务/历史/保护、ACK、固定内容和源码后才生成内部三写审查；实际写前仍重新读取、重算并核验。不把内存提案当作已持久化 proof。

## 入口（仅接口说明，不是可执行批准）

`ops/platform-a604-operator-v1/local.mjs` 新增：

- `PrepareContinuousSaved --grant <新grant.json> --output <本地审查目录>`：只用已保存的新 grant 和准确 CI 准备外层清单，不读配置内容或私钥、不连接生产、不消费执行槽。
- `RunContinuousReviewed --manifest <新manifest.json> --approved-sha <新外层SHA>`：先核验所有槽未占用，再按上述流程一次执行。

没有 resume、run-id、profile、job 或 publication 覆盖参数。当前旧 a604 Review 槽已占用，准备和执行入口都拒绝；不能用本次代码提交、旧 grant `14d6946a…` 或旧批准启动它。新增固定本地槽 `techlong-a604-continuous-review-v1.intent.json` 只在将来准确批准的执行中消费，所有旧槽保留；本次没有创建该槽。

## 范围和不变的时限

本机最多一次 Review dispatch/一次 App 签名与撤销尝试、一次审计条件 PUT；原调度范围保持。连续阶段额外最多4次准确版本 S3 GET、一份官方日志引用下载（2MB，内存解析不保存原日志/签名URL）、一次配置全文件读取/一条验证TLS连接/45条只读查询；原三写阶段最多4次准确版本GET、一次配置读取/两条TLS连接/100条查询及 observe/proof/publish 各一次。合计上限为3次配置读取、5条TLS连接、245条查询、3次 Source STS、1次 PEM 读取；本机 Secret 值读取0、资源/IAM写0、RunOnce dispatch0。监控 GitHub GET最多86，准确CI GET最多9，原调度器环境/App GET另沿用其固定上限。

云 Review 仍由已安装合同限定：固定 installation 和 DB Secret 版本一次读取、窄 Neon 只读访问及审查证据写入；外层 S3 条件 PUT最多2次，内层证据沿用原合同。不读取控制私密包、不写DDB、不领取业务任务、不创建承载资源。

进程总运行最多20分钟，GitHub状态每15秒观察一次、最多80轮；等待是只读观察，不是重发 dispatch。GitHub批准前尚未生成云审查的15分钟领取窗口；Review成功后立即衔接。原15分钟 claim、8分钟执行预留、2分钟发布启动预留、workload/basis期限和5小时准备快照政策全部不变。陈旧、失败、身份/内容漂移、窗口不足或源变动都停止，不补时。

## 完整风险及验证边界

外层授权包含额外副作用，不能沿用旧 Review-only 批准。配置全文件、私钥签名材料、临时令牌及历史业务版本对象进入内存，可能涉及提供者日志；TLS与不输出凭据不能保证内存或日志绝无残留。完整对象仅保存在本地私有证据目录，不提交GitHub。GitHub、S3审计、数据库三写和本地回执没有跨服务事务/CAS，仍有并发和部分成功风险；正常登录刷新、源变更、网络失败、进程/额度中断都可能使执行停止。

未知 dispatch、审计/SQL提交或撤销结果保留 ACK、阶段及派生 SHA，停止不自动补齐、回滚、清理、重试或恢复槽。只读重核和运行时更短衔接不能保证永远成功。源/证据、窗口或业务状态发生变化时，不修改基准来求通过。原费用风险保持，50USD/月不是硬停费，已有资源可能继续计费；不自动删除或续租。

测试复用合成自包含资料和原真实内容编译器/三写独立回读，覆盖单次授权、无聊天衔接、坏版本/业务漂移/错误run、超时、占槽及三写未知提交。通过 CI 仅证明对应代码，不证明新周期已上线或当前生产状态。后续先解决新周期的准确来源/任务与权限范围，再另审实际运行；本次只到代码和 CI。
