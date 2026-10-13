# F3c9i：KMS 最小修正候选完成；旧身份计划已过期，未安装

2026-10-13 Winnipeg。本轮原计划是准备精确 IAM/table/parent 范围。审阅发现父策略的全局 SourceFunctionArn deny 没有沿用此前已实施的 KMS 转发例外，因此先完成候选修正；核对实时钟时原 plan 已过期，**没有生成可执行安装批准、更新代码/权限、打开登记窗口、登记 parent、调用 Lambda 或退役/重建栈**。自动部署/F3c9i 仍未整体完成。

## 权限及代码修正

原 V4 策略 `DenyOtherOrMissingSource` 是 `Action=*`，包含 `kms:Decrypt`。如果 Secrets Manager 转发解密的上下文不携带 Lambda SourceFunctionArn，则该 deny 阻止解密。原 F3b3 KMS repair 已采用这条例外；本轮不将潜在风险冒充当前父函数实际失败，因为尚未调用父函数。

新 V6 编译器只将这一条 deny 的 `Action=*` 改成 `NotAction=kms:Decrypt`。准确 Key、Secrets Manager ViaService、CallerAccount、两固定 Secret ARN 的 boundary Allow 保留；Secret Get 本身仍要求准确 source function、固定 version/AWSCURRENT，其它动作/region/栈/事务 key/log/self-read 限制全部不变。其它 Key、服务或 Secret 未取得 boundary Allow，直接解密也不能自行提供 ViaService。这里用 boundary 的受限 Allow/隐式拒绝，不新增宽泛 KMS Allow、修改 Key/Secret 或删除旧版本。

SourceFunctionArn 的可用上下文及不能用于 resource policy 的限制见 [AWS 文档](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)；转发与代调用上下文需要按实际服务路径核验，本轮没有真实 KMS/Secret 调用证明。没有直接修改原冻结编译器或已安装包。

旧安装 reader 逐字匹配 V4 IAM 文档，故不能只改 IAM 然后继续使用已安装 r3 代码。新增 V6 reader：**先完整核验实际 V6 policy，只对两个准确 IAM document 响应投影为已验证的 V4 兼容视图**，再交由原 reader 保留真实私有品牌、身份/RoleId/trust、表 freeze、函数/包/实际自哈希及双读检查；V5 的准确 `$LATEST`/null Layers 兼容保留。旧 body、其它栈/版本/额外 permission 均拒绝。

兼容视图的 legacy metadata hash **不是实际 V6 IAM policy 字节摘要**，必须在后续安装/登记材料中另外记录实际 policy digest，并绑定新 bundle/ZIP/Revision，不能宣称旧策略没有变更。新 handler 的执行主体与原 V5 一致，仅替换安装 reader；保留原固定 gate、guarded provision、inline TTL/失败 root 和所有数据库门禁。未登记 parent，后续新包的云安装需 fresh 独立批准；不是登记后静默换包。

## 当前云事实及有限模拟

**12:18:46.174 UTC / Winnipeg 07:18:46.174** 最终 r2 只读审阅：

- 原真实 Stack `.../01a06ca0-c6bf-11f1-898a-0e285576029b` 仍 `CREATE_COMPLETE/RESERVED`，实际资源 0，原 template/参数/tags/token/两输出及角色 flags 通过完整原 V3 双读。
- Source 身份只读有效，parent/workflow 仍缺失；原 r3 Code/Revision、deny-all/空策略/concurrency0、async age60/retry0、其它 parentCommon/foundation 不变量保持。CFN service role 仍空策略。原 109 pins/包/槽保持，创建槽 SHA `89db5acf...` 仍消费，没有复位。
- 原 plan 截止 **2026-10-13 07:02:35.244 UTC / Winnipeg02:02:35.244**，原创建批准截止05:02:44.175 UTC；两者均过期。本轮明确检测，不执行过期范围、不就地延长旧 nonce/时间/模板，不冒充新计划。身份栈没有 cleanup schedule，不会自动销毁，但没有实际 Cell 资源。
- 7 个 AWS IAM SimulateCustomPolicy 只读上下文案例：两个固定 Secret、指定 Key/ViaService/CallerAccount/region且刻意省略 SourceFunctionArn，旧候选两项 `explicitDeny`、新候选两项 `allowed`；错误服务/Secret/Key 三项返回 `implicitDeny`。后面三项还报告其它缺失 context，完整列表保存在私有材料中，**不推广为任意请求或完整有效权限证明**。没有给实际角色安装这些输入 policy。

IAM CreatePolicyVersion 可切换 operative default、PutRolePolicy 会改变角色权限，均不是只读操作；本轮没有调用，未来仍需明确范围审批。[CreatePolicyVersion](https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreatePolicyVersion.html)、[PutRolePolicy](https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutRolePolicy.html)。新候选不是批准凭证，IAM metadata/模拟也不是真实 Lambda 转发解密/有限 gate/数据库 writer/删除闭环证明。

## 最终候选与证据

| 项目 | SHA/值 |
| --- | --- |
| 最终候选 bundle | `5ea6974456883d836764489c01357a003ca4c20cdea6ff704bba1d82858723b4` |
| ZIP | `a1f3807de8f15bf1d3ef3f37d8ba5aa626e610104a488ab66e3cf05330dadbae` |
| AWS CodeSha256 候选值 | `ofOAfejxW/HT7z832LpapibmEBBKSIq2bjzwUzDa264=` |
| build r2 报告文件 | `71e787390299e73a369547fa4f421c543b25ffc69b772eb9554be733e9b98662` |
| 115 代码绑定（原109 + 六新文件） | `381c1726baf7b2d1a93b04351a344d490f972c61763cee5da3b835a3bd801b3f` |
| 最终只读 r2 报告 | `c85ae78daa07dd58464217b274170e88d01e50be9b565f0ca3918d0d8712bf92` |
| 真实 stack/locks evidence 文件 | `e46e58832d73dfc7b516b6366d80c3b0825764068690a924ca11dc7db9cfa3e0` |
| 历史准确 Stack 的旧 IAM 候选 | `818dea43869b8c4914694acb7df4d0908b4207a36c657ab166d16ea79561aa9c`，6037 bytes |
| 同历史 Stack 的 V6 IAM 候选 | `084968b6c452f5411c085d00786a3449b2ee7c6600a8fa33c7b22eac47eb8108`，6050 bytes |

候选 bundle 2,355,162 bytes / ZIP432,966 bytes，handler仍`cell-birth-coordinator-v4.handler`、Node22/x86/256MB/120s；内部两次构建/ZIP一致，解压回读一致，无外部 npm 依赖启动、两种无效事件在凭据前拒绝。package-lock `d2fe3d8e...`、esbuild0.28.0/fflate0.7.4保持，无新依赖/本地 Docker/镜像重建。

5 新＋12 相邻共 **17 项测试通过**、typecheck、定向 lint零警告及syntax通过。初次类型声明问题只改新文件，r1草稿/证据保留；最终r2是当前候选，旧r3仍是实际云运行字节，旧文件及消费槽不改。不是新的数据库隔离模拟或旧 generation 权限探针。

私有产物 `F:/ChatGPT_workshop/techlong-f3c9i-kms-parent-bundle-20261013-r2/`；只读材料 `F:/ChatGPT_workshop/techlong-f3c9i-kms-review-20261013-r2/`。两 r1 目录和所有 F3c9h 创建/停止/刷新回执保留。实际 AWS/IAM/authority 写、Secret值读取、Neon连接/写入、Invoke、code上传、删除/创建资源为 **0**，runtime关闭。50 USD/月目标非硬cap，既有 Secret/日志费用仍可能存在。

## 需要用户决定的恢复方向

不能把旧过期 identity 计划延长后登记，也不能复用已消费的创建槽。建议先**仅准备准确旧零资源 Stack ARN 的退役方案**供独立 fresh 审批；获批并独立确认退役后，再准备独立新 birth/新永久槽、保留所有旧记录。实际删除、重新创建、V6 code更新、IAM安装、表窗口/parent、gate及付费阶段仍各按具体范围/新SHA单独批准，本轮不包含它们。

新计划建立前先冻结其余运行包/权限/登记入口和审批材料，临近连续执行再建立短时身份，以控制 TTL 的使用。未得到用户对这一恢复方向的同意前，不自动实现云删除或开始新 generation，不生成误导性的“可立即安装”旧计划 SHA。
