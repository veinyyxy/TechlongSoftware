# W8l：同一待审任务追加新 Review（仅准备，执行另批）

## 前置与目标

W8k空策略兼容修复`dc0352a`已完成。用户另批的Neon只读核对通过：准确job `job_6e2e115c80301595512f11fb`仍pending/attempt0/max1/审核挂起、无lease/云执行授权；九行快照、六条旧job摘要及活跃平台管理员匹配。客户端TLSv1.3、证书验证及只读事务检查通过，一连接/一只读事务/五SELECT，未写数据库或AWS。原件`F:/ChatGPT_workshop/techlong-platform-w8k-recovery-readonly-20261023-b.json`，SHA `d8cd5f3733ef3d8cb3e91744fe18848ab473a04340c84c89d21134502eebb1c5`。

准确旧计划`efeff7c2bbd24c9869cd6daccb43bdb106940ba12720fee6853c085cbdeed4e6`、action `1e6c0570cf3e5a1e8c806893c2f44d37910028840d01c26b3579fa4d573799b2`正文均未变；源码02bc，期限`2026-10-24T03:05:11.885Z`（温尼伯10月23日22:05:11 CDT）已过。当前读取时只有该计划，批准0、dispatch attempt0。**这是点时证据，实际执行前仍必须重读，不是锁或CAS。**

目标仅是在同一job保留旧计划、追加一个绑定最终受审main的新Review。无需新建业务任务、改旧计划/订阅/实例、重建镜像、安装权限或扩展F3c9。旧W8j永久槽已消费，不得重跑；旧W8k ce3执行在元数据阶段停止，窗口槽未消费但旧清单不能转移到新源码。

## 拟议执行范围与完整风险——尚未批准

- 原trusted publisher、原`deployment_control_v6.publish_plan`、原安装release和同一job；最多一次准确新Review计划SQL提交。仅插入新计划，不更新/删除旧计划，不创建批准、dispatch、任务lease或工作负载。
- 最多两次读取本机`.env.local`的现有owner连接信息（发布/独立回读各一次），两个TLS连接、合计最多八个显式只读事务；使用既有函数体/owner/数据库指纹核验。发布前、实际SQL前再次核对准确旧计划、1/0/0计数及heldjob/历史哈希。owner连接权限较宽，代码预算不是数据库沙箱；配置整文件会进入内存，存在内存、网络、TLS及提供者日志风险，不输出或保存密码、Cookie、私钥、Secret值。
- 两次Source STS身份读取，最多三次固定S3版本GET（发布安装/lineage两次、独立核验lineage一次）。不读取AWS Secret/PEM或GitHub App token，不写S3、不新增IAM。SDK固定profile/account/endpoint、IPv4、`maxAttempts=1`；AWS Login或临时凭据可能失效，读取、发布或独立核验可能失败，不保证刷新或传播。
- 复用lineage key `worker-v5/app_e897a4377bce498b9c5ee9e64509dcad/lineage/w8j-job_6e2e115c80301595512f11fb-v1.json`，版本`pin8XHJzZaadT7HU.rnn2POdD06xPphz`，内容SHA `7ad860d750474ab8e3a9eb50539e736cab5c4e1d67da0ee390caecc836b406c1`。实际GET仍核对版本、AES256、长度和内容；发布器重新验证安装与完整历史沿革，不伪造或重盖旧证据时间。
- 新固定槽`F:/ChatGPT_workshop/techlong-w8l-review-refresh.intent.json`及`...-inspect.intent.json`，与所有旧槽独立；消费后不自动重试、复位、补齐、回滚、删除或补偿。错误/未知SQL提交可能留下真实新计划、收费或私有证据，本地ACK/输出可能丢失；不得以失败为理由重放。
- 另进程独立读取并验证**两条准确计划**（旧efeff和本次新SHA），批准0、attempt0、heldjob/历史未变。旧计划源码/期限不可改，新计划必须Review、同job、同安装/lineage、最终main、空执行/manifest输入、无predecessor；原永久`UNIQUE(job_id,mode)` dispatch围栏及全部SQL/IAM保持不变。异常第三条计划、任何批准/attempt、旧正文漂移均停止，不采用“大于等于1”通配计数。
- 计划SQL与提供者/本地证据不具备跨服务原子性。两个读取到SQL之间及SQL到独立回读之间仍有并发竞争，不宣称CAS；即使预读为0，也不能保证其他主体不会同时批准旧或新计划。数据库约束继续限制实际dispatch，未知结果只留证据，另行处理。

operator清单有效48小时，最晚启动留2分钟执行预留。新Review两小时期限从真实发布时派生；不延长旧计划、不启动或续期托管控制租约。发布在2分钟操作窗口内检查写入资格，Source/S3设2分钟截止信号；在途数据库/网络调用仍按各自超时结束，可能跨过截止，不能保证进程恰在2分钟退出。时间过长停止，独立回读超时也不证明计划不存在，不自动续期或重试。

已有ALB/Fargate/公网IP等仍可能持续计费，旧HostingExpiresAt只是历史标签，不会自动停止。50USD/月是目标而非硬上限；本轮GET和证据保留接受低成本但非零费用。准确资源清理、窗口更新及真实租户部署不在本批准范围。

## 工程实现与核验

`ops/platform-review-v6/refresh.mjs`固定旧计划/来源原件/新槽，重算旧SHA，验证准备证据，约束一条SQL及精确ledger。`refresh-local.mjs`复用现有publisher、数据库验证器及S3固定版本读取器；无S3 Put/Delete、Secret值、App、CloudFormation或dispatch写能力。Prepare只读本地公开证据、配置文件元数据及GitHub CI，不读取配置内容、不连接Neon或访问AWS。

新增测试覆盖旧计划篡改、引用/源码绑定、精确1→2计数、已有批准/attempt、过期/未知提交及单次SQL/关闭行为；既有窗口测试继续覆盖原单计划路径。GitHub临时PostgreSQL独立数据库使用实际`LEDGER_SQL`与原安装函数验证追加、旧行保持、异常批准拒绝、旧plan_sha不可覆盖及永久dispatch唯一性；不使用Neon或AWS凭据。这些测试不冒充生产发布或部署验收。

## 同源码配套窗口与顺序

窗口代码为`ReviewRefresh`显式分支接线：仅接受新入口的独立结果、准确旧计划SHA、oldPlanUnchanged/Expired及精确两计划哈希、2/0/0计数；原W8j单计划分支仍只接受1/0/0。**40分钟剩余/80分钟回读新鲜度、资源/角色/固定Secret/镜像及单次UpdateStack围栏不放宽。** 这里只实现和准备配套清单，绝不执行更新。

1. 所有代码/测试/真实临时PG/CI通过后，在同一最终干净main准备W8l发布及新W8k窗口两份清单。此后冻结main直到本job Review→RunOnce→Inspect结束，阶段证据暂存F盘和检查点，防止提交使计划失效。
2. 先批准准确W8l manifest SHA及本文完整风险，单次追加Review，随后独立核验；未通过不得启动窗口。
3. 再按配套W8k准确SHA及其[完整风险](aws-auto-deployment-platform-w8k-hosted-window-review.md)另批窗口更新/独立核验。原ce3批准不能迁移；新输出目录保留原失败目录，未消费窗口槽也不表示自动重试获批。
4. 后续用户平台动作、GitHub environment审批、真实RunOnce和独立Inspect仍各按具体范围推进，不能用计划发布或更新元数据成功冒充部署成功。

入口`node --experimental-strip-types ops/platform-review-v6/refresh-local.mjs`。Prepare参数：`--mode Prepare --output F:/ChatGPT_workshop/techlong-w8l-review-refresh-<标签> --ci-run <最终准确CI>`。Publish/Inspect需原manifest、`--approved-sha <准确SHA>`和分别新的`-run`/`-inspect`目录；源/pins/CI不匹配、过期或槽占用即停，不重放。F盘仅数据，实现全部位于工程。
