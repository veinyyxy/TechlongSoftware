# 独立前端承载与人工门禁：真实安装完成

2026-10-28，America/Winnipeg。用户确认清单 `e66544260e91a60af62e7275dd69522e406c27aa70f1a5ebb033b066b02570ae` 后，于**19:19:28–19:24:25 CDT**完成一次安装和独立回读。结果为 `FRONTEND_HOSTING_AND_HUMAN_GATE_INDEPENDENTLY_VERIFIED_NO_PUBLICATION`；这是承载/权限安装成功，**不是客户端发布、后端恢复或整套产品验收成功**。原[待审范围与完整风险](aws-buyer-web-sandbox-bootstrap-review.md)、[批准清单原件](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.bootstrap-execution.json)保持原样，不改写准备时的PENDING状态。

## 实际创建与核验

先用实际Git写入凭据证明repo管理权限、准确客户端602e543/CI40789471388、workflow内容与OIDC、新目标空缺及Source IAM身份。随后仅创建GitHub环境和master规则两写；**独立证明人工门禁后才提交AWS**，最终再回读同一门禁。

| 对象 | 准确身份与结果 |
| --- | --- |
| GitHub环境 | speedfeast / techlong-sandbox-buyer-deploy，ID25634086386；reviewer仅用户14145707、can_admins_bypass=false、prevent_self_review=false |
| 分支规则 | ID64728366，仅master；没有代批任何environment运行或dispatch |
| 新栈 | techlong-sandbox-buyer-web-v1 / UUID71751190-d32e-11f1-9a09-06ffda7a3477，CREATE_COMPLETE、DisableRollback=true |
| S3 | techlong-sandbox-buyer-web-402010193138-ca-central-1-v1；私有、BucketOwnerEnforced、AES256、版本化、Retain |
| CloudFront / OAC | EDJYJUKAZ12BO / E2RCLW5N96SAFV；Deployed、S3 REST origin/OAC SigV4、HTTPS-only GET/HEAD、PriceClass100，无alias/API代理/edge函数 |
| 来源输出 | https://d3a0kml1xanzgt.cloudfront.net；本轮未请求此地址或发布任何应用产物 |
| 发布角色 | TechlongSandboxBuyerWebPublisherRole，RoleId AROAV3GNMXTZCUU7ORDXB；准确repo/environment OIDC sub、会话上限3600秒（workflow请求900秒） |
| 新策略 | TechlongSandboxBuyerWebPublishBoundary，PolicyId ANPAV3GNMXTZIWQQVOEAJ；同一准确策略作为identity grant和boundary，无inline或额外attached policy |

完整新栈ARN为 `arn:aws:cloudformation:ca-central-1:402010193138:stack/techlong-sandbox-buyer-web-v1/71751190-d32e-11f1-9a09-06ffda7a3477`。独立核对原始存储模板与受审模板结构完全相同，无参数替换；六个准确逻辑/物理资源、请求token、标签、桶属性/准确分布策略、CF/OAC/输出和IAM内容均通过。没有把单一CREATE_COMPLETE当作全部证明，也没有做AssumeRole/上传探针。

## 次数、原件与停止边界

实际GitHub GET11、配置写2，Source STS2、AWS元数据32（包含9次状态观察）、直接CreateStack1；共48条提供者调用记录已在本地重新核对。六资源是CFN声明数量，不是底层托管API写入数量。

私密值/HMAC/.env/PEM读取、DB连接、GitHub变量/Secret设置、应用HTTPS/JS/登录、workflow dispatch、backend/CORS/TTL操作、删除、自动重试/回滚/撤权/清理均0。新窄发布权限**持久保留**，并非临时Grant；桶版本Retain、CDN及其他既有资源可能持续收费，50 USD/月仍是目标而非硬上限。

主原件 `F:/ChatGPT_workshop/techlong-buyer-web-bootstrap-20261028-a/execution-result.json`，raw SHA `8853333b9a2a58d0847607bf945743c9b2b77e844fc26f070c34db5252de97ab`，包括48条非秘密调用结果及全部独立断言所用数据。恢复从同目录 `executed-verified.json` 开始（raw SHA `6b174ae265ac4b2d9dda45ebcf5002d267654912b28a824d51df510fd1ee69fc`），绑定准备、执行起点、永久标记、预检、门禁、提交意图、ACK、结果及本次脚本9个原件的摘要；原始结果不提交Git。[公开机器摘要](../ops/aws-sandbox/reviews/buyer-web-sandbox-v1.bootstrap-executed.json)仅保留必要资源/状态，不包含业务快照或私密日志。

永久标记execute.intent.json已消费，不能重跑run-bootstrap.mjs、再次CreateStack、复位标记或把旧PENDING清单解释为未安装。仅在真实缺失/漂移出现时按新的范围处理，不覆盖本轮证明。

## 下一唯一动作

只准备**现有workflow的sandbox客户端发布所需准确变量、私密输入来源和单次发布清单**，同时明确已退役后端所需的新联调/CORS窗口；集中备齐再开窗口，不新增运行器、控制器或固定任务代码分支。新CloudFront输出现在可真实绑定，不再使用候选ID或旧已删分布。

本次未批准HMAC转移、配置变量/Secret、发布/dispatch或恢复后端，这些仍按准确资源、私密使用、时序和风险另审。HMAC编译进Web产物可被读者分析，不能把GitHub Secret输入误称为客户端保密。旧后端UUID已退役的最后证据仍是18:54；本轮未重新查询它或连接业务数据库，不重放旧成功任务、旧Review或TTL，也不声称当前API可用。客户端发布完成后，仍须在获批的新真实后端窗口完成产品业务验收；`wholeProductAccepted=false`。
