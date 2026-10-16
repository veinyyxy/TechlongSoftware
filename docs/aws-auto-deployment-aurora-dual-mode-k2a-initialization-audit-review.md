# K2a 最终待审：只读判定 HTTP500 后的实际初始化状态

状态：**现场只读 Review 通过，尚未连接 Aurora，也没有执行授权。** 本阶段只解决原 provision HTTP500 后的实际状态，不扩展 F3c9，不重建资源，不先做平台 job/plan 协调。

## 清单、窗口与已完成核验

- Manifest SHA：`e5610e470f12ce98d274b7ad605d5d3492542acfd874a4f8ae4d1698e47b18b1`。
- 原件：`F:/ChatGPT_workshop/techlong-express-k2a-review-20261016-r1/manifest.json`；19 个代码/风险文件、18 项历史原件及 Node v22.19.0 完整绑定。
- 生成：Winnipeg **2026-10-15 23:46:21.931 CDT**（UTC 2026-10-16 04:46:21.931）。入场必须严格早于 **2026-10-16 01:46:21.931 CDT**（UTC 06:46:21.931）。过期只核对，不执行旧清单；未消费槽可另准备 fresh SHA，消费后不能靠换 SHA 重试。
- K1 workload 仍固定 **2026-10-16 07:04:28.726 CDT** 到期，原 Janitor 保持启用。K2a 不续期，也不重新开放已消费的 K1 创建许可。
- Review 实际 35 SDK + 11 CLI + 1 Neon 只读事务通过，准确新栈 UUID `f71252c0-c917-11f1-8148-02ff648cb917`、task definition:2、实际新镜像 `sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e` 及健康目标保持；旧 Cell、IAM、固定 Secret 版本元数据、DNS、DDB 和平台 job/lease/plan/artifact/generation/epoch 均保持。
- 此次 Aurora 连接、DB token 签发、Secret 值/旧私密包读取、应用请求、云/平台/业务写、永久槽消费均 **0**。SQL 业务状态仍未知，不能从健康目标推断初始化成功。
- 8 项新测试 + 8 项相邻测试、typecheck、四个新文件的定向 ESLint、三脚本语法检查均通过。本地 Check 验证 10 条固定 SELECT、14 次正常 query 和 5 个公共 ATS 根，不连接数据库。新进程独立回读 manifest canonical hash、19 代码/风险原件、18 历史原件及空槽均通过。证据见[非秘密摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-k2a-initialization-audit.prepared.json)。

## 唯一申请范围

使用已有 Source/IAM DB auth，以已有高权限管理用户 `postgres`，经 ATS 主机名验证 TLS，只对 `tenant_a0da1748bc4d5419_db` / OID16459 建立**一次连接、一个 SERIALIZABLE READ ONLY 事务**。准确 endpoint、应用 role/OID、引擎及原冻结目录/ACL必须匹配。

固定 **10 SELECT，正常14次 query**；错误最多一次额外 ROLLBACK。前四项目录/身份通过后才读状态。仅在内存比较固定目录、73 表计数、原 ownership/default entitlement/store 元数据、13 项 readiness 布尔值及原幂等键/receipt/owner/profile/audit计数与布尔值；只保存计数、布尔和摘要。原八条查询会将明确列出的目录/entitlement/store字段读入内存，不能声称所有字段都只在服务端比较；具体字段见[完整风险](aws-auto-deployment-aurora-dual-mode-k2a-initialization-audit-risk.md)。

Run 前后、独立 Inspect 各复用一组 35 SDK + 11 CLI + 1 Neon 只读元数据核验；SQL入口另一次 STS 确认当前 Source。Inspect **只核对原 SQL receipt 完整性并重读承载元数据，不建立第二次 Aurora 连接**，不是新的数据库快照。Source 自动刷新/签名使用既有 AWS Login，不增加 IAM，不读取 Secret 值，不加载 JWT/mTLS/付款私密包，不发任何应用 HTTP。

数据库结果仅允许：原始未初始化 / 原完整提交候选仍待认证控制核验 / 差异或部分状态停止。全部 `provisionAuthorized=false`、`platformReady=false`。只有明确未初始化后，才能另准备单次 provision；已提交只能另准备只读控制核验及 reconcile，不能再 POST。

## 批准前必须接受

[固定完整风险 v1](aws-auto-deployment-aurora-dual-mode-k2a-initialization-audit-risk.md) 由清单绑定（raw SHA `c413406657d72c4936e127986da8dc3d968457de513b6c9cb0f4daf4f58a0f30`），包括 postgres 管理能力暴露、提供者日志/内存、非零 ACU/I/O/连接费用、只读并不等于底层零磁盘写、AWS/Neon/SQL 非跨服务 CAS、并发与序列化失败、保存/响应不明，以及固定永久槽消费后不自动复位、重连、补齐或重试。50USD/月为目标，不是费用 cap；既有资源继续收费。

不改 IAM、Secret、DNS、DDB、Neon/业务数据、job/lease/plan/epoch，不重发 POST、不标 ready、不延长或重建 workload。原 17 槽及所有旧证据保留。

建议确认文本（尚未由用户发送，文档提交不构成授权）：

> 我确认按清单 `e5610e470f12ce98d274b7ad605d5d3492542acfd874a4f8ae4d1698e47b18b1` 执行 K2a：仅一次 postgres Aurora TLS 只读连接、10 SELECT / 14 正常 query，随后独立元数据与原 receipt 核验；不读取 Secret 值或旧私密包、不 POST、不改数据/权限/平台状态、不续期，并接受完整风险及永久槽不自动复位或重试。

## 获准后的唯一继续命令

先验证窗口、固定槽仍空、源码/历史绑定不变。只有收到上面范围的新明确批准，才运行：

```powershell
node ops/aws-sandbox/scripts/review-express-initialization-audit-v1.mjs --mode Run --manifest F:/ChatGPT_workshop/techlong-express-k2a-review-20261016-r1/manifest.json --approved-sha e5610e470f12ce98d274b7ad605d5d3492542acfd874a4f8ae4d1698e47b18b1 --output F:/ChatGPT_workshop/techlong-express-k2a-run-20261016-r1
```

成功保存原 SQL receipt/分类后另起进程：

```powershell
node ops/aws-sandbox/scripts/review-express-initialization-audit-v1.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-express-k2a-review-20261016-r1/manifest.json --approved-sha e5610e470f12ce98d274b7ad605d5d3492542acfd874a4f8ae4d1698e47b18b1 --run F:/ChatGPT_workshop/techlong-express-k2a-run-20261016-r1 --output F:/ChatGPT_workshop/techlong-express-k2a-inspect-20261016-r1
```

失败不再次 Run；保留槽和回执。若只在后置元数据阶段失败且 SQL receipt/分类已保存，可用无第二次 SQL 的独立 Inspect 核对，不能将未核实的结果写成 ready。剩余平台协调与认证 API 验收均未获本清单授权。
