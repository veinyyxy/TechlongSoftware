# F2f5：AWS Login 前置检查修正与新批准

2026-10-07。**尚未执行AWS资源写入**，旧 `c9fa6086...` 执行槽位不存在，IAM仍Locked/v2，两新ECR tag仍未占用。Source在额度中断后仍能真实只读调用，不需要因为当前临时凭据期限而反复登录。

## 原因与修正

用户已批准 `c9fa6086f28c8e599f40baf1d1f20ef937d2fcb9d2346bdd5376cc1d2a1c4790`。实际执行前的只读检查读到当前凭据约14分钟；原执行器要求一小时，因此未调用IAM更新、GitHub dispatch、镜像push或建立永久执行槽位。

原检查是实现错误：AWS Login使用15分钟短凭据，CLI按需自动刷新，整体会话可能持续至其设定期限、最多12小时；`export-credentials`的Expiration不是整个登录会话期限。不能假设手动再次login就会导出一小时凭据。[AWS官方provider说明](https://docs.aws.amazon.com/sdkref/latest/guide/feature-login-credentials.html)

修正只针对这个判定，不绕过旧SHA执行：

- 必须是固定Source profile `techlong-sandbox-user`、login_session `arn:aws:iam::402010193138:user/techlong-sandbox-dev`；CLI实际credential provider为login，不接受静态文件或其他provider冒充。
- CLI版本至少2.32，当前STS账户/ARN准确，当前临时凭据至少还可用120秒；Grant与Revoke前独立复验。这是当前可用性检查，不是未来一小时可用性的证明。
- AWS调用保持 `--profile`，让CLI自动刷新；不把三项临时keys/token设置到环境或写入执行证据。只保留provider/身份/当前Expiration等非秘密proof。
- 不读取/改写refresh token来延长期限，也不把cached ID token当成整个refresh session期限。`overallLoginSessionExpiryVerified=false`明示证据限制；自动刷新受整体会话期限、权限和网络影响，不能保证未来撤权绝对成功。失败仍必须报告revoke/Locked需要处理，禁止新Grant或写重试。
- 只读认证helper在candidate/发布截止之后仍可检查当前身份，因此不会因候选过期阻止已需要执行的Revoke。过期后不能启动新的Grant/发布。

## 新清单与不变的云范围

服务端 `deployment/reviewed-ecr-publication.json` 新UTF-8 LF文本SHA：

```text
15d30e5ec70feb4712c572a404f437405b5d5b9704acd59937423ac4bbd62f80
```

旧已批准但未执行清单原文归档 `deployment/history/reviewed-ecr-publication-c9fa6086.json`，归档SHA仍准确c9fa6086...；原执行器在Git `9bd3560e5e1c576b543aea30bd35a33e3feda50f`。更早已消费ce32清单、原模板、旧镜像和全部证据不改写/删除。

两份IAM模板和全部镜像/扫描/tag pins与c9fa清单深比较一致。仍仅account402010193138/ca-central-1准确现有publisher栈的两项IAM资源UPDATE，不CREATE/replace，不改OIDC provider；publisher只有同区域准确 `techlong-sandbox-speedfeast` ECR上传/读扫描能力。Source本身不新增权限。

仍只单次manual promotion第四批源 `40b1ce6e487dc4c1187da3014a89b9379d50d578`、[run37674970489](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37674970489)的app/lifecycle两份准确ZIP/receipt/config/scan。先完整bytes/load验证再OIDC，不rebuild；新的immutable tags不覆盖旧镜像。独立ECR manifest/config/BASIC scan回读，HIGH/CRITICAL仍阻断；成功或失败立即Source Revoke并独立Locked。旧写槽位不重试/复位，新槽位也永久占用。详细两资源、OIDC main-ref trust与镜像/计费范围仍见 [原F2f5审阅](./aws-auto-deployment-fast-track-f2f5-republish-review.md)，其旧一小时认证条款由本页显式取代。

不授权ECS/付费Cell、ALB/Aurora、生产baseline/Secrets、源PG15/Neon写入、Worker/root启用或任何删除。50 USD/月仍是目标而非实时扣费断路器，接受低成本但非绝对零费用。

## 验证与继续位置

17项相邻测试、JS/PowerShell语法及真实原始receipt/scan复核通过；历史SHA原文保留、IAM模板/镜像/date不变、错误provider/身份/过期或过短凭据拒绝、proof不返回秘密均有定向覆盖。没有大批离线AWS模拟。

实际新ReviewOnly `2026-10-07T22:08:04.7Z`：Source login provider/准确身份/CLI2.36.19、当前Expiration22:16Z，认证检查通过；现有栈UPDATE_COMPLETE、boundary default v2、完整Deny boundary/inline/trust、零attached policies、原两资源一致，mutationPerformed=false。另只读GitHub artifact metadata仍准确且未过期，ECR两新tag仍absent。新执行槽位 `F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-15d30e5ec70f` 不存在。

私有只读输出保留于 `F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-f2f5-authfix-20261007/source-review-only.txt`，原始文件SHA `f8f76f6aa3d27e1798500a379797db61b78c530e3d070a9c31b649c4934d10b1`；上一批ZIP和review index不覆盖。另起进程Inspect再次证明Locked/v2/UPDATE_COMPLETE，无写入。实际执行时会重新检查，不把本页时点当作未来凭据有效性保证。

修正已提交/推送服务端main `41b5645dd91c99547dd88d4ac570802c96e4de02`，[完整Backend CI37694519466](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37694519466)实际success，check和Docker构建/inspect/smoke两job均通过。未运行手动publisher，不能把CI通过当作ECR发布成功。

日期**没有延长**：最迟温尼伯2026-10-08 **13:00 CDT**（18:00Z）开始安装，权限/发布截止13:45（18:45Z），最早artifact过期14:30:55（19:30:55Z）。过期须重新只读审阅和fresh SHA批准，不重放。

确认语句：

> 我确认按清单 15d30e5ec70feb4712c572a404f437405b5d5b9704acd59937423ac4bbd62f80 执行现有两项发布IAM更新、两份修复镜像单次ECR发布和成功或失败后立即Source撤权；接受CLI自动刷新凭据检查及其证据限制，不部署ECS、不删除资源，接受低成本但非绝对零费用。
