import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {parseFotMobPayload} from '../server/stats-providers/match-recovery.mjs';
import {persistHistoricalGoalFacts} from '../server/ledger/historical-event-facts.mjs';
import {persistHistoricalTimedEvents} from '../server/ledger/historical-timed-events.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {gradeStatisticLine} from '../server/ledger/statistic-markets.mjs';
import {gradeLine} from '../server/ledger/settler.mjs';

// FotMob is used for statistics plus corner/card event verification only.
// Legacy FotMob goal rows must never authorize goal-market payouts.
const matchId=92820261;
const summary={status:{scoreStr:'1 - 0',finished:true},home:{score:1},away:{score:0}};
const details={
 header:{status:{finished:true,reason:{short:'Full-time'},scoreStr:'1 - 0'}},
 content:{
  matchFacts:{events:{events:[
   {type:'Goal',eventId:'goal-1',isHome:true,time:'22',
    player:{id:100,name:'Home Scorer'},ownGoal:false},
   {type:'Corner',eventId:'corner-1',isHome:true,time:'10'},
   {type:'Corner',eventId:'corner-2',isHome:false,time:'45+3'},
   {type:'Corner',eventId:'corner-3',isHome:true,time:'90+4'},
   {type:'Card',eventId:'card-1',isHome:true,time:'20',card:'Yellow',
    player:{id:200,name:'Booked Home'}},
   {type:'Card',eventId:'card-2',isHome:false,time:'85',card:'Red',
    player:{id:201,name:'Sent Off Away'}}
  ]}},
  stats:{Periods:{All:{stats:[
   {title:'Corners',stats:['2','1']},
   {title:'Cards',stats:[
    {title:'Yellow Cards',stats:['1','0']},
    {title:'Red Cards',stats:['0','1']}
   ]},
   {title:'Shots',stats:[
    {title:'Total Shots',stats:['12','7']},
    {title:'Shots on Target',stats:['5','2']}
   ]},
   {title:'Fouls',stats:['9','13']},
   {title:'Possession',stats:['61%','39%']}
  ]}}}
 }
};
const parsed=parseFotMobPayload(summary,details);
assert.equal(parsed.finished,true);
assert.deepEqual([parsed.homeScore,parsed.awayScore],[1,0]);
assert.deepEqual([parsed.cornersHome,parsed.cornersAway],[2,1]);
assert.deepEqual([parsed.cardsHome,parsed.cardsAway],[1,1]);
assert.equal('goalEvents' in parsed,false,'FotMob does not expose goal chronology');
assert.equal(parsed.cornerTimelineAvailable,true);
assert.equal(parsed.cardTimelineAvailable,true);

const db=new PGlite();
const run=(sql,params=[])=>db.query(sql,params);
const database={connect:async()=>({query:run,release(){}})};
try{
 await db.exec(LEDGER_SQL);
 await run(`insert into app_match_result(match_id,home_team,away_team,home_score,away_score,
  corners_home,corners_away,cards_home,cards_away,source)
  values($1,'Home FC','Away FC',1,0,2,1,1,1,'ZIZOBET')`,[matchId]);

 const goalEvidence=await persistHistoricalGoalFacts(matchId,{
  source:'fotmob',final:true,complete:true,goalsAvailable:true,
  homeScore:parsed.homeScore,awayScore:parsed.awayScore,
  events:[{id:'not-eligible',type:'goal',team:'home',minute:22,own:false}]
 },{database});
 assert.equal(goalEvidence.stored,false,'FotMob goal facts are rejected at the persistence boundary');

 const cornerEvidence=await persistHistoricalTimedEvents(matchId,{
  source:'fotmob',kind:'corner',final:true,complete:true,timelineAvailable:parsed.cornerTimelineAvailable,
  homeCount:parsed.cornersHome,awayCount:parsed.cornersAway,
  homeScore:parsed.homeScore,awayScore:parsed.awayScore,events:parsed.cornerEvents
 },{database});
 assert.equal(cornerEvidence.stored,true,'complete FotMob corner chronology reconciles to the final counters');

 const cardEvidence=await persistHistoricalTimedEvents(matchId,{
  source:'fotmob',kind:'card',final:true,complete:true,timelineAvailable:parsed.cardTimelineAvailable,
  homeCount:parsed.cardsHome,awayCount:parsed.cardsAway,
  homeScore:parsed.homeScore,awayScore:parsed.awayScore,events:parsed.cardEvents
 },{database});
 assert.equal(cardEvidence.stored,true,'complete FotMob card chronology reconciles to total cards and card colours');

 const id='00000000-0000-4000-8000-000000000099';
 const line=(event,kind,contract)=>({id,match_id:matchId,live_contract:{version:1,event,kind,...contract}});
 const grade=(event,kind,contract)=>gradeStoredEventContract(line(event,kind,contract),{
  source:'ZIZOBET',home_score:1,away_score:0,corners_home:2,corners_away:1,
  cards_home:1,cards_away:1
 },{execute:run});

 // FotMob goal chronology is deliberately ignored for goal-market settlement.
 assert.equal(await grade('goal','sequence',{target:1,side:'home'}),null);
 assert.equal(await grade('goal','window',{from:20,to:25,choice:true}),null);

 // First/next/race/90+ corners.
 assert.equal(await grade('corner','sequence',{target:1,side:'home'}),'WON');
 assert.equal(await grade('corner','sequence',{target:2,side:'away'}),'WON');
 assert.equal(await grade('corner','race',{target:2,side:'home'}),'WON');
 assert.equal(await grade('corner','window',{from:90,to:90,choice:true}),'WON',
  '90+4 is included in the 90th-minute interval, not dropped from chronology');

 // Card sequence, exact color, and timed window.
 assert.equal(await grade('card','sequence',{target:2,side:'away'}),'WON');
 assert.equal(await grade('card','window',{from:19,to:21,choice:true,cardColor:'yellow'}),'WON');
 assert.equal(await grade('card','window',{from:84,to:86,choice:true,cardColor:'red'}),'WON');
 assert.equal(await grade('card','window',{from:84,to:86,choice:true,cardColor:'yellow'}),'LOST');

 // Ordinary aggregate totals use explicit final counters, never event-list guesses.
 const result={source:'ZIZOBET',home_score:1,away_score:0,
  corners_home:parsed.cornersHome,corners_away:parsed.cornersAway,
  cards_home:parsed.cardsHome,cards_away:parsed.cardsAway,
  statistics:{
   corners:{home:parsed.cornersHome,away:parsed.cornersAway},
   cards:{home:parsed.cardsHome,away:parsed.cardsAway},
   yellow:parsed.yellowCards,red:parsed.redCards,
   shots:parsed.statistics.shots,shotsOnTarget:parsed.statistics.shotsOnTarget,
   fouls:parsed.statistics.fouls,possession:parsed.statistics.possession
  }};
 assert.equal(gradeLine({market_name:'Total Corners',line:'2.5',outcome_name:'Over',outcome_key:'over'},result),'WON');
 assert.equal(gradeStatisticLine({market_name:'Total Cards',line:'1.5',outcome_name:'Over'},result),'WON');
 assert.equal(gradeStatisticLine({market_name:'Total Yellow Cards',line:'1.5',outcome_name:'Under'},result),'WON');
 assert.equal(gradeStatisticLine({market_name:'Total Red Cards',line:'0.5',outcome_name:'Over'},result),'WON');
 assert.equal(gradeStatisticLine({market_name:'Total Shots on Target',line:'6.5',outcome_name:'Over'},result),'WON');

 console.log('PASS FotMob statistics-only integration: corners/cards chronology, 90+ events, intervals, and no FotMob goal settlement');
}finally{await db.close();}
