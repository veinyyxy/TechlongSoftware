# W7d：独立镜像基础设施创建评审

本页仅用于审核一次新foundation创建；与[镜像/数据库准备说明](aws-platform-hosting-w7d-image-and-db-preparation.md)配套。没有授权尚未确认的调用。本次不解锁OIDC、不发布ECR、不部署平台，不开始两小时hosting窗口。

## 准确范围

账户402010193138、ca-central-1；Source必须为IAM User techlong-sandbox-dev，UserId=AIDAV3GNMXTZEO7SHLC2X。仅提交最多一次CloudFormation `CreateStack`：`techlong-sandbox-platform-image-foundation-v1`，模板由固定源码的 `lockedImageFoundation()` 生成，并严格比对已审模板字节SHA。含3个逻辑资源：

1. ECR `techlong-sandbox-platform-web`：IMMUTABLE、AES256、scanOnPush；Retain、EmptyOnDelete=false，无自动生命周期删除。
2. Managed boundary `TechlongSandboxPlatformImagePublishBoundaryV1`：上限仅新仓库的上传/读取/扫描元数据，以及区域限定的GetAuthorizationToken。没有旧仓库或部署、IAM、PassRole、Secret、删除权限。
3. Role `TechlongSandboxPlatformImagePublisherV1`：上述boundary和相同inline；**trust显式Deny所有AssumeRole入口，无可登录principal**；无附加managed policy。MaxSessionDuration3600不是已签发会话，也不是自动授予发布权限。

能力声明为CAPABILITY_NAMED_IAM，DisableRollback=true，TimeoutInMinutes=20；准确客户端幂等token与永久意图槽见JSON清单。一次顶层调用不等于底层只有一次IAM/ECR写入：CloudFormation会执行具体建库、建policy/role、附加boundary、设置inline和标签等多次服务操作。

不创建/修改OIDC provider、GitHub environment、旧IAM、Secret、数据库、Cell/ALB/ECS/DNS、预算或清理机制，不登录registry或调度任何workflow。无资源替换、更新或删除许可；如果同名对象出现，不接管、不更新、不自动换名。

## 执行与独立核验

- 批准后首先核验清单未过期、固定源码/模板及风险说明摘要，执行前五分钟内重读准确Source身份及新repository/role/boundary/stack均absent；任何不符停止，不用旧Absent观察代替。
- 原子排他创建稳定的本地永久意图槽，然后最多提交一次CreateStack，SDK应用调用maxAttempts=1。槽路径不随清单刷新变更，已有槽或已有栈一律只读核对，不自动复位/重放。槽文件损坏或提交结果不明也按已消费处理。
- Source AWS Login的正常刷新不等于资源批准；会话/网络失效不保证可恢复。预检前失败不写槽；消费槽后即使未成功提交，也没有自动重试许可。
- 轮询仅DescribeStacks；之后用独立的新客户端回读准确StackId、3个资源类型/逻辑ID/物理对象、ECR不可变/加密/扫描、role/boundary/inline和trust布局，核对template及策略正文。只证明锁定新foundation，不声称镜像或生产部署已成功。
- 不安装grant、不尝试AssumeRole、推送镜像或撤销/删除任何对象。CreateStack成功、失败或状态不明均保存原始结果，必要时只读inspect；后续恢复、补齐、撤权或删除另行审核。

## 完整风险与保留项

创建不是跨服务原子事务；并发者仍可能在预检后抢占名字或改变资源，轮询/独立回读也不是跨服务CAS。template schema验证不保证安装成功、IAM传播或未来授权布局永远不变。Source本身有高权限，创建受审role不是对Source的权限约束。

DisableRollback=true故意不让失败自动删除已建对象；失败/超时可能留下stack、部分IAM或仓库，无自动补齐/删除/重试。创建的IAM role/boundary/inline具有新仓库权限上限但trust锁定；后续有人另改trust仍可能激活，故不能将创建当作长期不会变的安全保证。实际grant需单独准确批准。

ECR保留镜像/仓库，不强制清空；删除hosting或foundation栈也不代表仓库/镜像已删。若未来发布，会持续产生存储/扫描/请求/传输费用；GitHub镜像产物保留3天，也可能占用存储额度。本次不创建计算承载，仍接受低成本但非绝对零费用，不承诺全项目50USD硬上限或两小时自动停费。

本次不会读取Secret、App PEM、业务数据库或私密包；cloud账号/ARN/状态证据可按既有代码文档授权进入Git，但凭据值不得进入Git/日志/聊天。任何额外私密值读取、权限扩大、发布/部署/业务写入/清理都不由本页授权。

审核JSON给出48小时批准有效期及UTC/温尼伯时间。该有效期只供本次foundation创建批准，不能延长未来两小时hosting窗口；过期只刷新只读材料后重新批准，不重置永久槽。模板SHA不是批准SHA，应确认完整JSON清单的SHA及本页风险后才可执行。
