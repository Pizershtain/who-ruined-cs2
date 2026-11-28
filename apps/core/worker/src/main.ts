import path from 'node:path';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';
import { workerDependencies } from './runner/worker-dependencies.js';
import { runWorker } from './runner/worker-runner.js';

const config = resolveWorkerRuntimeConfig();
const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
await runWorker({ config, dataRoot, dependencies: workerDependencies });
