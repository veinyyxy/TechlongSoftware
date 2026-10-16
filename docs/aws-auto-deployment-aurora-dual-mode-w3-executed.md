# W3 实跑及独立验收通过：已初始化租户的单任务承载闭环

2026-10-16 Winnipeg。用户对上一条集中范围及完整风险回复“确认”，绑定清单 **`bf4bd8b45acc0a01d1e24451e219891ee9d30521ac41a17e0d460fb584909937`**。本轮仅执行该清单一次，没有刷新/扩展权限或重试。

## 真实结果

| 环节 | 本轮事实 |
| --- | --- |
| 新任务 | `job_e4147af2f10faf37b51ec9a3`，attempt/max=1，新 DB-clock lease；最终 succeeded、lease 清空 |
| 新承载 | 一次 Source CreateStack，新 UUID **`74a79560-c981-11f1-bfcc-06ffde30f30d`**；模板/参数/原角色/七资源实际回读通过 |
| 实际运行 | task definition **`:4`**，单 Fargate task，真实 app digest `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`，ECS stable/HEALTHY、准确 target healthy |
| 认证配置 | 既有私密包一次读取，准确租户8443上两次 JWT/mTLS GET；initialized、原 store、有效配置及 epoch 一致，无 POST |
| 持久化 | 原子追加 deployment 输出并完成**新 job**；其余旧行、旧 apply 成功任务、原 ready_at/初始化归因保持 |
| 独立 Inspect | 新进程、只读 AWS/Neon 回读均通过：`NEW_JOB_SUCCEEDED_OLD_ROWS_PRESERVED`、`EXACT_WORKLOAD_PROVED` |

CreateStack 于 **11:48:46.049 CDT / 16:48:46.049 UTC** 得到新 UUID 回应；认证配置于 **11:50:57.087 CDT** 验证。Run 在 **11:50:58.625 CDT** 返回 `NEW_JOB_SUCCEEDED_OLD_READY_PRESERVED`；独立 Inspect 完成于 **11:51:24.711 CDT / 16:51:24.711 UTC**。不是凭 bootstrap health 或 DI 测试宣告 ready。

准确栈 ARN：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-tenant-9c5ee9e64509dcad/74a79560-c981-11f1-bfcc-06ffde30f30d`。ECS task 为 `ea8434b5c92948dbbeadc5310f3befe3`，task definition 为 `tenant-9c5ee9e64509dcad-task-definition:4`，target group 后缀 `33aa49a9027fa747`。这些坐标来自真实新回应，不沿用旧 :3/ab4 UUID。

新回执位于 `deployment.outputs.expressInitializedWorkerRunsV2[jobId]`，SHA **`6e88f9a64c06328c066fa330296ed9469009a46e3086915bb55f20f58a433c4b`**；原子程序 SHA **`800d85c4ad13574177e78a9cd7c90b8498294ee126288d09748ef9219cf7d30b`**。旧顶层 stackId 与 K2/K3 历史回执保留，不应误当当前承载指针。新回执没有 lease token、JWT、私钥或密码。

## 实际操作与保存范围

Run计数：84次SDK读取、27次CLI读取，**1次 Source CreateStack**；CloudFormation 按批准模板建立其七个子资源。Neon 两个写事务：一行新 job INSERT，随后两行原子 UPDATE（新 job 和准确 deployment）；另有只读快照、lease 检查与完成回读。没有把未单独记录的 Neon 读取总数推算成精确审计值。

私密包读取1次，应用认证GET2次，初始化POST0、自动重试0、Source GetSecretValue0、operator直接Aurora连接0。已接受整包含未使用的Stripe秘钥；它没有通过payment source暴露、没有Stripe请求或付款写入。应用GET内部数据库读取不等于operator直接连接Aurora。

独立 Inspect 另做7次SDK+1次CLI及1个Neon只读事务，云/DB写、私密读取和应用请求均0。它重新比较八个完整旧行及 deployment 除 outputs/updated_at 外的全部字段，检查新 job 成功且 lease 清除；同时新鲜读取准确新 UUID/七资源/实际运行镜像与健康 target。没有用写事务 ACK 代替独立确认。

[机器执行摘要及13份原件摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-w3-worker-root.executed.json)关联 Run、独立 Inspect 和五个永久槽：`run / claim_job / create_workload / private_control_load / atomic_complete`。所有槽已消费，不能再次运行此清单或复位。原准备记录、作废r1清单和本次批准r2清单均保留。执行器、W1/W2/旧代码和固定风险文件本轮没有修改；前阶段26tests/typecheck/lint证据保留，线上执行及独立回读是新增的实际验收依据。

## 现在能声称什么、下一步是什么

已验收的是：**同一个已初始化租户，在一次明确批准后，由单任务 worker 自动完成承载创建、认证配置核验和新 job 原子收口**。未接平台事件/订阅触发、未开放全局队列，也不是“新客户首次建库/商户开通到上线”全链路；没有伪称 Full 或无人值守全平台已完成。

下一主线可接平台的受控单任务触发及可观察结果，不重开 Grant/F3c9/generation，不再重建/初始化原库。任何下一次实际部署、业务写或新的私密来源范围仍另审；本轮不会继续第二次创建、公开业务请求、商户登录或付款验收。

新 workload 固定到期仍为 **今天13:42:30 CDT / 18:42:30 UTC**，不会因为成功、MFA或文档工作续期。既有Janitor保持，但不保证准时删除；父Cell和初始化Aurora库默认保留，不能声称全部停止费用。50 USD/月仍是目标而非硬cap。没有创建新监控/计划任务，后续用户触发且已到期时才可附带准确只读确认，不自动重建或删数据。
