import {
  Body, Catch, Controller, Delete, Get, HttpCode, HttpException, Inject, Post, Put, Req, Res,
  type ArgumentsHost, type ExceptionFilter,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request, Response } from 'express';
import { authLoginSchema, authPlayerLinkInputSchema } from '@who-ruined/contracts';
import { PrismaClient } from '../generated/client/index.js';
import { AuthFault } from './fault.js';
import { AuthService, type Issued } from './service.js';
import type { AuthConfig } from './runtime.js';

export const authHttpConfig = Symbol('authHttpConfig');

export function assertBrowserOrigin(request: Request, config: AuthConfig, write: boolean): void {
  const host = config.trustGateway ? request.headers['x-forwarded-host'] : request.headers.host;
  const scheme = config.trustGateway ? request.headers['x-forwarded-proto'] : 'http';
  const fetchSite = request.headers['sec-fetch-site'];
  if (host !== config.origin.host || scheme + ':' !== config.origin.protocol
    || (write && (request.headers.origin !== config.origin.origin
      || (fetchSite !== undefined && fetchSite !== 'same-origin')))) throw new AuthFault('AUTH_ORIGIN_NOT_ALLOWED');
  if (request.originalUrl.includes('?')) throw new AuthFault('INVALID_REQUEST');
}

export function clientAddress(request: Request, trustGateway: boolean): string {
  const raw = trustGateway ? request.headers['x-real-ip'] : request.socket.remoteAddress;
  if (typeof raw !== 'string' || !isIP(raw)) throw new AuthFault('INVALID_REQUEST');
  return raw.toLowerCase().replace(/^::ffff:(?=\d)/u, '');
}

function cookieName(config: AuthConfig): string {
  return config.local ? 'wrc_refresh_dev' : '__Host-wrc_refresh';
}

function cookieOptions(config: AuthConfig) {
  return { httpOnly: true, path: '/', sameSite: 'strict', secure: !config.local } as const;
}

export function readRefreshCookie(raw: string | undefined, name: string): string | null {
  if (!raw || raw.length > 8192) return null;
  const pairs = raw.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  const value = pairs.length === 1 ? pairs[0]?.slice(name.length + 1) : undefined;
  return value && /^[A-Za-z0-9_-]{43}$/u.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value ? value : null;
}

function bearer(request: Request): string {
  const header = request.headers.authorization;
  const value = header && header.length < 2048 ? /^Bearer ([A-Za-z0-9_.-]+)$/iu.exec(header)?.[1] : undefined;
  if (!value) throw new AuthFault('UNAUTHENTICATED');
  return value;
}

@Catch()
export class AuthExceptions implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = response.getHeader('x-request-id') ?? randomUUID();
    response.setHeader('Cache-Control', 'no-store').setHeader('x-request-id', requestId);
    if (error instanceof AuthFault) {
      if (error.retryAfter) response.setHeader('Retry-After', error.retryAfter);
      response.status(error.status).json({ error: { code: error.code, message: error.message }, requestId });
      return;
    }
    const status = error instanceof HttpException ? error.getStatus() : 500;
    if (status >= 400 && status < 500) {
      const code = status === 413 ? 'SIZE_LIMIT' : status === 404 ? 'NOT_FOUND' : 'INVALID_REQUEST';
      response.status(status).json({ error: { code, message: 'Request rejected.' }, requestId });
      return;
    }
    console.error(JSON.stringify({ event: 'auth_request_failed', requestId }));
    const fault = new AuthFault('AUTH_UNAVAILABLE');
    response.status(fault.status).json({ error: { code: fault.code, message: fault.message }, requestId });
  }
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(authHttpConfig) private readonly config: AuthConfig,
    @Inject(PrismaClient) private readonly db: PrismaClient,
  ) {}

  private writeCookie(response: Response, issued: Issued) {
    response.cookie(cookieName(this.config), issued.refreshToken, { ...cookieOptions(this.config), expires: issued.cookieUntil });
    return issued.body;
  }

  @Post('login')
  @HttpCode(200)
  async login(@Req() request: Request, @Body() payload: unknown, @Res({ passthrough: true }) response: Response) {
    assertBrowserOrigin(request, this.config, true);
    if (!request.is('application/json')) throw new AuthFault('INVALID_REQUEST');
    const input = authLoginSchema.safeParse(payload);
    if (!input.success || Buffer.byteLength(input.data.password) > 1024) throw new AuthFault('INVALID_REQUEST');
    try {
      const issued = await this.auth.authenticateWithPassword(input.data.username, input.data.password, clientAddress(request, this.config.trustGateway));
      console.info(JSON.stringify({ event: 'auth_login_accepted', requestId: response.getHeader('x-request-id') }));
      return this.writeCookie(response, issued);
    } catch (error) {
      console.info(JSON.stringify({ event: 'auth_login_rejected', requestId: response.getHeader('x-request-id') }));
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    assertBrowserOrigin(request, this.config, true);
    try {
      const token = readRefreshCookie(request.headers.cookie, cookieName(this.config));
      if (!token) throw new AuthFault('UNAUTHENTICATED');
      return this.writeCookie(response, await this.auth.refresh(token));
    } catch (error) {
      if (error instanceof AuthFault && error.status === 401) response.clearCookie(cookieName(this.config), cookieOptions(this.config));
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    assertBrowserOrigin(request, this.config, true);
    await this.auth.logout(readRefreshCookie(request.headers.cookie, cookieName(this.config)));
    response.clearCookie(cookieName(this.config), cookieOptions(this.config));
  }

  @Get('me')
  me(@Req() request: Request) {
    assertBrowserOrigin(request, this.config, false);
    return this.auth.me(bearer(request));
  }

  @Get('player-link')
  playerLink(@Req() request: Request) {
    assertBrowserOrigin(request, this.config, false);
    return this.auth.readPlayerLink(bearer(request));
  }

  @Put('player-link')
  savePlayerLink(@Req() request: Request, @Body() payload: unknown) {
    assertBrowserOrigin(request, this.config, true);
    const token = bearer(request);
    if (!request.is('application/json')) throw new AuthFault('INVALID_REQUEST');
    const input = authPlayerLinkInputSchema.safeParse(payload);
    if (!input.success) throw new AuthFault('INVALID_REQUEST');
    return this.auth.savePlayerLink(token, input.data);
  }

  @Delete('player-link')
  deletePlayerLink(@Req() request: Request) {
    assertBrowserOrigin(request, this.config, true);
    return this.auth.deletePlayerLink(bearer(request));
  }

  @Get('health')
  health() { return { status: 'ok' }; }

  @Get('ready')
  async ready() {
    await this.db.$queryRaw`SELECT 1 FROM "AuthUser" LIMIT 1`;
    return { status: 'ready' };
  }
}
