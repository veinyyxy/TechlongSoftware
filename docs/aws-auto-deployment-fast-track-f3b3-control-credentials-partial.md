# F3b3：两个 AWS Secret 已创建，Neon LOGIN 未证明提交

本页记录原bootstrap部分失败，内容仍保留；后续新3610895c...批准的独立恢复已COMMIT确认并两次真实认证核验，见 [当前控制凭据就绪](./aws-auto-deployment-fast-track-f3b3-neon-credentials-ready.md)。成功恢复不改变原失败证据或重新授权旧slot。

后续只读准备已发现Neon官方不支持预哈希密码，独立的新恢复入口/准确Secret复用与新批准清单见 [托管兼容恢复阶段](./aws-auto-deployment-fast-track-f3b3-neon-credential-recovery.md)。本页保留原执行和异常证据，不回填未知根因或改变旧授权。

2026-10-08 Winnipeg。用户批准清单 `85b500511452328329159ebe0ce13ea5aeeaa36dd9cb6aef64bd19f103d27a54` 后，仅一次Run。两个准确Secret及标签/初始版本创建并独立读值核验成功；两角色的SCRAM/LOGIN语句在事务中已提交执行、事务内角色回读通过，但**COMMIT抛出异常，未得到提交确认**。随后两次独立只读Inspect都看到原NOLOGIN状态，`credentialReady=false`。**这是部分状态，不是凭据安装成功或自动部署上线。**

## 已证明的状态

两Secret均为本次准确初始UUID/AWSCURRENT，ApprovalSha256标签绑定用户批准的85b500...，metadata/完整版本枚举/无resource policy/无rotation或replica/默认AWS-managed KMS及严格载荷校验通过：

- reader：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-cleanup-readonly-v3-AWZoLG`；VersionId `3f8047d4-e357-4d32-ae87-861fda5f8253`。
- drain：`arn:aws:secretsmanager:ca-central-1:402010193138:secret:techlong/sandbox/cell-drain-control-QDFwQ9`；VersionId `72eb93b3-1da0-40a2-a5a1-176e6869ae98`。

两角色 `rolcanlogin=false`，完整角色/权限状态仍为原 `1528e1e2888bb191200d8bc2224318512cfa63f5aaa138eb324870674f3fe0ef`。preserved SHA仍 `993506a66f586d9ad447b77769769cbf372dee9be9a30cc556af9d9de00426fa`，原seal/业务原件/其余授权保持。Inspect因NOLOGIN没有尝试受限角色认证；`authenticated=false`不是已证实密码不匹配的诊断。没有读取pg_authid密码字段，不能据此声称密码或Neon控制平面密码状态绝对未变。

没有第二次CreateSecret、密码更换/SQL重发、自动NOLOGIN/down/delete、slot复位、IAM/Cell/ECS/Lambda写入或runtime启用。两收费Secret保留，沿用原价表基础约0.80USD/月加请求相关费用/税费；50USD/月目标不变，费用不因NOLOGIN自动消失。[原范围与费用证据](./aws-auto-deployment-fast-track-f3b3-control-credentials.md)。

## 提交和独立观察证据

原代码/SQL/依赖均未改变；执行时main `738e785a1904992690bccbf3e50cbcbd9ee3994c`，code binding `3ec561f34c95cf2f80e6ba8a6cebf5572c26d5eeeac28f598d00593960b084c0`。执行发生在原23:26:12.968UTC窗口前。

私有 `F:/ChatGPT_workshop/techlong-f3b3-control-credentials-20261008-c3-run`：submission SHA `3096211ad3a9edc0621c0ef8f6abab677e2ebf5685f034ec8205cebdfe6fe0fb`，outcome `CREDENTIAL_COMMIT_UNKNOWN_INSPECT_ONLY`、slotConsumed=true、SecretAttempts/SecretConfirmed各2、commitAttempted=true、commitConfirmed=false、failureStage=DATABASE_COMMIT、failureCode=CONTROL_CREDENTIAL_WRITE_NOT_VERIFIED。应用/SDK没有重试写入；原捕获器未保存原SQLSTATE/错误文本，不能事后恢复它或把通用code当成SQLSTATE。

Run自带独立Inspect observation **23:16:16.833UTC**，文件SHA `5c3057709539a800c7f4272016d88a18f58de0fd2cf78866d73ceae08b84972a`。另一个进程仅 `--mode Inspect`，目录 `F:/ChatGPT_workshop/techlong-f3b3-control-credentials-20261008-c3-inspect`，observation **23:17:23.388UTC**，文件SHA `d44a87545315802ac235ad9f12a33377cf2ea0471798124450f3489ab80c65c6`。两者均 `CONTROL_ROLES_NOLOGIN_PARTIAL_SECRETS_INSPECT_ONLY`、LOGIN=[false,false]、两个本次Secret版本OWN_INITIAL_VERSION_VERIFIED、credentialReady/runtimeEnabled=false。

固定credential slot `F:/ChatGPT_workshop/techlong-f3b3-control-credentials-v1-consumed` 已永久占用，approved-manifest文件SHA `f8cf6afa721e504715d1645019849be61a1066b43672f6eca8e69f18f077b481`。保存了两Secret attempt/confirmed及login-attempt元数据，没有密码/URL/SecretString/verifier落本地文件。旧三个schema/registration/role-install slot保持。

## 只读诊断及不确定性

新增独立只读工具 `ops/aws-sandbox/scripts/inspect-f3b3-credential-provider.mjs`，不改原9文件code binding，避免破坏原Inspect入口。只读取准确原目标的公开非敏感bool/enum配置、版本和角色LOGIN，不读console URL/token等敏感GUC、不调用AWS、不提交DDL/密码或业务写。

实际 `F:/ChatGPT_workshop/techlong-f3b3-credential-provider-read-20261008-c3/provider-metadata.json` SHA `9ce8c5fb51d33d15c03c4546fad8378b0463298e5e6bfdb162a7b1c8746539da`：18.6、pooledEndpoint=true、neon.forward_ddl=on、password_encryption=scram-sha-256、默认read committed/read-write；两角色仍NOLOGIN。所选pg_extension列表为空，不代表Neon没有preload hook。

Neon官方实现的角色密码DDL在PRE_COMMIT阶段向控制平面转发，HTTP失败可抛错，且存在外部转发后本地事务仍中止的边界；普通PG18容器认证证明不能验证这一托管服务路径。[官方DDL hook源码](https://github.com/neondatabase/neon/blob/main/pgxn/neon/neon_ddl_handler.c)

**提交阶段hook/托管密码同步是有依据的排查方向，不是已证明的本次根因。** 没有保存原SQLSTATE、服务错误详情或提供者日志；无法排除网络/序列化/托管校验等原因。禁止为了重现错误而再ALTER/COMMIT，也不关闭neon.forward_ddl或改管理权限绕过托管同步。现有角色NOLOGIN/目录不变不能证明控制平面没有其他副作用。

## 继续位置与授权边界

不能再Run原bootstrap、刷新清单重放、另建同名Secret、生成替代密码/版本、删Secret或复位slot；原批准不授权新的恢复写入。仅原manifest在全新目录的只读Inspect可继续，过期也不恢复写权。

下一阶段先完成托管提交兼容性/脱敏SQLSTATE捕获方案与现有两Secret准确版本的恢复设计。若可恢复，应复用已存密码，不再CreateSecret，不自动改变Secret版本；任何新密码/LOGIN写、放宽SQL密码传输方式、Neon API、清理或IAM变更都需要另列具体资源/风险和fresh SHA确认。当前不能推进runtime安装或宣称凭据ready。原29组PG18与AWS模拟证据仍保留，真实AWS两Secret创建/读回本次已证明，但Neon LOGIN路径未通过。

两个仓库main照默认Git授权提交状态与只读诊断代码；服务端仅同步文档，不改生产源码/镜像。
