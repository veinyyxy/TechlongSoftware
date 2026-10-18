# W5e-R1 实际结果：数据库版本已存，恢复停止

2026-10-17 Winnipeg 22:28 CDT（2026-10-18 03:28 UTC）。用户明确“确认清单”后，按 `4f82199f64705e73ece260e6d14e416575b64ab8fed39a5d48e080ef3fb237bb` **只执行一次 RecoverLocked**，随后另进程只读 Inspect。结果为部分完成，不是安装成功，更不是云端自动部署已启用。[原批准完整风险](aws-auto-deployment-cloud-worker-w5e-neon-recovery.md)及原入口不修改；[机器摘要和原件哈希](../ops/aws-sandbox/reviews/cloud-worker-w5e-neon-recovery.executed.json)。

## 实际执行与独立核验

- Source/准确资源、99个受审源码 LF pins、25份旧证据及旧槽均先核对通过；新独立恢复槽已永久消费，未复位旧槽。原私密包新读1次、公开指纹校验通过，生成48随机字节密码；本机回执没有保存 DSN、密码、PEM 或私密包内容。
- **仅一次 PutSecretValue 获 AWS 成功确认。** 数据库 Secret 完整 ARN `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/neon-control-v1-pVKVEV`，固定版本 `ce34d730-0e08-4ce7-b1b6-b5eaa5f9ca0e`。独立 Inspect 核对资源策略、完整版本集（IncludeDeprecated），确认正好该1个版本，标签 AWSCURRENT；未读值。
- 在 `DatabaseVersion` 阶段停止，写请求 ACK 计数为1，但没有该阶段完整 `.ack.json`；不能将“API已确认”与“写后核验/阶段记录完整成功”混为一谈。随后独立核验已看到准确版本，不授权再次 Put 或自动续跑。
- 控制 Secret `arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/deployment-worker/control-first-acceptance-v1-CatDWK` 独立核验仍是空版本集，隔离策略保持。拟用 `2854e7b6-6c3c-41be-a5d8-b87dd9d98810` **尚未写入**。
- Neon 安装事务尝试0、提交 ACK=false、窄角色认证0。独立 read-only catalog 与批准前全目录快照规范化比较一致：`techlong_cloud_worker_v5` role/schema 不存在，未安装其四函数；未发生本入口的数据库写入或业务函数调用。
- 五资源 foundation 栈保持 CREATE_COMPLETE/Locked：UUID `308174f0-ca9e-11f1-a04d-02569e9287b5`、role ID `AROAV3GNMXTZK5O45RG24`、journal table ID `ea69c69e-1c48-481a-83f0-36393c196d9f`；deny-all trust、inline/boundary、DDB/S3安全设置及既有IAM布局回读通过。未改 IAM、策略、GitHub配置或资源。
- 无第二次原私密读取、Source GetSecretValue、JWT/控制HTTP/Stripe、job/租户/workload写入或部署；未生成完整 installation-binding，候选workflow保持非活动。既有收费资源未删除，50 USD/月仍只是目标。

## 故障边界，不补造唯一原因

回执仅保留 `LOCAL_OR_PROVIDER_FAILURE`，SQLSTATE/HTTP状态为空，未保留具体断言、provider原文或异常堆栈。静态控制流把未完成范围限定在 Put API ACK 之后、该阶段 ACK 文件持久化之前（写后 Secret/版本元数据检查或本地阶段记录）。后来的独立回读成功**不等于**当时检查已通过，亦不能证明唯一原因就是传播延迟、凭据或权限。不得为了复现再发写请求、再次读取私密包或从内存猜原密码。

后续应在新代码中记录非敏感的具体步骤/固定断言枚举，并在写后检查前单独保存 API ACK；如引入只读传播等待，也应有明确上限和不重复写入的测试。这里只记录建议，**本轮没有修改失败源码、放宽断言、增加等待/权限或执行补齐**。

## 原件与永久槽

- 原准备/执行/独立核验目录分别为 `F:/ChatGPT_workshop/techlong-w5e-recovery-review-20261017-a`、`techlong-w5e-recovery-run-20261017-a`、`techlong-w5e-recovery-inspect-20261017-a`。
- 新槽 `F:/ChatGPT_workshop/techlong-cloud-worker-v5-neon-recovery-v1.permanent-slot.json`，raw SHA `db1b665fda7abee9a5bdd852b60da06663747e659a097336cd070634edfd5459`；旧槽 raw SHA `765a1e3cb46ce07cc781d8955323bfbe4baae6e323f55da9a8a859e328d7297f` 保持。
- 纯本地独立原件核对 `F:/ChatGPT_workshop/techlong-w5e-recovery-partial-verified-20261017-a.json`，raw SHA `91e5d0c40eda20cf50ed151b9d5d5a07090ac302ad7e3d90472e799121f610fe`。确认14个本轮公开回执/槽哈希、99源码和25旧原件；该核对自身网络/私密读取/外部写入均0。该证明不是另一次云端观察。
- 原439ab7dc安装记录、本轮批准源码和两次失败原件不改写；准备证据中的“未执行/两个空Secret”保留为当时历史，不能再作为当前事实使用。

## 唯一后续方向：从已存版本续接，而非重跑

当前入口要求两Secret均为空且新槽未用，现已永久不满足。不能换manifest/输出目录、删除槽、换密码覆盖版本、创建新Secret或重放旧InstallLocked绕过。

如用户同意继续准备，下一应只设计**复用已存数据库固定版本**的窄续接入口：新独立尝试槽；未来需明确批准 Source 对该准确 ARN+VersionId **一次 GetSecretValue**，在内存中复用原密码，不生成新密码、不重写数据库Secret；控制材料若重新读取原包并写其固定版本，也须在新清单明确计数。然后才允许一个新的 Neon 兼容原子安装事务和独立核验。每项仍按新的源码/action/fresh SHA及风险单独批准；本次清单没有赋予读取既存值或新的恢复权限。

完成Locked安装之前不谈激活或新租户部署；不扩F3c9、Sites、清理器或监控支线。后续先收口这一个安装缺口，再单独审阅OIDC/workflow激活。
