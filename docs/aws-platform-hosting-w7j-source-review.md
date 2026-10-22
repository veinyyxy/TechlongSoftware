# W7j：Source 单次平台镜像发布控制器——完整执行范围与风险

本页是新控制器的固定风险说明，实际执行还需要精确JSON清单的SHA单独批准。
“开始下一步”仅授权代码、测试及只读准备，不授权下面的云写或dispatch。

## 唯一目标及资源

复用已通过W7h/W7i扫描与真实字节复核的同一份平台镜像，不重建：

- producer source `4209fcab429b868e253ea2d7263dfe2189187232`，run `39692352506`，artifact `12388759351`。
- 官方ZIP `sha256:74cf0fa61cc2a6ba9192050fbe63b0872785afc65239445f146395c3b361e478`，307758788字节；
  原archive `31578b890954ab675b1ef4c1f90424af82f519fd09b0b1a2cfac4fb1b0e5b30c`，307757790字节。
- config `sha256:2338439ea316a6189d50281f5d25a0a1c2a2ca1f4455494253f20bcbd8f6f9ae`。
- 精确ECR `402010193138.dkr.ecr.ca-central-1.amazonaws.com/techlong-sandbox-platform-web`；
  tag `platform-sha4209fcab429b868e253ea2d7263dfe2189187232-r39692352506-a1`，不使用latest。
- 精确健康V2栈 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-platform-image-publisher-v2/701257e0-cd89-11f1-be5e-02452f6c634b`。
- 现有角色 `arn:aws:iam::402010193138:role/TechlongSandboxPlatformImagePublisherV2`，
  RoleId `AROAV3GNMXTZID6CJJBA2`。boundary仍为原v1，不变更默认版本、附件、角色名或最大会话时长。
- 固定reusable源码 `c35dd66e1207181b9591056e1202cfb84ffcf010`，文件 `platform-image-publish-job-v2.yml`；
  [真实No-AWS复核39695238725](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39695238725) 已通过。
  caller `platform-image-publish-v2.yml` 在当前main上固定引用该完整commit，不使用浮动main。

不改变旧CREATE_FAILED栈、旧AVAILABLE Change Set、旧角色、租户81文件闭包、F3c9、Neon、Secret、DNS、ECS/ALB或业务状态。
不新增AWS基础资源，不删除资源或镜像，不执行旧清单、不消费旧槽。

## 清单期限与实际授权时间分离

外层清单绑定本页SHA、Source代码/依赖/测试/caller pins、准确已通过的Source CI、GitHub caller workflow ID和整个candidate。
外层有效期最长48小时，并截断到原镜像artifact到期前；**最迟开始时间是外层到期前1小时**。
只有明确批准外层SHA并启动 `RunReviewed`、通过fresh只读门禁后，才按批准的固定算法生成内层清单：

- grantStartsAt = 该次实际启动时刻；grantExpiresAt = 启动时刻 + 3600秒。
- 内层绑定当时准确dispatch commit、同一个nonce、完整candidate与固定reusable R。
- 内层原始JSON、SHA和绝对UTC时间先写入排他永久intent；随后才能提交第一笔AWS写。
- 内层日期不是静态外层JSON的预定日期；批准外层SHA即明确批准这一受限、被代码pins绑定的运行时生成算法。
  不允许自行延长窗口、换nonce、换镜像或重试。

因此48小时不是持续开放权限48小时，也不是允许在截止后启动；只有一次最长1小时的窗口，正常结果后立即开始撤权。
Source本机程序必须保持运行。原artifact在2026-10-24T23:18:27Z到期，过期不重建或替换。

## 具体写入及凭据范围（待单独批准）

1. Source仅使用现有 `techlong-sandbox-user` AWS Login profile，STS核对准确IAM User、GetRole核对准确RoleId。
   不调用Source AssumeRole、不读取Secret值、PEM、私密包或数据库。
2. 最多一次 **CloudFormation UpdateStack Grant**，只更新上述V2栈内现有一个Role的trust和唯一inline：
   增加准确GitHub provider/audience/immutable subject、repo/owner/actor IDs、main/environment、固定reusable commit条件；
   trust与ECR-only Allow都加同一3600秒时间条件。不开CFN/IAM/ECS/Secret/Delete等发布角色权限。
3. Grant必须UPDATE_COMPLETE且直接IAM独立回读匹配后，才允许一次GitHub POST dispatch。
   用现有仓库Git credential helper取得一次人类账号凭据，只发往准确 `https://api.github.com`，
   `/user`身份必须为veinyyxy/14145707。不是读取GitHub App私钥，也不创建token、改权限或计费设置。
   此凭据可能拥有比本工作流更广的现有权限；控制器只允许准确read endpoints及一次准确workflow POST。
4. 调度要求 `return_run_details:true`，精确ACK/run ID须先落盘，才开始观察；响应不明、204或超时不猜测run、不重发。
   需要你在既有 `techlong-sandbox-deploy` environment人工批准这**一次**运行，不允许Run/Re-run。
5. 云端重验原ZIP/archive/config、双smoke和fresh零HIGH/CRITICAL扫描；完整review与JWT匹配后，
   最多一次900秒WebIdentity会话、一次顶层Docker push，读取准确registry manifest确认其config为原镜像。
   角色权限仅ECR，不能自行撤权或部署。源码始终checkout固定reusable自身R，而非caller选定目录。
6. 不论Grant/dispatch/push成功、失败或结果不明，Source在finally中启动最多一次 **UpdateStack Revoke**：
   同一Role trust回到原no-Allow，唯一inline改为显式 **Deny ecr:* / Resource ***。
   不恢复原ECR Allow，不更新或删除managed boundary。
7. 随后用新的只读SDK clients独立回读CFN template/资源及真实RoleId/trust/inline/boundary。
   即使Revoke提交出错也独立读取；再由Source读取ECR原始manifest验证hash/config和准确唯一tag。
   任意步骤不明或不匹配，结果为需要Inspect，不能宣称“已安全撤权”或“发布成功”。

两次UpdateStack均为准确StackId、NAMED_IAM、DisableRollback=true、Parameters=[]、准确编译TemplateBody和固定client token；
不传RoleARN、Tags、TemplateURL、宏、策略覆盖或强制回滚选项。
[AWS说明](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_UpdateStack.html)：UpdateStack是异步启动；省略Tags保留标签。
本方案直接UpdateStack，不创建/执行Change Set。批准必须明确接受这个范围，不沿用旧Change Set执行批准。

## 永久一次性槽、失败及中断

- 精确永久槽 `F:/ChatGPT_workshop/techlong-platform-publication-v2.source.intent.json`。
  fresh本地/云端门禁通过后、任何云写前使用wx+fsync写入。内层review原件也存入槽，便于中断后审计。
- 每个CFN写及dispatch前有独立intent，ACK在后续读取之前落盘。SDK maxAttempts=1；没有应用层写重试。
- 槽一旦占用，不自动删除、复位、换名、恢复或复用；新nonce也不能绕过这个稳定槽。
  Prepare不消费这个槽，失败的本地证据目录保留。执行失败后不能重新运行RunReviewed。
- CFN Grant可能仍在异步更新；Revoke前最多等10分钟让其稳定，再进行唯一一次提交尝试。
  CFN忙、UPDATE_FAILED、凭据过期、网络错误或本机强制退出，都可能令撤权无法提交或无法证明。
  不暗中改为直接IAM修复，不取消CFN、不重试。需只读Inspect，实际后续补救必须另行明确批准。
- cleanup不会因原批准已过期或main后来变化而主动拒绝；但仍需准确Source身份与RoleId。
  角色ID/状态检查不构成跨服务CAS，无法消除并发替换或其他操作者竞态。
- GitHub等待最多约50分钟，为CFN Revoke预留时间。超时后立即进入收尾，不自动取消、重跑或重新调度run；
  延迟启动的job会因缺少权限/过期内层而失败，但在途请求仍有残留风险。

## 必须接受的费用与安全残余风险

- 50USD/月仍是目标，不是服务端硬停费或绝对上限。ECR存储、扫描、传输、GitHub runner等可能收费；
  失败也可能留下收费镜像或部分上传层，本流程不自动清理。两小时平台hosting验收窗口仍未启动。
- 只有两个顶层CFN API提交上限，不代表AWS内部只写两次。DisableRollback不保证provider内部无补偿/清理；
  同一V2栈的并发未执行Change Set可能失效，执行前要求列表空，但无法保证之后无人写入。
- [关闭trust不会让ECR token立即失效，token可有效12小时](https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html)。
  已有STS会话/registry token、IAM传播延迟、在途请求及服务端授权缓存，不能保证即时归零。
  显式Deny及Allow时间条件是限制措施，不是可证明的即时凭据吊销。
- 发布IAM权限约束的是repository而非仅一个tag/一次请求；runner intent、nonce、GitHub串行组、immutable tag和空仓库检查不是全局原子锁。
  一次Docker push进程会发送多个layer请求，Docker内部可能重传；不能宣称只有一个ECR HTTP写。
- Docker token经stdin、独立临时auth文件，仅正常finally删除准确文件/空目录；强制终止、提供者日志、内存取证或磁盘残留风险不能消除。
  Source登录缓存和Git credential helper现有凭据不被注销；字符串内存不能保证可靠擦除。
- policy/JWT门禁和本地合成测试不证明真实OIDC/STSpush路径成功；这是首次实际发布范围。
  OS扫描不等于npm/应用安全、真实数据库登录、TLS或完整平台上线验收。
- 目录链接拒绝/排他写不是完整防本机恶意管理员机制；审批后的主机、SDK包、GitHub runner或云账号并发变化仍有风险。

## 工程命令与后续

`ops/platform-image-source-v2/cli.mjs` 仅有Prepare、RunReviewed、Inspect三个明确模式。
Prepare只读取现有元数据、身份和CI，生成本地清单及facts；Inspect只读取准确既有intent所绑定状态，可在原清单过期后审计，不写云。
RunReviewed必须显式提供外层SHA，验证当前干净main、Source CI与代码pins；只允许在已验证代码提交之后新增准确公开review文件及README元数据，不能变更运行代码或本风险说明。
发布caller引用的R不随Source代码提交变动，不需重新构建镜像。

完整待审清单与命令将在准确Source CI通过、GitHub/AWS只读事实核验后生成。批准前没有Grant、dispatch、ECR push或新永久槽消费。
