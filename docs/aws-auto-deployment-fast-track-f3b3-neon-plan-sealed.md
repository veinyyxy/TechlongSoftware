# F3b3：准确旧计划已永久登记密封，v3运行时尚未启用

2026-10-08 Winnipeg。用户明确批准登记清单 `1fba989e681c6e7bb0c71178adfde6686f618359ad9e422db549b7b038aab333` 后，原受审代码只执行一次准确证书 INSERT 及既有 trigger 的内部 fence finalize，COMMIT确认成功。新连接独立只读回读完整证书通过，另一次 VerifyRegistration 也通过；两份证书 canonical SHA 一致。**本次完成准确单行永久登记，不是自动部署或 v3删除运行时启用。**

## 实际结果与边界

准确目标仍为 `dep_d00144511731f1c20991aa56` / `env_aws_sandbox_ca_central_1` / `app_fb1962e93a9a4cc2acf046170593d9e3`。

- registry行数1，approved_registration_sha256为本次准确批准SHA；sealed_at为DB事务时间 `1791480771883`（2026-10-08 17:32:51.883UTC）。
- 内部fence sealed=true、revision=2、sealed_at与证书一致；两次revision变化由原validator/finalize trigger在同一事务内完成，未直接改业务原件。
- 原计划仍planned/plan_only，原行/plan字节未变。实例pending、订阅active及完整批准业务preimage不变，旧immutable trigger与已有角色不变。
- 原行SHA `9f2cc13138f577783c72d86ea7caa5ab0f80d9b3e394748c4b651e0f70c41a11`；plan字节SHA与original_plan_hash均为 `00a57bb81fdaaf91d5a846e00608c7aea89412acf24ae1b4b391e0ec682d40b5`；历史business state SHA `6364420b1903d8588515e5efb423b01cfb9494f060a776e1db6395a4d921f659`。
- protection catalog SHA仍为 `41eea5ac8b64801144fa568dce2b42d5dcb350a520a82df91f973c23bedab168`，八函数/十六Always guards与准确引用闭包通过原校验。没有修改schema安装字节。
- 拟议reader/writer/registrar控制角色仍0；本次未创建角色、授权或Secret，未调用/修改AWS、上传baseline、重建镜像/Lambda包或启用Worker/Scheduler/runtime。50USD/月目标、旧Budget及所有历史记录保留。

完整十字段证书位于私有独立回读文件的 `certificate` 字段，sealed_at已规范为number；canonical证书SHA为 `dc093614188a8f0a086b4fc6a7e251c43312495a60db2efffc654cf3d48b066f`，两次回读逐值一致。之后source v3的expectedRegisteredCertificate必须来自这份已批准提交后的独立证书pin，不能从event或任意未核验DB行推导。业务原件/原plan JSON不入Git。

永久登记意味着原计划/登记/fence不能更新、删除、truncate或重新领取执行引用；本次不运行旧计划。其他业务status的后续合法变化或新deployment不因本次登记被冻结，仍由已验证guard协议和原admission规则处理；不是忽略future未密封部署。旧schema2路径未改，不用它消费v3证书；cleanup_reader与drain条件未安装/满足前，不能宣称线上v3零租户证据或删除权限可用。

## 执行证据与禁止重放

私有目录 `F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-register-a1`：

- submission SHA `b805b34f8186c5bccede66cefb5d05e0b39d754368da6459e2d399588e29564d`，COMMIT_CONFIRMED_REQUIRES_INDEPENDENT_READBACK、commitConfirmed=true、slotConsumed=true、failureCode=null、retryAuthorized=false。
- 新连接独立readback SHA `d7f609f0e7c341c8cb0e847f2fab90f8749292ab9265af654159e655ad2d712a`，EXACT_CERTIFICATE_INDEPENDENT_READBACK_VERIFIED。
- 原始只读observation SHA `09b28ba4b11bc4be433f496a202721009c9db0c3b9b5d0bc68a4cd3dc6871294`；完整poststate SHA `1e495dd1299d1849fb5cfaf678abf84f4e7ffa12896f283255ccb79a5d6813e8`。

另次 VerifyRegistration 私有目录 `F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-register-verify-a1`，readback SHA `2b8b75e2fa4d20a17c5d9cad8561d1a6f1e9321cb056b6b9f5c4786f8ce3651e`，同样完整独立校验成功。此操作只读，不是重复登记。

`F:/ChatGPT_workshop/techlong-f3b3-sealed-register-v1-consumed` 已永久占用，原批准manifest文件SHA `19d52eb3546e67c936a6053e078528ce6f8b35c9e453ba414483d7afa202a80f` 与批准前原件相同。install槽位也仍永久占用。**不要RunRegistration/RunInstall、刷新清单重放、复位槽位、down或删除密封证据。** 后续如需调查只运行新输出目录的Verify/只读操作。

同一管理实现 `554b125155adb4ed5d632c3627327c788bf91430` / code SHA `38c479f4204d088925077fb39915b86ab5db33d8606814a47e3943a54cf67447` / schema C088 SHA 未改，继续对应32项定向与真实PG18 [run37813739467](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37813739467)/19组证明。本次采用真实Neon登记和两次独立只读核验，没有重复离线模拟/CI。

## 下一阶段

1. 实现并验证严格v3持久authority解码/CAS、永久一次性journal、独立executor root与新包，将完整证书/raw state/准确身份带入新plan/hash。当前v3仅有prepared候选与证据适配，不用旧v2记录/包桥接，不打开默认Worker。
2. 基于已提交独立证书pin，准备最小DB reader/drain writer及Secrets的具体权限/资源范围、只读capability预检和审批入口；密封登记不是这些新增权限的授权。实际DB角色/GRANT/Secret/IAM/Lambda安装均单独按fresh范围确认。
3. 然后集中处理authority/schedule、DNS/mTLS/baseline和真实Cell/单租户闭环，仍以50USD/月目标和具体部署审批边界推进。不要复用已消费旧publisher/grant/DB槽位或改写历史证据。

本仓和服务端main按默认Git授权直接记录推送，服务端生产代码与镜像不变。历史schema-installed/prepared文件保留原时间点状态，当前完成记录 `ops/aws-sandbox/reviews/f3b3-neon-plan-sealed.completed.json`。
