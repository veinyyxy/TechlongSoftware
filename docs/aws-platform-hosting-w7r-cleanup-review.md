# W7r：第二轮临时承载清理范围与完整风险（删除待批准）

用户已允许有限公网和人工认证验收，闭环已完成并发现未修的窄屏退出问题。**该授权不是删除批准。** 本清单只准备结束本轮两小时临时承载；新准确SHA及本页完整风险获确认后才允许一次DeleteStack。旧W7p删除槽不可复位或重放。

## 唯一目标及保留范围

目标只限：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/2d7d45a0-ced0-11f1-acc8-0effedbce869`。

拟议一次标准DeleteStack，绑定准确ARN、11项当前物理ID/类型、原W7q模板hash、批准部署及独立回执、验收证据、fresh只读快照和本页hash。删除11项承载逻辑资源：两安全组、独立入站规则、日志组及日志、ECS cluster/service和托管task、任务定义`:2`、ALB、443 listener、target group、准确console DNS A alias。task definition可能注销为INACTIVE并保留历史，不能承诺所有服务元数据都消失。

保留IAM execution角色/boundary/读取策略、Web Secret及固定版本、Neon数据库/LOGIN角色/全部业务记录、ECR仓库/镜像、证书、hosted zone与其他DNS、VPC/subnet/routes、旧栈/旧租户/旧支线。ECS名称/ARN可能复用旧退役字符串，删除权仅由本轮新CFN UUID及当前11项所有权绑定确定，不凭名称清理账户其他对象。

## 单次操作和失败边界

不另建执行框架。沿用受审运维方式：验证新原件SHA、48小时外层期限/最晚启动、完整风险、冻结部署源码33项pin、父证据/快照/验收hash和clean main（仅文档/索引快进）。执行前重新读取准确Source IAM用户、准确ARN的栈、资源及Original模板；必须仍CREATE_COMPLETE、termination protection关闭、无CFN service RoleARN/parent、11项物理ID/类型/状态与清单完全一致。任何差异停止，不自动放宽或修改清单。完整事实核对后30秒内提交；这不是跨服务CAS，不能防止并发漂移。

新永久槽固定为`F:/ChatGPT_workshop/techlong-platform-hosting-cleanup-v2.intent.json`，批准后才wx/fsync消费，记录新SHA/目标/nonce/时间。旧创建v1、删除v1、创建v2槽全部保留。新槽也是一次性，不复位、换槽或自动重试。

唯一请求仅包含准确StackName ARN、固定ClientRequestToken、`DeletionMode: STANDARD`；官方ca-central-1 endpoint、既有techlong-sandbox-user Source、SDK maxAttempts=1。**不force、不RetainResources、不指定新RoleARN、不UpdateStack、不预先StopTask/缩容、不补删单资源。** [AWS DeleteStack API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeleteStack.html)规定的可选强制/保留/角色行为不属于本次范围。

记录ACK或提交不明后，只读观察准确ARN最多约25分钟，再独立核验DELETE_COMPLETE/准确ARN缺失及服务级移除情况。删除历史可继续以DELETE_COMPLETE显示；ECS cluster/service/任务定义可保留INACTIVE元数据。不因此再发删除。DELETE_FAILED、网络/凭据/ACK不明或超时时，保留槽和全部资源/回执，人工另审，不自动修复、强制、回滚或换槽。应用一次提交不限制CFN/ECS内部提供者操作。

## 必须接受的完整风险

- **中断及不可恢复。** 入口、ALB、运行task和该日志组日志将停止/删除；容器临时数据、未导出的本轮日志会丢失。没有读取/导出业务数据或日志作备份；原栈UUID不可通过同名重建恢复。删除后不能继续本轮浏览器验收。
- **异步、部分删除及竞态。** ACK不等于完成；依赖/传播、外部保护或并发可能导致部分删除、DELETE_FAILED、服务历史或收费资源遗留。fresh检查不能消除检查与写入间、写入中的竞态；ENI/IP释放和账单反映可能延迟。
- **残余费用和权限。** 两小时标签不自动停机。等待、失败及保留的Secret/数据库/镜像等仍可能收费；50USD月预算不是硬上限。没有自动撤权、NOLOGIN、轮换密码/Secret、删镜像、删证书或关闭数据库。本次不证明整个账户零费用或其他资源未被外部改变。
- **一次性槽与凭据。** 槽一经消费不重试/复位；即便提交结果不明也不会再发写。Source自动刷新可能失效，人工/额度/离线可能延误观察与清理。不得以省费用为由跳过新确认、扩大删除范围或补删其他资源。

清单48小时仅为审核有效期，**不是建议保留资源收费48小时**。原承载意图截止2026-10-23 07:54:53CDT，删除尚未获准也不会自动发生。实际执行须使用本次新SHA、准确新UUID及新槽，不能拿旧54a0UUID的清单替代。
