# W8k 空策略兼容修复及新的恢复审核材料

## 已发生的事实

用户批准`ce3bb28d8b13324941aec15266f93d5f2d66bdb5d904b1094481c244041cdac6`后，原源码`02bc4c26a22e4e81141e7426f521e4bb0a51fe6f`的RunReviewed在元数据阶段停止，返回`HOSTED_WINDOW_METADATA_UNAVAILABLE`。输出目录`F:/ChatGPT_workshop/techlong-w8k-window-20261023-a-run`仅有approved-manifest及review-prerequisite。

未创建update-intent/ack，未提交UpdateStack、未开启控制窗口、未消费两个W8k槽。原失败目录、旧清单及所有W8j已消费槽全部保留，不自动重放、覆盖、复位或换槽。停止证据`F:/ChatGPT_workshop/techlong-platform-w8k-prewrite-stop-20261023-a.json`，文件SHA `ea2ddea9054a2a580bf434753728358291bb3caa0968cebca03e9957014f73bc`。

另一次限定只读GetStackPolicy诊断：CLI退出0、stdout为0字节。现有栈没有永久策略时，成功的空响应被`JSON.parse('')`误判为失败。该阻断点已经复现，不应据此要求用户刷新AWS身份。初次失败命令没有逐条持久化读计数，不能声称完整快照已通过或所有读取均完成。

## 本轮仅两项代码变更

1. `ops/platform-hosted-window-v6/cloud.mjs`增加可测试的读取解析边界。**仅**成功的`cloudformation/get-stack-policy`空白输出映射为`{}`；执行函数抛错时立即停止，不进入空响应兼容，不重试或输出提供者错误详情。
2. `tests/platform-hosted-window-v6.test.mjs`增加三项回归测试，覆盖空字符串/空白/空对象、其他操作空输出、非零退出、错误信息屏蔽、已有策略、畸形字段和非字符串输出。

已有策略正文原样保留，由原`assertExtra`拒绝；不能把`null`、数组、空正文或未知字段当成无策略。读取白名单、300项元数据预算、`maxAttempts=1`、Source身份、单次UpdateStack、临时窄栈策略、30秒意图/120秒事实窗口及全部资源/Secret版本限制保持不变。应用、控制器、云闭包、镜像、IAM和SQL安装源均不改。

本机31项窗口/新旧publisher测试及lint通过。CI继续使用既有无AWS工作流，自动运行新增测试及原临时PostgreSQL/类型/lint/build；不调度任何带AWS身份的工作流。原48项部署pin和81项云闭包将在最终源码上另行核对。实际CI结果保存在不可覆盖的本地修复证据包，而不是提前声称通过。

## 为什么不能直接给旧清单换一个SHA重跑

旧Review计划`efeff7c2bbd24c9869cd6daccb43bdb106940ba12720fee6853c085cbdeed4e6`绑定源码02bc，期限为`2026-10-24T03:05:11.885Z`，即温尼伯10月23日22:05:11 CDT。准备本修复时该期限已经过去；这可由原件核对，不等于已经重新读取数据库。

既有GitHub适配器继续要求当前main等于计划源码。用户本轮要求修复及准备材料，因此可以结束旧计划的源码冻结、提交受限operator修复；旧计划保持原文，不修改期限或源码、不删除记录。修复提交后旧计划和`ce3…`清单均不能用于新的执行。

W8j原发布入口要求该job控制记录为空，且其两个永久槽已消费；不能重跑它。W8k当前入口要求同源码、独立回读且未调度的Review及plans1/approvals0/attempts0；不能把这一门禁放宽来接受旧源码或过期计划。**本轮没有实现新的计划恢复发布入口，也没有生成可用于云写入的有效新执行清单。**

## 下一份审核的最小准备范围（尚未执行或批准）

先经用户限定只读授权，使用既有Neon连接，准确核对：

- job `job_6e2e115c80301595512f11fb`仍pending/attempt0/max1/审核挂起，无lease及云执行授权；九行快照、六条旧job和管理员状态符合原摘要。
- 该job只有准确旧Review计划，正文/计划/action/risk SHA及源码/期限与原件一致，且当前批准、dispatch attempt均为0。历史独立回读的0/0计数不能冒充新的当前事实。
- 既有lineage准确版本引用仍用于后续材料：key `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/w8j-job_6e2e115c80301595512f11fb-v1.json`，版本`pin8XHJzZaadT7HU.rnn2POdD06xPphz`，内容SHA `7ad860d750474ab8e3a9eb50539e736cab5c4e1d67da0ee390caecc836b406c1`。本轮不重新上传或覆盖对象；后续读取需核验版本、加密与内容。

条件全部成立后，下一小阶段才准备一个**保留旧计划、同job追加新Review计划**的受审最小入口：复用原trusted publisher及现有窄`publish_plan`，绑定最终main/CI及既有lineage，不新建业务任务、不修改旧计划/订阅/实例、不安装SQL或IAM、不调度工作流。源码中的plans表允许不同plan_sha并存，永久`UNIQUE(job_id,mode)`位于dispatch_attempts，仍不得修改或绕过。新入口必须明确核对一条准确旧过期计划与0批准/0attempt，追加后独立验证**两条准确计划**；不得简单改成“数量大于等于1”。

上述恢复入口、一个新计划SQL及其配置读取/网络/提交不明风险需绑定fresh SHA另批。本轮修复不包含该SQL批准。新Review计划从实际发布时派生两小时，不延长旧计划。此后再准备同源码窗口更新清单；只有新计划、门禁及实际资源状态全部通过且具体更新获批，才能再次尝试一次UpdateStack。

## 边界与交接

本轮不调用AWS、不读取AWS Secret/PEM、不执行SQL写入或创建/修改云资源。限定Neon只读核对需要另获本轮授权，不默认为前次一次性许可的延续；未获授权时保留“当前数据库状态未重新核对”的标记。

不重建镜像、不改IAM/云运行时/UI，不创建新job，不撤销或删除任何旧记录。48小时operator材料不等于两小时计划期限，也不等于30分钟控制租约。修复CI、只读核对、新Review发布、窗口更新及后续用户调度分别保留真实证据，不能互相替代。

现有承载仍可能持续计费，原HostingExpiresAt标签不是自动停止；50USD/月仍是目标而非硬上限。清理、续期、资源更新和真实部署均不由本修复授权。
