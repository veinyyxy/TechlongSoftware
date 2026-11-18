# D2-6 步骤4最后三项接续审批

2026-11-17，America/Winnipeg。这里只准备[机器清单](../ops/releases/d2-6-step4-finish.review.json)，**没有执行许可，也没有新的生产读取或操作**。源码`29398e3`及[准确CI44202919107](https://github.com/veinyyxy/TechlongSoftware/actions/runs/44202919107)已通过；[a338结果](aws-instance-release-step4-activation-partial-20261117.json)中的九图、媒体CAS及四段CFN已经成功，全部保留，不再恢复、上传、迁移或盘点。

## 一次批准，只完成三项

1. **独立技术核验。** 新独立进程以原Source IAM用户做STS一次；最多35项准确AWS元数据（既有采样路径预计29项，不翻页/不重试），只核对准确Cell/tenant/platform/IAM归属、A任务与目标健康、实际路由/DNS、原Aurora可用、两个固定Secret版本元数据、图片桶HEAD和A原始ECR manifest。仅准确API的`/health`、`/ready`各一次HTTPS GET，无身份、不重定向，不执行JS/登录或业务测试。响应、HTTP状态和真实facts先保存，再用已修复核验器判定；不能把旧运行或旧缺失HTTP结果当本轮通过。
2. **初始A绑定及独立回读。** 仅全部技术证明通过后，读取现有`.env.local`全文件一次，建立两条验证TLS的Neon连接，最多40条SQL提交；一个受审owner事务仅插入准确实例的一条`deployment_release.instance_state`，A/revision0/无active request，保存实际sampling及原`releaseRuntimeDigests`指纹。先核对目录A/B、业务准入、OIDs、原记录不存在及无活动release；owner成员SET临时开启、同事务关闭，保留原ADMIN/INHERIT FALSE。新连接READ ONLY回读整行及关闭状态。冲突/提交不明停止，不更新旧行、不重放SQL、不改业务/目录/schema/密码。
3. **runtime最后启用。** 仅绑定明确提交且独立回读一致后，复制既有关闭候选，只改`enabled=true`，严格核对规范SHA `ed815edf557e9e5fcf080c0636622532a73d5d542b177e09168fe0e88c342ec8`；仅该数据文件一次提交/推送main。bootstrap、工作流及GitHub人工门禁不变，不dispatch正常更新。此后D2真实更新仍0/2。

## 本次准确读取与上限

| 范围 | 本次最多 |
| --- | ---: |
| Source STS（只在独立进程） | 1，原累计5→6，必须明确另批 |
| 白名单AWS元数据 | 35，原124之剩余内，累计最多159，不新增总预算 |
| API技术HTTPS GET | 2，原2之外，本次各路径1；累计最多4 |
| GitHub GET / 显式Git凭据helper | 2 / 1，明确新增，只核对当前main和准确CI，并供最后Git push |
| `.env.local` / Neon TLS / SQL / 初始INSERT | 1 / 2 / 40 / 1，全部是原未使用余量 |
| runtime数据提交 / 推送 | 1 / 1，原未使用余量 |
| 本轮成功原件本地读取 | 3份各1次、各≤2MiB，仅旧journal、完整持久化证明、恢复后归属 |

旧原始八文件/派生输入累计20不再读取；不补读13个旧provider返回，不读原图/ZIP、Secret值/PEM/PAT/HMAC，不连接Aurora、不增加Token或镜像GET。三份本次成功原件由准确raw SHA绑定，可能含资源/媒体标识，只进内存和本机私有证据目录，不提交正文。旧数据和新鲜元数据用途分开：九图证明复用，但新鲜服务验收不能从旧响应重构为通过。

Git凭据只在内存，经HTTPS交给GitHub官方及最后精确main推送；不保存token。没有environment批准动作，因为本次没有workflow dispatch；后续正常A→B/B→A仍由用户本人批准GitHub environment。所有AWS写、CFN创建/执行、IAM/DNS/Secret修改、图片PUT/CAS、启动/停止和新增资源均为**0**。

## 时间与调用就绪

原a338执行截止保持**2026-11-18T00:50:04.215Z＝今天18:50:04温尼伯**，原事实截止00:53:21.305Z＝18:53:21也不延长。本次最多15分钟，**最晚00:35:04.215Z＝今天18:35:04启动**，执行截止为`min(本次启动+15分钟，原00:50:04.215Z)`；只是收紧旧剩余期限，不复活旧90分钟、不重采样或给CI重新计事实时间。B原artifact/扫描期限不改。过期不开窗、不消耗新槽、不自动另采快照。

私有单次调用在批准前先接齐，复用既有Source只读端口、独立采样和原owner绑定/runtime端口，不新增正式工具或框架。新意图只在收到准确SHA批准且门槛通过后创建一次；旧失败journal、INTENT、操作信封和全环境启停状态原字节保持。旧端口参数中原计数上限不当作新预算：本次meter只按明确批准的delta增量计费，未列动作直接拒绝，不能把累计数清零重开。

## 完整风险与失败处置

- 接受[原完整风险](aws-instance-release-step4-execution-review.md)中适用的宽Source/owner权限、内存/提供者日志、跨服务非原子、并发/非CAS、提交不明和持续计费风险。恢复已经完成；ALB/Fargate/公网IPv4和本来运行的Aurora可能继续计费，50USD不是硬上限；截止不是自动停费时间，不自动清理或暂停。
- 读取`.env.local`会使整文件进入内存，未选字段不使用/输出；TLS不消除本机或托管提供者日志风险。控制面owner权限远宽于一行，临时SET可用期间存在风险；严格关闭并独立核验，不删原ADMIN，也不新增登录/授权/Secret。
- 初始行COMMIT、runtime本地改动、Git commit/push不原子。故障可能留下已插入绑定、已提交但未推送或已启用runtime；提交/推送不明即停止，不自动重试/补齐/回滚或用读回冒充明确ACK。永不覆盖已存在绑定。
- 资源在检查后可能变化；现有采样与摘要不能提供跨服务CAS或阻止并发修改。Role/参数/标签/归属、固定版本、A、健康/HTTPS或业务准入不符就停；不按新事实悄悄改基准。
- 单次新槽永久保留，失败不删除/改名/复位；不重跑原a338、四个CS或九图/CAS，也不偷偷继续后续A/B正常发布。必要新查因、重试意图、恢复或停费仍具体另批。

只有用户明确接受新SHA及上述范围/风险后才执行。准备、语法/无网络检查和代码CI不等于本次独立验收、初始绑定或runtime已完成。
