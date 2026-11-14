# D2-6 后端三项生产依赖最小修复

用户批准范围仅为body-parser、follow-redirects、multer及必要回归。原构建43624344472及其失败记录保留，不Re-run；不改业务逻辑、路由、数据库结构、Dockerfile、工作流/权限或audit门槛，不读取PAT/.env/Secret、不连接生产库或调用AWS/ECR/恢复/部署。后端已有未跟踪`.vscode/settings.json`属于用户，保持不提交。

## 实际依赖差异

| 包 | 原锁定 | 新锁定 | 修复目标 |
| --- | --- | --- | --- |
| body-parser | 2.3.0 | 2.4.0 | 压缩请求尾部导致拒绝服务 |
| follow-redirects | 1.16.0 | 1.16.3 | 数组形式headers、正则元字符和跨VM realm敏感头剥离（最低修复版本1.16.2） |
| multer | 2.4.0 | 2.5.0 | 异步fileFilter在请求清理后继续执行导致拒绝服务 |

直接依赖multer范围只由`^2.2.0`提高至`^2.5.0`；另外两项继续作为传递依赖，不添加直接依赖或overrides。仅另改body-parser补丁必需的两个锁项：其content-type由2.0.0到2.1.0、qs由6.16.0到6.17.1，以满足新`^6.16.1`要求。Express/Axios/Twilio/SendGrid/AWS SDK与开发依赖锁项均不变。定向npm update产生锁文件；本地增量安装仍留旧node_modules，遂以npm ci --ignore-scripts按同一锁文件干净安装，未执行安装脚本。

上游依据：[body-parser公告](https://github.com/advisories/GHSA-27r3-jxmh-p828)、[follow-redirects数组头](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)、[头名称转义](https://github.com/advisories/GHSA-8r9p-f939-6h3c)、[跨realm数组](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p)、[1.16.3补丁](https://github.com/follow-redirects/follow-redirects/releases/tag/v1.16.3)、[multer公告](https://github.com/advisories/GHSA-q7qp-rjg7-q26m)。

## 必要回归及本地结果

后端新增`test/dependency_security_regression.test.js`，自动由原`test/*.test.js`入口执行，无新框架/入口或工作流修改。所有数据合成，仅临时回环HTTP/内存流/子进程，不导入app或dotenv、不连第三方/数据库：

- 三项包分别核对锁定与实际安装版本已越过漏洞下限、保持原major。
- gzip JSON仍保留签名所需原字节（含12.0），损坏gzip被400拒绝且后继有效请求仍成功。
- 对象与数组headers跨origin后均剥离内置及自定义合成凭据；敏感名称含正则元字符、敏感头数组来自独立VM realm，无关头保持。
- 上传失败后延迟fileFilter回调不崩溃/不重复next；正常内存multipart文件/普通字段保持。

旧node_modules先运行得到5失败/3通过：三项版本门槛和两项重定向检查失败。安装后8项全通过/skip0。gzip和multipart是兼容/生命周期回归，不声称复现全部上游DoS变种。连同原容器/候选工作流/OS安全门槛静态回归共20项全通过/skip0；类型检查通过。

保持原命令`npm audit --omit=dev --audit-level=high`：exit0，0 critical/0 high/1 moderate/4 low。余下ip-address和deepmerge/SendGrid记录但不扩大修复，没有执行audit fix --force或增加忽略项。候选工作流LF-normalized SHA仍为1d7fd99db80d03d8261e268d656045d5a89d0f28efa5a1f8e2e4471b92670aa8。

## 提交与技术核验边界

仅正常main提交/推送依赖与测试，跟进该准确提交自动触发的Backend CI和无AWS镜像候选构建；不手动dispatch或重跑原失败。原ECR/迁移发布工作流仍仅workflow_dispatch，不因main推送运行。后端源码11ec9bbdef4b76a2f7824afdd3d3fabcb505c8a9已推main，准确[Backend CI43625892859](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/43625892859)与[候选43625892768](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/43625892768)均为push/attempt1。

Backend CI已completed/success：Node24.18.0下319项测试全过/skip0，14项Python manifest检查成功，类型/迁移脚本语法、Docker镜像构建/inspect和合成环境启动smoke均成功。候选两job的生产audit、镜像构建、隔离自检及原Aurora/租户就绪运行检查均成功；随后**OS扫描门槛失败**，app HIGH2/CRITICAL0，lifecycle HIGH61/CRITICAL0，因此无checked-app/lifecycle归档，只有两个7天扫描诊断artifact。不是三项npm漏洞仍未修复，也不是整体候选成功。[准确run/job/步骤/扫描摘要与artifact元数据](aws-instance-release-backend-dependency-fix-ci-20261114.json)。没有下载ZIP，不依据计数猜测具体系统库/CVE或可修复版本。

本次授权范围到此收尾，不修Dockerfile/系统库、升级扫描器、加例外或降低门槛，不扩生命周期61项修复线。下一只建议另准准确app扫描诊断的最小只读提取，以确定阻止实际API候选的两项OS问题；诊断/修复仍未获准。原失败、原工作流及用户.vscode文件保持。本轮AWS/生产配置/Secret/PAT读取、生产库、ECR/安装/恢复/手动dispatch全部0；原资源快照已到期，不重新计算或借此恢复收费环境，runtime关闭、D2-6实际更新0次。
