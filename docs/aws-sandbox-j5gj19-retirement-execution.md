# J5g-j19：旧未执行 Grant 已退役

用户明确批准 manifest `ddf2372898210c72a26fa0ba06ef41e7cccb94b632b8f2dde963fa953ca8c25f`，仅授权一次准确 Source DeleteChangeSet 和独立只读核验。批准窗口为 `2026-10-04T13:56:22.850Z`–`14:01:22.850Z`（Winnipeg 08:56:22–09:01:22 CDT）。本流程没有删除原 fixture/Stack、创建资源、安装权限、登录 Operator、写入 Neon 或创建付费 Cell。

## 唯一目标与提交证据

```text
arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj17-read-grant-ab42ba50c3d9f4b6/84265223-0571-4770-a293-61fd4b732bdc
```

所有原件保留于 `F:/ChatGPT_workshop`：

| 原件 | SHA-256 | 含义 |
| --- | --- | --- |
| `techlong-j5gj19-retirement-review-202610040855.json` | `ddf2372898210c72a26fa0ba06ef41e7cccb94b632b8f2dde963fa953ca8c25f` | 准确五分钟批准 manifest；当前已过期，不可复用 |
| `techlong-j5gj19-retirement-run-ddf23728.json` | `8061d7edd0dc891b405f3981fb2491588519bfd9e4884868e6c6da8e066f1b77` | deletionAttempted=true、failures=[]；一次提交本身不证明退役 |
| `techlong-j5gj19-retirement-run-ddf23728.inspect.json` | `64fd0e26e7aee9d3c3a8170def5995c3e06481879c1ebbaf1ef511d7d7337497` | 另起 Source-only Inspect：RETIRED_LOCKED_VERIFIED |

永久 delete intent 于 `2026-10-04T14:00:45.352Z`（09:00:45 CDT）落盘并读回，SHA `019db61140cdebec1ab085c3b9878b6487edd4cee36f299e00332d070f8c4a44`；包含完整批准 manifest 和 fresh preflight。唯一删除回执时间 `14:00:45.567Z`，处于批准窗口内；独立 Inspect 时间 `14:00:57.566Z`。没有第二次 Delete、自动复位、权限修改或换身份。

## 独立核验与围栏状态

真实 Source Inspect 两次完整管理清单均为空，准确旧 Grant 为 MISSING；完整管理/策略/角色快照仍原准确 Locked/operator 默认v5、execution boundary v1、Cell MISSING、authority ABSENT。原 fixture 仍 READY_UNEXECUTED、资源0。随后另起本地进程重编译/复算 manifest、run/proof/永久 intent、全部 generation1/legacy/generation2 原件，核对实际 intent 和批准 SHA 的唯一绑定通过。

- 原 generation2 槽位仍只含 `claim.json`，SHA `3f06d253646d29d77d7a9045cdb1a28098b442b1cc58ee9ca65c130b2186a71a`；旧 generation1/legacy 原件未改。
- `.aws-sandbox/j5gj19-read-retirement/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000002` 现在永久消费，只含 `delete-intent.json`，不能重放。
- `.aws-sandbox/j5gj19-read-comparison` 仍 absent；generation3 没有 claim、资源或创建审阅窗口。

删除旧 UUID 的云对象不可恢复；本地 manifest/template/receipt/claim 历史继续保留，不等于恢复该对象。证据仅覆盖本流程，不证明其他外部账户动作、Operator 条件上下文或生产兼容性。所有 compatibility/readiness/runtime gates 仍 false，预算10 USD/月仍为告警而非硬费用上限。

## 本地 wrapper 的 UTC 缺陷与修复

第一次调用 PowerShell wrapper 在 SDK/Node/write-ahead 之前退出，未生成 run 输出或新目录。不是批准实际过期：PowerShell `ConvertFrom-Json` 将 ISO UTC 字符串转换成 `System.DateTime`，原 `DateTimeOffset.Parse($Value)` 隐式格式化时丢掉 `Z` 与毫秒，再按本地 `-05:00` 解释，错误地判定窗口尚未开始。实际当时清单仍有效；检查确认无 intent/输出/云提交后，使用原已实现的 Node 严格入口，在同一未过期批准下提交唯一准确 Delete，随后另起独立只读 Inspect。没有自动刷新清单或继承批准。

修复使用单独、无 SDK/ledger 能力的 `ReadComparisonApprovalWindow.psm1`：ISO canonical UTC 字符串使用 invariant ParseExact；DateTimeOffset/带明确 Kind 的 DateTime 保留绝对时间和毫秒再转 UTC；无 timezone/Unspecified 输入拒绝。三种批准参数集均调用新 guard，仍限制五分钟且最终 Node CLI 再严格检查原 SHA/窗口/永久日志。不延长窗口，不降低批准或取消检查。

27/27 定向 retirement 测试通过，其中新增一项真实 PowerShell 回归覆盖11个 UTC/毫秒/JSON DateTime/local DateTime/DateTimeOffset/活跃窗口/过期/未来/过长/零区间/无时区检查，完全不调用云或 ledger。TypeScript、定向 ESLint、PowerShell加载/语法检查通过；不重复全量离线模拟。

## 下一步

先审阅并单独批准推送本地 wrapper 修复及退役证据提交；推送本身不批准创建。准备 Source 登录与 MFA 应用后，再只读生成 fresh generation3 创建审阅，传入上述独立 proof 文件。实际一次 Create 必须单独批准新 creation SHA；随后的安装/两种只读/立即撤权又须单独批准新 execution manifest 和其三项 action SHA。不能复用这次退役批准，也不提前开启新的30分钟 policy 窗口。入口与命令见[实现与本地顺序](./aws-sandbox-j5gj19-retirement-generation3.md)。
