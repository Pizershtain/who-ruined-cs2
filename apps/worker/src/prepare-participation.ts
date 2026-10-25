import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@who-ruined/database';
import { matchDataSchema } from '@who-ruined/contracts';
import { normalizeSnapshot } from '@who-ruined/match-domain';
import { parseDemoSnapshot } from '@who-ruined/parser-adapter';
import { buildParticipationSidecar, persistParticipationSidecar } from './participation-sidecar.js';
import { resolveDataPath } from './storage.js';

const dataRoot=path.resolve(process.env.DATA_DIR??path.resolve(process.cwd(),'data'));
const ids=process.argv.slice(2).filter((value)=>value!=='--all'&&value!=='--');const all=process.argv.includes('--all');
if(!all&&!ids.length)throw new Error('Usage: pnpm experimental:participation:prepare -- <matchId...> | --all');
async function sha256(file:string){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk as Buffer);return h.digest('hex');}
const matches=await prisma.match.findMany({where:all?{status:{in:['COMPLETED','PARTIAL']}}:{id:{in:ids}}});let failed=0;
for(const match of matches){try{if(!match.rawFilePath)throw new Error('REQUIRES_ORIGINAL_DEMO');const demoPath=resolveDataPath(dataRoot,match.rawFilePath);try{await access(demoPath);}catch{throw new Error('REQUIRES_ORIGINAL_DEMO');}if(await sha256(demoPath)!==match.fileSha256)throw new Error('SOURCE_DEMO_SHA256_MISMATCH');const snapshot=parseDemoSnapshot(demoPath);const normalized=matchDataSchema.parse(normalizeSnapshot({matchId:match.id,fileSha256:match.fileSha256,snapshot}));const relative=await persistParticipationSidecar(dataRoot,buildParticipationSidecar(snapshot,normalized,demoPath));process.stdout.write(`${match.id}\tPASS\t${relative}\n`);}catch(error){failed++;process.stderr.write(`${match.id}\tFAIL\t${error instanceof Error?error.message:'UNKNOWN'}\n`);}}
for(const id of ids.filter((id)=>!matches.some((m)=>m.id===id))){failed++;process.stderr.write(`${id}\tFAIL\tMATCH_NOT_FOUND\n`);}await prisma.$disconnect();if(failed)process.exitCode=1;
