# W8b：Node受审托管启动与私密供给候选

## 本阶段已经接通什么

W8a已兼容本机/托管来源，本阶段复用原Node start、ALB ingress和V6控制器，接通显式托管启动与服务端binding。默认Docker命令仍是原关闭入口；不改UI、不新增执行器、身份、数据库schema或云工作流，不读取真实密钥或部署AWS。

只有未来按具体范围获批的启动才能使用`node ops/platform-hosting-v1/start.mjs --hosted-controller`。**这里是代码接口，不是本轮实际运行授权或可直接执行的生产命令。** 此模式要求固定ALB HTTPS入口、已发布release、W8a有效托管租约、准确`TECHLONG_PLATFORM_HOSTED_SOURCE_COMMIT`与租约源码一致；本机/托管混合模式、摘要错误、过期、来源或源码不符均在供给控制器私密值前拒绝。原默认启动继续拒绝注入启用开关或私密控制变量。

## 私密供给与进程边界

- 只向原控制器提供`TECHLONG_PLATFORM_CONTROLLER_DATABASE_URL`和`TECHLONG_PLATFORM_CONTROLLER_PRIVATE_KEY`；不以Web的DATABASE_URL、数据库owner或AWS Source身份作替代。原专用数据库角色/TLS/准确目标校验及GitHub App校验仍在实际使用时执行。
- 启动先验证公开配置，不求值这两项私密getter。有效能力内第一次使用时才读取对应环境值，进程内缓存；之后不因环境被修改而换用另一个值。该缓存不是Secret版本证明；未来部署清单必须绑定实际注入的固定版本。
- 原生Node入口与构建后的服务端别名通过固定进程内Symbol共享能力，避免打包后得到两份不相通的模块状态。只有本模块已验证的对象能安装，单进程不替换、不续期；此机制是可信服务端代码内的能力隔离，不是抵御同进程任意代码执行的边界。
- 到期、非法时钟或时钟回退后永久关闭，清空该缓存；私密getter返回null，阻断原控制器的process.env回退。不会因时钟恢复、改布尔值或换租约字符串重新开放。
- 禁止AWS Source/WebIdentity/容器task-role凭据、任意SDK endpoint和Node/vinext绕过参数；未来任务使用execution role供ECS管理拉取，不向Web进程开放AWS执行凭据。

**应用层惰性供给不等于ECS惰性读取Secret。** 如果未来使用ECS Secrets注入，ECS会在进程启动前读取值，即使应用随后拒绝过期配置也可能已经取过Secret。环境、已返回字符串、导入后的CryptoKey或在途令牌不能保证从内存擦除；cache.clear也不是安全擦除。实际装载/固定版本/权限及此暴露风险必须另审，不能沿用本轮“未读真实Secret”的事实作为未来零读取承诺。

## 到期语义与费用

最多30分钟的控制能力窗口保持不变，既不是审核清单有效期，也不延长云任务领取窗口。定时器关闭控制能力但**不停止Web健康/登录服务、不删除资源、不撤IAM或数据库LOGIN**，避免desired ECS服务在同一过期租约下不断重启、重新拉取Secret。承载及保留资源仍可能收费；50USD/月是目标不是硬上限，临时试验的实际清理仍单独批准。

能力截止不能撤销已在途请求或已签发App token。原控制器仍在提交前复核，并在成功/失败后尝试撤销token；外部杀进程、10秒强制停机窗口、网络或提供者失败可能令清理未完成。没有自动重试、强制回滚、重新开槽或扩大权限来补偿；未来真实验收须接受并保存独立核验位置。

## 容器与验证

运行镜像只额外复制4个公开TS模块（configuration、contract、installed-binding、hash），与原控制器共用实现，不复制完整工程或私密文件。使用锁定Node24的erasable TypeScript支持，不加依赖或npm脚本；[Node官方TypeScript说明](https://nodejs.org/api/typescript.html)描述了内建type stripping及其不执行类型检查的限制，类型检查仍独立运行。

本机87项相关新旧测试通过、0跳过，其中8项新增检查覆盖惰性读取、非法配置不读私密值、模式来源、时钟失效永久关闭、Web数据库不能回退、重复安装拒绝、独立模块副本共享能力及CI约束。另有类型检查与定向零警告lint。没有真实App key、AWS或生产数据库参与测试；此前已有的云执行81/76闭包、发布binding和已消费槽保持。

原No-AWS hosting CI增加一项**真实容器**验证：无网络、只读、非root、无数据库/私钥/Secret/TLS凭据，在容器内生成25秒合成租约；启动明确托管模式，health200、未认证控制API401，到期后公开开关关闭、私密供给null而health仍200，再由测试关闭容器。它不是生产授权、真实认证或真实部署证明。只有该源码CI及安全扫描成功才继续下一步，不预先声称已通过。

## 唯一继续点

本阶段源码的真实云构建与上述25秒到期检查通过后，集中准备现有资源/固定Secret版本/既有发布角色的最小核对与具体发布、供给、权限和部署清单。新Secret、IAM变更、实际App key装载、ECR发布、ECS部署或业务任务均不因代码入库而获准。不要重建只读壳、重跑已消费W7r清理/部署槽、重开F3c9或修窄屏UI。
