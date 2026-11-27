import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {validateHistoricalTimedEvents,persistHistoricalTimedEvents} from '../server/ledger/historical-timed-events.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {fotMobTimedIncidents,apiFootballTimedIncidents} from '../server/stats-providers/historical-incidents.mjs';

const history={source:'fotmob',kind:'corner',final:true,complete:true,
 timelineAvailable:true,homeCount:2,awayCount:1,events:[
  {id:'c1',type:'corner',team:'home',minute:10,playerId:'42',playerName:'Corner Taker'},
  {id:'c2',type:'corner',team:'away',minute:15},
  {id:'c3',type:'corner',team:'home',minute:23}
 ]};
assert.ok(validateHistoricalTimedEvents(history));
assert.equal(validateHistoricalTimedEvents({...history,events:[
 {...history.events[0],phase:'Second Half'},...history.events.slice(1)]}),null,
 'A second-half incident reported as minute ten is not a verified absolute minute');
assert.equal(validateHistoricalTimedEvents({...history,events:history.events.slice(1)}),null,
 'Partial timeline must not authorize a negative/positive corner settlement');
assert.equal(validateHistoricalTimedEvents({...history,events:[
  history.events[0],history.events[0],history.events[2]]}),null,
 'Duplicated incident IDs must leave races pending');
assert.equal(validateHistoricalTimedEvents({...history,events:[
  {...history.events[0],injury:2},history.events[1],history.events[2]]}),null,
 'Unknown stoppage semantics are not settled as normal minutes');

const stoppage=validateHistoricalTimedEvents({...history,events:[
 {...history.events[0],minute:45,injury:3,phase:null},
 {...history.events[1],minute:90,injury:2,phase:null},
 history.events[2]
]});
assert.ok(stoppage,'45+3 and 90+2 with explicit football-clock notation are verifiable');
assert.deepEqual(stoppage.facts.slice(0,2).map(f=>f.phase),['H1','H2'],
 '45+3 belongs to the first half, 90+2 to the second');
assert.equal(validateHistoricalTimedEvents({...history,events:[
 {...history.events[0],minute:45,injury:3,phase:'H2'},
 ...history.events.slice(1)
]}),null,'A contradictory provider phase must never pass');
assert.equal(validateHistoricalTimedEvents({...history,events:[
 {...history.events[0],minute:40,injury:3},...history.events.slice(1)
]}),null,'Added time at an arbitrary minute is not verified football clock syntax');

const fm=fotMobTimedIncidents([
 {type:'Corner',eventId:17,isHome:true,time:'10'},
 {type:'Card',eventId:18,isHome:false,time:'20',card:'Yellow',player:{id:99,name:'Card Recipient'}}
]);
assert.deepEqual([fm.cornerEvents.length,fm.cardEvents.length],[1,1]);
assert.equal(fm.cardEvents[0].cardColor,'yellow');
assert.equal(fm.cardEvents[0].playerName,'Card Recipient');
assert.equal(fm.cardEvents[0].playerId,'99');
const injuryEvents=fotMobTimedIncidents([
 {type:'Corner',isHome:true,time:'45+2',player:{id:7,name:'Player One'}},
 {type:'Corner',isHome:true,time:'45+4',player:{id:7,name:'Player One'}}
]);
assert.deepEqual(injuryEvents.cornerEvents.map(f=>[f.minute,f.injury]),[[45,2],[45,4]]);
assert.notEqual(injuryEvents.cornerEvents[0].id,injuryEvents.cornerEvents[1].id,
 'Two distinct added-time corners by the same player are not collapsed');

// FotMob returns a complete event array even when a kind has zero incidents.
// That is the evidence needed to settle an explicitly recorded 0-0 final total.
const emptyFotMob=fotMobTimedIncidents([]);
assert.equal(emptyFotMob.cornerTimelineAvailable,true);
assert.equal(emptyFotMob.cardTimelineAvailable,true);
assert.ok(validateHistoricalTimedEvents({
 source:'fotmob',kind:'corner',final:true,complete:true,timelineAvailable:true,
 homeCount:0,awayCount:0,events:[]}));
assert.ok(validateHistoricalTimedEvents({
 source:'fotmob',kind:'card',final:true,complete:true,timelineAvailable:true,
 homeCount:0,awayCount:0,events:[]}));
const fotmobNinetyPlus=fotMobTimedIncidents([
 {type:'Corner',eventId:'fotmob-90-plus-4',isHome:true,time:'90+4'},
 {type:'Card',eventId:'fotmob-card-90-plus-2',isHome:false,time:'90+2',card:'Yellow'}
]);
assert.deepEqual(fotmobNinetyPlus.cornerEvents.map(e=>[e.minute,e.injury]),[[90,4]]);
assert.deepEqual(fotmobNinetyPlus.cardEvents.map(e=>[e.minute,e.injury,e.cardColor]),[[90,2,'yellow']]);
assert.ok(validateHistoricalTimedEvents({
 source:'fotmob',kind:'corner',final:true,complete:true,timelineAvailable:true,
 homeCount:1,awayCount:0,events:fotmobNinetyPlus.cornerEvents
}),'A 90+4 FotMob corner is eligible when its final team counters reconcile');
assert.ok(validateHistoricalTimedEvents({
 source:'fotmob',kind:'card',final:true,complete:true,timelineAvailable:true,
 homeCount:0,awayCount:1,events:fotmobNinetyPlus.cardEvents
}),'A 90+2 FotMob card retains its side and color');

// Exhaustive 45+1..45+15 and 90+1..90+15 coverage for BOTH supported
// historical timed incident families. Absolute minutes preserve ordering.
const stoppagePayloads={};
for(const kind of ['corner','card']){
 const events=[];
 for(const base of [45,90])for(let added=1;added<=15;added++){
  events.push({id:`${kind}-${base}-plus-${added}`,type:kind,team:'home',
   minute:base,injury:added,...(kind==='card'?{cardColor:'yellow'}:{})});
 }
 const payload={source:'fotmob',kind,final:true,complete:true,timelineAvailable:true,
  homeCount:30,awayCount:0,events};
 const verified=validateHistoricalTimedEvents(payload);
 assert.ok(verified,`${kind}: all first- and second-half stoppage minutes validate`);
 assert.deepEqual(verified.facts.map(event=>event.minute),[
  ...Array.from({length:15},(_,i)=>46+i),
  ...Array.from({length:15},(_,i)=>91+i)
 ],`${kind}: absolute stoppage minutes preserve chronology`);
 assert.deepEqual(verified.facts.slice(0,15).map(event=>event.phase),Array(15).fill('H1'));
 assert.deepEqual(verified.facts.slice(15).map(event=>event.phase),Array(15).fill('H2'));
 stoppagePayloads[kind]=payload;
}

const ap=apiFootballTimedIncidents([
 {type:'Card',detail:'Red Card',team:{id:12},time:{elapsed:42},player:{id:73,name:'Sent Off Player'}}
],{teams:{home:{id:11},away:{id:12}}});
assert.equal(ap.cardEvents[0].team,'away');
assert.equal(ap.cardEvents[0].cardColor,'red');
assert.equal(ap.cardEvents[0].playerName,'Sent Off Player');

const db=new PGlite();
const run=(sql,params=[])=>db.query(sql,params);
const database={connect:async()=>({query:run,release(){}})};
try{
 await db.exec(LEDGER_SQL);
 const id=92820211;
 await run(`insert into app_match_result(match_id,home_team,away_team,
   home_score,away_score,corners_home,corners_away,cards_home,cards_away,source)
   values($1,'Home','Away',0,0,2,1,1,1,'RECOVERY')`,[id]);
 const saved=await persistHistoricalTimedEvents(id,history,{database});
 assert.equal(saved.stored,true);
 assert.deepEqual((await run("select player_id,player_name from app_match_event_fact where match_id=$1 and provider='fotmob' and provider_event_id='c1'",[id])).rows[0],
   {player_id:'42',player_name:'Corner Taker'},'Backup corner actor is durable in PostgreSQL');
 assert.equal((await persistHistoricalTimedEvents(id,history,{database})).reason,'ALREADY_VERIFIED');
 assert.equal((await persistHistoricalTimedEvents(id,{
  ...history,events:[{...history.events[0],minute:11},...history.events.slice(1)]
 },{database})).reason,'TIMELINE_CHANGED');
 const card={source:'apifootball',kind:'card',final:true,complete:true,
  timelineAvailable:true,homeCount:1,awayCount:1,events:[
   {id:'y1',type:'card',team:'home',minute:20,cardColor:'yellow',playerId:'83',playerName:'Booked Player'},
   {id:'r1',type:'card',team:'away',minute:42,cardColor:'red'}
 ]};
 assert.equal((await persistHistoricalTimedEvents(id,card,{database})).stored,true);
 assert.equal((await run("select player_name from app_match_event_fact where match_id=$1 and provider='apifootball' and provider_event_id='y1'",[id])).rows[0].player_name,'Booked Player');
 const result={home_score:0,away_score:0,corners_home:2,corners_away:1,
  cards_home:1,cards_away:1};
 const bet=(event,kind,other)=>({id:'00000000-0000-4000-8000-000000000001',
  match_id:id,live_contract:{version:1,event,kind,...other}});
 const grade=(event,kind,other)=>gradeStoredEventContract(bet(event,kind,other),result,{execute:run});
 assert.equal(await grade('corner','sequence',{target:1,side:'home'}),'WON');
 assert.equal(await grade('corner','sequence',{target:2,side:'away'}),'WON');
 assert.equal(await grade('corner','race',{target:2,side:'home'}),'WON');
 assert.equal(await grade('corner','window',{from:10,to:20,choice:true}),'WON');
 assert.equal(await grade('corner','window',{from:30,to:40,choice:false}),'WON');
 assert.equal(await grade('card','window',{from:19,to:21,choice:true,cardColor:'yellow'}),'WON');
 assert.equal(await grade('card','window',{from:19,to:21,choice:true,cardColor:'red'}),'LOST');
 assert.equal(await grade('corner','window',{
  from:10.25,to:11.25,choice:true,startExclusive:true}),null,
 'Minute-only incidents cannot determine seconds in a rolling contract');
 const wrong={...history,homeCount:3};
 assert.equal((await persistHistoricalTimedEvents(id+1,wrong,{database})).stored,false);
 const conflicting={...result,corners_away:2};
 assert.equal(await gradeStoredEventContract(bet('corner','sequence',{target:1,side:'home'}),
  conflicting,{execute:run}),null,'Disagreement with final totals cannot change the wallet');

 // Persist and grade both historical stoppage timelines. 45+15 and 90+15
 // remain regular-time events and are ordered by their absolute minute.
 const stoppageId=id+50;
 await run(`insert into app_match_result(match_id,home_team,away_team,
  home_score,away_score,corners_home,corners_away,cards_home,cards_away,source)
  values($1,'Home','Away',0,0,30,0,30,0,'RECOVERY')`,[stoppageId]);
 assert.equal((await persistHistoricalTimedEvents(stoppageId,stoppagePayloads.corner,{database})).stored,true);
 assert.equal((await persistHistoricalTimedEvents(stoppageId,stoppagePayloads.card,{database})).stored,true);
 const stoppageBet=(event,kind,rest)=>({...bet(event,kind,rest),match_id:stoppageId});
 for(const kind of ['corner','card']){
  const stored=(await run(`select minute,phase from app_match_event_fact
   where match_id=$1 and provider='fotmob' and kind=$2 order by minute`,[stoppageId,kind])).rows;
  assert.deepEqual(stored.map(row=>row.minute),[
   ...Array.from({length:15},(_,i)=>46+i),
   ...Array.from({length:15},(_,i)=>91+i)
  ],`${kind} stores distinct 45+N / 90+N event minutes`);
  assert.ok(stored.slice(0,15).every(row=>row.phase==='H1'));
  assert.ok(stored.slice(15).every(row=>row.phase==='H2'));
  const final={home_score:0,away_score:0,corners_home:30,corners_away:0,cards_home:30,cards_away:0};
  assert.equal(await gradeStoredEventContract(stoppageBet(kind,'window',{
   from:31,to:45,choice:true,...(kind==='card'?{cardColor:'yellow'}:{})
  }),final,{execute:run}),'WON',`${kind}: 45+N belongs to the 31-45 interval`);
  assert.equal(await gradeStoredEventContract(stoppageBet(kind,'window',{
   from:76,to:90,choice:true,...(kind==='card'?{cardColor:'yellow'}:{})
  }),final,{execute:run}),'WON',`${kind}: 90+N belongs to the 76-90 interval`);
 }
 assert.equal(await gradeStoredEventContract(stoppageBet('corner','sequence',{target:30,side:'home'}),
  {home_score:0,away_score:0,corners_home:30,corners_away:0,cards_home:30,cards_away:0},
  {execute:run}),'WON','90+15 is the last ordered corner');

 // Missing Zizobet corner counters may be filled by one complete, independently
 // matched FT timeline. The alternate provider never changes the stored score.
 const missingTotalsId=id+1;
 await run(`insert into app_match_result(match_id,home_team,away_team,home_score,away_score,
   corners_home,corners_away,cards_home,cards_away,source)
   values($1,'Home','Away',0,0,null,null,null,null,'ZIZOBET')`,[missingTotalsId]);
 const missingTotalsSaved=await persistHistoricalTimedEvents(missingTotalsId,{
  ...history,homeScore:0,awayScore:0
 },{database});
 assert.equal(missingTotalsSaved.stored,true,
  'Complete alternate events fill missing Zizobet aggregate counters');
 const missingTotalsLine={...bet('corner','sequence',{target:1,side:'home'}),match_id:missingTotalsId};
 assert.equal(await gradeStoredEventContract(missingTotalsLine,{
  home_score:0,away_score:0,corners_home:null,corners_away:null,cards_home:null,cards_away:null
 },{execute:run}),'WON','A verified FotMob chronology settles a missing primary corner timeline');

 // Two complete fallback sources with different event order must not be
 // merged or used to guess the result of an ordinal selection.
 const disagreementId=id+2;
 await run(`insert into app_match_result(match_id,home_team,away_team,home_score,away_score,
   corners_home,corners_away,cards_home,cards_away,source)
   values($1,'Home','Away',0,0,null,null,null,null,'ZIZOBET')`,[disagreementId]);
 const reverseHistory={...history,source:'apifootball',homeScore:0,awayScore:0,
  events:[
   {...history.events[0],id:'a1',team:'away',minute:10},
   {...history.events[1],id:'a2',team:'home',minute:15},
   {...history.events[2],id:'a3',team:'home',minute:23}
  ]};
 assert.equal((await persistHistoricalTimedEvents(disagreementId,
  {...history,homeScore:0,awayScore:0},{database})).stored,true);
 assert.equal((await persistHistoricalTimedEvents(disagreementId,reverseHistory,{database})).stored,true);
 const disagreementLine={...bet('corner','sequence',{target:1,side:'home'}),match_id:disagreementId};
 assert.equal(await gradeStoredEventContract(disagreementLine,{
  home_score:0,away_score:0,corners_home:null,corners_away:null,cards_home:null,cards_away:null
 },{execute:run}),null,'Conflicting complete timelines leave the ordinal market pending');
 console.log('PASS historical corners/cards SQL: Next Corner, Race, windows, card colours, duplicates, conflicts, missing-primary fallback and rolling holds');
}finally{await db.close();}
