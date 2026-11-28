import { setTimeout as delay } from 'node:timers/promises';
import {
  matchPublicationStateSchema, matchPublicationsSchema, type MatchPublications, type MatchPublicationState,
} from '@who-ruined/contracts';
import type { ProfileStore } from './store.js';

class PublicationConnectionError extends Error {}

export class MatchPublicationClient {
  constructor(private readonly origin: URL, private readonly token: string) {}

  private async get(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(new URL(path, this.origin), {
      headers: { authorization: 'Bearer ' + this.token }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    }).catch((cause: unknown) => { throw new PublicationConnectionError('PUBLICATION_CONNECTION_FAILED', { cause }); });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      if ([502, 503, 504].includes(response.status)) throw new PublicationConnectionError('PUBLICATION_HTTP_' + response.status);
      throw new Error('PUBLICATION_HTTP_' + response.status);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read().catch((cause: unknown) => {
          throw new PublicationConnectionError('PUBLICATION_CONNECTION_FAILED', { cause });
        });
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 4 * 1024 * 1024) throw new Error('PUBLICATION_SIZE_LIMIT');
        chunks.push(item.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  async list(after: bigint, signal: AbortSignal): Promise<MatchPublications['events']> {
    return matchPublicationsSchema.parse(await this.get('/api/v1/internal/match-publications?after=' + after, signal)).events;
  }

  async state(matchId: string, minimumRevision: bigint, signal: AbortSignal): Promise<MatchPublicationState> {
    const state = matchPublicationStateSchema.parse(
      await this.get('/api/v1/internal/match-publications/' + encodeURIComponent(matchId), signal),
    );
    if (state.matchId !== matchId || BigInt(state.revision) < minimumRevision) {
      throw new Error('PUBLICATION_STATE_BINDING_MISMATCH');
    }
    return state;
  }
}

export class ProfileSynchronization {
  private readonly abort = new AbortController();
  private running: Promise<void> | undefined;
  private lastReadAt: Date | null = null;
  private sourceReachable = false;
  private caughtUp = false;
  private lastReadRevision: string | null = null;

  constructor(
    private readonly store: Pick<ProfileStore, 'cursor' | 'receive' | 'pending' | 'apply' | 'failed' | 'backfillNext' | 'completeReplay'>,
    private readonly core: MatchPublicationClient,
  ) {}

  start(): void {
    this.running ??= this.loop(this.abort.signal);
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.running;
  }

  readiness(revision: string) {
    return {
      sourceOnline: this.sourceReachable && this.lastReadAt !== null && Date.now() - this.lastReadAt.getTime() <= 30_000,
      feedCaughtUp: this.caughtUp && this.lastReadRevision === revision,
      lastReadAt: this.lastReadAt?.toISOString() ?? null,
    };
  }

  async poll(signal: AbortSignal): Promise<void> {
    const after = await this.store.cursor();
    const events = await this.core.list(after, signal).catch((error: unknown) => {
      this.sourceReachable = false;
      this.caughtUp = false;
      throw error;
    });
    if (events.length > 0) this.caughtUp = false;
    await this.store.receive(after, events);
    this.sourceReachable = true;
    this.lastReadAt = new Date();
    const readRevision = events.at(-1)?.revision ?? after.toString();
    this.lastReadRevision = readRevision;
    this.caughtUp = events.length < 100;
    for (const pending of await this.store.pending()) {
      if (signal.aborted) return;
      let snapshot: MatchPublicationState | null = null;
      try {
        snapshot = await this.core.state(pending.matchId, pending.revision, signal);
        if (BigInt(snapshot.revision) > BigInt(readRevision)) this.caughtUp = false;
        await this.store.apply(snapshot);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof PublicationConnectionError) {
          this.sourceReachable = false;
          this.caughtUp = false;
        }
        await this.store.failed(pending.matchId, pending.revision, pending.attempts, snapshot);
      }
    }
    if (this.caughtUp) await this.store.completeReplay(BigInt(readRevision));
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.poll(signal);
      } catch {
        this.caughtUp = false;
      }
      try {
        // Bound maintenance work between polls. It uses only Profiles data.
        for (let batch = 0; batch < 8 && !signal.aborted; batch++) {
          if (!await this.store.backfillNext()) break;
        }
      } catch {
        console.warn('PROFILE_AGGREGATE_BACKFILL_RETRY');
      }
      await delay(1_000, undefined, { signal }).catch(() => undefined);
    }
  }
}
