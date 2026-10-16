# K3a 已过期且承载已删除：停止，不刷新原范围

用户对清单`41ab184c73a04dc90ee70da21edf04653b65d27d99472cd58606607f027dcde6`回复“确认，但是清单过期了”。Winnipeg **2026-10-16 07:55:02 CDT / UTC12:55:02**核对时，原公开检查清单06:51:04.661 CDT及workload固定07:04:28.726 CDT均已过期。因此不能沿用确认发送GET、仅换SHA延长窗口或续期云资源。

## 当前实证

**07:55:49.258 CDT / UTC12:55:49.258**，一次Source STS及三次CFN只读查询完成：

- 准确workload栈`.../techlong-sandbox-tenant-9c5ee9e64509dcad/f71252c0-c917-11f1-8148-02ff648cb917`为 **DELETE_COMPLETE**；七条资源记录均DELETE_COMPLETE，无分页。
- CFN `DeletionTime`字段为UTC12:08:38.748；七资源LastUpdated在12:16:34.674–12:16:38.314之间。这里只报告提供者字段，**不把DeletionTime当作完成时刻，也不根据时间自动归因给Janitor**；本轮未查询CloudTrail或独立核对所有物理资源。
- 准确父Cell栈`.../techlong-sandbox-cell-sandbox-1/b64a20f0-c8a0-11f1-8aeb-02f47cc20dc1`仍为 **CREATE_COMPLETE**。未核对其全部物理现状或其它残留资源/账单，不能宣称全系统停费。
- K3a永久槽不存在，只有原review目录；**未运行Run、未刷新清单、0公网GET、0私密/Secret读取、0 SQL连接、0云或数据库写**。没有删除、续期、重建或初始化。

原始脱敏投影与准确资源ID见[停止观察](../ops/aws-sandbox/reviews/aurora-dual-mode-k3a-public-smoke.expired.json)。Source身份正常，无需此时要求刷新；本轮不额外测试或调用应用。

## 保留事实与下一选择

K2b初始化及K2c平台ready的独立证明仍是有效历史，不因workload删除而重做provision。本轮未读取Neon/DDB，**不声称当前平台已自动同步终态，也不写destroyed**。Aurora/Secret等不在被删除的workload七资源内，但本轮没有重新读它们的状态或值。

原K3a入口保持固定期限，不修改代码/risk/原prepared capsule来绕过失效；原确认不能批准恢复收费资源。旧review、槽及所有历史保留。

需要用户选择方向：

1. **继续公网验收**：先只读盘点当前剩余Cell/库/角色/Secret元数据及平台坐标，再准备独立workload-only恢复/明确新承载期限的具体清单。实际创建及其后公开检查另审；保留已初始化数据库，不重新provision，不自动复用旧恢复槽。
2. **准备资源退出**：转K3b只读残留/依赖盘点，保留数据库和证据，准备准确退出清单。实际父Cell/DNS/Secret/数据库/权限/平台状态等变更各按具体范围批准；不因tag过期就批量删除。

两条都不自动扩展F3c9/Grant/generation，不把“确认过期清单”变成新部署或删除授权。50 USD/月仍是目标非cap，已有资源/残留可能继续产生费用。
