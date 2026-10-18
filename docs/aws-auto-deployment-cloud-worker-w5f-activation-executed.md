# W5f 已完成：激活并独立核验，尚未运行云 worker

2026-10-18，America/Winnipeg。用户确认清单 `f8786e44c6c1342d9d20c684e92617eac7a8115ba8760f34e35a7f9813ba1228` 后，入场发现文档误加 `qu`，没有执行或占槽；用户明确批准仅移除该误改后，工作区恢复原已审文本，清单仍有效，执行一次 Activate、再另起进程执行一次 Inspect，均成功。[机器记录](../ops/aws-sandbox/reviews/cloud-worker-w5f-activation.executed.json) / [当时完整风险](aws-auto-deployment-cloud-worker-w5f-activation.md)。旧准备记录和批准原件不改写。

## 完成事实

六项顶层提交各一次，未自动重试、补齐、回滚、撤权或清理：

| 项目 | 实际结果 |
| --- | --- |
| GitHub environment | `techlong-sandbox-deploy`，ID `24613410405`；唯一 reviewer `14145707`，允许本人审批，实际回读 admin bypass=false |
| 环境分支规则 | ID `63436866`；仅准确 `main` branch，不是 tag/通配符；这不是 GitHub main 的仓库级分支保护 |
| 私有 S3 公开绑定 | create-only/AES256，实际 VersionId `QzUuJ3ypqIdZW2OixF5WIDKpGZDtX_fV`，准确正文独立回读 |
| 工作流发布 | 一次非 force fast-forward，只新增 reusable 与 dispatcher 两文件；未创建分支 |
| CFN Change Set | `worker-activation-v5-f8786e44c6c1342d9d20c684/e0e27b69-a843-4acf-b780-24a51d8a0f35`；完整模板和准确 ARN 检查，仅 WorkerRole trust 非替换 Modify |
| CFN Execute | 一次，DisableRollback=true，foundation `UPDATE_COMPLETE`，五资源及 termination protection 保持 |

独立 Inspect 返回 `ACTIVATION_INDEPENDENT_METADATA_VERIFIED_NO_DISPATCH`。role ID `AROAV3GNMXTZK5O45RG24`、DDB ID `ea69c69e-1c48-481a-83f0-36393c196d9f`、boundary v1/inline/旧 IAM、表和桶保护、两 Secret 固定版本元数据及 Neon catalog 均核验通过。原 deny-all trust 已按批准被准确 OIDC Allow 替换，**真实 worker 权限入口已开启，不能再称为 Locked/未激活**。

本轮 Secret 值读取、原私密包读取、workflow dispatch、OIDC/STS 换取 worker 凭据、Neon 写、job/workload 写均为0。只读目录检查使用既有 owner 元数据路径，没有重复窄角色密码认证。没有创建 Cell/ECS/ALB/RDS、调用业务函数、访问应用、签 JWT 或更改已有租户 TTL。

## 固定发布链和实际 S3 版本

- 准备/执行源码 main D：`afe0e4f7f763746e384c7f5e57956e98760da93a`。
- 物理运行源码 C：`ac75c4bcbb856babc67d88b6e06212e981a25d90`，已通过原候选 CI；reusable 固定 checkout C。
- reusable R：`7c02d9db3a39fc2f926848a593eb804b642bd1e5`，父 D；信任策略固定 `job_workflow_ref` 到此 R。
- dispatcher S：`f16a36c531e7d3ac34ca359b012ac1054bae2a00`，父 R；固定 uses reusable@R。远程准确核对后，本地 main 已 ff-only 同步到 S，之后仅追加文档收尾提交；不是修改冻结运行源码。
- 安装 canonical SHA：`0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1`。
- 桶：`techlong-sandbox-cloud-worker-evidence-402010193138`。
- key：`worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/installation/0edfa9d7e9b284e0cf9dda91e280bd12e98bf8e9c36f955c3ad661f72d6ad4b1.json`。
- 该公开绑定整文档 SHA：`695cb13f463ba734fc5aaf8400eee6ef42021949bdb44a426ae10764e393acae`，不同于排除自身字段后的 installation SHA，不可混用。

发布入口只有手动 `workflow_dispatch`；本轮没有触发。environment 人工审批仍需未来用户亲自完成，单人 self-review 不是双人分权。环境/冻结代码限制可信路径，不使真实 IAM 能力变成只读，也不能保证管理员不可绕过。

## 原件和不可重放位置

- 新永久槽：`F:/ChatGPT_workshop/techlong-cloud-worker-v5-activation-v1.permanent-slot.json`，2026-10-18 **00:01:40.684 CDT** 消费；不复位或重放，旧三槽保留。
- Review：`F:/ChatGPT_workshop/techlong-w5f-review-20261017-a`；release 对象/index：`F:/ChatGPT_workshop/techlong-w5f-release-20261017-a`。
- Activate：`F:/ChatGPT_workshop/techlong-w5f-run-20261017-a`；独立 Inspect：`F:/ChatGPT_workshop/techlong-w5f-inspect-20261017-a`。
- 本地独立完整性证明：`F:/ChatGPT_workshop/techlong-w5f-activation-execution-verified-20261018-a.json`，raw SHA `4e97101231981fa3326294490de7d5d96df9a60eee8862b9e8090b846390c78b`，2026-10-18 **00:04:06.684 CDT** 完成。
- 28 份本轮公开回执/清单/槽逐件哈希，110 源码 pins、C1 的107旧 pins及23原件保持。该本地证明不再次调用网络；云端事实由独立 Inspect 的新进程读取支持。原安装绑定和 C1 历史记录未重写。

收尾再次运行 `tests/cloud-worker-activation-v5.test.mjs`，14/14 通过；公开机器记录与完整性证明、28 份原件和110源码 pins再次逐件比对通过。此测试不是云端 OIDC/Secret/窄角色认证证明，不能替代下一阶段 VerifyInstall。

## 下一步只做什么

下一最小阶段是**另审单次云端 VerifyInstall**：准确已发布 reusable/冻结 C 和上述 S3 版本，一次 GitHub OIDC token/一次 STS 会话、一次固定数据库 Secret 版本读取、一个窄角色只读 catalog 事务；不读 control Secret/原包，不调用四业务函数，不写 job、DDB、S3 或 CloudFormation，不访问应用。不需要新的租户部署窗口。

当前激活批准**不包含该私密读取或 dispatch**，不能直接运行。应先准备准确 dispatch 输入/当前 caller main/fresh 审批材料，说明最多一小时 worker 临时凭据、提供者日志/Actions 费用、失败不自动 re-run 等风险，再请求确认并由用户人工批准 environment。真实 OIDC 条件是否被 AWS 接受、固定 Secret 是否能由 worker 读取、窄角色数据库连接是否成功，仍未做云端实测。

VerifyInstall 通过也不等于真实自动部署验收通过；之后才为新的准确 held job 准备云 Review/RunOnce/独立 Inspect，沿用既有 Cell 有效期/空闲/命名空间门禁，不重用成功的 `job_fe5ced28b698d0bf128e7b42`、延长旧 TTL 或重放历史栈。主线继续保持“先自动部署、最后整套 AWS”，不重开 F3c9/Sites/观察器支线。

50 USD/月为目标不是硬限额；既有 Secret/Cell/ALB/Aurora 和 S3/API/Actions 仍可能收费。本轮没有自动删除资源，也没有停费承诺。
