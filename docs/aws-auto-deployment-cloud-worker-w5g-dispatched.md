# W5g 已单次调度：等待准确运行的人工环境批准

2026-10-18，America/Winnipeg。用户明确确认清单 `a44dfaffdd0e5227ad7ed5571be6879f1b50a65e777de87697386979bce81f3d` 后，在时效内重新只读核对，通过116源码/历史和准确资源门禁，单次 dispatch 获得包含 run ID 的成功 ACK。07:09:20.380 CDT 永久消费新槽；没有自动重试或环境批准。[机器证据](../ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.dispatched.json) / [批准范围与完整风险](aws-auto-deployment-cloud-worker-w5g-verify-install.md)。

准确运行：[39126114772](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39126114772)，workflow `388188162`，attempt 1，head `90693a83ae0b2c35c43a08401c51c58c6fd92ada`。另起进程首次 Inspect 已核对 run/head/actor/manual event/attempt，状态 `waiting`。这只是当时快照，尚未取得云端 OIDC/固定数据库 Secret/只读catalog 成功证明，不能把它称为验收成功或提前记录最终读取计数。

## 唯一下一动作

用户打开上述准确链接，点击 **Review deployments**，选择 **techlong-sandbox-deploy**，只批准本次运行。不要点击 Run workflow 或 Re-run；不要新建第二次调度。控制器不会代替用户调用环境批准 API。

获知环境已批准后，只运行新的只读 Inspect：

```powershell
node --experimental-strip-types ops/cloud-worker/verify-install-v5.mjs --mode Inspect --dispatch-directory F:/ChatGPT_workshop/techlong-w5g-dispatch-20261018-a --output F:/ChatGPT_workshop/techlong-w5g-inspect-20261018-b
```

该命令从已保存 ACK绑定准确 run，不会再 dispatch 或再次触发云端 Secret读取。若仍 waiting/running，只读等待；若失败，不 rerun/补齐/自动处置；若 success，还需提取和核对唯一公开 proof，不能仅看绿色状态。原始日志不保存，不输出签名下载地址/凭据。若后续只读目录 `b` 已存在，换一个新 Inspect 输出目录，不重放写入口。

Review 原件：`F:/ChatGPT_workshop/techlong-w5g-review-20261018-a`；dispatch/ACK/intent 原件：`F:/ChatGPT_workshop/techlong-w5g-dispatch-20261018-a`；首次 Inspect：`F:/ChatGPT_workshop/techlong-w5g-inspect-20261018-a`。新永久槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-verify-install-v1.permanent-slot.json` 和旧四槽全部保留。文档收尾提交可推进 main，但已经排队的 run/head 与批准仍固定旧 head，不能用新的 main SHA替换验收对象。

本地控制器 Secret值读取0、环境批准0；云端实际读取计数留待运行结果证明。没有授权新 IAM、资源部署、应用业务操作、旧TTL续期或成功job重用。50 USD/月仍为目标非硬cap，排队/读取/已有资源仍有费用与日志风险。
