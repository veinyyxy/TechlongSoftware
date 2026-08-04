import assert from "node:assert/strict";
import test from "node:test";
import { compileProvisioningConfiguration } from "../lib/templates/provisioning.ts";
import { getTemplateVersionPreset } from "../lib/templates/presets.ts";
import {
  parseTemplateConfiguration,
  resolveTemplateConfiguration,
  resolvePlanTemplateConfiguration,
  validateAppInstanceTemplateVersionInput,
  validateTemplatePlanLimits,
} from "../lib/templates/validation.ts";

const schema = {
  fields: [
    {
      key: "storeName",
      label: "店铺名称",
      type: "text" as const,
      source: "customer" as const,
      required: true,
    },
    {
      key: "theme",
      label: "主题风格",
      type: "select" as const,
      source: "customer" as const,
      required: true,
      options: ["classic", "warm"],
    },
    {
      key: "visitorLimit",
      label: "访问人数限制",
      type: "number" as const,
      source: "plan_limit" as const,
      required: true,
      limitKey: "访问人数限制",
      min: 1,
    },
  ],
};

test("publishes a controlled template schema without deployment scripts or secrets", () => {
  const result = validateAppInstanceTemplateVersionInput({
    version: 1,
    configurationSchema: schema,
    defaultConfiguration: { theme: "classic" },
    deploymentDriver: "manual",
    deploymentWorkflowVersion: "v1",
    status: "published",
  });
  assert.equal(result.data?.deploymentDriver, "manual");
  assert.equal(result.data?.configurationSchema.fields.length, 3);

  const secretField = validateAppInstanceTemplateVersionInput({
    version: 2,
    configurationSchema: {
      fields: [
        {
          key: "api_key",
          label: "API Key",
          type: "text",
          source: "customer",
          required: true,
        },
      ],
    },
    defaultConfiguration: {},
    deploymentDriver: "shell",
    deploymentWorkflowVersion: "v2",
    status: "draft",
  });
  assert.equal(secretField.data, null);
  assert.ok(secretField.errors["configurationSchema.fields.0"]);
});

test("derives plan limits on the server and validates customer configuration", () => {
  const resolved = resolveTemplateConfiguration({
    schema,
    defaults: { theme: "classic" },
    planLimits: { 访问人数限制: "250" },
    requested: { storeName: "北岸餐厅", theme: "warm" },
  });
  assert.deepEqual(resolved.data, {
    storeName: "北岸餐厅",
    theme: "warm",
    visitorLimit: 250,
  });

  const forgedLimit = resolveTemplateConfiguration({
    schema,
    defaults: { theme: "classic" },
    planLimits: { 访问人数限制: "250" },
    requested: {
      storeName: "北岸餐厅",
      theme: "classic",
      visitorLimit: 999999,
    },
  });
  assert.deepEqual(forgedLimit.data, {
    storeName: "北岸餐厅",
    theme: "classic",
    visitorLimit: 250,
  });

  const missingLimit = resolveTemplateConfiguration({
    schema,
    defaults: { theme: "classic" },
    planLimits: {},
    requested: { storeName: "北岸餐厅" },
  });
  assert.equal(missingLimit.data, null);
  assert.ok(missingLimit.errors.limits);
});

test("rejects unknown customer configuration fields", () => {
  const result = resolveTemplateConfiguration({
    schema,
    defaults: { theme: "classic" },
    planLimits: { 访问人数限制: "100" },
    requested: { storeName: "北岸餐厅", unexpected: "value" },
  });
  assert.equal(result.data, null);
  assert.ok(result.errors.instanceConfiguration);
});

test("requires every template-derived limit when saving a plan", () => {
  assert.deepEqual(
    validateTemplatePlanLimits({
      schema,
      planLimits: { 访问人数限制: "100" },
    }).data,
    { visitorLimit: 100 },
  );
  const invalid = validateTemplatePlanLimits({
    schema,
    planLimits: {},
  });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.limits);
});

test("accepts customer parameter defaults at plan level but rejects fixed limits", () => {
  assert.deepEqual(
    resolvePlanTemplateConfiguration({
      schema,
      requested: { theme: "warm", storeName: "" },
    }).data,
    { theme: "warm" },
  );

  const forgedLimit = resolvePlanTemplateConfiguration({
    schema,
    requested: { visitorLimit: 9999 },
  });
  assert.equal(forgedLimit.data, null);
  assert.ok(forgedLimit.errors.templateConfiguration);
});

test("accepts the versioned restaurant control schema and preserves native values", () => {
  const preset = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(preset);
  const validated = validateAppInstanceTemplateVersionInput({
    version: 2,
    configurationSchema: preset.configurationSchema,
    defaultConfiguration: preset.defaultConfiguration,
    deploymentDriver: "manual",
    deploymentWorkflowVersion: "v2",
    status: "published",
  });
  assert.equal(validated.errors.configurationSchema, undefined);
  assert.equal(validated.data?.configurationSchema.schemaVersion, 2);
  assert.equal(validated.data?.configurationSchema.fields.length, 23);
  assert.equal(validated.data?.defaultConfiguration.buyerAccountsMax, null);
  assert.equal(validated.data?.defaultConfiguration.brandingMerchantEditable, true);
  assert.deepEqual(
    parseTemplateConfiguration(
      JSON.stringify({ unlimited: null, disabled: false, zero: 0 }),
    ),
    { unlimited: null, disabled: false, zero: 0 },
  );
});

test("validates integer, unlimited and cross-field access policy values", () => {
  const preset = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(preset);
  const validPlan = resolvePlanTemplateConfiguration({
    schema: preset.configurationSchema,
    defaults: preset.defaultConfiguration,
    requested: {
      buyerAccountsMax: null,
      buyerConcurrentAccessMax: 0,
      storesMax: 3,
      merchantActiveUsersMax: 10,
      brandingCustomThemeEnabled: false,
      brandingMerchantEditable: false,
      buyerAccessLeaseSeconds: 900,
      buyerAccessHeartbeatSeconds: 300,
    },
  });
  assert.equal(validPlan.data?.buyerAccountsMax, null);
  assert.equal(validPlan.data?.buyerConcurrentAccessMax, 0);
  assert.equal(validPlan.data?.brandingCustomThemeEnabled, false);

  const decimalQuota = resolvePlanTemplateConfiguration({
    schema: preset.configurationSchema,
    defaults: preset.defaultConfiguration,
    requested: { storesMax: 1.5 },
  });
  assert.equal(decimalQuota.data, null);
  assert.ok(decimalQuota.errors["templateConfiguration.storesMax"]);

  const invalidPolicy = resolvePlanTemplateConfiguration({
    schema: preset.configurationSchema,
    defaults: preset.defaultConfiguration,
    requested: {
      buyerAccessLeaseSeconds: 300,
      buyerAccessHeartbeatSeconds: 300,
    },
  });
  assert.equal(invalidPolicy.data, null);
  assert.ok(
    invalidPolicy.errors[
      "instanceConfiguration.buyerAccessHeartbeatSeconds"
    ],
  );
});

test("keeps plan values authoritative when a customer submits forged fields", () => {
  const preset = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(preset);
  const planConfiguration = {
    ...preset.defaultConfiguration,
    storesMax: 2,
    brandingCustomThemeEnabled: false,
  };
  const resolved = resolveTemplateConfiguration({
    schema: preset.configurationSchema,
    defaults: planConfiguration,
    planLimits: {},
    requested: {
      defaultStoreName: "北岸餐厅",
      firstOwnerUsername: "owner_01",
      storesMax: 999,
      brandingCustomThemeEnabled: true,
    },
  });
  assert.equal(resolved.data?.storesMax, 2);
  assert.equal(resolved.data?.brandingCustomThemeEnabled, false);
  assert.equal(resolved.data?.defaultStoreName, "北岸餐厅");
});

test("compiles the flat version snapshot into the SpeedFeast provisioning JSON", () => {
  const preset = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(preset);
  const resolved = resolveTemplateConfiguration({
    schema: preset.configurationSchema,
    defaults: {
      ...preset.defaultConfiguration,
      storesMax: 5,
      merchantActiveUsersMax: 20,
    },
    planLimits: {},
    requested: {
      defaultStoreName: "北岸餐厅",
      firstOwnerUsername: "owner",
      firstOwnerDisplayName: "店铺负责人",
    },
  });
  assert.ok(resolved.data);
  const compiled = compileProvisioningConfiguration({
    schema: preset.configurationSchema,
    configuration: resolved.data,
    runtimeSecrets: { firstOwnerPassword: "one-time-strong-password" },
  });
  const payload = compiled.data as {
    entitlements: Record<string, unknown>;
    default_store: {
      name: string;
      buyer_theme: Record<string, unknown>;
    };
    first_owner: Record<string, unknown>;
  };
  assert.equal(payload.entitlements["stores.max"], 5);
  assert.equal(
    payload.entitlements["buyer.accounts.max"],
    null,
  );
  assert.equal(payload.default_store.name, "北岸餐厅");
  assert.equal(
    payload.default_store.buyer_theme.primary,
    "#03A9F4",
  );
  assert.deepEqual(payload.first_owner, {
    username: "owner",
    display_name: "店铺负责人",
    password: "one-time-strong-password",
  });
  assert.equal("password" in resolved.data, false);
});

test("rejects unsafe output paths and camelCase credential fields", () => {
  const unsafe = validateAppInstanceTemplateVersionInput({
    version: 2,
    configurationSchema: {
      schemaVersion: 2,
      fields: [
        {
          key: "apiKey",
          label: "API key",
          type: "text",
          source: "customer",
          required: true,
          outputPath: "/first_owner/password",
        },
      ],
    },
    defaultConfiguration: {},
    deploymentDriver: "manual",
    deploymentWorkflowVersion: "v2",
    status: "draft",
  });
  assert.equal(unsafe.data, null);
  assert.ok(unsafe.errors["configurationSchema.fields.0"]);

  const preset = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(preset);
  preset.configurationSchema.fields[0].outputPath =
    "/entitlements/buyer.accounts.maax";
  const typo = validateAppInstanceTemplateVersionInput({
    version: 3,
    configurationSchema: preset.configurationSchema,
    defaultConfiguration: preset.defaultConfiguration,
    deploymentDriver: "manual",
    deploymentWorkflowVersion: "v3",
    status: "draft",
  });
  assert.equal(typo.data, null);
  assert.ok(typo.errors["configurationSchema.fields.0"]);
});

test("rejects parent-child output paths and requires runtime owner secret", () => {
  const pathCollision = validateAppInstanceTemplateVersionInput({
    version: 2,
    configurationSchema: {
      schemaVersion: 2,
      fields: [
        {
          key: "themeObject",
          label: "Theme object",
          type: "text",
          source: "customer",
          required: true,
          outputPath: "/default_store/buyer_theme",
        },
        {
          key: "themePrimary",
          label: "Theme primary",
          type: "color",
          source: "customer",
          required: true,
          outputPath: "/default_store/buyer_theme/primary",
        },
      ],
    },
    defaultConfiguration: {},
    deploymentDriver: "manual",
    deploymentWorkflowVersion: "v2",
    status: "draft",
  });
  assert.equal(pathCollision.data, null);
  assert.ok(pathCollision.errors["configurationSchema.fields.1"]);

  const preset = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(preset);
  const configuration = resolveTemplateConfiguration({
    schema: preset.configurationSchema,
    defaults: preset.defaultConfiguration,
    planLimits: {},
    requested: {
      defaultStoreName: "北岸餐厅",
      firstOwnerUsername: "owner",
    },
  });
  assert.ok(configuration.data);
  const missingRuntimeSecret = compileProvisioningConfiguration({
    schema: preset.configurationSchema,
    configuration: configuration.data,
  });
  assert.equal(missingRuntimeSecret.data, null);
  assert.ok(
    missingRuntimeSecret.errors["runtimeSecrets.firstOwnerPassword"],
  );
});

test("compiler rejects v1 schemas and invalid resolved values", () => {
  const legacy = compileProvisioningConfiguration({
    schema,
    configuration: {
      storeName: "北岸餐厅",
      theme: "classic",
      visitorLimit: 100,
    },
  });
  assert.equal(legacy.data, null);
  assert.ok(legacy.errors.configurationSchema);

  const preset = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(preset);
  const invalid = compileProvisioningConfiguration({
    schema: preset.configurationSchema,
    configuration: {
      ...preset.defaultConfiguration,
      defaultStoreName: "北岸餐厅",
      firstOwnerUsername: "owner",
      buyerAccessLeaseSeconds: "not-an-integer" as unknown as number,
    },
    runtimeSecrets: { firstOwnerPassword: "one-time-strong-password" },
  });
  assert.equal(invalid.data, null);
  assert.ok(invalid.errors.buyerAccessLeaseSeconds);
});

test("locks SpeedFeast semantic constraints and first-owner dependencies", () => {
  const weakened = getTemplateVersionPreset("restaurant-order-system");
  assert.ok(weakened);
  const stores = weakened.configurationSchema.fields.find(
    (field) => field.outputPath === "/entitlements/stores.max",
  );
  assert.ok(stores);
  stores.min = -1;
  weakened.configurationSchema.rules = [];
  const invalidContract = validateAppInstanceTemplateVersionInput({
    version: 4,
    configurationSchema: weakened.configurationSchema,
    defaultConfiguration: weakened.defaultConfiguration,
    deploymentDriver: "manual",
    deploymentWorkflowVersion: "v4",
    status: "draft",
  });
  assert.equal(invalidContract.data, null);
  assert.ok(invalidContract.errors["configurationSchema.fields.2"]);
  assert.ok(invalidContract.errors["configurationSchema.rules"]);

  const ownerWithoutUsername = compileProvisioningConfiguration({
    schema: {
      schemaVersion: 2,
      fields: [
        {
          key: "ownerDisplayName",
          label: "Owner display name",
          type: "text",
          source: "customer",
          required: true,
          outputPath: "/first_owner/display_name",
        },
      ],
    },
    configuration: { ownerDisplayName: "Owner" },
    runtimeSecrets: { firstOwnerPassword: "one-time-strong-password" },
  });
  assert.equal(ownerWithoutUsername.data, null);
  assert.ok(ownerWithoutUsername.errors["first_owner.username"]);
});
