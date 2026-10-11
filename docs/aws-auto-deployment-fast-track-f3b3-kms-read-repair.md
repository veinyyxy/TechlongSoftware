# F3b3：最小 KMS 读取修正清单，未执行

2026-10-11 Winnipeg。上次两只读函数安装完成，但Secrets Manager读取在KMS解密阶段被拒绝；旧安装槽位已消费。本阶段新增独立修正module/SDK+CLI入口，不改旧代码binding、p2 ZIP、函数配置或旧记录。**当前仅代码与只读Review，IAM写=0、新探针调用=0、Secret值读取=0、Neon连接=0。** Source已刷新，新槽位为空。

## 拟更新四项现有IAM权限，随后两次新只读探针

| 固定角色 / RoleId | 现有boundary（拟新增默认v2，保留v1） | 现有inline（拟更新） |
| --- | --- | --- |
| TechlongSandboxCellTtlExecutorRole / AROAV3GNMXTZLB4NZQLZY | TechlongSandboxCellTtlExecutorBoundaryV3 | RuntimeReadOnlyV3 |
| TechlongSandboxCellDrainCoordinatorRole / AROAV3GNMXTZPRETOTXTS | TechlongSandboxCellDrainCoordinatorBoundaryV1 | RuntimeReadOnlyV1 |

账户402010193138。最多4个IAM写API：各一次CreatePolicyVersion(SetAsDefault=true)，只接受响应v2；各一次PutRolePolicy。原v1、角色/策略标签和信任保持，不DeletePolicyVersion、不自动清理旧版本、不改Key policy、不创建Key/Secret/角色或付费Cell。任何预先存在v2或非准确状态拒绝采用，不自动“修好”或补齐。

唯一新增允许动作是 `kms:Decrypt`，Resource固定为 **arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570**。每角色都必须同时满足：

- aws:RequestedRegion=ca-central-1（原全局显式拒绝保持）。
- kms:ViaService=secretsmanager.ca-central-1.amazonaws.com。
- kms:CallerAccount=402010193138。
- kms:EncryptionContext:SecretARN=该角色自己的准确Secret ARN。
- kms:EncryptionContext:SecretVersionId=该Secret已批准的固定初始UUID。

TTL绑定readonly-v3-AWZoLG / `3f8047d4-e357-4d32-ae87-861fda5f8253`；drain绑定drain-control-QDFwQ9 / `72eb93b3-1da0-40a2-a5a1-176e6869ae98`，完整ARN在清单中。wrong/missing的Key、ViaService、CallerAccount、Secret ARN或VersionId都有**各自独立的显式Deny**；不存在把多个错误条件放在同一StringNotEquals变成AND漏洞。CallerAccount由单独Deny强制，包括缺失条件，Allow不再重复它以满足quota。

原DenyAllOtherActions仅为Decrypt增加例外；原来源函数Deny仅对该KMS动作不适用，其余调用继续严格要求准确函数ARN。直接GetSecretValue的来源/region/准确Secret/AWSCURRENT限制，以及DDB/CF/日志范围、所有其他动作拒绝都保持。KMS转发改用服务、账户和加密上下文限制，不开放直接调用KMS或其他服务转发。AWS文档明确Secrets Manager解密使用这些上下文；转发上下文是否完全符合仍须这次批准后的实机调用证明。[Secrets Manager解密和上下文](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)、[KMS ViaService条件](https://docs.aws.amazon.com/kms/latest/developerguide/conditions-kms.html#conditions-kms-via-service)。

TTL原policy接近6144字符额度：仅删除不参与授权的Sid、把资源和条件完全相同的STS/ListStacks两个Allow合并。候选identity与boundary文档相同，长度 **6119/4340字符**；其余非KMS规则逐项结构等价测试通过，不合并不同资源授权。[IAM managed policy额度](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)。

四次写完成并回读后，等待20秒（**不保证传播已完成**），每次调用前重新核对全anchor和准确IAM阶段。仅对已安装的TTL-v3/drain只读探针各发一次新的nonce/同步RequestResponse；不UpdateFunction/代码或参数、不连接Neon/启用业务runtime、不写authority或安装删除grant。Secret只在Lambda内存校验，原始Invoke输出不落盘，闭合脱敏回执与分页云日志完整SHA绑定；缺少日志时只读Inspect，不补调。

## 状态机、失败与权限生效风险

新固定槽位 `techlong-f3b3-readonly-kms-read-repair-v1-consumed`，不复用旧安装/凭据槽位。每写前重读RoleId、原v1、当前默认版本/inline及全函数/日志/Key/Secret anchor；另在发API前重读对应IAM准确阶段和批准时间。检查不是服务端CAS，不能消除管理员并发。SDK maxAttempts=1；IAM读取/模拟600ms节流、CLI元数据最多3并发/200ms起步间隔，不是写重试。

IAM更新非原子。boundary v2生效后inline可能仍为旧版；完成某个角色inline后该角色读取能力可能已生效，即使另一角色失败。失败或失响应可能留下部分权限，**不自动恢复v1、撤权、删除、补齐、reset或写/调用重试**。新slot消费后只读Inspect；人工后续处置须另审。外部已有授权主体额外Invoke不可由本地slot排除。50USD/月是目标，IAM更新不增加Key资源月费，但新Lambda/KMS/Secret/DDB/日志请求可能计费，不能保证绝对零费用或硬上限。

## 真实只读核验与定向验证

9项定向测试覆盖quota/原规则等价、各KMS显式拒绝、fresh SHA/槽位、版本冲突、失响应和无自动恢复；typecheck/lint/两CLI语法通过。没有重复Docker/PG/ECR/镜像/GHA演练。

最终r3在线KMS模拟 **26案例：2个准确转发允许、24个wrong/missing拒绝** 均符合；6项Source CreatePolicyVersion/PutRolePolicy/InvokeFunction精确资源模拟allowed。这是模拟，不是实机已成功。真实inventory完整采集小于30秒，角色/信任/标签/原v1/inline均准确BASE，函数p2字节SHA元数据/RevisionId/配置/无URL/事件源/别名和日志7天准确；两个Secret唯一原版本/标签/无rotation/资源policy保持，AWS-managed Key/Enabled/准确policy SHA保持。没有读取Secret值、密码或Neon。

r1在get-function-concurrency读取/解析退出，无写和slot消费；新增CLI空响应兼容（无保留并发时允许空对象）及有界读取调度后r2/r3完成。r1/r2资料保留，r2不是当前待批SHA；没有据首轮错误追加权限或重放旧云执行。

## 本次待批清单

`F:/ChatGPT_workshop/techlong-f3b3-readonly-kms-repair-20261011-r3/review-manifest.json`：

- manifest SHA：**`5d1485cf6d9a36bee3da8546124c2d02cf99339c02dfe47aa0e9ceefc47baca6`**。
- 文件SHA：`255b827d7c9e684d320bfa9c7b8b02520f6a3d09cae4ea95873517d466faaef7`。
- 新8文件code SHA：`f382bda1dd4e7401f485e95941cbae64a0956220de1d2e5d30a5cdf1e3be2222`；原10文件064119b9...仍核对一致。
- anchor SHA：`139ed0f461a676de2ff450f1bd2311a53997d960488b7ca97f0e0708a47a6dd5`。
- inventory文件SHA：`4b3e238a915f0a34a32ff0cfa3613d8ac7653c3c6a0dfad14723c787f9197e3b`。
- 模拟文件SHA：`c3872bd43bb1f4b0bda0499ac905cf174ed5fd62cfaeac5d6614132958aa04c9`。
- 截止：**2026-10-11 15:53:45.699UTC / Winnipeg10月11日10:53:45.699CDT**。过期只读刷新后另确认，不能执行旧SHA。

> 我确认按清单 5d1485cf6d9a36bee3da8546124c2d02cf99339c02dfe47aa0e9ceefc47baca6 更新两现有boundary默认v2（保留v1）及两inline，仅授准确Key/自身Secret固定版本的Secrets Manager转发Decrypt，最多4次IAM写、两次新同步只读探针及独立核验；不改Key/Secret/函数代码、不连Neon、不写authority或创建付费Cell；接受IAM非原子/非CAS、传播不保证、部分权限可能留存和外部额外调用，永久新槽位不自动删除/撤权/回滚/补齐/复位或重试，以及低成本但非绝对零费用。

当前未获本清单的实际写/调用批准。确认后仅一次Run；任何失败仅Inspect。自动部署端到端、真实Cell/前驱/生产CF完整读取、密封v3 drain业务兼容和mutation门禁仍未完成，不能把KMS模拟通过当业务上线。
