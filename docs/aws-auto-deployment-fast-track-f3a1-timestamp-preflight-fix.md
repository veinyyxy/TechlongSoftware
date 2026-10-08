# F3a1：已批准发布在写入前停止，GitHub日期解析已修复

最新状态：新1ab清单已获批准且唯一执行成功，双镜像发布/扫描与独立原始回执一致，Source立即Revoke并独立Locked/v6；该slot已消费、窗口已过期，不得重放。见 [F3a2实际发布结果](./aws-auto-deployment-fast-track-f3a2-ecr-published.md)。以下保留修复前后的F3a1历史状态，待确认/slot不存在并非当前状态。

2026-10-07 Winnipeg / 10-08 UTC。用户批准 `8081815c08436a219d1701867bcaf9f16d19bfb0437c66270bee52822163a8c2` 后，唯一RunReviewed尝试在line155候选元数据检查处退出。**没有创建永久slot、提交Grant/任何AWS写入或dispatch workflow，因此没有需要撤销的临时权限。** Source-only独立Inspect确认UPDATE_COMPLETE、Deny-all、两资源精确inventory、Locked/v4。

独立逐字段GET验证：两candidate均未过期，artifact id/digest/name/source/run全部一致；失败仅为expires_at比较。`Invoke-RestMethod`自动把API ISO文本转为`System.DateTime`，manifest按安全UTC规则保留String；显示都是2026-10-08T23:31:29Z/23:31:33Z，但PowerShell `-cne`判不等。

仅将GitHub helper改为 `Invoke-WebRequest` 取得raw Content，再 `ConvertFrom-Json -DateKind String`，并保持HTTP204/空响应返回null。没有忽略expiry、放宽比较、延长日期、改镜像或权限。实际相同API读取证明新helper返回String并准确匹配两份完整pin；9项Node范围/历史/transport测试、typecheck和PowerShell AST通过。旧执行器不自动重跑。

新清单SHA：`1ab97e7b380947662e54920a3150e4c314fd8d8f8a29c320a74f7abe46b51c6a`。与808清单的images、IAM templates、iamUpdate、installBy、expiresAt严格相同，测试逐项比较；只更新执行器hash/reviewedAt与解析修复说明。必须确认新SHA才可执行。旧808批准原件已加入backend `deployment/history/reviewed-ecr-publication-8081815c0843.json`，原SHA逐字节LF校验不变；ce32/c9/15d、旧template/image/slot保留。旧808和新1ab永久执行slot都不存在，不能将该检查失败当云写入可重试授权。

原窗口不变：installBy2026-10-08T02:00:00Z（Winnipeg10月7日21:00CDT），权限/发布expiry03:00Z（22:00CDT）。Source当前CLI login只读验证仍可用，外层session未独立保证；每次执行会重新检查，过期不自动刷新清单。

仍仅更新既有publisher role/boundary两资源、一次GHA发布两source19cc候选，成功/失败立即SourceRevoke与独立Locked；接受CloudFormation旧非默认policy version可能清理并在写前备份，备份不恢复云version ID。其他云权限/费用范围不变，不部署ECS/Cell、不上传baseline、不更改其他资源。新Grant/dispatch均未执行。私有no-write诊断：`F:/ChatGPT_workshop/techlong-f3-publisher-8081815c-no-write.json`。

继续位置：请用户确认新1ab SHA；不得用已批准808 SHA执行改后的代码。确认后若窗口、prestate、Source或candidate漂移则继续失败关闭，只读核对。F3整体仍未完成，实际TTL清理、基础权限/证书mTLS/DNS/baseline/读cap与付费Cell审批仍独立。[F3a门禁结果](./aws-auto-deployment-fast-track-f3a-readonly-preflight.md)
