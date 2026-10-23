# W8g：承载已部署，独立资源核验通过

最后独立观察：**2026-10-23 14:10:34 CDT（19:10:34Z）**。准确新栈 `CREATE_COMPLETE`，11项逻辑资源全部完成；单task `RUNNING/HEALTHY`，目标组健康，镜像、命令、三个固定版本Secret引用、租约、SG/HTTPS/DNS、原执行身份与权限均匹配。

这是**承载/元数据验收**，不是管理员登录或真实控制器签发/调度验收。本轮没有Source应用HTTP、SQL、App token或GitHub dispatch；没有读取Secret值/PEM，但ECS启动时已按批准范围管理注入三个私密版本，不能将托管私密读取声称为零或固定三次。

## 新资源与期限

- 准确栈：`arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-hosting-v1/c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`。
- 原清单SHA：`d7452b87c53430156569d2fc8fd049229c3d4e12cd0670087a83f050d42568fe`；用户在准确SHA/完整风险之后回复“我确认清单”。
- 一次建栈意图：18:58:42.592Z；ACK保存：18:58:43.073Z。新任务定义`:3`；旧INACTIVE`:1/:2`及旧记录保留。
- 镜像仍为已发布 `sha256:ad3cbde847375967a1eb0d593e39d9faefcb742c64ba87aa3abb463b9c534789`，实际源码 `f3cea2da7d26dfc09726c4cbc52cab40217340c6`，没有构建、发布或再次部署。
- 原执行RoleId `AROAV3GNMXTZJ45S2ANZ7` / boundaryId `ANPAV3GNMXTZP7KMHXNYF`、default v2保持；没有新增/更新IAM或Secret。
- **控制配置租约截止今天14:28:42 CDT（19:28:42Z）**，未续租。到期只关闭控制能力，不停止Web或收费，也不撤销IAM/LOGIN/在途令牌。
- **承载两小时意图截止今天15:58:42 CDT（20:58:42Z）**，只是标签，**不会自动停止或删除，之后仍可能计费**。清理尚未授权，必须以本页新完整栈ARN另审，不能重放W7r旧UUID删除。

## 原核验误报及只读证明

原受审部署程序单次运行完成后保存 `HOSTING_REQUIRES_INSPECT_NO_RETRY`，唯一错误 `INDEPENDENT_METADATA / HOSTED_DEPLOY_TASK_DEFINITION`。随后原独立Inspect同样报此错误。两份原始失败回执均完整保留，没有将其重写为成功，也没有补写、重启任务或再次CreateStack。

实际只读 `DescribeTaskDefinition` 证明AWS补齐了三个默认空数组：`linuxParameters.capabilities.add=[]`、`linuxParameters.devices=[]`、`linuxParameters.tmpfs=[]`。原校验器对整个对象做严格相等，因此误报。

增加的仅是独立只读核验入口 `ops/platform-hosted-deploy-v6/inspect-defaults.mjs`。它只在三个字段均准确为空、且没有未知设置时克隆并移除这些返回格式默认值，再调用**原**runtime校验函数；非空capability/device/tmpfs或未知属性仍拒绝。原受审48项源码、风险、模板、四份父原件及执行回执不变。

新增只读代码提交 `f24e5b935cff986dfb2597ea8f8b5d9a61352045`，本机14项测试及lint通过；准确[只读CI40009052767](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40009052767)和[原部署回归40009052868](https://github.com/veinyyxy/TechlongSoftware/actions/runs/40009052868)共18报告步骤成功，含类型/lint；无AWS身份、构建或云写。

全新进程只读结果：`HOSTING_METADATA_INDEPENDENTLY_VERIFIED_DEFAULT_ARRAYS`，errors空、36项元数据操作、AWS写0。完整模板/参数/tags、11项资源、任务/镜像/命令/环境/Secret引用、SG、DNS、HTTPS listener、日志保留和原供给权限均重新核验；没有仅忽略报错后宣称成功。

## 证据与计数

[公开执行索引](../ops/aws-sandbox/reviews/platform-hosted-deploy-w8g.review.json)保存原始失败与新只读结果、实际物理资源清单和七份原件hash；[CI索引](../ops/aws-sandbox/reviews/platform-hosted-deploy-w8g.verified.json)保留原准备CI并追加只读兼容CI，不覆盖历史。

原件目录 `F:/ChatGPT_workshop/techlong-platform-hosted-deploy-1e710b176bd5e31bcddae438ace7d772/` 内为 create-intent、create-ack、result。原独立Inspect文件后缀 `1792782242034.json`，新只读Inspect后缀 `1792782634322.json`。新只读原件SHA `3863a19d198f992bb9c1c199060ea6116c9a623615bd767b844d3d3162e7e4df`；离线执行证据复核 `F:/ChatGPT_workshop/techlong-hosted-deploy-w8g-execution-verified-20261023.json` SHA `0b112cabdc325ef2e14aff618162fee83aae46d91b46160631f6ef0a0d2c2cfd`。

本轮已跟踪顶层元数据操作156：原运行106、原独立Inspect10、新兼容只读Inspect36、额外进度/诊断4。仅一次Source CreateStack提交；不把CloudFormation/ECS底层创建调用、托管Secret读取、凭据提供者/登录内部请求、GitHub API或上一准备阶段读取计入这些数字，不能称所有云写总计一次。

永久槽 `F:/ChatGPT_workshop/techlong-platform-hosted-deploy-v6.intent.json` 已消费，SHA `2de8ba660e2dd7d96cc567b7be0f06f43c0c5667ae953a69c915c6adbb9c8963`，不可复位/重放/换槽重试。原Source/Inspect进程均已结束，无部署进程仍在等待。

## 唯一下一步

单独准备有限的真实托管控制入口验收（公网访问、用户自行登录、准确请求/计划/Review等各按具体范围），以及准确新栈清理审查。不得把本次资源健康当作App私钥匹配、真实签发/调度或整套系统生产验收；不得因租约到期自动续租/重启，亦不能为了清理重放旧删除。资源仍在计费，50 USD/月是目标不是硬上限。[原部署完整风险](aws-auto-deployment-platform-w8g-hosting-review.md)继续适用。
