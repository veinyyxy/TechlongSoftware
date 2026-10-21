# W7h：基础镜像修复与云端兼容验收（No AWS）

## W7g 实际结果，不是待重跑

2026-10-21，准确执行源码 `4889f9f61b7f761dba995b2744ec9844a1fda3f0` 的
[run 39669482771](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39669482771)
完成但失败。contracts 成功，官方 ZIP 字节、原镜像 load/inspect、两个无网络容器自检均成功；
每种自检检查18个浏览器资产。扫描返回 **64 HIGH、4 CRITICAL**，因此禁止继续发布。
这68条是23个不同 CVE 对18个二进制包的发现，不是68个独立漏洞；其中57条没有扫描数据库列出的修复版本。
扫描标签不等同于应用可利用性证明，也不应把全部发现宣称为远程攻击漏洞。

原候选 producer/source/run/image/artifact 的准确身份见 [W7g](aws-platform-hosting-w7g-image-publication-preflight.md)，不改写为新镜像。
原发布 proposal 的 pins 保留作历史；没有实际 Grant、OIDC 会话、ECR push 或部署。

### 保存的真实扫描证据

- 小型证据 artifact `12379096264`，3867字节，官方 ZIP SHA256
  `a79aaa7fbf918b74370fca72b832f5f0ecf0084de58d90b3882f97b91134a21d`。
- 名称 `platform-image-preflight-4889f9f61b7f761dba995b2744ec9844a1fda3f0-39669482771`；
  原始云端过期时间 `2026-10-24T20:22:27Z`。
- 已按准确长度及官方摘要校验并保存
  `F:/ChatGPT_workshop/platform-image-preflight-12379096264.zip`，只包含以下三个文件：
  - `preflight-bytes.json`：`f7b354730223ec98da338471f0f606c24e252eecf7ab02c3bef8975f14581b61`
  - `loaded-inspect.json`：`71ed1c79007a072d48663cc9cdde18b604d4fd3f07f7722b9ef66a01a37f3a74`
  - `os-scan-summary.json`：`d518b3f7821b7936eafe99895ffc78e02a6c76e5d25dd37de6a3f13441b1edd7`
- Debian 12.15 / 88 OS包，Trivy 0.75.0，DB更新于 `2026-10-21T19:18:22.876313144Z`；
  扫描记录 `2026-10-21T20:22:25.727Z`。摘要未截断，包含准确包/安装版本/修复版本。
- 四条 CRITICAL：Perl 的 CVE-2026-13221、CVE-2026-42496、CVE-2026-8376；zlib 的 CVE-2023-45853。
  libpcre2-8-0 的四条 HIGH 有修复版本。其余主要为 util-linux、ncurses、acl、systemd 等基础包。

## 为什么不是仅 apt upgrade 或换 Debian 13

Debian 官方记录说明：

- [Perl CVE-2026-13221](https://security-tracker.debian.org/tracker/CVE-2026-13221) 有 bookworm-security 修复，
  但 [Archive::Tar CVE-2026-9538](https://security-tracker.debian.org/tracker/CVE-2026-9538) 在 bookworm/trixie 仍未修复。
- [ncurses CVE-2025-69720](https://security-tracker.debian.org/tracker/CVE-2025-69720)、
  [acl CVE-2026-54369](https://security-tracker.debian.org/tracker/CVE-2026-54369)、
  [systemd CVE-2026-16742](https://security-tracker.debian.org/tracker/CVE-2026-16742) 在 trixie 仍有未修复记录。
- [zlib CVE-2023-45853](https://security-tracker.debian.org/tracker/CVE-2023-45853) 在旧 Debian 中存在
  “源包有记录、相关二进制未构建”的可利用性差异。这里记录该限定，不新增 ignore 或绕过扫描。

因此只换 Debian 13 不能保证通过原零 HIGH/CRITICAL 目标。采用官方 Node Alpine 候选，减少不需要的基础工具闭包；
不是自行删除包数据库来隐藏漏洞，也不采用 Debian sid 混装或编译系统库支线。

## 本次代码范围

- 仅平台 Dockerfile，Node 保持 **24.18.0**，改为官方 `node:24.18.0-alpine3.24`，固定 index digest
  `sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`。
  官方 registry 的 linux/amd64 子 manifest 为
  `sha256:4ba75f835bb8802193e4c114572113d4b26f95f6f094f4b5229d2a77773e0afc`。
  [官方构建源码](https://github.com/nodejs/docker-node/blob/303e6c3be0be8010403376712d3018fb99809f86/24/alpine3.24/Dockerfile)。
- build/runtime 共同继承固定 base，经 `apk upgrade --no-cache` 获取该发行版当前安全更新。
  包解析依赖构建时间，不承诺跨日可复现；整个输出镜像随后按 config/archive/官方 ZIP 摘要封存。
- Alpine 使用 musl，不能假定与 glibc 完全兼容：两阶段均使用同一 base，`npm ci` 使用既有锁文件，
  不复制 Debian 的 node_modules；真实云端编译和两种非root、只读、无网络 smoke 必须重新通过。
- producer 新增固定 Trivy 0.75.0 binary SHA 校验，独立空扫描目录/ignore、新DB（最多48小时）、
  精确实际 image ID、Alpine 3.24 OS包覆盖及非EOSL门禁。HIGH/CRITICAL 包括 unfixed，不能跳过文件或旧DB放行。
- `security-scan.mjs` 把完整报告/DB摘要与source/run写入排他摘要；发现漏洞时先保存摘要再失败。
  原镜像三文件 artifact **只在扫描成功后上传**；失败仅保存小型扫描摘要。
- 原 W7g Debian scan gate、旧 image/approval pins、IAM factories、租户81文件闭包不变。
  不增环境、调度入口或 AWS 权限，不修改服务端/客户端工程、数据库或业务状态。

扫描只覆盖OS包，不代表npm、应用、真实TLS/数据库登录或托管验收已通过。未安装本地 Docker，未升级用户plan。

## 验证与唯一继续点

本机54项 Node 回归通过（含新门禁及失败摘要保留），类型/定向lint检查通过；
真实 GitHub No-AWS 构建结果必须按新提交独立读取，不能把旧成功 smoke 当作新 Alpine 兼容证据。

若新候选失败，保存准确失败结果并修复，不重跑旧run或放宽门禁；若成功，读取新 artifact/source/run/config/ZIP 的准确身份，
另准备受控一次 ECR 发布及立即撤权的待审清单。**此文不是执行授权。** IAM/OIDC/推送/实际部署继续分别按具体范围确认。
原角色只读锁定事实仍是20:10观察，不是本轮重查；本轮没有 AWS API 调用、私密值读取、SQL连接或新永久执行槽。
50USD/月目标不变，两小时hosting窗口尚未开始，部署和清理分别审核。
