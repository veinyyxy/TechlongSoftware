# K3r 实际结果：恢复与公网检查成功，独立 Inspect 停止

2026-10-16 Winnipeg。用户“确认”后，按清单 `10242ff57c631458705efde250ea2805786d07d22965e263b1e79630e965b148` 执行了一次 Run 和一次独立 Inspect。**Run 成功，但不能宣称完整独立验收通过**：Inspect 在只读阶段返回未分类错误，永久槽已消费，未重跑、补写或重新创建。

## 已发生的动作

| 时间（CDT；UTC 加5小时） | 实际证据 |
| --- | --- |
| 08:37:01.033 | 新执行起点与完整 request/hash 落盘；新 TTL 唯一固定到 **10:37:01.033**，不续期 |
| 08:37:01.424 | 唯一 CreateStack 获新准确 UUID `ab4aa8c0-c966-11f1-b068-0ecbbd896a2b` |
| 08:39:11.195 | Run 的真实元数据观察确认七资源 CREATE_COMPLETE、task definition **:3**、1 running/healthy task 与 healthy target，实际 digest `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`；35 SDK/11 CLI/1 Neon只读事务 |
| 08:39:12.053 / .475 / .734 | 三个且仅三个公网 GET 依次通过：`/health` **200**、`/ready` **200**、`/api/merchant/stores` **401**，准确响应验证为 true，TLSv1.3/证书验证通过；无认证、重试或正文留存 |
| 08:39:13.459 | 唯一 Neon SERIALIZABLE 五语句事务获 ACK，更新 **1条 deployment 的 outputs/updated_at** |
| 紧随 ACK | 同一 Run 的只读回读通过：新 stackId/receipt、原完整 outputs/人工 ready receipt、九行受限摘要、身份/endpoint/catalog 通过；随后 Run 成功退出 |
| 另进程 Inspect | 只读阶段 `HOSTING_RESUME_LOCAL_OR_PROVIDER_FAILURE`，退出码1；只保存 binding/failure，没有完整 metadata/state，不冒充独立通过 |

准确新栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/ab4aa8c0-c966-11f1-b068-0ecbbd896a2b`。

准确 task definition：`arn:aws:ecs:ca-central-1:402010193138:task-definition/tenant-9c5ee9e64509dcad-task-definition:3`。公开入口仍为 [first-acceptance.sandbox.techlong.cloud](https://first-acceptance.sandbox.techlong.cloud)，上表是观察时点，不是持续可用保证。

Create request SHA `0fb05e4affb0a4a6195bc119b65588bf65996e7695e178fcca7022eb95cf9b60`；事务 program SHA `d877757b4c81eb83a87f8fee9cd0803945f9cbaf60e2b803ea65c7b270b82d3d`；新 receipt SHA `707c3feaf2a26ad1916b1c4c397ee390bb892d425bb21643fae67357ac1d9cce`。

## 保留的不变量和证明边界

原数据库和初始化结果保留，**没有第二次 provision**。instance 仍 active，deployment 仍 ready，job 仍 succeeded，attempt1/max1、lease 清空、原 plan/错误/幂等键/generation/epoch/authority不改。原 K2c outputs 摘要 `ec32e68f8950c97a05e300041ff17349905619411337b1c397dd33fb4c3e446e` 完整嵌入 previousOutputs；新 outputs 6660字节，摘要 `71ba94ebbb32a0940814c1109e6bc7886ec9e6ec7fdadba029b06601e5b9369a`。原人工归因不被伪装成自动 worker 成功。

本轮操作器私密包/Secret值读取、直连Aurora、应用POST、IAM/DNS/DDB写及重试均0。运行 task 自身按既有配置读取 Secret、访问 Aurora、写日志；不是全系统零私密读取/数据库活动/费用。有效配置与准确 store/owner 的认证证明仍为 K2b/K2c 历史，本轮新增的是实际新承载和公开 readiness/缺签名401证明；未验收商户正向登录、浏览器/CORS、商品/订单/支付，亦未证明无人值守全链路。

## 独立核验失败：已知与未知

Inspect 已通过本地 manifest/code/execution/program/public proof/两个已消费写槽关联，随后消费唯一 inspect 槽并进入只读观察。失败回执没有保存底层 exception name、provider request ID 或具体读步骤；仅凭此回执**无法区分凭据、网络、限流、数据库或其他运行时原因**。不把猜测写成根因，不声称凭据一定过期或平台提交失败。

失败后只做本地文件复核：重新计算当前全部代码绑定、确定性 execution、事务 program/public proof 关联并用原 validator 检查 Run 已保存的 after-state，均通过。**这不是新的云/Neon观察，也不能替代独立 Inspect。** 未再联网重放 observer/SQL/HTTP，原失败证据不覆盖，三个永久槽全部保留。

## 证据与唯一继续边界

[执行摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-k3r-hosting-resume.executed.json)保存 Run 18份、Inspect 2份和3个永久槽，共 **23份原件 raw SHA**；[批准前准备摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-k3r-hosting-resume.prepared.json)及其8份历史原件、原冻结代码/风险和旧阶段记录保持。实际20参数/完整模板只在本地原件，不入Git。

- Run 原件：`F:/ChatGPT_workshop/techlong-express-k3r-run-20261016-r1`。
- Inspect 原件：`F:/ChatGPT_workshop/techlong-express-k3r-inspect-20261016-r1`。
- 三永久槽：`F:/ChatGPT_workshop/techlong-express-k3r-hosting-resume-v1.{permanent-slot,write-slot,inspect-slot}.json`，已消费，**原 Run/Inspect 命令不可重放**，不能因审批尚未过期而再执行。

下一步只准备一项**新的窄只读诊断/验收范围**：保留本次失败，提供脱敏错误类型/读步骤/请求ID诊断，绑定这个准确新 UUID 和已提交 receipt，核验当前承载及一行平台结果；不再创建、provision、补写、读私密或追加应用GET。若运行期限已过，转为退出盘点，不能刷新时间戳当作仍运行。不要恢复F3c9/Grant/generation支线或制造新付费Cell。

固定到期为 **2026-10-16 10:37:01.033 CDT / 15:37:01.033 UTC**；原 Janitor 保持，但本轮没有验证新UUID的到期删除、父Cell/Aurora/Secret全退出或实际停费。50USD/月仍是目标非硬上限。未调用删除、自动续期或新增监控；后续任何删除/平台终态协调仍需准确范围另批。
