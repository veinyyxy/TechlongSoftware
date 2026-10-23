# W7p：准确承载栈清理范围与风险（尚未批准删除）

用户选择优先准备清理，**不是批准删除**。初次准备因Source过期退出，没有触发删除；之后已完成Source刷新及fresh只读核对，当前清单见[准确待审索引](../ops/aws-sandbox/reviews/platform-hosting-w7p.cleanup-review.json)。Source刷新也不是删除批准。必须获得准确新SHA及本页完整风险确认，才能提交一次DeleteStack。

## 唯一目标与保留边界

目标仅W7o新建的准确栈ID：

`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/54a0d7d0-ce87-11f1-aa1a-0eb4b7868f6f`

拟议一次标准DeleteStack（不force、不指定retain资源、不传新RoleARN），由CloudFormation停止/删除其11项承载逻辑资源：ECS Service及托管任务、该task definition revision、cluster、ALB、443listener、target group、A alias、7天日志组、两安全组及独立入站规则。task definition可能仅注销为INACTIVE并保留元数据，不能承诺全服务历史数据彻底抹除。

标准删除和可选force/retain/RoleARN行为按[AWS DeleteStack API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeleteStack.html)核对；本清单不会批准force或临时更换执行角色。

**不删除或修改**：W7n execution角色/boundary/Secret读取策略、Web Secret值/版本、Neon数据库/角色/业务记录、ECR仓库/镜像、现有证书、sandbox hosted zone及其他DNS记录、VPC/subnet/route、旧栈/旧租户/旧支线。保留的Secret、数据库及其他资源仍可能收费；删承载不等于AWS账单归零。

## 审核及单次执行方式

不再扩展新的执行框架。准确操作清单将绑定固定Source IAM User/UserId、区域、唯一目标ARN、11项准确物理ID/类型、原W7o模板hash、部署成功父证据、fresh只读snapshot及本页hash、唯一ClientRequestToken、48小时外层期限。

准备和执行前分别核对Source、准确ARN的栈仍CREATE_COMPLETE、termination protection关闭、无外部CFN service RoleARN/parent、原模板及11项资源完全匹配。执行前重新读取事实，不凭历史快照直接删除；任何差异停下另审。读完后尽快提交，检查不是跨服务CAS，不能阻止并发改变。

只有新SHA获批后，才以wx+fsync创建 `F:/ChatGPT_workshop/techlong-platform-hosting-cleanup-v1.intent.json`，永久记录清单SHA/目标ARN/开始时间；随后官方ca-central-1 endpoint、既有Source AWS Login、SDK maxAttempts=1，仅一次清单内DeleteStack API。无模板更新/应用请求/Secret读取/SQL或先停机等额外写操作。

保存ACK或提交不明的回执后，仅只读观察准确ARN删除状态/资源（最长约25分钟，再独立核验）；不得重复DeleteStack、强制删除、修改保护、补删单资源、换槽或重放。应用层一次提交不限制CFN provider/ECS内部的多次操作。凭据过期、网络/超时/ACK不明或DELETE_FAILED时保留全部证据和槽，人工另审，不自动修复。

## 必须接受的风险

- **不可恢复/中断。** 公网入口、ALB/任务及该日志组日志将被删除；现有页面/请求会中断，会丢失容器临时文件及未保存日志。原栈UUID不能通过同名重建恢复。本轮没有读取/导出应用日志或业务数据作备份，不能承诺数据恢复能力。
- **异步、非原子与竞态。** ACK不等于完成；资源依赖、传播、保护或外部并发可造成部分删除/DELETE_FAILED及收费遗留。检查后仍可能漂移；没有跨服务CAS。标准删除不能保证立刻释放所有ENI/IP或消除所有服务历史记录。
- **成本与残余权限。** 删除等待期间、失败后及保留资源仍可计费；两小时标签不自动停机。IAM/Secret/Neon LOGIN仍存在，不自动撤权/NOLOGIN/轮换/删除。50USD月预算是目标与告警，不是硬上限。
- **单次永久槽。** 槽一经消费不复位/换槽/自动重试；即使提交前后结果不明，也不会再发写请求。Source自动刷新可能失败，人工/额度/离线会延误观察；不能以降低费用为由跳过新确认或自动扩大删除范围。

## 此前只读验收的限度

23:09:46CDT的三次无Cookie/无身份GET确认TLS1.3证书/主机名校验、健康200、登录页200、未登录admin307跳登录及HSTS300。没有登录、表单、Cookie值、静态资源或认证页面验收；不能宣称管理员或整套系统验收通过。用户选择先清理，不再推进本轮登录测试。
