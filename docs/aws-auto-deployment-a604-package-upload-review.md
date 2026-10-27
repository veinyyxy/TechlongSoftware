# a604 最小发布：先上传不可变审查包

2026-10-27。本阶段准备代码、测试和准确待审材料，不代表批准上传、新事实期限、工作流/trust 发布或部署。包内历史业务元数据仅保存在本地私有工作目录及后续另批的准确私有 S3 对象，不进入 GitHub。

## 当前真实状态

已按两轮独立只读授权完成核对：a604 仍 pending/attempt0/max1/审核挂起、无 lease，新控制账本为空；完整业务/历史/保护摘要匹配真实衔接后状态。revision11 在对应承载快照中健康，控制租约已过，不延长；不是当前时刻的健康保证。IAM inline/boundary 与既有发布摘要一致，目标对象当时不存在。过程中发现本地脚本混用 JSON 键排序算法，已用历史及实际策略复现并纠正；旧失败保留，没有修改生产保护基准来求通过。

只读封存证明 `techlong-a604-publication-readonly-verified-20261027-a.json` 原始 SHA256 为 `f20abc74c22999c8009922e178d62d70136203a23ed8d9e3db60e80166bf0565`。准备时验证该证明及所有原件摘要，要求检查时间两小时内；这不赋予任何新的生产读取权限。上传执行时再次核对 Source、桶安全和准确目标键，不把本机旧快照作为当前数据库证明。

## 两个顺序审批边界

1. 本入口仅审批固定新事实窗口、一次包条件 PUT 和固定版本独立回读。完整候选 wrapper 不上传，仅上传重建后的 canonical package（390134 bytes，七个原版本证据对象）。新 job 固定为 `job_a60423b885fef3e4326213f7`，basis `61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40`，内容 SHA `03e32f4b3f1f364cab53593d662b8744fb6081f7960d153c0da928946286986e`。
2. 独立回读返回真实 VersionId 后，才准备同一包引用、固定104文件云闭包和双工作流、现有 worker role 的 trust-only Change Set。权限不扩大；此项尚未生成可执行 SHA，不能把未知 VersionId 或未来 Git commit 写成事实。发布和后续 Review/RunOnce/Inspect 各按准确范围审批，GitHub environment 始终由用户本人批准。

对象仅为私有桶 `techlong-sandbox-cloud-worker-evidence-402010193138` 下 `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40.json`。不覆盖/删除旧包，不重用旧9b入口或槽。

新事实期限固定真实衔接时间 2026-10-27T14:06:24.483Z 起48小时，即温尼伯10月29日09:06:24.483 CDT。原 basis 的10月27日13:47:57.695 CDT截止完整保留，不复活旧批准。包上传清单最多24小时、受上述固定期限截断，启动至少保留2分钟；准备/重新准备不会滚动改变新事实截止。新事实批准仅供后续另审的 a604 basis，不打开运行时。

## 入口、上限和失败处理

工程入口 `ops/platform-a604-package-v1/local.mjs`：`--check` 为零I/O；`PrepareSaved` 只做封存本地原件、包重建、准确CI三GET和源码pin；`UploadReviewed` 要求准确 manifest SHA，复用既有上传器并立即独立 Inspect；`Inspect` 只接受原永久上传槽及已经严格核验的 ACK，不接受调用方提供 VersionId。

上限：上传 Source STS2、桶元数据6、准确目标HEAD2、本地候选内容1读、条件PUT1；独立实例 STS1、固定版本GET1。SDK maxAttempts1、不跟随区域重定向；HEAD只有明确404且没有delete marker才表示可写。上传前再次核对源码/CI/原始候选/编译后的basis/对象字节，消费新的永久上传槽后，再做最终Source/目标核对，最多一次 `If-None-Match:*`、AES256、ContentLength及SHA256 checksum绑定的PUT。

独立新SDK实例只读准确VersionId、校验原始字节/checksum/内容hash，并用原编译器重建basis；成功仅表示“审查包上传并固定版本验证”，不表示部署或云端验收。独立永久槽只消费一次。ACK未知或任何部分失败保留槽和原件；无自动PUT重试、补齐、删除、回滚、复位或重放。缺少准确有效ACK时不能猜测版本执行Inspect，需另审限定回读。

新增永久槽为 `techlong-a604-package-v1.intent.json` 和 `techlong-a604-package-v1.inspect.intent.json`。不改任何旧槽。入口没有 bucket/key/profile/endpoint/新期限/内容hash/重试覆盖参数；适配由源码工厂提供，不从JSON恢复能力。旧上传入口默认行为和97/104云闭包保持不变。

## 完整风险

上传内容包含历史业务、AWS Account ID/ARN、部署及审查元数据；私有桶不排除已有IAM读者、服务端/提供者/审计日志访问。Source权限比本次用途宽，凭据与整个本地包进入进程内存，不输出不等于绝无内存或日志暴露。AES256与TLS不消除以上风险。

HEAD仅看当前版本，不能证明历史版本不存在；检查到PUT之间仍有并发竞态，条件PUT并非跨服务CAS。身份/桶检查、永久槽写入、PUT、ACK保存及独立GET不构成单一事务。会话到期、网络或落盘故障可能在对象已写时留下未知ACK、收费对象或只完成上传而未完成核验；不自动补偿意味着需单独评估处理，不能反复点击或运行同一命令。独立Inspect也可能消费槽但读失败，不自动重试。

本次没有 IAM/Secret/数据库/承载写、私钥或Secret值读取、工作流发布/dispatch、续租、Cell创建或删除。仍接受低额非零存储/请求费用；50 USD/月是目标，不是硬停费，现有承载可能继续计费，清理另审。批准上传不能替代未来工作流、trust更新或实际部署的具体批准。
