# F3c9f：锁定期最终 gate-capable 运行包准备完成

2026-10-12 Winnipeg。本阶段仅代码、打包、自检和交接；**没有AWS调用、Secret值读取、Neon连接或写入、Lambda调用、权限安装、parent登记、RESERVED或付费Cell创建。** AWS锁定状态沿用F3c9c历史验收，本阶段未重新读取，不宣称当前云端配置已重新核验。

## 完成的实现

- 新V5适配层仅接受准确同一函数的未限定ARN或`:$LATEST`、准确name/Version，以及不存在、null或空Layers。不接受alias、数字版本、前缀相似函数或其它account/region。继续使用V4私有proof品牌和完整身份、RoleId、trust、IAM全文、表策略、ZIP、Revision、实际运行bundle自哈希及双回读检查；不是把旧bootstrap ZIP固定值用于新包。
- 新SQL传输适配器仅替换准确旧jobs语句为`pending/running/retry_wait`；参数、查询对象、事务配置及原解析器保留。原V4组合已经在同一事务额外补查真实jobs，并非此前漏掉pending；新包统一底层谓词，同时保留原额外覆盖和品牌。
- V5 registry在发布前、新DB loader在读取材料前均要求F3c9e真实失败保护SHA `015db4276a151d5c0dd0fb96cdb6df214af40fc8be89c8d6d955071b4c7340b9`。没有从事件、环境变量或旧投影基线替换该值。
- 新handler仍打包为`cell-birth-coordinator-v4.mjs`、`cell-birth-coordinator-v4.handler`，保留guarded provision及inline失败/TTL清理组合、不调用旧child。新增固定gate分支，与生命周期执行分支分开；允许登记前准确缺失模式，或登记后绑定完整准确已批准parent SHA的只读模式。

原F3c9e **70文件pins逐一归一LF核对，无漂移**，原SQL/写入口/旧包不改；旧消费槽SHA `d113cae152d5eb0a3c4b10e7f16fd07983813bd303c8d0e057d729676f2b7d9e`、新消费槽SHA `f5cb3a943c2751de168afbcf2b71766635a667443a2e22f82fe585e049d6bc39` 均原样保留，不能重放/复位或换目录。旧包仍是历史实际安装字节，新包尚未安装。

## 固定gate的范围及限制

入口事件仅绑定固定spec、完整运行binding、准确Cell stack ARN、15分钟窗口、`expectedParentSha256`（null或准确SHA）和请求digest；没有任意键、SQL、Secret、URL、命令、条件、principal或权限文档参数。**请求SHA只是请求绑定，不是人类批准凭证。** 实际调用须未来独立fresh本地审批/永久槽入口；本阶段未提供或执行写/调用runner。具备Invoke权限的调用者可能重复发送该固定入口，不能把事件字段当作认证。

1. 原真实metadata reader检查实际本地bundle、准确已安装IAM/table策略及关闭的Source登记窗口。null模式要求parent缺失；SHA模式严格解析真实完整canonical V4 record并绑定parent SHA、同一runtime binding/stack/protection及批准/delegation窗口；不能只看存在。所有相关固定workflow/failed槽仍必须缺失，前后记录必须一致。这样登记窗口关闭后可直接验收同一记录，不需要为了gate重新开启Source写窗口，也不产生installed-parent/ownership品牌。
2. 两次允许路径条件事务：固定可写槽Put、固定可读槽ConditionCheck。五次拒绝路径：parent Put、activation Put、其它键Put、混合键事务、直接provision Put。**最多7次条件写API请求，不是AWS只读操作。** 每项始终带`attribute_exists(#key) AND attribute_not_exists(#key)`，不论对象存在或并发改变都不可满足；没有Update/Delete，也不请求返回旧Item。
3. 允许路径仅接受准确`TransactionCanceledException`及每项准确`ConditionalCheckFailed`；拒绝路径仅接受`AccessDeniedException`。None/缺失reasons、参数错误、节流、超时或条件失败不证明deny；成功或不确定响应立刻inspect-only，不重试/补写。
4. 只读取自身固定reader Secret准确版本/AWSCURRENT，TLS以`techlong_cell_cleanup_reader`执行14条固定SELECT的单SERIALIZABLE READ ONLY DEFERRABLE事务。原seal/真实protection/open0/受限reader及零租户门禁必须通过。**不读取drain密码、不构造真实writer、不调用definer或写业务状态。** 最后再次检查槽缺失及完整metadata不漂移。

条件事务的全成或全败语义及有序取消原因来自[AWS TransactWriteItems API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)。这是有限请求形状的观察，不推广为任意事务、其它角色/来源/区域的有效deny证明，也不证明DeleteStack/PassRole、writer认证、失败入口行为或云清理。handler只返回有界摘要、不返回Secret/URL/原始provider消息/Item；云提供者及第三方日志风险仍存在。

## 最终候选产物

最终r3构建内部双构建/双ZIP比较一致，只有node内置external；脱离node_modules、无AWS凭据环境下启动并在凭据/provider前拒绝两种无效事件。r1/r2旧候选保留，不再作为最终登记包。

| 绑定 | SHA/值 |
| --- | --- |
| 最终bundle | `71f31e586f2eeb737c158b917cf799595f76803f8fe725476e0b6ed47a86f25c` |
| 最终ZIP | `b53ba821ce2619b90c4d941e5bc4969b131d4e9e777f3498a75320deca136e47` |
| AWS CodeSha256 | `tTuoIc4mGbkMTZQeW8SWmxMdTp53fzSYp1Mg3soTbkc=` |
| r3构建报告文件 | `ce8ff76b25b3dae56498c4e453698f423639541bcb45861e2d11de913d531ddb` |
| gate spec | `45c434b1c27c0e932aa5ed08d2ebe346345a824c3acdc953c26051a490badb99` |
| 七请求形状 | `a29f95828579c89129e169745637b6bbbbd0a71b7bf881be205bb53cf4f661b6` |
| async配置方案 | `70c9cae715aae67d87127fbb11c08c8199a3226944ad3ef9199780e7190a57a4` |

bundle 2,351,722 bytes，ZIP 432,218 bytes；Node22/x86_64/256MB/120s。package-lock保持`d2fe3d8e93e04ed696c6dd7d5a44a0861d9c9e61ced0caecea2875a375ee39a5`；esbuild0.28.0/fflate0.7.4，无新依赖、Docker或镜像重建。候选及完整48个sourcePins在私有 `F:/ChatGPT_workshop/techlong-f3c9f-parent-bundle-20261012-r3/`；r1/r2报告和包均保留。不得登记parent后静默换包。

12新＋23相邻共 **35测试通过**，覆盖准确metadata/原proof、真实jobs传输、固定不可满足条件、严格允许/拒绝分类、事件范围/窗口、意外parent/槽占用停止、准确完整parent绑定及到期拒绝、不确定响应不重试、固定reader材料和async门禁；typecheck、定向eslint零警告及builder语法通过。这些是假传输上的真实解析器/品牌测试，不是云验收；没有重复旧generation探针或隔离数据库模拟。

## async方案与下一切片

只准备准确`$LATEST`的`MaximumEventAgeInSeconds=60`、`MaximumRetryAttempts=0`、无destination；reserved concurrency仍0。空destination接受AWS的`{}`、空OnSuccess/OnFailure或空Destination表示，拒绝其它字段/非空目标。60是API最小age，0是函数错误重试配置；配置更换可能覆盖旧设置，async API没有RevisionId CAS，非原子/并发可能遗留部分设置。[AWS配置API](https://docs.aws.amazon.com/lambda/latest/api/API_PutFunctionEventInvokeConfig.html)、[CLI回读结构](https://docs.aws.amazon.com/cli/latest/reference/lambda/get-function-event-invoke-config.html)。

**retry0不是绝对不重投，age60不是精确60秒执行/销毁承诺**；节流/服务错误和队列重复投递仍需原永久ownership/once门禁，concurrency0也不撤销已运行调用，不带来exactly-once证明。[AWS异步错误与重复投递说明](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)。

下一切片F3c9g先集中只读当前云状态/Source身份和候选sourcePins，准备**准确现有函数一次Revision条件代码更新＋一次async配置**的fresh清单/单次runner/独立Inspect，保留deny-all boundary、无inline及concurrency0；不新增IAM、不Invoke、不创建Cell。当前spec/包SHA均不是该云变更的执行批准SHA，不应直接运行AWS写命令。只在实际凭据失败时请Source刷新。

随后最终RESERVED/准确IAM/table窗口/Source登记及实际固定gate各按资源和fresh范围审批；实际gate调用还须准确批准短暂concurrency窗口和成功/失败后回锁0，不用本轮concurrency0方案替代调用授权。Source SDK/runner须明确使用V5 metadata兼容层，不能拿旧bootstrap Inspector验证新ZIP，也不放宽旧记录。真正受限allow-deny、其它旧writer冻结证明、writer/失败/TTL实际验收及ARMED/PAID仍未完成。最终包冻结之前不提前创建会在实现期间过期的RESERVED；50 USD/月仍是目标、不是硬cap或全年常驻许可。**本阶段完成≠F3完成≠自动部署已启用。**
