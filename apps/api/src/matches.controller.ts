import { Body, Controller, Get, HttpCode, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiAcceptedResponse, ApiBody, ApiConflictResponse, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MatchesService } from './matches.service.js';
import { dataRoot } from './storage.js';
import { ApiError } from './safe-exception.filter.js';

const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 262_144_000);

@ApiTags('matches')
@Controller()
export class MatchesController {
  constructor(private readonly service: MatchesService) {}

  @Post('matches')
  @HttpCode(202)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['demo'], properties: { demo: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('demo', { storage: diskStorage({ destination: path.join(dataRoot, 'uploads'), filename: (_request, _file, callback) => callback(null, `${randomUUID()}.dem`) }), limits: { fileSize: maxUploadBytes, files: 1 } }))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ApiError('INVALID_DEMO', 'Поле multipart demo обязательно.', 422);
    return this.service.ingest(file);
  }

  @Get('jobs/:id') job(@Param('id') id: string) { return this.service.job(id); }
  @Get('matches') list(@Query('cursor') cursor?: string) { return this.service.list(cursor); }
  @Get('matches/:id') match(@Param('id') id: string) { return this.service.match(id); }
  @Get('matches/:id/rounds') rounds(@Param('id') id: string) { return this.service.rounds(id); }
  @Get('matches/:id/analytics')
  @ApiOperation({ summary: 'Versioned factual M2 analytics without scores or blame labels' })
  analytics(@Param('id') id: string) { return this.service.analytics(id); }
  @Get('matches/:id/players/:playerId/analytics')
  @ApiOperation({ summary: 'Factual M2 analytics for one match participant' })
  playerAnalytics(@Param('id') id: string, @Param('playerId') playerId: string) { return this.service.playerAnalytics(id, playerId); }

  @Get('matches/:id/experimental-rating')
  @ApiOperation({ summary: 'Feature-flagged M3-C8 experimental player ratings and factual analytics; not calibrated causal blame' })
  @ApiOkResponse({ description: 'm3c8-integration-1 typed response for a supported 5v5 M2 artifact' })
  @ApiConflictResponse({ description: 'Stored artifact predates M2 analytics' })
  experimentalRating(@Param('id') id: string) { return this.service.experimentalRating(id); }

  @Get('matches/:id/report')
  @ApiOperation({ summary: 'Versioned deterministic M3 scoring report; experimental policy, not causal probability' })
  @ApiOkResponse({ description: 'm3-score-1 report with all ten players, per-round ledgers and evidence episodes' })
  @ApiConflictResponse({ description: 'Report is pending or the stored artifact predates M2 analytics' })
  report(@Param('id') id: string, @Query('version') version?: string, @Query('configHash') configHash?: string) { return this.service.report(id, version, configHash); }

  @Get('matches/:id/players/:playerId/report')
  @ApiOperation({ summary: 'Attributed findings and evidence episodes for one participant' })
  @ApiOkResponse({ description: 'Player components, findings, episodes and per-round rows for the selected scorer version' })
  playerReport(@Param('id') id: string, @Param('playerId') playerId: string, @Query('version') version?: string, @Query('configHash') configHash?: string) { return this.service.playerReport(id, playerId, version, configHash); }

  @Post('matches/:id/rescore')
  @HttpCode(202)
  @ApiOperation({ summary: 'Queue scoring from the stored M2 artifact without parsing the demo again' })
  @ApiAcceptedResponse({ description: 'RESCORE job queued with resolved scorer version and config hash' })
  @ApiConflictResponse({ description: 'Stored M2 artifact is unavailable or incompatible' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown scorer version/config hash' })
  @ApiBody({ schema: { type: 'object', required: ['scoringVersion'], properties: { scoringVersion: { type: 'string' }, configHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } } } })
  rescore(@Param('id') id: string, @Body() body: unknown) { return this.service.rescore(id, body); }
}
