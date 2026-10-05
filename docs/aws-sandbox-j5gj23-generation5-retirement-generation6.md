# J5g-j23：generation5 严格退役工具与 generation6 独立围栏

按用户“继续下一步”确认的仅代码范围实现；本轮没有 AWS/Neon 调用、云删除/创建/IAM 安装、Operator/MFA 登录、新候选 policy 或真实云批准窗口。旧记录保持不变，代码提交和 github/main 推送沿用持续授权。

## 已接通的边界

- 新独立退役核心、Source-only 读取组合、一次 DeleteChangeSet adapter 和固定磁盘 ledger。不会复用或修改旧代删除/创建/安装入口。
- 删除只绑定下面唯一完整 ARN；必须在原 policy 过期后获得 fresh、最多5分钟的单独 SHA/固定 phrase/不可恢复删除及低成本确认。清单不是批准，参数不提供默认批准值。
- 完整 Locked/v7、四个 IAM 资源/角色 trust/attachments/全部 policy 快照、原零资源 fixture 与完整 singleton 清单须与历史锚定快照一致。管理清单只能是准确未执行目标或独立删除后的完整空清单；不能过滤旧终态、外部对象、重复项或分页。准确 UUID、Original template、单一非替换 policy Modify、root/non-nested/import/rollback 等检查复用未放宽的 J22 Source SDK 读适配器。
- 云提交前重新加载全部真实前驱、旧账本和仅 claim 的 generation5 槽位。一次独占 mkdir、文件 fsync 和严格回读完成后，才允许至多一次准确 Delete；过期/取消/丢失回包/部分目录/损坏或链接状态不重试、不复位或修复。成功回包只记录安全 request ID，仍不是退役证明。
- PowerShell 批准入口在 `finally` 中另起只读 Inspect 进程。准确对象缺失、完整管理空清单、完整 Locked/fixture、实际永久 delete intent 和旧记录稳定全部成立，才产生独立退役证明。不存在 intent 时不能采用外部删除造成的缺失。

```text
arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj22-stack-read-grant-eb71b71ef41e3111/efbf0abc-5638-41d7-9a50-6960f9f442f2
```

新退役固定路径为 `.aws-sandbox/j5gj23-stack-control-retirement/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000005`，与旧 claim/六步 intent 命名空间隔离，不按审阅窗口另起槽位。

generation6 围栏只接受成功独立退役 proof，并绑定其永久 intent、原 claim 和全部历史锚点；固定路径为 `.aws-sandbox/j5gj23-stack-control/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000006`。本地 admission 还必须比对实际退役 intent、重新核验全部旧记录，且新 registry absent。**仅有纯围栏描述和 admission；generation6 候选编译、创建/安装执行链、真实新 claim/registry 尚未实现或创建。**

## 紧凑证据和工具入口

新清单/intent/proof仅包含固定历史摘要及新的完整只读观察，不再嵌套复制所有旧树；新增 reader 仍限制600,000 bytes，单链接普通本地文件及读取前后 inode/dev/size/mtime 稳定。旧 J22 约1MB的 creation/execution review仍使用其专用2MB reader，不扩大旧证据或账本限额。历史 Inspect 最终快照按原时间验证，不合成历史 before/after 观察。

`s3-b5-arn-probe-stack-control-generation5-retirement.ts` 提供严格互斥入口：`CheckLocalPreparation`（本地、无窗口）、`Review`（未来 Source-only fresh 删除审阅）、`RetireReviewed`（未来单次受批删除）、`Inspect`（未来独立只读退役证明）、`CheckGeneration6Admission`（本地 proof/实际 intent/新 registry 围栏）。本轮仅实际运行 `CheckLocalPreparation`。

本地批准脚本为 `ops/aws-sandbox/scripts/Invoke-ReviewedGeneration5Retirement.ps1`，需要绝对 Evidence/Manifest/新 Output 和显式完整 ApprovedManifestSha；继承已验证 UTC/DateTime 审批窗口模块，不自动刷新清单、登录 Operator、创建后继或安装权限。

## 已完成验证

15项定向测试/必要 JSON/PowerShell 回归通过，包含完整快照漂移、过期/错误批准、丢失响应、intent 回读失败、取消、部分/未知槽位、hardlink/junction、并发唯一赢家、缺少 intent 的外部缺失拒绝、过早 proof 和独立 generation6 绑定；全项目 TypeScript 检查、新增 TypeScript 文件 lint 通过。没有重复全量旧代离线模拟。可用 `npm run test:aws:generation5-retirement` 重跑这些测试。

真实本地证据路径表：`F:/ChatGPT_workshop/techlong-j5gj23-generation5-retirement-evidence-paths.json`。分别在两个进程完整加载归档原件及实际账本，结果均为 `CLOSED_GENERATION5_LOCAL_PREPARATION_VERIFIED`：

- `F:/ChatGPT_workshop/techlong-j5gj23-local-preparation-20261005T131009992Z.json`。
- `F:/ChatGPT_workshop/techlong-j5gj23-independent-local-preparation-20261005T131434124Z.json`。
- 两份 timeless receipt SHA 均为 `82042544e504f0ff192720883472db7d9fc2efb53914bf4471f13333a1ed9e17`，紧凑前驱 SHA `157f162f0b763eb3a77989296f5183f28f1831d3218878e3480a3b9aafbf9087`。
- 实际 generation5 claim SHA仍 `f6c09dd307dfeeb4e0bb08cb17b9dca997dde96d0e1f43cbc9b6329488a76641`；唯一文件 `claim.json`，没有六步执行 intent。原关闭前驱/真实旧 journal SHA 未变，新退役 intent absent，generation6 registry absent。

这是本地实读证据，不是2026-10-05新的 AWS 回读；云端最后独立观察仍是温尼伯2026-10-04 23:35:25的准确未执行 Grant/Locked/v7。真实退役尚未发生，本轮没有 fresh 删除 manifest 或批准值。

## 下一步

用户准备继续在线阶段时，先固定 Source-only 核对准确对象及完整 Locked/fixture/实际账本，生成独立 fresh 退役清单；随后由用户确认准确 SHA，仅退役旧未执行 generation5 管理 Grant，立即独立 Inspect。该批准不删除原 probe/Stack，不执行 child、不安装权限、不创建付费 Cell或 generation6。旧对象不可恢复，固定槽位占用后不自动复位或重试；低成本不等于绝对零费用。

generation6 云创建/安装仍需后续代码接线和各自 fresh SHA 单独批准；代码、runner准备、定向验证和推送须先完成，再打开新候选窗口，不在创建与安装审阅间插入归档/Git工作。不延长原窗口，不扩大权限，runtime/readiness/生产兼容性仍未开启或证明。
