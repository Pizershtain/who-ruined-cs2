import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { MatchesModule } from './modules/matches/matches.module.js';

@Module({ imports: [HealthModule, MatchesModule] })
export class AppModule {}
