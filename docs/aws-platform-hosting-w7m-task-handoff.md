# W7m：Web Secret 到托管 task 的快速接线约定

本页是待后续审批的接线契约，不创建或授权ECS/IAM。首轮目标仍是两小时平台HTTPS验收：既有管理员登录、overview和实例只读页面；controller/request/worker/apply保持关闭。不重建已发布平台镜像，不重启F3c9或旧tenant支线。

## 已固定与待绑定

- 镜像固定既有 `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web@sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612`。这是W7j已验收manifest，不是config digest；本阶段没有重新读取ECR或宣称其当前状态已复核。
- Web数据库只使用W7l安装的 `techlong_platform_web_acceptance_v1` / OID196608，永不使用owner或controller凭据。
- 新Secret名称 `techlong/sandbox/platform-web/neon-v1`，实际完整ARN（AWS分配六字符suffix）及版本UUID必须来自未来已验收安装回执，不猜测ARN或回退到仅名称/AWSCURRENT。
- 未来container `secrets` 仅一项：`{ name: 'DATABASE_URL', valueFrom: '<准确ARN>:databaseUrl::<准确UUID>' }`。JSON key是databaseUrl，version-stage位置留空；UUID与stage不能同时在ECS selector指定。[AWS格式](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)

`taskSecretReference()`只在准确Secret ARN和UUID校验后生成此引用。清单及Git只保存引用，不保存URL/密码。不得把Secret值塞到CloudFormation参数、普通Environment、task definition明文、工作流输入或日志。

## 下一份部署清单需核对的权限

1. **Task execution role**：只为镜像拉取、准确日志组/流和准确Secret版本GetSecretValue服务，Fargate Linux平台至少1.4.0。具体RoleId/ARN、boundary、trust、ECR/日志及KMS转发条件按实际现状另审，不复用旧高权限租户执行角色。
2. **Task application role**：不授予AWS部署或Secret读取能力；ECS agent通过execution role注入值，Web应用不应自取AWS Secret。容器进程仍能读取注入环境，不承诺对应用内攻陷隔离。
3. **Secret资源策略**：W7m初始Source-only显式Deny必须在后续准确批准中扩展读取例外到最终execution角色，管理动作仍仅Source。先前W7m审批不授权这项handoff；仅新建IAM Allow不能越过现有Deny。
4. 若使用AWS-managed key，核对该Key现状、默认托管使用语义和execution身份的有效解密路径；不默认从旧IAM权限推导新身份可用，不改Key来绕过拒绝。

后续应把IAM/Secret策略handoff与两小时hosting部署资源逐项绑定到同一份清晰审阅材料，避免逐项无关探针；实际执行仍按确认范围进行，不顺带创建长期常驻平台。

## 验收与结束

两小时窗口从未来真实hosting创建开始计，不从本次凭据准备/LOGIN开始。未来需独立核验TLS、HTTP健康、真实管理员登录、实例读回及关闭的写入口；仅Secret/PG认证通过不等于平台上线。

ECS只在启动任务时注入值，Secret更新不会自动替换已运行容器；固定版本更新必须新审task/deployment。验收结束的云资源清理、LOGIN关闭/凭据轮换/Secret保留策略另审；不会自动销毁或宣称预算是硬性停止器。所有旧批准、消耗槽位和证据保留供追溯。
