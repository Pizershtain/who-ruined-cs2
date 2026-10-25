import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { C2S2_MODEL_VERSION, C2S2_POLICY_DIGEST, C2S2_REFERENCE_VERSION } from '@who-ruined/scoring';
import { NORMALIZER_VERSION } from '@who-ruined/parser-adapter';

const findUnique=vi.fn();const readFile=vi.fn();const access=vi.fn();
vi.mock('@who-ruined/database',()=>({prisma:{match:{findUnique},report:{findUnique:vi.fn()},job:{create:vi.fn()}}}));
vi.mock('node:fs/promises',async(original)=>({...await original<typeof import('node:fs/promises')>(),readFile,access}));
const {MatchesService}=await import('../src/matches.service.js');

function fixture(){
  const a=Array.from({length:5},(_,index)=>`7656119800000000${index}`),b=Array.from({length:5},(_,index)=>`7656119800000001${index}`);const teamA='team-a',teamB='team-b';
  const match={schemaVersion:'1' as const,matchId:'synthetic-match',fileSha256:'a'.repeat(64),map:'de_synthetic',tickRate:64,teams:[{id:teamA,playerIds:a,label:'A'},{id:teamB,playerIds:b,label:'B'}],players:[...a.map((id,index)=>({id,steamId:id,displayName:`A${index}`,teamId:teamA})),...b.map((id,index)=>({id,steamId:id,displayName:`B${index}`,teamId:teamB}))],rounds:[{id:'round-1',ordinal:1,startTick:0,freezeEndTick:10,endTick:100,winnerTeamId:teamA,winnerSide:'T' as const,sideByTeamId:{[teamA]:'T' as const,[teamB]:'CT' as const},scoreBefore:{[teamA]:0,[teamB]:0},scoreAfter:{[teamA]:1,[teamB]:0},isValid:true,issues:[]}],events:[],quality:'VALID' as const,qualityIssues:[],provenance:{parser:'synthetic',parserVersion:'0',normalizedAt:'2026-10-23T00:00:00.000Z'}};
  const analytics={schemaVersion:'m2-1' as const,featureVersion:'m2-0.1.0' as const,matchId:match.matchId,generatedAt:'2026-10-23T00:00:00.000Z',tradeWindowSeconds:5 as const,availability:{damage:'AVAILABLE' as const,flashes:'AVAILABLE' as const,economy:'AVAILABLE' as const,aliveContext:'AVAILABLE' as const},players:match.players.map((player)=>({playerId:player.id,teamId:player.teamId,roundsPlayed:1,kills:0,deaths:0,assists:0,kdaRatio:0,enemyDamage:0,teamDamage:0,adr:0,kastRounds:0,kastPercent:0,survivedRounds:0,openingKills:0,openingDeaths:0,tradeKills:0,deathsTraded:0,untradedDeaths:0,tradeParticipation:0,multiKills:{two:0,three:0,four:0,five:0},clutches:{},killsWithAdvantage:0,killsAtDisadvantage:0,teamKills:0,suicides:0,bomb:{plants:0,defuses:0,explosions:0},grenades:{flashesThrown:0,enemiesFlashed:0,teammatesFlashed:0,enemyBlindSeconds:0,teamBlindSeconds:0,heThrown:0,heEnemyDamage:0,heTeamDamage:0,infernosStarted:0,infernoEnemyDamage:0,infernoTeamDamage:0,smokesThrown:0,smokeEffectiveness:null},economy:{availability:'AVAILABLE' as const,freezeEquipmentValueTotal:0,freezeRoundsObserved:1,money:null},facts:[]})),limitations:[]};
  const artifact={schemaVersion:'m2-artifact-1',match,analytics};
  const families={COMBAT:0,SUPPORT:0,DEATH_RELATED:0,DIRECT_HARM:0,CONTEXT:0,OBJECTIVES:0};
  const preparedProfiles=match.players.map((player,index)=>({profileKey:`${match.matchId}:P${String(index+1).padStart(2,'0')}`,playerId:player.id,teamId:player.teamId,scenario:'BOMB',rounds:13,validRounds:13,tRounds:6,ctRounds:7,requiredInputStatus:'COMPLETE',p4BPlus:{status:'CALCULATED_RESEARCH_ONLY',reason:null,familyContributions:families,episodeContributions:[]},p4CPlus:{status:'CALCULATED_RESEARCH_ONLY',reason:null,familyContributions:families,objectiveSignals:{'objective:plants':0,'objective:defuses':0},episodeContributions:[]}}));
  const sidecar={schemaVersion:'m3c8-c2s2-prepared-sidecar-1',createdAt:'2026-10-23T00:00:00.000Z',binding:{matchId:match.matchId,fileSha256:match.fileSha256,parserVersion:match.provenance.parserVersion,normalizerVersion:NORMALIZER_VERSION},model:{modelVersion:C2S2_MODEL_VERSION,policyDigest:C2S2_POLICY_DIGEST,referenceVersion:C2S2_REFERENCE_VERSION},scenario:'BOMB',roundEvidence:[],hostageActions:[],armorAxes:[],physicalAnchors:[],contextTagRegistry:['OPENING','TRADE','FAST_TRADE','MULTI_KILL','DISADVANTAGE','ALIVE_LEAD_TAKEN','POSTPLANT','FLASH_ASSIST','FLASH_TEAM_KILL_WINDOW','FLASH_TEAM_DAMAGE_WINDOW','LOW_EQUIP_COMBAT'],contextTags:[],preparedProfiles};
  return{match,artifact,sidecar};
}

describe('C2+S2 opt-in API mode',()=>{
  beforeEach(()=>{process.env.ENABLE_EXPERIMENTAL_RATING='1';findUnique.mockReset();readFile.mockReset();access.mockReset();access.mockResolvedValue(undefined);});
  it('loads the exact versioned sidecar only when explicitly selected',async()=>{
    const data=fixture();findUnique.mockResolvedValue({id:data.match.matchId,normalizedFilePath:`cache/${data.match.matchId}.json.gz`,rawFilePath:'uploads/source.dem'});
    readFile.mockImplementation(async(value)=>gzipSync(Buffer.from(JSON.stringify(String(value).includes('c2s2')?data.sidecar:data.artifact))));
    const response=await new MatchesService().experimentalRating(data.match.matchId,'c2-s2');
    expect(response.schemaVersion).toBe('m3c8-c2s2-integration-1');
    expect(response.players).toHaveLength(10);
    expect(response.players.every((player)=>player.status==='CALCULATED_RESEARCH_ONLY')).toBe(true);
    expect(response.players.every((player)=>player.familyContributions&&Object.keys(player.familyContributions).length===6)).toBe(true);
  });
  it('does not approximate C2+S2 when the sidecar is missing',async()=>{
    const data=fixture();findUnique.mockResolvedValue({id:data.match.matchId,normalizedFilePath:`cache/${data.match.matchId}.json.gz`,rawFilePath:'uploads/source.dem'});
    readFile.mockImplementationOnce(async()=>gzipSync(Buffer.from(JSON.stringify(data.artifact)))).mockRejectedValueOnce(Object.assign(new Error('missing'),{code:'ENOENT'}));
    await expect(new MatchesService().experimentalRating(data.match.matchId,'c2-s2')).rejects.toMatchObject({code:'C2S2_SIDECAR_UNAVAILABLE',status:409});
  });
  it('reports an unavailable source demo instead of calculating a partial C2',async()=>{
    const data=fixture();findUnique.mockResolvedValue({id:data.match.matchId,normalizedFilePath:`cache/${data.match.matchId}.json.gz`,rawFilePath:null});
    readFile.mockImplementationOnce(async()=>gzipSync(Buffer.from(JSON.stringify(data.artifact)))).mockRejectedValueOnce(Object.assign(new Error('missing'),{code:'ENOENT'}));
    await expect(new MatchesService().experimentalRating(data.match.matchId,'c2-s2')).rejects.toMatchObject({code:'C2S2_SOURCE_DEMO_UNAVAILABLE',status:409});
  });
  it('rejects a validly encoded sidecar bound to another source hash',async()=>{
    const data=fixture();const stale={...data.sidecar,binding:{...data.sidecar.binding,fileSha256:'b'.repeat(64)}};
    findUnique.mockResolvedValue({id:data.match.matchId,normalizedFilePath:`cache/${data.match.matchId}.json.gz`,rawFilePath:'uploads/source.dem'});
    readFile.mockImplementation(async(value)=>gzipSync(Buffer.from(JSON.stringify(String(value).includes('c2s2')?stale:data.artifact))));
    await expect(new MatchesService().experimentalRating(data.match.matchId,'c2-s2')).rejects.toMatchObject({code:'C2S2_SIDECAR_STALE',status:409});
  });
  it('rejects unknown selectors without changing the default route semantics',async()=>{
    await expect(new MatchesService().experimentalRating('match','invented')).rejects.toMatchObject({code:'UNSUPPORTED_MODE',status:422});
    expect(findUnique).not.toHaveBeenCalled();
  });
});
