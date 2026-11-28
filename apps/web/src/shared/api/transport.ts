import { z } from 'zod';

export class ApiClientError extends Error {
  constructor(public readonly code: string, public readonly status = 0, public readonly requestId?: string,
    public readonly details?: unknown, public readonly retryAfter?: string) {
    super(code);
  }
}

export function decodeResponse<T>(body: unknown, status: number, schema: z.ZodType<T>, headers?: Headers): T {
  if (status < 200 || status >= 300) {
    const error = z.object({ error: z.object({ code: z.string(), details: z.unknown().optional() }), requestId: z.string().optional() }).safeParse(body);
    throw new ApiClientError(error.success ? error.data.error.code : 'SERVER_ERROR', status,
      error.success ? error.data.requestId : undefined, error.success ? error.data.error.details : undefined,
      headers?.get('Retry-After') ?? undefined);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiClientError('INVALID_RESPONSE', status);
  return result.data;
}

export async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  return (await requestWithHeaders(url, init, schema)).data;
}

export async function requestWithHeaders<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<{ data: T; headers: Headers }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiClientError('NETWORK_ERROR');
  }
  let body: unknown;
  try {
    body = response.status === 204 ? undefined : await response.json();
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiClientError(response.ok ? 'INVALID_RESPONSE' : 'SERVER_ERROR', response.status, undefined, undefined,
      response.headers.get('Retry-After') ?? undefined);
  }
  return { data: decodeResponse(body, response.status, schema, response.headers), headers: response.headers };
}
