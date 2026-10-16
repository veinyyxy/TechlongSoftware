# K3 首轮验收收尾：先公网最小冒烟，再准确资源退出

> **当前停止（2026-10-16 07:55 CDT）**：清单及原workload期限都已过。仅1 STS+3 CFN只读确认准确workload/七资源记录DELETE_COMPLETE、父Cell记录CREATE_COMPLETE；0公网GET/私密/SQL/写，K3a槽未消费，不刷新原范围、不续期/重建。需选择另审恢复承载继续公开验收，或K3b只读退出盘点；不重复初始化。[真实停止证据与两个方向](aws-auto-deployment-aurora-dual-mode-k3a-expired.md)。下方为保留的原准备历史，原命令不可执行。

2026-10-16 Winnipeg。用户要求“下一步开始”；本阶段沿用收缩主线，不扩展F3c9/Grant/generation，不重做初始化、部署、镜像发布或权限探针。K2c已经完成，原私密/HTTP/写批准全部消费。本次只实现**K3a三个公开GET的单次待审入口**，并根据已有真实证据整理退出依赖；未联网读取任何应用/AWS/数据库。

## 已证明与尚未证明

| 首轮目标 | 已有真实证据 | 剩余缺口/本阶段处理 |
| --- | --- | --- |
| 容器真实承载 | K1/K2c准确stack UUID、task definition:2、实际镜像0dc34eda…、1 running/healthy target | 最新AWS观察为01:31 CDT的历史，不冒充当前；K3a不重新证明AWS UUID/image |
| 初始化与配置 | K2b唯一POST及独立认证，K2c再次核对原store、初始化flags/有效配置 | 不再provision；不新增私密读取 |
| 平台结果 | K2c三行事务、active/ready/succeeded、URL/receipt、清旧lease，独立回读通过 | 人工恢复归因保持，不能声称无人值守全链路已验收 |
| 公网访问与边界 | 控制端口:8443及ALB healthy有证据 | K3a拟验收443 health、ready、未签名商户GET被401拒绝 |
| 正向端用户业务 | owner由POST创建，readiness证明owner存在 | 未验收浏览器/CORS、商户登录/改密码、商品/订单/付款。三GET不能勾选这些项；不为“冒烟”读取密码或真实下单 |
| 失败/到期清理 | 旧workload曾被现有Janitor删除；新workload有固定到期及已观察enabled旧调度 | 新UUID的到期删除、父Cell/库/Secret/平台状态退出与实际费用收口尚未证明；本轮不注入故障/删资源 |

[K2c真实结果及22份证据](aws-auto-deployment-aurora-dual-mode-k2c-ready-reconciliation-executed.md)为历史基线，不是本轮新的云快照。

## K3a 最终待审范围

清单SHA **`41ab184c73a04dc90ee70da21edf04653b65d27d99472cd58606607f027dcde6`**。

- 原件：`F:/ChatGPT_workshop/techlong-express-k3-public-review-20261016-r1/manifest.json`。
- 生成：**2026-10-16 06:21:04.661 CDT / UTC11:21:04.661**。
- 唯一Run及每个请求严格早于 **06:51:04.661 CDT / UTC11:51:04.661**；网络timeout受余下时间限制。原workload仍固定 **07:04:28.726 CDT / UTC12:04:28.726** 到期，不续期。
- 固定HTTPS主机`first-acceptance.sandbox.techlong.cloud:443`：依次GET `/health`（200/ok）、`/ready`（200/ready）、`/api/merchant/stores`（401/准确Invalid signature）。三次均无HMAC/JWT/Cookie/设备ID；不登录、不发送POST。
- 最多3请求、各10秒/总45秒/正文4096字节、不跟随redirect或重试；固定公开store header。严格系统TLS信任/SNI/主机验证，禁止自定义CA/代理环境。不加载私密包、Secret或AWS profile，不直连SQL；**无需刷新Source身份**。
- 成功只记录路径/状态/准确响应验证和公开TLS指纹/期限，不保存HTTP正文或headers。一个新永久槽及每请求独占intent，失败保留、不自动复位或重试；没有第二次Inspect HTTP。独立验收仅本地文件hash/已记录结果复核，不追加GET。

本地代码确认：`/ready`是应用严格READ ONLY事务；merchant路径被buyer access middleware排除，不申请buyer lease；store-context可能先读店铺/缓存，商户鉴权遇缺签名先401返回，不进入账号、登录或CRUD。**操作器直连SQL为0不等于应用没有Aurora活动**。本地源码pins不是新部署镜像证明。

6项针对测试、ESLint零警告、语法检查通过；仅内置Node模块，没有AWS/SQL/私密loader依赖。Prepare及独立新进程重算canonical SHA、计划、10项脚本/风险/测试/后端源码pin、22份公共历史raw hash与空永久槽通过。没有重跑完整CI/构建或模拟部署；没有声称当前公网已通过。[准备摘要与三份原件hash](../ops/aws-sandbox/reviews/aurora-dual-mode-k3a-public-smoke.prepared.json)。

完整风险固定在[K3a风险](aws-auto-deployment-aurora-dual-mode-k3a-public-smoke-risk.md)，raw SHA `54586be566dcd2b772a56c1f63196b366b9af2845a7625c4dd16f3f275800cfc`：公网/提供者日志、应用只读SQL与非零费用、并发及有限证明、超时结果不明、新永久槽不复位或重试、无续期或资源删除。

建议确认文本（尚未发送）：

> 我确认按清单 `41ab184c73a04dc90ee70da21edf04653b65d27d99472cd58606607f027dcde6` 执行K3a，仅三个固定无认证HTTPS GET，接受完整风险及永久槽不自动复位或重试；不读私密值、不登录或执行业务写、不改AWS/数据库/期限、不删除资源。

获准且时限/绑定/永久槽仍满足后，平台仓仅一次：

```powershell
node ops/aws-sandbox/scripts/review-express-public-smoke-v1.mjs --mode Run --manifest F:/ChatGPT_workshop/techlong-express-k3-public-review-20261016-r1/manifest.json --approved-sha 41ab184c73a04dc90ee70da21edf04653b65d27d99472cd58606607f027dcde6 --output F:/ChatGPT_workshop/techlong-express-k3-public-run-20261016-r1
```

若过期但槽未消费，只能重新准备仍早于原workload到期5分钟的新公开清单并再确认；不能放宽原到期或复用K2c认证/写窗口。槽一旦消费，旧Run/公开GET不重放。

## 退出依赖：不是本轮删除授权

以下依据K1模板、C5d/K2c历史和本地旧Janitor源码，不是当前云inventory或费用账单。旧Janitor的栈名限定`techlong-sandbox-tenant-[a-z0-9]{1,16}`、ManagedBy/Environment等tags、到期和独立根栈条件，每次扫描最多删除1栈；不能负责父Cell、Aurora或平台数据库。已部署CodeSha在K2c观察，当前源码分析不能替代新的云代码/权限回读。

| 退出对象 | 固定已知坐标/范围 | 退出顺序与保留边界 |
| --- | --- | --- |
| workload七资源 | `...stack/techlong-sandbox-tenant-9c5ee9e64509dcad/f71252c0-c917-11f1-8148-02ff648cb917` | 先只读核对新UUID状态/七资源及Janitor结果；不要Delete已删对象或重建。包含ECS service、task definition、target group、三listener rules、log group；模板无Retain，日志可能随栈删除，TD可能仅INACTIVE，不能称所有历史完全抹除 |
| 父Cell十六资源 | `...stack/techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1` | 不在旧Janitor命名空间；须先确认所有tenant service/任务/规则/target已退出、无其它租户依赖，再准备准确UUID DeleteStack另审。ALB/公网IP可能继续收费，旧ExpiresAt标签不会自行停费 |
| DNS | `first-acceptance.sandbox.techlong.cloud`原准确alias | 删除父ALB前后须准备准确record集合回读及匹配删除另审；不删除hosted zone/其它记录，不重定向到新服务 |
| Aurora Express/租户库角色 | cluster `techlong-sandbox-express-d001`；库`tenant_a0da1748bc4d5419_db`/角色`tenant_a0da1748bc4d5419_role` | 不在上述两CFN栈，已有初始化/owner业务数据。默认保留，不隐式DROP/注销；删除、备份/快照、停用访问或收费续用需明确数据保留选择和单独清单 |
| Secrets/证书/TrustStore/S3/ECR/IAM | 既有runtime、公钥、TTL/drain及共享控制基础、已发布镜像/角色等 | 保留且记录残留；先核归属/共享/引用及运行任务/DB身份，再按准确对象另批，不批量扫前缀删除、不声称免费 |
| Neon/DDB控制面 | 原app/deployment/job、generation1/epoch1 active authority及环境 | workload消失不自动证明这些同步终态。先只读证实外部资源实际退出，保留ready/人工receipt历史，再另审带准确旧值的状态协调；不先标destroyed冒充物理退出 |

**下一K3b仅准备准确退出清单**：新只读核对上述实际UUID/physical IDs、现有权限/依赖、DNS、任务/网络/DB/Secret元数据和平台状态；不读Secret值、不连Aurora、不Invoke Janitor、不写或删除。该只读集合可以按正常诊断范围准备；实际任何删除、角色/Secret/数据库变更或平台状态协调仍fresh具体SHA批准。无需恢复F3c9或创建新generation。

不为补齐验收而默认制造新失败部署/收费Cell或付款。正向商户业务验收暂列明确缺口，若需要，只准备使用测试数据/指定账号的最小独立方案，再按私密/认证/业务写范围批准。

## 结束条件

首轮结果分别报告：真实部署与配置/平台ready（含人工恢复）、公网最小检查（待批准执行）、尚未验收的正向业务/无人值守失败补偿，以及资源退出/剩余收费对象（待证实）。保留全部证据，不把“tag到期/调度启用/Stack DELETE_COMPLETE之一”当作全系统停费。50 USD/月只是目标；本轮没有费用估算更新或硬cap保证。
