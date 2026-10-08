# F3b3：PG18.6云端证明与只读ownership source v3完成，未安装

2026-10-08 Winnipeg。完成前阶段的PG18验证缺口和独立证书型source代码。本轮GitHub Actions只创建/清理自己的临时服务与合成数据库，不使用AWS/Neon凭据；没有Neon DDL/登记、AWS权限/资源变更、默认Worker/Scheduler启用或旧记录删除。**F3b3/自动部署尚未整体完成，source v3没有接入实际删除入口。**

## 固定版本真实云端验证

新增手动工作流 `.github/workflows/sealed-plan-postgres18.yml`，Ubuntu24.04/Node22.19，固定官方 `postgres:18.6-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873` 与三个Action commit SHA，permissions仅contents:read、无OIDC/仓库Secrets。无需本地Docker；服务属于该CI任务。[GitHub官方服务容器说明](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)

首轮 [37800779231](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37800779231)，head9a31c7aef5b56af5a5ae48a3cd235123ebb5b916/attempt1 success，验证原SQL候选的11组真实schema/永久guard/并发/业务连续性证明。第二轮 [37804488475](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37804488475)，headf83d1fb0e3a0f3bfcf4d99c06db1f05e3556e367/attempt1 success，增加source v3实际只读角色、future可见性、替换helper拒绝和完整原件保留，共14组。均明确断言serverVersion180006，不把PG16或不同patch当本轮版本。

两轮完整平台schema/合成数据都使用新建、随机命名、cell_admin非superuser所有的数据库；最终DROP仅本次创建的数据库，docker stop仅job.services绑定的容器，独立状态false。数据库删除与容器停止属于已授权测试清理，不涉及Neon、RDS、ECS、旧云slot或用户业务数据库。CI中ssl=false只限本机映射的临时服务，不是线上TLS证明；PG18服务不是Neon分支/权限/安装后的在线证明。

`read-sealed-pg18-proof.ps1`用Git现有凭据只读取准确run/artifact，绑定head/path/main/attempt1/success，原ZIP与GitHub artifact digest复算一致，仅接受四个固定成员；核对PG18.6、固定image、CI数据库drop、容器stopped以及各false授权字段。首轮私有目录 `F:/ChatGPT_workshop/techlong-f3b3-pg18-ci-20261008-a1`，独立verification SHA `6a06d78ff34f8c20376e56a1df7615dbfeb4a41f6cf559c975a7182923301af9`。第二轮a2 verification SHA `f28fbe6d3a9707e547f84b3f7be7dbefe0b6ea5ad4f23db2725a93f8f8391340`，raw ZIP SHA `281089c59d1a896ad5a1e5995613d4ca89518aa25f8cf92eb915a230bc8d763d`、report SHA `9e391e58b612d9bd4720c8c43d6239bddb10f9ce0aef4433acb93386086ded38`、receipt SHA `cc08bdc09aa88fb9e33180fd85cbdee8ce7420e42a06dc7140d8b72a1c4fbe41`。原件不提交Git。

## 新只读source v3

`neon-sealed-cell-ownership-source-v3.ts`构造时不连接，独立方法 `readCertifiedSerializableSnapshot` 不实现旧schema2接口。只接受固定account/region/cell/environment和完整预期登记证书pin，factory仅接受既定cleanup_reader/Neon/TLS URL；实际读事务再验证准确角色、无super/createdb/createrole/bypassRLS、无任何public表owner/write与schema CREATE资格。不存在缺失证书或schema时的空数组fallback。

事务在Serializable/readOnly/deferrable下使用局部pg_catalog search_path，九个请求包括完整环境/admission、证书/原行/planbytes/永久fence、五类原始ownership集合和全部active instance→deployment关联。证书全部十字段与预期post-commit pin匹配，live原行/planbytes/plan_hash和当前保护catalog一致；历史business preimage仅是证书审计pin，不能冻结后来业务status变化。

独立 `sealed-plan-catalog-read-v1.ts` 直接读系统catalog重算与DDL同格式的指纹，**不执行可能被owner替换的SECURITY DEFINER指纹helper再信它自报的hash**。所有调用限定pg_catalog；同时核对静态helper prosrc SHA `16e82ac1c8b9589a332cd64dbd93f4b197c5062a9c655c7b0f5d88b1302d8e66`、语言/返回类型/无参数/search_path/owner关系。PG18真实trap测试把helper替换为RAISE程序，source仍读catalog并以证书/保护失配拒绝，未执行trap。SQL候选自身仍原SHA `c088d1a8c75705c88d3f2bfc38cc6070c731de4cac6cd891c91af821a4e3a57a`，没有改写历史proof。

只有精确密封旧deployment可以分类为非owner；activeTenant按完整关联集合计算，任何新未密封deployment（甚至terminal关联，延续旧语义）都保持该active instance可见。资源/容量/调度集合不加过滤。新state hash分域为sealed-cell-ownership-v3，包含证书/保护、admission、全部分类集合以及未删减的raw witness，dbObservedAt单独保留供后续freshness适配。返回runtimeActivationAuthorized=false，不是grant/deletion批准。实际PG18验证覆盖新queued部署保留非零，以及fixture终结/非活跃后的证书型零集合；active实例只有旧密封记录的分类分支另有定向单测。

152项清理/隔离/source相邻回归（含新增6项source单测）、typecheck、定向lint、PowerShell AST与production build通过。pg8.16.3仅作固定devDependency支持CI客户端；没有重建app/lifecycle镜像或Lambda包。旧schema2 source、旧Janitor/IAM/PLAN_ONLY、旧删除core与v2 root保持原样，没有把v3降级映射成旧证据。

## 下一小阶段

1. 实现v3独立freshness/admission/authority/deletion证据适配与版本化接线；完整证书/原始集合必须进新plan/hash，不能直接把schema3转换成旧schema2或忽略字段。实际运行仍关闭。
2. 只读核对Neon准确schema、owner与最小角色权限，编制fresh安装范围。SQL安装与准确单行永久登记分别批准，预期证书来自独立批准/提交/回读收据，不来自event或任意DB行；目前仍无生产登记执行器。
3. 专属IAM/Secret/Lambda/authority/schedule与真实Cell仍各按具体范围批准。旧1/1门禁没有因本轮代码变零；50USD/月目标、旧Budget与所有旧记录/slot/镜像保留。

资源与证据草案 `ops/aws-sandbox/reviews/f3b3-sealed-ownership-v3.prepared.json` 的所有安装/Neon写入/AWS写入/runtime授权false。两个main按默认授权提交推送，服务端只同步进度。
