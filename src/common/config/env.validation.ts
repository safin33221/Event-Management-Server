export function validateEnvironment(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim().length === 0) {
    missing.push('DATABASE_URL');
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.trim().length < 16) {
    missing.push('AUTH_SECRET (minimum 16 characters)');
  }
  if (missing.length > 0 && process.env.NODE_ENV !== 'test') {
    throw new Error(`Missing required environment configuration: ${missing.join(', ')}`);
  }
}
