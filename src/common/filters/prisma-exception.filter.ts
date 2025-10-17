import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.BAD_REQUEST;
    let message = exception.message;

    if (exception.code === 'P2002') {
      const rawTarget = exception.meta?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget.join(', ')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';
      status = HttpStatus.CONFLICT;
      message = `Unique constraint failed: ${target}`;
    }

    res.status(status).json({
      statusCode: status,
      message,
      code: exception.code,
    });
  }
}
