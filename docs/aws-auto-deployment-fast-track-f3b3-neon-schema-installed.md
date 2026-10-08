# F3b3：Neon 保护 schema 已安装，旧计划尚未登记

2026-10-08 Winnipeg。用户明确批准仅安装清单 `ce844c9096de5c71cf3d3447916143260d336292180dbf2193f3b256d67fb36b` 后，执行原受审代码/SQL一次并成功提交；新连接独立只读回读通过，随后另一次 VerifyInstall 只读核验也通过。**本次仅 schema 安装完成，不是旧计划登记、最小角色/授权安装、v3 runtime 或自动部署上线。**

## 已执行范围与核验

- 现有 Neon PG18.6，管理/保护对象 owner 为 neondb_owner；准确 TLS target/code/prestate/一小时窗口均由原入口验证。
- 原 C088 SQL SHA `c088d1a8c75705c88d3f2bfc38cc6070c731de4cac6cd891c91af821a4e3a57a` 未改变。只创建两张内部保护表、八个函数、十六个 Always 触发器，并插入一条未密封内部 fence。
- 实际 catalog 新对象26，16/16触发器 Always；函数 body/owner/language/definer/search_path/参数/返回类型/PUBLIC execute 与准确 trigger profile、完整引用闭包通过验证。独立 protection catalog SHA `41eea5ac8b64801144fa568dce2b42d5dcb350a520a82df91f973c23bedab168`。
- 新对象的 PUBLIC 权限按原批准SQL撤销，不授予控制角色权限；这不应表述为“没有任何新对象ACL写入”。既有角色/授权没有修改。
- fence 对象 `dep_d00144511731f1c20991aa56` 为 sealed=false、revision0、sealed_at=null；登记表行数0。原行、原 plan、实例 pending/订阅 active、旧不可变 trigger 和现有角色与批准 prestate 完全一致。未创建拟议三个控制角色或授予权限。
- 执行未登记、更新或删除业务原件，未修改 AWS/旧 Budget、上传 baseline、重建镜像或 Lambda 包；默认 Worker/Scheduler/runtime 保持关闭。旧 schema2 门禁没有放宽，source v3 仍未启用。

固定槽位 `F:/ChatGPT_workshop/techlong-f3b3-sealed-install-v1-consumed` 已永久占用，保留原批准 manifest；文件 SHA `4f274e1f5cfd09a52e2c8dd688c4e96ac102b415a111cd25323b0b31d19bafe0` 与批准前原件相同。**不要再次 RunInstall、复位槽位或自动 down。** 登记槽位仍不存在，安装批准不能用于登记。

## 实际执行证据

私有执行目录 `F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-install-a1`：

- submission-receipt SHA `f3e3f493f4c7173b6237695696418ba52f2d3c293b5fe19d626bc545e32dc371`，COMMIT_CONFIRMED_REQUIRES_INDEPENDENT_READBACK、slotConsumed=true、commitConfirmed=true、failureCode=null、retryAuthorized=false。
- 新连接独立 readback SHA `2f99cc6974a27799023a1d72fd533bc97de738527aa6c8bd679649b2839f6726`，SCHEMA_INSTALLED_UNREGISTERED_READBACK_VERIFIED。
- 原始只读 observation SHA `dfc29562b0cf4f2c2ea2405989052b7c53e9e7e7b33c7c7f5675171825ec3141`。

另一次 VerifyInstall 私有目录 `F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-install-verify-a1`，独立 readback SHA `a78d2fc1b4ba374ea09a0dbd7438aa7d2e4ab34d047c89ce57d45638a023ea5b`，同样为 schema已安装/未登记；没有写入或重试。只读后继审阅的私有业务 preimage 文件 SHA 仍是 `c53e659d644894377de56d2a72b40dc5a84dc605490de4b0c9dd1282bfaed5c6`，与安装前相同。

管理代码保持 `554b125155adb4ed5d632c3627327c788bf91430` 验证版本及 composite code SHA `38c479f4204d088925077fb39915b86ab5db33d8606814a47e3943a54cf67447`。此前32项定向及真实PG18 [run37813739467](https://github.com/veinyyxy/TechlongSoftware/actions/runs/37813739467)/19组证明仍对应同一代码；本次没有代码改动，不重复离线模拟或CI。Neon实际安装/两次独立只读核验才是本轮在线完成证据。

## 下一步：准确单行永久登记，尚未批准

安装后已仅执行 ReviewRegistration 的只读审阅，完整 installed guard/catalog、原件/业务和空登记/fence prestate 都绑定新清单。没有调用 RunRegistration。

私有目录 `F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-register-review-a1`：

- manifest SHA `1fba989e681c6e7bb0c71178adfde6686f618359ad9e422db549b7b038aab333`。
- JSON 文件 SHA `19d52eb3546e67c936a6053e078528ce6f8b35c9e453ba414483d7afa202a80f`。
- prestate SHA `138fd3d4d711b5db469cf35113c0779f97aef64dd888a279a9c9195513b95616`；只读 preflight 文件 SHA `752d31a682c16beaa96dcee673aa43174cbb3f8db56713dc4c9ac94afec3554d`。
- 原行 SHA `9f2cc13138f577783c72d86ea7caa5ab0f80d9b3e394748c4b651e0f70c41a11`、business state SHA `6364420b1903d8588515e5efb423b01cfb9494f060a776e1db6395a4d921f659`、protection SHA如上。原行/业务 JSON 不入Git。
- 审阅时间2026-10-08 17:21:21.014UTC，**过期18:21:21UTC / 13:21:21 Winnipeg**。

登记批准必须仅涵盖：向 registry 插入这一条准确旧计划证书（批准 SHA 作为 audit pin、sealed_at 为DB事务时钟），由既有 trigger 将内部 fence sealed=true/revision增二，随后新连接独立只读核对完整证书。原记录、实例和订阅原件保留；不运行旧计划、不改/删业务、不创建角色或权限、不改 AWS、不启用 runtime；接受永久密封/引用限制、短暂写锁、提交后不自动 down及登记固定槽位领取后不自动复位/重试。过期/漂移在写前停止，仅刷新只读清单并再确认新SHA；未知提交只读恢复。

如果用户明确批准且窗口/pin仍有效，才能执行如下命令（本轮未运行）：

```powershell
node --experimental-strip-types --env-file-if-exists=.env.local ops/aws-sandbox/scripts/review-f3b3-sealed-management.mjs --mode RunRegistration --out F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-register-a1 --manifest F:/ChatGPT_workshop/techlong-f3b3-sealed-management-20261008-register-review-a1/review-manifest.json --approved-sha 1fba989e681c6e7bb0c71178adfde6686f618359ad9e422db549b7b038aab333
```

精确登记和独立证书回读后，继续最小 DB reader/writer/Secrets、v3持久 authority/CAS/永久journal/独立root及新包；云IAM/资源/真实Cell各单独批准，50USD/月目标不变。两个main按默认Git授权直接提交推送，服务端仅同步文档。历史prepared清单与证据保留不回写授权标志，新实际状态记录 `ops/aws-sandbox/reviews/f3b3-neon-schema-installed.completed.json`。
