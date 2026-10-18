# W5p：DescribeTaskDefinition 单项读取授权修正（仅准备，未执行）

2026-10-18，America/Winnipeg。用户同意继续准备 W5o 失败后的这一项权限修正清单；本阶段仅编码、测试、文档和只读 Prepare，不修改 AWS、不重新调度 Review、不领取任务或部署。为绑定新的待审源码，仅结束已失败 Review 的 main 冻结，旧原件和槽保持。新入口 `ops/cloud-worker/task-definition-permission-local-v5.mjs` 的 Apply 必须等待准确 fresh SHA 单独批准；本轮不运行 Apply。

## 已确认阻断与原件

W5o Review-v4 `39157727313` / attempt 1 / caller `8fe4f9de21bd8c5d47db3f98d53ec4e6d0873f5e` completed/failure。准确会话的 STS 登录成功，读取了固定 DB Secret 一次；随后 `ecs:DescribeTaskDefinition` 的 request `f5db919f-8ae1-4f2f-8029-cf6f0fd38730` 被 AccessDenied，报告缺少 identity-based Allow、授权资源为 `*`。现有 inline 与已安装模板一致，未发生未批准漂移；boundary 默认 v1 已含该 action。原任务/九行/四 job 队列摘要未变，准确私有 S3 前缀版本及删除标记为空，没有云 manifest，不得准备 RunOnce。

AWS [ECS 授权动作表](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecs.html)中该 action 的 resource types 为空；[官方授权规则](https://docs.aws.amazon.com/service-authorization/latest/reference/reference_policies_actions-resources-contextkeys.html)要求此类 action 使用 `Resource: "*"`。当前 ARN 级 Allow 因此无效。该确认不保证没有其它并发或后续阻断。

审计事件的 requestParameters 实际为 null；原诊断中的 exactPredecessorTaskDefinition=false 不表示请求读错目标。冻结代码路径指向准确前驱，只能作代码推断，不能冒充 CloudTrail 保存了请求正文。Source 独立读取锚定前驱 :5 为 INACTIVE、投影摘要匹配；Source 成功不是 worker 权限重放或部署成功证明。初次空 CloudTrail 列表是入库延迟，后续精确会话/STS 原件补齐而未覆盖旧文件。

继续入口固定核验：

- `F:/ChatGPT_workshop/techlong-w5o-failed-checkpoint-20261018-a.json`，原始 SHA `917b7d48df2f364d0d2f60e3d29815aef0f1d3c24284b69be72b6429635eb0ab` 及八份原件；再核对 dispatch 检查点的十五份原件。
- `F:/ChatGPT_workshop/techlong-w5o-review-diagnosis-20261018-a.md`，原始 SHA `0cd3e7a586d7d3019f3e8f6501fdac2453a1e2d4e78b094d9ae1a1085dac0c99`。
- W5o 获批 manifest/body SHA、159 个当时 Git pins，再比较当前源码，仅允许 README/主线交接和无 AWS CI 新增测试三项变化；W5n 27 原件、旧 152 pins、W5m/W5l 及更早沿革继续复用原核验，不改旧入口/记录。

## 唯一待批准变更

现有 foundation `techlong-sandbox-cloud-worker-foundation-v5` 的 `WorkerRole`（角色 ID `AROAV3GNMXTZK5O45RG24`）中，唯一 inline `ExactSandboxWorkerV5` 的一条声明：

```json
{
  "Effect": "Allow",
  "Action": "ecs:DescribeTaskDefinition",
  "Resource": "*",
  "Condition": { "StringEquals": { "aws:RequestedRegion": "ca-central-1" } }
}
```

只将原 `arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:*` 替换为上述 `*`。完整模板其它字节语义均不变，源模板规范摘要固定为 `b9dc0f524b2aeafb8e7986b2a6f0fb985392ce0b9f956c2ba10e4d9206342a41`。action、区域条件、其它 statements、trust、boundary 默认 v1、角色/五资源身份不变，不新增 IAM 资源或增加写操作权限。

**这仍然是实际读取能力扩张，而且持续生效，不自动撤权。** 该 API 不能在 IAM 中按此租户/任务 ARN 隔离；角色可能读取本账号 ca-central-1 其它任务定义，其环境配置可能包含敏感字段。程序继续只请求准确目标，不等于 IAM 层提供了租户过滤，不能称为无权限扩张。

既有云运行 C=`d8cb99693231770de6a5d73e02dda42b87035714`、R=`7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c`、76 文件闭包 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac` 保持，不更新两个部署工作流、provider、ROOT、安装 renderer 或依赖，不需要重新发布 C/R。

## 受审顺序和核验范围

1. 最终 clean main 的 portable/continuation 两项无 AWS CI 必须 attempt=1/completed/success。Prepare 复用原本机只读 preflight：GitHub main/工作流/环境/OIDC、现有完整布局/固定 Secret 版本元数据/Neon 目录及原 held job/队列快照；不读取 AWS Secret 值或连接 Aurora。
2. 另只读保存准确 CFN/IAM 基线：五资源 physical ID 摘要、模板/inline/trust/boundary/角色标签摘要及实际 source 身份。清单两小时有效；Apply 另批后先重建完整计划并 fresh 回读，三分钟内一致才消费独立永久槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-task-definition-read-correction-v1.permanent-slot.json`。
3. 最多一次 CreateChangeSet（UPDATE、inline 完整模板、CAPABILITY_NAMED_IAM）。只采用本次 ACK 的准确 ARN，先落盘，再核对完整模板及唯一 `WorkerRole / AWS::IAM::Role / Modify / Replacement=False / Properties.Policies`；细节仅 DirectModification/Static/Never。trust、boundary、替换、其它资源、分页或漂移全部拒绝。
4. 再只读核对旧 CFN/IAM/Git 布局；最多一次 ExecuteChangeSet（DisableRollback=true），ACK 先落盘，等待 UPDATE_COMPLETE，再核对新模板/inline 和其余身份摘要不变。每写前检查准确批准、固定源码、远端 main 和原二十分钟执行窗口。SDK maxAttempts=1，任何失败停止，不补齐/重发/撤权/回滚。
5. 成功或失败均新进程 Inspect。它只读核对准确 CFN/IAM、五资源身份和 Git main，区分旧/新/更新中/未知或漂移；只有新布局完整一致才成功。不调用 worker、不验证实际 DescribeTaskDefinition 权限生效，不声称租户健康或部署成功。

顶层 AWS 写上限为 CreateChangeSet 1 + ExecuteChangeSet 1；CloudFormation 内部 IAM 更新不是另一个可自由调用的入口。没有 Git 工作流发布、Secret/S3/Neon 写、Secret 值读取、job 领取、CreateStack 或 Review dispatch。独立 Inspect 的 Secret/catalog/job 不是再次回读，相关事实仅来自执行前 preflight；不能据此排除执行期间其它系统并发漂移。当前代码/七项新边界及相邻回归共 72 项本机通过，最终 main CI 和实际云执行仍各自核验。

## 完整风险

- 一项无效 ARN 级 Allow 变为可生效的区域级读取权限，可能暴露其它租户任务定义及其中敏感环境配置。该 action 无资源级隔离，不能通过增加未经支持的 ecs 条件伪装限制；区域外依旧不允许，其他读/写能力不扩大。
- 改动持续存在，不自动撤权；已有有效 STS 会话可能获得新增读取能力。IAM 传播/实际授权不保证即时生效，新布局回读并非调用者访问验收。后续云 Review 仍须新具体批准及人工环境审批。
- CloudFormation、IAM、GitHub、Neon和本机非原子，没有跨服务 CAS；main 未保护，核对后仍可并发漂移。Create/Execute ACK 或落盘可未知，可能遗留未执行 Change Set，或 IAM 已扩大但栈 UPDATE_FAILED/回读失败。
- DisableRollback=true，失败不自动回滚、撤权、删除、补齐、复位槽或重试。固定永久槽可能已消费但没有成功修正；后续人工处置须另审，不保证清理或停费。CFN 内部更新和清理仍可能产生影响。
- Source AWS Login 自动刷新可失效，批准/二十分钟执行窗口可在过程中到期；未知结果只读 Inspect，不重新提交。独立回读只覆盖本页明确范围，不能保证没有后续门禁问题。
- 本机文件/Git/hash不是云端签名或防管理员篡改保证；原始提供者/管理员日志风险仍在。本入口不输出 Secret、原错误正文、任务定义正文或签名下载 URL；固定证据摘要不能证明绝对无泄露。
- 50 USD/月是目标不是硬 cap，既有资源和 API/CI/存储等可能继续收费。此项修正不创建付费 Cell，也不保证绝对零费用、自动部署完成或整套系统上线。

## 命令与下一步

代码/文档按既有授权提交推送，最终 CI 成功后只读 Prepare：

```powershell
node --experimental-strip-types ops/cloud-worker/task-definition-permission-local-v5.mjs --mode Prepare --output F:/ChatGPT_workshop/techlong-w5p-review-20261018-a
# 准确 fresh SHA 单独批准后才允许；本阶段不运行：
node --experimental-strip-types ops/cloud-worker/task-definition-permission-local-v5.mjs --mode Apply --manifest F:/ChatGPT_workshop/techlong-w5p-review-20261018-a/manifest.json --approved-sha <fresh-sha> --output F:/ChatGPT_workshop/techlong-w5p-apply-20261018-a
# 成功/失败均只读，不重跑 Apply：
node --experimental-strip-types ops/cloud-worker/task-definition-permission-local-v5.mjs --mode Inspect --run-directory F:/ChatGPT_workshop/techlong-w5p-apply-20261018-a --output F:/ChatGPT_workshop/techlong-w5p-inspect-20261018-a
```

目录必须全新、直接位于 F 基目录且前缀 `techlong-w5p-`。任何过期或事实变化都只读刷新清单并请新 SHA，不转移旧批准。

本轮终点是待审单项修正清单，不执行修正、不新开 Review 槽。未来修正成功后，旧 W5o dispatcher 的布局核验仍硬绑定旧 inline，会拒绝新状态，不能直接重跑。下一阶段仅将本机核验显式绑定这项正确新 policy/新独立 Review-v5 槽并另审，保留旧检查/记录，不改云 C/R、不放宽资源/业务准入、不重做发布或扩 F3c9。部署/RunOnce 仍另审。
