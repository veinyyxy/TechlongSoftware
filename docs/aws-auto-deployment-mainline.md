# 当前主线：先完成自动部署，再整套迁到 AWS

最新里程碑（2026-10-17）：**W5d集中安装材料已准备，仍未安装。** 28次AWS SDK只读、GitHub配置和Neon catalog确认候选名为空/旧IAM不变，准确W4c栈七资源CFN已删、父Cell保留，不声明namespace全空/停费。真实immutable OIDC subject与旧task宽Secret权限已纳入候选；五资源foundation、Neon四函数、两个新Secret先资源策略隔离后写值，受审workflow尚未发布。AWS只读验证、42项云回归及PG18十二组通过，原始证据留存。当前design SHA不是执行批准；下一只做一次性安装入口和准确源/动作绑定，再给fresh集中安装确认，不再增加盘点切片。见 [W5d范围和风险](aws-auto-deployment-cloud-worker-w5d-install-review.md) / [原件摘要](../ops/aws-sandbox/reviews/cloud-worker-w5d.prepared.json)。以下里程碑保留追溯。

最新里程碑（2026-10-17）：**W5c单一云Review/RunOnce/独立Inspect候选已收口**，连接W5a永久journal、V5 SDK/最小Secret、四函数Neon窄权限、同任务原子完成及S3条件写回执；成功沿革可继续。run39073640808云端36项、真实PG18十二组、75文件闭包及原ZIP/五材料核验通过，旧99 raw pins保持。当前仍未安装身份/Secret/权限/付费资源，不代表实际云部署已启用。下一只做集中安装盘点与具体范围审批，不再加观察器切片。见 [W5c实现及完整风险](aws-auto-deployment-cloud-worker-w5c.md) / [原件和准确继续位置](../ops/aws-sandbox/reviews/cloud-worker-w5c.prepared.json)。下方W5b里程碑保留追溯。

最新里程碑（2026-10-17）：W4c真实闭环及W5a云永久journal候选已完成。W5b独立SDK云provider、准确W4c沿革公开capsule和最小JWT/mTLS Secret接口已完成，本地29项/Linux 20+8项及60文件闭包通过、原始回执独立核实，保留旧99 pins。云执行入口尚未启用；下一直接收拢一个Review/Run/Inspect执行根及最小Neon权限合同，不扩观察器切片。无新增权限/资源安装或真实部署，不重复W4c、不扩F3c9。见 [W5b实现、验证与唯一继续位置](aws-auto-deployment-cloud-worker-w5b.md) / [W5a已完成](aws-auto-deployment-cloud-worker-w5a.md)。首轮Actions单次worker，最终整套AWS托管仍在其后。

2026-10-16，按用户最新决定更新。**不在 Sites 上线，不修改 Sites 托管配置、不推送 sites remote。** 保留现有兼容代码和托管身份，避免把“现在不发布”扩大成未经批准的删除/重构。F3c9 等支线继续冻结，历史文档用于追溯，不再作为下一步任务来源。

## 顺序与完成标准

1. **先打通平台触发闭环（W4c已完成）。** 本地平台 → 现有 Neon 控制面的一条待审任务 → W4 单次 worker → AWS 实际承载 → 两个认证 GET → 同任务结果回显及独立 Inspect。准确同job已成功，历史入口与消费槽保留，不作为下一条请求的可重放根。
2. **再把部署执行自动化。** 上述验收通过后，将准确 job 的 Review/批准/执行/Inspect 收拢到同一条操作流程；再把 worker 从依赖本机 AWS Login/本地私密包迁到受限云执行身份及受控材料。新增 IAM、云运行环境与凭据迁移按实际资源范围另审，不复制长期 AWS key，不先开放全局队列。完成标准是批准后无需人工逐条跑部署命令，失败/未知有明确状态且不偷偷重试。这才是本轮目标的自动部署完成，不把“按钮已出现”或“本机 CLI 成功”当作最终完成。
3. **最后整套系统在 AWS 上线。** 平台前端/API、部署执行器、租户应用和最终数据库承载统一纳入 AWS 发布方案，配好 `techlong.cloud` 的子域、HTTPS、登录及 Stripe 回调、日志、备份和恢复验收。本地平台/Neon 是当前过渡，不把它们当最终 AWS 交付。平台目前有 Cloudflare runtime 依赖，届时需真实 Node/AWS 适配；本阶段不提前重写。Aurora Express/Full 快速切换方案保留。

不把第三步提前做成另一个发布项目。当前不新增 Sites 版本、不为平台再创建一套 ALB/ECS/数据库，也不重新启动旧 generation/IAM 探针。

## 沿用边界

- 50 USD/月是预算目标，不是硬停费保证；已有父 Cell/数据库可能持续收费，不因本地平台停止而停费。
- 代码提交和推送按既有授权直接到两个仓库 main，不新建分支。实际请求写入、新 AWS 权限、部署和私密包读取仍按明确范围批准。
- 保留已初始化库、默认 store、现有业务记录、旧 ready_at 和成功 job。先做已初始化租户恢复，不偷偷回到首次初始化/重设密码。
- W3 原承载固定于 **2026-10-16 18:42:30 UTC / 13:42:30 CDT** 到期，不续期；到期不等于已清理。W4 执行前仍须 AWS 证明准确前驱已退役及 namespace 空，无自动删除。

## 唯一继续位置

见 [W5d集中安装材料](aws-auto-deployment-cloud-worker-w5d-install-review.md)。执行根/合同和安装盘点已完成，下一将已列明的安装顺序封装为一次性入口，绑定不可变workflow commit、fresh prestate和源/动作SHA，再集中确认安装；不重复W5b/W5c验收或重开观察器。当前design-review不可执行，不误当用户已批准写入。不要从README旧历史/W4c入口重新登记请求，不制造新job/部署SHA，也不改旧前驱重放W4。实际云运行仍需准确新held job及fresh单独审批。
