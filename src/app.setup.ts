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

  const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins =
    configuredOrigins.length > 0
      ? configuredOrigins
      : process.env.NODE_ENV === 'production'
        ? []
        : ['http://localhost:3000', 'http://127.0.0.1:3000'];

  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
    });
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
}
