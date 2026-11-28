import { Controller, Get, Header, HttpException, Inject, Param, Req, Res } from '@nestjs/common';
import { profileSteamIdSchema } from '@who-ruined/contracts';
import type { Request, Response } from 'express';
import { decodeHistoryCursor, ProfileQueries } from './read-profiles.js';
import { ProfileSynchronization } from './synchronization.js';
import { ProfileStore } from './store.js';

function invalid(): never {
  throw new HttpException({ error: { code: 'INVALID_QUERY', message: 'Invalid profile history query.' } }, 422);
}

function exactQuery(request: Request, keys: readonly string[]): void {
  if (Object.entries(request.query).some(([key, value]) => !keys.includes(key) || typeof value !== 'string')) invalid();
}

function steamId(id: string): string {
  const validated = profileSteamIdSchema.safeParse(id);
  if (!validated.success) {
    throw new HttpException({ error: { code: 'INVALID_STEAM_ID', message: 'SteamID64 is invalid.' } }, 422);
  }
  return validated.data;
}

@Controller()
export class ProfilesController {
  constructor(
    @Inject(ProfileQueries) private readonly queries: ProfileQueries,
    @Inject(ProfileStore) private readonly store: ProfileStore,
    @Inject(ProfileSynchronization) private readonly synchronization: ProfileSynchronization,
  ) {}

  @Get('health')
  health() { return { status: 'ok' }; }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    const source = await this.store.status().catch(() => {
      throw new HttpException({ status: 'database_unavailable' }, 503);
    });
    const connectivity = this.synchronization.readiness(source.revision);
    return {
      status: connectivity.sourceOnline && connectivity.feedCaughtUp && source.pending === 0
        && source.aggregateBackfillComplete && !source.replaying ? 'ready' : 'degraded',
      ...source, ...connectivity,
    };
  }

  @Get('players/:steamId/profile')
  @Header('Cache-Control', 'no-store')
  async profile(@Param('steamId') id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    exactQuery(request, []);
    const projection = await this.queries.profile(steamId(id));
    const feed = this.synchronization.readiness(projection.feedRevision);
    const current = feed.sourceOnline && feed.feedCaughtUp && !projection.playerPending;
    const status = projection.rebuilding ? 'REBUILDING' : current ? 'CURRENT' : 'STALE';
    response.setHeader('X-Profile-Sync-State', status);
    if (projection.revision !== null) response.setHeader('X-Profile-Revision', projection.revision);
    if (projection.profile) return projection.profile;
    if (status !== 'CURRENT') {
      throw new HttpException({ error: { code: 'PROFILE_NOT_READY', message: 'The player projection is still synchronizing.' } }, 503);
    }
    throw new HttpException({ error: { code: 'PROFILE_NOT_FOUND', message: 'Player profile not found.' } }, 404);
  }

  @Get('players/:steamId/profile/matches')
  @Header('Cache-Control', 'no-store')
  history(@Param('steamId') id: string, @Req() request: Request) {
    exactQuery(request, ['limit', 'cursor']);
    const { limit = '20', cursor } = request.query;
    if (typeof limit !== 'string' || !/^[1-9][0-9]?$/u.test(limit) || Number(limit) > 50) invalid();
    const validated = typeof cursor === 'string' ? decodeHistoryCursor(cursor) : null;
    if (cursor !== undefined && validated === null) invalid();
    return this.queries.history(steamId(id), Number(limit), validated);
  }
}
