# F3c9g：最终运行包和异步配置已安装，独立验收通过

2026-10-12 Winnipeg。用户明确确认清单 `0cea566b526ad14d39e426c9479aec947b4afabc694407495d25c9d0b28d6538`、最多两写和完整风险后，原95绑定Run仅执行一次，**代码及async两次提交均收到响应，最终回读和独立新进程双回读均通过**。原deny-all boundary、空角色策略、reserved concurrency0、七天日志及其它完整锁定不变量保持。没有新增IAM、Invoke、Secret值读取、Neon连接/写入、authority/表policy写入、parent登记、RESERVED或付费Cell创建；没有启用SaaS运行时。

## 实际结果

| 项目 | 安装并独立核验的值 |
| --- | --- |
| 同一函数 | `arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3` 的 `$LATEST` |
| 最终包 | F3c9f r3，ZIP SHA `b53ba821ce2619b90c4d941e5bc4969b131d4e9e777f3498a75320deca136e47`，432218 bytes |
| AWS CodeSha256 | `tTuoIc4mGbkMTZQeW8SWmxMdTp53fzSYp1Mg3soTbkc=` |
| bundle SHA | `71f31e586f2eeb737c158b917cf799595f76803f8fe725476e0b6ed47a86f25c`，实际运行自哈希尚未调用验证 |
| 稳定完成Revision | `4a5f64bb-f47e-4e56-a468-1364f4381767` |
| 状态/应用配置 | Active/Successful，Node22/x86_64/256MB/120s、`cell-birth-coordinator-v4.handler`；完整应用配置及未知字段的不变量保持 |
| async | 最大事件年龄60秒、函数错误重试0、OnSuccess/OnFailure均空，无destination |
| IAM/并发 | 原RoleId `AROAV3GNMXTZBYYFRN63O`、Lambda-only trust、boundary仅v1显式Deny全部动作/资源、无inline/attached，reserved concurrency0 |
| 其它门禁 | 原bootstrap标签/log7、准确表ACTIVE/资源policy未读到、parent/所有相关槽与Cell缺失、无URL/resource policy/alias/发布版本/事件源映射；默认bus target缺失，不推广全部bus |

RuntimeManagement仍Auto；AWS托管Node22 runtime-version ARN `fcbc5912...`本次未改变，没有实际runtime Error。完成Revision是稳定回读的值；响应中Revision未持久化，因此不声称响应与完成值相同或不同。

## 时间及证据

- 有效窗口截至 **2026-10-13 04:12:38.945 UTC / Winnipeg10月12日23:12:38.945**。Run在窗口内，原95/最终48/原70及ZIP/旧槽均通过重新校验，Source身份和真实前态未漂移。
- **03:31:40.210 UTC / Winnipeg22:31:40.210**，新固定槽wx+flush消费；代码更新使用原Revision `7817b5a5...`条件、Publish=false，随后read-only readiness和完整前态复核，再提交同一`$LATEST` async配置一次。每项attempt和response-received marker均保存。
- **03:32:18.062 UTC / Winnipeg22:32:18.062**，Run最终metadata通过，两写入口尝试2次，无重试、回滚、补齐、删除或复位。
- **03:33:21.179 UTC / Winnipeg22:33:21.179**，另一个独立进程做两次完整只读集合，`LOCKED_CODE_ASYNC_INDEPENDENTLY_VERIFIED`；与Run最终完整snapshot/hash相同，固定槽准确绑定本次SHA。

| 回执/绑定 | SHA |
| --- | --- |
| 95代码 | `3d6b3e7770d6074be0f3594fdd73b485a959ee2540732dbd29169c0bb27f32be`，未修改 |
| Run报告 | `7c0888a0d847c8431de7a55dca77136f067f5ce43ac3f2d18d7b321cc605c03e` |
| 独立Inspect报告 | `4c544354d3502d9f7b0119b972f62e6197f0d6b4d4bad4489c31269612920b30` |
| 最终完整snapshot | `5e758fe60104f0baa813f0742115b81a09b3c618a87d2a304e7514f53d3e0ab0` |
| 原完整锁定不变量 | `7da9d1e9b5e35a908e6433496918192722fd4acf4c4a5e6cf3d4f47897731d6e`，保持 |
| 新async状态 | `2b999acc6361e0032ac78cc3e9b1ef9b40069f50fd7047aba1864fcf48e4002f` |
| 已消费新永久槽 | `fe99f83387cc8f4ab3449276d2573c04442224dd0c5e3c33f1e07f1d9e5fed58` |

私有Run：`F:/ChatGPT_workshop/techlong-f3c9g-locked-update-20261012-r5-run/`；独立验收：同前缀`-independent-after-inspect/`；固定槽 `techlong-f3c9g-locked-function-update.permanent-slot.json`。旧bootstrap/数据库消费槽、原ZIP、r1–r4停止证据及r5批准前态均保留。**即使原批准窗口尚未结束，也不能重放Run、换目录重试、复位槽、自动恢复旧代码或修改配置；以后只能Inspect，新的变更必须另审。**

沿用原25定向测试/type/lint/syntax结果，本次原95全部不变，因此不重复离线模拟、重建包或镜像；本轮验收依据实际云metadata。AWS直接写2、IAM写/Invoke/Secret值/Neon/表/Cell写0。没有临时新grant需要撤销，本次未更改原锁定权限，所有回读均观察到保持；不能将此推广为实际effective deny、并发完全排除或受限角色行为已证明。

## 下一继续位置

F3c9g安装小阶段完成，但metadata不是函数实际运行、自身Secret/TLS reader认证、writer/失败入口、TTL/云删除或自动部署闭环验收；实际有限allow-deny gate未调用，runtime/F3仍未完成。async age60/retry0也不承诺exactly-once或精确销毁，50 USD/月仍是目标而非硬cap；[原完整风险](./aws-auto-deployment-fast-track-f3c9g-locked-update-review.md)保留。

下一切片 **F3c9h：准备准确无付费资源的RESERVED身份栈及其fresh创建范围**，先只读核对现有CFN执行角色/原表及材料基础，复用已冻结r3包和此真实完成Revision；不提前安装runtime权限、登记parent、开并发或ARMED/PAID。该栈的真实UUID ARN用于后续精确IAM、table短窗口和Source parent绑定，不能编造ARN或登记后再换包。实际CFN创建、IAM/table更新、parent登记、短暂concurrency gate与付费Cell各按准确资源和fresh SHA另批，不重复旧generation权限探针；仅遇到真实凭据失败才请求刷新。
