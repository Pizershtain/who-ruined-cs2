import 'reflect-metadata';
import { mkdir } from 'node:fs/promises';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { SafeExceptionFilter } from './safe-exception.filter.js';
import { dataDir } from './storage.js';
import { resolveApiBindHost } from './runtime-config.js';

await Promise.all(['uploads','cache','reports'].map((name) => mkdir(new URL(name + '/', dataDir), { recursive: true })));
const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api/v1');
app.useGlobalFilters(new SafeExceptionFilter());
const config = new DocumentBuilder().setTitle('Who Ruined CS2 local API').setVersion('0.2.0').build();
SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
await app.listen(Number(process.env.PORT ?? 3000), resolveApiBindHost());
