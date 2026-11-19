# Sandbox Checkout 修复：只构建一次无 AWS 候选

[构建审批材料](evidence/sandbox-first-purchase-checkout-repair-build.review.json)只涉及一个固定修复。沿用已上线的 Dahlia 源码树，在 19 文件 overlay 中仅替换[已锁定的三个文件](evidence/sandbox-first-purchase-checkout-repair.prepared.json)。现有专用 GitHub 工作流已加入这一条准确 recipe；原两条 recipe、旧产物、通用托管检查和 ECR 发布入口未改。离线归档已实际得到预期源码树 `88749946405674d03892e241bbfc6f6153caa88c`。本材料尚未获批或调度。

本次批准只允许：

1. 用现有 Git 凭据认证，仅进内存；对同一 GitHub 仓库有限只读核对 `main`、工作流和准确运行。构建接线须为本清单绑定的提交，之后只允许本清单列出的审批文档改动，实际输入 `orchestration_sha` 必须等于所核对的 `main` 头。
2. 没有冲突运行且在窗口内，仅向现有 `sandbox-registration-candidate-v1.yml` 调度一次，输入本清单的唯一 recipe 和准确 `orchestration_sha`；只认可原 attempt 1。候选为单个 `linux/amd64` 镜像、单 job 最多 25 分钟，镜像只在 GitHub runner 内构建和运行，模拟支付回调容器禁网，普通 worker、部署控制器和 AWS apply 均关闭。执行原高危／严重漏洞门禁及候选压缩包封签，仅在 GitHub 保留产物三天。
3. 只观察这一次，最多 35 分钟；最多 40 次固定范围 GitHub API GET（含读取单个候选 job 的日志），另允许一次精确的 GitHub 签名日志 GET、上限 2 MiB，不保存或显示签名 URL 或日志正文。只提取原 run、attempt、各步骤、唯一 artifact ID 及大小和摘要，和 seal 输出的源码树、压缩包哈希／大小、镜像 config digest、扫描与模拟验证结果；本次不下载镜像 ZIP。任何缺项、漂移、提交不明或失败即停，不重发 dispatch 或点 Re-run。

没有 AWS 身份、ECR 登录或推送、生产配置／密钥读取、Stripe 或 Neon 请求、平台更新、SQL 或原会话关联。该构建不用 GitHub environment 审批，不授权后续 ECR 或任何上线。GitHub runner、产物存储、网络和提供者日志可能产生费用或留痕。最晚启动 **温尼伯 11 月 19 日 01:08:41**，原会话到期不延；此轮构建不能证明会话当前有效。成功后才把真实候选绑定到[上线与关联集中审批](aws-sandbox-first-purchase-checkout-repair-review.md)。
