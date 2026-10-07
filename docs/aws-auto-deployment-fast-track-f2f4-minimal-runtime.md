# F2f 第四批：最小运行层修复与发布前 OS 扫描

2026-10-07 完成真实 GitHub Actions 验证：app 和 lifecycle 均成功构建、隔离自检，并通过新增 Trivy OS HIGH/CRITICAL 门禁；完整 Backend CI success。**这批候选没有发布到 ECR**，发布 IAM 仍为原 Locked/v2，不能把前置 Trivy 结果等同 ECR BASIC 扫描或 ECS ready。

## 修复范围

- 两类 final runtime 使用精确 `gcr.io/distroless/cc-debian13:nonroot@sha256:e792ab3d241a468a4fd7519ddbbebe66b49b5f365771716ea688ad40b6c6f1c2`，没有 shell、apt/dpkg 执行器、Perl、npm/pip。保留原 Node24.18.0，nonroot uid/gid65532。
- lifecycle 保留 pg_restore **16.14**，来源改为固定 `postgres:16.14-trixie@sha256:95206741a5b214807675e14165369d05b93a9cf692223b616d07cca227e74b0b`；实际输出 `16.14-1.pgdg13+1`。旧 Debian12 包装和 Windows plain16.14 仍支持，PG15/另一 patch/任意 suffix仍拒绝。
- 使用官方 `python:3.14.8-slim-trixie@sha256:f85c5697265c178cc6887276c55fe16cf3d14ca35c3df6a5eab3b360534a55d2` 的准确 patched interpreter、非GUI stdlib和所需ELF依赖。Python3.14.8 修复本轮报告的 SSL 两项 CVE；真实 build执行版本断言和缺少server_hostname的MemoryBIO回归，不能仅靠镜像标签声称修复。[Python官方发布说明](https://www.python.org/downloads/release/python-3148/)
- 本轮新前置扫描在应用旧运行层发现 OpenSSL `CVE-2026-84782` HIGH，因此同步更新 app 的精确 runtime pin，业务代码不变；新层构建/bcrypt/native smoke与扫描通过。[Debian修复状态](https://security-tracker.debian.org/tracker/CVE-2026-84782)
- `build-lifecycle-runtime.py` 从固定PG/Python源提取实际所需二进制和动态依赖，优先使用distroless已提供的基底库，不覆盖基底libc/ssl/libgcc后仍冒称原版本。额外Debian库保留准确原包version/source metadata；Python是上游安装，不伪造Debian包名/version，记录独立source/version/文件SHA provenance。保留distroless原dpkg status.d。[官方包元数据规范](https://github.com/GoogleContainerTools/distroless/blob/main/PACKAGE_METADATA.md)
- 实际删除未使用的Tk/IDLE/turtle、curses/readline和原生 `_uuid` 模块及其相应库，不复制不必要的交互/GUI运行时。后续6项HIGH来自这些依赖，未采用ignore/ignore-unfixed、严重度豁免或删除保留组件的扫描元数据。不是一个通用交互式Python发行版。
- 修复COPY overlay改变 `/tmp` 权限的问题：sticky1777共享目录，compiler新建owned0700 child，CI显式tmpfs1777；仍network none/read-only/noexec/nosuid/128MB。实际 compiler 在 uid65532 上跑通。
- CA bytes、SQL/profile/seed/journal/ownership/receipt/业务协议均不改变；旧runtime/Worker/standalone生产写CLI仍disabled。

## 新增前置门禁

`check-image-security.sh` 下载并核验 Trivy0.75.0 linux/amd64 tar原始SHA `c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f`，只有job-local新DB/cache，不安装本地Docker/WSL或调用AWS。仅扫描该job本地Docker image，固定OS scope、HIGH/CRITICAL、exit1、空ignorefile，未ignore-unfixed或skip-db-update。

`verify-image-security.js` 核对准确image config ID、受支持Debian12/13、非EOL、可见完整包清单、新鲜DB（48h内），再验证HIGH/CRITICAL均0；报告/DB/metadata各有SHA。异常、不支持或DB失败均不能导出 promotion candidate。扫描详细报告和摘要独立保留7天；精确checked镜像仍保留1天。candidate receipt新增 `osSecurityScan` 小proof，原四文件promotion ZIP结构不变。

此门禁在云发布前尽早发现OS问题，不取代npm audit、上游非DebianPython的版本/已知修复核验或未来独立ECR BASIC扫描；不同扫描器/feed结果可能不同，不能降低原ECR HIGH/CRITICAL门槛。

## 真实成功证据

源提交：`40b1ce6e487dc4c1187da3014a89b9379d50d578`。

- [两镜像构建、自检和OS扫描 37674970489](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37674970489)：两个job success。
- [同源完整 Backend CI 37674970442](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/37674970442)：success。
- lifecycle实际完成3.14.8 SSL补丁回归、bundle/CA/SQL、无多余执行器/库、copied dependency bytes/准确包metadata、PG16.14合成五表schema compiler、自检write gate拒绝；不读取或批准真实私有73表baseline。
- app实际nonroot/native smoke与health200/无数据库ready503；仍不是租户就绪。
- Trivy新鲜DB UpdatedAt `2026-10-07T07:38:55.515026687Z`，DB bytes SHA `5f4b978a55284b1997dc31e9f2fc3f4f1abae80829f51451ade221d5675a69b9`；app可见14个OS包、lifecycle32个，两者HIGH=0/CRITICAL=0。

以下仍是 **image config digest，不是 ECR manifest digest**：

| kind | config digest | candidate receipt bytes SHA | checked artifact ID |
| --- | --- | --- | --- |
| app | `sha256:f82596ef5dae6229a629a07b37cfce5b0ece9b99fc63d939af997fbde9c40f49` | `fcdcc0abee0393820a4c190e593330a9af3357d37d2f2a00b4eec488fc1b65d0` | 11506991818 |
| lifecycle | `sha256:cc342bcc242b9c3ae9d61d9b94c27053e7e8c8a2bc32347f54368848d76ea5af` | `46a825ce303b87312075db66417f20731aa28989035fa5ff1dfcc0aca57bc45e` | 11506102380 |

app ZIP SHA `e3213b870c3a6ef6aac79d05826c2cc4e8f87756e18a5d9b69de0c419839b928`；lifecycle ZIP SHA `df93125d87f76800d816927d5185fbdc3ef30649b2699a6a3e8cae869553bf01`。两ZIP合计约154MB，实际ECR layer计费量另算。

app候选最早于**温尼伯时间2026-10-08 14:30:55 CDT**（19:30:55Z）失效；lifecycle为19:31:13Z。过期不自动延长或重放，后续发布必须新鲜批准。OS报告artifact：app11506296990、lifecycle11505922699；report SHA分别 `401769fb477853fa0d341e8408e697752ee20b54903e772496eb42ee7d867b58` / `380d9bc2301a84064aa2fb2d9db9ad71d5cb0e9eebae9064ffb98bf526402850`。

私有索引 `F:/ChatGPT_workshop/techlong-lifecycle-image-remediation-20261007-f2f4/successful-candidate-index.json` SHA `0a091e21d81daa1f838dd26ac6ebbc7a5eadc9a8d6d86cf84d78cead38b23e32`，来自成功run日志与REST元数据；尚未把这次索引称为候选ZIP加载或ECR读回。失败运行37672180629/37672624719/37673160212/37673767846/37674318219全部保留，依次暴露旧app OpenSSL、Tk依赖、旧pin测试、nonroot临时目录与未使用的交互库扫描项；不重试云权限或旧发布。17项相邻Node测试、脚本语法通过，最后完整在线CI通过。

## AWS终态与下一步

结束前Source只读确认：原专用IAM栈UPDATE_COMPLETE、boundary default v2/唯一inline DenyAll、OIDCtrust Deny，未重开权限；原两个ECR镜像和所有记录保留。没有AWS写入、ECR新tag、源PG15/Neon变更、baseline发布、付费Cell或ECS/Worker运行。预算仍50 USD/月目标。

下一小阶段准备这批修复候选的**新发布清单**：绑定上述准确run/ZIP/receipt/config/前置scan证据，并明确更新现有Locked IAM栈的短时Grant范围（不是重新创建同名资源）；用户按新SHA确认后，才能单次发布到新的immutable tags、独立ECR扫描/manifest回读，成功或失败立即SourceRevoke。不得复用已执行的 `ce32e464...` 批准或删除原有失败镜像。ECS/Cell、生产authority/root、真实baseline/数据库硬化仍分别确认。
