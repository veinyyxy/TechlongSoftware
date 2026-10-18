# W5g：单次云端 VerifyInstall 待审范围与完整风险

2026-10-18，America/Winnipeg。承接 [W5f 已激活且独立核验](aws-auto-deployment-cloud-worker-w5f-activation-executed.md)。用户“开始下一步”授权本地实现和只读准备，**不是 workflow dispatch、环境批准或 Secret 值读取批准**。不修改已冻结的云运行源码 C、reusable R、dispatcher 内容或任何 IAM/Secret/数据库安装。

## 最小验收范围

本地入口 `ops/cloud-worker/verify-install-v5.mjs` 提供 Review、Dispatch、Inspect。Review 先核对准确 main/工作流/environment、W5f 资源及固定绑定元数据，生成有效两小时的 SHA 清单；无私密值、云写或新槽消费。Dispatch 只有获得该 fresh SHA 明确批准后才运行。

| 对象 | 固定值/上限 |
| --- | --- |
| GitHub repo/actor | `veinyyxy/TechlongSoftware`，repo ID `1323312747`，owner/actor ID `14145707` |
| 部署工作流 | `cloud-worker-execute.yml`，ID `388188162`，`ref=main`，mode 只准 `VerifyInstall`；job/manifest/manifestSha/execution/lineage 全空 |
| 冻结运行源码 C | `ac75c4bcbb856babc67d88b6e06212e981a25d90` |
| reusable R | `7c02d9db3a39fc2f926848a593eb804b642bd1e5`；当前 caller main 单独绑定 fresh 清单，不混为 C |
| environment | `techlong-sandbox-deploy`，ID `24613410405`；仅 main、reviewer `14145707`、admin bypass=false；须用户亲自批准 |
| S3 绑定版本 | `QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV`，准确 key/整文档 SHA 由 W5f ACK 固定，无 latest/自动接纳新版本 |
| worker | `TechlongSandboxGitHubDeploymentWorkerRole`，role ID `AROAV3GNMXTZK5O45RG24`；STS 会话 `Deploy-<runId>-1`，最多3600秒 |
| 固定数据库 Secret | `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/neon-control-v1-pVKVEV`，VersionId `ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e`，必须唯一 AWSCURRENT |

获批后最多一次 dispatch POST，用户一次人工 environment 批准；可信云路径最多一个 OIDC token、一次 STS 交换、一次实际身份读取、一次准确 S3 版本读取、一次上述 Secret 值读取、一个窄角色只读 catalog 事务。失败可在任一步提前停止，因此这些是上限，不是无论成败都必须读取。云端不读取控制 Secret/原私密包，不调用四业务函数，不创建/领取/完成 job，不写 DDB/S3/CFN/Neon，不访问应用，不签 JWT，不创建 Cell/ECS/ALB/Aurora 或改 TTL。

数据库连接只使用固定 Secret 中的专属窄角色，校验 TLS、端点摘要、真实 OID/ACL/函数合同；不是使用 owner 读取私密值。准备期对既有控制面 catalog 的 owner 只读核对与未来这一次真实窄角色认证分开计数。

## 单次提交、准确运行与独立回读

新独立永久槽：`F:/ChatGPT_workshop/techlong-cloud-worker-v5-verify-install-v1.permanent-slot.json`。Review 不消费。Dispatch fresh 校验、180秒内重读现状后，以 `wx` 永久占槽，落盘 intent；临提交重读 main 并再次检查 SHA/时效，最多210秒入场至提交。槽后本地错误即使尚未发出 POST，也不自动复位。

请求使用 GitHub REST API `2026-03-10`、`return_run_details=true`，只接受返回准确 run ID 和固定仓库 URL 的200 ACK；不以“最新 run”猜测，不用第二次 POST补救。[GitHub 官方 dispatch 合同](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)说明该选项返回 run ID/URL；无该选项的204不提供同样证明。意外204、网络超时/丢 ACK 或磁盘失败均停止，实际运行可能已创建；只读调查，不能重发、自动 rerun 或清槽。

有 ACK 后只核对那个 run：workflow ID、head SHA、main、manual event、actor/triggering_actor/repo ID、attempt=1。用户自己在该准确 run URL 审批 environment，控制器不调用批准 API。未完成的 run 只返回等待/运行状态；非 success 只记录失败，不自动取消/重跑。另起 Inspect 以保存的 dispatch 目录/ACK 为来源，不接受任意“最新 run”。

成功后必须只有一个准确 run/head 的 successful job，读取 GitHub job log 的受限临时 HTTPS 地址（凭据不转发到该地址），只提取唯一公开 proof JSON，核对 C、原76闭包、安装 SHA、run/head/attempt 和读取/写入计数。不存原始日志或签名下载 URL，不把“绿色”本身当验收证明。[GitHub workflow run 元数据](https://docs.github.com/en/rest/actions/workflow-runs)和准确 ACK共同支撑身份绑定。

## 完整风险和不保证事项

- **真实私密读取与凭据能力**：Secret 密码/DSN只在 AWS/GitHub runner/Neon TLS可信路径内存中使用，不输出/上传；提供者、runner、Actions/网络日志或被入侵依赖仍可能泄露。STS worker 凭据可用最多一小时，既有 IAM/数据库能力并非只读；只读约束来自不可变可信代码路径和审批，不是新建只读角色，也不保证管理员不可绕过。不会为本次探针新增或收窄 IAM。
- **两小时时效仅限制本地 dispatch**：它不是写入冻结云代码的强制执行期限。人工审批、队列和排队可延后；若超时未审批，请先只读核对，不直接批准。控制器不自动取消，GitHub 审批等待不等于 runner 的65分钟执行超时。若批准很晚，仍可能执行真实读取；无法凭聊天清单让旧 pending run自动失效。
- **非原子/竞态**：main、环境、IAM/Secret元数据和并发 GitHub 操作没有跨服务 CAS；提交前重读不能排除随后分支变化或另一个管理员手动调度。同工作流发现既有 run、非唯一/身份不符即停；本地槽不是云端全局幂等锁，人工/API绕过不在其强制范围。未知状态不能自动接纳。
- **不可重放**：一次 POST和新槽固定；失去 ACK不等于没发生。单次脚本失败、SDK传播/服务端内部重试、自动 Node patch、API版本不支持、runner/SQL超时都可能留下待审/失败运行；不自动 rerun、取消、删除、撤权、轮换、回滚、补齐或复位。旧四槽、所有失败原件保留。需要新的有副作用处置时另审，不借新目录重放旧槽。
- **证据边界**：日志提取只保存经固定字段/计数检查的公开 proof，不能保证提供者完全无私密日志。固定 commit/action/依赖锁降低变更面，不是供应链绝对保证。成功仅证明这一次身份、固定绑定、数据库 Secret和目录连接；不验证 control Secret、应用通信/初始化、claim/complete 或真实租户部署。
- **费用/范围**：GitHub Actions、Secrets Manager、S3/STS/网络/数据库提供者可能收费或记录审计。接受低成本但非零费用；50 USD/月是目标不是硬 cap，既有 Cell/ALB/Aurora/Secret 不因探针自动停费。没有授权创建新收费 Cell 或删除已有资源省钱。
- **权限布局保持**：不改环境保护、OIDC subject/trust/inline/boundary、Secret版本或策略、Neon角色/函数/权限。单人 self-review 与既有公开main未保护风险沿用 W5f，不能称为双人分权。不重开 F3c9/Sites/观察器支线，不重用旧成功job或延长TTL。

## 当前准备证明和命令

本地新9项加原14项定向测试23/23、定向eslint零警告和类型检查通过；仅控制器为新源码，云端 C/R 和110原 pins保持。初次在线准备遇 Source `CredentialsProviderError`，没有新槽或云写；用户刷新后只在最终clean main重新执行只读 Review，不重放写入。冻结云 runtime的旧 CI证明保留，不将本地 mocks冒充新的云端OIDC成功。

```powershell
# 准备；任何回显SHA都不自动构成批准。
node --experimental-strip-types ops/cloud-worker/verify-install-v5.mjs --mode Review --output F:/ChatGPT_workshop/techlong-w5g-review-<fresh-id>
# 仅明确批准 fresh SHA 后，最多一次POST；不要手动从Actions重复运行。
node --experimental-strip-types ops/cloud-worker/verify-install-v5.mjs --mode Dispatch --manifest F:/ChatGPT_workshop/techlong-w5g-review-<fresh-id>/manifest.json --approved-sha <FRESH-SHA> --output F:/ChatGPT_workshop/techlong-w5g-dispatch-<fresh-id>
# 用户批准准确run的environment后，独立只读检查；不rerun。
node --experimental-strip-types ops/cloud-worker/verify-install-v5.mjs --mode Inspect --dispatch-directory F:/ChatGPT_workshop/techlong-w5g-dispatch-<fresh-id> --output F:/ChatGPT_workshop/techlong-w5g-inspect-<fresh-id>
```

完成后再准备一个新的准确 held job 的云 Review/RunOnce/独立 Inspect。当前阶段不部署；下一次批准必须明确此 fresh SHA、单次 dispatch、固定 Secret读取和人工环境批准的完整范围/风险。
