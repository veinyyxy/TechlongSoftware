# 免 Web 受审发布入口与固定请求衔接提案

后续实现（2026-10-27）：固定a604事务入口及未发布绑定候选已另行编码，仍未生产执行。本文原“没有请求执行CLI”仅描述上一代码阶段；请以[新入口范围与完整风险](aws-auto-deployment-a604-handoff-v1.md)为当前继续点，不执行本文旧提案SQL或过期三写材料。

2026-10-27。此文件是新增publisher入口的完整范围/风险及准备说明。**代码实现不代表生产执行批准**；本阶段没有读取生产配置、连接数据库、写资源、创建任务、读取Secret/PEM、调用App或dispatch。只运行本机测试和无AWS身份CI。已有冻结97文件云闭包、镜像、IAM、业务schema和GitHub环境规则不变。

## 已实现的入口

`ops/platform-delegated-publisher-v1/local.mjs`提供显式 `--check`、`PrepareSaved`、`RunReviewed`。不是HTTP路由或常驻worker，导入无网络/凭据副作用。没有Web登录、租约或ready-at参数；没有账号、region、endpoint、数据库、任意SQL或dispatch覆盖参数。

PrepareSaved仅使用另批只读阶段保存的完整材料：完整业务/保护/账本snapshot、实际load_plan结果、准确GitHub run、四份带原始版本/加密/长度/hash元数据的证据对象（result、manifest、installation、原package）。它不伪造缺失的provider元数据。旧archive、原请求12份封存原件、源码/pin和准确CI均绑定，配置仅读ACL/长度元数据。过期、源码不符或缺材料时不生成可执行清单。当前旧Review已过期，**没有准备或批准任何实际RunReviewed清单**。

新manifest精确绑定baseline、真实ACK计划、历史6366…行、来源/release、结果版本、worker时限、源码/CI/pin、配置元数据和下面三写规则。外层SHA同时绑定材料路径和每份原件摘要。后继plan/action SHA只能按已绑定源码规则和实际运行时间派生，不接受调用方指定的任意后继计划。

## RunReviewed的实际顺序和上限

批准新外层SHA后才可执行。先检查干净同源码/完整pin/准确CI、固定Source IAM身份、配置目标/TLS/owner/OID/九个函数体、实际ACK与完整业务/保护/历史基线。复用现成RecoveryPublisher重建四份固定版本内容，再独立重查准确run和完整baseline。全部通过后才消费一次固定永久槽并记录意图。

随后最多各一次：

1. `observe_run`记录准确run的真实completed/success，并从独立reader回读；
2. `attest_evidence`写入内容重建产生的准确proof，并独立回读；
3. `publish_plan`写入固定派生RunOnce，独立回读它未调度，完整snapshot核对仅本轮观察/proof/新增计划变化，旧业务行、历史、批准、保护布局全部保持。

上限：配置全文件读取1次、验证TLS连接2条、查询/RPC100条、Source STS1、固定版本S3 GET4、准确GitHub run GET2、准确CI GET3；观察/proof/计划各最多1次。没有AWS资源写、IAM/Secret修改、Secret值/PEM读取、App签名或dispatch。正常返回 `DELEGATED_RUNONCE_PUBLISHED_REQUIRES_SEPARATE_DISPATCH`，**不是部署成功或执行批准**。之后仍需有效的委托dispatch授权和用户本人GitHub environment审批。

CLI固定槽 `F:/ChatGPT_workshop/techlong-delegated-publisher-advance-v1.intent.json`；一次消费后不删除/复位/改名重试。运行输出由批准SHA固定派生，不能用output覆盖。作业最多2分钟，启动须留出2分钟；每步继续受真实claimBy、90分钟workload预留和8分钟衔接预留约束。不存在grant期限覆盖worker期限、冻结时钟或自动刷新manifest的行为。

## 固定请求衔接编译器：只提案，不执行

`request-handoff.mjs`核对准确旧Review的source/plan/run、固定S3版本/hash及已过期领取和TTL，同时要求30秒内完整snapshot、旧任务仍pending/attempt0/无lease、所有其他任务/业务/保护/历史符合原始基准。任何RunOnce/新活动任务/旧proof占用或变化都拒绝。

只调用现有 `compileHeldTransferProgram`生成准确旧任务取消和新held行INSERT提案；不执行、不修改已有审批/部署/订阅/实例或保护。候选固定为：

- 旧任务 `job_9b57b43a6b88f37202b29170`；
- clientRequestId `17004827-71da-4e61-9bb3-26cbf6fbb1ba`；
- 新候选 `job_a60423b885fef3e4326213f7`，请求摘要 `3bb1acc176722d5196a1e507f34e11c0fae512a1cee915a7320ac458047dafe9`。

这些是编译候选，不是已存在的业务记录或批准。新行保持审核挂起、`cloudExecutionAuthorized:false`，普通队列不能领取；原行只拟变为canceled，完整旧记录保留。输出强制 `runtimeCompatible:false`、`bindingPublicationRequired:true`、`executionReady:false`、`physicalWrites:0`。**现有冻结云入口仍只支持9b**；不能仅换job ID就运行，新任务对应binding/release兼容及实际事务仍需另外准备、审批。当前没有请求执行CLI或自动迁移。

## 完整风险和不确定提交

owner凭据比用途更宽、整份配置进入内存；版本/源码/元数据检查不是跨服务CAS，仍有并发、提供者日志、网络及内存残留风险。TLS和固定目标检查不保证提供者不记录查询。S3/GitHub读取可能计费；50USD/月是目标而非硬停费保证。

三项publisher SQL是分别提交的，**不是原子事务**。可能只留下观察、只留下proof、或计划已提交但ACK/最终回读失败。每次提交前记录phase/数量，未知结果立即停止，不再写后一步、不自动重试、回滚、补齐或删槽；需另审独立回读。独立reader不能消除读取后竞态。源码、配置、原始历史/保护或截止变化也停止，不修改原基准以求通过。

请求取消/新建提案如未来获批，须用现有Serializable/锁/准确旧行CAS/提交不明不重试及独立回读入口，不得直接拿两条SQL裸执行。冻结云发布/binding/IAM和实际部署不是本publisher三写许可的一部分。

## 接下来的唯一主线

本机252项相关测试通过（本阶段新增29项），类型检查和限定lint通过；覆盖三写顺序、独立回读、旧行漂移、UNKNOWN/响应不明、时限、固定版本、候选碰撞及无权限检查入口。写入路径使用自包含测试fixture，不是生产写入或部署证明；准确提交的无AWS身份CI另存完成回执。

先完成新候选请求与云绑定的受审兼容准备，并把“Review→可信发布→RunOnce代批/调度→Inspect”连续衔接代码和全部材料备齐，再开启新的15分钟worker窗口。旧Review、旧grant和过期basis不重放；不为Web按钮续租，不扩F3c9/UI/IAM探针/镜像支线。GitHub environment始终由用户本人审批。

```powershell
node --experimental-strip-types ops/platform-delegated-publisher-v1/local.mjs --check
# 未来另批材料/命令索引；不是本次执行授权
node --experimental-strip-types ops/platform-delegated-publisher-v1/local.mjs --mode PrepareSaved --material F:/ChatGPT_workshop/techlong-<新材料>.json --ci-run <准确CI> --output F:/ChatGPT_workshop/techlong-delegated-publisher-prepare-<新后缀>
node --experimental-strip-types ops/platform-delegated-publisher-v1/local.mjs --mode RunReviewed --manifest F:/ChatGPT_workshop/techlong-delegated-publisher-prepare-<新后缀>/manifest.json --approved-sha <明确批准的外层SHA>
```
