# W9p 实际结果：承载更新通过，业务 Review 尚未登记

2026-10-26，用户明确确认清单 `388237d9a250a65f8597eb83caf5a2e85fbe467d60a76b245413af11b8dcae23`、完整风险及40分钟在线配合。实际执行源码为 `806bc2e2e17d6e4097805bae39f3fa1a4ac72bab`，本轮生产流程期间保持冻结。

## 已完成的实际更新

对既有栈 `techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7` 仅提交一次UpdateStack，ACK的SDK attempts为1。更新意图为 `2026-10-26T19:37:39.259Z`，准确request token为 `recovery-hosting-70b07619236eac11e5dc84d01fe34f3b`；正常CloudFormation替代资源及旧revision清理属于原批准范围。

CloudFormation达到UPDATE_COMPLETE。原11项逻辑资源保持，TaskDefinition由`:8`替换为`:9`，其他10项物理身份不变；单任务512CPU/1024MiB、原角色、三个Secret固定版本、网络/证书/DNS/日志保持。新镜像仍为已发布digest `sha256:71e268934bb1dbe8220f33cf68757cd48d74c89be35269ba583f6dd1b712e75a`，没有再build/push。ECS启动涉及原批准的托管Secret重注入；代理未读取Secret值、PEM或本地配置内容。

原执行结果为`RECOVERY_HOSTING_METADATA_VERIFIED_ACCEPTANCE_PENDING`，实际STS1/元数据110/写1。另起独立进程结果为`RECOVERY_HOSTING_INDEPENDENTLY_VERIFIED_ACCEPTANCE_PENDING`，实际STS1/元数据40/写0；准确事件token、新revision、镜像、source/lease、服务/ALB健康、DNS和授权布局全部通过。

30分钟控制租约为19:37:39.259Z–20:07:39.259Z（温尼伯14:37:39–15:07:39），未延长。原HostingExpiresAt历史标签保持，既不是本次续费期限，也不会自动停止Web、资源或费用。50USD/月仍非硬上限。hosting及独立Inspect槽已永久消费，不能重跑或复位。

## 尚未完成的 Review 与只读诊断

用户随后单独批准仅登记Review的operator SHA `2c3df1762adf9b48879d80d9f0178f0f1c9beb125618e7ff0769425d9ad77e21`。它在PREFLIGHT返回`RECOVERY_V1_OLD_ROWS_CHANGED`：配置读取1、TLS连接2、查询23、STS1、S3 GET0，**SQL写0、claimed=false、槽未消费、dispatch0**，没有领取任务或执行RunOnce。未自动重试。

另获一次只读诊断许可后，实际配置读取1、验证TLS连接1、查询11、所有写0。保存实际快照和字段差异后，结果确认deployment、旧jobs、ledger完全相等，仅`protection.catalogSha256`及`protection.triggersSha256`不同；不把它说成真实业务漂移。

静态比较发现：原`openTransferDatabase`及`readTransferredSnapshot`都会先执行事务内`SET LOCAL search_path=pg_catalog`，新launch snapshot入口遗漏了它。对象定义的表示环境因此未保持一致。此次只修复这个明确缺口，并测试BEGIN→SET LOCAL→读取→COMMIT的顺序，以及设置/读取失败时仅ROLLBACK、不回退或重试；**没有重算、替换或放宽保护基准**。摘要差异是否全部由此造成，尚待新的明确许可，在一致设置下重新只读核验；不能用本地测试冒充生产证明。

## 本轮关闭与唯一继续点

当前窗口已不足Review启动所需15分钟预留。本轮生产流程在未登记任何Review计划、未调度任何workflow的状态下明确关闭，用户只批准最小兼容代码修复/测试/文档和正常推送，不再生产读取、写入或重试，不续租。该代码提交不应用于本窗口；原成功承载继续运行，清理另审。

原执行和独立核验文件保存在本地私有证据目录，业务快照和配置不提交Git。下一阶段先在另批限定只读条件下确认保护指纹一致，再根据实际已更新承载准备新的继续清单。不得重放上述旧SHA、重用已消费hosting槽、自动新建任务或扩展F3c9/UI/IAM支线。本记录不等于完整自动部署或整套系统上线已验收。
