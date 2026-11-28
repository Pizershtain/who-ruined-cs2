import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ApiBody, ApiConflictResponse, ApiConsumes, ApiNotFoundResponse, ApiOperation, ApiPayloadTooLargeResponse, ApiResponse, ApiTags, ApiUnsupportedMediaTypeResponse, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { DeleteMatch } from '../../application/use-cases/delete-match.js';
import { IngestDemo, type ReceivedDemo } from '../../application/use-cases/ingest-demo.js';
import { matchUploadContractVersion, uploadReuseStatuses } from '@who-ruined/contracts';
import { MatchQueries } from '../../application/use-cases/match-queries.js';
import { safeDataPath } from '../../storage.js';
import { ApiError } from '../../safe-exception.filter.js';
import { UploadAdmissionInterceptor } from '../../upload-admission.interceptor.js';
import { resolveUploadConfig } from '../../upload-config.js';
import { createAbortSafeDiskStorage } from '../../upload-storage.js';
import { assertExactQuery, assertOpaqueId } from '../../http-validation.js';

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
  constructor(
    @Inject(IngestDemo) private readonly ingestDemo: IngestDemo,
    @Inject(MatchQueries) private readonly queries: MatchQueries,
    @Inject(DeleteMatch) private readonly deleteMatchUseCase: DeleteMatch,
  ) {}

  @Post('matches')
  @HttpCode(202)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['demo'], properties: { demo: { type: 'string', format: 'binary' } } } })
  @ApiResponse({ status: 202, description: matchUploadContractVersion, schema: {
    type: 'object', required: ['matchId', 'jobId', 'duplicate'],
    properties: { matchId: { type: 'string' }, jobId: { type: 'string' }, duplicate: { type: 'boolean' },
      reuseStatus: { type: 'string', enum: [...uploadReuseStatuses] } },
  } })
  @ApiConflictResponse({ description: 'MATCH_ACTIVE, REPORT_NOT_READY, REPORT_CORRUPT or REPORT_POLICY_MISMATCH' })
  @ApiPayloadTooLargeResponse({ description: 'SIZE_LIMIT: the demo exceeds MAX_UPLOAD_BYTES' })
  @ApiUnsupportedMediaTypeResponse({ description: 'INVALID_DEMO: only .dem uploads are accepted' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_DEMO: missing, empty, malformed, truncated or non-Source-2 demo' })
  @ApiResponse({ status: 503, description: 'INGESTION_PERSISTENCE_FAILED: upload metadata could not be committed atomically' })
  @ApiResponse({ status: 507, description: 'STORAGE_UNAVAILABLE: upload storage is unavailable or lacks the configured safety reserve' })
  @UseInterceptors(new UploadAdmissionInterceptor(uploadDirectory, uploadConfig), FileInterceptor('demo', createDemoUploadOptions()))
  async upload(@UploadedFile() file?: ReceivedDemo) {
    if (!file) throw new ApiError('INVALID_DEMO', 'Поле multipart demo обязательно.', 422);
    return this.ingestDemo.execute(file);
  }

  @Get('jobs/:id') job(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.queries.job(assertOpaqueId(id, 'JOB_NOT_FOUND')); }
  @Get('matches') list(@Req() request: Request) { const query = assertExactQuery(request, ['cursor']); return this.queries.list(query.cursor); }
  @Get('matches/:id') match(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.queries.match(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }
  @Get('matches/:id/rounds') rounds(@Param('id') id: string, @Req() request: Request) { assertExactQuery(request, []); return this.queries.rounds(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }

  @Delete('matches/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete one inactive match and its owned artifacts' })
  @ApiConflictResponse({ description: 'MATCH_ACTIVE: an active worker owns this match' })
  @ApiNotFoundResponse({ description: 'MATCH_NOT_FOUND' })
  async deleteMatch(@Param('id') id: string, @Req() request: Request): Promise<void> { assertExactQuery(request, []); await this.deleteMatchUseCase.execute(assertOpaqueId(id, 'MATCH_NOT_FOUND')); }
}
