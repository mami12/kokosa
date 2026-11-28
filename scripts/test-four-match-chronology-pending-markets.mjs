import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {recoverLegacyZizobetEventContract} from '../server/ledger/legacy-zizobet-corner-contract.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {gradeHeldNativeCombo} from '../server/ledger/settler.mjs';

const db=new PGlite();
const run=(sql,params=[])=>db.query(sql,params);
const observed=new Date('2026-11-28T20:00:00.000Z');
const makeQuote=(matchId,marketId,nativeMarketName,nativeParameters,line,outcome,hold)=>{
 const marketKey='zz'+marketId+'@'+Buffer.from(JSON.stringify(nativeParameters)).toString('base64url');
 return {
  id:'00000000-0000-4000-8000-'+String(marketId).padStart(12,'0'),
  match_id:matchId,market_key:marketKey,market_name:'Legacy translated display title',
  outcome_key:outcome,outcome_name:outcome,line,period:0,
  home_team:'Home',away_team:'Away',
  accepted_contract:{
   sourceProviderId:'ZIZOBET',providerMarketKey:marketKey,
   providerMarketName:'Original Zizobet display title',
   providerOutcomeKey:outcome,providerOutcomeName:outcome,
   nativeMarketId:marketId,nativeOutcomeId:outcome,
   nativeMarketName,nativeOutcomeName:outcome,nativeParameters,
   providerPeriod:0,line,homeTeamName:'Home',awayTeamName:'Away',
   settlementHold:hold
  }
 };
};
const addMatch=async(matchId,{goals=[],corners=[],cards=[],score=[0,0],cornerTotal=[0,0],cardTotal=[0,0]})=>{
 await run(`insert into app_match_result(match_id,home_team,away_team,home_score,away_score,
   corners_home,corners_away,cards_home,cards_away,source,finished_at)
   values($1,'Home','Away',$2,$3,$4,$5,$6,$7,'ZIZOBET',$8)`,
  [matchId,score[0],score[1],cornerTotal[0],cornerTotal[1],cardTotal[0],cardTotal[1],observed]);
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[matchId,observed]);
 for(const [kind,events,counts,colorVerified] of [
  ['goal',goals,score,false],['corner',corners,cornerTotal,false],['card',cards,cardTotal,true]
 ]){
  if(!events.length&&counts[0]+counts[1]!==0)continue;
  for(const e of events)await run(`insert into app_match_event_fact
    (match_id,provider,provider_event_id,kind,team,minute,seconds,sequence,
     card_color,phase,active)
    values($1,'zizobet',$2,$3,$4,$5,$6,$7,$8,$9,true)`,
   [matchId,e.id,kind,e.team,e.minute,e.minute*60+(e.second??10),e.sequence??null,
    e.color??null,e.phase??null]);
  await run(`insert into app_match_event_coverage
    (match_id,provider,kind,through_minute,count_home,count_away,complete,
     observed_at,confirmed_at,card_colors_verified)
    values($1,'zizobet',$2,90,$3,$4,true,$5,$5,$6)`,
   [matchId,kind,counts[0],counts[1],observed,colorVerified]);
 }
};
const grade=async(line,result)=>{
 const recovered=recoverLegacyZizobetEventContract(line);
 assert.ok(recovered,'Legacy accepted Zizobet quote must recover: '+line.accepted_contract.nativeMarketName);
 const settlementLine={...line,live_contract:recovered,
  accepted_contract:{...line.accepted_contract,settlementHold:null}};
 return {contract:recovered,status:await gradeStoredEventContract(settlementLine,result,{execute:run})};
};
try{
 await db.exec(LEDGER_SQL);

 // MATCH 1: the dynamic one-minute market the feed exposes as
 // "1 minute - Total from {from} to {to} (0.5)".
 const goalMatch=990101;
 await addMatch(goalMatch,{
  score:[1,1],goals:[
   {id:'g16',team:'home',minute:16,second:12},
   {id:'g55',team:'away',minute:55,second:9}
  ]
 });
 const oneMinute=makeQuote(goalMatch,9250,
  '1 minute - total from {from} to {to} (0.5)',{p1:16,p2:16,h:0.5},
  '0.5','Over','NATIVE_PERIOD_GOAL_UNMAPPED');
 const goalResult={home_score:1,away_score:1,source:'ZIZOBET'};
 const goal=await grade(oneMinute,goalResult);
 assert.deepEqual(
  {kind:goal.contract.kind,event:goal.contract.event,from:goal.contract.from,to:goal.contract.to},
  {kind:'window-total',event:'goal',from:16,to:16}
 );
 assert.equal(goal.status,'WON','One confirmed Zizobet goal in minute 16 settles Over 0.5 immediately');

 // MATCH 2: numbered corner, race-to-X and last-corner offers all use
 // the same complete event order, not just the final 2-2 aggregate.
 const cornerMatch=990102;
 await addMatch(cornerMatch,{
  score:[0,0],cornerTotal:[2,2],
  corners:[
   {id:'c1',team:'home',minute:2,second:10,sequence:1},
   {id:'c2',team:'away',minute:5,second:11,sequence:2},
   {id:'c3',team:'home',minute:9,second:12,sequence:3},
   {id:'c4',team:'away',minute:77,second:13,sequence:4}
  ]
 });
 const cornerResult={home_score:0,away_score:0,corners_home:2,corners_away:2,source:'ZIZOBET'};
 const nthCorner=makeQuote(cornerMatch,9025,'Who takes the [corner!] corner',
  {p3:3},'','1','NATIVE_PARAMETERS_UNMAPPED');
 const nth=await grade(nthCorner,cornerResult);
 assert.deepEqual({kind:nth.contract.kind,event:nth.contract.event,target:nth.contract.target,side:nth.contract.side},
  {kind:'sequence',event:'corner',target:3,side:'home'});
 assert.equal(nth.status,'WON','The third corner is Home');

 const race=makeQuote(cornerMatch,9002,'Which team wins race to X corners?',
  {},'2','1','NATIVE_PARAMETERS_UNMAPPED');
 const raced=await grade(race,cornerResult);
 assert.deepEqual({kind:raced.contract.kind,event:raced.contract.event,target:raced.contract.target},
  {kind:'race',event:'corner',target:2});
 assert.equal(raced.status,'WON','Home reaches two corners before Away');

 const last=makeQuote(cornerMatch,9030,'Last corner',{},'','2','NATIVE_FINAL_RULE_UNMAPPED');
 const lastCorner=await grade(last,cornerResult);
 assert.deepEqual({kind:lastCorner.contract.kind,event:lastCorner.contract.event,side:lastCorner.contract.side},
  {kind:'last-event',event:'corner',side:'away'});
 assert.equal(lastCorner.status,'WON','The final corner belongs to Away');

 // MATCH 3: fixed 10-minute interval corner total. Only incidents 21-30
 // count; earlier/later corners in the same match must not leak into it.
 const intervalMatch=990103;
 await addMatch(intervalMatch,{
  score:[0,0],cornerTotal:[2,1],
  corners:[
   {id:'c10',team:'home',minute:10,second:10,sequence:1},
   {id:'c22',team:'away',minute:22,second:12,sequence:2},
   {id:'c60',team:'home',minute:60,second:13,sequence:3}
  ]
 });
 const intervalQuote=makeQuote(intervalMatch,9015,
  '10 minutes - Total corners from first value - second value:00 min',
  {p1:21,p2:30,h:0.5},'0.5','Over','NATIVE_INTERVAL_BASELINE_UNVERIFIED');
 const interval=await grade(intervalQuote,{home_score:0,away_score:0,corners_home:2,corners_away:1,source:'ZIZOBET'});
 assert.deepEqual({kind:interval.contract.kind,event:interval.contract.event,
  from:interval.contract.from,to:interval.contract.to},
  {kind:'window-total',event:'corner',from:21,to:30});
 assert.equal(interval.status,'WON','The Away corner at 22 settles this interval Over');

 // MATCH 4: card interval plus separate color totals. Yellow/red are not
 // combined when the original Zizobet quote names a specific card color.
 const cardMatch=990104;
 await addMatch(cardMatch,{
  score:[0,0],cardTotal:[1,2],
  cards:[
   {id:'y24',team:'home',minute:24,second:10,color:'yellow'},
   {id:'y25',team:'away',minute:25,second:11,color:'yellow'},
   {id:'r77',team:'away',minute:77,second:12,color:'red'}
  ]
 });
 const cardResult={home_score:0,away_score:0,cards_home:1,cards_away:2,source:'ZIZOBET'};
 const cardIntervalQuote=makeQuote(cardMatch,9020,
  'Total 0.5 bookings in 10 minutes interval 21-30',{},'0.5','Over',
  'NATIVE_STATISTIC_UNMAPPED');
 const cardInterval=await grade(cardIntervalQuote,cardResult);
 assert.deepEqual({kind:cardInterval.contract.kind,event:cardInterval.contract.event,
  from:cardInterval.contract.from,to:cardInterval.contract.to},
  {kind:'window-total',event:'card',from:21,to:30});
 assert.equal(cardInterval.status,'WON','Yellow cards at 24 and 25 settle the card interval');

 const redTotal=makeQuote(cardMatch,9040,'Total Red Cards',{},'0.5','Over',
  'NATIVE_STATISTIC_UNMAPPED');
 const red=await grade(redTotal,cardResult);
 assert.deepEqual({kind:red.contract.kind,event:red.contract.event,
  cardColor:red.contract.cardColor,threshold:red.contract.threshold},
  {kind:'over',event:'card',cardColor:'red',threshold:0.5});
 assert.equal(red.status,'WON','The confirmed red card is counted separately from yellow cards');

 const yellowTotal=makeQuote(cardMatch,9041,'Total Yellow Cards',{},'1.5','Over',
  'NATIVE_STATISTIC_UNMAPPED');
 const yellow=await grade(yellowTotal,cardResult);
 assert.deepEqual({kind:yellow.contract.kind,event:yellow.contract.event,
  cardColor:yellow.contract.cardColor,threshold:yellow.contract.threshold},
  {kind:'over',event:'card',cardColor:'yellow',threshold:1.5});
 assert.equal(yellow.status,'WON','Both yellow cards are counted independently');

 // NOTTINGHAM FOREST - CHELSEA: 3-2 FT. The Under 1.5 leg is
 // mathematically lost even if the half-time result is not yet available.
 const frozenCombo=(marketId,marketName,selection,line,hold='NATIVE_HTFT_UNMAPPED')=>{
  const marketKey='zz'+marketId+'@e30';
  return {
   id:'00000000-0000-4000-8000-'+String(marketId).padStart(12,'0'),
   match_id:990105,market_key:marketKey,market_name:marketName,
   outcome_key:selection,outcome_name:selection,line,period:0,
   accepted_contract:{
    sourceProviderId:'ZIZOBET',providerMarketKey:marketKey,
    providerMarketName:marketName,providerOutcomeKey:selection,
    providerOutcomeName:selection,nativeMarketId:marketId,
    nativeMarketName:marketName,nativeOutcomeName:selection,
    nativeParameters:{},providerPeriod:0,line,settlementHold:hold
   }
  };
 };
 const nottingham={home_score:3,away_score:2,half_home_score:null,half_away_score:null};
 const nottUnder=frozenCombo(91001,'Halftime/fulltime & total goals (1.5)','1/1 and Under','1.5');
 assert.equal(gradeHeldNativeCombo(nottUnder,nottingham),'LOST',
  '3-2 FT makes the quoted Under 1.5 leg impossible without reconstructing HT');
 const nottOver=frozenCombo(91002,'Halftime/fulltime & total goals (1.5)','1/1 and Over','1.5');
 assert.equal(gradeHeldNativeCombo(nottOver,nottingham),null,
  'A possible HT/FT winner waits for the Zizobet halftime score');
 assert.equal(gradeHeldNativeCombo(nottOver,{...nottingham,half_home_score:1,half_away_score:0}),'WON',
  'Zizobet HT 1-0 plus FT 3-2 verifies 1/1 and Over 1.5');
 assert.equal(gradeHeldNativeCombo(frozenCombo(91003,
  'Halftime/fulltime correct score','1/1 3:2',''),{...nottingham,half_home_score:1,half_away_score:0}),'WON',
  'A correct-score HT/FT ticket checks both archived scorelines');
 assert.equal(gradeHeldNativeCombo(frozenCombo(91004,
  'Halftime/fulltime & exact goals (5)','1/1 and 5',''),{...nottingham,half_home_score:1,half_away_score:0}),'WON',
  'HT/FT exact-goal combo uses the actual full-time total');

 // BREST - PARIS: 1-0 FT. Under 1.5 is a possible winning total leg,
 // but only Zizobet's archived 1-0 halftime score proves the 1/1 part.
 const brest={home_score:1,away_score:0,half_home_score:1,half_away_score:0};
 assert.equal(gradeHeldNativeCombo(frozenCombo(91005,
  'Halftime/fulltime & total goals (1.5)','1/1 and Under','1.5'),brest),'WON');
 assert.equal(gradeHeldNativeCombo(frozenCombo(91006,
  'Halftime/fulltime & total goals (2.5)','1/1 and Over','2.5'),brest),'LOST',
  '1-0 FT makes Over 2.5 impossible even before checking HT/FT');
 assert.equal(gradeHeldNativeCombo(frozenCombo(91007,
  'Halftime/fulltime & total goals (2.5)','1/1 and Under','2.5'),brest),'WON');
 assert.equal(gradeHeldNativeCombo(frozenCombo(91008,
  'Halftime/fulltime & total goals (1.5)','X/1 and Under','1.5'),brest),'LOST',
  'The confirmed 1-0 HT result disproves X/1');

 console.log('PASS four-match legacy pending markets: goal interval, Nth corner, race to X, last corner, corner interval and separate yellow/red cards');
}finally{
 await db.close();
}
