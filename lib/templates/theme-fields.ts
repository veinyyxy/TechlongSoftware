import type { TemplateConfigurationField } from "./validation";

export type ThemeAudience = "buyer" | "merchant";

export interface ThemeFieldDescriptor {
  audience: ThemeAudience;
  token: string;
}

export interface TemplateFieldGroups {
  fixed: TemplateConfigurationField[];
  basic: TemplateConfigurationField[];
  buyerTheme: TemplateConfigurationField[];
  merchantTheme: TemplateConfigurationField[];
}

export type ThemePalette = Record<string, string> & {
  brightness: string;
  primary: string;
  secondary: string;
  surface: string;
  background: string;
  error: string;
};

export const themeFallbackPalettes: Record<ThemeAudience, ThemePalette> = {
  buyer: {
    brightness: "light",
    primary: "#03A9F4",
    secondary: "#0288D1",
    surface: "#FFFFFF",
    background: "#FFFFFF",
    error: "#B3261E",
  },
  merchant: {
    brightness: "light",
    primary: "#0F766E",
    secondary: "#0D9488",
    surface: "#FFFFFF",
    background: "#F8FAFC",
    error: "#B3261E",
  },
};

const themePathPattern =
  /^\/default_store\/(buyer_theme|merchant_theme)\/([A-Za-z0-9._-]+)$/;

export function describeThemeField(
  field: TemplateConfigurationField,
): ThemeFieldDescriptor | null {
  const match = field.outputPath?.match(themePathPattern);
  if (!match) return null;
  return {
    audience: match[1] === "buyer_theme" ? "buyer" : "merchant",
    token: match[2],
  };
}

export function partitionTemplateFields(
  fields: TemplateConfigurationField[],
): TemplateFieldGroups {
  const groups: TemplateFieldGroups = {
    fixed: [],
    basic: [],
    buyerTheme: [],
    merchantTheme: [],
  };
  for (const field of fields) {
    if (field.source !== "customer") {
      groups.fixed.push(field);
      continue;
    }
    const theme = describeThemeField(field);
    const visualThemeField =
      field.type === "color" ||
      (field.type === "select" && theme?.token === "brightness");
    if (visualThemeField && theme?.audience === "buyer") groups.buyerTheme.push(field);
    else if (visualThemeField && theme?.audience === "merchant") groups.merchantTheme.push(field);
    else groups.basic.push(field);
  }
  return groups;
}

export function normalizeThemeColor(
  value: unknown,
  fallback: string,
): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toUpperCase()
    : fallback;
}

export function buildThemePalette(
  audience: ThemeAudience,
  fields: TemplateConfigurationField[],
  values: Record<string, unknown>,
): ThemePalette {
  const palette = { ...themeFallbackPalettes[audience] };
  for (const field of fields) {
    const descriptor = describeThemeField(field);
    if (!descriptor || descriptor.audience !== audience) continue;
    const value = values[field.key];
    if (field.type === "color") {
      palette[descriptor.token] = normalizeThemeColor(
        value,
        palette[descriptor.token] ?? "#000000",
      );
    } else if (
      descriptor.token === "brightness" &&
      (value === "light" || value === "dark")
    ) {
      palette.brightness = value;
    }
  }
  return palette;
}
