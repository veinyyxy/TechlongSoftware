# 本次已存事实 → 两行原子任务衔接（待准确SHA批准）

落实[执行手册](aws-auto-deployment-execution-runbook.md)P3，不另开固定任务分支。本次只准备SOURCE接线、测试和待审清单，不读生产配置、不连接数据库、不执行变更。新held任务不是Review或云执行授权。

## 准确变更范围

- 仅把 `job_a60423b885fef3e4326213f7` 从审核挂起pending/attempt0变为canceled；原行、请求、旧Review及全部槽保留。
- 插入准确 `job_a00fc18c13a5d6c6616c8039`，client request `d520d219-4b60-455e-8596-3730bcb8fe9b`，request SHA `67181c98fe9ad70988655d66660a2dc0c1127d0a6889d7ebfb91320b9e8b7538`；pending/attempt0/max1、`available_at=9007199254740991`、无lease、`reviewRequired=true`、`cloudExecutionAuthorized=false`。该ID目前只是提案。
- 其他10条旧job、14/9/9完整控制账本、业务/保护原件完全保持。不安装IAM/Secret、包/来源/计划，不调度、不部署、不续租、不设置密码，不自动清理或初始化商户。

## 复用与SOURCE边界

原 `createTransferTransaction`、SQL编译器、请求编译器及独立readback不变。原handoff profile仅增加代码选择的target/entry及准确历史列表能力，旧9b→a604默认行为保持；本次SOURCE在共享 `platform-reviewed-cycle-v1` 下，不复制a00目录或接收job/profile/facts/expiry CLI参数。完整读取器沿用原身份、目录、角色、准入、保护及事务内search_path检查；读取全部准确旧job和新候选的账本，检查外部同ID/dedupe占用。

原事实采样源码是 `05a1eda`，并非之后的执行HEAD。封存事实 `4709aad2…`、ledger `b2e48e45…`、原始文件SHA及08:51:24采样时间都写入SOURCE。本次仅允许共享handoff组合/相关六项测试/本文与手册/主线/无AWS候选CI的明确文件差异；原SQL编译器、数据库保护、角色和云代码差异一律拒绝，97/104/110云闭包须保持。新执行HEAD须自身准确CI通过。此窄桥不重写事实、放宽基准或使用旧CI替代新源码；执行前仍须完整实时重读并与封存原件一致。

## 运行、预算与独立核验

入口 `ops/platform-reviewed-cycle-v1/request-local.mjs` 只支持 `--check`、`PrepareSaved`、`RunReviewed`、`Inspect`。Prepare只读已存原件、源码/pins、准确CI及配置文件元数据/ACL，不读配置内容或连接生产，不消费槽。生成新的准确SHA后，实际两行写入仍须用户批准；原清单/普通草案SHA不能执行。

获批RunReviewed复用原SERIALIZABLE事务：先SHARE锁控制表，再数据库时钟/完整事实读取，锁定准确准入及job行，再核对完整原件；仅一次条件UPDATE和一次INSERT，事务内完整readback后提交。参数时间由**真实事务内数据库时钟**按固定编译器派生，计划预览时间不是实际执行时间，不能将预览SQL过期后照抄执行。提交不明不重发或盲目ROLLBACK。

写连接关闭后，若本次准确写槽已消费，同一批准自动执行一次**新连接独立只读Inspect**；匹配旧状态则记录未应用，匹配准确两行事后状态才记录held-only成功。无槽不打开第二连接，无写重试/补偿。两槽按准确新job固定，不因换grant/事实/输出而重置；旧槽不改。

最大2次配置全文件读取、2条验证证书TLS连接；原适配器每连接最多80条SQL/事务/目录/保护/读写核验查询，总最多160条。业务DML仅UPDATE1＋INSERT1/一次提交；另外是既有事务/行/SHARE锁及只读查询。最多6次准确CI GitHub GET（writer/Inspect各3）；AWS/Secret值/PEM/控制表写/dispatch均0。Inspect不允许UPDATE，所有原源码/pins/环境/TLS/owner角色及字段保护保留。

## 时限与完整风险

准备截止保持温尼伯2026-10-28 **13:42:18**，最晚启动 **13:40:18**；没有新的48小时窗口。独立只读Inspect可核验已经提交的状态，不用来延长写入时限。没有开Review/claim/workload窗口，原过期Review永久不重放。

实际批准须接受：owner凭据权限宽、配置整文件进入进程内存（不输出或持久化凭据）、TLS/网络与数据库/提供者日志；含必要业务/管理员元数据的私有本地原件；短暂写锁/SHARE锁阻塞、并发及非跨服务CAS；真实数据库时钟派生值、取消旧请求不可无损恢复；提交不明、独立核验失败或部分本地文件遗留；永久槽不复位、不自动重试/回滚/补齐/down/清理、后继运行仍未批准。锁超时/事实或源码漂移/期限不足即停止。当前平台仍可能计费，50 USD/月不是硬封顶，此操作不停止费用。

独立成功后才从真实事后状态派生新basis/profile：只排除新held行、保留旧a604的canceled原行；不把未执行a604提升为成功前驱。新事实窗口、包、来源发布及整轮执行仍另审；本清单不自动启用当前为null的云周期选择。
