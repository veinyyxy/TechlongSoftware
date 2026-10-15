# C5c：准确镜像发布待审，Express 计算层候选

**本清单已获批并消费，发布与立即撤权、独立Locked/v8/ECR回读已完成，不再待批、刷新或重放。** 下文是当时审阅范围与风险原记录；[当前实际结果及继续位置](./aws-auto-deployment-aurora-dual-mode-c5c-publication-executed.md)。

2026-10-14 America/Winnipeg（只读核验UTC2026-10-15）。接续 [C5b 已验接线](./aws-auto-deployment-aurora-dual-mode-c5b-delivery-wiring.md)，保持50 USD/月目标、现有隔离与审批边界，不扩展F3c9或再做SQL诊断。

**C5c 尚未完成真实执行根，也未部署。当前停在必要的镜像发布审批处。** C5b候选只有 Docker config digest，不能把它填成 ECR registry manifest digest。先发布已经验证的准确字节并独立读回 registry digest，再把真实镜像绑定到当前租户的执行入口。新清单只涉及现有发布 IAM 两资源与两份镜像，不授权实际计算层、旧栈删除、数据库或业务写入。

## 已完成的主线准备

- 新 `renderExpressSingleTenantCellV1` 复用既有隔离/mTLS/域名/预算检查，产生16个计算/网络资源候选：VPC/IGW/attachment、两public subnet、route table/default route/两association、ALB/task两SG、ECS cluster/ALB、business/control两listener与business control deny rule。删除9项 Full 数据库/one-shot 资源及4个对应输出，不创建第二份 RDS、不把现有 Express DB纳入此栈，也不伪造 master Secret/one-shot输出。原 Full 的25资源模板保持；新结果没有旧 Cell apply brand，不可交给旧25资源执行入口。
- 已只读确认原 Full 失败栈仍 `ROLLBACK_COMPLETE`，准确 UUID `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cell-sandbox-1/ede4f290-c758-11f1-8050-06ffda7a3477`。它仍占名；本轮没删、没复位、没自动换名。只查栈状态，不称已重新证明当前全部底层资源缺席。未来删除失败栈与创建新计算层必须独立 fresh 范围审批及库存核对。
- C5b源码 `8753546772476b018d33b96ab66db4837abde186`、成功CI38680847326和双候选38680847373保持。分别从准确完成的app/lifecycle job日志提取 image config、candidate receipt SHA、OS scan完整摘要，与候选artifact元数据绑定；本机没有下载大镜像、安装Docker或重建。promotion prepare会在获得批准后独立校验真实下载的ZIP/receipt/scan/镜像字节，不把日志当作其替代。
- 实际发布栈、两项 IAM 的 trust/inline/boundary 与原 Locked模板一致，UPDATE_COMPLETE、default v6；另读精确版本清单只有v5/v6。Source账号/ARN/UserId核对通过。新schema4仅接受这个准确v6+v5/v6前态和固定C5c grant文件；旧schema3仍只接受原v4+v3/v4及原grant文件，不改成任意版本通配。
- 原当前1ab97e7b...清单已逐字节归档 `deployment/history/reviewed-ecr-publication-1ab97e7b3809.json`，SHA保持1ab97e7b380947662e54920a3150e4c314fd8d8f8a29c320a74f7abe46b51c6a。旧四份历史、grant/revoke文件与失败/执行记录均保留。新grant仅更换准确有效期及描述，不新增动作、资源、OIDC provider或角色。

## 本次待批范围

清单：[服务端当前manifest](https://github.com/veinyyxy/SpeedFeast_Backend_main/blob/main/deployment/reviewed-ecr-publication.json)。UTF8/LF SHA：

`b7d4bb49a15c5b69aee22c456fea1d4e0bcd640a2e5dd32db32bf456bdfee792`

可安装到 **2026-10-15 09:30:00 UTC / Winnipeg 04:30 CDT**；权限最迟 **10:30 UTC / 05:30 CDT** 截止，成功或失败都必须立即 Source Revoke，不等待这个截止。过期拒绝，不自动延长、更换槽或重试。

1. Source只更新现有准确栈 `techlong-sandbox-github-image-publication/62c806e0-c27e-11f1-88a8-0e6ce3fed11f` 的 `TechlongSandboxGitHubImagePublisherRole` 与 `TechlongSandboxGitHubImagePublisherBoundary`，不创建/替换IAM对象。只复用既有OIDC provider、这个repo main ref、区域ca-central-1及现有ECR仓库。
2. 手动workflow只dispatch一次，promotion现有仓库 `techlong-sandbox-speedfeast` 的两份已检镜像；准确不可变tag：`app-sha8753546772476b018d33b96ab66db4837abde186-r38680847373-a1` 与同后缀`lifecycle-...`。不重建、不覆盖旧tag、不删除旧镜像。两checked artifact11947876415/11947134411于UTC10月16日04:20:12/15到期。
3. 无论结果如何立即Source按原准确deny-all模板撤权，随后独立Inspect确认Locked。当前default/version清单写前仍须重新匹配，保存原policy文档，maxAttempts/写入重试边界不放宽。

app config digest `sha256:334299151810ba19165ea694f0c8fe10f8f3162b72b4aac851e539fffa2364e1`，lifecycle `sha256:24ddb8f9dd57c71dc7639336f6dc2e3fa04becce1e8cf2f98abaa7a74bf539f1`。这些**不是ECR registry digest**；publication receipt必须分别独立回读两类digest及BASIC scan，HIGH/CRITICAL会阻止后续部署。仍不上传baseline。

## 完整风险与排除项

- IAM更新、GitHub dispatch、ECR上传与撤权不是一个事务。失败/响应丢失可能遗留部分镜像或临时权限；不自动回滚/补齐/重试，保留槽和收据，必要时人工接管。即使CloudFormation接受Update，也不能仅据提交响应宣称Locked恢复。
- CloudFormation更新和撤权可能自动清理旧非默认policy versions；旧版本ID不可恢复。本地备份保留文档不等于恢复云端version ID。用户需单独接受这一正常更新副作用；没有批准删除其它资源。
- OIDC trust限定repo main，不是AWS强制的单个workflow限制；窗口内其它获准main工作流可能尝试承担此role。IAM允许的是准确仓库的ECR发布动作，不是IAM强制只允许两个tag；两个tag上限由受审脚本执行。过期条件与立即撤权降低但不消除此风险。
- Source使用AWS CLI Login自动刷新、写前至少120秒当前凭据与准确身份检查；不导出密钥到环境，不保证外层login session一直有效。刷新或撤权失败必须及时处理，不能将当前STS成功当作未来撤权保证。只读Review在UTC04:34:36.491确认当前provider可用，并未为未来读取Secret值授权。
- 复用原RDS CA/ATS与已检镜像字节，不关闭TLS、安全扫描或receipt检查；OS scan DB时间01:13:01Z且门禁最长48小时。新C5c发布控制代码有独立executor SHA，不能沿用旧批准执行。
- 50 USD/月仍是目标非cap。按[AWS官方ECR计费](https://aws.amazon.com/ecr/pricing/)的存储示例，沿用1GB约0.10 USD/月的规划留额；不是实际两镜像新增字节/账单或费用上限，未依赖credits/free tier抵扣，旧仓库存储和适用传输等另计。镜像不会随撤权自动删除。本次不创建ALB/Fargate，所以不产生新计算层常驻费用；未来创建另列具体费用与清理范围。
- **不授权** ECS/Cell/ALB/DNS创建或更新、删除旧失败栈、Neon/租户SQL或LOGIN/GRANT、Secret值读取、私密bundle读取、商户初始化、deployment/job/enqueue/activation、baseline发布或运行时启用。新16资源Cell仅代码候选，与这次两资源发布IAM审批严格分开。

## 验证、实际调用与继续位置

平台新Cell/旧Full/Express组件共15项定向测试、types/lint通过；服务端发布/候选14项、types/syntax通过。修正时第一次ReviewOnly在本地固定grant路径校验拒绝，AWS写/槽为0；明确保留v3旧路径并为v4增加准确新路径后通过，没有绕过SHA。旧归档/原Full/旧权限规则保持。新发布控制代码准确提交`9a58af5afd47aae26dde071c99da8f94c7d62601`的[CI38682480159](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/38682480159) check116249894856/docker116249894539所有steps均success；没有触发候选镜像或手动发布workflow。双方C5b应用/ready的18个源文件LF pins保持，因此仍promotion原8753546已验候选，不把这个发布代码提交冒充镜像源码。[机器可读待审证据](../ops/aws-sandbox/reviews/aurora-dual-mode-c5c-publication.prepared.json)。

最终ReviewOnly已实际核对Source/CLI自动刷新、准确CFN栈及Locked角色/inline/boundary、精确版本清单；只读，不申请GitHub token、不dispatch、不获取ECR登录密码、不消费执行槽。当前AWS资源写、Secret值/私密bundle读取、SQL、镜像发布、业务/TTL/资源删除均0。代码提交和push依用户长期授权，不代表本清单获批。

唯一下一步：用户按上述SHA确认**现有两项发布IAM更新→两镜像单次发布→成功或失败立即撤权及独立Inspect**。获得真实ECR receipt后，继续同一个C5c，集中收尾16资源计算层、当前租户job/epoch/新Express执行根及初始化验收，不再扩展诊断支线。旧Full执行根和队列仍关闭，新完整root/监督清理绑定未完成，不能说仅批准ECR就能直接ready。
