# W6d：无AWS App身份发布草稿（CI门禁未通过，不可执行）

2026-10-19。本阶段未重做W6c实现、未重跑105项测试、未新建CI；先只读回读准确运行，再将已实现的身份renderer固化为待审文件。**这不是可批准执行的清单，没有有效action SHA或执行命令。**

## 当前门禁事实

准确源码 `ca2b38d8c756dd8fb800a88ded596c93687f278f` 的[CI39278613827](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39278613827)元数据仍queued；job118148719175的runner_id/runner_name均null、步骤0。独立check-run也queued，摘要为空、注释0。用户UI仅显示candidate和“Started 11m 17s ago”，没有提供用量/账单/审批提示；pending environment回读为0。没有足够证据判断原因，不猜测为额度、设置或MFA问题。

随后已独立读取**准确最终job日志**：15:31:48 UTC输出 `PASSED_REAL_POSTGRESQL_18`（9组），15:31:49输出 `PASSED_REAL_PUBLISHER_POSTGRESQL_18`（3组）；15:32:10已记录post-job cleanup。SQL权限拒绝、占槽/重复键ERROR是成功测试中的预期负断言，不是这些检查失败。日志还确认旧62599bb首轮失败为缺少ELB SDK依赖，85cf9b3已做对应依赖修正；没有重新跑旧轮次。

但列表、单独check-run、准确attempt1及其jobs接口（含no-cache头）仍显示queued/无conclusion，run updated_at仍15:31:10；独立GitHub连接器也返回同一job queued、conclusion/steps为null。**目前证据不一致：12组真实PG检查可确认通过，整轮CI终态及全部步骤成功尚不能确认。** 不从空runner/steps推导从未执行，也不从PG日志越过整轮success门禁。无需用户再点按钮、提供凭据、刷新AWS、Run/Re-run、升级或改付费设置；不再自动取消、重排或新增候选轮次。

## 已固化的候选文件

草稿文件：`ops/platform-identity-review-v6/platform-controller-identity-v6.candidate.yml`；不在 `.github/workflows`，不会注册为可运行workflow。拟发布的唯一目标为 `.github/workflows/platform-controller-identity-v6.yml`，本阶段只读核对目标不存在，不创建/覆盖它。

候选由原W6c已测试的 `identityWorkflowV6` 渲染，冻结checkout为上述源码；normalized-LF SHA256为 `ffac70244e455a547b498fc233a9a17fa5b0c022ab598c5b9735c83436007dea`，LF文本1682字节。校验只比对公开文本/结构及Git源码，未调用身份程序、读取私钥、生成nonce/token或访问AWS/数据库。

候选仅接受manual dispatch的 `nonce`、`sourceCommit` 两参数，固定repo/owner/App bot actor、main及attempt1，5分钟job上限；Contents read，无id-token、AWS权限或Secrets传入。沿用现有 `techlong-sandbox-deploy` 人工环境批准，不改变reviewer或环境设置。输出一份公开白名单身份proof，artifact保留7天且不覆盖。

## 后续批准边界（本草稿不授权）

1. 原准确CI通过并独立核对12组临时PG证明后，刷新github/main父commit、目标不存在/候选digest与源码绑定，生成**只发布这一份manual身份workflow**的可执行清单并请fresh SHA批准；不自动dispatch，不读key，不改trust/IAM/SQL或收费资源。
2. 发布ACK后，另审真实workflow ID、发布后的caller main SHA和新公开nonce，才准备一次App调度/指定PEM读取/最小必需令牌及撤销的范围。原只读认证批准和永久槽不复用；不能从“准许提交代码”推导读key或任意Actions write授权。
3. 保留人工environment批准。准确run/nonce/caller SHA/冻结代码SHA/actor/sender及artifact摘要独立比对后，才记录实测App身份；不因CI、API公开bot资料或合成fixture而填成功。

未来发布会新增长期可调度的仓库工作流，配置本身不是一次性权限。实际dispatch创建Actions运行、GitHub环境deployment记录、日志和artifact，可能消耗Actions分钟/存储额度；无AWS不等于绝对零费用。App私钥仍具长期高权限，程序的单workflow白名单不能阻止凭据泄露后的仓库级Actions write滥用；未来另审内存/提供者日志、网络不明、令牌撤销失败和永久槽不自动复位/重试风险。不得为解除当前排队自行升级GitHub或增加付费runner。

本草稿没有父commit执行绑定、发布ACK、真实workflow ID、nonce或调度授权；不得复制到 `.github` 后直接运行。用户即使回复“确认草稿”，也不能绕过尚未成功的原CI或代替未来具体执行SHA批准。

## 最小继续位置

[结构化草稿](../ops/aws-sandbox/reviews/platform-identity-v6.draft.json)保留唯一run和准确日志证明。后续**只读查准确CI/attempt的终态**，不重复读取已保存的PG日志、不重复实现/测试、不为排队改CI或生成可执行批准SHA。确认准确success后，直接使用已固化候选准备最终发布清单，不再重新设计身份方案；当前没有额外用户动作。

回到[W6c候选与风险](aws-auto-deployment-platform-w6c-cloud-candidate.md)。
