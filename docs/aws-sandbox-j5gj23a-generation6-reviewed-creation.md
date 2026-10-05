# J5g-j23A：generation6 独立候选、固定持久化和受审创建工具

沿用用户已确定的精确 Stack-only Describe 只读范围及执行边界。本轮只实现代码、运行定向验证并核验真实本地归档/账本，没有 AWS/Neon 调用、Operator/MFA 登录、真实候选或批准窗口、云创建/IAM 安装，也没有占用实际 generation6 槽位。提交/推送沿用持续授权。

## 已接通

- 独立 generation6 compiler，不向旧 generation5 compiler 注入改写前驱或伪装代数。紧凑 context 绑定成功独立退役 proof、实际永久 delete intent、原始 Locked 模板及完整历史锚点；线上入口每次仍完整重读原始旧归档和磁盘账本。
- 显式时间的30分钟未部署候选，仅在原 Operator boundary 加一项 `cloudformation:DescribeChangeSet` Allow，Resource 为准确原零资源 fixture Stack；省略 ChangeSetName 条件只限这项 Describe。原删除/执行条件、其他资源/角色、Locked revoke 模板均不改变。
- 新的 generation6 名称、token、SHA 与独立固定路径；代码没有 generation7 或可配置代数/目标。围栏继续使用已完成退役证明生成的不可变描述，其中 false 表示描述本身不是授权或物理预留，不随工具实现状态改写。
- 创建审阅只允许 `CreateChangeSet`，最多5分钟批准窗口，保留至少15分钟候选 policy 余量。完整 SHA、固定新 phrase 和四项显式确认缺一不可；创建不授权 Grant/child 执行、Operator、删除或安装。
- Source 前后完整 Locked/v7、四个 IAM 资源/角色 trust/attachments/全部 policy 快照、原 fixture 和完整 singleton 库存必须稳定。新管理库存只能为空或准确的新未执行 Grant；不沿用旧终态过滤规则，不接纳任何外来、重复、分页、已执行、未稳定对象。
- SDK 双 List、完整 ARN 双 Describe 和 Original template 校验保留准确 UUID、root/non-nested/import/rollback/参数/单一非替换 Operator policy Modify 检查。复用的是通用严格 provider 验证器和真实旧 Locked/fixture 的只读适配器，不扩大旧 compiler 或权限。
- 独占 mkdir 后 `wx`、fsync、严格回读永久 claim，才至多一次 SDK Create。入口与 SDK 提交边界都重查 live window；过期、取消、损坏、部分目录、未知文件/代数、hardlink/junction、并发失去槽位或丢失响应均不修复、复位或重试。
- PowerShell wrapper 在 `finally` 另起 Source-only `RecoverCreate` 进程；只凭永久 claim 与独立完整观察证明 `READY_UNEXECUTED`。缺少 claim 不允许重建，完整库存缺失只记录 `MISSING_SLOT_CONSUMED`，不重试创建。

固定路径：

```text
.aws-sandbox/j5gj23-stack-control/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000006
```

当前创建-only storage 仅允许 `claim.json`，不接受任何 workflow intent。安装/Operator/撤权 journal 与执行链将在后续代码阶段独立接线；没有在本阶段通过新云创建提前消耗窗口。

## 工具入口

核心、生产归档/固定 storage 和单次 SDK 创建适配器分别为：

- `lib/deployments/execution/arn-probe-stack-control-generation6.ts`。
- `lib/deployments/execution/arn-probe-stack-control-generation6-storage.ts`。
- `lib/deployments/execution/aws-sdk-arn-probe-stack-control-generation6-create.ts`。

`ops/aws-sandbox/scripts/s3-b5-arn-probe-stack-control-generation6-create.ts` 严格互斥模式为 `CheckLocalPreparation`、`ReviewCreate`、`CreateReviewed`、`RecoverCreate`。本轮只实际运行 `CheckLocalPreparation`；此分支不加载 SDK/身份、不编译候选或打开窗口。旧 evidence 路径表和独立 retirement proof 均须显式绝对本地文件；新小 envelope 继续使用600,000 bytes普通单链接稳定读取限制，不嵌套复制旧大树或放宽旧 reader。

批准入口为 `ops/aws-sandbox/scripts/Invoke-ReviewedGeneration6Create.ps1`，需要显式 Evidence、RetirementProof、CreateReview、完整 ApprovedReviewSha 和新 Output。继承已验证 UTC/DateTime 窗口模块；Node 仍严格重新编译/复算，不以 PowerShell 摘要字段或“脚本已完成”代替真实批准/独立证据。

## 验证结果

13项新定向测试与15项紧邻退役/JSON/PowerShell 回归全部通过，共28项；覆盖准确模板增量、旧批准隔离、proof/模板/权限漂移、全快照和库存检查、窗口/取消、提交后丢失响应、永久 claim、并发唯一赢家、损坏/部分/链接/未知槽位、SDK 原件/rollback/终态拒绝、严格互斥 CLI 和 wrapper。本轮不重复全量旧代离线模拟。全项目 TypeScript 检查与新增 TypeScript lint 通过；可用 `npm run test:aws:generation6-create` 运行这组测试。

真实本地原件与实际磁盘账本在两个独立进程加载，结果均为 `RETIRED_GENERATION5_GENERATION6_PREPARATION_VERIFIED`：

- `F:/ChatGPT_workshop/techlong-j5gj23a-generation6-local-preparation.json`。
- `F:/ChatGPT_workshop/techlong-j5gj23a-generation6-independent-local-preparation.json`。
- 两份内容和 timeless receipt SHA 相同：`668ae1efd7a7fdae294586681337acd057d14be1a7aede1a14d82ba0b1bb1bb4`。
- 紧凑 context SHA：`426eca37ec3c26bb46f49c142c2294c7690d2b08d73e34efdb840914d65e26eb`。
- 围栏 SHA：`21efd42ed85140dceddf19a2d4891ec4b8d0cd015b9750433251a19c7f491949`；绑定实际独立退役 proof `6a18e4047f492da5459e2c6fac077b310301ef25a9cdaefe61e570b816fd86e3` 和永久 intent `63f1a488c318337fb8a53a3895b1f261d0f0695c68ee5d50bf2bb9d8b1b4d06e`。
- 旧 generation5 claim、generation4 journal 与所有归档未变；generation6 registry absent，没有真实新 claim 或 workflow intent。

这是本地实读，不是新的 AWS 回读。云端最后独立观察仍是温尼伯2026-10-05 08:43:07的成功退役、完整管理空库存、Locked/v7 与原 fixture 未变。后端仓库没有改动。

## 下一小阶段

先接入 generation6 准确安装审阅、固定 MFA Operator 至多两种 Describe、异常路径立即 Source Revoke、独立 Locked Inspect 与 revoke-only 恢复的代码和 runner；完成全部工具/验证/提交后，再转 fresh Source-only 创建审阅。不会在新云创建后才补安装工具或做 Git 工作。

真实创建和安装仍分别按 fresh SHA 单独批准；不得复用退役批准、创建批准、旧 policy 或安装窗口。保持不执行 child、不 DeleteStack、不删除原 fixture、不创建付费 Cell、不打开 runtime/readiness。低成本不等于绝对零费用，生产兼容性仍未证明。
