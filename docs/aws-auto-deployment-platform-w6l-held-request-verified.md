# W6l完成：准确新待审任务已登记，入口关闭并独立核验

2026-10-20，America/Winnipeg（CDT）。用户确认清单 `ff9dc72be5f7c699feaa68c64697c5da16ebc68deb7438d5e6da9398bea5adec` 后执行唯一一次Start，由既有管理员自行登录并登记固定新任务。**新job已独立核验，但尚未领取、授权云执行或调度Review；本机服务现已关闭。**

## 实际结果

- 准确任务：`job_fc0309dabebc09367f64153f`；实例 `app_e897a4377bce498b9c5ee9e64509dcad`，deployment `dep_7c99bd249470184852f0dc74`。固定requestId为 `95ac9490ecf4698d001cb05acea3b11219116c65e7375b6b6b190b5eae2bd2f6`，管理员为既有 `veinyang@gmail.com` / `usr_4dcd0a09821fde2bb1801f58`，不是代理伪造session或直接INSERT。
- 执行源码 `471c213e23f2dba39d9e1b17e2d12bb7a597a458`；67项本机检查、类型/定向lint通过。[准确CI39481221235](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39481221235)（job118829980875，attempt1）全部17步骤成功，含一次性PostgreSQL真实SELECT/int8/lease投影、合成材料controller/request-only子进程、构建；没有rerun或使用生产AWS身份。
- 元数据Prepare与独立canonical清单/26项源码pin核对通过后，Start永久槽于 `19:18:59.331Z` 消费。两次显式只读事务核对九行及四旧任务、管理员/前驱；基线新目标不存在。`19:19:10.960Z` Ready，原child PID31620，OS核对仅127.0.0.1:3100监听。controller专用凭据为空、开关关闭，普通worker/apply关闭。
- 用户报告准确job“待审（不会被普通队列领取）”。数据库回读确认pending/reconcile、attempt0/max1、`available_at=9007199254740991`、无lease、completedAt为空、reviewRequired=true、cloudExecutionAuthorized=false，且request/admin/scope与批准目标一致。请求时间 `19:20:45.460Z` 在本次许可内。
- 经原PTY session67150发送Ctrl+C，保存结果 `REQUEST_WINDOW_CLOSED_REQUIRES_INDEPENDENT_READBACK`、portFree=true；结果文件mtime为 `19:21:25.038Z`。终端包装层退出码1与正常结构化关停结果同时保留，不据此重启或重试。原许可本应到 `19:49:02.675Z`（14:49:02.675CDT），本次提前关闭。
- 独立Inspect于 `19:21:36.030Z` 消费另一永久槽，第二次读取既有认证文件，另作两次显式只读事务，`19:21:37.896Z` 返回 `NEW_EXACT_HELD_REQUEST_INDEPENDENTLY_VERIFIED`。九行业务及四旧任务摘要均与基线一致；OS于 `19:22:50.7515185Z` 再确认原PID不存在、3100监听数0。

## 证据与授权边界

[机器执行摘要](../ops/aws-sandbox/reviews/platform-request-v6.executed.json)保存12项公开原件路径/raw SHA、批准目标、CI、关停与回读状态。文档编辑前重新对照canonical清单、全部26项执行源码pin、原批准副本、两槽、同一窗口及前后摘要；没有为了核对而追加生产SQL或重读秘密。原件保留在 `F:/ChatGPT_workshop/techlong-w6l-held-request-20261020-a`、`...-a-run`、`...-a-inspect`。

本阶段有界路径读取原`.env.local`两次、四次显式READ ONLY事务、一个真实管理员新逻辑job；登录和页面还有正常认证session写入/查询，不把总SQL计为四读一写。读取整份文件会把其它原秘密短暂带入可信父进程，只转发DATABASE_URL；未读取App PEM、AWS Secret值或原私密包，未调用AWS、签App token、dispatch、领取任务或创建承载资源。这些计数来自受审路径/回执，不是另做提供者日志或全库审计。摘要保持仅证明准确九行和四旧任务的观测结果，不证明所有并发业务或认证表都不变。

两个W6l永久槽均已消费，W6k及旧记录保留。**不得再次Prepare/Start/Inspect、改nonce、复位任务/槽、回滚或自动补偿。** 原[受审风险文件](aws-auto-deployment-platform-w6l-held-request-review.md)与prepared JSON保留历史内容，不直接改写为执行结果。端口/PID退出不等于所有孙进程/内存副本或外部凭据被撤销。50 USD/月仍是目标而非硬cap，既有资源费用继续。

## 唯一下一步

仅为 `job_fc0309dabebc09367f64153f` 复用已安装可信publisher/controller准备Review计划，先形成准确范围和新待审SHA；随后计划SQL、固定私密供给、App token/dispatch/观察及人工environment审批分别按具体新范围授权。Review通过后才准备RunOnce→Inspect，caller源码跨该云验收链保持冻结。

不再登记另一条任务、不重放W5r或W6k/W6l、不重装IAM/Secret、不扩F3c9/身份实验或新执行器，不使用Sites/本地Docker。W6l完成不等于AWS自动部署已端到端验收；整套平台AWS上线仍在最后。
