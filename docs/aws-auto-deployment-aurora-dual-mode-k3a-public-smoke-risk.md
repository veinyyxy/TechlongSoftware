# K3a 公网最小冒烟：固定范围与完整风险 v1

这是独立的新许可，不复用K2b/K2c已消费的私密、应用或写槽。Prepare仅验证本地公共历史证据和代码绑定并生成清单；**0网络、0私密读取、0云/DB写、0槽消费**。必须对最终SHA明确确认后才Run。

## 唯一允许范围

一次Run，依次最多三个**无认证HTTPS GET**，仅固定主机 `first-acceptance.sandbox.techlong.cloud:443`：

1. `/health`：要求200、准确JSON `{"status":"ok"}`。
2. `/ready`：要求200、准确JSON `{"status":"ready"}`。现有Express tenant-v1应用执行严格READ ONLY身份/目录/已初始化状态检查，不是仅SELECT1。
3. `/api/merchant/stores`：没有HMAC、Authorization、Cookie或设备ID，发送已公开固定`X-Store-Id: add89a8c-f43e-81b9-8287-0cb6c5c54f87`，要求401及准确`Invalid signature`，只验证未签名商户入口被拒绝。选择merchant路径绕开buyer access lease获取；store-context可能先读取店铺配置/内存缓存，但签名拒绝后不读取商户行、执行登录或业务CRUD。

固定User-Agent/Accept/identity encoding，无body/query；TLS默认系统信任、SNI和证书主机检查、最小TLS1.2，不关验证、不加载客户端证书、签名私钥、AWS profile/Secret值或数据库URL。不跟随redirect、不使用代理/自定义CA环境。每个请求独立连接，10秒超时、body最多4096字节，整个请求段45秒。仅保存路径/status/字节数/验证结果及公开TLS指纹/到期信息，不保存HTTP正文、全headers、Cookie、IP、原始异常或其body hash。

## 边界与完整风险

- **证明有限**：成功仅证明当时公网DNS/TLS/443路由、readiness及一项未签名拒绝。不是浏览器UI/CORS、前端部署、商户登录/改密码、商品/订单/支付CRUD、完整鉴权矩阵、失败补偿或无人值守部署验收；不把401当正向业务成功。K2c平台/镜像/承载证明为历史，不重新声称当前AWS资源身份/完整状态已验证。本地源码pins固定的是本次检查依据，不冒充新读取的部署镜像源码证明。
- **底层活动和费用**：操作器0直连Aurora/Neon、0AWS调用，但`/ready`及store-context可使用应用IAM身份建立Aurora连接/只读SQL、更新内存缓存；正常访问日志/指标会写入，可能唤醒数据库、产生ACU/I/O/日志/网络费用。不能称全系统零数据库活动或绝对零写/零费用。脚本不执行业务DML、登录/lease、provision、Secret/IAM/DNS/DDB/资源变更或删除。
- **网络与并发**：DNS、证书、ALB路由、应用或Janitor可能并发变化；有效TLS与准确body不能提供AWS资源UUID/镜像的跨服务CAS证明。缓存/同域路由可影响结果。网络/TLS/超时/429/401非预期body/503/redirect均停止，不重定向、降级、重连重发或修复。超时不保证请求未到达服务端，也不能排除服务器继续完成检查。
- **提供者日志/信息**：固定域名和公开store ID随请求交给该服务；操作器IP、URL/headers可能进入DNS、AWS/应用及网络提供者日志。仅内存处理body且限制大小，不保证JS/TLS缓冲或provider日志物理擦除。若误返回敏感内容，不存正文、不继续请求。
- **一次永久槽**：Run在任何DNS/HTTPS前独占创建并fsync `F:/ChatGPT_workshop/techlong-express-k3-public-smoke-v1.permanent-slot.json`；每请求另写独占intent文件，落盘后再核对时限。消费后即使未发出请求、响应不明、局部落盘或过程失败，也不自动删除/复位/换SHA绕过、Run或额外Inspect GET；最多各一次，失败即停止。后续独立验证仅核对本地摘要/文件hash，不再联网。
- **时限不续期**：新公开scope从Prepare起最多30分钟，且严格早于原workload到期5分钟；每请求前核验。它不延长过期的K2c私密/SQL窗口，也不续期云资源。**workload固定2026-10-16 07:04:28.726 CDT / UTC12:04:28.726到期**，旧Janitor保持；可能先后删除/失败，清理时刻/覆盖范围/停费不保证。50USD/月仍为目标，非费用cap。

父Cell、Aurora、Secret、DNS、ECR、DDB/Neon状态、角色及旧历史保留，清理或收费续用均须具体范围fresh另批。本范围不安装权限、不调整TTL、不新增监控/自动化，不扩展F3c9/Grant支线。
