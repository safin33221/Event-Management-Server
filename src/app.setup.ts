import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter.js';

export function configureApp(app: INestApplication): void {
  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter?.getInstance?.();
  if (typeof instance?.disable === 'function') {
    instance.disable('x-powered-by');
  }

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    next();
  });

  const defaultAllowedOrigins = [
    'https://wedding-photo-art.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  const configuredOrigins = [
    process.env.CORS_ORIGINS ?? '',
    process.env.FRONTEND_URL ?? '',
    process.env.CLIENT_URL ?? '',
  ]
    .join(',')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);

  const allowedOriginSet = new Set<string>([
    ...defaultAllowedOrigins.map((o) => o.toLowerCase()),
    ...configuredOrigins,
  ]);

  app.enableCors({
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow server-to-server requests (Next.js Server Actions / SSR) with no Origin header
      if (!requestOrigin) {
        callback(null, true);
        return;
      }
      const normalized = requestOrigin.trim().replace(/\/+$/, '').toLowerCase();
      if (
        allowedOriginSet.has('*') ||
        allowedOriginSet.has(normalized) ||
        /^https:\/\/wedding-photo-art(-[a-z0-9-]+)?\.vercel\.app$/i.test(normalized)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
}
