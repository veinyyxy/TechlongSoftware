import {
  validateResolvedTemplateConfiguration,
  validateConfigurationSchema,
  type FieldErrors,
  type TemplateConfiguration,
  type TemplateConfigurationSchema,
  type TemplateConfigurationValue,
  type ValidationResult,
} from "./validation.ts";

export type ProvisioningConfiguration = Record<string, unknown>;

export interface ProvisioningRuntimeSecrets {
  firstOwnerPassword?: string;
}

const safeRoots = new Set(["entitlements", "default_store", "first_owner"]);
const reservedSegments = new Set(["__proto__", "prototype", "constructor"]);

function addError(errors: FieldErrors, field: string, message: string) {
  errors[field] = [...(errors[field] ?? []), message];
}

function assignJsonPointer(
  target: ProvisioningConfiguration,
  pointer: string,
  value: TemplateConfigurationValue,
): boolean {
  const segments = pointer.startsWith("/") ? pointer.slice(1).split("/") : [];
  if (
    segments.length < 2 ||
    !safeRoots.has(segments[0]) ||
    segments.some((segment) => !segment || reservedSegments.has(segment.toLowerCase()))
  ) {
    return false;
  }
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    const existing = Object.hasOwn(cursor, segment) ? cursor[segment] : undefined;
    if (existing === undefined) {
      cursor[segment] = {};
    } else if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      return false;
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const finalSegment = segments.at(-1) as string;
  if (Object.hasOwn(cursor, finalSegment)) return false;
  cursor[finalSegment] = value;
  return true;
}

export function compileProvisioningConfiguration(input: {
  schema: TemplateConfigurationSchema;
  configuration: TemplateConfiguration;
  runtimeSecrets?: ProvisioningRuntimeSecrets;
}): ValidationResult<ProvisioningConfiguration> {
  const errors: FieldErrors = {};
  const schemaValidation = validateConfigurationSchema(input.schema);
  if (!schemaValidation.data) return { data: null, errors: schemaValidation.errors };
  const schema = schemaValidation.data;
  if (schema.schemaVersion !== 2) {
    addError(
      errors,
      "configurationSchema",
      "只有包含 outputPath 的 Schema v2 可以编译为订单系统控制参数。",
    );
    return { data: null, errors };
  }
  const validated = validateResolvedTemplateConfiguration({
    schema,
    configuration: input.configuration,
  });
  if (!validated.data) return { data: null, errors: validated.errors };
  const data: ProvisioningConfiguration = {};
  for (const field of schema.fields) {
    if (!field.outputPath) continue;
    if (!Object.hasOwn(validated.data, field.key)) {
      if (field.required) {
        addError(errors, field.key, `实例配置缺少“${field.label}”。`);
      }
      continue;
    }
    if (!assignJsonPointer(data, field.outputPath, validated.data[field.key])) {
      addError(errors, field.key, `“${field.label}”的输出路径不安全。`);
    }
  }
  const firstOwner = data.first_owner;
  if (typeof firstOwner === "object" && firstOwner !== null && !Array.isArray(firstOwner)) {
    const username = (firstOwner as Record<string, unknown>).username;
    if (
      typeof username !== "string" ||
      !/^[A-Za-z0-9._-]{3,64}$/.test(username)
    ) {
      addError(
        errors,
        "first_owner.username",
        "生成首位管理员时必须提供有效的 3–64 位用户名。",
      );
    }
    const password = input.runtimeSecrets?.firstOwnerPassword ?? "";
    if (password.length < 10) {
      addError(
        errors,
        "runtimeSecrets.firstOwnerPassword",
        "生成首位管理员时必须在部署运行时注入至少 10 位的一次性密码。",
      );
    } else {
      (firstOwner as Record<string, unknown>).password = password;
    }
  }
  return { data: Object.keys(errors).length ? null : data, errors };
}
