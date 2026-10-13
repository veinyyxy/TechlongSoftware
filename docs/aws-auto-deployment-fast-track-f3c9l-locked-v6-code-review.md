# F3c9l：锁定期一次 V6 代码更新清单，未执行

2026-10-13 Winnipeg。旧零资源身份已独立退役后，先完成KMS兼容V6代码的云安装准备，不提前启动新的birth TTL。复用F3c9i最终r2 ZIP，不重建镜像/包、不做离线数据库模拟。8项新增和5项相邻测试共13项通过，typecheck、lint零警告及语法检查通过；真实在线只读审阅及另一个新进程回读一致。**本轮云写、Invoke、Secret值读取、Neon连接和新槽消费均为0。**

## 唯一拟更新资源与范围

```text
arn:aws:lambda:ca-central-1:402010193138:function:techlong-sandbox-cell-lifecycle-coordinator-v3
```

最多一次 `lambda:UpdateFunctionCode`：当前准确Revision `4a5f64bb-f47e-4e56-a468-1364f4381767` 为前置条件，`Publish=false`、`DryRun=false`、架构保持x86_64，只更新未发布的 `$LATEST` 代码。handler、Node22、256MB/120s、空env/layers/VPC、所有其它配置/标签/role、deny-all仅v1、空角色策略、并发0、日志7天及parent/workflow缺失保持。

async已是age60/retry0/空destination，**本次不重写它**。不发布版本/建alias、改变并发、Invoke、建触发器、安装IAM、改Secret/Key/Neon/table/parent、创建身份或付费Cell，不上传S3。新候选只是KMS兼容reader代码，不授予实际解密或业务写权限；KMS转发、实际有限gate和runtime尚未验证/启用。

冻结候选：

- ZIP `a1f3807de8f15bf1d3ef3f37d8ba5aa626e610104a488ab66e3cf05330dadbae`，432966字节，CodeSha256 `ofOAfejxW/HT7z832LpapibmEBBKSIq2bjzwUzDa264=`。
- bundle `5ea6974456883d836764489c01357a003ca4c20cdea6ff704bba1d82858723b4`；原构建报告 `71e787390299e73a369547fa4f421c543b25ffc69b772eb9554be733e9b98662`。
- 候选来源 `F:/ChatGPT_workshop/techlong-f3c9i-kms-parent-bundle-20261013-r2/`，现有源码pins、package-lock、ZIP解压/内部文件hash均再核验；未重新运行构建。
- 候选报告中的旧Stack权限摘要仅为历史示例，**不安装已删除UUID的权限**；未来新身份IAM材料另编译、记录实际V6policy digest，不能把legacy兼容metadataHash当实际文档字节摘要。

## 新清单与实际只读证据

待批准SHA：`9a6598007275766845e0da0a3657f01c33ae9899032188685b3c8bcaaced7c7d`。

- 有效窗口：**2026-10-13 14:19:59.677–15:19:59.677 UTC**；Winnipeg **09:19:59.677–10:19:59.677 CDT**。
- 132代码绑定：`80bf86b1a22b75aa0512f27f64df562039fb49c57e6146d479a67422626e349e`；原128文件、旧包及已消费创建/退役/恢复槽、全部回执保持。
- 清单文件SHA：`7b98299a0a0856b526b16be5e41a77889092c34ad1e296aaf59642203d5a3ec7`；Review报告SHA：`284b9e2ab6c8ac2ad5d7d75977727609126ff5a3bf9bde87eb198fb20f946817`；完整前态文件SHA：`c098db3a4167aa3b751c4ae3d12c8fe0bdb85c56c141d0f482e434fccdad3a0a`。
- 完整原r3 snapshot `5e758fe60104f0baa813f0742115b81a09b3c618a87d2a304e7514f53d3e0ab0`；保留配置/锁/async的不变量 `6210b806af9fd439b53efe5879950f870f01ee7f954164466fcbb7232c359dda`。
- **14:22:22.913 UTC / Winnipeg09:22:22.913** 独立新进程回读一致：`LOCKED_V6_CODE_BEFORE_OR_UNATTRIBUTED_INSPECT_ONLY`，variant=before、candidateInstalled=false、新槽缺失。报告SHA `fd77ed0d6b9d059382e2b7da289c1401dc3ffb46efb55895ad42d34791959557`，完整metadata文件SHA `b3a4e1764263636f6027bde64d4967ef374d01f979dabb1827d23d2c497f9e90`。

Source精确IAM User有效；UpdateFunctionCode的准确未限定ARN及同一 `$LATEST` ARN两项模拟allowed、无missing context，非实际服务权限/代码部署证明。实际仍r3 ZIP `b53ba821...`、CodeSha `tTuoIc4mGbkMTZQeW8SWmxMdTp53fzSYp1Mg3soTbkc=`、Revision4a5f64bb...、Active/Successful。15个原完整锁门禁全部通过，roleId/trust/deny-all/空策略/标签/concurrency0/日志/table无policy/全parent槽缺失/identity名称缺失/无URL-别名-发布版本-映射/default bus targets及原async保持。只证明这些受审事实，不推广为所有bus或所有外部调用绝对缺失。

私有审阅：`F:/ChatGPT_workshop/techlong-f3c9l-v6-code-20261013-r1/`，独立回读在同前缀 `-independent-before-inspect/`。未创建 `techlong-f3c9l-locked-v6-code-update.permanent-slot.json`，未运行Run。

## 执行准备方式

新入口Review/Run/独立Inspect分开。Run须准确新SHA/代码/窗口，原材料、旧槽及Source/权限模拟复查、两轮完整锁状态匹配并先保存证据，再消费唯一新永久槽、保存attempt。消费后完整锁事实不整组重读，其最早读取至提交不超过30秒；最后Source身份及Revision/窗口/年龄检查通过才发送一次更新。

使用已有pinned Smithy SigV4组件，固定HTTPS host/函数名/region及PUT路径；将已校验ZIP复制到内存并base64内联，**不在提交时按路径重读ZIP**。无手工写重试、redirect=error，不打印/保存签名headers、credentials、原始提供者异常或请求payload。AWS [UpdateFunctionCode API](https://docs.aws.amazon.com/lambda/latest/api/API_UpdateFunctionCode.html)支持内联ZipFile与RevisionId条件；这不是IAM/表/并发等跨服务CAS。

记录批准、Source/文件/模拟、完整前态、保存、消费槽、提交、等待ready、最终锁回读各阶段时间和有界错误。成功响应后只读等待Active/Successful/准确新CodeSha，再双读所有锁及async不变量，保存实际完成Revision。最后必须新进程Inspect；CodeSha/CodeSize/完成Revision、全部原配置/role/锁/async和新槽匹配才确认代码安装。元数据验收不是实际Lambda运行、KMS解密或业务部署验收。

## 完整风险：实际更新前须确认

1. 代码更新及就绪是异步过程，响应Revision可能不同于最终完成Revision；响应丢失、失败或回读失败可能遗留候选代码。即使未能完成验收，也禁止自动rollback、补齐、第二次更新或复位槽。
2. RevisionId只约束目标Lambda的匹配版本，不锁住IAM、concurrency、table、其它服务或所有人工操作。完整锁事实在消费槽后只使用最多30秒缓存；读检查非CAS，并发漂移不能绝对排除。并发0不取消已在运行的调用，metadata并不证明绝对有效Deny或没有队列/其它bus活动。
3. Node22 RuntimeManagement Auto可能在更新期间自动patch runtime ARN；不改这个模式。全部应用配置/未知配置字段、role/trust/边界/原tags/表/async/并发/缺失parent等仍逐项绑定，不把任意其它变化当输出差异忽略。
4. 候选包含未来guarded业务写能力，但本次仍deny-all/空策略/concurrency0且不Invoke/登记。代码安装不证明实际KMS转发或完整业务路径。IAM、代码签名/提供者接受度、网络及就绪不能由本次模拟或本地测试保证。
5. 新永久槽wx+flush在API前消费，消费后即使实际写0也永久保留。槽部分保存、阶段/证据保存、凭据自动刷新或网络失败可导致状态不明；只有独立Inspect，无自动删除槽/复位/重试/补写/回滚。提供者日志可能记录账号、ARN和requestId；本流程不读Secret值或连接DB。
6. 低成本但非绝对零费用，既有Secret/日志等收费可能持续；50USD/月是目标，不是硬cap、账户总账单保证或实时停止开关。

## 下一位置

现在等待本新SHA、一次准确代码更新范围及完整风险批准；本轮仅准备与只读核验，不能按泛化“下一步”自动PUT。若窗口过期且新槽仍空，只读刷新清单另批；旧创建/退役/恢复槽及原代码更新槽不复用。

独立安装通过后，在仍锁定状态准备剩余新identity创建、真实新ARN的V6 IAM/table短窗口/Source parent材料和固定有限gate，长时准备尽量先于新TTL。新创建、安装权限、登记、短暂运行门禁及ARMED/PAID各按准确新范围另批；当前runtime/F3整体未完成，不自动重新创建过期旧身份。
