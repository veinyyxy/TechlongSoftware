# Checkout 修复：发布器预检单点修正后的接续审批

**待批准，未执行。** 仅接续[原合并清单](evidence/sandbox-first-purchase-checkout-repair-rollout.review.json)的同一轮业务目标。[接续清单](evidence/sandbox-first-purchase-checkout-repair-revoke-continuation.review.json)绑定新的单次入口和证据。原尝试 `d4ead3f7…` 在首次写入前停止：无 Grant、受保护调度、ECR 发布、Hosting 变更或 Neon 写入；不重放、不删改旧记录。

唯一逻辑修正是发布器预检：从上次留存的准确发布输入重建已经独立核验的 **Revoke**，并固定该模板摘要。仍用既有 CloudFormation 模板、RoleId、trust、inline、boundary、仓库与 OIDC 的完整核对，不放宽任何一项。回归证明 Revoke 通过、初装模板及残留 Allow 均拒绝。候选 `14491468132`、发布工作流、一次性 OIDC 及撤权逻辑、平台更新和数据库事务均不改；复用原 [发布 CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44444287971) 和 [PG18 回归](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44444287959)，不重建镜像。

批准后才在新单次记录中按原边界执行：现场只读重核原平台、同一开放未付 Stripe 测试会话和同一草稿订单 → 原发布器一次临时 Grant、你本人批准准确 GitHub environment、单次 ECR 发布并立即 Revoke，独立核对 Locked 和新镜像 → 原 Hosting 只换镜像并技术核验 → 同一 Neon 事务仅替换 `attach`、关联原订单／原会话并独立回读。任何必需条件不符则停止，不创建或付款、不重试购买、不启用 worker 或首开。

读取上限、写入上限、凭据使用方式及其网络／日志／非原子、停机与费用风险均[沿用原范围](aws-sandbox-first-purchase-checkout-repair-review.md)。新批准仅可启动一个独立的最多 95 分钟窗口；最晚启动仍为**温尼伯 11 月 19 日 17:21:57**，正常操作仍于 **18:56:57** 截止，原会话历史到期 **19:16:57**，不延长。原尝试已结束，不能重开；先前只读结果不用作新鲜事实。首次写入前重新核对，过期、漂移或提交不明就停止，不补齐、不重放；必要的单次撤权及其核验按原规则处理。
