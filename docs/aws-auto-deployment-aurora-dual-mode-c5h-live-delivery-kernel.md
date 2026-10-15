# C5h1：真实首轮交付执行内核，尚未安装 live 入口

2026-10-15，America/Winnipeg。承接 [C5g 已验证安装](aws-auto-deployment-aurora-dual-mode-c5g-cfn-read-policy-executed.md)。本轮用户要求“开始下一步”；据此实现代码和本地验证，没有把它扩张为部署、SQL 写、私密重读或 IAM 许可。

结论：**执行内核、具体 AWS/Neon 适配器和本地候选已实现；完整现场执行命令尚未接通，应用尚未部署。** 不能把单元测试中的成功结果当作云端成功；本页不是执行审批清单，没有可批准的部署 SHA。

## 收敛后的单一路径

`当前现场只读核对 → 私密控制来源一次装配 → 首次 Neon 认领 → 初始 DDB epoch 条件事务/强读/Neon 激活 → 七资源 workload → 精确 DNS CREATE → 真实 bootstrap → 接纳现有数据库 → 一次 provision → initialized/effective configuration → 原子 ready → 独立回读`

不重新 restore、迁移、seed、构建镜像或发布 ECR；不改 Full 路径、共享 boundary 或已完成的 C5g 权限；不打开 F3c9、Grant、恢复或日志模拟支线。沿用 Express 四键 Secret、固定版本、既有 PG 17.9 实例、两份既有 ECR digest 和现有计算层。

## 本轮新增的可执行代码

- `express-live-delivery-plan-v1.ts` 新增独立 V2 候选工厂，V1 原有过期门禁保持。V2 校验旧计划完整 hash、相同 owner/数据库/网络/DNS/epoch/public 参数，再生成新的 child 时间窗；不会修改旧证据或父栈。
- `express-live-persistence-v1.ts` 使用真实 Neon HTTP `transaction`。首次认领仍是 SERIALIZABLE 九条 SQL、六行追加、直接 running/attempt1/max1；不是构造时插入。最终 ready 是另一 SERIALIZABLE 四语句事务：先锁定准确实例/订阅/工作区/环境/部署/任务/verified resource/active epoch，随后实例 active、部署 ready、同一任务 succeeded 一起提交。每条 UPDATE 在 SQL 内断言恰好一行，任一失败整组回滚；不使用事后 JavaScript 检查来代替事务原子性。
- 最终事务重新核对配置快照、完整 desired plan、50 USD 环境策略、租约 token/attempt/数据库时钟、owner/generation/物理身份/固定 Secret ref、当前 resource evidence hash、baseline 与 migration contract。不会持久化首个 owner 的密码、编译后 payload 或该密码-bearing payload 的 hash。
- `aws-sdk-express-live-infrastructure-v1.ts` 是具体 SDK/CLI 接线，不是模拟 provider：固定 Source/profile/区域/官方 endpoint，SDK/CLI 最大尝试均为1；一次 DDB TransactWriteItems、一次 CreateStack、一次 Route53 CREATE。epoch 条件检查两个命名空间，独立强读精确 record/版本并拒绝 Aurora namespace 冲突。工作负载回读准确 UUID、RoleARN、标签、完整 Original template、非 NoEcho 参数及七个 CREATE_COMPLETE 资源；NoEcho 的 Secret 引用掩码不冒充独立值核验。CFN 最多180次状态读（成功另读模板/资源）、DNS最多40次状态读，15秒间隔；没有 Update/DELETE/补齐写路径。
- `express-live-delivery-runner-v1.ts` 统一上述顺序和既有 scoped repository、mTLS control/compiler。先验证准确批准 SHA、重建固定审批范围、15分钟入场窗口，以及30秒现场元数据/最多5分钟初始数据库证据；未通过不消费槽或认领。运行最多55分钟，job 单次租约最多1小时，不续租/排队/自动重试。
- workload/DNS 后再次只读核对数据库及准确默认店铺，证据最多30秒；bootstrap 必须是真实数据库身份/配置/image 检验。接纳 `planned → verified` 表示核对现有 schema，不声称刚执行 restore/migration，不表示 initialized。随后 compiler 只在真实 verified owner/active epoch 下读取一次固定 runtime Secret、派生首个 owner 密码，一次 POST 后在 finally 清除 payload 密码。
- initialized 与 effective configuration 均通过才进入原子 ready。提交后独立回读不匹配仍是 `REQUIRES_INDEPENDENT_INSPECT_NO_RETRY`，不是成功，也不重写。
- `express-live-journal-v1.ts` 在每次副作用前用 `wx`/fsync 写准确 entry digest，根目录固定为 `F:/ChatGPT_workshop/techlong-express-c5h-first-delivery-v1`，不随新 SHA 或时间窗变化。入口和每项写均有永久槽；不在本轮创建目录/消费槽，不在代码里复位或删除。它是本地执行围栏，不是云端锁；文件系统故障、外部删除/篡改、并发跨服务竞态仍不能被消除。

首次运行内核的拟上限是 **Source 云写3次、Neon 写事务10次（含六次进度迁移）、provision POST1次、本地私密 loader1次、operator runtime Secret value1次**。这是代码计划，不是已经获批；CFN provider 还会创建七项资源，并可能自行回滚/删除它们。ECS 注入固定 Secret 的平台读取不等于 operator 的一次 value 读取，也不能计成“只有一次所有服务读取”。

## 旧父标签与新 child 窗口：不能混同

旧 compute UUID 仍绑定 `b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`，原模板 digest 不变，历史 `CellExpiresAt` 为 **2026-10-15 16:44:56.246 UTC / 11:44:56.246 CDT**，本轮开始前已过期。没有在线修改或续期父栈。

V2 提议一个**独立 child 两小时时间窗**，明确标记父标签已过期、父续期未授权、自动清理未安装。这个方向改变了旧“child 不晚于父标签”的审批范围，实际使用前必须重新列入具体资源/费用清单由用户确认。不能把候选工厂的 acknowledgement 字符串冒充用户同意；不能让旧 V1 SHA 重放，也不能只给旧 compute outputs 换日期。

本地 r3 示例提议 child 截止 **21:31:04 UTC / 16:31:04 CDT**；只是模板候选，不代表云上 TTL 或已批准使用时段。后续准备真实执行清单时须以当时现场事实重新生成，不执行本页示例时间窗。标签不自动删资源或停止计费。

## 真实完成与明确缺口

本轮已运行 `npm run test:deployment:express-live`：**62/62 通过**，含10项新增和 Express/旧 Full 邻接回归；`npm run typecheck`、所改代码 ESLint、`git diff --check` 通过。故障测试覆盖错误 SHA、修改审批上限/有效期、过期/漂移历史来源、单次提交不确定、CFN 终态失败、丢失 epoch、店铺改变、provision 不确定、initialized 失败、ready 提交后回读失败、密码清除和入口重放拒绝。

这些主要是构造/流程/纯 SQL 编译测试。没有在 Neon 提交首次认领/ready，没有证明实际 FK/触发器提交通过，没有调用新 AWS 适配器，没有证明真实日志访问、ECS Secret/KMS 注入、IAM 数据库连接、域名访问或 initialized-ready。

本轮 **AWS API/CLI 0、SQL 连接0、原私密包/Secret值读取0、云/数据库写0、永久槽消费0、job/TTL/部署0**。仅读取本地非秘密历史凭据摘要/回执并生成候选。没有刷新/测试当前凭据，不能推断 Source 仍可用。原已有收费资源未在本轮停止；50 USD/月仍是目标而非硬 cap。

**尚缺的四项现场接线，未伪造默认成功：**

1. 将旧只读预检适配为新独立窗口：准确 CFN v8、角色/策略及 Secret 固定版本元数据、现 compute UUID/网络/namespace、ECR 两 digest、Neon 初次认领条件及完整执行源码闭包。新增私有 IAM 布局读取必须取得对应允许，不循环日志模拟。
2. 用现有 IAM/TLS 只读诊断实现 `observeInstalledDatabase`，给出当前物理 OID/schema/migration/default store/未初始化事实；不能把 C5c 历史 seed 回执重新标记为刚观测。
3. 完成私密 loader/既有 Express scoped runtime/四键 SDK 的实际装配，以及独立只读 ready inspector；后者还应核对真实 ECS service/task/image 和准确平台坐标，不能仅依赖 CFN 资源状态或应用自报 image。控制面凭据/密码只在内存，不进 CLI 参数或输出。
4. 提供固定路径的 Review/Run/Inspect 命令，绑定完整 code/evidence closure、资源和费用风险；fresh SHA 单独批准后才允许 Run。当前只导出内核，**未安装可执行 live Run 命令，也未接入通用 worker**。

下一次只做以上接线与现场清单，不先创建 running job，不补新权限或付费资源来掩盖尚未实现的接口。若现场拒绝/过期，先保存只读事实再请求具体方向，不自动重试写入。

## 本地候选与追溯

入口（纯本地，不访问 AWS/SQL/原私密包）：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/prepare-express-live-delivery-v2.mjs `
  --output F:/ChatGPT_workshop/techlong-express-c5h-draft-NEW.json
```

它只接受新的 create-exclusive 输出文件。历史 r1/r2 保留（随后源码变动，绑定已旧），r3 为本轮最终组件候选：

- 路径 `F:/ChatGPT_workshop/techlong-express-c5h-draft-20261015-r3.json`。
- raw SHA `ae0f400140bb9c35768edfec125bddb540c2222615404e287a5e8b748ec378f4`。
- plan SHA `718edfe29d8e4e3d50a953950a44f9e0c84c14beed6f0bc6b0103c9359d0607e`。
- 9组件/依赖文件 binding `b1290f57d5c3d305a6b8168970a8e5754a3c2620e2e5fae18ec32523e3e71cf3`；这是组件绑定，不是完整 live 执行闭包。
- 结果 `KERNEL_IMPLEMENTED_LIVE_ENTRY_NOT_INSTALLED`，`approvalManifest=false`、`executionAuthorized=false`。这些 SHA **均不是请求用户批准部署的 SHA**。
- [Git 非秘密摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-c5h-live-delivery.local-draft.json)；完整 public 参数/提供者文档仍仅在本地，不复制 Git。

API 语义复核：CreateStack 响应只表示开始创建，需另行 DescribeStacks；本候选保留 provider 的 `OnFailure=ROLLBACK`，不等于脚本获准任意清理。[AWS CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html)。DDB 原子事务绑定两个命名空间，客户端幂等 token 不赋予本地槽的重试许可。[AWS TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)。DNS 严格 CREATE 而非 UPSERT，另读 GetChange 等待 INSYNC，不代表浏览器/公共递归 DNS 已立即一致。[AWS ChangeResourceRecordSets](https://docs.aws.amazon.com/Route53/latest/APIReference/API_ChangeResourceRecordSets.html)。
