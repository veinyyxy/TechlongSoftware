import type {
  TemplateConfiguration,
  TemplateConfigurationField,
  TemplateConfigurationSchema,
} from "./validation";

export interface TemplateVersionPreset {
  name: string;
  configurationSchema: TemplateConfigurationSchema;
  defaultConfiguration: TemplateConfiguration;
}

const planField = (
  field: Omit<TemplateConfigurationField, "source" | "required"> & {
    required?: boolean;
  },
): TemplateConfigurationField => ({
  ...field,
  source: "plan",
  required: field.required ?? true,
});

const customerField = (
  field: Omit<TemplateConfigurationField, "source" | "required"> & {
    required?: boolean;
  },
): TemplateConfigurationField => ({
  ...field,
  source: "customer",
  required: field.required ?? true,
});

const restaurantOrderSystemPreset: TemplateVersionPreset = {
  name: "餐饮订单系统控制参数",
  configurationSchema: {
    schemaVersion: 2,
    contract: "speedfeast-saas-control-v1",
    fields: [
      planField({
        key: "buyerAccountsMax",
        label: "注册买家账号上限",
        type: "integer",
        group: "套餐容量",
        description: "允许注册的买家账号数量；选择“不限”时发送 null。",
        outputPath: "/entitlements/buyer.accounts.max",
        nullable: true,
        nullLabel: "不限",
        min: 0,
        unit: "个",
      }),
      planField({
        key: "buyerConcurrentAccessMax",
        label: "买家同时在线设备上限",
        type: "integer",
        group: "套餐容量",
        description: "允许同时保持活跃访问租约的买家设备数量。",
        outputPath: "/entitlements/buyer.concurrent_access.max",
        nullable: true,
        nullLabel: "不限",
        min: 0,
        unit: "台",
      }),
      planField({
        key: "storesMax",
        label: "门店上限",
        type: "integer",
        group: "套餐容量",
        description: "允许启用的门店数量，包含主店。",
        outputPath: "/entitlements/stores.max",
        nullable: true,
        nullLabel: "不限",
        min: 1,
        unit: "家",
      }),
      planField({
        key: "merchantActiveUsersMax",
        label: "商户用户账号上限（含管理员）",
        type: "integer",
        group: "套餐容量",
        description: "允许启用的商户端员工账号数量。",
        outputPath: "/entitlements/merchant.active_users.max",
        nullable: true,
        nullLabel: "不限",
        min: 1,
        unit: "个",
      }),
      planField({
        key: "brandingCustomThemeEnabled",
        label: "启用自定义主题",
        type: "boolean",
        group: "品牌能力",
        description: "关闭后主题参数仍可保存，但订单系统运行时使用系统默认主题。",
        outputPath: "/entitlements/branding.custom_theme.enabled",
      }),
      planField({
        key: "brandingMerchantEditable",
        label: "允许商户修改品牌设置",
        type: "boolean",
        group: "品牌能力",
        description: "控制商户是否可以自行修改店名和主题。",
        outputPath: "/entitlements/branding.merchant_editable",
      }),
      planField({
        key: "buyerAccessLeaseSeconds",
        label: "买家访问租约时长",
        type: "integer",
        group: "访问策略",
        description: "买家设备一次访问租约的有效时间。",
        outputPath: "/entitlements/buyer.access.lease_seconds",
        min: 60,
        max: 86400,
        unit: "秒",
      }),
      planField({
        key: "buyerAccessHeartbeatSeconds",
        label: "买家访问心跳间隔",
        type: "integer",
        group: "访问策略",
        description: "必须严格小于买家访问租约时长。",
        outputPath: "/entitlements/buyer.access.heartbeat_seconds",
        min: 30,
        max: 3600,
        unit: "秒",
      }),
      customerField({
        key: "defaultStoreName",
        label: "店铺名称",
        type: "text",
        group: "店铺基本信息",
        description: "首次开通时写入订单系统现有默认主店的名称。",
        placeholder: "例如：北岸餐厅",
        outputPath: "/default_store/name",
        minLength: 1,
        maxLength: 120,
      }),
      customerField({
        key: "buyerThemeBrightness",
        label: "买家端明暗模式",
        type: "select",
        group: "买家端主题",
        outputPath: "/default_store/buyer_theme/brightness",
        options: ["light", "dark"],
      }),
      customerField({
        key: "buyerThemePrimary",
        label: "买家端主色",
        type: "color",
        group: "买家端主题",
        outputPath: "/default_store/buyer_theme/primary",
      }),
      customerField({
        key: "buyerThemeSecondary",
        label: "买家端辅助色",
        type: "color",
        group: "买家端主题",
        outputPath: "/default_store/buyer_theme/secondary",
      }),
      customerField({
        key: "buyerThemeSurface",
        label: "买家端卡片背景色",
        type: "color",
        group: "买家端主题",
        outputPath: "/default_store/buyer_theme/surface",
      }),
      customerField({
        key: "buyerThemeBackground",
        label: "买家端页面背景色",
        type: "color",
        group: "买家端主题",
        outputPath: "/default_store/buyer_theme/background",
      }),
      customerField({
        key: "buyerThemeError",
        label: "买家端错误提示色",
        type: "color",
        group: "买家端主题",
        outputPath: "/default_store/buyer_theme/error",
      }),
      customerField({
        key: "merchantThemeBrightness",
        label: "商户端明暗模式",
        type: "select",
        group: "商户端主题",
        outputPath: "/default_store/merchant_theme/brightness",
        options: ["light", "dark"],
      }),
      customerField({
        key: "merchantThemePrimary",
        label: "商户端主色",
        type: "color",
        group: "商户端主题",
        outputPath: "/default_store/merchant_theme/primary",
      }),
      customerField({
        key: "merchantThemeSecondary",
        label: "商户端辅助色",
        type: "color",
        group: "商户端主题",
        outputPath: "/default_store/merchant_theme/secondary",
      }),
      customerField({
        key: "merchantThemeSurface",
        label: "商户端卡片背景色",
        type: "color",
        group: "商户端主题",
        outputPath: "/default_store/merchant_theme/surface",
      }),
      customerField({
        key: "merchantThemeBackground",
        label: "商户端页面背景色",
        type: "color",
        group: "商户端主题",
        outputPath: "/default_store/merchant_theme/background",
      }),
      customerField({
        key: "merchantThemeError",
        label: "商户端错误提示色",
        type: "color",
        group: "商户端主题",
        outputPath: "/default_store/merchant_theme/error",
      }),
      customerField({
        key: "firstOwnerUsername",
        label: "首位管理员用户名",
        type: "text",
        group: "首位管理员",
        description: "3–64 位，只能使用字母、数字、点、下划线和短横线。",
        placeholder: "例如：owner",
        outputPath: "/first_owner/username",
        format: "merchant_username",
        minLength: 3,
        maxLength: 64,
      }),
      customerField({
        key: "firstOwnerDisplayName",
        label: "首位管理员显示名称",
        type: "text",
        group: "首位管理员",
        description: "留空时，订单系统会使用管理员用户名。",
        placeholder: "例如：店铺负责人",
        outputPath: "/first_owner/display_name",
        required: false,
        maxLength: 120,
      }),
    ],
    rules: [
      {
        type: "less_than",
        leftKey: "buyerAccessHeartbeatSeconds",
        rightKey: "buyerAccessLeaseSeconds",
        message: "买家访问心跳间隔必须严格小于访问租约时长。",
      },
    ],
  },
  defaultConfiguration: {
    buyerAccountsMax: null,
    buyerConcurrentAccessMax: null,
    storesMax: null,
    merchantActiveUsersMax: null,
    brandingCustomThemeEnabled: true,
    brandingMerchantEditable: true,
    buyerAccessLeaseSeconds: 900,
    buyerAccessHeartbeatSeconds: 300,
    buyerThemeBrightness: "light",
    buyerThemePrimary: "#03A9F4",
    buyerThemeSecondary: "#0288D1",
    buyerThemeSurface: "#FFFFFF",
    buyerThemeBackground: "#FFFFFF",
    buyerThemeError: "#B3261E",
    merchantThemeBrightness: "light",
    merchantThemePrimary: "#0F766E",
    merchantThemeSecondary: "#0D9488",
    merchantThemeSurface: "#FFFFFF",
    merchantThemeBackground: "#F8FAFC",
    merchantThemeError: "#B3261E",
  },
};

const presetsByProductSlug: Record<string, TemplateVersionPreset> = {
  "restaurant-order-system": restaurantOrderSystemPreset,
};

export function getTemplateVersionPreset(
  productSlug: string,
): TemplateVersionPreset | null {
  const preset = presetsByProductSlug[productSlug];
  if (!preset) return null;
  return JSON.parse(JSON.stringify(preset)) as TemplateVersionPreset;
}
