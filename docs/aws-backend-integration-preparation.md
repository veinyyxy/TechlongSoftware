# 后端联调/CORS：当前最小准备与继续点

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)，承接[已完成的客户端静态发布](aws-buyer-web-sandbox-publication-observed.md)。本文件仅整理当前主线，不是新任务、数据库写入、私密读取、来源发布、IAM修改或付费后端部署授权。[机器准备摘要](../ops/aws-sandbox/reviews/backend-integration-v1.plan.json)执行SHA为null。

## 已确定的主线差异

客户端602e543/准确run40799958045已发布，来源为https://d3a0kml1xanzgt.cloudfront.net；无需重建前端、再读HMAC、更新客户端Secret或再dispatch。API编译目标仍为first-acceptance.sandbox.techlong.cloud。

当前源码核对发现，现有云入口不是可随意传入CORS的通用部署器：

| 位置 | 受约束事实 |
| --- | --- |
| ops/cloud-worker/material/public-capsule-v5.json | CorsAllowedOrigins仍为first-acceptance与techlong.cloud两个原来源 |
| ops/cloud-worker/cloud-context-v5.mjs | 固定接受capsule body SHA 5c7e5eeff2febef52b469487e0bd7d170e711fb2b26e3df81162b5b46c6e2e14；不能静默改材料 |
| .github/workflows/cloud-worker-platform-job-v6.yml | checkout/核对冻结源码0e18a25，源码中仍选中已经完成的a00周期；本地改文件不会自动替换已发布云代码 |
| ops/platform-reviewed-cycle-v1/closure.mjs | 保留旧104闭包并校验110闭包；不能改旧pin、放宽guard或用环境变量绕过 |

所需业务差异只有新增准确来源，保留原两个，不用*、不移除Origin或新增API代理：

`https://first-acceptance.sandbox.techlong.cloud,https://techlong.cloud,https://d3a0kml1xanzgt.cloudfront.net`

仅在本机克隆原公开body、追加上述一项得到候选body SHA `c124b21accd6cd538e45c2cc43706583ad146ba0ded25067c0406e0c5d128ddc`；原body摘要匹配检查通过。**这是差异证明，不是批准SHA，不是已安装材料。** 当前原capsule/常量/闭包/工作流均未修改。后继须把新配置纳入合法新请求/来源及实际模板校验，不能直接UpdateStack已删UUID，或恢复旧a00/旧Review/旧永久槽。

最小适配必须复用既有请求/Review→RunOnce→Inspect能力，保持执行内核、资源清单和权限范围尽量不变；先取得真实完整历史，才确定准确的新请求/来源绑定。若确需新的固定配置材料/源码发布和reusable trust pin变更，要在执行清单逐项说明并另批，不能承诺“绝无IAM写”后再临时改trust。这里不新建固定job目录、通用恢复器、探针或UI支线，也不先修改冻结内核。

## 本轮真实停止点

用户已允许一次STS1＋AWS元数据65/GitHub GET10、配置全文件1/TLS连接1/SQL45的限定只读。实际新观察于20:39:15 CDT在**第一次Source STS身份查询**失败，结果 `STOPPED_NO_RETRY / SOURCE_UNAVAILABLE`：

- STS尝试1；AWS元数据、GitHub、配置读取、TLS连接和SQL均0。
- Secret值/HMAC/PEM/DDB项、Aurora连接、云或数据库写、新/取消任务、续租、dispatch和执行槽均0。
- 原件 `F:/ChatGPT_workshop/techlong-backend-integration-readiness-20261028-a/result.json`，raw SHA `ebd73a2a1d4dae7c2c2e7815dc209f6a6aa4e0fc3bc154f0622bfe12650c3548`。原脚本和结果保留，不重跑、覆盖或改时间。

失败记录中的计算到期字段不是可用于部署的新事实窗口；本轮尚未获得AWS/Neon现状，不能声称namespace已空、业务/保护未变、新job不存在或材料已经齐备。旧19:46退役记录仍只证明当时那个准确UUID，不能据此推导现在所有同名资源不存在或费用停止。

**当前唯一动作：Source刷新并获得新一次同范围读取许可后，创建新的观察记录继续限定核对。** 请运行aws login --profile techlong-sandbox-user，完成后回复“Source 已刷新，允许新一轮同范围只读核对”；不要发送凭据/验证码。旧已消费的STS尝试和读取许可不重复使用，不执行原失败命令。

## 读取完成后需要备齐的一轮材料

1. 核对准确旧UUID/七资源退役、同名CFN/ECS/监听规则/目标组空缺、共享Cell、镜像和原角色权限，以及固定Secret版本元数据。DDB只看表/TTL布局，不读业务项，不据静态capsule中的旧epoch项冒充当前强读事实。
2. 一次验证TLS的Neon只读快照覆盖准确实例全部job、完整计划/批准/尝试账本、准入和保护摘要；原成功任务/订阅/店铺/默认库与历史全部保留。新合法请求和候选ID只能依据现状及准确批准形成，不先编造状态或复制固定任务代码分支。
3. 把单一CORS差异、必要材料/来源绑定、真实新后端起止、GitHub本人审批点、正常应用副作用和独立验收方式集中列清，再给准确执行SHA；先备齐再开付费窗口。候选意图可按2小时准备，但现在不填写实际起止、不续旧TTL；到期不等于自动销毁或停费，清理仍准确资源另审。
4. 首轮联调先准备客户端启动、既有店铺/菜单读取与后端/数据库连通。运行客户端会正常创建/更新访问租约并heartbeat，不能当纯只读；实际执行仍须预先明确批准。尚不默认创建商品/订单、商户改密或Stripe支付；数据不足先记录缺口，不自动造业务数据。此阶段通过也不冒充订单/支付或最终整套交付完成。

本次仅完成本地源码/差异核对和停止记录；没有修改部署代码、角色、材料、数据库或前端。50 USD/月仍是整体目标而非硬停费，平台/共享Cell/数据库和静态版本可能持续收费。后继不扩F3c9、前端/探针/UI/调度平台，`wholeProductAccepted=false`。
