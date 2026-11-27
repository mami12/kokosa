import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {validateHistoricalGoals,persistHistoricalGoalFacts} from '../server/ledger/historical-event-facts.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';

const complete={source:'fotmob',complete:true,final:true,goalsAvailable:true,
 homeScore:1,awayScore:1,events:[
  {type:'goal',id:'g12',team:'home',minute:12,player:'Home Scorer',own:false},
  {type:'goal',id:'g23',team:'away',minute:23,player:'Away Scorer',own:false}
 ]};
assert.equal(validateHistoricalGoals({...complete,events:complete.events.slice(0,1)}),null,
 'A partial goal list must not prove the entire FT result');
assert.equal(validateHistoricalGoals({...complete,events:[
 complete.events[0],{...complete.events[1],id:'g12'}]}),null,
 'Duplicated IDs cannot establish goal order');
assert.equal(validateHistoricalGoals({...complete,events:[
 {...complete.events[0],own:true},complete.events[1]]}),null,
 'Unresolved own-goal attribution remains pending');
assert.ok(validateHistoricalGoals(complete));
assert.equal(validateHistoricalGoals({...complete,events:[
 {...complete.events[0],minute:10,phase:'H2'},complete.events[1]]}),null,
 'Second-half minute must be an absolute match clock, not the period-relative minute');

// Every stoppage minute from 45+1 through 90+15 validates as regular time.
for(const base of [45,90])for(let added=1;added<=15;added++){
 const checked=validateHistoricalGoals({...complete,homeScore:1,awayScore:0,events:[
  {type:'goal',id:`goal-${base}-plus-${added}`,team:'home',minute:base,injury:added,own:false}
 ]});
 assert.ok(checked,`FotMob goal ${base}+${added} is valid regular-time stoppage evidence`);
 assert.equal(checked.events[0].minute,base+added);
 assert.equal(checked.events[0].phase,base===45?'H1':'H2');
}
assert.equal(validateHistoricalGoals({...complete,events:[
 {type:'goal',id:'bad-added-goal',team:'home',minute:40,injury:3,own:false},
 {type:'goal',id:'other-goal',team:'away',minute:23,own:false}
]}),null,'Added time away from the 45th/90th boundary is not accepted');

const db=new PGlite();
const database={connect:async()=>({query:(sql,params)=>db.query(sql,params),release(){}})};
try{
 await db.exec(LEDGER_SQL);
 const id=91822881;
 const run=(sql,params=[])=>db.query(sql,params);
 await run("insert into app_match_result(match_id,home_team,away_team,home_score,away_score,source) values($1,'Home','Away',1,1,'RECOVERY')",[id]);
 const written=await persistHistoricalGoalFacts(id,complete,{database});
 assert.equal(written.stored,true);
 assert.equal((await persistHistoricalGoalFacts(id,complete,{database})).reason,'ALREADY_VERIFIED');
 const conflicting={...complete,events:[{...complete.events[0],minute:13},complete.events[1]]};
 assert.equal((await persistHistoricalGoalFacts(id,conflicting,{database})).reason,'HISTORY_CHANGED');
 const facts=(await run('select provider,minute from app_match_event_fact where match_id=$1 order by minute',[id])).rows;
 assert.deepEqual(facts.map(x=>[x.provider,x.minute]),[['fotmob',12],['fotmob',23]]);
 const coverage=(await run("select provider,complete,confirmed_at from app_match_event_coverage where match_id=$1 and kind='goal'",[id])).rows;
 assert.equal(coverage.length,1);
 assert.equal(coverage[0].provider,'fotmob');
 assert.equal(coverage[0].complete,true);
 assert.ok(coverage[0].confirmed_at);

 const matchId=id,result={home_score:1,away_score:1},uuid='00000000-0000-4000-8000-000000000001';
 const line=(kind,rest)=>({id:uuid,match_id:matchId,live_contract:{version:1,kind,event:'goal',...rest}});
 const judge=(kind,rest)=>gradeStoredEventContract(line(kind,rest),result,{execute:run});
 assert.equal(await judge('sequence',{target:1,side:'home'}),'WON','Home scored goal one');
 assert.equal(await judge('sequence',{target:2,side:'home'}),'LOST','Away scored goal two');
 assert.equal(await judge('window',{from:10,to:20,choice:true}),'WON','Goal at minute 12');
 assert.equal(await judge('window',{from:10,to:20,choice:false}),'LOST');
 assert.equal(await judge('window',{from:30,to:40,choice:false}),'WON','Proved no goal');
 assert.equal(await judge('interval-leader',{from:10,to:20,side:'home'}),'WON');
 assert.equal(await judge('race',{target:1,side:'home'}),'WON');
 assert.equal(await judge('race',{target:2,side:'home'}),'VOID','Neither team reached 2');
 assert.equal(await judge('last-event',{side:'away'}),'WON','The verified last scorer is recovered from the historical timeline');
 assert.equal(await judge('nth-time',{target:2,choice:'range',from:20,to:25}),'WON','The second goal time is settled from verified chronology');
 assert.equal(await judge('half-first-event',{half:1,side:'home'}),'WON','First-half first goal uses the provider timeline');
 assert.equal(await judge('half-last-event',{half:1,side:'away'}),'WON','First-half last goal uses the provider timeline');
 assert.equal(await judge('player-goal',{playerName:'Home Scorer',choice:true}),null,
  'Supplementary historical scorer facts do not enable excluded player props');
 assert.equal(await judge('player-goal',{playerName:'Unused Bench Player',choice:true}),null,
  'Player props remain outside the allowed settlement scope');
 assert.equal(await gradeStoredEventContract(
  {...line('window',{from:10,to:20,choice:true}),live_contract:{
    version:1,kind:'window',event:'corner',from:10,to:20,choice:true}},
  result,{execute:run}),null,'Goal history cannot grade a corner bet');

 // Two stoppage-time goals must retain their true order (90+3 before 90+6).
 const stoppageMatch=id+10;
 await run(`insert into app_match_result(match_id,home_team,away_team,home_score,away_score,source)
  values($1,'Home','Away',1,1,'RECOVERY')`,[stoppageMatch]);
 const stoppagePayload={source:'fotmob',complete:true,final:true,goalsAvailable:true,
  homeScore:1,awayScore:1,events:[
   {type:'goal',id:'home-90-plus-3',team:'home',minute:90,injury:3,own:false},
   {type:'goal',id:'away-90-plus-6',team:'away',minute:90,injury:6,own:false}
  ]};
 assert.equal((await persistHistoricalGoalFacts(stoppageMatch,stoppagePayload,{database})).stored,true);
 const stoppageRows=(await run(`select minute,phase from app_match_event_fact
  where match_id=$1 and provider='fotmob' and kind='goal' order by minute`,[stoppageMatch])).rows;
 assert.deepEqual(stoppageRows,[{minute:93,phase:'H2'},{minute:96,phase:'H2'}]);
 const stoppageLine=(kind,rest)=>({id:uuid,match_id:stoppageMatch,
  live_contract:{version:1,kind,event:'goal',...rest}});
 assert.equal(await gradeStoredEventContract(stoppageLine('sequence',{target:1,side:'home'}),
  {home_score:1,away_score:1},{execute:run}),'WON','90+3 home is the first goal');
 assert.equal(await gradeStoredEventContract(stoppageLine('sequence',{target:2,side:'away'}),
  {home_score:1,away_score:1},{execute:run}),'WON','90+6 away is the second goal');
 assert.equal(await gradeStoredEventContract(stoppageLine('window',{from:76,to:90,choice:true}),
  {home_score:1,away_score:1},{execute:run}),'WON','90+N goals belong to the 76-90 interval');

 const firstHalfStoppageMatch=id+11;
 await run(`insert into app_match_result(match_id,home_team,away_team,home_score,away_score,source)
  values($1,'Home','Away',1,0,'RECOVERY')`,[firstHalfStoppageMatch]);
 const firstHalfAdded={source:'fotmob',complete:true,final:true,goalsAvailable:true,
  homeScore:1,awayScore:0,events:[
   {type:'goal',id:'home-45-plus-15',team:'home',minute:45,injury:15,own:false}
  ]};
 assert.equal((await persistHistoricalGoalFacts(firstHalfStoppageMatch,firstHalfAdded,{database})).stored,true);
 const firstHalfLine={id:uuid,match_id:firstHalfStoppageMatch,
  live_contract:{version:1,kind:'window',event:'goal',from:31,to:45,choice:true}};
 assert.equal(await gradeStoredEventContract(firstHalfLine,{home_score:1,away_score:0},
  {execute:run}),'WON','45+15 is included in the closing first-half interval');
 const firstHalfStored=(await run(`select minute,phase from app_match_event_fact
  where match_id=$1 and provider='fotmob' and kind='goal'`,[firstHalfStoppageMatch])).rows[0];
 assert.deepEqual(firstHalfStored,{minute:60,phase:'H1'});

 const other=91822882;
 await run("insert into app_match_result(match_id,home_team,away_team,home_score,away_score,source) values($1,'Home','Away',0,0,'RECOVERY')",[other]);
 assert.equal((await persistHistoricalGoalFacts(other,complete,{database})).reason,'HISTORY_SCORE_CONFLICT');
 assert.equal((await run('select count(*)::int as n from app_match_event_fact where match_id=$1',[other])).rows[0].n,0);
 console.log('PASS historical SQL facts: complete FT, frozen Next Goal/race/interval, missing corners PENDING, conflicts and idempotence');
}finally{await db.close();}
