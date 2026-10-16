# K3r 最终待审：保留初始化结果，一次恢复承载并完成公网验收

用户选择继续承载恢复方向后，代码、29项针对/相邻测试、零警告lint、语法、本地Check、现场只读Review及独立绑定复核已通过。**尚未创建资源、发送应用请求、写平台或消费新槽。** 不是重新初始化，也不恢复F3c9/Grant支线。

## 最终SHA及不会因审批等待耗掉的承载窗口

- Manifest SHA：`10242ff57c631458705efde250ea2805786d07d22965e263b1e79630e965b148`。
- 原件：`F:/ChatGPT_workshop/techlong-express-k3r-review-20261016-r2/manifest.json`。
- 生成：Winnipeg **2026-10-16 08:22:43.744 CDT** / UTC13:22:43.744。
- 审批/Run入场严格早于 **2026-10-17 08:22:43.744 CDT** / UTC13:22:43.744。
- **不是预先给新资源指定一个正在倒计时的过期日**：批准的是确定性规则。Run重新通过前态后，唯一固定`startedAt`，新workload到期=`startedAt+7200秒`；完整实际request/到期/hash先落盘，与永久槽绑定。之后不移动、不续期，验收/事务在到期前5分钟截止。等待用户确认不创建或延长任何资源，也不延长旧清单/旧workload。

## 具体动作——一个集中范围，不再拆新的权限轮次

1. **一次新CreateStack**，七workload资源：log group、task definition、target group、三listener rules、ECS service。复用现有父Cell/ALB/网络、固定Secret版本、角色和DNS，1副本/0.5vCPU/1GiB，实际镜像仍`sha256:0dc34eda11fba65ca217aaa589ea527d88402991864b8bfbac6da00f4496f15e`。前任准确UUID `f71252c0-c917-11f1-8148-02ff648cb917`已删除；新UUID/task definition由真实响应和事件绑定，不预编造`:3`。不Update前任、不安装IAM、不新建Cell/库/Secret、不发布镜像。
2. **三个无认证HTTPS GET**：固定域名443的`/health`200/ok、`/ready`200/ready、`/api/merchant/stores`缺签名401。无私密包/Secret值/密码、JWT/HMAC/Cookie、登录或provision；不重试、不follow redirect、不关TLS。应用可能正常读取Aurora并写日志，不能称底层零数据库活动/零费用。
3. **一个Neon SERIALIZABLE事务、五语句、仅一条deployment的outputs/updated_at**：更新实际新stack/observation，新增`workloadRestorationV1`及前outputs完整JSON/摘要。原K2c人工receipt、plan/错误/幂等键、instance active、job succeeded/attempt1/max1/清lease、generation/epoch/authority全部保留。不重写ready时间、不创建job、不续租或初始化。DB时钟/精确九行摘要及行锁、原receipt、endpoint/身份/catalog、环境/订阅和承载/公开证明30秒事实窗口门禁。
4. **新进程独立Inspect**：仅AWS元数据与Neon只读回读，验证新栈/实际task/target及一行重绑定/不变量；不追加GET、私密读取或写入。不把K2c历史有效配置证明冒充本次新的认证control回读。

三新永久槽固定前缀`F:/ChatGPT_workshop/techlong-express-k3r-hosting-resume-v1`，分别`.permanent-slot.json`、`.write-slot.json`、`.inspect-slot.json`；各只消费一次，失败/UNKNOWN也不自动复位、补齐、回滚、重新创建或重试。CFN本身仍使用受审OnFailure=ROLLBACK/25分钟创建timeout，提供者可能自动回滚并删除新资源；脚本不额外Delete或补偿。

## 本轮真实只读准备

最终r2为30 SDK/14 CLI/2次Neon只读事务，当前确认：

- 原workload七资源DELETE_COMPLETE；现有service INACTIVE/0任务、日志/target group/活动task family/监听优先级无新占用。
- 父Cell16资源/模板/输出、IAM角色ID及完整既有策略、数据库available/17.9/网络模式、固定Secret版本元数据、ECR实际digest/manifest/扫描、DNS/DDB及原Janitor匹配。未直接连接Aurora或读Secret值。
- 当前平台仍保留历史active/ready/succeeded、旧stackId；旧lease已清、attempt1/max1，九条整行摘要与K2c独立读回完全相同。**记录ready不等于当前有运行承载**；恢复后才按本范围更新实际坐标。
- 原outputs为2669字节，原manual receipt完整，新restoration key缺失。PG18.6/身份/OID、endpoint摘要及catalog `3acdd88bfd8f8320a0191dcc97189b8ea39b08a34f0296e4df373abb43d84a1e`保持。仅outputs更新不触发status admission路径，Always sealed guard仍保护不同旧计划；未改函数/触发器/权限。

r1只读准备因误用旧`:1`镜像转换器停下，源码没有绕过验证；新observer直接比较实际已修复`:2`与原K2c固定规范摘要，原旧validator未改。r1 binding/state/failure保留、0槽/写；其部分元数据不冒充完整观察。r2成功后另进程重算manifest、当前全部binding、实际计划及五份原件hash，三槽均空；10项新+19项相邻测试共29通过、四文件ESLint零警告、三脚本语法/最终Check通过，没有重跑镜像CI或完整构建。

[准备摘要](../ops/aws-sandbox/reviews/aurora-dual-mode-k3r-hosting-resume.prepared.json)保存五份r2及三份r1原件hash、旧完整闭包/22份历史证据保持情况；实际20参数/模板及public payment参数只留本地F原件，不提交Git。没有新云/Neon写、应用HTTP、私密读取、Aurora连接或槽消费。

## 完整风险与确认

必须接受[固定完整风险](aws-auto-deployment-aurora-dual-mode-k3r-hosting-resume-risk.md)，raw SHA `e507bde3963a367851af02a3637144cbc735cdbf8389a085bba0ade5e2622564`，尤其是：**相对TTL派生规则、真实收费七资源、CFN自身ROLLBACK、创建/HTTP/Neon非原子与部分成功或提交不明、九行锁/并发DDL/30秒事实仍可漂移、没有新的认证有效配置证明、三个永久槽不复位/补齐/回滚或重试**。新两小时环境policy不改变父Cell旧tag/调度；Janitor保留但不保证准时清理或覆盖全部费用。

按本轮官方目录，单task两小时计算+一个公网IPv4约**0.0643 USD增量**；不含既有Cell/ALB/IP/Aurora/Secrets/ECR、日志/流量/额外调度/删除滞后及税费，不是本次或全月总价。准确目录、计费说明与排除项见完整风险；50USD/月仍是目标非cap。

建议确认文本（尚未收到）：

> 我确认按清单 `10242ff57c631458705efde250ea2805786d07d22965e263b1e79630e965b148` 执行K3r：一次七资源workload创建，接受TTL从实际执行startedAt起两小时的固定派生；三个无认证GET，一次Neon deployment输出重绑定及独立只读验收。保留已初始化数据库和原任务/历史，不再次provision、不新增IAM或改Secret/DNS/DDB，并接受完整风险、CFN自身回滚、非零费用及永久槽不自动复位或重试。

## 获准后唯一继续命令

先核对审批窗口、全部绑定及三槽未消费，平台仓运行一次：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-hosting-resume-v1.mjs --mode Run --manifest F:/ChatGPT_workshop/techlong-express-k3r-review-20261016-r2/manifest.json --approved-sha 10242ff57c631458705efde250ea2805786d07d22965e263b1e79630e965b148 --output F:/ChatGPT_workshop/techlong-express-k3r-run-20261016-r1
```

write intent/program/三GET证明完整后，新进程只读Inspect，不需要成功commit ack，但不会补写或再发GET：

```powershell
node --experimental-strip-types ops/aws-sandbox/scripts/review-express-hosting-resume-v1.mjs --mode Inspect --manifest F:/ChatGPT_workshop/techlong-express-k3r-review-20261016-r2/manifest.json --approved-sha 10242ff57c631458705efde250ea2805786d07d22965e263b1e79630e965b148 --run F:/ChatGPT_workshop/techlong-express-k3r-run-20261016-r1 --output F:/ChatGPT_workshop/techlong-express-k3r-inspect-20261016-r1
```

若创建结果不明且尚无write intent/program，保留根槽/已有证据，停止另做准确只读诊断；不能自动第二次Create或为了Inspect补造文件。没有自动监控、续期、资源退出或业务写批准。完成后只盘点剩余端用户业务/失败补偿/清理费用验收，不增加新Grant或generation轮次。
