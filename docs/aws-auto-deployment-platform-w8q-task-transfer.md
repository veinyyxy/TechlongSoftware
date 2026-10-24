# W8q：审核挂起任务原子交接

本阶段只实现并测试 operator 核心；没有生产入口、配置读取、数据库连接或自动执行。用户仍须另批具体生产清单。旧a308周期及成功Review已结束为历史；新代码只用于新周期，不使旧计划重新有效。

## 准确范围

只支持旧任务 `job_6e2e115c80301595512f11fb` → 新审核挂起候选 `job_6a1129afcebfc9fb580517c9`，原deployment/管理员/scope不变。固定候选UUID由现有请求算法推导，不能由调用者换成任意任务。

当前已核对的旧任务待审未领取、没有RunOnce；但代码执行时必须重新证明，不能依赖历史报告。旧Review run40106010722仍是成功历史，控制账本ACKNOWLEDGED并不等于OBSERVED/attested。本模块不补造观察或证据，不重放该Review，不改其时间或永久槽。

## 核心接口

`ops/platform-request-v6/transfer.mjs` 提供纯准备/编译/回读验证和显式能力注入接口：

- `prepareTransferReview`：绑定准确完整基线、新周期源码、48小时准备期限、限定两行交接及SHA。准备不是授权，不开始云端15分钟时钟。
- `compileTransfer`：校验旧行及控制历史；仅在**拟议后状态**中把旧行视为canceled，调用原 `prepareInitializedPlatformRequest` 编译器。不是更改/规范化真实读取。
- `createTransferTransaction`：调用者必须显式传入已核对的SQL客户端和完整状态读取器；无默认连接或owner回退。一个SERIALIZABLE事务内执行准入锁定、准确旧行CAS取消及原请求INSERT。
- `verifyTransferReadback`：用于调用者另开只读连接核对结果；证明旧payload、其他任务、部署和控制历史不变，新行仍为审核挂起且未授予执行。
- `createReviewedTransfer`：要求准确SHA、源码核验和外部永久claim先于事务。没有默认claim、CLI、HTTP入口、凭据发现或启动器。调用者必须负责连接关闭、结果归档和独立回读。

状态读取器必须返回完整且证据安全的同部署任务行（payload解析为JSON；所有lease必须NULL）、完整deployment投影和outputs、准确控制账本以及已验证保护摘要。不接受仅有UI投影或不完整历史快照的生产执行。正式入口还需验证目标/角色/权限、保护布局及源码CI，当前模块不是这些验证的替代品。

## 事务与并发

事务首先对三个现有control账本表取得SHARE锁，再开始快照读取，防止任务交接期间产生新的调度/证据写入。**这些锁会短暂阻塞该control schema的其他写入**，不是分布式锁或跨服务CAS；lock_timeout为1秒，statement_timeout为15秒，整体写入预留30秒，锁冲突即停止，不自动重试。

完整基线摘要必须匹配；复用原请求SQL的app/workspace/subscription/environment/资源归属/成功回执和完整outputs检查，并锁定准入行。同部署任务行锁定后再次读回基线。取消的SQL还要求完整旧行匹配、审核挂起、未领取及没有非Review尝试。

旧行只改status/updated_at/completed_at；新行使用数据库时钟及原审核隔离值。任一准入、CAS或INSERT失败（包括返回0行）都在提交前回滚两项；不做两次生产提交。提交前还验证两行及全部保留项。

若COMMIT调用结果不明，返回 `TASK_TRANSFER_COMMIT_UNKNOWN_REQUIRES_READBACK`，不再发ROLLBACK、COMMIT或重跑。必须关闭该连接并独立只读核对；不能因为ACK缺失判成“肯定没提交”。内存一次限制不能替代正式入口的持久永久槽。

## 验证

本地合成测试：

```sh
node --experimental-strip-types --test tests/platform-task-transfer-v6.test.mjs
```

既有 No-AWS GitHub CI 同时运行 `ops/platform-request-v6/verify-transfer-pg.mjs`：只接受GitHub Actions标志、loopback和动态CI端口，在固定隔离测试数据库验证真实SQL、插入异常/0结果整体回滚、业务准入/历史/保护漂移、并发账本写锁和COMMIT回执丢失的独立回读。它不读取.env，不接受生产URL，不访问Neon/AWS。仅清理该进程新建的准确测试数据库。

## 明确未做

没有生产任务取消/创建、数据库角色/触发器/约束安装、App签名、GitHub部署dispatch、AWS控制窗口更新或Cell部署。没有修改web/cloud执行闭包、请求编译器、已发布release、既有权限或普通队列。

下一步才是为这个核心建立受审生产入口、固定代码/CI与完整新鲜基线，并生成用户单独批准的fresh SHA。托管观察/证据/RunOnce材料连续衔接仍需另外完成；本模块不宣称已经可以进行下一次实际部署。

后续生产入口见 [W8r受审入口与风险](aws-auto-deployment-platform-w8r-task-transfer-review.md)。本页保留W8q核心阶段的实现范围；生产执行授权仍须单独取得。
