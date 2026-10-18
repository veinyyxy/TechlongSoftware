# W5i-R1：修正外部调度参数，仅准备一次新的 Review

2026-10-18。用户确认 `dcff130a…` 后，本机确实只提交了一次GitHub dispatch，返回HTTP 422、没有run ID；未重发。随后独立3个GitHub只读GET和2笔Neon只读事务确认：部署工作流仍只有旧成功run `39126114772`，**没有新运行**，准确job `job_ecbf09030d3da7286ea3ef93`仍pending，原完整job/九行/全部job摘要不变。无AWS写、Secret值读取、job领取或部署。见[失败记录](../ops/aws-sandbox/reviews/cloud-worker-w5i-dispatch.stopped.json)。

## 缺陷与修正

本机复用了runtime八字段验证器，却把其中 `installationSha` 也传给外部workflow_dispatch。实际已安装caller只声明七个输入，该SHA已经由caller以固定literal传给reusable。原单元测试只检查runtime形状，遗漏真实外部输入合同；不是用户操作或权限刷新问题。提供者具体422响应体未保存，因此不能声称唯一拒绝原因已由响应正文证明；**本地与远端定义不匹配已明确证明并修正**。

修正仅在本机入口：先验证完整runtime输入，再去掉外部不接受的installationSha；新增直接解析真实已安装workflow的Review/RunOnce/Inspect合同回归，拒绝多余输入或固定SHA变更，在线preflight也解析远端实际定义。原116pins、76文件云闭包、两工作流、OIDC/IAM/Secret/数据库均不改。

## 新审批范围与完整风险

此前准确批准的POST尝试已用掉，**不能沿用旧SHA再发**。旧Review-v1永久槽、原批准/intent/只读回执/失败证明都保留，不删除、复位或更改。新待审manifest显式绑定**唯一新独立Review-v2槽**；Prepare不消费它，只有用户新SHA批准后才能进行一次新POST，任何结果仍不自动重试。RunOnce/Inspect槽仍是各自v1，不提前消费或授权。

新的业务/云范围与[原W5i完整风险](aws-auto-deployment-cloud-worker-w5i-job-dispatch.md)相同：只对准确job运行Review，用户人工批准environment、固定DB Secret版本读取一次、窄角色catalog/read_state及真实AWS前置只读核验，全部通过后私有S3条件写一份包含业务/队列快照的不可变manifest。不领取job、不读control Secret、不写DDB/业务、不调用CreateStack或应用GET，不改IAM，不创建付费Cell。Review本身含S3写，非绝对零费用。

仍接受私有业务信息保存于S3/F盘及提供者/本机管理员日志可见、权限能力存在、GitHub/AWS/Neon/本机非原子、main未保护/并发非CAS、槽消费后无完整效果、凭据/人工批准可能过期、非零费用和不自动回滚/补齐/删除/复位/重试风险。50 USD/月是目标非硬cap。不要把“无新run”的只读事实扩大为未来请求一定成功或完全无费用。

本次实际没有云Review生成manifest，故现在可提交本机修正；**下一次真实Review调度后冻结新caller main**，后续RunOnce及不同run的Inspect仍各自fresh批准、同caller SHA，沿用原15分钟claimBy/一小时job deadline/两小时child TTL，不重盖时间，不续父Cell TTL。

## 继续命令

本机13项（含直接解析真实workflow输入）及原17项根/VerifyInstall回归共30项通过，类型检查、定向lint零警告通过。116旧pins及76云闭包SHA保持，没有真实重发作为“测试”。

入口不变：`node --experimental-strip-types ops/cloud-worker/job-dispatch-local-v5.mjs`。全部代码提交/推送后只读Prepare到全新 `F:/ChatGPT_workshop/techlong-w5i-recovery-review-20261018-a`；请新SHA批准后Dispatch到全新 `techlong-w5i-recovery-dispatch-20261018-a`。不会自动执行Dispatch。后续Observe/RunOnce/Inspect参数和原文档一致，不使用失败目录作为成功run引用。

失败原件 `F:/ChatGPT_workshop/techlong-w5i-dispatch-stopped-independent-20261018-a.json` raw SHA `38e928bcde4bfa252bc62b50510f0eef02d75334ace81c134b701c7a93ad58f5`，包含5原件/旧槽摘要。新source history强制校验它们，任何原件/槽变化即停止。
