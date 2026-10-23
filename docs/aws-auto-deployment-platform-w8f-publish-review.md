# W8f：真实托管镜像的单次发布及立即撤权

本文是固定范围和完整风险说明，不是执行批准。W8d已安装、W8e真实字节和35步CI已通过；本阶段只把真实候选接到现有publisher及Source流程。代码/不可变工作流/绑定CI通过并fresh只读核对后，才生成另一份具体SHA清单。源码提交和推送沿用既有授权，不等于AWS授权或ECR发布。

## 固定资源与候选

账号402010193138，ca-central-1；Source既有IAM User techlong-sandbox-dev。只使用原publisher `TechlongSandboxPlatformImagePublisherV2`，RoleId `AROAV3GNMXTZID6CJJBA2`，原stack UUID `701257e0-cd89-11f1-be5e-02452f6c634b`。boundary及其v1不改，不创建新身份或资源，不改其它IAM、access栈、Secret、Neon、业务状态或部署Cell/ECS/Lambda。

真实生产者 `f3cea2da7d26dfc09726c4cbc52cab40217340c6` / run39960583333 / artifact12503974340；ZIP307773703字节/SHA256 `12f027cccd21d955c5a0c4db9b6f536606749028c0a1fdcc8d09f95279265723`，archive SHA256 `9c427ec8a2f5b4146ee578b0fd1f5f602f729cf09f65aa7bb5392b1c596a22f5`，image-config `sha256:c418fef9c5146ef1fcdb39f88cb28ffe2d50a8b89f64ce94f6c8f463f6924230`。官方artifact到期2026-10-26 08:24:09CDT，不由本地留存延长，不自动重建或重跑。

ECR准确仓库 `techlong-sandbox-platform-web`，IMMUTABLE、AES256及scanOnPush布局保持。旧镜像digest `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612`、准确旧tag保留；预检查只能看见该旧镜像，新tag只能为 `platform-shaf3cea2da7d26dfc09726c4cbc52cab40217340c6-r39960583333-a1`。最终独立证明旧＋新恰好两份，新registry manifest原始字节摘要必须链接准确config；不以ZIP/config或Docker stdout冒充registry digest。

## 一份新批准的执行范围

1. Source重新核对身份、原角色/stack/template/trust/inline/boundary、无其它Change Set、原仓库及旧镜像；GitHub既有账号、immutable OIDC subject、main-only环境和required reviewer布局保持。只读Prepare不GetSecretValue、读私钥、申请App token、连接数据库、安装授权、创建执行槽或调度。
2. 只有准确新SHA及本文风险获明确批准，RunReviewed才消费新独立永久槽 `techlong-platform-hosted-publication-v2.source.intent.json`。保留所有旧槽，不能复位或用新槽重放未知结果。
3. 一次CloudFormation UpdateStack，将原单角色的trust及inline临时改为准确日期范围：既有GitHub主体、账号/actor/branch/environment及新hosted reusable的不可变commit。boundary、资源集合、RoleId及tags保持，DisableRollback=true，不用直接IAM写作为失败回退。
4. 独立核验Grant后，只向准确hosted caller单次workflow_dispatch，记录确切run ACK，不靠列表猜运行，不Re-run。人工在原GitHub environment批准仅这一run。云端从OIDC的job_workflow_sha取得不可变源码，严格匹配清单/调用者/候选，重新下载并核对同一真实ZIP、Docker加载、三项隔离自检及fresh OS门禁；通过后才请求一次900秒STS会话、一次ECR登录、一次tag和一次顶层docker push。
5. 成功、失败、超时、ACK不明或记录失败后，Source都尝试一次Revoke UpdateStack，把同一角色恢复无Allow trust＋LockedDenyAllEcr inline；再用独立读取客户端核验Locked。撤权不受清单到期或本地Git head变化阻止，清理审计记录写失败不能阻止这一次撤权尝试。
6. Source独立读取新registry manifest和完整库存，核对原boundary/仓库/tags仍在。另进程Inspect只读，不能补齐、重推或修复。失败/撤权不明保存证据并停止，不自动重试、回滚、删除镜像、撤销环境规则或换槽。

人工审批最长48小时，最晚启动至少预留一小时；实际Grant的一小时从RunReviewed preflight后开始，不因等待人工审批或凭据刷新延长，且不能超过批准/产物期限。Source最多两次顶层UpdateStack，CFN可产生多次底层IAM写；一次dispatch、一次角色会话、一次顶层push不是底层HTTP或ECR layer请求总量上限。Docker/托管服务自身可能内部重试；本应用不自动重放顶层写。无部署、删除、Secret值读取、私钥读取、SQL或新App授权。

## 必须接受的完整风险

CloudFormation、GitHub、ECR和本地记录不是原子事务或跨服务CAS。RoleId、源码、独立快照与精确ARN检查不能消除并发更改、删除重建、权限传播或审批后竞态；两分钟事实窗口也不是锁。CFN异步/失败禁用回滚，可能遗留临时权限、UPDATE_FAILED或已发布镜像。没有保证“成功或失败后立即撤权”一定完成：断电、进程/额度中断、Source Login自动刷新失败、网络/SDK超时、CFN未settle都可能令撤权失败或结果不明；只能独立检查并另审处置，不能承诺自动修好。代码在可继续运行时无论发布结果都会尝试撤权。

临时权限限制仓库但不是IAM级“仅一个tag”或“仅这份内容”；真正候选/tag/次数由固定受审程序控制。短期凭据、OIDC或ECR token泄露仍可能被滥用。IAM撤权/时间条件传播不保证立即中断在途请求，已有STS/ECR token不能承诺立即失效；在途layer/manifest可能于Source开始撤权后完成。GitHub排队、人工审批或环境拒绝可消耗整个窗口；超时不自动取消/Re-run或延长Grant。

Source使用既有AWS Login和普通GitHub凭据管理器授权，凭据只交给官方端点，不打印/落Git；自动刷新可失败。临时Docker认证文件在私有RUNNER_TEMP中，finally只删除准确config.json和空目录；runner崩溃不能保证清理，字符串/进程内对象不能保证安全擦除。服务端、提供者、诊断及进程日志风险仍存在，不把“无业务私密读取”解释为没有认证凭据进入内存。

严格digest、成功smoke及OS HIGH/CRITICAL零发现不能证明软件/业务没有漏洞、供应链完全可信或生产可用；扫描仅OS包，不替代应用依赖审计。扫描器及库固定版本/新鲜度仍有盲区；任何发现、过期、不完整覆盖或unfixed都不忽略，停止发布。本次No-AWS CI成功不能长期替代实际发布当时的新扫描。不可变工作流存在于Git不代表它被实际调用或获得AWS权限。

ECR存储、扫描、流量和保留资源可产生费用，50USD/月是目标而非硬上限；发布不自动清理收费资源或停止既有服务。不删除旧镜像，不因失败自动补偿。新执行槽永久占用，不复位/自动重试；提交后镜像不自动删除。后续两小时承载、私密配置读取、运行时租约、业务请求及清理全部另按具体资源确认，不能继承本次发布许可。
