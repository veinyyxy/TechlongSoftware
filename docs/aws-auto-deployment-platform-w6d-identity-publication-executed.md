# W6d：身份工作流已发布并独立核验，尚未调度

2026-10-19 14:16（温尼伯）。用户确认清单 `cf521abb72153a096fc00efff3badc7515e9503e57ad6043d2f35c737facfa40` 后，准确执行一次仅发布入口。结果为 `IDENTITY_WORKFLOW_PUBLISHED_REQUIRES_INDEPENDENT_INSPECT`，随后另行只读Inspect为 `IDENTITY_PUBLICATION_INDEPENDENTLY_VERIFIED_NO_DISPATCH`，没有失败或重试。

## 已完成事实

- 一次非强制push：父commit `cd25ac7d1e958b26d963ef3431c2fe0e86a89560` → 发布commit `f1318ad8a50dd4b1f6f60714283503131ddc1d4b`，只新增 `.github/workflows/platform-controller-identity-v6.yml`。
- GitHub注册的真实workflow ID为 **389772013**，状态active、路径正确。[身份工作流](https://github.com/veinyyxy/TechlongSoftware/actions/workflows/platform-controller-identity-v6.yml)。active表示已注册，不表示执行过或App身份验收通过。
- 准确blob `4fb6626ca37730e8606abe3ae0d06000d015dcce`、1682字节LF文本、SHA256 `ffac70244e455a547b498fc233a9a17fa5b0c022ab598c5b9735c83436007dea` 独立回读匹配。运行代码仍冻结为 `ca2b38d8c756dd8fb800a88ded596c93687f278f`。
- 本地main已ff-only到准确发布commit；独立Inspect时本地和远端一致。此后仅按已有授权提交本次结果文档，不改工作流内容；后续真实调度必须绑定当时fresh main SHA，不能错误地把发布commit当成永远不变的dispatch head。
- 永久槽 `F:/ChatGPT_workshop/techlong-w6d-identity-publication.intent.json` 已消费，push和本地快进ACK均保存；不自动删除、复位或重放。

没有读取App PEM、mint App token、调度工作流、代批环境，AWS/SQL调用和trust/IAM/Secret/环境设置变更均为0。原个人V5部署入口、旧闭包与旧槽保持。服务端应用和用户未跟踪 `.vscode/settings.json` 不动。平台控制器仍 `UNPUBLISHED`，未获得端到端自动部署验收。

原准确CI39278613827已通过的16步骤与12组临时PG证明沿用原核验，未重新跑CI、日志或105项测试。执行使用的发布入口仍为已经通过8项定向检查的原版本，未在批准后修改源码或清单。

## 证据与最小继续点

[结构化发布证据](../ops/aws-sandbox/reviews/platform-identity-v6.executed.json)记录原清单、永久槽、push ACK、发布回读、本地ACK和独立Inspect共7份本地原件的raw SHA256。原批准使用canonical清单SHA；它与manifest文件raw SHA是不同算法输入，不混淆。原件在 `F:/ChatGPT_workshop/techlong-w6d-identity-20261019-a*`，保留旧准备快照和本次运行，不改原回执。

**下一步只实现/准备一次无AWS App实际身份验收的专用入口与清单**：绑定上述真实workflow ID、准确发布文件摘要、当时fresh caller main SHA、冻结代码SHA、新公开nonce和独立永久槽。不能直接套用旧云工作流调度器，也不能复用已经占用的只读认证槽。

实际一次固定PEM读取、最小Actions-write installation token、唯一identity dispatch及finally撤销仍须新清单单独批准；人工environment批准保留，由用户完成。准确run ACK后，只读比对run/actor/sender/nonce/caller/source/artifact才能标记实测App身份。未取得这些事实前，不扩大到SQL安装、App AWS trust、部署工作流或新业务任务执行。

本次批准至此执行完毕，不继续读取私钥或自动调度。发布工作流是长期仓库对象；费用、并发、Git凭据、网络不明和不可重放等既有风险见[原完整风险清单](aws-auto-deployment-platform-w6d-identity-publication-review.md)。
