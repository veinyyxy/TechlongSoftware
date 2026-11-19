# Sandbox 首开：发布完成后的单次接续

[运行 44425786946](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44425786946) 已成功。[固定回执](evidence/sandbox-first-purchase-dahlia-size-fix-activation-stopped.json)显示临时发布权限已撤回并回读为 Locked，随后本机 STS 子预算阻断了独立发布证明。Neon 安装、Secret 写入和平台更新尚未执行。保留旧批准、两份已用意图、已发布镜像和原截止时间；本次另用一个固定单次接续槽，不重跑旧命令。

本清单一次批准下列剩余工作：

1. 复核已保存的两个旧意图、三个固定回执，以及原范围的工作区、平台配置和窄权限目标。没有 GitHub API 请求或产物下载。在同一轮前置核对中，复用原两个 Stripe 私密文件和签名，校验既有 Sandbox 账户、测试模式、原 Dahlia 回调及五个事件；这些是最多五次固定 GET，不单独跑测试，不改 Stripe，不发测试事件或支付。
2. 用独立只读客户端回读原 publisher 栈、角色、边界、ECR 仓库和唯一已发布 tag；验证 Locked、四份保留镜像、不可变 tag、manifest 原始 SHA 和原封存 config digest。没有 Grant、Revoke、调度、重新批准 GitHub environment、推送或重建；没有通过则不开始安装。
3. 使用[原窄权限、Secret 和平台更新范围](aws-sandbox-first-purchase-dahlia-size-fix-activation-review.md)：仅在原 Neon 安装受限函数和角色，另连验证；同一固定名称 Secret 各一次 CreateSecret、PutResourcePolicy、PutSecretValue；原 Access 和 Hosting 各一次 CreateChangeSet 和 ExecuteChangeSet，只有准确差异通过才执行。保持旧 Web 不直接写业务表，原任务数量、域名、网络不变，部署控制器和 worker 关闭。不恢复 Cell／Express、不实际开通租户。
4. 独立核验两个栈、运行镜像 digest、健康和固定 Secret 版本，匿名 GET `/api/health`、`/register` 各一次。然后通知用户亲自测试购买。

批准上限：Source STS **5**，AWS 元数据 **217**（平台 200、发布核验 17；含原有有界轮询），7 次 AWS 写入，Stripe 私密文件各一次、认证 GET 最多 **5**，现有 `.env.local` 一次进入内存、3 条经验证 TLS 的 Neon 连接、最多 76 条 SQL、仅一次安装事务。没有读取 AWS Secret 正文、GitHub 凭据、PEM、Aurora 或业务支付内容。原两个私密文件和配置不输出；证据仅保留必要去敏投影。

实际启动起最多 **60 分钟**，原截止不延长。首次远程写入须在启动后 **10 分钟内**且独立核验通过。接受私用配置进内存及托管注入、日志／网络、Neon 创建者 ADMIN、跨服务非原子、并发、滚动短时中断、CloudFormation 托管回滚和持续费用风险；部分安装失败可能留资源，不自动回滚、补齐、清理或重试。只要核验失败或结果不明就停止，不能据此重跑。
