# W8e：真实托管镜像封验与无 AWS 身份自检

## 主线与范围

W8d已安装并独立核验完成，本阶段只核验它后续要使用的W8b真实镜像。复用原artifact下载/严格解包/回执、Docker加载、匿名健康检查及扫描流程；没有新构建、依赖、身份、执行器或UI。旧publisher默认候选和原受保护工作流不改，不重放任何已消费安装/发布/清理槽。

本阶段无AWS SDK调用、Secret值/PEM读取、数据库连接、App token、workflow_dispatch、ECR登录/上传、IAM变更或ECS部署。GitHub推送及只读CI是正常代码验证，不是云发布许可。

## 真实字节绑定

准确生产者源码 `f3cea2da7d26dfc09726c4cbc52cab40217340c6`；首次main/push构建[39960583333](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39960583333)成功。实际下载artifact `12503974340`，307773703字节，官方ZIP SHA256 `12f027cccd21d955c5a0c4db9b6f536606749028c0a1fdcc8d09f95279265723`。

本地原件位于 `F:/ChatGPT_workshop/techlong-hosted-image-w8e-39960583333/`。仅允许三个准确普通文件的原解包器已读取真实ZIP；image.tar.gz为307772705字节，实际流式SHA256 `9c427ec8a2f5b4146ee578b0fd1f5f602f729cf09f65aa7bb5392b1c596a22f5`，与生产者回执一致。回执绑定的image-config digest为 `sha256:c418fef9c5146ef1fcdb39f88cb28ffe2d50a8b89f64ce94f6c8f463f6924230`；云CI必须再次加载真实镜像并独立核对，不能仅相信这份JSON。

本地还直接读取archive的唯一manifest及其config blob，核对真实config字节摘要、准确源码tag、Node24/amd64/non-root/默认关闭命令及SHA256SUMS；不解出或运行layer。12个layer由云端Docker加载进一步验证。真实本地回执 `binary-verification.json` SHA256 `eba7d68c66cc9d612f7f5c9c863204bf1469faf54e567005137c825306b3ba86`，生产者回执原始字节SHA256 `cb10861a1e74fc47c108615ae1f60f3201200ef70b2d9c4dd0b35b259b6c75b7`。本机28项新旧测试及类型/定向lint通过；不是云端加载或fresh扫描成功声明。

`ops/platform-hosted-publication-v2/candidate.mjs`仅固定以上已核对候选；`artifact.mjs`使用原检查逻辑。共享preflight只接受默认legacy或准确hosted-v2两种模式，不接受任意driver、镜像、路径或endpoint。旧候选参数默认保持。

## CI门禁和完成标准

新 `platform-hosted-publication-candidate.yml`只在代码push/PR运行，contents/actions read，无environment或id-token权限。它不调度生产工作流、不取AWS身份：

1. 合同/旧发布器/旧Source回归、类型及定向lint。
2. 从官方GitHub再次核对生产者、有效期、ZIP字节、严格三文件解包、archive及SHA256SUMS。
3. Docker加载相同image-config，核对Node24、非root、默认关闭命令和有限公开环境。
4. 三项network-none/read-only自检：loopback、固定HTTPS入口、合成25秒托管控制租约及到期关闭。无真实私密绑定；到期后Web仍可健康响应不是停费证明。
5. 重新下载准确摘要的Trivy0.75.0及新漏洞库，只扫OS HIGH/CRITICAL，不能忽略unfixed、发现或旧库；必须为零。上传小型回执，不上传镜像、token或私密值。

真实字节匹配不等于无漏洞、生产运行或AWS兼容性验收；本阶段CI尚未完成前不能宣称门禁通过。后续实际发布必须在其运行内重新执行fresh扫描，不沿用这次CI扫描作长期通行证。

## 发布边界和唯一下一步

候选artifact到期 **2026-10-26 08:24:09 CDT（13:24:09Z）**。保存本地原件不延长GitHub下载或发布窗口；到期不自动重建、复位或重跑。镜像源码晚于旧镜像不代表已发布；ZIP/archive/config和registry manifest是不同摘要，真实registry digest在新批准发布前仍未知。

原ECR旧镜像 `sha256:81fb8157fd9dcf834204a3b0c866d3fc8071386a4cbc1ff71f2ccac992ed4612` 及tag保留，新目标仅 `platform-shaf3cea2da7d26dfc09726c4cbc52cab40217340c6-r39960583333-a1`。本阶段不查询或改AWS，publisher Locked沿用前次观察，不声称fresh状态。

准确CI通过后，唯一下一步是把这个真实候选接到原Source Grant→一次发布→无论成功失败立即Revoke及独立Locked核验，发布新不可变受保护caller/reusable绑定并生成具体新SHA清单。必须重新核对现有publisher身份、精确策略/旧镜像和GitHub门禁；**本文件及W8d安装批准均不授权这些写入**。不新建角色/执行器，不回到F3c9或UI支线。之后两小时托管与清理继续分别审核，50USD/月目标不是硬上限。
