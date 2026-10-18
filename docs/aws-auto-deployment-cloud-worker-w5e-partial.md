# W5e 实际安装：Locked 基础完成，Neon 阶段停止

2026-10-17 Winnipeg（2026-10-18 UTC）。用户明确确认清单 `439ab7dc6ff32d196809d5467d713510bbb5b1e9886742e82e0d856171812152` 后，执行一次 InstallLocked，在 `NeonAtomicInstall` 停止。**不是安装成功，不可激活或部署，旧清单及固定槽不得重放。** 原风险和源码保持原件，见 [已批准范围](aws-auto-deployment-cloud-worker-w5e-installer.md)。

## 已完成与独立回读

- Foundation 栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-cloud-worker-foundation-v5/308174f0-ca9e-11f1-a04d-02569e9287b5` 为 CREATE_COMPLETE。五资源、准确模板、删除保护/禁失败回滚、deny-all OIDC trust、inline/boundary v1、journal 禁 TTL/删除保护及桶全部安全设置均通过第二个独立只读进程核对。
- 新 role ID `AROAV3GNMXTZK5O45RG24`，DDB table ID `ea69c69e-1c48-481a-83f0-36393c196d9f`。原 IAM 布局未变。没有 UpdateAssumeRolePolicy、GitHub environment/workflow 发布或租户创建。
- 两个新 Secret 均已创建、附加并独立回读资源策略；**都为空，没有任何已写版本**。数据库材料 ARN 后缀 `neon-control-v1-pVKVEV`，控制材料后缀 `control-first-acceptance-v1-CatDWK`。清单中的两个 UUID 仍是拟写版本，不是已存在版本。
- 原私密 JSON 读取/校验完成一次，公开指纹、ACL、密钥/证书检查通过；没有签 JWT、控制 HTTP、Stripe 调用或 Source GetSecretValue。最小控制材料没有写入 Secret，进程退出后不复用内存，也不自动重读原文件。
- Neon 安装事务调用尝试1次，没有安装 ACK 或提交确认。两次独立 read-only catalog 均看到目标 role/schema 不存在、目标 definer 函数0个。不能把这解释为 Neon 托管控制平面绝对没有副作用；没有 provider 日志/SQLSTATE，不能补造 COMMIT 结果。

安装器计数为 AWS 变更请求尝试5次（CreateStack1、CreateSecret2、PutResourcePolicy2），Neon 写事务尝试1次，私密读取1次。PutSecretValue0、trust/GitHub/租户部署写0。CloudFormation 内部写入另计，不把“5次”误说成全部云 API 请求。

## 兼容性缺陷与诊断边界

本次编译器使用客户端 SCRAM verifier。标准 PostgreSQL 支持这种格式，真实 PG18 CI 也验证通过；但 [Neon 官方角色文档](https://neon.com/docs/manage/roles#manage-roles-with-sql) 明确要求提供原密码，不支持预哈希密码。仓库 [F3b3 兼容恢复记录](aws-auto-deployment-fast-track-f3b3-neon-credential-recovery.md) 已经记录过同样差异。**W5e 未复用这一既有结论，是本次实现的遗漏，不应靠重复普通 PG 测试宣称 Neon 兼容。**

这是确定存在的代码/提供者契约冲突，与当前 PostgreSQL 对象未落库的观察一致；但原捕获器只保存通用失败状态，没有原始 SQLSTATE/HTTP 状态或服务端错误，不能声称已唯一证明实际异常原因。Neon 官方 [DDL hook 实现](https://github.com/neondatabase/neon/blob/main/pgxn/neon/neon_ddl_handler.c) 涉及托管密码同步；普通 PG 容器不覆盖该路径。没有为了重现错误再执行 CREATE/ALTER/COMMIT，也没有读取密码 catalog 或关闭 `neon.forward_ddl`。

## 原件与不可重放状态

执行源码 main `0b11fe8f7026ab0be093de4db75cf70d7dba3846`，90文件绑定，runtime 76文件闭包 `110f06bcfe0037ffc1bc0e1d4679a6796080564abde42818074807e516b7bb84`。之前 CI run39089481836 的50项回归/真实PG18十五组仍是真实通过，但不等于 Neon 托管密码接口通过。

原件保留：

- `F:/ChatGPT_workshop/techlong-w5e-review-20261017-a`：获批 manifest、只读 prestate、独立本地重构证明。
- `F:/ChatGPT_workshop/techlong-w5e-install-20261017-a`：每步 intent/ACK、基础 UUID、私密校验无值 ACK、Neon intent、停止/summary；没有安装绑定。
- `F:/ChatGPT_workshop/techlong-w5e-inspect-20261017-a`：新进程的 partial metadata/summary，没有恢复写权。
- `F:/ChatGPT_workshop/techlong-w5e-partial-verified-20261017-a`：再次完整核对五资源/两策略/空版本和 Neon 目标不存在的独立结果。
- `F:/ChatGPT_workshop/techlong-cloud-worker-v5-install.permanent-slot.json`：永久已消费，保留；不换目录绕过、不按新 SHA 重建同一安装根。

各原件原始 SHA 见 [实际安装记录](../ops/aws-sandbox/reviews/cloud-worker-w5e.executed.json)。未删除或回滚任何已创建对象；这些资源和既有 Cell/Aurora 等可能继续收费，50 USD/月仍非硬上限。

## 唯一继续位置：新恢复设计，先不写入

不能再 Run 原 InstallLocked，不再创建同名 foundation/Secret，不生成/安装替代版本、不自动重读私密材料或重置槽。需要一个独立受审恢复入口/新永久槽以及 fresh SHA，至少重新明确批准：

1. 原样复用准确已存在的 Locked 基础栈和两个空 Secret；旧 IAM/槽/失败原件全部保留。
2. Neon 使用原密码经认证 TLS 提交而非预哈希。这改变原已批准的“明文不进入 SQL”边界，必须明确接受密码可能出现在提供者/服务端日志、托管同步非原子的风险，不关闭 hook 或通过 Console/API 创建宽管理角色绕过。
3. 先做代码修正和安全错误分类（只保留 SQLSTATE/有限 HTTP 状态/阶段，绝不保存 query/password/DSN/raw error）。新48随机字节密码只能在新的明确批准后生成；上次密码未持久化，不能假装能够恢复。
4. 同样的目标角色/schema/四函数权限在最多一个新受审事务中安装，随后受限身份只读认证；两个既存 Secret 最多各写原定固定版本一次。需另批准原私密文件的一次新读取，因为上次内存已释放、控制 Secret 仍为空。
5. 先独立只读核验，再以真实完整安装 ID 另审激活。没有默认补齐/回滚/撤权/删除或自动重试；若状态漂移，只读停下。

上述仅为恢复方向，不是可执行清单，也不是新的写入或私密读取授权。不重开 F3b3/F3c9 支线、不发布 Sites、不创建新 job 或租户 Cell。
