# W7i：新镜像的发布前复核与受保护云端发布入口

2026-10-21。当前仅编码、只读核验及No-AWS CI；**不是Grant、dispatch或ECR发布授权**。
此阶段完成云端侧入口与Source编排边界，Source生产写入适配器/固定caller/完整执行清单尚未完成；
不能把合成撤权测试当作真实权限已经收回，也不能直接调用reusable workflow代替审批。

## 同一份已扫描镜像，不重新构建

新目录 `ops/platform-image-publication-v2/` 明确绑定 [W7h结果](evidence/platform-hosting-w7h.result.json)：

- source `4209fcab429b868e253ea2d7263dfe2189187232`，producer run `39692352506`，workflow `391864582`，main push / attempt1。
- artifact `12388759351`，官方ZIP `sha256:74cf0fa61cc2a6ba9192050fbe63b0872785afc65239445f146395c3b361e478`，307758788字节；
  到期2026-10-24T23:18:27Z（温尼伯10月24日18:18:27 CDT）。
- image config `sha256:2338439ea316a6189d50281f5d25a0a1c2a2ca1f4455494253f20bcbd8f6f9ae`；
  archive SHA `31578b890954ab675b1ef4c1f90424af82f519fd09b0b1a2cfac4fb1b0e5b30c`。
- 目标固定 `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web:platform-sha4209fcab429b868e253ea2d7263dfe2189187232-r39692352506-a1`。
  这不是现有ECR镜像，尚无registry manifest digest。

保留旧v1目录、旧Debian候选、旧失败扫描及三次永久槽；不将旧批准改写成新镜像批准。

## 已实现的代码边界

1. `artifact.mjs` 与 `cloud-preflight.sh`：准确producer/官方ZIP摘要和大小→复用严格三条目ZIP提取→实际archive/receipt/SHA256SUMS→
   load/inspect准确image ID→非root、只读、无网络双smoke→固定Trivy二进制、新DB和零HIGH/CRITICAL扫描。
   不build、不login、不push、不申请AWS会话；只向官方GitHub下载API提交GitHub认证，signed Blob URL不转发认证或打印。
2. 新No-AWS CI只具contents/actions read，无environment和id-token能力；仅保存三个小JSON，不复制307MB产物。
3. `plan.mjs`：严格绑定新candidate、review原始字节SHA、nonce、reusable/dispatch两个完整commit；
   review最多48小时且不能超artifact期限，Grant为准确绝对时间、最长1小时。**48小时审批有效期不等于Grant开放48小时**。
   Grant/revoke纯模板仅改变现有V2角色trust和同一inline，不新增role/boundary或修改旧栈。
4. `platform-image-publish-job-v2.yml` 仅支持workflow_call，无push/dispatch入口；仍使用现有人工审核environment。
   不接受caller选择代码checkout：固定bootstrap先从GitHub官方OIDC响应读取当前reusable自身SHA，再checkout这个SHA。
   bootstrap仅取得GitHub OIDC token识别源码，不申请AWS STS；完整JWT/上下文验证后方可申请一次900秒AWS会话。
   Source的trust必须绑定这个实际reusable完整commit，不能绑定main或任意caller传入的checkout。
5. `publish.mjs`：在真实artifact和fresh scan通过、review有效且Grant剩余至少60秒时，排他保存该runner的intent；
   单次AssumeRoleWithWebIdentity，GetCallerIdentity核对准确RoleId+session，再确认目标仓库完全空。
   token只经stdin交给Docker；独立0700临时目录/0600 config，禁用host helper自动发现，不输出认证材料。
   单次tag/顶层push进程后，BatchGetImage核对准确account/repo/tag、原始manifest SHA与config digest。
   finally仅清理本次准确config文件和空目录，不递归删除、不改HOME。
6. Source协调函数 `coordinatePublication` 已有grant/verify/dispatch/finally-revoke/独立Locked核验顺序及失败测试，
   **生产写入ports尚未接入**。发布角色无IAM/CFN权限，不能自行撤权；云端结果明确标记 `iamRevokeProved:false`。
   当前没有可执行Source RunReviewed命令、固定caller或实际dispatch路径。

## 现有AWS只读核验

`inspect-aws.mjs` 是仅只读CLI，未实现任何Put/Update/Create/Delete/AssumeRole/Secret读取。
2026-10-21T23:36:54.838Z核验Source准确IAM User、原V2 StackId/CREATE_COMPLETE/单role原template、
真实RoleId `AROAV3GNMXTZID6CJJBA2`、no-Allow trust、唯一原inline、无managed attachments、
原boundary PolicyId/default v1/usage1及ECR immutable/AES256/scanOnPush/零镜像，全部通过。
兼容IAM Action单项标量与数组，只规范化该字段；分页不全即拒绝。

证据 `F:/ChatGPT_workshop/techlong-platform-publication-v2-inspect-20261021.json`，
SHA `5ea06a4ae0fa590fa45223a2974b0dd18c1babb0d9aaedd22506e93cc5743420`。
此为非原子只读观察，不保证后续状态不变；Source无需本轮刷新。

## 当前验证与后续完整执行审阅必须包含的风险

本机20项Node检查（12新＋8旧）及类型/lint通过；新的真实云端字节/load/scan结果须单独核对。
测试包含旧image/review替换、错误身份/branch/attempt/源码、过期、unfixed非零拦截、错误registry manifest、
失败不重试、模糊grant错误仍进入Source revoke、Locked未证明不得成功等。未真实调用AWS发布路径。

- ECR权限只能约束准确repository，不保证IAM层面只允许一个tag/一次请求；nonce/runner排他文件不是云端全局原子锁。
  当前空仓库检查、固定tag、immutable和GitHub串行组用于降低重复风险，不能消除其他操作者竞态。
- 一次顶层Docker push会包含多个layer请求，Docker内部可能重传；不能宣称只有一次ECR HTTP写。
- 关trust不撤销已有会话。[ECR token可能有效12小时](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html)；
  Source最终需关trust并对ECR显式Deny，限时Allow只是兜底，IAM传播/in-flight请求不保证即时停止。
- [AWS对GitHub condition keys的支持](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_iam-condition-keys.html)
  与真实OIDC/角色路径仍待单独授权后验证。不能借机修改repo subject格式或扩boundary。
- Source安装/撤权非原子，登录自动刷新失败、网络/本机进程中断、CFN异步状态均可能留下部分权限；
  真实Source适配器必须先保证独立永久槽和ACK记录、明确失败收尾及应急检查，不自动重试或重放。
- 镜像会新增存储/扫描等潜在费用，扫描不代表应用/真实TLS/数据库业务验收；不自动删除镜像或残留上传层。
- Docker认证文件是临时明文base64凭据，正常finally清理不覆盖runner被强制终止/提供者日志/内存取证风险。
  [Docker配置实现](https://github.com/docker/cli/blob/master/cli/config/config.go) 在无认证配置时会自动发现credential helper；本入口显式初始化准确registry auth map避免该默认分支。

以上为实现说明与风险预告，**不是可以单独批准执行的完整清单**。
下一步只接入Source生产安装/撤权/单次dispatch及独立核验，发布固定caller，核对准确CI/source后生成fresh SHA；
最终Grant/发布/立即撤权范围再单独批准。旧Change Set/旧栈/F3c9/租户81文件闭包不动。
本轮AWS写/私密值/SQL/新执行槽/dispatch/会话/ECR发布/部署均为0，50USD目标不变，两小时hosting窗口未开始。
