# W6w：sandbox 自动部署的独立云端验收

2026年10月21日09:03:25（温尼伯CDT），本次 sandbox 部署通过独立 Inspect，结果为 **SUCCEEDED_INDEPENDENTLY_VERIFIED**。这不是“整套平台已经在AWS上线”的声明，也不只是GitHub运行显示成功。

- 源码锚点：`b82ef569582655ff8f121fa15bcc1b6ebafa193d`。
- 实例：`app_e897a4377bce498b9c5ee9e64509dcad`；任务：`job_c6cb047ac3ff30ed51ba9f34`。
- 区域/栈：`ca-central-1` / `techlong-sandbox-tenant-9c5ee9e64509dcad`。
- [原部署RunOnce39607535810](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39607535810)：新任务成功、旧就绪记录保留。
- [独立Inspect39613198333](https://github.com/veinyyxy/TechlongSoftware/actions/runs/39613198333)：由用户单独批准环境，与执行run不同。

## 验收范围与边界

独立工作流核对准确7资源栈、模板/参数/标签/角色，稳定ECS服务、运行任务及镜像摘要、健康目标；核对原五个永久槽、任务成功状态和租约释放、完整完成回执/输出、旧业务记录保留以及独立读前后状态一致。未重新发起原先两次认证GET；初始化和有效配置证明来自原执行回执及对它的独立核验。

本轮资源写0、数据库写0、任务领取0、私密控制包读取0。存在两份正常的私有、版本化、条件写入S3验收证据，不能称为“完全无写入”或“绝对零费用”。既有工作负载继续计费，50USD/月仍只是目标；验收不保证TTL自动清理或停止计费。

**平台控制账本未读写、验收证明未导入，平台页面验收标志未改变。** 独立云验收通过与平台账本最终认证是不同事实。若以后需要写回，另审准确窄写入；不要因此重新部署。

验收后另起本地进程复核148项当时源码绑定、8份版本化对象以及完整Inspect证明，索引19项回执，未再次调用AWS/数据库或读取凭据。这里的源码绑定属于原始执行版本，不随后续main提交倒填。

## 脱敏追溯

完整原件保留在本地私有证据档案，不复制业务快照、Secret、PEM、认证文件、提供者原始日志或签名URL到Git。以下是协议摘要或文件摘要，二者不可混用：

| 项目 | SHA256 |
| --- | --- |
| 获批执行清单（协议摘要） | `ce3032a2420807b4fa917d3416dc1c0b06926307019bf7d9e6875ca37c15ff90` |
| 云manifest（协议摘要） | `44f1b096d6f6521454fab65b2766ca57d34ffc4c1444eb5e0579fcd274c19f39` |
| 独立Inspect报告（内部协议摘要） | `d521807ef51bb08d7bdf0a782b6578594372c8e2807f4b6a77155a4412aa9cc9` |
| 验收证明（协议摘要） | `4c9d1251ac61577eb10051ebb81d64c5a18fd7fa6efc34ea1450b64720ba465b` |
| 最终结果JSON（原始文件字节） | `4595651390ebc9deffbd7270b991af65e265dc3452e83f1ed952cde72cf5e71c` |
| 独立本地复核JSON（原始文件字节） | `9ef7d558486a3067e7c67d0e5196bf2a9fcfdf90b5c177d884ace676533b2d3a` |
| 已消费永久槽JSON（原始文件字节） | `d340d3180c6ef41a52122cf7c9ff27249276c73ea8e057974a6904c728aff147` |

[机器可读的脱敏摘要](../ops/aws-sandbox/reviews/platform-independent-inspect-w6w.verified.json)。该摘要是历史记录，不是新执行授权或当前云状态监控。

后续以[W6x代码收敛](aws-auto-deployment-platform-w6x-code-consolidation.md)为代码维护方向，保留本次历史锚点和所有已消费槽，不重跑本次验收或旧部署。
