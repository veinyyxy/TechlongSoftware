# W6x：将已验证的运维核心收敛进工程

本阶段只整理可复用代码、测试和脱敏文档。W6w独立云验收已经闭环，允许现有main为本次代码维护继续推进；原执行仍永久绑定`b82ef569582655ff8f121fa15bcc1b6ebafa193d`，不倒填SHA、不重跑旧入口。未更改IAM、Secret、Neon、云部署工作流/运行器或平台账本，也不启用新的在线入口。

## 第一批已纳入的逻辑

| 历史原件 | 工程模块 | 迁移范围 |
| --- | --- | --- |
| W6u-WindowPorts-20261020.mjs | [credentials.mjs](../ops/platform-operations-v6/credentials.mjs) | 有界、身份匹配的临时凭据缓存/刷新；没有复制SDK、数据库或Source登录适配器 |
| W6v-PageReadyDriver-20261021.mjs | [window.mjs](../ops/platform-operations-v6/window.mjs) | 人工页面确认、严格ACK/运行等待、Review/RunOnce有界衔接 |
| W6r-RecoveryHandoff-20261020.mjs | [handoff.mjs](../ops/platform-operations-v6/handoff.mjs) | 完整证据核验后的一次观察、一次证明、一次缩短窗口计划；不复制旧业务替换SQL或历史重放入口 |
| W6w-IndependentInspect-20261021.mjs | [evidence.mjs](../ops/platform-operations-v6/evidence.mjs) | RunOnce/独立Inspect的完整内容核验、仅内存派生Inspect计划；不复制私钥/凭据加载、单次调度CLI或原件读取器 |

这些模块移除了本机盘符、日期命名导入、历史job/run/源码SHA的耦合。source/job/release/预期Source身份由受审调用者明确传入，租约和读写能力也必须显式传入。现有V6固定sandbox实例约束仍保留，不把参数化误作任意租户/权限授权。

迁移保留既有门禁：30分钟租约上限、人工页面确认先于Review、8/14分钟阶段截止、真实15分钟云领取窗口、8分钟预留、同任务准确版本/来源/actor/reusable绑定、未知结果不重试、严格写预算、独立Inspect才构成云验收。另补足凭据等待/关闭后时间复核、ACK完整计划绑定、输入快照和driver进程内一次性守卫；若永久claim回包不明，明确记录“已尝试但未确认”，不能当作槽位不存在。避免在复用时依赖原外部适配器隐含的校验。

## 不迁移、不删除的部分

- 私钥、认证文件、Secret内容、原始业务快照、日志或签名URL，不加入Git。
- 一次性安装/修复/退役脚本、固定SHA清单和已消费永久槽，不产品化，也不移动或删除。
- 原日期命名运行器和原测试作为历史原件保留，不改导入路径、不改时间、不指向新模块。推进main后，它们不能当作新批准重放。
- 本轮没有整理整个外部工作目录，文件数量不会因此立刻减少。先分离可维护核心，后续若清理归档目录，须另作引用检查和可恢复方案。

源文件原始字节SHA256（不是新模块的等价性证明；移植存在明确参数化/加固差异）：

| 历史原件 | 原始字节SHA256 |
| --- | --- |
| W6u-WindowPorts-20261020.mjs | `a94914da36c677c77e55adc0ff453ab8daa7000c9e2d6eb9aec30f853ad842af` |
| W6v-PageReadyDriver-20261021.mjs | `15fbf064c7601f0c80a48f2735b98967127c9a1fa8355e266dc06acdba230b36` |
| W6r-RecoveryHandoff-20261020.mjs | `fa5397ad6a6232b0519833cebc783cbdc3af27c3ceee7325d4bb854c5eaacc35` |
| W6w-IndependentInspect-20261021.mjs | `6360c8ffbe0be686c40ef9580bf6e3c4e62aca61c73324cc250e5c8c555e314c` |

## 验证和运行边界

[模块说明及可复现测试命令](../ops/platform-operations-v6/README.md)。新测试只使用仓库内合成fixture，不访问私有档案、不读取真实凭据、不调用AWS/GitHub/Neon。现有No-AWS CI纳入新增模块和测试；未增加权限或新部署触发器。

本机验证：新增58项与既有111项相关回归合计**169项通过、0失败**；类型检查、定向ESLint（0警告）、diff空白检查通过。另复核四份外部历史源码、已消费W6w槽及两份结果/复核原件的原始字节SHA，均保持不变。本机未重跑真实PostgreSQL fixture或生产连接；真实临时PostgreSQL和构建仍由现有No-AWS CI在干净checkout执行，其结果在对应提交的Checks中核对，不冒充本机已运行。

`package.json`/锁文件和已发布云代码保持不动，云闭包必须仍为`828491ecbb72054fd3098ebba837331bb587e5e4620bcbf9096bf25b4df63b2a`，旧闭包仍为`70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`。新模块未接入云执行根或web运行时。增加一个npm脚本也会改变闭包，因此这里直接使用Node测试命令。

本轮整理本身不是新运行授权。后续真实适配器或CLI接线仍要按准确资源、私密材料、读写范围和fresh SHA另审；不能因为代码已经在main就自动读凭据、调度或重用旧槽。平台验收标志的写回仍是独立事项，不夹带在代码收敛中。

本轮目标完成后，后续可复用逻辑直接在工程维护；外部目录主要作为私密运行数据和不可变历史证据存储，避免继续用日期文件叠加正式功能。
