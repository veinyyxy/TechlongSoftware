# W5e-C1 已完成：Locked 安装与独立核验通过

2026-10-17 Winnipeg 23:17 CDT（2026-10-18 04:17 UTC）。用户确认新清单 `0f0e2c02b2c8a20d0cefd2cc8097de939a654fbfd6664dc720fdbfc0ca6d23a5` 后，**一次 ContinueLocked 成功，另进程 Inspect 成功**。这是Locked安装完成，不是自动部署已启用；没有新租户或承载部署。[原受审范围与完整风险](aws-auto-deployment-cloud-worker-w5e-neon-continuation.md)保持，不改写旧失败结论。

## 实际效果

- Source仅一次读取原数据库Secret准确固定版本 `ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e`；版本/JSON/endpoint/TLS/密码形状验证通过。**数据库Secret写0、新密码生成0**，复用R1保存的原密码。
- 原私密包新读取/公开指纹和原ACL校验1次；只使用最小控制材料，不签JWT、不发应用控制HTTP/Stripe请求，不把原整包或私密值保存到回执。
- 控制Secret仅一次Put，固定版本 `2854e7b6-6c3c-41be-a5d8-b87dd9d98810` 获ACK，先保存 `control-api-ack.json`，第一轮只读发布核验即通过。没有用到额外退避/观察轮次或重发Put，不能据此补推R1的唯一故障原因。
- 一个Serializable Neon安装事务成功获COMMIT ACK，先保存 `neon-commit-ack.json`；随后用同一固定密码完成一次新窄角色的真实只读catalog认证。原密码接口在真实Neon执行成功，未关闭provider hook；这不替代将来云端OIDC、Secret读取和实际worker执行验证。
- 新角色 `techlong_cloud_worker_v5` OID `163840`，schema OID `163842`，owner `16392`；四函数 read_state/claim/lease/complete 的OID分别 `163843`/`163844`/`163848`/`163852`。实际源码/ACL/owner/OID和窄权限合同核验通过：LOGIN但无继承、超级用户、建库、建角色、复制、BYPASSRLS、成员资格、通用表/列写读或schema CREATE；仅四函数窄能力。
- 独立新进程Inspect再次确认准确角色/函数源码与权限、两Secret完整版本集各唯一AWSCURRENT、资源隔离策略及基础栈Locked布局。该进程的Secret值读取/原包读取/写入均0，不重复密码认证。原公开表/列权限、表ACL、旧触发器、旧definer及default ACL保留。
- 未改IAM/资源策略/GitHub设置，未建/删AWS资源、创建job、调用业务函数或部署workload；authority/原store/ready_at/历史未触碰。本轮无需撤权动作；没有自动清理/回滚、补齐或重试。

## 安装绑定及仍关闭的入口

[公开实际绑定](../ops/aws-sandbox/reviews/cloud-worker-v5.installed-binding.json)的canonical SHA为 `0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1`。其中只有ARN/版本/OID/公开摘要，不含主机明文DSN、密码或PEM。

基础栈UUID `308174f0-ca9e-11f1-a04d-02569e9287b5`、worker role ID `AROAV3GNMXTZK5O45RG24`、journal table ID `ea69c69e-1c48-481a-83f0-36393c196d9f`均未替换。原deny-all OIDC trust、inline/boundary v1、DDB删除保护/禁TTL和私有S3保护保持；旧IAM布局回读未变。

**部署worker workflow/OIDC尚未激活，公开绑定尚未发布到S3，没有云端worker会话。** 现有CI工作流仍仅测试候选。`installed=true`不等于 `runtimeEnabled=true`，也不证明GitHub角色可读Secret或能自动部署。

Neon LOGIN和四函数现在真实存在，claim/complete仍具有受限业务写能力，不应误称为“纯只读安装”。材料已在受控Secret中持久化；没有禁用/改密/自动撤销。现有Secret/API/原Cell、ALB、Aurora等可能继续收费，50 USD/月为目标而非硬上限，未自动删除资源停费。

## 原件与不可重放

- 准备、执行、独立回读目录：`F:/ChatGPT_workshop/techlong-w5e-continuation-review-20261017-a`、`techlong-w5e-continuation-run-20261017-a`、`techlong-w5e-continuation-inspect-20261017-a`。
- 新永久槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-neon-continuation-v1.permanent-slot.json` raw SHA `1b35a1261e7df3c1f1dc81d8d9095f0a646130ab761bccbb614f940d8f1da0fa`；原安装槽/R1槽保持，三槽均不得自动复位或重放。成功不产生第二次执行授权。
- [机器执行证据及23份公开回执/槽哈希](../ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.executed.json)。纯本地独立重构 `F:/ChatGPT_workshop/techlong-w5e-continuation-execution-verified-20261017-a.json` raw SHA `2fa63beb16632014339253cc88b31ea697ced6c46644dfad73685bf304507793`；核对107源码、旧25原件、R1的14份原件/槽及99旧源码保持。它自身的网络/私密读取/外部写0，不是又一次云端观察。
- [候选CI和首轮CI修正记录](../ops/aws-sandbox/reviews/cloud-worker-w5e-neon-continuation.prepared.json)、原439ab7dc安装失败与R1部分结果都保留。没有为了收尾改旧执行源码/风险文件。

## 唯一下一阶段

准备一个集中的**激活审批清单**：将这份实际ID绑定接入准确GitHub environment、SHA-pinned reusable workflow、OIDC trust和受控公开绑定发布；逐项列出真实GitHub/IAM/S3变更及失败边界，再按新的source/action/fresh SHA批准执行。不要再做旧安装恢复、Grant generation、模拟或观察器支线。

本次批准不包含上述激活、再次读取Source私密材料、业务函数调用/新job、运行云端worker或再次部署租户。先完成受控激活和云端Review验证，实际RunOnce仍按准确任务、资源、期限和费用范围另批；不重复初始化/seed旧数据库，不先迁整个平台。
