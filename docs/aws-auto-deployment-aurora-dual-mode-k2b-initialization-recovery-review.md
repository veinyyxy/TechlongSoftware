# K2b 最终待审：一次人工初始化恢复及独立应用验收

状态：**代码/Check/现场只读Review通过，尚无实际初始化或执行授权。** 不重跑旧部署流程，不创建资源。本阶段只把现有修复镜像承载上的准确租户初始化并认证验收，平台ready协调是验收后的K2c短事务，另审。

## 新清单与三个固定时间

- Manifest SHA：`7596abc946c49640de42832aab432bcbe437f51bcd81136221a692aebe1d3017`。
- 原件：`F:/ChatGPT_workshop/techlong-express-k2b-review-20261016-r2/manifest.json`。
- 生成：Winnipeg **2026-10-16 00:24:39.501 CDT** / UTC05:24:39.501。
- 入场严格早于 **2026-10-16 02:24:39.501 CDT** / UTC07:24:39.501。
- 应用执行及独立Inspect严格早于 **02:39:39.501 CDT** / UTC07:39:39.501；过期不再加载私密包、签JWT或调用应用，不更新本清单延长时间。
- workload仍固定 **07:04:28.726 CDT** / UTC12:04:28.726到期，旧Janitor保持。上述新审批窗口不是续期，既有资源继续收费，50USD/月为目标非cap。

## 与旧worker的边界

旧job已过期，平台artifact仍旧digest，本次**不声称旧job有有效lease，也不更新/伪造worker context**。申请的是新的、明确受审的**人工单次恢复例外**：准确原app/owner/store/configuration/generation1/epoch1及新真实stack/image由新manifest独立绑定；保留旧job/lease/plan/artifact及全部失败证据。旧Full/Express worker校验器不改、不启用额外worker。

desired_plan本身不含镜像引用，镜像是独立artifact_ref；没有必要为这一步重建计划、租户或Cell。K2b不写Neon。接受应用先初始化但平台仍pending的中间态；后续K2c根据独立验收，准备准确旧值/DB时钟/CAS协调artifact、job和ready，不借用本批准写平台。

## 唯一申请动作

1. Run内**一次新的postgres Aurora TLS只读预检**，10冻结/固定SELECT、14正常query（错误最多一次ROLLBACK），再次确认目录/身份/73表/默认entitlements/原UUIDv8 seed store完整pristine；不把K2a历史快照冒充当前事实。若已有初始化或其它差异，停止，不POST。
2. **Run、Inspect各最多一次原本地私密包加载**；其中包括RSA/mTLS私钥及旧loader必读但本入口不使用的测试Stripe材料。严验原ACL/summary/binding/密钥对/证书指纹，不改原件，不调用Stripe。
3. Run**一次准确runtime Secret固定版本读取**，仅在内存按已有HKDF协议派生首位owner密码，不打印/保存密码或其body摘要。准确ARN及version见固定风险；不新建Secret、不改IAM。
4. Run最多四个mTLS/JWT请求：bootstrap GET、**一次provision POST（真实租户业务写）**、readiness GET、control GET。原店铺 `add89a8c-f43e-81b9-8287-0cb6c5c54f87`，店铺名`Techlong Sandbox`，owner `techlong_sandbox_admin`，原八项entitlements和两套主题/配置保持；payload metadata明确使用实际新镜像digest0dc34eda…及原epoch，原幂等键不变。不重试或循环POST。
5. 新进程Inspect最多readiness/control两个GET，独立核对实际image、初始化、准确store及有效entitlements/name/themes/hash；**不再连接Aurora、不再读取Secret值、不POST**。成功仍`platformReady=false`。

Run前、POST前、Run后、Inspect各35 SDK+11 CLI+1 Neon元数据只读；编译/密码来源另最多五次Neon只读SELECT及一次STS/两次Secret Describe/一次Get，SQL入口另一次STS。完整输入/时限/永久槽、并发窗口及副作用范围由[固定完整风险 v1](aws-auto-deployment-aurora-dual-mode-k2b-initialization-recovery-risk.md)定义，risk raw SHA `c6729d705d3e5a140bc87a5a1f13dec2953744fa03684457f59e4a8234a7df03`。

## 已完成的准备，不是实际初始化证明

现场35 SDK+11 CLI+1 Neon只读通过：准确新栈UUID `f71252c0-c917-11f1-8148-02ff648cb917`、task definition:2、实际修复digest0dc34eda…与健康目标保持，Cell/IAM/固定Secret版本/DNS/DDB/Janitor及原平台原状精确匹配。本次没有重新连接Aurora，最新pristine事实仍是K2a 23:51:34.216快照；真正获准Run时必须重新只读核验。

10项新针对测试+15项相邻测试、typecheck、四文件定向ESLint和三脚本语法通过；最终本地Check无网络/私密动作。另起进程验证canonical manifest、23项raw code/risk pins、70项LF-normalized旧import closure pins、38项新历史pin条目及34项旧公共history pins；两新固定槽均空。pin条目有重复，不声称合计93个独立文件。代码闭包绑定不是对全部第三方包的安全审计。

本轮Aurora连接/Secret值/私密包加载/JWT/应用HTTP/云或业务写/槽消费均0。完整raw evidence hashes和摘要见[准备记录](../ops/aws-sandbox/reviews/aurora-dual-mode-k2b-initialization-recovery.prepared.json)。实际body、password、Secret值和原私密包不入Git，旧17槽和K2a已消费槽保留。

r1只读Review保留；增加槽落盘后的时限/事实窗口复核后由r2取代，r1未请求执行批准、未消费槽，不可执行。两轮共70 SDK/22 CLI/2 Neon只读，不是运行时动作。上述时间与SHA只对应最终r2。

## 必须确认的风险

本次会真实写入租户库，不是只读探针。请接受[完整风险](aws-auto-deployment-aurora-dual-mode-k2b-initialization-recovery-risk.md)：人工恢复不是有效job lease、应用/平台非原子中间态、管理postgres只读能力、私密包/固定Secret/owner密码暴露、并发/事实窗口、提交成功但响应或回执丢失、低成本非零费用，以及两个新永久槽消费后不自动复位/补齐/回滚/重连或重试POST。任何失败只保存证据并按已批准只读Inspect核验，不因旧幂等键相同就自动再发。0 AWS/IAM/Secret/DNS/DDB/Neon平台写；不延期、不重建资源、不ready。

建议确认文本（尚未由用户发送，代码提交不构成授权）：

> 我确认按清单 `7596abc946c49640de42832aab432bcbe437f51bcd81136221a692aebe1d3017` 执行K2b，明确接受人工单次恢复不是旧job lease：一次Aurora只读pristine预检、Run/Inspect各一次原私密包加载、一次固定Secret版本读取、一次真实初始化POST及独立认证验收；不改AWS/IAM或Neon平台记录、不续期、不ready，并接受完整风险、非原子中间态和永久槽不自动复位或重试。

## 获准后的唯一继续点

核对窗口/全部绑定及两槽仍空。只有收到上述fresh范围明确批准后，在平台仓运行一次：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-initialization-recovery-v1.mjs --mode Run --manifest F:/ChatGPT_workshop/techlong-express-k2b-review-20261016-r2/manifest.json --approved-sha 7596abc946c49640de42832aab432bcbe437f51bcd81136221a692aebe1d3017 --output F:/ChatGPT_workshop/techlong-express-k2b-run-20261016-r1
```

有POST提交槽后，另起进程仅只读验收（包括提交响应不明情况；不需要Run已保存成功ack）：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-initialization-recovery-v1.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-express-k2b-review-20261016-r2/manifest.json --approved-sha 7596abc946c49640de42832aab432bcbe437f51bcd81136221a692aebe1d3017 --run F:/ChatGPT_workshop/techlong-express-k2b-run-20261016-r1 --output F:/ChatGPT_workshop/techlong-express-k2b-inspect-20261016-r1
```

若Run在POST槽前已消费根槽后失败，不能重跑Run或为了有slot而补写POST槽；保留证据，缺少后续权限时停止另审。已过窗口只能只读核对公开元数据及原回执，不再读取私密材料、签JWT/调用应用或重放旧许可。不扩展F3c9、Grant、restore/seed、清理器或镜像重发支线。
