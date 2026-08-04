"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import type { TemplateVersionPreset } from "@/lib/templates/presets";
import type {
  TemplateConfiguration,
  TemplateConfigurationField,
  TemplateConfigurationRule,
  TemplateConfigurationSchema,
  TemplateConfigurationValue,
  TemplateFieldType,
} from "@/lib/templates/validation";

interface AppInstanceTemplateVersionFormProps {
  mode: "create" | "edit";
  templateId: string;
  versionId?: string;
  defaultVersion?: number;
  preset?: TemplateVersionPreset;
  initial?: {
    version: number;
    configurationSchema: TemplateConfigurationSchema;
    defaultConfiguration: TemplateConfiguration;
    deploymentDriver: string;
    deploymentWorkflowVersion: string;
    status: "draft" | "published";
  };
}

interface ErrorPayload {
  error?: {
    message?: string;
    fields?: Record<string, string[]>;
  } | null;
}

type EditableTemplateField = TemplateConfigurationField & {
  editorId: string;
};

const fieldTypeOptions: Array<{ value: TemplateFieldType; label: string }> = [
  { value: "text", label: "文字" },
  { value: "select", label: "下拉选择" },
  { value: "integer", label: "整数" },
  { value: "number", label: "数字" },
  { value: "boolean", label: "开关" },
  { value: "color", label: "颜色" },
];

function cloneSchema(schema: TemplateConfigurationSchema): TemplateConfigurationSchema {
  return JSON.parse(JSON.stringify(schema)) as TemplateConfigurationSchema;
}

function cloneConfiguration(configuration: TemplateConfiguration): TemplateConfiguration {
  return JSON.parse(JSON.stringify(configuration)) as TemplateConfiguration;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function editableFields(
  fields: TemplateConfigurationField[],
): EditableTemplateField[] {
  return fields.map((field, index) => ({
    ...field,
    editorId: `existing-${index}-${field.key}`,
  }));
}

function newField(existing: EditableTemplateField[]): EditableTemplateField {
  let index = existing.length + 1;
  const keys = new Set(existing.map((field) => field.key));
  while (keys.has(`parameter${index}`)) index += 1;
  return {
    key: `parameter${index}`,
    label: `新参数 ${index}`,
    type: "text",
    source: "customer",
    required: false,
    group: "其他参数",
    outputPath: "",
    editorId: `new-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };
}

function initialDefault(field: TemplateConfigurationField): TemplateConfigurationValue {
  if (field.nullable && (field.type === "integer" || field.type === "number")) return null;
  if (field.type === "boolean") return false;
  if (field.type === "integer" || field.type === "number") return field.min ?? 0;
  if (field.type === "select") return field.options?.[0] ?? "";
  if (field.type === "color") return "#000000";
  return "";
}

function persistedFields(
  fields: EditableTemplateField[],
): TemplateConfigurationField[] {
  return fields.map((field) =>
    Object.fromEntries(
      Object.entries(field).filter(([key]) => key !== "editorId"),
    ) as unknown as TemplateConfigurationField,
  );
}

export function AppInstanceTemplateVersionForm({
  mode,
  templateId,
  versionId,
  defaultVersion,
  preset,
  initial,
}: AppInstanceTemplateVersionFormProps) {
  const router = useRouter();
  const sourceSchema = initial?.configurationSchema ??
    preset?.configurationSchema ?? { schemaVersion: 2 as const, fields: [], rules: [] };
  const [fields, setFields] = useState<EditableTemplateField[]>(
    () => editableFields(cloneSchema(sourceSchema).fields),
  );
  const [rules, setRules] = useState<TemplateConfigurationRule[]>(
    () => cloneSchema(sourceSchema).rules ?? [],
  );
  const [defaults, setDefaults] = useState<TemplateConfiguration>(
    () => cloneConfiguration(initial?.defaultConfiguration ?? preset?.defaultConfiguration ?? {}),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const numericFields = useMemo(
    () => fields.filter((field) => field.type === "number" || field.type === "integer"),
    [fields],
  );
  const contractPathOptions = useMemo(
    () =>
      [...new Set(sourceSchema.fields.map((field) => field.outputPath).filter(Boolean))] as string[],
    [sourceSchema.fields],
  );

  function updateField(index: number, patch: Partial<TemplateConfigurationField>) {
    const previous = fields[index];
    const nextField: EditableTemplateField = { ...previous, ...patch };
    if (patch.type) {
      if (patch.type !== "select") nextField.options = undefined;
      if (patch.type !== "number" && patch.type !== "integer") {
        nextField.min = undefined;
        nextField.max = undefined;
        nextField.nullable = undefined;
        nextField.nullLabel = undefined;
      }
      if (patch.type !== "text") {
        nextField.minLength = undefined;
        nextField.maxLength = undefined;
        nextField.format = undefined;
      }
    }
    if (patch.source) {
      if (patch.source === "plan_limit") {
        nextField.limitKey = nextField.limitKey || nextField.label;
      } else {
        nextField.limitKey = undefined;
      }
    }
    setFields((current) =>
      current.map((field, fieldIndex) => (fieldIndex === index ? nextField : field)),
    );
    const nextKey = patch.key && patch.key !== previous.key ? patch.key : previous.key;
    setDefaults((current) => {
      const next = { ...current };
      const hadDefault = Object.hasOwn(next, previous.key);
      const previousDefault = next[previous.key];
      if (nextKey !== previous.key && hadDefault) {
        delete next[previous.key];
        next[nextKey] = previousDefault;
      }
      if (nextField.source === "plan_limit") {
        delete next[nextKey];
      } else if (hadDefault && patch.type) {
        next[nextKey] = initialDefault(nextField);
      } else if (next[nextKey] === null && !nextField.nullable) {
        next[nextKey] = initialDefault(nextField);
      }
      return next;
    });
    if (nextKey !== previous.key) {
      setRules((current) =>
        current.map((rule) => ({
          ...rule,
          leftKey: rule.leftKey === previous.key ? nextKey : rule.leftKey,
          rightKey: rule.rightKey === previous.key ? nextKey : rule.rightKey,
        })),
      );
    } else if (
      patch.type &&
      patch.type !== "number" &&
      patch.type !== "integer"
    ) {
      setRules((current) =>
        current.filter(
          (rule) =>
            rule.leftKey !== previous.key && rule.rightKey !== previous.key,
        ),
      );
    }
  }

  function removeField(index: number) {
    const removed = fields[index];
    setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
    setDefaults((current) => {
      const next = { ...current };
      delete next[removed.key];
      return next;
    });
    setRules((current) =>
      current.filter(
        (rule) => rule.leftKey !== removed.key && rule.rightKey !== removed.key,
      ),
    );
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    setFields((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function setDefault(key: string, value: TemplateConfigurationValue) {
    setDefaults((current) => ({ ...current, [key]: value }));
  }

  function toggleDefault(field: TemplateConfigurationField, enabled: boolean) {
    setDefaults((current) => {
      const next = { ...current };
      if (enabled) next[field.key] = initialDefault(field);
      else delete next[field.key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    const configurationSchema: TemplateConfigurationSchema = {
      schemaVersion: 2,
      ...(sourceSchema.contract ? { contract: sourceSchema.contract } : {}),
      fields: persistedFields(fields),
      ...(rules.length ? { rules } : {}),
    };
    const payload = {
      version: Number(formData.get("version")),
      configurationSchema,
      defaultConfiguration: defaults,
      deploymentDriver: "manual",
      deploymentWorkflowVersion: String(
        formData.get("deploymentWorkflowVersion") ?? "",
      ),
      status: String(formData.get("status") ?? ""),
    };
    if (
      payload.status === "published" &&
      !window.confirm("发布后这个版本将不可修改。确认现在发布吗？")
    ) {
      return;
    }
    setPending(true);
    try {
      const endpoint =
        mode === "create"
          ? `/api/admin/templates/${templateId}/versions`
          : `/api/admin/templates/${templateId}/versions/${versionId}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as ErrorPayload;
      if (!response.ok) {
        setMessage(result.error?.message ?? "保存失败，请检查表单。");
        setFieldErrors(result.error?.fields ?? {});
        return;
      }
      router.push(`/admin/templates/${templateId}`);
      router.refresh();
    } catch {
      setMessage("网络连接失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  const fieldError = (name: string) =>
    fieldErrors[name]?.[0] ??
    Object.entries(fieldErrors).find(([key]) => key.startsWith(`${name}.`))?.[1]?.[0];

  return (
    <form className="admin-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="form-field">
          <span>版本号</span>
          <input
            defaultValue={initial?.version ?? defaultVersion ?? 1}
            disabled={mode === "edit"}
            max={10000}
            min={1}
            name="version"
            required
            type="number"
          />
          {mode === "edit" ? <input name="version" type="hidden" value={initial?.version} /> : null}
          {fieldError("version") ? <small className="form-error">{fieldError("version")}</small> : null}
        </label>
        <label className="form-field">
          <span>保存状态</span>
          <select defaultValue={initial?.status ?? "draft"} name="status">
            <option value="draft">保存为草稿</option>
            <option value="published">发布并允许套餐使用</option>
          </select>
          {fieldError("status") ? <small className="form-error">{fieldError("status")}</small> : null}
        </label>
      </div>

      <section className="parameter-section">
        <div className="data-panel-heading">
          <div>
            <h2>动态参数定义</h2>
            <p>
              {preset ? `已带入“${preset.name}”预设。` : "从空白 Schema 开始。"}
              参数保存在当前模板版本中，新增或删除参数不会改变旧版本。
            </p>
          </div>
          <button
            className="button button-ghost button-small"
            onClick={() => setFields((current) => [...current, newField(current)])}
            type="button"
          >
            添加参数
          </button>
        </div>
        <div className="notice notice-neutral">
          输出路径使用订单服务端 JSON Pointer，例如 <code>/entitlements/stores.max</code> 或 <code>/default_store/name</code>。密码、API Token、mTLS 私钥不会保存到模板。
        </div>
        {contractPathOptions.length ? (
          <datalist id="template-contract-output-paths">
            {contractPathOptions.map((path) => <option key={path} value={path} />)}
          </datalist>
        ) : null}
        {!fields.length ? (
          <div className="empty-state"><strong>还没有参数</strong><p>添加参数后，套餐和客户购买表单会自动生成对应字段。</p></div>
        ) : (
          <div className="parameter-editor-list">
            {fields.map((field, index) => {
              const hasDefault = Object.hasOwn(defaults, field.key);
              const defaultValue = defaults[field.key];
              const numeric = field.type === "integer" || field.type === "number";
              return (
                <details className="parameter-editor" key={field.editorId}>
                  <summary>
                    <strong>{field.label || field.key || `参数 ${index + 1}`}</strong>
                    <span>{field.group || "未分组"} · {field.source === "plan" ? "套餐配置" : field.source === "customer" ? "客户填写" : "旧版套餐限制"} · {field.type}</span>
                    <code>{field.outputPath || "未设置输出路径"}</code>
                    {fieldError(`configurationSchema.fields.${index}`) ? <span className="form-error">{fieldError(`configurationSchema.fields.${index}`)}</span> : null}
                  </summary>
                  <div className="parameter-editor-body">
                    <div className="parameter-editor-actions">
                      <button className="button button-ghost button-small" disabled={index === 0} onClick={() => moveField(index, -1)} type="button">上移</button>
                      <button className="button button-ghost button-small" disabled={index === fields.length - 1} onClick={() => moveField(index, 1)} type="button">下移</button>
                      <button className="button button-danger button-small" onClick={() => removeField(index)} type="button">删除参数</button>
                    </div>
                    <div className="form-grid">
                      <label className="form-field"><span>显示名称</span><input maxLength={80} onChange={(event) => updateField(index, { label: event.target.value })} required value={field.label} /></label>
                      <label className="form-field"><span>稳定 key</span><input maxLength={64} onChange={(event) => updateField(index, { key: event.target.value })} required value={field.key} /><small>发布后不要复用或改变同一含义的 key。</small></label>
                      <label className="form-field"><span>分组</span><input maxLength={60} onChange={(event) => updateField(index, { group: event.target.value })} placeholder="例如：套餐容量" value={field.group ?? ""} /></label>
                      <label className="form-field"><span>参数来源</span><select onChange={(event) => updateField(index, { source: event.target.value as TemplateConfigurationField["source"] })} value={field.source}><option value="plan">新建套餐时设置</option><option value="customer">租户购买时填写</option><option value="plan_limit">旧版 limits 兼容</option></select></label>
                      <label className="form-field"><span>字段类型</span><select onChange={(event) => updateField(index, { type: event.target.value as TemplateFieldType })} value={field.type}>{fieldTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label className="form-field"><span>订单系统输出路径</span><input list={contractPathOptions.length ? "template-contract-output-paths" : undefined} maxLength={180} onChange={(event) => updateField(index, { outputPath: event.target.value })} placeholder="/entitlements/stores.max" required value={field.outputPath ?? ""} /></label>
                      <label className="form-field form-field-wide"><span>参数说明</span><textarea maxLength={300} onChange={(event) => updateField(index, { description: event.target.value })} rows={2} value={field.description ?? ""} /></label>
                      <label className="form-field"><span>输入提示</span><input maxLength={120} onChange={(event) => updateField(index, { placeholder: event.target.value })} value={field.placeholder ?? ""} /></label>
                      <label className="form-field"><span>单位</span><input maxLength={24} onChange={(event) => updateField(index, { unit: event.target.value })} placeholder="个 / 秒 / 家" value={field.unit ?? ""} /></label>
                      {field.source === "plan_limit" ? <label className="form-field"><span>旧版 limitKey</span><input maxLength={60} onChange={(event) => updateField(index, { limitKey: event.target.value })} required value={field.limitKey ?? ""} /></label> : null}
                      {field.type === "select" ? <label className="form-field form-field-wide"><span>下拉选项</span><textarea onChange={(event) => updateField(index, { options: event.target.value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) })} rows={3} value={(field.options ?? []).join("\n")} /><small>每行一个选项，或使用英文逗号分隔。</small></label> : null}
                      {numeric ? <><label className="form-field"><span>最小值</span><input onChange={(event) => updateField(index, { min: optionalNumber(event.target.value) })} type="number" value={field.min ?? ""} /></label><label className="form-field"><span>最大值</span><input onChange={(event) => updateField(index, { max: optionalNumber(event.target.value) })} type="number" value={field.max ?? ""} /></label></> : null}
                      {field.type === "text" ? <><label className="form-field"><span>最小长度</span><input min={0} onChange={(event) => updateField(index, { minLength: optionalNumber(event.target.value) })} type="number" value={field.minLength ?? ""} /></label><label className="form-field"><span>最大长度</span><input min={1} onChange={(event) => updateField(index, { maxLength: optionalNumber(event.target.value) })} type="number" value={field.maxLength ?? ""} /></label><label className="form-field"><span>特殊格式</span><select onChange={(event) => updateField(index, { format: event.target.value === "merchant_username" ? "merchant_username" : undefined })} value={field.format ?? ""}><option value="">无</option><option value="merchant_username">商户用户名</option></select></label></> : null}
                      <label className="check-field"><input checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} type="checkbox" /><span><strong>必填参数</strong><small>套餐或购买流程必须提供有效值。</small></span></label>
                      {numeric ? <label className="check-field"><input checked={field.nullable ?? false} onChange={(event) => updateField(index, { nullable: event.target.checked, nullLabel: event.target.checked ? field.nullLabel || "不限" : undefined })} type="checkbox" /><span><strong>允许“不限”</strong><small>保存为 JSON null，而不是 0 或空字符串。</small></span></label> : null}
                    </div>
                    {field.source !== "plan_limit" ? <div className="parameter-default">
                      <label className="check-field"><input checked={hasDefault} onChange={(event) => toggleDefault(field, event.target.checked)} type="checkbox" /><span><strong>设置模板默认值</strong><small>新建套餐或客户购买时会自动带入，仍会由服务端校验。</small></span></label>
                      {hasDefault ? (
                        field.type === "boolean" ? <label className="check-field"><input checked={defaultValue === true} onChange={(event) => setDefault(field.key, event.target.checked)} type="checkbox" /><span><strong>默认启用</strong><small>取消勾选会明确保存 false。</small></span></label> :
                        numeric ? <div className="form-grid"><label className="check-field"><input checked={defaultValue === null} disabled={!field.nullable} onChange={(event) => setDefault(field.key, event.target.checked ? null : field.min ?? 0)} type="checkbox" /><span><strong>{field.nullLabel || "不限"}</strong><small>启用时默认值保存为 null。</small></span></label><label className="form-field"><span>默认数值</span><input disabled={defaultValue === null} max={field.max} min={field.min} onChange={(event) => setDefault(field.key, Number(event.target.value))} step={field.type === "integer" ? 1 : "any"} type="number" value={defaultValue === null ? "" : String(defaultValue ?? "")} /></label></div> :
                          field.type === "select" ? <label className="form-field"><span>默认选项</span><select onChange={(event) => setDefault(field.key, event.target.value)} value={String(defaultValue ?? "")}>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select></label> :
                            field.type === "color" ? <label className="form-field"><span>默认颜色</span><input onChange={(event) => setDefault(field.key, event.target.value)} type="color" value={String(defaultValue || "#000000")} /></label> :
                              <label className="form-field"><span>默认文字</span><input maxLength={field.maxLength ?? 200} onChange={(event) => setDefault(field.key, event.target.value)} value={String(defaultValue ?? "")} /></label>
                      ) : null}
                    </div> : null}
                  </div>
                </details>
              );
            })}
          </div>
        )}
        {fieldError("configurationSchema") ? <small className="form-error">{fieldError("configurationSchema")}</small> : null}
        {fieldError("defaultConfiguration") ? <small className="form-error">{fieldError("defaultConfiguration")}</small> : null}
      </section>

      <section className="parameter-section">
        <div className="data-panel-heading"><div><h2>字段间校验规则</h2><p>用于表达单字段 min/max 无法覆盖的关系，当前支持“小于另一个字段”。</p></div><button className="button button-ghost button-small" disabled={numericFields.length < 2} onClick={() => setRules((current) => [...current, { type: "less_than", leftKey: numericFields[0]?.key ?? "", rightKey: numericFields[1]?.key ?? "" }])} type="button">添加规则</button></div>
        {rules.map((rule, index) => <div className="rule-editor" key={index}><label className="form-field"><span>左侧字段</span><select onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, leftKey: event.target.value } : item))} value={rule.leftKey}>{numericFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label><span className="rule-operator">必须小于</span><label className="form-field"><span>右侧字段</span><select onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, rightKey: event.target.value } : item))} value={rule.rightKey}>{numericFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label><label className="form-field"><span>错误提示</span><input maxLength={160} onChange={(event) => setRules((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, message: event.target.value } : item))} value={rule.message ?? ""} /></label><button className="button button-danger button-small" onClick={() => setRules((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">删除</button></div>)}
        {fieldError("configurationSchema.rules") ? <small className="form-error">{fieldError("configurationSchema.rules")}</small> : null}
      </section>

      <div className="form-grid">
        <label className="form-field"><span>部署驱动标识</span><input disabled value="manual" /><small>本阶段只生成受控配置，不自动部署。</small></label>
        <label className="form-field"><span>部署流程版本</span><input defaultValue={initial?.deploymentWorkflowVersion ?? "v1"} name="deploymentWorkflowVersion" required />{fieldError("deploymentWorkflowVersion") ? <small className="form-error">{fieldError("deploymentWorkflowVersion")}</small> : null}</label>
      </div>

      <details className="schema-preview"><summary>查看将保存的 Schema JSON</summary><pre>{JSON.stringify({ schemaVersion: 2, ...(sourceSchema.contract ? { contract: sourceSchema.contract } : {}), fields: persistedFields(fields), ...(rules.length ? { rules } : {}) }, null, 2)}</pre></details>
      <div className="notice notice-warning">已发布版本不可修改。以后增减参数时，请创建更高版本；旧套餐、历史订阅和应用实例继续使用原版本快照。</div>
      {message ? <p className="form-error form-message">{message}</p> : null}
      <div className="form-actions">
        <button className="button button-dark" disabled={pending || !fields.length} type="submit">{pending ? "保存中…" : mode === "create" ? "创建模板版本" : "保存草稿"}</button>
        <button className="button button-ghost" disabled={pending} onClick={() => router.back()} type="button">取消</button>
      </div>
    </form>
  );
}
