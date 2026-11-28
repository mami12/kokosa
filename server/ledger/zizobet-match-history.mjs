import {createHash} from 'node:crypto';
import {pool} from '../db.mjs';
import {normalizeLiveFrame} from './live-observation-store.mjs';
import {persistVerifiedEventFacts,invalidateContradictedEventCoverage} from './match-event-facts.mjs';
import {providerResultPair} from '../match-statistics.mjs';

/** Independent sporting archive. It never contains prices and never pays bets. */
export const ZIZOBET_MATCH_HISTORY_SQL = [
 "create table if not exists app_zizobet_match_history (match_id bigint primary key, details jsonb not null, timeline_signature text, observed_at timestamptz not null default now());",
 "alter table app_zizobet_match_history add column if not exists evidence_observed_at timestamptz;",
 "create table if not exists app_zizobet_match_incident (match_id bigint not null, kind text not null check(kind in ('goal','corner','card','foul')), provider_event_id text not null, team text not null check(team in ('home','away')), minute integer not null check(minute between 0 and 130), sequence integer, detail jsonb not null, active boolean not null default true, first_observed_at timestamptz not null default now(), observed_at timestamptz not null default now(), primary key(match_id,kind,provider_event_id));",
 "alter table app_zizobet_match_incident add column if not exists sequence integer;",
 "create index if not exists app_zizobet_match_incident_sequence_lookup on app_zizobet_match_incident(match_id,kind,active,minute,sequence);"
].join('\n');

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const whole=value=>value!=null&&String(value).trim()!==''&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
const pair=(game,name)=>{const home=whole(game[name+'Team1']),away=whole(game[name+'Team2']);
 return home===null||away===null?null:{home,away};};
const clockOf=game=>{
 const m=String(game.MatchTimeExtended??'').match(/^(\d{1,3}):([0-5]\d)$/);
 if(m)return Number(m[1])+Number(m[2])/60;
 const n=Number(game.MatchTime);
 return game.MatchTime!=null&&Number.isFinite(n)&&n>=0&&n<=130?n:null;
};
export function projectZizobetHistory(matchId,data,row={}){
 const id=Number(matchId),game=data?.Match;
 if(!Number.isSafeInteger(id)||id<1||!game||typeof game!=='object')return null;
 const frame=normalizeLiveFrame(data);
 const score=String(game.Score??'').match(/^(\d+):(\d+)$/);
 const rawPeriods=game.SetScores;
 let periods=null;
 try{
  const values=typeof rawPeriods==='string'?JSON.parse(rawPeriods):rawPeriods;
  if(Array.isArray(values)){
   const parsed=values.map(value=>{
    const m=String(value).match(/^(\d+):(\d+)$/);
    if(m)return {home:Number(m[1]),away:Number(m[2])};
    const home=whole(value?.t1),away=whole(value?.t2);
    return home===null||away===null?null:{home,away};
   });
   if(parsed.length&&parsed.every(Boolean))periods=parsed.slice(0,4);
  }
 }catch{}
 const finished=Number(game.EventStatus??game.MatchStatusID)===40;
 const cornerHT=providerResultPair(game,'RESULT_CORNERHT');
 const cornerFT=providerResultPair(game,'RESULT_CORNERFT');
 const liveCorners=pair(game,'Corners');
 const finalCorners=finished?(cornerFT??liveCorners):liveCorners;
 const cornerPeriods=cornerHT&&cornerFT&&
  cornerFT.home>=cornerHT.home&&cornerFT.away>=cornerHT.away
  ?{firstHalf:cornerHT,secondHalf:{home:cornerFT.home-cornerHT.home,
     away:cornerFT.away-cornerHT.away},fullTime:cornerFT}:null;
 const details={
  provider:'zizobet', matchId:id, home:row.home??null, away:row.away??null,
  kickoffAt:row.start_at??null,
  phase:game.EventStatus??game.MatchStatusID??null,
  clockMinute:clockOf(game),periodScores:periods,
  goals:score?{home:Number(score[1]),away:Number(score[2])}:null,
  corners:finalCorners,cornerPeriods,
  yellowCards:pair(game,'YellowCards'),redCards:pair(game,'RedCards'),
  fouls:pair(game,'Fouls'),shots:pair(game,'Shots')
 };
 // A missing field is unknown, never a fabricated zero or stale overwrite.
 const clean=Object.fromEntries(Object.entries(details).filter(([,v])=>v!==null));
 const events=frame.eventListAvailable?frame.events.filter(e=>
  ['goal','corner','card','foul'].includes(e.type)&&['home','away'].includes(e.team)&&
  Number.isInteger(e.minute)&&e.minute>=0&&e.minute<=130&&e.id!=null&&String(e.id)
 ).map(e=>({
  id:String(e.id),kind:e.type,team:e.team,minute:e.minute,sequence:e.sequence??null,
  minuteLabel:e.minuteLabel??null,seconds:e.seconds??null,phase:e.phase??null,
  playerName:e.player??null,playerId:e.playerId??null,
  cardColor:e.cardColor??null,ownGoal:e.ownGoal??null
 })):[];
 const verifiedKinds=frame.eventListAvailable&&!frame.rawTimelineTruncated?
  ['goal','corner','card','foul'].filter(k=>frame.coverage?.[k+'Through']!=null):[];
 const fingerprint=frame.eventListAvailable?hash([events,verifiedKinds]):null;
 return {id,details:clean,events,verifiedKinds,
  timelineAvailable:frame.eventListAvailable, timelineSignature:fingerprint,
  summarySignature:hash(clean)};
}

/** One latest match row plus independently keyed events, not a frame per second. */
export function createZizobetHistoryArchive({database=pool,now=()=>new Date()}={}){
 const seen=new Map();
 return async function archive(matchId,data,row={},{observedAt=null}={}){
  const state=projectZizobetHistory(matchId,data,row);
  if(!state)return {stored:false,reason:'INVALID_MATCH'};
  const {id,details,events,verifiedKinds,timelineAvailable,timelineSignature,summarySignature}=state;
  const prior=seen.get(id);
  const unchanged=prior?.summary===summarySignature&&
    (!timelineAvailable||prior.timeline===timelineSignature);
  // Even a byte-for-byte unchanged final frame needs a SECOND observation
  // at a later time before its facts are eligible for financial settlement.
  // Archive rows can be deduplicated; evidence confirmation cannot.
  if(unchanged&&!verifiedKinds.length)return {stored:false,reason:'UNCHANGED'};
  const observed=new Date(observedAt??now());
  if(!Number.isFinite(observed.getTime()))throw Error('Invalid Zizobet observation time');
  const client=await database.connect();
  try{
   await client.query('begin');
   if(!unchanged)await client.query(
    "insert into app_zizobet_match_history(match_id,details,timeline_signature,observed_at) "+
    "values($1,$2::jsonb,$3,$4::timestamptz) on conflict(match_id) do update set "+
    "details=app_zizobet_match_history.details || excluded.details, "+
    "timeline_signature=coalesce(excluded.timeline_signature,app_zizobet_match_history.timeline_signature), "+
    "observed_at=excluded.observed_at",
    [id,JSON.stringify(details),timelineSignature,observed]);
   if(timelineAvailable&&prior?.timeline!==timelineSignature){
    if(events.length){
     await client.query(
      "insert into app_zizobet_match_incident(match_id,kind,provider_event_id,team,minute,sequence,detail,active,observed_at) "+
      "select $1,e.kind,e.id,e.team,e.minute,e.sequence,e.detail,true,$3::timestamptz "+
      "from jsonb_to_recordset($2::jsonb) as e(kind text,id text,team text,minute integer,sequence integer,detail jsonb) "+
      "on conflict(match_id,kind,provider_event_id) do update set "+
      "team=excluded.team,minute=excluded.minute,sequence=excluded.sequence, "+
      "detail=case when app_zizobet_match_incident.team=excluded.team and "+
      "app_zizobet_match_incident.minute=excluded.minute then "+
      "app_zizobet_match_incident.detail || excluded.detail else excluded.detail end, "+
      "active=true,observed_at=excluded.observed_at",
      [id,JSON.stringify(events.map(e=>({kind:e.kind,id:e.id,team:e.team,minute:e.minute,sequence:e.sequence,
       detail:Object.fromEntries(Object.entries(e).filter(([,v])=>v!==null))}))),observed]);
    }
    // Only reconciled full timelines can retire corrected/deleted provider events.
    for(const kind of verifiedKinds){
     const ids=events.filter(e=>e.kind===kind).map(e=>e.id);
     await client.query(
      "update app_zizobet_match_incident set active=false,observed_at=$3::timestamptz "+
      "where match_id=$1 and kind=$2 and active and not(provider_event_id=any($4::text[]))",
      [id,kind,observed,ids]);
    }
   }
   // The verified fact store is the SINGLE canonical source for grading
   // goal/corner/card/foul contracts. The compact history above is a raw
   // forensic archive, not an alternative financial event ledger.
   let confirmedKinds=[];
   const frame=normalizeLiveFrame(data);
   await invalidateContradictedEventCoverage(id,frame,client.query.bind(client),observed);
   if(verifiedKinds.length){
    await persistVerifiedEventFacts(id,frame,client.query.bind(client),observed);
    const {rows}=await client.query(
     "select kind,confirmed_at from app_match_event_coverage "+
     "where match_id=$1 and provider='zizobet' and observed_at=$2::timestamptz "+
     "and kind=any($3::text[])",[id,observed,verifiedKinds]);
    if(rows.length){
     await client.query(
      "update app_zizobet_match_history set evidence_observed_at=$2::timestamptz "+
      "where match_id=$1",[id,observed]);
     confirmedKinds=rows.filter(row=>row.confirmed_at!=null).map(row=>row.kind);
    }
   }
   await client.query('commit');
   seen.set(id,{summary:summarySignature,timeline:timelineSignature??prior?.timeline??null});
   if(seen.size>10000)seen.delete(seen.keys().next().value);
   return {stored:!unchanged,eventCount:events.length,verifiedKinds,confirmedKinds,
    ...(unchanged?{reason:'EVIDENCE_REOBSERVED'}:{})};
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}
  finally{client.release();}
 };
}
export const archiveZizobetMatchHistory=createZizobetHistoryArchive();

const dashboardPairs=match=>{
 const score=String(match?.Score??'').match(/^(\d+):(\d+)$/);
 const goals=score?{home:Number(score[1]),away:Number(score[2])}:null;
 const corners=providerResultPair(match,'Corners')??pair(match,'Corners');
 return {
  'goal:home':goals?.home??null,'goal:away':goals?.away??null,
  'corner:home':corners?.home??whole(match?.CornersTeam1),
  'corner:away':corners?.away??whole(match?.CornersTeam2),
  'yellow:home':whole(match?.YellowCardsTeam1),'yellow:away':whole(match?.YellowCardsTeam2),
  'red:home':whole(match?.RedCardsTeam1),'red:away':whole(match?.RedCardsTeam2)
 };
};
const dashboardMinute=match=>{
 const extended=String(match?.MatchTimeExtended??'').trim();
 const fallback=extended.match(/^(\d{1,3}):([0-5]\d)$/)?.[1]??null;
 const raw=match?.MatchTime??fallback;
 if(raw==null)return null;
 const parsed=zizobetEventTime(raw,extended,0);
 return Number.isSafeInteger(parsed.minute)&&parsed.minute>=0&&parsed.minute<=130?parsed:null;
};
const dashboardCounterSpecs=Object.keys({
 'goal:home':1,'goal:away':1,'corner:home':1,'corner:away':1,
 'yellow:home':1,'yellow:away':1,'red:home':1,'red:away':1
}).map(key=>{
 const [type,team]=key.split(':');
 return {key,type:type==='yellow'||type==='red'?'card':type,team,color:type==='yellow'?'yellow':type==='red'?'red':null};
});
const dashboardEventText=(kind,color)=>kind==='goal'?'Goal':kind==='corner'?'Corner':
 color==='yellow'?'Yellow card':color==='red'?'Red card':'Card';

/**
 * Persist fast Match/Header counter deltas for every live fixture, regardless
 * of viewers or pending tickets. These events carry the minute observed by
 * the dashboard, not a claimed exact incident timestamp. TimeLines can enrich
 * them later when its event list reconciles with the same counters.
 */
export function createZizobetDashboardIncidentArchive({database=pool,now=()=>new Date()}={}){
 return async function archiveDashboard(matchId,match,{observedAt=null}={}){
  const id=Number(matchId);
  if(!Number.isSafeInteger(id)||id<1||!match||typeof match!=='object')
   return {stored:false,reason:'INVALID_MATCH',events:[]};
  const incoming=dashboardPairs(match),clock=dashboardMinute(match);
  const observed=new Date(observedAt??now());
  if(!Number.isFinite(observed.getTime()))throw Error('Invalid Zizobet dashboard observation time');
  const client=await database.connect();
  try{
   await client.query('begin');
   const seeded=await client.query(
    "insert into app_zizobet_dashboard_counter_state(match_id,counters,observed_at) values($1,$2::jsonb,$3::timestamptz) on conflict(match_id) do nothing returning match_id",
    [id,JSON.stringify(incoming),observed]
   );
   const locked=await client.query(
    "select counters,observed_at from app_zizobet_dashboard_counter_state where match_id=$1 for update",[id]
   );
   const previous=locked.rows[0]?.counters??{};
   const previousAt=new Date(locked.rows[0]?.observed_at??observed);
   let next={...previous};
   let created=0;
   const isSeeded=seeded.rowCount>0;
   if(!isSeeded&&observed.getTime()>=previousAt.getTime()){
    for(const spec of dashboardCounterSpecs){
     const before=whole(previous[spec.key]),after=whole(incoming[spec.key]);
     if(after===null)continue;
     if(before===null){
      next[spec.key]=after;
      continue;
     }
     if(after<before){
      await client.query(
       "update app_zizobet_dashboard_incident set active=false,observed_at=$4::timestamptz,detail=detail || '{\"counterCorrected\":true}'::jsonb where match_id=$1 and counter_key=$2 and team=$3 and counter_ordinal>$5 and active",
       [id,spec.key,spec.team,observed,after]
      );
     }else if(after>before){
      if(!clock){
       // Do not consume the counter delta until a usable dashboard clock arrives.
       next[spec.key]=before;
       continue;
      }
      for(let ordinal=before+1;ordinal<=after;ordinal++){
       const eventKey=id+':'+spec.key+':'+ordinal;
       const detail={
        source:'zizobet-dashboard',provisional:true,counterKey:spec.key,
        counterOrdinal:ordinal,minuteLabel:clock.label,addedMinute:clock.added,
        timestampQuality:'dashboard-observation',orderingUnverified:true,
        observedAt:observed.toISOString(),...(spec.color?{cardColor:spec.color}:{})
       };
       await client.query(
        "insert into app_zizobet_dashboard_incident(event_key,match_id,kind,counter_key,team,counter_ordinal,minute,added_minute,minute_label,sequence,detail,active,first_observed_at,observed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,null,$10::jsonb,true,$11::timestamptz,$11::timestamptz) on conflict(event_key) do update set minute=excluded.minute,added_minute=excluded.added_minute,minute_label=excluded.minute_label,detail=app_zizobet_dashboard_incident.detail || excluded.detail,active=true,observed_at=excluded.observed_at",
        [eventKey,id,spec.type,spec.key,spec.team,ordinal,clock.minute,clock.added,clock.label,
         JSON.stringify(detail),observed]
       );
       created++;
      }
     }
     next[spec.key]=after;
    }
    for(const key of Object.keys(incoming)){
     if(incoming[key]!==null&&next[key]===undefined)next[key]=incoming[key];
    }
    await client.query(
     "update app_zizobet_dashboard_counter_state set counters=$2::jsonb,observed_at=$3::timestamptz where match_id=$1",
     [id,JSON.stringify(next),observed]
    );
   }
   const {rows}=await client.query(
    "select event_key,kind,counter_key,team,counter_ordinal,minute,added_minute,minute_label,sequence,provider_event_id,provisional,detail from app_zizobet_dashboard_incident where match_id=$1 and active=true order by minute,added_minute,first_observed_at,counter_key,counter_ordinal",
    [id]
   );
   await client.query('commit');
   const events=rows.map(row=>{
    const color=row.detail?.cardColor??null;
    const type=row.kind==='card'?(color==='yellow'?'yellow_card':color==='red'?'red_card':'card'):row.kind;
    const added=Number(row.added_minute)||0;
    const base=Number(row.minute)-added;
    return {
     id:row.event_key,matchId:String(id),type,minute:base,addedMinute:added,
     minuteLabel:row.minute_label,team:row.team,text:dashboardEventText(row.kind,color),
     sequence:row.sequence??null,counterOrdinal:Number(row.counter_ordinal),
     source:'dashboard',provisional:!!row.provisional,
     timestampQuality:row.detail?.timestampQuality??'provider-timeline',
     ...(row.provider_event_id?{providerEventId:row.provider_event_id}:{}),
     ...(typeof row.detail?.playerName==='string'&&row.detail.playerName?{player:row.detail.playerName}:{})
    };
   });
   return {stored:created>0||isSeeded,baseline:isSeeded,created,events};
  }catch(error){await client.query('rollback').catch(()=>{});throw error;}
  finally{client.release();}
 };
}
export const archiveZizobetDashboardIncidents=createZizobetDashboardIncidentArchive();

