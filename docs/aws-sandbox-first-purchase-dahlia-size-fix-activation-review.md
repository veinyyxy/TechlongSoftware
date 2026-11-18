# Sandbox 首开：复用同一产物的单次启用

本次是新的一次性审批，不继承旧批准、重跑旧 GitHub run 或复位旧槽。[旧运行回执](evidence/sandbox-first-purchase-dahlia-activation-stopped.json)证明旧发布在产物校验阶段停止：AWS 发布会话和推送均跳过，临时权限已经撤回并独立回读为 Locked，未安装权限或更新平台。执行前核对两份保留的旧意图和原停止回执；新启用与发布使用两个固定的新槽，失败不重试。

保持[原启用目标、权限、调用上限和风险](aws-sandbox-first-purchase-dahlia-activation-review.md)；具体差异是发布入口绑定到 [已通过无 AWS CI 的修复版](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44423446449)，复用原产物 `14480476839`。要求镜像包 **307,792,511 字节**精确匹配，原 ZIP 大小、哈希、成员、安全检查及禁网自检／新鲜扫描均保留。原产物于 **2026-11-21 17:09:39（温尼伯）** 到期，不重建、不延长。

一次批准覆盖：

1. 执行时做原范围现状核对：固定目标、发布器 Locked、原镜像保留、目标 tag 不存在、Neon 与平台基线。现有 Stripe 测试回调、五个事件和签名只在原启用前置步骤内核对，不另跑 Stripe 测试，不创建回调或付款。
2. 原发布栈至多一次临时 Grant，单次调度原受保护工作流；由用户本人批准该次 `techlong-sandbox-deploy`。只下载上述固定包并向原 ECR 发布一次。Grant 可能提交后无论成败立即尝试一次 Revoke；只有独立证明 Locked 且 ECR manifest／config digest 匹配才能继续。
3. 使用原范围在 Neon 原子安装窄权限、安装同名预审新 Secret 的一个固定版本；严格按原 Access 和 Hosting 栈各一份 Change Set 更新准确的权限、镜像和配置引用。保持现有 Web 不直接写业务表、原数据库／网络／域名和任务数、控制器及 worker 关闭。不恢复 Cell／Express，不实际开通租户。
4. 独立技术核验栈、运行镜像、健康和固定引用。通过后通知用户亲自做测试购买；不会代购。

实际启动后最多 95 分钟，首笔远程写入须在 10 分钟内且所有前置检查通过；以新清单的准确时刻为准。承接受控凭据进内存／托管注入、网络／日志、Neon 创建者 ADMIN、非原子及并发、滚动期间短时中断、CloudFormation 托管回滚和持续费用风险。可能留下已发布镜像、权限、Secret 或栈更新；除一次必要撤权外，不自动补齐、回滚、清理或重试未知提交。
