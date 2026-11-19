# Sandbox「订阅与账单」500：单次上线接续审批

只修复已登录用户的账单页，并让原工作区 Owner 在会话仍开放、未付款且未到期时继续**原** Stripe 测试会话。复用 [已封签的 build run 44450853247](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44450853247) 原 attempt 1 的唯一 artifact `14495028924`，不再构建。不重放 [原 7112a253… 清单](evidence/sandbox-first-purchase-billing-rollout.review.json) 或其 [停止记录](evidence/sandbox-first-purchase-billing-candidate.stopped.json)。本次 [接续清单](evidence/sandbox-first-purchase-billing-continuation.review.json) 未获批准，不是执行许可。

## 一份审批内的顺序

1. 将本机两个固定提交非强制快进到原 GitHub `main`：先发布不可变 reusable `89230b2628d9719157f0a79d7ab27e5a1c091728`，再发布唯一 caller `1b6c9680c9ba42ca07b128aaa0f94c7eba8984e1`。两次推送只启用对应无 AWS 身份的发布检查与隔离 PostgreSQL 18 回归，不是再造镜像。不自动重推、重跑；任何身份、分支、CI、证据或原时限不匹配就停。
2. 在合并范围内一次核对原托管 revision 16、已验证的原发布器 Locked 基线、候选、Neon 现有五个函数及原订单。在原 Stripe 测试账户对**原会话**仅做一次认证 GET，确认原订单、金额、币种、不含付款意图且会话仍可继续；不做购买测试。前置任何不符不写云或数据库。
3. 仅一次临时 Grant、一次受保护发布调度。用户亲自批准准确 run 的 `techlong-sandbox-deploy`，不点 Run workflow 或 Re-run。工作流从原 run 下载唯一封存 ZIP 一次，按原封签核对摘要、确切字节、源码、镜像配置和扫描；只发布到 `ca-central-1` 的 `techlong-sandbox-platform-web:sandbox-first-purchase-billing-1f01d6a8`。发布成功、失败或结果不明均按已验证模板撤权并独立核验 Locked；只有发布 digest 和撤权都核实，才继续数据库步骤。
4. Neon 一次事务创建唯一的 `sandbox_first_purchase.read_billing_order(text,text)`，使用原 definer，临时 SET 权限提交前撤掉；仅 Web 角色新增函数 EXECUTE。用独立只读 TLS 连接核对函数体、Owner、ACL、原五函数和原订单状态不变。不是只读部署事务：它会安装函数，但不改业务数据、不增加角色及整表读取、不给 PUBLIC 或 webhook EXECUTE。
5. 仅替换原 Sandbox 平台镜像为已验证 digest；CloudFormation 最多创建、执行各一次经严格核对的变更集，允许 TaskDefinition 替换、Service 原地更新及两处镜像来源元数据差异。用独立回读核对 ECS/CloudFormation 和两次匿名技术 GET；控制器及 worker 继续关闭。用户之后可自行打开账单页，工程侧不登录、不创建会话、不测试购买。

## 边界与停止条件

- 原窗口不延：最晚启动 **2026-11-19 17:21:57**，常规动作最晚 **18:56:57**，原 Stripe 会话历史到期 **19:16:57**（均为温尼伯 CST）。会话实际状态以本次经批准的限定核验为准；只允许既有撤权安全动作越过正常操作截止。产物原截止 **2026-11-22 03:22:51 UTC**，不是执行期限。
- 本机最多 Git 凭据读取 1 次、GitHub API GET 120 次、非强制源码推送 2 次、受保护 dispatch 1 次；不再读构建日志、不另行下载产物。Source 最多 STS 8 次、AWS 元数据 260 次；工作流内最多 GitHub API GET 3 次、封存 ZIP 下载 1 次、OIDC 会话 1 次、ECR 元数据 3 次。保持原清单的 Grant/Revoke/ECR push 各 1 次、Hosting 变更集创建与执行各 1 次、匿名技术 GET 2 次上限。
- 原 Stripe 测试配置和 Neon 本机配置各读取一次、只在内存使用。只对官方 Stripe 发送原会话认证 GET 一次；Neon 上限为 3 条验证 TLS 的连接、60 次 SQL、1 条新增函数的 DDL 事务。无 AWS Secret 值、PEM 读取；不开 Cell、Express 或全队列，不改 Stripe、重试购买、新建会话、改业务数据或扩大角色权限。
- 跨 GitHub、AWS、Neon 非原子，仍有并发、锁、日志、网络和非零费用风险。推送、CloudFormation、ECR 或 SQL 提交结果不明，不复位永久槽、不重试、不自动补齐或清理；授予已尝试时仍保留一次立即撤权。函数可能已提交而平台仍是旧镜像；平台更新只沿用既有 CloudFormation 托管回滚，不另起回滚。只在独立部署核验通过后通知用户；过期不创建替代订单或会话。
