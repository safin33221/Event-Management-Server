import {
  SOFTILO_DEFAULT_THEME,
  mergeWithDefaultTheme,
  validateLogoUrl,
  validateThemeTokens,
} from './branding-defaults.js';

describe('Branding Defaults & Validation', () => {
  it('accepts valid https and relative logo URLs and rejects javascript: URLs', () => {
    expect(validateLogoUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
    expect(validateLogoUrl('/assets/logo.svg')).toBe('/assets/logo.svg');
    expect(() => validateLogoUrl('javascript:alert(1)')).toThrow();
    expect(() => validateLogoUrl('//evil.com/logo.png')).toThrow();
  });

  it('validates approved theme tokens and merges with neutral Softilo defaults', () => {
    const validated = validateThemeTokens({
      primaryColor: '#881337',
      accentColor: '#D97706',
    });
    const merged = mergeWithDefaultTheme(validated);
    expect(merged.primaryColor).toBe('#881337');
    expect(merged.accentColor).toBe('#D97706');
    expect(merged.backgroundColor).toBe(SOFTILO_DEFAULT_THEME.backgroundColor);

    expect(() => validateThemeTokens({ primaryColor: 'not-a-color' })).toThrow();
    expect(() => validateThemeTokens({ unknownToken: '#000000' })).toThrow();
  });
});
