# D2-6 app候选：两个OS高危项的最小修复

用户要求继续排除构建错误。本轮只处理app镜像扫描中的两个HIGH；不降低安全门槛，不改业务、工作流、身份或部署，不读取PAT/.env/Secret、不调用AWS或恢复环境。lifecycle其余项没有顺带修复。

## 原件及根因

从候选run43625892768的准确app artifact14125858964读取扫描诊断ZIP（18,180字节），SHA256为0840ba9964a9647eebc31a91f4c2798ace48aefb66924ed3939db5f6729e42c5；内层os-scan.json的SHA为09ec4e564e525e84822876e0977c99969ebd582145de6fe28159dad0ad44e13d，均与上轮原证据一致。镜像绑定为11ec9bb…/config digest98f072a6…，不是另一个构建或推导报告。只下载诊断，不下载镜像候选ZIP。

两条报告均为zlib1g：CVE-2026-76844、CVE-2026-85091，InstalledVersion为1:1.3.dfsg+really1.3.1-1+b1，FixedVersion为1:1.3.dfsg+really1.3.1-1+deb13u1。[Debian 85091状态](https://security-tracker.debian.org/tracker/CVE-2026-85091)、[76844状态](https://security-tracker.debian.org/tracker/CVE-2026-76844)均把trixie security该版本列为fixed。76844的标题描述与zlib名称不一致，原样记录此差异，不自行改CVE映射、加例外或把它当成可忽略项；修复包并保留新鲜原扫描门槛。

## 唯一运行修改

app Dockerfile最终阶段仍是官方gcr.io/distroless/cc-debian13:nonroot，仅固定digest由e792ab3d…改为cb87acc574abe719b6e5c547384defa2f7b1f24af9605d3f618cf852495d8be2，不增加阶段、包管理器/壳、手工库覆盖或库存伪造。三个Node24.18.0构建阶段及其他文件保持。

官方GCR公共index正文SHA与Docker-Content-Digest一致；其linux/amd64 child为de02e95a878d4662f7a0f93bffb3799e08e04cc5a53f6a9c0593a20eaf4dc80e，config为d6f64fa799667e9af6c4c841910b7c10cfe146b580027b2187779bf95932eb32，均核对原文SHA。config为Linux/amd64、User65532。只补读95,974字节的zlib层208bf18b…并验证SHA；内存tar核对实体usr/lib/x86_64-linux-gnu/libz.so.1.3.1和准确var/lib/dpkg/status.d/zlib1g，其Version为上述修复版本。没有把md5sums当包状态，也没有删除库存；这不是cosign签名验证或整个新镜像已扫描的证明。

本次源码只有三文件：Dockerfile一处digest、原container_artifact测试的一处对应digest、新增一个旧zlib仍应被拒绝的原安全门槛测试（即使FixedVersion非空，两个HIGH仍阻挡旧镜像）。lifecycle Dockerfile和候选工作流原字节保持。相关21项本地回归全通过/skip0，类型通过；旧依赖8项回归保持成功。

## 源码/CI及停止边界

后端源码fe8273899d4251267666807cf965ce52970a13e9已推main；原用户.vscode文件未改未提交。只跟进该push/attempt1的[Backend CI43627155472](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/43627155472)与[候选43627155229](https://github.com/veinyyxy/SpeedFeast_Backend_main/actions/runs/43627155229)，无手动dispatch/Re-run。最终结论只据准确job/步骤和扫描摘要记录，不能仅凭官方层版本声称app已验收。

原候选矩阵包含lifecycle；即使app job独立通过并保存checked-app，若整体run因lifecycle失败，现有版本导入合同仍拒绝该run，不能据此称已取得可晋升版本。当前不改合同放行失败run，也不借此扩生命周期61项修复。D2-6真实更新仍0，runtime关闭，旧AWS/Neon事实不续期；目录/IAM/Secret/SQL/恢复/更新均仍另审。

## 最终结果与必要耦合诊断

准确Backend CI43627155472已completed/success：320测试全过/skip0，14项Python、镜像构建/inspect与合成环境启动smoke成功。候选43627155229的app job132545522243全成功，OS HIGH0/CRITICAL0/包库存14保持，归档checked-app artifact14126707042已保存（72,654,081字节，到期2026-11-15T18:33:13Z），仅回读元数据，没有下载或读取归档内容。[去敏run/job/扫描摘要/归档引用](aws-instance-release-app-zlib-fix-ci-20261114.json)。

整个候选run仍failure：lifecycle job132545521909的OS门槛仍HIGH61/CRITICAL0。`lib/deployments/releases/production.ts:61`确实要求run整体success，不会因为app成功自动放行；本轮没有修改该合同。仅为定位这个仍阻挡主线的耦合，补读同run扫描artifact14126681971（27,421字节），ZIP SHA912fcf05…、报告SHAeddd9856…均核对原摘要，未修改镜像或执行代码。61条归并为：

| 包组 | HIGH条数 | 当前版本 | 报告给出的修复版本 |
| --- | --- | --- | --- |
| libgssapi-krb5-2、libk5crypto3、libkrb5-3、libkrb5support0 | 各14，共56 | 1.21.3-5+deb13u1 | 未给出 |
| libsqlite3-0 | 3 | 3.46.1-7+deb13u2 | 未给出 |
| zlib1g | 2 | 1:1.3.dfsg+really1.3.1-1+b1 | 1:1.3.dfsg+really1.3.1-1+deb13u1 |

报告没有FixedVersion不等于证明所有上游/发行版都无修复；没有据此添加忽略项、删除库存或猜测可用版本。调整Kerberos/libpq或Python功能会超出app基础层补丁，不自行裁剪。app两个OS项的修复已完成；整个源构建尚不可晋升，两件事分别记录。

下一唯一建议：由用户确认后，先离线准备最小app/lifecycle构建隔离方案，使日常API版本更新只依赖app自身全部严格检查，不要求数据库工具镜像同时合格；不把失败整体run直接放行，不放松任何扫描门槛。是否调整工作流/来源合同或改选生命周期工具链修复，须明确范围后再编码，当前不自动扩展。本轮无AWS/生产读取/私密值/手动dispatch/恢复或ECR发布；旧事实期限保持。
