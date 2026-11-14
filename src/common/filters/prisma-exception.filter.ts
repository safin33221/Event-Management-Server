import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception.code === 'P2002') {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'UNIQUE_CONSTRAINT_VIOLATION',
        message: 'A record with the same unique identifier already exists.',
      });
      return;
    }

    if (exception.code === 'P2025') {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        code: 'RECORD_NOT_FOUND',
        message: 'Requested record was not found.',
      });
      return;
    }

    // PostgreSQL exclusion constraint violation (23P01) or serialization failure (40001)
    if (exception.code === 'P2010' || exception.code === 'P2034') {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        code: 'RESOURCE_CONFLICT',
        message: 'Resource or concurrency conflict detected. Please retry.',
      });
      return;
    }

    this.logger.error(`Unhandled Prisma error ${exception.code}: ${exception.message}`);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Database operation failed.',
    });
  }
}
