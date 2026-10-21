# W6y：工程内受审运维入口（独立 Inspect 首批）

## 状态与目的

W6w 已完成 sandbox 独立云端验收，W6x 已收敛纯运维核心。本阶段把**独立验收**的公开准备、单次调度、准确 run 观察和完整证据核验放进工程，不再新建日期命名的外部代码。

本阶段只实现与测试，不运行真实命令、不读现有 PEM、Git 凭据或 Secret、不连接 AWS/Neon、不生成生产执行清单。新入口的可用性不等于新的云验收已经完成，更不等于整套平台已经在 AWS 上线。

代码：`ops/platform-operator-v6/`。继续使用现有 main；不改 package.json/lock、不改现有发布 binding、IAM、云代码或两条执行工作流。81/76 项云闭包保持原摘要。现有 No-AWS CI 覆盖新增入口；测试使用合成网络、内存临时 RSA 和一次性本地目录。

## 明确支持的范围

1. `prepare`：只读公开 RunOnce 计划/准确结果引用、源码、私钥**元数据**；在指定外部证据目录写一份48小时待审清单。不加载凭据、不发网络请求、不读私钥内容、不消费执行槽。
2. `inspect-once`：仅在 fresh SHA、明确 human-ready、源码/私钥元数据/云闭包核对后，验证原 RunOnce 完整内容，派生 Inspect，一次 App 调度，立即撤销安装 token，显示并保存准确环境审批链接，有限观察，完整独立核验。它不是部署重试器。
3. `verify-bundle`：只读已导出的非私密证据包，在记录的观察时刻重建原 publisher 的完整内容检查，写一次离线报告；不接触凭据或网络。**包里的 GitHub 元数据是待验输入，不是经过本命令认证的在线事实。** 因而即使内容一致，也固定返回 `runMetadataAuthenticated:false`、`independentCloudAcceptanceVerified:false`、`proofImported:false`。

Review/RunOnce 的 UI、业务登记、数据库 owner 写和平台证明导入仍走原明确边界，本轮不合并、不自动授权。没有 resume、rerun、reset、自动刷新清单并执行、自动代批 GitHub environment 或后台服务。实际 Inspect 超时/失败只保留证据；若需之后在线只读回读，另准备准确 run 的清单，不重跑本命令。

## 配置与命令

需要 Node22.13+、工程现有依赖以及 `ops/cloud-worker` 原依赖。不新增全局工具。直接从工程根运行，不添加会改变云闭包的 npm scripts。

输入是严格字段的公开 JSON（路径用当前机器的绝对路径，不包含任何密钥）：

```json
{
  "schema": "techlong/platform-operator-input/v6",
  "plan": { "说明": "原完整、受发布 binding 校验的 RunOnce ControlPlan，不是计划摘要" },
  "runId": "原准确成功RunOnce的数字ID",
  "resultReference": { "key": "准确platform-result-v6.json键", "versionId": "准确版本", "sha256": "64位语义摘要" },
  "keyPath": "本机现有App私钥绝对路径",
  "evidenceRoot": "已存在、位于工程外的专用证据目录绝对路径"
}
```

以上是字段示意，不是可直接执行的样例或 W6w 重放材料。`plan` 需来自原公开记录；不手工重写其窗口、源码、风险或前驱。路径可配置，API/仓库/身份/角色/区域/binding 不可配置。禁止 `.env`、Secret 值或原私密包进入输入/证据包。

```powershell
node --experimental-strip-types ops/platform-operator-v6/cli.mjs prepare --input '<公开输入绝对路径>'

# 单独核对清单、完整风险、源码对应的成功CI并得到用户针对新SHA的明确批准后才运行：
node --experimental-strip-types ops/platform-operator-v6/cli.mjs inspect-once --manifest '<返回的manifest绝对路径>' --approved-sha '<fresh SHA>' --human-ready yes

# 仅离线内容复核，输出必须是不存在的新文件：
node --experimental-strip-types ops/platform-operator-v6/cli.mjs verify-bundle --bundle '<run目录内bundle.json绝对路径>' --output '<新的离线报告绝对路径>'
```

`prepare` 输出 UTC、America/Winnipeg 完整日期和最后允许开始时间；48小时批准窗口不等于无限执行窗口。`inspect-once` 最多35分钟，GitHub环境必须由用户独立批准。链接在 token 撤销返回后立即输出，不再只保存在文件中；若撤销失败，已收到的 ACK 仍保存在 `dispatch-api-ack.json`，不得重新调度。

**原执行源码必须等于当前干净 main。** 旧 W6w/W6v 源码已成为历史，不能拿其计划对已前移的 main 执行。离线复核不受这个限制，但不会声称在线认证。新准备结果中的 `sourceMatchesOriginalRun:false` 表示不可执行，不要篡改计划或回退 main 绕过。

## 文件、源码与一次性边界

- 证据根目录必须已存在、在工程外、路径规范化且各祖先不含符号链接/junction。只写固定子名和新文件，拒绝覆盖；新目录/文件尽可能使用0700/0600。**Windows证据目录继承其既有ACL，操作者须预先保护目录。** 不扫描、移动或删除外部历史目录。
- 私钥路径及元数据绑定在 SHA 内。Windows要求当前用户所有、禁继承，当前用户/SYSTEM/Administrators三条明确 FullControl；POSIX要求当前 uid、单硬链接、0600。读取前后核对元数据/文件句柄、拒绝链接，RSA至少2048位。不会为兼容自动修改ACL或复制密钥。
- 源码 pin 递归包含新入口、所用旧核心、原云闭包、包锁、测试和本风险文档；不接受未跟踪代码、工作树修改或非 main。执行前及槽前重新核对，最终 App客户端再次核对远端 main/workflow。
- 永久执行槽为 `intent-<jobId>-<原runId>.json`，不是新清单 SHA。刷新批准不会重开同一动作。新输出目录或槽一经创建，失败不自动清理或复位；改变证据根目录不能当作绕过旧槽的手段。保留同一操作的证据根，迁移或新独立尝试必须另行审查。
- ACK先持久化再撤销token；未知写入、响应丢失、撤销失败都停止，不自动重发。源码/元数据检查不是跨服务CAS，不能消除并发竞态。

## 真实执行的完整风险与最大权限使用

本页是未来清单的风险文本，**本轮用户要求编码不构成以下真实操作的批准**。实际执行前还须确认 fresh SHA、成功 CI、准确原 run/结果版本、私钥元数据、证据根及以下范围：

- 本机一次 Git 凭据帮助器读取和一次私钥内容读取；Git帮助器可访问其既有凭据存储。密钥、JWT、Git凭据及安装token仅用于内存网络认证，但不能保证内存擦除，也不能排除本机工具/提供者日志记录。不得在聊天粘贴这些内容。
- Source固定为账户402010193138的IAM用户techlong-sandbox-dev；固定AWS Login profile，最多6次获取/验证真实临时会话，检查真实过期时间，认证失败即关闭。没有“伪造一小时有效期”。自动刷新失败可能使验收中止。
- 固定S3证据桶最多8次版本化GET和一次准确新result HEAD，强制 owner、版本、AES256、大小、语义SHA；仅已批准根引用及严格验证后的准确后代引用。不得列表扫描或读Secret值。
- GitHub App最多一个仅该仓库的actions:write/contents:read/metadata:read token，一次Inspect dispatch，一次撤销；使用已有完整客户端身份/权限/远端源码核验。最多80次准确run GET（原run1次，新run最多78次），每请求有20秒超时，不跟随重定向；没有环境代批、任意工作流、rerun或审批接口。
- 返回token后成功/失败都立即尝试一次撤销，撤销在执行截止后仍有自己的有界超时；撤销失败不自动补偿。发行响应丢失可能无法取得token以撤销；dispatch ACK丢失可能已创建run，不能再次POST。
- Inspect本身可读固定数据库Secret一次，执行最多3个只读Neon事务、写最多2个验收证据对象。因此不承诺绝对零费用；沿用50USD/月目标，目标不是硬停费。不会创建承载资源、改IAM/Secret/数据库业务状态、领取job或读取原私密包。
- 本机/云/用户审批非原子；截止不取消已经在途操作，可能留下未确认run、收费日志/证据或未确认撤销。部分记录/磁盘写失败需要独立只读核对，不自动回滚、补齐、复位或重试。
- 只有真实认证元数据加完整 publisher 重建并取得 `SUCCEEDED_INDEPENDENTLY_VERIFIED` 才返回本入口的独立云验收通过。仍不读写平台控制账本、不导入proof、不改变UI验收旗标，不把GitHub success当作整套上线。

## 追溯与下一步

来源是 W6w 已验证的单次 Inspect 适配与 W6x 纯核心，**不修改、导入执行或重放**外部日期脚本/旧SHA/旧槽。后续新代码继续进工程；外部目录只存私密输入、待审清单、运行证据和旧档案。

本阶段通过本机合成协议/实际App客户端注入测试、文件防覆盖测试、原闭包回归、类型检查与No-AWS CI后收口。接下来优先评估主目标剩余项及平台AWS托管，不为证明新入口再次重复已通过的历史验收；实际新任务/新部署仍按具体范围另批。

本机验证包含 CLI 实际离线命令、原 publisher 完整重建和真实 App 客户端的合成网络协议；不将这些测试说成真实云执行。Windows 沙箱拒绝创建测试 junction，因此该单项本机跳过，Linux No-AWS CI 必须实际验证链接及其祖先拒绝；生产守卫没有跳过开关。其余原部署相关111项回归、TypeScript及定向零警告lint均须通过。
