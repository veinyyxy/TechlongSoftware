# F3b3：两只读 Lambda 已安装，Secret 的 KMS 读取门禁未通过

执行于 Winnipeg 2026-10-08 23:47–23:49，后续只读取证至23:59。用户批准 `e49ce088cffc18273bcd43d87dd44bf042c51665667f25ee1790cc548d24291e` 后，在原窗口内一次 Run 完成全部6次安装写及两次同步 Invoke。**安装完整并经独立核验；实机读取验收未全通过，不能宣称自动部署或业务runtime上线。** 两函数、两日志组按批准保留，不删除、补齐、修改权限或追加调用。

## 实际状态

| 对象 | 创建/配置回读 | 一次探针结果 |
| --- | --- | --- |
| techlong-sandbox-cell-ttl-executor-v3 | OWN_READY，准确p2 ZIP SHA/角色/配置/标签 | 身份、原子两key、两journal、CF第一页/准确Cell缺失读取通过；自身Secret读取AccessDeniedException |
| techlong-sandbox-cell-drain-coordinator | OWN_READY，准确p2 ZIP SHA/角色/配置/标签 | 身份、准确provision key读取通过；自身Secret读取AccessDeniedException |
| /aws/lambda/techlong-sandbox-cell-ttl-executor-v3 | OWN_READY，7天保留/准确标签 | 完整脱敏响应摘要匹配云日志 |
| /aws/lambda/techlong-sandbox-cell-drain-coordinator | OWN_READY，7天保留/准确标签 | 完整脱敏响应摘要匹配云日志 |

两次同步调用均返回有效闭合脱敏回执，无HTTP/FunctionError或失响应；失败的是回执中的Secret读取步骤，分别请求ID `db16322f-7579-4e4e-82b4-b91006bc2b30` / `f015a1ae-343d-4ed6-bd21-7fcee9bee63b`。没有调用重试，追加诊断只读、Invoke=0。

原角色/boundary/inline/RoleId/标签的完整foundation SHA `ab9bd91bbc70a5dbc684094d76df3672aa21b75aa1dac753c8ec21cba1fbabc9` 未漂移。代码绑定 `064119b9576e1dd5beb73900ec1290f7bed28204905f989ea03be30bf83b7d7d`、原manifest、p2 ZIP及全部旧IAM/Neonbinding保持；没有修改已批执行CLI以掩盖失败。

两 authority key和journal读取返回ABSENT，准确Cell缺失；CF不存在资源的读取不证明真实生产CF资源读/完整依赖集合。没有Cell/前驱/zero raw witness或有效删除authority，密封v3 drain业务兼容未证明。两Secret均未向探针返回值，**Secret值成功读取=0、Neon连接/写=0、IAM/Secret/authority写=0、Cell/ECS创建=0**。Lambda实际Active但仅有只读探针代码，默认Worker/业务runtime关闭；50USD/月仍目标，不是费用硬上限。

## 独立核验与分页日志的真实结论

Run后独立inventory观察起点 **2026-10-09 04:49:21.058UTC**，四对象OWN_READY，两日志摘要找到；新进程Inspect起点 **04:51:33.811UTC**，对象仍OWN_READY，但其第一页日志查询没有找到记录，liveReadProof仍false。保留两个原始结果，不重标为成功。

追加独立分页只读工具，对每个准确日志组以清单nonce查询，读取第3页后才找到对应函数ARN/requestId/nonce/**完整响应SHA**。23:55的d1和23:59:07.524的d2均证明两marker匹配；d1页数显示存在+1计数偏差，原报告保留，d2只读复核纠正为各3页。不需要为“第一页面没找到”补调函数。当前已批CLI只看第一页，后继代码应修正分页，但不能改本次绑定后重放执行。

## KMS拒绝的只读定位

CloudTrail在两准确Role/Secret上找到 `GetSecretValue` AccessDenied事件：**04:48:59UTC**（TTL）/ **04:49:20UTC**（drain）。两请求的VersionId均与固定初始UUID一致、VersionStage均AWSCURRENT；脱敏错误分类明确含KMS/解密拒绝。两Secret元数据仍无自定义KMS标识、无resource policy、唯一初始版本/AWSCURRENT，不是本次新建、换密或权限修改。

`alias/aws/secretsmanager`只读解析为 **arn:aws:kms:ca-central-1:402010193138:key/3af8de5c-dbb7-451a-83f3-983fb1673570**，KeyManager=AWS/Enabled，key policy规范化SHA `7c8b6b20a7a9a74535e08954eb2cf5435f71cd442a39596e1ea60e43dd631b51`。现有两个role的identity/boundary中 `DenyAllOtherActions` 的NotAction不含 `kms:Decrypt`，因此明确覆盖该动作。这是已确认的授权阻断点；没有独立Decrypt CloudTrail事件，本轮不能唯一证明所有转发上下文/其他Deny是否还会阻断修正后的调用。

Secrets Manager读取值依赖KMS解密，即使用AWS-managed key，其key policy的许可也不能作为消除显式Deny的证明。[官方Secrets Manager解密与AWS-managed key授权说明](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)、[显式拒绝优先级](https://docs.aws.amazon.com/secretsmanager/latest/userguide/determine-acccess_examine-iam-policies.html)。这与上一阶段Lambda默认环境加密无需新增权限不是同一调用链。来源函数围栏已在实际DDB/CF/日志链观察到正向路径，不应因Secret/KMS拒绝就删除整条来源约束。

## 留存证据和继续位置

私有回执 `F:/ChatGPT_workshop/techlong-f3b3-readonly-lambda-20261008-r5-run/submission-receipt.json` SHA `020fdb1cbefacc3af98bf344d7c5cad826f388f7149330ad919efc6b9e6a2c2d`；两独立Inspect文件SHA `84e6171dcc8b5b48dcf2116d0130a02739211f2dd616a889fe969c4dae1bc019` / `1c92427b1b39527a1ef91f4d373c3a1d6108b931b7a2a450cb938aad3de565e4`。

只读诊断d1文件 `F:/ChatGPT_workshop/techlong-f3b3-readonly-lambda-diagnostics-20261008-d1/read-only-diagnostic.json` SHA `21a8c086a300a2795f87bae13cb544c0e063e70c9e6913ba21061a2f83848986`；d2分页日志文件对应d2目录，SHA `ae9e33d62601d48327b4a6394ac46d41d126f3d4e990b96c98302b30eb6ed7b7`。没有原始provider日志/CloudTrail记录/密钥policy/Secret值持久化；仅允许闭合字段及摘要。

永久槽位 `techlong-f3b3-readonly-lambda-install-v1-consumed` 已消费，所有attempt/confirmed/两Invoke回执与旧记录保留；**不再次Run、调用、删除、补齐、reset或重新创建。** 尚余审批窗口也不构成重放授权。

下一小阶段准备针对准确AWS-managed key、各自Secret ARN/VersionId、Secrets Manager ViaService/CallerAccount的**最小KMS读取例外**，同时审阅转发调用的来源上下文，保留直接Secret读取的函数/region/版本限制及所有写拒绝；不能仅追加Allow而忽略原显式Deny，也不创建/更换KMS key或改Secret。新IAM变更和新探针调用须独立fresh SHA/新一次性入口批准，不复用本次槽位或旧审批。当前未实现/批准这份修正，业务runtime/authority写/delete仍不得开启。
