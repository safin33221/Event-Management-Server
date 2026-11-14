import { createHmac, timingSafeEqual } from 'node:crypto';

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function signAuthToken(
  payload: Omit<AuthTokenPayload, 'iat' | 'exp'>,
  secret: string,
  ttlSeconds = 60 * 60 * 24,
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: AuthTokenPayload = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64UrlEncode(sig)}`;
}

export function verifyAuthToken(token: string, secret: string): AuthTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [header, body, sig] = parts;
  if (!header || !body || !sig) {
    return null;
  }
  const data = `${header}.${body}`;
  const expectedSig = createHmac('sha256', secret).update(data).digest();
  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as AuthTokenPayload;
    if (!parsed.sub || typeof parsed.exp !== 'number') {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp < now) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
