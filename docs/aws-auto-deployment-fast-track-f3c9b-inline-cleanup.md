# F3c9b：完整 inline 失败补偿、TTL 清理与一次性删除组合

2026-10-12 Winnipeg。当前未安装的协调器候选已完成失败/TTL 分支代码组合；不是 F3 整体完成，也不是云部署/清理验收。本轮 AWS 写入、Lambda 调用、Secret 值读取、Neon 连接/写入均为 **0**。50 USD/月仍是预算目标，不是费用硬上限。

## 完成范围

- 实际 Lambda handler 接入同一协调器内的数据库控制、DDB journal、准确 STANDARD DeleteStack 和只读恢复。没有调用旧 TTL/drain child，也不需把旧 child role 加入 coordinator-only 表冻结例外；原有代码/记录不放宽。
- 失败分支：准确 failed Stack + open/epoch0/受限角色数据库快照 → 永久 DB operation 槽位及 private ownership → 再采集 parent/CFN/DB → 一次失败围栏 SQL → 独立 certified failed zero → 一次授权发行槽位 → **同一 DDB 原子事务**发布旧 schema3 failed marker 和新 schema4 delete authority → 统一删除槽位 → 再采集全部证明 → 一次准确 ARN/CFN Role/token/`STANDARD` 删除。
- TTL 分支：当前完整 PAID 且已到期 → 同样的一次 DB operation 门禁 → 现有 admission drain/cleanup job producer → 真实 certified zero → 同一授权/删除门禁。仍有租户资源或 jobs/steps 时只等待核验，不删除。旧 Worker 继续负责租户销毁，不把排队成功当作零占用。
- 对“完整 PAID 已建成但 provision 发布遗漏”的到期 Cell，编译仅供清理的 metadata predecessor。它**从不写入 provision 或 activation**，不把过期 Cell 补发布为运行许可。部分失败也不会伪造成功 predecessor。
- 数据库 reader 保留历史证书、目录、受限非 owner 和真实 Serializable READ ONLY 解析器。TTL 的原九查询＋四补充查询在同一事务；failed 保留原十四查询，额外同事务检查真实 `pending/running/retry_wait` jobs。新 private brand 阻止旧 parser 的 jobs 覆盖缺口被误当作完整零占用证明。历史 46 文件保持原字节，不静默修改封存 parser。
- 两个固定 Secret 只在清理分支内存读取，准确 ARN/VersionId/`AWSCURRENT`、已登记证书、Neon 用户/同 host/database/TLS 严格绑定；不接受 caller URL/env URL 或新版本 fallback。此处为未来 runtime 代码，本轮没有实际 Secret 值读取。

## 永久槽位及中断语义

在父 key 外新增六个固定 per-Cell key：`db-intent`、`db-receipt`、`issuance-intent`、`delete-authority`、`delete-intent`、`delete-receipt`，均使用 `cell-birth-v4:*:cell:cell-sandbox-1` 的准确键值。没有时间/随机后缀的新槽位或 reset/delete。

SQL、授权发行及删除各自需要成功争槽响应后才产生不可复制的内存 ownership；每次争槽使用独立 UUID，避免同 DDB token 成功回放产生双 owner。ownership 在网络写入前消耗。登记、provision、activation、旧 compensation 和新 workflow 在条件事务中相互排除；失败和 TTL 共用一个 delete 槽位。

SQL 响应丢失可凭独立真实 DB 读证明已提交，不能重发 SQL。发行槽位已占但 authority 未发布时仅 Inspect，不重发或补齐。删除槽位已占时只做准确 ARN 的 CFN 回读，不再调用 DeleteStack。首次删除返回后可尝试一次 terminal receipt 写；恢复轮次仅返回独立观察，不补写未保存 receipt。已保存 receipt 原样重放。父执行窗口过期后仍可只读恢复，不重启 Secret/Neon 或 actuator。

Stack 消失不等于本次删除成功：CFN 回读必须两次稳定、完整分页、准确 ARN，最新 Stack event 时间/token 匹配；只有匹配 `DELETE_COMPLETE` 可证明已完成。`ValidationError`/空 Describe 单独不能证明成功，其他网络/AccessDenied 也不当作缺失。不使用名称 fallback、FORCE_DELETE、retain/skip 或自动重试。[AWS DeleteStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeleteStack.html)

## 候选权限与风险

更新的是**未安装** parent boundary/inline 数据，canonical UTF-8 **6037 字节**。新增准确两 Secret 固定版本读取、准确 Key 经 Secrets Manager/SecretARN encryption context 解密，以及六个准确 workflow keys；没有 InvokeFunction、parent/activation Put、DDB Update/Delete、IAM/code 修改或创建/更新 Cell 权限。新 scope 明确 inline TTL 和完整未发布 Cell 的清理，不能沿用 F3c9a 的旧审批/包摘要。

提交前已核对 AWS 官方条件键：GetSecretValue 支持 VersionId/VersionStage；KMS 使用 ViaService、CallerAccount 和准确 SecretARN context，SDK 请求/回读再严格检查固定版本。本轮未实际调用这些允许路径，不把官方条件语义当作本账号有效权限证明。[Secrets Manager 条件键](https://docs.aws.amazon.com/service-authorization/latest/reference/list_secretsmanager.html)、[KMS 加密上下文](https://docs.aws.amazon.com/secretsmanager/latest/userguide/security-encryption.html)。

旧表全写冻结、≤15分钟 Source 宽写窗口、runtime 等截止方案保留，尚未安装。实际 data-plane allow/deny、SQL 角色能力及云延迟仍未证明；metadata 最终一致、IAM/代码/DB/CFN 不跨服务 CAS、管理员并发/传播差异仍可能使执行失效。发行 authority 有五分钟有效期，parent 有原四小时上限；慢调用或槽位抢占会留下收费资源，需要人工核验和 fresh 独立范围，不自动补偿删除/回滚。运行时不能保证总费用≤50 USD 或 JS 内存秘密即时擦除。

## 验证及当前事实

- 13 项本切片 + 10 parent + 11 F3c8 + 12 admission 相邻测试，**46 项通过**；typecheck、定向 lint 0 warning、两 CLI syntax 通过。SQL/SDK 夹具不是真实云/Neon写验收；未重复 PG 集群、旧 generation、DNS、镜像或费用控制流程。
- 新候选 ZIP 可重复构建、解压字节核对及无外部 npm 依赖启动通过；invalid event 在凭据前拒绝。包 429713 字节，没有上传/Invoke。首次沙箱仅因私有目录 `realpath EPERM` 失败，尚未创建输出；经私有目录访问授权重跑本地构建成功。
- `F:/ChatGPT_workshop/techlong-f3c9b-parent-bundle-20261012-r1/`：bundle `6ea5a688fbd2b3b9026a4a790c42a48be5a75b2e4c1aa148fc16faae23157bd9`；ZIP `405e6654b9c8ca0c80536f5fcf8caa910e00246ce497c2dedc81c9f63f3be35f`；构建 report `db0cd34eded1f75c87f514e03230172c3e27a07f549da46709c2e1d9227e2193`。旧 F3c9a 包保留但不得用于完整 root 安装。
- **20:53:31.589 UTC / Winnipeg 15:53:31.589**：准确 Source 身份有效；原 TableId `58c851f4-5b8e-45ce-8933-05c33b17fb21` ACTIVE/key schema 准确；父 key 及六 workflow key 两独立事务均 ABSENT；新 coordinator role/function 与 resource policy 本轮读均 ABSENT。旧 Cell/Neon/DNS/费用状态本轮不刷新，不当作新证据。
- `F:/ChatGPT_workshop/techlong-f3c9b-parent-prestate-20261012-r1/parent-prestate-review.json` SHA `c863d4c9098d6e6179ee461d4e905cc9b26dfae87de20a0fe117a56c2cc4e230`；58 文件 code SHA `6675ca6570ed4fcca1521fcd2ea7361f97db94b746627dadbf414be02f26b697`，原46 `49719dc5...`/package-lock 不变；F3c9a 53 binding 为历史记录保留，不宣称其中七个新候选文件未改。

## 下一切片

F3c9c 集中完成 Source registrar/短窗口策略安装流程和独立实际 allow/deny 验收计划，准备准确 IAM/函数/表策略/Neon 权限与 schema 安装范围。真实角色 ID、Function Revision、完整 DB 能力及 exact RESERVED 才能生成 executable parent registration review；目前未生成可执行安装或部署清单。不提前消耗 parent 槽位，不创建 RESERVED/付费 Cell，不借旧 drain/marker 授权。实际新增权限、DB 写/部署/删除仍按具体 fresh SHA 单独批准。
