# W9l — 恢复包一次条件上传及独立固定版本核验

## 准备和边界

本阶段不扩展 F3c9，不改既有权限或运行时。复用既有包重建器、来源/文件围栏、一次性证据写入工具及成功的 W9k 发布证明。准备清单只读本地已有包和封口材料，再查询准确源码的 No-AWS CI；不请求 AWS，不读取 `.env`、Secret 或私钥，不连接数据库，不把包原文提交 GitHub。

包是历史业务/审查快照，包含 Account ID、ARN、任务、业务/保护/控制账本及旧回执等元数据；不是密码或运行配置包，但不能视为公开无敏感信息。只在内存重建原证据关系并校验摘要。原始文件固定为 `F:/ChatGPT_workshop/techlong-w9f-request-20261025-a/publication-package.json`，raw558921字节/SHA `c4762e903f9c9e1d7d4d0683a6ebd72dc6ccefcb067c7134547962627e8df5d5`。上传的 canonical JSON 为384888字节/SHA `07d9d9475033b35cc6a38597946c40a8389ccd4409c177122878590e94975ce7`，包含7份固定原证据。

基础摘要 `c7baeb6471d48c01f99144d299225e33fe2d8f8eb9763f9d976cdb053374c7c0`，准确持有任务 `job_9b57b43a6b88f37202b29170`。原事实截止仍为 **2026-10-27T18:47:57.695Z（温尼伯10月27日13:47:57）**，不会因上传或准备清单延长。清单最多24小时且不超过该截止；至少提前2分钟开始。历史快照不是当前数据库状态证明，后续云端 Review 仍须再次准入核对。

## 单独批准后的准确写范围

仅 Source IAM User `arn:aws:iam::402010193138:user/techlong-sandbox-dev`（ID `AIDAV3GNMXTZEO7SHLC2X`），现有 `ca-central-1` 私有桶 `techlong-sandbox-cloud-worker-evidence-402010193138`，唯一键：

`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/recovery-v1-c7baeb6471d48c01f99144d299225e33fe2d8f8eb9763f9d976cdb053374c7c0.json`

最多一次 PutObject，`ExpectedBucketOwner=402010193138`、`IfNoneMatch=*`、显式 AES256、SHA256 checksum、JSON ContentType、准确长度。无 ACL、标签、KMS、multipart、IAM或桶配置写入。仅新对象写，不覆盖/删除已有对象。

执行前必须读验：Source、桶 region、versioning Enabled、AES256 默认加密、BucketOwnerEnforced、四项 PublicAccessBlock 全真、PolicyIsPublic=false，以及唯一键 HEAD 为404且没有 delete-marker 证据。这些是**待执行时核验的要求，不是本次新观察**。403、权限不足、200已存在、删除标记、错误或不明结果均停止，不能将403当作不存在。不列表其他对象或历史版本。

前置状态最多180秒，消费永久槽后再做一次 Source+唯一键 HEAD，最终只读核对至发送不得超过30秒。上传阶段上限：STS2、桶元数据6、该键HEAD2、包内容读取1、PUT1、准确CI GET3；SDK maxAttempts=1、固定官方 endpoint，不使用环境提供的其他 AWS 身份/endpoint。新槽为 `F:/ChatGPT_workshop/techlong-w9l-recovery-package.intent.json`，与所有旧槽独立。

上传 ACK 必须包含非 null VersionId、AES256 和准确 checksum。随后另起进程、使用独立只读能力/永久 Inspect 槽，最多 STS1 与该 VersionId 的 GET1（<=384888字节），独立校验 SHA、canonical JSON 和原基础关系；不读取“latest”代替固定版本、不再次读取本地包内容。独立结果仅证明对象版本内容，不等同于部署批准或平台验收。若原事实已过期，明确记录过期，不延长执行权。

## 完整风险及停止规则

- 历史业务元数据将发送至上述 AWS 私有桶。私有并不阻止已有 IAM 读者访问，凭据/数据进入进程内存，AWS/提供者审计日志、网络及本地审查文件存在暴露风险。
- 跨服务与文件核对非原子。HEAD只观察当前版本，不证明所有历史版本不存在；并发操作仍可能发生。条件写可拒绝已有当前对象，但不是跨服务 CAS，也不保护后续版本免遭其他操作者修改/删除。
- 任意409/412、超时、断连、ACK缺字段/校验失败均不自动重试。虽然 AWS 文档可能建议重试409，本入口更严格：消费槽后保留槽及证据，停止并另审恢复。提交不明时可能已经产生持久、计费对象；不能借用新槽重放或把最新版本猜作原返回版本。
- 上传成功但独立核验失败时，可能遗留收费对象；不自动删除、回滚、补齐、改权限、复位槽或重试。即使内容相同，发现已有对象也不自动接纳或覆盖。Source Login 可能失效，自动凭据刷新可能产生额外登录服务请求；API计数不代表提供者内部刷新计数。
- 包将持续存储，低成本但非绝对零费用。50 USD/月仍是预算目标，不是硬性费用保险。清理必须另行准确审批。
- 不改变 Neon/业务状态、控制器、hosting租约、IAM/Secret、工作流，不调用 Lambda，不领取任务，不执行 Review/RunOnce/Inspect 工作流或创建 Cell/ECS。W9k 已完成槽不得重放。

接口语义参照 AWS 官方 [PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)、[HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)、[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)。实际执行以固定清单及更严格的单次策略为准。

## 后续

PrepareSaved → 用户确认准确 SHA → 单次 Upload → 独立 Inspect。失败原件和永久槽均保留。取得经独立核验的 VersionId 后，才准备准确 release/controller 绑定与激活清单；绑定、实际激活及部署仍各自审批，不因上传成功自动开启。
