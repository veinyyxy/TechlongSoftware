"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  buildThemePalette,
  describeThemeField,
  normalizeThemeColor,
  themeFallbackPalettes,
  type ThemeAudience,
  type ThemePalette,
} from "@/lib/templates/theme-fields";
import type {
  TemplateConfiguration,
  TemplateConfigurationField,
} from "@/lib/templates/validation";

interface ThemeConfigurationEditorProps {
  audience: ThemeAudience;
  fields: TemplateConfigurationField[];
  initialConfiguration: TemplateConfiguration;
  readOnly?: boolean;
  fieldError?: (key: string) => string | undefined;
}

function initialFieldValue(
  audience: ThemeAudience,
  field: TemplateConfigurationField,
  configuration: TemplateConfiguration,
): string {
  const descriptor = describeThemeField(field);
  const fallback = descriptor
    ? themeFallbackPalettes[audience][descriptor.token] ??
      themeFallbackPalettes[audience].primary
    : themeFallbackPalettes[audience].primary;
  const value = configuration[field.key];

  if (field.type === "color") {
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
      return value.toUpperCase();
    }
    return field.required ? fallback : "";
  }

  if (
    descriptor?.token === "brightness" &&
    typeof value === "string" &&
    field.options?.includes(value)
  ) {
    return value;
  }
  if (!field.required) return "";
  if (field.options?.includes(fallback)) return fallback;
  return field.options?.[0] ?? fallback;
}

function readableText(background: string): string {
  const color = normalizeThemeColor(background, "#FFFFFF").slice(1);
  const relativeLuminance = (hex: string) => {
    const channels = [0, 2, 4].map((offset) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const backgroundLuminance = relativeLuminance(color);
  const darkText = "#17221B";
  const contrast = (first: number, second: number) =>
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  const darkContrast = contrast(
    backgroundLuminance,
    relativeLuminance(darkText.slice(1)),
  );
  const lightContrast = 1.05 / (backgroundLuminance + 0.05);
  return darkContrast >= lightContrast ? darkText : "#FFFFFF";
}

function previewStyle(colors: ThemePalette): CSSProperties {
  return {
    "--preview-primary": colors.primary,
    "--preview-primary-text": readableText(colors.primary),
    "--preview-secondary": colors.secondary,
    "--preview-secondary-text": readableText(colors.secondary),
    "--preview-surface": colors.surface,
    "--preview-surface-text": readableText(colors.surface),
    "--preview-background": colors.background,
    "--preview-background-text": readableText(colors.background),
    "--preview-error": colors.error,
    "--preview-error-text": readableText(colors.error),
  } as CSSProperties;
}

function BuyerThemePreview({ colors }: { colors: ThemePalette }) {
  return (
    <div
      aria-hidden="true"
      className={`buyer-theme-preview theme-preview-${colors.brightness}`}
      style={previewStyle(colors)}
    >
      <div className="buyer-preview-phone">
        <div className="buyer-preview-status">
          <span>9:41</span>
          <span>● ● ●</span>
        </div>
        <div className="buyer-preview-header">
          <div>
            <small>欢迎光临</small>
            <strong>北岸餐厅</strong>
          </div>
          <span className="buyer-preview-cart">购物车 2</span>
        </div>
        <div className="buyer-preview-content">
          <div className="buyer-preview-tabs">
            <strong>推荐</strong>
            <span>主食</span>
            <span>饮品</span>
          </div>
          <div className="buyer-preview-card">
            <div className="buyer-preview-food" />
            <div>
              <strong>招牌牛肉汉堡</strong>
              <small>每日现烤，搭配秘制酱汁</small>
              <b>$15.90</b>
            </div>
            <span className="buyer-preview-add">加入</span>
          </div>
          <div className="buyer-preview-alert">有 1 件商品库存紧张</div>
        </div>
        <div className="buyer-preview-nav">
          <strong>菜单</strong>
          <span>订单</span>
          <span>我的</span>
        </div>
      </div>
    </div>
  );
}

function MerchantThemePreview({ colors }: { colors: ThemePalette }) {
  return (
    <div
      aria-hidden="true"
      className={`merchant-theme-preview theme-preview-${colors.brightness}`}
      style={previewStyle(colors)}
    >
      <aside className="merchant-preview-sidebar">
        <strong>北岸餐厅</strong>
        <span className="merchant-preview-nav-active">今日订单</span>
        <span>菜单管理</span>
        <span>门店设置</span>
      </aside>
      <div className="merchant-preview-main">
        <header>
          <div>
            <small>订单工作台</small>
            <strong>今日订单</strong>
          </div>
          <span className="merchant-preview-create">新增订单</span>
        </header>
        <div className="merchant-preview-stats">
          <div>
            <small>待处理</small>
            <strong>12</strong>
          </div>
          <div>
            <small>今日销售</small>
            <strong>$1,286</strong>
          </div>
        </div>
        <div className="merchant-preview-order">
          <div>
            <strong>#A-1024</strong>
            <small>牛肉汉堡 × 2 · 柠檬茶 × 1</small>
          </div>
          <span>制作中</span>
        </div>
        <div className="merchant-preview-error">
          订单 #A-1021 付款失败，请检查
        </div>
      </div>
    </div>
  );
}

export function ThemeConfigurationEditor({
  audience,
  fields,
  initialConfiguration,
  readOnly = false,
  fieldError,
}: ThemeConfigurationEditorProps) {
  const initialValues = useMemo(
    () =>
      Object.fromEntries(
        fields.map((field) => [
          field.key,
          initialFieldValue(audience, field, initialConfiguration),
        ]),
      ),
    [audience, fields, initialConfiguration],
  );
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const colors = useMemo(
    () => buildThemePalette(audience, fields, values),
    [audience, fields, values],
  );
  const additionalColors = useMemo(
    () =>
      fields.flatMap((field) => {
        const descriptor = describeThemeField(field);
        if (
          !descriptor ||
          field.type !== "color" ||
          ["primary", "secondary", "surface", "background", "error"].includes(
            descriptor.token,
          )
        ) {
          return [];
        }
        return [
          {
            key: field.key,
            label: field.label,
            color: colors[descriptor.token],
          },
        ];
      }),
    [colors, fields],
  );

  const title = audience === "buyer" ? "买家端界面" : "商户端界面";
  const description =
    audience === "buyer"
      ? "顾客浏览菜单、选购和查看订单时看到的配色。"
      : "店员处理订单、管理菜单和门店时看到的配色。";

  return (
    <section aria-label={`${title}配色设置`} className="theme-configurator">
      <div className="theme-configurator-heading">
        <div>
          <span>{audience === "buyer" ? "BUYER APP" : "MERCHANT APP"}</span>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {!readOnly ? (
          <button
            className="button button-ghost button-small"
            onClick={() => setValues(initialValues)}
            type="button"
          >
            恢复套餐默认配色
          </button>
        ) : (
          <span className="status-pill">续费沿用当前配色</span>
        )}
      </div>

      <div className="theme-configurator-grid">
        <div className="theme-controls">
          {fields.map((field) => {
            const descriptor = describeThemeField(field);
            const value = values[field.key] ?? "";
            const error = fieldError?.(field.key);
            const inputId = `theme-${audience}-${field.key}`;
            const descriptionId = field.description
              ? `${inputId}-description`
              : undefined;
            const errorId = error ? `${inputId}-error` : undefined;
            const describedBy = [descriptionId, errorId].filter(Boolean).join(" ");

            if (descriptor?.token === "brightness") {
              return (
                <div className="form-field theme-mode-field" key={field.key}>
                  <label htmlFor={inputId}>主题模式</label>
                  <select
                    aria-describedby={describedBy || undefined}
                    aria-invalid={Boolean(error)}
                    disabled={readOnly}
                    id={inputId}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    required={field.required}
                    value={value}
                  >
                    {!field.required ? <option value="">使用系统默认</option> : null}
                    {field.options?.map((option) => (
                      <option key={option} value={option}>
                        {option === "dark"
                          ? "深色（Dark）"
                          : option === "light"
                            ? "浅色（Light）"
                            : option}
                      </option>
                    ))}
                  </select>
                  {!readOnly && (field.required || value) ? (
                    <input
                      name={`instanceConfiguration.${field.key}`}
                      type="hidden"
                      value={value}
                    />
                  ) : null}
                  {field.description ? (
                    <small id={descriptionId}>{field.description}</small>
                  ) : null}
                  {error ? (
                    <small className="form-error" id={errorId}>
                      {error}
                    </small>
                  ) : null}
                </div>
              );
            }

            const visualColor = normalizeThemeColor(
              value,
              descriptor
                ? colors[descriptor.token] ?? themeFallbackPalettes[audience].primary
                : themeFallbackPalettes[audience].primary,
            );

            return (
              <div className="theme-color-field" key={field.key}>
                <label htmlFor={inputId}>
                  {field.label.replace(/^(买家端|商户端)/, "")}
                </label>
                <span className="theme-color-control">
                  <input
                    aria-describedby={describedBy || undefined}
                    aria-invalid={Boolean(error)}
                    disabled={readOnly}
                    id={inputId}
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value.toUpperCase(),
                      }))
                    }
                    type="color"
                    value={visualColor}
                  />
                  <small>{readOnly ? "当前配色" : "点击色块选择"}</small>
                  {!readOnly && !field.required && value ? (
                    <button
                      className="theme-color-clear"
                      onClick={() =>
                        setValues((current) => ({
                          ...current,
                          [field.key]: "",
                        }))
                      }
                      type="button"
                    >
                      使用默认
                    </button>
                  ) : null}
                </span>
                {!readOnly && (field.required || value) ? (
                  <input
                    name={`instanceConfiguration.${field.key}`}
                    type="hidden"
                    value={value}
                  />
                ) : null}
                {field.description ? (
                  <small id={descriptionId}>{field.description}</small>
                ) : null}
                {error ? (
                  <small className="form-error" id={errorId}>
                    {error}
                  </small>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="theme-preview-panel">
          <div className="theme-preview-label">
            <span>实时预览</span>
            <small>
              {readOnly
                ? "当前订阅配色预览"
                : `${colors.brightness === "dark" ? "深色模式" : "浅色模式"} · 调整后立即更新`}
            </small>
          </div>
          {audience === "buyer" ? (
            <BuyerThemePreview colors={colors} />
          ) : (
            <MerchantThemePreview colors={colors} />
          )}
          {additionalColors.length ? (
            <div className="theme-preview-extra-colors">
              <small>模板新增配色</small>
              <div>
                {additionalColors.map((item) => (
                  <span key={item.key}>
                    <i style={{ background: item.color }} />
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
