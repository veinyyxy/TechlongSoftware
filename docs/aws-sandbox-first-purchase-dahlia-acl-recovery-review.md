# Sandbox 首开：ACL 修正后的剩余启用

[上次执行回执](evidence/sandbox-first-purchase-dahlia-continuation-stopped.json)已经独立证明镜像与发布器 Locked，Neon 安装停在提交前，未写 Secret 或更新平台。保留两轮旧批准、回执及所有已用槽。只用一个新的单次接续槽，不重新调度或重放旧命令。上线前的校验代码必须与 [PG18 回归通过的修复](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44429410826)相同；原安装 DDL、原角色权限目标、承载和工作区均不变。既有 Web 登录授权不增加、不撤销。

一次批准涵盖：

1. 复用上轮固定本机回执，先连接同一 Neon 做限定只读核对：两个安装角色和 `sandbox_first_purchase` schema 都不存在，原业务与安装基线仍匹配。任何对象残留或漂移立即停止，不删除、补齐或写入；安装事务开始后仍使用原入口再次核对。这一步不另开一次审批。
2. 保留原平台、固定 Secret 元数据及既有 Stripe 运行材料的前置检查，最多五次原范围的认证 GET，只校验 Sandbox 账户／测试模式及原 Dahlia 回调；不额外跑 Stripe 测试或修改回调。复用先前独立 Locked 回执，仅一次批量读取准确 ECR tag 的 manifest，要求原始 SHA 和 config digest 与已经核验的同一镜像完全一致。不重建、发布或重新授权，不读 GitHub 凭据，不 dispatch 或要求 GitHub 环境审批。
3. 上述门槛通过后，按[原启用范围](aws-sandbox-first-purchase-dahlia-continuation-review.md)只做一次原 Neon 安装事务及独立回读、固定 Secret 的创建／资源策略／固定版本，以及原 Access 和 Hosting 栈各一次准确 Change Set 创建和执行。原数据库、网络、域名、任务数、闭控和禁用 worker 保持不变。不恢复 Cell 或 Express，不替用户购买或实际开通租户。
4. 独立回读栈、运行镜像、健康、Secret 版本，匿名读取 `/api/health` 和 `/register` 各一次。通过后通知用户亲自测试购买。

范围上限：Source STS **4**、AWS 元数据 **201**、AWS 写入 **7**；配置一次、两份原有 Stripe 私密文件各一次进入内存，最多五次固定认证 GET，验证 TLS 的 Neon 连接最多三条／SQL 最多 76 条，包含一次安装事务。只核对既有工作区准入与套餐／版本，不导出业务记录、不读 AWS Secret 值或 PEM、不触发支付。首笔远程写入须在启动后十分钟内且前置通过；启动后最多 60 分钟，原最晚启动及硬截止不延长。

接受现有私用材料进入内存及托管注入、日志／网络、Neon 创建者 ADMIN、安装和云栈非原子、并发、滚动短时中断、CloudFormation 托管回滚及费用风险。异常或提交不明立即停车；可能留下已创建权限、Secret 或已更改的栈，不自动重试、补齐、回滚或清理。仅批准此新 SHA，不批准任何旧命令。
