# D2-5：真实证据接入与可信版本登记入口

2026-11-13，America/Winnipeg。范围：已有 ECR 路线的具体接线，不新增部署引擎、工作流、数据库对象或长期角色。用户选择**先只完成代码与 CI**；本轮不运行真实采集、不登记真实版本，不读取配置/凭据或恢复收费环境。

## 一条明确的交付路径

`collect → prepare → 准确 SHA 批准 → register（含独立连接核验）`

统一入口：[scripts/instance-release-import.ts](../scripts/instance-release-import.ts)。默认和 `check` 只报告关闭状态，不加载认证、连接数据库或调用 AWS/GitHub。其余模式都必须显式调用，私有输入/输出限制在工程 `.local-secrets` 下；目录/结果 create-only，失败保留，不清理、复位或重试。未把该命令接入日常运行工作流。

### 1. collect：真实来源只读采集，未来另审

输入一份 `techlong/catalog-source-read/v1` 范围 JSON、其规范 JSON SHA256，以及尚不存在的私有输出目录。范围固定后端仓库 `veinyyxy/SpeedFeast_Backend_main`、账号 `402010193138`、区域 `ca-central-1` 和 `techlong-sandbox-speedfeast` 仓库，显式声明 Node/scanner 版本及 scanner 归档 SHA；读取截止最多五小时，不修改来源原有效期。

[具体读取器](../ops/releases/import-source.ts)按以下顺序执行：

1. 固定 Source profile / 官方 STS endpoint 核对准确 IAM 用户。失败不再获取 GitHub 凭据。
2. 延迟调用既有 Git credential helper，仅内存使用认证。一次列出最新十条成功 main 构建，从正常 `backend-image-candidate.yml` 选择第一个原 attempt1；一次读取该 run 的 artifact 元数据，不翻页。
3. 仅接受同源码/同 run 的未过期 `checked-app-{commit}-{run}-1`。核对 ECR 仓库严格 `IMMUTABLE`、准确 `app-sha{commit}-r{run}-a1` 的已发布镜像；无匹配就停，不自动构建/晋升、找旧版本或下载大文件。
4. 下载一份原 ZIP（最多 500MiB），认证只发 GitHub 官方 API；302 后仅允许指定官方 blob host，绝不转发 GitHub Authorization 或保存签名 URL。流式校验原 ZIP 大小/SHA，再复用固定四文件解包和 receipt/扫描验证器。
5. 由准确 digest 回读原始 ECR manifest，必要时回读一个 amd64 子 manifest；核对原始字节、registry/config digest 关系。最多 STS1、ECR5、GitHub GET12、ZIP1，无应用级重试。

保存原 run/artifact/tag 元数据、原 ZIP/四文件和 `source-evidence.json`；仅本机私有目录，不提交 GitHub。技术结果为 `SOURCE_AND_ECR_VERIFIED_PRODUCT_BINDING_PENDING`，明确 `productBound=false/catalogWritten=false`，**不编造产品 ID、版本或兼容声明**。artifact、扫描数据库及五小时事实中先到期者仍约束后继准备，不因晚准备重新计时。

### 2. prepare：离线绑定产品与准确登记材料

输入采集原件、显式产品策略 JSON 和新私有清单文件；不获取凭据或联网。策略必须指定真实 productId/version、仓库 ID、imageRepository，以及 Express/Full、schema/API/端口、无迁移/启动写兼容性；来源/run/扫描字段必须与已采集原件一致，不从镜像“能启动”推定兼容。

[纯准备器](../ops/releases/import-review.ts)重建候选与 SoftwareRelease，绑定原件字节 SHA、登记代码文件指纹、准确目标/权限/查询上限、风险和原截止时间，输出新的规范 JSON SHA256。清单不启用 runtime，不是自动执行许可；缺真实原件或产品策略时不生成虚假生产批准。

### 3. register：仅另批后运行，一条目录记录

输入原清单与准确批准 SHA；先核对代码、原件和重新推导的 release/目标/上限，再创建单次本地 attempt，随后才读取一次 `.env.local` 的既有 `DATABASE_URL`。不生成密码、创建 LOGIN/Secret/IAM，也不取得 GitHub/AWS 凭据。

固定现有 Neon `neondb` / `neondb_owner`，验证 TLS，校验已安装 schema/table OID `237571/237572`、owner/管理员能力及初始 SET/INHERIT 关闭。目标 OID 来自既有已提交安装记录；不匹配即停止，不自动重建或重新盘点。

[目录事务](../ops/releases/catalog-transaction.ts)复用原 [不可变 INSERT](../lib/deployments/releases/catalog.ts)：

- 一条连接内 BEGIN，事务内临时允许安装者切换 owner；仅提交一次参数化目录 INSERT。相同版本同字节可确认既存，不同来源/digest/兼容声明或已撤销版本拒绝，绝不 UPDATE/DELETE。
- 提交前关闭 owner SET，提交后核对有效 SET/INHERIT 仍关闭；创建者 ADMIN 管理能力保留，不声称消除了管理员权限。
- 关闭 writer，再用独立第二条连接核对准确完整目录行；该连接也需要同样的事务内临时 owner 授权/关闭。**独立核验的 SELECT 不改目录，但整个核验事务含角色成员写，不是纯 READ ONLY 事务。** 这是未来登记批准必须包含的副作用。
- 即使 COMMIT ACK 不明，只允许那一次预先批准的独立核验，不重发 INSERT、不把回读成功自动改写成写 ACK 成功。记录 UNKNOWN/失败，不回滚补偿、补齐或删除本地槽。

总上限：配置1、TLS连接2、SQL提交64、目录 INSERT提交1/最多1行；每个事务 statement15秒/锁等待2秒，整次最多10分钟且不超过原事实截止。AWS/GitHub/Secret值/PEM读取0，业务/实例/请求行写0。连接读取全配置进入内存，owner权限较宽、提供者/SQL日志、跨连接非原子/并发及提交不明风险必须实际批准；代码有边界不等于不存在管理员或并发风险。

## 使用形式（仅说明，不是本轮执行指令）

```text
node --experimental-strip-types scripts/instance-release-import.ts check
node --experimental-strip-types scripts/instance-release-import.ts collect <私有范围.json> <批准范围SHA> <新私有目录>
node --experimental-strip-types scripts/instance-release-import.ts prepare <source-evidence.json> <私有产品策略.json> <新私有登记清单.json>
node --experimental-strip-types scripts/instance-release-import.ts register <私有登记清单.json> <准确批准SHA>
```

现阶段没有填入真实 productId/version、取得新产物或生成登记批准，不复制旧固定 sandbox 快照充当新来源。未来采集和数据库写仍分别按准确范围批准；运行角色不新增表 DML。登记成功后才供已有 D2-4 的 releaseId 选择使用，停止环境照旧拒绝更新，不隐式恢复。

## 验证与停止点

既有测试增加8项：真实适配器的合成官方响应、固定身份失败前不取凭据、无合格来源不下载/回退、签名下载隔离与原字节、API/计数边界、显式产品绑定/原有效期、实际 CLI 关闭入口、事务授权关闭及丢 ACK 不重放。原 Linux Python ZIP 实测保留。

既有 PG16 CI 将目录测试改为真正的非超级用户 LOGIN（CREATEROLE、初始 owner SET/INHERIT=false）执行写入，再由新 LOGIN 连接独立核验，检查冲突/撤销及收尾权限；不再用管理员 `SET ROLE owner` 代替安装者可行性证明。本地没有隔离 PG 时明确 skip；只有准确 Linux CI 原生日志通过才记为该路径实测，不等于 Neon 生产安装验证。

本轮只完成代码、离线回归、普通无 AWS CI 与文档。**真实采集/真实登记仍未执行；同审批自动晋升仍未实现，但已确立为这项底座之后的需求，不作为“可选”跳过。** 不扩临时工具/UI或重做业务测试，不进入 D2-6 实际更新。
