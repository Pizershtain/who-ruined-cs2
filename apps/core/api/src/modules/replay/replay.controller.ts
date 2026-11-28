import { Controller, Get, Inject, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import { replayMetadataOpenApiSchema, replayRoundOpenApiSchema } from '@who-ruined/contracts';
import { ReplayQueries } from '../../application/use-cases/replay-queries.js';
import { assertExactQuery, assertOpaqueId } from '../../http-validation.js';
import { ApiError } from '../../safe-exception.filter.js';

@ApiTags('matches')
@Controller()
export class ReplayController {
  constructor(@Inject(ReplayQueries) private readonly queries: ReplayQueries) {}

  @Get('matches/:id/replay')
  @ApiOperation({ operationId: 'MatchesController_replay', summary: 'Versioned metadata and availability for stored 2D match replay' })
  @ApiQuery({ name: 'version', required: false, enum: ['1', '2'], description: 'Defaults to 1; version 2 adds the map radar catalogue and altitude layers.' })
  @ApiOkResponse({ description: 'm4.7-replay-metadata@1 or @2', schema: replayMetadataOpenApiSchema as unknown as SchemaObject })
  replay(@Param('id') id: string, @Req() request: Request) {
    const query = assertExactQuery(request, ['version']);
    if (query.version !== undefined && query.version !== '1' && query.version !== '2') throw new ApiError('INVALID_QUERY', 'Unsupported replay metadata version.', 422);
    return this.queries.metadata(assertOpaqueId(id, 'MATCH_NOT_FOUND'), query.version === '2' ? 2 : 1);
  }

  @Get('matches/:id/replay/rounds/:roundId')
  @ApiOperation({ operationId: 'MatchesController_replayRound', summary: 'One stored replay round with sampled player coordinates and factual events' })
  @ApiOkResponse({ description: 'm4.7-replay-round@1', schema: replayRoundOpenApiSchema as unknown as SchemaObject })
  @ApiNotFoundResponse({ description: 'Match or replay round not found' })
  @ApiConflictResponse({ description: 'Replay unavailable or corrupt' })
  replayRound(@Param('id') id: string, @Param('roundId') roundId: string, @Req() request: Request) {
    assertExactQuery(request, []);
    return this.queries.round(assertOpaqueId(id, 'MATCH_NOT_FOUND'), assertOpaqueId(roundId, 'REPLAY_ROUND_NOT_FOUND'));
  }
}
