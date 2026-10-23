# W8a：回归自动部署主线，控制器托管来源兼容

## 当前差距与本阶段结果

自动部署主线已有两项独立的真实证据：W6w完成sandbox租户的Review → RunOnce → Inspect；W7r完成平台AWS临时托管的公网/管理员有限验收，并已清理临时承载。**两项通过不等于部署控制器已在AWS启用。** 既有控制器只接受本机Origin/租约，Node托管也硬关闭控制入口。本阶段只补前一项兼容缺口，不重建只读承载来重复验收。

用户已明确：窄屏退出按钮不属于主线，不修复。该历史缺陷仅留档，不作为本阶段前置条件；清理报告里此前“下一步修UI”的建议已被这项决定取代。

已在原控制器接入本机/托管运行上下文选择，没有新执行器、App身份或部署工作流。原本机租约格式、Origin、30分钟上限和release验证保持；托管候选仅接受准确`https://console.sandbox.techlong.cloud`，不接受兄弟域、任意HTTPS、HTTP、本机来源、显式`:443`或尾斜线租约。两种模式不能同时开启、不能互换租约。

## 公开配置协议（不是执行清单）

托管候选要求三项公开开关组合：`TECHLONG_PLATFORM_CONTROLLER_ENABLED=true`、`TECHLONG_PLATFORM_CONTROL_HOSTED=true`、`TECHLONG_PLATFORM_CONTROL_LOCAL=false`或缺席。`TECHLONG_PLATFORM_CONTROLLER_LEASE`严格只有以下字段：

- `schema`：`techlong/platform-hosted-runtime-lease/v6`。
- `origin`：准确固定HTTPS来源。
- `sourceCommit`：40位准确源码SHA，继续绑定原控制器计划及GitHub远端main检查。
- `releaseSha256`：既有已发布release的语义SHA256；操作前必须独立算出并匹配。
- `issuedAt`、`expiresAt`：毫秒整数，当前有效且跨度最多30分钟。

30分钟是运行能力窗口，不是用户审批清单有效期，也不会延长云任务原领取窗口。没有自动续期或后台重新调度。此租约是由受信启动/部署配置提供的公开范围声明，**不是签名授权，也不是单独的云身份或镜像来源证明**；不能把“解析通过”当作获准部署。未来托管启动材料须把准确镜像/源码、release、固定Secret版本、权限和本租约一起纳入具体审核。

控制器在读取数据库绑定、私钥或调度之前验证有效租约及release摘要；提交前仍复核原计划、源码、账本永久槽和时间。保留人工GitHub environment批准、ACK先保存再撤销token、未知结果不重试等原行为。当前单sandbox实例范围不扩大为任意客户。

## 默认仍关闭、尚未完成的部分

Node托管构建/绑定增加明确的`TECHLONG_PLATFORM_CONTROL_HOSTED=false`。现有`start.mjs`仍拒绝注入启用开关及控制器私密变量；只设置新布尔值不会激活入口。现有镜像、AWS/IAM/Secret、数据库、已发布release/binding、云执行闭包及已消费槽均未改变。没有读取App私钥或Secret值、连接生产数据库、签发App token、dispatch或创建收费资源。

**下一主线阶段是Node受审托管启动与私密供给接线**：复用当前start/ingress和原控制器，加入明确独立的受控启动模式、截止处理及只在有效上下文中供给凭据；原默认关闭模式不变。随后通过现有GitHub Actions真实构建/容器检查，再集中给出准确Secret/IAM和部署清单。实际密钥装载、权限、镜像发布、运行/部署各按具体范围确认；不因为代码在main就自动启用或恢复已删除的栈。

## 本机与云端验证

本机79项相关新旧测试全部通过、0跳过，包含5项新增托管候选测试、原本机来源/租约、真实控制器私密读取前拒绝、HTTP同源门禁、App协议与默认关闭Node镜像/云闭包回归；类型和定向零警告lint通过。首次沙箱运行78/79通过，唯一失败是本机loopback连接EACCES；在允许loopback的环境原样重跑79/79通过，没有修改守卫绕过。测试只用合成配置/内存测试密钥，不代表生产托管控制器已验收。

新测试进入既有No-AWS cloud candidate工作流；现有hosting candidate会构建精确main的容器并做无网络冒烟与安全扫描。真实CI结果在对应源码Checks核对，不冒充本机Docker验证；不安装Docker Desktop，不新增有AWS权限的工作流。源码push后等待准确CI，本页初版不预先宣称云构建通过。
