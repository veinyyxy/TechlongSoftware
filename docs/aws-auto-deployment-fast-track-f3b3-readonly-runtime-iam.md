# F3b3：只读 IAM 基础安装清单，运行时允许路径尚未证明

2026-10-08 Winnipeg。两个既有Secret/Neon控制角色已在上一批真实COMMIT和两次认证回读证明就绪。本批完成独立的IAM安装入口及当前AWS只读核对，**尚未批准/创建IAM资源、安装或调用Lambda、写authority、启用runtime。** 50USD/月仍为目标，不是费用硬上限。

## 拟议范围：四个新IAM对象、两条内嵌策略、最多六次写API

| 新角色 | 新专属boundary | 角色内嵌策略 | 未来来源函数 |
| --- | --- | --- | --- |
| TechlongSandboxCellTtlExecutorRole | TechlongSandboxCellTtlExecutorBoundaryV3 | RuntimeReadOnlyV3 | techlong-sandbox-cell-ttl-executor-v3 |
| TechlongSandboxCellDrainCoordinatorRole | TechlongSandboxCellDrainCoordinatorBoundaryV1 | RuntimeReadOnlyV1 | techlong-sandbox-cell-drain-coordinator |

IAM对象位于账户402010193138的根path（IAM是全局服务）；未来函数/API请求固定ca-central-1。两个role信任主体仅`lambda.amazonaws.com`，不授任何IAM用户/Operator AssumeRole。函数来源围栏置于identity policy和boundary中，不能误当成trust policy已经保证特定函数。[AWS来源函数条件说明](https://docs.aws.amazon.com/lambda/latest/dg/permissions-source-function-arn.html)。

两个boundary与各自角色内嵌identity policy采用同一严格文档（5555/3418字符，低于6144额度）。boundary仅是上限，不单独授予权限；显式Deny和allow范围同时存在，避免误称只附boundary即已获授权。[AWS边界语义](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)。

- 仅允许固定来源函数ARN和region的`sts:GetCallerIdentity`、准确自身Secret ARN的`GetSecretValue`且请求明确AWSCURRENT、准确authority表及限定key的GetItem；两个角色的Secret不能互换。GetCallerIdentity是身份检查，不是Secrets/DDB访问已经获准的证明。
- TTL role：GetItem仅在TransactGetItems内部原子读取`cell:cell-sandbox-1`和`sealed-cell-ttl-v3:cell:cell-sandbox-1`；journal允许直接Get准确v3 intent/receipt前缀及64字符后缀。所有LeadingKeys条件同时检查非空，混入其他key拒绝。AWS事务读取依据底层GetItem授权，不授虚构的TransactGetItems IAM action。[事务IAM说明](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html)。
- Drain role：仅直接Get`cell:cell-sandbox-1`，不授CF权限或journal权限。读取drain Secret意味着未来获批函数可使用已有20项Neon列权限；不是数据库纯读/行过滤角色。
- TTL可ListStacks读取全部Stack名称进行依赖检查，DescribeStacks/GetTemplate/ListStackResources仅限`techlong-sandbox-cell-sandbox-1/*`。这些是读取，不允许DeleteStack或创建Stack。
- 两role仅对各自未来函数的准确既有log-stream允许CreateLogStream/PutLogEvents，**不授CreateLogGroup、不在本批创建日志组**。因此文档称“只读AWS+准确日志流写”，不是所有API绝对只读；日志费用仍按服务规则，未来创建/运行函数另批。
- 显式Deny所有其他action、错/缺来源、其他region、其他Secret/阶段、其他表/key/log，以及TTL的其他Stack。**没有Put/Update/Delete/ConditionCheck、Query/Scan、PassRole/AssumeRole、IAM管理、Secret写、Lambda创建/调用或CF删除权限。**

实际创建顺序是两次CreatePolicy（含标签），再对各自新role一次CreateRole（附自身boundary/标签/一小时MaxSessionDuration）及一次PutRolePolicy。标签绑定本次批准SHA/Project/Environment/Purpose。Put前两次只读核对刚创建role的RoleId/信任/boundary/标签/无外附或内嵌策略；只操作本次新RoleId。**IAM API不能把RoleId放入PutRolePolicy作为服务端CAS，管理员并发改名/重建或变更仍有竞态，不能保证跨API原子。** 不安装付费Cell、不复用旧Janitor/boundary/PLAN_ONLY对象。

新永久slot `techlong-f3b3-readonly-runtime-iam-v1-consumed` 目前为空；任一写调用前永久保存attempt，失响应或任一阶段失败仅Inspect，不自动删除、撤权、继续补齐、刷新清单重放或复位。直接IAM API不经CloudFormation，避免把自动rollback删除当成已授权恢复。失败可能留下部分IAM对象，需另审后续处置。

## 真实只读状态与authority顺序

私有 `F:/ChatGPT_workshop/techlong-f3b3-readonly-iam-20261008-d5/read-only-inventory.json` SHA `171ff862a7fb8d26d59c5b9545fc28fe142ac8eab348bfabfddfbaf8b92f56f6`；采集始于**2026-10-09 00:51:46.080UTC / 2026-10-08 19:51:46.080CDT**，完整采集小于30秒。每批凭据先STS核对准确Source IAM user，与该批SDK/CLI使用同一凭据对象，不接受endpoint override/身份回退，maxAttempts=1。

两个新role、两个新boundary、TTL-v3和drain两函数均ABSENT。两个准确Secret仍原ARN/唯一初始UUID/AWSCURRENT/原标签，无rotation/replica/resource policy；本批仅元数据与完整version枚举，**没有GetSecretValue/生成密码或读取Neon**。原最后真实凭据Inspect文件SHA9537b004...被固定引用，不能把它冒充本轮新DB观察。

authority表ACTIVE/PAY_PER_REQUEST、唯一HASH key=authority_key；GetResourcePolicy观察PolicyNotFound，属于最终一致元数据，不能保证并发外部policy变更绝对不存在。没有把ResourceNotFound当“无policy”的证明。[该API一致性和错误语义](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetResourcePolicy.html)。

两个准确authority key的ConsistentRead均ABSENT；Cell Stack以准确名字绑定的ValidationError证明ABSENT。因此**目前没有可生成/安装的真实v3 authority记录**：必须先有真实Cell/provision-v2前驱，再有到期draining和完整zero/raw witness，才能编译新authority批准记录。不能凭这份IAM清单创建空前驱、假authority或启用删除。prerequisites SHA `191a3784ff04d436c94ee165ffc1b1e2816db7d2c974236ed1ad8e8c6b8d1802`，Run前全部重新读取且必须不漂移。

## 验证的真实结果和缺口（不可宣称全部IAM允许路径通过）

8项定向状态机/范围/失响应/无重试/角色ID/永久slot测试，typecheck、lint和JS语法通过。没有增加本地Docker、重建app/lifecycle镜像、做新PG离线演练或调用生产写API。

AWS在线IAM模拟32案例，24个预期拒绝案例均拒绝，**8个预期允许案例仍被拒绝，允许路径没有证明**。匹配报告指向来源函数围栏；最小比较对ArnEquals/ArnNotEquals/ArnLike/StringEquals、大小写、string/stringList、现有/不存在函数及虚拟Caller均未观察到相同来源允许。GetContextKeys能解析lambda:SourceFunctionArn；aws:RequestedRegion和aws:SourceArn基准可匹配。原因尚不能唯一确定，不声称这是AWS已确认bug或已知不支持，也不能因为拒绝案例都拒绝就证明来源匹配时其他条件必然正确。

安装文档保留来源围栏，没有删除它来让模拟变绿；清单scope明确包含`sourceFunctionAllowPathNotProvedBySimulator=true`及`liveReadProofRequiredBeforeAnyMutationGrant=true`。**本清单只供IAM基础对象安装审批，不承诺未来Lambda读API已可用；用户须接受此缺口及后续可能另审修正策略的风险。** 真实Lambda凭据/读取必须在后续另批的低成本、只读实机验收中证明，未通过不得安装任何本role删除/authority写grant。默认Worker、旧函数和旧IAM不动。[模拟不是实机证明](https://docs.aws.amazon.com/IAM/latest/APIReference/API_SimulateCustomPolicy.html)。

另10个Source现有CreatePolicy/TagPolicy/CreateRole/TagRole/PutRolePolicy精确资源模拟均allowed，仅权限预检，不是创建成功保证。私有policy-simulation.json SHA `282592a5683549b4ba6deb0e2b1f4b200b0f1dcc2849f9084e2e3e425cb860cf`。d1/d2错误指向DDB无policy错误分类，修正为官方PolicyNotFound后读取通过；d3/d4保留来源拒绝发现，d4脱敏位置/决策文件保留，不重标为成功；所有轮次AWS写=0、slot未消费。

## 待批清单与继续位置

清单 `F:/ChatGPT_workshop/techlong-f3b3-readonly-iam-20261008-d5/review-manifest.json`：

- manifest SHA **`748999ae1ebb298670243d1dae36cf29accb75046daaab981f136534f77764aa`**。
- 文件 SHA `9c77ac5c1da3df18a7d4f912fb5f457ef6e1ac1781b1862e1edbacaf53ec8cb3`。
- 新5文件code SHA `91a6dd3fa15abd018838ad5a3777cb436716eaa842c761a454574c29fb6e93c8`；原Neon bootstrap/recovery代码与package/lock不变，消费slot不重放。
- 截止 **2026-10-09 01:51:52.106UTC / 2026-10-08 20:51:52.106CDT**；只批准IAM基础资源和本节列出的风险，不批准部署或有效运行时权限。

新CLI提供Review、一次批准Run及独立Inspect，Run只能从四对象全ABSENT开始。后续：本批确认后IAM安装+独立核验；然后准备准确Lambda/日志及一次只读实机证明范围，核对AWS-managed环境加密等非代码调用、源条件和drain与密封v3的兼容接线（不能默认旧v2 drain已接受密封记录）。实际安装/调用、策略修正及最终Mutation/authority范围各需新SHA确认；authority必须等待真实Cell与前驱，不使用历史候选当live授权。

本批没有产生IAM/Secret/Neon/Lambda/DDB写入或付费Cell，两个Secret现有收费不因此消失；只读服务请求不保证绝对零费用。两个main按默认Git授权提交/推送代码和脱敏证据，后端只同步进度文档。
