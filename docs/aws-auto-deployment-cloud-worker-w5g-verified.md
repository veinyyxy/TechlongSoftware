# W5g 已完成：云端真实身份、固定数据库版本和目录验收

2026-10-18，America/Winnipeg。用户确认 `a44dfaffdd0e5227ad7ed5571be6879f1b50a65e777de87697386979bce81f3d` 后，只调度一次；[首次 waiting/ACK 记录](aws-auto-deployment-cloud-worker-w5g-dispatched.md)保留。用户亲自完成 environment 审批并报告“环境已批准”，随后另起进程只读 Inspect，准确[运行 39126114772](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39126114772)为 completed/success，唯一公开 proof 完整核对通过，而不是只看绿色状态。[机器结果](../ops/aws-sandbox/reviews/cloud-worker-w5g-verify-install.executed.json) / [当时完整范围与风险](aws-auto-deployment-cloud-worker-w5g-verify-install.md)。

## 本次实际证明

- workflow `388188162`，mode `VerifyInstall`，attempt 1，准确 actor/triggering_actor、repo ID、manual event 和 main head `90693a83ae0b2c35c43a08401c51c58c6fd92ada` 均独立核对。
- reusable R `7c02d9db3a39fc2f926848a593eb804b642bd1e5`、实际 checkout C `ac75c4bcbb856babc67d88b6e06212e981a25d90` 与原76文件闭包固定；后续交接文档推进 main 不改变此运行的 head。
- 真实 OIDC/STS 会话及角色身份校验成功；固定 S3 版本/整文档与安装绑定 `0edfa9d7…` 校验成功；worker 一次读取准确数据库 Secret VersionId `ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e`，经窄角色进行一个只读 catalog 事务，真实目录 OID/ACL/函数合同校验成功。
- 云端公开计数：bindingReads=1、identityReads=1、databaseSecretReads=1、catalogTransactions=1，controlSecretReads/cloudWrites/databaseWrites 均0。该计数只针对云 worker；之前 Source 的准备/提交前只读元数据核对另计，不能混成整个阶段只有一次 SQL 连接。
- 本地控制器没有读取 Secret 值或代批环境；仅一次 POST，没有 rerun/自动重试/取消/撤权/补齐。没有新 IAM/数据库权限、Secret变更、DDB/S3/CFN业务写、job领取/完成、应用调用、初始化或租户部署。

Inspect 返回 `CLOUD_VERIFY_INSTALL_INDEPENDENT_PUBLIC_PROOF_VERIFIED`；云 proof 为 `CLOUD_IDENTITY_FIXED_BINDING_DATABASE_CATALOG_VERIFIED`。准确成功 job 的日志只在内存中提取唯一公开 JSON，核对身份/源码/安装/全部计数；**原始日志和临时签名下载 URL未保存**，不含密码/DSN/STS凭据/私钥。

## 原件与永久继续位置

Review：`F:/ChatGPT_workshop/techlong-w5g-review-20261018-a`；单次 dispatch/ACK：`F:/ChatGPT_workshop/techlong-w5g-dispatch-20261018-a`；首次只读快照：`F:/ChatGPT_workshop/techlong-w5g-inspect-20261018-a`；成功独立 Inspect：`F:/ChatGPT_workshop/techlong-w5g-inspect-20261018-b`。旧 waiting 文档/回执是历史快照，不删除或改写成成功。

新永久槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-verify-install-v1.permanent-slot.json` 已于07:09:20.380 CDT消费，旧四槽保持；**不得再次 Review/Dispatch、Run workflow 或 Re-run**。成功后也不重复调用探针来“再证明一次”。

本地完整性证明：`F:/ChatGPT_workshop/techlong-w5g-execution-verified-20261018-a.json`，raw SHA `24e2f1d93fd33cf39e4d06c6eb5678f3db5f0e78f950c19238f52e605037ce84`，07:13:08.515 CDT完成。18份本阶段原件/槽、116源码 pins、旧110 pins与28份激活原件，以及更早107 pins/23份C1原件均核对通过。本地哈希重构无网络；真实云结果来自另起进程对准确run的读取。此前23项定向测试/类型/lint证明保持，运行源码没有修改。

## 下一阶段边界

这解决了“已安装权限但尚未证明 GitHub真实身份和窄数据库连接”的缺口；**没有证明 control Secret、应用通信/初始化、四业务函数或真实自动部署闭环**，不能称整套系统已上线。

下一直接准备新准确 held job 的云端 Review/RunOnce/独立 Inspect 最小验收，不扩观察器/恢复模拟支线。先只读核对当前平台沿革、是否已有新的待审job、Cell期限/空闲/命名空间和已有镜像/资源门禁；若缺新任务或有效部署窗口，只准备所需准确变更，业务入队、窗口更新、私密读取和云资源创建仍按 fresh 范围另审。不能重用已成功的 `job_fe5ced28b698d0bf128e7b42`、延长旧TTL或重放历史栈。

既有 OIDC trust/inline/boundary、Secret版本/隔离策略、Neon窄能力保持，不自动收紧、轮换或关闭；会话/提供者日志与单人审批风险继续适用。50 USD/月是目标非硬cap，已有 Secret/Cell/ALB/Aurora 和API/Actions仍可能收费，无停费承诺。主线仍是先自动部署，再整套AWS；F3c9/Sites等封存支线不重开。
