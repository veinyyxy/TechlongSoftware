# W5q RunOnce 失败事实（保留，不能重放）

2026-10-18，America/Winnipeg。云 Review `39173977158` 已成功且私有 manifest 独立重构；后续 RunOnce `39174947831` / attempt 1 completed/failure。冻结 caller `1b6aafb36130658d79118a189ab61a22cad59301`，执行批准 SHA `4302b81708d0c919e5fdf75ce17253580f8b63b5b9424ab312b86e3950607655`。

原 claimBy 为 **18:10:29.859 CDT**，GitHub job 于 **18:13:03** 才开始，实际 runtime 步骤为 **18:13:22–18:13:24**。在该开始时间对原 manifest 重放纯时间门禁得到 `INITIALIZED_W3_REVIEW_EXPIRED_NO_WRITE`。原云日志只保存安全 sentinel，未记录详细异常；不能称为唯一原异常证明，也不能据此区分人工批准与排队延迟，不归责于用户。

18:16:51 CDT 独立只读核对：原 job pending/attempt0/无 lease；job、九行业务、四 job 队列及 requester 摘要保持；准确 DDB 五动作槽事务快照全空；准确栈名不存在、ECS 服务 MISSING；本次 run 私有 S3 前缀版本/删除标记完整为空。证据支持部署前停止，不等于全账号停费或绝对无 API 调用；初次 CloudTrail 空列表可能有入库延迟。

Review-v5 和本机 RunOnce-v4 槽永久保留。没有成功执行报告，不运行成功后云 Inspect，不复位/补偿/重试、重盖 claimBy 或重跑旧 run。原成功 Review 仍是历史成功，不能据此部署过期计划。原始私有 manifest/快照/日志/签名 URL 不提交公开仓库。

完整脱敏指针见[机器记录](../ops/aws-sandbox/reviews/cloud-worker-w5q-runonce.stopped.json)。F 检查点 raw SHA `aa121edda3a2158297b90c9c181edf90d152d04063e4c97ed2212e86f61b2b35`；独立状态证明 raw SHA `2fdc7ad4a243606e38cec4920363a7601d02e615e4f73c8dd5ba316d880b5906`。

用户另行同意后，W5r 只改善本机衔接并准备一轮新的独立槽/清单，不改 IAM、云 C/R、部署工作流或原云 15 分钟规则。[W5r 范围和完整风险](aws-auto-deployment-cloud-worker-w5r-approval-handoff.md)。实际新 Review/RunOnce 均需 fresh SHA 和人工环境批准。
