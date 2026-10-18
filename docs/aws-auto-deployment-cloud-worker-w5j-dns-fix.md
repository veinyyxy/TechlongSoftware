# W5j：DNS 规范化小修复与新固定版本材料（未发布）

2026-10-18，America/Winnipeg。用户已同意结束失败Review的main冻结，**仅修复、测试并准备新版本发布清单**；实际工作流发布、现有IAM trust更新、再次Review及部署均未授权。本阶段不新增业务/数据库/权限支线，不改Route53记录，不升级plan或重建Cell。

## 失败事实及修复

原Review run `39132584005`经用户批准environment后，固定源码checkout及安装成功，runtime在13:47:02 UTC失败。S3准确job前缀完整版本清单为空，job `job_ecbf09030d3da7286ea3ef93`及九行/旧job完整摘要不变，未领取或部署。旧Review-v1/v2永久槽均保留、不重跑。

与此前422不同，**这次实际云运行已读取获批固定Neon Secret**：精确角色会话CloudTrail有一次成功GetSecretValue记录，Route53及相关IAM读取成功。通用错误日志未保留具体异常；不能说未读Secret或唯一失败原因由原始异常证明。本机诊断没有读Secret值/原私密包。区域/全局审计存在摄取延迟，不把查询完整冒充永久完整审计。

确定的代码缺陷：Route53返回ALB别名域名末尾带`.`，而固定期望无末尾点；原normalDns正则过度转义，实际没有正确去掉末尾点和dualstack前缀。已只修`aws-initialized-workload-v5.mjs`的规范化表达式及其调用，导出纯函数供针对性回归。域名目标/HostedZone/别名类型与health、HTTPS/mTLS仍各自严格检查，不接受不同主机/后缀/端口/URL/多余点。

本次云闭包仍76文件，只该provider文件改变；旧摘要 `110f06bcfe0037ffc1bc0e1d4679a6796080564abde42818074807e516b7bb84`，新摘要 `e06c12e53732268ca1665ca6ec77805bd626c9f2bce1d44f66ef8efa430e5299`。activation/runtime的ROOT_CLOSURE随之更新，以免新源码被旧摘要门禁拒绝。旧源码commit/回执不覆盖；原124 pins在历史main `1c45f9e…`逐一核对，当前只允许这两个明确文件例外，其余122保持。

本机新增DNS及发布材料9项、既有activation/root/dispatcher35项，共44项通过；类型检查和定向lint零警告。这里是针对性代码/合同检查，未以模拟结果声称真实新云Review通过。历史124 pins和准确新Git对象在最终Prepare再次核验。

## 发布材料范围（提案，不是执行授权）

`ops/cloud-worker/dns-release-v5.mjs` **只实现Prepare**，拒绝Publish/Activate/Dispatch，不能执行云变更。它在最终clean main生成独立Git index和两个无分支/无ref变动的commit对象：R2仅更新reusable的源码checkout/断言/env到新C2，S2仅把caller的reusable引用更新为R2。两对象未推送；现有两工作流仍指旧C/R，普通代码提交不意味着新云版本已生效。

只读核验既有foundation/template/trust、role ID/boundary/inline、DDB/bucket、environment保护、固定Secret**版本元数据**及Neon目录。复用现有公开S3安装绑定，不上传/覆盖对象，不GetSecretValue，不读原私密包，不连接Aurora、领取job或修改数据库。实际失败/审计和旧槽原件摘要均须匹配。

集中提案只有三项顶层提交，**实际执行仍需另行准备受审发布入口与fresh SHA批准**：

1. 将已核实的R2/S2两commit fast-forward发布到现有main（不force、不新建分支、不自动dispatch）。
2. 在既有foundation stack创建UPDATE Change Set，template仅将WorkerRole trust里的固定`job_workflow_ref@R`替换成准确R2；复用已有role ID、boundary/inline权限和全部OIDC repo/owner/actor/main/environment条件，不扩大能力、不加通配符，不创建IAM资源。
3. 根据本次Create ACK绑定准确ChangeSet ARN；独立核对template完整摘要及Change Set只有WorkerRole非替换AssumeRolePolicyDocument修改后，再执行一次DisableRollback=true，随后独立核验新固定版本/trust。若实际ChangeSet不符合即停止，不自动Execute。

计划保存准确Create请求和template、待ACK绑定Execute规则、两工作流diff及预期资源变化；没有虚构提前知道的ChangeSet ARN。当前`executableEntryAvailable=false`，该准备清单不是可直接执行的安装批准；后续加入发布入口或main变化必须重生最终执行清单。旧W5i dispatcher仍绑定旧源码/历史pins，会安全拒绝新状态，不能绕过它重发；新Review接线及新独立槽另审。

## 完整风险

GitHub fast-forward和CloudFormation/IAM更新不原子，也没有跨服务CAS。发布新caller后而trust仍固定旧R时，OIDC可能临时被拒；失败可留下“新工作流/旧trust”或未执行/执行中的ChangeSet。执行禁用自动失败回滚，可能UPDATE_FAILED；不自动撤销Git、改回trust、补齐/复位/删除/重试。CloudFormation正常更新清理行为与人工恢复可能仍有额外操作风险。

main未保护，读取到一致状态也不能排除并发。所有计划对象和旧原件保持；本机Git对象未签名，可被本机管理员读取或Git GC收集，因此最终批准/执行前必须重新验证对象存在、父链、tree/blob/SHA和remote head，不能只相信本地JSON。新的固定源码/工作流版本必须相互匹配；不使用main代替源码SHA或通配符代替reusable SHA。

准备只读不等于未来运行不收费。保持50 USD/月目标非硬cap，Secret/S3/DDB/父Cell既有成本继续存在；无自动停费保证。只修此确定门禁缺陷，不声称后续ECR/命名空间/authority等完整云Review已经通过，更不是自动部署验收完成。

## 继续命令及追溯

所有源码/测试/文档提交推送后，在平台最终clean main：

```powershell
node --experimental-strip-types ops/cloud-worker/dns-release-v5.mjs --mode Prepare --output F:/ChatGPT_workshop/techlong-w5j-dns-release-20261018-a
```

输出目录必须全新。结果/manifest/release/template/现有安装元数据仅存F盘；不会消费拟发布槽、不自动发布、运行Review或改AWS。临时index和两个commit对象的本地Git写是本次准备范围，主工作tree/ref不动。Source失效只停止并留原件，不刷新后自动重试写。

失败原件：`F:/ChatGPT_workshop/techlong-w5i-cloud-review-failed-independent-20261018-a.json`（raw SHA `59d98dfb68bdbb0ddb56f50a328f7760ea638d35eb9df76bbb397740e91d6466`）；五项只读诊断 `techlong-w5i-fixed-metadata-diagnosis-20261018-a.json`（`0e5412f2555c6b2e94f400c31e4112d588b0946daf8651c1970f1bc61819924a`）；全局角色会话审计 `techlong-w5i-global-read-audit-20261018-a.json`（`ee31f5ce41e4fe70828afc66457b5e94705a4fc46e4f58dea30449165c662032`），均位于F:/ChatGPT_workshop，未保存原日志/签名URL/原始事件或私密值。

机器记录见[W5j准备状态](../ops/aws-sandbox/reviews/cloud-worker-w5j-dns-fix.prepared.json)。现有云版本仍为C=`ac75c4bcbb856babc67d88b6e06212e981a25d90`、R=`7c02d9db3a39fc2f926848a593eb804b642bd1e5`，安装绑定/role ID不变。
