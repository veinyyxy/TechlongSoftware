# a604 审查包已发布并独立验证

2026-10-27。按用户确认的 `af800cdbe26b61f96a8454522a8c0e94f215aa72b0834c22bc83101fbf79ebce`，执行源码 `592492ccce9207efd06369e0d1d0afa54e79cef5` 完成一次条件 PUT，以及独立 SDK 实例的一次准确版本 GET。结果为 `A604_PACKAGE_UPLOADED_AND_INDEPENDENT_FIXED_VERSION_VERIFIED`。对应源码CI 40566114822成功，367项相关测试通过。

对象为390134字节 canonical package，VersionId `WKWNfTsDXkQ5lZuqQRIG7YZw.4PERCEt`，内容SHA `03e32f4b3f1f364cab53593d662b8744fb6081f7960d153c0da928946286986e`，basis `61865f5e4b8af472ce5e5a118c3ab5d1db2aead6c400e5648dcc714891e99c40`。独立读取核对AES256/checksum/原始字节/内容SHA，并用原证据编译器重建basis；未用ETag代替SHA，也未猜测或读取latest版本。完整包含历史业务元数据，不提交GitHub。

实际调用：Source STS3、桶元数据6、目标HEAD2、包内容1读、条件PUT1、独立固定版本GET1、CI三GET。IAM/SQL/配置内容/私钥/Secret值/工作流发布或调度/Cell创建/自动重试均0。上传意图为2026-10-27T19:10:26.576Z，独立读取意图为19:10:30.207Z。仅有本次准确S3对象新增，费用仍是低额非零。

新a604事实窗口已按此准确清单批准，期限固定至温尼伯10月29日09:06:24.483 CDT；原basis及原授权的到期时间不变。批准记录仅是后续source publication的一个必要输入，不激活运行时或云部署。

`techlong-a604-package-v1.intent.json` 和 `techlong-a604-package-v1.inspect.intent.json` 两永久槽已消费，不复位、删除或重放；原包、原槽、两次只读停止及本轮完整原件保留。私有执行证明SHA为 `fa960d1bc00b990dd63985063b980f1a277f3773dd49cce844453076fafd055f`，公开摘要见[机器记录](../ops/aws-sandbox/reviews/platform-a604-package-v1.executed.json)。

**唯一下一步：** 使用真实固定版本引用和已批准事实记录，准备双工作流及现有 worker role 的 trust-only 新审批清单。104/97云闭包及权限内容保持不变，不新增IAM、镜像、业务任务或承载租约。工作流发布、trust修改、Review/RunOnce/Inspect调度均尚未批准；GitHub environment审批仍由用户本人完成。本次不代表部署成功或独立云端验收通过。
