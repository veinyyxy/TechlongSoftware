# W4b 执行风险与固定边界（代码就绪，不代表已批准）

仅支持首次平台受控恢复：同一已初始化 sandbox 租户、同一 deployment、准确一条 W4 待审 job；最近成功前驱必须是 W3 `job_e4147af2f10faf37b51ec9a3` / 栈 UUID `74a79560-c981-11f1-bfcc-06ffde30f30d` / task definition:4。代码不会根据日期推断退役，也不会自动删除它；AWS 必须回读准确前驱 DELETE_COMPLETE、七资源删除、:4 INACTIVE，原 namespace/容量/监听优先级为空。

执行批准必须针对新鲜、完整的 W4 SHA，绑定原待审行、管理员来源、九行快照、代码与公开历史、真实 provider preflight、原角色/数据库/Secret 版本、两镜像和固定截止。仅有网页请求或“继续”不授权运行。Review/CheckSources 不写资源或读取原私密包；过期只读刷新，不重放旧清单。默认平台请求入口与全局 worker 仍关闭。

RunOnce 在五项永久槽 run/claim_job/create_workload/private_control_load/atomic_complete 前分别记录消费；同 requestId 跨清单不自动复位或重试。原地领取同一条 pending job（attempt/max=1、DB-clock lease），不 INSERT 新任务；随后最多一次 Source CreateStack，CloudFormation 建立七个承载子资源，0.5vCPU/1GiB、两小时固定 TTL。约20分钟 lease、一小时完成截止、15分钟审阅准入；原父 Cell 到期标签不续期。实际 IAM、DNS、DDB authority、Secret 与 Aurora 直接写入均0，不初始化、不设置商户密码、不调用 provision/POST；只读清单并不保证届时可准入。

原私密包最多读取一次，包内含本次不使用的 Stripe 秘钥，仍可能整体进入进程内存；不得把包、令牌、私钥或密码写入日志、提交或发送第三方。仅固定租户8443上的 readiness/control 两次 JWT/mTLS GET；应用 GET 自身可能读取数据库，不能声称底层绝无数据库活动。Source 不 GetSecretValue、不直接连接 Aurora、不发送支付请求。程序依赖原文件、AWS Login 自动刷新和本机网络；凭据过期、文件/权限漂移和提供者日志风险仍存在。

Neon claim、AWS 创建、私密读取、业务 GET 和最终 Neon 原子完成是跨服务**非原子**流程。并发、传播延迟、超时/提交 ACK 不明、磁盘失败、进程/配额中断可能留下 running job、收费栈/任务、未记录的 ACK 或已提交结果；完整行 CAS/lease 不能锁住 AWS 或消除跨服务竞态。不自动撤销已成功动作、不补齐、不回滚 SQL、不接管/延长 lease 或重试。CloudFormation 的 OnFailure=ROLLBACK 是它自身的回滚，可能删除部分子资源，不等于本地执行器补偿，且不保证清理成功。

最终只允许原子追加该 deployment 的新回执并完成同一 job，保留请求来源、旧成功 job/ready_at、实例、订阅、原 store 与数据库。独立 Inspect 重新读取结果并核对准确新 UUID/运行镜像；未知或已过期不报实时健康，Inspect 不修复、不写入。固定日志/提供者审计与 CT 既有公开风险仍适用。Janitor 已有但不保证准时删除，父 Cell/库保留；50 USD/月是目标而非硬cap，真实调用/残留资源可产生费用，不能保证零费用或绝对停费。

这不是持续无人值守队列或新客户首次开通。入口发布/激活、登记真实请求及实际资源执行均须按具体范围另批；新一轮成功后的再次恢复也不自动沿用此固定前驱的代码/批准。
