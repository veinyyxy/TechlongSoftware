# W6d：无AWS App身份发布草稿（CI门禁未通过，不可执行）

2026-10-19。本阶段未重做W6c实现、未重跑105项测试、未新建CI；先只读回读准确运行，再将已实现的身份renderer固化为待审文件。**这不是可批准执行的清单，没有有效action SHA或执行命令。**

## 当前门禁事实

准确源码 `ca2b38d8c756dd8fb800a88ded596c93687f278f` 的[CI39278613827](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39278613827)仍queued；job118148719175的runner_id/runner_name均null、步骤0。独立check-run也queued，摘要为空、注释0。尚无代码失败结果，也没有足够证据判断排队是否由容量、账户额度或设置导致，不猜测原因。

原真实PG导入/云端构建仍未验证，不把本机105项通过冒充云结果。已请用户只看该页面有无用量/账单/审批/runner提示，不提供凭据、不Run/Re-run、不升级或改付费设置。原CI与旧失败/取消未确认记录保持，不再自动取消、重排或新增候选轮次。

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

[结构化草稿](../ops/aws-sandbox/reviews/platform-identity-v6.draft.json)保留唯一run和全部阻断项。后续只读查CI39278613827，或核对用户提供的页面提示；CI未通过时不重复实现/测试，不生成可执行批准SHA。通过后直接使用已固化候选准备最终发布清单，不再重新设计身份方案。

回到[W6c候选与风险](aws-auto-deployment-platform-w6c-cloud-candidate.md)。
