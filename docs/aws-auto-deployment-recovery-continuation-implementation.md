# 两项主线接线的实现记录（代码阶段）

2026-10-26。仅实现已确定的两项必要接线；未开生产窗口，未执行AWS/SQL读取或写入、私密配置读取、计划登记、dispatch或永久槽消费。旧W9p生产执行与全部原件保留，历史proposal及其机器清单不修改。CI、代码入口存在不等于部署或业务验收通过。

## 已实现

1. `ops/platform-recovery-launch-v1/request-evidence.mjs`固定原请求seal、intent及批准/source/core/basis/job/事务时间。准备与执行重新核验12份原件摘要，operator清单绑定该证据；`verifyBaseline`使用原事务时间1792970812292，不再使用晚3036ms的created_at。原30秒、payload和保护摘要约束未放宽。已保存真实状态回放完整通过，不重新连接生产或重算基准。
2. `ops/platform-recovery-continuation-v1/`只接受真实旧revision9/source806/原租约/token/既有11资源。复用原严格AWS读取和更新器，仅换source/lease及Service所需引用；镜像71e268…、角色/三个Secret版本/网络/DNS/历史费用标签保持。独立新Run/Inspect槽，旧W9p槽永不复位。未来更新前另加只读Neon准入校验，必须在新执行SHA中批准。Review准备已接收该继续入口的真实manifest/intent/独立Inspect原件，不能混用旧Inspect outcome或source。

本机验证：141项相关测试全部通过（含延迟插入、原件篡改、revision漂移、只读默认、单次失败不补偿、原件衔接）；`tsc --noEmit --incremental false`及限定lint通过。真实历史AWS/Neon材料回放通过，生产连接0；97项云闭包仍为30a7cdf74b50563afbc73f4a6b62661962d83127c3e409b627d11e5b3b91e374。无AWS身份的准确main CI由既有`platform-recovery-hosting-candidate.yml`执行，最终run/source另存本地完成回执，不把未完成CI记为成功。

## 唯一下一步

1. 代码提交到main，准确CI成功。旧20:17UTC快照已超过2小时，不可重记时间或用于生成执行SHA。
2. 另获一次限定只读允许后，运行新入口`Snapshot`：固定Source IAM身份STS最多1次、AWS元数据最多65次，不读Secret值/PEM/.env、不连数据库、不消费槽或写云。新目录保留旧快照。
3. `PrepareSaved`用新快照、原封存证据、准确CI及当前clean main生成新manifest/SHA，不开租约、不读配置内容或连生产。实际`RunReviewed`和独立`Inspect`必须再批准准确SHA及[完整风险](aws-auto-deployment-recovery-continuation-review.md)，并收到三分钟内新的在线40分钟确认。
4. 同一main冻结期间，先单次source/lease更新并独立Inspect，再各自审批`PublishReview`/`AdvanceReview`；用户仍亲自完成平台批准和GitHub环境批准。RunOnce/独立云Inspect沿用既有准确入口，不新增任务、执行器、IAM、镜像或UI功能。所有实际后续动作按范围分别审批，不能把代码许可当作部署许可。

## 命令索引（不是执行授权）

```powershell
node --experimental-strip-types ops/platform-recovery-continuation-v1/local.mjs --check
node --experimental-strip-types ops/platform-recovery-continuation-v1/local.mjs --mode Snapshot --output F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-<新快照后缀>
node --experimental-strip-types ops/platform-recovery-continuation-v1/local.mjs --mode PrepareSaved --snapshot F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-<新快照后缀>/snapshot.json --ci-run <准确CI> --output F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-<新准备后缀>
node --experimental-strip-types ops/platform-recovery-continuation-v1/local.mjs --mode RunReviewed --manifest F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-<新准备后缀>/manifest.json --approved-sha <新manifestSha256> --ready-at <新的用户在线确认UTC> --output F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-<新运行后缀>
node --experimental-strip-types ops/platform-recovery-continuation-v1/local.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-<新准备后缀>/manifest.json --approved-sha <同一新manifestSha256> --output F:/ChatGPT_workshop/techlong-recovery-hosting-continuation-<新独立核验后缀>
```

原业务basis于2026-10-27T18:47:57.695Z（温尼伯10月27日13:47:57）截止，不因中断/准备而延长。若不足以完成既定流程则停止并另审，不自动新建held任务。过期控制租约不停止普通Web或费用；50USD是预算目标不是硬封顶，清理另批。
