# W5r：一条真实受控 AWS 自动部署闭环已独立验收

2026-10-18，America/Winnipeg。结论是准确的既有 sandbox 任务完成了 GitHub Actions Review → RunOnce 实际部署 → 独立 Inspect。三次运行均为 attempt 1 / success，分别获得精确 SHA 批准和用户 environment 批准。不再执行旧任务或重新开始 W5r。

## 完成事实

| 阶段 | 精确 GitHub run | 批准清单 SHA 前缀 | 结果 |
| --- | --- | --- | --- |
| Review | [39200031548](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39200031548) | fa0677e1 | 私有 manifest 已重构 |
| RunOnce | [39200300265](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39200300265) | 73236b62 | NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED |
| Inspect | [39200910036](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39200910036) | 0e219dc4 | SUCCEEDED_INDEPENDENTLY_VERIFIED |

完整批准 SHA、固定对象版本和摘要见[机器执行记录](../ops/aws-sandbox/reviews/cloud-worker-w5r.executed.json)。实际执行冻结于 Git `2957f714a6cdfbd849bf354af3f7f0fcda25aa11`，179 项源码 pins 已核验；云 C=`d8cb99693231770de6a5d73e02dda42b87035714`、R=`7f0fbf2549fa3e2e05163b2ebb1f3de275f2b66c`、原76文件闭包保持。该执行源码的两项无 AWS CI 为 39198717505 / 39198717494，均成功。

任务是 `job_ecbf09030d3da7286ea3ef93`，仍归属原 app/deployment，没有新建请求。RunOnce 启动于 23:37:05 CDT，早于原领取截止 23:49:15.200；一次 CreateStack 于 23:37:11.520 创建准确栈：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/c017ca00-cb76-11f1-bc7a-02920833add5`

七项资源均 CREATE_COMPLETE：三个 ListenerRule、LogGroup、ECS Service、TargetGroup、TaskDefinition。复用既有父 Cell，没有在本轮改 IAM/Secret/DNS、创建新数据库或进行初始化/重设密码。

执行回执中的计数为 CreateStack 1、认证 HTTP GET 2、数据库写事务 2（领取及原子完成）、初始化 POST 0、自动重试 0。任务 succeeded / attempts 1 / lease 清空。旧 ready_at、原业务字段和旧成功任务保持；部署 outputs 仅按合同追加本次回执并更新相应时间，不声称整行从未变化。

## 独立验收证明了什么

Inspect 使用不同于 RunOnce 的精确 run，核对同一 manifest、固定 execution-reference / run-report 对象版本及摘要，重编译完成合同，校验旧业务/原 READY/前驱任务保持和回执追加约束，再将当前 AWS 运行观察与历史 provider-after 对比，并回读数据库确认没有中途漂移。验收 body SHA 为 `baf5597143af1bed98166933747308176077ba905235d43a01a1356c9ad69504`。

同 job 五个 DDB 动作均永久占用，本机 Review-v6、RunOnce-v5、Inspect-v5 槽也均保留。journal 中 `executionSucceededProved=false` 是有意保留的合同：**槽占用本身不证明成功**，本次成功由独立业务、执行证据及实时 provider 合同共同证明。

Inspect 的业务数据库写、承载资源写、control Secret 读取、应用 GET、DDB 写均为0，但不是“完全无云写”：Source 已获批条件写一次 execution-reference，云端也条件写一次私有验收报告，固定 DB Secret 在云端读取一次。不保存原日志、签名 URL、密码、JWT、mTLS 材料或私密业务快照到 Git。

## 追溯与本机显示错误说明

[本地完成检查点](F:/ChatGPT_workshop/techlong-w5r-completed-checkpoint-20261018-a.json) SHA `43d243548d4d6d8be7b285bae434307071385cf00016320e470bfbf2e9ce3a3c`，递归核验本轮69份证据原件，保留此前所有失败/历史槽。它和本轮实际 SHA/对象版本都不是下一次执行授权。

收口本机工具在断言及检查点落盘后发生显示变量名 ReferenceError，中间显示回读也重复该拼写问题；未覆盖检查点/原脚本或重放云动作。随后独立回读退出码0，重新核对检查点、69原件、原脚本摘要和 Inspect body SHA。[回读确认原件](F:/ChatGPT_workshop/techlong-w5r-completion-readback-confirmation-20261018-a.json)保留该诊断；实际 GitHub Inspect 一直是 success，不把本机显示异常归为云失败。

## 完成边界与唯一继续位置

本轮完成的是**一条已有初始化 sandbox 任务的受控云部署**，不等于任意租户、普通队列全局开启、无审批自动发布，或整套平台已在 AWS 上线。平台请求入口/worker/apply 没有在本轮重新开启，Neon 和本地平台仍是过渡组件。不发布 Sites，不重启 F3c9 支线，不把当前硬编码 job 的入口改成通用重放工具。

执行 caller 冻结在独立验收及本地原件核对完成后结束，仅做本次文档/记录提交。所有报告仍绑定执行 Git 2957f714，不把后续文档 HEAD 冒充已部署源码；文档提交后不要直接用要求旧 caller 冻结的命令回放旧 run。

下一阶段须另外明确要做的平台审批体验/新请求或最终 AWS 托管范围。本次不自动建立下一条任务、延长窗口、续期、扩权、再部署、复位永久槽或补偿删除。当前 job 已终态，旧批准不能重用。

已创建的 ECS 等资源和父 Cell/数据库继续保留，可能持续收费；50 USD/月是目标不是硬上限。本轮 workload 到期标签为 **2026-10-19 01:34:15 CDT**，不保证清理或停费。实际销毁、停止、续期均须准确资源范围另批；没有因本次验收成功而获得删除授权。既有区域级 DescribeTaskDefinition 读取权限仍在，本轮不改/不撤销它。

原[W5r 完整风险与边界](aws-auto-deployment-cloud-worker-w5r-approval-handoff.md)、[W5c 云端合同](aws-auto-deployment-cloud-worker-w5c.md)及所有历史失败记录继续保留。
