/**
 * Durable half-time score evidence. NEVER store half-time values in
 * app_match_result, whose scores mean the 90-minute final result.
 * The first valid HT transition fixes the 1H cutoff; two matching Zizobet
 * observations at least five seconds apart confirm its score and statistics.
 */
import {getMatches,getMatchById} from '../matches.mjs';
import {matchSnapshots} from './match-snapshots.mjs';
import {query} from '../db.mjs';
import {verifiedFinalStatistics} from '../match-statistics.mjs';

export const HALFTIME_RESULT_SQL=[
 'create table if not exists app_match_half_result (match_id bigint primary key, home_team text not null, away_team text not null, half_home_score integer not null check(half_home_score between 0 and 200), half_away_score integer not null check(half_away_score between 0 and 200), signature text not null, first_seen_at timestamptz not null default now(), signature_first_seen_at timestamptz not null default now(), observed_at timestamptz not null default now(), confirmed_at timestamptz, correction_count integer not null default 0, source text not null default ' + "'UNVERIFIED_LEGACY', statistics jsonb not null default '{}'::jsonb);",
 'alter table app_match_half_result alter column source set default ' + "'UNVERIFIED_LEGACY';",
 "alter table app_match_half_result add column if not exists signature_first_seen_at timestamptz;",
 "update app_match_half_result set signature_first_seen_at=first_seen_at where signature_first_seen_at is null;",
 "alter table app_match_half_result alter column signature_first_seen_at set default now();",
 "alter table app_match_half_result alter column signature_first_seen_at set not null;",
 "alter table app_match_half_result add column if not exists statistics jsonb not null default '{}'::jsonb;",
 ''
].join('\n');

const score=v=>v!=null&&v!==''&&/^\d+$/.test(String(v))&&
 Number.isSafeInteger(Number(v))&&Number(v)<=200?Number(v):null;
const milliseconds=v=>v==null?NaN:new Date(v).getTime();
const phaseOf=v=>{
 const s=String(v??'').trim().toLowerCase();
 if(/^(?:ht|half.?time|half time|break time|interval|break)$/.test(s))return 'HT';
 if(/^(?:2h|h2|second half|2nd half|2nd|second period)$/.test(s))return '2H';
 if(/^(?:ft|full.?time|finished|ended)$/.test(s))return 'FT';
 return null;
};
export function extractConfirmedHalfTimeCandidate(row){
 if(!row||!Number.isSafeInteger(Number(row.match_id))||Number(row.match_id)<=0)return null;
 // A half-time scoreboard is financial evidence only when it came from Zizobet.
 if(String(row.raw?.provider??'').toUpperCase()!=='ZIZOBET')return null;
 const phase=phaseOf(row.feed_status);
 // Only the actual HT transition is a safe cutoff for live bet eligibility.
 // A later 2H/FT snapshot may contain the old half score, but cannot prove
 // whether a wager was placed before or after that period had already ended.
 if(phase!=='HT')return null;
 let periods=row.periods_score;
 if(typeof periods==='string'){try{periods=JSON.parse(periods);}catch{return null;}}
 if(!Array.isArray(periods)||periods.length===0)return null;
 const first=periods[0],home=score(first?.t1),away=score(first?.t2);
 if(home==null||away==null)return null;
 const fullHome=score(row.home_score),fullAway=score(row.away_score);
 if(fullHome==null||fullAway==null||home>fullHome||away>fullAway)return null;
 if(phase==='HT'&&(home!==fullHome||away!==fullAway))return null;
 const scoreAt=milliseconds(row.score_at),phaseAt=milliseconds(row.feed_status_at),
  clockAt=milliseconds(row.clock_at);
 // score_at and feed_status_at identify the original score/HT transition.
 // clock_at proves this is a fresh primary snapshot of the HT transition.
 if(!Number.isFinite(scoreAt)||!Number.isFinite(phaseAt)||
    !Number.isFinite(clockAt)||Math.abs(scoreAt-phaseAt)>120000||
    clockAt<Math.max(scoreAt,phaseAt))return null;
 const at=clockAt;
 const primaryHome=String(row.home??'').trim(),primaryAway=String(row.away??'').trim();
 if(!primaryHome||!primaryAway||primaryHome===primaryAway)return null;
 const rawStats=verifiedFinalStatistics(row),statistics={};
 for(const [field,pair] of Object.entries(rawStats))
  if(pair?.home!=null&&pair?.away!=null)statistics[field]=pair;
 if(statistics.yellow&&statistics.red)statistics.cards={
  home:statistics.yellow.home+statistics.red.home,
  away:statistics.yellow.away+statistics.red.away};
 return {source:'ZIZOBET',matchId:Number(row.match_id),homeTeam:primaryHome,awayTeam:primaryAway,
  home,away,statistics,observedAt:new Date(at).toISOString(),
  signature:JSON.stringify([primaryHome,primaryAway,home,away,statistics])};
}
export async function persistHalfTimeCandidate(candidate,{execute=query}={}){
 if(!candidate||candidate.source!=='ZIZOBET')return {stored:false,confirmed:false};
 const statement=[
 'insert into app_match_half_result (match_id,home_team,away_team,half_home_score,half_away_score,signature,observed_at,source,first_seen_at,signature_first_seen_at,confirmed_at,statistics)',
 "values ($1,$2,$3,$4,$5,$6,$7::timestamptz,'ZIZOBET',$7::timestamptz,$7::timestamptz,null,$8::jsonb)",
 'on conflict(match_id) do update set',
 'home_team=excluded.home_team, away_team=excluded.away_team,',
 'half_home_score=excluded.half_home_score,half_away_score=excluded.half_away_score,',
 'correction_count=app_match_half_result.correction_count+case when app_match_half_result.signature<>excluded.signature then 1 else 0 end,',
 'signature=excluded.signature,source=excluded.source,',
 // first_seen_at remains the original HT cutoff. A separate timestamp tracks
 // the first observation of this exact signature for the five-second rule.
 "first_seen_at=case when app_match_half_result.source='ZIZOBET' then app_match_half_result.first_seen_at else excluded.observed_at end,",
 "signature_first_seen_at=case when app_match_half_result.source='ZIZOBET' and app_match_half_result.signature=excluded.signature then app_match_half_result.signature_first_seen_at else excluded.observed_at end,",
 "confirmed_at=case when app_match_half_result.source='ZIZOBET' and app_match_half_result.signature=excluded.signature and excluded.observed_at-app_match_half_result.signature_first_seen_at>=interval '5 seconds' then coalesce(app_match_half_result.confirmed_at,now()) else null end,",
 "statistics=case when app_match_half_result.source='ZIZOBET' and app_match_half_result.signature=excluded.signature then coalesce(app_match_half_result.statistics,'{}'::jsonb)||excluded.statistics else excluded.statistics end,",
 'observed_at=excluded.observed_at',
 'where excluded.observed_at>app_match_half_result.observed_at',
 'returning confirmed_at,correction_count'
 ].join(' ');
 const r=await execute(statement,[candidate.matchId,candidate.homeTeam,candidate.awayTeam,
    candidate.home,candidate.away,candidate.signature,candidate.observedAt,JSON.stringify(candidate.statistics??{})]);
 return {stored:r.rowCount>0,confirmed:r.rows[0]?.confirmed_at!=null,
   corrections:Number(r.rows[0]?.correction_count??0)};
}
export async function captureHalfTimeResults({
 runQuery=query,loadMatches=getMatches,loadMatch=getMatchById,
 loadSnapshots=ids=>matchSnapshots.load(ids)
}={}){
 const pend=(await runQuery([
  'select distinct l.match_id from app_ticket_line l',
  'join app_ticket t on t.id=l.ticket_id',
  "where l.status='PENDING' and t.status='PENDING'",
  'order by l.match_id limit 4000'
 ].join(' '))).rows.map(v=>Number(v.match_id));
 if(!pend.length)return {examined:0,recorded:0,confirmed:0};
 // A fresh in-memory row sometimes contains only a clock/score delta,
 // while the durable snapshot still has the native HT SetScores. Choose
 // among VALID primary candidates; an invalid header cannot mask history.
 const relevant=new Set(pend),candidates=new Map();
 const consider=row=>{
  const id=Number(row?.match_id);
  if(!relevant.has(id))return;
  const candidate=extractConfirmedHalfTimeCandidate(row);
  if(!candidate)return;
  const prior=candidates.get(id);
  if(!prior||Date.parse(candidate.observedAt)>Date.parse(prior.observedAt))
   candidates.set(id,candidate);
 };
 for(const row of await loadMatches({includeEnded:true,limit:4000}))consider(row);
 for(const snapshot of await loadSnapshots(pend))consider(snapshot);
 for(const id of pend)if(!candidates.has(id))consider(await loadMatch(id));
 let recorded=0,confirmed=0;
 for(const candidate of candidates.values()){
  try{
   const r=await persistHalfTimeCandidate(candidate,{execute:runQuery});
   if(r.stored)recorded++;
   if(r.confirmed)confirmed++;
  }catch(error){console.warn('[settle] halftime candidate capture failed',candidate.matchId,error?.message);}
 }
 return {examined:pend.length,recorded,confirmed};
}
