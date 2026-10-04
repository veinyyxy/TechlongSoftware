# J5g-j19：严格退役、独立 generation3 与本地批准入口

本轮仅实现代码和核验；已推送用户批准的 `5aa0ffb2485616f0e9d84b54d4d273d4d56ea702`。**没有云 Delete/Create/Execute、IAM 修改、Operator 登录、Neon 写入或付费 Cell 创建；新代码提交仍须单独批准推送。**

## 入口和不变边界

| 入口 | 已实现 | 禁止 |
| --- | --- | --- |
| `s3-b5-arn-probe-read-comparison-retirement.ts` | Review / RetireReviewed / 独立 Inspect；5分钟批准；Source 一次准确 full ARN DeleteChangeSet | 原探针/栈删除、IAM 修改、Grant 创建/安装、删除重试、自动提升权限 |
| `s3-b5-arn-probe-read-comparison-generation3-create.ts` | 独立 ReviewCreate / CreateReviewed / RecoverCreate；仅 EXACT_NAME_CONDITION；30分钟 policy / 5分钟创建批准 | 复用 generation2、另一个条件候选、reset/replay、自动 generation4、安装权限 |
| `s3-b5-arn-probe-read-comparison-generation3-workflow.ts` | 独立 Review / Inspect / RunReviewed / revoke-only recovery；一次安装、固定 MFA 两种 Describe、独立立即 Revoke | child、探针删除、付费 Cell、传播重试、开启生产门禁 |

退役只针对以下旧未执行管理 Grant，而不是原 fixture Change Set：

```text
arn:aws:cloudformation:ca-central-1:402010193138:changeSet/techlong-j5gj17-read-grant-ab42ba50c3d9f4b6/84265223-0571-4770-a293-61fd4b732bdc
```

退役前重编译历史创建审阅、复算 generation1/legacy 全部 anchored 记录、准确 generation2 claim/创建/回读/窗口收尾摘要，并要求旧槽位仅有 `claim.json`。fresh Source 双次全量观察必须保持原准确 Locked/v5 四资源、两策略、两角色、trust/attachment/版本摘要、Cell MISSING、authority ABSENT 和未执行/资源0原 fixture。两次完整管理清单必须只有退役目标，任何额外对象（包括 terminal）都阻断。准确 full ARN 双次 Describe/Original 模板核验必须稳定、AVAILABLE/root/non-nested、仅一个非替换 Operator policy Modify。UPDATE 来源由原已提交 request/receipt/准确 UUID 锚定，不伪称 DescribeChangeSet 有 ChangeSetType 响应字段。

删除前 exclusive mkdir + wx/fsync/readback 永久封存批准 manifest 和 fresh preflight；旧完整 review/template 原件也必须持续保留。过期、取消、落盘失败、拒绝、丢失响应或崩溃均不重放删除。提交不等于退役证明；另起 Source-only Inspect 必须证明两次完整空管理清单、准确对象缺失、Locked/原 fixture 不变。缺失但无永久 intent 不能接纳；仍存在为 `RETIREMENT_UNPROVED`。部分目录、未知文件、符号链接和外来 generation 阻断，不修复。

AWS 对 nested Change Set 删除有级联语义，因此不提供 nested 选项；删除旧 UUID 不能恢复，本地封存不等于恢复云对象。[AWS DeleteChangeSet](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeleteChangeSet.html) 本轮只读不证明 Source Delete 或未来 Create/Execute 写权限，不会为拒绝自动安装权限。

独立固定目录如下，**本轮均 absent**：

```text
.aws-sandbox/j5gj19-read-retirement/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000002
.aws-sandbox/j5gj19-read-comparison/9e6c381d768f09bb9f7d8498237512284ba992e8e411b58bae6432d73f53892d/slot-000003
```

generation3 fence 绑定 generation1、封存 generation2 和准确独立退役 proof SHA，每次核对实际旧目录与退役 intent，而非只信任摘要字符串。plan/claim/六步 journal 使用独立编译器和命名空间；所有候选/窗口争用唯一新槽位，只读不 mkdir，创建失败或 MISSING 仍消费槽位。跨代计划互相拒绝，原 J11/J17/J18 规则不放宽。共享管理读取器仅增加严格 generation3 入口，生产 renderer 不接纳读 Grant。

## 本轮真实只读核验

原件均保留于 `F:/ChatGPT_workshop`：

- `techlong-j5gj19-retirement-evidence-paths.json` 是全部历史原件的显式映射，无凭据。
- `techlong-j5gj19-retirement-code-review-readonly.json` 记录沙箱无法读取真实 Source 配置的阻断，`mutationPerformed=false`，不覆盖。允许读取实际登录配置后核对 Source 身份准确，再仅重做只读 Review。
- `techlong-j5gj19-retirement-code-review-source-readonly.json` 是成功的真实 Source Review；manifest SHA `09a887c9e820e73639988fc42158f7d5d5cefa780e21bf7c9ad39eb620418ff2`，窗口 `2026-10-04T05:30:04.405Z`–`05:35:04.405Z`（Winnipeg 00:30–00:35）。**它是实现核验的历史证据，不是删除批准，不能用于以后执行。**

当时仍为旧 Grant READY_UNEXECUTED、完整管理清单只有它、准确 Locked/v5、Cell MISSING、authority ABSENT、原 fixture 未执行资源0。独立进程重新编译 manifest、复算所有前驱并核对真实旧 slot 只有 `claim.json`，SHA 仍 `3f06d253646d29d77d7a9045cdb1a28098b442b1cc58ee9ca65c130b2186a71a`。闭合前驱 SHA `a9482c6a329a070c36bf4ac5a96baa06f8c4ef529741f539b1142d32acc3eddf`；新两个 registry 不存在，无永久占槽。

## 以后另行批准时的本地顺序

以下是命令模板，**本轮未执行任何写模式**。先完成代码推送，再准备 Source 登录和 MFA 应用，然后生成短时 review。保留全部历史原件、旧 wrappers 和 ledgers。MFA 不发到聊天。

1. 只读生成 fresh 退役 manifest：

```powershell
node --experimental-strip-types .\ops\aws-sandbox\scripts\s3-b5-arn-probe-read-comparison-retirement.ts --mode Review --evidence F:/ChatGPT_workshop/techlong-j5gj19-retirement-evidence-paths.json --output F:/ChatGPT_workshop/j19-fresh-retirement-review.json --acknowledge-read-only
```

2. 用户审阅准确删除对象、不可恢复删除、低成本非零费用和完整新 SHA，另行批准后运行：

```powershell
.\ops\aws-sandbox\scripts\Invoke-ReviewedReadComparison.ps1 -Evidence F:/ChatGPT_workshop/techlong-j5gj19-retirement-evidence-paths.json -Output F:/ChatGPT_workshop/j19-retirement-run.json -RetirementManifest F:/ChatGPT_workshop/j19-fresh-retirement-review.json -ApprovedRetirementManifestSha '<本次完整新SHA>'
```

最多一次 Delete，随后另起只读 Inspect，proof 输出为 `j19-retirement-run.inspect.json`；不自动 Create。只有 `RETIRED_LOCKED_VERIFIED` 能继续，拒绝/不确定/部分目录只读协调，不能重新运行 Delete。

3. 退役独立证明后，只读生成 generation3 创建审阅：

```powershell
node --experimental-strip-types .\ops\aws-sandbox\scripts\s3-b5-arn-probe-read-comparison-generation3-create.ts --mode ReviewCreate --evidence F:/ChatGPT_workshop/techlong-j5gj19-retirement-evidence-paths.json --retirement-proof F:/ChatGPT_workshop/j19-retirement-run.inspect.json --output F:/ChatGPT_workshop/j19-fresh-creation-review.json --variant EXACT_NAME_CONDITION --acknowledge-read-only
```

4. 用户另行批准准确新 creation SHA 后：

```powershell
.\ops\aws-sandbox\scripts\Invoke-ReviewedReadComparison.ps1 -Evidence F:/ChatGPT_workshop/techlong-j5gj19-retirement-evidence-paths.json -Output F:/ChatGPT_workshop/j19-create-run.json -CreationReview F:/ChatGPT_workshop/j19-fresh-creation-review.json -RetirementProof F:/ChatGPT_workshop/j19-retirement-run.inspect.json -ApprovedCreationReviewSha '<本次完整新creation SHA>'
```

只创建，不安装权限；另起只读 RecoverCreate（准确 singleton creation 状态最多等待40秒，MISSING 不创建/重试），再只读生成 execution review，显示新 SHA、到期时间和下一条命令，**不调用该命令**。任何回读/审阅失败不重放 Create，可以单独只读协调。

5. 用户审阅 manifest 绑定的 Grant Execute / 两种固定 MFA Operator Describe / 立即 Revoke 三项 action SHA，并另行批准，才运行显示的带 `-ApprovedManifestSha` 命令。没有额外 SHA Read-Host，唯一敏感输入是本地 MFA。CLI 仍严格重编译、读真实 ledgers、MFA 前后 fresh Source 预检、write-ahead 后单次提交；成功/失败都独立立即撤权，失去响应只读协调，`REVOKE_REQUIRED` 时只走另行批准的 revoke-only recovery。

全部输出是新绝对路径，不覆盖。5分钟安装批准、10分钟撤权余量、30分钟 policy 不延长；未占槽可另行 fresh 只读审阅但不能继承批准，已占槽不能这样恢复写操作。预算10 USD/月告警不是硬费用上限；低成本并非绝对零费用。所有 compatibility/readiness/runtime gates 保持 false。

## 定向验证

48项新增定向测试及相关回归合计173/173通过，覆盖准确目标/模板/根/清单/IAM 漂移、永久 archive/单次提交、丢失响应无重放、独立退役证明、旧记录和新固定围栏、跨代计划拒绝、创建后的只读协调、本地批准参数，以及 generation3 安装/两读/立即撤权/恢复回归。测试仅使用临时目录和内存 doubles，不当作云证据。TypeScript、定向 ESLint、PowerShell AST/参数集/错误 SHA 阻断和 management contract 验证通过；真实只读 Source 核验与独立复算如上。未执行全量 build/npm test/IAM simulation。
