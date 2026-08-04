# 应用实例模板管理

## 目的

实例模板负责描述“某个产品的应用实例需要哪些配置”，但不负责执行部署。当前链路是：

```text
产品
→ 已发布模板版本
→ 套餐
→ 订阅 + 客户配置
→ Stripe 付款确认
→ pending 应用实例 + 配置快照
→ 管理员填写入口并手动激活
```

## 管理流程

1. 在“应用实例模板管理”创建归属于产品的模板。
2. 创建草稿版本。第一个 v2 会自动带入与 `SAAS_CONTROL.md` 对齐的参数预设；以后创建更高版本时默认复制最新 v2，再在可视化编辑器中增删、排序和修改字段。
3. 发布版本。发布后内容不可修改；变更必须创建新版本。
4. 创建套餐并选择同一产品下的已发布模板版本，页面会自动展开该版本的参数。
5. 在展开区域配置套餐固定参数，例如账号、并发、门店、员工额度、品牌开关和访问策略；也可以为客户参数设置套餐默认值。
6. 客户购买或管理员手动创建订阅时填写客户需求字段，例如店铺名称、买家端/商户端主题和首位管理员基本资料。客户购买页会根据 `outputPath` 自动把主题字段分为买家端和商户端，并提供浅色/深色及颜色选择的实时界面预览；客户不需要填写十六进制颜色值。
7. 付款成功后，系统仅创建 `pending` 实例并复制模板版本与配置快照。
8. 管理员人工检查、填写 `access_url`、`tenant_key` 和域名/路径后手动激活。

## 配置字段

底层仍使用受验证、版本化的 JSON Schema，但管理员不需要手写 JSON。当前支持：

- 类型：`text`、`select`、`integer`、`number`、`boolean`、`color`
- 来源：`plan`、`customer`，以及仅供旧 v1 使用的 `plan_limit`
- `plan`：管理员新建套餐时设置，客户购买时只读，客户请求不能覆盖。
- `customer`：套餐可以提供默认值，客户购买或管理员创建订阅时按实际需求填写。
- `plan_limit`：旧模板兼容模式，根据 `limitKey` 保存到 `plans.limits`；新版本应优先使用原生类型的 `plan`。
- 数字字段可设置 `nullable`，其中 JSON `null` 表示“不限”，不会与 `0` 混淆。
- 每个 v2 字段必须设置 `outputPath`，使用 JSON Pointer 映射到订单系统控制参数。
- 购买页的主题可视化按 `/default_store/buyer_theme/*` 和 `/default_store/merchant_theme/*` 识别，而不是依赖固定字段 key；模板以后增加或重命名颜色字段时仍可动态分组。预览的安全回退值只用于显示，不会替代客户未填写的可选字段提交到后端。
- 餐饮订单系统预设固定 `contract=speedfeast-saas-control-v1`；发布时会校验路径、来源和类型，避免拼写错误生成后端不认识的 entitlement。
- `rules` 可以表达字段间约束，例如心跳间隔必须小于租约时长。

示例：

```json
{
  "schemaVersion": 2,
  "fields": [
    {
      "key": "storesMax",
      "label": "门店上限",
      "type": "integer",
      "source": "plan",
      "required": true,
      "nullable": true,
      "min": 1,
      "outputPath": "/entitlements/stores.max"
    },
    {
      "key": "defaultStoreName",
      "label": "店铺名称",
      "type": "text",
      "source": "customer",
      "required": true,
      "outputPath": "/default_store/name"
    }
  ]
}
```

`outputPath` 会在后端把扁平快照编译为 `SAAS_CONTROL.md` 要求的 `entitlements`、`default_store` 和 `first_owner` JSON。订单系统控制面接收 JSON，不接收 XML。编译器会再次校验字段类型、范围、跨字段规则和路径冲突；旧 v1 因没有输出路径不能直接编译。

模板不得包含密码、令牌、凭据、私钥或 API 密钥字段。`first_owner.password` 不能进入模板、套餐、购买订单、订阅或实例快照；编译器只有在真实部署调用时收到独立的运行时一次性密码，才会把它注入最终请求，否则拒绝生成可发送的配置。`instance.external_instance_id`、metadata 和幂等键也由平台生成，不允许客户填写。

## 餐饮订单系统预设

新建餐饮订单系统模板版本时会带入 23 个字段：

- 套餐配置：注册买家上限、买家同时在线设备上限、门店上限、商户员工账号上限、自定义主题开关、商户可编辑开关、访问租约时长、心跳间隔。
- 客户填写：主店名称、买家端主题 6 项、商户端主题 6 项、首位管理员用户名和显示名称。
- 四个额度的默认值为 `null`（不限）；租约默认 900 秒，心跳默认 300 秒，并校验心跳严格小于租约。

## 不可变约定

- 已发布或已归档模板版本的内容不可修改。
- 套餐创建后不能更换模板版本；升级模板需要创建新套餐。
- 订阅生成实例后不能修改套餐或实例配置。
- 实例创建后不能更换产品、订阅、模板版本或配置快照。
- 旧实例可以没有模板版本和配置快照，作为兼容历史记录保留。

## 当前部署边界

`deployment_driver` 当前只允许 `manual`。`deployment_workflow_version` 只是受控版本标识。现阶段只生成和冻结配置，并提供严格的 JSON 编译器；平台不会发送控制请求、执行任意脚本、创建云资源、调用 Docker/Kubernetes 或自动修改餐饮订单系统代码。
