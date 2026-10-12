# F3c5：完整v3模板、独立证据和清理计划接口

2026-10-12 Winnipeg。本切片完成完整v3资源模板、匹配AWS证据adapter、schema2前驱兼容桥，以及birth范围内清理/失败补偿的数据计划接口。**自动部署/清理闭环尚未完成**：实际协调器、批准登记、失败入场排除围栏、certified census和补偿执行器仍缺失。只有一次AWS ValidateTemplate和只读查询，资源/IAM/Invoke/数据库写入0；没有创建Reserved Stack或付费Cell。

## 三阶段模板

独立`shared-cell-stack-v3.ts`复用原基础架构，删除旧schema1/PLAN_ONLY Janitor调度，替换为拟建v3生命周期协调器。旧模板、旧validator、已部署函数和历史绑定不改。默认renderOnly/applyReady=false。

| 阶段 | 生效资源 | 作用 |
| --- | --- | --- |
| RESERVED（默认） | 0 | 仅计划取得Stack身份；实际栈尚不存在 |
| ARMED | 1个ENABLED生命周期Schedule | 必须先独立验收协调器、批准登记、角色/调用与异步配置，不能现在执行 |
| PAID | Schedule及原25项网络/ECS/ALB/日志/Aurora资源 | 全部付费资源依赖Schedule，输出按阶段加Condition；需另批准 |

调度事件只携带schema3 `reconcile_approved_cell_birth_v3`、birth intent SHA和`${AWS::StackId}`真实解析的完整ARN，不使用创建前未知的provision/delete SHA。retry0、最大事件年龄60秒、ActionAfterCompletion=NONE；不承诺Lambda异步队列零重复。原PG16.14/maxACU1、无NAT/endpoint、Cell3h/tenant2h设置保留。

应用阶段验证仅允许RESERVED→ARMED→PAID。外部CFN仍可能手动倒退；[AWS Conditions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/conditions-section-structure.html)在条件变false时删除资源，因此PAID→ARMED/RESERVED可能删除付费资源，必须另行批准，不能自动当作回滚。

## 独立证据与数据计划

`AwsSdkCellStackEvidenceV3`只持有STS/CFN读命令。Source只读、Provisioner和未来生命周期Coordinator身份域固定；Source证据不能升级为provision/cleanup能力。准确ARN、role、四标签、全部参数、Original Template、创建ClientRequestToken、阶段和分页inventory均绑定；前后两次完整读取稳定且≤30秒，校验physical-ID/输出、出生时钟、分页及终态，拒绝额外/缺失/重复/错类型资源和其它Cell。准确名称缺失仅为只读ABSENT；已给完整ARN的缺失不能复用槽位。

新branded证据不能由JSON复制制造。`compileV3ProvisionPredecessor`仅从complete PAID真实证据生成兼容原schema2的前驱数据，不伪造旧renderer WeakSet、不安装authority。`V3CellCleanupStackEvidenceBridge`完成新v3读回后复用原cleanup proof接口，旧验证不放宽。部分失败/终态partial inventory独立分类，DisableRollback须核验，不能生成成功TTL前驱；[失败选项](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/stack-failure-options.html)亦不保证AWS内部不回滚。

`cell-birth-lifecycle-v3.ts`提供委托候选/冷decoder、到期准确drain、certified sealed-v3 zero/Stack候选范围内authority记录，以及现有TTL executor准确plan SHA/event的数据编译。绑定真实RESERVED空清单、Stack、RoleId/代码、owner/代次/模板和3h+1h上限，拒绝提前/过期/跨对象或复制候选。**所有install/invoke/runtime标志false**；范围描述不是授予程序，独立批准登记和实际协调器尚未实现，不能用候选SHA取代用户fresh审批。

失败补偿仅编译准确STANDARD DeleteStack请求和不可变intent SHA/token，无Retain/Force/Skip，mutationAuthorized=false。实际写之前还缺：明确批准并登记的parent范围、failed birth与activation/provision缺失的原子排除围栏、certified未入场零租户census、立即精确回读、once-only journal及独立恢复。不能凭“创建失败”直接删栈、借用旧placeholder补偿或假冒到期draining/zero proof。[DeleteStack API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeleteStack.html)

若未来采用“批准精确birth后，在该birth范围自动发行到期清理授权”，必须在具体云清单里明确批准该委托、代码和风险，再由实际登记/协调器消费；本轮不启用，不写登记/authority/journal或业务状态。

## 真实AWS只读验证

2026-10-12 **17:07:15.912 UTC / Winnipeg12:07:15.912**：Source准确，现有ACM `6d1f2880...` ISSUED/正确sandbox与wildcard SAN，TrustStore `aa1771fd0469cc44` ACTIVE/1CA，ca-central-1a/b可用。仅元数据验收，不重复上传或声称端到端mTLS。

AWS **ValidateTemplate通过**：Capabilities空，六参数、LifecyclePhase默认RESERVED，26资源定义。该[API](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ValidateTemplate.html)不执行资源，也不证明IAM/DB/调度/清理已通过。新adapter于17:07:15.893 UTC确认Cell栈ABSENT；新协调器Function及两拟建Role均ABSENT。旧Cell CFN role存在，RoleId `AROAV3GNMXTZOJLYFB4HB`、原boundary ARN，未证明有效执行权限。

输入环境/owner/nonce是新birth审阅提案，不是Neon当前行、已有客户deployment或已安装激活状态。拟requestedAt17:07:14.320 UTC、到期20:07:14.320 UTC / Winnipeg15:07:14.320，清理委托拟至21:07:14.320 UTC / Winnipeg16:07:14.320；没有实际栈或调度，日期仅提案，实际实现/安装就绪后必须fresh重编译，不过期重放。本报告不是云执行批准清单，Reservation/ARMED/PAID均未授权。

没有重跑已消费费用命令、上传baseline、发布镜像、调用旧探针或改Neon。Budget50/read100-write2历史成功证据保持，本切片不把它伪装成新的当前费用admission；未来仍fresh验收，50USD目标非硬cap。

## 验证和材料

10新+22相邻共 **32测试通过**；typecheck、定向lint无warning、CLI syntax通过。SDK transport明确为fixture，在线仅验证模板与缺失/元数据状态，未验收付费执行或自动清理。

私有目录 `F:/ChatGPT_workshop/techlong-f3c5-cell-v3-20261012-r1/`：报告SHA `6b06b46319d385b2b8f9fa7d8068b7468dc12cdc8119053165cb7a6940950058`；plan文件SHA `cc4edaa9043746c3456cce7bf2017fec1baf8383e3c8b641ded66b71dc8ad47f`，plan SHA `232899ef5de8dc3edb990fdd5dff808b12fb3f567039420a2e9363cdb4292165`；birth SHA `d629ff473a99f64ee8d4e718645fd10902daa64d5f3045f399150aad4cc7eed2`（非批准）。template文件SHA `7a80f3e256a07323748d1b088e60ea332bd277742bea9ca571792f8d738c73ff` / canonical `9a1f7bba17d5f925b55db56e3321ba8b9ce4d14eff26ecc99851adea17ad1db6`；snapshot SHA `461289c48011a01f99ad36adecd306cad6084033e26854e3cb18bc023373b8c3`。

32代码绑定 `f69e4250c0c9894b1981579e1e7ddc0a0a70e214536fe53585190a24700209d8`，最后本地回读未变；原24/16、旧文件与消费槽位保持。[公开摘要](../ops/aws-sandbox/reviews/f3c5-cell-v3-template-evidence.prepared.json)。

下一切片集中批准登记/实际协调器、失败入场排除围栏/census、不可变补偿journal/恢复，再准备具体IAM/函数与三阶段session云批准；不抢先创建会在后续开发期间到期的Reserved Stack。
