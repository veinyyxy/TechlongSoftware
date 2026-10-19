# W6e：一次无 AWS 的真实 App 身份调度，待审入口

2026-10-19。继续主线，不重开F3c9、重跑原CI或部署业务。W6d已发布真实身份workflow **389772013**，本步只实现/测试专用调度和独立只读验收入口。**准备不读取PEM内容、不签JWT、不mint App token、不dispatch；实际执行必须另批最终SHA。** 平台仍 `UNPUBLISHED`，这不是端到端自动部署完成。

## 固定范围

固定App5381160、installation173033406、仓库veinyyxy/TechlongSoftware（1323312747）、owner14145707、待实测bot344813947。仅调度现有 `.github/workflows/platform-controller-identity-v6.yml` / ID389772013；内容SHA `ffac70244e455a547b498fc233a9a17fa5b0c022ab598c5b9735c83436007dea`、blob `4fb6626ca37730e8606abe3ae0d06000d015dcce`，运行代码冻结 `ca2b38d8c756dd8fb800a88ded596c93687f278f`。

工作流只有两个输入：新公开nonce与当时准确main SHA。仅Contents read、没有id-token、AWS或平台Secrets；保留 `techlong-sandbox-deploy` 人工环境审批。新程序不修改或重新发布工作流、不代批环境、不运行旧部署入口。

真实PEM唯一允许路径仍为 `E:/NodejsProject/TechlongSoftware/techlong-sandbox-controller.2026-10-19.private-key.pem`。Prepare只读取文件类型、长度、时间戳、真实路径和ACL（现有三主体受保护ACL），确认ignored且未跟踪；不读取/计算PEM内容摘要。旧认证脚本和九个原pins不改、不重跑旧槽。

## 两个入口与顺序

核心 `ops/platform-identity-review-v6/dispatch.mjs` 只有显式依赖接口；本地I/O `dispatch-local.mjs` 有Prepare / Dispatch / Inspect三种互斥模式，不进入平台HTTP或队列。

准备和执行时还要求7个共用认证/身份验证依赖与冻结ca2b38d的Git源码无差异，避免拿另一版解析器冒充已发布身份程序的合同；新入口本身用15项fresh源码pin绑定。

1. Prepare在最终同步干净main上使用现有Git凭据做5项只读查询：仓库、main、已发布workflow、准确内容、历史运行。要求身份workflow尚无任何历史运行。生成新32字节公开nonce、15项源码/风险/证据pin、PEM元数据、准确caller main和48小时窗口，写仓库外manifest。没有App认证或写入。
2. Dispatch验证精确manifest SHA、15项pin、元数据、干净main及现有Git只读远端事实，再独占永久槽。**槽先于PEM内容读取和App请求**；并发执行只可能有一个槽成功。
3. 最多一次固定PEM读取/内存签名。顺序仅 `/app`、指定installation、一次安装token POST、单仓scope与bot、准确main/workflow/内容/历史运行8个GET；token权限只请求 `actions:write, contents:read, metadata:read`，repository_ids只含1323312747。权限/身份/过短或过长expiry/有旧运行/主分支或内容漂移均停止。
4. 最后本地pin/元数据/期限检查后，唯一POST到该workflow dispatch，ref=main、两输入固定，要求HTTP200和准确run ID/URLs ACK；先将公开ACK独占落盘并flush，再退出认证session。新API的明确run ACK见[官方dispatch接口](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event)。不从运行列表猜测ACK，不在响应不明时重发。
5. 在成功或失败路径上，若取得可用token，立即finally进行最多一次 `DELETE /installation/token`，不等待人工审批或Actions执行。之后写不含凭据/原始错误的receipt；清理失败不能抹掉已保存ACK。[官方安装token与撤销接口](https://docs.github.com/en/rest/apps/installations)。
6. 获得准确run后由用户只批准那一次environment，禁止Run/Re-run。Inspect使用既有Git只读凭据，不读取PEM或签发App token；先绑定原槽/ACK，再读准确run。waiting只报告等待，失败不读部署日志或重跑。成功才读取唯一准确公开artifact，核对run/caller/digest，内存解码单文件ZIP并验证CRC/长度与文件名，最后使用原 `verifyIdentityProofV6` 比对nonce、sender、actor、caller、冻结源码和proof摘要。

实际认证最多**11个App API调用**：8 GET、1 token POST、1 dispatch POST、1 revoke DELETE；失败可能更少。前置5项Git身份GET、metadata脚本和Git本地检查不属于App token请求数。Inspect仅GET：准确run、artifact列表、ZIP下载302及无Authorization的签名存储下载；不请求其它日志或artifact。[官方artifact下载接口](https://docs.github.com/en/rest/actions/artifacts#download-an-artifact)。存储URL不落盘/打印，GitHub凭据不转发给存储域；ZIP不解压到文件系统。

Inspect还回读本次本地receipt中的撤销204/审计。缺receipt或撤销证据时保留token可能存活风险；即使身份proof成功，也不能掩盖清理失败。它没有用旧token做第二次提供者撤销状态认证，故不声称独立证明实时失效。

## 清单与命令

先提交推送本步代码/文档，在最终main准备，不把含父SHA的最终清单再提交而移动绑定：

```powershell
node --experimental-strip-types ops/platform-identity-review-v6/dispatch-local.mjs --mode Prepare --output F:/ChatGPT_workshop/techlong-w6e-identity-20261019-a
```

最终清单为上面目录的 `manifest.json`，包含有效48小时的精确SHA。仓库记录只是非执行准备状态，不能代替这个SHA授权。最终Prepare后暂停推进平台main，直到本次dispatch执行或明确放弃；避免再次出现审批期间自己改变caller head的问题。

仅获准确SHA批准后：

```powershell
node --experimental-strip-types ops/platform-identity-review-v6/dispatch-local.mjs --mode Dispatch --manifest F:/ChatGPT_workshop/techlong-w6e-identity-20261019-a/manifest.json --approved-sha <最终SHA> --output F:/ChatGPT_workshop/techlong-w6e-identity-20261019-a-run
```

独立Inspect（不要求未过期、不要求main仍停在原SHA，但必须匹配原槽和准确ACK）：

```powershell
node --experimental-strip-types ops/platform-identity-review-v6/dispatch-local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-w6e-identity-20261019-a/manifest.json --output F:/ChatGPT_workshop/techlong-w6e-identity-20261019-a-inspect1
```

若仍waiting，可在用户审批/运行有进展后使用新的inspect2等输出目录继续**只读**Inspect；不是新dispatch或复位。程序不在后台轮询、取消或重新安排运行。48小时只限制发起dispatch；原准确run的后续只读验收不会因本机清单过期被阻断，也不将它当成云部署TTL。

新永久槽 `F:/ChatGPT_workshop/techlong-w6e-identity-dispatch.intent.json`，ACK为同目录 `techlong-w6e-identity-dispatch.ack.json`，receipt为 `techlong-w6e-identity-dispatch.receipt.json`，均wx+flush写一次。旧W6b认证/W6d发布槽和原件保留。ACK缺失时Inspect只报告人工只读恢复需求，不扫描/认领其它run，不自动再读钥、mint、dispatch、revoke、回滚或重试。

## 完整风险与未授权事项

- App安装的Actions write在提供者侧是**仓库级**，不能仅限制这一个workflow；代码白名单不是GitHub权限边界。token仅请求单仓且不请求Contents write或其它新权限，但凭据泄漏或被其它程序使用仍可能操作更多Actions功能。准备/Inspect使用的原Git凭据也可能有更广权限。
- 本地PEM是长期私钥，内存字符串/CryptoKey无法保证擦除；只尽量清零读取缓冲区。ACL/文件类型/打开句柄/前后时间戳不是内容签名或跨进程锁，不能证明从未复制；本机被攻陷、同权限并发修改或文件系统竞态仍有风险。不自动生成、复制、轮换或删除任何key。
- token POST可能已创建凭据但响应丢失/不合法，无法知道可撤销token；DELETE也可能超时/失败。保守记录可能存活，不重新mint或自动重试撤销；提供者token通常有最长一小时期限，不把它当成已证明撤销。App JWT短期有效但未提供单独立即撤销动作。需要用户审视异常后另行决定处置。
- main/元数据/权限/槽等检查不是GitHub与本地之间的原子事务。检查后main仍可能并发前进，调度可能产生不同head、错误actor或失败运行，验收会拒绝；不能因此自动dispatch第二次。ACK保存失败或网络不明可能留下未被本机准确识别的真实运行。
- 环境审批由用户负责，不在脚本中等待或代批。仍可能发生runner排队、环境拒绝、依赖下载/提供者故障、job失败、artifact过期/无法下载或ZIP严格合同不兼容；只保留原件并诊断，不重跑工作流、不自动放宽验收或换nonce重试。公开proof不含业务凭据，但公开App/仓库/actor/run/nonce和提交等元数据。
- 令牌只通过HTTPS交给GitHub官方API，storage请求只下载身份artifact；网络、提供者与托管日志风险仍存在。签名URL不输出但提供者可记录访问。没有读取其它私有Actions日志/部署材料的授权。
- 本次运行会使用Actions分钟、artifact存储（原工作流7天）以及environment deployment记录，低成本但不保证绝对零费用。原50 USD/月AWS目标保留；本步AWS/SQL调用为0，并不让既有AWS资源停止计费。不升级plan、不改runner/环境/权限或付费设置。
- 一个新固定槽占用后不自动复位/重放；失败前置未占槽也不自动重跑失败命令。清单变更或过期需要刷新并重新确认，不能用旧批准替代。后续已成功identity proof并不授权SQL、App OIDC trust、部署workflow或任何Cell/业务操作。

本步15项新增定向检查+原认证10项回归覆盖上述顺序、失败和证据边界，使用内存临时RSA测试密钥/合成API与ZIP，不是实测App身份。真实私钥、App token、dispatch和artifact下载尚未执行。无须刷新AWS Source；下一唯一写动作须新清单批准。
