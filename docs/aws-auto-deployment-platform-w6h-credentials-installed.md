# W6h完成：控制器专用凭据已安装并独立核验

2026-10-20 10:43（America/Winnipeg，CDT）。用户明确批准清单 `a9b5e2ceb4ed7dc25fc5d38aa2379c63cfc50cf2f17107f84149c4bbac4aa70c` 及[完整风险](aws-auto-deployment-platform-w6h-activation-review.md)后，单次安装完成；另起进程独立核验成功。**这是凭据底座完成，不是平台已启用或自动部署闭环完成。**

## 实际结果

- 执行源码 `f8e046fedcd7633fa32e5b7555dd503a1d302210`；[准确无AWS CI](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39447172538) attempt1、16步骤全部success。真实临时PG验证密码/LOGIN模板（仅替换CI角色OID）及invoker权限边界；生产执行未重跑CI。
- ca-central-1创建一个Secret：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-controller/neon-v6-M4A08E`。空创建→Source-only保护策略及回读→写固定版本，三次持久写完成；未扩展IAM identity policy或修改worker trust。
- 准确版本 `3574f24e-ecb3-476c-8f71-baa501fd129e`，唯一版本、AWSCURRENT；默认AWS-managed KMS。DescribeSecret的`KmsKeyId`未返回，不能将该空字段误说为未加密；本步未指定客户Key。
- 唯一SQL事务设置既有角色 `techlong_deployment_controller_v6`（OID180224）的新随机密码和LOGIN，COMMIT ACK已保存。不新增角色/schema/表/函数或授权。
- 安装及独立核验的完整目录/权限快照相同；将两处LOGIN布尔值归一为false后，与原批准prestate逐字段相同。三张控制表仍空，九个控制函数及七项窄EXECUTE、旧业务表身份/owner和既有权限保持。
- 清单内27项旧PUBLIC invoker trigger精确快照 `ba28793914eae30cb2cd1dc3a9d8cd5ce61553250f68ddf6edd3d2cd93f2d5d2` 被本次批准接受；未修改全局默认严格审计、旧函数、PUBLIC权限或原提案历史文件。
- 同进程新凭据TLS只读认证成功；独立进程仅一次读取准确Secret固定版本，再做TLS只读认证成功，身份/OID/只读状态/空控制账本均匹配。
- 密码、DSN、Secret值和其摘要未进入回执、仓库或聊天；未读取App私钥、签JWT、创建token或dispatch。

原安装结果：`CONTROLLER_CREDENTIAL_INSTALLED_REQUIRES_INDEPENDENT_INSPECT`。独立结果：`CONTROLLER_CREDENTIAL_INDEPENDENTLY_VERIFIED`。之后仅对本地脱敏回执核对13项原件SHA；没有再次读取Secret或连接数据库。

## 永久槽和可追溯原件

- 安装槽 `F:/ChatGPT_workshop/techlong-w6h-controller-credentials.intent.json` 于 `2026-10-20T15:42:59.246Z` 消费。
- 一次私密读取槽 `F:/ChatGPT_workshop/techlong-w6h-controller-credentials-inspect.intent.json` 于 `2026-10-20T15:43:14.734Z` 消费。
- 原清单目录：`F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a`。
- 安装原件：`F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a-run`。
- 独立原件：`F:/ChatGPT_workshop/techlong-w6h-activation-20261020-a-inspect`。
- 全部13项原件路径和原始字节SHA记录于[执行记录](../ops/aws-sandbox/reviews/platform-activation-v6.executed.json)。这些是脱敏证据文件摘要，不是密码或Secret值摘要。

**不要再次运行Install/Inspect，不复位槽，不补齐/关闭LOGIN/轮换/删除Secret或自动回滚。** 原批准已经完成，不是到期前可重复使用的许可证。高权限提供者日志、持久凭据、27触发器/TEMP能力、并发和非原子风险仍存在；本步没有自动轮换或资源删除授权。新增Secret开始计费，总50 USD/月仍是目标而非硬上限。

## 唯一下一阶段

集中准备App caller/reusable的受审发布及现有worker角色的trust-only变更，再接平台/publisher发布绑定；不扩身份实验，不重装凭据，不开启F3c9。

本次尚未发布两份V6工作流、改worker trust、开启平台/publisher、登记新任务或执行AWS部署。原本机不可达R/S只作为准备证据保留，**未批准**；本次完成文档提交将推进main，因此不得直接推送旧S、force覆盖main或把旧材料当成当前发布清单。下一阶段应在最新clean main刷新候选父提交和SHA；实际工作流发布/trust Change Set、读取App key/Secret和新任务调度仍各按具体新范围审批，workflow ID只在发布后解析。

既有已完成W5r job不得重放。整套平台AWS上线仍是后续目标，本步不使用Sites。
