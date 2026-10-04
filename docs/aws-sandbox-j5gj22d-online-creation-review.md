# J5g-j22D：在线 Source 只读核验与 generation5 创建审阅

本阶段使用固定 Source IAM User `arn:aws:iam::402010193138:user/techlong-sandbox-dev`，Region `ca-central-1`，进入已约定的受控在线只读准备。没有登录 Operator、MFA、AssumeRole、创建/执行 Change Set、安装权限、删除资源或 AWS/Neon 写入。代码提交与非强制推送沿用持续授权，云创建和安装仍各自批准。

## 实际回读结果

2026-10-04 的 Source STS 身份核验通过，随后现有 `ReviewCreate` 实读完整管理/IAM、原零资源 fixture 和前后完整 Change Set 清单：

- 管理 Stack 为 UPDATE_COMPLETE，完整 Locked/v7；四个 IAM 资源、两个角色/trust/attachments、两个 policy 默认文档与关闭前驱一致，execution boundary 未变。
- Cell MISSING、authority ABSENT；原 fixture 稳定，前后完整 singleton 清单均 count=1，CREATE_COMPLETE/AVAILABLE。
- 实际完整管理清单为空，原 generation4 历史对象的缺失由真实完整清单证明；未过滤陌生终态或合成空清单。本阶段没有删除这些对象。
- generation5 registry/claim/intents 仍 absent，原固定 claim/六步 journal SHA 保持 `6ec0eae446692285efe64e844eca3cb9f9e24ced36d5fb268b8f1ba66872b192`。

首份真实清单 `F:/ChatGPT_workshop/techlong-j5gj22-generation5-create-review-20261004T210140000Z.json`，SHA `9cad6651293386563a707a5f046360df4aea3bd6fe7c8ca6d59a250a461dd577`，issuedAt `2026-10-04T21:02:27.231Z`、expiresAt `2026-10-04T21:07:27.231Z`。其原件保留，不作为后续批准或执行输入；完成以下入口修复后另作 fresh Source 审阅。

## 真实输入发现的入口修复

首份保留完整四代前驱的新清单约 916 KB，超过旧共享证据读取器的 600 KB 限制，独立本地复读因而拒绝。没有忽略上限或直接执行。新增 J22 专用 `readStackControlReviewJson`，仅新 generation5 创建清单及执行 manifest 使用 2,000,000-byte 上限；原证据路径映射、历史原件、磁盘 claim/intent 和旧 compiler/reader 仍保持原 600 KB 限制。

新读取器要求本地绝对路径、普通单链接有界文件，拒绝远程/相对路径、目录、符号链接、多硬链接、超限及读取期间的 inode/dev/size/mtime 漂移。读取后仍完整 schema/hash/前驱重编译，先于任何 SDK/MFA/云写入能力构造。PowerShell wrapper 只有 CreationReview/ExecutionReview 显式使用新上限，其余输入保持原限额；没有默认批准 SHA 或自动执行。

3 项文件边界测试及 1 项旧 CLI/PowerShell 提前拒绝回归通过；TypeScript `--noEmit --incremental false`、四个相关 TypeScript 文件的 ESLint `--max-warnings 0` 通过。未重复部署模拟或全量 build。

独立本地核验脚本 `F:/ChatGPT_workshop/verify-techlong-j22d-create-review.mjs` 重新加载准确原件/真实旧账本，严格复算新清单、完整 Source 快照和固定围栏，并再次证明新 registry absent、旧记录稳定。该独立复算只读本地原件，不冒充第二次独立 AWS 会话；实际 AWS 前后回读由 Source 审阅入口完成。

## 后续批准边界

修复后重新 Source 实读生成的最终创建清单：`F:/ChatGPT_workshop/techlong-j5gj22-generation5-create-review-20261004T210850000Z.json`，完整 SHA 为 `0086e4ab7f69d4c4355642ba63e7a7f198f0a545501652e66926d208c082e6e6`。issuedAt `2026-10-04T21:09:34.364Z`、expiresAt `2026-10-04T21:14:34.364Z`，policy 截止 `2026-10-04T21:39:14.685Z`。随后独立进程在 `21:10:04.735Z` 重新读取/完整重编译清单及原件，确认 SHA、准确范围和旧账本一致，新 registry absent。此记录不是批准，时间已过则仅供历史核验。

最终 fresh 创建清单及完整 SHA 以本地新原件和本次交付为准，期限仅 5 分钟，过期不能凭刷新身份继续执行。若需重新只读审阅，保留旧文件，并在确认槽位仍 absent 后生成新文件；不自动复位、占位或重试创建。

创建批准只能允许准确管理 Stack 上一次未执行 `CreateChangeSet`，模板仅追加准确原 fixture Stack ARN 的 Describe Allow，无 ChangeSetName 条件，保留旧角色、资源、删除/执行限制。接受 `CAPABILITY_NAMED_IAM`、永久 generation5 claim 和低成本但非绝对零费用；不执行 Grant/child、不安装权限、不登录 Operator、不删除资源、不创建付费 Cell。

创建获批且提交后，独立 Source RecoverCreate 必须证明 READY_UNEXECUTED。之后才可生成独立执行 manifest；安装、固定 MFA Operator 两种 Describe 和立即 Revoke 还需要 manifest/三项 action SHA 的 fresh 单独批准。当前生产兼容性、Worker/runtime/readiness 均未开启。
