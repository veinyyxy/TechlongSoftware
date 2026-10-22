# W7m：Web固定凭据已安装，真实只读认证通过

2026-10-22，用户明确确认原始清单 `a93b64169dd598d45832a7e9e0fc7317395fdd907cb7baa8c0f4a935b7c45b09` 及[完整风险](aws-platform-hosting-w7m-credential-review.md)后，唯一一次受审入口返回 exit0：

`WEB_CREDENTIAL_INDEPENDENTLY_VERIFIED`

本次首次在真实AWS/Neon完成凭据安装及认证，超出此前仅普通PostgreSQL+AWS替身的[CI39850777219](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39850777219)证明。仍不是平台HTTPS上线或管理员登录验收。

## 实际安装

执行源码 `00b4189e44097bd8c7708013e41c95726235731a`，执行HEAD `028a5b7c46c761242f6bc6224331c366b73b3103`，未改受审代码、风险、原始清单或旧槽位。

- 消费执行槽于 `2026-10-22T20:46:06.726Z`（温尼伯15:46:06.726CDT）；COMMIT ACK于 `20:46:12.323Z`，结果文件mtime `20:46:15.234Z`。mtime是本地文件时间，不是数据库服务器时钟证明。
- AWS恰有三次受审写：准确空Secret创建、Source-only资源策略保护、准确UUID初始版本写入。Key未修改，使用既有AWS-managed Key。三阶段按预期完成，无复制/轮换/删除标记，标签/策略/Key/唯一版本元数据前后匹配。
- 完整ARN：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/neon-v1-UfFKVF`。
- 唯一初始版本：`6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f`，AWSCURRENT。
- 数据库角色 `techlong_platform_web_acceptance_v1` / OID196608，单事务中一次原密码/LOGIN语句提交得到明确ACK。独立只读目录显示 LOGIN=true，完整原授权/所有权/成员关系/连接上限5/search_path不变。
- 仅一次按准确ARN、UUID和AWSCURRENT读取Secret值，在内存严格校验；随后使用该固定版本密码完成准确Web角色的真实TLS认证及只读身份/OID/search_path查询。没有尝试错误密码或读取业务行，真实管理员账号密码未变。

运行计数为20次AWS服务读（其中1次固定Secret值读取）、3次写。成功代码路径为2个owner连接+1个专用Web角色连接、37条元数据SELECT、1条持久密码/LOGIN SQL；连接均已关闭。这不是另行网络抓包的查询计数；SDK凭据刷新内部网络交互不计资源服务调用。没有额外诊断SQL、Secret读取、写重试、补齐、删除、IAM或部署。

## 证据与不可重放

永久槽 `F:/ChatGPT_workshop/techlong-platform-web-credential-v1.intent.json` **已消费**，SHA `b16ca946c80fc58f927a7b60028e9db415ed4d9076d5f76a43685ea2dbfb9387`。不删除/复位/换槽/重放。原48小时清单到期时间不使此已完成授权可重复使用；旧W7l/W7k槽继续保留。

十三份原始运行证据保存在 `F:/ChatGPT_workshop/techlong-platform-web-credential-31d32e3dfc04b53c425dfa7a7d6581e5/`，项目仅公开[脱敏机器摘要与文件哈希](../ops/aws-sandbox/reviews/platform-web-credential-w7m.observed.json)，完整生产目录及host/actor/database不公开。回执无密码、连接URL、SCRAM verifier或携带密码的SQL；这不保证提供者日志也无敏感内容。

主要SHA：

- result.json：`0db96b44555ad053144c5705c98eb5faaf8d1a90b7e55ebabe9220f51e18ee13`
- independent-database.json：`d040a4b5345b961d381bcdc13d450b3a5847aa16b7d5032951288c60b9444e04`
- independent-secret-metadata.json：`d25c8033452c917abeeadc359f03bfd9a8d86656efdd921e63239f72dc2e4f09`
- dedicated-proof.json：`e05a8d0867f734c97792563062ae06cddd6291aa4a0f94dfb28b77c6ab9e9565`
- commit-ack.json：`b1de8c2e724d32909c5ce0d08d1a74c27839a33558818aab873de87a29a964d7`

离线语义复核于 `2026-10-22T20:46:53Z` 重新检查原始批准/nonce/UUID/意图、六份基线、19个源码哈希、初检和事务预检NOLOGIN、事务后和独立目录仅LOGIN变化、有效权限、提供者配置、策略/标签/Key/版本、提交ACK及专用只读认证回执。`offline-semantic.json` SHA `788c76d34c0b297edb33bd3431e66f93760932a6e614374d9a5976a792ebde67`。此复核**额外数据库连接0、Secret值读取0**，不是新的实时快照。

## 当前边界与下一步

角色现在可LOGIN，Secret已保留并可能持续计费，不会随两小时hosting窗口自动失效。Source-only显式Deny仍限制未来ECS execution role；本次没有新增IAM Allow或安装handoff，不能仅拿此Secret引用就宣称可部署。保留PUBLIC TEMP、创建者ADMIN（无SET/INHERIT）、认证哈希/会话能力敏感性、非行隔离、并发及提供者日志风险。

仅对未来task使用的准确引用为：

```text
DATABASE_URL <- arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/platform-web/neon-v1-UfFKVF:databaseUrl::6ea2ca59-9a24-4f3e-b16f-ec824f32bc5f
```

下一步准备[task接线契约](aws-platform-hosting-w7m-task-handoff.md)所需的execution-role/IAM、准确Secret策略读取例外和两小时HTTPS承载资源清单。实际权限/资源策略handoff、部署、清理或LOGIN禁用/轮换仍需具体范围审批。应用controller/request/worker/apply保持关闭，既有镜像不重建，不重启旧支线。平台尚未上线、两小时窗口未启动，50USD/月仍是目标而非硬封顶。
