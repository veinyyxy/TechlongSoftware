# F3c9l：锁定期 V6 代码更新完成，独立验收通过

2026-10-13 Winnipeg。用户明确批准清单 `9a6598007275766845e0da0a3657f01c33ae9899032188685b3c8bcaaced7c7d` 及其完整范围和风险后，冻结132文件入口 Run 一次、独立新进程 Inspect 一次，均成功。只请求了一次现有 Lambda 的 Revision 条件代码更新；没有追加写入、重试或回滚。原[准备清单与完整风险](./aws-auto-deployment-fast-track-f3c9l-locked-v6-code-review.md)、旧准备/停止/退役记录及永久槽保持，不改写历史。

## 实际更新与验收

准确目标：

```text
arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3
```

- Source身份、冻结文件与包、两个准确资源的权限模拟，以及两轮完整锁定前态检查均通过并先存证；模拟不作为实际有效权限证明。
- **14:39:40.029 UTC / Winnipeg 09:39:40.029 CDT**，唯一新永久槽消费。
- 提交阶段 **14:39:40.144–14:39:41.177 UTC**，固定HTTPS PUT进入并收到成功响应。条件 Revision 为 `4a5f64bb-f47e-4e56-a468-1364f4381767`，`Publish=false`、`DryRun=false`、x86_64，上传已经校验并复制到内存的原r2 ZIP；不重建包/镜像、不上传S3。
- 脚本内只读就绪和最终完整锁回读通过，Run结果 `V6_CODE_SUBMITTED_INDEPENDENT_INSPECT_REQUIRED`；最后阶段在 **14:39:51.841 UTC** 完成。
- **14:40:48.770 UTC / Winnipeg 09:40:48.770 CDT**，独立新进程结果 `LOCKED_V6_CODE_INDEPENDENTLY_VERIFIED`，candidateInstalled、slotMatches、invariantMatches均true。
- 实际完成 Revision：`1843cd76-fd3b-4b82-9c3d-1e532901a58e`；代码 `ofOAfejxW/HT7z832LpapibmEBBKSIq2bjzwUzDa264=`，432966字节，Active/Successful。LastModified为 `2026-10-13T14:39:41.000+0000`。
- ZIP SHA `a1f3807de8f15bf1d3ef3f37d8ba5aa626e610104a488ab66e3cf05330dadbae`，bundle SHA `5ea6974456883d836764489c01357a003ca4c20cdea6ff704bba1d82858723b4`，均与受审冻结材料一致。

## 保留的锁与边界

全部15项原门禁通过：准确Source、roleId/trust/boundary、deny-all仅v1、空inline/attached策略、原bootstrap标签、并发0、日志7天、准确authority表且无policy、parent/workflow/registration缺失、Cell名称缺失、无resource policy/URL/alias/发布版本/映射、仅原 `$LATEST` async以及default bus固定targets缺失。

handler、Node22、x86_64、256MB/120s、空env/layers/VPC和所有其它受审应用配置保持；async仍age60/retry0、空OnSuccess/OnFailure，**未重写async**。完整锁与配置/async不变量仍为 `6210b806af9fd439b53efe5879950f870f01ee7f954164466fcbb7232c359dda`。RuntimeManagement仍Auto，实际runtime patch ARN与前态一致；不将此次一致推断为未来不会自动patch。

本轮直接AWS写仅上述一次代码更新。IAM、async、表/parent、数据库、Secret/Key写入、资源创建、版本发布和Lambda调用均0；Secret值读取和Neon连接均0。**runtime仍关闭，F3及自动部署整体尚未完成。** 元数据和代码包验收不证明实际Lambda执行、KMS转发或业务部署；并发0/读取门禁也不是跨服务CAS或账户所有外部活动的绝对证明。50USD/月仍为目标，不是硬cap。

## 证据与永久槽

| 证据 | SHA256 |
| --- | --- |
| 获批清单 | `9a6598007275766845e0da0a3657f01c33ae9899032188685b3c8bcaaced7c7d` |
| 冻结132文件代码绑定 | `80bf86b1a22b75aa0512f27f64df562039fb49c57e6146d479a67422626e349e` |
| 完整执行前态文件 | `c8e9dd195ae8deacc66af8dd30658e252b7f6a6ca767c57220c869ba47ddcf07` |
| 更新attempt文件 | `af5c541f6518ce6055ca8c23b3dbb874de3d65e0bb65d3191bd3ce46025a1d9a` |
| 成功响应记录 | `32c0cd3d00d0321a152bfcea8fbad479a2e645a5a7c2822cf63a7f2a07f9aee2` |
| Run报告 | `42db6f9478c1af4ffa999f1fee18dd5e3ada5dc334970b5d8be3d67e95c1d336` |
| Run最终metadata文件 | `849adb65e8a18d834877b3a3bdc962ca0c42cbde277b596623a4ac9a5949f0ff` |
| 消费永久槽文件 | `63f167f113279b2b6317dae0f301325cdf54fbb2dcb1228bc6ce393b77bac3f3` |
| 独立Inspect报告 | `faa88863062845d92e3fd0a40d8ef1fe8e1a6fd761183464fe1f0e5f5a4793a4` |
| 独立完整metadata文件 | `6aadcf03f0817f944511a40162745285db51c54e6336788c7ee810dfe186cb48` |
| 独立实际snapshot | `e4337370ffeaad88d9f827bc507af50cb38571db92d1dae93c5139a354ee86a1` |

永久槽：`F:/ChatGPT_workshop/techlong-f3c9l-locked-v6-code-update.permanent-slot.json`。已消费，禁止复位、复用或再次Run；所有更早的槽及旧身份退役证据保留。

私有Run证据：`F:/ChatGPT_workshop/techlong-f3c9l-v6-code-20261013-r1-run/`。独立Inspect证据：`F:/ChatGPT_workshop/techlong-f3c9l-v6-code-20261013-r1-independent-after-inspect/`。公有非秘密摘要：[验收capsule](../ops/aws-sandbox/reviews/f3c9l-locked-v6-code.verified.json)。准备阶段13项定向/相邻测试、typecheck、lint零警告及语法检查记录保持；本轮不修改执行代码、不重跑构建或离线数据库模拟，验收来自真实AWS更新后独立只读结果。

## 下一位置

锁定期V6代码安装小阶段完成。下一先在锁定状态准备剩余独立新identity流程、新ARN的实际V6 IAM/table短窗口、Source parent及固定有限gate材料，尽量在新的birth TTL开始前完成长时准备。新的身份创建、权限安装、parent登记、调用/门禁与ARMED/付费部署各按准确资源范围和fresh SHA另批；不安装旧已删除UUID的权限，不把legacy metadata hash冒充实际V6 policy字节摘要。本次批准不授权这些后续云操作。
