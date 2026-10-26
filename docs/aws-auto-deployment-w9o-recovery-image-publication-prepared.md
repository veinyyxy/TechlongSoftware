# W9o — 单次恢复镜像发布清单已准备（未执行）

本轮经用户明确允许，仅提交新适配代码/受保护工作流并运行无AWS身份自检；另一次限定只读预检也已获准。没有安装Grant、dispatch、发布ECR或部署ECS。

## 已完成证据

- 冻结 reusable `9b26b7c7d16929d50c0e14e05d92f1e7fe40eb75`，准确自检 run `40345578484`（contracts job121651487335/9步、exact-image job121651908083/8步），push/attempt1，所有步骤成功。
- 最终 Source 代码 `b29b984e4cc7f2bff185367389eb83995368e277`，准确自检 run `40346504910`（contracts job121654725976/10步、exact-image job121655205106/8步），push/attempt1，所有步骤成功。62项本地相关测试、lint与typecheck通过。云端重新下载/load原始W9n镜像并做三项禁网smoke/新鲜OS扫描，没有重新build镜像。
- 17项冻结发布依赖与reusable提交逐字匹配；37项操作源码/风险/配置pin再次核对。旧默认发布入口保留，新增范围仅为代码限定profile、准确新文件名对及独立槽；没有通用目标覆盖入口。
- 一次只读预检：STS1、AWS元数据15、AWS写0；GitHub准备GET11，加本轮CI诊断GET8，合计19（批准上限20），POST/dispatch0。准备模式代码拒绝任何写调用，并对读取设硬计数。
- 当前准确publisher RoleId、trust、inline、boundary、CFN模板/单资源、ECR仓库/两份旧镜像、OIDC及GitHub人类审批门禁全部通过既有严格校验。角色保持Locked，boundary不改，新tag尚未发布。Secret/PEM/.env读取、SQL连接和永久槽消费均为0。快照不是跨服务CAS。

## 待审清单

文件 `F:/ChatGPT_workshop/techlong-w9o-recovery-image-review-20261026-a.json`，准确原始字节SHA256：

`67782d1e0f5e2e4f661f9deef8214c74590d16c2b994d2a6a07667b036cba4eb`

清单有效至 **2026-10-28T15:13:49.633Z（温尼伯10月28日10:13:49）**，最晚开始 **2026-10-28T14:13:49.633Z（温尼伯09:13:49）**。这不是提前安装权限：最长一小时的实际Grant窗口只在RunReviewed启动时生成，且不能超过批准截止；原镜像artifact到期不延长。后续业务基础事实仍在 **2026-10-27T18:47:57.695Z** 截止，镜像清单不续其期限或授权业务执行。

唯一镜像仍为producer40340097784/artifact12658433499/config `sha256:23fbf299930cdd5883579d296adc40ff789d4acc9881587bbeb3a93f87a7ab90`。Registry manifest digest仍未知，只有批准后的真实ECR发布及原始manifest回读才能确定。

完整范围与风险见 [执行风险清单](aws-auto-deployment-w9o-recovery-image-publication-review.md)。批准范围应明确：现有单资源publisher栈最多两次UpdateStack（临时Grant与成功/失败后立即Revoke）、一次准确新caller调度、用户亲自批准environment、一次角色会话/顶层ECR push及独立Locked/registry核验；保留两份旧镜像，不改boundary、不新建IAM/Secret、不部署ECS或改数据库。

准备摘要 `ops/aws-sandbox/reviews/platform-recovery-image-v1.prepared.json` 记录准确CI、计数、两项原始文件摘要和W9n父证据；facts原文保留在清单同名 `.facts.json` 文件。源码/工作流提交不是实际云发布授权。

## 下一步与停止规则

等待用户确认上述准确SHA及完整风险，尚未运行以下命令：

```powershell
node --experimental-strip-types ops/platform-recovery-image-v1/source.mjs RunReviewed F:/ChatGPT_workshop/techlong-w9o-recovery-image-review-20261026-a.json 67782d1e0f5e2e4f661f9deef8214c74590d16c2b994d2a6a07667b036cba4eb
```

执行前还必须重新核对清单、clean main、pins、原artifact、Locked布局和准确远端HEAD。新永久槽 `F:/ChatGPT_workshop/techlong-recovery-image-v1.source.intent.json` 当前不存在；一经占用永久保留，不因新SHA、超时、未知ACK或失败而自动重放。旧所有发布/部署槽保留，不重做。凭据失败且无写入时保存现场，按实际状态另行处理，不能自动重跑原失败命令。

实际发布成功或失败后立即进入唯一Revoke尝试与独立回读；若不能证明Locked，明确报告并停在待处置状态，不假装撤权、不自行补权或重试。清单没有授权删除镜像、停止旧承载、租约续期或业务部署；旧承载仍可能持续计费。F3c9和UI支线继续停止。
