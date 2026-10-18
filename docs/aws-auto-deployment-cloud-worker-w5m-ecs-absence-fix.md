# W5m：仅修复 ECS 服务缺失响应，不发布或重跑

2026-10-18，America/Winnipeg。用户明确要求“继续仅修复这项代码并测试”，允许结束 W5l 失败运行的 main 冻结，仅实施本页小修复、回归及交接。不安装权限、不改变两份已发布部署工作流、不创建发布材料或 Change Set、不 dispatch/重跑 Review、领取任务或部署。

## 原因及保留的失败证据

W5l Review-v3 的准确运行 [39149802733](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39149802733) 在 runtime 失败。OIDC/STS 成功；准确会话读取过一次获批固定 DB Secret，业务/任务摘要保持且未生成成功 manifest。不能把这次失败记为“没有读取过 Secret”。

审计请求 `d320a04a-b459-4e92-9c6b-b9c0aae5fe0a` 显示固定服务的 `ecs.ListTasks` 返回 `ServiceNotFoundException`。Source 独立只读诊断复现 `DescribeServices` 为准确 ARN 的唯一 MISSING、services=[]，而同服务 ListTasks 返回 HTTP400。原 inspector 将它直接放在 Promise.all 中，异常未处理，导致读取完成前失败。这不是缺少 IAM Allow，不通过扩权解决。

完整原件与 11 个摘要保留于 `F:/ChatGPT_workshop/techlong-w5l-failed-checkpoint-20261018-a.json`，其原始 SHA-256 为 `f7174f3e2b0d12580fbf107bd6b8cb664168c200c6fe64a12a31ba6e7ad00357`；此前等待、运行、诊断和 v1/v2/v3 永久槽均不改写。原异常只输出泛化安全标记，审计有摄取延迟；证据能确定该代码阻断点，但不能保证没有其他后续问题。

## 唯一代码修复

`ops/cloud-worker/aws-initialized-workload-v5.mjs` 增加同服务的两读封装，仍各发送一次 DescribeServices / ListTasks；生产路径仍先证明 Cell 正常且空闲、固定元数据匹配，再进行本读取。

只有同时满足下列条件，才把 ListTasks 的缺失异常表示为 `{taskArns:[]}`，交给原 namespace 门禁继续核验：

1. DescribeServices 的 services 是空数组，failures 是恰好一项的数组，准确账号/集群/服务 ARN，reason 严格为 MISSING。
2. 对同一固定集群、同服务、desiredStatus=RUNNING 的 ListTasks 返回准确错误名 `ServiceNotFoundException`，HTTP 状态严格为 400。

任一条件不符均保留原异常，不重试，不按消息模糊匹配。ACTIVE 或 INACTIVE 服务不能佐证这项缺失异常；原 INACTIVE/零容量配合成功空 ListTasks 的路径保持不变。正常返回的 tasks、nextToken 和异常结构原样保留供原检查拒绝，不能通过兜底吞掉分页/已有任务。权限拒绝、集群缺失、节流、中止、超时和网络错误继续失败；DescribeServices 自己失败也不会被忽略。

其余 namespace/前驱/监听器/authority、IAM、Secret、镜像扫描、DNS/mTLS、超时/lease/永久槽及 CreateStack 门禁不变。云闭包仍 76 文件，仅 provider 一项变更，候选摘要为 `70ee60eb7c5d3a7144a08c33587d81ef255a5f0126107f03b85541b7e7f961ac`；本地 activation ROOT 常量随之绑定此摘要，不代表已更新运行中的版本。

## 验证与范围

新增 `tests/cloud-worker-ecs-absence-v5.test.mjs` 八项检查，覆盖真实响应组合、准确 SDK 请求、畸形/混合/错误 ARN、ACTIVE/INACTIVE、权限/集群/网络错误、状态码、DescribeServices 失败和生产路径门禁；与 DNS/发布/调度/激活的 53 项回归共 61 项本机通过。首次测试使用根目录 SDK 的 instanceof，因独立 runtime 的 SDK 副本不同而失败；测试改为解析 runtime 自己的依赖后通过，没有改包版本或生产行为来迎合测试。

无 AWS portable CI 增加该专项测试；仅 contents:read、无 AWS 凭据，不是部署工作流。类型检查/定向 lint 及最终 main CI 分别核验；CI 原件在新的本机 F 盘验证记录，不能把本机通过等同真实云 Review 成功。

本阶段不发送 AWS/Neon API 请求或读取私密材料，不更改安装记录、已发布 C/R、trust、任何旧槽或业务；只提交推送代码、测试及追溯文档。后台用户 `.vscode/settings.json` 保持不动。

## 下一步边界

当前云端仍固定 C=`e55367c370ca5aa883d8a7e1342514fc3f34c442`、R=`46312fff06d60e9e4ca96be6bb8d82ce1ce3d109`，不会因 main 修复提交自动取得新代码。旧 W5k 发布槽已消费，旧 W5l controller 固定旧闭包/历史 pins，仍应拒绝当前候选；本轮不放宽它们、不自动套用旧批准。

若用户之后要求推进，下一才准备新版本的受审发布入口与 fresh 清单，再分别批准新 C/R 工作流/trust-only 更新及新独立 Review 尝试。不得重跑 v3、复位旧槽、直接安装权限或从不存在的成功 manifest 准备 RunOnce。本轮到代码/测试/无 AWS CI 验证结束，不包含这一步。
