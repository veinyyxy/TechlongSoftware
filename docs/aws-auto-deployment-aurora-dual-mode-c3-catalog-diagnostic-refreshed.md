# D002 C3e刷新清单：Source恢复，仅重新准备只读诊断

2026-10-14 America/Winnipeg。用户回复“Source 已刷新”后，只运行新Review和独立metadata，没有重跑[上次停止的Run](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic-stopped.md)，SQL/写入/槽消费仍0。旧d82c清单、停止回执和全部历史记录保留。

## 当前唯一待审SHA

`872e302703b3e09bcbf9a439b3d6eef818e5643ead4872fee523a81ab7c7e5cf`

生成：2026-10-14 14:02:09.481 UTC / Winnipeg09:02:09.481 CDT；截止：**2026-10-14 20:02:09.481 UTC / Winnipeg15:02:09.481 CDT**。过期不执行，不自动延长。

私有清单 `F:/ChatGPT_workshop/techlong-d002-express-c3-catalog-review-20261014-r2/manifest.json`。Review5次直接metadata通过；独立新进程 `...-c3-catalog-metadata-20261014-r2/facts.json` 于14:02:53.866 UTC / Winnipeg09:02:53.866 CDT另5次只读通过，facts字节SHA `242544ef315011317ef0149b294432bdfc7e9a9268aca417ef8b64a9443f2dde`。

除observedAt外，两事实集的Source、准确cluster/writer、FREE-ACTIVE、准确postgres连接模拟一致。新旧清单除时间、facts和manifest SHA外的全部字段相同；226源码/原224/212/183pins、2工具、code binding `91a2c8e1ce994e607a709ac90b2a827f0bd6cb9cfcba67e6eff5f84b527d38db` 和history `783a896da1af5d3379c33c93e5fb776a1913a6ff66b2e840d121dafeae0b1b96`不变。上次stopped字节SHA `f98307951c03c5c571935a78b1abe0d990d5824f6988e2ca718b1a5b3e6d6c3c`独立核对仍匹配，新永久槽仍不存在。

## 具体范围和风险保持

仅允许一次准确管理/租户目录只读诊断：最多2个物理连接、9次固定query、120秒pair group、30秒connect、直接metadata最多9次，内存Source snapshot至少余5分钟并验证同份STS。绑定原准确Express cluster及DB/OID16459、postgres owner16410、NOLOGIN app16456、guard缺席和原nonce/ownership。

复用原未改PG17目录SQL/校验器及严格V4 owner policy，报告17组解释谓词；解释与真实原校验必须一致。业务表查询/SQL结构和权限写/云资源写/Secret读取0，不恢复schema或迁移，不重建DB/guard，不安装权限、启用运行时、部署ECS或回F3c9。槽在连接前永久消费，成功或失败均不自动重试/补齐/复位。

[原完整范围和九项风险](./aws-auto-deployment-aurora-dual-mode-c3-catalog-diagnostic.md)全部适用：管理员而非新最小权限边界、非原子/并发、提供者日志、当前空目录不能重建原未提交失败状态、目录查询可能失败、非零费用和50USD目标非硬cap、永久槽不自动重试，以及观察不等于PG17恢复/隔离/runtime/ready验收。没有扩大权限或写范围。

本轮无源码/镜像/原归档变化，沿用已通过的9个针对性检查/types/lint和实际无效SHA负例，不重复离线检查、native编译、镜像构建或ECR发布。只保存新清单和双仓交接；Backend用户`.vscode/settings.json`保留。

## 唯一继续点

取得本新SHA的具体确认后，在有效窗口内单次Run；Source刷新本身不授权诊断重试。旧d82c/停止目录保留，不重用输出目录、复位槽或自动继续SQL。只读目录观察后再收敛保留准确库的窄恢复候选；后继写/权限/Secret/ECS仍单独审阅。[紧凑继续摘要](../ops/aws-sandbox/reviews/aurora-express-c3e-catalog-diagnostic.prepared.json)。
