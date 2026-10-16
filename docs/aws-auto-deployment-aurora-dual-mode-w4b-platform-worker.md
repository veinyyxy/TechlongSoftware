# W4b：平台准确待审任务的单次 CLI 根接通（未启用、未实跑）

2026-10-16，承接 [W4a 平台入口](aws-auto-deployment-aurora-dual-mode-w4a-platform-entry.md)。主线代码现在连成：管理员待审请求 → 准确同 job 的 Review → 按新 SHA 单次 RunOnce → 原地领取/真实承载/两认证 GET/原子完成 → 独立 Inspect。不是轮询队列，不发布平台或自动登记请求，也没有重开权限/保护支线。

## 入口与绑定

新增 `ops/aws-sandbox/scripts/run-express-platform-worker-v4.mjs`，复用原 W1/W2/W3 和 W4a 的实现，不修改它们：

| Mode | 实际能力 |
| --- | --- |
| CheckRuntime | 本地报告接线状态；不读取环境凭据、连接 DB、调用 AWS 或读取私密包 |
| CheckSources | 核对公开材料/既有回执和99项代码绑定；不联网、消费槽或读取原私密值文件 |
| Review | 必须明确给 `--job-id`，只读取该 deployment 的准确待审行、原管理员及既有成功证明；合格后再只读核验 AWS 并生成新清单，不自动挑“下一条” |
| RunOnce | 必须给准确 `--manifest` 与新的 `--approved-sha`；原地领取该 pending job，最多一次 Source CreateStack，最终原子完成同 job，**新 job INSERT=0** |
| Inspect | 给原清单及 `--run`，新进程独立读 DB/AWS，不读取私密值、调用业务应用或修复/重试 |

除 CheckRuntime 外，输出目录必须是 `F:/ChatGPT_workshop/techlong-platform-w4-*` 下一个全新目录，不能覆盖旧记录；Run/Inspect 只接受同类目录中的 manifest.json。`CheckSources` 不是准入证明，合成测试数据也不能替代真实 Review。

Review 绑定完整 queued row 及摘要、原管理员 active/platform-admin 事实、九行快照、原 W3 成功 job、两个实际镜像、固定 store/epoch/配置、endpoint/代码与公开历史、真实 namespace preflight、固定时间和完整风险。领取 SQL 模板用零 lease token 作可重复摘要；真实 token 由 W2 内核生成，仅该随机能力可变，必须重新编译匹配同一个模板。零 token 不能用于真正领取。最终 proof 尚未发生，不能预填伪证据：清单绑定完成规则/旧成功 job 摘要/代码；实际原子程序与输出摘要在执行前记入永久槽，完成后再独立回读。

本轮限定**首次平台受控恢复**：前驱是 W3 `job_e4147af2f10faf37b51ec9a3`、栈 UUID `74a79560-c981-11f1-bfcc-06ffde30f30d`、task definition:4。根据真实 W3 provider/完成回执交叉绑定，而非沿用更早的 :3/ab4。其保存的 TTL 必须已到期，且 AWS 仍须证明准确前驱 DELETE_COMPLETE、七资源删除/:4 INACTIVE、namespace/容量/监听优先级均空。不会因为到期自动删除或重建。之后再次恢复不自动沿用这个固定前驱。

Run 前做准确行/来源/原成功任务与当前资源核对；领取处仍有 SERIALIZABLE 完整行 CAS、DB-clock lease 和 active 管理员检查。复用 W2 单次 runner，W4a 适配器不创建第二条 job；W3 provider 仅有一次 CreateStack 写能力，W1 仅做 readiness/control 两个 GET。最终除 W2 对原九行/新 job 的独立回读外，再比较保留的 W3 成功 job；独立 Inspect 也检查它，不凭旧 ready 或 ACK 报成功。跨服务并非 CAS、该额外历史行不是 AWS 的跨服务锁，仍有 [完整执行风险](aws-auto-deployment-aurora-dual-mode-w4b-execution-review.md)。

每 requestId 有单独的 W4 五项永久槽 `run / claim_job / create_workload / private_control_load / atomic_complete`；与已消费 W3 槽隔离，不换 generation。未进入 run 的过期审阅可只读重审原 held job；run 槽一经消费，不自动复位、重试或接管，即使提交 ACK 不明或失败时 job 仍 pending/running。

## 已验证与当前事实

7项新增测试及相邻33项合计 **40 tests 通过**；包含真实编译器接入 W2 runner 的同 job / 保留来源 / 原子收口组合测试，以及错来源、旧成功 job、活动兄弟任务、过期/漂移与不正确批准拒绝。组合测试的 DB/provider/GET 是明确合成端口，不是线上部署验收。typecheck、三文件零警告 ESLint、两脚本语法检查通过。未改网页代码，沿用 W4a 构建结果，未重复宣称新的平台发布。

真实本地 `CheckSources` r2 通过，99项绑定含原 W3 的76项不变，公开前驱/回执/修复镜像吻合。真实 Neon Review 对旧成功 W3 job 返回 `PLATFORM_W4_EXACT_HELD_JOB_REQUIRED`，在第一个 READ ONLY 事务后就停止，尚未创建 AWS client 或消费槽；这次 exit=1 是**预期的防重放拒绝**，不是已生成执行清单。初轮及最终轮各一次（共2个只读事务），没有重试任何写。

独立状态读取于 **2026-10-16T17:37:27.322Z / 12:37:27.322 CDT** 完成：原九行、W3 成功 job 和任务列表摘要与 W4a 一致；仅两条 succeeded job，**held request=0、active job=0**。这另用2个 READ ONLY 事务，本阶段共4个 Neon 只读事务，AWS调用/SQL写/原私密值读取/业务请求/执行槽消费均0。没有重新检查 AWS 实时健康或准时清理，也没有请求无用的 Source 刷新。

当前无法且不应该生成真实部署执行 SHA：平台写入口尚未启用，也没有合法待审 job。不能为凑齐 Review 插入假任务、重放旧成功 job、修改旧业务行或开全局 worker。机器摘要与原件位置见 [W4b 接线记录](../ops/aws-sandbox/reviews/aurora-dual-mode-w4b-platform-worker.prepared.json)。

## 下一主线 W4c

用户最新决定：**不发布 Sites；先完成自动部署，最后整套 AWS 上线。** 因此 W4c 改为只准备**本地平台请求入口启用 + 首条真实待审请求**的具体范围与审批材料，不再做任何平台托管发布。管理员来源、登录写入、一条准确 held job、费用与失败残留见 [W4c 本地入口](aws-auto-deployment-aurora-dual-mode-w4c-local-entry.md)。该确认不自动授权 AWS CreateStack 或原私密包读取。确认后真实请求须经本入口重新 Review，再按其新 SHA 一次批准部署及独立 Inspect。

不要再添加保护子分支、离线 generation 或泛化队列。Full/旧入口/初始化库/store/成功历史保留，50 USD/月仍非硬cap；W3 承载固定 **2026-10-16 13:42:30 CDT / 18:42:30 UTC** 到期不续期，本轮没有删除、监控或承诺全部停费。
