import { BadRequestException } from '@nestjs/common';

export interface ThemeTokens {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
}

export interface ContactDetails {
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
}

export const SOFTILO_DEFAULT_THEME: ThemeTokens = {
  primaryColor: '#1E293B',
  secondaryColor: '#475569',
  accentColor: '#0F766E',
  backgroundColor: '#FFFFFF',
  textColor: '#0F172A',
  fontFamily: 'Inter, system-ui, sans-serif',
};

export const SOFTILO_DEFAULT_BRANDING = {
  displayName: 'Softilo Event Management',
  logoUrl: null as string | null,
  themeTokens: SOFTILO_DEFAULT_THEME,
  contactDetails: {} as ContactDetails,
};

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const APPROVED_THEME_KEYS = new Set<keyof ThemeTokens>([
  'primaryColor',
  'secondaryColor',
  'accentColor',
  'backgroundColor',
  'textColor',
  'fontFamily',
]);

export function validateLogoUrl(logoUrl: string | null | undefined): string | null {
  if (logoUrl === undefined || logoUrl === null || logoUrl === '') {
    return null;
  }
  const trimmed = logoUrl.trim();
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//')) {
      throw new BadRequestException('Invalid relative logoUrl');
    }
    return trimmed;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BadRequestException('logoUrl must be a valid https/http URL or relative path');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BadRequestException('logoUrl must use http or https protocol');
  }
  return trimmed;
}

export function validateThemeTokens(
  input: Record<string, unknown> | null | undefined,
): Partial<ThemeTokens> | null {
  if (!input) {
    return null;
  }
  const result: Partial<ThemeTokens> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!APPROVED_THEME_KEYS.has(key as keyof ThemeTokens)) {
      throw new BadRequestException(`Unsupported theme token: ${key}`);
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`Theme token ${key} must be a non-empty string`);
    }
    const trimmed = value.trim();
    if (key !== 'fontFamily' && !HEX_COLOR_RE.test(trimmed)) {
      throw new BadRequestException(`Theme token ${key} must be a valid hex color`);
    }
    if (key === 'fontFamily' && trimmed.length > 120) {
      throw new BadRequestException('fontFamily exceeds maximum length');
    }
    result[key as keyof ThemeTokens] = trimmed;
  }
  return result;
}

export function mergeWithDefaultTheme(stored: unknown): ThemeTokens {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...SOFTILO_DEFAULT_THEME };
  }
  const raw = stored as Record<string, unknown>;
  return {
    primaryColor:
      typeof raw.primaryColor === 'string'
        ? raw.primaryColor
        : SOFTILO_DEFAULT_THEME.primaryColor,
    secondaryColor:
      typeof raw.secondaryColor === 'string'
        ? raw.secondaryColor
        : SOFTILO_DEFAULT_THEME.secondaryColor,
    accentColor:
      typeof raw.accentColor === 'string' ? raw.accentColor : SOFTILO_DEFAULT_THEME.accentColor,
    backgroundColor:
      typeof raw.backgroundColor === 'string'
        ? raw.backgroundColor
        : SOFTILO_DEFAULT_THEME.backgroundColor,
    textColor:
      typeof raw.textColor === 'string' ? raw.textColor : SOFTILO_DEFAULT_THEME.textColor,
    fontFamily:
      typeof raw.fontFamily === 'string' ? raw.fontFamily : SOFTILO_DEFAULT_THEME.fontFamily,
  };
}
