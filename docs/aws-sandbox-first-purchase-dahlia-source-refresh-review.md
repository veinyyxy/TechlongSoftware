# Sandbox 首开：Source 刷新后的限定接续

[原回执](evidence/sandbox-first-purchase-dahlia-acl-recovery-stopped.json)：Neon 已只读确认两个安装角色和 schema 均无残留，随后 Source 凭据失败，本轮无 AWS、Neon 或 Secret 写入。用户刷新后，同一 SDK 凭据链一次 STS 已验证为原 Source 身份（温尼伯 11 月 18 日 19:00:33）。这只是身份校验，不是执行批准。

本次继续用[原 ACL 修正清单的范围与风险](aws-sandbox-first-purchase-dahlia-acl-recovery-review.md)，有两处收窄：

- 执行时先验证 Source 身份，再占用本清单的本地一次性槽。保留此前全部槽和回执，不重跑旧清单或重发镜像。
- 复用原 Neon 无残留回执，不再单独建立只读预检连接。原安装事务仍须在任何 DDL 前确认角色和 schema 为空、环境和业务基线匹配，提交后独立回读；残留或漂移立即停止，不删除、不补齐。

一次批准覆盖：固定 Source STS 最多 **4**、现有 AWS 元数据 **201**（包含原 ECR manifest 一次）；两份原 Stripe 私密文件各读一次，原范围认证 GET 最多 **5**，不单独测试或修改 Stripe；现有配置进内存一次、验证 TLS 的 Neon 连接最多 **2**、原 SQL 上限 **76**。通过前置才允许一次原 Neon 安装事务、固定 Secret 三次写及原两平台栈各一次准确 Change Set 创建和执行（AWS 写最多 **7**），随后独立技术验收。无额外权限、GitHub 操作、发布、替用户购买或启动 worker。

保持旧硬截止不延。原 Neon 回执按真实观测起五小时有效，须留十分钟前置，最晚启动 **11 月 18 日 23:47:53（温尼伯 CST）**；实际启动后最多 60 分钟。继承原私用配置、托管注入、网络／日志、Neon 创建者 ADMIN、跨系统非原子、滚动短时中断、托管回滚及费用风险；异常立即停，不自动重试、回滚、补齐或清理。只有技术验收通过后才由用户亲自测试购买。
