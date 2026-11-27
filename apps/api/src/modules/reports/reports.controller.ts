import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiAcceptedResponse, ApiBody, ApiConflictResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import { storedParticipationRatingOpenApiSchema, evpReportOpenApiSchema, storedParticipationExplanationOpenApiSchema, storedPlayerRadarOpenApiSchema, playerRadarWithConfirmedEvidenceOpenApiSchema, rescoreRequestSchema } from '@who-ruined/contracts';
import { ReportQueries } from '../../application/use-cases/report-queries.js';
import { RescoreMatch, type RescoreMatchRequest } from '../../application/use-cases/rescore-match.js';
import { assertExactQuery, assertNoPolicySelector, assertOpaqueId, assertPlainObjectWithKeys } from '../../http-validation.js';
import { ApiError } from '../../safe-exception.filter.js';

function parseRescoreRequest(body: unknown): RescoreMatchRequest {
  assertPlainObjectWithKeys(body, ['scoringVersion', 'configHash']);
  const parsed = rescoreRequestSchema.safeParse(body);
  if (!parsed.success) throw new ApiError('UNSUPPORTED_MODE', 'Некорректный запрос rescore.', 422);
  return {
    scoringVersion: parsed.data.scoringVersion,
    ...(parsed.data.configHash === undefined ? {} : { configHash: parsed.data.configHash }),
  };
}

@ApiTags('matches')
@Controller()
export class ReportsController {
  constructor(
    @Inject(ReportQueries) private readonly queries: ReportQueries,
    @Inject(RescoreMatch) private readonly rescoreMatch: RescoreMatch,
  ) {}

  @Get('matches/:id/analytics')
  @ApiOperation({ operationId: 'MatchesController_analytics', summary: 'Versioned factual M2 analytics without scores or blame labels' })
  analytics(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.queries.analytics(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }

  @Get('matches/:id/players/:playerId/analytics')
  @ApiOperation({ operationId: 'MatchesController_playerAnalytics', summary: 'Factual M2 analytics for one match participant' })
  playerAnalytics(@Param('id') id: string, @Param('playerId') playerId: string, @Req() request: Request) { assertExactQuery(request, []); return this.queries.playerAnalytics(assertOpaqueId(id, 'MATCH_NOT_FOUND'), assertOpaqueId(playerId, 'PLAYER_NOT_FOUND')); }

  @Get('matches/:id/experimental-participation-rating')
  @ApiOperation({ operationId: 'MatchesController_participationRating', summary: 'Owner-selected participation rating; policy is server-only and cannot be selected over HTTP' })
  @ApiOkResponse({
    description: 'H3 m4.3-participation-rating@2 or historical H2 m4.3-participation-rating@1',
    schema: storedParticipationRatingOpenApiSchema as unknown as SchemaObject
  })
  @ApiNotFoundResponse({ description: 'Match not found or ENABLE_EXPERIMENTAL_PARTICIPATION_RATING is not enabled' })
  @ApiConflictResponse({ description: 'Canonical result missing, corrupt or bound to a different owner policy' })
  @ApiUnprocessableEntityResponse({ description: 'HTTP policy selection is forbidden' })
  participationRating(@Param('id') id: string, @Req() request: Request) {
    assertNoPolicySelector(request);
    return this.queries.participationRating(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }

  @Get('matches/:id/experimental-participation-explanation')
  @ApiOperation({ operationId: 'MatchesController_participationExplanation', summary: 'Read-only explanation of the active participation rating and verified important moments' })
  @ApiOkResponse({
    description: 'Persisted seven-family H3 explanation or historical six-family H2 explanation',
    schema: storedParticipationExplanationOpenApiSchema as unknown as SchemaObject
  })
  @ApiNotFoundResponse({ description: 'Match not found or ENABLE_EXPERIMENTAL_PARTICIPATION_RATING is not enabled' })
  @ApiConflictResponse({ description: 'REPORT_NOT_READY, REPORT_CORRUPT or REPORT_POLICY_MISMATCH' })
  participationExplanation(@Param('id') id: string, @Req() request: Request) {
    assertExactQuery(request, []);
    return this.queries.participationExplanation(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }

  @Get('matches/:id/evp')
  @ApiOperation({ operationId: 'MatchesController_evp', summary: 'Stored experimental EVP awards and candidate explanations' })
  @ApiOkResponse({
    description: 'evp-report@1 read from an immutable stored artifact',
    schema: evpReportOpenApiSchema as unknown as SchemaObject,
  })
  @ApiNotFoundResponse({ description: 'MATCH_NOT_FOUND' })
  @ApiConflictResponse({ description: 'REPORT_NOT_READY, REPORT_CORRUPT or REPORT_POLICY_MISMATCH with EVP reason details' })
  evp(@Param('id') id: string, @Req() request: Request) {
    assertExactQuery(request, []);
    return this.queries.evp(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }

  @Get('matches/:id/radar')
  @ApiOperation({ operationId: 'MatchesController_radar', summary: 'Read-only eight-axis player radar projection for every match participant' })
  @ApiQuery({ name: 'include', required: false, enum: ['confirmed'] })
  @ApiOkResponse({
    description: 'player-radar@2 for H3 or player-radar@1 for historical results. Include confirmed evidence with include=confirmed.',
    schema: { oneOf: [storedPlayerRadarOpenApiSchema, playerRadarWithConfirmedEvidenceOpenApiSchema] as unknown as SchemaObject[] },
  })
  @ApiNotFoundResponse({ description: 'MATCH_NOT_FOUND' })
  @ApiConflictResponse({ description: 'REPORT_NOT_READY, REPORT_CORRUPT or REPORT_POLICY_MISMATCH' })
  radar(@Param('id') id: string, @Req() request: Request) {
    const { include } = assertExactQuery(request, ['include']);
    if (include !== undefined && include !== 'confirmed') throw new ApiError('INVALID_QUERY', 'Некорректные параметры запроса.', 422);
    return this.queries.radar(assertOpaqueId(id, 'MATCH_NOT_FOUND'), include === 'confirmed');
  }

  @Get('matches/:id/report')
  @ApiOperation({ operationId: 'MatchesController_report', summary: 'Versioned deterministic M3 scoring report; experimental policy, not causal probability' })
  @ApiOkResponse({ description: 'm3-score-1 report with all ten players, per-round ledgers and evidence episodes' })
  @ApiConflictResponse({ description: 'Report is pending or the stored artifact predates M2 analytics' })
  report(@Param('id') id: string, @Req() request: Request) { const query = assertExactQuery(request, ['version','configHash']); return this.queries.report(assertOpaqueId(id, 'MATCH_NOT_FOUND'), query.version, query.configHash); }

  @Get('matches/:id/players/:playerId/report')
  @ApiOperation({ operationId: 'MatchesController_playerReport', summary: 'Attributed findings and evidence episodes for one participant' })
  @ApiOkResponse({ description: 'Player components, findings, episodes and per-round rows for the selected scorer version' })
  playerReport(@Param('id') id: string, @Param('playerId') playerId: string, @Req() request: Request) { const query = assertExactQuery(request, ['version','configHash']); return this.queries.playerReport(assertOpaqueId(id, 'MATCH_NOT_FOUND'), assertOpaqueId(playerId, 'PLAYER_NOT_FOUND'), query.version, query.configHash); }

  @Post('matches/:id/rescore')
  @HttpCode(202)
  @ApiOperation({ operationId: 'MatchesController_rescore', summary: 'Queue scoring from the stored M2 artifact without parsing the demo again' })
  @ApiAcceptedResponse({ description: 'RESCORE job queued with resolved scorer version and config hash' })
  @ApiConflictResponse({ description: 'Stored M2 artifact is unavailable or incompatible' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown scorer version/config hash' })
  @ApiBody({ schema: { type: 'object', required: ['scoringVersion'], properties: { scoringVersion: { type: 'string' }, configHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } })
  rescore(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) { assertExactQuery(request, []); return this.rescoreMatch.execute(assertOpaqueId(id, 'MATCH_NOT_FOUND'), parseRescoreRequest(body)); }
}
