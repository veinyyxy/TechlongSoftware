# F3c6：批准登记、一次性日志和到期 drain 协调器

2026-10-12 Winnipeg。本切片完成 dormant 登记/日志 SDK 和协调器的**一次到期 drain**路径，未云安装。没有把 F3c5 数据委托升级为完整清理权限；TTL authority 发行、TTL executor 调用和失败 DeleteStack 仍未接通。自动部署/清理闭环尚未完成。

## 本次实现

`cell-birth-registration-v3.ts`从真正 branded RESERVED 空栈证据和完整 v3 plan 编译15分钟审阅候选，再要求准确 fresh SHA 批准。固定 birth、完整 Stack ARN、owner/generation/epoch、template、coordinator RoleId/code digest、出生/清理截止时间。冷 decoder 验证全记录/范围/时钟/哈希，不产生“已安装”证明。

登记范围刻意只允许一次 `beginAdmissionDrainOnce`。创建/更新栈、启用租户、发行 TTL authority、调用 TTL executor、失败删除、复位/替换/重试均 false。F3c5 delegation 中较广的自动 TTL 描述仍是数据计划，不能越过这里的窄范围。

`aws-sdk-cell-birth-registry-v3.ts`复用现有 authority 表，但只使用新的 `cell-birth-v3:*` 键，不修改旧 schema2 provision/v3 cleanup/journal：

| 记录 | 固定键/门禁 |
| --- | --- |
| 批准登记 | `cell-birth-v3:cell:cell-sandbox-1`；Source-only，fresh 精确 RESERVED 回读，absent-key 条件事务，不覆盖 |
| drain intent | `cell-birth-v3:drain-intent:<registration SHA>`；原登记全 JSON ConditionCheck＋absent-key Put |
| drain receipt | `cell-birth-v3:drain-receipt:<registration SHA>`；登记＋精确 intent ConditionCheck＋absent-key Put |

登记 reader 使用 GetItem `ConsistentRead=true`，前后 STS 核对准确身份；运行身份同时绑定 STS UserId 中的真实 RoleId/session。日志通过 TransactGet 原子读取登记/intent/receipt。存储强读的 WeakSet brand 与 JSON decoder 分开；Source 只读不能成为执行证明。reader、Source registrar、runtime journal 分离，无表创建、删除、复位或 TTL 自动消耗记录能力。

争槽每次使用**独立 UUID 事务令牌**，不由 intent SHA 确定性生成。[DynamoDB TransactWriteItems](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)对相同令牌/相同请求可在10分钟内回放成功；若把回放成功当新 ownership，会让并发者都获得调用权。本实现由永久 absent-key 条件决定胜者，而不是靠令牌去重窗口。SDK maxAttempts=1，响应丢失或取消不发 ownership，不自动再写。receipt 仅记规范结果摘要，不保存 provider 原始错误；成功返回也不是 certified zero/deletion proof。

`prepared-cell-birth-coordinator-v3.ts`执行真实编排逻辑，仍需后续受审 composition 接线：准确 birth event→强读已安装登记/身份/code pin→完整 v3 Stack→到期→强读原 schema2 前驱/准确 inventory→固定 drain event→一次性 claim→重新回读登记/Stack/前驱/intent→一次 drain→不可变摘要 receipt。重复事件回读历史 receipt；已占槽或不确定状态只 Inspect，不重放调用。

提前、不完整、错 RoleId/code/Stack/predecessor、额外事件字段均不能争槽。失败栈仅返回单独补偿数据计划和围栏/census/journal blockers，不调用 drain 或 deleter；RESERVED/ARMED 不当作成功付费 Cell 清理。旧真实 certified drain 实现不修改，不把测试 transport 的计数用于生产证明。

## 在线只读核验与测试

最终 r2 于 **2026-10-12 17:52:34.368 UTC / Winnipeg12:52:34.368**完成：准确 Source 身份有效；现有表 `58c851f4-5b8e-45ce-8933-05c33b17fb21` ACTIVE、准确 ARN/单个 authority_key HASH；新登记键前后两次强一致读取均 ABSENT。没有安装记录、争槽或 receipt，没有运行协调器/drain、Secret 值读取或 Neon 连接。读请求可能有费用，未宣称绝对零费用。

不重新检查费用、DNS、ACM、baseline 或旧函数；F3c5 的 Cell/新协调器缺失记录仍是历史，不称本轮重新核验。36代码绑定含原32，旧模板/角色/函数/消费槽位和 package/lock 未修改。r1 只读证据保留；事务 UUID 修正后代码以 r2 为准，r1 不作为最终代码绑定。

8新测试＋10模板证据＋8相邻真实 drain 共 **26测试通过**；typecheck、定向 lint 无 warning、CLI syntax通过。fixture 明确模拟 SDK transport 和 DynamoDB 令牌回放语义，不是 AWS 并发或 Neon 业务验收。测试包括相同 intent 的并发两争槽、丢失 claim/receipt、重复事件、错身份/前驱、未到期/非付费/失败分支及过期日志只读。

私有 r2：`F:/ChatGPT_workshop/techlong-f3c6-birth-registry-20261012-r2/`。报告 SHA `4057bf04ca754ba5fd9795556838d32454630c4035d2617ca55e388831540491`；36代码 SHA `af9695730b041e471c1c847ef5f6a011d58519113712480fa885a2cbccc20a8f`；原32 SHA `f69e4250c0c9894b1981579e1e7ddc0a0a70e214536fe53585190a24700209d8`保持。[公开摘要](../ops/aws-sandbox/reviews/f3c6-birth-registry.prepared.json)。本轮资源/IAM/authority Item/Invoke/数据库写入0，没有可执行云批准清单。

## 未完成与下一切片

本协调器仅是可组合程序，**没有新 Lambda handler/云运行时 factory 或安装 helper**，调用 port 还需受审固定 drain Function/Revision/代码接线。`coordinatorCodeSha256`目前是 trusted composition 输入，不是实际运行 bundle 的自测哈希；未来 root 必须从受审实际包计算/核验，不能从事件或任意环境变量声称正确。Source registrar 也不能代替函数/IAM的独立 fresh 验收。

一次 drain 返回 pending/blocked 不会自动再次 Invoke；未来 TTL 发行必须另取新的 certified ownership/完整 Stack/准确前驱，不能把摘要 receipt 当证明。失败补偿仍缺原子 failed-birth 排除围栏、activation/provision 缺失门禁、certified serializable 未入场零租户 census、不可变补偿日志与准确删除/独立恢复。

下一切片集中这些失败来源和删除前证明，再组合 fixed Lambda root、完整 TTL child 范围/包和具体权限审批。**完整范围就绪前不安装当前窄登记、不抢先创建 RESERVED 栈**：永久登记不覆盖，安装中间 scope 会冻结槽位；所有真正 IAM/函数/登记/三阶段 Cell 变更仍需 fresh SHA 与具体范围确认。50 USD/月是目标，非费用硬 cap。
