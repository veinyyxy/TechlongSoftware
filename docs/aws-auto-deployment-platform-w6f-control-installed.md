# W6f：NOLOGIN 控制账本安装完成，独立核验通过

2026年10月20日08:10（温尼伯CDT，UTC−5）。按用户确认的7天清单 `acf19e106bd2f0116debe4a829578455448ec0417e312351962c827f05537298`，从准确源码 `e84ca4d30aa57a3b7a0fbc0c215201bc2778ffaf` 提交唯一原SQL事务。COMMIT ACK已保存，同进程回读成功；随后独立新进程、新TLS连接只读核验结果为 **`CONTROL_NOLOGIN_SCHEMA_INDEPENDENTLY_VERIFIED`**。

## 真实安装与核验

- 角色 `techlong_deployment_controller_v6`，OID180224；NOLOGIN、NOINHERIT、非superuser/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS。
- schema `deployment_control_v6`，OID180226；3张控制表 `plans` / `approvals` / `dispatch_attempts` 均为空，列名、owner、无PUBLIC/服务角色直接表或列访问等检查通过。
- 9个SECURITY DEFINER函数的服务端prosrc摘要、参数类型、语言、owner和固定search_path逐项匹配原SQL；仅7个控制函数授予服务角色EXECUTE，`publish_plan` / `attest_evidence`仍owner-only。
- 自动创建者成员资格仅 `neondb_owner`，ADMIN=true、SET=false、INHERIT=false；未将服务角色加入其它角色。NOLOGIN不等于所有授权成员永远不能使用，未来成员资格或LOGIN仍需另审。
- 既有三张业务表OID/owner与安装前清单一致，PUBLIC授权检查通过。程序未读取业务行，因此不声称独立比对全部业务数据或列定义。

原SQL未重写，LF摘要 `7ae2444c2f8719ad1434529eda35fa4c2c4cf7ed8a416a50530c0c0381f9d541`。唯一完整BEGIN…COMMIT批次提交一次，未补齐、down、自动回滚或重试。显式TLS证书验证；owner DSN仅在既有本机入口内存使用，未输出或绑定平台HTTP。

执行前再次核对准确main/14项源码pin、CI39427462522/attempt1全部成功、固定目标指纹和fresh Neon目录逐项一致。此前12安装+6 publisher本机检查、临时PG18实际批次/目录和原9+3组真实PG证明沿用；本次未为结果文档重跑测试、CI或身份探针。

## 原件与不可重放边界

[结构化完成证据](../ops/aws-sandbox/reviews/platform-control-install-v6.executed.json)保存10份原件的raw SHA256。批准manifest的canonical SHA与文件raw SHA分别记录；安装回读和独立回读catalog原件摘要相同。

- 新清单及独立准备核验：`F:/ChatGPT_workshop/techlong-w6f-control-20261020-b/`。
- 唯一安装/COMMIT ACK/回读：`F:/ChatGPT_workshop/techlong-w6f-control-20261020-b-run/`。
- 独立只读catalog/结果：`F:/ChatGPT_workshop/techlong-w6f-control-20261020-b-inspect/`。
- 永久槽 `F:/ChatGPT_workshop/techlong-w6f-control-install.intent.json` 于 `2026-10-20T13:10:22.329Z` 已消费，**不复位、不重跑Install**。7天有效期不是重复执行许可。

旧203cda41…清单和全部历史槽/证据保留且未执行；原App身份proof沿用，没有重读PEM、签发token、dispatch、代批environment、读取Secret值或调用AWS。未设置密码/LOGIN，未改IAM/trust/已发布workflow或业务状态；没有部署新的Cell/ECS。

## 下一唯一主线

**W6f底座已完成，不等于W6或平台自动部署已完成。** `PLATFORM_RELEASE`仍UNPUBLISHED，运行时保持关闭；数据库角色没有被本次激活。

下一集中完成可信publisher生产I/O、平台专用窄凭据，以及App caller/reusable/trust的最小发布接线。复用已经实测的身份proof和控制账本，不重做身份实验，不扩F3c9支线；计划/证明导入保持owner-only，不能把owner DSN放进平台API。

代码实现和只读准备可沿主线继续；实际LOGIN/Secret/IAM/trust/工作流发布及部署仍按具体资源与fresh SHA另审。激活LOGIN前补全PUBLIC函数、列权限和继承路径审计，不能用本次目录通过替代。最终以**新held job**完成Review→人工environment批准→RunOnce→独立Inspect，不重放已完成W5r任务。

整套系统最终AWS上线、Aurora双模式、50 USD/月预算目标保持；本次不升级plan、不转向Sites。已有收费资源未删除，不保证绝对零费用。[已接受的完整安装风险](aws-auto-deployment-platform-w6f-control-install.md)继续保留，提交后不自动down。
