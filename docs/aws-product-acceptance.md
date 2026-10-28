# 产品真实验收：当前最小继续点

2026-10-28，America/Winnipeg。沿用[执行手册](aws-auto-deployment-execution-runbook.md)；这是主线第二步的工作记录，不是新的云部署、私密读取或业务写入批准。

## 已完成与本轮阻塞

[同一 sandbox 的整轮恢复部署](aws-auto-deployment-reviewed-cycle-observed.md)已独立通过，不重跑 Review、RunOnce 或 Inspect，也不再扩部署框架。整套产品仍未验收。

客户端 `veinyyxy/speedfeast` 的默认分支是既有 `master`。原源码 `5a01ee49344c9c2cfc6c3c5ecfbea6db76fcf269` 的[准确 CI 31296964215](https://github.com/veinyyxy/speedfeast/actions/runs/31296964215)在依赖安装失败：运行环境 Dart 3.8.1，而 `pubspec.yaml` 要求 Dart ^3.12.2、Flutter >=3.44.9。Analyze、Test 和 web release build 均未执行，deploy 被跳过；历史旧源码的成功不能替代这次检查。

## 最小修复与验证

客户端提交 **`3ad0ea8b99c2f891bcc450cc006bc5a97000a337`** 已推送到原 `master`，没有新分支或更改默认分支。只修改两个工作流内三处 Flutter pin：

| 文件 | 唯一变化 |
| --- | --- |
| `.github/workflows/web-deploy.yml` | verify / deploy 使用的 SDK 从3.32.5改为3.44.9 |
| `.github/workflows/android-package.yml` | package 使用的 SDK 从3.32.5改为3.44.9 |

这是对齐项目已经声明的最低 SDK，不是依赖升级、功能或部署变更。[Flutter 官方归档](https://docs.flutter.dev/install/archive)与官方 Linux release 元数据确认3.44.9 stable携带Dart3.12.2，framework ref `6b182d2c7585eba26d4edce0f97630effd256c33`。

本机只检查 YAML、三处pin与pubspec一致、两个文件除版本替换外全文不变，以及push的无AWS路径；通过 `SDK_PINS_AND_NO_AWS_PUSH_SCOPE_VERIFIED` 和 `git diff --check`。本机没有Flutter SDK，不安装SDK或Docker，不将静态检查冒充Flutter测试。

准确云端检查为[CI 40755064679](https://github.com/veinyyxy/speedfeast/actions/runs/40755064679)，attempt1、push事件、head准确等于3ad0ea8，已于温尼伯14:34:26报告completed/success。verify job `123051667552` 的依赖安装、Analyze、Test及web release build均success，官方日志确认 `Built build/web`。该run的deploy job `123051670802` 为skipped。Android仅静态核对pin，本轮没有执行其打包工作流，不声称APK已验证。

恢复检查点：`F:/ChatGPT_workshop/techlong-product-client-sdk-verified-20261028-a.json`，原始字节SHA `c9749a74553e143ac44f631d85a2bbd2c0cd840b90ecc4ae48d97868296794d3`。它只记录代码、准确CI和零云写边界，不是新的生产快照或后继操作许可。

原触发及权限边界保持：master push只运行verify、使用无效示例API地址和测试值；没有AWS身份、真实HMAC或生产Secret。web部署仍仅手动dispatch、沿用production环境；Android仅tag或手动触发，本轮没有tag或dispatch。没有运行现有 `s3 sync --delete`、CloudFront invalidation、Android签名/打包或Release上传。

## 接下来的单条路径

1. 上述准确CI已通过，不重跑、不再为此增加测试框架；这只证明测试参数下能构建，不证明当前sandbox客户端已发布或业务通过。
2. 经当轮明确允许，用既有入口核对当前租户API及已发布客户端的真实来源/配置；不把CI中 `api.example.invalid` 的构建当作可验收的sandbox产物。没有当前资源快照或生产发布配置实证时，不声称客户端已绑定新租户。
3. 对齐来源后，才单独审批短时真实客户端访问、商户认证和必要业务场景。复用现有资源和工作流，不新建控制器、任务代际或恢复框架；部署及清理按具体资源另审。

本轮已发起限定在线核对的许可询问，尚未据此调用生产AWS/HTTP。拟定范围为最多10次GitHub GET、1次STS+20次AWS元数据以及4次无身份HTTPS GET；不读Secret值/PEM/.env/HMAC、不执行网页JS、不认证或写业务、不连数据库、不调度或续租。回复与实际调用次数须在执行后记录；这份文档本身不代替批准。

### 为什么不直接打开买家页面“只读验收”

客户端 `lib/Controller/service_provider.dart` 在initialize中设置设备上下文并GET `/api/buyer/access`，随后开启定时heartbeat。服务端当前本地源码 `a79ed89cdb5dc788ec880d8dcbeeb875f1f19159` 的buyer middleware会据此INSERT/UPDATE `saas_access_leases`；GET不等于零业务写。商户 `/api/merchant/auth/login` 也更新 `merchant_users.last_login_at`。当前云镜像的源码及配置对应关系仍须核对，不能仅凭本地HEAD宣称线上已经包含这些行为。

因此本阶段不启动客户端JS、不读取签名私密材料、不登录、不创建样例商品/订单、不支付，也不自动续访问租约或发送通知。后续真正打开客户端时须明确接受这些正常应用副作用；不能用一个“只读页面”许可覆盖它们。

## 费用与停止条件

既有工作负载意图到期为**2026-10-28 16:06:01 CDT**。TTL不会自动删除、停机或停止计费，50 USD/月不是硬上限。本轮没有延长期限或清理许可；原窗口到期后停止业务验收方向，先另审准确现状/清理，不自动重新部署。代码CI与来源核对不等于整套产品通过；当前 `wholeProductAccepted=false`。
