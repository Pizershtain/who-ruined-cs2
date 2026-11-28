import { timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Headers, Inject, Param, Req } from '@nestjs/common';
import { publicationRevisionSchema } from '@who-ruined/contracts';
import type { Request } from 'express';
import { MatchPublications } from '../../application/use-cases/match-publications.js';
import { assertExactQuery, assertOpaqueId } from '../../http-validation.js';
import { ApiError } from '../../safe-exception.filter.js';

function authorize(authorization: string | undefined): void {
  const token = process.env.MATCH_PUBLICATION_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/u.test(token)) throw new ApiError('MATCH_NOT_FOUND', 'Publication feed is disabled.', 404);
  const expected = 'Bearer ' + token;
  if (!authorization || authorization.length !== expected.length
    || Buffer.byteLength(authorization) !== expected.length
    || !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))) {
    throw new ApiError('REQUEST_REJECTED', 'Publication feed credentials required.', 401);
  }
}

@Controller()
export class MatchPublicationsController {
  constructor(@Inject(MatchPublications) private readonly queries: MatchPublications) {}

  @Get('internal/match-publications')
  @Header('Cache-Control', 'no-store')
  async list(@Headers('authorization') authorization: string | undefined, @Req() request: Request) {
    authorize(authorization);
    const query = assertExactQuery(request, ['after']);
    const cursor = publicationRevisionSchema.safeParse(query.after ?? '0');
    if (!cursor.success) throw new ApiError('INVALID_QUERY', 'Invalid publication cursor.', 422);
    return { schemaVersion: 'match-publications@1', events: await this.queries.list(BigInt(cursor.data)) };
  }

  @Get('internal/match-publications/:id')
  @Header('Cache-Control', 'no-store')
  state(@Headers('authorization') authorization: string | undefined, @Param('id') id: string, @Req() request: Request) {
    authorize(authorization);
    assertExactQuery(request, []);
    return this.queries.state(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }

  @Get('matches/:id/measured-stats')
  @Header('Cache-Control', 'no-store')
  measurements(@Param('id') id: string, @Req() request: Request) {
    assertExactQuery(request, []);
    return this.queries.measuredStats(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }
}
