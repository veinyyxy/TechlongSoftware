# W8r 任务交接生产入口与风险

此文档描述能力，不是执行授权。入口代码、测试或CI通过均不会取消/创建生产任务。具体执行必须由用户批准新清单SHA及本节风险。

## 三个分开的模式

入口：`ops/platform-request-v6/transfer-local.mjs`，仅固定Windows工程、干净main、准确源码/依赖pins、已成功的No-AWS CI。禁止环境/参数覆盖数据库、配置、目标任务、执行槽或连接验证。

`Prepare` 需要独立的配置读取和Neon只读许可；显式 `--allow-config-read yes` 不能替代用户授权。它只读取现有.env.local一次、建立一次TLS verify-full连接，在只读事务取得完整新鲜基线，生成48小时待审清单，不消费执行槽或写生产数据。预留最后2分钟，不以准备时刻启动云端时钟。

`RunReviewed` 要求准确 `--approved-sha`，先核对源码CI、文件元数据、目标身份及当前完整基线，再消费新永久执行槽，调用W8q原子事务。一次配置读取、一次连接；最多改旧任务三个状态/时间字段和新增一条独立审核挂起任务。不改部署、实例、订阅、配置、旧payload、控制账本、权限或AWS。原请求编译器的全部准入条件仍存在。

`Inspect` 是独立进程/连接的只读回读，需要同一准确清单和写槽/输出/意图绑定，另消费一次永久回读槽。它不调用写事务，区分“未应用”“两行已原子交接且历史保留”和“状态不明”。旧任务canceled、新任务pending不等于云部署成功。

所有输出使用新目录、write-once与链路校验；不覆盖旧记录或复位槽。写后必须冻结本清单源码，完成独立回读前不推进main。

## 读取与保护

固定配置文件内容可能含其他私密配置，整文件会进入进程内存；只使用DATABASE_URL并仅交给指纹匹配的Neon PostgreSQL TLS端点，不输出、落盘复制或提交凭据。不读取AWS Secret值或PEM，不签App token、不调用AWS/GitHub部署。

目标neondb/neondb_owner及OID/指纹沿用已安装绑定；不仅检查URL，还核对TLS、current_user/session_user/database、实际表权限、九个控制函数的准确正文/owner/SECURITY DEFINER/search_path/EXECUTE、控制角色隔离、唯一尝试约束及准确ALWAYS任务保护触发器。保护不符就停止，不GRANT、不改函数/触发器/约束。

完整业务基线包含准确deployment和outputs、同部署完整安全任务行、控制计划/批准/尝试，以及app/workspace/subscription/environment/资源/外部操作/模板/成功前序/管理员。任何活跃lease只返回拒绝信号，不把lease token读入进程。准备与写前摘要不一致即停止；事务仍逐项重新验证原始准入。

连接沿用空startup options，使用事务级READ ONLY及局部search_path，避免污染池化连接的会话默认值。每进程一次配置读取/连接、最多80个SQL调用，无自动连接/SQL重试。

## 完整执行风险（批准SHA时一并接受）

- 旧待审任务将永久收尾为canceled，新任务将成为唯一审核挂起请求；尽管原子提交，不会自动反向恢复或down migration。
- 业务写、认证/会话、提供者日志和网络风险；owner凭据在进程内存中具有比本次两行操作更广的能力。代码范围约束不是数据库新建的行级权限隔离。
- 源码/配置元数据和只读快照不是跨服务CAS。其他owner、DDL、权限或业务并发可能导致冲突、失败或回读不明；不保证消除竞态。
- 三个control表的SHARE锁会短暂阻塞该schema其他写入；原准入行锁及SERIALIZABLE也可能造成等待/死锁。锁超时1秒、语句15秒、事务工作预留30秒，超时停止不重试。
- 新行插入错误/返回0或提交前异常，事务回滚两行；若COMMIT提交后ACK丢失，不保证应用端知道是否提交。不再ROLLBACK/COMMIT/重跑，只做独立只读回读。
- 正式执行槽和独立回读槽均永久一次。认证失败或结果不明也可能留下已消费槽/输出，不能自动补齐、复位、删除、续期或重试；只能保留记录并取得新的明确方向。
- 现有AWS承载仍可能持续计费，50USD/月是目标非硬上限；此次不停止或清理资源。Neon查询也可能唤醒其免费compute，提供者规则/日志仍适用。

## 将来获批后的命令形式

下列仅为接口示例，不可用占位符执行，不是当前生产授权：

```powershell
node --experimental-strip-types ops/platform-request-v6/transfer-local.mjs --mode Prepare --ci-run <准确成功CI> --allow-config-read yes --output F:/ChatGPT_workshop/techlong-w8r-task-transfer-<本次标识>
node --experimental-strip-types ops/platform-request-v6/transfer-local.mjs --mode RunReviewed --manifest <本次manifest.json> --approved-sha <用户批准SHA> --output <同清单目录>-run
node --experimental-strip-types ops/platform-request-v6/transfer-local.mjs --mode Inspect --manifest <本次manifest.json> --approved-sha <同一批准SHA> --output <同清单目录>-inspect
```

准备的只读许可不包括RunReviewed或Inspect的后续配置读取/连接。具体生产批准须列明两行范围、两次配置读取/连接（执行及独立回读）、永久槽、完整风险。没有AWS窗口更新、Review重放、新grant、实际RunOnce或Cell创建授权。
