import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { PublicApiErrorCode } from '@who-ruined/contracts';
import { ApplicationError } from './application/application-error.js';

const filterCodes = {
  internal: 'INTERNAL_ERROR',
  invalidRequest: 'INVALID_REQUEST',
  rejected: 'REQUEST_REJECTED',
  sizeLimit: 'SIZE_LIMIT',
} as const satisfies Record<string, PublicApiErrorCode>;

export class ApiError extends HttpException {
  constructor(public readonly code: PublicApiErrorCode, message: string, status: number, public readonly details?: Record<string, unknown>) { super(message, status); }
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = typeof response.locals?.requestId === 'string' ? response.locals.requestId : randomUUID();
    response.setHeader('x-request-id', requestId);
    if (exception instanceof ApplicationError) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
        },
        requestId,
      });
      return;
    }
    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json({ error: { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) }, requestId });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        response.status(status).json({ error: { code: filterCodes.sizeLimit, message: 'Файл превышает допустимый размер.' }, requestId });
        return;
      }
      const code = status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY ? filterCodes.invalidRequest : filterCodes.rejected;
      response.status(status).json({ error: { code, message: 'Некорректный HTTP-запрос.' }, requestId });
      return;
    }
    const parserStatus = typeof exception === 'object' && exception !== null && 'status' in exception ? Number((exception as { status: unknown }).status) : null;
    if (parserStatus === HttpStatus.PAYLOAD_TOO_LARGE) {
      response.status(parserStatus).json({ error: { code: filterCodes.sizeLimit, message: 'Тело запроса превышает допустимый размер.' }, requestId });
      return;
    }
    if (parserStatus === HttpStatus.BAD_REQUEST) {
      response.status(parserStatus).json({ error: { code: filterCodes.invalidRequest, message: 'Некорректный HTTP-запрос.' }, requestId });
      return;
    }
    console.error(JSON.stringify({ level: 'error', requestId, code: 'UNHANDLED_EXCEPTION', type: exception instanceof Error ? exception.name : 'UnknownError' }));
    response.status(500).json({ error: { code: filterCodes.internal, message: 'Внутренняя ошибка сервера.' }, requestId });
  }
}
