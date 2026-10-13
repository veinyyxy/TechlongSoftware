# F3c9e：Neon保护及窄授权原子安装完成

2026-10-12 Winnipeg。用户明确批准 `6c4f17278d9d6ff1271783b68e490f2d57f215e6ab683e7a14bd141210ac950d`、同范围原子安装、新独立槽及完整风险后，原70绑定 Run执行一次；**COMMIT确认，两个新TLS只读验收均通过且完整状态一致。** 新保护已安装，未调用失败入口、未改业务原件/状态/Secret/AWS、未启用runtime或创建Cell。

## 已提交并独立核验的范围

| 对象 | 实际结果 |
| --- | --- |
| `public.deployment_failed_cell_birth_fences_v1` | 新表为空，4准确列/4个NOT NULL逐列映射、5CHECK/1PK/1FK，共11目录约束；均enforced/validated，键列/引用environment id及RESTRICT动作准确 |
| 环境保护 | 原transition函数准确候选body/ACL，两个新CHECK enforced/validated；现有环境列、其它约束、旧业务和证书保护保持 |
| 新函数/trigger | 3个新函数及4个新Always trigger，原transition也为Always；定义、安全属性、scope及目录符合清单 |
| `techlong_cell_cleanup_reader` | 9表SELECT，其中新增围栏表；jobs/steps各3列，共6列SELECT，无non-trigger definer访问；已有LOGIN/属性保持 |
| `techlong_cell_drain` | 原4表SELECT/20列窄权限保持，准确失败围栏函数EXECUTE已安装，non-trigger definer访问为true；已有LOGIN/属性保持 |

本次GRANT是用户批准的安装结果，**没有在完成后自动撤销**。现有drain凭据已获得受限SECURITY DEFINER能力；本轮未使用该能力，不等于没人能调用。环境仍`open`、epoch0、apply0，失败围栏0行；没有写入failed/draining状态或任何永久业务围栏行。

## 实际流程与稳定证据

- 70文件/原68/SQL/目标及旧停止证据通过；有效窗截止02:15:11.492 UTC，运行在窗口内。新固定槽于 **2026-10-13 01:43:23.552 UTC / Winnipeg10月12日20:43:23.552** 消费，随后schema SQL与grants SQL各一次、COMMIT一次，未重试。
- 完整after-DDL安全目录在核验前已保存，snapshot SHA `77cd7faa0dbb22cb32ccaf9a41c5bbd0d58113027e1e3febe230be1d89ff6681`；`afterEvidenceSaved=true`。实际目录4n/5c/1p/1f与双查询一致，原V4非计数安全检查全部通过。
- **01:43:26.464 UTC / Winnipeg20:43:26.464**，原写连接关闭后的新TLS SERIALIZABLE READ ONLY DEFERRABLE事务验收通过。
- **01:44:07.602 UTC / Winnipeg20:44:07.602**，另一个独立进程/新TLS同类只读事务再次验收通过；完整state canonical相同，SHA `e4687f3837ac26ebe9bda72c2b044c646e36529a542cce531f6ec57dcf14ebaf`。
- 新失败保护目录 SHA `015db4276a151d5c0dd0fb96cdb6df214af40fc8be89c8d6d955071b4c7340b9`；真实未投影legacy状态SHA `27f5fc8804267a3eb92f453787c4dc60f8f7e8b4d96e451f241665a372334b4b`。旧证书`dc093614...`、旧保护`41eea5ac...`及业务摘要未变。

| 回执 | SHA |
| --- | --- |
| 批准清单 | `6c4f17278d9d6ff1271783b68e490f2d57f215e6ab683e7a14bd141210ac950d` |
| 原70代码 | `1c1bc49285d6ef061e7fede2a82fd720c533fbbe00cff51cf5574bbed529e778`，未修改 |
| 提交确认回执 | `aa1ec6a048ff2f521852ba07046ea1c7c584603eb85683276095db36fe128c02` |
| 第一次独立Inspect | `99672aa8547ab35910f607a24ca6a73382b43adae6f84cddce27d93c843824fe` |
| 第二次独立Inspect | `c253818477738b5a3feeb868be8820e63bb22116c90f618b60f633b791f8a67a` |
| 已消费新槽 | `f5cb3a943c2751de168afbcf2b71766635a667443a2e22f82fe585e049d6bc39` |
| 原消费槽 | `d113cae152d5eb0a3c4b10e7f16fd07983813bd303c8d0e057d729676f2b7d9e`，原样保留 |

私有记录目录：`F:/ChatGPT_workshop/techlong-f3c9e-pg18-install-20261012-r1-run/` 及 `F:/ChatGPT_workshop/techlong-f3c9e-pg18-install-20261012-r1-independent-inspect/`。新槽 `techlong-f3c9e-pg18-reviewed-installation.permanent-slot.json` 与旧槽均不可删除、复位、换目录或重放；Run与Review不再适用于该空槽安装，仅可Inspect。本次3数据库连接（写事务1＋独立只读2）、schema尝试1/grants1/COMMIT1，AWS调用/Secret值/Invoke0。

原21测试/type/lint/syntax结果及70绑定保持，未重复隔离模拟或重建镜像；本轮是实际数据库目录验收。原停止事务目录未保存，因此本次成功不倒填原失败记录，也不声称旧失败原因已唯一证明。

## 尚未完成与下一阶段

目录验收不是实际受限角色认证、失败入口执行、并发排除或云清理验收；`actualRestrictedRuntimeProofProduced=false`、`failureEntryBehaviorExercised=false`、runtime关闭。AWS锁定控制面沿用上阶段记录，本轮未重新读取或修改；50 USD/月保持为目标而非硬上限。

下一阶段在锁定期集中完成 **runtime reader准确$LATEST ARN/null Layer兼容、实际jobs的pending/running/retry_wait谓词、固定gate-capable最终包及async age60/retry0配置方案**，绑定本次真实失败保护目录SHA。代码/只读准备可推进，函数代码/配置/IAM/table策略/调用及RESERVED/parent/ARMED/PAID仍须准确fresh范围单独批准；不登记后静默更换包，也不提前创建会在实现期间过期的RESERVED栈。
