import 'reflect-metadata';
import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ProfilesController } from './profiles-controller.js';
import { ProfileQueries } from './read-profiles.js';
import { ProfileStore } from './store.js';
import { MatchPublicationClient, ProfileSynchronization } from './synchronization.js';
import { connectToProfilesDatabase, resolveProfilesRuntime } from './runtime.js';

const runtime = resolveProfilesRuntime();
const db = connectToProfilesDatabase();
const store = new ProfileStore(db);
const sync = new ProfileSynchronization(store, new MatchPublicationClient(runtime.coreOrigin, runtime.token));

class Shutdown implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await sync.stop();
    await db.$disconnect();
  }
}

@Module({
  controllers: [ProfilesController],
  providers: [
    { provide: ProfileStore, useValue: store },
    { provide: ProfileQueries, useValue: new ProfileQueries(store) },
    { provide: ProfileSynchronization, useValue: sync },
    Shutdown,
  ],
})
class ProfilesModule {}

await db.$connect();
const app = await NestFactory.create(ProfilesModule, { bodyParser: false, logger: ['log', 'warn'] });
app.setGlobalPrefix('api/v1');
app.enableCors({ origin: ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174'], methods: ['GET'] });
app.enableShutdownHooks();
await app.listen(runtime.port, runtime.bindHost);
sync.start();
