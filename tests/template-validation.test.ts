import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTemplateConfiguration,
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
