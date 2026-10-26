# W9m — 恢复源码绑定已发布并独立核验

2026年10月26日按清单 `31d9727d5a3c229a59f5ce4dfe1a68ac7507398ee464a71d186616ad89b40323` 完成单次发布与另进程独立 Inspect。原范围与完整风险保留在 `aws-auto-deployment-w9m-recovery-binding-review.md`，本记录不扩展授权。

## 已完成

发布提交 `9a005f5f798f01b339726a0c23aaf400a4d74c60`，parent 为已过 No-AWS CI 的 `655cc62e8557cc387d73b1e969498c8aee879b20`。只替换 `ops/platform-recovery-control-v1/binding.mjs` 的描述字面量，CANDIDATE 改为 PUBLISHED；函数、原 V6 binding、IAM 和运行时供给未改。

独立核验结果：`BINDING_PUBLICATION_INDEPENDENTLY_VERIFIED_RUNTIME_NOT_STARTED`，结果记录时间 `2026-10-26T14:09:34.4748793Z`。当时本地与远端 main 均为上述发布提交；文件 LF SHA 为 `f6fa8c41635137f6486620189f91e21a0196331067782c97f79a77743f4c5f22`，blob 为 `c9856c8daf52b88742930efb6ad613bc65e596ad`。完整剩余授权/工作流布局与受审基线匹配，元数据状态摘要为 `5a8985a65ccb0b9016443d8c916a82faf827abb3d59d80be5d4d4435d6388e40`，角色 ID 保持 `AROAV3GNMXTZK5O45RG24`。

固定绑定仍指向 reusable `4c09548ab9852a4f3e948f0686f8c81251cda73b`、云端冻结源码 `0494b2be7b0f559ac991533137dfb1b0388ac7a9`、97文件 closure `30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374`，以及已验收恢复包 VersionId `Zz5fH5Javs900ZrmMrgi3QhBzFbCNkPm`。描述与 activation 的 sourceCommit 仍为 null，由未来单独受审的有效运行时租约绑定执行源码，避免提交自引用。

## 计数、永久槽与证据

发布阶段 non-force push1、本地快进1、GitHub GET28、AWS元数据20；独立 Inspect 为 GitHub GET13、AWS元数据10、外部写0。没有 AWS 写入、包内容读取、Secret/PEM/配置值读取、数据库连接、租约供给、服务器启动、镜像/hosting 更新或工作流调度。

两个永久槽 `F:/ChatGPT_workshop/techlong-w9m-recovery-binding.intent.json` 与 `...techlong-w9m-recovery-binding.inspect.intent.json` 均已消费。**即使批准未过期，也不得重放、复位、删除或重试发布/Inspect。** 没有自动回滚或补齐。

原始结果保存在 `F:/ChatGPT_workshop/techlong-w9m-recovery-binding-run-20261026-a/` 与 `...-inspect-20261026-a/`。公开摘要 `ops/aws-sandbox/reviews/platform-recovery-binding-v1.executed.json` 仅包含审查元数据、准确计数及11项原始文件摘要，不包含凭据或私密包原文。

## 发布后 CI 的最小测试修复

首次自动 No-AWS CI `40336750289`（准确发布源码9a005，attempt1）失败于 hosted runtime 测试：测试仍期待旧 V6 的 `CONTROL_RUNTIME_LEASE`，实际新选择器按设计返回 `RECOVERY_V1_CONTROL_RUNTIME_BINDING`。未重跑该 CI，未回滚或重放发布。

普通测试提交 `2f69888b8db7e9616f7c331c2d7a2efe8575d669` 仅更新 `tests/platform-controller-hosted-v6.test.mjs`：真实运行时测试使用当前源码选择的 release，并精确检查对应拒绝错误；另新增旧 release 租约不得读取私密配置的回归测试。旧 V6 纯配置测试保留，生产代码和已发布 binding 均未修改。本地相关53项测试、lint、typecheck 通过；该准确源码自动 CI `40338452848`（job `121626244947`，attempt1）已 completed/success，26个步骤全部成功，包括类型检查和构建。后续文档提交不冒称为已运行此 CI 的源码。

## 与实际部署的距离

这是持久**源码选择器**发布，不是运行时上线或业务部署验收。它会切换消费该新源码的进程，但本次没有配置任何新运行租约或私密绑定；没有查询所有既有环境，不能据此宣称全局运行时均已关闭。没有当前数据库或业务健康证明，原 held 任务未被本阶段领取。

下一步只准备新源码镜像/服务、固定 Secret 版本供给及短租约的准确清单；实际供给与后续 Review、RunOnce、Inspect 各自按新清单审核。原基础事实截止仍为 `2026-10-27T18:47:57.695Z`（温尼伯10月27日13:47:57），不因发布或测试提交延长。W9k/W9l 已完成操作不重做，F3c9 支线继续停止。
