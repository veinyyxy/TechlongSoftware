# 实现记录：免Web逐次批准，GitHub审批保留

2026-10-26。用户明确选择“平台审批由受限委托处理，GitHub给本人审核”。本次完成代码、测试和文档，不代表批准任何实际私密读取、账本写入或调度；没有修改线上环境、IAM、数据库schema、共享控制器、部署工作流或镜像。

新增`ops/platform-delegated-approval-v1/`五个模块：policy绑定单轮授权和固定任务；operation执行单次代批；io限定已有RPC/App接口；readiness做另批只读准备；local提供显式命令。旧Web入口保持原人工行为，不通过全局开关绕过。新路径不用Web登录、用户密码/Cookie、三项SHA页面点击，也不依赖已过期的Web控制租约。

一份新grant可授权该任务Review、RunOnce、Inspect各代批/dispatch一次。每次都验证准确源码/CI、原安装版本、计划/前驱证明、GitHub规则、Source身份与准确审计对象权限、数据库布局；条件S3审计成功后才写批准账本/读取App私钥。审计记录“管理员为授权人，local delegated operator为执行者”，而不是本人Web点击。ACK保存/独立读回、固定不可重放槽、提交不明停止和原worker期限不变。

GitHub人工门禁是硬约束：required reviewer包含仓库所有者，首次检查后在dispatch POST前再次检查，规则漂移即停止；传输层不允许pending-deployment批准、环境修改或任意仓库写接口。原共享`humanEnvironmentApprovalRequired:true`、GitHub环境和部署工作流全部未改。正常返回准确run链接，用户仍自行点GitHub的Review deployments。

旧6366…计划完整保留。新grant的只读准备/执行都核对它仍未调度；ACK、UNKNOWN或其他历史漂移会阻止新代批。新源码Review种子按固定规则生成，仅不存在时单次登记。后继RunOnce/Inspect仍必须由原可信publisher完成内容重建、观察/证明和计划发布；此入口只替代Web批准/调度，不伪造证明或将GitHub成功直接视作业务成功。

本机208项相关测试通过，类型检查和限定lint通过。新增覆盖授权/资源/执行者篡改、人工门禁缺失或临时移除、未知旧状态、审计失败、私钥读取顺序、单次种子/调度、ACK/撤销异常、RunOnce/Inspect锚点、只读查询门禁、Review时限及无权限检查入口。准确No-AWS CI与最终源码另记本地完成回执，未提前宣称成功。97项云闭包和现有镜像保护代码须继续匹配。

## 后续仅按此顺序

1. 准确CI通过，另获一次限定只读准备许可；核对GitHub环境、活跃管理员、held任务、旧计划/attempt和必要Source元数据，PEM仅读ACL/大小元数据，不读取内容。
2. Snapshot做1次GitHub environment GET、配置1次/TLS1条/最多25条只读查询；PrepareSaved只用两小时内本地结果、ACL元数据、准确CI3GET生成一次待审grant。Review最晚启动时间另列，grant名义有效期不延长种子两小时期限。
3. 用户一次批准本轮授权范围及[完整风险](aws-auto-deployment-delegated-web-approval-v1.md)后，operator代批准确计划并单次dispatch；用户只需在GitHub批准对应run。后续可信publisher与代批可由agent推进，仍须遵守原证明/领取/资源期限和已批准副作用，超范围另审。

```powershell
node --experimental-strip-types ops/platform-delegated-approval-v1/local.mjs --check
# 下面均为未来另批命令索引，不是本次授权
node --experimental-strip-types ops/platform-delegated-approval-v1/local.mjs --mode Snapshot --output F:/ChatGPT_workshop/techlong-delegated-approval-snapshot-<新后缀>
node --experimental-strip-types ops/platform-delegated-approval-v1/local.mjs --mode PrepareSaved --environment-file F:/ChatGPT_workshop/techlong-delegated-approval-snapshot-<新后缀>/environment.json --ledger-file F:/ChatGPT_workshop/techlong-delegated-approval-snapshot-<新后缀>/ledger.json --ci-run <准确CI> --output F:/ChatGPT_workshop/techlong-delegated-approval-prepare-<新后缀>
node --experimental-strip-types ops/platform-delegated-approval-v1/local.mjs --mode DispatchReviewed --grant F:/ChatGPT_workshop/techlong-delegated-approval-prepare-<新后缀>/grant.json --approved-sha <已批准grantSHA> --action Review --plan-sha <grant内准确seedPlanSHA>
```

原basis仍于2026-10-27T18:47:57.695Z截止，旧20:23租约不续期，旧批准/槽不重放。50USD/月是目标不是硬停费保证；本轮未访问生产、未签发token或dispatch，没有消费新槽。
