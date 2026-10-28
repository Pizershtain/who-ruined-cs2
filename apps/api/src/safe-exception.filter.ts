import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

export class ApiError extends HttpException {
  constructor(public readonly code: string, message: string, status: number, public readonly details?: Record<string, unknown>) { super(message, status); }
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = typeof response.locals?.requestId === 'string' ? response.locals.requestId : randomUUID();
    response.setHeader('x-request-id', requestId);
    if (exception instanceof ApiError) {
      response.status(exception.getStatus()).json({ error: { code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) }, requestId });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        response.status(status).json({ error: { code: 'SIZE_LIMIT', message: 'Файл превышает допустимый размер.' }, requestId });
        return;
      }
      const code = status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY ? 'INVALID_REQUEST' : 'REQUEST_REJECTED';
      response.status(status).json({ error: { code, message: 'Некорректный HTTP-запрос.' }, requestId });
      return;
    }
    const parserStatus = typeof exception === 'object' && exception !== null && 'status' in exception ? Number((exception as { status: unknown }).status) : null;
    if (parserStatus === HttpStatus.PAYLOAD_TOO_LARGE) {
      response.status(parserStatus).json({ error: { code: 'SIZE_LIMIT', message: 'Тело запроса превышает допустимый размер.' }, requestId });
      return;
    }
    if (parserStatus === HttpStatus.BAD_REQUEST) {
      response.status(parserStatus).json({ error: { code: 'INVALID_REQUEST', message: 'Некорректный HTTP-запрос.' }, requestId });
      return;
    }
    console.error(JSON.stringify({ level: 'error', requestId, code: 'UNHANDLED_EXCEPTION', type: exception instanceof Error ? exception.name : 'UnknownError' }));
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера.' }, requestId });
  }
}
