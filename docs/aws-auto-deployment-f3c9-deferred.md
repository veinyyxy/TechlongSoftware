# F3c9 封存与重启说明

决策日期：2026-10-13，America/Winnipeg。用户明确要求停止继续扩展F3c9支线，记录以便以后重启，转向[单租户首轮交付](./aws-auto-deployment-single-tenant-acceptance.md)。这是开发主线调整，不是删除已部署资源、撤销权限或复位历史槽的授权。

## 封存基线

- 平台基准提交：`a5b54cc51538bc120e2a37fd930a3f9231abc1dc`；服务端交接基准：`25df9c97fbb360edb45d85131cec5def52582b72`。
- 最后完成位置为F3c9l：获批的一次V6代码更新已成功，独立Inspect于2026-10-13 **09:40:48.770 CDT / 14:40:48.770 UTC**通过。详见[实际验收](./aws-auto-deployment-fast-track-f3c9l-locked-v6-code-installed.md)和[非秘密capsule](../ops/aws-sandbox/reviews/f3c9l-locked-v6-code.verified.json)。
- 函数：`arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3`。
- 实际完成Revision：`1843cd76-fd3b-4b82-9c3d-1e532901a58e`；CodeSha：`ofOAfejxW/HT7z832LpapibmEBBKSIq2bjzwUzDa264=`，432966字节。ZIP SHA `a1f3807de8f15bf1d3ef3f37d8ba5aa626e610104a488ab66e3cf05330dadbae`。
- 当时完整15锁通过：协调器deny-all仅v1、空role策略、并发0、原async age60/retry0/空destination；parent/workflow/registration和Cell缺失。锁/配置/async不变量 `6210b806af9fd439b53efe5879950f870f01ee7f954164466fcbb7232c359dda`。
- 冻结132文件代码绑定 `80bf86b1a22b75aa0512f27f64df562039fb49c57e6146d479a67422626e349e`。私有原材料 `F:/ChatGPT_workshop/techlong-f3c9l-v6-code-20261013-r1/`；Run与独立后验收在相同前缀的 `-run/`、`-independent-after-inspect/`。
- Neon保护已安装，保护SHA `015db4276a151d5c0dd0fb96cdb6df214af40fc8be89c8d6d955071b4c7340b9`；不做down、不移除触发器、角色、Secret或既有业务记录。
- 旧零资源身份UUID `01a06ca0-c6bf-11f1-898a-0e285576029b`已准确退役，UUID不可恢复；[退役证据](./aws-auto-deployment-fast-track-f3c9k-retirement-verified.md)保留。

这些是已保存的历史实测事实，不保证将来保持不变。本轮不另做云全量复核，也不将所有清理函数宣称为deny-all：已有TTL/drain业务候选及其既有权限仍保留，未调用。Secret、日志等既有费用可能继续发生。

## 停止扩展的范围

不继续新增generation、parent/child协议、birth registry、故障围栏、journal、退役恢复器或更多微探针；不为首轮部署完善通用无人值守Cell工厂。现有源码、测试、文档、已安装代码、权限、数据库约束与私有材料均保留，不物理删除或偷偷放宽。

所有旧永久槽保持，包括V6更新槽 `techlong-f3c9l-locked-v6-code-update.permanent-slot.json`（SHA `63f167f113279b2b6317dae0f301325cdf54fbb2dcb1228bc6ce393b77bac3f3`）、旧RESERVED创建槽、原退役槽和恢复槽，以及更早数据库/部署槽。**已消费入口永不重放或复位**；过期批准不延长，不把用户泛化“继续”解释为重启封存支线或云写许可。

## 保留的未完成项

未来如要交付通用无人值守生命周期，需要继续处理：

1. 独立新身份及真实新Stack ARN的V6 IAM/table短窗口、Source parent登记材料。
2. 固定有限gate的真实allow/deny与Secret/KMS转发验收；目前代码元数据验收不证明这些运行路径。
3. 完整自动birth/provision、失败补偿、drain、TTL删除与恢复的实际云闭环。
4. 与租户运行时activation/authority writer和单租户部署接线的兼容，不能假定现有全表冻结候选可直接安装。

它们不是全部废弃，也不再全部作为首轮交付前置。原风险和安全边界仍有效。

## 重启步骤

先取得用户明确的“重启F3c9”方向指示，再只读检查Source身份、当前代码/Revision/角色与boundary/async/并发、表策略和items、Neon保护、当前Cell库存，以及全部旧槽/历史材料是否与封存基线一致。代码绑定与材料校验失败时先诊断，不能自动补齐。

若新主线已创建Cell或authority，封存的“Cell/parent缺失”等事实已不适用：不得删除新主线资源以恢复旧前态，也不得把新Stack套成旧RESERVED品牌。先明确兼容/接管范围，重新生成新材料和fresh批准；旧UUID、旧窗和旧槽均不复用。权限安装、调用、数据库写入、新资源和不可恢复删除各按具体范围另审。

开发重启不意味着自动执行任何旧Run。原有50USD/月目标继续适用，非账单硬cap；重启前重新核对现存费用和清理责任。
