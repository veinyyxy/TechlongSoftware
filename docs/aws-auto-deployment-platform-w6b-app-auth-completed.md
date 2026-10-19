# W6b：真实 App 只读认证已完成，控制器仍未启用

2026-10-19，America/Winnipeg。用户对最终清单 `22dc06b289f5964464ec27f537540d68a006f20fd68d391239956af3bbf48782` 回复“确定”后执行一次受审入口；原待审材料、九项源码和风险文档保持原样，未复用或扩展旧部署授权。

## 已观察到的结果

- 执行源码 `25572aad38db1cb408a73299d496b912fd29986b`；实际代码与通过[无AWS CI 39273460659](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39273460659)的 `30bdcfd4687489b6e13e0fb043fb805b75dd2582` 相同，后续此前仅增加结果文档。运行前重新核对九项源码、48小时窗口、文件元数据、ACL及ignored/untracked状态。
- 固定本地intent槽先于读钥建立；一次指定PEM读取尝试，签名与真实GitHub认证成功。没有输出或保存PEM/JWT/token，不移动/复制/生成/轮换私钥。
- App `5381160`、installation `173033406`、owner `14145707`、候选bot `344813947`符合合同；App/安装权限核对通过。
- POST一次创建仅仓库 `1323312747`（`veinyyxy/TechlongSoftware`）的最小令牌，Actions/Contents/Metadata均read，HTTP201；四次GET均HTTP200。随后finally一次DELETE，观察到HTTP204。
- 独立执行 `--inspect` 回读本地intent和回执，manifest匹配；原回执字节SHA为 `bf0d96e6fe3af2b7d752b2b78c06604da95d439e13f0e3739292ade4fcfb9d75`。

原件位于 `F:/ChatGPT_workshop/techlong-controller-auth-v6.intent.json` 和 `F:/ChatGPT_workshop/techlong-controller-auth-v6.receipt.json`；仅非敏感白名单结果，无密钥、请求头或响应正文。[公开执行证据](../ops/aws-sandbox/reviews/platform-controller-auth-v6.executed.json)。不删除/复位本地槽或重新运行认证入口；`--check/--prepare` 在槽已占用后拒绝是预期行为，继续位置是本完成记录，而非再次生成token。

## 不能由此推导的结论

独立回读只验证**本地回执**，并未用第二客户端实时核验GitHub撤销状态；准确结论是“本次DELETE已观察到204”。没有保存令牌用于事后再次测试。私钥仍长期有效，App安装权限没有撤销，原完整风险持续适用。

单仓范围仅证明本次token的范围，不证明installation没有其它已选仓库。private/OAuth/webhook UI设置仍需人工核对；候选bot元数据不是实际workflow actor证明。没有workflow dispatch、environment批准、AWS调用、SQL连接/安装、业务记录或Secret写入。平台 `UNPUBLISHED` 硬关闭保持，**W6尚未全部完成**，也不是整套系统已AWS上线。

## 唯一主线继续方向

集中编码并测试 V6 云执行候选、无AWS的App实际调度身份验证workflow，以及可信capsule/证据导入适配器，复用已经验证的云部署闭环。不恢复F3c9支线，不再注册App或反复做只读token探针。身份workflow的实际发布/调度、Neon账本及窄凭据安装、workflow/trust发布和新任务真实部署仍按具体资源与fresh清单单独批准；本次批准不覆盖它们。

参考[原执行范围与完整风险](aws-auto-deployment-platform-w6b-app-auth-review.md) / [控制器候选实现](aws-auto-deployment-platform-w6b-controller-implementation.md)。
