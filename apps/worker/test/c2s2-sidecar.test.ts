import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { c2s2PreparedSidecarSchema, type C2S2PreparedSidecar } from '@who-ruined/contracts';
import { C2S2_MODEL_VERSION, C2S2_POLICY_DIGEST, C2S2_REFERENCE_VERSION } from '@who-ruined/scoring';
import { c2s2SidecarRelativePath, persistC2S2PreparedSidecar } from '../src/c2s2-sidecar.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function fixture():C2S2PreparedSidecar{const preparedProfiles=Array.from({length:10},(_,index)=>({profileKey:`profile-${index}`,playerId:`player-${index}`,teamId:index<5?'team-a':'team-b',scenario:'BOMB' as const,rounds:1,validRounds:1,tRounds:1,ctRounds:1,requiredInputStatus:'COMPLETE',p4BPlus:{status:'CALCULATED_RESEARCH_ONLY' as const,reason:null,familyContributions:{COMBAT:0,SUPPORT:0,DEATH_RELATED:0,DIRECT_HARM:0,CONTEXT:0,OBJECTIVES:0},episodeContributions:[]},p4CPlus:{status:'CALCULATED_RESEARCH_ONLY' as const,reason:null,familyContributions:{COMBAT:0,SUPPORT:0,DEATH_RELATED:0,DIRECT_HARM:0,CONTEXT:0,OBJECTIVES:0},objectiveSignals:{'objective:plants':0,'objective:defuses':0},episodeContributions:[]}}));return c2s2PreparedSidecarSchema.parse({schemaVersion:'m3c8-c2s2-prepared-sidecar-1',createdAt:'2026-10-23T00:00:00.000Z',binding:{matchId:'match-a',fileSha256:'a'.repeat(64),parserVersion:'0.42.0',normalizerVersion:'m2.5-0.2.0'},model:{modelVersion:C2S2_MODEL_VERSION,policyDigest:C2S2_POLICY_DIGEST,referenceVersion:C2S2_REFERENCE_VERSION},scenario:'BOMB',roundEvidence:[],hostageActions:[],armorAxes:[],physicalAnchors:[],contextTagRegistry:['OPENING','TRADE','FAST_TRADE','MULTI_KILL','DISADVANTAGE','ALIVE_LEAD_TAKEN','POSTPLANT','FLASH_ASSIST','FLASH_TEAM_KILL_WINDOW','FLASH_TEAM_DAMAGE_WINDOW','LOW_EQUIP_COMBAT'],contextTags:[],preparedProfiles});}

describe('C2+S2 prepared sidecar persistence',()=>{
  it('writes a validated immutable gzip artifact through a same-directory temporary file',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'wrc-c2s2-'));roots.push(root);const value=fixture();const relative=await persistC2S2PreparedSidecar(root,value);expect(relative).toBe(c2s2SidecarRelativePath(value.binding.matchId,value.binding.fileSha256));const decoded=c2s2PreparedSidecarSchema.parse(JSON.parse(gunzipSync(await readFile(path.join(root,...relative.split('/')))).toString('utf8')));expect(decoded.preparedProfiles).toHaveLength(10);expect(await readdir(path.dirname(path.join(root,...relative.split('/'))))).toEqual([path.basename(relative)]);expect(await persistC2S2PreparedSidecar(root,value)).toBe(relative);});
  it('refuses to replace a corrupt artifact at an immutable versioned path',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'wrc-c2s2-'));roots.push(root);const value=fixture();const relative=await persistC2S2PreparedSidecar(root,value);await import('node:fs/promises').then(({writeFile})=>writeFile(path.join(root,...relative.split('/')),'corrupt'));await expect(persistC2S2PreparedSidecar(root,value)).rejects.toThrow('C2S2_SIDECAR_INVALID_EXISTING');});
});
