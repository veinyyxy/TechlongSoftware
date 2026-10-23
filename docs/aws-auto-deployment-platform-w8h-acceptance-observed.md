# W8h：托管控制读取链路与有限认证验收通过

结果：`HOSTED_CONTROL_READ_PATH_AND_BOUNDED_AUTH_FLOW_VERIFIED_NO_DISPATCH`。本轮证明新承载的公网TLS/登录门禁、真实管理员登录、托管控制器专用Neon读取路径和浏览器退出门禁；**没有验证App私钥匹配/签名、真实GitHub调度或整套系统生产就绪**。

准确目标为W8g新栈UUID `c4bf36b0-cf13-11f1-b94e-06ffda9fc5c7`，入口 `https://console.sandbox.techlong.cloud`。用户明确批准[本轮有限范围及风险](aws-auto-deployment-platform-w8h-bounded-acceptance.md)，不是从登录刷新或旧部署批准推断。没有云写、重启、续租、IAM/Secret修改、任务/计划创建或批准/观察/调度。

## 实际证据

2026-10-23 14:24:48 CDT，5项AWS元数据读取核对Source、新准确栈CREATE_COMPLETE、原租约、准确ALB/DNS绑定和ECS desired/running1、pending0、deployment完成。

随后仅3次独立诊断GET，无Cookie/Authorization、不跟随重定向，TLS1.3证书链/主机名验证通过，HSTS300、无Set-Cookie：

| 路径 | 实际结果 |
| --- | --- |
| `/api/health` | 14:24:49 HTTP200；body167字节及hash保存，JSON语义未由本次诊断正确投影 |
| `/login` | 14:25:46 HTTP200，登录表单存在 |
| `/admin` | 14:25:46 HTTP307，同源跳转/login |

第一诊断误把 `apiSuccess` 的 `data.status` 当成顶层 `status`，因而保存了 `health:{}` 和 `HTTP_RESULT`。这是检查器投影错误，不是HTTP失败；原回执保留，**没有重试health，也不声称其JSON语义已实际验证**。检查现有route/response源码确认包裹结构后，仅完成原批准范围内剩余的login/admin各一次，没有重复请求。浏览器正常资源加载/预取/认证流量不计入这3次诊断。

用户自行输入现有凭据并单次登录，报告“已登录概览”。电脑操作技能的凭据边界用于人工接管；助手只通过专用浏览器接口读取最小DOM投影，不读取/输入密码、Cookie、存储或认证页面截图。

- `/admin`：标题“管理概览”、概览H1、实例导航存在，未出现可见控制/应用错误。
- 准确实例页：**14:27:30.591 CDT（19:27:30.591Z）**，标题“应用实例详情”、控制区存在，显示“每个阶段需准确计划”，未显示“控制器尚未启用”，无可见控制错误或实例不存在提示。现有5项计划状态可读：RunOnce ACKNOWLEDGED、Review OBSERVED/SLOT_OCCUPIED。未读取/保存客户名单、姓名、财务值或完整页面；没有点击控制按钮。

这次读取早于原14:28:42截止，实际经过现有 `status()` 路径、已注入专用控制数据库URL及Neon已有只读status函数。不是重复只读Web壳或纯配置推断；但不触发GitHub私钥getter/签名/dispatch，也不据此声称这些已验证。实例H1可能是具体店铺名，初始“含实例二字”启发式为false不代表失败，采用准确路径/页面title/控制区及无错误证据。

用户自行退出并报告“已退出”。14:29:22观察到公开首页与登录链接；14:29:27访问/admin实际跳回/login，登录标题和表单存在。证明当前浏览器已退出且管理员入口重新要求认证；未直接查询会话表、重放旧token或检查Cookie值，所以不扩大为数据库会话删除或旧令牌失效证明。认证POST数未独立捕获，正常登录/退出数据库写入不声称为零。

## 记录、期限与下一步

[机器索引](../ops/aws-sandbox/reviews/platform-hosted-w8h.acceptance.json)包含三个原件hash及最小状态。汇总原件 `F:/ChatGPT_workshop/techlong-platform-w8h-acceptance-verified-20261023.json`，SHA `f3abdabfd418a7c2470e0ae3a75f45cdd07fab06f32881097aeb98f4396ab985`。应用、镜像、权限、原部署48源码pin和已消费槽未改；本轮只有文档/实际证据，不重复构建或离线模拟测试。

**原控制租约已于14:28:42到期，未续租。** 本轮没有在到期后重新认证读取控制区，因此记录的是“租约按时钟到期”，不是声称已另行观察运行时关闭。Web和费用不会随控制租约停止。**15:58:42仅承载意图标签，仍可能持续计费；清理未授权**，需要准确新栈完整ARN另审，不能重放旧W7r删除。

下一主线缺口是**从AWS托管控制器发起一次准确Review调度**，然后复用既有RunOnce/Inspect链路。先集中准备所需准确任务/计划/验收材料，齐备后再审核一次新的控制窗口，避免把30分钟耗在准备与等待上；不重做登录壳、镜像、身份或F3c9。新窗口、私密使用、业务/计划写入、App操作和可能部署仍须按最终具体范围确认。当前栈的清理清单可单独准备，但没有自动续租、重启、调度或删除。
