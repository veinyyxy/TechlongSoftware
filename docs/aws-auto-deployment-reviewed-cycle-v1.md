# G1/G2最小接线：一个受审周期组合与整轮连续衔接

这是[执行手册](aws-auto-deployment-execution-runbook.md)及[总清单P1](aws-auto-deployment-next-cycle-plan.md)的实现说明和风险附表，不另开部署分支。用户已同意仅代码/测试/文档；本阶段没有生产查询、配置/PEM/Secret内容读取、业务任务创建、云/SQL写入、发布或dispatch。

## 范围和默认关闭

`ops/platform-reviewed-cycle-v1`只增加一个源码选择的组合，复用原请求/基准编译器、单次代理调度、两套三写发布器、冻结的云执行/完成/独立Inspect内核。没有a605/a606目录、任意job/profile CLI、普通队列、另一个执行器或调度平台；旧a604默认行为和全部旧槽保持。原97/104文件云闭包不得改变，新云线协议适配只在未来准确源码发布后可用，不更新已部署工作流。

`selection.mjs`当前为`null`。新任务/请求、真实终态基准、准确held事后状态、历史全集及摘要、独立回读证明、事实批准、包版本和来源发布描述符尚未形成，**不得把测试值或旧周期值填进去**。本机入口和OIDC传输在默认关闭时均先拒绝，之后才可能读取配置或申请身份。JSON清单、环境变量、包或CLI不能选择周期能力；四个自引用来源字段只由受审workflow源码模板按原规则绑定，仍须OIDC和准确RoleId核对。实际来源发布、必要trust-only变更仍另按准确差异批准，不扩权限。

周期ID绑定完整profile/请求证明/历史摘要；单次槽按准确job固定，**更新事实、源码、grant或输出路径不会给同一job新槽**。禁止重用已知旧job、复位/删旧槽或绕过数据库永久`(job_id,mode)`唯一约束。基准编译器仍从原件完整重建，原成功前驱、退役和accepted lineage锚点不变，不把a604 Review提升为部署成功。

## 唯一整轮入口

本机`local.mjs`仅有`--check`、`PrepareSaved`及`RunReviewed`。Prepare从当轮另批、真实不足5小时的只读快照及最终准确CI生成清单；不连接生产。当前未配置来源，不能Prepare或Run。

新的**整轮外层SHA**预先绑定准确grant/seed、source/pins/CI、周期/包/固定版本、风险、累计上限、每个派生规则及全部槽；Review-only grant或原continuous SHA不能升级为整轮批准。运行不接受外部派生SQL/plan或resume/run-id参数。

1. 连续Review：原单次审计/seed/批准/调度，等待用户本人批准GitHub environment，准确run及四版本内容核验，原observe/proof/publish三写和独立回读。
2. 同任务RunOnce：只调度受信后继一次，再由用户本人批准GitHub environment；保持原claim/完成/CreateStack七资源/私密读取等合同。不在窗口内回来聊天准备新材料。
3. RunOnce→Inspect：捕获准确六版本对象及完整真实状态，核对原完成编译器、回执和四字段执行描述符；派生准确三写清单，独立回读后才允许下一步。
4. 独立Inspect：只调度该后继一次，第三次GitHub environment由本人批准；不同run独立读取，准确五版本对象/完整账本及业务/回执一致后才输出`WHOLE_CYCLE_INDEPENDENTLY_VERIFIED`。

最终证明只写本机私有证据，**没有导入Inspect的账本proof，也没有证明完整产品/新租户首次部署/长期AWS交付**。GitHub success、捕获日志或前一步成功均不能替代最后核验。初始材料/请求创建、包上传、事实/来源发布、清理不隐藏在整轮入口内，均须先完成各自准确审批。

## 整轮预授权的固定上限

上限由`whole.mjs`固定重编译，并受原各入口的更小单次预算约束；不能在清单里加大。以下覆盖整轮执行，不包含此前P2–P4准备/请求/来源发布，后者需分别清单，不把它们混成一次授权。

| 本机能力 | 整轮最大值 |
| --- | --- |
| 配置全文件进入内存 / 验证TLS连接 / SQL查询 | 8 / 13 / 635；均沿用原身份、catalog、角色、保护和search_path核验 |
| Source STS / 审计权限模拟 / 条件审计PUT | 8 / 3 / 3 |
| PEM进入内存 / App token / dispatch / revoke尝试 | 各3；App HTTP共30，实际token撤销不作保证 |
| 固定版本S3 GET | 26（Review捕获4+发布重核4、RunOnce捕获6+发布重核6、Inspect捕获5，共25，保留硬上限26） |
| 监控GitHub GET / 官方短期日志下载 / 准确CI GET | 258 / 3 / 21；另发布器准确run GET4、环境规则GET6，App的读取计入上行30 |
| observe / proof / 后继plan / 初始seed | 2 / 2 / 2 / 1；begin/live/ACK各最多3，未知标记最多3，无重试 |
| 新业务任务、AWS资源直接写、IAM、Secret值直接读、Web续租 | 0 |

云端沿用固定安装合同：每模式DB Secret固定版本最多1次，共3次；RunOnce控制私密包最多1次、claim及complete事务各1、DDB journal写最多5、CreateStack最多1/七资源、认证GET最多2。外层条件S3 PUT最多6，原内层证据PUT最多6（Review manifest1、RunOnce provider-before/create-ack/provider-after/run各1、Inspect1），Inspect内层固定版本证据GET最多2；云协议读取包/installation/manifest/descriptor每模式分别最多2/3/4。原SDK元数据轮询/角色/网络/authority核验及证据桶布局核验保留安装合同，没有扩服务/对象范围；正式审批须绑定准确安装描述符和源码，不以这段摘要替代原合同。GitHub artifact按受审workflow原规则保存，不输出凭据。

## 时序、停止及完整风险

整轮最长40分钟；各阶段仍受原更短限制：Review连续段20分钟、单次dispatch/三写2分钟、监控每模式最多80次/15秒间隔。原事实期限、15分钟claim、8分钟执行预留、2分钟发布启动预留、Inspect 12分钟启动/发布至少10分钟剩余均不延长。约R+5分钟前必须开始原Review后继发布；5小时仅是准备快照，不是执行窗口。

每阶段仅一次；任何源码/权限/历史/业务/版本漂移、超预算/过期、未知写ACK/dispatch或失败立即保存已知ACK并停止，不自动补齐、回滚、清理、再建任务、刷新时钟或重试。停止结果不是“未产生副作用”；可能已经写了部分账本、发出run或遗留收费资源。GitHub三次environment只能本人批准，不能自动代批或修改规则。

实际批准时须接受配置全文件、owner数据库凭据和私钥进入进程内存（不记录内容）、owner权限较宽、数据库/云/网络/提供者日志、正常认证/账本写入、App签名与token清理不确定、非原子/并发/非跨服务CAS、短窗口/异步和提交不明、源发布差异、永久槽、部分资源/任务/权限遗留及非零费用等风险。50 USD/月是目标不是硬上限；TTL/标签不停止计费，清理仍另审。继承的[代理批准](aws-auto-deployment-delegated-web-approval-v1.md)、[三写发布](aws-auto-deployment-delegated-publisher-live-v1.md)、[原云合同](aws-auto-deployment-a604-cloud-compatibility.md)风险不因集中批准消失。

本轮测试只用合成数据、原编译器和内存端口，不冒充AWS/Neon实测。下一只在准确CI后准备**当轮限定只读事实**的具体调用范围并另征允许；不直接执行旧清单、填假来源或开Review。

2026-10-28本机收尾：19项新串联/边界测试、118项相关旧入口回归、类型检查和scoped lint通过，Markdown链接和diff检查通过；旧97/104闭包保持。正常提交只触发No-AWS候选CI，准确run结果另封存本地检查点，不在短执行窗口内追加提交。本轮生产调用/私密内容读取/数据库连接/新任务/云或SQL写/新槽/dispatch均0。
