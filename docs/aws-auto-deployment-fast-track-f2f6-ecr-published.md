# F2f6：修复镜像已发布，ECR门禁通过与Locked收尾

2026-10-07，本次按用户明确确认的fresh SHA `15d30e5ec70feb4712c572a404f437405b5d5b9704acd59937423ac4bbd62f80` 实际执行完成。**镜像已发布，但尚未部署ECS或启用生产Worker/root**。预算仍50USD/月目标，未以此授权额外付费Cell。

## 唯一实际执行

Source在准确账户402010193138/ca-central-1更新现有 `techlong-sandbox-github-image-publication` 两IAM资源，完整Grant回读通过。IAM role/boundary未新建或替换，OIDC provider不变。唯一 [publisher run37694984927](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37694984927) 在main `41b5645dd91c99547dd88d4ac570802c96e4de02` 上success；源镜像仍为修复提交 `40b1ce6e487dc4c1187da3014a89b9379d50d578` 的原candidate run37674970489。

Actions先实际验证原ZIP/成员checksum/receipt/前置scan及Docker加载后的config ID，才获取短时OIDC凭据。没有rebuild，向现有 `techlong-sandbox-speedfeast` 写入以下两个新固定immutable tag；工作流和独立Source均读回原始registry manifest bytes SHA及准确config digest，不混用两种digest。

| kind | immutable tag | 新registry manifest digest |
| --- | --- | --- |
| app | `app-sha40b1ce6e487dc4c1187da3014a89b9379d50d578-r37674970489-a1` | `sha256:4a92824790cf005c35ab9fd77c4f9756070bf98c74fcd5d16f2dbeae0c80e315` |
| lifecycle | `lifecycle-sha40b1ce6e487dc4c1187da3014a89b9379d50d578-r37674970489-a1` | `sha256:a0a0abb59c2acbc370aee39556cae4cf536451387109fe97f9d616817369e858` |

未来受审ECS材料必须使用 `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-speedfeast@<registry digest>`，而不是把image config digest当可部署的registry digest。本阶段只记录候选URI，没有更改ECS task或生产模板。

独立scan读回两者均COMPLETE，`findingSeverityCounts={}`，没有报告HIGH/CRITICAL：app扫描/feed时点22:16:21Z、lifecycle22:16:43Z。原Trivy前置门禁也仍通过；这些结果不保证所有组件/所有未来漏洞清零，不能替代真实数据库、健康、mTLS、TTL或生产ready验收。

## 立即撤权与独立最终核验

工作流22:16:49Z完成；Source控制器22:17:00.692Z记录Revoke intent并应用原准确Locked模板，22:17:58Z完整Locked读回。最终栈UPDATE_COMPLETE、boundary默认v4、boundary/唯一inline DenyAll、OIDCtrust Deny、零attached policy、原两资源。另起进程Inspect再次Locked/v4；独立GetTemplate深比较与原Revoke完整一致。

独立Source于22:21:32Z完成两份新manifest/config/scan、两旧镜像原digest、最终模板及policy version inventory回读，无云写入。只读辅助工具第一次在空severity对象上触发PowerShell StrictMode属性错误；修正后写到新的只读证据目录，原partial读回保留，**没有重试IAM/dispatch/push**。最终独立结果 `INDEPENDENT_ECR_AND_LOCKED_TEMPLATE_VERIFIED`。

此前两个旧ECR镜像原digest `sha256:1c60a09f37c84cc45979e218bd5c221b60cd51200fea7cfd2b0701d334dfb610` / `sha256:c24f2c8847ffd5e95faf815a39d7ac7387334e5602f61be94c7774159c5d1014` 独立读回仍一致，不删除或覆盖。原ce32/c9fa/本次manifest、模板和本地执行记录均保留，不重置槽位。

## IAM历史版本的实际变化

不能把“保留IAM资源和策略证据”说成“所有旧IAM版本还在AWS”。实际ListPolicyVersions只有v3/v4；global IAM的us-east-1 CloudTrail准确显示：

- 22:14:28Z，`DeletePolicyVersion v1`，requestID `87d23c89-3d70-4709-93c2-9c3f3bba2d32`。
- 22:17:06Z，`DeletePolicyVersion v2`，requestID `555ec738-5d38-4664-b02a-12ec4ee7cb5b`。

两条准确policy ARN、Source IAM user和userAgent `cloudformation.amazonaws.com`，证明是这两次CloudFormation更新中的版本清理；控制器没有另发DeleteRole/DeletePolicy/DeleteImage。role、managed policy本体和镜像资源仍在，但v1/v2云端历史版本同一ID不可恢复。旧策略原文在原Grant/Revoke模板、旧Git提交和私有prestate/原执行证据中保留。后续审批要显式披露这个副作用；Retain保护资源，不应被描述为历史版本保留保证。

## 已保存证据与继续边界

永久执行目录 `F:/ChatGPT_workshop/techlong-reviewed-ecr-republish-15d30e5ec70f`，本清单/slot已消费，禁止重放、清空或自动重试。新认证检查原理和旧未执行批准见 [F2f5登录修正](./aws-auto-deployment-fast-track-f2f5-login-preflight-fix.md)。

- 云端receipt artifact11514089925，ZIP SHA `5f143fae7bb62628a0983bc1e201c32cee07807bf59976724efef8dc0fc999b6`；实际下载并核验仅一个小receipt文件。
- raw `publication-receipt.json` SHA `c083333347de746c9b8a66856f944621991ae2b0a4877946214ce3aea019b454`。
- 完整 `locked-readback.json` SHA `ced12daf4562b9688d45809aacd76ab12a85623a3cc2fb8ec523b7664ecd1d2d`。
- `execution-summary.json` SHA `7f670607d39c7a056218c45c1d8ad66bfc15dd64d94d907ed164adbe559cc9e9`，workflowSucceeded/lockedVerified均true、failure=null。
- 独立目录 `independent-readonly-complete-1` 的verification SHA `fce55ceec12231fd638460f794a550b7cf858b3c69140d266fdc43d2d15717e3`，含新旧镜像、scan、完整模板、版本清单和两region CloudTrail原件，不提交这些私有原件。

没有安装本地Docker/WSL，没有ECS/Cell、源PG15/Neon/业务库或baseline/Secret写入，生产Worker/CLI root仍disabled。下一小阶段接通production admission/CLI root和准确新registry digest的受审材料，随后按真实资源清单、期限、50USD预算评估单独确认ECS/Cell部署。现在不能声称自动部署端到端已完成。
