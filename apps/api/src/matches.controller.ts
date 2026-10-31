import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ApiAcceptedResponse, ApiBody, ApiConflictResponse, ApiConsumes, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiPayloadTooLargeResponse, ApiResponse, ApiTags, ApiUnsupportedMediaTypeResponse, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface.js';
import { activeParticipationRatingOpenApiSchema, participationExplanationOpenApiSchema, replayMetadataOpenApiSchema, replayRoundOpenApiSchema } from '@who-ruined/contracts';
import { MatchesService } from './matches.service.js';
import { safeDataPath } from './storage.js';
import { ApiError } from './safe-exception.filter.js';
import { UploadAdmissionInterceptor } from './upload-admission.interceptor.js';
import { resolveUploadConfig } from './upload-config.js';
import { createAbortSafeDiskStorage } from './upload-storage.js';
import { assertExactQuery, assertNoPolicySelector, assertOpaqueId } from './http-validation.js';

export const uploadConfig = resolveUploadConfig();
export const uploadDirectory = safeDataPath('uploads');

export function createDemoUploadOptions(directory = uploadDirectory, config = uploadConfig) {
  return {
    storage: createAbortSafeDiskStorage(directory),
    fileFilter: (_request: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
      if (!file.originalname.toLowerCase().endsWith('.dem')) {
        callback(new ApiError('INVALID_DEMO', 'Поддерживаются только файлы .dem.', 415), false);
        return;
      }
      callback(null, true);
    },
    // Busboy emits LIMIT_FILE_SIZE when bytesRead reaches fileSize, so use
    // max+1 to allow the exact documented boundary while rejecting +1.
    limits: { fileSize: config.maxUploadBytes + 1 }
  };
}

@ApiTags('matches')
@Controller()
export class MatchesController {
  constructor(@Inject(MatchesService) private readonly service: MatchesService) {}

  @Post('matches')
  @HttpCode(202)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['demo'], properties: { demo: { type: 'string', format: 'binary' } } } })
  @ApiPayloadTooLargeResponse({ description: 'SIZE_LIMIT: the demo exceeds MAX_UPLOAD_BYTES' })
  @ApiUnsupportedMediaTypeResponse({ description: 'INVALID_DEMO: only .dem uploads are accepted' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_DEMO: missing, empty, malformed, truncated or non-Source-2 demo' })
  @ApiResponse({ status: 503, description: 'INGESTION_PERSISTENCE_FAILED: upload metadata could not be committed atomically' })
  @ApiResponse({ status: 507, description: 'STORAGE_UNAVAILABLE: upload storage is unavailable or lacks the configured safety reserve' })
  @UseInterceptors(new UploadAdmissionInterceptor(uploadDirectory, uploadConfig), FileInterceptor('demo', createDemoUploadOptions()))
  async upload(@UploadedFile() file?: Express.Multer.File, @Req() request?: Request) {
    if (request) assertExactQuery(request, []);
    if (!file) throw new ApiError('INVALID_DEMO', 'Поле multipart demo обязательно.', 422);
    return this.service.ingest(file);
  }

  @Get('jobs/:id') job(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.service.job(assertOpaqueId(id, 'JOB_NOT_FOUND')); }
  @Get('matches') list(@Req() request: Request) { const query = assertExactQuery(request, ['cursor']); return this.service.list(query.cursor); }
  @Get('matches/:id') match(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.service.match(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }
  @Get('matches/:id/rounds') rounds(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.service.rounds(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }
  @Get('matches/:id/replay')
  @ApiOperation({ summary: 'Versioned metadata and availability for stored 2D match replay' })
  @ApiOkResponse({ description: 'm4.7-replay-metadata@1', schema: replayMetadataOpenApiSchema as unknown as SchemaObject })
  replay(@Param('id') id: string, @Req() request: Request) {
    assertExactQuery(request, []);
    return this.service.replay(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }

  @Get('matches/:id/replay/rounds/:roundId')
  @ApiOperation({ summary: 'One stored replay round with sampled player coordinates and factual events' })
  @ApiOkResponse({ description: 'm4.7-replay-round@1', schema: replayRoundOpenApiSchema as unknown as SchemaObject })
  @ApiNotFoundResponse({ description: 'Match or replay round not found' })
  @ApiConflictResponse({ description: 'Replay unavailable or corrupt' })
  replayRound(@Param('id') id: string, @Param('roundId') roundId: string, @Req() request: Request) {
    assertExactQuery(request, []);
    return this.service.replayRound(assertOpaqueId(id, 'MATCH_NOT_FOUND'), assertOpaqueId(roundId, 'REPLAY_ROUND_NOT_FOUND'));
  }
  @Get('matches/:id/analytics')
  @ApiOperation({ summary: 'Versioned factual M2 analytics without scores or blame labels' })
  analytics(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.service.analytics(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }
  @Get('matches/:id/players/:playerId/analytics')
  @ApiOperation({ summary: 'Factual M2 analytics for one match participant' })
  playerAnalytics(@Param('id') id: string, @Param('playerId') playerId: string, @Req() request: Request) { assertExactQuery(request, []); return this.service.playerAnalytics(assertOpaqueId(id, 'MATCH_NOT_FOUND'), assertOpaqueId(playerId, 'PLAYER_NOT_FOUND')); }

  @Get('matches/:id/experimental-participation-rating')
  @ApiOperation({ summary: 'Owner-selected participation rating; policy is server-only and cannot be selected over HTTP' })
  @ApiOkResponse({
    description: 'm4.3-participation-rating@1; policy-neutral read from the canonical match result',
    schema: activeParticipationRatingOpenApiSchema as unknown as SchemaObject
  })
  @ApiNotFoundResponse({ description: 'Match not found or ENABLE_EXPERIMENTAL_PARTICIPATION_RATING is not enabled' })
  @ApiConflictResponse({ description: 'Canonical result missing, corrupt or bound to a different owner policy' })
  @ApiUnprocessableEntityResponse({ description: 'HTTP policy selection is forbidden' })
  participationRating(@Param('id') id: string, @Req() request: Request) {
    assertNoPolicySelector(request);
    return this.service.participationRating(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }

  @Get('matches/:id/experimental-participation-explanation')
  @ApiOperation({ summary: 'Read-only explanation of the active participation rating and verified important moments' })
  @ApiOkResponse({
    description: 'm4.6-participation-explanation@1 built from the stored canonical match-result@1',
    schema: participationExplanationOpenApiSchema as unknown as SchemaObject
  })
  @ApiNotFoundResponse({ description: 'Match not found or ENABLE_EXPERIMENTAL_PARTICIPATION_RATING is not enabled' })
  @ApiConflictResponse({ description: 'REPORT_NOT_READY, REPORT_CORRUPT or REPORT_POLICY_MISMATCH' })
  participationExplanation(@Param('id') id: string, @Req() request: Request) {
    assertExactQuery(request, []);
    return this.service.participationExplanation(assertOpaqueId(id, 'MATCH_NOT_FOUND'));
  }

  @Delete('matches/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one inactive match and its owned artifacts' })
  @ApiConflictResponse({ description: 'MATCH_ACTIVE: an active worker owns this match' })
  @ApiNotFoundResponse({ description: 'MATCH_NOT_FOUND' })
  async deleteMatch(@Param('id') id: string, @Req() request: Request): Promise<void> { assertExactQuery(request, []); await this.service.deleteMatch(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }

  @Get('matches/:id/report')
  @ApiOperation({ summary: 'Versioned deterministic M3 scoring report; experimental policy, not causal probability' })
  @ApiOkResponse({ description: 'm3-score-1 report with all ten players, per-round ledgers and evidence episodes' })
  @ApiConflictResponse({ description: 'Report is pending or the stored artifact predates M2 analytics' })
  report(@Param('id') id: string, @Req() request: Request) { const query = assertExactQuery(request, ['version','configHash']); return this.service.report(assertOpaqueId(id, 'MATCH_NOT_FOUND'), query.version, query.configHash); }

  @Get('matches/:id/players/:playerId/report')
  @ApiOperation({ summary: 'Attributed findings and evidence episodes for one participant' })
  @ApiOkResponse({ description: 'Player components, findings, episodes and per-round rows for the selected scorer version' })
  playerReport(@Param('id') id: string, @Param('playerId') playerId: string, @Req() request: Request) { const query = assertExactQuery(request, ['version','configHash']); return this.service.playerReport(assertOpaqueId(id, 'MATCH_NOT_FOUND'), assertOpaqueId(playerId, 'PLAYER_NOT_FOUND'), query.version, query.configHash); }

  @Post('matches/:id/rescore')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue scoring from the stored M2 artifact without parsing the demo again' })
  @ApiAcceptedResponse({ description: 'RESCORE job queued with resolved scorer version and config hash' })
  @ApiConflictResponse({ description: 'Stored M2 artifact is unavailable or incompatible' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown scorer version/config hash' })
  @ApiBody({ schema: { type: 'object', required: ['scoringVersion'], properties: { scoringVersion: { type: 'string' }, configHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } })
  rescore(@Param('id') id: string, @Body() body: unknown, @Req() request: Request) { assertExactQuery(request, []); return this.service.rescore(assertOpaqueId(id, 'MATCH_NOT_FOUND'), body); }
}
