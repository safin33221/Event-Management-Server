import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard.js';

function createMockContext(ip: string) {
  const headers: Record<string, string> = {};
  const handler = function loginHandler() {};
  class MockController {}
  return {
    headers,
    context: {
      getHandler: () => handler,
      getClass: () => MockController,
      switchToHttp: () => ({
        getRequest: () => ({ ip, headers: {}, socket: { remoteAddress: ip } }),
        getResponse: () => ({
          setHeader: (k: string, v: string) => {
            headers[k] = v;
          },
        }),
      }),
    },
  };
}

describe('RateLimitGuard', () => {
  it('allows undecorated routes and throttles excessive requests per IP', () => {
    const reflector = {
      getAllAndOverride: () => ({ limit: 2, windowMs: 60_000 }),
    } as unknown as Reflector;

    const guard = new RateLimitGuard(reflector);
    const firstIp = createMockContext('10.0.0.1');
    const secondIp = createMockContext('10.0.0.2');

    expect(guard.canActivate(firstIp.context as never)).toBe(true);
    expect(guard.canActivate(firstIp.context as never)).toBe(true);

    try {
      guard.canActivate(firstIp.context as never);
      throw new Error('Expected rate limit exception');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(firstIp.headers['Retry-After']).toBeDefined();
    }

    // Separate IP keeps independent quota
    expect(guard.canActivate(secondIp.context as never)).toBe(true);
  });
});
